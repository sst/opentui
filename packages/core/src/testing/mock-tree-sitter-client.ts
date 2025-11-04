import { TreeSitterClient } from "../lib/tree-sitter"
import type { SimpleHighlight } from "../lib/tree-sitter/types"

export class MockTreeSitterClient extends TreeSitterClient {
  private _highlightPromises: Array<{
    promise: Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }>
    resolve: (result: { highlights?: SimpleHighlight[]; warning?: string; error?: string }) => void
  }> = []
  private _mockResult: { highlights?: SimpleHighlight[]; warning?: string; error?: string } = { highlights: [] }

  constructor() {
    super({ dataPath: "/tmp/mock" })
  }

  async highlightOnce(
    content: string,
    filetype: string,
  ): Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> {
    const { promise, resolve } = Promise.withResolvers<{
      highlights?: SimpleHighlight[]
      warning?: string
      error?: string
    }>()

    this._highlightPromises.push({ promise, resolve })

    return promise
  }

  setMockResult(result: { highlights?: SimpleHighlight[]; warning?: string; error?: string }) {
    this._mockResult = result
  }

  resolveHighlightOnce(index: number = 0) {
    if (index >= 0 && index < this._highlightPromises.length) {
      this._highlightPromises[index].resolve(this._mockResult)
      this._highlightPromises.splice(index, 1)
    }
  }

  resolveAllHighlightOnce() {
    for (const { resolve } of this._highlightPromises) {
      resolve(this._mockResult)
    }
    this._highlightPromises = []
  }

  isHighlighting(): boolean {
    return this._highlightPromises.length > 0
  }
}
