import type { BaseRenderable } from "../Renderable.js"
import type { Node } from "../yoga.js"

export function getYogaNode(renderable: BaseRenderable): Node {
  const target = renderable as BaseRenderable & { _sceneHandle?: unknown; isFreed?: () => boolean }
  if (!target._sceneHandle && !target.isFreed?.()) throw new Error("Renderable has no layout backing")
  return renderable as unknown as Node
}

export function setYogaNode(_renderable: BaseRenderable, _node: Node): void {}

export function assertRenderableMutable(renderable: BaseRenderable): void {
  getYogaNode(renderable).assertMutable()
}

export function runRenderableMutation<T>(renderable: BaseRenderable, operation: () => T): T {
  return getYogaNode(renderable).runMutation(operation)
}
