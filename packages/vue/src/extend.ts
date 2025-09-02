import { elements } from "./elements"
import type { OpenTUIComponents } from "../types/opentui"

export function extend<T extends Partial<OpenTUIComponents>>(newElements: T) {
  Object.assign(elements, newElements)
}
