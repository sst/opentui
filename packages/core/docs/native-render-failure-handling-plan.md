# Native Render Failure Handling Plan

## Purpose

This document defines a complete implementation plan for making OpenTUI native frame submission reliable under output backpressure and native failures.

The plan addresses four related requirements:

1. A frame that is temporarily rejected must not be silently lost.
2. Retryable failures must recover automatically without requiring terminal resize or unrelated input.
3. Permanent failures must not cause an endless render loop or sustained CPU consumption.
4. Native failures must carry enough information for TypeScript to choose the correct recovery policy.

This document is self-contained. It describes the current implementation, the observed defect, the native buffer constraints, the proposed status contract, retry policy, circuit breaker, implementation order, and required tests.

## Problem Summary

OpenTUI builds a complete application frame in TypeScript and submits it through the native renderer. Native rendering can currently return one of three numeric statuses:

```zig
pub const RenderStatus = enum(u8) {
    rendered = 0,
    skipped = 1,
    failed = 2,
};
```

The TypeScript renderer currently maps both native `skipped` and native `failed` to a single `"backpressured"` result:

```ts
const nativeStatus = this.lib.render(this.rendererPtr, force)
if (nativeStatus === NATIVE_RENDER_STATUS_SKIPPED || nativeStatus === NATIVE_RENDER_STATUS_FAILED) {
  this.scheduleRenderAfterFeedIdle()
  return "backpressured"
}
```

This loses essential information:

- Some skips are expected transient feed pressure.
- Some failures are temporary resource failures.
- Some failures can never succeed when retried with the same renderer or configuration.
- An invalid renderer handle is not backpressure.
- A frame exceeding a fixed capacity is not backpressure.
- A closed output transport is not backpressure.

The outer render loop historically did not retry the `"backpressured"` result in every output configuration. A rejected frame could therefore disappear until a later resize or input requested another render.

A provisional TypeScript change can retry rejected frames, but retrying every `skipped` or `failed` result forever is not a complete solution. Persistent rejection would run the complete renderable tree repeatedly and could consume substantial CPU.

## Relevant History

The current backpressure behavior was introduced on May 28, 2026 in:

```text
66856a87ec84897b3622e6a689646e98a32d5693
feat(core): route renderer output through NativeSpanFeed for custom stdout (#958)
```

It first shipped in OpenTUI `v0.3.0`.

An earlier related implementation existed on an unmerged review branch:

```text
7f00c416f6a0dbf2cfa638e588295e9143d1c426
fix(core): handle custom stdout feed backpressure safely
```

The released implementation must be treated as the source of truth.

## Current Rendering Pipeline

For an ordinary frame, TypeScript performs the following work:

1. Increment the frame ID.
2. Run animation callbacks.
3. Run frame callbacks.
4. Run root layout and culling.
5. Render the selected renderables into `nextRenderBuffer`.
6. Run post-processing.
7. Render the console overlay.
8. Call native `render(rendererPtr, force)`.
9. Native diffs `nextRenderBuffer` against `currentRenderBuffer`.
10. Native emits terminal bytes through its selected output backend.
11. Native updates its current-buffer, hit-grid, cursor, palette, and repaint state.

The main TypeScript code is in:

```text
packages/core/src/renderer.ts
```

The native rendering code is in:

```text
packages/core/src/zig/renderer.zig
packages/core/src/zig/renderer-output.zig
packages/core/src/zig/lib.zig
packages/core/src/zig/native-span-feed.zig
```

## Current Output Backends

### Buffered Backend

The buffered backend is used for normal process stdout and memory-backed output.

Current properties:

- `prepareFrame()` always returns `.ok`.
- `endFrame()` currently returns `.ok`.
- It has two fixed 2 MiB output buffers.
- `bufferWrite()` can return `BufferFull` if generated output exceeds a buffer.
- Writer errors in parts of native rendering are currently swallowed with `catch {}`.

This means normal buffered output does not currently report backpressure, but it also does not reliably surface every output-capacity failure.

The buffered sink callback currently returns `void`, so actual stdout or memory-sink failures cannot be reported through native status. Expand `BufferedWriteFn` to return an explicit fixed-width write status and propagate sink failure through `endFrame()`. Update every portable FFI callback implementation and test it in Bun, Node, and Deno where supported. The project is not complete while direct sink failures are silently swallowed.

### Feed Backend

The feed backend is used for custom stdout transports.

Current properties:

- It writes into `NativeSpanFeed` memory.
- It can skip before diffing when pending output or queue pressure exists.
- It can fail while writing or committing a frame.
- TypeScript receives feed data and writes it to the caller's `Writable`.
- TypeScript can wait for `feed.idle()`.

Default feed configuration:

```text
chunk size:          64 KiB
initial chunks:      2
maximum bytes:       unlimited by default
growth policy:       grow
span queue capacity: 4096
```

## Native Frame Mutation Constraints

Native-only replay is not safe with the current implementation.

### Early Skip

Native checks output availability before diffing:

```zig
if (self.backend.prepareFrame() != .ok) {
    return self.finishSkippedFrame();
}
```

`finishSkippedFrame()` clears the complete pending application frame:

```zig
fn clearSkippedFrameState(self: *CliRenderer) void {
    self.nextRenderBuffer.clear(self.backgroundColor, null);
    @memset(self.nextHitGrid, 0);
}
```

After this happens, native has no retained frame to submit again. TypeScript must rerender the tree to reconstruct `nextRenderBuffer` and `nextHitGrid`.

### Failure After Diffing Starts

During diff generation, native synchronizes changed cells into `currentRenderBuffer` immediately:

```zig
self.currentRenderBuffer.syncCell(x, y, nextCell.?);
```

At the end of native frame preparation, it also:

- Clears `nextRenderBuffer`.
- Swaps hit grids.
- Clears the next hit grid.
- Updates cursor tracking.
- Updates palette epoch tracking.
- Clears native force-repaint state.

