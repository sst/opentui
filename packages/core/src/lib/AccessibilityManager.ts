import { EventEmitter } from "events"
import type { Renderable, AccessibilityRole, AccessibilityLive } from "../Renderable"

export interface AccessibilityNode {
  id: number
  role: AccessibilityRole
  name: string | undefined
  value: string | number | undefined
  hint: string | undefined
  hidden: boolean
  live: AccessibilityLive
  bounds: { x: number; y: number; width: number; height: number }
  focused: boolean
  parentId: number | null
  children: number[]
}

export enum AccessibilityEventType {
  FOCUS_CHANGED = "focus-changed",
  VALUE_CHANGED = "value-changed",
  STRUCTURE_CHANGED = "structure-changed",
  ANNOUNCEMENT = "announcement",
}

export interface AccessibilityEvent {
  type: AccessibilityEventType
  targetId: number
  data?: unknown
}

export class AccessibilityManager extends EventEmitter {
  private _enabled: boolean = false
  private _nodes: Map<number, AccessibilityNode> = new Map()
  private _focusedId: number | null = null

  constructor() {
    super()
  }

  public get enabled(): boolean {
    return this._enabled
  }

  public setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return

    this._enabled = enabled

    if (enabled) {
      this.initialize()
    } else {
      this.cleanup()
    }

    this.emit("enabled-changed", enabled)
  }

  private initialize(): void {
    // Future: Initialize platform-specific accessibility provider
    // Windows: Create hidden HWND, register UIA provider
    // macOS: Create NSAccessibilityElement hierarchy
    // Linux: Connect to AT-SPI2 D-Bus
  }

  private cleanup(): void {
    // Future: Cleanup platform-specific resources
    this._nodes.clear()
    this._focusedId = null
  }

  public buildNodeFromRenderable(renderable: Renderable): AccessibilityNode {
    const children = renderable.getChildren().map((child) => child.num)

    return {
      id: renderable.num,
      role: renderable.accessibilityRole,
      name: renderable.accessibilityLabel,
      value: renderable.accessibilityValue,
      hint: renderable.accessibilityHint,
      hidden: renderable.accessibilityHidden,
      live: renderable.accessibilityLive,
      bounds: {
        x: renderable.x,
        y: renderable.y,
        width: renderable.width,
        height: renderable.height,
      },
      focused: renderable.focused,
      parentId: renderable.parent?.num ?? null,
      children,
    }
  }

  public updateNode(renderable: Renderable): void {
    if (!this._enabled) return

    const node = this.buildNodeFromRenderable(renderable)
    this._nodes.set(node.id, node)

    // Emit structure change if this is a new node
    this.emit("node-updated", node)
  }

  public removeNode(id: number): void {
    if (!this._enabled) return

    this._nodes.delete(id)
    this.emit("node-removed", id)
  }

  public setFocused(renderable: Renderable | null): void {
    if (!this._enabled) return

    const newFocusedId = renderable?.num ?? null

    if (this._focusedId !== newFocusedId) {
      this._focusedId = newFocusedId

      this.raiseEvent({
        type: AccessibilityEventType.FOCUS_CHANGED,
        targetId: newFocusedId ?? 0,
      })
    }
  }

  public raiseEvent(event: AccessibilityEvent): void {
    if (!this._enabled) return

    this.emit("accessibility-event", event)

    // Future: Forward to platform-specific accessibility API
    // Windows: UiaRaiseAutomationEvent
    // macOS: NSAccessibilityPostNotification
    // Linux: AT-SPI2 D-Bus event emission
  }

  public announce(message: string, priority: "polite" | "assertive" = "polite"): void {
    if (!this._enabled) return

    this.raiseEvent({
      type: AccessibilityEventType.ANNOUNCEMENT,
      targetId: 0,
      data: { message, priority },
    })
  }

  public getNode(id: number): AccessibilityNode | undefined {
    return this._nodes.get(id)
  }

  public getAllNodes(): AccessibilityNode[] {
    return Array.from(this._nodes.values())
  }

  public getFocusedNode(): AccessibilityNode | undefined {
    if (this._focusedId === null) return undefined
    return this._nodes.get(this._focusedId)
  }

  public buildTree(root: Renderable): AccessibilityNode[] {
    const nodes: AccessibilityNode[] = []

    const traverse = (renderable: Renderable) => {
      if (renderable.accessibilityHidden) return

      const node = this.buildNodeFromRenderable(renderable)
      nodes.push(node)
      this._nodes.set(node.id, node)

      for (const child of renderable.getChildren()) {
        traverse(child as Renderable)
      }
    }

    traverse(root)
    return nodes
  }
}

// Singleton instance for global accessibility management
let globalAccessibilityManager: AccessibilityManager | null = null

export function getAccessibilityManager(): AccessibilityManager {
  if (!globalAccessibilityManager) {
    globalAccessibilityManager = new AccessibilityManager()
  }
  return globalAccessibilityManager
}
