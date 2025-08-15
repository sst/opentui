#!/usr/bin/env bun

import { CliRenderer, createCliRenderer, RGBA, GroupRenderable, TextRenderable, FrameBufferRenderable } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import * as THREE from "three"
import { ThreeCliRenderer } from "../3d"
import { SpriteUtils } from "../3d/SpriteUtils"

// @ts-ignore - Bun specific import attribute for assets
import staticImagePath from "./assets/main_char_idle.png" with { type: "image/png" }

let engine: ThreeCliRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.OrthographicCamera | null = null
let sprite: any = null
let frameIndex = 0
let accumulatedTime = 0
let frameCallback: ((deltaTime: number) => Promise<void>) | null = null
let keyHandler: ((key: Buffer) => void) | null = null
let resizeHandler: ((newWidth: number, newHeight: number) => void) | null = null
let parentContainer: GroupRenderable | null = null

export async function run(renderer: CliRenderer): Promise<void> {
  renderer.start()
  const TERM_WIDTH = renderer.terminalWidth
  const TERM_HEIGHT = renderer.terminalHeight

  parentContainer = new GroupRenderable("static-sprite-container", {
    zIndex: 15,
    visible: true,
  })
  renderer.root.add(parentContainer)

  const framebufferRenderable = new FrameBufferRenderable("main", {
    width: TERM_WIDTH,
    height: TERM_HEIGHT,
    zIndex: 10,
  })
  renderer.root.add(framebufferRenderable)
  const { frameBuffer: framebuffer } = framebufferRenderable

  engine = new ThreeCliRenderer(renderer, {
    width: TERM_WIDTH,
    height: TERM_HEIGHT,
    focalLength: 1,
    backgroundColor: RGBA.fromValues(0.2, 0.1, 0.3, 1.0),
  })
  await engine.init()

  scene = new THREE.Scene()

  const aspectRatio = engine.aspectRatio
  const frustumSize = 1
  camera = new THREE.OrthographicCamera(
    (frustumSize * aspectRatio) / -2, // left
    (frustumSize * aspectRatio) / 2, // right
    frustumSize / 2, // top
    frustumSize / -2, // bottom
    0.1, // near
    1000, // far
  )

  camera.position.z = 5
  scene.add(camera)
  engine.setActiveCamera(camera)

  const titleText = new TextRenderable("demo-title", {
    content: "Static THREE.Sprite Demo",
    position: "absolute",
    left: 1,
    top: 1,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(titleText)

  const statusText = new TextRenderable("status", {
    content: "Loading sprite texture...",
    position: "absolute",
    left: 1,
    top: 2,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(statusText)

  const totalFrames = 8
  sprite = await SpriteUtils.sheetFromFile(staticImagePath, totalFrames)

  const desiredHeight = 2.0
  sprite.scale.set(desiredHeight, desiredHeight, desiredHeight)

  scene.add(sprite)
  statusText.content = "Sprite loaded. Press t/u/`/k."

  resizeHandler = (newWidth: number, newHeight: number) => {
    framebuffer.resize(newWidth, newHeight)

    const newAspectRatio = engine!.aspectRatio
    camera!.left = (frustumSize * newAspectRatio) / -2
    camera!.right = (frustumSize * newAspectRatio) / 2
    camera!.top = frustumSize / 2
    camera!.bottom = frustumSize / -2
    camera!.updateProjectionMatrix()
  }

  renderer.on("resize", resizeHandler)

  frameCallback = async (deltaTime: number) => {
    accumulatedTime += deltaTime
    if (accumulatedTime > 64) {
      frameIndex = (frameIndex + 1) % totalFrames
      sprite.setIndex(frameIndex)
      accumulatedTime = 0
    }

    await engine!.drawScene(scene!, framebuffer, deltaTime)
  }

  renderer.setFrameCallback(frameCallback)

  keyHandler = (key: Buffer) => {
    const keyStr = key.toString()

    if (keyStr === "u") {
      engine!.toggleSuperSampling()
    }

    if (keyStr === "k") {
      renderer.console.toggleDebugMode()
    }
  }

  process.stdin.on("data", keyHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (keyHandler) {
    process.stdin.removeListener("data", keyHandler)
    keyHandler = null
  }

  if (frameCallback) {
    renderer.clearFrameCallbacks()
    frameCallback = null
  }

  if (resizeHandler) {
    renderer.off("resize", resizeHandler)
    resizeHandler = null
  }

  renderer.root.remove("main")

  if (parentContainer) {
    renderer.root.remove("static-sprite-container")
    parentContainer = null
  }

  if (sprite && scene) {
    scene.remove(sprite)
    sprite = null
  }

  if (engine) {
    engine.destroy()
    engine = null
  }

  scene = null
  camera = null
  frameIndex = 0
  accumulatedTime = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  })

  await run(renderer)
  setupCommonDemoKeys(renderer)
}
