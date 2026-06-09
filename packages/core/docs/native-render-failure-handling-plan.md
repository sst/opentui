# Native Render Failure Handling Plan

## Goal

Fix dropped native frames without adding a new rendering architecture.

The implementation must remain simple:

- No new native ABI.
- No new native transaction system.
- No retained-frame queue.
- No exponential-backoff state machine.
- No circuit breaker.
- No new public API.
- No changes to normal successful rendering.
- No polling while output is backpressured.

## Current Bug

Native rendering currently returns three statuses:

```zig
pub const RenderStatus = enum(u8) {
    rendered = 0,
    skipped = 1,
    failed = 2,
};
```

TypeScript currently collapses native `skipped` and `failed` into one `"backpressured"` result.

The outer render loop does not correctly preserve every rejected frame. A transiently skipped frame can therefore remain missing until another event, such as resize or input, requests a new frame.

## Existing Native Semantics

The existing statuses are sufficient if TypeScript handles them differently.

### `rendered`

The frame was accepted.

Behavior:

- Continue existing successful-frame behavior unchanged.
- Emit the existing frame event.
- Update existing successful-frame statistics.
- Clear the pending force-repaint state as native already does.

### `skipped`

The frame was not attempted because the feed was temporarily unable to accept another frame.

Current native causes are:

- Pending bytes from an earlier feed write had to be committed first.
- The feed queue was at its high-water mark.

This is temporary output backpressure.

Behavior:

- Do not emit a successful frame event.
- Do not treat the frame as accepted.
- Wait for the existing `feed.idle()` readiness signal.
- Schedule exactly one new render after the feed becomes idle.
- Do not poll while the feed remains busy.
- Coalesce any additional render requests into that one pending render.

### `failed`

Native attempted the frame but could not complete it.

The existing native code already sets `force_full_repaint = true` after a failed frame. The next ordinary render request will therefore perform a complete repaint.

Behavior:

- Do not automatically retry.
- Do not emit a successful frame event.
- Do not treat the frame as accepted.
- Report the failure once with `console.error` using the existing renderer error style.
- Leave native force-full-repaint state intact.
- Wait for the next normal application render request, resize, resume, or other existing render trigger.

This avoids an endless retry loop for unknown or permanent failures.

## Why No Exponential Backoff Is Needed

Automatic retries are only used for native `skipped`.

`skipped` is feed backpressure, and the feed already provides `idle()`. The renderer waits for that readiness event instead of repeatedly retrying on a timer.

Native `failed` is not automatically retried.

Therefore:

- There is no unbounded timer loop.
- There is no repeated whole-tree rendering while the feed is busy.
- There is no need for retry counters.
- There is no need for exponential backoff.
- There is no need for a retry limit.
- There is no persistent retry CPU cost.

## Scope

This change fixes one invariant:

> A frame skipped because of temporary feed backpressure must cause one new render after the feed becomes ready.

It does not attempt to redesign native output failures.

The normal OpenTUI process-stdout backend currently does not return `skipped` from `prepareFrame()`. The feed-backed custom-output path is the path that currently reports temporary backpressure.

Do not claim this change fixes an application-specific blank-rendering issue unless an end-to-end reproduction proves that the affected application uses this path and receives native `skipped`.

## Implementation

### Step 1: Preserve Native Statuses In TypeScript

Change the private TypeScript result from:

```ts
"rendered" | "backpressured" | "skipped"
```

to:

```ts
"rendered" | "retryable-skip" | "failed" | "blocked"
```

Mapping:

```text
native rendered -> rendered
native skipped  -> retryable-skip
native failed   -> failed
split startup block -> blocked
```

This is private implementation detail. Do not add a public status API.

### Step 2: Keep One Feed-Idle Wait

Reuse the existing `feedIdleRenderScheduled` boolean as the only latch.

When native returns `retryable-skip`:

1. If no feed exists, log an unexpected skip and do not loop automatically.
2. If a feed-idle wait already exists, do nothing.
3. Otherwise call `feed.idle()` once.
4. When it resolves, verify the renderer is not destroyed, paused, stopped, or suspended.
5. Schedule one normal render.

Do not add another retry counter, queue, timer state, or state enum.

While `feedIdleRenderScheduled` is true, `requestRender()` must not schedule a competing frame. The one render after feed readiness rebuilds from current application state, so updates are naturally coalesced without another pending-update structure.

### Step 3: Avoid The Existing Scheduling Race

Do not call `requestRender()` from the feed-idle continuation while the original one-shot `activateFrame()` may still own `updateScheduled`.

Use the existing renderer clock to schedule one call to `loop()` after the current frame has completed:

```ts
this.renderTimeout = this.clock.setTimeout(() => {
  this.renderTimeout = null
  this.loop()
}, this.minTargetFrameTime)
```

Guard it with the existing `renderTimeout` field so only one retry can exist.

This is the only retry timer. It is created only after `feed.idle()` resolves, not while the feed is backpressured.

