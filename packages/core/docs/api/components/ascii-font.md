# ASCIIFontRenderable

Renders text using ASCII art fonts for large, decorative text displays.

## Class: `ASCIIFontRenderable`

```typescript
import { ASCIIFontRenderable } from '@opentui/core'

const title = new ASCIIFontRenderable('title', {
  text: 'HELLO',
  font: 'block',
  fg: '#00ff00'
})
```

## Constructor

### `new ASCIIFontRenderable(id: string, options: ASCIIFontOptions)`

## Options

### `ASCIIFontOptions`

Extends [`RenderableOptions`](../renderable.md#renderableoptions) with:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `text` | `string` | `''` | Text to render |
| `font` | `'tiny' \| 'block' \| 'shade' \| 'slick'` | `'tiny'` | ASCII font style |
| `fg` | `RGBA \| RGBA[] \| string \| string[]` | `'#ffffff'` | Foreground color(s) |
| `bg` | `RGBA \| string` | `transparent` | Background color |
| `selectionBg` | `string \| RGBA` | - | Selection background color |
| `selectionFg` | `string \| RGBA` | - | Selection foreground color |
| `selectable` | `boolean` | `true` | Enable text selection |

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `text` | `string` | Get/set the text content |
| `font` | `'tiny' \| 'block' \| 'shade' \| 'slick'` | Get/set the font style |
| `fg` | `RGBA[]` | Get/set foreground colors |
| `bg` | `RGBA` | Get/set background color |
| `selectable` | `boolean` | Enable/disable selection |

## Font Styles

### `tiny`
Compact font, good for headers in limited space:
```
H   H EEEEE L     L      OOO  
H   H E     L     L     O   O 
HHHHH EEEE  L     L     O   O 
H   H E     L     L     O   O 
H   H EEEEE LLLLL LLLLL  OOO  
```

### `block`
Bold, blocky letters for maximum impact:
```
██   ██ ███████ ██      ██       ██████  
██   ██ ██      ██      ██      ██    ██ 
███████ █████   ██      ██      ██    ██ 
██   ██ ██      ██      ██      ██    ██ 
██   ██ ███████ ███████ ███████  ██████  
```

### `shade`
Shaded/gradient effect using different density characters:
```
░█   ░█ ▒█▒█▒█ ░█     ░█      ▒█▒█▒█ 
▒█   ▒█ ▒█     ▒█     ▒█     ▒█   ▒█ 
▓█▓█▓█  ▓█▓█   ▓█     ▓█     ▓█   ▓█ 
▒█   ▒█ ▒█     ▒█     ▒█     ▒█   ▒█ 
░█   ░█ ▒█▒█▒█ ▒█▒█▒█ ▒█▒█▒█ ▒█▒█▒█ 
```

### `slick`
Stylized font with decorative elements:
```
╦ ╦╔═╗╦  ╦  ╔═╗
╠═╣║╣ ║  ║  ║ ║
╩ ╩╚═╝╩═╝╩═╝╚═╝
```

## Examples

### Basic Title

```typescript
const title = new ASCIIFontRenderable('title', {
  text: 'GAME OVER',
  font: 'block',
  fg: '#ff0000'
})
```

### Rainbow Colors

```typescript
const rainbow = new ASCIIFontRenderable('rainbow', {
  text: 'RAINBOW',
  font: 'block',
  fg: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#9400d3']
})
```

### Animated Title

```typescript
class AnimatedTitle extends ASCIIFontRenderable {
  private colors = [
    '#ff0000', '#ff3333', '#ff6666', '#ff9999', '#ffcccc',
    '#ff9999', '#ff6666', '#ff3333'
  ]
  private colorIndex = 0

  constructor(id: string, text: string) {
    super(id, {
      text,
      font: 'block',
      fg: '#ff0000'
    })
    
    this.startAnimation()
  }

  private startAnimation() {
    setInterval(() => {
      this.fg = this.colors[this.colorIndex]
      this.colorIndex = (this.colorIndex + 1) % this.colors.length
    }, 100)
  }
}

const animatedTitle = new AnimatedTitle('animated', 'ALERT!')
```

### Gradient Effect

```typescript
function createGradient(text: string, startColor: string, endColor: string): string[] {
  const colors: string[] = []
  const steps = text.length
  
  // Parse RGB values
  const start = parseRGB(startColor)
  const end = parseRGB(endColor)
  
  for (let i = 0; i < steps; i++) {
    const ratio = i / (steps - 1)
    const r = Math.round(start.r + (end.r - start.r) * ratio)
    const g = Math.round(start.g + (end.g - start.g) * ratio)
    const b = Math.round(start.b + (end.b - start.b) * ratio)
    colors.push(`rgb(${r}, ${g}, ${b})`)
  }
  
  return colors
}

const gradient = new ASCIIFontRenderable('gradient', {
  text: 'GRADIENT',
  font: 'shade',
  fg: createGradient('GRADIENT', '#0000ff', '#ff00ff')
})
```

### Menu Title

```typescript
const menuTitle = new ASCIIFontRenderable('menu-title', {
  text: 'MAIN MENU',
  font: 'slick',
  fg: '#00ff00',
  bg: '#001100'
})

// Center it
menuTitle.alignSelf = 'center'
menuTitle.marginTop = 2
menuTitle.marginBottom = 2
```

### Score Display

```typescript
class ScoreDisplay extends GroupRenderable {
  private label: ASCIIFontRenderable
  private score: ASCIIFontRenderable
  private _value = 0

  constructor(id: string) {
    super(id, {
      flexDirection: 'column',
      alignItems: 'center'
    })

    this.label = new ASCIIFontRenderable('label', {
      text: 'SCORE',
      font: 'tiny',
      fg: '#ffff00'
    })

    this.score = new ASCIIFontRenderable('score', {
      text: '000000',
      font: 'block',
      fg: '#ffffff'
    })

    this.appendChild(this.label)
    this.appendChild(this.score)
  }

  set value(score: number) {
    this._value = score
    this.score.text = score.toString().padStart(6, '0')
    
    // Flash effect on score change
    this.score.fg = '#ffff00'
    setTimeout(() => {
      this.score.fg = '#ffffff'
    }, 200)
  }

  get value(): number {
    return this._value
  }
}
```

### ASCII Art Logo

```typescript
const logo = new GroupRenderable('logo', {
  flexDirection: 'column',
  alignItems: 'center',
  padding: 2
})

const line1 = new ASCIIFontRenderable('line1', {
  text: 'OPEN',
  font: 'block',
  fg: '#00aaff'
})

const line2 = new ASCIIFontRenderable('line2', {
  text: 'TUI',
  font: 'shade',
  fg: '#00ff00'
})

logo.appendChild(line1)
logo.appendChild(line2)
```

### Loading Screen

```typescript
class LoadingScreen extends GroupRenderable {
  private title: ASCIIFontRenderable
  private dots = 0

  constructor(id: string) {
    super(id, {
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center'
    })

    this.title = new ASCIIFontRenderable('loading', {
      text: 'LOADING',
      font: 'block',
      fg: '#00ff00'
    })

    this.appendChild(this.title)
    this.startAnimation()
  }

  private startAnimation() {
    setInterval(() => {
      this.dots = (this.dots + 1) % 4
      const dotStr = '.'.repeat(this.dots)
      this.title.text = 'LOADING' + dotStr
    }, 500)
  }
}
```

### Game Title with Subtitle

```typescript
const gameTitle = new GroupRenderable('game-title', {
  flexDirection: 'column',
  alignItems: 'center',
  gap: 1
})

const mainTitle = new ASCIIFontRenderable('main', {
  text: 'SPACE',
  font: 'block',
  fg: ['#0000ff', '#0066ff', '#00aaff', '#00ddff', '#00ffff']
})

const subTitle = new ASCIIFontRenderable('sub', {
  text: 'INVADERS',
  font: 'shade',
  fg: '#ff0000'
})

const tagline = new TextRenderable('tagline', {
  content: 'Press ENTER to start',
  fg: '#999999'
})

gameTitle.appendChild(mainTitle)
gameTitle.appendChild(subTitle)
gameTitle.appendChild(tagline)
```

## Text Selection

ASCIIFontRenderable supports text selection when `selectable` is true:

```typescript
const selectableTitle = new ASCIIFontRenderable('title', {
  text: 'SELECT ME',
  font: 'tiny',
  selectable: true,
  selectionBg: '#0066cc',
  selectionFg: '#ffffff'
})

// Check if has selection
if (selectableTitle.hasSelection()) {
  const selected = selectableTitle.getSelectedText()
  console.log('Selected:', selected)
}
```

## Performance Considerations

1. **Font Rendering**: ASCII fonts are pre-rendered to a frame buffer
2. **Size**: Larger fonts consume more screen space and memory
3. **Color Arrays**: Using color arrays has minimal performance impact
4. **Updates**: Changing text or font triggers a full re-render

## Dimensions

The component automatically calculates its dimensions based on:
- Font size
- Text length
- Font style

Dimensions update automatically when text or font changes.

## Integration

```typescript
// Complete example: Game menu
const menu = new BoxRenderable('menu', {
  width: 60,
  height: 30,
  borderStyle: 'double',
  backgroundColor: '#1a1a1a'
})

const content = new GroupRenderable('content', {
  flexDirection: 'column',
  alignItems: 'center',
  padding: 2,
  gap: 2
})

const title = new ASCIIFontRenderable('title', {
  text: 'MAIN MENU',
  font: 'block',
  fg: '#00ff00'
})

const options = new Select('options', {
  options: ['New Game', 'Load Game', 'Settings', 'Exit'],
  width: 30,
  selectedBg: '#003366'
})

content.appendChild(title)
content.appendChild(options)
menu.appendChild(content)
```

## Limitations

1. **Character Set**: Limited to ASCII characters
2. **Font Selection**: Only 4 built-in fonts available
3. **Scaling**: Cannot dynamically scale fonts
4. **Line Breaks**: Single line only (no multi-line support)