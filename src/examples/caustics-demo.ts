#!/usr/bin/env bun

import { perlin3d } from "@typegpu/noise"
import { createWebGPUDevice, setupGlobals } from "bun-webgpu"
import tgpu, { type TgpuRoot } from "typegpu"
import * as d from "typegpu/data"
import * as std from "typegpu/std"
import { CLICanvas, type CliRenderer, GroupRenderable, SuperSampleType } from "../index"

/** Controls the angle of rotation for the pool tile texture */
const angle = 0.2
/** The scene fades into this color at a distance */
const fogColor = d.vec3f(0.05, 0.2, 0.7)
/** The ambient light color */
const ambientColor = d.vec3f(0.2, 0.5, 1)

const layout = tgpu.bindGroupLayout({
  aspect: { uniform: d.f32 },
  time: { uniform: d.f32 },
})

const mainVertex = tgpu["~unstable"].vertexFn({
  in: { vertexIndex: d.builtin.vertexIndex },
  out: { pos: d.builtin.position, uv: d.vec2f },
})(({ vertexIndex }) => {
  const pos = [d.vec2f(-1, -1), d.vec2f(3, -1), d.vec2f(-1, 3)]
  const left = 0.5 - layout.$.aspect * 0.5
  const right = 0.5 + layout.$.aspect * 0.5
  const uv = [d.vec2f(left, 0), d.vec2f(right, 0), d.vec2f(left, 2)]

  return {
    pos: d.vec4f(pos[vertexIndex], 0, 1),
    uv: uv[vertexIndex],
  }
})

/**
 * Given a coordinate, it returns a grayscale floor tile pattern at that
 * location.
 */
const tilePattern = tgpu.fn(
  [d.vec2f],
  d.f32,
)((uv) => {
  const tiledUv = std.fract(uv)
  const proximity = std.abs(std.sub(std.mul(tiledUv, 2), 1))
  const maxProximity = std.max(proximity.x, proximity.y)
  return std.clamp(std.pow(1 - maxProximity, 0.6) * 5, 0, 1)
})

const caustics = tgpu.fn(
  [d.vec2f, d.f32, d.vec3f],
  d.vec3f,
)((uv, time, profile) => {
  const distortion = perlin3d.sample(d.vec3f(std.mul(uv, 0.5), time * 0.2))
  // Distorting UV coordinates
  const uv2 = std.add(uv, distortion)
  const noise = std.abs(perlin3d.sample(d.vec3f(std.mul(uv2, 5), time)))
  return std.pow(d.vec3f(1 - noise), profile)
})

const clamp01 = tgpu.fn([d.f32], d.f32)((v) => std.clamp(v, 0, 1))

/**
 * Returns a transformation matrix that represents an `angle` rotation
 * in the XY plane (around the imaginary Z axis)
 */
const rotateXY = tgpu.fn(
  [d.f32],
  d.mat2x2f,
)((angle) => {
  return d.mat2x2f(
    /* right */ d.vec2f(std.cos(angle), std.sin(angle)),
    /* up    */ d.vec2f(-std.sin(angle), std.cos(angle)),
  )
})

