const singletonCacheSymbol = Symbol.for('@opentui/core/singleton')

/**
 * Ensures a value is initialized once per process,
 * persists across Bun hot reloads, and is type-safe.
 */
export function singleton<T>(key: string, factory: () => T): T {
  // @ts-expect-error this symbol is only used in this file and is not part of the public API
  const bag = globalThis[singletonCacheSymbol] ??= {}
  if (!(key in bag)) {
    bag[key] = factory()
  }
  return bag[key] as T
}
