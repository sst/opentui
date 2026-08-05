#!/usr/bin/env bun

import { readFile } from "node:fs/promises"

const terminalRows = ["▄▄▄ ▄▄▄ ▄▄▄ ▄▄  █▄▄ ▄ ▄ ▄", "█ █ █ █ █ ▀ █ █ █ ▄ █ █ █", "▀▀▀ █▀▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀ ▀"] as const

const halfBlocks: Record<string, readonly [upper: boolean, lower: boolean]> = {
  " ": [false, false],
  "▄": [false, true],
  "▀": [true, false],
  "█": [true, true],
}

const targets = [
  "public/opentui-logo-black.svg",
  "public/opentui-logo-white.svg",
  "public/opentui-logo-spectrum.svg",
  "src/components/OpenTUILogo.astro",
] as const

const expectedViewBox = "0 0 27 6"
const expectedPath = buildPath()
const expectedSpectrumStops = [
  ["0", "#ff6b6b"],
  ["16%", "#ff6b6b"],
  ["16%", "#ffa94d"],
  ["32%", "#ffa94d"],
  ["32%", "#ffe066"],
  ["44%", "#ffe066"],
  ["44%", "#69db7c"],
  ["60%", "#69db7c"],
  ["60%", "#4dabf7"],
  ["72%", "#4dabf7"],
  ["72%", "#748ffc"],
  ["88%", "#748ffc"],
  ["88%", "#da77f2"],
  ["100%", "#da77f2"],
] as const

for (const target of targets) {
  const source = await readFile(new URL(`../${target}`, import.meta.url), "utf8")
  const viewBox = source.match(/<svg\b[^>]*\bviewBox="([^"]+)"/s)?.[1]
  const path = source.match(/<path\b[^>]*\bd="([^"]+)"/s)?.[1]

  if (viewBox !== expectedViewBox) {
    throw new Error(`${target}: expected viewBox="${expectedViewBox}", found ${JSON.stringify(viewBox)}`)
  }
  if (path !== expectedPath) {
    throw new Error(`${target}: path does not match the bitmap decoded from ORIGINAL_LOGO`)
  }
}

for (const target of ["public/opentui-logo-spectrum.svg", "src/components/OpenTUILogo.astro"] as const) {
  const source = await readFile(new URL(`../${target}`, import.meta.url), "utf8")
  const stops = [...source.matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)" \/>/g)].map((match) => [
    match[1],
    match[2]?.toLowerCase(),
  ])

  if (JSON.stringify(stops) !== JSON.stringify(expectedSpectrumStops)) {
    throw new Error(`${target}: spectrum must use the same discrete column colors as the terminal theme`)
  }
}

console.log(`OpenTUI logo geometry and spectrum colors validated across ${targets.length} renditions.`)

function buildPath(): string {
  const widths = terminalRows.map((row) => [...row].length)
  if (widths.some((width) => width !== 25)) {
    throw new Error(`ORIGINAL_LOGO rows must contain 25 source cells, found ${widths.join(", ")}`)
  }

  const commands: string[] = []
  for (const [terminalRow, row] of terminalRows.entries()) {
    for (let half = 0; half < 2; half++) {
      const pixels = [...row].map((character) => {
        const block = halfBlocks[character]
        if (!block) throw new Error(`Unsupported ORIGINAL_LOGO character: ${JSON.stringify(character)}`)
        return block[half]
      })

      for (let x = 0; x < pixels.length; ) {
        if (!pixels[x]) {
          x++
          continue
        }

        const start = x
        while (pixels[x]) x++
        const width = x - start
        commands.push(`M${start + 1} ${terminalRow * 2 + half}h${width}v1h-${width}z`)
      }
    }
  }

  return commands.join("")
}
