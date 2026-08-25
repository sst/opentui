import { isCapabilityResponse } from "./terminal-capability-detection.js"

/**
 * A terminal-capability mutation request minted by
 * OutstandingCapabilityProbes.consume() — the only producer. The renderer
 * applies capability changes exclusively through this value, so a mutation
 * without an outstanding probe is unrepresentable at the API level.
 */
export interface CapabilityUpdate {
  readonly sequence: string
  readonly hasCursorReport: boolean
  readonly hasStandardCapabilitySignature: boolean
}

/**
 * Provenance gate for terminal capability mutations.
 *
 * The renderer issues its startup capability probes when it arms the
 * capability window in setupTerminal(); the window expires with the probe
 * timeout (or renderer teardown). While no probe is outstanding, consume()
 * returns null for every byte sequence — including bytes that merely SHARE
 * THE SHAPE of a capability response, such as modified F-key chords
 * (`CSI 1;<mod>R`, byte-identical to a row-1 cursor position report, e.g.
 * Ctrl+F3 = `ESC [ 1;5R`). Shape-matching without provenance let such a
 * chord latch explicit_width/scaled_text in the native layer (set-only,
 * never cleared), corrupting rendering until restart.
 *
 * Residual, documented: bytes arriving while a probe window IS open still
 * pass — within the window a colliding chord is indistinguishable from a
 * genuine probe reply at this layer. That is a much smaller surface than a
 * lifetime-open listener and is not solvable here.
 */
export class OutstandingCapabilityProbes {
  private windowOpen = false

  /** True while startup capability queries are outstanding. */
  public get isOpen(): boolean {
    return this.windowOpen
  }

  /** Mark probes as issued; called where the renderer arms the probe window. */
  public begin(): void {
    this.windowOpen = true
  }

  /** Expire every outstanding probe (probe-window timeout or renderer teardown). */
  public expire(): void {
    this.windowOpen = false
  }

  /**
   * The only CapabilityUpdate producer. Returns null unless the probe window
   * is open AND the sequence is a recognizable capability response or a
   * cursor report (cursor reports carry no self-identifying signature, so
   * the open window is their only provenance).
   */
  public consume(sequence: string, hasCursorReport: boolean): CapabilityUpdate | null {
    if (!this.windowOpen) {
      return null
    }
    const hasStandardCapabilitySignature = isCapabilityResponse(sequence)
    if (!hasStandardCapabilitySignature && !hasCursorReport) {
      return null
    }
    return { sequence, hasCursorReport, hasStandardCapabilitySignature }
  }
}
