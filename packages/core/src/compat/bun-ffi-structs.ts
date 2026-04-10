let mod: typeof import("./nodejs/bun-ffi-structs/index.js")

if (process.versions.bun) {
  mod = (await import("bun-ffi-structs")) as any
} else {
  mod = await import("./nodejs/bun-ffi-structs/index.js")
}

export const defineStruct = mod.defineStruct
export const defineEnum = mod.defineEnum
