# Native Handle Migration Plan

## Summary

OpenTUI currently passes raw Zig object pointers through the JavaScript FFI boundary. That makes late JavaScript calls after a native object has been destroyed capable of dereferencing freed memory. The concrete failure mode this plan addresses is a renderer pointer being destroyed and then used by a later cursor call:

```txt
destroyRenderer(5457969152)
destroyRenderer returned: undefined
...
setCursorPosition(5457969152, 0, 0, 0)
```

The long-term fix is to stop exposing raw native object pointers to JavaScript. Every long-lived native object crossing the FFI boundary should be represented by an opaque generational handle. The Zig FFI layer owns the handle table, validates handles at every exported function boundary, and resolves valid handles to native pointers before calling implementation code.

This document describes a complete, step-by-step migration for all relevant native object families: renderer, buffers, text buffers, text buffer views, edit buffers, editor views, syntax styles, event sinks, audio engines, and native span feed streams.

## Goals

- Prevent use-after-free crashes from stale JavaScript references.
- Keep safety checks at the native FFI boundary instead of spreading lifecycle guards across TypeScript wrappers.
- Preserve the public TypeScript API shape where possible while changing internal FFI representations.
- Make double-destroy and post-destroy calls deterministic no-ops or error codes, never native memory faults.
- Keep overhead low enough for hot render paths.
- Migrate all long-lived native objects consistently, not just one object family.

## Non-Goals

- Do not redesign object ownership inside the Zig implementation modules.
- Do not introduce JavaScript-side finalizers as the primary safety mechanism.
- Do not make every borrowed pointer or temporary out-buffer a handle. Only long-lived native objects that JavaScript stores and passes back should become handles.
- Do not silently ignore all native errors. Functions that already return status codes should continue to return meaningful invalid-handle status values where possible.
- Do not remove the optimized buffer direct-write path. Native buffer cell arrays must remain directly accessible to TypeScript via `toArrayBuffer(...)` typed arrays for performance.

## Current Native Object Inventory

The following constructors/destructors currently expose native object pointers or pointer-like long-lived objects across the FFI boundary.

The audit must include both `packages/core/src/zig/lib.zig` and other Zig modules with `pub export fn` declarations. At the time this plan was written, `native-span-feed.zig` exports stream functions directly, so it must use the same handle infrastructure even though it is not in `lib.zig`.

### Renderer

- `createRenderer(...) ?*renderer.CliRenderer`
- `destroyRenderer(rendererPtr: *renderer.CliRenderer)`
- Many renderer methods accept `*renderer.CliRenderer`, including cursor, terminal, render, split scrollback, hit grid, palette, and stats operations.
- `getNextBuffer(rendererPtr)` and `getCurrentBuffer(rendererPtr)` currently return renderer-owned `*buffer.OptimizedBuffer` pointers. These are long-lived references from JavaScript's perspective, but they are not independently owned buffers. They need explicit borrowed-child handle semantics.

### Buffers

- `createOptimizedBuffer(...) ?*buffer.OptimizedBuffer`
- `destroyOptimizedBuffer(bufferPtr: *buffer.OptimizedBuffer)`
- `destroyFrameBuffer(frameBufferPtr: *buffer.OptimizedBuffer)`
- Drawing APIs pass `*buffer.OptimizedBuffer` for target and source buffers.
- `bufferGetCharPtr`, `bufferGetFgPtr`, `bufferGetBgPtr`, and `bufferGetAttributesPtr` return direct pointers to buffer cell arrays. TypeScript wraps these with `toArrayBuffer(...)` and typed arrays in `packages/core/src/buffer.ts` so render code can write cells directly.

`FrameBuffer` is currently the same native type as `OptimizedBuffer`. It can share the same handle kind unless a separate public type is needed for diagnostics.

### Text Buffers and Views

- `createTextBuffer(...) ?*text_buffer.UnifiedTextBuffer`
- `destroyTextBuffer(tb: *text_buffer.UnifiedTextBuffer)`
- `createTextBufferView(tb: *text_buffer.UnifiedTextBuffer) ?*text_buffer_view.UnifiedTextBufferView`
- `destroyTextBufferView(view: *text_buffer_view.UnifiedTextBufferView)`
- Many text buffer and view APIs accept these pointers.

