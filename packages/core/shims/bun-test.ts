import "jsr:@lu-zero/bun-compat@^0.4.2"

export { describe, it, test, beforeEach, afterEach, beforeAll, afterAll } from "jsr:@std/testing/bdd"
export { expect } from "jsr:@std/expect"
import { stub as _stub, type Stub } from "jsr:@std/testing/mock"
import { fn as _mockFn } from "jsr:@std/expect/fn"

interface BunSpy {
  (...args: unknown[]): unknown
  mockImplementation(impl: (...args: unknown[]) => unknown): BunSpy
  mockReturnValue(value: unknown): BunSpy
  mockRestore(): void
  mock: { calls: unknown[][] }
}

function spyOn(obj: Record<string, unknown>, method: string): BunSpy {
  let impl: (() => unknown) | undefined = undefined
  const mockFn = _mockFn((...args: unknown[]) => (impl ? impl(...args) : undefined)) as unknown as BunSpy

  const stub = _stub(obj, method, (...args: unknown[]) => mockFn(...args))

  mockFn.mockImplementation = (newImpl: (...args: unknown[]) => unknown) => {
    impl = newImpl as () => unknown
    return mockFn
  }
  mockFn.mockReturnValue = (value: unknown) => {
    return mockFn.mockImplementation(() => value)
  }
  mockFn.mockRestore = () => stub.restore()
  mockFn.mock = { calls: stub.calls as unknown as unknown[][] }

  return mockFn
}

export { spyOn }

export function mock<T extends Function>(fn: T): T {
  return fn
}

export const jest = {
  fn: (impl?: Function) => {
    const fn = impl ?? (() => {})
    const calls: unknown[][] = []
    const wrapper = (...args: unknown[]) => {
      calls.push(args)
      return fn(...args)
    }
    wrapper.mock = { calls }
    return wrapper
  },
}
