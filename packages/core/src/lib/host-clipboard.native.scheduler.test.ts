import { expect, test } from "bun:test"

import { NativeClipboardPollScheduler } from "./host-clipboard.native.scheduler.js"

interface FakeTimer {
  readonly callback: () => void
  readonly delayMs: number
  cleared: boolean
  refed: boolean
  refCalls: number
  unrefCalls: number
  ref: () => void
  unref: () => void
}

const createHarness = () => {
  const timers: FakeTimer[] = []
  const scheduler = new NativeClipboardPollScheduler<FakeTimer>({
    set: (callback, delayMs) => {
      const timer: FakeTimer = {
        callback,
        delayMs,
        cleared: false,
        refed: true,
        refCalls: 0,
        unrefCalls: 0,
        ref() {
          timer.refed = true
          timer.refCalls += 1
        },
        unref() {
          timer.refed = false
          timer.unrefCalls += 1
        },
      }
      timers.push(timer)
      return timer
    },
    clear: (timer) => {
      timer.cleared = true
    },
  })
  return { scheduler, timers }
}

test("replaces the provider timer with one operation timer", () => {
  const { scheduler, timers } = createHarness()

  scheduler.schedule(false, true, () => {})
  expect(timers).toHaveLength(1)
  expect(timers[0]).toMatchObject({ delayMs: 8, refed: false, unrefCalls: 1, cleared: false })

  scheduler.schedule(true, true, () => {})
  expect(timers).toHaveLength(2)
  expect(timers[0]?.cleared).toBe(true)
  expect(timers[1]).toMatchObject({ delayMs: 1, refed: true, unrefCalls: 0, cleared: false })
})

test("does not create duplicate timers and clears timer identity before the callback", () => {
  const { scheduler, timers } = createHarness()
  let callbackCalls = 0

  scheduler.schedule(true, false, () => {
    callbackCalls += 1
  })
  scheduler.schedule(true, false, () => {})
  expect(timers).toHaveLength(1)
  expect(timers[0]?.refCalls).toBe(1)

  timers[0]?.callback()
  expect(callbackCalls).toBe(1)
  scheduler.schedule(false, true, () => {})
  expect(timers).toHaveLength(2)
  expect(timers[1]?.delayMs).toBe(8)
})

test("clears timers when idle or disposed", () => {
  const { scheduler, timers } = createHarness()

  scheduler.schedule(false, true, () => {})
  scheduler.schedule(false, false, () => {})
  expect(timers[0]?.cleared).toBe(true)

  scheduler.schedule(true, false, () => {})
  scheduler.dispose()
  expect(timers[1]?.cleared).toBe(true)
  scheduler.dispose()
  expect(timers).toHaveLength(2)
})