### Step 4: Handle Native Failure Without Retrying

When native returns `failed`:

1. Do not schedule a retry.
2. Clear any TypeScript immediate-rerender request associated only with that attempt.
3. Log one error:

```text
[CliRenderer] Native frame render failed; waiting for the next render request to force repaint
```

4. Leave native force-full-repaint state unchanged.
5. Return to idle if no other ordinary work is pending.

Do not add failure counters or failure state.

### Step 5: Preserve Existing Control Behavior

The retry uses existing scheduling fields, so existing control paths remain authoritative:

- `pause()` clears `renderTimeout`; the feed-idle continuation checks paused state.
- `stop()` clears `renderTimeout`; the feed-idle continuation checks stopped state.
- `suspend()` clears scheduling; the feed-idle continuation checks suspended state.
- `destroy()` prevents the feed-idle continuation from scheduling.
- `resume()` uses its existing full-repaint behavior.
- Continuous rendering continues through its existing frame loop.

Do not add special cases unless a deterministic test demonstrates a missing one.

## Performance

Normal rendering receives one extra status comparison only.

During feed backpressure:

- The renderer waits on `feed.idle()`.
- It does not rerender the tree.
- It does not poll.
- It allocates no retry queue.
- It schedules one render after readiness.

During native failure:

- It logs once for that failed attempt.
- It performs no automatic retries.
- It consumes no ongoing retry CPU.

## Tests

All scheduler tests must use `ManualClock`. Do not use real `setTimeout` sleeps.

### Status Mapping

1. Native status `0` maps to `rendered`.
2. Native status `1` maps to `retryable-skip`.
3. Native status `2` maps to `failed`.
4. Split startup blocking maps to `blocked`, not feed backpressure.

### Feed Skip Recovery

1. Force one native `skipped` result on a feed-backed renderer.
2. Verify no successful frame event is emitted.
3. Verify exactly one feed-idle wait is active.
4. Resolve feed idle.
5. Advance `ManualClock` by one maximum-frame interval.
6. Return native `rendered`.
7. Verify one successful frame event is emitted.
8. Verify no retry remains scheduled.

### Coalescing

1. Force native `skipped`.
2. Request rendering multiple times while feed idle is pending.
3. Verify only one retry render occurs after readiness.
4. Verify the latest application state is present in that rebuilt frame.

### Repeated Feed Pressure

1. Return `skipped`.
2. Resolve feed idle and retry.
3. Return `skipped` again.
4. Verify the renderer waits for a new feed-idle transition.
5. Verify it does not poll between readiness transitions.
6. Resolve again and return `rendered`.

### Failure

1. Force native `failed`.
2. Verify no automatic retry is scheduled.
3. Verify no successful frame event is emitted.
4. Verify one error is reported.
5. Trigger a new ordinary render request.
6. Return `rendered`.
7. Verify the renderer recovers and emits a successful frame event.

### Cancellation

For each of `pause`, `stop`, `suspend`, and `destroy`:

1. Force native `skipped`.
2. Enter the control state before feed idle resolves.
3. Resolve feed idle.
4. Advance `ManualClock`.
5. Verify no retry occurs.

### Continuous Rendering

1. Start the renderer.
2. Force one native `skipped` result.
3. Resolve feed idle.
4. Advance `ManualClock`.
5. Verify rendering resumes through the existing continuous loop.
6. Verify only one scheduler timer is active.

### Mock Isolation

Native render mocks modify a process-global library object. Every test must restore the original function before destroying the renderer or running another test.

Run a snapshot-heavy renderer suite after the retry tests to prove no mock contamination remains.

## Verification

From `packages/core`:

```sh
bun test src/tests/renderer.custom-stdout.test.ts
bun test src/tests/renderer.control.test.ts
bun test src/tests/renderer.idle.test.ts
bun test src/tests/renderer.clock.test.ts
bun test
```

From repository root:

```sh
bunx oxlint packages/core/src/renderer.ts packages/core/src/tests/renderer.custom-stdout.test.ts
bunx oxfmt --check packages/core/src/renderer.ts packages/core/src/tests/renderer.custom-stdout.test.ts
git diff --check
```

No native build is required because this plan does not change Zig or FFI code.

## Files To Change

```text
packages/core/src/renderer.ts
packages/core/src/tests/renderer.custom-stdout.test.ts
```

Do not change ScrollBox, renderables, native Zig code, FFI declarations, or public APIs.

## Acceptance Criteria

The work is complete when:

1. Feed-backed native `skipped` always causes one render after feed readiness.
2. The renderer performs no polling while feed output is busy.
3. Additional requests during backpressure are coalesced and not lost.
4. Native `failed` causes no automatic retry loop.
5. Pause, stop, suspend, and destroy cancel pending retry work.
6. Successful rendering behavior is unchanged.
7. Rejected attempts do not emit successful frame events.
8. All new scheduler tests use `ManualClock`.
9. The complete core test suite passes.
10. Lint, format, and diff checks pass.
