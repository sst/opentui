import { setTimeout as sleep } from "node:timers/promises"

import { expect, test } from "bun:test"

import {
  NativeClipboardCancelStatus,
  NativeClipboardCopyStatus,
  NativeClipboardDestroyStatus,
  NativeClipboardOperationStatus,
  NativeClipboardShutdownStatus,
  NativeClipboardStartStatus,
  type ClipboardOperationHandle,
  type ClipboardServiceHandle,
} from "../zig.js"
import { ClipboardNativeWorkerTestLib } from "./clipboard-native-worker.internal.js"

async function waitForOperation(
  lib: ClipboardNativeWorkerTestLib,
  operation: ClipboardOperationHandle,
): Promise<NativeClipboardOperationStatus> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const status = lib.poll(operation)
    if (status !== NativeClipboardOperationStatus.Pending) return status
    await sleep(1)
  }
  throw new Error("native clipboard operation did not settle")
}

async function shutdown(lib: ClipboardNativeWorkerTestLib, service: ClipboardServiceHandle): Promise<void> {
  let status = lib.beginShutdown(service)
  for (let attempt = 0; status === NativeClipboardShutdownStatus.Pending && attempt < 2_000; attempt += 1) {
    await sleep(1)
    status = lib.pollShutdown(service)
  }
  expect(status).toBe(NativeClipboardShutdownStatus.Ready)
  expect(lib.destroyService(service)).toBe(NativeClipboardDestroyStatus.Destroyed)
  expect(lib.destroyService(service)).toBe(NativeClipboardDestroyStatus.InvalidHandle)
}

test("native clipboard worker uses callback-free copied request and result memory", async () => {
  const lib = new ClipboardNativeWorkerTestLib()
  const otherLib = new ClipboardNativeWorkerTestLib()
  const firstService = lib.createService(2)
  const secondService = lib.createService(1)
  expect(firstService).not.toBeNull()
  expect(secondService).not.toBeNull()
  if (!firstService || !secondService) return
  expect(otherLib.beginShutdown(firstService)).toBe(NativeClipboardShutdownStatus.InvalidHandle)
  expect(otherLib.pollShutdown(firstService)).toBe(NativeClipboardShutdownStatus.InvalidHandle)
  expect(otherLib.destroyService(firstService)).toBe(NativeClipboardDestroyStatus.InvalidHandle)
  expect(otherLib.start(firstService, new Uint8Array(), 0)).toEqual({
    status: NativeClipboardStartStatus.InvalidService,
    operation: null,
  })

  const request = new Uint8Array([0, 1, 2, 0, 254, 255])
  const expected = request.slice()
  const started = lib.start(firstService, request, 5)
  expect(started.status).toBe(NativeClipboardStartStatus.Ok)
  expect(started.operation).not.toBeNull()
  if (!started.operation) return
  request.fill(9)
  expect(() => lib.dispose()).toThrow("services are active")

  expect(await waitForOperation(lib, started.operation)).toBe(NativeClipboardOperationStatus.Read)
  expect(lib.poll(started.operation)).toBe(NativeClipboardOperationStatus.Read)
  expect(otherLib.cancel(started.operation)).toBe(NativeClipboardCancelStatus.InvalidHandle)
  const dataLength = lib.resultDataLength(started.operation)
  expect(dataLength).toEqual({ status: NativeClipboardCopyStatus.Ok, length: expected.byteLength })
  const tooSmall = new Uint8Array(expected.byteLength - 1).fill(0xaa)
  expect(lib.resultDataCopy(started.operation, tooSmall)).toBe(NativeClipboardCopyStatus.BufferTooSmall)
  expect(tooSmall).toEqual(new Uint8Array(expected.byteLength - 1).fill(0xaa))
  const output = new Uint8Array(dataLength.length)
  expect(lib.resultDataCopy(started.operation, output)).toBe(NativeClipboardCopyStatus.Ok)
  expect(output).toEqual(expected)

  const mimeLength = lib.resultMimeLength(started.operation)
  const mime = new Uint8Array(mimeLength.length)
  expect(lib.resultMimeCopy(started.operation, mime)).toBe(NativeClipboardCopyStatus.Ok)
  expect(new TextDecoder().decode(mime)).toBe("application/octet-stream")
  expect(lib.cancel(started.operation)).toBe(NativeClipboardCancelStatus.AlreadyTerminal)
  expect(lib.destroyOperation(started.operation)).toBe(NativeClipboardDestroyStatus.Destroyed)
  expect(lib.destroyOperation(started.operation)).toBe(NativeClipboardDestroyStatus.InvalidHandle)
  expect(lib.poll(started.operation)).toBe(NativeClipboardOperationStatus.InvalidHandle)

  const cancelled = lib.start(firstService, expected, 500)
  expect(cancelled.status).toBe(NativeClipboardStartStatus.Ok)
  expect(cancelled.operation).not.toBeNull()
  if (!cancelled.operation) return
  expect(lib.destroyOperation(cancelled.operation)).toBe(NativeClipboardDestroyStatus.NotReady)
  expect(lib.cancel(cancelled.operation)).toBe(NativeClipboardCancelStatus.Requested)
  expect([NativeClipboardCancelStatus.Requested, NativeClipboardCancelStatus.AlreadyTerminal]).toContain(
    lib.cancel(cancelled.operation),
  )
  expect(lib.beginShutdown(firstService)).toBe(NativeClipboardShutdownStatus.Pending)
  expect(lib.start(firstService, expected, 0).status).toBe(NativeClipboardStartStatus.ShuttingDown)

  const isolated = lib.start(secondService, expected, 0)
  expect(isolated.status).toBe(NativeClipboardStartStatus.Ok)
  expect(isolated.operation).not.toBeNull()
  await shutdown(lib, firstService)
  expect(lib.poll(cancelled.operation)).toBe(NativeClipboardOperationStatus.InvalidHandle)
  if (isolated.operation) {
    expect(await waitForOperation(lib, isolated.operation)).toBe(NativeClipboardOperationStatus.Read)
    expect(lib.destroyOperation(isolated.operation)).toBe(NativeClipboardDestroyStatus.Destroyed)
  }
  await shutdown(lib, secondService)
  lib.dispose()
  lib.dispose()
  otherLib.dispose()
  await sleep(5)
})