If output then fails, native sets `force_full_repaint = true`, but the pending frame is no longer available as an immutable replay object.

Therefore, the first implementation must retry by rebuilding the application frame. Native-only replay must not be attempted until native frame submission becomes transactional or explicitly retains a pending frame.

### Partial Feed Emission

A feed-backed frame can fail after part of its terminal output has already been committed. `NativeSpanFeed` can auto-commit a full chunk while native is still generating the same logical frame. A later chunk allocation, queue push, write, or final commit can then fail.

Consequences:

- A rejected attempt does not necessarily mean that no bytes reached the downstream transport.
- The terminal may have received an incomplete synchronized-update envelope.
- Retrying a screen repaint can repair terminal state only if the retry emits a complete force repaint and closes any interrupted synchronization state.
- Split-scrollback appends are not generally idempotent. Replaying an append can duplicate rows.
- Fatal cleanup after partial emission must perform a best-effort synchronized-update reset and terminal-state restoration where the transport remains writable.

The final implementation must eliminate partial feed frame publication rather than attempting to make arbitrary partial frames replayable.

Implement a transactional feed-frame staging path:

1. Encode the complete ordinary frame or complete split batch into a native growable staging buffer.
2. Do not publish any feed span while encoding.
3. Validate and allocate every feed chunk/span required by the complete staged frame.
4. Publish all spans only after every allocation and queue-capacity check succeeds.
5. If preparation fails, publish nothing and return `outputState=none`.
6. Commit renderer visual state only after feed publication succeeds.

This staging buffer provides the concrete intrinsic-size proof:

- If the staged byte length exceeds a configured hard maximum even with zero occupied/pinned chunks, return fatal `capacity_limit`.
- If it can fit after existing chunks/spans drain, return retryable queue/pinned pressure.
- Allocation failure while building staging is `resource_exhausted/out_of_memory`.

During migration, before transactional staging is active, report `outputState=partial` when auto-commit may have occurred. The migration-only recovery algorithm is:

1. Wait for already published spans to drain.
2. Emit a best-effort `syncReset` control sequence through the same still-writable feed.
3. Rebuild and force a complete screen repaint.
4. Never replay split appends from a partially published batch; fail the split batch and rebuild its complete logical output from the application queue.

If the downstream transport has failed, do not attempt terminal repair. Transition to output unavailable and close the feed as defined below.

The native result reports whether output was committed:

```ts
interface NativeRenderResult {
  renderOffset: number
  disposition: NativeRenderDisposition
  reason: NativeRenderReason
  outputState: "none" | "partial" | "complete"
}
```

The packed result carries this field directly. Do not infer it from disposition.

### Split-Footer Batch Semantics

Split-footer output is a multi-call batch. Native retains `splitBatchActive` and related state between the first and final snapshot. A failure in the middle or final call can leave the batch active if handle validation fails before entering the renderer.

Before TypeScript can safely classify or retry split-footer failures, replace the multi-call submission protocol with one atomic `commitSplitFooterBatchV2` call. TypeScript passes an array of fixed-width snapshot descriptors. Native validates every renderer and snapshot handle before starting output or mutating split-scrollback state.

The implementation must define:

- No snapshot in a failed V2 batch is accepted.
- `renderOffset` advances only after complete batch publication succeeds.
- TypeScript calls `recordSplitCommit()` and drops queued commits only after complete batch success.
- Transactional feed staging prevents partial batch auto-commit.
- Native resets all temporary batch state before returning on every path.
- The V2 API has no externally visible intermediate continuation result.

Keep the old multi-call API only for old TypeScript compatibility. New TypeScript must use the atomic V2 API.

### Buffered Writer Failure Propagation

The buffered writer can return `BufferFull`, but native rendering currently uses `catch {}` throughout frame generation and continues mutating renderer state. Changing only `BufferedBackend.endFrame()` is insufficient.

Propagate writer errors through `prepareRenderFrameWithWriter()` and every output helper. Do not mutate committed renderer state while encoding. Specifically defer these operations until output acceptance:

- Synchronizing cells into `currentRenderBuffer`.
- Clearing `nextRenderBuffer`.
- Swapping hit grids.
- Updating cursor tracking.
- Updating palette epoch tracking.
- Clearing force-full-repaint state.

After the backend accepts the complete frame, perform a commit pass that copies changed cells and commits the deferred state. This makes native frame preparation transactional for both buffered and feed backends. Cover failures at the beginning, middle, cursor-restoration, and synchronized-update-reset portions of a frame.

## Measured Cost Of Whole-Tree Retry

The following measurements were collected on a 120 by 40 renderer with nested Box and Text renderables while forcing every native frame to be rejected:

| Renderables | JS render cost per attempt | Approximate one-core usage with 16.7 ms retry delay |
| ---: | ---: | ---: |
| 100 | 0.064 ms | 0.4% |
| 1,000 | 0.412 ms | 2.4% |
| 5,000 | 3.224 ms | 16.2% |
| 10,000 | 8.558 ms | 33.9% |
| 20,000 | 23.014 ms | 58.0% |

These are synthetic measurements. Real costs depend on Yoga work, culling, Markdown, diffs, text buffers, post-processing, and render hooks.

The conclusion is clear: a fixed 60 FPS retry loop is unacceptable for persistent failures.

## Design Goals

The final design must satisfy these invariants:

1. A transiently rejected frame remains logically pending.
2. Retryable pressure recovers automatically.
3. Feed pressure uses feed readiness rather than polling.
4. Repeated rejection does not run at 60 FPS forever.
5. Known permanent failures are never retried automatically.
6. Unknown failures decode to fatal `internal_error` and are not retried automatically. Only the temporary migration-only `legacy_unclassified` reason receives the legacy retry policy.
7. A rejected frame does not emit a successful `FRAME` event.
8. A rejected frame does not update successful-frame statistics.
9. Force-full-repaint state remains active until a frame succeeds.
10. Suspend, pause, stop, and destroy cancel pending retry timers.
11. `idle()` does not resolve while a retry or readiness wait is pending.
12. Fatal failure does not leave `idle()` waiting forever.
13. Every native failure is observable with a structured reason.
14. Split-footer and ordinary rendering use the same failure vocabulary.
15. Existing successful-frame scheduling and visual behavior remain unchanged except for accepted-frame statistics being corrected to exclude rejected attempts.

