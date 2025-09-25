import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { TreeSitterClient } from "./client"
import { tmpdir } from "os"
import { join } from "path"
import { mkdir, readdir, stat } from "fs/promises"

describe("TreeSitterClient Caching", () => {
  let dataPath: string

  beforeEach(async () => {
    // Create a temporary directory for test data
    dataPath = join(tmpdir(), "tree-sitter-cache-test-" + Math.random().toString(36).slice(2))
    await mkdir(dataPath, { recursive: true })
  })

  test("should create storage directories on initialization", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Check that storage directories were created
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

    // Preload JavaScript parser - should download and cache
    const hasParser = await client.preloadParser("javascript")
    expect(hasParser).toBe(true)

    // Check that the language file was cached
    const languagesDir = join(dataPath, "languages")
    const cachedFiles = await readdir(languagesDir)

    expect(cachedFiles).toContain("tree-sitter-javascript.wasm")

    await client.destroy()
  })

  test("should cache downloaded highlight queries", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Preload JavaScript parser - should download and cache highlight query
    const hasParser = await client.preloadParser("javascript")
    expect(hasParser).toBe(true)

    // Check that highlight queries were cached
    const queriesDir = join(dataPath, "queries")
    const cachedQueries = await readdir(queriesDir)

    // Should have at least one .scm file (the cached highlight query)
    const scmFiles = cachedQueries.filter((file) => file.endsWith(".scm"))
    expect(scmFiles.length).toBeGreaterThan(0)

    await client.destroy()
  })

  test("should reuse cached files across client instances", async () => {
    // First client - downloads and caches
    let client1 = new TreeSitterClient({ dataPath })
    await client1.initialize()

    console.log("=== First client (should download) ===")
    const start1 = Date.now()
    const hasParser1 = await client1.preloadParser("javascript")
    const duration1 = Date.now() - start1
    expect(hasParser1).toBe(true)

    await client1.destroy()

    // Second client - should use cache
    let client2 = new TreeSitterClient({ dataPath })
    await client2.initialize()

    console.log("=== Second client (should use cache) ===")
    const start2 = Date.now()
    const hasParser2 = await client2.preloadParser("javascript")
    const duration2 = Date.now() - start2
    expect(hasParser2).toBe(true)

    console.log(`First client: ${duration1}ms, Second client: ${duration2}ms`)

    // Second should be significantly faster due to caching
    expect(duration2).toBeLessThan(duration1)
    expect(duration2).toBeLessThan(100) // Should be very fast with cache

    await client2.destroy()
  })

  test("should handle multiple parsers with independent caching", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Preload both JavaScript and TypeScript
    const hasJS = await client.preloadParser("javascript")
    const hasTS = await client.preloadParser("typescript")

    expect(hasJS).toBe(true)
    expect(hasTS).toBe(true)

    // Check that both language files were cached
    const languagesDir = join(dataPath, "languages")
    const cachedFiles = await readdir(languagesDir)

    expect(cachedFiles).toContain("tree-sitter-javascript.wasm")
    expect(cachedFiles).toContain("tree-sitter-typescript.wasm")

    // Check that both highlight queries were cached
    const queriesDir = join(dataPath, "queries")
    const cachedQueries = await readdir(queriesDir)
    const scmFiles = cachedQueries.filter((file) => file.endsWith(".scm"))

    // Should have 2 cached highlight queries
    expect(scmFiles.length).toBe(2)

    await client.destroy()
  })

  test("should store files in dataPath subdirectories", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    const hasParser = await client.preloadParser("javascript")
    expect(hasParser).toBe(true)

    // Should use dataPath subdirectories
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
    // Use an invalid data path that can't be created
    const invalidDataPath = "/invalid/path/that/cannot/be/created"
    const client = new TreeSitterClient({ dataPath: invalidDataPath })

    // Should fail to initialize due to directory creation error
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

    const hasParser1 = await client.preloadParser("javascript")
    expect(hasParser1).toBe(true)

    const initialLanguagesDir = join(initialDataPath, "languages")
    const initialFiles = await readdir(initialLanguagesDir)
    expect(initialFiles).toContain("tree-sitter-javascript.wasm")

    await client.setDataPath(newDataPath)

    const hasParser2 = await client.preloadParser("typescript")
    expect(hasParser2).toBe(true)

    const newLanguagesDir = join(newDataPath, "languages")
    const newFiles = await readdir(newLanguagesDir)
    expect(newFiles).toContain("tree-sitter-typescript.wasm")

    await client.destroy()
  })
})
