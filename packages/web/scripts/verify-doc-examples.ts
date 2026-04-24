#!/usr/bin/env bun
/**
 * Verifies that documentation code examples are accurate by type-checking them.
 *
 * Usage:
 *   bun scripts/verify-doc-examples.ts [file-pattern]
 *
 * This script:
 * 1. Extracts TypeScript/JavaScript code blocks from MDX files
 * 2. Type-checks them against @opentui/core
 * 3. Reports any type errors found
 */

import { cp, readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { existsSync } from "node:fs"

import { buildDocsIndex } from "../src/lib/docs-index"

const REPO_ROOT = join(import.meta.dir, "../../..")
const DOCS_DIR = join(import.meta.dir, "../src/content/docs")
const CORE_PACKAGE = join(import.meta.dir, "../../core")
const TEST_DIR = "/tmp/opentui-doc-verify"
const VENDORED_CORE_PACKAGE = join(TEST_DIR, "vendor-core")

interface PackageJson {
  name?: string
  version?: string
  type?: string
  main?: string
  module?: string
  types?: string
  exports?: unknown
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface CodeBlock {
  code: string
  language: string
  lineNumber: number
  file: string
}

interface Issue {
  type: "error" | "warning"
  message: string
}

interface VerificationResult {
  file: string
  lineNumber: number
  issues: Issue[]
  codePreview: string
}

// Extract code blocks from MDX content
function extractCodeBlocks(content: string, file: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let currentBlock:
    | { file: string; language: string; lineNumber: number; lines: string[]; fenceLength: number }
    | undefined

  for (const [index, line] of content.replace(/\r\n/g, "\n").split("\n").entries()) {
    const trimmed = line.trim()

    if (!currentBlock) {
      const openMatch = trimmed.match(/^(`{3,})(typescript|ts|javascript|js|tsx|jsx)\s*$/)
      if (!openMatch) {
        continue
      }

      currentBlock = {
        file,
        language: openMatch[2],
        lineNumber: index + 2,
        lines: [],
        fenceLength: openMatch[1].length,
      }
      continue
    }

    if (/^`+\s*$/.test(trimmed) && trimmed.length >= currentBlock.fenceLength) {
      blocks.push({
        code: currentBlock.lines.join("\n"),
        file: currentBlock.file,
        language: currentBlock.language,
        lineNumber: currentBlock.lineNumber,
      })
      currentBlock = undefined
      continue
    }

    currentBlock.lines.push(line)
  }

  return blocks
}

// Check if a code block is a complete example (has imports) vs a fragment
function isCompleteExample(code: string): boolean {
  return code.includes("import ") && code.includes("from ")
}

// Check if code block is just showing object properties (not runnable code)
function isPropertyFragment(code: string): boolean {
  const trimmed = code.trim()
  // Matches things like: { borderStyle: "single" }
  return trimmed.startsWith("{") && !trimmed.includes("const ") && !trimmed.includes("function ")
}

// Check if code contains JSX syntax
function hasJSX(code: string): boolean {
  return /(^|[\s(=,:])<[A-Za-z][\w-]*(\s|\/?>)/m.test(code) || /<\/[A-Za-z][\w-]*>/.test(code)
}

// Wrap a code block to make it type-checkable
function wrapCodeForTypeCheck(code: string, blockIndex: number): string {
  // Skip property-only fragments
  if (isPropertyFragment(code)) {
    return ""
  }

  // Skip JSX - would need separate handling with tsx
  if (hasJSX(code)) {
    return ""
  }

  const { importStatements, bodyLines } = splitImportsAndBody(code)
  const importedModules = importStatements.map(getImportModule).filter((value): value is string => Boolean(value))

  // Skip fragments without imports - they're incomplete by design
  if (importStatements.length === 0 || importedModules.length === 0 || !isCompleteExample(code)) {
    return ""
  }

  if (importedModules.some((module) => !module.startsWith("@opentui/core"))) {
    return ""
  }

  const body = bodyLines.join("\n")

  if (!hasExecutableStatements(body) || isPreexistingTargetFragment(body)) {
    return ""
  }

  if (hasUndeclaredReceiverCalls(importStatements, body)) {
    return ""
  }

  // Add renderer declaration if body uses it but doesn't define it
  const usesRenderer =
    body.includes("renderer.") || body.includes("renderer,") || body.includes("renderer)") || body.includes("(renderer")
  const definesRenderer = body.includes("const renderer") || body.includes("let renderer")

  let preamble = importStatements.join("\n")

  if (usesRenderer && !definesRenderer) {
    // Add renderer declaration and createCliRenderer import if not already imported
    if (!preamble.includes("createCliRenderer")) {
      preamble = `import { createCliRenderer } from "@opentui/core"\n` + preamble
    }
    preamble += `\ndeclare const renderer: Awaited<ReturnType<typeof createCliRenderer>>\n`
  }

  // Wrap body in async function if it uses await
  if (body.includes("await ")) {
    return `${preamble}\n\nasync function __example${blockIndex}() {\n${body}\n}\n`
  }

  return preamble + "\n" + body
}

function splitImportsAndBody(code: string): { importStatements: string[]; bodyLines: string[] } {
  const importStatements: string[] = []
  const bodyLines: string[] = []
  let currentImport: string[] | undefined
  let readingImports = true

  for (const line of code.split("\n")) {
    const trimmed = line.trim()

    if (!readingImports) {
      bodyLines.push(line)
      continue
    }

    if (currentImport) {
      currentImport.push(line)
      if (isImportStatementComplete(currentImport.join("\n"))) {
        importStatements.push(currentImport.join("\n"))
        currentImport = undefined
      }
      continue
    }

    if (!trimmed) {
      continue
    }

    if (trimmed.startsWith("import ")) {
      currentImport = [line]
      if (isImportStatementComplete(trimmed)) {
        importStatements.push(trimmed)
        currentImport = undefined
      }
      continue
    }

    readingImports = false
    bodyLines.push(line)
  }

  if (currentImport) {
    bodyLines.unshift(...currentImport)
  }

  return { importStatements, bodyLines }
}

function isImportStatementComplete(statement: string): boolean {
  return (
    /^import\s+["'][^"']+["'](?:\s+with\s+\{[\s\S]*\})?\s*$/s.test(statement) ||
    /\bfrom\s+["'][^"']+["'](?:\s+with\s+\{[\s\S]*\})?\s*$/s.test(statement)
  )
}

function getImportModule(statement: string): string | undefined {
  const sideEffectMatch = statement.match(/^import\s+["']([^"']+)["']/s)
  if (sideEffectMatch) {
    return sideEffectMatch[1]
  }

  const fromMatch = statement.match(/\bfrom\s+["']([^"']+)["']/s)
  return fromMatch?.[1]
}

function hasExecutableStatements(body: string): boolean {
  return body
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line.length > 0 && !line.startsWith("//"))
}

function isPreexistingTargetFragment(body: string): boolean {
  const firstExecutableLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//"))

  if (!firstExecutableLine) {
    return true
  }

  return /^[A-Za-z_$][\w$]*\./.test(firstExecutableLine)
}

function hasUndeclaredReceiverCalls(importStatements: string[], body: string): boolean {
  const allowedReceivers = new Set<string>([
    ...collectImportedBindings(importStatements),
    ...collectDeclaredBindings(body),
    "Array",
    "Bun",
    "JSON",
    "Math",
    "Number",
    "Object",
    "Promise",
    "String",
    "console",
    "process",
  ])

  const receiverPattern = /\b([A-Za-z_$][\w$]*)\./g
  let match: RegExpExecArray | null

  while ((match = receiverPattern.exec(body)) !== null) {
    if (!allowedReceivers.has(match[1])) {
      return true
    }
  }

  return false
}

function collectImportedBindings(importStatements: string[]): string[] {
  const bindings: string[] = []

  for (const statement of importStatements) {
    const namedMatch = statement.match(/\{([\s\S]*?)\}/)
    if (namedMatch) {
      for (const part of namedMatch[1].split(",")) {
        const binding = part
          .replace(/\btype\b/g, "")
          .split(" as ")[0]
          ?.trim()
        if (binding) {
          bindings.push(binding)
        }
      }
    }

    const defaultMatch = statement.match(/^import\s+([A-Za-z_$][\w$]*)\s*(,|from)/)
    if (defaultMatch) {
      bindings.push(defaultMatch[1])
    }
  }

  return bindings
}

function collectDeclaredBindings(body: string): string[] {
  const bindings = new Set<string>()
  const declarationPattern = /\b(?:const|let|var|class|function|interface|type)\s+([A-Za-z_$][\w$]*)/g
  let match: RegExpExecArray | null

  while ((match = declarationPattern.exec(body)) !== null) {
    bindings.add(match[1])
  }

  return [...bindings]
}

// Setup the test environment
async function setupTestEnv(): Promise<boolean> {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true })
  }
  await mkdir(TEST_DIR, { recursive: true })

  if (!existsSync(CORE_PACKAGE)) {
    console.error(`ERROR: ${CORE_PACKAGE} not found.`)
    return false
  }

  const corePackageJsonPath = join(CORE_PACKAGE, "package.json")
  const corePackageJson = JSON.parse(await readFile(corePackageJsonPath, "utf8")) as PackageJson

  await mkdir(VENDORED_CORE_PACKAGE, { recursive: true })
  await cp(join(CORE_PACKAGE, "src"), join(VENDORED_CORE_PACKAGE, "src"), { recursive: true })
  await writeFile(
    join(VENDORED_CORE_PACKAGE, "package.json"),
    JSON.stringify(
      {
        name: corePackageJson.name ?? "@opentui/core",
        version: corePackageJson.version ?? "0.0.0",
        type: corePackageJson.type ?? "module",
        main: corePackageJson.main ?? "src/index.ts",
        module: corePackageJson.module ?? "src/index.ts",
        types: corePackageJson.types ?? "src/index.ts",
        exports: corePackageJson.exports,
        dependencies: corePackageJson.dependencies,
        optionalDependencies: corePackageJson.optionalDependencies,
        peerDependencies: corePackageJson.peerDependencies,
      },
      null,
      2,
    ),
  )

  // Create package.json for the verifier sandbox.
  await writeFile(
    join(TEST_DIR, "package.json"),
    JSON.stringify({
      name: "doc-verify",
      type: "module",
      dependencies: {
        "@opentui/core": `file:${VENDORED_CORE_PACKAGE}`,
      },
    }),
  )

  // Create tsconfig.json
  await writeFile(
    join(TEST_DIR, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noEmit: true,
        jsx: "preserve",
        types: ["bun-types"],
      },
      include: ["*.ts", "*.tsx"],
    }),
  )

  // Install dependencies
  const install = Bun.spawnSync(["bun", "install", "--production"], {
    cwd: TEST_DIR,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (install.exitCode !== 0) {
    console.error("Failed to install dependencies:", install.stderr.toString())
    return false
  }

  return true
}

// Type-check a code block
async function typeCheckBlock(block: CodeBlock, blockIndex: number): Promise<Issue[]> {
  const issues: Issue[] = []

  const wrappedCode = wrapCodeForTypeCheck(block.code, blockIndex)
  if (!wrappedCode) {
    return issues // Skip fragments that can't be checked
  }

  const testFile = join(TEST_DIR, `example-${blockIndex}.ts`)
  await writeFile(testFile, wrappedCode)

  // Run tsc on this specific file
  const result = Bun.spawnSync(["bunx", "tsc", "--noEmit", "--skipLibCheck", testFile], {
    cwd: TEST_DIR,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (result.exitCode !== 0) {
    const output = result.stdout.toString() + result.stderr.toString()

    // Parse errors, filter out noise
    const lines = output.split("\n")
    for (const line of lines) {
      // Match TypeScript errors like: example-0.ts(5,3): error TS2304: Cannot find name 'foo'.
      const match = line.match(/example-\d+\.ts\(\d+,\d+\): error TS\d+: (.+)/)
      if (match) {
        const msg = match[1]
        // Skip some noise errors
        if (msg.includes("Cannot find module './assets/")) continue
        if (msg.includes("@ts-expect-error")) continue

        issues.push({
          type: "error",
          message: msg,
        })
      }
    }
  }

  return issues
}

// Process a single MDX file
async function processFile(filePath: string, sourcePath: string): Promise<VerificationResult[]> {
  const content = await readFile(filePath, "utf-8")
  const blocks = extractCodeBlocks(content, sourcePath)
  const results: VerificationResult[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const issues = await typeCheckBlock(block, i)

    if (issues.length > 0) {
      results.push({
        file: sourcePath,
        lineNumber: block.lineNumber,
        issues,
        codePreview: block.code.split("\n")[0].substring(0, 60),
      })
    }
  }

  return results
}

async function main() {
  const pattern = process.argv[2]
  const index = await buildDocsIndex()
  const matchedSourcePaths = pattern ? collectMatchedSourcePaths(pattern) : undefined
  const pages = index.skillPages.filter((page) => !matchedSourcePaths || matchedSourcePaths.has(page.sourcePath))

  console.log(`Verifying documentation examples in: ${DOCS_DIR}`)
  console.log(`Scope: ${pattern ? `skill docs matching ${pattern}` : "all skill-included docs"}\n`)

  if (pages.length === 0) {
    console.error("No matching docs found.")
    process.exit(1)
  }

  // Setup test environment
  console.log("Setting up test environment...")
  const setupOk = await setupTestEnv()
  if (!setupOk) {
    process.exit(1)
  }
  console.log("Test environment ready.\n")

  console.log(`Found ${pages.length} MDX files to verify\n`)

  let totalErrors = 0
  let filesWithIssues = 0
  const allResults: VerificationResult[] = []

  for (const page of pages) {
    const absolutePath = join(REPO_ROOT, page.sourcePath)
    process.stdout.write(`Checking ${page.sourcePath}...`)

    const results = await processFile(absolutePath, page.sourcePath)
    allResults.push(...results)

    if (results.length > 0) {
      filesWithIssues++
      console.log(` ${results.reduce((sum, r) => sum + r.issues.length, 0)} issues`)
    } else {
      console.log(" OK")
    }
  }

  // Print detailed results
  if (allResults.length > 0) {
    console.log("\n" + "=".repeat(60))
    console.log("ISSUES FOUND:")
    console.log("=".repeat(60))

    // Group by file
    const byFile = new Map<string, VerificationResult[]>()
    for (const result of allResults) {
      if (!byFile.has(result.file)) {
        byFile.set(result.file, [])
      }
      byFile.get(result.file)!.push(result)
    }

    for (const [file, results] of byFile) {
      console.log(`\n${file}:`)
      for (const result of results) {
        console.log(`  Line ${result.lineNumber}: ${result.codePreview}...`)
        for (const issue of result.issues) {
          console.log(`    - ${issue.message}`)
          totalErrors++
        }
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`Summary:`)
  console.log(`  Files checked: ${pages.length}`)
  console.log(`  Files with issues: ${filesWithIssues}`)
  console.log(`  Total errors: ${totalErrors}`)

  // Cleanup
  await rm(TEST_DIR, { recursive: true })

  process.exit(totalErrors > 0 ? 1 : 0)
}

function collectMatchedSourcePaths(pattern: string): Set<string> {
  const matched = new Set<string>()

  for (const file of new Bun.Glob(pattern).scanSync({ cwd: DOCS_DIR, absolute: false })) {
    matched.add(`packages/web/src/content/docs/${normalizePath(file)}`)
  }

  for (const file of new Bun.Glob(pattern).scanSync({ cwd: REPO_ROOT, absolute: false })) {
    matched.add(normalizePath(file))
  }

  return matched
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
