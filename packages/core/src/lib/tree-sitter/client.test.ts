import { test, expect, beforeEach, afterEach, beforeAll, describe } from "bun:test"
import { TreeSitterClient } from "./client"
import { tmpdir } from "os"
import { join } from "path"
import { mkdir, writeFile } from "fs/promises"

describe("TreeSitterClient", () => {
  let client: TreeSitterClient
  let dataPath: string

  const sharedDataPath = join(tmpdir(), "tree-sitter-shared-test-data")

  beforeAll(async () => {
    await mkdir(sharedDataPath, { recursive: true })
  })

  beforeEach(async () => {
    dataPath = sharedDataPath
    client = new TreeSitterClient({
      dataPath,
    })
  })

  afterEach(async () => {
    if (client) {
      await client.destroy()
    }
  })

  test("should initialize successfully", async () => {
    await client.initialize()
    expect(client.isInitialized()).toBe(true)
  })

  test("should preload parsers for supported filetypes", async () => {
    await client.initialize()

    const hasJavaScript = await client.preloadParser("javascript")
    expect(hasJavaScript).toBe(true)

    const hasTypeScript = await client.preloadParser("typescript")
    expect(hasTypeScript).toBe(true)
  })

  test("should return false for unsupported filetypes", async () => {
    await client.initialize()

    const hasUnsupported = await client.preloadParser("unsupported-language")
    expect(hasUnsupported).toBe(false)
  })

  test("should create buffer with supported filetype", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    const hasParser = await client.createBuffer(1, jsCode, "javascript")

    expect(hasParser).toBe(true)

    const buffer = client.getBuffer(1)
    expect(buffer).toBeDefined()
    expect(buffer?.hasParser).toBe(true)
    expect(buffer?.content).toBe(jsCode)
    expect(buffer?.filetype).toBe("javascript")
  })

  test("should create buffer without parser for unsupported filetype", async () => {
    await client.initialize()

    const content = "some random content"
    const hasParser = await client.createBuffer(1, content, "unsupported")

    expect(hasParser).toBe(false)

    const buffer = client.getBuffer(1)
    expect(buffer).toBeDefined()
    expect(buffer?.hasParser).toBe(false)
  })

  test("should emit highlights:response event when buffer is updated", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    let highlightReceived = false
    let receivedBufferId: number | undefined
    let receivedVersion: number | undefined

    client.on("highlights:response", (bufferId, version, highlights) => {
      highlightReceived = true
      receivedBufferId = bufferId
      receivedVersion = version
    })

    // Wait a bit for initial highlighting to complete
    await new Promise((resolve) => setTimeout(resolve, 100))

    const newCode = 'const hello = "world";\nconst foo = 42;'
    const edits = [
      {
        startIndex: jsCode.length,
        oldEndIndex: jsCode.length,
        newEndIndex: newCode.length,
        startPosition: { row: 0, column: jsCode.length },
        oldEndPosition: { row: 0, column: jsCode.length },
        newEndPosition: { row: 1, column: 14 },
      },
    ]

    await client.updateBuffer(1, edits, newCode, 2)

    // Wait for highlighting to complete
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(highlightReceived).toBe(true)
    expect(receivedBufferId).toBe(1)
    expect(receivedVersion).toBe(2)
  })

  test("should handle buffer removal", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    let bufferDisposed = false
    client.on("buffer:disposed", (bufferId) => {
      if (bufferId === 1) {
        bufferDisposed = true
      }
    })

    await client.removeBuffer(1)

    expect(bufferDisposed).toBe(true)
    expect(client.getBuffer(1)).toBeUndefined()
  })

  test("should handle multiple buffers", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    const tsCode = "interface Test { value: string }"

    await client.createBuffer(1, jsCode, "javascript")
    await client.createBuffer(2, tsCode, "typescript")

    const buffers = client.getAllBuffers()
    expect(buffers).toHaveLength(2)

    const jsBuffer = client.getBuffer(1)
    const tsBuffer = client.getBuffer(2)

    expect(jsBuffer?.filetype).toBe("javascript")
    expect(tsBuffer?.filetype).toBe("typescript")
    expect(jsBuffer?.hasParser).toBe(true)
    expect(tsBuffer?.hasParser).toBe(true)
  })

  test("should handle buffer reset", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    const newContent = "function test() { return 42; }"
    await client.resetBuffer(1, 2, newContent)

    const buffer = client.getBuffer(1)
    expect(buffer?.content).toBe(newContent)
    expect(buffer?.version).toBe(2)
  })

  test("should emit error events for invalid operations", async () => {
    await client.initialize()

    let errorReceived = false
    let errorMessage = ""

    client.on("error", (error, bufferId) => {
      errorReceived = true
      errorMessage = error
    })

    // Try to reset a buffer that doesn't exist
    await client.resetBuffer(999, 1, "test")

    expect(errorReceived).toBe(true)
    expect(errorMessage).toContain("Cannot reset buffer with no parser")
  })

  test("should prevent duplicate buffer creation", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    // Try to create buffer with same ID
    await expect(client.createBuffer(1, "other code", "javascript")).rejects.toThrow("Buffer with id 1 already exists")
  })

  test("should handle performance metrics", async () => {
    await client.initialize()

    const performance = await client.getPerformance()
    expect(performance).toBeDefined()
    expect(typeof performance.averageParseTime).toBe("number")
    expect(typeof performance.averageQueryTime).toBe("number")
    expect(Array.isArray(performance.parseTimes)).toBe(true)
    expect(Array.isArray(performance.queryTimes)).toBe(true)
  })

  test("should handle concurrent buffer operations", async () => {
    await client.initialize()

    const promises = []

    // Create multiple buffers concurrently
    for (let i = 0; i < 5; i++) {
      const code = `const var${i} = ${i};`
      promises.push(client.createBuffer(i, code, "javascript"))
    }

    const results = await Promise.all(promises)
    expect(results.every((result) => result === true)).toBe(true)

    const buffers = client.getAllBuffers()
    expect(buffers).toHaveLength(5)
  })

  test("should clean up resources on destroy", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    expect(client.getAllBuffers()).toHaveLength(1)

    await client.destroy()

    expect(client.isInitialized()).toBe(false)
    expect(client.getAllBuffers()).toHaveLength(0)
  })

  test("should perform one-shot highlighting", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";\nfunction test() { return 42; }'
    const result = await client.highlightOnce(jsCode, "javascript")

    expect(result.highlights).toBeDefined()
    expect(result.highlights!.length).toBeGreaterThan(0)

    const firstHighlight = result.highlights![0]
    expect(Array.isArray(firstHighlight)).toBe(true)
    expect(firstHighlight).toHaveLength(3)
    expect(typeof firstHighlight[0]).toBe("number")
    expect(typeof firstHighlight[1]).toBe("number")
    expect(typeof firstHighlight[2]).toBe("string")

    // Should have some highlight groups
    const groups = result.highlights!.map((hl) => hl[2])
    expect(groups.length).toBeGreaterThan(0)
    expect(groups).toContain("keyword")
  })

  test("should handle one-shot highlighting for unsupported filetype", async () => {
    await client.initialize()

    const result = await client.highlightOnce("some content", "unsupported-lang")

    expect(result.highlights).toBeUndefined()
    expect(result.warning).toContain("No parser available for filetype unsupported-lang")
  }, 5000)

  test("should perform multiple one-shot highlights independently", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    const tsCode = "interface Test { value: string }"

    const [jsResult, tsResult] = await Promise.all([
      client.highlightOnce(jsCode, "javascript"),
      client.highlightOnce(tsCode, "typescript"),
    ])

    expect(jsResult.highlights).toBeDefined()
    expect(tsResult.highlights).toBeDefined()
    expect(jsResult.highlights!.length).toBeGreaterThan(0)
    expect(tsResult.highlights!.length).toBeGreaterThan(0)

    jsResult.highlights!.forEach((hl) => {
      expect(Array.isArray(hl)).toBe(true)
      expect(hl).toHaveLength(3)
    })

    tsResult.highlights!.forEach((hl) => {
      expect(Array.isArray(hl)).toBe(true)
      expect(hl).toHaveLength(3)
    })

    expect(client.getAllBuffers()).toHaveLength(0)
  })

  test("should support local file paths for parser configuration", async () => {
    const testQueryPath = join(dataPath, "test-highlights.scm")
    const simpleQuery = "(identifier) @variable"
    await writeFile(testQueryPath, simpleQuery, "utf8")

    client.addFiletypeParser({
      filetype: "test-lang",
      queries: {
        highlights: [testQueryPath],
      },
      wasm: "https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.23.1/tree-sitter-javascript.wasm",
    })

    await client.initialize()

    const hasParser = await client.preloadParser("test-lang")
    expect(hasParser).toBe(true)

    const testCode = "const myVariable = 42;"
    const result = await client.highlightOnce(testCode, "test-lang")

    expect(result.highlights).toBeDefined()
    expect(result.error).toBeUndefined()
    expect(result.warning).toBeUndefined()
  })

  test("should handle concurrent highlightOnce calls efficiently (no duplicate parser loading)", async () => {
    const freshClient = new TreeSitterClient({ dataPath })
    const workerLogs: string[] = []

    freshClient.on("worker:log", (logType, message) => {
      if (message.includes("Loading from local path:")) {
        workerLogs.push(message)
      }
    })

    try {
      await freshClient.initialize()

      const jsCode = 'const hello = "world"; function test() { return 42; }'
      const promises = Array.from({ length: 5 }, () => freshClient.highlightOnce(jsCode, "javascript"))

      const results = await Promise.all(promises)

      for (const result of results) {
        expect(result.highlights).toBeDefined()
        expect(result.highlights!.length).toBeGreaterThan(0)
        expect(result.error).toBeUndefined()
      }

      const firstResult = results[0]
      for (let i = 1; i < results.length; i++) {
        expect(results[i].highlights).toEqual(firstResult.highlights)
      }

      await new Promise((resolve) => setTimeout(resolve, 100))

      const languageLoadLogs = workerLogs.filter((log) => log.includes("tree-sitter-javascript.wasm"))
      const queryLoadLogs = workerLogs.filter((log) => log.includes("highlights.scm"))

      expect(languageLoadLogs.length).toBeLessThanOrEqual(1)
      expect(queryLoadLogs.length).toBeLessThanOrEqual(1)
    } finally {
      await freshClient.destroy()
    }
  })
})

