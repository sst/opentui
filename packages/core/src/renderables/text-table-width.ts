export function allocateProportionalColumnWidths(widths: number[], targetWidth: number, minWidth: number): number[] {
  const baseWidths = widths.map((width) => Math.max(minWidth, Math.floor(width)))
  const totalBaseWidth = baseWidths.reduce((sum, width) => sum + width, 0)
  const capacity = baseWidths.map((width) => width - minWidth)
  const growth = new Array(baseWidths.length).fill(0)
  const available = Math.min(
    Math.max(0, targetWidth - minWidth * baseWidths.length),
    totalBaseWidth - minWidth * baseWidths.length,
  )

  if (available === 0) return growth.map(() => minWidth)
  if (available === capacity.reduce((sum, width) => sum + width, 0)) return baseWidths

  const weights = capacity.map(Math.sqrt)
  const active = capacity
    .map((width, idx) => ({ idx, width, weight: weights[idx]! }))
    .filter((column) => column.width > 0)
    .sort((a, b) => a.weight - b.weight)
  let remaining = available
  let totalWeight = active.reduce((sum, column) => sum + column.weight, 0)

  // Water-fill the arithmetic priority sequences in bulk, capping short columns first.
  for (const column of active) {
    if (remaining / totalWeight <= column.weight) break
    growth[column.idx] = column.width
    remaining -= column.width
    totalWeight -= column.weight
  }

  const level = remaining / totalWeight
  for (const column of active) {
    if (growth[column.idx] === column.width) continue
    growth[column.idx] = Math.min(column.width, Math.floor(level * column.weight))
  }

  let allocatedGrowth = growth.reduce((sum, width) => sum + width, 0)

  while (allocatedGrowth > available) {
    let worstIdx = -1
    let worstPriority = Number.NEGATIVE_INFINITY

    for (let idx = 0; idx < baseWidths.length; idx++) {
      if (growth[idx] === 0) continue

      const priority = growth[idx] / weights[idx]!
      if (priority > worstPriority || (priority === worstPriority && idx > worstIdx)) {
        worstIdx = idx
        worstPriority = priority
      }
    }

    if (worstIdx === -1) break
    growth[worstIdx] -= 1
    allocatedGrowth -= 1
  }

  // Flooring leaves fewer than one cell per active column to resolve by exact priority.
  while (allocatedGrowth < available) {
    let bestIdx = -1
    let bestPriority = Number.POSITIVE_INFINITY

    for (let idx = 0; idx < baseWidths.length; idx++) {
      if (growth[idx] >= capacity[idx]) continue

      const priority = (growth[idx] + 1) / weights[idx]!
      if (priority < bestPriority) {
        bestIdx = idx
        bestPriority = priority
      }
    }

    if (bestIdx === -1) break
    growth[bestIdx] += 1
    allocatedGrowth += 1
  }

  return growth.map((width) => width + minWidth)
}