## Proposed Native Result Contract

Replace the coarse status with a packed result containing a disposition and reason.

### Disposition

```zig
pub const RenderDisposition = enum(u8) {
    rendered = 0,
    retryable = 1,
    resource_exhausted = 2,
    fatal = 3,
};
```

### Reason

```zig
pub const RenderReason = enum(u8) {
    none = 0,

    // Expected transient conditions.
    pending_output = 1,
    output_queue_full = 2,
    output_busy = 3,
    legacy_unclassified = 4, // Migration only; remove after Phase 2.

    // Resource conditions with a finite automatic retry budget.
    out_of_memory = 10,

    // Known permanent failures for the current renderer/frame/configuration.
    invalid_renderer = 20,
    invalid_buffer = 21,
    output_closed = 22,
    frame_too_large = 23,
    capacity_limit = 24,
    invalid_feed_state = 25,
    internal_error = 26,
    transport_failed = 27,
};
```

```zig
pub const OutputState = enum(u8) {
    none = 0,
    partial = 1, // Migration-only once transactional staging is complete.
    complete = 2,
};
```

### Packed Result

The existing ABI returns a small integer for ordinary render and a packed integer for split-footer operations. Add V2 operations that standardize both paths on the same packed result while preserving old exports for compatibility.

```zig
pub const RenderResult = struct {
    render_offset: u32,
    disposition: RenderDisposition,
    reason: RenderReason,
    output_state: OutputState,
    result_version: u8,
};
```

Use a packed `u64` for portable FFI:

```text
bits 0..31:  render offset
bits 32..39: disposition
bits 40..47: reason
bits 48..55: output state
bits 56..63: ABI result version
```

Use explicit-width types only. Do not expose backend-specific pointer or ABI types.

### ABI Versioning And Diagnostic Details

Adding packed `renderV2()` avoids changing the existing `render()` ABI. TypeScript and native artifacts must still detect whether the V2 contract is available rather than silently falling back.

Preserve the existing `render` export for old TypeScript and add a versioned `renderV2` export returning packed `u64`. New TypeScript must require `renderV2` and verify the result-version byte. This gives symmetric compatibility: old TypeScript continues calling the unchanged old export, while new TypeScript rejects native artifacts without `renderV2`. Do not change the return ABI of the existing symbol.

Add an explicit native ABI version or feature query as an additional startup check. The loader must reject an incompatible native library with an actionable error. Update every boundary:

- `packages/core/src/zig/lib.zig` export signatures.
- `packages/core/src/zig.ts` symbol definitions.
- `RenderLib` interface and platform facade.
- Bun FFI loading.
- Node portable FFI loading.
- Deno loading if supported by the current portable runtime layer.
- Test mocks.
- Optional platform-native packages.
- Distribution smoke tests.

The compact render result cannot carry required details such as attempted size, configured capacity, or operation. Add a concrete side channel:

```zig
pub const RenderFailureDetails = extern struct {
    operation: u8,
    output_state: u8,
    reserved: u16,
    attempted_bytes: u64,
    available_bytes: u64,
    configured_limit: u64,
};
```

Expose `getLastRenderFailureDetails(renderer, outPtr)` using a caller-provided fixed-width struct. Define these semantics:

- Details describe the most recent unsuccessful native render operation.
- A successful render clears the record.
- Access is same-thread with renderer calls unless synchronization is added.
- Invalid renderer handles are fully represented by the packed `renderV2` result; their optional details are zeroed because renderer-local details cannot be read.
- Details contain explicit-width numbers only.
- Operation distinguishes ordinary render, split repaint, split batch validation, split batch continuation, and split batch finalization.

### TypeScript Representation

```ts
type NativeRenderDisposition = "rendered" | "retryable" | "resource-exhausted" | "fatal"

type NativeRenderReason =
  | "none"
  | "pending-output"
  | "output-queue-full"
  | "output-busy"
  | "legacy-unclassified"
  | "out-of-memory"
  | "invalid-renderer"
  | "invalid-buffer"
  | "output-closed"
  | "frame-too-large"
  | "capacity-limit"
  | "invalid-feed-state"
  | "internal-error"
  | "transport-failed"

interface NativeRenderResult {
  renderOffset: number
  disposition: NativeRenderDisposition
  reason: NativeRenderReason
  outputState: "none" | "partial" | "complete"
}
```

Unknown numeric values must decode to `fatal/internal-error`, not to retryable pressure.

## Failure Classification

### Retryable

#### Pending Output

Condition:

- Feed has bytes from an earlier frame or control write that must be committed and drained first.

Native result:

```text
retryable / pending_output
```

Recovery:

- Wait for `feed.idle()`.
- Retry once after readiness.
- Do not poll while the feed is busy.

#### Output Queue Full

Condition:

- Feed span queue reached its high-water mark.

Native result:

```text
retryable / output_queue_full
```

Recovery:

- Wait for `feed.idle()`. A future below-high-water event may optimize latency but is not required by this plan.
- Retry after readiness.

#### Output Busy

Condition:

- Feed has an active reservation or temporary operation conflict.

Native result:

```text
retryable / output_busy
```

Recovery:

- Prefer an event-driven readiness signal.
- Otherwise use bounded backoff.

### Resource Exhaustion

#### Out Of Memory

Condition:

- Span-ring growth failed.
- Chunk allocation failed.
- State-buffer allocation failed.

Native result:

```text
resource_exhausted / out_of_memory
```

Recovery:

- Retry only a small finite number of times.
- Use exponential backoff.
- Open a circuit after the budget is exhausted.
- Preserve full-repaint state.
- Permit a later explicit render request to perform one probe attempt.

