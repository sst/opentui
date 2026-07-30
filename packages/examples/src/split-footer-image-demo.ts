import {
  BoxRenderable,
  CliRenderEvents,
  ImageRenderable,
  TextAttributes,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type ImageRenderProtocol,
  type KeyEvent,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

// @ts-ignore Bun embeds imported assets and returns their runtime paths.
import jpegPath from "./assets/dragon.jpg" with { type: "image/jpeg" }
// @ts-ignore Bun embeds imported assets and returns their runtime paths.
import pngPath from "./assets/image-demo.png" with { type: "image/png" }

const DEFAULT_FOOTER_HEIGHT = 12
const MIN_FOOTER_HEIGHT = 7
const MAX_FOOTER_HEIGHT = 18

const PALETTE = {
  background: "#071018",
  panel: "#0D1B26",
  imagePanel: "#102938",
  border: "#2C6075",
  accent: "#56D6C9",
  title: "#F4FBFF",
  text: "#D6E8F0",
  warning: "#FFCB6B",
} as const

const SOURCES = [
  { name: "PNG", path: pngPath },
  { name: "JPEG", path: jpegPath },
] as const
const PROTOCOLS: ImageRenderProtocol[] = ["auto", "kitty", "sixel", "blocks"]

class SplitFooterImageDemo {
  private shell: BoxRenderable
  private image: ImageRenderable
  private status: TextRenderable
  private sourceIndex = 0
  private protocolIndex = 0
  private fit: "fit" | "cover" | "fill" = "fit"
  private commitCount = 0
  private lastAction = "Ready"
  private destroyed = false

  constructor(private renderer: CliRenderer) {
    if (renderer.screenMode !== "split-footer") renderer.screenMode = "split-footer"
    renderer.footerHeight = DEFAULT_FOOTER_HEIGHT
    if (renderer.externalOutputMode !== "capture-stdout") renderer.externalOutputMode = "capture-stdout"
    renderer.setBackgroundColor(PALETTE.background)

    this.shell = new BoxRenderable(renderer, {
      id: "split-footer-image-shell",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      border: ["top"],
      borderColor: PALETTE.border,
      backgroundColor: PALETTE.panel,
      paddingLeft: 1,
      paddingRight: 1,
    })

    const heading = new TextRenderable(renderer, {
      id: "split-footer-image-heading",
      width: "100%",
      height: 2,
      flexGrow: 0,
      flexShrink: 0,
      content: "SPLIT FOOTER / LIVE IMAGE",
      fg: PALETTE.title,
      attributes: TextAttributes.BOLD,
    })

    const body = new BoxRenderable(renderer, {
      id: "split-footer-image-body",
      width: "100%",
      height: "auto",
      flexGrow: 1,
      flexShrink: 1,
      flexDirection: "row",
      gap: 2,
      backgroundColor: PALETTE.panel,
    })

    const imagePanel = new BoxRenderable(renderer, {
      id: "split-footer-image-panel",
      width: 28,
      height: "100%",
      minWidth: 12,
      flexGrow: 0,
      flexShrink: 1,
      border: true,
      borderColor: PALETTE.accent,
      title: "LIVE PLACEMENT",
      backgroundColor: PALETTE.imagePanel,
      padding: 1,
    })

    this.image = new ImageRenderable(renderer, {
      id: "split-footer-live-image",
      source: SOURCES[this.sourceIndex].path,
      protocol: PROTOCOLS[this.protocolIndex],
      fit: this.fit,
      width: "100%",
      height: "100%",
      onLoad: () => {
        this.lastAction = `${SOURCES[this.sourceIndex].name} loaded into the live footer`
        this.refreshStatus()
      },
      onError: (error) => {
        this.lastAction = `Image load failed: ${error instanceof Error ? error.message : String(error)}`
        this.refreshStatus()
      },
    })
    imagePanel.add(this.image)

    this.status = new TextRenderable(renderer, {
      id: "split-footer-image-status",
      width: "auto",
      height: "100%",
      flexGrow: 1,
      flexShrink: 1,
      wrapMode: "word",
      content: "",
      fg: PALETTE.text,
      bg: PALETTE.panel,
    })

    body.add(imagePanel)
    body.add(this.status)
    this.shell.add(heading)
    this.shell.add(body)
    renderer.root.add(this.shell)

    renderer.keyInput.on("keypress", this.handleKeyPress)
    renderer.on("capabilities", this.refreshStatus)
    renderer.on(CliRenderEvents.RESIZE, this.refreshStatus)
    renderer.on(CliRenderEvents.DESTROY, this.handleRendererDestroy)
    this.refreshStatus()
  }

  private refreshStatus = (): void => {
    if (this.destroyed || this.status.isDestroyed) return
    const requested = PROTOCOLS[this.protocolIndex]
    const effective = this.image.effectiveProtocol
    const mode = this.renderer.externalOutputMode
    const commitHint = mode === "capture-stdout" ? "W appends a scrollback snapshot" : "W requires capture mode"
    this.status.content = [
      `${SOURCES[this.sourceIndex].name}  ${requested.toUpperCase()} -> ${effective.toUpperCase()}  ${this.fit.toUpperCase()}`,
      `footer ${this.renderer.footerHeight} rows  /  ${mode}  /  ${this.commitCount} scrollback commits`,
      "I source   P protocol   F fit   [ ] height   M output mode",
      `${commitHint}. The image itself stays on the live footer surface.`,
      this.lastAction,
    ].join("\n")
    this.status.fg = mode === "capture-stdout" ? PALETTE.text : PALETTE.warning
  }

  private cycleSource(): void {
    this.sourceIndex = (this.sourceIndex + 1) % SOURCES.length
    this.lastAction = `Loading ${SOURCES[this.sourceIndex].name}`
    this.image.source = SOURCES[this.sourceIndex].path
    this.refreshStatus()
  }

  private cycleProtocol(): void {
    this.protocolIndex = (this.protocolIndex + 1) % PROTOCOLS.length
    this.image.protocol = PROTOCOLS[this.protocolIndex]
    this.lastAction = `Requested ${PROTOCOLS[this.protocolIndex]} rendering`
    this.refreshStatus()
  }

  private cycleFit(): void {
    this.fit = this.fit === "fit" ? "cover" : this.fit === "cover" ? "fill" : "fit"
    this.image.fit = this.fit
    this.lastAction = `Fit mode changed to ${this.fit}`
    this.refreshStatus()
  }

  private adjustFooterHeight(delta: number): void {
    const next = Math.min(MAX_FOOTER_HEIGHT, Math.max(MIN_FOOTER_HEIGHT, this.renderer.footerHeight + delta))
    if (next === this.renderer.footerHeight) {
      this.lastAction = "Footer height is already at the demo limit"
    } else {
      this.renderer.footerHeight = next
      this.lastAction = `Footer moved to ${next} rows; the native image should move with it`
    }
    this.refreshStatus()
  }

  private toggleOutputMode(): void {
    this.renderer.externalOutputMode =
      this.renderer.externalOutputMode === "capture-stdout" ? "passthrough" : "capture-stdout"
    this.lastAction =
      this.renderer.externalOutputMode === "capture-stdout"
        ? "Capture mode restored; scrollback commits are enabled"
        : "Passthrough mode enabled; change height to exercise placement relocation"
    this.refreshStatus()
  }

  private writeScrollbackSnapshot(): void {
    if (this.renderer.externalOutputMode !== "capture-stdout") {
      this.lastAction = "Switch to capture mode before writing a scrollback snapshot"
      this.refreshStatus()
      return
    }

    const commit = ++this.commitCount
    const source = SOURCES[this.sourceIndex].name
    const protocol = this.image.effectiveProtocol
    this.renderer.writeToScrollback((ctx) => {
      const root = new TextRenderable(ctx.renderContext, {
        id: `split-footer-image-commit-${commit}`,
        position: "absolute",
        left: 0,
        top: 0,
        width: ctx.width,
        height: 2,
        content: `IMAGE EVENT ${String(commit).padStart(2, "0")}  ${source} via ${protocol}\nLive footer repaints atomically after this text snapshot.`,
        fg: PALETTE.accent,
        bg: PALETTE.background,
        attributes: TextAttributes.BOLD,
      })
      return {
        root,
        width: ctx.width,
        height: 2,
        startOnNewLine: true,
        trailingNewline: true,
      }
    })

    this.lastAction = `Scrollback snapshot ${commit} queued; footer image remains live`
    this.refreshStatus()
  }

  private handleKeyPress = (key: KeyEvent): void => {
    if (key.ctrl || key.meta || key.option) return
    switch (key.name) {
      case "i":
        key.preventDefault()
        this.cycleSource()
        return
      case "p":
        key.preventDefault()
        this.cycleProtocol()
        return
      case "f":
        key.preventDefault()
        this.cycleFit()
        return
      case "[":
        key.preventDefault()
        this.adjustFooterHeight(-1)
        return
      case "]":
        key.preventDefault()
        this.adjustFooterHeight(1)
        return
      case "m":
        key.preventDefault()
        this.toggleOutputMode()
        return
      case "w":
        key.preventDefault()
        this.writeScrollbackSnapshot()
        return
    }
  }

  private handleRendererDestroy = (): void => {
    this.destroy()
  }

  public destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.renderer.keyInput.off("keypress", this.handleKeyPress)
    this.renderer.off("capabilities", this.refreshStatus)
    this.renderer.off(CliRenderEvents.RESIZE, this.refreshStatus)
    this.renderer.off(CliRenderEvents.DESTROY, this.handleRendererDestroy)
    if (!this.shell.isDestroyed) this.shell.destroyRecursively()
    if (!this.renderer.isDestroyed) {
      this.renderer.externalOutputMode = "passthrough"
      this.renderer.screenMode = "main-screen"
    }
  }
}

let activeDemo: SplitFooterImageDemo | null = null

export function run(renderer: CliRenderer): void {
  activeDemo?.destroy()
  activeDemo = new SplitFooterImageDemo(renderer)
}

export function destroy(_renderer: CliRenderer): void {
  activeDemo?.destroy()
  activeDemo = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    targetFps: 30,
    exitOnCtrlC: true,
    useMouse: false,
    screenMode: "split-footer",
    footerHeight: DEFAULT_FOOTER_HEIGHT,
    externalOutputMode: "capture-stdout",
    consoleMode: "disabled",
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
