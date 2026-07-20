import {
  PerspectiveCamera,
  OrthographicCamera,
  Color,
  NoToneMapping,
  LinearSRGBColorSpace,
  CustomToneMapping,
  Scene,
  type ColorSpace,
  type ToneMapping,
} from "three"
import { WebGPURenderer } from "three/webgpu"
import { createWebGPUDevice, setupGlobals } from "bun-webgpu"
import { CliRenderEvents, RGBA, type CliRenderer, type OptimizedBuffer } from "@opentui/core"
import { CLICanvas, SuperSampleAlgorithm } from "./canvas.js"

export enum SuperSampleType {
  NONE = "none",
  GPU = "gpu",
  CPU = "cpu",
}

export interface ThreeCliRendererOptions {
  width: number
  height: number
  focalLength?: number
  backgroundColor?: RGBA
  superSample?: SuperSampleType
  alpha?: boolean
  autoResize?: boolean
  libPath?: string
  toneMapping?: Exclude<ToneMapping, typeof CustomToneMapping>
  toneMappingExposure?: number
  outputColorSpace?: ColorSpace
}

export class ThreeCliRenderer {
  private outputWidth: number
  private outputHeight: number
  private renderWidth: number
  private renderHeight: number
  private superSample: SuperSampleType
  private backgroundColor: RGBA = RGBA.fromValues(0, 0, 0, 1)
  private alpha: boolean = false
  private toneMapping: Exclude<ToneMapping, typeof CustomToneMapping>
  private toneMappingExposure: number
  private outputColorSpace: ColorSpace
  private threeRenderer?: WebGPURenderer
  private canvas?: CLICanvas
  private device: GPUDevice | null = null
  private initPromise: Promise<void> | null = null
  private readonly activeOperations = new Set<Promise<unknown>>()
  private operationChain: Promise<void> = Promise.resolve()
  private destroyingDevice = false

  private activeCamera: PerspectiveCamera | OrthographicCamera
  private _aspectRatio: number | null = null
  private doRenderStats: boolean = false

  private resizeHandler: (width: number, height: number) => void
  private debugToggleHandler: (enabled: boolean) => void
  private destroyHandler: () => void

  // Stats tracking
  private renderTimeMs: number = 0
  private readbackTimeMs: number = 0
  private totalDrawTimeMs: number = 0

  private renderMethod: (
    root: Scene,
    camera: PerspectiveCamera | OrthographicCamera,
    buffer: OptimizedBuffer,
    deltaTime: number,
  ) => Promise<void> = () => Promise.resolve()

  public get aspectRatio(): number {
    if (this._aspectRatio) return this._aspectRatio
    if (this.cliRenderer.resolution) {
      const pixelAspectRatio = this.cliRenderer.resolution.width / this.cliRenderer.resolution.height
      return pixelAspectRatio
    }
    const terminalWidth = process.stdout.columns
    const terminalHeight = process.stdout.rows
    return terminalWidth / (terminalHeight * 2)
  }

  public get renderingHeight(): number {
    return this.renderHeight
  }

  constructor(
    private readonly cliRenderer: CliRenderer,
    options: ThreeCliRendererOptions,
  ) {
    this.outputWidth = options.width
    this.outputHeight = options.height
    this.superSample = options.superSample ?? SuperSampleType.GPU

    this.renderWidth = this.outputWidth * (this.superSample !== SuperSampleType.NONE ? 2 : 1)
    this.renderHeight = this.outputHeight * (this.superSample !== SuperSampleType.NONE ? 2 : 1)

    this.backgroundColor = options.backgroundColor ?? RGBA.fromValues(0, 0, 0, 1)
    this.alpha = options.alpha ?? false
    this.toneMapping = options.toneMapping ?? NoToneMapping
    this.toneMappingExposure = options.toneMappingExposure ?? 1
    this.outputColorSpace = options.outputColorSpace ?? LinearSRGBColorSpace

    if (process.env.CELL_ASPECT_RATIO) {
      this._aspectRatio = parseFloat(process.env.CELL_ASPECT_RATIO)
    }

    // Create a default active camera
    const fov = options.focalLength ? 2 * Math.atan(this.outputHeight / (2 * options.focalLength)) * (180 / Math.PI) : 1 // Default FOV if focal length not provided
    this.activeCamera = new PerspectiveCamera(
      fov,
      this.aspectRatio,
      0.1, // near plane
      1000, // far plane
    )
    this.activeCamera.position.set(0, 0, 3)
    this.activeCamera.up.set(0, 1, 0)
    this.activeCamera.lookAt(0, 0, 0)
    this.activeCamera.updateMatrixWorld()

    this.resizeHandler = (width: number, height: number) => {
      this.setSize(width, height, true)
    }

    this.debugToggleHandler = (enabled: boolean) => {
      this.doRenderStats = enabled
    }

    this.destroyHandler = () => {
      this.destroy()
    }

    if (options.autoResize !== false) {
      this.cliRenderer.on("resize", this.resizeHandler)
    }

    this.cliRenderer.on(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, this.debugToggleHandler)
    this.cliRenderer.on(CliRenderEvents.DESTROY, this.destroyHandler)

    setupGlobals({ libPath: options.libPath })
  }