### Fatal

#### Invalid Renderer

Condition:

- Renderer handle cannot be acquired.
- Handle is stale, destroyed, or wrong-kind.

Native result:

```text
fatal / invalid_renderer
```

Recovery:

- No automatic retry.
- Mark renderer unusable.
- Emit a structured error.
- Require renderer reconstruction.

#### Invalid Buffer

Condition:

- Split-footer snapshot handle cannot be acquired.

Native result:

```text
fatal / invalid_buffer
```

Recovery:

- Drop that invalid queued commit.
- Emit an error identifying the bad snapshot.
- Keep the renderer alive if its renderer handle remains valid.
- Force a complete repaint from current application state.

#### Output Closed

Condition:

- Feed is closed.

Native result:

```text
fatal / output_closed
```

Recovery:

- No automatic retry.
- Mark output unavailable.
- Require transport or renderer reconstruction.

Native feed closure and downstream JavaScript transport failure are different conditions. Native only knows whether `NativeSpanFeed` is closed. TypeScript owns the caller's `Writable` and must separately observe:

- A synchronous exception from `stdout.write()`.
- An error passed to the write callback.
- The `error` event.
- The `close` event.
- `destroyed` or `writableEnded` before a write.

Add a TypeScript transport-failure path and a distinct reason such as `transport_failed`. Register and detach listeners with renderer lifecycle cleanup. Once the sink is unavailable:

- Increment retry generation so all readiness continuations become stale.
- Mark output unavailable before detaching handlers.
- Detach the feed data handler so no new writes target the failed sink.
- Let already-entered write callbacks settle; ignore their results after the generation change.
- Discard queued feed spans because they cannot reach the failed transport.
- Close the feed after in-flight handlers release their chunk references.
- Stop native submission.
- Mark output unavailable.
- Emit one deduplicated structured failure event.
- Do not continue automatic render retries.

`idle()` resolves after retry scheduling is cancelled and in-flight handlers have settled or feed close has completed. It does not wait for an unavailable transport to recover. Renderer destruction remains safe and idempotent after this transition.

The existing feed `Closed` event must not be described as proof that the downstream `Writable` closed.

#### Frame Too Large

Condition:

- Generated ANSI output exceeds the fixed buffered output capacity.
- Native can prove the complete encoded frame exceeds a fixed, non-drainable per-frame capacity.

Native result:

```text
fatal / frame_too_large
```

Recovery:

- No retry with unchanged capacity.
- Report attempted bytes, available bytes, and configured capacity through `RenderFailureDetails`.
- Preserve full-repaint state.
- Allow explicit recovery after capacity or dimensions change.

#### Capacity Limit

Condition:

- Native can prove the complete frame cannot fit after all drainable spans and pinned chunks are released.
- The configured hard limit is lower than the intrinsic complete-frame requirement.

Native result:

```text
fatal / capacity_limit
```

Recovery:

- Do not classify `NoSpace`, `MaxBytes`, or a blocking growth policy as fatal from the error tag alone. Finite `max_bytes` can be temporarily exhausted because existing chunks are pinned; the same write may succeed after drain.
- Record whether the failure is caused by temporary occupancy or an intrinsic frame requirement.
- No automatic retry only after native proves the same complete frame cannot fit after drain.
- Require feed configuration or renderer replacement for a proven intrinsic capacity failure.

#### Invalid Feed State

Condition:

- Invalid reservation lifecycle.
- Invalid commit/release state.
- Other feed protocol violation.

Native result:

```text
fatal / invalid_feed_state
```

Recovery:

- No automatic retry.
- Emit diagnostics.
- Treat as an implementation defect or API misuse.

#### Internal Error

Condition:

- Unknown native status.
- Unclassified native failure.
- Native invariant failure that can be reported without panic.

Native result:

```text
fatal / internal_error
```

Recovery:

- Use a finite automatic probe budget only if required during migration.
- Final behavior should stop automatic retries and report the error.

## Retry Policy

### Renderer Failure State Model

Implement explicit renderer states rather than distributing fatal/retry booleans across unrelated fields:

```ts
type NativeSubmissionState =
  | { type: "healthy" }
  | { type: "waiting-readiness"; reason: NativeRenderReason; attempt: number; generation: number }
  | { type: "backing-off"; reason: NativeRenderReason; attempt: number; dueAt: number; generation: number }
  | { type: "resource-circuit-open"; reason: NativeRenderReason; generation: number }
  | { type: "recoverable-after-reconfigure"; reason: NativeRenderReason; generation: number }
  | { type: "output-unavailable"; reason: NativeRenderReason; generation: number }
  | { type: "renderer-unusable"; reason: NativeRenderReason; generation: number }
```

Use a monotonically increasing generation token. `feed.idle()` promises cannot be cancelled, so every readiness continuation must capture the current generation and verify it before scheduling work. Increment the generation on:

- Pause.
- Stop.
- Suspend.
- Destroy.
- Fatal transition.
- Circuit-open transition.
- Output transport replacement or mode transition.
- Renderer reconfiguration that invalidates the pending attempt.

### Public Operation Behavior By State

Define and test the following behavior:

| State | `requestRender()` | `start()` / live | `resize()` | `resume()` | `idle()` |
| --- | --- | --- | --- | --- | --- |
| healthy | Normal | Normal | Normal | Normal | Resolves when quiescent |
| waiting-readiness | Mark application update pending; do not poll | Preserve requested running state | Mark update pending | Preserve wait if still valid | Remains pending |
| backing-off | Coalesce update into pending retry | Preserve requested running state | Coalesce and require full repaint | Preserve retry if valid | Remains pending |
| resource-circuit-open | Perform one explicit probe | Do not start continuous probes | Any actual dimension change performs one explicit probe because it can reduce frame size | One explicit probe | Resolves because scheduler is quiescent |
| recoverable-after-reconfigure | Record dirty state; no submission | No automatic submission | Probe only if resize can fix the reason | No submission without reconfiguration | Resolves |
| output-unavailable | No submission; emit/query existing failure | No submission | Preserve dirty state | No submission | Resolves |
| renderer-unusable | Safe no-op; state remains queryable | Same | Same | Same | Resolves |

