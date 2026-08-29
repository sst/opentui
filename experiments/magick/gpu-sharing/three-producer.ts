import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { CString, dlopen } from "bun:ffi"
import { managePixelGpu } from "../../../packages/examples/src/magick/gpu-lifetime.js"

const directory = process.env.WEBGPU_NODE_MODULES
const modulePath = process.env.MAGICK_ARENA_MODULE
assert(directory && modulePath, "Set WEBGPU_NODE_MODULES and MAGICK_ARENA_MODULE explicitly")
const arenaPath = realpathSync(modulePath)
const packagePath = realpathSync(resolve(directory, "bun-webgpu"))
const libraryPath = realpathSync(resolve(packagePath, "../bun-webgpu-linux-x64/libwebgpu_wrapper.so"))
const sha256 = async (path: string) =>
  new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex")
const nativeHash = await sha256(libraryPath)
const javascriptHash = await sha256(resolve(packagePath, "index.js"))
assert.equal(nativeHash, "3190c3777f2c07fcf6a0640833cbf5d0cde859dc53aed6d9083946d093198788")
assert.equal(javascriptHash, "afc3b46db7b2e1b62602a146dca0749e0df5f456a3b742bca38505aa17537ee1")
assert.equal((await Bun.file(resolve(packagePath, "package.json")).json()).version, "0.1.7")
const arenaHash = await sha256(arenaPath)
const arenaVersion = Bun.spawnSync(["git", "-C", dirname(arenaPath), "rev-parse", "HEAD"], {
  timeout: 2000,
  killSignal: "SIGKILL",
})
assert.equal(arenaVersion.exitCode, 0, "The explicitly selected arena must belong to a git checkout")
const threePath = Bun.resolveSync("three", dirname(arenaPath))
const rendererPath = Bun.resolveSync("three/webgpu", dirname(arenaPath))
const THREE = await import(threePath)
const { WebGPURenderer } = await import(rendererPath)
assert.equal(THREE.REVISION, "177", "This canvas bridge is pinned to Three r177")
const { createArena } = await import(arenaPath)
const { setupGlobals } = await import(resolve(packagePath, "index.js"))
await setupGlobals({ libPath: libraryPath })
globalThis.requestAnimationFrame ??= ((callback: FrameRequestCallback) =>
  Number(setTimeout(() => callback(performance.now()), 16).unref())) as any
globalThis.cancelAnimationFrame ??= (id: number) => clearTimeout(id)
const adapter = await navigator.gpu.requestAdapter({
  powerPreference: "high-performance",
  backendType: "Vulkan",
} as any)
assert(adapter, "No Vulkan adapter")
// These pinned JS enum aliases encode native DmaBuf and SyncFD; the helper verifies both.
const device = await adapter.requestDevice({
  requiredFeatures: ["shared-texture-memory-a-hardware-buffer", "shared-fence-vk-semaphore-opaque-fd"] as any,
})
device.addEventListener("uncapturederror", (event: any) => {
  console.error("Uncaptured Three GPU error", event.error)
  process.exit(1)
})
const [socketText, widthText, heightText, mode] = process.argv.slice(2)
const [socket, width, height] = [socketText, widthText, heightText].map(Number)
assert([socket, width, height].every(Number.isSafeInteger))
assert(mode === "validate" || mode === "no-readback" || mode === "performance")
const validate = mode === "validate"
const performanceRun = mode === "performance"
assert.equal(performanceRun, process.env.GPU_SHARING_PERF_FRAMES !== undefined, "Parent/producer performance mode")
const calibration = process.env.GPU_SHARING_CALIBRATION !== undefined
const sourceHashes: Record<string, string> = {}
if (performanceRun) {
  for (const source of [
    "three-sharing.c",
    "three-producer.c",
    "three-producer.ts",
    "../../../packages/examples/src/magick/gpu-lifetime.ts",
    "three-protocol.h",
    "native-sharing.c",
    "dawn-consumer.c",
    "protocol.h",
    "no-readback-guard.c",
    "Makefile",
  ]) {
    sourceHashes[source] = await sha256(resolve(import.meta.dir, source))
  }
}
const bridge = dlopen(resolve(import.meta.dir, ".build/three-producer.so"), {
  three_library_path: { args: [], returns: "ptr" },
  three_open: { args: ["ptr", "ptr", "i32", "u32", "u32", "u32"], returns: "u32" },
  three_texture: { args: ["u32"], returns: "ptr" },
  three_begin: { args: ["u32"], returns: "void" },
  three_reference_hash: { args: ["ptr"], returns: "u64" },
  three_end: { args: ["u32", "u64"], returns: "void" },
  three_wait_stop: { args: [], returns: "void" },
  three_close: { args: [], returns: "void" },
})
assert.equal(
  realpathSync(new CString(bridge.symbols.three_library_path()).toString()),
  libraryPath,
  "Helper and Bun must load the same library path; clean the build after changing dependencies",
)
const nativeDevice = device as any
const frameCount = bridge.symbols.three_open(
  nativeDevice.ptr,
  (adapter as any).instancePtr,
  socket!,
  width!,
  height!,
  Number(validate),
)
assert(Number.isInteger(frameCount) && frameCount > 0)
if (!performanceRun) assert.equal(frameCount, 8, "Correctness runs remain eight frames")
const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
const probe = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage }) as any
const Texture = probe.constructor
assert.equal(Texture.name, "GPUTextureImpl")
assert.equal(Texture.length, 10)
assert.equal(probe.lib, nativeDevice.lib)
assert.equal(probe.ptr, probe.texturePtr)
const textures = [0, 1].map((index) => {
  const pointer = bridge.symbols.three_texture(index)
  assert(pointer)
  const texture = new Texture(pointer, probe.lib, width, height, 1, "rgba8unorm", "2d", 1, 1, usage)
  texture.destroy = () => {
    throw new Error("Imported textures are borrowed from the native owner")
  }
  return texture
})
probe.destroy()
nativeDevice.lib.wgpuTextureRelease(probe.ptr)

