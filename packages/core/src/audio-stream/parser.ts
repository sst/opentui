import { IcyStreamParser } from "./icy/parser.js"

export type AudioStreamParserOutput =
  | { type: "audio"; data: Uint8Array }
  | { type: "metadata"; fields: Readonly<Record<string, string>> }

export interface AudioStreamBodyParser {
  push(chunk: Uint8Array): IterableIterator<AudioStreamParserOutput>
  finish(): void
}

export type AudioStreamParserSelection =
  | { format: null; headers: Readonly<Record<string, string>>; parser: null }
  | { format: "icy"; headers: Readonly<Record<string, string>>; parser: AudioStreamBodyParser | null }

export function selectAudioStreamParser(options: {
  url: string
  headers: Headers
  metadataEncoding: string
}): AudioStreamParserSelection {
  const icyHeaders: Record<string, string> = Object.create(null)
  options.headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith("icy-")) icyHeaders[name.toLowerCase()] = value
  })
  const headers = Object.freeze(icyHeaders)
  const rawInterval = options.headers.get("icy-metaint")
  if (rawInterval == null) {
    return {
      format: Object.keys(headers).length === 0 ? null : "icy",
      headers,
      parser: null,
    }
  }

  const value = rawInterval.trim()
  if (!/^\d+$/.test(value)) throw new Error(`Invalid icy-metaint response header: ${rawInterval}`)
  const interval = Number(value)
  if (!Number.isSafeInteger(interval)) throw new Error(`Invalid icy-metaint response header: ${rawInterval}`)
  if (interval === 0) return { format: "icy", headers, parser: null }
  return {
    format: "icy",
    headers,
    parser: new IcyStreamParser(interval, new TextDecoder(options.metadataEncoding)),
  }
}
