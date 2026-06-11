import { Renderable, type RenderableOptions } from "../Renderable.js"
import { NativeImage, type ImageSource } from "../image.js"
import type { RenderContext } from "../types.js"

export type ImageFit = "fit" | "cover" | "fill"

export interface ImageRenderableOptions extends RenderableOptions<ImageRenderable> {
  source?: ImageSource
  fit?: ImageFit
  onLoad?: (image: NativeImage) => void
  onError?: (error: unknown) => void
}

export class ImageRenderable extends Renderable {
  private _source: ImageSource | undefined
  private _image: NativeImage | null = null
  private _loading = false
  private _loadError: unknown = null
  private _loadGeneration = 0
  private _loadController: AbortController | null = null
  private readonly _onLoad?: (image: NativeImage) => void
  private readonly _onError?: (error: unknown) => void
  private _fit: ImageFit
  public loadPromise: Promise<void> | null = null

  constructor(ctx: RenderContext, options: ImageRenderableOptions) {
    super(ctx, options)
    this._fit = options.fit ?? "fit"
    this._onLoad = options.onLoad
    this._onError = options.onError
    if (options.source !== undefined) this.source = options.source
  }

  public get source(): ImageSource | undefined {
    return this._source
  }

  public set source(source: ImageSource | undefined) {
    this._source = source
    const generation = ++this._loadGeneration
    this._loadController?.abort()
    this._loadController = null

    if (source === undefined) {
      this._loading = false
      this._loadError = null
      this._image?.dispose()
      this._image = null
      this.loadPromise = null
      this.requestRender()
      return
    }

    const controller = new AbortController()
    this._loadController = controller
    this._loading = true
    this._loadError = null
    this.loadPromise = this.load(source, generation, controller)
  }

  public get image(): NativeImage | null {
    return this._image
  }

  public get fit(): ImageFit {
    return this._fit
  }

  public set fit(value: ImageFit) {
    if (this._fit === value) return
    this._fit = value
    this.requestRender()
  }

  public get cellAspectRatio(): number {
    const resolution = this._ctx.resolution
    if (!resolution || this._ctx.terminalWidth <= 0 || this._ctx.terminalHeight <= 0) return 2
    const cellWidth = resolution.width / this._ctx.terminalWidth
    const cellHeight = resolution.height / this._ctx.terminalHeight
    return cellWidth > 0 && cellHeight > 0 ? cellHeight / cellWidth : 2
  }

  public getFittedSize(
    targetWidth: number,
    targetHeight: number,
    cellAspectRatio: number = this.cellAspectRatio,
    sourceWidth: number = this._image?.width ?? 0,
    sourceHeight: number = this._image?.height ?? 0,
  ): { width: number; height: number } {
    if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return { width: 0, height: 0 }
    if (this._fit === "fill") return { width: targetWidth, height: targetHeight }

    const displayAspect = (sourceWidth / sourceHeight) * cellAspectRatio
    const scale =
      this._fit === "fit"
        ? Math.min(targetWidth / displayAspect, targetHeight)
        : Math.max(targetWidth / displayAspect, targetHeight)
    return {
      width: Math.max(1, Math.round(displayAspect * scale)),
      height: Math.max(1, Math.round(scale)),
    }
  }

  public get loading(): boolean {
    return this._loading
  }

  public get loadError(): unknown {
    return this._loadError
  }

  private async load(source: ImageSource, generation: number, controller: AbortController): Promise<void> {
    let image: NativeImage
    try {
      image = await NativeImage.load(source, { signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted || this.isDestroyed || generation !== this._loadGeneration) return
      this._loading = false
      this._loadController = null
      this._loadError = error
      this._onError?.(error)
      return
    }

    if (this.isDestroyed || generation !== this._loadGeneration) {
      image.dispose()
      return
    }

    const previous = this._image
    this._image = image
    this._loading = false
    this._loadController = null
    previous?.dispose()
    this.requestRender()
    this._onLoad?.(image)
  }

  protected destroySelf(): void {
    ++this._loadGeneration
    this._loadController?.abort()
    this._loadController = null
    this._loading = false
    this._image?.dispose()
    this._image = null
    super.destroySelf()
  }
}
