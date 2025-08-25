const idCounter = new Map<string, number>()

export function getNextId(elementType: string): string {
  if (!idCounter.has(elementType)) {
    idCounter.set(elementType, 0)
  }

  const value = idCounter.get(elementType)! + 1
  idCounter.set(elementType, value)
  return `${elementType}-${value}`
}
