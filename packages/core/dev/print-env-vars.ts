#!/usr/bin/env bun

/**
 * Development script to print all registered environment variables
 *
 * Usage:
 *   bun dev/print-env-vars.ts          # Colored output (default)
 *   bun dev/print-env-vars.ts --markdown  # Markdown output
 *   bun dev/print-env-vars.ts --update   # Update docs/env-vars.md
 */

import { generateEnvColored, generateEnvMarkdown } from "../src/index"
import { join } from "path"

const args = process.argv.slice(2)
const useMarkdown = args.includes("--markdown")
const updateDocs = args.includes("--update")

const generateMarkdownContent = () => {
  return `# Environment Variables\n\n${generateEnvMarkdown()}---\n\n_generated via packages/core/dev/print-env-vars.ts_\n`
}

if (updateDocs) {
  const docsPath = join(import.meta.dir, "../docs/env-vars.md")
  const content = generateMarkdownContent()
  await Bun.write(docsPath, content)
  console.log(`✓ Updated ${docsPath}`)
} else if (useMarkdown) {
  console.log(`${generateEnvMarkdown()}\n---\n_generated via packages/core/dev/print-env-vars.ts_`)
} else {
  console.log(generateEnvColored())
}
