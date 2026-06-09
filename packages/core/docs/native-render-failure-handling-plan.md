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
6. Unknown failures have a finite automatic retry budget.
7. A rejected frame does not emit a successful `FRAME` event.
8. A rejected frame does not update successful-frame statistics.
9. Force-full-repaint state remains active until a frame succeeds.
10. Suspend, pause, stop, and destroy cancel pending retry timers.
11. `idle()` does not resolve while a retry or readiness wait is pending.
12. Fatal failure does not leave `idle()` waiting forever.
13. Every native failure is observable with a structured reason.
14. Split-footer and ordinary rendering use the same failure vocabulary.
15. Existing successful-frame scheduling remains unchanged.

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
};
```

### Packed Result

The existing ABI returns a small integer for ordinary render and a packed integer for split-footer operations. Standardize both paths on a packed result.

```zig
pub const RenderResult = extern struct {
    render_offset: u32,
    disposition: u8,
    reason: u8,
    reserved: u16,
};
```

If returning a struct is undesirable for portable FFI, encode it in `u64`:

```text
bits 0..31:  render offset
bits 32..39: disposition
bits 40..47: reason
bits 48..63: reserved
```

Use explicit-width types only. Do not expose backend-specific pointer or ABI types.

### TypeScript Representation

```ts
type NativeRenderDisposition = "rendered" | "retryable" | "resource-exhausted" | "fatal"

type NativeRenderReason =
  | "none"
  | "pending-output"
  | "output-queue-full"
  | "output-busy"
  | "out-of-memory"
  | "invalid-renderer"
  | "invalid-buffer"
  | "output-closed"
  | "frame-too-large"
  | "capacity-limit"
  | "invalid-feed-state"
  | "internal-error"

interface NativeRenderResult {
  renderOffset: number
  disposition: NativeRenderDisposition
  reason: NativeRenderReason
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

- Wait for `feed.idle()` or a more precise below-high-water event if added.
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

#### Frame Too Large

Condition:

- Generated ANSI output exceeds the fixed buffered output capacity.
- A single frame cannot fit in the configured feed/chunk constraints.

Native result:

```text
fatal / frame_too_large
```

Recovery:

- No retry with unchanged capacity.
- Report required and available capacity where possible.
- Preserve full-repaint state.
- Allow explicit recovery after capacity or dimensions change.

#### Capacity Limit

Condition:

- Feed growth would exceed configured `max_bytes`.
- Growth policy forbids expansion required by the frame.

Native result:

```text
fatal / capacity_limit
```

Recovery:

- No automatic retry.
- Require feed configuration or renderer replacement.

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

### Consecutive Retry State

Add renderer state:

```ts
private nativeRetryCount = 0
private nativeRetryTimer: TimerHandle | null = null
private nativeRetryReason: NativeRenderReason | null = null
private nativeRenderCircuitOpen = false
```

Do not overload unrelated state if explicit fields make cancellation and observability safer. If the existing `renderTimeout` remains the retry timer, document that ownership clearly and ensure all control paths cancel it.

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
6. Resolve or reject `idle()` waiters; never leave them hanging.
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

## Structured Error Reporting

Add a renderer event for native render failures.

```ts
interface NativeRenderFailureEvent {
  disposition: "resource-exhausted" | "fatal"
  reason: NativeRenderReason
  attempts: number
  message: string
  details?: Record<string, string | number | boolean>
}
```

Suggested event:

```ts
CliRenderEvents.NATIVE_RENDER_FAILURE
```

The event must not include pointers or backend-specific ABI values.

Log only when there is no listener or according to existing renderer error-reporting conventions. Avoid logging on every retry. Log transitions:

- First failure.
- Entry into backoff.
- Circuit opened.
- Recovery after previous failure.

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
8. Keep existing behavior temporarily by mapping old outcomes to equivalent new dispositions.

Tests:

- Zig packing round trip.
- TypeScript decoding for every disposition/reason.
- Unknown disposition/reason decoding.
- Ordinary and split-footer APIs return identical vocabulary.

Acceptance gate:

- No behavior change yet.
- Existing renderer tests pass.
- Native ABI tests pass.

### Phase 2: Preserve Native Error Reasons

1. Change feed writer errors so they no longer collapse all `StreamError` values into `BufferFull`.
2. Map `Busy` to retryable output busy.
3. Map queue high-water and prior pending bytes separately.
4. Map `OutOfMemory` to resource exhaustion.
5. Map `MaxBytes` to fatal capacity limit.
6. Map closed-feed `Invalid` to fatal output closed.
7. Map protocol-state `Invalid` to fatal invalid feed state.
8. Return fatal invalid renderer when handle acquisition fails.
9. Return fatal invalid buffer when split snapshot acquisition fails.
10. Audit buffered writer `BufferFull` handling; stop swallowing it.
11. Return fatal frame too large when fixed output capacity is exceeded.
12. Add details such as capacity and attempted size where practical.

Tests:

- One Zig test per mapped reason.
- Invalid renderer handle.
- Invalid snapshot handle.
- Closed feed.
- Busy reservation.
- Queue high-water.
- Pending prior bytes.
- Maximum feed bytes exceeded.
- Allocation failure using failing allocator.
- Fixed buffered frame capacity exceeded.

Acceptance gate:

- Every native failure path has an explicit reason.
- No generic `failed` remains without an internal-error reason.

### Phase 3: Implement The TypeScript Retry State Machine

1. Add a single method to process native render results.
2. Keep the normal successful-frame branch unchanged.
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
5. Invalid split buffer: drop only the invalid commit and preserve renderer viability.
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

### Integration Tests

- Mixed ScrollBox subtree survives one rejected frame.
- Mixed ScrollBox subtree survives multiple retryable rejections.
- Content updates while waiting are included after recovery.
- Hit grid matches accepted frame.
- Resize during retry.
- Output mode transition during retry.
- Renderer suspend/resume during retry.

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
- Resolve or reject idle on fatal transition.

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
