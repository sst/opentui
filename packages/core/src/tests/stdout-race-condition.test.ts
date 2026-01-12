import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { Renderable } from "../Renderable"
import { resolveRenderLib } from "../zig"

/**
 * Test for stdout race condition investigation.
 *
 * ## THE ISSUE
 * Sometimes partial ANSI sequences like "55;255;255m" appear in terminal output.
 * This looks like a broken color sequence from "\x1b[38;2;255;255;255m" (foreground white)
 * that was truncated/interleaved with other output.
 *
 * ## ROOT CAUSE ANALYSIS
 *
 * When `useThread=true` in renderer.zig, there's a race condition between:
 *
 * 1. **Render thread** - Writes frame data to stdout asynchronously after `render()` signals it
 * 2. **Native helper functions** - Write directly to stdout without synchronization:
 *    - enableMouse(), disableMouse()
 *    - enableKittyKeyboard(), disableKittyKeyboard()
 *    - processCapabilityResponse()
 *    - queryPixelResolution()
 *    - clearTerminal()
 *    - setupTerminal(), performShutdownSequence()
 * 3. **TypeScript** - Writes to stdout via writeOut()/flushStdoutCache()
 *
 * ## RACE CONDITION TIMELINE (Split-screen mode)
 *
 * 1. Frame 1: `lib.render()` → prepares output buffer, signals render thread, returns immediately
 * 2. Render thread starts writing frame 1 to stdout (e.g., "\x1b[38;2;255;255;255m...")
 * 3. Frame 2: TypeScript's `renderNative()` calls `flushStdoutCache()` (writes to stdout!)
 * 4. Frame 2: Then calls `lib.render()` which FINALLY waits for render thread
 * 5. **Result**: Step 3 interleaves with step 2, breaking ANSI sequences
 *
 * The wait for the previous render happens INSIDE `lib.render()`, but TypeScript
 * code writes to stdout BEFORE calling `lib.render()`.
 *
 * ## ADDITIONAL RACE SCENARIOS
 *
 * Even without split-screen, stdin handlers can trigger stdout writes:
 * - `processCapabilityResponse()` is called from stdin handler when terminal responds
 * - This can happen while the render thread is still writing the previous frame
 *
 * ## HOW TO FIX
 *
 * Option A: Move all stdout writes to the render thread (serialize all output)
 * Option B: Add a mutex in TypeScript that waits for render thread before any stdout write
 * Option C: Make native helper functions wait for renderInProgress=false before writing
 *
 * For now, debug logging has been added to track when stdout writes happen from different
 * sources. Enable STDOUT_DEBUG_LOG in renderer.zig and OTUI_DEBUG_STDOUT env var to capture.
 */

