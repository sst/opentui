import { EventEmitter } from "events"
import type { TrackedNode } from "./TrackedNode"

export type GlobalEvents = {
  treeChanged: TrackedNode<any>
}

class TypedEmitter extends EventEmitter {
  emit<K extends keyof GlobalEvents>(event: K, payload: GlobalEvents[K]) {
    return super.emit(event, payload)
  }

  on<K extends keyof GlobalEvents>(event: K, listener: (payload: GlobalEvents[K]) => void) {
    return super.on(event, listener)
  }
}

export const globalEmitter = new TypedEmitter()
