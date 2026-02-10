#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  TextRenderable,
  FrameBufferRenderable,
  RGBA,
  SelectRenderable,
  SelectRenderableEvents,
  BoxRenderable,
  TextareaRenderable,
  type SelectOption,
  type KeyEvent,
  type ThemeMode,
  ASCIIFontRenderable,
} from "../index"
import { measureText } from "../lib/ascii.font"
import * as goldenStarDemo from "./golden-star-demo"
import * as boxExample from "./fonts"
import * as fractalShaderExample from "./fractal-shader-demo"
import * as framebufferExample from "./framebuffer-demo"
import * as lightsPhongExample from "./lights-phong-demo"
import * as physxPlanckExample from "./physx-planck-2d-demo"
import * as physxRapierExample from "./physx-rapier-2d-demo"
import * as opentuiDemo from "./opentui-demo"
import * as nestedZIndexDemo from "./nested-zindex-demo"
import * as relativePositioningDemo from "./relative-positioning-demo"
import * as transparencyDemo from "./transparency-demo"
import * as draggableThreeDemo from "./draggable-three-demo"
import * as scrollExample from "./scroll-example"
import * as stickyScrollExample from "./sticky-scroll-example"
import * as shaderCubeExample from "./shader-cube-demo"
import * as spriteAnimationExample from "./sprite-animation-demo"
import * as spriteParticleExample from "./sprite-particle-generator-demo"
import * as staticSpriteExample from "./static-sprite-demo"
import * as textureLoadingExample from "./texture-loading-demo"
import * as timelineExample from "./timeline-example"
import * as tabSelectExample from "./tab-select-demo"
import * as selectExample from "./select-demo"
import * as inputExample from "./input-demo"
import * as layoutExample from "./simple-layout-example"
import * as inputSelectLayoutExample from "./input-select-layout-demo"
import * as styledTextExample from "./styled-text-demo"
import * as mouseInteractionExample from "./mouse-interaction-demo"
import * as textSelectionExample from "./text-selection-demo"
import * as asciiFontSelectionExample from "./ascii-font-selection-demo"
import * as splitModeExample from "./split-mode-demo"
import * as consoleExample from "./console-demo"
import * as vnodeCompositionDemo from "./vnode-composition-demo"
import * as hastSyntaxHighlightingExample from "./hast-syntax-highlighting-demo"
import * as codeDemo from "./code-demo"
import * as liveStateExample from "./live-state-demo"
import * as fullUnicodeExample from "./full-unicode-demo"
import * as textNodeDemo from "./text-node-demo"
import * as textWrapExample from "./text-wrap"
import * as editorDemo from "./editor-demo"
import * as sliderDemo from "./slider-demo"
import * as terminalDemo from "./terminal"
import * as diffDemo from "./diff-demo"
import * as keypressDebugDemo from "./keypress-debug-demo"
import * as extmarksDemo from "./extmarks-demo"
import * as markdownDemo from "./markdown-demo"
import * as linkDemo from "./link-demo"
import * as opacityExample from "./opacity-example"
import * as scrollboxOverlayHitTest from "./scrollbox-overlay-hit-test"
import * as scrollboxMouseTest from "./scrollbox-mouse-test"
import * as textTruncationDemo from "./text-truncation-demo"
import * as grayscaleBufferDemo from "./grayscale-buffer-demo"
import * as focusRestoreDemo from "./focus-restore-demo"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

interface Example {
  name: string
  description: string
  run?: (renderer: CliRenderer) => void
  destroy?: (renderer: CliRenderer) => void
}

interface ExampleTheme {
  titleColor: RGBA
  borderColor: string
  focusedBorderColor: string
  inputTextColor: string
  inputFocusedTextColor: string
  inputPlaceholderColor: string
  inputCursorColor: string
  selectSelectedBackgroundColor: string
  selectTextColor: string
  selectSelectedTextColor: string
  selectDescriptionColor: string
  selectSelectedDescriptionColor: string
  instructionsColor: string
  notImplementedColor: string
}

