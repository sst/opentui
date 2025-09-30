# DOM-Only Approach: Verified Limitations

**Date**: 2025-11-03
**Implementation**: packages/svelte/src/dom.ts (491 lines)
**Status**: ✅ Working but constrained

This document provides evidence-based analysis of what breaks or is limited when using the DOM-only approach (Approach 5) for Svelte integration with OpenTUI.

---

## Overview

The DOM-only approach shims 60 DOM APIs to map between Svelte's DOM expectations and OpenTUI's Renderable system. While this works for basic use cases, it has fundamental limitations due to the impedance mismatch between DOM (document-centric) and TUI (terminal-centric) models.

**Architecture**:

```
Svelte Compiler → Svelte Runtime → DOM APIs → TUI Shims → Renderables
```

**Trade-off**: Simpler implementation (60 APIs vs 115 AST functions) but limited to what DOM can express.

---

## 10 Verified Limitations

### 1. ⚠️ Missing Yoga Properties (Limited)

**Issue**: Only 2 Yoga properties are missing from core OpenTUI implementation.

**Evidence**: Core Renderable classes (`packages/core/src/Renderable.ts`, `packages/core/src/renderables/Box.ts`) lack these setters

**Actually missing from core**:

- `aspectRatio` - Yoga aspect ratio constraint (not implemented in core)
- `alignContent` - Multi-line alignment (not implemented in core)

**Previously missing, now added to DIRECT_MAPPINGS** (`src/dom.ts:35-41`):

- ✅ `flexWrap` - Added (exists on Renderable.ts:832, calls yogaNode.setFlexWrap())
- ✅ `alignSelf` - Added (exists on Renderable.ts:847, calls yogaNode.setAlignSelf())
- ✅ `gap` - Added (exists on BoxRenderable, Box.ts:269, calls yogaNode.setGap())
- ✅ `rowGap` - Added (exists on BoxRenderable, Box.ts:276)
- ✅ `columnGap` - Added (exists on BoxRenderable, Box.ts:283)

**What happens**: The 2 actually missing properties (`aspectRatio`, `alignContent`) get stored in `_props` stub storage (`dom.ts:301-321`) but don't affect rendering. The 5 newly-added properties work correctly.

**Example**:

```svelte
<!-- These now work -->
<div style="flex-wrap: wrap; align-self: center; gap: 10px;">
  Content
</div>

<!-- These still don't work (not in core) -->
<div style="aspect-ratio: 16/9; align-content: center;">
  Content
</div>
```

**Workaround**: Use alternative layout properties (margin/padding for spacing, manual sizing instead of aspectRatio).

---

### 2. ❌ Custom OpenTUI Events Not Accessible

**Issue**: OpenTUI Renderables emit custom events via constants (e.g., `SelectRenderableEvents.SELECTION_CHANGED`). DOM API only supports string-based event names.

**Evidence**: `src/dom.ts:266-272` - generic EventEmitter pattern

```typescript
addEventListener(event: string, handler: Function) {
  this._renderable.on(event, handler as any);
}
```

**Can't access**:

- `SelectRenderableEvents.SELECTION_CHANGED` (constant value, not string)
- `SelectRenderableEvents.ITEM_SELECTED`
- `InputRenderableEvents.INPUT`
- `InputRenderableEvents.BLUR`
- `TabSelectRenderableEvents.*`

**Example**:

```svelte
<script>
  import { SelectRenderableEvents } from '@opentui/core';

  function handleSelect(e) {
    console.log('Selected:', e.detail);
  }
</script>

<!-- This won't work - SelectRenderableEvents not accessible via DOM API -->
<select on:selectionChanged={handleSelect}>
  <option>A</option>
  <option>B</option>
</select>
```

**Workaround**: Break abstraction and access `_renderable` directly:

```javascript
let selectEl
onMount(() => {
  selectEl._renderable.on(SelectRenderableEvents.SELECTION_CHANGED, handler)
})
```

**Impact**: Fragile, breaks DOM abstraction layer.

---

### 3. ❌ Constructor Arguments Impossible

**Issue**: DOM's `document.createElement()` calls constructor with no arguments. Renderable constructors often need initialization options.

**Evidence**: `TUIDocument.createElement()` in `src/dom.ts:463-474`

