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

import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { join, relative } from "node:path"
import { existsSync } from "node:fs"

const DOCS_DIR = join(import.meta.dir, "../src/content/docs")
const CORE_PACKAGE = join(import.meta.dir, "../../core")
const CORE_DIST = join(CORE_PACKAGE, "dist")
const TEST_DIR = "/tmp/opentui-doc-verify"

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
  const codeBlockRegex = /```(typescript|ts|javascript|js|tsx|jsx)\n([\s\S]*?)```/g

  let match
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const lineNumber = content.substring(0, match.index).split("\n").length
    blocks.push({
      code: match[2],
      language: match[1],
      lineNumber,
      file,
    })
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
  // Look for JSX patterns: <Component />, <Component>, </Component>
  return /<[A-Z][a-zA-Z]*[\s/>]/.test(code) || /<\/[A-Z][a-zA-Z]*>/.test(code)
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

  // Skip fragments without imports - they're incomplete by design
  if (!isCompleteExample(code)) {
    return ""
  }

  // Split into imports and body
  const lines = code.split("\n")
  const importLines: string[] = []
  const bodyLines: string[] = []

  let pastImports = false
  for (const line of lines) {
    if (!pastImports && (line.trim().startsWith("import ") || line.trim() === "")) {
      importLines.push(line)
    } else {
      pastImports = true
      bodyLines.push(line)
    }
  }

  const body = bodyLines.join("\n")

  // Add renderer declaration if body uses it but doesn't define it
  const usesRenderer = body.includes("renderer.") || body.includes("renderer,") || body.includes("renderer)")
  const definesRenderer = body.includes("const renderer") || body.includes("let renderer")

  let preamble = importLines.join("\n")

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

// Setup the test environment
async function setupTestEnv(): Promise<boolean> {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true })
  }
  await mkdir(TEST_DIR, { recursive: true })

  // Check that dist exists
  if (!existsSync(CORE_DIST)) {
    console.error(`ERROR: ${CORE_DIST} not found. Run 'bun run build' in packages/core first.`)
    return false
  }

  // Create package.json - use dist for proper type declarations
  await writeFile(
    join(TEST_DIR, "package.json"),
    JSON.stringify({
      name: "doc-verify",
      type: "module",
      dependencies: {
        "@opentui/core": `file:${CORE_DIST}`,
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
        types: ["bun-types"],
      },
      include: ["*.ts"],
    }),
  )

  // Install dependencies
  const install = Bun.spawnSync(["bun", "install"], {
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
async function processFile(filePath: string): Promise<VerificationResult[]> {
  const content = await readFile(filePath, "utf-8")
  const blocks = extractCodeBlocks(content, filePath)
  const results: VerificationResult[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const issues = await typeCheckBlock(block, i)

    if (issues.length > 0) {
      results.push({
        file: filePath,
        lineNumber: block.lineNumber,
        issues,
        codePreview: block.code.split("\n")[0].substring(0, 60),
      })
    }
  }

  return results
}

async function main() {
  const pattern = process.argv[2] || "**/*.mdx"

  console.log(`Verifying documentation examples in: ${DOCS_DIR}`)
  console.log(`Pattern: ${pattern}\n`)

  // Setup test environment
  console.log("Setting up test environment...")
  const setupOk = await setupTestEnv()
  if (!setupOk) {
    process.exit(1)
  }
  console.log("Test environment ready.\n")

  // Find MDX files
  const globber = new Bun.Glob(pattern)
  const files = [...globber.scanSync({ cwd: DOCS_DIR, absolute: true })]

  console.log(`Found ${files.length} MDX files to verify\n`)

  let totalErrors = 0
  let filesWithIssues = 0
  const allResults: VerificationResult[] = []

  for (const file of files) {
    const relPath = relative(DOCS_DIR, file)
    process.stdout.write(`Checking ${relPath}...`)

    const results = await processFile(file)
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
      const relPath = relative(DOCS_DIR, result.file)
      if (!byFile.has(relPath)) {
        byFile.set(relPath, [])
      }
      byFile.get(relPath)!.push(result)
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
  console.log(`  Files checked: ${files.length}`)
  console.log(`  Files with issues: ${filesWithIssues}`)
  console.log(`  Total errors: ${totalErrors}`)

  // Cleanup
  await rm(TEST_DIR, { recursive: true })

  process.exit(totalErrors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