const DEFAULT_THEME_MODE: ThemeMode = "dark"

const MENU_THEMES: Record<ThemeMode, ExampleTheme> = {
  dark: {
    titleColor: RGBA.fromInts(240, 248, 255, 255),
    borderColor: "#475569",
    focusedBorderColor: "#60A5FA",
    inputTextColor: "#E2E8F0",
    inputFocusedTextColor: "#F8FAFC",
    inputPlaceholderColor: "#94A3B8",
    inputCursorColor: "#60A5FA",
    selectSelectedBackgroundColor: "#1E3A5F",
    selectTextColor: "#E2E8F0",
    selectSelectedTextColor: "#38BDF8",
    selectDescriptionColor: "#64748B",
    selectSelectedDescriptionColor: "#94A3B8",
    instructionsColor: "#94A3B8",
    notImplementedColor: "#FACC15",
  },
  light: {
    titleColor: RGBA.fromInts(15, 23, 42, 255),
    borderColor: "#CBD5E1",
    focusedBorderColor: "#2563EB",
    inputTextColor: "#0F172A",
    inputFocusedTextColor: "#0B1221",
    inputPlaceholderColor: "#64748B",
    inputCursorColor: "#2563EB",
    selectSelectedBackgroundColor: "#DBEAFE",
    selectTextColor: "#0F172A",
    selectSelectedTextColor: "#1D4ED8",
    selectDescriptionColor: "#475569",
    selectSelectedDescriptionColor: "#1E40AF",
    instructionsColor: "#475569",
    notImplementedColor: "#B45309",
  },
}

