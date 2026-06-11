import { Renderable, type RenderableOptions } from "../Renderable.js"
import { NativeImage, type ImageSource } from "../image.js"
import type { RenderContext } from "../types.js"

export interface ImageRenderableOptions extends RenderableOptions<ImageRenderable> {
  source?: ImageSource
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
  public loadPromise: Promise<void> | null = null

  constructor(ctx: RenderContext, options: ImageRenderableOptions) {
    super(ctx, options)
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
