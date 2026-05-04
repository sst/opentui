import type { EventData, KeymapEvent } from "../types.js"
import type { ActivationService } from "./activation.js"
import type { NotificationService } from "./notify.js"
import type { State } from "./state.js"

export interface RuntimeService<TTarget extends object, TEvent extends KeymapEvent> {
  getData(name: string): unknown
  setData(name: string, value: unknown): void
  getReadonlyData(): Readonly<EventData>
}

export function createRuntimeService<TTarget extends object, TEvent extends KeymapEvent>(
  state: State<TTarget, TEvent>,
  notify: NotificationService<TTarget, TEvent>,
  activation: ActivationService<TTarget, TEvent>,
): RuntimeService<TTarget, TEvent> {
  return {
    getData(name) {
      return state.runtime.data[name]
    },
    setData(name, value) {
      notify.runWithStateChangeBatch(() => {
        if (value === undefined) {
          if (!(name in state.runtime.data)) {
            return
          }

          delete state.runtime.data[name]
          activation.ensureValidPendingSequence()
          notify.queueStateChange()
          return
        }

        if (Object.is(state.runtime.data[name], value)) {
          return
        }

        state.runtime.data[name] = value
        activation.ensureValidPendingSequence()
        notify.queueStateChange()
      })
    },
    getReadonlyData() {
      return Object.freeze({ ...state.runtime.data })
    },
  }
}