### Edit Buffers and Editor Views

- `createEditBuffer(...) ?*edit_buffer_mod.EditBuffer`
- `destroyEditBuffer(edit_buffer: *edit_buffer_mod.EditBuffer)`
- `createEditorView(edit_buffer: *edit_buffer_mod.EditBuffer, ...) ?*editor_view.EditorView`
- `destroyEditorView(view: *editor_view.EditorView)`
- Edit buffer APIs return or accept related text buffer pointers today, for example `editBufferGetTextBuffer`.

### Syntax Styles

- `createSyntaxStyle() ?*syntax_style.SyntaxStyle`
- `destroySyntaxStyle(style: *syntax_style.SyntaxStyle)`
- Text buffer APIs accept syntax style pointers.

### Event Sinks

- `createEventSink(callback: ?event_bus.EventCallback) ?*event_bus.EventSink`
- `destroyEventSink(sink: *event_bus.EventSink)`
- Event sinks are passed into edit buffer construction and callbacks.

### Audio

- `createAudioEngine(...) ?*native_audio.Engine`
- `destroyAudioEngine(engine: *native_audio.Engine)`
- Audio APIs accept engine pointers.
- Sound, voice, and group identities are already integer IDs scoped to an engine. They should remain IDs, not handles.

### Native Span Feed

- `createNativeSpanFeed(...) ?*native_span_feed.Stream`
- `destroyNativeSpanFeed(stream: ?*Stream)`
- `attachNativeSpanFeed`, `streamWrite`, `streamCommit`, `streamDrainSpans`, `streamClose`, `streamReserve`, `streamCommitReserved`, `streamSetOptions`, `streamGetStats`, and `streamSetCallback` accept stream pointers.

### Buffer Data Pointers, Borrowed Pointers, and Temporary Pointers

Buffer cell-array pointers are a deliberate data-plane escape hatch. They are not object handles. They expose raw memory so TypeScript can write directly into native buffers without an FFI call per cell. This path must remain available unless a separate performance project replaces it.

The handle migration can protect FFI calls that accept a buffer object, but it cannot validate direct writes through previously-created `Uint32Array` or `Uint16Array` views. Once JavaScript has a typed array backed by native memory, writes to that array bypass `lib.zig` entirely. Therefore:

- buffer object references should become handles for FFI calls such as draw/copy/clear/destroy
- `bufferGet*Ptr` APIs may continue returning raw data pointers for active buffers
- TypeScript `OptimizedBuffer` must treat typed array views as borrowed views tied to the buffer lifetime
- destroying a buffer must invalidate the wrapper's cached views where possible
- code holding old typed array references after destroy is still unsafe by design and should be documented as invalid usage
- debug/test builds may optionally poison or zero memory before free, but native handle validation cannot catch direct typed-array writes

Renderer-owned current/next buffers are not temporary pointers. They are stable child objects owned by the renderer and used repeatedly from JavaScript. Their object identity should be represented as borrowed child handles, but their cell arrays still need direct raw data pointers while the renderer is alive.

### Other Borrowed or Temporary Pointers

Some exports return temporary arrays or use caller-provided buffers, for example highlight result arrays freed by `textBufferFreeLineHighlights(...)`, byte buffers, RGBA arrays, and out parameters. These are not long-lived object handles in the same sense. They need a separate audit, but they should not block the first handle-table migration.

## Handle Model

Use a generational handle table owned by the Zig FFI layer.

### Handle Type

Use one integer handle representation for all object handles. Phase 2 decides the exact ABI width after verifying Bun FFI round-tripping on supported platforms.

Reserve `0` as invalid/null.

One practical `u64` encoding:

```txt
bits  0..31  slot index
bits 32..55  generation
bits 56..63  kind tag
```

The kind can also live only in the slot, but encoding it in the handle improves debugging and rejects wrong-kind calls before reading slot metadata. Keep the slot kind check as the source of truth.

If Phase 2 chooses a `u32` handle, adapt the bit layout instead of using the example above. A `u32` layout must still include a slot index and generation. A kind tag is useful but optional if the table slot always stores and checks kind.