For an unusable renderer, preserve safe no-op behavior for render-triggering and lifecycle cleanup methods. Expose `getNativeSubmissionState(): NativeSubmissionState` so callers can inspect the terminal condition. Methods that already throw after destruction retain their existing behavior; this project does not add new throws to `requestRender()`, resize, pause, stop, suspend, resume, or destroy. Do not introduce implicit renderer reconstruction.

Keep `idle(): Promise<void>` backward compatible: it resolves when scheduling is quiescent, including circuit-open or fatal states. Failure is communicated through the structured event and queryable state. Do not make existing `idle()` calls reject. A future separate API may offer reject-on-failure semantics.

### Retry State Transitions

Use these exact event semantics:

- `submit-success`: reset attempt count, retry reason, circuit, readiness wait, and generation-specific pending state.
- `submit-retryable(reason)`: increment the consecutive count for that reason and schedule readiness/backoff.
- `readiness-resolved(generation)`: no-op if generation or state changed; otherwise schedule one retry timer.
- `backoff-fired(generation)`: no-op if generation or state changed; otherwise submit one newly built frame.
- `explicit-request`: mark application update pending; if a resource circuit is open, allow exactly one probe.
- `submit-resource-failure`: advance finite resource retry budget or open circuit.
- `submit-fatal`: cancel scheduling, increment generation, transition to reason-specific fatal state, and emit once.
- `pause/stop/suspend/destroy`: cancel timers, increment generation, and prevent stale readiness continuations.
- `reconfigure`: increment generation, clear only recoverable failure states covered by that reconfiguration, force repaint, and perform one probe.

Counters are consecutive per reason. A different reason starts a new sequence but retains a total diagnostic count. Only successful native acceptance resets all retry history. A new application update does not reset pressure history.

For the legacy multi-call split API, only final batch acceptance counts as `submit-success`; intermediate continuation must not reset retry state. New TypeScript uses atomic `commitSplitFooterBatchV2`, which has only complete success or complete failure.

### Retry Metrics And Timer Ownership

`NativeSubmissionState` is the single source of lifecycle truth. Keep only orthogonal metrics outside it, such as total rejected attempts by reason and total recovery count. Do not duplicate retry reason, attempt, or circuit-open state in independent booleans.

Use one dedicated `nativeRetryTimer` rather than overloading the ordinary frame-loop `renderTimeout`. This makes pause, stop, suspend, destroy, idle accounting, and diagnostics explicit. Every timer callback captures and verifies the retry generation.

### Retryable Pressure With Feed Readiness

For `pending-output` and `output-queue-full`:

1. Set the pending full-repaint requirement.
2. Mark native retry as pending.
3. Wait for `feed.idle()`.
4. After idle, schedule one retry at the normal maximum-frame interval.
5. If the retry is rejected again after idle, increment consecutive retry count.
6. After several consecutive post-idle rejections, apply backoff.

No render-tree work should occur while waiting for `feed.idle()`.

### Retryable Pressure Without Readiness Event

Use this delay schedule:

```text
attempts 1-3:  one maximum-frame interval
attempt 4:     33 ms
attempt 5:     67 ms
attempt 6:     125 ms
attempt 7:     250 ms
attempt 8+:    500 ms, capped
```

Derive the first delay from `minTargetFrameTime`. Constants should be private and centrally defined.

Do not add random jitter. Retries are local and per-renderer; distributed synchronization is not a concern.

### Resource Exhaustion

For `out-of-memory`:

```text
attempt 1: 100 ms
attempt 2: 250 ms
attempt 3: 1000 ms
then open circuit
```

After opening the circuit:

- Cancel automatic retries.
- Emit an error.
- Keep full-repaint state.
- A later explicit application `requestRender()` may perform one probe attempt.
- If the probe succeeds, close the circuit and reset counters.
- If it fails for the same resource reason, reopen the circuit immediately.

### Fatal Failure

For a fatal result:

1. Cancel all retry timers and feed-idle retry callbacks.
2. Set retry count to zero.
3. Preserve full-repaint state if the renderer could recover after explicit reconfiguration.
4. Mark the renderer or output unavailable when appropriate.
5. Emit a structured error event.
6. Resolve `idle()` waiters once scheduling is quiescent; never leave them hanging.
7. Do not emit `FRAME`.
8. Do not update successful-frame statistics.
9. Do not automatically retry on resize unless the failure reason is explicitly recoverable through resize.

### Success

On the next successful native frame:

1. Reset consecutive retry count.
2. Clear retry reason.
3. Close any retry circuit.
4. Clear force-full-repaint only after native acceptance.
5. Emit exactly one successful frame event for that accepted attempt.
6. Resume normal scheduling.

### Whole-Tree Retry Semantics

With the current buffers, a retry is a new logical frame, not replay of the rejected logical frame. Define this explicitly:

- Every retry increments `frameId`.
- Frame callbacks run again.
- Render hooks run again for selected renderables.
- A one-shot animation request consumed by the rejected attempt remains consumed; application state produced by it must remain reflected in the next rebuilt frame.
- Delta time continues from the prior loop attempt according to the existing TypeScript clock.
- Native `lastRenderTime` advances only after accepted output. Move its update into the native state-commit phase and test accumulated delta across rejected attempts.
- `CliRenderEvents.FRAME` means accepted native frame, not loop attempt.

Because callbacks can have side effects, add an explicit `applicationUpdatePending` bit. Calls to `requestRender()` during a rejected attempt set it. After the retry succeeds, schedule one additional frame if this bit indicates that updates arrived after the rebuilt frame's relevant callback phase. Do not infer this solely from the retry timer.

Test one-shot animation callbacks, asynchronous frame callbacks, render-time requests, frame IDs, and delta time across rejection.

