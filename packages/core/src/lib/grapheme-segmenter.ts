let segmenter: Intl.Segmenter | null = null
let initPromise: Promise<void> | null = null
let initError: Error | null = null

function initializePolyfill(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    if (typeof Intl === "undefined" || typeof (Intl as any).Segmenter !== "function") {
      try {
        await import("@formatjs/intl-segmenter/polyfill-force.js")
      } catch (e) {
        initError = new Error(
          "Failed to load Intl.Segmenter polyfill. Please ensure @formatjs/intl-segmenter is installed or use a runtime that supports Intl.Segmenter natively.",
        )
      }
    }
  })()

  return initPromise
}

initializePolyfill()

export function getGraphemeSegmenter(): Intl.Segmenter {
  if (segmenter) return segmenter

  if (typeof Intl !== "undefined" && typeof (Intl as any).Segmenter === "function") {
    segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
    return segmenter
  }

  if (initError) {
    throw initError
  }

  throw new Error(
    "Intl.Segmenter is not available. Please ensure your runtime supports it or install @formatjs/intl-segmenter",
  )
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export function isSingleGrapheme(s: string): boolean {
  if (s.length === 0) return false
  if (s.length === 1) return true

  const first = s.charCodeAt(0)
  if (first < 128) {
    const second = s.charCodeAt(1)
    if (second < 128) return false
  }

  const iter = getGraphemeSegmenter().segment(s)[Symbol.iterator]()
  iter.next()
  return iter.next().done === true
}

export function firstGrapheme(str: string): string {
  if (str.length === 0) return ""

  const firstCode = str.charCodeAt(0)
  if (firstCode < 128) {
    if (str.length === 1) return str[0]!
    const secondCode = str.charCodeAt(1)
    if (secondCode < 128) return str[0]!
  } else if (str.length === 1) {
    return str[0]!
  } else if (isHighSurrogate(firstCode)) {
    const secondCode = str.charCodeAt(1)
    if (isLowSurrogate(secondCode) && str.length === 2) {
      return str.substring(0, 2)
    }
  }

  const segments = getGraphemeSegmenter().segment(str)
  const first = segments[Symbol.iterator]().next()
  return first.done ? "" : first.value.segment
}
