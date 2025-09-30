#!/usr/bin/env bun
import sveltePlugin from "./svelte-plugin"
import { dirname } from "path"

const [input] = process.argv.slice(2)
if (!input) {
  console.error("Usage: bun compile-one.ts <file.svelte>")
  process.exit(1)
}

const result = await Bun.build({
  entrypoints: [input],
  outdir: dirname(input),
  target: "bun",
  packages: "external",
  plugins: [sveltePlugin],
})

if (!result.success) {
  result.logs.forEach(console.error)
  process.exit(1)
}
