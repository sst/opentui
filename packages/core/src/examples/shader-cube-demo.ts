#!/usr/bin/env bun

import { createCliRenderer, CliRenderer, TextRenderable, BoxRenderable, FrameBufferRenderable } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { RGBA } from "../lib"
import { TextureUtils } from "../3d/TextureUtils"
import {
  Scene as ThreeScene,
  Mesh as ThreeMesh,
  PerspectiveCamera,
  Color,
  DirectionalLight as ThreeDirectionalLight,
  PointLight as ThreePointLight,
  MeshPhongMaterial,
  BoxGeometry,
  AmbientLight,
} from "three"
import * as Filters from "../post/filters"
import { DistortionEffect, VignetteEffect, BrightnessEffect, BlurEffect, BloomEffect } from "../post/filters"
import type { OptimizedBuffer } from "../buffer"
import { ThreeCliRenderer } from "../3d"

// State management for the demo
interface ShaderCubeDemoState {
  engine: ThreeCliRenderer
  sceneRoot: ThreeScene
  cameraNode: PerspectiveCamera
  mainLightNode: ThreeDirectionalLight
  pointLightNode: ThreePointLight
  ambientLightNode: AmbientLight
  lightVisualizerMesh: ThreeMesh
  cubeMeshNode: ThreeMesh
  materials: MeshPhongMaterial[]
  distortionEffectInstance: DistortionEffect
  vignetteEffectInstance: VignetteEffect
  brightnessEffectInstance: BrightnessEffect
  blurEffectInstance: BlurEffect
  bloomEffectInstance: BloomEffect
  filterFunctions: { name: string; func: ((buffer: OptimizedBuffer, deltaTime: number) => void) | null }[]
  currentFilterIndex: number
  time: number
  lightColorMode: number
  rotationEnabled: boolean
  showLightVisualizers: boolean
  customLightsEnabled: boolean
  currentMaterial: number
  manualMaterialSelection: boolean
  specularMapEnabled: boolean
  normalMapEnabled: boolean
  emissiveMapEnabled: boolean
  parentContainer: BoxRenderable
  backgroundBox: BoxRenderable
  lightVizText: TextRenderable
  lightColorText: TextRenderable
  customLightsText: TextRenderable
  materialToggleText: TextRenderable
  textureEffectsText: TextRenderable
  filterStatusText: TextRenderable
  param1StatusText: TextRenderable
  param2StatusText: TextRenderable
  controlsText: TextRenderable
  keyHandler: (key: Buffer) => void
  resizeHandler: (width: number, height: number) => void
  frameCallbackId: boolean
}

let demoState: ShaderCubeDemoState | null = null