  public toggleDebugStats(): void {
    this.doRenderStats = !this.doRenderStats
  }

  async init(): Promise<void> {
    if (this.destroyed) return
    this.initPromise ??= this.initialize()
    return this.initPromise
  }

  private async initialize(): Promise<void> {
    const device = await createWebGPUDevice()
    if (this.destroyed) {
      device.destroy()
      return
    }

    this.device = device
    this.canvas = new CLICanvas(device, this.renderWidth, this.renderHeight, this.superSample)

    try {
      this.threeRenderer = new WebGPURenderer({
        canvas: this.canvas as unknown as HTMLCanvasElement,
        device: this.device,
        alpha: this.alpha,
      })
      const onDeviceLost = this.threeRenderer.onDeviceLost.bind(this.threeRenderer)
      this.threeRenderer.onDeviceLost = (info) => {
        if (!this.destroyingDevice) onDeviceLost(info)
      }

      this.setBackgroundColor(this.backgroundColor)

      this.threeRenderer.toneMapping = this.toneMapping
      this.threeRenderer.toneMappingExposure = this.toneMappingExposure
      this.threeRenderer.outputColorSpace = this.outputColorSpace

      this.threeRenderer.setSize(this.renderWidth, this.renderHeight, false)
      await this.threeRenderer.init()
      if (this.destroyed) {
        this.disposeResources()
        return
      }
      this.renderMethod = this.doDrawScene.bind(this)
    } catch (error) {
      this.disposeResources()
      if (this.destroyed) return
      console.error("Error creating THREE.WebGPURenderer:", error)
      throw error
    }
  }

  public getSuperSampleAlgorithm(): SuperSampleAlgorithm {
    return this.canvas!.getSuperSampleAlgorithm()
  }

  public setSuperSampleAlgorithm(superSampleAlgorithm: SuperSampleAlgorithm): void {
    this.canvas!.setSuperSampleAlgorithm(superSampleAlgorithm)
  }

  public async saveToFile(filePath: string): Promise<void> {
    await this.init()
    if (this.destroyed || !this.canvas) throw new Error("Cannot save a screenshot after the renderer is destroyed")
    return this.trackOperation(() => this.canvas!.saveToFile(filePath))
  }

  setActiveCamera(camera: PerspectiveCamera | OrthographicCamera): void {
    this.activeCamera = camera
  }

  getActiveCamera(): PerspectiveCamera | OrthographicCamera {
    return this.activeCamera
  }

  public setBackgroundColor(color: RGBA): void {
    this.backgroundColor = color
    const clearColor = new Color(this.backgroundColor.r, this.backgroundColor.g, this.backgroundColor.b)
    const clearAlpha = this.alpha ? this.backgroundColor.a : 1.0
    this.threeRenderer!.setClearColor(clearColor, clearAlpha)
  }

  setSize(width: number, height: number, forceUpdate: boolean = false): void {
    // Check against OUTPUT dimensions
    if (!forceUpdate && this.outputWidth === width && this.outputHeight === height) return

    this.outputWidth = width
    this.outputHeight = height

    this.renderWidth = this.outputWidth * (this.superSample !== SuperSampleType.NONE ? 2 : 1)
    this.renderHeight = this.outputHeight * (this.superSample !== SuperSampleType.NONE ? 2 : 1)

    const renderWidth = this.renderWidth
    const renderHeight = this.renderHeight
    const superSample = this.superSample
    const applySize = async () => {
      this.canvas?.setSuperSample(superSample)
      this.canvas?.setSize(renderWidth, renderHeight)
      this.threeRenderer?.setSize(renderWidth, renderHeight, false)
      this.threeRenderer?.setViewport(0, 0, renderWidth, renderHeight)
    }
    if (this.activeOperations.size > 0) void this.trackOperation(applySize)
    else void applySize()

    if (this.activeCamera instanceof PerspectiveCamera) {
      this.activeCamera.aspect = this.aspectRatio
    }
    this.activeCamera.updateProjectionMatrix()
  }

