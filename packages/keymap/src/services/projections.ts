import type { ActivationService } from "./activation.js"
import type { State } from "./state.js"
import type { ActiveKey, ActiveKeyOptions, KeymapEvent, KeySequencePart } from "../types.js"

export interface KeymapProjections<TTarget extends object, TEvent extends KeymapEvent> {
  getPendingSequence(): readonly KeySequencePart[]
  getActiveKeys(options?: ActiveKeyOptions): readonly ActiveKey<TTarget, TEvent>[]
}

export function createKeymapProjections<TTarget extends object, TEvent extends KeymapEvent>(
  state: State<TTarget, TEvent>,
  activation: ActivationService<TTarget, TEvent>,
): KeymapProjections<TTarget, TEvent> {
  let pendingSequenceCacheVersion = -1
  let pendingSequenceCache: readonly KeySequencePart[] = []
  let activeKeysPlainCacheVersion = -1
  let activeKeysPlainCache: readonly ActiveKey<TTarget, TEvent>[] = []
  let activeKeysBindingsCacheVersion = -1
  let activeKeysBindingsCache: readonly ActiveKey<TTarget, TEvent>[] = []
  let activeKeysMetadataCacheVersion = -1
  let activeKeysMetadataCache: readonly ActiveKey<TTarget, TEvent>[] = []
  let activeKeysBindingsAndMetadataCacheVersion = -1
  let activeKeysBindingsAndMetadataCache: readonly ActiveKey<TTarget, TEvent>[] = []

  const canCacheActiveKeys = (): boolean => {
    return !state.commandResolvers.has() && state.activeKeyCacheBlockers === 0
  }

  const getPendingSequence = (): readonly KeySequencePart[] => {
    if (pendingSequenceCacheVersion === state.cacheVersion) {
      return pendingSequenceCache
    }

    const sequence = activation.getPendingSequence()
    if (!state.pending || canCacheActiveKeys()) {
      pendingSequenceCacheVersion = state.cacheVersion
      pendingSequenceCache = sequence
    }

    return sequence
  }

  const getActiveKeys = (options?: ActiveKeyOptions): readonly ActiveKey<TTarget, TEvent>[] => {
    if (canCacheActiveKeys()) {
      if (options === undefined) {
        if (activeKeysPlainCacheVersion === state.derivedVersion) return activeKeysPlainCache
        const activeKeys = activation.getActiveKeys()
        activeKeysPlainCacheVersion = state.derivedVersion
        activeKeysPlainCache = activeKeys
        return activeKeys
      }

      const includeBindings = options.includeBindings === true
      const includeMetadata = options.includeMetadata === true
      if (includeBindings) {
        if (includeMetadata) {
          if (activeKeysBindingsAndMetadataCacheVersion === state.derivedVersion) {
            return activeKeysBindingsAndMetadataCache
          }
          const activeKeys = activation.getActiveKeys(options)
          activeKeysBindingsAndMetadataCacheVersion = state.derivedVersion
          activeKeysBindingsAndMetadataCache = activeKeys
          return activeKeys
        }

        if (activeKeysBindingsCacheVersion === state.derivedVersion) return activeKeysBindingsCache
        const activeKeys = activation.getActiveKeys(options)
        activeKeysBindingsCacheVersion = state.derivedVersion
        activeKeysBindingsCache = activeKeys
        return activeKeys
      }

      if (includeMetadata) {
        if (activeKeysMetadataCacheVersion === state.derivedVersion) return activeKeysMetadataCache
        const activeKeys = activation.getActiveKeys(options)
        activeKeysMetadataCacheVersion = state.derivedVersion
        activeKeysMetadataCache = activeKeys
        return activeKeys
      }

      if (activeKeysPlainCacheVersion === state.derivedVersion) return activeKeysPlainCache
      const activeKeys = activation.getActiveKeys(options)
      activeKeysPlainCacheVersion = state.derivedVersion
      activeKeysPlainCache = activeKeys
      return activeKeys
    }

    return activation.getActiveKeys(options)
  }

  return { getPendingSequence, getActiveKeys }
}
