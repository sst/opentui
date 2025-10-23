import { describe, expect, it } from "bun:test"
import { mergeKeyBindings, getKeyBindingKey, buildKeyBindingsMap } from "./keymapping"

describe("keymapping", () => {
  describe("getKeyBindingKey", () => {
    it("should generate key with meta modifier", () => {
      const metaBinding = { name: "a", meta: true, action: "test" }
      const key = getKeyBindingKey(metaBinding)
      expect(key).toBe("a:false:false:true")
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
      expect(key).toBe("a:true:true:true")
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
      expect(map.get("a:false:false:false")).toBe("action1")
      expect(map.get("b:false:false:true")).toBe("action2")
    })

    it("should handle meta modifier correctly", () => {
      const bindings = [{ name: "a", meta: true, action: "action1" as const }]

      const map = buildKeyBindingsMap(bindings)
      expect(map.get("a:false:false:true")).toBe("action1")
    })
  })
})
