/**
 * A module-level map to store timeout IDs for all debounced functions
 * Structure: Map<scopeId, Map<debounceId, timerId>>
 */
const TIMERS_MAP = new Map<string | number, Map<string | number, ReturnType<typeof setTimeout>>>();

/**
 * Debounce controller that manages debounce instances for a specific scope
 */
export class DebounceController {
  constructor(private scopeId: string | number) {
    // Initialize the scope map if it doesn't exist
    if (!TIMERS_MAP.has(this.scopeId)) {
      TIMERS_MAP.set(this.scopeId, new Map());
    }
  }

  /**
   * Debounces the provided function with the given ID
   * 
   * @param id Unique identifier within this scope
   * @param ms Milliseconds to wait before executing
   * @param fn Function to execute
   */
  debounce<R>(id: string | number, ms: number, fn: () => Promise<R>): Promise<R> {
    const scopeMap = TIMERS_MAP.get(this.scopeId)!;
    
    return new Promise((resolve, reject) => {
      // Clear any existing timeout for this ID
      if (scopeMap.has(id)) {
        clearTimeout(scopeMap.get(id));
      }
      
      // Set a new timeout
      const timerId = setTimeout(() => {
        try {
          resolve(fn());
        } catch (error) {
          reject(error);
        }
        scopeMap.delete(id);
      }, ms);
      
      // Store the new timeout ID
      scopeMap.set(id, timerId);
    });
  }

  /**
   * Clear a specific debounce timer in this scope
   * 
   * @param id The debounce ID to clear
   */
  clearDebounce(id: string | number): void {
    const scopeMap = TIMERS_MAP.get(this.scopeId);
    if (scopeMap && scopeMap.has(id)) {
      clearTimeout(scopeMap.get(id));
      scopeMap.delete(id);
    }
  }

  /**
   * Clear all debounce timers in this scope
   */
  clear(): void {
    const scopeMap = TIMERS_MAP.get(this.scopeId);
    if (scopeMap) {
      scopeMap.forEach(timerId => clearTimeout(timerId));
      scopeMap.clear();
    }
  }
}

/**
 * Creates a new debounce controller for a specific scope
 * 
 * @param scopeId Unique identifier for this debounce scope
 * @returns A DebounceController for the specified scope
 */
export function createDebounce(scopeId: string | number): DebounceController {
  return new DebounceController(scopeId);
}

/**
 * Clears all debounce timers for a specific scope
 * 
 * @param scopeId The scope identifier
 */
export function clearDebounceScope(scopeId: string | number): void {
  const scopeMap = TIMERS_MAP.get(scopeId);
  if (scopeMap) {
    scopeMap.forEach(timerId => clearTimeout(timerId));
    scopeMap.clear();
  }
}

/**
 * Clears all active debounce timers across all scopes
 */
export function clearAllDebounces(): void {
  TIMERS_MAP.forEach(scopeMap => {
    scopeMap.forEach(timerId => clearTimeout(timerId));
    scopeMap.clear();
  });
  TIMERS_MAP.clear();
} 