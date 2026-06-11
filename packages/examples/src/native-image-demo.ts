#!/usr/bin/env bun

import { createServer, type Server } from "node:http"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { ptr } from "bun:ffi"

import {
  BoxRenderable,
  CliRenderer,
  ImageRenderable,
  NativeImage,
  OptimizedBuffer,
  RGBA,
  TextAttributes,
  TextRenderable,
  createCliRenderer,
  type ImageSource,
  type KeyEvent,
  type ResizeKernel,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

// @ts-ignore Bun embeds imported assets and returns their runtime paths.
import gifPath from "./assets/image-demo.gif" with { type: "image/gif" }
// @ts-ignore Bun embeds imported assets and returns their runtime paths.
import pngPath from "./assets/image-demo.png" with { type: "image/png" }
// @ts-ignore Bun embeds imported assets and returns their runtime paths.
import jpegPath from "./assets/dragon.jpg" with { type: "image/jpeg" }
// @ts-ignore Bun embeds imported assets and returns their runtime paths.
import webpPath from "./assets/image-demo.webp" with { type: "image/webp" }

const P = {
  page: "#090d18",
  header: "#10172a",
  footer: "#0d1323",
  text: "#f4f7ff",
  muted: "#8d98b5",
  cyan: "#55d6d0",
  violet: "#a78bfa",
  coral: "#fb7185",
  lime: "#a3e635",
  cards: ["#111c2d", "#17192e", "#211827", "#14231f"],
} as const

type FitMode = "fit" | "cover"
type Rotation = 0 | 90 | 180 | 270

interface PreviewOptions {
  id: string
  source: ImageSource
  background: string
  onLoad: (image: NativeImage) => void
  onError: (error: unknown) => void
}

class NativeImagePreview extends ImageRenderable {
  private fitMode: FitMode = "fit"
  private resizeKernel: ResizeKernel = "area"
  private rotation: Rotation = 0
  private derivedImage: NativeImage | null = null
  private derivedPixels: Uint8Array | null = null
  private derivedStride = 0
  private cacheKey = ""
  private readonly previewBackground: RGBA
  private readonly previewBackgroundBytes: readonly [number, number, number, number]

  constructor(renderer: CliRenderer, options: PreviewOptions) {
    super(renderer, {
      id: options.id,
      source: options.source,
      width: "100%",
      height: "auto",
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 5,
      buffered: true,
      onLoad: options.onLoad,
      onError: options.onError,
    })
    this.previewBackground = RGBA.fromHex(options.background)
    this.previewBackgroundBytes = this.previewBackground.toInts()
  }

  public setDisplayOptions(fitMode: FitMode, resizeKernel: ResizeKernel, rotation: Rotation): void {
    if (this.fitMode === fitMode && this.resizeKernel === resizeKernel && this.rotation === rotation) return
    this.fitMode = fitMode
    this.fit = fitMode
    this.resizeKernel = resizeKernel
    this.rotation = rotation
    this.invalidateDerivedImage()
    this.requestRender()
  }

  protected onResize(width: number, height: number): void {
    this.invalidateDerivedImage()
    super.onResize(width, height)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.fillRect(0, 0, buffer.width, buffer.height, this.previewBackground)
    if (!this.image || buffer.width === 0 || buffer.height === 0) return

    const key = `${this.image.info().format}:${buffer.width}x${buffer.height}:${this.fitMode}:${this.resizeKernel}:${this.rotation}`
    if (key !== this.cacheKey) this.rebuildDerivedImage(buffer.width * 2, buffer.height * 2, key)
    if (!this.derivedPixels) return

    buffer.drawSuperSampleBuffer(
      0,
      0,
      ptr(this.derivedPixels),
      this.derivedPixels.byteLength,
      "rgba8unorm",
      this.derivedStride,
    )
  }

  private rebuildDerivedImage(targetWidth: number, targetHeight: number, key: string): void {
    this.invalidateDerivedImage()
    const source = this.image
    if (!source) return

    let rotated: NativeImage | null = null
    let resized: NativeImage | null = null
    try {
      const working = this.rotation === 0 ? source : (rotated = source.rotate(this.rotation))
      const { width, height } = this.getFittedSize(
        targetWidth,
        targetHeight,
        this.cellAspectRatio,
        working.width,
        working.height,
      )
      resized = working.resize({ width, height, kernel: this.resizeKernel })

      if (this.fitMode === "fit") {
        const horizontal = targetWidth - width
        const vertical = targetHeight - height
        this.derivedImage = resized.extend({
          left: Math.floor(horizontal / 2),
          right: Math.ceil(horizontal / 2),
          top: Math.floor(vertical / 2),
          bottom: Math.ceil(vertical / 2),
          background: this.previewBackgroundBytes,
        })
      } else {
        this.derivedImage = resized.extract({
          left: Math.floor((width - targetWidth) / 2),
          top: Math.floor((height - targetHeight) / 2),
          width: targetWidth,
          height: targetHeight,
        })
      }

      const raw = this.derivedImage.raw()
      this.derivedPixels = raw.data
      this.derivedStride = raw.stride
      this.cacheKey = key
    } finally {
      resized?.dispose()
      rotated?.dispose()
    }
  }

  private invalidateDerivedImage(): void {
    this.derivedImage?.dispose()
    this.derivedImage = null
    this.derivedPixels = null
    this.derivedStride = 0
    this.cacheKey = ""
  }

  protected destroySelf(): void {
    this.invalidateDerivedImage()
    super.destroySelf()
  }
}

interface GalleryItem {
  name: string
  sourceType: string
  source: ImageSource
  accent: string
  card: string
}

let root: BoxRenderable | null = null
let server: Server | null = null
let keyListener: ((key: KeyEvent) => void) | null = null
let controlsText: TextRenderable | null = null
let previews: NativeImagePreview[] = []
let fitMode: FitMode = "fit"
let resizeKernel: ResizeKernel = "area"
let rotation: Rotation = 0

function updateControls(): void {
  if (!controlsText) return
  controlsText.content = `F  ${fitMode.toUpperCase()}     K  ${resizeKernel.toUpperCase()}     R  ${rotation}°     ESC  MENU`
}

function createCard(renderer: CliRenderer, item: GalleryItem, index: number): BoxRenderable {
  const card = new BoxRenderable(renderer, {
    id: `native-image-card-${index}`,
    width: "auto",
    height: "100%",
    minWidth: 18,
    flexBasis: 24,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "column",
    backgroundColor: item.card,
  })

  card.add(
    new BoxRenderable(renderer, {
      id: `native-image-accent-${index}`,
      width: "100%",
      height: 1,
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: item.accent,
    }),
  )

  const heading = new BoxRenderable(renderer, {
    id: `native-image-heading-${index}`,
    width: "100%",
    height: 4,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "column",
    paddingLeft: 2,
    paddingTop: 1,
    backgroundColor: item.card,
  })
  heading.add(
    new TextRenderable(renderer, {
      id: `native-image-title-${index}`,
      content: item.name,
      fg: P.text,
      attributes: TextAttributes.BOLD,
    }),
  )
  heading.add(
    new TextRenderable(renderer, {
      id: `native-image-source-${index}`,
      content: item.sourceType,
      fg: item.accent,
    }),
  )
  card.add(heading)

  const metadata = new TextRenderable(renderer, {
    id: `native-image-metadata-${index}`,
    content: "LOADING\nNative decoder",
    width: "100%",
    height: 4,
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 2,
    paddingTop: 1,
    fg: P.muted,
    bg: item.card,
  })

  const preview = new NativeImagePreview(renderer, {
    id: `native-image-preview-${index}`,
    source: item.source,
    background: item.card,
    onLoad: (image) => {
      const info = image.info()
      metadata.content = `${info.format.toUpperCase()}  ${info.width}×${info.height}\nRGBA8  ${info.hasAlpha ? "ALPHA" : "OPAQUE"}`
    },
    onError: (error) => {
      metadata.content = `LOAD FAILED\n${error instanceof Error ? error.message : String(error)}`
      metadata.fg = P.coral
    },
  })
  previews.push(preview)
  card.add(preview)
  card.add(metadata)
  return card
}

async function startImageServer(gif: Uint8Array): Promise<string> {
  server = createServer((request, response) => {
    if (request.url !== "/image") {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { "content-type": "application/octet-stream" })
    response.end(gif)
  })
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject)
    server!.listen(0, "127.0.0.1", () => {
      server!.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Image demo server did not expose a TCP port")
  return `http://127.0.0.1:${address.port}/image`
}

export async function run(renderer: CliRenderer): Promise<void> {
  renderer.start()
  renderer.setBackgroundColor(P.page)

  const [webpBytes, gifBytes] = await Promise.all([readFile(webpPath), readFile(gifPath)])
  const gifUrl = await startImageServer(gifBytes)

  root = new BoxRenderable(renderer, {
    id: "native-image-demo",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: P.page,
  })
  renderer.root.add(root)

  const header = new BoxRenderable(renderer, {
    id: "native-image-header",
    width: "100%",
    height: 6,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 3,
    paddingRight: 3,
    backgroundColor: P.header,
  })
  header.add(
    new TextRenderable(renderer, {
      id: "native-image-heading",
      content: "NATIVE IMAGE LAB",
      fg: P.text,
      attributes: TextAttributes.BOLD,
    }),
  )
  const headerCopy = new BoxRenderable(renderer, {
    id: "native-image-header-copy",
    width: "auto",
    height: "100%",
    flexGrow: 1,
    flexShrink: 1,
    alignItems: "flex-end",
    justifyContent: "center",
    flexDirection: "column",
    backgroundColor: P.header,
  })
  headerCopy.add(
    new TextRenderable(renderer, {
      id: "native-image-subtitle",
      content: "ONE RGBA PIPELINE · FOUR FORMATS · FOUR SOURCE TYPES",
      fg: P.cyan,
    }),
  )
  headerCopy.add(
    new TextRenderable(renderer, {
      id: "native-image-caption",
      content: "decode  →  transform  →  supersample",
      fg: P.muted,
    }),
  )
  header.add(headerCopy)
  root.add(header)

  const gallery = new BoxRenderable(renderer, {
    id: "native-image-gallery",
    width: "100%",
    height: "auto",
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: P.page,
  })
  root.add(gallery)

  const items: GalleryItem[] = [
    { name: "LOCAL PNG", sourceType: "filesystem path", source: pngPath, accent: P.cyan, card: P.cards[0] },
    {
      name: "JPEG URL",
      sourceType: "file: URL",
      source: pathToFileURL(jpegPath),
      accent: P.violet,
      card: P.cards[1],
    },
    { name: "WEBP BYTES", sourceType: "Uint8Array", source: webpBytes, accent: P.coral, card: P.cards[2] },
    { name: "GIF FETCH", sourceType: "HTTP response", source: gifUrl, accent: P.lime, card: P.cards[3] },
  ]
  for (const [index, item] of items.entries()) gallery.add(createCard(renderer, item, index))

  const footer = new BoxRenderable(renderer, {
    id: "native-image-footer",
    width: "100%",
    height: 3,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.footer,
  })
  controlsText = new TextRenderable(renderer, {
    id: "native-image-controls",
    content: "",
    fg: P.muted,
    attributes: TextAttributes.BOLD,
  })
  footer.add(controlsText)
  root.add(footer)
  updateControls()

  keyListener = (key: KeyEvent) => {
    if (key.name === "f") fitMode = fitMode === "fit" ? "cover" : "fit"
    else if (key.name === "k") resizeKernel = resizeKernel === "area" ? "nearest" : "area"
    else if (key.name === "r") rotation = ((rotation + 90) % 360) as Rotation
    else return

    for (const preview of previews) preview.setDisplayOptions(fitMode, resizeKernel, rotation)
    updateControls()
  }
  renderer.keyInput.on("keypress", keyListener)
}

export function destroy(renderer: CliRenderer): void {
  if (keyListener) renderer.keyInput.off("keypress", keyListener)
  keyListener = null
  root?.destroy()
  root = null
  previews = []
  controlsText = null
  fitMode = "fit"
  resizeKernel = "area"
  rotation = 0
  server?.close()
  server = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  await run(renderer)
  setupCommonDemoKeys(renderer)
}
