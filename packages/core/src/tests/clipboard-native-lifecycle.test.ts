import { setTimeout as sleep } from "node:timers/promises"

import { expect, test } from "bun:test"

import {
  NativeClipboardCopyStatus,
  NativeClipboardDestroyStatus,
  NativeClipboardOperationStatus,
  NativeClipboardShutdownStatus,
  NativeClipboardStartStatus,
  resolveRenderLib,
  type ClipboardOperationHandle,
  type ClipboardServiceHandle,
} from "../zig.js"

const readRequest = (): Uint8Array => {
  const mime = new TextEncoder().encode("text/plain")
  const request = new Uint8Array(8 + mime.length)
  const view = new DataView(request.buffer)
  view.setUint32(0, 1, true)
  view.setUint32(4, mime.length, true)
  request.set(mime, 8)
  return request
}

const expectTimedOutAndDestroy = (operation: ClipboardOperationHandle): void => {
  const lib = resolveRenderLib()
  expect(lib.clipboardOperationPoll(operation)).toBe(NativeClipboardOperationStatus.TimedOut)
  expect(lib.clipboardOperationResultMimeLength(operation).status).toBe(NativeClipboardCopyStatus.InvalidState)
  expect(lib.clipboardOperationDestroy(operation)).toBe(NativeClipboardDestroyStatus.Destroyed)
  expect(lib.clipboardOperationPoll(operation)).toBe(NativeClipboardOperationStatus.InvalidHandle)
  expect(lib.clipboardOperationDestroy(operation)).toBe(NativeClipboardDestroyStatus.InvalidHandle)
}

test("native clipboard real-operation ABI lifecycle", async () => {
  const lib = resolveRenderLib()
  const service = lib.clipboardServiceCreate(3, 2)
  expect(service).not.toBeNull()
  if (!service) return

  expect(() => (lib as typeof lib & { dispose(): void }).dispose()).toThrow("clipboard services are active")
  expect(lib.clipboardServiceDrain(service)).not.toBe(2)

  const read = lib.clipboardReadOperationStart(service, readRequest(), 0, 1024, 4096, 8192, 0)
  const write = lib.clipboardWriteOperationStart(service, new TextEncoder().encode("text"), 0, 0)
  const clear = lib.clipboardClearOperationStart(service, 0, 0)
  expect(read.status).toBe(NativeClipboardStartStatus.Ok)
  expect(write.status).toBe(NativeClipboardStartStatus.Ok)
  expect(clear.status).toBe(NativeClipboardStartStatus.Ok)
  expect(read.operation).not.toBeNull()
  expect(write.operation).not.toBeNull()
  expect(clear.operation).not.toBeNull()

  if (read.operation) expectTimedOutAndDestroy(read.operation)
  if (write.operation) expectTimedOutAndDestroy(write.operation)
  if (clear.operation) expectTimedOutAndDestroy(clear.operation)

  expect(lib.clipboardServiceBeginShutdown(service)).toBe(NativeClipboardShutdownStatus.Pending)
  expect(lib.clipboardClearOperationStart(service, 0, 0).status).toBe(NativeClipboardStartStatus.ShuttingDown)
  await shutdownAfterBegin(service)
})

async function shutdownAfterBegin(service: ClipboardServiceHandle): Promise<void> {
  const lib = resolveRenderLib()
  let status = lib.clipboardServicePollShutdown(service)
  for (let attempt = 0; status === NativeClipboardShutdownStatus.Pending && attempt < 2_000; attempt += 1) {
    await sleep(1)
    status = lib.clipboardServicePollShutdown(service)
  }
  expect(status).toBe(NativeClipboardShutdownStatus.Ready)
  expect(lib.clipboardServiceDestroy(service)).toBe(NativeClipboardDestroyStatus.Destroyed)
  expect(lib.clipboardServicePollShutdown(service)).toBe(NativeClipboardShutdownStatus.InvalidHandle)
}
