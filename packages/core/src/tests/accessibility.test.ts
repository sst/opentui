import { describe, expect, it, beforeEach } from "bun:test"
import {
  AccessibilityManager,
  getAccessibilityManager,
  AccessibilityEventType,
  type AccessibilityNode,
} from "../lib/AccessibilityManager"
import type { AccessibilityRole, AccessibilityLive } from "../Renderable"

describe("AccessibilityManager", () => {
  let manager: AccessibilityManager

  beforeEach(() => {
    manager = new AccessibilityManager()
  })

  describe("enabled state", () => {
    it("should be disabled by default", () => {
      expect(manager.enabled).toBe(false)
    })

    it("should enable when setEnabled(true) is called", () => {
      manager.setEnabled(true)
      expect(manager.enabled).toBe(true)
    })

    it("should disable when setEnabled(false) is called", () => {
      manager.setEnabled(true)
      manager.setEnabled(false)
      expect(manager.enabled).toBe(false)
    })

    it("should emit enabled-changed event", () => {
      let emittedValue = false
      manager.on("enabled-changed", (enabled: boolean) => {
        emittedValue = enabled
      })

      manager.setEnabled(true)
      expect(emittedValue).toBe(true)
    })
  })

  describe("node management", () => {
    it("should return undefined for unknown node", () => {
      expect(manager.getNode(999)).toBeUndefined()
    })

    it("should return all nodes as empty array initially", () => {
      expect(manager.getAllNodes()).toEqual([])
    })
  })

  describe("singleton accessor", () => {
    it("should return same instance", () => {
      const m1 = getAccessibilityManager()
      const m2 = getAccessibilityManager()
      expect(m1).toBe(m2)
    })
  })

  describe("announce", () => {
    it("should emit announcement event when enabled", () => {
      manager.setEnabled(true)
      let eventReceived = false

      manager.on("accessibility-event", (event) => {
        if (event.type === AccessibilityEventType.ANNOUNCEMENT) {
          eventReceived = true
          expect(event.data).toEqual({ message: "Test message", priority: "polite" })
        }
      })

      manager.announce("Test message")
      expect(eventReceived).toBe(true)
    })

    it("should not emit when disabled", () => {
      let eventReceived = false
      manager.on("accessibility-event", () => {
        eventReceived = true
      })

      manager.announce("Test message")
      expect(eventReceived).toBe(false)
    })
  })
})

describe("Accessibility Types", () => {
  it("should have valid AccessibilityRole values", () => {
    const roles: AccessibilityRole[] = [
      "none",
      "button",
      "text",
      "input",
      "checkbox",
      "radio",
      "list",
      "listItem",
      "menu",
      "menuItem",
      "dialog",
      "alert",
      "progressbar",
      "slider",
      "scrollbar",
      "group",
    ]

    expect(roles.length).toBe(16)
  })

  it("should have valid AccessibilityLive values", () => {
    const liveValues: AccessibilityLive[] = ["off", "polite", "assertive"]
    expect(liveValues.length).toBe(3)
  })
})