export async function run(renderer: CliRenderer): Promise<void> {
  renderer.start()
  const WIDTH = renderer.terminalWidth
  const HEIGHT = renderer.terminalHeight
  const CAM_DISTANCE = 2
  const rotationSpeed = [0.2, 0.4, 0.1]

  const lightColors = [
    { color: [255, 220, 180], name: "Warm" },
    { color: [180, 220, 255], name: "Cool" },
    { color: [255, 100, 100], name: "Red" },
    { color: [100, 255, 100], name: "Green" },
    { color: [100, 100, 255], name: "Blue" },
    { color: [255, 255, 100], name: "Yellow" },
  ]

  // Create parent container for all UI elements
  const parentContainer = new BoxRenderable(renderer, {
    id: "shader-cube-container",
    zIndex: 10,
  })
  renderer.root.add(parentContainer)

  // Initialize effect instances
  const distortionEffectInstance = new DistortionEffect()
  const vignetteEffectInstance = new VignetteEffect()
  const brightnessEffectInstance = new BrightnessEffect()
  const blurEffectInstance = new BlurEffect(1)
  const bloomEffectInstance = new BloomEffect(0.7, 0.3, 2)

  const filterFunctions: { name: string; func: ((buffer: OptimizedBuffer, deltaTime: number) => void) | null }[] = [
    { name: "None", func: null },
    { name: "Scanlines", func: (buf, _dt) => Filters.applyScanlines(buf, 0.85) },
    { name: "Vignette", func: vignetteEffectInstance.apply.bind(vignetteEffectInstance) },
    { name: "Grayscale", func: (buf, _dt) => Filters.applyGrayscale(buf) },
    { name: "Sepia", func: (buf, _dt) => Filters.applySepia(buf) },
    { name: "Invert", func: (buf, _dt) => Filters.applyInvert(buf) },
    { name: "Noise", func: (buf, _dt) => Filters.applyNoise(buf, 0.05) },
    { name: "Blur", func: blurEffectInstance.apply.bind(blurEffectInstance) },
    { name: "Chromatic Aberration", func: (buf, _dt) => Filters.applyChromaticAberration(buf, 2) },
    { name: "ASCII Art", func: (buf, _dt) => Filters.applyAsciiArt(buf) },
    { name: "Bloom", func: bloomEffectInstance.apply.bind(bloomEffectInstance) },
    { name: "Distortion", func: distortionEffectInstance.apply.bind(distortionEffectInstance) },
    { name: "Brightness", func: brightnessEffectInstance.apply.bind(brightnessEffectInstance) },
  ]

  // Box in the background to show alpha channel works
  const backgroundBox = new BoxRenderable(renderer, {
    id: "shader-cube-box",
    position: "absolute",
    left: 5,
    top: 5,
    width: WIDTH - 10,
    height: HEIGHT - 10,
    backgroundColor: "#131336",
    zIndex: 0,
    borderStyle: "single",
    borderColor: "#FFFFFF",
    title: "Shader Cube Demo",
    titleAlignment: "center",
    border: true,
  })
  parentContainer.add(backgroundBox)

  const framebufferRenderable = new FrameBufferRenderable(renderer, {
    id: "shader-cube-main",
    width: WIDTH,
    height: HEIGHT,
    zIndex: 10,
    respectAlpha: true,
  })
  renderer.root.add(framebufferRenderable)
  const { frameBuffer: framebuffer } = framebufferRenderable

  const engine = new ThreeCliRenderer(renderer, {
    width: WIDTH,
    height: HEIGHT,
    focalLength: 8,
    backgroundColor: RGBA.fromInts(0, 0, 0, 0),
    alpha: true,
  })
  await engine.init()

  const sceneRoot = new ThreeScene()

  const mainLightNode = new ThreeDirectionalLight(new Color(1, 1, 1), 0.8)
  mainLightNode.position.set(-10, -5, 1)
  mainLightNode.target.position.set(0, 0, 0)
  mainLightNode.name = "main_light"

  sceneRoot.add(mainLightNode)
  sceneRoot.add(mainLightNode.target)

  const pointLightNode = new ThreePointLight(new Color(1, 220 / 255, 180 / 255), 2.0, 4)
  pointLightNode.position.set(1.5, 0, 0)
  pointLightNode.name = "point_light"
  sceneRoot.add(pointLightNode)

  const ambientLightNode = new AmbientLight(new Color(0.25, 0.25, 0.25), 1)
  ambientLightNode.name = "ambient_light"
  sceneRoot.add(ambientLightNode)

  const lightVisualizerGeometry = new BoxGeometry(0.2, 0.2, 0.2)
  const lightVisualizerMaterial = new MeshPhongMaterial({
    color: 0x000000,
    emissive: new Color(1.0, 0.8, 0.4),
    emissiveIntensity: 1.0,
    shininess: 0,
  })
  const lightVisualizerMesh = new ThreeMesh(lightVisualizerGeometry, lightVisualizerMaterial)
  lightVisualizerMesh.name = "light_viz"
  lightVisualizerMesh.position.copy(pointLightNode.position)
  sceneRoot.add(lightVisualizerMesh)

  // Create textures
  const redTexture = TextureUtils.createCheckerboard(
    256,
    new Color(255 / 255, 40 / 255, 40 / 255),
    new Color(180 / 255, 10 / 255, 10 / 255),
  )
  const greenTexture = TextureUtils.createCheckerboard(
    256,
    new Color(40 / 255, 255 / 255, 40 / 255),
    new Color(10 / 255, 180 / 255, 10 / 255),
  )
  const blueTexture = TextureUtils.createCheckerboard(
    256,
    new Color(40 / 255, 40 / 255, 255 / 255),
    new Color(10 / 255, 10 / 255, 180 / 255),
  )
  const yellowTexture = TextureUtils.createCheckerboard(
    256,
    new Color(255 / 255, 255 / 255, 40 / 255),
    new Color(180 / 255, 180 / 255, 10 / 255),
  )
  const cyanTexture = TextureUtils.createCheckerboard(
    256,
    new Color(40 / 255, 255 / 255, 255 / 255),
    new Color(10 / 255, 180 / 255, 180 / 255),
  )
  const magentaTexture = TextureUtils.createCheckerboard(
    256,
    new Color(255 / 255, 40 / 255, 255 / 255),
    new Color(180 / 255, 10 / 255, 180 / 255),
  )
  const specularMapTexture = TextureUtils.createGradient(
    256,
    new Color(1, 1, 1),
    new Color(0.2, 0.2, 0.2),
    "horizontal",
  )
  const emissiveMapTexture = TextureUtils.createGradient(256, new Color(1, 0.6, 0), new Color(0, 0, 0), "radial")
  const normalMapTexture = TextureUtils.createNoise(
    256,
    2,
    3,
    new Color(127 / 255, 127 / 255, 255 / 255),
    new Color(127 / 255, 127 / 255, 127 / 255),
  )

  const materials: MeshPhongMaterial[] = [
    new MeshPhongMaterial({ map: redTexture, shininess: 30, specular: new Color(0.8, 0.8, 0.8) }),
    new MeshPhongMaterial({ map: greenTexture, shininess: 30, specular: new Color(0.8, 0.8, 0.8) }),
    new MeshPhongMaterial({ map: blueTexture, shininess: 30, specular: new Color(0.8, 0.8, 0.8) }),
    new MeshPhongMaterial({ map: yellowTexture, shininess: 30, specular: new Color(0.8, 0.8, 0.8) }),
    new MeshPhongMaterial({ map: cyanTexture, shininess: 30, specular: new Color(0.8, 0.8, 0.8) }),
    new MeshPhongMaterial({ map: magentaTexture, shininess: 30, specular: new Color(0.8, 0.8, 0.8) }),
    new MeshPhongMaterial({
      color: new Color(1, 1, 1),
      specular: new Color(1, 1, 1),
      shininess: 80,
    }),
  ]

  const cubeGeometry = new BoxGeometry(1.0, 1.0, 1.0)
  const cubeMeshNode = new ThreeMesh(cubeGeometry, materials[0])
  cubeMeshNode.name = "cube"

  sceneRoot.add(cubeMeshNode)

  const cameraNode = new PerspectiveCamera(45, engine.aspectRatio, 1.0, 100.0)
  cameraNode.position.set(0, 0, CAM_DISTANCE)
  cameraNode.name = "main_camera"

  sceneRoot.add(cameraNode)
  engine.setActiveCamera(cameraNode)

  // Initialize state variables
  let currentFilterIndex = 0
  let time = 0
  let lightColorMode = 0
  let rotationEnabled = true
  let showLightVisualizers = true
  let customLightsEnabled = true
  let currentMaterial = 0
  let manualMaterialSelection = false
  let specularMapEnabled = false
  let normalMapEnabled = false
  let emissiveMapEnabled = false

  // Create UI elements
  let uiLine = 0
  const lightVizText = new TextRenderable(renderer, {
    id: "shader-light-viz",
    content: "Light Visualization: ON (V to toggle)",
    position: "absolute",
    left: 0,
    top: uiLine++,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(lightVizText)

  const lightColorText = new TextRenderable(renderer, {
    id: "shader-light-color",
    content: "Point Light: Warm (C to change)",
    position: "absolute",
    left: 0,
    top: uiLine++,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(lightColorText)

  const customLightsText = new TextRenderable(renderer, {
    id: "shader-custom-lights",
    content: "Custom Lights: ON (L to toggle)",
    position: "absolute",
    left: 0,
    top: uiLine++,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(customLightsText)

  const materialToggleText = new TextRenderable(renderer, {
    id: "shader-material-toggle",
    content: "Material: Auto-cycling (M to toggle, N to change)",
    position: "absolute",
    left: 0,
    top: uiLine++,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(materialToggleText)

  const textureEffectsText = new TextRenderable(renderer, {
    id: "shader-texture-effects",
    content: "Texture Effects: P-Specular [OFF] | B-Normal [OFF] | I-Emissive [OFF]",
    position: "absolute",
    left: 0,
    top: uiLine++,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(textureEffectsText)

  const filterStatusText = new TextRenderable(renderer, {
    id: "shader-filter-status",
    content: `Filter: ${filterFunctions[currentFilterIndex].name} (,/. to cycle)`,
    position: "absolute",
    left: 0,
    top: uiLine++,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(filterStatusText)

  const param1StatusText = new TextRenderable(renderer, {
    id: "shader-param1-status",
    content: ``,
    position: "absolute",
    left: 0,
    top: uiLine++,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  param1StatusText.visible = false
  parentContainer.add(param1StatusText)

  const param2StatusText = new TextRenderable(renderer, {
    id: "shader-param2-status",
    content: ``,
    position: "absolute",
    left: 0,
    top: uiLine++,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  param2StatusText.visible = false
  parentContainer.add(param2StatusText)

  const controlsText = new TextRenderable(renderer, {
    id: "shader-controls",
    content:
      "WASD: Move | QE: Rotate | ZX: Zoom | V: Light Viz | C: Light Color | L: Lights | M/N: Material | P/B/I: Maps | R: Reset | Space: Rotation | ,/. Filter | [/]{/} Param Adjust",
    position: "absolute",
    left: 0,
    top: HEIGHT - 2,
    fg: "#FFFFFF",
    zIndex: 20,
  })
  parentContainer.add(controlsText)

  function updateParameterUI() {
    const selectedFilter = filterFunctions[currentFilterIndex]
    let param1Text = ""
    let param2Text = ""
    let param1Visible = false
    let param2Visible = false

    switch (selectedFilter.name) {
      case "Distortion":
        param1Text = `Distortion Chance: ${distortionEffectInstance.glitchChancePerSecond.toFixed(2)} ([/])`
        param2Text = `Distortion Lines: ${distortionEffectInstance.maxGlitchLines} ({/})`
        param1Visible = true
        param2Visible = true
        break
      case "Vignette":
        param1Text = `Vignette Strength: ${vignetteEffectInstance.strength.toFixed(2)} ([/])`
        param1Visible = true
        break
      case "Brightness":
        param1Text = `Brightness Factor: ${brightnessEffectInstance.brightness.toFixed(2)} ([/])`
        param1Visible = true
        break
      case "Blur":
        param1Text = `Blur Radius: ${blurEffectInstance.radius} ([/])`
        param1Visible = true
        break
      case "Bloom":
        param1Text = `Bloom Strength: ${bloomEffectInstance.strength.toFixed(2)} ([/])`
        param2Text = `Bloom Radius: ${bloomEffectInstance.radius} ({/})`
        param1Visible = true
        param2Visible = true
        break
    }

    param1StatusText.content = param1Text
    param1StatusText.visible = param1Visible
    param2StatusText.content = param2Text
    param2StatusText.visible = param2Visible
  }

  function updateTextureEffectsUI() {
    textureEffectsText.content = `Texture Effects: P-Specular [${specularMapEnabled ? "ON" : "OFF"}] | B-Normal [${normalMapEnabled ? "ON" : "OFF"}] | I-Emissive [${emissiveMapEnabled ? "ON" : "OFF"}]`
  }

  const keyHandler = (key: Buffer) => {
    const keyStr = key.toString()
    const cubeObject = sceneRoot.getObjectByName("cube") as ThreeMesh | undefined

    if (keyStr === "w") cameraNode.translateY(0.5)
    else if (keyStr === "s") cameraNode.translateY(-0.5)
    else if (keyStr === "a") cameraNode.translateX(-0.5)
    else if (keyStr === "d") cameraNode.translateX(0.5)
    if (keyStr === "q") cameraNode.rotateY(0.1)
    else if (keyStr === "e") cameraNode.rotateY(-0.1)
    if (keyStr === "z") cameraNode.translateZ(1)
    else if (keyStr === "x") cameraNode.translateZ(-1)
    if (keyStr === "r") {
      cameraNode.position.set(0, 0, CAM_DISTANCE)
      cameraNode.rotation.set(0, 0, 0)
      cameraNode.lookAt(0, 0, 0)
    }
    if (keyStr === " ") rotationEnabled = !rotationEnabled

    // Toggle light visualization
    if (keyStr === "v") {
      showLightVisualizers = !showLightVisualizers
      const vizObject = sceneRoot.getObjectByName("light_viz")
      if (vizObject) {
        vizObject.visible = showLightVisualizers
      }
      lightVizText.content = `Light Visualization: ${showLightVisualizers ? "ON" : "OFF"} (V to toggle)`
    }

    // Add light color cycling
    if (keyStr === "c") {
      lightColorMode = (lightColorMode + 1) % lightColors.length
      const colorInfo = lightColors[lightColorMode]

      if (pointLightNode) {
        pointLightNode.color.setRGB(colorInfo.color[0] / 255, colorInfo.color[1] / 255, colorInfo.color[2] / 255)

        const vizObject = sceneRoot.getObjectByName("light_viz") as ThreeMesh | undefined
        if (vizObject && vizObject.material instanceof MeshPhongMaterial) {
          vizObject.material.emissive.setRGB(
            colorInfo.color[0] / 255,
            colorInfo.color[1] / 255,
            colorInfo.color[2] / 255,
          )
        }
      }
      lightColorText.content = `Point Light: ${colorInfo.name} (C to change)`
    }

    // Toggle custom lights
    if (keyStr === "l") {
      customLightsEnabled = !customLightsEnabled
      if (mainLightNode) mainLightNode.visible = customLightsEnabled
      if (pointLightNode) pointLightNode.visible = customLightsEnabled
      customLightsText.content = `Custom Lights: ${customLightsEnabled ? "ON" : "OFF"} (L to toggle)`
    }

    // Material toggling
    if (keyStr === "m") {
      manualMaterialSelection = !manualMaterialSelection
      materialToggleText.content = `Material: ${manualMaterialSelection ? "Manual" : "Auto-cycling"} (M to toggle, N to change)`
    }
    if (keyStr === "n") {
      currentMaterial = (currentMaterial + 1) % materials.length
      materialToggleText.content = `Material: ${manualMaterialSelection ? "Manual" : "Auto-cycling"} (#${currentMaterial}${currentMaterial === 6 ? " - White" : ""}) (M/N)`
      if (cubeObject) {
        const newMaterialInstance = materials[currentMaterial]
        cubeObject.material = newMaterialInstance
      }
    }

    // Toggle super sampling
    if (keyStr === "u") {
      engine.toggleSuperSampling()
    }

    // Toggle debug mode for console caller info
    if (keyStr === "k") {
      renderer.console.toggleDebugMode()
    }

    // Toggle texture effects
    let effectsChanged = false
    if (keyStr === "p") {
      specularMapEnabled = !specularMapEnabled
      effectsChanged = true
    } else if (keyStr === "b") {
      normalMapEnabled = !normalMapEnabled
      effectsChanged = true
    } else if (keyStr === "i") {
      emissiveMapEnabled = !emissiveMapEnabled
      effectsChanged = true
    }

    if (effectsChanged) {
      if (cubeObject) {
        const material = cubeObject.material as MeshPhongMaterial
        material.specularMap = specularMapEnabled ? specularMapTexture : null
        material.normalMap = normalMapEnabled ? normalMapTexture : null
        material.emissiveMap = emissiveMapEnabled ? emissiveMapTexture : null
        material.emissive = new Color(0, 0, 0)
        material.emissiveIntensity = emissiveMapEnabled ? 0.7 : 0.0
        material.needsUpdate = true
      }
      updateTextureEffectsUI()
    }

    let filterChanged = false
    if (keyStr === ",") {
      currentFilterIndex = (currentFilterIndex - 1 + filterFunctions.length) % filterFunctions.length
      filterChanged = true
    } else if (keyStr === ".") {
      currentFilterIndex = (currentFilterIndex + 1) % filterFunctions.length
      filterChanged = true
    }

    if (filterChanged) {
      const selectedFilter = filterFunctions[currentFilterIndex]
      renderer.clearPostProcessFns()
      if (selectedFilter.func) {
        renderer.addPostProcessFn(selectedFilter.func)
      }
      filterStatusText.content = `Filter: ${selectedFilter.name} (,/. to cycle)`
      updateParameterUI()
    }

    // Parameter Adjustment Keys ([ / ] and { / })
    let paramChanged = false
    const currentFilterName = filterFunctions[currentFilterIndex].name
    const height = renderer.terminalHeight

    if (keyStr === "[") {
      switch (currentFilterName) {
        case "Distortion":
          distortionEffectInstance.glitchChancePerSecond = Math.max(
            0,
            distortionEffectInstance.glitchChancePerSecond - 0.1,
          )
          paramChanged = true
          break
        case "Vignette":
          vignetteEffectInstance.strength = Math.max(0, vignetteEffectInstance.strength - 0.05)
          paramChanged = true
          break
        case "Brightness":
          brightnessEffectInstance.brightness = Math.max(0, brightnessEffectInstance.brightness - 0.05)
          paramChanged = true
          break
        case "Blur":
          blurEffectInstance.radius = Math.max(0, blurEffectInstance.radius - 1)
          paramChanged = true
          break
        case "Bloom":
          bloomEffectInstance.strength = Math.max(0, bloomEffectInstance.strength - 0.05)
          paramChanged = true
          break
      }
    } else if (keyStr === "]") {
      switch (currentFilterName) {
        case "Distortion":
          distortionEffectInstance.glitchChancePerSecond = Math.min(
            25,
            distortionEffectInstance.glitchChancePerSecond + 0.1,
          )
          paramChanged = true
          break
        case "Vignette":
          vignetteEffectInstance.strength = Math.min(5, vignetteEffectInstance.strength + 0.05)
          paramChanged = true
          break
        case "Brightness":
          brightnessEffectInstance.brightness = Math.min(50, brightnessEffectInstance.brightness + 0.05)
          paramChanged = true
          break
        case "Blur":
          blurEffectInstance.radius = Math.min(50, blurEffectInstance.radius + 1)
          paramChanged = true
          break
        case "Bloom":
          bloomEffectInstance.strength = Math.min(25, bloomEffectInstance.strength + 0.05)
          paramChanged = true
          break
      }
    }

    // Parameter 2 Adjustment ({/})
    if (keyStr === "{") {
      switch (currentFilterName) {
        case "Distortion":
          distortionEffectInstance.maxGlitchLines = Math.max(0, distortionEffectInstance.maxGlitchLines - 1)
          paramChanged = true
          break
        case "Bloom":
          bloomEffectInstance.radius = Math.max(0, bloomEffectInstance.radius - 1)
          paramChanged = true
          break
      }
    } else if (keyStr === "}") {
      switch (currentFilterName) {
        case "Distortion":
          distortionEffectInstance.maxGlitchLines = Math.min(height - 1, distortionEffectInstance.maxGlitchLines + 1)
          paramChanged = true
          break
        case "Bloom":
          bloomEffectInstance.radius = Math.min(20, bloomEffectInstance.radius + 1)
          paramChanged = true
          break
      }
    }

    if (paramChanged) {
      updateParameterUI()
    }
  }

  const resizeHandler = (width: number, height: number) => {
    framebuffer.resize(width, height)

    if (cameraNode) {
      cameraNode.aspect = engine.aspectRatio
      cameraNode.updateProjectionMatrix()
    }

    backgroundBox.width = width - 10
    backgroundBox.height = height - 10
    controlsText.y = height - 2
  }

  process.stdin.on("data", keyHandler)
  renderer.on("resize", resizeHandler)

  renderer.setFrameCallback(async (deltaMs) => {
    const deltaTime = deltaMs / 1000
    time += deltaTime
    const cubeObject = sceneRoot.getObjectByName("cube") as ThreeMesh | undefined

    if (rotationEnabled && cubeObject) {
      cubeObject.rotation.x += rotationSpeed[0] * deltaTime
      cubeObject.rotation.y += rotationSpeed[1] * deltaTime
      cubeObject.rotation.z += rotationSpeed[2] * deltaTime
    }

    if (pointLightNode) {
      const radius = 3
      const speed = 0.9
      pointLightNode.position.set(Math.sin(time * speed) * radius, 1.5, Math.cos(time * speed) * radius)

      const vizObject = sceneRoot.getObjectByName("light_viz")
      if (vizObject) {
        vizObject.position.copy(pointLightNode.position)
      }
    }

    if (cubeObject) {
      let materialIndex = currentMaterial
      if (!manualMaterialSelection) {
        materialIndex = Math.floor(time * 0.5) % (materials.length - 1)
      }

      if (materialIndex < materials.length && cubeObject.material !== materials[materialIndex]) {
        const newMaterialInstance = materials[materialIndex]
        cubeObject.material = newMaterialInstance

        const material = cubeObject.material as MeshPhongMaterial
        material.specularMap = specularMapEnabled ? specularMapTexture : null
        material.normalMap = normalMapEnabled ? normalMapTexture : null
        material.emissiveMap = emissiveMapEnabled ? emissiveMapTexture : null
        material.emissive = new Color(0, 0, 0)
        material.emissiveIntensity = emissiveMapEnabled ? 0.7 : 0.0
        material.needsUpdate = true
      }
    }

    engine.drawScene(sceneRoot, framebuffer, deltaTime)
  })

  // Store state for cleanup
  demoState = {
    engine,
    sceneRoot,
    cameraNode,
    mainLightNode,
    pointLightNode,
    ambientLightNode,
    lightVisualizerMesh,
    cubeMeshNode,
    materials,
    distortionEffectInstance,
    vignetteEffectInstance,
    brightnessEffectInstance,
    blurEffectInstance,
    bloomEffectInstance,
    filterFunctions,
    currentFilterIndex,
    time,
    lightColorMode,
    rotationEnabled,
    showLightVisualizers,
    customLightsEnabled,
    currentMaterial,
    manualMaterialSelection,
    specularMapEnabled,
    normalMapEnabled,
    emissiveMapEnabled,
    parentContainer,
    backgroundBox,
    lightVizText,
    lightColorText,
    customLightsText,
    materialToggleText,
    textureEffectsText,
    filterStatusText,
    param1StatusText,
    param2StatusText,
    controlsText,
    keyHandler,
    resizeHandler,
    frameCallbackId: true,
  }
}

export function destroy(renderer: CliRenderer): void {
  if (!demoState) return

  process.stdin.removeListener("data", demoState.keyHandler)
  renderer.root.removeListener("resize", demoState.resizeHandler)

  if (demoState.frameCallbackId) {
    renderer.clearFrameCallbacks()
  }

  demoState.engine.destroy()
  renderer.clearPostProcessFns()

  renderer.root.remove("shader-cube-main")
  renderer.root.remove("shader-cube-container")

  demoState = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  })

  await run(renderer)
  setupCommonDemoKeys(renderer)
}
