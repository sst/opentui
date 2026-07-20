#!/usr/bin/env bun

import {
  BoxRenderable,
  CliRenderer,
  RGBA,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
  type MouseEvent,
} from "@opentui/core"
import { ThreeRenderable, type ThreeRenderableOptions } from "@opentui/three"
import decodeWebP, { init as initWebPDecoder } from "@jsquash/webp/decode.js"
import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  BufferGeometry,
  Color,
  CompressedTexture,
  DataTexture,
  EquirectangularReflectionMapping,
  Euler,
  Fog,
  Frustum,
  LinearFilter,
  LinearSRGBColorSpace,
  Loader,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  RGBAFormat,
  RepeatWrapping,
  Scene,
  SkinnedMesh,
  Spherical,
  SRGBColorSpace,
  Texture,
  Vector3,
} from "three"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"
import { GLTFLoader, type GLTF, type GLTFLoaderPlugin, type GLTFParser } from "three/addons/loaders/GLTFLoader.js"
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

// @ts-ignore Bun embeds file imports in standalone executables.
import webpDecoderWasmPath from "@jsquash/webp/codec/dec/webp_dec.wasm" with { type: "file" }

const EXTENSION_NAME = "NEEDLE_progressive"
const TARGET_TRIANGLE_DENSITY = 200_000
const MAX_CONCURRENT_REQUESTS = 50
const DRACO_DECODER_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/"
const KTX2_TRANSCODER_PATH = "https://www.gstatic.com/basis-universal/versioned/2021-04-15-ba1c3e4/"
const HDR_URL = "https://threejs.org/examples/textures/equirectangular/quarry_01_1k.hdr"
const CAMERA_TARGET = new Vector3(-1, 2.1, 0)
const CAMERA_POSITION = new Vector3(-9, 2, -13)

const MODEL_DEFINITIONS = [
  {
    name: "Mobile Home",
    url: "https://cloud.needle.tools/-/assets/Z23hmXBZ2sPRdk-world/file",
    configure(model: Object3D): void {
      model.scale.multiplyScalar(0.1)
    },
  },
  {
    name: "Peachy Balloon",
    url: "https://cloud.needle.tools/-/assets/Z23hmXBZnlceI-ZnlceI-world/file",
    isAirship: true,
    configure(model: Object3D): void {
      model.scale.multiplyScalar(0.0005)
      model.position.set(1.6, 6, 7)
      model.rotation.set(0, Math.PI * 1.4, 0)
    },
  },
  {
    name: "The Forgotten Knight",
    url: "https://cloud.needle.tools/-/assets/Z23hmXBZ21QnG-Z21QnG-product/file",
    configure(model: Object3D): void {
      model.scale.multiplyScalar(0.5)
      model.position.set(2, 5.15, 2.3)
      model.rotation.set(0, Math.PI, 0)
    },
  },
] as const

interface ProgressiveLOD {
  path: string
  hash?: string
  width?: number
  height?: number
  density?: number
  densities?: number[]
}

interface ProgressiveExtension {
  guid: string
  lods: ProgressiveLOD[]
}

interface CapturedMesh {
  mesh: Mesh
  extension: ProgressiveExtension
  primitiveIndex: number
}

interface CapturedTexture {
  extension: ProgressiveExtension
  texture: Texture | null
}

interface TextureBinding {
  textureIndex: number
  slots: string[]
  colorSpace: typeof SRGBColorSpace | null
  channel: number
}

interface RootCapture {
  sourcePath: string
  meshes: CapturedMesh[]
  textures: Map<number, CapturedTexture>
  materials: Map<Material, number>
  materialDefinitions: unknown[]
}

interface MeshLODState {
  mesh: Mesh
  sourcePath: string
  extension: ProgressiveExtension
  primitiveIndex: number
  baseGeometry: BufferGeometry
  currentLevel: number
  requestedLevel: number | null
  requestVersion: number
  failedLevels: Set<number>
}

interface TextureLODState {
  material: Material
  slots: string[]
  sourcePath: string
  extension: ProgressiveExtension
  baseTexture: Texture | null
  currentTexture: Texture | null
  colorSpace: typeof SRGBColorSpace | null
  channel: number
  currentLevel: number
  requestedLevel: number | null
  requestVersion: number
  failedLevels: Set<number>
}

interface MeshViewState {
  frames: number
  lastTextureLevel: number
}

interface ProgressiveStats {
  loadedRequests: number
  failedRequests: number
  baseBytes: number
  progressiveBytes: number
  activeRequests: number
  queuedRequests: number
}

interface HDRData {
  width: number
  height: number
  data: Uint16Array | Float32Array
  type: DataTexture["type"]
}

class ProgressiveMetadataPlugin implements GLTFLoaderPlugin {
  public readonly name = EXTENSION_NAME

  constructor(
    private readonly parser: GLTFParser,
    private readonly capture: RootCapture,
  ) {}

  public afterRoot(): null {
    const json = this.parser.json as {
      meshes?: Array<{ extensions?: Record<string, ProgressiveExtension> }>
      textures?: Array<{ extensions?: Record<string, ProgressiveExtension> }>
      materials?: unknown[]
    }

    for (let index = 0; index < (json.textures?.length ?? 0); index++) {
      const extension = json.textures?.[index]?.extensions?.[EXTENSION_NAME]
      if (extension?.lods?.length) {
        this.capture.textures.set(index, { extension, texture: null })
      }
    }

    for (const [object, reference] of this.parser.associations) {
      if ((object as Mesh).isMesh && reference.meshes !== undefined) {
        const extension = json.meshes?.[reference.meshes]?.extensions?.[EXTENSION_NAME]
        if (extension?.lods?.length) {
          this.capture.meshes.push({
            mesh: object as Mesh,
            extension,
            primitiveIndex: (reference as typeof reference & { primitives?: number }).primitives ?? 0,
          })
        }
      }

      if ((object as Texture).isTexture && reference.textures !== undefined) {
        const texture = this.capture.textures.get(reference.textures)
        if (texture) texture.texture = object as Texture
      }

      if ((object as Material).isMaterial && reference.materials !== undefined) {
        this.capture.materials.set(object as Material, reference.materials)
      }
    }

    this.capture.materialDefinitions = json.materials ?? []
    return null
  }
}

