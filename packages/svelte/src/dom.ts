import { Renderable, TextRenderable, BoxRenderable } from "@opentui/core"

// ============================================================================
// Type definitions
// ============================================================================

type TUIDOMTokenList = {
  add(...tokens: string[]): void
  remove(...tokens: string[]): void
  contains(token: string): boolean
}

// ============================================================================
// Property mappings - DOM properties → OpenTUI Renderable properties
// ============================================================================

// Properties that map directly to Renderable properties (same name)
const DIRECT_MAPPINGS = new Set([
  // Layout
  "width",
  "height",
  "visible",
  "zIndex",
  "position",
  "left",
  "top",
  "right",
  "bottom",

  // Yoga Flexbox
  "flexDirection",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "flexWrap",
  "alignItems",
  "alignSelf",
  "justifyContent",
  "gap",
  "rowGap",
  "columnGap",
  "padding",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",

  // Visual Styling
  "backgroundColor",
  "borderStyle",
  "borderColor",
  "border",
  "fg",
  "bg",

  // InputRenderable-specific
  "value",
  "placeholder",
  "maxLength",
  "textColor",
  "focusedBackgroundColor",
  "focusedTextColor",
  "cursorColor",
  "placeholderColor",

  // TextRenderable-specific
  "selectable",
])

// Properties that need name remapping (DOM name → Renderable property name)
const SPECIAL_MAPPINGS: Record<string, string> = {
  innerHTML: "content",
  textContent: "content",
  innerText: "content",
}

// ============================================================================
// Renderer context
// ============================================================================

let globalRenderer: any = null

export function getRenderer() {
  if (!globalRenderer) {
    throw new Error("Renderer not initialized. Call render() first.")
  }
  return globalRenderer
}

export function setRenderer(renderer: any) {
  globalRenderer = renderer
}

// ============================================================================
// DOM wrapper classes
// ============================================================================

// Base class - Node operations
export class TUINode {
  constructor(public _renderable: Renderable) {}

  // Navigation properties
  get firstChild(): TUINode | null {
    const child = this._renderable.getChildren()[0]
    return child ? wrap(child!) : null
  }

  get lastChild(): TUINode | null {
    const children = this._renderable.getChildren()
    return children.length ? wrap(children[children.length - 1]!) : null
  }

  get parentNode(): TUINode | null {
    return this._renderable.parent ? wrap(this._renderable.parent) : null
  }

  get nextSibling(): TUINode | null {
    if (!this._renderable?.parent) return null
    const siblings = this._renderable.parent.getChildren()
    const idx = siblings.indexOf(this._renderable)
    const nextSib = siblings[idx + 1]
    return nextSib ? wrap(nextSib) : null
  }

  get children(): TUINode[] {
    return this._renderable.getChildren().map(wrap)
  }

  get nodeName(): string {
    return this._renderable.constructor.name
  }

  get nodeType(): number {
    return this._renderable instanceof TextRenderable ? 3 : 1
  }

  get nodeValue(): string | null {
    if (this._renderable instanceof TextRenderable) {
      return (this._renderable as TextRenderable).content.toString()
    }
    return null
  }

  set nodeValue(value: string | null) {
    if (this._renderable instanceof TextRenderable && value !== null) {
      ;(this._renderable as TextRenderable).content = value
    }
  }

  get ownerDocument() {
    return document
  }

  // Node manipulation methods
  appendChild(child: TUINode): TUINode {
    this._renderable.add(unwrap(child))
    return child
  }

  append(...children: TUINode[]) {
    children.forEach((c) => {
      const childRenderable = unwrap(c)

      // DocumentFragment special behavior: when appended, its children are moved
      if (childRenderable.id.startsWith("fragment-")) {
        const fragmentChildren = childRenderable.getChildren()
        fragmentChildren.forEach((fragChild) => {
          this._renderable.add(fragChild)
        })
      } else {
        this._renderable.add(childRenderable)
      }
    })
  }

  remove() {
    this._renderable.parent?.remove(this._renderable.id)
  }

  before(...nodes: TUINode[]) {
    const parent = this._renderable.parent
    if (!parent) return
    const children = parent.getChildren()
    const idx = children.indexOf(this._renderable)
    nodes.forEach((n, i) => {
      const insertIdx = idx + i
      const nodeToInsert = unwrap(n)
      parent.add(nodeToInsert, insertIdx)
    })
  }

