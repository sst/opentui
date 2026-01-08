import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { defineComponent, h, nextTick, ref } from "vue"
import { testRender } from "../src/test-utils"
import { initDevtoolsGlobalHook } from "../src/devtools/connect"

type DevtoolsHook = {
  emit: (event: string, ...args: unknown[]) => void
  apps?: unknown[]
}

function getGlobalDevtoolsHook(): DevtoolsHook {
  const hook = (globalThis as Record<string, unknown>).__VUE_DEVTOOLS_GLOBAL_HOOK__ as DevtoolsHook | undefined
  if (!hook) throw new Error("Expected __VUE_DEVTOOLS_GLOBAL_HOOK__ to be set")
  return hook
}

async function withHiddenGlobalDevtoolsHook<T>(fn: () => Promise<T>): Promise<T> {
  const target = globalThis as Record<string, unknown>
  const original = Object.getOwnPropertyDescriptor(target, "__VUE_DEVTOOLS_GLOBAL_HOOK__")

  Object.defineProperty(target, "__VUE_DEVTOOLS_GLOBAL_HOOK__", {
    configurable: true,
    get: () => undefined,
  })

  try {
    return await fn()
  } finally {
    if (original) {
      Object.defineProperty(target, "__VUE_DEVTOOLS_GLOBAL_HOOK__", original)
    } else {
      delete target.__VUE_DEVTOOLS_GLOBAL_HOOK__
    }
  }
}

describe("DevTools integration | hook timing", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null

  beforeAll(async () => {
    await initDevtoolsGlobalHook()
  })

  afterEach(() => {
    if (testSetup) testSetup.renderer.destroy()
    testSetup = null
  })

  afterAll(() => {
    // Keep the global hook installed to avoid async unmount handlers throwing.
  })

  it("emits component updates when DevTools hook exists before renderer creation", async () => {
    const hook = getGlobalDevtoolsHook()

    const calls: Array<{ event: string; args: unknown[] }> = []
    const originalEmit = hook.emit
    hook.emit = (event, ...args) => {
      calls.push({ event, args })
      originalEmit.call(hook, event, ...args)
    }

    const count = ref(0)
    const TestComponent = defineComponent({
      setup() {
        return () => h("Text", { content: `count:${count.value}` })
      },
    })

    testSetup = await testRender(TestComponent, { width: 20, height: 3 })

    calls.length = 0
    count.value++
    await testSetup.renderOnce()

    expect(calls.some((c) => c.event === "component:updated")).toBe(true)

    hook.emit = originalEmit
  })

  it("does not emit component updates if DevTools is initialized after renderer creation", async () => {
    const count = ref(0)
    const TestComponent = defineComponent({
      setup() {
        return () => h("Text", { content: `count:${count.value}` })
      },
    })

    testSetup = await withHiddenGlobalDevtoolsHook(() => testRender(TestComponent, { width: 20, height: 3 }))
    const hook = getGlobalDevtoolsHook()

    const calls: Array<{ event: string; args: unknown[] }> = []
    const originalEmit = hook.emit
    hook.emit = (event, ...args) => {
      calls.push({ event, args })
      originalEmit.call(hook, event, ...args)
    }

    count.value++
    await nextTick()

    expect(calls.some((c) => c.event === "component:updated")).toBe(false)

    hook.emit = originalEmit
  })
})
