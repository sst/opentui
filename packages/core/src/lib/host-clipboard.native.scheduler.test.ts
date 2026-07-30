import { expect, test } from "bun:test"

import { NativeClipboardPollScheduler } from "./host-clipboard.native.scheduler.js"

interface FakeTimer {
  cleared: boolean
  refed: boolean
  callback: () => void
  ref(): void
  unref(): void
}

const createHarness = () => {
  const timers: FakeTimer[] = []
  const scheduler = new NativeClipboardPollScheduler<FakeTimer>({
    set: (callback) => {
      const timer: FakeTimer = {
        cleared: false,
        refed: true,
        callback,
        ref() {
          timer.refed = true
        },
        unref() {
          timer.refed = false
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

test("tracks process liveness as provider and operation work changes", () => {
  const { scheduler, timers } = createHarness()

  scheduler.schedule(false, true, () => {})
  expect(timers).toHaveLength(1)
  expect(timers[0]).toMatchObject({ cleared: false, refed: false })

  scheduler.schedule(true, true, () => {})
  expect(timers).toHaveLength(2)
  expect(timers[0]?.cleared).toBe(true)
  expect(timers[1]).toMatchObject({ cleared: false, refed: true })

  scheduler.schedule(false, true, () => {})
  expect(timers[1]).toMatchObject({ cleared: false, refed: false })
  scheduler.schedule(true, true, () => {})
  expect(timers).toHaveLength(2)
  expect(timers[1]?.refed).toBe(true)

  scheduler.schedule(false, false, () => {})
  expect(timers[1]?.cleared).toBe(true)

  let callbackCount = 0
  scheduler.schedule(true, false, () => {
    callbackCount += 1
  })
  expect(timers[2]).toMatchObject({ cleared: false, refed: true })
  timers[2]!.callback()
  timers[2]!.callback()
  expect(callbackCount).toBe(1)
  scheduler.schedule(true, false, () => {})
  expect(timers).toHaveLength(4)
  scheduler.dispose()
  scheduler.dispose()
  expect(timers[3]?.cleared).toBe(true)
})

test("schedules one unrefed service turn after any final terminal operation poll", () => {
  const { scheduler, timers } = createHarness()
  let hasOperation = true
  let providerActive = false
  const drain = () => {
    providerActive = false
    if (!hasOperation) {
      scheduler.schedule(hasOperation, providerActive, drain)
      return
    }
    hasOperation = false
    providerActive = true
    scheduler.schedule(hasOperation, providerActive, drain)
  }

  scheduler.schedule(hasOperation, false, drain)
  timers[0]!.callback()

  expect(timers[1]).toMatchObject({ cleared: false, refed: false })
  timers[1]!.callback()
  expect(timers).toHaveLength(2)
})