describe("TreeSitterClient Edge Cases", () => {
  let dataPath: string

  const edgeCaseDataPath = join(tmpdir(), "tree-sitter-edge-case-test-data")

  beforeAll(async () => {
    await mkdir(edgeCaseDataPath, { recursive: true })
  })

  beforeEach(async () => {
    dataPath = edgeCaseDataPath
  })

  test("should handle initialization timeout", async () => {
    // Create client with invalid worker path and short timeout
    const client = new TreeSitterClient({
      dataPath,
      workerPath: "invalid-path",
      initTimeout: 500,
    })

    // Should fail with either a worker error (Bun fails fast) or timeout
    await expect(client.initialize()).rejects.toThrow(/Worker error|Worker initialization timed out/)

    await client.destroy()
  })

  test("should handle operations before initialization", async () => {
    const client = new TreeSitterClient({ dataPath })

    // These operations should work even before initialization
    expect(client.isInitialized()).toBe(false)
    expect(client.getAllBuffers()).toHaveLength(0)
    expect(client.getBuffer(1)).toBeUndefined()

    await client.destroy()
  })

  test("should handle worker errors gracefully", async () => {
    const client = new TreeSitterClient({ dataPath })

    let errorReceived = false
    client.on("error", () => {
      errorReceived = true
    })

    // Try to create buffer before initialization with autoInitialize disabled
    const hasParser = await client.createBuffer(1, "test", "javascript", 1, false)
    expect(hasParser).toBe(false)
    expect(errorReceived).toBe(true)

    await client.destroy()
  })

  test("should handle data path changes with reactive getTreeSitterClient", async () => {
    const { getDataPaths } = await import("../data-paths")
    const { getTreeSitterClient } = await import("./index")

    const dataPathsManager = getDataPaths()
    const originalAppName = dataPathsManager.appName
    let client: any

    try {
      client = getTreeSitterClient()
      await client.initialize()

      const initialDataPath = dataPathsManager.globalDataPath

      dataPathsManager.appName = "test-app-changed"

      // Wait for the event to propagate and client to reinitialize
      await new Promise((resolve) => setTimeout(resolve, 100))

      const newDataPath = dataPathsManager.globalDataPath
      expect(newDataPath).not.toBe(initialDataPath)
      expect(newDataPath).toContain("test-app-changed")

      if (!client.isInitialized()) {
        await client.initialize()
      }

      const hasParser = await client.preloadParser("javascript")
      expect(hasParser).toBe(true)
    } finally {
      if (client) {
        await client.destroy()
      }

      dataPathsManager.appName = originalAppName
    }
  })
})