const examples: Example[] = [
  {
    name: "Golden Star Demo",
    description: "3D golden star with particle effects and animated text celebrating 5000 stars",
    run: goldenStarDemo.run,
    destroy: goldenStarDemo.destroy,
  },
  {
    name: "Mouse Interaction Demo",
    description: "Interactive mouse trails and clickable cells demonstration",
    run: mouseInteractionExample.run,
    destroy: mouseInteractionExample.destroy,
  },
  {
    name: "Text Selection Demo",
    description: "Text selection across multiple renderables with mouse drag",
    run: textSelectionExample.run,
    destroy: textSelectionExample.destroy,
  },
  {
    name: "Text Truncation Demo",
    description: "Middle truncation with ellipsis - toggle with 'T' key and resize to test responsive behavior",
    run: textTruncationDemo.run,
    destroy: textTruncationDemo.destroy,
  },
  {
    name: "ASCII Font Selection Demo",
    description: "Text selection with ASCII fonts - precise character-level selection across different font types",
    run: asciiFontSelectionExample.run,
    destroy: asciiFontSelectionExample.destroy,
  },
  {
    name: "Text Wrap Demo",
    description: "Text wrapping example",
    run: textWrapExample.run,
    destroy: textWrapExample.destroy,
  },
  {
    name: "Console Demo",
    description: "Interactive console logging with clickable buttons for different log levels",
    run: consoleExample.run,
    destroy: consoleExample.destroy,
  },
  {
    name: "Styled Text Demo",
    description: "Template literals with styled text, colors, and formatting",
    run: styledTextExample.run,
    destroy: styledTextExample.destroy,
  },
  {
    name: "Link Demo",
    description: "Hyperlink support with OSC 8 - clickable links and link inheritance in styled text",
    run: linkDemo.run,
    destroy: linkDemo.destroy,
  },
  {
    name: "Extmarks Demo",
    description: "Virtual extmarks - text ranges that cursor jumps over, like inline tags and links",
    run: extmarksDemo.run,
    destroy: extmarksDemo.destroy,
  },
  {
    name: "Opacity Demo",
    description: "Box opacity and transparency effects with animated opacity transitions",
    run: opacityExample.run,
    destroy: opacityExample.destroy,
  },
  {
    name: "TextNode Demo",
    description: "TextNode API for building complex styled text structures",
    run: textNodeDemo.run,
    destroy: textNodeDemo.destroy,
  },
  {
    name: "HAST Syntax Highlighting Demo",
    description: "Convert HAST trees to syntax-highlighted text with efficient chunk generation",
    run: hastSyntaxHighlightingExample.run,
    destroy: hastSyntaxHighlightingExample.destroy,
  },
  {
    name: "Code Demo",
    description:
      "Code viewer with line numbers, diff highlights, and diagnostics using CodeRenderable + LineNumberRenderable",
    run: codeDemo.run,
    destroy: codeDemo.destroy,
  },
  {
    name: "Diff Demo",
    description: "Unified and split diff views with syntax highlighting and multiple themes",
    run: diffDemo.run,
    destroy: diffDemo.destroy,
  },
  {
    name: "Markdown Demo",
    description: "Markdown rendering with table alignment, syntax highlighting, and theme switching",
    run: markdownDemo.run,
    destroy: markdownDemo.destroy,
  },
  {
    name: "Live State Management Demo",
    description: "Test automatic renderer lifecycle management with live renderables",
    run: liveStateExample.run,
    destroy: liveStateExample.destroy,
  },
  {
    name: "Layout System Demo",
    description: "Flex layout system with multiple configurations",
    run: layoutExample.run,
    destroy: layoutExample.destroy,
  },
  {
    name: "Input & Select Layout Demo",
    description: "Interactive layout with input and select elements",
    run: inputSelectLayoutExample.run,
    destroy: inputSelectLayoutExample.destroy,
  },
  {
    name: "ASCII Font Demo",
    description: "ASCII font rendering with various colors and text",
    run: boxExample.run,
    destroy: boxExample.destroy,
  },
  {
    name: "OpenTUI Demo",
    description: "Multi-tab demo with various features",
    run: opentuiDemo.run,
    destroy: opentuiDemo.destroy,
  },
  {
    name: "Nested Z-Index Demo",
    description: "Demonstrates z-index behavior with nested render objects",
    run: nestedZIndexDemo.run,
    destroy: nestedZIndexDemo.destroy,
  },
  {
    name: "Relative Positioning Demo",
    description: "Shows how child positions are relative to their parent containers",
    run: relativePositioningDemo.run,
    destroy: relativePositioningDemo.destroy,
  },
  {
    name: "Transparency Demo",
    description: "Alpha blending and transparency effects demonstration",
    run: transparencyDemo.run,
    destroy: transparencyDemo.destroy,
  },
  {
    name: "Draggable ThreeRenderable",
    description: "Draggable WebGPU cube with live animation",
    run: draggableThreeDemo.run,
    destroy: draggableThreeDemo.destroy,
  },
  {
    name: "Static Sprite",
    description: "Static sprite rendering demo",
    run: staticSpriteExample.run,
    destroy: staticSpriteExample.destroy,
  },
  {
    name: "Sprite Animation",
    description: "Animated sprite sequences",
    run: spriteAnimationExample.run,
    destroy: spriteAnimationExample.destroy,
  },
  {
    name: "Sprite Particles",
    description: "Particle system with sprites",
    run: spriteParticleExample.run,
    destroy: spriteParticleExample.destroy,
  },
  {
    name: "Framebuffer Demo",
    description: "Framebuffer rendering techniques",
    run: framebufferExample.run,
    destroy: framebufferExample.destroy,
  },
  {
    name: "Texture Loading",
    description: "Loading and displaying textures",
    run: textureLoadingExample.run,
    destroy: textureLoadingExample.destroy,
  },
  {
    name: "ScrollBox Demo",
    description: "Scrollable container with customization",
    run: scrollExample.run,
    destroy: scrollExample.destroy,
  },
  {
    name: "Sticky Scroll Demo",
    description: "ScrollBox with sticky scroll behavior - maintains position at borders when content changes",
    run: stickyScrollExample.run,
    destroy: stickyScrollExample.destroy,
  },
  {
    name: "Scrollbox Mouse Test",
    description: "Test scrollbox mouse hit detection with hover and click events",
    run: scrollboxMouseTest.run,
    destroy: scrollboxMouseTest.destroy,
  },
  {
    name: "Scrollbox Overlay Hit Test",
    description: "Test scrollbox hit detection with overlays and dialogs",
    run: scrollboxOverlayHitTest.run,
    destroy: scrollboxOverlayHitTest.destroy,
  },
  {
    name: "Shader Cube",
    description: "3D cube with custom shaders",
    run: shaderCubeExample.run,
    destroy: shaderCubeExample.destroy,
  },
  {
    name: "Fractal Shader",
    description: "Fractal rendering with shaders",
    run: fractalShaderExample.run,
    destroy: fractalShaderExample.destroy,
  },
  {
    name: "Phong Lighting",
    description: "Phong lighting model demo",
    run: lightsPhongExample.run,
    destroy: lightsPhongExample.destroy,
  },
  {
    name: "Physics Planck",
    description: "2D physics with Planck.js",
    run: physxPlanckExample.run,
    destroy: physxPlanckExample.destroy,
  },
  {
    name: "Physics Rapier",
    description: "2D physics with Rapier",
    run: physxRapierExample.run,
    destroy: physxRapierExample.destroy,
  },
  {
    name: "Timeline Example",
    description: "Animation timeline system",
    run: timelineExample.run,
    destroy: timelineExample.destroy,
  },
  {
    name: "Tab Select",
    description: "Tab selection demo",
    run: tabSelectExample.run,
    destroy: tabSelectExample.destroy,
  },
  {
    name: "Select Demo",
    description: "Interactive SelectElement demo with customizable options",
    run: selectExample.run,
    destroy: selectExample.destroy,
  },
  {
    name: "Input Demo",
    description: "Interactive InputElement demo with validation and multiple fields",
    run: inputExample.run,
    destroy: inputExample.destroy,
  },
  {
    name: "Terminal Palette Demo",
    description: "Terminal color palette detection and visualization - fetch and display all 256 terminal colors",
    run: terminalDemo.run,
    destroy: terminalDemo.destroy,
  },
  {
    name: "Editor Demo",
    description: "Interactive text editor with TextareaRenderable - supports full editing capabilities",
    run: editorDemo.run,
    destroy: editorDemo.destroy,
  },
  {
    name: "Extmarks Demo",
    description: "Virtual extmarks - text ranges that the cursor jumps over, with deletion handling",
    run: extmarksDemo.run,
    destroy: extmarksDemo.destroy,
  },
  {
    name: "Slider Demo",
    description: "Interactive slider components with various orientations and configurations",
    run: sliderDemo.run,
    destroy: sliderDemo.destroy,
  },
  {
    name: "VNode Composition Demo",
    description: "Declarative Box(Box(Box(children))) composition",
    run: vnodeCompositionDemo.run,
    destroy: vnodeCompositionDemo.destroy,
  },
  {
    name: "Full Unicode Demo",
    description: "Draggable boxes and background filled with complex graphemes",
    run: fullUnicodeExample.run,
    destroy: fullUnicodeExample.destroy,
  },
  {
    name: "Split Mode Demo (Experimental)",
    description: "Renderer confined to bottom area with normal terminal output above",
    run: splitModeExample.run,
    destroy: splitModeExample.destroy,
  },
  {
    name: "Keypress Debug Tool",
    description: "Debug tool to inspect keypress events, raw input, and terminal capabilities",
    run: keypressDebugDemo.run,
    destroy: keypressDebugDemo.destroy,
  },
  {
    name: "Grayscale Buffer",
    description: "Grayscale buffer rendering with 1x vs 2x supersampled intensity",
    run: grayscaleBufferDemo.run,
    destroy: grayscaleBufferDemo.destroy,
  },
  {
    name: "Focus Restore Demo",
    description: "Test focus restore - alt-tab away and back to verify mouse tracking resumes",
    run: focusRestoreDemo.run,
    destroy: focusRestoreDemo.destroy,
  },
]

