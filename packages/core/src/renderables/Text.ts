import { BaseRenderable } from "../Renderable"
import { stringToStyledText, StyledText } from "../lib/styled-text"
import { type TextChunk } from "../text-buffer"
import { RGBA } from "../lib/RGBA"
import { type RenderContext } from "../types"
import { RootTextNodeRenderable, TextNodeRenderable } from "./TextNode"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable"

export interface TextOptions extends TextBufferOptions {
  content?: StyledText | string
}

export class TextRenderable extends TextBufferRenderable {
  private _text: StyledText

  // TODO: The TextRenderable is currently juggling both a StyledText and a RootTextNodeRenderable.
  // We should refactor this to only use the RootTextNodeRenderable here and have a separate StyledTextRenderable with `content`.
  private _hasManualStyledText: boolean = false

  protected rootTextNode: RootTextNodeRenderable

  protected _contentDefaultOptions = {
    content: "",
  } satisfies Partial<TextOptions>

  constructor(ctx: RenderContext, options: TextOptions) {
    super(ctx, options)

    const content = options.content ?? this._contentDefaultOptions.content
    const styledText = typeof content === "string" ? stringToStyledText(content) : content
    this._text = styledText
    this._hasManualStyledText = options.content !== undefined && content !== ""

    this.rootTextNode = new RootTextNodeRenderable(
      ctx,
      {
        id: `${this.id}-root`,
        fg: this._defaultFg,
        bg: this._defaultBg,
        attributes: this._defaultAttributes,
      },
      this,
    )

    this.updateTextBuffer(styledText)
  }

  private updateTextBuffer(styledText: StyledText): void {
    this.textBuffer.setStyledText(styledText)
    this.clearChunks(styledText)
  }

  private clearChunks(styledText: StyledText): void {
    // Clearing chunks that were already writtend to the text buffer,
    // to not retain references to the text data in js
    // TODO: This is causing issues in the solid renderer
    // styledText.chunks.forEach((chunk) => {
    //   // @ts-ignore
    //   chunk.text = undefined
    // })
  }

  get content(): StyledText {
    return this._text
  }

  get chunks(): TextChunk[] {
    return this._text.chunks
  }

  get textNode(): RootTextNodeRenderable {
    return this.rootTextNode
  }

  set content(value: StyledText | string) {
    this._hasManualStyledText = true
    const styledText = typeof value === "string" ? stringToStyledText(value) : value
    if (this._text !== styledText) {
      this._text = styledText
      this.updateTextBuffer(styledText)
      this.updateTextInfo()
    }
  }

  insertChunk(chunk: TextChunk, index?: number): void {
    super.insertChunk(chunk, index)
    this.clearChunks(this._text)
  }

  removeChunkByObject(chunk: TextChunk): void {
    const index = this._text.chunks.indexOf(chunk)
    if (index === -1) return
    super.removeChunk(index)
    this.clearChunks(this._text)
  }

  replaceChunkByObject(chunk: TextChunk, oldChunk: TextChunk): void {
    const index = this._text.chunks.indexOf(oldChunk)
    if (index === -1) return
    super.replaceChunk(index, chunk)
    this.clearChunks(this._text)
  }

  private updateTextFromNodes(): void {
    if (this.rootTextNode.isDirty && !this._hasManualStyledText) {
      const chunks = this.rootTextNode.gatherWithInheritedStyle({
        fg: this._defaultFg,
        bg: this._defaultBg,
        attributes: this._defaultAttributes,
      })
      this.textBuffer.setStyledText(new StyledText(chunks))
      this.refreshLocalSelection()
      this.yogaNode.markDirty()
    }
  }

  public add(obj: TextNodeRenderable | StyledText | string, index?: number): number {
    return this.rootTextNode.add(obj, index)
  }

  public remove(id: string): void {
    this.rootTextNode.remove(id)
  }

  public insertBefore(obj: BaseRenderable | any, anchor?: TextNodeRenderable): number {
    this.rootTextNode.insertBefore(obj, anchor)
    return this.rootTextNode.children.indexOf(obj)
  }

  public getTextChildren(): BaseRenderable[] {
    return this.rootTextNode.getChildren()
  }

  public clear(): void {
    this.rootTextNode.clear()

    const emptyStyledText = stringToStyledText("")
    this._text = emptyStyledText
    this.updateTextBuffer(emptyStyledText)
    this.updateTextInfo()

    this.requestRender()
  }

  public onLifecyclePass = () => {
    this.updateTextFromNodes()
  }

  protected onFgChanged(newColor: RGBA): void {
    this.rootTextNode.fg = newColor
  }

  protected onBgChanged(newColor: RGBA): void {
    this.rootTextNode.bg = newColor
  }

  protected onAttributesChanged(newAttributes: number): void {
    this.rootTextNode.attributes = newAttributes
  }

  destroy(): void {
    this.rootTextNode.children.length = 0
    super.destroy()
  }
}