### Statistics Semantics

Separate these counters:

- Render loop attempts.
- Native submission attempts.
- Accepted frames.
- Rejected attempts by disposition and reason.
- Retry count.
- Time spent rebuilding rejected frames.

Existing `renderStats.frameCount` currently advances before native acceptance. Moving accepted-frame counters after successful submission is an intentional behavior change. FPS exposed to users should count accepted frames. Attempt counters belong in debug/native-failure statistics.

## Structured Error Reporting

Add a discriminated renderer event for native submission transitions.

```ts
type NativeRenderTransitionEvent =
  | {
      type: "failure"
      disposition: "retryable" | "resource-exhausted" | "fatal"
      reason: NativeRenderReason
      attempts: number
      message: string
      details?: Record<string, string | number | boolean>
    }
  | {
      type: "recovery"
      previousReason: NativeRenderReason
      attempts: number
      durationMs: number
    }
```

Suggested event:

```ts
CliRenderEvents.NATIVE_RENDER_TRANSITION
```

The event must not include pointers or backend-specific ABI values.

Retryable failures are observable through this event and scheduler/debug state, but must be rate-limited by transition. Emit on the first failure, reason change, entry into backoff, circuit opening, fatal transition, and recovery. Do not emit on every repeated attempt.

Log only when there is no listener or according to existing renderer error-reporting conventions. Avoid logging on every retry. Log transitions:

- First failure.
- Entry into backoff.
- Circuit opened.
- Recovery after previous failure.

The existing feed error callback and downstream `Writable` events must feed the same deduplicated failure transition. Assign one transition ID or generation so a feed error, native result, and transport event from the same incident do not produce duplicate user-visible errors. Listener exceptions must be caught and must not interfere with scheduler cleanup.

Extend `getSchedulerState()` with:

```ts
retryState: "none" | "waiting-readiness" | "scheduled" | "circuit-open" | "fatal"
retryReason: NativeRenderReason | null
retryAttempt: number
retryDueAt: number | null
```

Include readiness waits in `hasScheduledRender` or document a separate `hasPendingWork` field.

## Step-By-Step Implementation

### Phase 0: Preserve A Clean Baseline

1. Record the current branch and worktree state.
2. Preserve existing reproduction commits and user changes.
3. Run the current focused renderer suites.
4. Run the full core TypeScript suite.
5. Record existing expected warnings separately from failures.
6. Do not combine status-contract work with unrelated ScrollBox, Markdown, or layout changes.

Acceptance gate:

- Baseline failures are known and documented.
- No unrelated files are modified.

### Phase 1: Add Native Result Types Without Changing Behavior

1. Add `RenderDisposition` and `RenderReason` to `renderer.zig`.
2. Replace or extend `RenderResult` to contain disposition and reason.
3. Add stable explicit numeric values.
4. Add packing and unpacking helpers in `lib.zig` and TypeScript.
5. Update ordinary `render`, `repaintSplitFooter`, and `commitSplitFooterSnapshot` to return the same packed contract.
6. Add TypeScript decoding with exhaustive switches.
7. Treat unknown values as fatal internal errors.
8. Add a temporary `retryable / legacy_unclassified` reason for the old generic `failed` behavior so Phase 1 truly has no behavior change.
9. Add ABI version/feature detection and fail loading on mixed old-native/new-TypeScript artifacts.
10. Update every runtime FFI facade and packaged native artifact listed in the ABI section.

Tests:

- Zig packing round trip.
- TypeScript decoding for every disposition/reason.
- Unknown disposition/reason decoding.
- Ordinary and split-footer APIs return identical vocabulary.
- Old native/new TypeScript and new native/old TypeScript compatibility rejection.
- Bun, Node, and Deno decoding where supported.

Acceptance gate:

- No behavior change yet.
- Existing renderer tests pass.
- Native ABI tests pass.

### Phase 2: Preserve Native Error Reasons

1. Change feed writer errors so they no longer collapse all `StreamError` values into `BufferFull`.
2. Map `Busy` to retryable output busy.
3. Map queue high-water and prior pending bytes separately.
4. Map `OutOfMemory` to resource exhaustion.
5. Preserve operation and occupancy context for `NoSpace` and `MaxBytes`; classify them as fatal only when intrinsic complete-frame size is proven.
6. Map closed-feed `Invalid` to fatal output closed.
7. Map protocol-state `Invalid` to fatal invalid feed state.
8. Return fatal invalid renderer when handle acquisition fails.
9. Return fatal invalid buffer when split snapshot acquisition fails.
10. Implement the chosen buffered writer-error propagation design; do not merely change `endFrame()`.
11. Return fatal frame too large only when fixed output capacity is proven insufficient.
12. Add and populate the failure-details side channel.
13. Add downstream TypeScript `Writable` error/close handling.
14. Add split-batch atomic validation or explicit abort/reset before retry policy work.
15. Remove `legacy_unclassified` after every path is classified.

Tests:

- One Zig test per mapped reason.
- Invalid renderer handle.
- Invalid snapshot handle.
- Closed feed.
- Busy reservation.
- Queue high-water.
- Pending prior bytes.
- Maximum feed bytes exceeded.
- Finite maximum bytes temporarily exhausted by pinned chunks, then successful after release.
- Blocking growth policy temporarily full, then successful after drain.
- Allocation failure using failing allocator.
- Fixed buffered frame capacity exceeded.
- Buffered overflow at early, middle, cursor-restoration, and sync-reset output.
- Writable callback error, synchronous throw, error event, and close event.
- Split batch failure at first, middle, and final positions.
- Invalid middle snapshot leaves no active native batch.
- Partial feed auto-commit followed by repair or fatal cleanup.

Acceptance gate:

- Every native failure path has an explicit reason.
- No generic `failed` remains without an internal-error reason.

### Phase 3: Implement The TypeScript Retry State Machine