class ExampleSelector {
  private renderer: CliRenderer
  private currentExample: Example | null = null
  private inMenu = true
  private themeMode: ThemeMode = DEFAULT_THEME_MODE

  private menuContainer: BoxRenderable | null = null
  private title: FrameBufferRenderable | null = null
  private filterBox: BoxRenderable | null = null
  private filterInput: TextareaRenderable | null = null
  private instructions: TextRenderable | null = null
  private selectElement: SelectRenderable | null = null
  private selectBox: BoxRenderable | null = null
  private notImplementedText: TextRenderable | null = null
  private allExamples: Example[] = examples

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.themeMode = this.renderer.themeMode ?? DEFAULT_THEME_MODE
    this.createLayout()
    this.setupKeyboardHandling()

    this.renderer.on("theme_mode", (mode: ThemeMode) => {
      this.applyTheme(mode)
      console.log(`Theme mode changed to ${mode}, applied new theme to menu`)
    })

    this.applyTheme(this.renderer.themeMode)

    this.renderer.on("resize", (width: number, height: number) => {
      this.handleResize(width, height)
    })
  }

  private createLayout(): void {
    const width = this.renderer.terminalWidth
    const theme = MENU_THEMES[this.themeMode]

    // Menu container with column layout
    this.menuContainer = new BoxRenderable(renderer, {
      id: "example-menu-container",
      flexDirection: "column",
      width: "100%",
      height: "100%",
    })
    this.renderer.root.add(this.menuContainer)

    // Title
    const titleText = "OPENTUI EXAMPLES"
    const titleFont = "tiny"
    const { width: titleWidth } = measureText({ text: titleText, font: titleFont })
    const centerX = Math.floor(width / 2) - Math.floor(titleWidth / 2)

    this.title = new ASCIIFontRenderable(renderer, {
      id: "example-index-title",
      left: centerX,
      margin: 1,
      text: titleText,
      font: titleFont,
      color: theme.titleColor,
      backgroundColor: "transparent",
    })
    this.menuContainer.add(this.title)

    // Filter box with border (grows with content)
    this.filterBox = new BoxRenderable(renderer, {
      id: "example-index-filter-box",
      marginLeft: 1,
      marginRight: 1,
      flexShrink: 0,
      backgroundColor: "transparent",
      border: true,
      borderStyle: "single",
      borderColor: theme.borderColor,
    })
    this.menuContainer.add(this.filterBox)

    // Filter input inside the box (transparent bg so box bg shows through)
    this.filterInput = new TextareaRenderable(renderer, {
      id: "example-index-filter-input",
      width: "100%",
      height: 1,
      placeholder: "Filter examples by title...",
      placeholderColor: theme.inputPlaceholderColor,
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      textColor: theme.inputTextColor,
      focusedTextColor: theme.inputFocusedTextColor,
      wrapMode: "none",
      showCursor: true,
      cursorColor: theme.inputCursorColor,
      onContentChange: () => {
        this.filterExamples()
      },
    })
    this.filterBox.add(this.filterInput)
    this.filterInput.focus()

    // Select box (grows to fill remaining space)
    this.selectBox = new BoxRenderable(renderer, {
      id: "example-selector-box",
      marginLeft: 1,
      marginRight: 1,
      marginBottom: 1,
      flexGrow: 1,
      borderStyle: "single",
      borderColor: theme.borderColor,
      focusedBorderColor: theme.focusedBorderColor,
      title: "Examples",
      titleAlignment: "center",
      backgroundColor: "transparent",
      shouldFill: true,
      border: true,
    })
    this.menuContainer.add(this.selectBox)

    // Select element
    const selectOptions: SelectOption[] = examples.map((example) => ({
      name: example.name,
      description: example.description,
      value: example,
    }))

    this.selectElement = new SelectRenderable(renderer, {
      id: "example-selector",
      height: "100%",
      options: selectOptions,
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      selectedBackgroundColor: theme.selectSelectedBackgroundColor,
      textColor: theme.selectTextColor,
      selectedTextColor: theme.selectSelectedTextColor,
      descriptionColor: theme.selectDescriptionColor,
      selectedDescriptionColor: theme.selectSelectedDescriptionColor,
      showScrollIndicator: true,
      wrapSelection: true,
      showDescription: true,
      fastScrollStep: 5,
    })
    this.selectBox.add(this.selectElement)

    this.selectElement.on(SelectRenderableEvents.ITEM_SELECTED, (index: number, option: SelectOption) => {
      this.runSelected(option.value as Example)
    })

    // Instructions at the bottom
    this.instructions = new TextRenderable(renderer, {
      id: "example-index-instructions",
      height: 1,
      flexShrink: 0,
      alignSelf: "center",
      content: "Type to filter | ↑↓/j/k navigate | Enter run | Esc clear/return | ctrl+c quit",
      fg: theme.instructionsColor,
    })
    this.menuContainer.add(this.instructions)
  }

  private applyTheme(mode: ThemeMode | null): void {
    this.themeMode = mode ?? DEFAULT_THEME_MODE
    const theme = MENU_THEMES[this.themeMode]

    if (this.title) {
      this.title.color = theme.titleColor
    }

    if (this.filterBox) {
      this.filterBox.borderColor = theme.borderColor
    }

    if (this.filterInput) {
      this.filterInput.textColor = theme.inputTextColor
      this.filterInput.focusedTextColor = theme.inputFocusedTextColor
      this.filterInput.placeholderColor = theme.inputPlaceholderColor
      this.filterInput.cursorColor = theme.inputCursorColor
    }

    if (this.selectBox) {
      this.selectBox.borderColor = theme.borderColor
      this.selectBox.focusedBorderColor = theme.focusedBorderColor
    }

    if (this.selectElement) {
      this.selectElement.selectedBackgroundColor = theme.selectSelectedBackgroundColor
      this.selectElement.textColor = theme.selectTextColor
      this.selectElement.selectedTextColor = theme.selectSelectedTextColor
      this.selectElement.descriptionColor = theme.selectDescriptionColor
      this.selectElement.selectedDescriptionColor = theme.selectSelectedDescriptionColor
    }

    if (this.instructions) {
      this.instructions.fg = theme.instructionsColor
    }

    if (this.notImplementedText) {
      this.notImplementedText.fg = theme.notImplementedColor
    }

    this.renderer.requestRender()
  }

  private filterExamples(): void {
    if (!this.filterInput || !this.selectElement) return

    const filterText = this.filterInput.editBuffer.getText().toLowerCase().trim()

    if (filterText === "") {
      // Show all examples
      const selectOptions: SelectOption[] = this.allExamples.map((example) => ({
        name: example.name,
        description: example.description,
        value: example,
      }))
      this.selectElement.options = selectOptions
    } else {
      // Filter by title only
      const filtered = this.allExamples.filter((example) => example.name.toLowerCase().includes(filterText))
      const selectOptions: SelectOption[] = filtered.map((example) => ({
        name: example.name,
        description: example.description,
        value: example,
      }))
      this.selectElement.options = selectOptions
    }
  }

  private handleResize(width: number, height: number): void {
    if (this.title) {
      const titleWidth = this.title.frameBuffer.width
      const centerX = Math.floor(width / 2) - Math.floor(titleWidth / 2)
      this.title.x = centerX
    }

    this.renderer.requestRender()
  }

  private setupKeyboardHandling(): void {
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      if (key.name === "c" && key.ctrl) {
        this.cleanup()
        return
      }

      if (!this.inMenu) {
        switch (key.name) {
          case "escape":
            this.returnToMenu()
            break
        }
        return
      }

      // Forward navigation keys to select even when filter is focused
      if (this.filterInput?.focused && this.selectElement) {
        // Navigation keys: arrow up/down, j/k, shift variants
        if (key.name === "up" || key.name === "k") {
          key.preventDefault()
          if (key.shift) {
            this.selectElement.moveUp(5)
          } else {
            this.selectElement.moveUp(1)
          }
          return
        }
        if (key.name === "down" || key.name === "j") {
          key.preventDefault()
          if (key.shift) {
            this.selectElement.moveDown(5)
          } else {
            this.selectElement.moveDown(1)
          }
          return
        }
        // Enter to select
        if (key.name === "return" || key.name === "linefeed") {
          key.preventDefault()
          this.selectElement.selectCurrent()
          return
        }
      }

      // Handle Escape: clear filter if has content
      if (key.name === "escape") {
        if (this.filterInput) {
          const filterText = this.filterInput.editBuffer.getText()
          if (filterText.length > 0) {
            key.preventDefault()
            this.filterInput.editBuffer.setText("")
            this.filterExamples()
            return
          }
        }
      }

      if (key.name === "c" && key.ctrl) {
        this.cleanup()
        return
      }
      switch (key.name) {
        case "c":
          console.log("Capabilities:", this.renderer.capabilities)
          break
        case "z":
          if (key.ctrl) {
            console.log("Suspending renderer... (will auto-resume in 5 seconds)")
            this.renderer.suspend()
            setTimeout(() => {
              console.log("Resuming renderer...")
              this.renderer.resume()
            }, 5000)
          }
          break
      }
    })
    setupCommonDemoKeys(this.renderer)
  }

  private runSelected(selected: Example): void {
    this.inMenu = false
    this.hideMenuElements()

    if (selected.run) {
      this.currentExample = selected
      selected.run(this.renderer)
    } else {
      if (!this.notImplementedText) {
        const theme = MENU_THEMES[this.themeMode]
        this.notImplementedText = new TextRenderable(renderer, {
          id: "not-implemented",
          position: "absolute",
          left: 10,
          top: 10,
          content: `${selected.name} not yet implemented. Press Escape to return.`,
          fg: theme.notImplementedColor,
          zIndex: 10,
        })
        this.renderer.root.add(this.notImplementedText)
      }
      this.renderer.requestRender()
    }
  }

  private hideMenuElements(): void {
    if (this.menuContainer) {
      this.menuContainer.visible = false
    }
    if (this.title) {
      this.title.visible = false
    }
    if (this.filterBox) {
      this.filterBox.visible = false
    }
    if (this.selectBox) {
      this.selectBox.visible = false
    }
    if (this.instructions) {
      this.instructions.visible = false
    }
    if (this.filterInput) {
      this.filterInput.blur()
    }
    if (this.selectElement) {
      this.selectElement.blur()
    }
  }

  private showMenuElements(): void {
    if (this.menuContainer) {
      this.menuContainer.visible = true
    }
    if (this.title) {
      this.title.visible = true
    }
    if (this.filterBox) {
      this.filterBox.visible = true
    }
    if (this.selectBox) {
      this.selectBox.visible = true
    }
    if (this.instructions) {
      this.instructions.visible = true
    }
    if (this.filterInput) {
      // Clear filter when returning to menu
      this.filterInput.editBuffer.setText("")
      this.filterInput.focus()
    }
    // Reset filter to show all examples
    this.filterExamples()
  }

  private returnToMenu(): void {
    if (this.currentExample) {
      this.currentExample.destroy?.(this.renderer)
      this.currentExample = null
    }

    if (this.notImplementedText) {
      this.renderer.root.remove(this.notImplementedText.id)
      this.notImplementedText = null
    }

    this.inMenu = true
    this.restart()
  }

  private restart(): void {
    this.renderer.pause()
    this.renderer.auto()
    this.showMenuElements()
    this.renderer.setBackgroundColor("transparent")
    this.renderer.requestRender()
  }

  private cleanup(): void {
    if (this.currentExample) {
      this.currentExample.destroy?.(this.renderer)
    }
    if (this.filterInput) {
      this.filterInput.blur()
    }
    if (this.selectElement) {
      this.selectElement.blur()
    }
    if (this.menuContainer) {
      this.menuContainer.destroy()
    }
    this.renderer.destroy()
  }
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 60,
  // useAlternateScreen: false,
})

renderer.setBackgroundColor("transparent")
new ExampleSelector(renderer)