const mainFragment = tgpu["~unstable"].fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})(({ uv }) => {
  /**
   * A transformation matrix that skews the perspective a bit
   * when applied to UV coordinates
   */
  const skewMat = d.mat2x2f(
    d.vec2f(std.cos(angle), std.sin(angle)),
    d.vec2f(-std.sin(angle) * 10 + uv.x * 3, std.cos(angle) * 5),
  )
  const skewedUv = std.mul(skewMat, uv)
  const tile = tilePattern(std.mul(skewedUv, 10))
  const albedo = std.mix(d.vec3f(0.1), d.vec3f(1), tile)

  // Transforming coordinates to simulate perspective squash
  const cuv = d.vec2f(uv.x * (std.pow(uv.y * 1.5, 3) + 0.1) * 5, std.pow((uv.y * 1.5 + 0.1) * 1.5, 3) * 1)
  // Generating two layers of caustics (large scale, and small scale)
  const c1 = std.mul(
    caustics(cuv, layout.$.time * 0.2, /* profile */ d.vec3f(4, 4, 1)),
    // Tinting
    d.vec3f(0.4, 0.65, 1),
  )
  const c2 = std.mul(
    caustics(std.mul(cuv, 2), layout.$.time * 0.4, /* profile */ d.vec3f(16, 1, 4)),
    // Tinting
    d.vec3f(0.18, 0.3, 0.5),
  )

  // -- BLEND --

  const blendCoord = d.vec3f(std.mul(uv, d.vec2f(5, 10)), layout.$.time * 0.2 + 5)
  // A smooth blending factor, so that caustics only appear at certain spots
  const blend = clamp01(perlin3d.sample(blendCoord) + 0.3)

  // -- FOG --

  const noFogColor = std.mul(albedo, std.mix(ambientColor, std.add(c1, c2), blend))
  // Fog blending factor, based on the height of the pixels
  const fog = std.min(std.pow(uv.y, 0.5) * 1.2, 1)

  // -- GOD RAYS --

  const godRayUv = std.mul(std.mul(rotateXY(-0.3), uv), d.vec2f(15, 3))
  const godRayFactor = std.pow(uv.y, 1)
  const godRay1 = std.mul(
    std.add(perlin3d.sample(d.vec3f(godRayUv, layout.$.time * 0.5)), 1),
    // Tinting
    std.mul(d.vec3f(0.18, 0.3, 0.5), godRayFactor),
  )
  const godRay2 = std.mul(
    std.add(perlin3d.sample(d.vec3f(std.mul(godRayUv, 2), layout.$.time * 0.3)), 1),
    // Tinting
    std.mul(d.vec3f(0.18, 0.3, 0.5), godRayFactor * 0.4),
  )
  const godRays = std.add(godRay1, godRay2)

  return d.vec4f(std.add(std.mix(noFogColor, fogColor, fog), godRays), 1)
})

let isRunning = true
let root: TgpuRoot | undefined
let keyHandler: ((key: Buffer) => void) | null = null
let handleResize: ((width: number, height: number) => void) | null = null
let parentContainer: GroupRenderable | null = null

export async function run(renderer: CliRenderer): Promise<void> {
  renderer.start()
  const WIDTH = renderer.terminalWidth
  const HEIGHT = renderer.terminalHeight

  parentContainer = new GroupRenderable("fractal-container", {
    x: 0,
    y: 0,
    zIndex: 10,
    visible: true,
  })
  renderer.add(parentContainer)

  // Bun WebGPU setup
  setupGlobals()
  const device = await createWebGPUDevice()
  const canvas = new CLICanvas(device, WIDTH, HEIGHT, SuperSampleType.GPU)

  root = tgpu.initFromDevice({ device })

  /** Seconds passed since the start of the example, wrapped to the range [0, 1000) */
  const timeBuffer = root.createBuffer(d.f32).$usage("uniform")
  /** Aspect ratio of the canvas */
  const aspectBuffer = root.createBuffer(d.f32, WIDTH / HEIGHT).$usage("uniform")

  const bindGroup = root.createBindGroup(layout, {
    time: timeBuffer,
    aspect: aspectBuffer,
  })

  handleResize = (width: number, height: number) => {
    aspectBuffer.write(width / height)
  }

  renderer.on("resize", handleResize)

  // Assuming a format...
  const presentationFormat = "rgba8unorm" as const
  const context = canvas.getContext("webgpu") as GPUCanvasContext

  context.configure({
    device: root.device,
    format: presentationFormat,
    alphaMode: "premultiplied",
  })

  const pipeline = root["~unstable"]
    .withVertex(mainVertex, {})
    .withFragment(mainFragment, { format: presentationFormat })
    .createPipeline()
    // ---
    .with(layout, bindGroup)

  let time = 0

  renderer.setFrameCallback(async (deltaMs) => {
    if (!isRunning) return

    time += deltaMs / 1000
    timeBuffer.write(time)

    pipeline
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
    keyHandler = null
  }

  if (handleResize) {
    renderer.off("resize", handleResize)
    handleResize = null
  }

  renderer.clearFrameCallbacks()
  root?.destroy()

  if (parentContainer) {
    renderer.remove("fractal-container")
    parentContainer = null
  }
}