// Helper to check if a string contains broken ANSI sequences
function findBrokenAnsiSequences(output: string): string[] {
  const broken: string[] = []

  // Pattern for what looks like orphaned ANSI sequence fragments
  // e.g., "55;255;255m" without the leading "\x1b["
  // We need to be careful - "38;2;255;255;255m" is valid after "\x1b[" but "8;2;255;255;255m" is not
  // The pattern should match sequences that look like color codes but aren't preceded by \x1b[
  // Use a more specific check - look for sequences starting with single digits that could be
  // truncated 2-digit codes (like "8;" from "38;")

  // Look for sequences that appear to be truncated at the start
  // Valid color sequences: \x1b[38;2;R;G;Bm or \x1b[48;2;R;G;Bm
  // Broken: starts with just 8;2; (missing the 3 or 4)
  const truncatedColorPattern = /(?<!\x1b\[\d?)(\d;2;\d+;\d+;\d+m)/g
  let match
  while ((match = truncatedColorPattern.exec(output)) !== null) {
    // Check context - if preceded by \x1b[ and a digit, it's fine
    const before = output.substring(Math.max(0, match.index - 3), match.index)
    if (!/\x1b\[\d$/.test(before)) {
      broken.push(match[1])
    }
  }

  return broken
}

// Helper to validate ANSI sequence integrity
function validateAnsiSequences(output: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // All CSI sequences should be complete: \x1b[ ... <letter>
  // Common terminators: m (SGR), H (cursor position), J (erase), K (erase line), etc.
  let i = 0
  while (i < output.length) {
    if (output[i] === "\x1b" && i + 1 < output.length && output[i + 1] === "[") {
      // Found CSI sequence start
      const start = i
      i += 2 // Skip \x1b[

      // Read until we find a terminator (letter) or end of string
      while (i < output.length) {
        const c = output[i]
        if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
          // Valid terminator
          i++
          break
        } else if (c === "\x1b") {
          // Another escape sequence started before this one ended - broken!
          errors.push(`Incomplete CSI at position ${start}: ${JSON.stringify(output.slice(start, i))}`)
          break
        }
        i++
      }

      // Note: Don't flag end-of-buffer as error since it's valid for partial buffer reads
    } else {
      i++
    }
  }

  // Check for orphaned fragments (numbers followed by 'm' without proper CSI prefix)
  const brokenFragments = findBrokenAnsiSequences(output)
  for (const fragment of brokenFragments) {
    errors.push(`Orphaned ANSI fragment: ${JSON.stringify(fragment)}`)
  }

  return { valid: errors.length === 0, errors }
}

class ColorfulRenderable extends Renderable {
  constructor(renderer: TestRenderer, options: any) {
    super(renderer, options)
  }

  protected override internalRender(): void {
    // Draw a colorful pattern to generate many ANSI color codes
    for (let y = 0; y < this.bounds.height; y++) {
      for (let x = 0; x < this.bounds.width; x++) {
        const r = ((x * 10) % 256) / 255
        const g = ((y * 10) % 256) / 255
        const b = (((x + y) * 5) % 256) / 255

        this.buffer?.setCell(x, y, "█".charCodeAt(0), { r, g, b, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }, 0)
      }
    }
  }
}

describe("stdout race condition investigation", () => {
  let renderer: TestRenderer
  let renderOnce: () => Promise<void>

  beforeEach(async () => {
    ;({ renderer, renderOnce } = await createTestRenderer({
      width: 80,
      height: 24,
      useThread: true, // Enable threading to test race conditions
    }))
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("output should not contain the reported broken pattern '55;255;255m'", async () => {
    // This is the specific pattern the user reported seeing
    const colorful = new ColorfulRenderable(renderer, {
      width: 80,
      height: 24,
    })
    renderer.root.add(colorful)

    const lib = resolveRenderLib()
    const reportedPattern = /(?<!\x1b\[[\d;]*)55;255;255m/

    for (let i = 0; i < 20; i++) {
      await renderOnce()

      const output = lib.getLastOutputForTestString(renderer.rendererPtr)
      const match = output.match(reportedPattern)

      if (match) {
        console.log(`Found reported pattern at frame ${i}:`)
        // Show context around the match
        const index = output.indexOf(match[0])
        const contextStart = Math.max(0, index - 20)
        const contextEnd = Math.min(output.length, index + match[0].length + 20)
        console.log(`Context: ${JSON.stringify(output.slice(contextStart, contextEnd))}`)
        throw new Error(`Found broken ANSI sequence: ${match[0]}`)
      }
    }
  })

  test("render output should have valid ANSI sequences", async () => {
    // Create a colorful renderable to generate many color codes
    const colorful = new ColorfulRenderable(renderer, {
      width: 40,
      height: 12,
    })
    renderer.root.add(colorful)

    // Render once
    await renderOnce()

    // Get the last output buffer
    const lib = resolveRenderLib()
    const output = lib.getLastOutputForTestString(renderer.rendererPtr)

    // Validate the ANSI sequences
    const validation = validateAnsiSequences(output)

    if (!validation.valid) {
      console.log("Found broken ANSI sequences:")
      for (const error of validation.errors) {
        console.log(`  - ${error}`)
      }
    }

    expect(validation.valid).toBe(true)
  })

  test("multiple rapid renders should maintain ANSI sequence integrity", async () => {
    const colorful = new ColorfulRenderable(renderer, {
      width: 80,
      height: 24,
    })
    renderer.root.add(colorful)

    const lib = resolveRenderLib()
    const allErrors: string[] = []

    // Perform multiple rapid renders
    for (let i = 0; i < 10; i++) {
      await renderOnce()

      const output = lib.getLastOutputForTestString(renderer.rendererPtr)
      const validation = validateAnsiSequences(output)

      if (!validation.valid) {
        allErrors.push(`Frame ${i}: ${validation.errors.join(", ")}`)
      }
    }

    if (allErrors.length > 0) {
      console.log("Found broken ANSI sequences across frames:")
      for (const error of allErrors) {
        console.log(`  - ${error}`)
      }
    }

    expect(allErrors.length).toBe(0)
  })
})