class PassiveProgressivePlugin implements GLTFLoaderPlugin {
  public readonly name = EXTENSION_NAME
}

class OpenTUIWebPPlugin implements GLTFLoaderPlugin {
  public readonly name = "EXT_texture_webp"
  private readonly loader: BunWebPTextureLoader

  constructor(
    private readonly parser: GLTFParser,
    signal: AbortSignal,
  ) {
    this.loader = new BunWebPTextureLoader(parser.options.manager, signal)
  }

  public loadTexture(textureIndex: number): Promise<Texture> | null {
    const textureDefinition = this.parser.json.textures?.[textureIndex]
    if (!textureDefinition?.extensions?.[this.name]) return null
    return this.parser.loadTextureImage(textureIndex, textureDefinition.extensions[this.name].source, this.loader)
  }
}

class BunWebPTextureLoader extends Loader<Texture> {
  constructor(
    manager: GLTFParser["options"]["manager"],
    private readonly signal: AbortSignal,
  ) {
    super(manager)
  }

  public load(
    url: string,
    onLoad: (texture: Texture) => void,
    _onProgress?: unknown,
    onError?: (error: unknown) => void,
  ): void {
    this.manager.itemStart(url)
    void fetch(url, { signal: this.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`)
        return response.arrayBuffer()
      })
      .then((buffer) => decodeWebPBuffer(buffer))
      .then(({ data, width, height }) => {
        const texture = new DataTexture(data, width, height)
        texture.generateMipmaps = true
        texture.needsUpdate = true
        onLoad(texture)
        this.manager.itemEnd(url)
      })
      .catch((error) => {
        onError?.(error)
        this.manager.itemError(url)
        this.manager.itemEnd(url)
      })
  }
}

let webpDecoderInitPromise: Promise<void> | null = null

async function decodeWebPBuffer(buffer: ArrayBuffer): Promise<ImageData> {
  webpDecoderInitPromise ??= Bun.file(webpDecoderWasmPath)
    .arrayBuffer()
    .then((wasmBinary) => initWebPDecoder({ wasmBinary }))
  await webpDecoderInitPromise
  return decodeWebP(buffer)
}

class RequestQueue {
  private active = 0
  private destroyed = false
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  public get activeCount(): number {
    return this.active
  }

  public get queuedCount(): number {
    return this.waiting.length
  }

  public async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.destroyed) throw abortError()

    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }

    if (this.destroyed) throw abortError()
    this.active++

    try {
      return await task()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }

  public destroy(): void {
    this.destroyed = true
    for (const resume of this.waiting.splice(0)) resume()
  }
}

class OrbitThreeRenderable extends ThreeRenderable {
  private readonly target = CAMERA_TARGET.clone()
  private readonly initialTarget = CAMERA_TARGET.clone()
  private readonly initialPosition = CAMERA_POSITION.clone()
  private readonly spherical = new Spherical()
  private dragging = false
  private panning = false
  private lastX = 0
  private lastY = 0

  constructor(
    ctx: CliRenderer,
    private readonly cameraNode: PerspectiveCamera,
    options: ThreeRenderableOptions,
  ) {
    super(ctx, options)
    this.syncSpherical()
  }

  public rotate(deltaTheta: number, deltaPhi: number): void {
    this.spherical.theta += deltaTheta
    this.spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.spherical.phi + deltaPhi))
    this.updateCamera()
  }

  public zoom(factor: number): void {
    this.spherical.radius = Math.max(0.1, Math.min(20, this.spherical.radius * factor))
    this.updateCamera()
  }

  public pan(horizontal: number, vertical: number): void {
    const distanceScale = this.spherical.radius * 0.02
    const forward = this.target.clone().sub(this.cameraNode.position).normalize()
    const right = forward.clone().cross(this.cameraNode.up).normalize()
    const up = right.clone().cross(forward).normalize()
    this.target.addScaledVector(right, horizontal * distanceScale)
    this.target.addScaledVector(up, vertical * distanceScale)
    this.updateCamera()
  }

  public resetOrbit(): void {
    this.target.copy(this.initialTarget)
    this.cameraNode.position.copy(this.initialPosition)
    this.syncSpherical()
    this.updateCamera()
  }

  protected onMouseEvent(event: MouseEvent): void {
    if (event.type === "down" && (event.button === 0 || event.button === 2)) {
      this.dragging = true
      this.panning = event.button === 2
      this.lastX = event.x
      this.lastY = event.y
      event.stopPropagation()
      return
    }

    if (event.type === "drag" && this.dragging) {
      const deltaX = event.x - this.lastX
      const deltaY = event.y - this.lastY
      this.lastX = event.x
      this.lastY = event.y

      if (this.panning) {
        this.panFromDrag(deltaX, deltaY)
      } else {
        this.rotate(-deltaX * 0.0175, deltaY * 0.0225)
      }

      event.stopPropagation()
      return
    }

    if (event.type === "drag-end" || event.type === "up") {
      if (this.dragging) event.stopPropagation()
      this.dragging = false
      this.panning = false
      return
    }

    if (event.type === "scroll" && event.scroll) {
      this.zoom(event.scroll.direction === "up" ? 0.94 : 1.07)
      event.stopPropagation()
      event.preventDefault()
    }
  }

  private syncSpherical(): void {
    this.spherical.setFromVector3(this.cameraNode.position.clone().sub(this.target))
  }

  private updateCamera(): void {
    this.cameraNode.position.setFromSpherical(this.spherical).add(this.target)
    this.cameraNode.lookAt(this.target)
    this.cameraNode.updateMatrixWorld()
  }

  private panFromDrag(deltaX: number, deltaY: number): void {
    const distanceScale = this.spherical.radius * 0.009
    const forward = this.target.clone().sub(this.cameraNode.position).normalize()
    const right = forward.clone().cross(this.cameraNode.up).normalize()
    const up = right.clone().cross(forward).normalize()
    this.target.addScaledVector(right, -deltaX * distanceScale)
    this.target.addScaledVector(up, deltaY * distanceScale * 1.5)
    this.updateCamera()
  }
}

class ProgressiveGLTFManager {
  private readonly abortController = new AbortController()
  private readonly queue = new RequestQueue(MAX_CONCURRENT_REQUESTS)
  private readonly dracoLoader = new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH)
  private readonly ktx2Loader = new KTX2Loader().setTranscoderPath(KTX2_TRANSCODER_PATH)
  private readonly meshStates = new Map<Mesh, MeshLODState>()
  private readonly textureStates = new Map<Material, TextureLODState[]>()
  private readonly meshViewStates = new WeakMap<Mesh, MeshViewState>()
  private readonly meshResourceCache = new Map<string, Promise<BufferGeometry[] | null>>()
  private readonly textureResourceCache = new Map<string, Promise<Texture | null>>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly ownedGeometries = new Set<BufferGeometry>()
  private readonly ownedMaterials = new Set<Material>()
  private readonly ownedTextures = new Set<Texture>()
  private readonly projectionScreenMatrix = new Matrix4()
  private readonly frustum = new Frustum()
  private readonly worldBox = new Box3()
  private readonly projectedBox = new Box3()
  private readonly viewBox = new Box3()
  private readonly boxSize = new Vector3()
  private readonly viewBoxSize = new Vector3()
  private readonly insidePoint = new Vector3()
  private destroyed = false
  private paused = false
  private loadedRequests = 0
  private failedRequests = 0
  private baseBytes = 0
  private progressiveBytes = 0

  constructor(private readonly onStatus: () => void) {
    acquireProgressEventPolyfill()

    // bun-webgpu requests no optional texture-compression features. Telling KTX2Loader that none are available
    // makes Basis transcode to portable RGBA data instead of selecting a GPU format the device did not request.
    this.ktx2Loader.detectSupport({
      isWebGPURenderer: true,
      hasFeature: () => false,
    } as never)
  }

  public get stats(): ProgressiveStats {
    return {
      loadedRequests: this.loadedRequests,
      failedRequests: this.failedRequests,
      baseBytes: this.baseBytes,
      progressiveBytes: this.progressiveBytes,
      activeRequests: this.queue.activeCount,
      queuedRequests: this.queue.queuedCount,
    }
  }

  public get isPaused(): boolean {
    return this.paused
  }

  public togglePaused(): void {
    this.paused = !this.paused
    this.onStatus()
  }

  public loadRoot(url: string): Promise<{ gltf: GLTF; capture: RootCapture }> {
    const capture: RootCapture = {
      sourcePath: new URL(".", url).href,
      meshes: [],
      textures: new Map(),
      materials: new Map(),
      materialDefinitions: [],
    }
    return this.track(
      (async () => {
        const data = await this.loadBuffer(url, "base", true)
        const loader = this.createLoader((parser) => new ProgressiveMetadataPlugin(parser, capture))
        const gltf = await loader.parseAsync(data, capture.sourcePath)
        return { gltf, capture }
      })(),
    )
  }

  public loadBuffer(url: string, kind: "base" | "progressive", progressiveHeader = false): Promise<ArrayBuffer> {
    return this.track(
      this.queue.run(async () => {
        const response = await fetch(url, {
          signal: this.abortController.signal,
          headers: progressiveHeader ? { Accept: "*/*;progressive=allowed;usecase=default" } : undefined,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`)

        const buffer = await response.arrayBuffer()
        if (kind === "base") this.baseBytes += buffer.byteLength
        else this.progressiveBytes += buffer.byteLength
        this.onStatus()
        return buffer
      }),
    )
  }

  public addRoot(root: Object3D, capture: RootCapture): void {
    this.normalizeObjectTextures(root)
    this.trackObjectResources(root)

    for (const captured of capture.meshes) {
      const baseLevel = captured.extension.lods.length
      this.meshStates.set(captured.mesh, {
        mesh: captured.mesh,
        sourcePath: capture.sourcePath,
        extension: captured.extension,
        primitiveIndex: captured.primitiveIndex,
        baseGeometry: captured.mesh.geometry,
        currentLevel: baseLevel,
        requestedLevel: null,
        requestVersion: 0,
        failedLevels: new Set(),
      })
      this.meshViewStates.set(captured.mesh, { frames: 0, lastTextureLevel: -1 })
      this.ownedGeometries.add(captured.mesh.geometry)
    }

    for (const [material, materialIndex] of capture.materials) {
      const definition = capture.materialDefinitions[materialIndex]
      const states: TextureLODState[] = []

      for (const binding of getTextureBindings(definition)) {
        const captured = capture.textures.get(binding.textureIndex)
        if (!captured) continue

        const assigned = binding.slots
          .map((slot) => (material as unknown as Record<string, unknown>)[slot])
          .find((value): value is Texture => (value as Texture | undefined)?.isTexture === true)
        const baseTexture = assigned ?? captured.texture

        if (baseTexture) this.ownedTextures.add(baseTexture)
        states.push({
          material,
          slots: binding.slots,
          sourcePath: capture.sourcePath,
          extension: captured.extension,
          baseTexture,
          currentTexture: baseTexture,
          colorSpace: binding.colorSpace,
          channel: binding.channel,
          currentLevel: captured.extension.lods.length,
          requestedLevel: null,
          requestVersion: 0,
          failedLevels: new Set(),
        })
      }

      if (states.length > 0) this.textureStates.set(material, states)
    }

    root.traverse((object) => {
      if ((object as Mesh).isMesh && !this.meshViewStates.has(object as Mesh)) {
        this.meshViewStates.set(object as Mesh, { frames: 0, lastTextureLevel: -1 })
      }
    })
  }

  public trackTexture(texture: Texture): void {
    this.ownedTextures.add(texture)
  }

  public disposeUnaccepted(gltf: GLTF): void {
    disposeGLTF(gltf)
  }

  public update(scene: Scene, camera: PerspectiveCamera, canvasHeight: number): void {
    if (this.destroyed || this.paused) return

    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
    this.projectionScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projectionScreenMatrix, camera.coordinateSystem)

    const materialTargets = new Map<Material, number>()

    scene.traverseVisible((object) => {
      if (!(object as Mesh).isMesh) return
      const mesh = object as Mesh
      const viewState = this.meshViewStates.get(mesh)
      if (!viewState) return
      viewState.frames++

      const skinnedMesh = mesh as SkinnedMesh
      if (skinnedMesh.isSkinnedMesh && (skinnedMesh.boundingSphere === null || viewState.frames % 30 === 0)) {
        skinnedMesh.computeBoundingSphere()
      }
      if (!this.frustum.intersectsObject(mesh) || viewState.frames <= 2) return

      const coverage = this.calculateScreenCoverage(camera, mesh, viewState.frames)
      const meshState = this.meshStates.get(mesh)
      if (meshState) this.requestMeshLevel(meshState, this.selectMeshLevel(meshState, coverage))

      const materials = asMaterials(mesh.material).filter((material) => this.textureStates.has(material))
      const textureStates = materials.flatMap((material) => this.textureStates.get(material) ?? [])
      if (textureStates.length > 0) {
        const target = this.selectTextureLevel(textureStates, viewState, coverage, canvasHeight)
        for (const material of materials) {
          const previous = materialTargets.get(material)
          materialTargets.set(material, previous === undefined ? target : Math.min(previous, target))
        }
      }
    })

    for (const [material, target] of materialTargets) {
      for (const state of this.textureStates.get(material) ?? []) {
        this.requestTextureLevel(state, target)
      }
    }
  }

  public destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.abortController.abort()
    this.queue.destroy()

    for (const state of this.meshStates.values()) state.requestVersion++
    for (const states of this.textureStates.values()) {
      for (const state of states) state.requestVersion++
    }

    // Dispose anything that may have reached the renderer before its WebGPU caches are torn down.
    this.disposeOwnedResources()
    const pending = [...this.pending]
    void Promise.allSettled(pending).then(() => {
      try {
        // Decoder work that was already running can produce unrendered resources after the synchronous pass.
        this.disposeOwnedResources()
      } finally {
        this.dracoLoader.dispose()
        this.ktx2Loader.dispose()
        releaseProgressEventPolyfill()
      }
    })
  }

  private createLoader(
    plugin: (parser: GLTFParser) => GLTFLoaderPlugin = () => new PassiveProgressivePlugin(),
  ): GLTFLoader {
    const loader = new GLTFLoader()
      .setDRACOLoader(this.dracoLoader)
      .setKTX2Loader(this.ktx2Loader)
      .setMeshoptDecoder(MeshoptDecoder)
    loader.register(plugin)
    loader.register((parser) => new OpenTUIWebPPlugin(parser, this.abortController.signal))
    return loader
  }

  private calculateScreenCoverage(camera: PerspectiveCamera, mesh: Mesh, frame: number): number {
    const geometry = mesh.geometry
    let boundingBox = geometry.boundingBox

    const skinnedMesh = mesh as SkinnedMesh
    if (skinnedMesh.isSkinnedMesh) {
      if (skinnedMesh.boundingBox === null || frame % 30 === 0) skinnedMesh.computeBoundingBox()
      boundingBox = skinnedMesh.boundingBox
    } else if (!boundingBox) {
      geometry.computeBoundingBox()
      boundingBox = geometry.boundingBox
    }
    if (!boundingBox) return 0

    this.worldBox.copy(boundingBox).applyMatrix4(mesh.matrixWorld)
    const min = this.worldBox.min
    const max = this.worldBox.max
    this.insidePoint.set((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, min.z).applyMatrix4(this.projectionScreenMatrix)
    if (this.insidePoint.z < 0) return Number.POSITIVE_INFINITY

    this.projectedBox.copy(this.worldBox).applyMatrix4(this.projectionScreenMatrix)
    this.projectedBox.getSize(this.boxSize).multiplyScalar(0.5)
    this.boxSize.x *= camera.aspect

    this.viewBox.copy(this.worldBox).applyMatrix4(camera.matrixWorldInverse)
    this.viewBox.getSize(this.viewBoxSize)
    const viewXY = Math.max(this.viewBoxSize.x, this.viewBoxSize.y)
    const projectedXY = Math.max(this.boxSize.x, this.boxSize.y)
    if (viewXY > 0 && projectedXY > 0) this.boxSize.z = (this.viewBoxSize.z / viewXY) * projectedXY

    return Math.max(this.boxSize.x, this.boxSize.y, this.boxSize.z)
  }

  private selectMeshLevel(state: MeshLODState, coverage: number): number {
    if (!Number.isFinite(coverage)) return 0
    if (coverage <= 0) return state.extension.lods.length

    for (let level = 0; level < state.extension.lods.length; level++) {
      const lod = state.extension.lods[level]
      const density = lod.densities?.[state.primitiveIndex] ?? lod.density ?? 0.00001
      if (density / coverage < TARGET_TRIANGLE_DENSITY) return level
    }

    return state.extension.lods.length
  }

  private selectTextureLevel(
    states: TextureLODState[],
    viewState: MeshViewState,
    coverage: number,
    canvasHeight: number,
  ): number {
    const maxCount = Math.max(...states.map((state) => state.extension.lods.length))
    if (viewState.lastTextureLevel < 0) {
      viewState.lastTextureLevel = Math.max(0, maxCount - 1)
      return viewState.lastTextureLevel
    }

    const pixelSizeOnScreen = canvasHeight * coverage * 4
    let selected = 0

    for (let level = maxCount - 1; level >= 0; level--) {
      const maxHeight = Math.max(
        0,
        ...states.map((state) => state.extension.lods[level]?.height ?? state.extension.lods[level]?.width ?? 0),
      )
      if (maxHeight > pixelSizeOnScreen || level === 0) {
        selected = level
        break
      }
    }

    viewState.lastTextureLevel = selected
    return selected
  }

  private requestMeshLevel(state: MeshLODState, target: number): void {
    if (state.currentLevel === target || state.requestedLevel === target || state.failedLevels.has(target)) return

    if (target >= state.extension.lods.length) {
      state.requestVersion++
      state.requestedLevel = null
      state.mesh.geometry = state.baseGeometry
      const skinnedMesh = state.mesh as SkinnedMesh
      if (skinnedMesh.isSkinnedMesh) {
        skinnedMesh.computeBoundingBox()
        skinnedMesh.computeBoundingSphere()
      }
      state.currentLevel = state.extension.lods.length
      return
    }

    const version = ++state.requestVersion
    state.requestedLevel = target
    const promise = this.loadMeshResource(state, target)
    void promise.then((geometries) => {
      if (state.requestVersion !== version || this.destroyed) return
      state.requestedLevel = null
      const geometry = geometries?.[state.primitiveIndex]
      if (!geometry) {
        state.failedLevels.add(target)
        return
      }
      state.mesh.geometry = geometry
      const skinnedMesh = state.mesh as SkinnedMesh
      if (skinnedMesh.isSkinnedMesh) {
        skinnedMesh.computeBoundingBox()
        skinnedMesh.computeBoundingSphere()
      }
      state.currentLevel = target
      this.loadedRequests++
      this.onStatus()
    })
  }

  private requestTextureLevel(state: TextureLODState, target: number): void {
    if (state.extension.lods.length === 0) return
    const availableTarget = Math.min(target, state.extension.lods.length - 1)
    const effectiveLevel = Math.min(state.currentLevel, state.requestedLevel ?? Number.POSITIVE_INFINITY)

    // Texture refinement is monotonic in the upstream manager: once a sharper texture is loaded it is retained.
    if (
      availableTarget >= effectiveLevel ||
      state.requestedLevel === availableTarget ||
      state.failedLevels.has(availableTarget)
    )
      return

    const version = ++state.requestVersion
    state.requestedLevel = availableTarget
    const promise = this.loadTextureResource(state, availableTarget)
    void promise.then((loaded) => {
      if (state.requestVersion !== version || this.destroyed) return
      state.requestedLevel = null
      if (!loaded) {
        state.failedLevels.add(availableTarget)
        return
      }

      const texture = loaded.clone()
      copyTextureSettings(state.baseTexture, texture)
      if (state.colorSpace) texture.colorSpace = state.colorSpace
      texture.channel = state.channel
      texture.needsUpdate = true
      this.ownedTextures.add(texture)

      const materialRecord = state.material as unknown as Record<string, unknown>
      for (const slot of state.slots) materialRecord[slot] = texture
      state.material.needsUpdate = true
      if (state.currentTexture && state.currentTexture !== state.baseTexture) {
        this.ownedTextures.delete(state.currentTexture)
        state.currentTexture.dispose()
      }
      state.currentTexture = texture
      state.currentLevel = availableTarget
      this.loadedRequests++
      this.onStatus()
    })
  }

  private loadMeshResource(state: MeshLODState, level: number): Promise<BufferGeometry[] | null> {
    const lod = state.extension.lods[level]
    const url = resolveLODURL(state.sourcePath, lod)
    const key = `mesh:${url}:${state.extension.guid}`
    const cached = this.meshResourceCache.get(key)
    if (cached) return cached

    const promise = this.track(
      this.queue
        .run(async () => {
          const gltf = await this.loadChild(url)
          const index = findProgressiveIndex(gltf.parser.json.meshes, state.extension.guid)
          if (index < 0) {
            disposeGLTF(gltf)
            throw new Error(`Mesh ${state.extension.guid} was not found in ${url}`)
          }

          const dependency = (await gltf.parser.getDependency("mesh", index)) as Object3D
          const geometries = (dependency as Mesh).isMesh
            ? [(dependency as Mesh).geometry]
            : dependency.children
                .filter((child): child is Mesh => (child as Mesh).isMesh)
                .map((child) => child.geometry)
          const keep = new Set(geometries)
          disposeGLTF(gltf, keep)
          for (const geometry of geometries) this.ownedGeometries.add(geometry)
          return geometries
        })
        .catch((error) => {
          this.reportRequestError(error)
          return null
        }),
    )
    this.meshResourceCache.set(key, promise)
    return promise
  }

  private loadTextureResource(state: TextureLODState, level: number): Promise<Texture | null> {
    const lod = state.extension.lods[level]
    const url = resolveLODURL(state.sourcePath, lod)
    const key = `texture:${url}:${state.extension.guid}`
    const cached = this.textureResourceCache.get(key)
    if (cached) return cached

    const promise = this.track(
      this.queue
        .run(async () => {
          const gltf = await this.loadChild(url)
          const index = findProgressiveIndex(gltf.parser.json.textures, state.extension.guid)
          if (index < 0) {
            disposeGLTF(gltf)
            throw new Error(`Texture ${state.extension.guid} was not found in ${url}`)
          }

          const texture = (await gltf.parser.getDependency("texture", index)) as Texture | null
          const portableTexture = texture ? toPortableTexture(texture) : null
          disposeGLTF(gltf, undefined, portableTexture ? new Set([portableTexture]) : undefined)
          if (portableTexture) this.ownedTextures.add(portableTexture)
          return portableTexture
        })
        .catch((error) => {
          this.reportRequestError(error)
          return null
        }),
    )
    this.textureResourceCache.set(key, promise)
    void promise.then((texture) => {
      queueMicrotask(() => {
        this.textureResourceCache.delete(key)
        if (!texture || !this.ownedTextures.delete(texture)) return
        texture.dispose()
      })
    })
    return promise
  }

  private async loadChild(url: string): Promise<GLTF> {
    const response = await fetch(url, { signal: this.abortController.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`)
    const data = await response.arrayBuffer()
    this.progressiveBytes += data.byteLength
    this.onStatus()
    return this.createLoader().parseAsync(data, new URL(".", url).href)
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    const remove = () => this.pending.delete(promise)
    void promise.then(remove, remove)
    return promise
  }

  private trackObjectResources(root: Object3D): void {
    root.traverse((object) => {
      if (!(object as Mesh).isMesh) return
      const mesh = object as Mesh
      this.ownedGeometries.add(mesh.geometry)
      for (const material of asMaterials(mesh.material)) {
        this.ownedMaterials.add(material)
        for (const texture of getMaterialTextures(material)) this.ownedTextures.add(texture)
      }
    })
  }

  private normalizeObjectTextures(root: Object3D): void {
    const replacements = new Map<Texture, Texture>()

    root.traverse((object) => {
      if (!(object as Mesh).isMesh) return
      for (const material of asMaterials((object as Mesh).material)) {
        const materialRecord = material as unknown as Record<string, unknown>
        for (const [slot, value] of Object.entries(materialRecord)) {
          if (!(value as Texture | undefined)?.isTexture) continue
          const texture = value as Texture
          const replacement = replacements.get(texture) ?? toPortableTexture(texture)
          if (replacement === texture) continue
          replacements.set(texture, replacement)
          materialRecord[slot] = replacement
          material.needsUpdate = true
        }
      }
    })

    for (const original of replacements.keys()) original.dispose()
  }

  private disposeOwnedResources(): void {
    for (const geometry of this.ownedGeometries) geometry.dispose()
    for (const material of this.ownedMaterials) material.dispose()
    for (const texture of this.ownedTextures) texture.dispose()
    this.ownedGeometries.clear()
    this.ownedMaterials.clear()
    this.ownedTextures.clear()
  }

  private reportRequestError(error: unknown): void {
    if (isAbortError(error) || this.destroyed) return
    this.failedRequests++
    this.onStatus()
  }
}

class ProgressiveLodDemo {
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(40, 1, 0.1, 40)
  private readonly mixer = new AnimationMixer(this.scene)
  private readonly manager: ProgressiveGLTFManager
  private readonly parent: BoxRenderable
  private readonly threeRenderable: OrbitThreeRenderable
  private readonly statusText: TextRenderable
  private readonly controlsText: TextRenderable
  private readonly frameCallback: (deltaMs: number) => Promise<void>
  private readonly keyListener: (key: KeyEvent) => void
  private readonly resizeListener: (width: number, height: number) => void
  private airshipModel: Object3D | null = null
  private destroyed = false
  private elapsed = 0
  private animationPaused = false
  private loadedModels = 0
  private failedModels = 0
  private environmentLoaded = false

  constructor(private readonly renderer: CliRenderer) {
    renderer.start()
    renderer.setBackgroundColor("#192022")

    this.scene.background = new Color("#192022")
    this.scene.backgroundBlurriness = 0.5
    this.scene.fog = new Fog("#131055", 15, 50)
    this.camera.position.copy(CAMERA_POSITION)
    this.camera.lookAt(CAMERA_TARGET)

    this.manager = new ProgressiveGLTFManager(() => this.refreshStatus())

    this.frameCallback = async (deltaMs) => {
      if (this.destroyed) return
      const delta = deltaMs / 1000
      if (!this.animationPaused) {
        this.elapsed += delta
        this.mixer.update(delta)
        // Preserve the source example's cumulative, frame-based balloon bob.
        if (this.airshipModel) this.airshipModel.position.y += Math.sin(this.elapsed) * 0.002
      }
      this.manager.update(this.scene, this.camera, Math.max(1, this.threeRenderable.renderer.renderingHeight))
    }
    renderer.setFrameCallback(this.frameCallback)

    this.threeRenderable = new OrbitThreeRenderable(renderer, this.camera, {
      id: "gltf-progressive-lod-scene",
      width: renderer.terminalWidth,
      height: renderer.terminalHeight,
      position: "absolute",
      left: 0,
      top: 0,
      zIndex: 10,
      scene: this.scene,
      camera: this.camera,
      renderer: {
        focalLength: 8,
        backgroundColor: RGBA.fromInts(25, 32, 34, 255),
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1,
        outputColorSpace: SRGBColorSpace,
      },
    })
    renderer.root.add(this.threeRenderable)

    this.parent = new BoxRenderable(renderer, {
      id: "gltf-progressive-lod-overlay",
      zIndex: 20,
    })
    renderer.root.add(this.parent)

    this.parent.add(
      new TextRenderable(renderer, {
        id: "gltf-progressive-lod-title",
        content: "three.js GLTF progressive loading -> OpenTUI WebGPU",
        position: "absolute",
        left: 1,
        top: 0,
        fg: "#F8FAFC",
        zIndex: 21,
      }),
    )
    this.parent.add(
      new TextRenderable(renderer, {
        id: "gltf-progressive-lod-credit-one",
        content: "Mobile Home & Peachy Balloon by ConradJustin | The Forgotten Knight by Dark Igorek",
        position: "absolute",
        left: 1,
        top: 1,
        fg: "#F5D76E",
        zIndex: 21,
      }),
    )
    this.parent.add(
      new TextRenderable(renderer, {
        id: "gltf-progressive-lod-credit-two",
        content:
          "Sources: https://sketchfab.com/3d-models/mobile-home-5240b1dbc29c4ea28be7f91b3638951a | https://sketchfab.com/3d-models/the-forgotten-knight-d14eb14d83bd4e7ba7cbe443d76a10fd",
        position: "absolute",
        left: 1,
        top: 2,
        fg: "#CBD5E1",
        zIndex: 21,
      }),
    )
    this.parent.add(
      new TextRenderable(renderer, {
        id: "gltf-progressive-lod-credit-three",
        content:
          "Progressive: https://www.npmjs.com/package/@needle-tools/gltf-progressive | Quarry 01: https://hdrihaven.com/hdri/?h=quarry_01 from https://hdrihaven.com | network required",
        position: "absolute",
        left: 1,
        top: 3,
        fg: "#CBD5E1",
        zIndex: 21,
      }),
    )

    this.statusText = new TextRenderable(renderer, {
      id: "gltf-progressive-lod-status",
      content: "Loading base GLBs and environment...",
      position: "absolute",
      left: 1,
      top: 4,
      fg: "#7DD3FC",
      zIndex: 21,
    })
    this.parent.add(this.statusText)

    this.controlsText = new TextRenderable(renderer, {
      id: "gltf-progressive-lod-controls",
      content: "",
      position: "absolute",
      left: 1,
      top: Math.max(0, renderer.terminalHeight - 2),
      fg: "#E2E8F0",
      zIndex: 21,
    })
    this.parent.add(this.controlsText)

    this.resizeListener = (width, height) => {
      this.threeRenderable.width = width
      this.threeRenderable.height = height
      this.controlsText.y = Math.max(0, height - 2)
      this.controlsText.visible = height > 7
      this.refreshStatus()
      this.refreshControls(width)
    }
    renderer.on("resize", this.resizeListener)

    this.keyListener = (key) => {
      if (key.name === "left") this.threeRenderable.rotate(-0.06, 0)
      else if (key.name === "right") this.threeRenderable.rotate(0.06, 0)
      else if (key.name === "up") this.threeRenderable.rotate(0, -0.05)
      else if (key.name === "down") this.threeRenderable.rotate(0, 0.05)
      else if (key.name === "a") this.threeRenderable.pan(-1, 0)
      else if (key.name === "d") this.threeRenderable.pan(1, 0)
      else if (key.name === "w") this.threeRenderable.pan(0, 1)
      else if (key.name === "s") this.threeRenderable.pan(0, -1)
      else if (key.name === "=" || key.name === "kpequal" || key.name === "kpplus") this.threeRenderable.zoom(0.94)
      else if (key.name === "-" || key.name === "kpminus") this.threeRenderable.zoom(1.07)
      else if (key.name === "r") this.threeRenderable.resetOrbit()
      else if (key.name === "space") {
        this.animationPaused = !this.animationPaused
        this.refreshStatus()
      } else if (key.name === "l") {
        this.manager.togglePaused()
      } else if (key.name === "p") {
        void this.threeRenderable.renderer.saveToFile(`gltf-progressive-lod-${Date.now()}.png`).catch(() => {
          if (!this.destroyed) this.refreshStatus("screenshot failed")
        })
      }
    }
    renderer.keyInput.on("keypress", this.keyListener)

    this.refreshControls(renderer.terminalWidth)
    this.controlsText.visible = renderer.terminalHeight > 7
    void this.loadScene()
  }

  public destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.renderer.removeFrameCallback(this.frameCallback)
    this.renderer.off("resize", this.resizeListener)
    this.renderer.keyInput.off("keypress", this.keyListener)
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.scene)
    this.manager.destroy()
    this.threeRenderable.destroy()
    this.parent.destroyRecursively()
  }

  private async loadScene(): Promise<void> {
    const tasks: Promise<void>[] = [this.loadEnvironment()]
    for (const definition of MODEL_DEFINITIONS) tasks.push(this.loadModel(definition))
    await Promise.allSettled(tasks)
    if (!this.destroyed) this.refreshStatus()
  }

  private async loadEnvironment(): Promise<void> {
    try {
      const buffer = await this.manager.loadBuffer(HDR_URL, "base")
      const parsed = new RGBELoader().parse(buffer) as HDRData
      const texture = new DataTexture(parsed.data, parsed.width, parsed.height)
      texture.type = parsed.type
      texture.colorSpace = LinearSRGBColorSpace
      texture.minFilter = LinearFilter
      texture.magFilter = LinearFilter
      texture.generateMipmaps = false
      texture.flipY = true
      texture.mapping = EquirectangularReflectionMapping
      texture.needsUpdate = true

      if (this.destroyed) {
        texture.dispose()
        return
      }

      this.manager.trackTexture(texture)
      this.scene.environment = texture
      this.scene.environmentRotation = new Euler(0, Math.PI / -2, 0, "XYZ")
      this.environmentLoaded = true
      this.refreshStatus()
    } catch (error) {
      if (!isAbortError(error) && !this.destroyed) this.refreshStatus("HDR failed")
    }
  }

  private async loadModel(definition: (typeof MODEL_DEFINITIONS)[number]): Promise<void> {
    try {
      const { gltf, capture } = await this.manager.loadRoot(definition.url)
      if (this.destroyed) {
        this.manager.disposeUnaccepted(gltf)
        return
      }

      const model = gltf.scene
      definition.configure(model)
      this.scene.add(model)
      this.manager.addRoot(model, capture)
      if ("isAirship" in definition && definition.isAirship) this.airshipModel = model

      for (const animation of gltf.animations) this.mixer.clipAction(animation).play()
      this.loadedModels++
      this.refreshStatus()
    } catch (error) {
      if (isAbortError(error) || this.destroyed) return
      this.failedModels++
      this.refreshStatus(`${definition.name} failed`)
    }
  }

  private refreshStatus(note?: string): void {
    if (!this.statusText) return
    const stats = this.manager.stats
    const activity = stats.activeRequests + stats.queuedRequests
    const flags = [
      this.environmentLoaded ? "HDR ready" : "HDR loading",
      this.animationPaused ? "animation paused" : null,
      this.manager.isPaused ? "LOD paused" : null,
      note,
    ].filter(Boolean)
    const content = [
      `Models ${this.loadedModels}/${MODEL_DEFINITIONS.length}${this.failedModels ? ` (${this.failedModels} failed)` : ""}`,
      `LOD ${stats.loadedRequests} loaded${stats.failedRequests ? `/${stats.failedRequests} failed` : ""}`,
      `${formatBytes(stats.baseBytes)} base + ${formatBytes(stats.progressiveBytes)} progressive`,
      activity ? `${stats.activeRequests} active, ${stats.queuedRequests} queued` : "idle",
      flags.join(", "),
    ].join(" | ")
    this.statusText.content = truncate(content, Math.max(1, this.renderer.terminalWidth - 2))
  }

  private refreshControls(width: number): void {
    this.controlsText.content = truncate(
      "Left drag/arrows: orbit | Right drag/WASD: pan | Wheel/+/-: zoom | R: reset | Space: animation | L: LOD | P: screenshot | Esc: return",
      Math.max(1, width - 2),
    )
  }
}

let activeDemo: ProgressiveLodDemo | null = null
let progressEventUsers = 0
let originalProgressEventDescriptor: PropertyDescriptor | undefined

export function run(renderer: CliRenderer): void {
  activeDemo?.destroy()
  activeDemo = new ProgressiveLodDemo(renderer)
}

export function destroy(_renderer: CliRenderer): void {
  activeDemo?.destroy()
  activeDemo = null
}

function getTextureBindings(definition: unknown): TextureBinding[] {
  if (!definition || typeof definition !== "object") return []
  const material = definition as {
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number; texCoord?: number }
      metallicRoughnessTexture?: { index: number; texCoord?: number }
    }
    normalTexture?: { index: number; texCoord?: number }
    occlusionTexture?: { index: number; texCoord?: number }
    emissiveTexture?: { index: number; texCoord?: number }
  }
  const bindings = new Map<number, TextureBinding>()

  const add = (
    info: { index: number; texCoord?: number } | undefined,
    slots: string[],
    colorSpace: typeof SRGBColorSpace | null,
  ) => {
    if (!info) return
    const existing = bindings.get(info.index)
    if (existing) {
      existing.slots.push(...slots)
      if (colorSpace) existing.colorSpace = colorSpace
      return
    }
    bindings.set(info.index, {
      textureIndex: info.index,
      slots: [...slots],
      colorSpace,
      channel: info.texCoord ?? 0,
    })
  }

  add(material.pbrMetallicRoughness?.baseColorTexture, ["map"], SRGBColorSpace)
  add(material.pbrMetallicRoughness?.metallicRoughnessTexture, ["metalnessMap", "roughnessMap"], null)
  add(material.normalTexture, ["normalMap"], null)
  add(material.occlusionTexture, ["aoMap"], null)
  add(material.emissiveTexture, ["emissiveMap"], SRGBColorSpace)
  return [...bindings.values()]
}

function copyTextureSettings(source: Texture | null, target: Texture): void {
  if (!source) {
    target.wrapS = RepeatWrapping
    target.wrapT = RepeatWrapping
    return
  }
  target.offset.copy(source.offset)
  target.repeat.copy(source.repeat)
  target.center.copy(source.center)
  target.rotation = source.rotation
  target.magFilter = source.magFilter
  target.minFilter = source.minFilter
  target.wrapS = source.wrapS
  target.wrapT = source.wrapT
  target.flipY = source.flipY
  target.anisotropy = source.anisotropy
  target.colorSpace = source.colorSpace
}

function toPortableTexture(texture: Texture): Texture {
  const compressed = texture as CompressedTexture
  if (!compressed.isCompressedTexture || (compressed.format as number) !== RGBAFormat) return texture
  const mipmap = compressed.mipmaps?.[0]
  if (!mipmap) return texture

  const portable = new DataTexture(mipmap.data, mipmap.width, mipmap.height, RGBAFormat, compressed.type)
  portable.name = compressed.name
  copyTextureSettings(compressed, portable)
  portable.generateMipmaps = true
  portable.needsUpdate = true
  return portable
}

function findProgressiveIndex(entries: unknown, guid: string): number {
  if (!Array.isArray(entries)) return -1
  return entries.findIndex((entry) => {
    if (!entry || typeof entry !== "object") return false
    const extension = (entry as { extensions?: Record<string, ProgressiveExtension> }).extensions?.[EXTENSION_NAME]
    return extension?.guid === guid
  })
}

function resolveLODURL(sourcePath: string, lod: ProgressiveLOD): string {
  const url = new URL(lod.path, sourcePath)
  if (lod.hash) url.searchParams.set("v", lod.hash)
  return url.href
}

function disposeGLTF(gltf: GLTF, keepGeometries = new Set<BufferGeometry>(), keepTextures = new Set<Texture>()): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()

  for (const root of gltf.scenes) {
    root.traverse((object) => {
      if (!(object as Mesh).isMesh) return
      const mesh = object as Mesh
      geometries.add(mesh.geometry)
      for (const material of asMaterials(mesh.material)) {
        materials.add(material)
        for (const texture of getMaterialTextures(material)) textures.add(texture)
      }
    })
  }

  for (const geometry of geometries) if (!keepGeometries.has(geometry)) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) if (!keepTextures.has(texture)) texture.dispose()
}

function getMaterialTextures(material: Material): Texture[] {
  const textures: Texture[] = []
  for (const value of Object.values(material)) {
    if ((value as Texture | undefined)?.isTexture === true) textures.push(value as Texture)
  }
  return textures
}

function asMaterials(material: Material | Material[]): Material[] {
  return Array.isArray(material) ? material : [material]
}

function acquireProgressEventPolyfill(): void {
  if (progressEventUsers++ > 0) return
  originalProgressEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ProgressEvent")
  if (typeof globalThis.ProgressEvent !== "undefined") return

  class OpenTUIProgressEvent extends Event {
    public readonly lengthComputable: boolean
    public readonly loaded: number
    public readonly total: number

    constructor(type: string, init: ProgressEventInit = {}) {
      super(type)
      this.lengthComputable = init.lengthComputable ?? false
      this.loaded = init.loaded ?? 0
      this.total = init.total ?? 0
    }
  }

  Object.defineProperty(globalThis, "ProgressEvent", {
    configurable: true,
    writable: true,
    value: OpenTUIProgressEvent,
  })
}

function releaseProgressEventPolyfill(): void {
  progressEventUsers = Math.max(0, progressEventUsers - 1)
  if (progressEventUsers > 0) return

  if (originalProgressEventDescriptor)
    Object.defineProperty(globalThis, "ProgressEvent", originalProgressEventDescriptor)
  else Reflect.deleteProperty(globalThis, "ProgressEvent")
  originalProgressEventDescriptor = undefined
}

function abortError(): Error {
  const error = new Error("The progressive GLTF operation was aborted")
  error.name = "AbortError"
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value
  if (width <= 3) return value.slice(0, width)
  return `${value.slice(0, width - 3)}...`
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
    enableMouseMovement: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
