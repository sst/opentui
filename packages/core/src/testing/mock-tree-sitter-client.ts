import { TreeSitterClient } from "../lib/tree-sitter"
import type { SimpleHighlight } from "../lib/tree-sitter/types"

export class MockTreeSitterClient extends TreeSitterClient {
  private _highlightOnceResolver:
    | ((result: { highlights?: SimpleHighlight[]; warning?: string; error?: string }) => void)
    | null = null
  private _highlightOncePromise: Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> | null =
    null
  private _mockResult: { highlights?: SimpleHighlight[]; warning?: string; error?: string } = { highlights: [] }

  constructor() {
    super({ dataPath: "/tmp/mock" })
  }

  async highlightOnce(
    content: string,
    filetype: string,
  ): Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> {
    this._highlightOncePromise = new Promise((resolve) => {
      this._highlightOnceResolver = resolve
    })

    return this._highlightOncePromise
  }

  setMockResult(result: { highlights?: SimpleHighlight[]; warning?: string; error?: string }) {
    this._mockResult = result
  }

  resolveHighlightOnce() {
    if (this._highlightOnceResolver) {
      this._highlightOnceResolver(this._mockResult)
      this._highlightOnceResolver = null
      this._highlightOncePromise = null
    }
  }

  isHighlighting(): boolean {
    return this._highlightOncePromise !== null
  }
}
