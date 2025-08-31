/**
 * Represents a timeout handle.
 * Added here to avoid platform specific type as each one has a different API (Bun, Node, DOM)
 */
export type Timeout = ReturnType<typeof setTimeout> | undefined
