# FrameBufferRenderable

An offscreen rendering buffer component that allows for advanced rendering techniques like double buffering, caching, and compositing.

## Class: `FrameBufferRenderable`

```typescript
import { FrameBufferRenderable } from '@opentui/core'

const frameBuffer = new FrameBufferRenderable('buffer', {
  width: 80,
  height: 24,
  respectAlpha: true
})
```

## Constructor

### `new FrameBufferRenderable(id: string, options: FrameBufferOptions)`

## Options

### `FrameBufferOptions`

Extends [`RenderableOptions`](../renderable.md#renderableoptions) with:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `width` | `number` | Yes | - | Buffer width in columns |
| `height` | `number` | Yes | - | Buffer height in rows |
| `respectAlpha` | `boolean` | No | `false` | Enable alpha blending |

## Properties

### Buffer Properties

| Property | Type | Description |
|----------|------|-------------|
| `frameBuffer` | `OptimizedBuffer` | The internal buffer instance |
| `respectAlpha` | `boolean` | Whether alpha blending is enabled |

## Methods

All methods from [`Renderable`](../renderable.md) plus:

### Direct Buffer Access

The `frameBuffer` property provides direct access to the `OptimizedBuffer` instance, allowing you to:

```typescript
// Clear the buffer
frameBuffer.frameBuffer.clear()

// Draw text
frameBuffer.frameBuffer.drawText('Hello', 0, 0)

// Fill rectangle
frameBuffer.frameBuffer.fillRect(0, 0, 10, 5, '#ff0000')

// Draw borders
frameBuffer.frameBuffer.drawBorder(0, 0, 20, 10, 'single')
```

## Use Cases

### 1. Caching Complex Renders

```typescript
class CachedComponent extends FrameBufferRenderable {
  private isDirty = true

  constructor(id: string, width: number, height: number) {
    super(id, { width, height, respectAlpha: false })
  }

  update() {
    if (this.isDirty) {
      // Clear and redraw only when needed
      this.frameBuffer.clear()
      this.drawComplexContent()
      this.isDirty = false
    }
  }

  private drawComplexContent() {
    // Expensive rendering operations
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const char = this.calculateComplexChar(x, y)
        this.frameBuffer.drawText(char, x, y)
      }
    }
  }

  markDirty() {
    this.isDirty = true
  }
}
```

### 2. Animation Buffers

```typescript
class AnimatedSprite extends FrameBufferRenderable {
  private frames: string[][] = []
  private currentFrame = 0

  constructor(id: string, frames: string[][]) {
    const width = Math.max(...frames.map(f => f[0]?.length || 0))
    const height = Math.max(...frames.map(f => f.length))
    
    super(id, { width, height, respectAlpha: true })
    this.frames = frames
    this.drawFrame(0)
  }

  nextFrame() {
    this.currentFrame = (this.currentFrame + 1) % this.frames.length
    this.drawFrame(this.currentFrame)
  }

  private drawFrame(index: number) {
    this.frameBuffer.clear()
    const frame = this.frames[index]
    
    frame.forEach((line, y) => {
      this.frameBuffer.drawText(line, 0, y)
    })
  }
}

// Usage
const sprite = new AnimatedSprite('sprite', [
  ['  O  ', ' /|\\ ', ' / \\ '],  // Frame 1
  ['  O  ', ' \\|/ ', ' / \\ '],  // Frame 2
  ['  O  ', ' /|\\ ', ' \\ / '],  // Frame 3
])

setInterval(() => sprite.nextFrame(), 100)
```

### 3. Layered Rendering

```typescript
class LayeredView extends GroupRenderable {
  private background: FrameBufferRenderable
  private midground: FrameBufferRenderable
  private foreground: FrameBufferRenderable

  constructor(id: string, width: number, height: number) {
    super(id, { width, height })

    // Create layers with alpha support
    this.background = new FrameBufferRenderable('bg', {
      width, height,
      respectAlpha: false
    })

    this.midground = new FrameBufferRenderable('mid', {
      width, height,
      respectAlpha: true
    })

    this.foreground = new FrameBufferRenderable('fg', {
      width, height,
      respectAlpha: true
    })

    // Stack layers
    this.appendChild(this.background)
    this.appendChild(this.midground)
    this.appendChild(this.foreground)
  }

  drawBackground(pattern: string) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.background.frameBuffer.drawText(pattern, x, y)
      }
    }
  }

  drawMidground(content: string, x: number, y: number) {
    this.midground.frameBuffer.clear()
    this.midground.frameBuffer.drawText(content, x, y)
  }

  drawForeground(overlay: string, x: number, y: number) {
    this.foreground.frameBuffer.clear()
    this.foreground.frameBuffer.drawText(overlay, x, y)
  }
}
```

### 4. Viewport/Camera

```typescript
class Viewport extends FrameBufferRenderable {
  private worldBuffer: OptimizedBuffer
  private cameraX = 0
  private cameraY = 0

  constructor(id: string, viewWidth: number, viewHeight: number, worldWidth: number, worldHeight: number) {
    super(id, { width: viewWidth, height: viewHeight })
    
    // Create larger world buffer
    this.worldBuffer = OptimizedBuffer.create(worldWidth, worldHeight)
    this.renderWorld()
  }

  private renderWorld() {
    // Draw a large world
    for (let y = 0; y < this.worldBuffer.height; y++) {
      for (let x = 0; x < this.worldBuffer.width; x++) {
        const char = ((x + y) % 2 === 0) ? '.' : ' '
        this.worldBuffer.drawText(char, x, y)
      }
    }
    
    // Add some landmarks
    this.worldBuffer.drawText('START', 0, 0)
    this.worldBuffer.drawText('END', this.worldBuffer.width - 5, this.worldBuffer.height - 1)
  }

  moveCamera(dx: number, dy: number) {
    this.cameraX = Math.max(0, Math.min(this.cameraX + dx, this.worldBuffer.width - this.width))
    this.cameraY = Math.max(0, Math.min(this.cameraY + dy, this.worldBuffer.height - this.height))
    this.updateView()
  }

  private updateView() {
    this.frameBuffer.clear()
    
    // Copy visible portion of world to viewport
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const worldX = this.cameraX + x
        const worldY = this.cameraY + y
        
        if (worldX < this.worldBuffer.width && worldY < this.worldBuffer.height) {
          const cell = this.worldBuffer.getCell(worldX, worldY)
          this.frameBuffer.setCell(x, y, cell)
        }
      }
    }
  }
}
```

### 5. Effects Buffer

```typescript
class EffectsBuffer extends FrameBufferRenderable {
  constructor(id: string, width: number, height: number) {
    super(id, { width, height, respectAlpha: true })
  }

  applyGlowEffect(text: string, x: number, y: number, color: string) {
    // Draw glow layers
    const glowColors = ['#330000', '#660000', '#990000', color]
    
    glowColors.forEach((glowColor, layer) => {
      const offset = glowColors.length - layer - 1
      
      // Draw in all directions for glow
      for (let dy = -offset; dy <= offset; dy++) {
        for (let dx = -offset; dx <= offset; dx++) {
          if (dx !== 0 || dy !== 0) {
            this.frameBuffer.drawText(text, x + dx, y + dy, {
              fg: glowColor,
              alpha: 0.3
            })
          }
        }
      }
    })
    
    // Draw main text on top
    this.frameBuffer.drawText(text, x, y, { fg: color })
  }

  applyNoiseEffect(intensity: number = 0.1) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (Math.random() < intensity) {
          const noise = String.fromCharCode(0x2591 + Math.floor(Math.random() * 3))
          this.frameBuffer.drawText(noise, x, y, {
            fg: '#333333',
            alpha: 0.5
          })
        }
      }
    }
  }
}
```

### 6. Double Buffering

```typescript
class DoubleBuffered extends Renderable {
  private frontBuffer: FrameBufferRenderable
  private backBuffer: FrameBufferRenderable

  constructor(id: string, width: number, height: number) {
    super(id, { width, height })
    
    this.frontBuffer = new FrameBufferRenderable('front', {
      width, height,
      respectAlpha: false
    })
    
    this.backBuffer = new FrameBufferRenderable('back', {
      width, height,
      respectAlpha: false
    })
    
    this.appendChild(this.frontBuffer)
  }

  draw(drawFn: (buffer: OptimizedBuffer) => void) {
    // Clear back buffer
    this.backBuffer.frameBuffer.clear()
    
    // Draw to back buffer
    drawFn(this.backBuffer.frameBuffer)
    
    // Swap buffers
    this.swapBuffers()
  }

  private swapBuffers() {
    // Swap the buffers
    [this.frontBuffer, this.backBuffer] = [this.backBuffer, this.frontBuffer]
    
    // Update which one is visible
    this.removeAllChildren()
    this.appendChild(this.frontBuffer)
  }
}
```

## Performance Considerations

1. **Buffer Size**: Large buffers consume more memory. Size appropriately.

2. **Alpha Blending**: `respectAlpha: true` has a performance cost. Only use when needed.

3. **Clearing**: Clear buffers only when necessary, not every frame.

4. **Reuse Buffers**: Reuse FrameBufferRenderables instead of creating new ones.

5. **Batch Operations**: Group multiple draw operations together.

## Best Practices

1. **Use for Caching**: Cache complex, static content that doesn't change often.

2. **Animation Frames**: Pre-render animation frames into buffers.

3. **Layering**: Use multiple buffers with alpha for layered effects.

4. **Viewport Pattern**: Use for scrollable areas larger than the screen.

5. **Memory Management**: Destroy buffers when no longer needed:
```typescript
frameBuffer.destroy()
```

## Integration with Buffered Renderables

Note: The base `Renderable` class also supports buffering via the `buffered: true` option. Consider using that for simpler cases:

```typescript
// Simple buffering
const buffered = new BoxRenderable('box', {
  buffered: true,  // Uses internal frame buffer
  width: 20,
  height: 10
})

// vs explicit FrameBuffer for advanced control
const frameBuffer = new FrameBufferRenderable('buffer', {
  width: 20,
  height: 10,
  respectAlpha: true
})
```

Use `FrameBufferRenderable` when you need:
- Direct buffer manipulation
- Alpha blending control
- Custom rendering pipelines
- Multi-buffer techniques