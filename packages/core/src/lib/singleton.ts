const singletonCacheSymbol = Symbol.for("@opentui/core/singleton")

/**
 * Ensures a value is initialized once per process,
 * persists across Bun hot reloads, and is type-safe.
 */
export function singleton<T>(key: string, factory: () => T): T {
  // @ts-expect-error this symbol is only used in this file and is not part of the public API
  const bag = (globalThis[singletonCacheSymbol] ??= new Map<string, unknown>()) as Map<string, unknown>
  if (!bag.has(key)) {
    bag.set(key, factory())
  }
  return bag.get(key) as T
}

export function destroySingleton(key: string): void {
  // @ts-expect-error this symbol is only used in this file and is not part of the public API
  const bag = globalThis[singletonCacheSymbol] as Map<string, unknown> | undefined
  if (bag?.has(key)) {
    bag.delete(key)
  }
}

export function hasSingleton(key: string): boolean {
  // @ts-expect-error this symbol is only used in this file and is not part of the public API
  const bag = globalThis[singletonCacheSymbol] as Map<string, unknown> | undefined
  return bag?.has(key) ?? false
}
