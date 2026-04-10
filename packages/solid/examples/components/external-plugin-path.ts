import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const defaultPluginEntry = ".plugin/index.tsx"

type ResolveExternalPluginCandidatesInput = {
  cwd: string
  execPath: string
  moduleUrl: string
  envPath?: string
}

function normalizeExternalPluginPath(input: string, cwd: string): string {
  if (input.startsWith("file://")) {
    return fileURLToPath(input)
  }

  // Canonicalize the path according to the current platform.
  // Notably, this applies the drive letter of cwd to the input path under
  // Windows if not present in the input path.
  //
  // On other platforms, paths starting with / are not affected
  // Windows:
  //   isAbsolute("/foo") => true
  //   resolve("c:/baz", "/foo/bar") => "c:\\foo\\bar"
  // Posix:
  //   isAbsolute("/foo") => true
  //   resolve("/baz", "/foo/bar") => "/foo/bar"
  return resolve(cwd, input)
}

export function resolveExternalPluginCandidates(input: ResolveExternalPluginCandidatesInput): string[] {
  const modulePath = normalizeExternalPluginPath(input.moduleUrl, input.cwd)
  const execPath = normalizeExternalPluginPath(input.execPath, input.cwd)
  const envPath = input.envPath?.trim() && normalizeExternalPluginPath(input.envPath.trim(), input.cwd)

  const paths = new Set<string>()
  const moduleDir = dirname(modulePath)
  const execDir = dirname(execPath)

  if (envPath) {
    paths.add(envPath)
  }
  paths.add(resolve(input.cwd, defaultPluginEntry))
  paths.add(join(execDir, defaultPluginEntry))
  paths.add(resolve(execDir, "..", defaultPluginEntry))
  paths.add(resolve(moduleDir, "..", defaultPluginEntry))
  paths.add(resolve(input.cwd, "packages", "solid", "examples", defaultPluginEntry))
  paths.add(resolve(execDir, "..", "..", defaultPluginEntry))

  return [...paths]
}