1. Add a single method to process native render results.
2. Keep normal successful-frame scheduling and visual behavior unchanged except for the intentional accepted-frame statistics correction defined above.
3. Add event-driven feed retry for pending output and queue pressure.
4. Add one timer latch for non-event retry.
5. Add consecutive retry count.
6. Add exponential backoff after the initial fast retry window.
7. Reset all retry state on success.
8. Preserve force-full-repaint through every rejected attempt.
9. Ensure requests during a pending retry are coalesced but not lost.
10. Ensure a successful retry can be followed by one additional frame if application updates arrived during rejection.
11. Keep rejected attempts out of `FRAME` events and successful stats.
12. Include retry state in `isIdleNow()`.
13. Ensure `getSchedulerState()` reports retry scheduling accurately.

Tests must use `ManualClock`. Do not use sleep-based assertions.

Acceptance gate:

- Transient rejection recovers automatically.
- Persistent retryable rejection backs off.
- No wall-clock-dependent scheduler tests.

### Phase 4: Implement Resource Circuit Breaking

1. Add the finite out-of-memory retry sequence.
2. Open a circuit after the retry budget.
3. Emit one structured error when the circuit opens.
4. Stop automatic retries.
5. Preserve full-repaint state.
6. Allow one explicit probe on a later application request.
7. Reset circuit state after successful probe.
8. Reopen immediately if the same resource failure repeats.

Tests:

- Exact retry delays with `ManualClock`.
- No timer after circuit opens.
- Idle resolves after circuit opens.
- Explicit request performs one probe.
- Successful probe resets state.
- Failed probe does not start a new rapid retry sequence.

Acceptance gate:

- Resource exhaustion cannot create an endless automatic render loop.

### Phase 5: Implement Fatal Failure Handling

1. Add structured fatal failure event.
2. Cancel pending timers and feed-idle retry state.
3. Define renderer viability per fatal reason.
4. Invalid renderer: mark renderer unusable.
5. Invalid split buffer: atomic V2 prevalidation rejects the entire unstarted batch. Drop the invalid commit, retain the other logical commits for a newly constructed batch where valid, and preserve renderer viability. No native split state or render offset may have changed.
6. Output closed: mark transport unavailable.
7. Frame too large/capacity limit: block automatic retries pending explicit reconfiguration.
8. Internal error: stop automatic retries and surface diagnostics.
9. Resolve or reject idle waiters.
10. Ensure later calls behave predictably and do not silently spin.

Tests:

- Every fatal reason schedules zero retries.
- Exactly one failure event per transition.
- No successful frame event.
- Idle does not hang.
- Destroy remains safe.
- Suspend/resume does not accidentally revive a fatal renderer.
- Invalid split snapshot does not kill unrelated rendering.

Acceptance gate:

- Known permanent failures consume no ongoing CPU.
- Callers receive actionable diagnostics.

### Phase 6: Control-State Integration

Test and, if needed, adjust interactions with:

- `start()`.
- `pause()`.
- `stop()`.
- `requestLive()` and `dropLive()`.
- `suspend()`.
- `resume()`.
- `destroy()` during an active render.
- `destroy()` while waiting for feed idle.
- `destroy()` with a scheduled backoff timer.
- Renderer resize.
- Split-footer mode transitions.
- External output mode transitions.

Required behavior:

- Pause and stop clear retry timers.
- Suspend clears timers and does not schedule while suspended.
- Resume requests a full repaint only when recovery is allowed.
- Destroy resolves waiters and detaches feed callbacks.
- Continuous mode does not create duplicate retry and frame-loop timers.

### Phase 7: End-To-End Visual Regression Tests

Add an application-like frame containing mixed renderables:

- User-message Box subtree.
- Tool-call Box subtree.
- Plain Text renderable.
- Markdown renderable.
- Nested boxes.
- ScrollBox with `viewportCulling=true`.
- Sticky bottom.

Test sequence:

1. Build the mixed frame.
2. Force one native retryable rejection.
3. Verify no successful frame event is emitted for rejection.
4. Advance `ManualClock` or resolve feed readiness.
5. Allow native acceptance.
6. Verify all mixed content appears without resize.
7. Verify the hit grid corresponds to the accepted visual frame.
8. Verify force-full-repaint resets only after success.

Add variants for:

- Direct buffered output.
- Feed-backed custom output.
- Split-footer output.
- New application update arriving while retry is pending.

### Phase 8: Performance Verification

1. Add a benchmark for rejected frames at representative tree sizes.
2. Measure retryable pressure before readiness; verify zero tree renders while waiting for feed idle.
3. Measure backoff frequency during persistent retryable rejection.
4. Measure resource circuit behavior.
5. Verify successful-frame performance is unchanged within noise.
6. Record retry count and delay in debug stats if useful.

Acceptance targets:

- No fixed 60 FPS loop after the initial fast retry window.
- Feed pressure performs no polling while feed is busy.
- Fatal failures perform no retries.
- Successful rendering has no material regression.

### Phase 9: Documentation And Release Notes

1. Document native render failure events.
2. Document custom-output backpressure behavior.
3. Document whether fatal output errors require renderer recreation.
4. Add release notes describing dropped-frame recovery and bounded retries.
5. Avoid claiming this fixes an application issue unless an end-to-end reproduction proves it.

## Complete Test Matrix

### Native Unit Tests

- Render success.
- Pending output.
- Queue high-water.
- Busy feed.
- Closed feed.
- Feed maximum bytes.
- Feed out of memory.
- Invalid feed state.
- Invalid renderer handle.
- Invalid snapshot handle.
- Buffered frame too large.
- Unknown/internal error fallback.
- Packed result ABI round trip.

### TypeScript Unit Tests

