import { BaseRenderable } from ".."
import Yoga, { Display, type Node as YogaNode } from "yoga-layout"

export class SlotRenderable extends BaseRenderable {
  protected yogaNode: YogaNode

  constructor(id: string) {
    super({
      id,
    })

    this.yogaNode = Yoga.Node.create()
    this.yogaNode.setDisplay(Display.None)
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

  public replace(obj: BaseRenderable) {
    this.parent?.insertBefore(obj, this)
    this.parent?.remove(this.id)
  }

  public getLayoutNode(): YogaNode {
    return this.yogaNode
  }

  public updateFromLayout() {}

  public updateLayout() {}

  public onRemove() {}
}