```typescript
createElement(tagName: string): TUIElement {
  const renderable = new BoxRenderable();  // ← No constructor args
  return new TUIElement(renderable, tagName);
}
```

**Problem flow**:

```
1. document.createElement('input')  → new InputRenderable()  [constructor runs]
2. element.setAttribute('placeholder', 'text')               [too late]
```

**Can't do**:

```javascript
// Many Renderables need constructor options
new InputRenderable(ctx, {
  placeholder: "Enter text",
  maxLength: 100,
  cursorColor: "#00FF00",
})

new ASCIIFontRenderable(fontData, options)
new ScrollBoxRenderable(scrollOptions)
```

**Example**:

```svelte
<!-- Can't pass constructor options -->
<input placeholder="text" maxLength="100" />
```

Properties set via `setAttribute()` after construction, but some Renderables need immutable constructor arguments.

**Workaround**: Set properties post-creation via `onMount()`:

```svelte
<script>
  let inputEl;
  onMount(() => {
    inputEl.placeholder = "text";
    inputEl.maxLength = 100;
  });
</script>
<input bind:this={inputEl} />
```

**Limitation**: Only works for properties in `DIRECT_MAPPINGS`.

---

### 4. ⚠️ 26 Properties Stubbed (No Effect)

**Issue**: 26 DOM properties are stored but have no rendering effect. Silent failures.

**Evidence**: `ELEMENT_PROPS` in `src/dom.ts:331-359`, stub storage in `dom.ts:313-318`

**Stubbed properties** (stored in `_props`, not used):

- **Form states**: `checked`, `selected`, `disabled`
- **Identifiers**: `className`, `id`
- **Media**: `currentTime`, `duration`, `paused`, `muted`, `volume`, `playbackRate`, `seeking`, `readyState`, `ended`
- **File inputs**: `files`, `multiple`
- **Misc**: `alt`, `src`, `name`, `type`, `form`, `dir`

**Code**:

```typescript
private _setProp(name: string, value: any) {
  if (DIRECT_MAPPINGS.has(name)) {
    (this._renderable as any)[name] = value;  // ✅ Works
    return;
  }
  const mappedKey = SPECIAL_MAPPINGS[name];
  if (mappedKey) {
    (this._renderable as any)[mappedKey] = value;  // ✅ Works
    return;
  }
  // ❌ Fallback: Store but don't render
  if (!this._props) this._props = {};
  this._props[name] = value;
}
```

**Example**:

```svelte
<!-- These properties are stored but ignored -->
<input
  className="my-input"
  id="username"
  disabled={true}
  checked={isChecked}
/>
```

Developer expects these to work, but they have no effect.

**Impact**: Confusing developer experience. Silent failures.

**Workaround**: Avoid using properties not in `DIRECT_MAPPINGS`. Document which properties work.

---

### 5. ❌ Type Safety Lost

**Issue**: DOM properties are string-based. Renderables expect typed values (enums, objects, functions).

**Evidence**: General architecture - all properties go through string-based DOM APIs.

**Type coercions required**:

| Renderable Type          | DOM Equivalent       | Loss                      |
| ------------------------ | -------------------- | ------------------------- |
| `FlexDirection.Row`      | `"row"`              | Type safety, autocomplete |
| `new RGBA(255, 0, 0, 1)` | `"#FF0000"`          | Precision, alpha channel  |
| `AlignItems.Center`      | `"center"`           | Enum validation           |
| `{ top: 10, left: 5 }`   | `"10px 5px"`         | Structure, units          |
| Function objects         | String serialization | Context, closures         |

**Example**:

```svelte
<script>
  import { FlexDirection, AlignItems } from '@opentui/core';

  // Can't use enums
  let direction = FlexDirection.Row;  // TypeScript enum
</script>

<!-- Must use strings -->
<div style="flex-direction: row; align-items: center">
  Content
</div>
```

**Impact**:

- Loss of TypeScript type checking
- No autocomplete for valid values
- Runtime errors instead of compile-time errors
- String typos not caught

**Workaround**: Use string constants:

```typescript
const FLEX_DIRECTION = {
  ROW: "row",
  COLUMN: "column",
} as const
```

---

### 6. ❌ Direct Renderable Methods Not Callable

**Issue**: `bind:this` gives you `TUIElement` wrapper, not the underlying Renderable. Can't call Renderable-specific methods.

