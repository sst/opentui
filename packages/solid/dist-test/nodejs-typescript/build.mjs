import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { transformAsync } from "@babel/core"
import ts from "@babel/preset-typescript"
import solid from "babel-preset-solid"

const rootDir = dirname(fileURLToPath(import.meta.url))
const inputPath = join(rootDir, "index.tsx")
const outputDir = join(rootDir, "dist")
const outputPath = join(outputDir, "index.js")

const input = readFileSync(inputPath, "utf8")
const transformed = await transformAsync(input, {
  filename: inputPath,
  configFile: false,
  babelrc: false,
  presets: [
    [
      solid,
      {
        moduleName: "@opentui/solid",
        generate: "universal",
      },
    ],
    [ts],
  ],
})

if (!transformed?.code) {
  throw new Error(`Failed to transform ${inputPath}`)
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, transformed.code)
