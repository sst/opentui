#!/usr/bin/env bun

import { perlin3d } from "@typegpu/noise"
import { createWebGPUDevice, setupGlobals } from "bun-webgpu"
import tgpu, { type TgpuRoot } from "typegpu"
import * as d from "typegpu/data"
import { abs, mix, pow, sign, tanh } from "typegpu/std"
import { CLICanvas, type CliRenderer, GroupRenderable, SuperSampleType, TextRenderable } from "../index"

/** The size of the perlin noise (in time), after which the pattern loops around */
const domainDepth = 10
/** The size of the perlin noise (in space) */
const domainSize = 10
/** With supersampling, the scene is rendered at 2x the resolution */
const pixelRatio = 2

const fullScreenTriangle = tgpu["~unstable"].vertexFn({
  in: { vertexIndex: d.builtin.vertexIndex },
  out: { pos: d.builtin.position, uv: d.vec2f },
})((input) => {
  const pos = [d.vec2f(-1, -1), d.vec2f(3, -1), d.vec2f(-1, 3)]

  return {
    pos: d.vec4f(pos[input.vertexIndex], 0.0, 1.0),
    uv: pos[input.vertexIndex].mul(0.5),
  }
})

const aspectAccess = tgpu["~unstable"].accessor(d.f32);
const timeAccess = tgpu["~unstable"].accessor(d.f32)
const sharpnessAccess = tgpu["~unstable"].accessor(d.f32)

const exponentialSharpen = tgpu.fn(
  [d.f32, d.f32],
  d.f32,
)((n, sharpness) => {
  return sign(n) * pow(abs(n), 1 - sharpness)
})

const tanhSharpen = tgpu.fn(
  [d.f32, d.f32],
  d.f32,
)((n, sharpness) => {
  return tanh(n * (1 + sharpness * 10))
})

/** The method to use for sharpening. Can be swapped at pipeline creation */
const sharpenFnSlot = tgpu.slot(exponentialSharpen)

const mainFragment = tgpu["~unstable"].fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  const uv = input.uv.mul(domainSize * 0.5).mul(d.vec2f(aspectAccess.$, 1.5));
  const n = perlin3d.sample(d.vec3f(uv, timeAccess.$ * 0.2))

  // Apply sharpening function
  const sharp = sharpenFnSlot.$(n, sharpnessAccess.$)

  // Map to 0-1 range
  const n01 = sharp * 0.5 + 0.5

  // Gradient map
  const dark = d.vec3f(0, 0.2, 1)
  const light = d.vec3f(1, 0.3, 0.5)
  return d.vec4f(mix(dark, light, n01), 1)
})

let isRunning = true
let activeSharpenFn: "exponential" | "tanh" = "exponential"
let root: TgpuRoot | undefined
let keyHandler: ((key: Buffer) => void) | undefined
let handleResize: ((width: number, height: number) => void) | undefined
let parentContainer: GroupRenderable | undefined

export async function run(renderer: CliRenderer): Promise<void> {
  isRunning = true
  renderer.start()
  const WIDTH = renderer.terminalWidth
  const HEIGHT = renderer.terminalHeight

  parentContainer = new GroupRenderable("shader-container", {
    x: 0,
    y: 0,
    zIndex: 10,
    visible: true,
  })
  renderer.add(parentContainer)

  const controlsText = new TextRenderable("demo_controls", {
    content: "S: Toggle Sharpening Method | +/-: Sharpness | Escape: Back to menu",
    x: 0,
    y: HEIGHT - 2,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(controlsText)

  const statusText = new TextRenderable("demo_status", {
    content: "Sharpening: exponential",
    x: 0,
    y: 0,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(statusText)

  // Bun WebGPU setup
  setupGlobals()
  const device = await createWebGPUDevice()
  const canvas = new CLICanvas(device, WIDTH * pixelRatio, HEIGHT * pixelRatio, SuperSampleType.GPU)

  root = tgpu.initFromDevice({ device })
  // Assuming a format...
  const presentationFormat = "rgba8unorm" as const

  /** Contains all resources that the perlin cache needs access to */
  const perlinCache = perlin3d.staticCache({ root, size: d.vec3u(domainSize, domainSize, domainDepth) })

  const aspect = root.createUniform(d.f32, WIDTH / HEIGHT);
  const time = root.createUniform(d.f32, 0)
  const sharpness = root.createUniform(d.f32, 0.5)

  const renderPipelineBase = root["~unstable"]
    .with(aspectAccess, aspect)
    .with(timeAccess, time)
    .with(sharpnessAccess, sharpness)
    .pipe(perlinCache.inject())

  const renderPipelines = {
    exponential: renderPipelineBase
      .with(sharpenFnSlot, exponentialSharpen)
      .withVertex(fullScreenTriangle, {})
      .withFragment(mainFragment, { format: presentationFormat })
      .createPipeline(),
    tanh: renderPipelineBase
      .with(sharpenFnSlot, tanhSharpen)
      .withVertex(fullScreenTriangle, {})
      .withFragment(mainFragment, { format: presentationFormat })
      .createPipeline(),
  }

  handleResize = (width: number, height: number) => {
    canvas.setSize(width * pixelRatio, height * pixelRatio)
    aspect.write(width / height);
    controlsText.y = height - 2;
  }

  renderer.on("resize", handleResize)

  const context = canvas.getContext("webgpu") as GPUCanvasContext

  context.configure({
    device: root.device,
    format: presentationFormat,
    alphaMode: "premultiplied",
  })

  let timeAcc = 0
  let sharpnessCpu = 0.5

  const updateStatusText = () => {
    statusText.content = `Method: ${activeSharpenFn}, Sharpness: ${sharpnessCpu.toFixed(1)}`
  }
  updateStatusText();

  keyHandler = (key: Buffer) => {
    const keyStr = key.toString()

    if (keyStr === "s") {
      activeSharpenFn = activeSharpenFn === "exponential" ? "tanh" : "exponential"
    }

    if (keyStr === "+" || keyStr === "=") {
      sharpnessCpu = Math.min(sharpnessCpu + 0.1, 1)
      sharpness.write(sharpnessCpu)
    }

    if (keyStr === "-" || keyStr === "_") {
      sharpnessCpu = Math.max(sharpnessCpu - 0.1, 0)
      sharpness.write(sharpnessCpu)
    }

    updateStatusText()
  }

  process.stdin.on("data", keyHandler)

  renderer.setFrameCallback(async (deltaMs) => {
    if (!isRunning) return

    timeAcc += deltaMs / 1000
    time.write(timeAcc)

    renderPipelines[activeSharpenFn]
      .withColorAttachment({
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(3)

    await canvas.readPixelsIntoBuffer(renderer.nextRenderBuffer)
  })
}

export function destroy(renderer: CliRenderer): void {
  isRunning = false
  if (keyHandler) {
    process.stdin.off("data", keyHandler)
    keyHandler = undefined
  }

  if (handleResize) {
    renderer.off("resize", handleResize)
    handleResize = undefined
  }

  renderer.clearFrameCallbacks()
  root?.destroy()

  if (parentContainer) {
    renderer.remove("shader-container")
    parentContainer = undefined
  }
}
