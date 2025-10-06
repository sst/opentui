import { BaseRenderable, isTextNodeRenderable, TextNodeRenderable, TextRenderable, Yoga } from "@opentui/core"

class SlotBaseRenderable extends BaseRenderable {
  constructor(id: string) {
    super({
      id,
    })
  }

  public add(obj: BaseRenderable | unknown, index?: number): number {
    throw new Error("Can't add children on an Slot renderable")
  }

  public getChildren(): BaseRenderable[] {
    return []
  }

  public remove(id: string): void {}

  public insertBefore(obj: BaseRenderable | unknown, anchor: BaseRenderable | unknown): void {
    throw new Error("Can't add children on an Slot renderable")
  }

  public getRenderable(id: string): BaseRenderable | undefined {
    return undefined
  }

  public getChildrenCount(): number {
    return 0
  }

  public requestRender(): void {}

  public findDescendantById(id: string): BaseRenderable | undefined {
    return undefined
  }
}

export class TextSlotRenderable extends TextNodeRenderable {
  protected slotParent?: SlotRenderable
  protected destroyed: boolean = false

  constructor(id: string, parent?: SlotRenderable) {
    super({ id: id })
    this._visible = false
    this.slotParent = parent
  }

  public override destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true

    this.slotParent?.destroy()
    super.destroy()
  }
}

export class LayoutSlotRenderable extends SlotBaseRenderable {
  protected yogaNode: Yoga.Node
  protected slotParent?: SlotRenderable
  protected destroyed: boolean = false

  constructor(id: string, parent?: SlotRenderable) {
    super(id)

    this._visible = false
    this.slotParent = parent
    this.yogaNode = Yoga.default.Node.create()
    this.yogaNode.setDisplay(Yoga.Display.None)
  }

  public getLayoutNode(): Yoga.Node {
    return this.yogaNode
  }

  public updateFromLayout() {}

  public updateLayout() {}

  public onRemove() {}

  public override destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true

    super.destroy()
    this.slotParent?.destroy()
  }
}

export class SlotRenderable extends SlotBaseRenderable {
  layoutNode?: LayoutSlotRenderable
  textNode?: TextSlotRenderable
  protected destroyed: boolean = false

  constructor(id: string) {
    super(id)

    this._visible = false
  }

  getSlotChild(parent: BaseRenderable) {
    if (isTextNodeRenderable(parent) || parent instanceof TextRenderable) {
      if (!this.textNode) {
        this.textNode = new TextSlotRenderable(`slot-text-${this.id}`, this)
      }
      return this.textNode
    }

    if (!this.layoutNode) {
      this.layoutNode = new LayoutSlotRenderable(`slot-layout-${this.id}`, this)
    }
    return this.layoutNode
  }

  public override destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true

    if (this.layoutNode) {
      this.layoutNode.destroy()
    }
    if (this.textNode) {
      this.textNode.destroy()
    }
  }
}
