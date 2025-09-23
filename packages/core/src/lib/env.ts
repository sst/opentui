import { singleton } from "./singleton.ts"

/**
 * Environment variable registry
 *
 * Usage:
 * ```ts
 * import { registerEnvVar, env } from "./lib/env.ts";
 *
 * // Register environment variables
 * registerEnvVar({
 *   name: "DEBUG",
 *   description: "Enable debug logging",
 *   type: "boolean",
 *   default: false
 * });
 *
 * registerEnvVar({
 *   name: "PORT",
 *   description: "Server port number",
 *   type: "number",
 *   default: 3000
 * });
 *
 * // Access environment variables
 * if (env.DEBUG) {
 *   console.log("Debug mode enabled");
 * }
 *
 * const port = env.PORT; // number
 * ```
 */

export interface EnvVarConfig {
  name: string
  description: string
  default?: string | boolean | number
  type?: "string" | "boolean" | "number"
}

export const envRegistry: Record<string, EnvVarConfig> = {}

export function registerEnvVar(config: EnvVarConfig): void {
  const existing = envRegistry[config.name]
  if (existing) {
    if (
      existing.description !== config.description ||
      existing.type !== config.type ||
      existing.default !== config.default
    ) {
      throw new Error(
        `Environment variable "${config.name}" is already registered with different configuration. ` +
          `Existing: ${JSON.stringify(existing)}, New: ${JSON.stringify(config)}`,
      )
    }
    return
  }
  envRegistry[config.name] = config
}

function normalizeBoolean(value: string): boolean {
  const lowerValue = value.toLowerCase()
  return ["true", "1", "on", "yes"].includes(lowerValue)
}

function parseEnvValue(config: EnvVarConfig): string | boolean | number {
  const envValue = process.env[config.name]

  if (envValue === undefined && config.default !== undefined) {
    return config.default
  }

  if (envValue === undefined) {
    throw new Error(`Required environment variable ${config.name} is not set. ${config.description}`)
  }

  switch (config.type) {
    case "boolean":
      return typeof envValue === "boolean" ? envValue : normalizeBoolean(envValue)
    case "number":
      const numValue = Number(envValue)
      if (isNaN(numValue)) {
        throw new Error(`Environment variable ${config.name} must be a valid number, got: ${envValue}`)
      }
      return numValue
    case "string":
    default:
      return envValue
  }
}

class EnvStore {
  private parsedValues: Map<string, string | boolean | number> = new Map()

  get(key: string): string | boolean | number {
    if (this.parsedValues.has(key)) {
      return this.parsedValues.get(key)!
    }

    if (!(key in envRegistry)) {
      throw new Error(`Environment variable ${key} is not registered.`)
    }

    try {
      const value = parseEnvValue(envRegistry[key])
      this.parsedValues.set(key, value)
      return value
    } catch (error) {
      throw new Error(`Failed to parse env var ${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  has(key: string): boolean {
    return key in envRegistry
  }
}

const envStore = singleton("env-store", () => new EnvStore())

export const env = new Proxy({} as Record<string, string | boolean | number>, {
  get(target, prop: string) {
    if (typeof prop !== "string") {
      return undefined
    }
    return envStore.get(prop)
  },

  has(target, prop: string) {
    return envStore.has(prop)
  },

  ownKeys() {
    return Object.keys(envRegistry)
  },

  getOwnPropertyDescriptor(target, prop: string) {
    if (envStore.has(prop)) {
      return {
        enumerable: true,
        configurable: true,
        get: () => envStore.get(prop),
      }
    }
    return undefined
  },
})