// No JS-created readback buffer is allowed, even in validation: only the native reference helper maps.
const createBuffer = device.createBuffer.bind(device)
device.createBuffer = (descriptor) => {
  assert.equal(descriptor.usage & GPUBufferUsage.MAP_READ, 0, "Unexpected JS readback allocation")
  return createBuffer(descriptor)
}
const reference = validate ? device.createTexture({ size: [width!, height!], format: "rgba8unorm", usage }) : undefined
const views = new Set<any>()
for (const texture of [...textures, ...(reference ? [reference] : [])]) {
  const createView = texture.createView.bind(texture)
  let persistentView: any
  texture.createView = (descriptor: GPUTextureViewDescriptor) => {
    if (performanceRun) {
      assert.equal(descriptor, undefined, "Performance canvas views must use the unchanged default descriptor")
      if (persistentView) return persistentView
    }
    const view = createView(descriptor)
    assert(view.ptr && typeof view.destroy === "function", "Pinned GPUTextureView layout")
    views.add(view)
    assert(views.size <= (performanceRun ? 2 : 32), "Bounded canvas view pool")
    if (performanceRun) persistentView = view
    return view
  }
}
let current: GPUTexture | undefined
let configured = false
const canvas = {
  width: width!,
  height: height!,
  getContext: (kind: string) => {
    assert.equal(kind, "webgpu")
    return context
  },
  addEventListener() {},
  removeEventListener() {},
}
const context = {
  canvas,
  configure(configuration: GPUCanvasConfiguration) {
    assert.equal(configuration.device, device)
    assert.equal(configuration.format, "rgba8unorm")
    assert.equal(configuration.usage, usage)
    assert.equal(configuration.alphaMode, "opaque")
    configured = true
  },
  getCurrentTexture() {
    assert(configured && current, "Canvas access outside an acquired frame")
    return current
  },
  unconfigure() {
    configured = false
  },
}
const lifetime = managePixelGpu(device, context as GPUCanvasContext, { release: "combined", cacheCanvasView: false })
const renderer = new WebGPURenderer({ canvas, context, device, alpha: false, antialias: false })
const arena = createArena(width! / height!, 512)
const calibrationScene = calibration ? new THREE.Scene() : undefined
const frameHashes: string[] = []
const draws: { draw_calls: number; triangles: number }[] = []
const drawRange = { draw_calls_min: Infinity, draw_calls_max: 0, triangles_min: Infinity, triangles_max: 0 }
let stopped = false
try {
  renderer.info.autoReset = false
  // r177 hard-codes BGRA for outputType; this instance-local hook keeps pipeline and shared-image formats identical.
  assert.equal(typeof renderer.backend.utils.getPreferredCanvasFormat, "function")
  renderer.backend.utils.getPreferredCanvasFormat = () => "rgba8unorm"
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setSize(width!, height!, false)
  await renderer.init()
  for (let sequence = 0; sequence < frameCount; sequence++) {
    bridge.symbols.three_begin(sequence)
    const seconds = sequence * 0.625
    arena.update(seconds)
    if (calibrationScene)
      calibrationScene.background = new THREE.Color([0xff0000, 0x00ff00, 0x0000ff, 0xffffff][sequence % 4])
    const scene = calibrationScene ?? arena.scene
    let hash = 0n
    if (reference) {
      current = reference
      renderer.render(scene, arena.camera)
      hash = BigInt(bridge.symbols.three_reference_hash((reference as any).ptr))
    }
    if (process.env.GPU_SHARING_THREE_STALE && sequence === 3) arena.update(seconds - 0.625)
    current = textures[sequence % 2]
    renderer.info.reset()
    renderer.render(scene, arena.camera)
    const draw = { draw_calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }
    if (!calibration) {
      assert(draw.draw_calls >= arena.counts.meshes, "The arena geometry must actually be drawn")
      assert(draw.triangles >= arena.counts.triangles, "The complete arena workload must reach the renderer")
    }
    if (performanceRun) {
      drawRange.draw_calls_min = Math.min(drawRange.draw_calls_min, draw.draw_calls)
      drawRange.draw_calls_max = Math.max(drawRange.draw_calls_max, draw.draw_calls)
      drawRange.triangles_min = Math.min(drawRange.triangles_min, draw.triangles)
      drawRange.triangles_max = Math.max(drawRange.triangles_max, draw.triangles)
    } else {
      draws.push(draw)
    }
    current = undefined
    bridge.symbols.three_end(sequence, hash)
    if (validate) frameHashes.push(hash.toString(16).padStart(16, "0"))
  }
  bridge.symbols.three_wait_stop()
  stopped = true
  const pending = lifetime.snapshot()
  assert.equal(
    pending.pendingEncoders + pending.pendingPasses + pending.pendingCommandBuffers,
    0,
    "Frame handles must retire before disposal",
  )
} finally {
  current = undefined
  try {
    lifetime.dispose()
  } finally {
    renderer.onDeviceLost = () => {}
    try {
      arena.dispose()
      renderer.dispose()
      for (const view of views) view.destroy()
      if (reference) {
        reference.destroy()
        nativeDevice.lib.wgpuTextureRelease((reference as any).ptr)
      }
      if (stopped) bridge.symbols.three_close()
    } finally {
      device.destroy()
    }
  }
}
const {
  canvasViewsCreated: canvasViewRequests,
  canvasViewsReleased,
  cachedCanvasViews,
  ...gpuHandles
} = lifetime.snapshot()
assert.equal(canvasViewsReleased + cachedCanvasViews, 0, "The sharing producer owns its canvas view pool")
assert.equal(await sha256(arenaPath), arenaHash, "Arena source changed during the run")
for (const [source, hash] of Object.entries(sourceHashes)) {
  assert.equal(await sha256(resolve(import.meta.dir, source)), hash, "Experiment source changed during the run")
}
console.log(
  JSON.stringify({
    type: "three-producer",
    status: "pass",
    arena_module: arenaPath,
    arena_source_sha256: arenaHash,
    arena_git_head: arenaVersion.stdout.toString().trim(),
    arena_version: `sha256:${arenaHash}`,
    arena_counts: arena.counts,
    three_revision: THREE.REVISION,
    three_module: rendererPath,
    three_renderer_sha256: await sha256(rendererPath),
    bun_webgpu_js_sha256: javascriptHash,
    native_library_sha256: nativeHash,
    native_library_path: libraryPath,
    shared_render_calls: frameCount,
    reference_render_calls: validate ? frameCount : 0,
    mode,
    calibration,
    gpu_handles: gpuHandles,
    canvas_view_requests: canvasViewRequests,
    reference_hashes: frameHashes,
    draws,
    ...(performanceRun
      ? {
          source_sha256: sourceHashes,
          draw_range: drawRange,
          canvas_views: views.size,
          bun_version: Bun.version,
          bun_revision: Bun.revision,
        }
      : {}),
  }),
)
// Bun owns its adapter/instance and ticker callbacks until process exit; keep the FFI library loaded.
process.exit(0)
