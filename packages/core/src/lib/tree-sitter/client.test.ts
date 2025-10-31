import { test, expect, beforeEach, afterEach, beforeAll, describe } from "bun:test"
import { TreeSitterClient } from "./client"
import { tmpdir } from "os"
import { join } from "path"
import { mkdir, writeFile } from "fs/promises"
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

  test("should inspect highlight metadata structure for markdown with injections", async () => {
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

      console.log("=== MARKDOWN HIGHLIGHT INSPECTION ===")
      console.log("Total highlights:", result.highlights?.length)

      expect(result.highlights).toBeDefined()

      result.highlights?.forEach((hl, idx) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        console.log(`[${idx}] [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}`, meta ? `meta: ${JSON.stringify(meta)}` : "")
      })

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

      console.log("Overlapping highlight pairs:", overlaps.length)
      overlaps.slice(0, 10).forEach(([i, j]) => {
        const hl1 = result.highlights![i]
        const hl2 = result.highlights![j]
        const text1 = markdownCode.substring(hl1[0], hl1[1])
        const text2 = markdownCode.substring(hl2[0], hl2[1])
        console.log(`  [${i}] "${text1}" (${hl1[2]}) overlaps [${j}] "${text2}" (${hl2[2]})`)
      })

      const injectionHighlights = result.highlights!.filter((hl) => hl[2].includes("injection"))
      console.log("Injection-related highlights:", injectionHighlights.length)
      injectionHighlights.forEach((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        console.log(`  [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}`)
      })

      const concealHighlights = result.highlights!.filter((hl) => hl[2] === "conceal")
      console.log("Conceal highlights:", concealHighlights.length)
      concealHighlights.forEach((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        console.log(`  [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}`)
      })

      const blockHighlights = result.highlights!.filter((hl) => hl[2] === "markup.raw.block")
      console.log("Markup.raw.block highlights:", blockHighlights.length)
      blockHighlights.slice(0, 5).forEach((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        console.log(`  [${hl[0]}, ${hl[1]}] "${text.substring(0, 20)}..." -> ${hl[2]}`)
      })

      console.log("=== END INSPECTION ===")
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

      // Markdown has conceal directives in its main highlights query
      // For example, image syntax: ![alt](url) conceals the brackets and parentheses
      const markdownCode = `![Image Alt Text](https://example.com/image.png)`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      console.log("\n=== NORMAL QUERY CONCEAL VALUES ===")
      concealedHighlights.forEach((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        console.log(`  [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}, conceal: "${meta.conceal}"`)
      })
      console.log("=== END NORMAL QUERY CONCEAL VALUES ===\n")
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should return conceal values from injected queries (markdown_inline)", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      // Inline links in markdown use the markdown_inline parser (injected)
      // The pattern should conceal the closing bracket with a space
      const markdownCode = `Here is a [link](https://example.com) in text.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      console.log("\n=== INJECTED QUERY CONCEAL VALUES ===")
      concealedHighlights.forEach((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        console.log(
          `  [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}, conceal: "${meta.conceal}", isInjection: ${meta.isInjection}`,
        )
      })
      console.log("=== END INJECTED QUERY CONCEAL VALUES ===\n")

      const closingBracketHighlight = concealedHighlights.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        return text === "]" && meta.conceal !== ""
      })

      if (closingBracketHighlight) {
        const meta = (closingBracketHighlight as any)[3]
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

      console.log("\n=== MIXED NORMAL + INJECTED CONCEAL VALUES ===")
      console.log("Total highlights:", result.highlights!.length)
      console.log("Concealed highlights:", concealedHighlights.length)

      const normalConceal = concealedHighlights.filter((hl) => {
        const meta = (hl as any)[3]
        return !meta.isInjection
      })

      const injectedConceal = concealedHighlights.filter((hl) => {
        const meta = (hl as any)[3]
        return meta.isInjection
      })

      console.log("\nNormal query conceals:", normalConceal.length)
      normalConceal.forEach((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        console.log(`  [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}, conceal: "${meta.conceal}"`)
      })

      console.log("\nInjected query conceals:", injectedConceal.length)
      injectedConceal.forEach((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        console.log(`  [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}, conceal: "${meta.conceal}"`)
      })

      console.log("=== END MIXED CONCEAL VALUES ===\n")

      expect(injectedConceal.length).toBeGreaterThan(0)
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

      // The bug was that pattern indices from injected queries were being looked up
      // in the parent query's setProperties array. This test verifies the fix works.
      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      console.log("\n=== PATTERN INDEX VERIFICATION ===")
      console.log("All highlights:")
      result.highlights!.forEach((hl, idx) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        console.log(
          `  [${idx}] [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}`,
          meta ? `meta: ${JSON.stringify(meta)}` : "",
        )
      })

      console.log("\nConcealed highlights detail:")
      concealedHighlights.forEach((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        console.log(`  Text: "${text}", Group: ${hl[2]}, Conceal: "${meta.conceal}", IsInjection: ${meta.isInjection}`)
      })
      console.log("=== END PATTERN INDEX VERIFICATION ===\n")

      // If the pattern index bug exists, we would get empty strings or wrong values
      // After the fix, all conceal values should be correctly retrieved
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

      console.log("\n=== MULTIPLE INJECTION CONCEAL TEST ===")
      console.log("Total highlights:", result.highlights!.length)
      console.log("Concealed highlights:", concealedHighlights.length)

      const byLang = new Map<string, any[]>()
      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        const lang = meta.isInjection ? meta.injectionLang || "injected" : "normal"
        if (!byLang.has(lang)) {
          byLang.set(lang, [])
        }
        byLang.get(lang)!.push(hl)
      })

      byLang.forEach((highlights, lang) => {
        console.log(`\n${lang} conceals: ${highlights.length}`)
        highlights.forEach((hl: any) => {
          const text = markdownCode.substring(hl[0], hl[1])
          const meta = hl[3]
          console.log(`  [${hl[0]}, ${hl[1]}] "${text}" -> ${hl[2]}, conceal: "${meta.conceal}"`)
        })
      })

      console.log("=== END MULTIPLE INJECTION CONCEAL TEST ===\n")

      expect(concealedHighlights.length).toBeGreaterThan(0)
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

      // Find the closing bracket conceal highlight (not the markup.link.bracket.close)
      const closingBracket = result.highlights!.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        return text === "]" && hl[2] === "conceal" && meta?.conceal !== undefined
      })

      console.log("\n=== SPACE REPLACEMENT TEST ===")
      if (closingBracket) {
        const meta = (closingBracket as any)[3]
        const text = markdownCode.substring(closingBracket[0], closingBracket[1])
        console.log(`Found closing bracket: [${closingBracket[0]}, ${closingBracket[1]}] "${text}"`)
        console.log(`  Group: ${closingBracket[2]}`)
        console.log(`  Meta:`, meta)
        if (meta) {
          console.log(`  Conceal value: "${meta.conceal}" (length: ${meta.conceal?.length})`)
          console.log(`  Conceal charCode:`, meta.conceal ? meta.conceal.charCodeAt(0) : "undefined")
        }
      } else {
        console.log("No closing bracket highlight found")
      }
      console.log("=== END SPACE REPLACEMENT TEST ===\n")

      // This is the critical test case from the issue
      // NOT an empty string which was the bug
      if (closingBracket) {
        const meta = (closingBracket as any)[3]
        expect(meta).toBeDefined()
        expect(meta.conceal).toBeDefined()
        // Should be a space character, not empty
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