### Slot Shape

```zig
const ObjectKind = enum(u8) {
    renderer,
    optimized_buffer,
    text_buffer,
    text_buffer_view,
    edit_buffer,
    editor_view,
    syntax_style,
    event_sink,
    audio_engine,
    native_span_feed,
};

const SlotState = enum(u8) {
    vacant,
    alive,
    destroying,
};

const ObjectSlot = struct {
    generation: u32,
    kind: ObjectKind,
    state: SlotState,
    ptr: ?*anyopaque,
    owned: bool,
    owner: Handle,
};
```

`owned` indicates whether destroying the slot should deinitialize/free the native object. `owner` is `0` for independent objects and the owning handle for borrowed child handles such as renderer current/next buffers. Borrowed child handles must be invalidated when their owner is destroyed, but their native memory must not be freed by the handle table.

### Core Operations

Provide helpers in a new Zig module, for example `src/zig/handles.zig`:

- `insert(kind, ptr) !Handle`
- `resolve(handle, expected_kind, comptime T: type) ?*T`
- `beginDestroy(handle, expected_kind, comptime T: type) ?*T`
- `finishDestroy(handle)` or have `beginDestroy` return a destruction guard object
- `isValid(handle, expected_kind) bool`
- `invalidateChildren(owner_handle)` for borrowed handles owned by another object

Resolution must return a pointer only when:

- handle is non-zero
- slot index is in bounds
- generation matches
- kind matches
- state is `alive`
- pointer is non-null

Destroy should mark the slot `destroying` before invoking the native destructor. This prevents reentrant FFI calls or callbacks from resolving the same object during destruction. After destruction finishes, clear the pointer, mark the slot vacant, increment generation, and add the slot to the free list.

When an owned parent is destroyed, invalidate borrowed child handles before or during parent destruction so any later JavaScript references to child handles fail closed. For renderer destruction, this includes the handles returned for `getNextBuffer` and `getCurrentBuffer`.

### Thread Safety

The handle table is global FFI state. Access must be synchronized unless implementation proves all handle operations happen on one thread. Do not rely on JavaScript being single-threaded for correctness: native render/audio/stream code already has threaded paths and callbacks.

Recommended default:

- Protect table mutation and resolution with a `std.Thread.Mutex` or equivalent.
- Keep the locked section small: validate slot, copy out the native pointer, then unlock before calling into object implementation when safe.
- For destruction, mark the slot `destroying` while locked, then release the lock before running the object's destructor, then reacquire to clear the slot. This avoids deadlocks if destructors trigger callbacks or invalidate child handles.
- Document any object family that requires the table lock to remain held during a call, and avoid that unless there is a specific race that cannot be solved otherwise.

The performance benchmarks must include the selected locking strategy. If uncontended mutex overhead is too high for hot calls, evaluate a per-kind table lock or a read/write strategy, but start with the simplest correct mutex design.

### Invalid Handle Behavior

Use consistent behavior by return type:

- `void` functions: no-op.
- pointer-returning constructors or getters: return `null` or handle `0`.
- boolean functions: return `false`.
- integer/status functions: return an existing invalid-argument code where available, otherwise introduce a shared invalid-handle status.
- size-returning functions: return `0` when no better error channel exists.

Do not log invalid handles by default in production. Add debug logging under a dedicated debug flag if needed, because stale calls during shutdown may be benign once handles are safe.

## TypeScript FFI Model

Introduce branded handle types in `packages/core/src/zig.ts` or a nearby FFI type module.

```ts
type NativeHandle<T extends string> = number & { readonly __nativeHandle: T }

type RendererHandle = NativeHandle<"renderer">
type OptimizedBufferHandle = NativeHandle<"optimized_buffer">
type TextBufferHandle = NativeHandle<"text_buffer">
type TextBufferViewHandle = NativeHandle<"text_buffer_view">
type EditBufferHandle = NativeHandle<"edit_buffer">
type EditorViewHandle = NativeHandle<"editor_view">
type SyntaxStyleHandle = NativeHandle<"syntax_style">
type EventSinkHandle = NativeHandle<"event_sink">
type AudioEngineHandle = NativeHandle<"audio_engine">
type NativeSpanFeedHandle = NativeHandle<"native_span_feed">
```

