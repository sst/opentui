import { Renderable, TextRenderable, RootRenderable, type TextChunk, type CliRenderer } from "@opentui/core"
import { getNextId } from "./utils"
import type { elements } from "./elements"

export const ChunkToTextNodeMap = new WeakMap<TextChunk, TextNode>()

export class TextNode {
  id: string
  chunk: TextChunk
  parent?: Renderable
  textParent?: TextRenderable

  constructor(chunk: TextChunk) {
    this.id = getNextId("text-node")
    this.chunk = chunk
  }
}

export class WhiteSpaceNode extends Renderable {
  constructor(cliRenderer: CliRenderer) {
    super(cliRenderer, { id: getNextId("whitespace") })
  }
}

export type OpenTUINode = Renderable | TextNode
type ElementConstructor = (typeof elements)[keyof typeof elements]
export type OpenTUIElement = InstanceType<ElementConstructor> | RootRenderable
