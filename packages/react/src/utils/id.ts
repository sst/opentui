import type { Type } from "../types/host"

const idCounter = new Map<string, number>()

export function getNextId(type: Type): string {
  if (!idCounter.has(type)) {
    idCounter.set(type, 0)
  }

  const value = idCounter.get(type)! + 1
  idCounter.set(type, value)

  return `${type}-${value}`
}
