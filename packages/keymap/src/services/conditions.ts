import type { NotificationService } from "./notify.js"
import type { State } from "./state.js"
import type { KeymapEvent, ReactiveMatcher, RegisteredLayer, RuntimeMatchable, RuntimeMatcher } from "../types.js"

function isReactiveMatcher(value: unknown): value is ReactiveMatcher {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as { get?: unknown; subscribe?: unknown }
  return typeof candidate.get === "function" && typeof candidate.subscribe === "function"
}

export class ConditionService<TTarget extends object, TEvent extends KeymapEvent> {
  #state: State<TTarget, TEvent>
  #notify: NotificationService<TTarget, TEvent>

  constructor(
    state: State<TTarget, TEvent>,
    notify: NotificationService<TTarget, TEvent>,
  ) {
    this.#state = state
    this.#notify = notify
  }

  public buildRuntimeMatcher(matcher: (() => boolean) | ReactiveMatcher, source: string): RuntimeMatcher {
    if (typeof matcher === "function") {
      return {
        source,
        match: matcher,
      }
    }

    if (isReactiveMatcher(matcher)) {
      return {
        source,
        match: () => matcher.get(),
        subscribe: (onChange) => matcher.subscribe(onChange),
      }
    }

    throw new Error(`Keymap ${source} expected a function or a reactive matcher`)
  }

  public hasNoConditions(target: RuntimeMatchable): boolean {
    return target.requires.length === 0 && target.matchers.length === 0
  }

  public matchesConditions(target: RuntimeMatchable): boolean {
    if (this.hasNoConditions(target)) {
      return true
    }

    return this.#matchRequirements(target.requires) && this.#matchesRuntimeMatchers(target)
  }

  public layerMatchesRuntimeState(layer: RegisteredLayer<TTarget, TEvent>): boolean {
    if (this.#state.layers.layersWithConditions === 0 || this.hasNoConditions(layer)) {
      return true
    }

    return this.matchesConditions(layer)
  }

  #matchRequirements(requires: readonly [name: string, value: unknown][]): boolean {
    if (requires.length === 0) {
      return true
    }

    for (const [name, value] of requires) {
      if (!Object.is(this.#state.runtime.data[name], value)) {
        return false
      }
    }

    return true
  }

  #matchesRuntimeMatcher(matcher: RuntimeMatcher): boolean {
    try {
      return matcher.match()
    } catch (error) {
      this.#notify.emitError(
        "runtime-matcher-error",
        error,
        `[Keymap] Error evaluating runtime matcher from ${matcher.source}:`,
      )
      return false
    }
  }

  #matchesRuntimeMatchers(target: RuntimeMatchable): boolean {
    if (target.matchers.length === 0) {
      return true
    }

    if (target.matchers.length === 1) {
      const [matcher] = target.matchers
      return matcher ? this.#matchesRuntimeMatcher(matcher) : true
    }

    for (const matcher of target.matchers) {
      if (!this.#matchesRuntimeMatcher(matcher)) {
        return false
      }
    }

    return true
  }
}
