// image renderable

import {
  Renderable,
  PixelBuffer,
  type CliRenderer,
  type RenderableOptions,
  type RenderContext,
} from "../index"

//
// image cells
//

const DEFAULT_CELL_WIDTH = 18
const DEFAULT_CELL_HEIGHT = 35

function getCellSize(renderer: CliRenderer): { cellWidth: number | null, cellHeight: number | null } {
  if (!renderer.resolution) {
    return { cellWidth: null, cellHeight: null }
  }
  const cellWidth = renderer.resolution.width / renderer.width
  const cellHeight = renderer.resolution.height / renderer.height
  return { cellWidth, cellHeight }
}

function getImageSize(imageWidth: number, imageHeight: number, cellWidth: number | null, cellHeight: number | null): { width: number, height: number } {
  const width = Math.ceil(imageWidth / (cellWidth ?? DEFAULT_CELL_WIDTH))
  const height = Math.ceil(imageHeight / (cellHeight ?? DEFAULT_CELL_HEIGHT))
  return { width, height }
}

//
// image renderable
//

export interface ImageOptions extends RenderableOptions<ImageRenderable> {
  data: Uint8Array
  imageWidth: number
  imageHeight: number
}

export class ImageRenderable extends Renderable {
  public data: Uint8Array
  public imageWidth: number
  public imageHeight: number
  private cellWidth: number | null = null
  private cellHeight: number | null = null

  constructor(ctx: RenderContext, options: ImageOptions) {
    const renderer = ctx as CliRenderer
    const { data, imageWidth, imageHeight } = options

    const { cellWidth, cellHeight } = getCellSize(renderer)
    const { width, height } = getImageSize(imageWidth, imageHeight, cellWidth, cellHeight)

    super(ctx, { ...options, width, height })
    this.data = data
    this.imageWidth = imageWidth
    this.imageHeight = imageHeight
    this.cellWidth = cellWidth
    this.cellHeight = cellHeight
  }

  public updateCellSize(): void {
    const renderer = this._ctx as CliRenderer
    if (renderer.resolution != null) {
      const { cellWidth, cellHeight } = getCellSize(renderer)
      const { width, height } = getImageSize(this.imageWidth, this.imageHeight, cellWidth, cellHeight)
      this.cellWidth = cellWidth
      this.cellHeight = cellHeight
      this.width = width
      this.height = height
    }
  }

  public renderPixels(pixels: PixelBuffer): void {
    if (this.cellWidth == null || this.cellHeight == null) {
      this.updateCellSize()
    }
    const x = Math.max(this.x, 0) + 1
    const y = Math.max(this.y, 0) + 1
    pixels.drawImage(x, y, this.imageWidth, this.imageHeight, this.data)
  }
}
