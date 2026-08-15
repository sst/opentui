#!/usr/bin/env bun

import { promises as fs } from "node:fs"
import { basename, resolve } from "node:path"
import { githubRepository, packageEntrySchema, type PackageEntry } from "../src/lib/package-schema"

type EntryFile = { entry: PackageEntry; path: string }

async function main() {
  const network = process.argv.includes("--network")
  const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--network")
  if (arguments_.length !== 1) fail("Usage: bun scripts/validate-packages.ts <entries-directory> [--network]")

  const localDirectory = resolve(import.meta.dir, "../src/content/packages")
  const targetDirectory = resolve(arguments_[0])
  const directories = [...new Set([localDirectory, targetDirectory])]
  const violations: string[] = []
  const files = (
    await Promise.all(
      directories.map((directory) =>
        readDirectory(directory, directory === localDirectory || targetDirectory === localDirectory),
      ),
    )
  ).flat()
  const entries = (await Promise.all(files.map((path) => parseEntry(path, violations)))).flat()
  const pathsById = new Map<string, string>()

  for (const { entry, path } of entries) {
    const previous = pathsById.get(entry.id)
    if (previous) violations.push(`duplicate id \`${entry.id}\`: ${previous}, ${path}`)
    else pathsById.set(entry.id, path)
  }

  if (network) await validateNetwork(entries, violations)

  if (violations.length) {
    console.error("Package validation failed:\n")
    for (const violation of violations.toSorted()) console.error(`- ${violation}`)
    process.exit(1)
  }

  console.log(`Package validation passed for ${entries.length} entries${network ? " with network checks" : ""}.`)
}

async function readDirectory(directory: string, allowMissing: boolean): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mdx"))
    .map((entry) => resolve(directory, entry.name))
    .toSorted()
}

async function parseEntry(path: string, violations: string[]): Promise<EntryFile[]> {
  const filename = basename(path, ".mdx")
  try {
    const contents = await Bun.file(path).text()
    const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!match) throw new Error("missing YAML frontmatter")
    const result = packageEntrySchema.safeParse(Bun.YAML.parse(match[1]))
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path.length ? `${issue.path.join(".")}: ` : ""
        violations.push(`${path}: ${field}${issue.message}`)
      }
      return []
    }
    if (result.data.id !== filename) violations.push(`${path}: frontmatter id must match filename \`${filename}\``)
    return [{ entry: result.data, path }]
  } catch (error) {
    violations.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

async function validateNetwork(entries: EntryFile[], violations: string[]) {
  const checks = new Map<string, { label: string; url: string }>()
  for (const { entry, path } of entries) {
    const repository = githubRepository(entry.source.url)
    const repositoryUrl = repository
      ? `https://api.github.com/repos/${repository}`
      : entry.source.url.replace(/\.git$/, "")
    checks.set(`repo:${repositoryUrl}`, { label: `${path}: source repository`, url: repositoryUrl })

    for (const distribution of entry.distributions) {
      if (distribution.type === "npm" && distribution.identifier) {
        checks.set(`npm:${distribution.identifier}`, {
          label: `${path}: npm package \`${distribution.identifier}\``,
          url: `https://registry.npmjs.org/${encodeURIComponent(distribution.identifier)}`,
        })
      }
      if (distribution.type === "github-release" && distribution.identifier) {
        checks.set(`release:${distribution.identifier}`, {
          label: `${path}: GitHub repository \`${distribution.identifier}\``,
          url: `https://api.github.com/repos/${distribution.identifier.replace(/\.git$/, "")}`,
        })
      }
    }
  }

  await Promise.all(
    [...checks.values()].map(async ({ label, url }) => {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "opentui-package-validator" },
        })
        if (!response.ok) violations.push(`${label} does not exist (${response.status})`)
      } catch (error) {
        violations.push(`${label} check failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
  )
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