FFI declarations should use integer ABI types for handles. Prefer `u64` only if Bun FFI supports round-tripping the values safely in this project and the TypeScript wrapper can store them without precision loss. If JavaScript number precision is a concern, use `u32` handles or use `bigint` consistently. A `u32` handle can still encode slot and generation if the table size is bounded; if it also encodes kind, budget bits explicitly for index, generation, and kind.

Decision point before implementation:

- Benchmark and verify Bun FFI behavior for `u64` handle return/argument on all supported runtimes.
- If `u64` maps to `bigint`, decide whether the TypeScript wrappers should store handles as `bigint` or whether a `u32` design is preferable.

## Performance Expectations

A generational handle lookup is normally:

- integer decode
- bounds check
- array slot load
- generation compare
- kind compare
- pointer load

This is cheaper than a hash map lookup and should be small relative to a Bun FFI crossing for most calls. However, this project has hot native APIs, so the migration must include benchmarks instead of relying on assumptions.

Benchmark at least:

- `setCursorPosition` repeated many times.
- `bufferWriteResolvedChars` or equivalent frame write path.
- `render` / frame loop throughput.
- text buffer edit operations.
- native span feed stream writes.

Benchmark each in three variants where feasible:

1. current raw pointer baseline
2. handle lookup only
3. handle lookup plus debug invalid-handle instrumentation disabled

Acceptance target: no material regression in frame throughput. Small per-call overhead on tiny calls is acceptable if it removes crash-class memory unsafety, but this must be documented with numbers.

## Migration Phases

### Phase 0: Reproduction and Baseline

1. Add a minimal regression test that reproduces the known class of bug:
   - create a renderer
   - destroy it
   - call `setCursorPosition` with the old reference
   - assert no crash and no native dereference after the migration
2. Record current FFI debug evidence in the test or issue description:

   ```txt
   destroyRenderer(ptr)
   destroyRenderer returned
   setCursorPosition(ptr, ...)
   ```

3. Add baseline performance measurements for renderer, buffer, text, and stream hot paths.

### Phase 1: Add Handle Infrastructure Without Changing Existing APIs

1. Add `handles.zig` with the table, slot, generation, kind, free-list, and tests.
2. Add unit tests for:
   - insert and resolve
   - wrong kind rejected
   - invalid zero rejected
   - double destroy rejected/no-op
   - stale generation rejected after slot reuse
   - destroy marks `destroying` before destructor body runs
3. Keep this module unused by public exports initially.

### Phase 2: Decide ABI Width and TypeScript Handle Representation

1. Add a small native test export if needed to round-trip candidate handle values.
2. Verify Bun FFI behavior for the selected ABI type on supported platforms.
3. Choose one:
   - `u32` handles represented as JavaScript `number`
   - `u64` handles represented as JavaScript `bigint`
   - `u64` handles represented as JavaScript `number` only if proven safe for the chosen bit layout
4. Document the choice in code comments in `handles.zig` and `zig.ts`.
5. Add a test that stale handles are rejected after enough create/destroy cycles to force slot reuse and generation increments.

### Phase 3: Migrate Renderer Handle Family

1. Change `createRenderer` to return a renderer handle instead of `*CliRenderer`.
2. Change every renderer export in `lib.zig` to accept the handle and resolve it at the boundary.
3. Change `destroyRenderer` to call `beginDestroy` and no-op on invalid/stale handles.
4. Register stable borrowed child handles for the renderer-owned current and next buffers returned by `getCurrentBuffer` and `getNextBuffer`. Do not allocate a new handle on every getter call. Do not allow these borrowed handles to free renderer-owned buffers.
5. Invalidate renderer-owned child buffer handles when the renderer is destroyed.
6. Update `packages/core/src/zig.ts` FFI declarations and `FFIRenderLib` methods to use `RendererHandle`.
7. Update TypeScript classes so `rendererPtr` becomes a handle, not a `Pointer`.
8. Add regression tests:
   - renderer call after destroy is a no-op
   - destroy twice is a no-op
   - creating a second renderer after destroying the first does not let stale handle target the new renderer
   - callback or renderable cleanup after renderer destroy cannot crash
   - stale current/next buffer handles from a destroyed renderer are rejected
