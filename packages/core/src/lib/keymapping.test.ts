import { describe, expect, it } from "bun:test"
import {
  mergeKeyBindings,
  getKeyBindingKey,
  buildKeyBindingsMap,
  mergeKeyAliases,
  defaultKeyAliases,
  keyBindingToString,
  type KeyAliasMap,
} from "./keymapping"

describe("keymapping", () => {
  describe("getKeyBindingKey", () => {
    it("should generate key with meta modifier", () => {
      const metaBinding = { name: "a", meta: true, action: "test" }
      const key = getKeyBindingKey(metaBinding)
      expect(key).toBe("a:0:0:1:0")
    })

    it("should generate different keys for different modifiers", () => {
      const noMod = getKeyBindingKey({ name: "a", action: "test" })
      const withMeta = getKeyBindingKey({ name: "a", meta: true, action: "test" })
      const withCtrl = getKeyBindingKey({ name: "a", ctrl: true, action: "test" })
      const withShift = getKeyBindingKey({ name: "a", shift: true, action: "test" })

      expect(noMod).not.toBe(withMeta)
      expect(noMod).not.toBe(withCtrl)
      expect(noMod).not.toBe(withShift)
      expect(withMeta).not.toBe(withCtrl)
    })

    it("should handle combined modifiers", () => {
      const key = getKeyBindingKey({ name: "a", ctrl: true, shift: true, meta: true, action: "test" })
      expect(key).toBe("a:1:1:1:0")
    })

    it("should generate key with super modifier", () => {
      const superBinding = { name: "z", super: true, action: "test" }
      const key = getKeyBindingKey(superBinding)
      expect(key).toBe("z:0:0:0:1")
    })
  })

  describe("mergeKeyBindings", () => {
    it("should merge defaults and custom bindings", () => {
      const defaults = [
        { name: "a", action: "action1" as const },
        { name: "b", action: "action2" as const },
      ]
      const custom = [{ name: "c", action: "action3" as const }]

      const merged = mergeKeyBindings(defaults, custom)
      expect(merged.length).toBe(3)
    })

    it("should allow custom to override defaults", () => {
      const defaults = [{ name: "a", action: "action1" as const }]
      const custom = [{ name: "a", action: "action2" as const }]

      const merged = mergeKeyBindings(defaults, custom)
      expect(merged.length).toBe(1)
      expect(merged[0]!.action).toBe("action2")
    })

    it("should override when meta matches", () => {
      const defaults = [{ name: "a", meta: true, action: "action1" as const }]
      const custom = [{ name: "a", meta: true, action: "action2" as const }]

      const merged = mergeKeyBindings(defaults, custom)
      expect(merged.length).toBe(1)
      expect(merged[0]!.action).toBe("action2")
    })
  })

  describe("buildKeyBindingsMap", () => {
    it("should build map from bindings", () => {
      const bindings = [
        { name: "a", action: "action1" as const },
        { name: "b", meta: true, action: "action2" as const },
      ]

      const map = buildKeyBindingsMap(bindings)
      expect(map.size).toBe(2)
      expect(map.get("a:0:0:0:0")).toBe("action1")
      expect(map.get("b:0:0:1:0")).toBe("action2")
    })

    it("should handle meta modifier correctly", () => {
      const bindings = [{ name: "a", meta: true, action: "action1" as const }]

      const map = buildKeyBindingsMap(bindings)
      expect(map.get("a:0:0:1:0")).toBe("action1")
    })

    it("should handle aliases and normalize key names", () => {
      const bindings = [{ name: "return", action: "submit" as const }]
      const aliases: KeyAliasMap = { enter: "return" }

      const map = buildKeyBindingsMap(bindings, aliases)

      // Original binding should work
      expect(map.get("return:0:0:0:0")).toBe("submit")
      // Alias should not be added since "enter" wasn't in the binding
      expect(map.get("enter:0:0:0:0")).toBeUndefined()
    })

    it("should create aliased mappings for aliased key names", () => {
      const bindings = [{ name: "enter", action: "submit" as const }]
      const aliases: KeyAliasMap = { enter: "return" }

      const map = buildKeyBindingsMap(bindings, aliases)

      // Original binding with "enter" name
      expect(map.get("enter:0:0:0:0")).toBe("submit")
      // Aliased version with normalized "return" name
      expect(map.get("return:0:0:0:0")).toBe("submit")
    })

    it("should handle multiple aliases", () => {
      const bindings = [
        { name: "enter", action: "submit" as const },
        { name: "esc", action: "cancel" as const },
      ]
      const aliases: KeyAliasMap = { enter: "return", esc: "escape" }

      const map = buildKeyBindingsMap(bindings, aliases)

      expect(map.get("enter:0:0:0:0")).toBe("submit")
      expect(map.get("return:0:0:0:0")).toBe("submit")
      expect(map.get("esc:0:0:0:0")).toBe("cancel")
      expect(map.get("escape:0:0:0:0")).toBe("cancel")
    })

    it("should handle aliases with modifiers", () => {
      const bindings = [{ name: "enter", meta: true, action: "special-submit" as const }]
      const aliases: KeyAliasMap = { enter: "return" }

      const map = buildKeyBindingsMap(bindings, aliases)

      expect(map.get("enter:0:0:1:0")).toBe("special-submit")
      expect(map.get("return:0:0:1:0")).toBe("special-submit")
    })
  })

  describe("mergeKeyAliases", () => {
    it("should merge default and custom aliases", () => {
      const defaults: KeyAliasMap = { enter: "return" }
      const custom: KeyAliasMap = { esc: "escape" }

      const merged = mergeKeyAliases(defaults, custom)

      expect(merged.enter).toBe("return")
      expect(merged.esc).toBe("escape")
    })

    it("should allow custom aliases to override defaults", () => {
      const defaults: KeyAliasMap = { enter: "return" }
      const custom: KeyAliasMap = { enter: "custom-return" }

      const merged = mergeKeyAliases(defaults, custom)

      expect(merged.enter).toBe("custom-return")
    })

    it("should preserve defaults when no custom aliases provided", () => {
      const defaults: KeyAliasMap = { enter: "return", esc: "escape" }
      const custom: KeyAliasMap = {}

      const merged = mergeKeyAliases(defaults, custom)

      expect(merged.enter).toBe("return")
      expect(merged.esc).toBe("escape")
    })
  })

  describe("defaultKeyAliases", () => {
    it("should have enter -> return alias", () => {
      expect(defaultKeyAliases.enter).toBe("return")
    })

    it("should have esc -> escape alias", () => {
      expect(defaultKeyAliases.esc).toBe("escape")
    })
  })

  describe("alias override behavior", () => {
    it("should override 'return' binding when custom provides 'enter' binding with aliases", () => {
      const defaults = [{ name: "return", action: "newline" as const }]
      const custom = [{ name: "enter", action: "submit" as const }]
      const aliases: KeyAliasMap = { enter: "return" }

      const merged = mergeKeyBindings(defaults, custom)
      const map = buildKeyBindingsMap(merged, aliases)

      const returnAction = map.get("return:0:0:0:0")
      const enterAction = map.get("enter:0:0:0:0")

      expect(returnAction).toBe("submit")
      expect(enterAction).toBe("submit")
    })

    it("should also allow direct override using canonical name", () => {
      const defaults = [{ name: "return", action: "newline" as const }]
      const custom = [{ name: "return", action: "submit" as const }]
      const aliases: KeyAliasMap = { enter: "return" }

      const merged = mergeKeyBindings(defaults, custom)
      const map = buildKeyBindingsMap(merged, aliases)

      const returnAction = map.get("return:0:0:0:0")
      const enterAction = map.get("enter:0:0:0:0")

      expect(returnAction).toBe("submit")
      expect(enterAction).toBeUndefined()
    })

    it("should handle the Textarea scenario: defaults with 'return', custom with 'enter'", () => {
      const defaults = [
        { name: "return", action: "newline" as const },
        { name: "return", meta: true, action: "submit" as const },
      ]
      const custom = [{ name: "enter", action: "custom-submit" as const }]
      const aliases: KeyAliasMap = { enter: "return" }

      const merged = mergeKeyBindings(defaults, custom)
      const map = buildKeyBindingsMap(merged, aliases)

      const returnNoMod = map.get("return:0:0:0:0")
      const returnWithMeta = map.get("return:0:0:1:0")
      const enterNoMod = map.get("enter:0:0:0:0")

      expect(returnNoMod).toBe("custom-submit")
      expect(enterNoMod).toBe("custom-submit")
      expect(returnWithMeta).toBe("submit")
    })
  })

  describe("keyBindingToString", () => {
    it("should convert simple key binding without modifiers", () => {
      const binding = { name: "escape", action: "cancel" as const }
      expect(keyBindingToString(binding)).toBe("escape")
    })

    it("should convert key binding with ctrl modifier", () => {
      const binding = { name: "c", ctrl: true, action: "copy" as const }
      expect(keyBindingToString(binding)).toBe("ctrl+c")
    })

    it("should convert key binding with shift modifier", () => {
      const binding = { name: "up", shift: true, action: "scroll-fast" as const }
      expect(keyBindingToString(binding)).toBe("shift+up")
    })

    it("should convert key binding with multiple modifiers", () => {
      const binding = { name: "y", ctrl: true, shift: true, action: "copy" as const }
      expect(keyBindingToString(binding)).toBe("ctrl+shift+y")
    })

    it("should convert key binding with all modifiers", () => {
      const binding = { name: "a", ctrl: true, shift: true, meta: true, super: true, action: "all" as const }
      expect(keyBindingToString(binding)).toBe("ctrl+shift+meta+super+a")
    })

    it("should convert key binding with meta modifier", () => {
      const binding = { name: "s", meta: true, action: "save" as const }
      expect(keyBindingToString(binding)).toBe("meta+s")
    })

    it("should convert key binding with super modifier", () => {
      const binding = { name: "z", super: true, action: "undo" as const }
      expect(keyBindingToString(binding)).toBe("super+z")
    })

    it("should handle special keys correctly", () => {
      expect(keyBindingToString({ name: "return", action: "submit" as const })).toBe("return")
      expect(keyBindingToString({ name: "space", action: "select" as const })).toBe("space")
      expect(keyBindingToString({ name: "tab", action: "next" as const })).toBe("tab")
    })
  })
})
