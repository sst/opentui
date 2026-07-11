import { getCurrentNodeAssetTarget, getNativeAssetDescriptor } from "../node-asset-target.js"
import { resolveAssetRootPath } from "./assets.js"

interface NativePackageModule {
  readonly default: string
}

export async function resolveNativeLibraryPath(): Promise<string> {
  const target = getCurrentNodeAssetTarget()
  const asset = getNativeAssetDescriptor(target)
  const configuredPath = resolveAssetRootPath(asset.key)
  if (configuredPath !== undefined) {
    return configuredPath
  }

  if (process.platform === "darwin") {
    // @ts-ignore Optional native package may be absent when building on another platform.
    if (process.arch === "x64") return ((await import("@opentui/core-darwin-x64")) as NativePackageModule).default
    // @ts-ignore Optional native package may be absent when building on another platform.
    if (process.arch === "arm64") return ((await import("@opentui/core-darwin-arm64")) as NativePackageModule).default
  }

  if (process.platform === "linux") {
    if (process.arch === "x64") {
      if (process.env.OPENTUI_LIBC === "musl") {
        // @ts-ignore Optional native package may be absent unless building a musl target.
        return ((await import("@opentui/core-linux-x64-musl")) as NativePackageModule).default
      }
      // @ts-ignore Optional native package may be absent when building on another platform.
      return ((await import("@opentui/core-linux-x64")) as NativePackageModule).default
    }

    if (process.arch === "arm64") {
      if (process.env.OPENTUI_LIBC === "musl") {
        // @ts-ignore Optional native package may be absent unless building a musl target.
        return ((await import("@opentui/core-linux-arm64-musl")) as NativePackageModule).default
      }
      // @ts-ignore Optional native package may be absent when building on another platform.
      return ((await import("@opentui/core-linux-arm64")) as NativePackageModule).default
    }
  }

  if (process.platform === "win32") {
    // @ts-ignore Optional native package may be absent when building on another platform.
    if (process.arch === "x64") return ((await import("@opentui/core-win32-x64")) as NativePackageModule).default
    // @ts-ignore Optional native package may be absent when building on another platform.
    if (process.arch === "arm64") return ((await import("@opentui/core-win32-arm64")) as NativePackageModule).default
  }

  throw new Error(`OpenTUI is not supported on the current platform: ${target.platform}-${target.arch}`)
}