9. Run renderer and keymap integration tests with `OTUI_DEBUG_FFI=1` to verify stale renderer handles are rejected at the FFI boundary. The debug log may still show calls with handle values after destruction; those calls must not resolve to freed native pointers.

### Phase 4: Migrate Buffer Handles

1. Migrate standalone `OptimizedBuffer` / frame buffer exports to handles.
2. Decide whether `frame_buffer` is a distinct handle kind or an alias of `optimized_buffer`.
3. Keep renderer-owned current/next buffers as borrowed buffer handles owned by the renderer, not standalone owned buffers.
4. Preserve direct cell-array access. `bufferGetCharPtr`, `bufferGetFgPtr`, `bufferGetBgPtr`, and `bufferGetAttributesPtr` should validate the buffer handle and return raw data pointers only for live buffers. They should return null/zero for invalid handles.
5. Keep TypeScript `OptimizedBuffer.buffers` backed by `toArrayBuffer(...)` typed arrays for direct writes. This is required for performance and is not replaced by handles.
6. Update all buffer draw/copy/read APIs to resolve source and target object handles.
7. Invalid source buffer should make draw APIs no-op; invalid target buffer should no-op or return an error depending on current API shape.
8. Add tests for stale source handles, stale target handles, wrong-kind handles, borrowed renderer buffer handles after renderer destroy, and `bufferGet*Ptr` returning null/zero for invalid handles.
9. Add TypeScript tests that `OptimizedBuffer.destroy()` clears its cached typed-array views and that `buffers` cannot be reacquired after destroy.
10. Document that previously retained typed-array views are invalid after buffer destroy. Native handle validation cannot protect direct writes through old typed-array references because they bypass FFI.
11. Benchmark frame buffer draw, resolved-char write, and direct typed-array cell writes.

### Phase 5: Migrate Text Buffer and Text Buffer View Handles

1. Migrate `UnifiedTextBuffer` exports to `TextBufferHandle`.
2. Migrate `UnifiedTextBufferView` exports to `TextBufferViewHandle`.
3. `createTextBufferView(textBufferHandle)` must resolve the text buffer handle and return handle `0` on invalid input.
4. Decide dependency behavior:
   - text buffer views should not keep raw parent handles in JavaScript
   - native view ownership should remain as currently implemented unless the Zig modules need explicit parent validity checks
   - if native view memory depends on the parent text buffer remaining alive, either enforce destroy order or mark the view as a borrowed/dependent handle owned by the text buffer
5. Add tests:
   - view call after view destroy no-ops or returns safe value
   - text buffer call after destroy no-ops or returns safe value
   - creating a view with stale text buffer handle returns invalid handle
   - stale text buffer handle cannot target a newly allocated text buffer
6. Benchmark text append, range queries, view line info, and selection operations.

### Phase 6: Migrate Edit Buffer and Editor View Handles

1. Migrate `EditBuffer` exports to `EditBufferHandle`.
2. Migrate `EditorView` exports to `EditorViewHandle`.
3. `createEditorView(editBufferHandle, ...)` must validate the edit buffer handle.
4. APIs returning related objects must be audited. For example, if `editBufferGetTextBuffer` currently returns a raw text buffer pointer, it should return a `TextBufferHandle` or be replaced with an API that avoids exposing the child object.
5. APIs returning editor-view-owned or edit-buffer-owned objects, such as `editorViewGetTextBufferView`, must return stable borrowed child handles, not fresh handles on every call.
6. Add tests:
   - editor view call after destroy is safe
   - edit buffer call after destroy is safe
   - editor view creation with stale edit buffer handle returns invalid handle
   - destroying edit buffer before editor view either prevents unsafe view access or is explicitly disallowed by ownership rules
   - stale handles returned by `editBufferGetTextBuffer` and `editorViewGetTextBufferView` are rejected after their owner is destroyed
7. Re-run the original cursor use-after-destroy scenario. It must be impossible for the stale renderer handle or stale editor resources to crash.

### Phase 7: Migrate Syntax Style Handles

