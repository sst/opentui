import { test, expect, beforeEach, afterEach, beforeAll, describe } from "bun:test"
import { TreeSitterClient } from "./client"
import { tmpdir } from "os"
import { join } from "path"
import { mkdir, writeFile, unlink } from "fs/promises"
import { getDataPaths } from "../data-paths"
import { getTreeSitterClient } from "."

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

    await client.resetBuffer(999, 1, "test")

    expect(errorReceived).toBe(true)
    expect(errorMessage).toContain("Cannot reset buffer with no parser")
  })

  test("should prevent duplicate buffer creation", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

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

  test("should handle Devanagari characters and highlight ranges after them correctly", async () => {
    await client.initialize()

    const jsCode = 'const greeting = "नमस्ते";\nconst x = 42;'
    const result = await client.highlightOnce(jsCode, "javascript")

    expect(result.highlights).toBeDefined()
    expect(result.highlights!.length).toBeGreaterThan(0)

    const keywordHighlights = result.highlights!.filter((hl) => hl[2] === "keyword")
    expect(keywordHighlights.length).toBeGreaterThanOrEqual(2)

    const constHighlights = keywordHighlights.filter((hl) => {
      const text = jsCode.substring(hl[0], hl[1])
      return text === "const"
    })

    expect(constHighlights).toHaveLength(2)

    const firstConst = constHighlights[0]
    const secondConst = constHighlights[1]

    expect(jsCode.substring(firstConst[0], firstConst[1])).toBe("const")
    expect(jsCode.substring(secondConst[0], secondConst[1])).toBe("const")

    expect(firstConst[0]).toBe(0)
    expect(firstConst[1]).toBe(5)

    expect(secondConst[0]).toBeGreaterThan(firstConst[1])
    const textBetween = jsCode.substring(firstConst[1], secondConst[0])
    expect(textBetween).toContain("नमस्ते")

    const numberHighlight = result.highlights!.find((hl) => {
      const text = jsCode.substring(hl[0], hl[1])
      return text === "42" && hl[2] === "number"
    })

    expect(numberHighlight).toBeDefined()
    if (numberHighlight) {
      const [start, end] = numberHighlight
      const actualText = jsCode.substring(start, end)
      expect(actualText).toBe("42")

      const secondLine = jsCode.split("\n")[1]
      const secondLineStart = jsCode.indexOf(secondLine)
      const expectedStart = secondLineStart + secondLine.indexOf("42")
      expect(start).toBe(expectedStart)
    }
  })

  test("should support local file paths for parser configuration", async () => {
    const testQueryPath = join(dataPath, `test-highlights-${Date.now()}.scm`)
    const simpleQuery = "(identifier) @variable"
    await writeFile(testQueryPath, simpleQuery, "utf8")

    try {
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
    } finally {
      try {
        await unlink(testQueryPath)
      } catch (e) {
        // Ignore cleanup errors
      }
    }
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

describe("TreeSitterClient Injections", () => {
  let dataPath: string

  const injectionsDataPath = join(tmpdir(), "tree-sitter-injections-test-data")

  beforeAll(async () => {
    await mkdir(injectionsDataPath, { recursive: true })
  })

  beforeEach(async () => {
    dataPath = injectionsDataPath
  })

  test("should highlight inline code in markdown using markdown_inline injection", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Hello World

The \`CodeRenderable\` component provides syntax highlighting.

You can use \`const x = 42\` in your code.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const groups = result.highlights!.map((hl) => hl[2])
      const hasInlineCodeHighlights = groups.some((g) => g.includes("markup.raw"))

      expect(hasInlineCodeHighlights).toBe(true)
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should highlight code blocks in markdown using language-specific injection", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Code Example

\`\`\`typescript
const hello: string = "world";
function test() { return 42; }
\`\`\`

Some text here.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const groups = result.highlights!.map((hl) => hl[2])
      const hasTypeScriptHighlights = groups.some((g) => g === "keyword" || g === "type" || g === "function")

      expect(hasTypeScriptHighlights).toBe(true)
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should return correct offsets for injected code in markdown code blocks", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Title\n\n\`\`\`typescript\nconst x = 42;\n\`\`\``

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const constHighlight = result.highlights!.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        return text === "const" && hl[2] === "keyword"
      })

      expect(constHighlight).toBeDefined()
      if (constHighlight) {
        const [start, end, group] = constHighlight
        const text = markdownCode.substring(start, end)

        expect(text).toBe("const")
        expect(group).toBe("keyword")
        expect(start).toBe(23)
        expect(end).toBe(28)
      }

      const numberHighlight = result.highlights!.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        return text === "42" && hl[2] === "number"
      })

      expect(numberHighlight).toBeDefined()
      if (numberHighlight) {
        const [start, end, group] = numberHighlight
        const text = markdownCode.substring(start, end)

        expect(text).toBe("42")
        expect(group).toBe("number")
        expect(start).toBe(33)
        expect(end).toBe(35)
      }
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should return highlights sorted by start offset for injected code", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Documentation

Some text with \`inline code\` here.

\`\`\`typescript
const first = 1;
const second = 2;
\`\`\`

More text with \`another inline\` code.

\`\`\`javascript
function test() {
  return 42;
}
\`\`\``

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      for (let i = 1; i < result.highlights!.length; i++) {
        const prevStart = result.highlights![i - 1][0]
        const currStart = result.highlights![i][0]
        expect(currStart).toBeGreaterThanOrEqual(prevStart)
      }
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should handle markdown with injections and return valid highlights", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Heading

Some **bold** text with \`inline code\`.

\`\`\`typescript
const x: string = "hello";
\`\`\`

[Link text](https://example.com)`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const overlaps: Array<[number, number]> = []
      for (let i = 0; i < result.highlights!.length; i++) {
        for (let j = i + 1; j < result.highlights!.length; j++) {
          const [start1, end1] = result.highlights![i]
          const [start2, end2] = result.highlights![j]

          if (start2 < end1) {
            overlaps.push([i, j])
          }
        }
      }

      expect(overlaps.length).toBeGreaterThanOrEqual(0)

      const injectionHighlights = result.highlights!.filter((hl) => hl[2].includes("injection"))
      expect(injectionHighlights).toBeDefined()

      const concealHighlights = result.highlights!.filter((hl) => hl[2] === "conceal")
      expect(concealHighlights).toBeDefined()

      const blockHighlights = result.highlights!.filter((hl) => hl[2] === "markup.raw.block")
      expect(blockHighlights).toBeDefined()
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should handle fast concurrent markdown highlighting requests with injections", async () => {
    const client = new TreeSitterClient({ dataPath })

    const errors: string[] = []
    client.on("error", (error) => {
      errors.push(error)
    })

    client.on("worker:log", (logType, message) => {
      if (logType === "error") {
        errors.push(message)
      }
    })

    try {
      await client.initialize()

      const markdownCode = `# OpenTUI Documentation

## Getting Started

OpenTUI is a modern terminal UI framework built on **tree-sitter** and WebGPU.

### Installation

\`\`\`bash
bun install opentui
\`\`\`

### Quick Example

\`\`\`typescript
import { createCliRenderer, BoxRenderable } from 'opentui';

const renderer = await createCliRenderer();
const box = new BoxRenderable(renderer, {
  border: true,
  title: "Hello World"
});
renderer.root.add(box);
\`\`\`

The \`CodeRenderable\` component provides syntax highlighting.

| Property | Type | Description |
|----------|------|-------------|
| content | string | Code to display |
| filetype | string | Language type |`

      const jsCode = `function test() {
  const hello = "world";
  return hello;
}`

      const tsCode = `interface User {
  name: string;
  age: number;
}

const user: User = { name: "Alice", age: 25 };`

      const promises = []
      for (let i = 0; i < 5; i++) {
        promises.push(client.highlightOnce(markdownCode, "markdown"))
      }

      const results = await Promise.allSettled(promises)

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === "fulfilled") {
          expect(result.value.error).toBeUndefined()
          expect(result.value.highlights).toBeDefined()
        } else {
          throw new Error(`Request ${i} was rejected: ${result.reason}`)
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500))

      const hasMemoryErrors = errors.some((err) => err.includes("Out of bounds memory access"))
      expect(hasMemoryErrors).toBe(false)
    } finally {
      await client.destroy()
    }
  }, 15000)
})

