#!/usr/bin/env bun

import { buildDocsIndex, DOC_SECTION_CONFIG, type DocPage } from "../src/lib/docs-index"

async function main() {
  try {
    const index = await buildDocsIndex()
    const violations: string[] = []

    for (const page of index.pages) {
      if (!(page.section in DOC_SECTION_CONFIG)) {
        violations.push(`${page.sourcePath}: unknown section \`${page.section}\``)
      }

      if (page.navTitle.trim().length === 0) {
        violations.push(`${page.sourcePath}: navTitle must be non-empty when provided`)
      }

      if (page.skill.entry && !page.skill.include) {
        violations.push(`${page.sourcePath}: skill.entry requires skill.include !== false`)
      }

      if (page.skill.entry && page.skill.intents.length === 0) {
        violations.push(`${page.sourcePath}: skill.entry requires at least one skill intent`)
      }

      const duplicateIntents = findDuplicates(page.skill.intents)
      for (const intent of duplicateIntents) {
        violations.push(`${page.sourcePath}: duplicate skill intent \`${intent}\``)
      }
    }

    addDuplicateKeyViolations(index.pages, (page) => page.slug, "slug", violations)
    addDuplicateKeyViolations(index.pages, (page) => page.url, "url", violations)
    addDuplicateKeyViolations(index.pages, (page) => page.sourcePath, "sourcePath", violations)
    addOrderCollisionViolations(index.pages, violations)

    if (violations.length > 0) {
      console.error("Metadata validation failed:\n")
      for (const violation of violations.sort()) {
        console.error(`- ${violation}`)
      }
      process.exit(1)
    }

    console.log(`Metadata validation passed for ${index.pages.length} docs.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function addDuplicateKeyViolations(
  pages: DocPage[],
  getKey: (page: DocPage) => string,
  label: string,
  violations: string[],
) {
  const grouped = new Map<string, DocPage[]>()

  for (const page of pages) {
    const key = getKey(page)
    grouped.set(key, [...(grouped.get(key) ?? []), page])
  }

  for (const [key, matches] of grouped) {
    if (matches.length < 2) {
      continue
    }

    violations.push(`duplicate ${label} \`${key}\`: ${matches.map((page) => page.sourcePath).join(", ")}`)
  }
}

function addOrderCollisionViolations(pages: DocPage[], violations: string[]) {
  const grouped = new Map<string, DocPage[]>()

  for (const page of pages) {
    if (page.order === undefined) {
      continue
    }

    const key = `${page.section}:${page.order}`
    grouped.set(key, [...(grouped.get(key) ?? []), page])
  }

  for (const [key, matches] of grouped) {
    if (matches.length < 2) {
      continue
    }

    const [section, order] = key.split(":")
    violations.push(
      `order collision in ${section} for order ${order}: ${matches.map((page) => page.sourcePath).join(", ")}`,
    )
  }
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
      continue
    }

    seen.add(value)
  }

  return [...duplicates]
}

main()
