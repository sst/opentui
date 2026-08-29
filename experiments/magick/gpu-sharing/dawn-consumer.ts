import { dlopen } from "bun:ffi"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"

const directory = process.env.WEBGPU_NODE_MODULES
if (!directory) throw new Error("Set WEBGPU_NODE_MODULES to the installed bun-webgpu node_modules directory")
const packagePath = realpathSync(resolve(directory, "bun-webgpu"))
const metadata = await Bun.file(resolve(packagePath, "package.json")).json()
if (metadata.version !== "0.1.7") throw new Error("This ABI experiment requires bun-webgpu 0.1.7")
const library = realpathSync(resolve(packagePath, "../bun-webgpu-linux-x64/libwebgpu_wrapper.so"))
const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(library).arrayBuffer()).digest("hex")
if (hash !== "3190c3777f2c07fcf6a0640833cbf5d0cde859dc53aed6d9083946d093198788") {
  throw new Error("The native binary does not match this experiment's pinned Dawn ABI")
}
const { setupGlobals } = await import(resolve(packagePath, "index.js"))
await setupGlobals({ libPath: library })
const adapter = await navigator.gpu.requestAdapter({
  powerPreference: "high-performance",
  backendType: "Vulkan",
} as any)
if (!adapter) throw new Error("No Vulkan WebGPU adapter")
if (process.argv[2] === "--probe-enums") {
  let error: string | undefined
  try {
    const normal = await adapter.requestDevice({
      requiredFeatures: ["shared-texture-memory-dma-buf", "shared-fence-sync-fd"] as any,
    })
    normal.destroy()
  } catch (cause) {
    error = String(cause)
  }
  if (!error?.includes("Invalid feature required: shared-fence-sync-fd")) {
    throw new Error(`Unexpected enum probe result: ${error}`)
  }
  console.log(JSON.stringify({ status: "confirmed", operation: "GPUAdapter.requestDevice", error }))
  process.exit(0)
}

// These 0.1.7 JS names encode native DmaBuf (0x50022) and SyncFD (0x5002a).
// The C helper checks the actual native feature bits before it imports anything.
const device = await adapter.requestDevice({
  requiredFeatures: ["shared-texture-memory-a-hardware-buffer", "shared-fence-vk-semaphore-opaque-fd"] as any,
})
const bridge = dlopen(resolve(import.meta.dir, ".build/dawn-consumer.so"), {
  dawn_consume: { args: ["ptr", "ptr", "i32", "u32", "u32"], returns: "void" },
})
try {
  const [socket, width, height] = process.argv.slice(2).map(Number)
  if (![socket, width, height].every(Number.isSafeInteger)) throw new Error("Invalid consumer arguments")
  bridge.symbols.dawn_consume((device as any).ptr, (adapter as any).instancePtr, socket!, width!, height!)
} finally {
  device.destroy()
}
// The package owns background tickers. Do not dlclose while its finalizers exist.
process.exit(0)