  after(...nodes: TUINode[]) {
    const parent = this._renderable.parent
    if (!parent) return
    const children = parent.getChildren()
    const idx = children.indexOf(this._renderable)
    nodes.forEach((n, i) => {
      parent.add(unwrap(n), idx + i + 1)
    })
  }

  replaceWith(...replacement: TUINode[]) {
    const parent = this._renderable.parent
    if (!parent) return
    const children = parent.getChildren()
    const idx = children.indexOf(this._renderable)
    parent.remove(this._renderable.id)
    replacement.forEach((n, i) => {
      parent.add(unwrap(n), idx + i)
    })
  }

  cloneNode(deep: boolean = false): TUINode {
    const cloned = new (this.constructor as any)(this._renderable)

    if (deep) {
      const children = this._renderable.getChildren()
      for (const child of children) {
        cloned.appendChild(wrap(child).cloneNode(true))
      }
    }

    return cloned
  }
}

// TypeScript interface for generated properties
export interface TUIElement {
  innerHTML: string
  textContent: string
  innerText: string
  className: string
  id: string
  value: string
  checked: boolean
  selected: boolean
  disabled: boolean
  name: string
  type: string
  alt: string
  src: string
  height: string
  multiple: boolean
  files: string[] | null
  form: string | null
  dir: string
  currentTime: number
  readonly duration: number
  readonly ended: boolean
  paused: boolean
  muted: boolean
  volume: number
  playbackRate: number
  readonly seeking: boolean
  readonly readyState: number
}

// Element class - adds element-specific operations
export class TUIElement extends TUINode {
  // Element properties generated below via Object.defineProperty

  // classList special handling
  get classList(): TUIDOMTokenList {
    const self = this
    return {
      add(...tokens: string[]) {
        const classes = (self.className || "").split(" ").filter(Boolean)
        const set = new Set([...classes, ...tokens])
        self.className = Array.from(set).join(" ")
      },
      remove(...tokens: string[]) {
        const classes = (self.className || "").split(" ").filter(Boolean)
        const set = new Set(classes)
        tokens.forEach((t) => set.delete(t))
        self.className = Array.from(set).join(" ")
      },
      contains(token: string) {
        const classes = (self.className || "").split(" ").filter(Boolean)
        return classes.includes(token)
      },
    }
  }

  // style special handling
  get style() {
    const style = this._props?.style || {}
    const self = this
    return new Proxy(style, {
      set: (target, prop, value) => {
        target[prop] = value
        if (!self._props) self._props = {}
        self._props.style = target
        return true
      },
    })
  }

  set style(value: any) {
    if (!this._props) this._props = {}
    this._props.style = value
  }

  // Element methods
  setAttribute(name: string, value: any) {
    this._setProp(name, value)
  }

  getAttribute(name: string): any {
    return this._getProp(name)
  }

  hasAttribute(name: string): boolean {
    // Check if it's a mapped property with a value
    if (DIRECT_MAPPINGS.has(name)) {
      return (this._renderable as any)[name] !== undefined
    }
    const mappedKey = SPECIAL_MAPPINGS[name]
    if (mappedKey) {
      return (this._renderable as any)[mappedKey] !== undefined
    }
    // Check stub storage
    return name in (this._props || {})
  }

  addEventListener(event: string, handler: Function) {
    this._renderable.on(event, handler as any)
  }

  dispatchEvent(event: any) {
    this._renderable.emit(event.type, event)
  }

  focus() {
    ;(this._renderable as any).focus?.()
  }

  scroll(_options?: any) {
    // Stub
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }
  }

  // Helper methods
  private _props: Record<string, any> | undefined

  public _getProp(name: string): any {
    // Check if this property maps to an actual Renderable property
    if (DIRECT_MAPPINGS.has(name)) {
      return (this._renderable as any)[name]
    }

    // Check if this needs special name mapping
    const mappedKey = SPECIAL_MAPPINGS[name]
    if (mappedKey) {
      return (this._renderable as any)[mappedKey]
    }

    // Fallback to stub storage for properties with no terminal equivalent
    return this._props?.[name]
  }

  public _setProp(name: string, value: any) {
    // Check if this property maps to an actual Renderable property
    if (DIRECT_MAPPINGS.has(name)) {
      ;(this._renderable as any)[name] = value
      return
    }

    // Check if this needs special name mapping
    const mappedKey = SPECIAL_MAPPINGS[name]
    if (mappedKey) {
      ;(this._renderable as any)[mappedKey] = value
      return
    }

    // Fallback to stub storage for properties with no terminal equivalent
    if (!this._props) this._props = {}
    this._props[name] = value
  }
}

