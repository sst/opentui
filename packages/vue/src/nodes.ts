import {
  BaseRenderable,
  Renderable,
  RootRenderable,
  TextNodeRenderable,
  TextRenderable,
  type CliRenderer,
  type TextChunk,
} from "@opentui/core"
import { getNextId } from "./utils"
import type { elements } from "./elements"

export const ChunkToTextNodeMap = new WeakMap<TextChunk, TextNode>()

export class TextNode {
  id: string
  chunk: TextChunk
  parent?: BaseRenderable
  textParent?: TextRenderable
  nodeRenderable?: TextNodeRenderable

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

export class CommentNode extends Renderable {
  constructor(cliRenderer: CliRenderer) {
    super(cliRenderer, { id: getNextId("comment"), visible: false, width: 0, height: 0 })
  }
}

export type OpenTUINode = BaseRenderable | TextNode
type ElementConstructor = (typeof elements)[keyof typeof elements]
export type OpenTUIElement = InstanceType<ElementConstructor> | RootRenderable
