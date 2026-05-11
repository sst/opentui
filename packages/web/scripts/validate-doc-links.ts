#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { buildDocsIndex } from "../src/lib/docs-index"

interface HeadingInfo {
  anchor: string
  lineNumber: number
}

interface LinkInfo {
  target: string
  lineNumber: number
}

const REPO_ROOT = join(import.meta.dir, "../../..")

async function main() {
  try {
    const index = await buildDocsIndex()
    const anchorsBySlug = new Map<string, Set<string>>()
    const violations: string[] = []

    for (const page of index.pages) {
      const content = await readFile(join(REPO_ROOT, page.sourcePath), "utf8")
      const headings = collectHeadings(content)
      anchorsBySlug.set(page.slug, new Set(headings.map((heading) => heading.anchor)))
    }

    for (const page of index.pages) {
      const content = await readFile(join(REPO_ROOT, page.sourcePath), "utf8")

      for (const link of collectLinks(content)) {
        const target = link.target.trim()

        if (isExternalLink(target)) {
          continue
        }

        if (target.startsWith("packages/web/src/content/docs/")) {
          violations.push(
            `${page.sourcePath}:${link.lineNumber}: use /docs/... URLs instead of repo file paths (${target})`,
          )
          continue
        }

        if (page.skill.include && isRelativeDocLink(target)) {
          violations.push(`${page.sourcePath}:${link.lineNumber}: use /docs/... URLs for cross-doc links (${target})`)
          continue
        }

        if (target.startsWith("#")) {
          const anchor = normalizeAnchor(target.slice(1))
          const anchors = anchorsBySlug.get(page.slug) ?? new Set<string>()
          if (!anchors.has(anchor)) {
            violations.push(`${page.sourcePath}:${link.lineNumber}: unresolved local anchor #${anchor}`)
          }
          continue
        }

        if (!target.startsWith("/docs/")) {
          continue
        }

        const { slug, anchor } = normalizeDocTarget(target)
        const linkedPage = index.pagesBySlug[slug]
        if (!linkedPage) {
          violations.push(`${page.sourcePath}:${link.lineNumber}: unresolved doc link ${target}`)
          continue
        }

        if (!anchor) {
          continue
        }

        const anchors = anchorsBySlug.get(slug) ?? new Set<string>()
        if (!anchors.has(anchor)) {
          violations.push(`${page.sourcePath}:${link.lineNumber}: unresolved doc anchor ${target}`)
        }
      }
    }

    if (violations.length > 0) {
      console.error("Link validation failed:\n")
      for (const violation of violations.sort()) {
        console.error(`- ${violation}`)
      }
      process.exit(1)
    }

    console.log(`Link validation passed for ${index.pages.length} docs.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function collectHeadings(content: string): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  const anchorCounts = new Map<string, number>()
  let fence: { marker: string; length: number } | undefined

  for (const [index, line] of content.replace(/\r\n/g, "\n").split("\n").entries()) {
    const trimmed = line.trim()
    const fenceMarker = getFenceMarker(trimmed)

    if (!fence && fenceMarker) {
      fence = fenceMarker
      continue
    }

    if (fence && closesFence(trimmed, fence)) {
      fence = undefined
      continue
    }

    if (fence) {
      continue
    }

    const match = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (!match) {
      continue
    }

    const baseAnchor = slugifyHeading(match[2])
    if (!baseAnchor) {
      continue
    }

    const duplicateIndex = anchorCounts.get(baseAnchor) ?? 0
    anchorCounts.set(baseAnchor, duplicateIndex + 1)

    headings.push({
      anchor: duplicateIndex === 0 ? baseAnchor : `${baseAnchor}-${duplicateIndex}`,
      lineNumber: index + 1,
    })
  }

  return headings
}

function collectLinks(content: string): LinkInfo[] {
  const links: LinkInfo[] = []
  let fence: { marker: string; length: number } | undefined

  for (const [index, line] of content.replace(/\r\n/g, "\n").split("\n").entries()) {
    const trimmed = line.trim()
    const fenceMarker = getFenceMarker(trimmed)

    if (!fence && fenceMarker) {
      fence = fenceMarker
      continue
    }

    if (fence && closesFence(trimmed, fence)) {
      fence = undefined
      continue
    }

    if (fence) {
      continue
    }

    const linkPattern = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
    let match: RegExpExecArray | null
    while ((match = linkPattern.exec(line)) !== null) {
      links.push({ target: match[1], lineNumber: index + 1 })
    }
  }

  return links
}

function slugifyHeading(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/[*_~]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

function getFenceMarker(line: string): { marker: string; length: number } | undefined {
  const match = line.match(/^(`{3,}|~{3,})/)
  if (!match) {
    return undefined
  }

  return { marker: match[1][0], length: match[1].length }
}

function closesFence(line: string, fence: { marker: string; length: number }): boolean {
  const pattern = new RegExp(`^${fence.marker}{${fence.length},}\\s*$`)
  return pattern.test(line)
}

function isExternalLink(target: string): boolean {
  return /^(https?:\/\/|mailto:)/.test(target)
}

function isRelativeDocLink(target: string): boolean {
  return target.startsWith("./") || target.startsWith("../") || target.endsWith(".md") || target.endsWith(".mdx")
}

function normalizeDocTarget(target: string): { slug: string; anchor?: string } {
  const [pathPart, anchorPart] = target.split("#", 2)
  const normalizedPath = pathPart.endsWith("/") ? pathPart.slice(0, -1) : pathPart
  const slug = normalizedPath.replace(/^\/docs\//, "")

  return {
    slug,
    anchor: anchorPart ? normalizeAnchor(anchorPart) : undefined,
  }
}

function normalizeAnchor(anchor: string): string {
  return decodeURIComponent(anchor).trim().toLowerCase()
}

main()
