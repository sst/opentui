import type { WriteFileOptions } from "node:fs"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { isArrayBufferView } from "node:util/types"

/**
 * ```bash
 * rg 'Bun\.(\w+)' -r ' | "$1"'  -o -N -I | sort | uniq | pbcopy
 * ```
 */
type UsedBunApis =
  | "argv"
  | "build"
  | "file"
  | "Glob"
  | "serve"
  | "sleep"
  | "spawn"
  | "spawnSync"
  | "stringWidth"
  | "stripANSI"
  | "write"

type NodeBunInterface = Pick<typeof Bun, UsedBunApis>

type BunFile = Bun.BunFile
type BunWrite = typeof Bun.write
type BunFileLike = { name: string | undefined }
type BunPathLike = string | NodeJS.TypedArray | ArrayBufferLike | URL

class NodeBunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NodeBunError"
  }
}

class NodeBun implements NodeBunInterface {
  get argv(): string[] {
    return process.argv
  }

  sleep(msOrDate: number | Date): Promise<void> {
    let ms: number
    if (msOrDate instanceof Date) {
      ms = msOrDate.getTime() - Date.now()
    } else {
      ms = msOrDate
    }
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  stringWidth(text: string): number {
    const stringWidth = require("string-width")
    return stringWidth(text)
  }

  stripANSI(text: string): string {
    const stripANSI = require("strip-ansi")
    return stripANSI(text)
  }

  write: typeof Bun.write = (destination, data, options): Promise<number> => {
    let dest: string | URL
    if (typeof destination === "string") {
      dest = destination
    } else if (destination instanceof URL) {
      dest = destination
    } else if ("name" in destination && destination.name !== undefined) {
      dest = destination.name
    } else {
      // ArrayBuffer, NodeJS.TypedArray, etc.
      throw new NodeBunError("Bun.write: Unsupported destination type")
    }

    let buffer: Uint8Array
    if (typeof data === "string") {
      buffer = new TextEncoder().encode(data)
    } else if (isArrayBufferView(data)) {
      buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    } else {
      throw new NodeBunError("Bun.write: Unsupported data type")
    }

    const nodeOptions: WriteFileOptions = {}
    if (typeof buffer === "string") {
      nodeOptions.encoding = "utf-8"
    }
    if (options && "mode" in options && options?.mode !== undefined) {
      nodeOptions.mode = options.mode
    }
    if (options && "createPath" in options && options?.createPath) {
      const destPath = typeof dest === "string" ? dest : dest.pathname
      fs.mkdir(path.dirname(destPath), { recursive: true })
    }

    return fs.writeFile(dest, buffer, nodeOptions).then(() => buffer.length)
  }

  // Unsupported
  get Glob(): typeof Bun.Glob {
    throw new NodeBunError("Bun.Glob is not supported in Node.js")
  }

  get spawn(): typeof Bun.spawn {
    throw new NodeBunError("Bun.spawn is not supported in Node.js")
  }

  get spawnSync(): typeof Bun.spawnSync {
    throw new NodeBunError("Bun.spawnSync is not supported in Node.js")
  }

  get build(): typeof Bun.build {
    throw new NodeBunError("Bun.build is not supported in Node.js")
  }

  get file(): typeof Bun.file {
    throw new NodeBunError("Bun.file is not supported in Node.js")
  }

  get serve(): typeof Bun.serve {
    throw new NodeBunError("Bun.serve is not supported in Node.js")
  }
}

export default new NodeBun()