**Evidence**: `TUIElement` is a wrapper around `_renderable` (`src/dom.ts:200`)

**Can't call**:

```typescript
// Hypothetical SelectRenderable methods
selectElement.addOption({ name: "New", description: "Details" })
selectElement.clearOptions()
selectElement.getSelectedIndex()

// Hypothetical InputRenderable methods
inputElement.clearContent()
inputElement.moveCursorToEnd()

// Custom Renderable methods
customElement.performAction()
customElement.getData()
```

**Why**: Svelte's `bind:this` returns the DOM element (TUIElement), not the Renderable.

**Example**:

```svelte
<script>
  let selectEl;

  function addOption() {
    // ❌ This won't work - selectEl is TUIElement, not SelectRenderable
    selectEl.addOption({ name: "New" });
  }
</script>

<select bind:this={selectEl}>
  <option>A</option>
</select>
```

**Limited workaround**: Some methods stubbed in TUIElement (e.g., `focus()` in `dom.ts:273`), but incomplete:

```typescript
focus() {
  (this._renderable as any).focus?.();  // Only if Renderable has focus()
}
```

**Better workaround**: Access `_renderable` directly (breaks abstraction):

```javascript
selectEl._renderable.addOption({ name: "New" })
```

**Impact**: Can't use full Renderable API. Advanced features inaccessible.

---

### 7. ⚠️ Event Bubbling/Capture Not Implemented

**Issue**: DOM event model includes bubbling, capture, stopPropagation, preventDefault. TUI shims use simple EventEmitter.

**Evidence**: `src/dom.ts:266-272`

```typescript
addEventListener(event: string, handler: Function) {
  this._renderable.on(event, handler as any);  // Simple emit/on
}

dispatchEvent(event: any) {
  this._renderable.emit(event.type, event);
}
```

**Missing DOM event features**:

- ❌ Event bubbling up the tree
- ❌ Capture phase (addEventListener 3rd parameter)
- ❌ `stopPropagation()` / `stopImmediatePropagation()`
- ❌ `preventDefault()`
- ❌ Event delegation patterns
- ❌ Event target vs currentTarget

**Example**:

```svelte
<div on:click={handleParent}>
  <button on:click={handleButton}>
    Click me
  </button>
</div>
```

In real DOM: Button click bubbles to div (both handlers called).
In TUI shim: Only button handler called (no bubbling).

**Impact**: DOM event patterns don't work as expected. Event delegation broken.

**Workaround**: Attach handlers directly to elements. Avoid relying on bubbling.

---

### 8. ⚠️ No Batch Update Mechanism

**Issue**: Each property update triggers immediate Renderable update. No batching like AST reconcilers.

**Evidence**: Property setters in `src/dom.ts:287-322` update Renderable immediately.

**Problem**:

```javascript
div.style.width = "200px" // → _renderable.width = 200  [Yoga layout calc]
div.style.height = "100px" // → _renderable.height = 100 [Yoga layout calc]
div.style.padding = "10px" // → _renderable.padding = 10 [Yoga layout calc]
// 3 separate Yoga layout calculations instead of 1
```

**Why**: DOM API has no batching phase. Each setter is synchronous.

**AST reconcilers do this**:

```typescript
commitUpdate(instance, updatePayload) {
  instance.beginUpdates();
  applyProperties(instance, updatePayload);  // All properties
  instance.endUpdates();  // Single layout calculation
  requestRender();
}
```

**Impact**: Performance overhead from multiple layout recalculations.

**Mitigation**: Svelte's reactivity system batches renders at the framework level, so some batching occurs naturally. But individual property updates still trigger immediate Renderable updates.

**Workaround**: None at DOM level. Rely on Svelte's render batching.

---

### 9. ⚠️ Stub DOM Methods Return Fake Data

**Issue**: Some DOM methods are stubbed with placeholder implementations that return incorrect data.

**Evidence**: `src/dom.ts:273-281`

```typescript
scroll(_options?: any) {
  // Stub - no-op
}

getBoundingClientRect() {
  return {
    x: 0, y: 0,
    width: 0, height: 0,
    top: 0, right: 0, bottom: 0, left: 0
  };  // All zeros - fake data
}

querySelector(_selector: string): TUINode | null {
  return null;  // Always null
}
```

**Impact**:

- `getBoundingClientRect()` returns all zeros (incorrect dimensions)
- `querySelector()` always returns null (CSS selectors don't apply to TUI)
- Svelte code relying on these APIs gets bad data

**Example**:

```svelte
<script>
  let divEl;
  onMount(() => {
    const rect = divEl.getBoundingClientRect();
    console.log(rect.width);  // Always 0, even if div has width
  });
</script>

<div bind:this={divEl} style="width: 200px">
  Content
</div>
```

**Workaround**: Don't rely on these methods. Access Renderable directly for layout info:

```javascript
const width = divEl._renderable.width
```

---

### 10. ❌ Global DOM Pollution

**Issue**: `installDOMShims()` replaces global `document`, `Node`, `Element` objects. Side effects.

**Evidence**: `index.ts:10-21`

```typescript
let shimsInstalled = false

export function installDOMShims() {
  if (shimsInstalled) return
  shimsInstalled = true
  ;(globalThis as any).document = document
  ;(globalThis as any).Node = TUINode
  ;(globalThis as any).Element = TUIElement
  ;(globalThis as any).HTMLElement = TUIElement
  ;(globalThis as any).Text = TUINode
  ;(globalThis as any).Comment = TUINode
}
```

**Impact**:

- Can't run browser DOM and TUI DOM simultaneously in same process
- Side effects if other code expects real DOM
- Testing complexity (need to install/uninstall shims between tests)
- Global state makes parallelization difficult

**Comparison**: React/Vue/Solid reconcilers use isolated instances, no globals.

**Example problem**:

```javascript
// Test file
import { installDOMShims } from "@opentui/svelte"
import someLibrary from "some-library" // Expects real DOM

installDOMShims() // Replaces global document

someLibrary.init() // ❌ Fails - expects real DOM, gets TUI shims
```

**Workaround**: Load TUI code in separate process/context. Or uninstall shims (not currently implemented).

**Design trade-off**: Simplicity (global shims) vs isolation (instance-based).

---

## Summary Table

| Issue                                      | Severity  | Evidence                | Workaround?                       |
| ------------------------------------------ | --------- | ----------------------- | --------------------------------- |
| **1. 2 Yoga properties missing from core** | ⚠️ Low    | Core Renderable classes | Use alternatives (margin/padding) |
| **2. Custom events inaccessible**          | ❌ High   | `dom.ts:266-272`        | Access `_renderable`              |
| **3. Constructor args impossible**         | ❌ High   | `dom.ts:463-474`        | Set props post-creation           |
| **4. 26 stubbed properties**               | ⚠️ Medium | `dom.ts:331-359`        | Avoid using them                  |
| **5. Type safety lost**                    | ⚠️ Medium | Architecture            | Use string constants              |
| **6. Renderable methods blocked**          | ❌ High   | `dom.ts:200` wrapper    | Access `_renderable`              |
| **7. No event bubbling**                   | ⚠️ Low    | `dom.ts:266-272`        | Direct handlers only              |
| **8. No batch updates**                    | ⚠️ Medium | Property setters        | Svelte batches renders            |
| **9. Fake getBoundingClientRect**          | ⚠️ Low    | `dom.ts:273-281`        | Access Renderable                 |
| **10. Global DOM pollution**               | ⚠️ Medium | `index.ts:10-21`        | Design trade-off                  |

---

## What Works Well (Verified)

Based on working examples (`examples/hello-svelte.svelte`, `examples/child.svelte`):

### ✅ Proven Working Features

1. **45 mapped properties** (`DIRECT_MAPPINGS`):
   - **Layout**: width, height, visible, zIndex, position, left, top, right, bottom
   - **Flexbox**: flexDirection, flexGrow, flexShrink, flexBasis, flexWrap, alignItems, alignSelf, justifyContent, gap, rowGap, columnGap
   - **Spacing**: padding, margin, marginTop, marginBottom, marginLeft, marginRight
   - **Sizing**: minWidth, maxWidth, minHeight, maxHeight
   - **Visual**: backgroundColor, borderStyle, borderColor, border, fg, bg
   - **Input**: value, placeholder, maxLength, textColor, focusedBackgroundColor, focusedTextColor, cursorColor, placeholderColor
   - **Text**: selectable

2. **Svelte 5 reactivity**:
   - `$state()` reactive variables
   - `$derived()` computed values
   - `$effect()` side effects
   - Automatic UI updates on state changes

3. **Component composition**:
   - Import/export components
   - Props passing between components
   - Child component rendering

4. **Text content**:
   - Text interpolation: `{variable}`
   - Dynamic text updates
   - TextNode handling

5. **Basic events**:
   - `addEventListener()` / `dispatchEvent()`
   - Simple event emit/on pattern
   - Event handlers in Svelte syntax: `on:click={handler}`

6. **DOM tree manipulation**:
   - `appendChild()`, `insertBefore()`, `removeChild()`
   - `firstChild`, `lastChild`, `nextSibling` navigation
   - `cloneNode()` for node cloning

7. **Standard JavaScript**:
   - `setInterval()`, `setTimeout()`
   - `fetch()` and async operations
   - Standard library functions

### ✅ Architectural Strengths

- **Small codebase**: 571 lines total (dom.ts: 491, index.ts: 82)
- **Uses real Svelte 5 runtime**: Battle-tested, maintained by Svelte team
- **Stable API surface**: DOM APIs are decades old, unlikely to change
- **Clear separation**: Svelte handles reactivity, shims handle rendering
- **Zero coupling**: No dependency on Svelte internals (unlike AST approach)

---

## Recommendations

### For Users

**Use DOM-only approach when**:

- Building basic TUI apps with standard layout
- Using properties in `DIRECT_MAPPINGS` list
- Simple event handling (no bubbling needed)
- Prototyping or simple tools

**Avoid DOM-only approach when**:

- Need advanced Yoga properties (aspectRatio, gap, flexWrap)
- Need OpenTUI custom events (SelectRenderableEvents, etc.)
- Need type-safe APIs (enums, complex objects)
- Need direct Renderable method calls
- Need constructor-based initialization
- Building complex TUI applications

### For Implementation

**High priority fixes**:

1. **Extend `DIRECT_MAPPINGS`**: Add aspectRatio, gap, flexWrap, alignSelf, alignContent
2. **Custom event bridge**: Map OpenTUI event constants to DOM event names
3. **Document working properties**: List which properties actually work
4. **Add tests**: Property mapping coverage, event handling, component composition

**Medium priority improvements**:

1. **Better error messages**: Warn on stubbed property usage
2. **Type definitions**: TypeScript types for supported properties
3. **Detect missing flag**: Warn if `--conditions=browser` not used
4. **Access helpers**: Expose `_renderable` safely for advanced use

**Low priority enhancements**:

1. **Event bubbling**: Implement if use cases emerge
2. **Batch updates**: Add update batching if performance issues found
3. **Uninstall shims**: Allow shim removal for testing
4. **getBoundingClientRect**: Return actual Renderable dimensions

---

## Comparison: DOM-Only vs AST Reconcilers

### DOM-Only (Svelte)

**Architecture**: Shim DOM APIs → Renderables

**Pros**:

- Simple (60 APIs, 571 lines)
- Uses unmodified Svelte runtime
- Stable API surface (DOM)
- Clear separation of concerns

**Cons**:

- Limited to DOM expressiveness (this document)
- Global pollution
- 26 stubbed properties
- Missing advanced features

### AST-Level (React/Vue/Solid)

**Architecture**: Implement reconciler API → Renderables

**Pros**:

- Full Renderable API access
- Type-safe properties
- Custom events accessible
- Constructor arguments supported
- No global pollution
- Batch updates

**Cons**:

- More code (525-1,061 lines)
- Framework-specific reconciler APIs
- Tighter coupling to framework
- More maintenance

### Recommendation

**DOM-only is acceptable for**:

- Basic Svelte TUI apps
- Standard layout and styling
- Simple event handling

**AST-level is better for**:

- Advanced OpenTUI features
- Type safety requirements
- Complex applications
- Production use cases

---

## Conclusion

The DOM-only approach is a **pragmatic, working solution** that successfully demonstrates Svelte 5 integration with OpenTUI in **571 lines of code**. It works well for basic use cases but has fundamental limitations when trying to expose OpenTUI's full feature set.

**Key insight**: DOM is designed for documents, OpenTUI is designed for terminals. The impedance mismatch is real and creates concrete limitations documented above.

**Status**: ✅ Production-ready for basic apps, ⚠️ limited for advanced features.

**Future**: Consider hybrid approach (DOM + selective AST shimming) or AST-level reconciler for fuller OpenTUI integration.