1. Migrate `SyntaxStyle` exports to `SyntaxStyleHandle`.
2. APIs such as text buffer syntax style setters should resolve style handles at the boundary.
3. Decide what `null` style means. Preserve current behavior for clearing style.
4. Add tests:
   - setting destroyed style is safe
   - destroying style twice is safe
   - text buffer cleanup after style destruction remains safe

### Phase 8: Migrate Event Sink Handles

1. Migrate `EventSink` exports to `EventSinkHandle`.
2. APIs accepting event sinks, such as edit buffer creation, should resolve the handle or treat invalid handles as null.
3. Add tests:
   - event sink callback after destroy cannot fire through stale handle
   - edit buffer creation with stale event sink behaves like no sink or fails safely

### Phase 9: Migrate Audio Engine Handles

1. Migrate `native_audio.Engine` exports to `AudioEngineHandle`.
2. Keep sound, group, and voice IDs as engine-scoped integer IDs.
3. All audio exports should validate the engine handle first.
4. Invalid engine handle should return a native audio invalid-argument status where available.
5. Add tests:
   - audio calls after engine destroy return invalid status and do not crash
   - double destroy is safe
   - stale engine handle cannot target a newly allocated engine
6. Benchmark audio mix/read hot paths if they cross FFI frequently.

### Phase 10: Migrate Native Span Feed Stream Handles

1. Migrate `native_span_feed.Stream` exports to `NativeSpanFeedHandle`.
2. Update TypeScript handler maps from `Map<Pointer, Handler>` to `Map<NativeSpanFeedHandle, Handler>`.
3. Update both `lib.zig` and direct `pub export fn` declarations in `native-span-feed.zig` to use the same handle table.
4. Native callbacks should pass the stream handle, not a raw stream pointer, if JavaScript needs to dispatch by stream identity.
5. If native callbacks currently only know the stream pointer, store the handle in the stream object or in callback context during creation.
6. Add tests:
   - stream write after destroy returns invalid status
   - callbacks after destroy are ignored
   - stale stream handle cannot target a reused stream slot
7. Benchmark stream write/commit/drain paths.

### Phase 11: Audit Temporary Pointer APIs

After all long-lived objects use handles, audit remaining raw pointer uses in TypeScript FFI declarations.

Also audit every Zig `export fn` and `pub export fn`, not just the declarations in `lib.zig`, so direct module exports cannot keep accepting raw object pointers accidentally.

Classify each remaining pointer as one of:

- caller-provided buffer pointer valid only for the duration of the call
- returned temporary allocation with explicit free function
- callback function pointer
- internal borrowed pointer that should not cross the boundary

For each returned temporary allocation, confirm:

- ownership is documented
- free function is safe for null/invalid where possible
- stale/free-twice behavior is tested or impossible by API design

Do not convert every temporary pointer to a generational handle by default. Handles are for long-lived objects that JavaScript stores and passes back repeatedly.

### Phase 12: Remove Raw Pointer Types From Public Core Wrappers

1. Search for `Pointer` in `packages/core/src`.
2. Replace object pointer usages with branded handle types.
3. Keep `Pointer` only for memory buffers, callbacks, FFI internals, or temporary borrowed data.
4. Add TypeScript tests or type assertions where practical to prevent passing one handle kind to another wrapper.

### Phase 13: Full Validation

Run all relevant checks:

```sh
bun run build
cd packages/core && bun run test:native
cd packages/core && bun test
cd packages/keymap && bun run test
```

Also run targeted integration tests with FFI debug logging:

```sh
OTUI_DEBUG_FFI=1 bun test <tests that create/destroy multiple renderers and textareas>
```

Confirm debug logs do not show stale handles resolving to freed native pointers. After this migration, JavaScript may still call exported functions with stale handle values during cleanup; those calls must be rejected by handle validation before any native object dereference. During migration this may require adding debug output for handle invalidation rather than relying on raw pointer call logs.

## Rollout Strategy

This is a breaking internal FFI migration but should not be a user-facing API break.

Recommended branch strategy:

1. Land `handles.zig` and tests with no public behavior change.
2. Land renderer migration and regression tests.
3. Land buffer migration.
4. Land text/edit/style migration.
5. Land event/audio/span feed migration.
6. Land final pointer audit cleanup.

