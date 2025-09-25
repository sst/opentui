import os from "os"
import path from "path"
import { singleton } from "./singleton"
import { registerEnvVar, env } from "./env"

export interface DataPaths {
  globalConfigPath: string
  globalConfigFile: string
  localConfigFile: string
  globalDataPath: string
}

registerEnvVar({
  name: "XDG_CONFIG_HOME",
  description: "Base directory for user-specific configuration files",
  type: "string",
  default: undefined,
})

registerEnvVar({
  name: "XDG_DATA_HOME",
  description: "Base directory for user-specific data files",
  type: "string",
  default: undefined,
})

export class DataPathsManager {
  private _globalConfigPath: string
  private _globalConfigFile: string
  private _localConfigFile: string
  private _globalDataPath: string

  constructor(appName: string = "opentui") {
    const homeDir = os.homedir()
    const baseConfigDir = env.XDG_CONFIG_HOME || path.join(homeDir, ".config")
    this._globalConfigPath = path.join(baseConfigDir, appName)
    this._globalConfigFile = path.join(this._globalConfigPath, "init.ts")
    this._localConfigFile = path.join(process.cwd(), `.${appName}.ts`)
    const baseDataDir = env.XDG_DATA_HOME || path.join(homeDir, ".local/share")
    this._globalDataPath = path.join(baseDataDir, appName)
  }

  get globalConfigPath(): string {
    return this._globalConfigPath
  }

  get globalConfigFile(): string {
    return this._globalConfigFile
  }

  get localConfigFile(): string {
    return this._localConfigFile
  }

  get globalDataPath(): string {
    return this._globalDataPath
  }

  toObject(): DataPaths {
    return {
      globalConfigPath: this.globalConfigPath,
      globalConfigFile: this.globalConfigFile,
      localConfigFile: this.localConfigFile,
      globalDataPath: this.globalDataPath,
    }
  }
}

export function getDataPaths(appName?: string): DataPathsManager {
  const key = `data-paths-${appName || "opentui"}`
  return singleton(key, () => new DataPathsManager(appName))
}
