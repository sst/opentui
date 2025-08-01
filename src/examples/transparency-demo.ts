import { TextAttributes, createCliRenderer, RGBA, GroupRenderable, TextRenderable, BoxRenderable, OptimizedBuffer, type MouseEvent, t, bold, underline, fg } from "../index"
import type { CliRenderer } from "../index"
import { setupStandaloneDemoKeys } from "./lib/standalone-keys"

let nextZIndex = 101
let draggableBoxes: DraggableTransparentBox[] = []

class DraggableTransparentBox extends BoxRenderable {
  private isDragging = false
  private dragOffsetX = 0
  private dragOffsetY = 0
  private alphaPercentage: number

  constructor(id: string, x: number, y: number, width: number, height: number, bg: RGBA, zIndex: number) {
    super(id, {
      x,
      y,
      width,
      height,
      zIndex,
      bg,
      border: false,
      titleAlignment: "center",
    })
    this.alphaPercentage = Math.round(bg.a * 100)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    const alphaText = `${this.alphaPercentage}%`
    const centerX = this.x + Math.floor(this.width / 2 - alphaText.length / 2)
    const centerY = this.y + Math.floor(this.height / 2)
    
    buffer.drawText(alphaText, centerX, centerY, RGBA.fromInts(255, 255, 255, 220))
  }

  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case "down":
        this.isDragging = true
        this.dragOffsetX = event.x - this.x
        this.dragOffsetY = event.y - this.y
        this.zIndex = nextZIndex++
        event.preventDefault()
        break

      case "drag-end":
        if (this.isDragging) {
          this.isDragging = false
          event.preventDefault()
        }
        break

      case "drag":
        if (this.isDragging) {
          this.x = event.x - this.dragOffsetX
          this.y = event.y - this.dragOffsetY

          this.x = Math.max(0, Math.min(this.x, (this.ctx?.width() || 80) - this.width))
          this.y = Math.max(4, Math.min(this.y, (this.ctx?.height() || 24) - this.height))

          event.preventDefault()
        }
        break
    }
  }
}

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor("#0A0E14")

  const parentContainer = new GroupRenderable("parent-container", {
    x: 0,
    y: 0,
    zIndex: 10,
    visible: true,
  })
  renderer.add(parentContainer)

  const headerText = t`${bold(underline(fg("#00D4AA")("Interactive Alpha Transparency & Blending Demo - Drag the boxes!")))}
${fg("#A8A8B2")("Click and drag any transparent box to move it around • Watch how transparency layers blend")}`

  const headerDisplay = renderer.createStyledText("header-text", {
    fragment: headerText,
    width: 85,
    height: 3,
    x: 10,
    y: 2,
    zIndex: 1,
    selectable: false,
  })
  parentContainer.add(headerDisplay)

  const textUnderAlpha = new TextRenderable("text-under-alpha", {
    content: "This text should not be selectable",
    x: 10,
    y: 6,
    fg: "#FFB84D",
    attributes: TextAttributes.BOLD,
    zIndex: 4,
    selectable: false,
  })
  parentContainer.add(textUnderAlpha)

  const moreTextUnder = new TextRenderable("more-text-under", {
    content: "Selectable text to show character preservation",
    x: 15,
    y: 10,
    fg: "#7B68EE",
    attributes: TextAttributes.BOLD,
    zIndex: 1,
  })
  parentContainer.add(moreTextUnder)

  const alphaBox50 = new DraggableTransparentBox(
    "alpha-box-50", 
    15, 5, 25, 8, 
    RGBA.fromValues(64 / 255, 176 / 255, 255 / 255, 128 / 255), 
    50
  )
  parentContainer.add(alphaBox50)
  draggableBoxes.push(alphaBox50)

  const alphaBox75 = new DraggableTransparentBox(
    "alpha-box-75", 
    30, 7, 25, 8, 
    RGBA.fromValues(255 / 255, 107 / 255, 129 / 255, 192 / 255), 
    30
  )
  parentContainer.add(alphaBox75)
  draggableBoxes.push(alphaBox75)

  const alphaBox25 = new DraggableTransparentBox(
    "alpha-box-25", 
    45, 9, 25, 8, 
    RGBA.fromValues(139 / 255, 69 / 255, 193 / 255, 64 / 255), 
    10
  )
  parentContainer.add(alphaBox25)
  draggableBoxes.push(alphaBox25)

  const alphaGreen = new DraggableTransparentBox(
    "alpha-green", 
    20, 11, 30, 5, 
    RGBA.fromValues(88 / 255, 214 / 255, 141 / 255, 96 / 255), 
    20
  )
  parentContainer.add(alphaGreen)
  draggableBoxes.push(alphaGreen)

  const alphaYellow = new DraggableTransparentBox(
    "alpha-yellow", 
    25, 13, 20, 6, 
    RGBA.fromValues(255 / 255, 183 / 255, 77 / 255, 128 / 255), 
    40
  )
  parentContainer.add(alphaYellow)
  draggableBoxes.push(alphaYellow)

  const alphaOverlay = new DraggableTransparentBox(
    "alpha-overlay", 
    10, 17, 65, 4, 
    RGBA.fromValues(200 / 255, 162 / 255, 255 / 255, 32 / 255), 
    60
  )
  parentContainer.add(alphaOverlay)
  draggableBoxes.push(alphaOverlay)


}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()
  
  for (const box of draggableBoxes) {
    renderer.remove(box.id)
  }
  draggableBoxes = []
  
  renderer.remove("parent-container")
  renderer.setCursorPosition(0, 0, false)
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupStandaloneDemoKeys(renderer)
  renderer.start()
}
