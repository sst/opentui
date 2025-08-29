#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  OptimizedBuffer,
  RGBA,
  BoxRenderable,
  TextRenderable,
  FrameBufferRenderable,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { TextureUtils } from "../3d/TextureUtils"
import {
  Scene as ThreeScene,
  Mesh as ThreeMesh,
  PerspectiveCamera,
  Color,
  PointLight as ThreePointLight,
  BoxGeometry,
  MeshBasicMaterial,
  Vector3,
} from "three"
import { MeshPhongNodeMaterial } from "three/webgpu"
import { lights } from "three/tsl"
import { ThreeCliRenderer, SuperSampleAlgorithm } from "../3d"

// @ts-ignore
import cratePath from "./assets/crate.png" with { type: "image/png" }
// @ts-ignore
import crateEmissivePath from "./assets/crate_emissive.png" with { type: "image/png" }

let engine: ThreeCliRenderer | null = null
let framebuffer: OptimizedBuffer | null = null
let keyListener: ((key: string) => void) | null = null
let resizeListener: ((width: number, height: number) => void) | null = null
let stdinHandler: ((key: Buffer) => void) | null = null
let parentContainer: BoxRenderable | null = null

export async function run(renderer: CliRenderer): Promise<void> {
  renderer.start()
  const WIDTH = renderer.terminalWidth
  const HEIGHT = renderer.terminalHeight

  parentContainer = new BoxRenderable(renderer, {
    id: "texture-loading-container",
    zIndex: 15,
  })
  renderer.root.add(parentContainer)

  const framebufferRenderable = new FrameBufferRenderable(renderer, {
    id: "main",
    width: WIDTH,
    height: HEIGHT,
    zIndex: 10,
  })
  renderer.root.add(framebufferRenderable)
  const { frameBuffer: framebuffer } = framebufferRenderable

  engine = new ThreeCliRenderer(renderer, {
    width: WIDTH,
    height: HEIGHT,
    focalLength: 8,
    backgroundColor: RGBA.fromValues(0.0, 0.0, 0.0, 1.0),
  })
  await engine.init()

  const sceneRoot = new ThreeScene()

  const mainLightNode = new ThreePointLight(new Color(1.0, 1.0, 1.0), 1.0, 60)
  mainLightNode.power = 500
  mainLightNode.position.set(2, 1, 2)
  mainLightNode.name = "main_light"
  sceneRoot.add(mainLightNode)

  const lightNode = new ThreePointLight(new Color(1.0, 1.0, 1.0), 1.0, 60)
  lightNode.power = 500
  lightNode.position.set(-2, 1, 2)
  lightNode.name = "light"
  sceneRoot.add(lightNode)

  const allLightsNode = lights([mainLightNode, lightNode])

  const cubeGeometry = new BoxGeometry(1.0, 1.0, 1.0)
  const cubeMeshNode = new ThreeMesh(cubeGeometry)
  cubeMeshNode.name = "cube"

  cubeMeshNode.position.set(0, 0, 0)
  cubeMeshNode.rotation.set(0, 0, 0)
  cubeMeshNode.scale.set(1.0, 1.0, 1.0)

  sceneRoot.add(cubeMeshNode)

  const cameraNode = new PerspectiveCamera(45, engine.aspectRatio, 1.0, 100.0)
  cameraNode.position.set(0, 0, 2)
  cameraNode.name = "main_camera"

  engine.setActiveCamera(cameraNode)

  const titleText = new TextRenderable(renderer, {
    id: "demo-title",
    content: "Texture Loading Demo",
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(titleText)

  const statusText = new TextRenderable(renderer, {
    id: "status",
    content: "Loading texture...",
    position: "absolute",
    left: 0,
    top: 1,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(statusText)

  const controlsText = new TextRenderable(renderer, {
    id: "controls",
    content: "WASD: Move | QE: Rotate | ZX: Zoom | R: Reset | Space: Toggle rotation | Escape: Return",
    position: "absolute",
    left: 0,
    top: HEIGHT - 2,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(controlsText)

  resizeListener = (width: number, height: number) => {
    if (framebuffer) {
      framebuffer.resize(width, height)
    }

    if (cameraNode && engine) {
      cameraNode.aspect = engine.aspectRatio
      cameraNode.updateProjectionMatrix()
    }

    controlsText.y = height - 2
  }

  renderer.on("resize", resizeListener)

  let rotationEnabled = true
  let showDebugOverlay = false

  keyListener = (key: string) => {
    if (key === "p" && engine) {
      engine.saveToFile(`screenshot-${Date.now()}.png`)
    }

    // Handle camera movement
    if (key === "w") {
      cameraNode.translateY(0.5)
    } else if (key === "s") {
      cameraNode.translateY(-0.5)
    } else if (key === "a") {
      cameraNode.translateX(-0.5)
    } else if (key === "d") {
      cameraNode.translateX(0.5)
    }

    // Handle camera rotation
    if (key === "q") {
      cameraNode.rotateY(0.1)
    } else if (key === "e") {
      cameraNode.rotateY(-0.1)
    }

    // Handle zoom by changing camera position
    if (key === "z") {
      cameraNode.translateZ(0.1)
    } else if (key === "x") {
      cameraNode.translateZ(-0.1)
    }

    // Reset camera position and rotation
    if (key === "r") {
      cameraNode.position.set(0, 0, 2)
      cameraNode.rotation.set(0, 0, 0)
      cameraNode.quaternion.set(0, 0, 0, 1)
      cameraNode.up.set(0, 1, 0)
      cameraNode.lookAt(0, 0, 0)
    }

    // Toggle super sampling
    if (key === "u" && engine) {
      engine.toggleSuperSampling()
    }

    if (key === "i" && engine) {
      const currentAlgorithm = engine.getSuperSampleAlgorithm()
      const newAlgorithm =
        currentAlgorithm === SuperSampleAlgorithm.STANDARD
          ? SuperSampleAlgorithm.PRE_SQUEEZED
          : SuperSampleAlgorithm.STANDARD
      engine.setSuperSampleAlgorithm(newAlgorithm)
    }

    // Toggle cube rotation
    if (key === " ") {
      rotationEnabled = !rotationEnabled
    }
  }

  const originalStdin = process.stdin.listenerCount("data") > 0
  if (!originalStdin) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding("utf8")
  }

  stdinHandler = (key: Buffer) => {
    if (keyListener) {
      keyListener(key.toString())
    }
  }

  process.stdin.on("data", stdinHandler)

  const rotationSpeed = new Vector3(0.4, 0.8, 0.2)

  const imagePath = cratePath
  const textureMap = await TextureUtils.fromFile(imagePath)
  const textureEmissive = await TextureUtils.fromFile(crateEmissivePath)

  let material
  if (textureMap) {
    material = new MeshPhongNodeMaterial({
      map: textureMap,
      emissiveMap: textureEmissive ? textureEmissive : undefined,
      emissive: new Color(0.0, 0.0, 0.0),
      emissiveIntensity: 0.2,
    })
    material.lightsNode = allLightsNode
    statusText.content = "Using PhongNodeMaterial with texture."
  } else {
    material = new MeshBasicMaterial({ color: 0x00ff00 })
    statusText.content = "Texture failed. Using green BasicMaterial."
  }

  cubeMeshNode.material = material

  statusText.content = "Using PhongNodeMaterial setup"

  // Start the animation loop
  renderer.setFrameCallback(async (deltaMs) => {
    const deltaTime = deltaMs / 1000

    if (rotationEnabled && cubeMeshNode) {
      cubeMeshNode.rotation.x += rotationSpeed.x * deltaTime
      cubeMeshNode.rotation.y += rotationSpeed.y * deltaTime
      cubeMeshNode.rotation.z += rotationSpeed.z * deltaTime
    }

    if (engine && framebuffer) {
      await engine.drawScene(sceneRoot, framebuffer, deltaTime)

      if (showDebugOverlay) {
        engine.renderStats(framebuffer)
      }
    }
  })
}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()

  if (resizeListener) {
    renderer.off("resize", resizeListener)
    resizeListener = null
  }

  if (stdinHandler) {
    process.stdin.off("data", stdinHandler)
    keyListener = null
  }

  renderer.root.remove("main")

  if (parentContainer) {
    renderer.root.remove("texture-loading-container")
    parentContainer = null
  }

  if (engine) {
    engine.destroy()
    engine = null
  }

  framebuffer = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
    memorySnapshotInterval: 2000,
  })

  await run(renderer)
  setupCommonDemoKeys(renderer)
}
