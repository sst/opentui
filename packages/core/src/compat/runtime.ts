export interface WriteFileOptions {
  createPath?: boolean
  mode?: number
}

type RuntimeModule = {
  sleep: (msOrDate: number | Date) => Promise<void>
  stringWidth: (text: string) => number
  stripANSI: (text: string) => string
  writeFile: (destination: string | URL, data: string | ArrayBufferView, options?: WriteFileOptions) => Promise<number>
}

const runtime: RuntimeModule = process.versions.bun
  ? {
      sleep: Bun.sleep,
      stringWidth: Bun.stringWidth,
      stripANSI: Bun.stripANSI,
      writeFile: Bun.write as RuntimeModule["writeFile"],
    }
  : await import("./nodejs/runtime.js")

export const sleep = runtime.sleep
export const stringWidth = runtime.stringWidth
export const stripANSI = runtime.stripANSI
export const writeFile = runtime.writeFile
