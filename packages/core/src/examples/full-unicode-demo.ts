import {
  createCliRenderer,
  RGBA,
  FrameBufferRenderable,
  TextRenderable,
  t,
  blue,
  bold,
  underline,
  fg,
  type MouseEvent,
  type CliRenderer,
  type RenderContext,
  BoxRenderable,
} from "../index"

const GRAPHEME_LINES: string[] = [
  "👩🏽‍💻  👨‍👩‍👧‍👦  🏳️‍🌈  🇺🇸  🇩🇪  🇯🇵  🇮🇳",
  "a̐éö̲  Z͑͗͛̒͘a̴͈͚̐̓l̷͓̱͉g̶̙̗̓͘o̵͍͈  क्‍ष",
  "مرحبا  こんにちは  สวัสดี  Здравствуйте",
  "𝔘𝔫𝔦𝔠𝔬𝔡𝔢  𝒻𝓊𝓁𝓁 𝓌𝒾𝒹𝓉𝒽：ＡＢＣ  ½ ⅞ ⅓",
]

class DraggableGraphemeBox extends FrameBufferRenderable {
  private isDragging = false
  private dragOffsetX = 0
  private dragOffsetY = 0

  constructor(
    ctx: RenderContext,
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    bg: RGBA,
    respectAlpha = true,
  ) {
    super(ctx, { id, width, height, position: "absolute", left: x, top: y, respectAlpha })

    // Fill the internal framebuffer with graphemes
    this.frameBuffer.clear(RGBA.fromInts(0, 0, 0, Math.round(bg.a * 255)))

    const fg = RGBA.fromInts(255, 255, 255, 255)
    let row = 0
    for (const line of GRAPHEME_LINES) {
      if (row >= height) break
      this.frameBuffer.drawText(line, 1, row, fg, bg)
      row += 1
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case "down":
        this.isDragging = true
        this.dragOffsetX = event.x - this.x
        this.dragOffsetY = event.y - this.y
        event.preventDefault()
        break
      case "drag":
        if (this.isDragging) {
          this.x = event.x - this.dragOffsetX
          this.y = event.y - this.dragOffsetY
          event.preventDefault()
        }
        break
      case "drag-end":
        if (this.isDragging) {
          this.isDragging = false
          event.preventDefault()
        }
        break
    }
  }
}

class GraphemeBackground extends FrameBufferRenderable {
  constructor(ctx: RenderContext, id: string, width: number, height: number) {
    super(ctx, { id, width, height, position: "absolute", left: 0, top: 0, respectAlpha: false })

    // Fill entire background with repeating grapheme lines
    const fg = RGBA.fromInts(220, 220, 220, 255)
    const bg = RGBA.fromInts(0, 17, 34, 255)
    this.frameBuffer.clear(RGBA.fromInts(0, 17, 34, 255))
    for (let y = 0; y < height; y++) {
      const line = GRAPHEME_LINES[y % GRAPHEME_LINES.length]
      this.frameBuffer.drawText(line, 2, y, fg, bg)
    }
  }
}

class DraggableStyledText extends TextRenderable {
  private isDragging = false
  private dragOffsetX = 0
  private dragOffsetY = 0

  constructor(ctx: RenderContext, id: string, x: number, y: number) {
    super(ctx, {
      id,
      position: "absolute",
      left: x,
      top: y,
      zIndex: 2,
      selectable: false,
    })

    // Styled text content with graphemes
    const content = t`${bold(blue("Graphemes:"))} 👩🏽‍💻  👨‍👩‍👧‍👦  🏳️‍🌈  🇺🇸  🇩🇪  🇯🇵  🇮🇳
${underline("Complex:")} a̐éö̲  Z͑͗͛̒͘a̴͈͚̐̓l̷͓̱͉g̶̙̗̓͘o̵͍͈  क्‍ष`

    this.content = content
    this.fg = RGBA.fromInts(255, 255, 255, 255)
    this.bg = RGBA.fromInts(0, 0, 0, 0)
  }

  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case "down":
        this.isDragging = true
        this.dragOffsetX = event.x - this.x
        this.dragOffsetY = event.y - this.y
        event.preventDefault()
        break
      case "drag":
        if (this.isDragging) {
          this.x = event.x - this.dragOffsetX
          this.y = event.y - this.dragOffsetY
          event.preventDefault()
        }
        break
      case "drag-end":
        if (this.isDragging) {
          this.isDragging = false
          event.preventDefault()
        }
        break
    }
  }
}

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor(RGBA.fromInts(0, 17, 34, 255))

  const rootGroup = new BoxRenderable(renderer, { id: "full-unicode-root", zIndex: 1 })
  renderer.root.add(rootGroup)

  const bg = new GraphemeBackground(renderer, "grapheme-bg", renderer.terminalWidth, renderer.terminalHeight)
  rootGroup.add(bg)

  const box1 = new DraggableGraphemeBox(renderer, "grapheme-box-1", 6, 4, 30, 6, RGBA.fromInts(32, 96, 192, 160), true)
  const box2 = new DraggableGraphemeBox(
    renderer,
    "grapheme-box-2",
    24,
    10,
    28,
    6,
    RGBA.fromInts(192, 96, 128, 180),
    true,
  )
  const box3 = new DraggableGraphemeBox(renderer, "grapheme-box-3", 42, 7, 26, 6, RGBA.fromInts(64, 176, 96, 128), true)

  rootGroup.add(box1)
  rootGroup.add(box2)
  rootGroup.add(box3)

  // Draggable styled text using TextRenderable (grapheme-aware via TextBuffer)
  const styledText = new DraggableStyledText(renderer, "draggable-styled-text", 8, 12)
  rootGroup.add(styledText)
}

export function destroy(renderer: CliRenderer): void {
  renderer.root.remove("full-unicode-root")
}

if (import.meta.main) {
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  run(renderer)
}
