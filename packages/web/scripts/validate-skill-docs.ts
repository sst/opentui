#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { buildDocsIndex } from "../src/lib/docs-index"

interface CodeLine {
  lineNumber: number
  text: string
}

interface CodeFence {
  disabledRules: Set<string>
  language: string
  lines: CodeLine[]
}

interface Violation {
  rule: string
  sourcePath: string
  lineNumber: number
  message: string
}

const REPO_ROOT = join(import.meta.dir, "../../..")
const SHELL_LANGUAGES = new Set(["bash", "console", "shell", "sh", "zsh"])

async function main() {
  try {
    const index = await buildDocsIndex()
    const violations: Violation[] = []

    for (const page of index.skillPages) {
      const content = await readFile(join(REPO_ROOT, page.sourcePath), "utf8")
      violations.push(...validateSkillDoc(page.sourcePath, content))
    }

    if (violations.length > 0) {
      console.error("Skill doc validation failed:\n")
      for (const violation of violations.sort(compareViolations)) {
        console.error(`- [${violation.rule}] ${violation.sourcePath}:${violation.lineNumber}: ${violation.message}`)
      }
      process.exit(1)
    }

    console.log(`Skill doc validation passed for ${index.skillPages.length} docs.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function validateSkillDoc(sourcePath: string, content: string): Violation[] {
  const violations: Violation[] = []
  const pendingDisables: string[] = []

  let fence: { marker: string; length: number; data: CodeFence } | undefined

  for (const [index, line] of content.replace(/\r\n/g, "\n").split("\n").entries()) {
    const lineNumber = index + 1
    const trimmed = line.trim()
    const disableMatch = trimmed.match(/^<!--\s*docs-lint-disable\s+([a-z0-9-]+)\s*-->$/)

    if (disableMatch) {
      pendingDisables.push(disableMatch[1])
      continue
    }

    const fenceMarker = getFenceMarker(trimmed)
    if (!fence && fenceMarker) {
      fence = {
        marker: fenceMarker.marker,
        length: fenceMarker.length,
        data: {
          disabledRules: new Set(pendingDisables.splice(0)),
          language: getFenceLanguage(trimmed),
          lines: [],
        },
      }
      continue
    }

    if (fence && closesFence(trimmed, fence)) {
      violations.push(...validateCodeFence(sourcePath, fence.data))
      fence = undefined
      continue
    }

    if (fence) {
      fence.data.lines.push({ lineNumber, text: line })
      continue
    }

    if (!trimmed) {
      continue
    }

    const disabledRules = new Set(pendingDisables.splice(0))

    if (!disabledRules.has("mdx-esm-import") && /^import\s/.test(trimmed)) {
      violations.push({
        rule: "mdx-esm-import",
        sourcePath,
        lineNumber,
        message: "top-level MDX import statements are not allowed in skill docs",
      })
    }

    if (!disabledRules.has("mdx-esm-export") && /^export\s/.test(trimmed)) {
      violations.push({
        rule: "mdx-esm-export",
        sourcePath,
        lineNumber,
        message: "top-level MDX export statements are not allowed in skill docs",
      })
    }

    if (!disabledRules.has("mdx-component-node") && isProbableMdxNode(trimmed)) {
      violations.push({
        rule: "mdx-component-node",
        sourcePath,
        lineNumber,
        message: "rendered JSX/MDX component nodes are not allowed outside fenced code blocks",
      })
    }
  }

  return violations
}

function validateCodeFence(sourcePath: string, fence: CodeFence): Violation[] {
  const violations: Violation[] = []

  for (const line of fence.lines) {
    if (!fence.disabledRules.has("process-exit-example") && line.text.includes("process.exit(")) {
      violations.push({
        rule: "process-exit-example",
        sourcePath,
        lineNumber: line.lineNumber,
        message: "prefer renderer.destroy() over process.exit() in positive examples",
      })
    }

    if (fence.disabledRules.has("non-bun-setup-command")) {
      continue
    }

    if (!SHELL_LANGUAGES.has(fence.language)) {
      continue
    }

    if (/\bnpm install\b|\byarn(?:\s|$)|\bpnpm(?:\s|$)|\bnode\s+/.test(line.text)) {
      violations.push({
        rule: "non-bun-setup-command",
        sourcePath,
        lineNumber: line.lineNumber,
        message: "use Bun-native setup commands in runnable examples",
      })
    }
  }

  return violations
}

function getFenceMarker(line: string): { marker: string; length: number } | undefined {
  const match = line.match(/^(`{3,}|~{3,})/)
  if (!match) {
    return undefined
  }

  return { marker: match[1][0], length: match[1].length }
}

function getFenceLanguage(line: string): string {
  const match = line.match(/^(`{3,}|~{3,})([^\s]*)/)
  return match?.[2]?.trim().toLowerCase() ?? ""
}

function closesFence(line: string, fence: { marker: string; length: number }): boolean {
  const pattern = new RegExp(`^${fence.marker}{${fence.length},}\\s*$`)
  return pattern.test(line)
}

function isProbableMdxNode(line: string): boolean {
  if (!line.startsWith("<") || line.startsWith("<!--")) {
    return false
  }

  return /^<\/?[A-Za-z][A-Za-z0-9:_-]*(\s|>|\/)/.test(line)
}

function compareViolations(left: Violation, right: Violation): number {
  if (left.sourcePath !== right.sourcePath) {
    return left.sourcePath.localeCompare(right.sourcePath)
  }

  if (left.lineNumber !== right.lineNumber) {
    return left.lineNumber - right.lineNumber
  }

  return left.rule.localeCompare(right.rule)
}

main()
