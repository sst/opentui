import type { EventData, KeymapEvent } from "../types.js"
import type { ActivationService } from "./activation.js"
import type { NotificationService } from "./notify.js"
import type { State } from "./state.js"

export class RuntimeService<TTarget extends object, TEvent extends KeymapEvent> {
  constructor(
    private readonly state: State<TTarget, TEvent>,
    private readonly notify: NotificationService<TTarget, TEvent>,
    private readonly activation: ActivationService<TTarget, TEvent>,
  ) {}

  public getData(name: string): unknown {
    return this.state.runtime.data[name]
  }

  public setData(name: string, value: unknown): void {
    this.notify.runWithStateChangeBatch(() => {
      if (value === undefined) {
        if (!(name in this.state.runtime.data)) {
          return
        }

        delete this.state.runtime.data[name]
        this.activation.ensureValidPendingSequence()
        this.notify.queueStateChange()
        return
      }

      if (Object.is(this.state.runtime.data[name], value)) {
        return
      }

      this.state.runtime.data[name] = value
      this.activation.ensureValidPendingSequence()
      this.notify.queueStateChange()
    })
  }

  public getReadonlyData(): Readonly<EventData> {
    return Object.freeze({ ...this.state.runtime.data })
  }
}
