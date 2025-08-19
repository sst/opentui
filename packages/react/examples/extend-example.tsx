import { BoxRenderable, OptimizedBuffer, RGBA, type BoxOptions } from "@opentui/core"
import { extend, render } from "@opentui/react"

// Custom renderable that extends BoxRenderable
class ConsoleButtonRenderable extends BoxRenderable {
  private _label: string = "Button"

  constructor(id: string, options: BoxOptions & { label?: string }) {
    super(id, options)

    if (options.label) {
      this._label = options.label
    }

    // Set some default styling for buttons
    this.borderStyle = "single"
    this.padding = 2
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    const centerX = this.x + Math.floor(this.width / 2 - this._label.length / 2)
    const centerY = this.y + Math.floor(this.height / 2)

    buffer.drawText(this._label, centerX, centerY, RGBA.fromInts(255, 255, 255, 255))
  }

  get label(): string {
    return this._label
  }

  set label(value: string) {
    this._label = value
    this.needsUpdate()
  }
}

// TypeScript module augmentation for proper typing
declare module "@opentui/react" {
  interface OpenTUIComponents {
    consoleButton: typeof ConsoleButtonRenderable
  }
}

// Extend the component catalogue
extend({ consoleButton: ConsoleButtonRenderable })

// Example usage component
export function ExtendExample() {
  return (
    <consoleButton
      label="Another Button"
      style={{
        backgroundColor: "green",
      }}
    />
  )
}

render(<ExtendExample />)
