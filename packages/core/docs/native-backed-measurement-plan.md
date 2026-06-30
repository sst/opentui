# Native-Backed Renderable Measurement Plan

## Goal

Move hot native-backed renderables away from native Yoga -> JS -> native measurement round trips while preserving current layout behavior exactly.

The first native-backed measured renderables should be:

- `TextBufferRenderable` via its `TextBufferView`
- `EditBufferRenderable` via its `EditorView` / internal `TextBufferView`

The design should also move toward a future where renderables can be represented by native renderable objects that own or reference Yoga nodes and cache expensive native layout state.

## Current Behavior To Preserve

`TextBufferRenderable` and `EditBufferRenderable` currently install JS Yoga measure functions.

For both renderables, JS does the same high-level measurement work:

- Convert `MeasureMode.Undefined` or `NaN` width to effective width `0`.
- Convert `NaN` height to effective height `1`.
- Call native `measureForDimensions(floor(effectiveWidth), floor(effectiveHeight))`.
- Coerce native result dimensions to at least `1`.
- If Yoga width mode is `AtMost` and the renderable is not absolute, clamp measured width and height to the available effective dimensions.
- Otherwise return the native measured width and height.

Native already has the important measurement primitive:

- `UnifiedTextBufferView.measureForDimensions(width, height)`

`EditorView.measureForDimensions(...)` currently delegates to the editor view's borrowed internal `TextBufferView` handle and calls the same native text-buffer-view measurement API.

## First Step: Test Coverage

Before implementation, add renderable-level parity tests that lock behavior at the Yoga/renderable boundary, not just direct `TextBufferView.measureForDimensions` behavior.

The tests should cover:

- `TextRenderable` relative measurement for `char`, `word`, and `none` wrap modes.
- `TextRenderable` empty content minimum size.
- `TextRenderable` absolute-position measurement without `AtMost` clamping.
- `TextRenderable` content mutation dirtying and recomputing layout.
- `TextareaRenderable` / `EditBufferRenderable` relative measurement for `char`, `word`, and `none` wrap modes.
- `TextareaRenderable` empty editor minimum size.
- `TextareaRenderable` absolute-position measurement without `AtMost` clamping.
- `TextareaRenderable` content mutation dirtying and recomputing layout.
- Current placeholder measurement behavior, explicitly captured before refactoring.

The expected values should be derived from the existing native `measureForDimensions(...)` primitive plus the current JS wrapper rules so tests document the behavior being preserved.

## Refined Native Design

Avoid type-specific Yoga APIs like `yogaNodeSetTextBufferViewMeasureFunc(node, viewHandle)`. That does not scale.

Instead add a generic native renderable/measure-target layer.

Conceptually:

```zig
const NativeRenderableKind = enum(u32) {
    none,
    text_buffer_view,
    editor_view,
};

const NativeRenderable = struct {
    yoga_node: YGNodeRef,
    measure_kind: NativeRenderableKind,
    measure_target: ?*anyopaque,
    cached_layout: ExternalYogaLayout,
    layout_generation_seen: u64,

    fn measure(self: *NativeRenderable, width: f32, width_mode: YGMeasureMode, height: f32, height_mode: YGMeasureMode) YGSize {
        // Switch on kind and call native target-specific measurement.
    }
};
```

Generic FFI shape:

```ts
nativeRenderableCreate(): NativeHandle
nativeRenderableDestroy(handle)
nativeRenderableAttachYogaNode(handle, yogaNodePtr)
nativeRenderableSetMeasureTarget(handle, kind, targetHandle)
nativeRenderableClearMeasureTarget(handle)
```

Yoga only needs one native callback:

```zig
fn nativeRenderableMeasureFunc(node: YGNodeConstRef, ...) YGSize {
    const renderable = nativeRenderableFromYogaNode(node) orelse return fallback;
    return renderable.measure(...);
}
```

## Option 1: NativeRenderable Owns/Attaches Yoga Node

JS renderables create a `NativeRenderable` and attach their existing Yoga node. The native renderable stores the measure target kind and handle.

Pros:

- Generic and extensible.
- Avoids one Yoga API per renderable type.
- Removes JS callback pressure for native-backed renderables.
- Gives a natural place to cache native layout values later.
- Aligns with the direction of fully native-backed renderables.

Cons:

- Requires a new native handle type and lifecycle.
- Must cleanly detach/clear measure target before a view or Yoga node is destroyed.
- Initially duplicates ownership concepts between JS `Renderable` and native `NativeRenderable` until more of the renderable moves native-side.

## Option 2: Native Yoga Measure Target Registry

Keep JS-owned Yoga nodes, but add a native registry keyed by `YGNodeRef` that stores a generic measure target kind and handle.

Pros:

- Smaller initial change.
- Still generic.
- Avoids JS callbacks for native-backed measurement.

Cons:

- Less aligned with future native-backed renderables.
- Adds a global registry that must be kept in sync with Yoga node lifetime.
- No natural place for broader renderable-level cached layout state.

## Preference

Prefer Option 1.

It is the better long-term direction because it introduces the native object that can eventually own renderable-native state, not just measurement routing. The initial implementation can still attach to the JS-created Yoga node to reduce migration size.

## Implementation Order

1. Add renderable-level parity tests.
2. Add native `NativeRenderable` handle type and lifecycle.
3. Add generic native measure-target APIs.
4. Implement `text_buffer_view` target kind.
5. Switch `TextBufferRenderable` to native-backed measurement.
6. Run parity tests and benchmarks.
7. Implement `editor_view` target kind by delegating to its internal `TextBufferView` behavior.
8. Switch `EditBufferRenderable` to native-backed measurement.
9. Run parity tests and benchmarks again.
10. Only simplify/remove JS measurement code after tests prove native parity.

## Performance Expectations

The generic native-backed path removes the Yoga measure callback crossing from JS entirely for these renderables. It should reduce FFI pressure more than the shared JS callback router does, because measurement stays native:

```text
Yoga -> native renderable -> TextBufferView.measureForDimensions -> YGSize
```

No native -> JS -> native round trip is required for hot text/editor measurement.