Each phase should be independently reviewable and should leave the repo green.

## Backward Compatibility

The public JavaScript/TypeScript API should not expose native pointers today as a documented API. Internal package code may still depend on pointer-shaped values. Update all workspace packages together.

Do not support both raw pointer and handle representations for the same object family long-term. A mixed mode makes correctness harder to reason about. During a single commit or short-lived branch it is acceptable to add compatibility helpers, but they must be removed before merging the phase.

## Failure Modes To Test Explicitly

- Calling any method after destroy.
- Destroying twice.
- Destroying parent before child where the API allows it.
- Creating a new object after destroying an old one and then using the stale old handle.
- Passing a handle of the wrong kind to an export.
- Passing handle `0` to every export that accepts a handle.
- Calling methods on borrowed child handles after their owner is destroyed.
- Destroying a borrowed child handle directly. This should no-op or be rejected; it must not free owner-managed memory.
- Requesting buffer cell-array pointers through `bufferGet*Ptr` after buffer destroy.
- Reusing `OptimizedBuffer.buffers` after `OptimizedBuffer.destroy()` from TypeScript. The wrapper should prevent reacquiring views, while documentation must state that already-retained typed array views are invalid.
- Reentrant callbacks during destruction.
- Renderer destruction while a frame is rendering.
- Native span feed callbacks after stream close/destroy.
- Audio callbacks after engine stop/destroy.

## Open Design Questions

Resolve these before implementation begins:

1. Should handles be `u32` numbers or `u64` bigints at the JavaScript boundary?
2. Should wrong-kind and stale-handle calls be silent no-ops, debug warnings, or status-code errors?
3. Should dependent child objects be automatically invalidated when a parent is destroyed, or should they remain independent if native ownership already supports that?
4. Should temporary returned arrays, such as highlight arrays, get a separate allocation registry later?
5. Should handle-table debug diagnostics expose live object counts by kind?
6. Which object getters return owned handles, borrowed child handles, or temporary data? This must be explicitly documented before each object family migrates.
7. Should buffer cell-array pointers continue to be returned as raw pointers, or should there be a debug-only mode that copies/validates them at the cost of performance?

## Preferred Answers To Open Questions

These are starting recommendations, not final decisions:

1. Prefer `u32` handles if the object table can be bounded comfortably; otherwise use `u64` with BigInt wrappers.
2. Prefer no-op for `void`, `false` for boolean, `0` for size, and invalid-argument status for status-returning APIs.
3. Do not automatically cascade invalidation until ownership rules are audited per family. Validate inputs at exported boundaries first.
4. Leave temporary arrays out of the first migration. Audit them after long-lived objects are handled.
5. Add debug-only live handle counts. They are useful for leak tests and should have negligible production impact when disabled.
6. Treat renderer current/next buffers and view/editor related getters as borrowed child handles unless a specific API owns and destroys the returned object independently.
7. Keep buffer cell-array pointers raw in production. They are the intentional direct-write data plane. Consider debug-only validation/copying separately if needed for diagnostics.

## Completion Criteria

The migration is complete when:

- No long-lived native object pointer is exposed to TypeScript as `Pointer`.
- No exported getter returns a raw pointer to a long-lived native object.
- Buffer cell-array getters are the explicit exception: they may return raw data pointers for direct typed-array writes, but only after validating a live buffer handle.
- All FFI object methods validate handles in `lib.zig` before dereferencing native pointers.
- All direct `pub export fn` object methods outside `lib.zig` validate handles before dereferencing native pointers.
- Stale handles are rejected by generation checks.
- Wrong-kind handles are rejected.
- Double destroy is safe for every object family.
- Borrowed child handles are invalidated when their owner is destroyed and cannot free owner-managed memory.
- Direct buffer typed-array access remains available and documented as valid only while the owning buffer is alive.
- The original renderer use-after-destroy sequence cannot crash.
- Benchmarks show acceptable overhead and document the measured cost.
- Tests cover renderer, buffer, text buffer, text buffer view, edit buffer, editor view, syntax style, event sink, audio engine, and native span feed stream invalid-handle behavior.
