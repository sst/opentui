import { TreeSitterClient } from "../lib/tree-sitter"
import type { SimpleHighlight } from "../lib/tree-sitter/types"

type HighlightResult = {
  highlights?: SimpleHighlight[]
  warning?: string
  error?: string
  transformedContent?: string
}

export class MockTreeSitterClient extends TreeSitterClient {
  private _highlightPromises: Array<{
    promise: Promise<HighlightResult>
    resolve: (result: HighlightResult) => void
    timeout?: ReturnType<typeof setTimeout>
  }> = []
  private _mockResult: HighlightResult = { highlights: [] }
  private _autoResolveTimeout?: number

  constructor(options?: { autoResolveTimeout?: number }) {
    super({ dataPath: "/tmp/mock" })
    this._autoResolveTimeout = options?.autoResolveTimeout
  }

  async highlightOnce(content: string, filetype: string, options?: { conceal?: boolean }): Promise<HighlightResult> {
    const { promise, resolve } = Promise.withResolvers<HighlightResult>()

    let timeout: ReturnType<typeof setTimeout> | undefined

    if (this._autoResolveTimeout !== undefined) {
      timeout = setTimeout(() => {
        const index = this._highlightPromises.findIndex((p) => p.promise === promise)
        if (index !== -1) {
          resolve(this._mockResult)
          this._highlightPromises.splice(index, 1)
        }
      }, this._autoResolveTimeout)
    }

    this._highlightPromises.push({ promise, resolve, timeout })

    return promise
  }

  setMockResult(result: HighlightResult) {
    this._mockResult = result
  }

  resolveHighlightOnce(index: number = 0) {
    if (index >= 0 && index < this._highlightPromises.length) {
      const item = this._highlightPromises[index]
      if (item.timeout) {
        clearTimeout(item.timeout)
      }
      item.resolve(this._mockResult)
      this._highlightPromises.splice(index, 1)
    }
  }

  resolveAllHighlightOnce() {
    for (const { resolve, timeout } of this._highlightPromises) {
      if (timeout) {
        clearTimeout(timeout)
      }
      resolve(this._mockResult)
    }
    this._highlightPromises = []
  }

  isHighlighting(): boolean {
    return this._highlightPromises.length > 0
  }
}