  public async drawScene(root: Scene, buffer: OptimizedBuffer, deltaTime: number): Promise<void> {
    if (this.destroyed) return
    await this.trackOperation(() => this.renderMethod(root, this.activeCamera, buffer, deltaTime))

    if (this.doRenderStats) {
      this.renderStats(buffer)
    }
  }

  private rendering: boolean = false
  private destroyed: boolean = false
  async doDrawScene(
    root: Scene,
    camera: PerspectiveCamera | OrthographicCamera,
    buffer: OptimizedBuffer,
    deltaTime: number,
  ): Promise<void> {
    if (this.rendering) {
      console.warn("ThreeCliRenderer.drawScene was called concurrently, which is not supported.")
      return
    }
    if (this.destroyed) {
      return
    }
    try {
      this.rendering = true

      const totalStart = performance.now()
      const renderStart = performance.now()
      await this.threeRenderer!.render(root, camera)
      this.renderTimeMs = performance.now() - renderStart

      const readbackStart = performance.now()
      await this.canvas!.readPixelsIntoBuffer(buffer)
      this.readbackTimeMs = performance.now() - readbackStart

      this.totalDrawTimeMs = performance.now() - totalStart
    } finally {
      this.rendering = false
    }
  }

  public toggleSuperSampling(): void {
    if (this.superSample === SuperSampleType.NONE) {
      this.superSample = SuperSampleType.CPU
    } else if (this.superSample === SuperSampleType.CPU) {
      this.superSample = SuperSampleType.GPU
    } else {
      this.superSample = SuperSampleType.NONE
    }
    this.setSize(this.outputWidth, this.outputHeight, true)
  }

  public renderStats(buffer: OptimizedBuffer): void {
    const stats = [
      `WebGPU Renderer Stats:`,
      ` Render: ${this.renderTimeMs.toFixed(2)}ms`,
      ` Readback: ${this.readbackTimeMs.toFixed(2)}ms`,
      `  ├ MapAsync: ${this.canvas!.mapAsyncTimeMs.toFixed(2)}ms`,
      `  └ SS Draw: ${this.canvas!.superSampleDrawTimeMs.toFixed(2)}ms`,
      ` Total Draw: ${this.totalDrawTimeMs.toFixed(2)}ms`,
      ` SuperSample: ${this.superSample}`,
      ` SuperSample Algorithm: ${this.getSuperSampleAlgorithm()}`,
    ]
    const startY = 4
    const startX = 2
    const fg = RGBA.fromValues(0.9, 0.9, 0.9, 1.0)
    const bg = RGBA.fromValues(0.1, 0.1, 0.1, 1.0)

    stats.forEach((line, index) => {
      buffer.drawText(line, startX + 1, startY + index, fg, bg)
    })
  }

  public destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    this.cliRenderer.off("resize", this.resizeHandler)
    this.cliRenderer.off(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, this.debugToggleHandler)
    this.cliRenderer.off(CliRenderEvents.DESTROY, this.destroyHandler)
    this.renderMethod = () => Promise.resolve()

    void this.finishDestroy()
  }

  private async finishDestroy(): Promise<void> {
    if (this.initPromise) await this.initPromise.catch(() => {})
    await Promise.allSettled([...this.activeOperations])
    this.disposeResources()
  }

  private async trackOperation<T>(start: () => Promise<T>): Promise<T> {
    const operation = this.operationChain.then(start, start)
    this.operationChain = operation.then(
      () => {},
      () => {},
    )
    this.activeOperations.add(operation)
    try {
      return await operation
    } finally {
      this.activeOperations.delete(operation)
    }
  }

  private disposeResources(): void {
    this.destroyingDevice = true
    this.canvas?.destroy()
    this.threeRenderer?.dispose()
    this.device?.destroy()
    this.threeRenderer = undefined
    this.canvas = undefined
    this.device = null
  }
}
