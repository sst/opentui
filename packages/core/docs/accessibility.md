# Accessibility API

OpenTUI provides accessibility support for screen readers via cross-platform text-to-speech.

## Quick Start

```typescript
import { BoxRenderable, getAccessibilityManager } from "@opentui/core"

// Enable accessibility
const accessibility = getAccessibilityManager()
accessibility.setEnabled(true)

// Create accessible component
const button = new BoxRenderable(renderer, {
  accessibilityRole: "button",
  accessibilityLabel: "Submit Form",
  accessibilityHint: "Press Enter to submit",
})

// Announcements
accessibility.announce("Form submitted successfully", "polite")
```

## Accessibility Properties

| Property              | Type                | Description                               |
| --------------------- | ------------------- | ----------------------------------------- |
| `accessibilityRole`   | `AccessibilityRole` | Semantic role (button, text, input, etc.) |
| `accessibilityLabel`  | `string`            | Human-readable name for screen readers    |
| `accessibilityValue`  | `string \| number`  | Current value (for inputs, sliders)       |
| `accessibilityHint`   | `string`            | Additional context about the element      |
| `accessibilityHidden` | `boolean`           | Hide from assistive technologies          |
| `accessibilityLive`   | `AccessibilityLive` | Live region update behavior               |

## Roles

```typescript
type AccessibilityRole =
  | "none"
  | "button"
  | "text"
  | "input"
  | "checkbox"
  | "radio"
  | "list"
  | "listItem"
  | "menu"
  | "menuItem"
  | "dialog"
  | "alert"
  | "progressbar"
  | "slider"
  | "scrollbar"
  | "group"
```

## Live Regions

Control how dynamic content changes are announced:

- `"off"` - Don't announce changes
- `"polite"` - Announce when idle
- `"assertive"` - Announce immediately

## AccessibilityManager

```typescript
const manager = getAccessibilityManager()

// Enable/disable
manager.setEnabled(true)
manager.enabled // boolean

// Announcements
manager.announce("Message", "polite" | "assertive")

// Focus tracking
manager.setFocused(renderable) // Announces element name + role

// Events
manager.on("accessibility-event", (event) => {
  console.log(event.type, event.targetId)
})
```

## Platform Support

| Platform | TTS Method | Screen Reader  |
| -------- | ---------- | -------------- |
| Linux    | spd-say    | Orca           |
| Windows  | SAPI       | NVDA, Narrator |
| macOS    | say        | VoiceOver      |

### Linux Requirements

- `speech-dispatcher` installed
- `espeak-ng` for text-to-speech
- Configure: `DefaultModule espeak-ng` in `/etc/speech-dispatcher/speechd.conf`

### Windows Requirements

- PowerShell (included with Windows)
- System.Speech assembly (included with .NET Framework)

### macOS Requirements

- None - `say` is built into macOS

## Example

See `examples/accessibility-demo.ts` for a complete demonstration.
