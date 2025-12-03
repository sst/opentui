/**
 * Utilities for detecting and handling Bun standalone virtual filesystem paths.
 *
 * When `bun build --compile` runs, it embeds assets into a virtual filesystem ("bunfs").
 * - POSIX (Linux/macOS): Assets live at paths containing `$bunfs` or starting with `//`
 * - Windows: Assets live at `B:/~BUN/...` (Bun hardcodes drive B: to avoid collisions)
 */

/**
 * Detects if a path is a Bun standalone virtual filesystem path.
 * - POSIX: Contains $bunfs or starts with //
 * - Windows: B:/~BUN/... or B:\~BUN\... (case-insensitive)
 */
export function isBunfsPath(path: string): boolean {
  // Check for $bunfs marker (used in path resolution)
  if (path.includes("$bunfs")) return true
  // POSIX bunfs paths start with //
  if (path.startsWith("//")) return true
  // Windows bunfs paths: B:/~BUN/ or B:\~BUN\ (case-insensitive)
  return /^B:[\\/]~BUN[\\/]/i.test(path)
}

/**
 * Returns the platform-specific root for embedded assets.
 * Safe for use in Worker environments (where global 'process' might vary).
 */
export function getBunfsRootPath(): string {
  const isWin =
    typeof process !== "undefined"
      ? process.platform === "win32"
      : typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")

  return isWin ? "B:/~BUN/root/" : "/$bunfs/root/"
}

/**
 * Normalizes a path to the embedded root.
 * NOTE: Flattens directory structure to the root level.
 */
export function normalizeBunfsPath(path: string, basename: string): string {
  return getBunfsRootPath() + basename
}
