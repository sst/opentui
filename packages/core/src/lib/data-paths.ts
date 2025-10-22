import os from "os"
import path from "path"
import { EventEmitter } from "events"
import { singleton } from "./singleton"
import { env, registerEnvVar } from "./env"
import { isValidDirectoryName } from "./validate-dir-name"

// Register environment variables for XDG directories
registerEnvVar({
  name: "XDG_CONFIG_HOME",
  description: "Base directory for user-specific configuration files",
  type: "string",
  default: "",
})

registerEnvVar({
  name: "XDG_DATA_HOME",
  description: "Base directory for user-specific data files",
  type: "string",
  default: "",
})

export interface DataPaths {
  globalConfigPath: string
  globalConfigFile: string
  localConfigFile: string
  globalDataPath: string
}

export interface DataPathsEvents {
  "paths:changed": [paths: DataPaths]
}

export class DataPathsManager extends EventEmitter<DataPathsEvents> {
  private _appName: string
  private _globalConfigPath?: string
  private _globalConfigFile?: string
  private _localConfigFile?: string
  private _globalDataPath?: string
  constructor() {
    super()
    this._appName = "opentui"
  }

  get appName(): string {
    return this._appName
  }

  set appName(value: string) {
    if (!isValidDirectoryName(value)) {
      throw new Error(`Invalid app name "${value}": must be a valid directory name`)
    }
    if (this._appName !== value) {
      this._appName = value
      this._globalConfigPath = undefined
      this._globalConfigFile = undefined
      this._localConfigFile = undefined
      this._globalDataPath = undefined
      this.emit("paths:changed", this.toObject())
    }
  }

  get globalConfigPath(): string {
    if (this._globalConfigPath === undefined) {
      const homeDir = os.homedir()
      const xdgConfigHome = env.XDG_CONFIG_HOME
      const baseConfigDir = xdgConfigHome || path.join(homeDir, ".config")
      this._globalConfigPath = path.join(baseConfigDir, this._appName)
    }
    return this._globalConfigPath
  }

  get globalConfigFile(): string {
    if (this._globalConfigFile === undefined) {
      this._globalConfigFile = path.join(this.globalConfigPath, "init.ts")
    }
    return this._globalConfigFile
  }

  get localConfigFile(): string {
    if (this._localConfigFile === undefined) {
      this._localConfigFile = path.join(process.cwd(), `.${this._appName}.ts`)
    }
    return this._localConfigFile
  }

  get globalDataPath(): string {
    if (this._globalDataPath === undefined) {
      const homeDir = os.homedir()
      const xdgDataHome = env.XDG_DATA_HOME
      const baseDataDir = xdgDataHome || path.join(homeDir, ".local/share")
      this._globalDataPath = path.join(baseDataDir, this._appName)
    }
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

export function getDataPaths(): DataPathsManager {
  return singleton("data-paths-opentui", () => new DataPathsManager())
}
