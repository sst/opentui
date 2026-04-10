import { mkdir, writeFile as writeFileNode } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import stringWidthLib from "string-width"
import stripAnsiLib from "strip-ansi"

import type { WriteFileOptions } from "../runtime.js"

export function sleep(msOrDate: number | Date): Promise<void> {
  const ms = msOrDate instanceof Date ? msOrDate.getTime() - Date.now() : msOrDate
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const stringWidth = stringWidthLib
export const stripANSI = stripAnsiLib

export async function writeFile(
  destination: string | URL,
  data: string | ArrayBufferView,
  options?: WriteFileOptions,
): Promise<number> {
  const destinationPath = destination instanceof URL ? fileURLToPath(destination) : destination

  if (options?.createPath) {
    await mkdir(dirname(destinationPath), { recursive: true })
  }

  if (typeof data === "string") {
    await writeFileNode(destination, data, { mode: options?.mode, encoding: "utf8" })
    return new TextEncoder().encode(data).length
  }

  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  await writeFileNode(destination, bytes, { mode: options?.mode })
  return bytes.length
}
