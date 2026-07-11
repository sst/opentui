import { getCurrentNodeAssetTarget, getNativeAssetDescriptor } from "../node-asset-target.js"
import { resolveAssetRootPath } from "./assets.js"

interface NativePackageModule {
  readonly default: string
}

export async function resolveNativeLibraryPath(): Promise<string> {
  const asset = getNativeAssetDescriptor(getCurrentNodeAssetTarget())
  const configuredPath = resolveAssetRootPath(asset.key)
  if (configuredPath !== undefined) {
    return configuredPath
  }

  const specifier: string = asset.packageName
  return ((await import(specifier)) as NativePackageModule).default
}