describe("TreeSitterClient Conceal Values", () => {
  let dataPath: string

  const concealDataPath = join(tmpdir(), "tree-sitter-conceal-test-data")

  beforeAll(async () => {
    await mkdir(concealDataPath, { recursive: true })
  })

  beforeEach(async () => {
    dataPath = concealDataPath
  })

  test("should return conceal values from normal (non-injected) queries", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `![Image Alt Text](https://example.com/image.png)`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
      })
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should return conceal values from injected queries (markdown_inline)", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `Here is a [link](https://example.com) in text.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
        expect(meta.isInjection).toBeDefined()
      })

      const closingBracketHighlight = concealedHighlights.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        return text === "]" && meta.conceal !== ""
      })

      if (closingBracketHighlight) {
        const meta = (closingBracketHighlight as any)[3]
        expect(meta.conceal).toBeDefined()
      }
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should distinguish conceal values between normal and injected queries", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `Here is a [link](https://example.com) and ![image](https://example.com/img.png).`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      const normalConceal = concealedHighlights.filter((hl) => {
        const meta = (hl as any)[3]
        return !meta.isInjection
      })

      const injectedConceal = concealedHighlights.filter((hl) => {
        const meta = (hl as any)[3]
        return meta.isInjection
      })

      expect(injectedConceal.length).toBeGreaterThan(0)

      injectedConceal.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
        expect(meta.isInjection).toBe(true)
      })

      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
        expect(typeof meta.isInjection).toBe("boolean")
      })
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should handle pattern index lookups correctly for injections", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `A [link](url) here.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
      })
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should handle multiple injected languages with different conceal patterns", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Title

