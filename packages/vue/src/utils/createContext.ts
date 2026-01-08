import { provide, inject, type InjectionKey } from "vue"

/**
 * Create a typed context provider/injector pair.
 * Inspired by Solid's createContextProvider pattern.
 *
 * @example
 * ```ts
 * const [injectMyContext, provideMyContext] = createContext<MyContextType>('MyContext')
 *
 * // In parent component
 * provideMyContext({ value: 42 })
 *
 * // In child component
 * const ctx = injectMyContext()
 * ```
 */
export function createContext<T>(
  contextName: string,
  defaultValue?: T,
): [injectContext: (fallback?: T) => T, provideContext: (value: T) => T] {
  const key: InjectionKey<T> = Symbol(contextName)

  const injectContext = (fallback?: T): T => {
    const context = inject(key, fallback ?? defaultValue)
    if (context === undefined) {
      throw new Error(
        `[OpenTUI] ${contextName} context not found. ` + `Make sure to wrap your component with a provider.`,
      )
    }
    return context
  }

  const provideContext = (value: T): T => {
    provide(key, value)
    return value
  }

  return [injectContext, provideContext]
}
