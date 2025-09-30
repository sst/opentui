import { test, expect, beforeEach, beforeAll, afterAll, describe } from "bun:test"
import { TreeSitterClient, addDefaultParsers } from "./client"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { mkdir, readdir, stat } from "fs/promises"
import type { FiletypeParserOptions } from "./types"

describe("TreeSitterClient Caching", () => {
  let dataPath: string
  let testServer: any
  const TEST_PORT = 55231
  const BASE_URL = `http://localhost:${TEST_PORT}`

  beforeAll(async () => {
    const assetsDir = resolve(__dirname, "assets")
    testServer = Bun.serve({
      port: TEST_PORT,
      fetch(req) {
        const url = new URL(req.url)
        const filePath = join(assetsDir, url.pathname)
        return new Response(Bun.file(filePath))
      },
    })
  })

  afterAll(async () => {
    if (testServer) {
      testServer.stop()
    }
  })

  beforeEach(async () => {
    dataPath = join(tmpdir(), "tree-sitter-cache-test-" + Math.random().toString(36).slice(2))
    await mkdir(dataPath, { recursive: true })
  })

  test("should create storage directories on initialization", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    const languagesDir = join(dataPath, "languages")
    const queriesDir = join(dataPath, "queries")

    const languagesStat = await stat(languagesDir)
    const queriesStat = await stat(queriesDir)

    expect(languagesStat.isDirectory()).toBe(true)
    expect(queriesStat.isDirectory()).toBe(true)

    await client.destroy()
  })

  test("should cache downloaded language files", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Add URL-based parser for this test
    client.addFiletypeParser({
      filetype: "javascript",
      queries: {
        highlights: [`${BASE_URL}/javascript/highlights.scm`],
      },
      wasm: `${BASE_URL}/javascript/tree-sitter-javascript.wasm`,
    })

    const hasParser = await client.preloadParser("javascript")
    expect(hasParser).toBe(true)

    const languagesDir = join(dataPath, "languages")
    const cachedFiles = await readdir(languagesDir)

    expect(cachedFiles).toContain("tree-sitter-javascript.wasm")

    await client.destroy()
  })

  test("should cache downloaded highlight queries", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Add URL-based parser for this test
    client.addFiletypeParser({
      filetype: "javascript",
      queries: {
        highlights: [`${BASE_URL}/javascript/highlights.scm`],
      },
      wasm: `${BASE_URL}/javascript/tree-sitter-javascript.wasm`,
    })

    const hasParser = await client.preloadParser("javascript")
    expect(hasParser).toBe(true)

    const queriesDir = join(dataPath, "queries")
    const cachedQueries = await readdir(queriesDir)

    const scmFiles = cachedQueries.filter((file) => file.endsWith(".scm"))
    expect(scmFiles.length).toBeGreaterThan(0)

    await client.destroy()
  })

  // TODO: This is flaky, there must be a more reliable way to test this
  test.skip("should reuse cached files across client instances", async () => {
    const jsParser: FiletypeParserOptions = {
      filetype: "javascript",
      queries: {
        highlights: [`${BASE_URL}/javascript/highlights.scm`],
      },
      wasm: `${BASE_URL}/javascript/tree-sitter-javascript.wasm`,
    }

    let client1 = new TreeSitterClient({ dataPath })
    await client1.initialize()
    client1.addFiletypeParser(jsParser)

    console.log("=== First client (should download) ===")
    const start1 = Date.now()
    const hasParser1 = await client1.preloadParser("javascript")
    const duration1 = Date.now() - start1
    expect(hasParser1).toBe(true)

    await client1.destroy()

    let client2 = new TreeSitterClient({ dataPath })
    await client2.initialize()
    client2.addFiletypeParser(jsParser)

    console.log("=== Second client (should use cache) ===")
    const start2 = Date.now()
    const hasParser2 = await client2.preloadParser("javascript")
    const duration2 = Date.now() - start2
    expect(hasParser2).toBe(true)

    console.log(`First client: ${duration1}ms, Second client: ${duration2}ms`)

    expect(duration2).toBeLessThanOrEqual(duration1)
    expect(duration2).toBeLessThan(100) // Should be very fast with cache

    await client2.destroy()
  })

  test("should handle multiple parsers with independent caching", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Add URL-based parsers for this test
    client.addFiletypeParser({
      filetype: "javascript",
      queries: {
        highlights: [`${BASE_URL}/javascript/highlights.scm`],
      },
      wasm: `${BASE_URL}/javascript/tree-sitter-javascript.wasm`,
    })
    client.addFiletypeParser({
      filetype: "typescript",
      queries: {
        highlights: [`${BASE_URL}/typescript/highlights.scm`],
      },
      wasm: `${BASE_URL}/typescript/tree-sitter-typescript.wasm`,
    })

    const hasJS = await client.preloadParser("javascript")
    const hasTS = await client.preloadParser("typescript")

    expect(hasJS).toBe(true)
    expect(hasTS).toBe(true)

    const languagesDir = join(dataPath, "languages")
    const cachedFiles = await readdir(languagesDir)

    expect(cachedFiles).toContain("tree-sitter-javascript.wasm")
    expect(cachedFiles).toContain("tree-sitter-typescript.wasm")

    const queriesDir = join(dataPath, "queries")
    const cachedQueries = await readdir(queriesDir)
    const scmFiles = cachedQueries.filter((file) => file.endsWith(".scm"))

    expect(scmFiles.length).toBe(2)

    await client.destroy()
  })

  test("should store files in dataPath subdirectories", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Add URL-based parser for this test
    client.addFiletypeParser({
      filetype: "javascript",
      queries: {
        highlights: [`${BASE_URL}/javascript/highlights.scm`],
      },
      wasm: `${BASE_URL}/javascript/tree-sitter-javascript.wasm`,
    })

    const hasParser = await client.preloadParser("javascript")
    expect(hasParser).toBe(true)

    const languagesDir = join(dataPath, "languages")
    const queriesDir = join(dataPath, "queries")

    const languagesStat = await stat(languagesDir)
    const queriesStat = await stat(queriesDir)

    expect(languagesStat.isDirectory()).toBe(true)
    expect(queriesStat.isDirectory()).toBe(true)

    const cachedFiles = await readdir(languagesDir)
    expect(cachedFiles).toContain("tree-sitter-javascript.wasm")

    await client.destroy()
  })

  test("should handle directory creation errors gracefully", async () => {
    const invalidDataPath = "/invalid/path/that/cannot/be/created"
    const client = new TreeSitterClient({ dataPath: invalidDataPath })

    await expect(client.initialize()).rejects.toThrow()

    await client.destroy()
  })

  test("should handle data path changes", async () => {
    const initialDataPath = join(tmpdir(), "tree-sitter-initial-" + Math.random().toString(36).slice(2))
    const newDataPath = join(tmpdir(), "tree-sitter-new-" + Math.random().toString(36).slice(2))

    await mkdir(initialDataPath, { recursive: true })
    await mkdir(newDataPath, { recursive: true })

    const client = new TreeSitterClient({ dataPath: initialDataPath })
    await client.initialize()

    // Add URL-based parsers for this test
    client.addFiletypeParser({
      filetype: "javascript",
      queries: {
        highlights: [`${BASE_URL}/javascript/highlights.scm`],
      },
      wasm: `${BASE_URL}/javascript/tree-sitter-javascript.wasm`,
    })

    const hasParser1 = await client.preloadParser("javascript")
    expect(hasParser1).toBe(true)

    const initialLanguagesDir = join(initialDataPath, "languages")
    const initialFiles = await readdir(initialLanguagesDir)
    expect(initialFiles).toContain("tree-sitter-javascript.wasm")

    await client.setDataPath(newDataPath)

    // Add typescript parser for the new data path
    client.addFiletypeParser({
      filetype: "typescript",
      queries: {
        highlights: [`${BASE_URL}/typescript/highlights.scm`],
      },
      wasm: `${BASE_URL}/typescript/tree-sitter-typescript.wasm`,
    })

    const hasParser2 = await client.preloadParser("typescript")
    expect(hasParser2).toBe(true)

    const newLanguagesDir = join(newDataPath, "languages")
    const newFiles = await readdir(newLanguagesDir)
    expect(newFiles).toContain("tree-sitter-typescript.wasm")

    await client.destroy()
  })
})
