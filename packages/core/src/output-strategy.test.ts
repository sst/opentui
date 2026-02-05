import { EventEmitter } from "events"
import { expect, test } from "bun:test"
import type { Pointer } from "bun:ffi"

import { createOutputStrategy } from "./output-strategy"
import type { RenderLib } from "./zig"
import { createCapturingStdout } from "./testing/stdout-mocks"

test("javascript output strategy flushes via provided write function", () => {
  const frame = Buffer.from("frame-bytes")
  const writes: Buffer[] = []

  const stdout = createCapturingStdout()
  stdout.write = () => {
    throw new Error("stdout.write should not be hit when writeToTerminal is provided")
  }

  const stdin = new EventEmitter() as unknown as NodeJS.ReadStream

  const libMock = {
    setWriteTarget: () => {},
    getWriteBufferLength: () => frame.length,
    copyWriteBuffer: (_renderer: Pointer, target: Uint8Array) => {
      target.set(frame)
      return frame.length
    },
  } as unknown as RenderLib

  const writeToTerminal = (chunk: any) => {
    writes.push(Buffer.from(chunk))
    return true
  }

  const strategy = createOutputStrategy("javascript", {
    stdout,
    stdin,
    lib: libMock,
    rendererPtr: 0 as Pointer,
    writeToTerminal,
    emitFlush: () => {},
    onDrain: () => {},
  })

  strategy.flush("test")

  expect(writes).toHaveLength(1)
  expect(writes[0].toString()).toBe(frame.toString())
})