- Decode every native result.
- Retry once then succeed.
- Multiple retries then succeed.
- Fast retries transition to backoff.
- Backoff caps at maximum delay.
- Success resets backoff.
- Multiple requests coalesce.
- Request during rejected frame is preserved.
- Forced repaint survives rejection.
- Rejected frame emits no frame event.
- Accepted retry emits frame event.
- Successful stats exclude rejected attempts.
- Direct output retry.
- Feed idle retry.
- Split-footer retry.
- Pause cancellation.
- Stop cancellation.
- Suspend cancellation.
- Resume behavior.
- Destroy cancellation.
- Destroy while feed idle promise is pending.
- Idle while retry timer is pending.
- Idle after fatal failure.
- Continuous/live renderer behavior.
- Resource circuit open.
- Explicit circuit probe.
- Fatal failure no retry.
- Fatal event payload.
- Native mock restoration between tests.
- Feed readiness resolving after pause, stop, suspend, destroy, fatal transition, and output-mode transition.
- Alternating retry reasons and per-reason counter semantics.
- One-shot animation requests across rejection.
- Async frame callback pending during cancellation and fatal transition.
- Frame IDs and delta time across retries.
- Failure event listener throwing.
- Retry generation invalidated by renderer/output replacement.

### Integration Tests

- Mixed ScrollBox subtree survives one rejected frame.
- Mixed ScrollBox subtree survives multiple retryable rejections.
- Content updates while waiting are included after recovery.
- Hit grid matches accepted frame.
- Resize during retry.
- Output mode transition during retry.
- Renderer suspend/resume during retry.
- Partial feed output followed by successful full repaint.
- Split batch rejection at first, middle, and final commit.
- Split render offset does not advance on unaccepted finalization.
- Split rows are neither duplicated nor dropped after recovery.
- Downstream transport callback error, synchronous throw, error event, and close.
- Fatal-state behavior for every public render-triggering API.

### Full Verification Commands

From `packages/core`:

```sh
bun test src/tests/renderer.custom-stdout.test.ts
bun test src/tests/renderer.control.test.ts
bun test src/tests/renderer.idle.test.ts
bun test src/tests/renderer.clock.test.ts
bun test
bun run test:native
```

From repository root:

```sh
bunx oxlint packages/core/src/renderer.ts packages/core/src/tests/renderer.custom-stdout.test.ts
bunx oxfmt --check packages/core/src/renderer.ts packages/core/src/tests/renderer.custom-stdout.test.ts
git diff --check
```

Run the build because this plan requires native Zig and FFI changes:

```sh
bun run build
```

## Rollout Strategy

Split implementation into reviewable commits:

1. Native result ABI and decoding, no behavior change.
2. Native reason propagation and Zig tests.
3. Retryable scheduling and TypeScript tests.
4. Resource backoff and circuit breaker.
5. Fatal error handling and events.
6. End-to-end mixed-renderable regression tests.
7. Documentation and benchmarks.

Do not combine all phases into one large commit. The ABI change, native classification, and scheduling policy should remain independently reviewable.

## Risks And Mitigations

### Risk: Native And TypeScript Enum Drift

Mitigation:

- Explicit numeric values.
- Shared generated constants if available.
- ABI round-trip tests.
- Unknown values decode as fatal.

### Risk: Retry Timer Duplication

Mitigation:

- One timer latch.
- Event-driven feed wait.
- Scheduler-state tests.

### Risk: Lost Application Update During Native Retry

Mitigation:

- Preserve a pending application-update flag.
- Rebuild the tree on retry with the current architecture.
- Test updates requested during rejection.

### Risk: Idle Waiters Hang

Mitigation:

- Include retry timer, feed wait, and circuit transition in idle state.
- Resolve idle once fatal-state scheduling and in-flight transport cleanup are quiescent; report failure through state and transition events.

### Risk: Fatal Failure Revived By Resize

Mitigation:

- Store fatal reason and renderer viability.
- Gate `requestRender()` based on recovery policy.
- Test resize and resume after fatal failure.

### Risk: Native-Only Replay Introduces Buffer Divergence

Mitigation:

- Do not implement native-only replay in this project phase.
- Keep whole-tree reconstruction until native frames are transactional.

### Risk: Persistent Retryable Failure Still Consumes CPU

Mitigation:

- Event-driven feed waiting.
- Exponential backoff.
- 500 ms cap for persistent retryable conditions.
- Warning after a threshold.

### Risk: Resource Failure Recovers But Circuit Prevents Progress

Mitigation:

- Allow an explicit request to perform one probe.
- Reset circuit immediately on success.

## Non-Goals

This plan does not include:

- Reworking ScrollBox viewport culling.
- Changing Markdown or Code rendering behavior.
- Implementing native retained-frame replay.
- Redesigning Yoga layout.
- Changing successful-frame FPS behavior.
- Automatically recreating renderer handles or output transports.

Those concerns should remain separate unless evidence proves they are required.

## Final Acceptance Criteria

The work is complete only when all of the following are true:

1. Native returns disposition and reason for every render rejection.
2. Expected feed pressure retries automatically after readiness.
3. Retryable pressure backs off under persistence.
4. Out-of-memory retries are finite and circuit-broken.
5. Known fatal failures perform no automatic retries.
6. Fatal failures emit structured diagnostics.
7. No rejected attempt emits a successful frame event.
8. Force-full-repaint survives until acceptance.
9. Suspend, stop, pause, and destroy cancel retries safely.
10. Idle behavior is deterministic for retry, circuit-open, and fatal states.
11. Mixed renderable content recovers without resize after transient rejection.
12. Full TypeScript and native test suites pass.
13. Formatting, lint, build, and diff checks pass.
14. Benchmarks confirm persistent failures cannot consume a large CPU fraction at fixed 60 FPS.
15. Documentation accurately distinguishes proven renderer behavior from unproven application-level causes.
16. Feed frame publication and native committed-state updates are transactional.
17. Atomic split V2 batches cannot leave active batch state, advance offsets, duplicate rows, or drop valid queued commits after failure.
18. Downstream `Writable` and buffered sink failures transition to output unavailable without retry loops or leaked feed references.
19. V2 ABI compatibility is verified for every supported runtime and rejects incompatible native artifacts.
20. Partial-output migration behavior is tested and no V2 feed frame can report partial publication.
