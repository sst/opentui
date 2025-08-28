# Console Demo

This demo recreates the OpenTUI console logging demo from TypeScript, showcasing interactive buttons and console logging functionality.

## Features

- **Interactive Buttons**: 5 colored buttons for different log levels (LOG, INFO, WARN, ERROR, DEBUG)
- **Visual Effects**: Sparkle animations when buttons are clicked
- **Mouse Support**: Mouse tracking enabled for clickable interactions
- **Keyboard Controls**: Fallback keyboard controls for button activation
- **Console Logging**: Different log levels with structured output
- **Statistics Tracking**: Click counters for each button type
- **Beautiful UI**: Bordered buttons, decorative elements, and colored text

## Controls

### Keyboard Controls
- **1-5**: Trigger buttons (LOG, INFO, WARN, ERROR, DEBUG)
- **q/Q**: Quit demo
- **ESC**: Exit

### Mouse Controls (if supported)
- **Click**: Click on buttons to trigger them
- **Hover**: Buttons change color on hover

## Running the Demo

```bash
# Build the demo
go build .

# Run the demo
./console
```

## Implementation Highlights

### ConsoleButton Struct
```go
type ConsoleButton struct {
    ID           string
    X, Y         int32
    Width, Height uint32
    Label        string
    LogType      string
    
    // Colors for different states
    OriginalBg   opentui.RGBA
    HoverBg      opentui.RGBA  
    PressBg      opentui.RGBA
    BorderColor  opentui.RGBA
    
    // State tracking
    IsHovered    bool
    IsPressed    bool
    LastClickTime time.Time
    ClickCount   int
}
```

### Visual Effects
- **Sparkle Animation**: ✦ symbols appear briefly when buttons are clicked
- **Color States**: Buttons change color based on hover/press state
- **Alpha Blending**: Smooth color transitions and transparency effects

### Console Logging
Each button type produces different log output:
- **LOG**: Regular console.log output
- **INFO**: Informational messages
- **WARN**: Warning messages with additional context
- **ERROR**: Error messages with error codes
- **DEBUG**: Debug information with variables

### Input Handling
The demo supports multiple input modes:
1. **Raw Terminal Input**: Direct key reading for responsive controls
2. **Simple Line Input**: Fallback mode for terminals without raw input support
3. **Mouse Events**: ANSI mouse tracking (where supported)

## Terminal Compatibility

Works best in terminals that support:
- ANSI escape sequences
- Mouse tracking (optional)
- 24-bit color (optional, fallback to 8-bit)

Tested terminals:
- ✅ macOS Terminal.app
- ✅ iTerm2
- ✅ VSCode Terminal
- ✅ Most Linux terminals

## Architecture

The demo showcases several OpenTUI Go wrapper features:

1. **Renderer Management**: Creating, configuring, and managing the terminal renderer
2. **Buffer Operations**: Drawing text, boxes, and visual elements
3. **Mouse Support**: Enabling/disabling mouse tracking
4. **Color Management**: Using RGBA colors with alpha blending
5. **Text Attributes**: Bold, italic, and other text styling
6. **Event Loop**: Handling input and rendering in a game-style loop

This serves as both a functional demo and a reference implementation for building interactive terminal applications with the OpenTUI Go wrapper.