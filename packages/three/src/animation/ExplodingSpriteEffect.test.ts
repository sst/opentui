import { describe, expect, it, spyOn } from "bun:test"
import * as THREE from "three"
import { ExplodingSpriteEffect, ExplosionManager } from "./ExplodingSpriteEffect.js"

describe("ExplodingSpriteEffect.clearMaterialCache", () => {
  it("disposes every cached material and empties the cache", () => {
    const cache: Map<string, { dispose: () => void }> = (ExplodingSpriteEffect as any).baseMaterialCache
    const disposed: string[] = []
    cache.set("a", { dispose: () => disposed.push("a") })
    cache.set("b", { dispose: () => disposed.push("b") })

    ExplodingSpriteEffect.clearMaterialCache()

    expect(disposed.sort()).toEqual(["a", "b"])
    expect(cache.size).toBe(0)
  })
})

describe("ExplosionManager.disposeAll", () => {
  it("also clears the static material cache, not just active explosions", () => {
    // Materials are cached per-instance-pool-key on the class itself
    // (ExplodingSpriteEffect.baseMaterialCache), independent of any single
    // ExplosionManager's activeExplosions list. Without clearing it here, the
    // GPU materials it holds are never released even after disposeAll().
    const manager = new ExplosionManager(new THREE.Scene())
    const clearSpy = spyOn(ExplodingSpriteEffect, "clearMaterialCache")

    manager.disposeAll()

    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
