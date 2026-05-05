import type { State } from "./state.js"
import type { NotificationService } from "./notify.js"
import type { KeymapEvent, ReactiveMatcher, RuntimeMatchable, RuntimeMatcher } from "../types.js"

function isReactiveMatcher(value: unknown): value is ReactiveMatcher {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as { get?: unknown; subscribe?: unknown }
  return typeof candidate.get === "function" && typeof candidate.subscribe === "function"
}

export interface ConditionService<TTarget extends object, TEvent extends KeymapEvent> {
  buildRuntimeMatcher(matcher: (() => boolean) | ReactiveMatcher, source: string): RuntimeMatcher
  matchesConditions(target: RuntimeMatchable): boolean
}

export function createConditionService<TTarget extends object, TEvent extends KeymapEvent>(
  state: State<TTarget, TEvent>,
  notify: NotificationService<TTarget, TEvent>,
): ConditionService<TTarget, TEvent> {
  const hasNoConditions = (target: RuntimeMatchable): boolean => {
    return target.requires.length === 0 && target.matchers.length === 0
  }

  const matchesRuntimeMatcher = (matcher: RuntimeMatcher): boolean => {
    try {
      return matcher.match()
    } catch (error) {
      notify.emitError(
        "runtime-matcher-error",
        error,
        `[Keymap] Error evaluating runtime matcher from ${matcher.source}:`,
      )
      return false
    }
  }

  const matchesRuntimeMatchers = (target: RuntimeMatchable): boolean => {
    if (target.matchers.length === 0) {
      return true
    }

    if (target.matchers.length === 1) {
      const [matcher] = target.matchers
      return matcher ? matchesRuntimeMatcher(matcher) : true
    }

    for (const matcher of target.matchers) {
      if (!matchesRuntimeMatcher(matcher)) {
        return false
      }
    }

    return true
  }

  const matchRequirements = (requires: readonly [name: string, value: unknown][]): boolean => {
    if (requires.length === 0) {
      return true
    }

    for (const [name, value] of requires) {
      if (!Object.is(state.data[name], value)) {
        return false
      }
    }

    return true
  }

  const matchesConditions = (target: RuntimeMatchable): boolean => {
    return hasNoConditions(target) || (matchRequirements(target.requires) && matchesRuntimeMatchers(target))
  }

  return {
    buildRuntimeMatcher(matcher, source) {
      if (typeof matcher === "function") {
        return { source, match: matcher }
      }

      if (isReactiveMatcher(matcher)) {
        return {
          source,
          match: () => matcher.get(),
          subscribe: (onChange) => matcher.subscribe(onChange),
        }
      }

      throw new Error(`Keymap ${source} expected a function or a reactive matcher`)
    },
    matchesConditions,
  }
}
