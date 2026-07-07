import { parseIcyMetadata } from "./metadata.js"
import type { AudioStreamBodyParser, AudioStreamParserOutput } from "../parser.js"

export class IcyStreamParser implements AudioStreamBodyParser {
  private audioRemaining: number
  private metadata: Uint8Array | null = null
  private metadataOffset = 0

  constructor(
    private readonly interval: number,
    private readonly decoder: TextDecoder,
  ) {
    this.audioRemaining = interval
  }

  *push(chunk: Uint8Array): IterableIterator<AudioStreamParserOutput> {
    let offset = 0
    while (offset < chunk.byteLength) {
      if (this.audioRemaining > 0) {
        const length = Math.min(this.audioRemaining, chunk.byteLength - offset)
        yield { type: "audio", data: chunk.subarray(offset, offset + length) }
        offset += length
        this.audioRemaining -= length
        continue
      }

      if (this.metadata == null) {
        const metadataLength = (chunk[offset] ?? 0) * 16
        offset += 1
        if (metadataLength === 0) {
          this.audioRemaining = this.interval
          continue
        }
        this.metadata = new Uint8Array(metadataLength)
        this.metadataOffset = 0
      }

      const metadata = this.metadata
      const length = Math.min(metadata.byteLength - this.metadataOffset, chunk.byteLength - offset)
      metadata.set(chunk.subarray(offset, offset + length), this.metadataOffset)
      offset += length
      this.metadataOffset += length
      if (this.metadataOffset !== metadata.byteLength) continue

      const fields = parseIcyMetadata(metadata, this.decoder)
      this.metadata = null
      this.metadataOffset = 0
      this.audioRemaining = this.interval
      if (fields != null) yield { type: "metadata", fields }
    }
  }

  finish(): void {
    if (this.audioRemaining === 0 || this.metadata != null) {
      throw new Error("ICY stream ended inside a metadata block")
    }
  }
}