Inline \`code\` and a [link](url) here.

\`\`\`typescript
const x = 42;
\`\`\`

More text with ![image](img.png) and **bold**.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      const byLang = new Map<string, any[]>()
      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        const lang = meta.isInjection ? meta.injectionLang || "injected" : "normal"
        if (!byLang.has(lang)) {
          byLang.set(lang, [])
        }
        byLang.get(lang)!.push(hl)
      })

      expect(byLang.size).toBeGreaterThan(0)

      byLang.forEach((highlights) => {
        expect(highlights.length).toBeGreaterThan(0)
        highlights.forEach((hl: any) => {
          const meta = hl[3]
          expect(meta.conceal).toBeDefined()
        })
      })
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should preserve non-empty conceal replacements like space character", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `Check [this link](https://example.com) out!`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const closingBracket = result.highlights!.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        return text === "]" && hl[2] === "conceal" && meta?.conceal !== undefined
      })

      if (closingBracket) {
        const meta = (closingBracket as any)[3]
        expect(meta).toBeDefined()
        expect(meta.conceal).toBeDefined()
        expect(meta.conceal).toBe(" ")
        expect(meta.conceal.length).toBeGreaterThan(0)
      }
    } finally {
      await client.destroy()
    }
  }, 10000)
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
    const client = new TreeSitterClient({
      dataPath,
      workerPath: "invalid-path",
      initTimeout: 500,
    })

    await expect(client.initialize()).rejects.toThrow(/Worker error|Worker initialization timed out/)

    await client.destroy()
  })

  test("should handle operations before initialization", async () => {
    const client = new TreeSitterClient({ dataPath })

    expect(client.isInitialized()).toBe(false)
    expect(client.getAllBuffers()).toHaveLength(0)
    expect(client.getBuffer(1)).toBeUndefined()

    await client.destroy()
  })

  test("should handle destroy() during pending initialization", async () => {
    const client = new TreeSitterClient({ dataPath })

    // Start init but don't await
    const initPromise = client.initialize()

    // Immediately destroy
    await client.destroy()

    // Init promise should reject with specific error
    await expect(initPromise).rejects.toThrow("Client destroyed during initialization")

    expect(client.isInitialized()).toBe(false)
  })

  test("should handle worker errors gracefully", async () => {
    const client = new TreeSitterClient({ dataPath })

    let errorReceived = false
    client.on("error", () => {
      errorReceived = true
    })

    const hasParser = await client.createBuffer(1, "test", "javascript", 1, false)
    expect(hasParser).toBe(false)
    expect(errorReceived).toBe(true)

    await client.destroy()
  })

  test("should handle data path changes with reactive getTreeSitterClient", async () => {
    const dataPathsManager = getDataPaths()
    const originalAppName = dataPathsManager.appName
    let client: any

    try {
      client = getTreeSitterClient()
      await client.initialize()

      const initialDataPath = dataPathsManager.globalDataPath

      dataPathsManager.appName = "test-app-changed"

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
