import { EventEmitter } from "events"
import { PassThrough } from "stream"

export type CapturingStdout = NodeJS.WriteStream & { written: string[] }

export function createCapturingStdout(): CapturingStdout {
  const stdout = new EventEmitter() as CapturingStdout
  stdout.columns = 120
  stdout.rows = 40
  stdout.isTTY = true
  stdout.writable = true
  stdout.writableLength = 0
  stdout.written = []
  stdout.write = function (chunk: any) {
    stdout.written.push(chunk.toString())
    return true
  }
  stdout.cork = () => {}
  stdout.uncork = () => {}
  stdout.setDefaultEncoding = () => stdout
  stdout.end = () => stdout
  stdout.destroySoon = () => stdout
  stdout.clearLine = () => true
  stdout.cursorTo = () => true
  stdout.moveCursor = () => true
  stdout.getColorDepth = () => 24
  stdout.hasColors = () => true
  stdout.getWindowSize = () => [stdout.columns, stdout.rows]
  stdout.ref = () => stdout
  stdout.unref = () => stdout
  return stdout
}

export class CollectingStdout extends PassThrough {
  public writes: Buffer[] = []
  public forcedBackpressure = false
  public columns = 80
  public rows = 24
  public isTTY = true

  override write(chunk: any, encoding?: any, callback?: any): boolean {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    this.writes.push(Buffer.from(buffer))
    if (typeof callback === "function") {
      callback()
    }
    return !this.forcedBackpressure
  }

  clearWrites(): void {
    this.writes = []
  }
}