// ============================================================================
// Element property generation
// ============================================================================

type PropConfig = { key?: string; default?: unknown; writable?: boolean }

const ELEMENT_PROPS: Record<string, PropConfig> = {
  innerHTML: { default: "" },
  textContent: { default: "" },
  innerText: { default: "" },
  className: { key: "class", default: "" },
  id: { default: "" },
  value: { default: "" },
  checked: { default: false },
  selected: { default: false },
  disabled: { default: false },
  name: {},
  type: {},
  alt: {},
  src: {},
  height: {},
  multiple: {},
  files: {},
  form: { writable: false },
  dir: {},
  currentTime: { default: 0 },
  duration: { default: 0, writable: false },
  ended: { default: false, writable: false },
  paused: { default: false },
  muted: { default: false },
  volume: { default: 1 },
  playbackRate: { default: 1 },
  seeking: { default: false, writable: false },
  readyState: { default: 0, writable: false },
}

// Generate properties at module load
for (const [prop, config] of Object.entries(ELEMENT_PROPS)) {
  const key = config.key || prop
  const defaultValue = config.default
  const writable = config.writable !== false

  Object.defineProperty(TUIElement.prototype, prop, {
    get(this: TUIElement) {
      return this._getProp(key) ?? defaultValue
    },
    set: writable
      ? function (this: TUIElement, v) {
          this._setProp(key, v)
        }
      : undefined,
    enumerable: true,
    configurable: true,
  })
}

// Helpers
export function wrap(r: Renderable): TUINode {
  return r instanceof TextRenderable ? new TUINode(r) : new TUIElement(r)
}

export function unwrap(node: TUINode | Renderable): Renderable {
  return node instanceof TUINode ? node._renderable : node
}

// ============================================================================
// Document API
// ============================================================================

const ELEMENT_MAP: Record<string, any> = {
  div: BoxRenderable,
  span: BoxRenderable,
  p: BoxRenderable,
  section: BoxRenderable,
  article: BoxRenderable,
  main: BoxRenderable,
  header: BoxRenderable,
  footer: BoxRenderable,
  nav: BoxRenderable,
  "*": BoxRenderable,
}

let idCounter = 0
function nextId(tag: string): string {
  return `${tag}-${++idCounter}`
}

class TUIDocument {
  private _create<T extends Renderable>(Class: new (...args: any[]) => T, tag: string, props: any = {}): TUINode {
    const renderer = getRenderer()
    const renderable = new Class(renderer, { id: nextId(tag), ...props })
    return renderable instanceof TextRenderable ? new TUINode(renderable) : new TUIElement(renderable)
  }

  createElement(tag: string): TUIElement {
    const RenderableClass = ELEMENT_MAP[tag] || ELEMENT_MAP["*"]
    return this._create(RenderableClass, tag) as TUIElement
  }

  createTextNode(text: string | number): TUINode {
    return this._create(TextRenderable, "text", { content: String(text) })
  }

  createComment(text: string): TUINode {
    return this._create(BoxRenderable, "comment", { visible: false })
  }

  createDocumentFragment(): TUINode {
    return this._create(BoxRenderable, "fragment", { visible: false })
  }

  importNode(node: TUINode, _deep?: boolean): TUINode {
    return node
  }

  querySelector(_selector: string): TUINode | null {
    return null
  }

  get activeElement(): TUINode | null {
    return null
  }

  private _getRoot(): TUINode | null {
    const root = (globalThis as any).__opentui_root
    return root ? new TUIElement(root) : null
  }

  get body(): TUINode | null {
    return this._getRoot()
  }

  get head(): TUINode | null {
    return this._getRoot()
  }
}

export const document = new TUIDocument()
