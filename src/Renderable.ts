import { OptimizedBuffer, type RenderContext, type MouseEvent, type SelectionState } from "."
import { EventEmitter } from "events"

export interface RenderableOptions {
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  visible?: boolean
}

let renderableNumber = 1

export abstract class Renderable extends EventEmitter {
  static renderablesByNumber: Map<number, Renderable> = new Map()

  public readonly id: string
  public readonly num: number
  protected ctx: RenderContext | null = null
  private _x: number
  private _y: number
  private _width: number
  private _height: number
  private _zIndex: number
  public visible: boolean
  public selectable: boolean = false

  private renderableMap: Map<string, Renderable> = new Map()
  private renderableArray: Renderable[] = []
  private needsZIndexSort: boolean = false
  public parent: Renderable | null = null

  constructor(id: string, options: RenderableOptions) {
    super()
    this.id = id
    this.num = renderableNumber++
    this._x = options.x
    this._y = options.y
    this._width = options.width
    this._height = options.height
    this._zIndex = options.zIndex
    this.visible = options.visible !== false

    Renderable.renderablesByNumber.set(this.num, this)
  }

  public hasSelection(): boolean {
    return false
  }

  public onSelectionChanged(selection: SelectionState | null): boolean {
    // Default implementation: do nothing
    // Override this method to provide custom selection handling
    return false
  }

  public getSelectedText(): string {
    return ""
  }

  public shouldStartSelection(x: number, y: number): boolean {
    return false
  }

  public set needsUpdate(value: boolean) {
    if (this.parent) {
      this.parent.needsUpdate = value
    }
  }

  public get x(): number {
    if (this.parent) {
      return this.parent.x + this._x
    }
    return this._x
  }

  public set x(value: number) {
    this._x = value
  }

  public get y(): number {
    if (this.parent) {
      return this.parent.y + this._y
    }
    return this._y
  }

  public set y(value: number) {
    this._y = value
  }

  public get width(): number {
    return this._width
  }

  public set width(value: number) {
    this._width = value
  }

  public get height(): number {
    return this._height
  }

  public set height(value: number) {
    this._height = value
  }

  public get zIndex(): number {
    return this._zIndex
  }

  public set zIndex(value: number) {
    if (this._zIndex !== value) {
      this._zIndex = value
      this.parent?.requestZIndexSort()
    }
  }

  public requestZIndexSort(): void {
    this.needsZIndexSort = true
  }

  private ensureZIndexSorted(): void {
    if (this.needsZIndexSort) {
      this.renderableArray.sort((a, b) => (a.zIndex > b.zIndex ? 1 : a.zIndex < b.zIndex ? -1 : 0))
      this.needsZIndexSort = false
    }
  }

  public add(obj: Renderable): void {
    if (this.renderableMap.has(obj.id)) {
      this.remove(obj.id)
    }

    if (obj.parent) {
      obj.parent.remove(obj.id)
    }

    obj.parent = this
    if (this.ctx) {
      obj.ctx = this.ctx
    }

    this.renderableArray.push(obj)
    this.needsZIndexSort = true
    this.renderableMap.set(obj.id, obj)
    this.emit("child:added", obj)
  }

  public propagateContext(ctx: RenderContext | null): void {
    this.ctx = ctx
    for (const child of this.renderableArray) {
      child.propagateContext(ctx)
    }
  }

  public getRenderable(id: string): Renderable | undefined {
    return this.renderableMap.get(id)
  }

  public remove(id: string): void {
    if (!id) {
      return
    }
    if (this.renderableMap.has(id)) {
      const obj = this.renderableMap.get(id)
      if (obj) {
        obj.parent = null
        obj.propagateContext(null)
      }
      this.renderableMap.delete(id)

      const index = this.renderableArray.findIndex((obj) => obj.id === id)
      if (index !== -1) {
        this.renderableArray.splice(index, 1)
      }
      this.emit("child:removed", id)
    }
  }

  public getAllElementIds(): string[] {
    return Array.from(this.renderableMap.keys())
  }

  public getChildren(): Renderable[] {
    return [...this.renderableArray]
  }

  public render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible) return

    this.renderSelf(buffer, deltaTime)
    this.ctx?.addToHitGrid(this.x, this.y, this.width, this.height, this.num)
    this.ensureZIndexSorted()

    for (const child of this.renderableArray) {
      child.render(buffer, deltaTime)
    }
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    // Default implementation: do nothing
    // Override this method to provide custom rendering
  }

  public destroy(): void {
    if (this.parent) {
      throw new Error(
        `Cannot destroy ${this.id} while it still has a parent (${this.parent.id}). Remove from parent first.`,
      )
    }

    for (const child of this.renderableArray) {
      child.parent = null
      child.destroy()
    }
    this.renderableArray = []
    this.renderableMap.clear()
    Renderable.renderablesByNumber.delete(this.num)

    this.destroySelf()
  }

  protected destroySelf(): void {
    // Default implementation: do nothing
    // Override this method to provide custom cleanup
  }

  public processMouseEvent(event: MouseEvent): void {
    this.onMouseEvent(event)
    if (this.parent && !event.defaultPrevented) {
      this.parent.processMouseEvent(event)
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    // Default implementation: do nothing
    // Override this method to provide custom event handling
  }
}
