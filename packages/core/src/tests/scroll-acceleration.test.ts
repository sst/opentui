import { describe, expect, test } from "bun:test"
import { MacOSScrollAccel } from "../lib/scroll-acceleration"

describe("MacOSScrollAccel", () => {
  test("returns baseMultiplier for first tick", () => {
    const accel = new MacOSScrollAccel({ baseMultiplier: 1, multiplier1: 2, multiplier2: 4 })
    const units = accel.tick()
    expect(units).toBe(1)
  })

  test("returns multiplier2 for very fast successive ticks", () => {
    const accel = new MacOSScrollAccel({ 
      threshold2: 50, 
      baseMultiplier: 1, 
      multiplier1: 2, 
      multiplier2: 4 
    })
    const now = Date.now()
    
    accel.tick(now)
    accel.tick(now + 30) // 30ms later
    const units = accel.tick(now + 60) // Average velocity should be ~30ms
    expect(units).toBe(4)
  })

  test("returns multiplier1 for medium speed ticks", () => {
    const accel = new MacOSScrollAccel({ 
      threshold1: 150,
      threshold2: 50,
      baseMultiplier: 1, 
      multiplier1: 2, 
      multiplier2: 4 
    })
    const now = Date.now()
    
    accel.tick(now)
    accel.tick(now + 100) // 100ms later
    const units = accel.tick(now + 200) // Average velocity should be ~100ms
    expect(units).toBe(2)
  })

  test("returns baseMultiplier for slow successive ticks", () => {
    const accel = new MacOSScrollAccel({ 
      threshold1: 150,
      baseMultiplier: 1, 
      multiplier1: 2, 
      multiplier2: 4 
    })
    const now = Date.now()
    
    accel.tick(now)
    accel.tick(now + 200) // 200ms later
    const units = accel.tick(now + 400) // Average velocity should be ~200ms
    expect(units).toBe(1)
  })

  test("uses default values when not specified", () => {
    const accel = new MacOSScrollAccel()
    const now = Date.now()
    
    // First tick returns baseMultiplier (default 1)
    expect(accel.tick(now)).toBe(1)
    
    // Very fast tick returns multiplier2 (default 4)
    accel.tick(now + 30)
    expect(accel.tick(now + 60)).toBe(4)
  })

  test("reset() clears velocity history", () => {
    const accel = new MacOSScrollAccel({ 
      threshold2: 50,
      baseMultiplier: 1, 
      multiplier2: 4 
    })
    const now = Date.now()
    
    accel.tick(now)
    accel.tick(now + 30) // Build up velocity history
    
    accel.reset()
    const units = accel.tick(now + 60) // Should return baseMultiplier after reset
    expect(units).toBe(1)
  })

  test("linear behavior when all multipliers are 1", () => {
    const accel = new MacOSScrollAccel({ 
      baseMultiplier: 1, 
      multiplier1: 1, 
      multiplier2: 1 
    })
    const now = Date.now()
    
    expect(accel.tick(now)).toBe(1)
    expect(accel.tick(now + 10)).toBe(1)
    expect(accel.tick(now + 20)).toBe(1)
    expect(accel.tick(now + 30)).toBe(1)
    expect(accel.tick(now + 200)).toBe(1)
  })
})