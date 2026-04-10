#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { Command, CommanderError, Option } from "commander"

interface DistTestPackageJson {
  name?: string
  version?: string
  engines?: Record<string, string>
  scripts?: {
    build?: string
    test?: string
  }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  overrides?: Record<string, string>
  resolutions?: Record<string, string>
}

interface PackedPackageJson {
  name: string
  version: string
}

interface PackedTarball {
  packageName: string
  tarballPath: string
}

interface CliArgs {
  testDirs: string[]
  outDir?: string
  runtime?: Runtime
  build: boolean
  help: boolean
}

interface FixturePaths {
  destinationDir: string
  tmpDir: string
  npmCacheDir: string
  bunCacheDir: string
  bunTmpDir: string
  packDir: string
}

interface DistTestFixture {
  sourceTestDir: string
  packageJson: DistTestPackageJson
  runtime: Runtime
  localPackageNames: string[]
  paths: FixturePaths
}

interface RunCommandArgs {
  cmd: string
  displayCmd?: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  quiet?: boolean
}

interface BunCommandContext {
  cwd: string
  tmpDir?: string
  quiet?: boolean
}

interface NpmCommandContext {
  cwd: string
  cacheDir?: string
  quiet?: boolean
}

interface CopyDirectoryArgs {
  srcDir: string
  destDir: string
}

interface ReadPackageJsonArgs {
  filePath: string
}

interface PackPackageArgs {
  packageDir: string
  packDir: string
  npmCacheDir: string
}

interface RepoBuildCache {
  buildEnabled: boolean
  builtPackages: Set<string>
  failedPackages: Map<string, Error>
}

interface EnsureRepoPackagesArgs {
  packageNames: string[]
  buildCache: RepoBuildCache
}

interface PrepareFixtureTarballsArgs {
  fixture: DistTestFixture
  buildCache: RepoBuildCache
}

interface RewriteFixturePackageJsonArgs {
  packageJson: DistTestPackageJson
  destinationDir: string
  localPackageNames: string[]
  tarballs: Map<string, string>
}

interface VerifyLocalPackageInstallArgs {
  fixture: DistTestFixture
}

interface CreateFixturesArgs {
  invocationDir: string
  args: CliArgs
  outputRootDir: string
}

interface RunFixtureArgs {
  fixture: DistTestFixture
  invocationDir: string
  buildCache: RepoBuildCache
}

interface AnnotateErrorArgs {
  error: unknown
  fixture: DistTestFixture
  invocationDir: string
  phase: string
  rerunCommands?: string[]
}

type Runtime = "node" | "bun"

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const nativePackageName = `@opentui/core-${process.platform}-${process.arch}`
const bunExecutable = process.execPath

const logInfo = (message: string): void => console.log(`INFO: ${message}`)
const logSuccess = (message: string): void => console.log(`SUCCESS: ${message}`)
const logError = (message: string): void => console.error(`ERROR: ${message}`)

const parseArgs = (rawArgs: string[]): CliArgs => {
  let testDirs: string[] = []

  const program = new Command()
    .name("./scripts/dist-test.ts")
    .argument("[testDirs...]", "One or more dist-test fixture directories")
    .option("--build", 'Build all in-repo dependencies marked with "*" before packing')
    .option("--out <dir>", "Write each prepared fixture into <out>/<fixture-name>")
    .addOption(
      new Option("--runtime <runtime>", "Override the runtime/package manager for every fixture").choices([
        "node",
        "bun",
      ]),
    )
    .addHelpText(
      "after",
      `
Fixture conventions:
  - package.json.engines selects the default runtime/package manager
  - dependencies["some-package"] = "*" means "pack/install this repo package"
  - dependencies["@opentui/core"] = "*" also installs the platform native tarball
  - without --build, dist/package.json.version must match the source package.json version

Examples:
  ./scripts/dist-test.ts --build ./packages/core/dist-test/nodejs
  ./scripts/dist-test.ts --build ./packages/*/dist-test/*
  ./scripts/dist-test.ts --runtime bun ./packages/react/dist-test/bun
`,
    )
    .exitOverride()
    .action((parsedTestDirs: string[]) => {
      testDirs = parsedTestDirs
    })

  try {
    program.parse(rawArgs, { from: "user" })
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return {
        testDirs: [],
        outDir: undefined,
        runtime: undefined,
        build: false,
        help: true,
      }
    }

    throw error
  }

  const options = program.opts<{
    build?: boolean
    out?: string
    runtime?: Runtime
  }>()

  return {
    testDirs,
    outDir: options.out,
    runtime: options.runtime,
    build: options.build ?? false,
    help: false,
  }
}

const runCommand = ({ cmd, displayCmd, args, cwd, env, quiet = false }: RunCommandArgs): void => {
  const renderedCmd = displayCmd ?? cmd
  const result = spawnSync(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: quiet ? "pipe" : "inherit",
  })

  if (result.error) {
    throw new Error(`Failed to run "${cmd}": ${result.error.message}`, { cause: result.error })
  }

  if (result.status !== 0) {
    if (quiet) {
      const stdout = result.stdout?.toString()
      const stderr = result.stderr?.toString()

      console.error(`$ (cd ${cwd} && ${renderedCmd} ${args.join(" ")})`)

      if (stdout) {
        process.stdout.write(stdout)
      }

      if (stderr) {
        process.stderr.write(stderr)
      }
    }

    throw new Error(`Command failed with exit code ${result.status ?? "unknown"}: ${renderedCmd} ${args.join(" ")}`)
  }
}

const bun = (ctx: BunCommandContext, ...args: string[]): void => {
  const env = ctx.tmpDir ? { TMPDIR: ctx.tmpDir } : undefined
  runCommand({
    cmd: bunExecutable,
    displayCmd: "bun",
    args,
    cwd: ctx.cwd,
    env,
    quiet: ctx.quiet,
  })
}

const npm = (ctx: NpmCommandContext, ...args: string[]): void => {
  const env = ctx.cacheDir ? { npm_config_cache: ctx.cacheDir } : undefined
  runCommand({
    cmd: "npm",
    args,
    cwd: ctx.cwd,
    env,
    quiet: ctx.quiet,
  })
}

const copyDirectoryContents = ({ srcDir, destDir }: CopyDirectoryArgs): void => {
  mkdirSync(destDir, { recursive: true })

  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue
    }

    cpSync(join(srcDir, entry.name), join(destDir, entry.name), {
      recursive: true,
      force: true,
    })
  }
}

const readPackageJson = <T>({ filePath }: ReadPackageJsonArgs): T => {
  if (!existsSync(filePath)) {
    throw new Error(`Missing package.json: ${filePath}`)
  }

  return JSON.parse(readFileSync(filePath, "utf8")) as T
}

const hasInstallableDependencies = (packageJson: DistTestPackageJson): boolean => {
  return [packageJson.dependencies, packageJson.devDependencies, packageJson.optionalDependencies].some(
    (deps) => deps !== undefined && Object.keys(deps).length > 0,
  )
}

const inferRuntime = (packageJson: DistTestPackageJson): Runtime => {
  const engineKey = Object.keys(packageJson.engines ?? {})[0]
  if (!engineKey) {
    throw new Error(
      `Unable to infer runtime from package.json. Add an engines field like { "node": ">=22" } or pass --runtime.`,
    )
  }

  if (engineKey !== "node" && engineKey !== "bun") {
    throw new Error(`Unsupported runtime "${engineKey}" in package.json.engines. Expected "node" or "bun".`)
  }

  return engineKey
}

const getLocalRepoDependencies = (packageJson: DistTestPackageJson): string[] => {
  return Object.entries(packageJson.dependencies ?? {})
    .filter(([, version]) => version === "*")
    .map(([packageName]) => packageName)
}

const getRepoPackageDir = (packageName: string): string => {
  const packageDirName = packageName.split("/").at(-1)
  if (!packageDirName) {
    throw new Error(`Unable to resolve repo package directory for ${packageName}`)
  }

  return join(repoRoot, "packages", packageDirName)
}

const getRepoDistDir = (packageName: string): string => join(getRepoPackageDir(packageName), "dist")

const getNativePackageDir = (): string =>
  join(getRepoPackageDir("@opentui/core"), "node_modules", "@opentui", nativePackageName.slice("@opentui/".length))

const readSourcePackageJson = (packageName: string): DistTestPackageJson => {
  const packageJsonPath = join(getRepoPackageDir(packageName), "package.json")
  const packageJson = readPackageJson<DistTestPackageJson>({ filePath: packageJsonPath })

  if (packageJson.name !== packageName) {
    throw new Error(`Expected ${packageJsonPath} to describe ${packageName}, found ${packageJson.name ?? "unknown"}`)
  }

  return packageJson
}

const readDistPackageJson = (packageName: string): DistTestPackageJson => {
  return readPackageJson<DistTestPackageJson>({
    filePath: join(getRepoDistDir(packageName), "package.json"),
  })
}

const assertDistVersionMatchesSource = ({ packageName }: { packageName: string }): void => {
  const sourcePackageJson = readSourcePackageJson(packageName)
  const distPackageJson = readDistPackageJson(packageName)

  if (!sourcePackageJson.version) {
    throw new Error(`Missing version in source package.json for ${packageName}`)
  }

  if (!distPackageJson.version) {
    throw new Error(`Missing version in dist/package.json for ${packageName}`)
  }

  if (distPackageJson.version !== sourcePackageJson.version) {
    throw new Error(
      `Version mismatch for ${packageName}: source package.json has ${sourcePackageJson.version}, dist/package.json has ${distPackageJson.version}. Re-run with --build.`,
    )
  }
}

const sortRepoPackages = (packageNames: string[]): string[] => {
  const requestedPackages = new Set(packageNames)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const orderedPackages: string[] = []

  const visit = (packageName: string): void => {
    if (visited.has(packageName)) {
      return
    }

    if (visiting.has(packageName)) {
      throw new Error(`Circular local dist-test dependency detected at ${packageName}`)
    }

    visiting.add(packageName)

    for (const dependencyName of Object.keys(readSourcePackageJson(packageName).dependencies ?? {}).sort()) {
      if (requestedPackages.has(dependencyName)) {
        visit(dependencyName)
      }
    }

    visiting.delete(packageName)
    visited.add(packageName)
    orderedPackages.push(packageName)
  }

  for (const packageName of [...requestedPackages].sort()) {
    visit(packageName)
  }

  return orderedPackages
}

const packageFilename = ({ name, version }: PackedPackageJson): string => {
  return `${name.replace(/^@/, "").replace(/\//g, "-")}-${version}.tgz`
}

const packPackage = ({ packageDir, packDir, npmCacheDir }: PackPackageArgs): PackedTarball => {
  const packageJson = readPackageJson<PackedPackageJson>({
    filePath: join(packageDir, "package.json"),
  })

  npm(
    {
      cwd: packageDir,
      cacheDir: npmCacheDir,
      quiet: true,
    },
    "pack",
    "--pack-destination",
    packDir,
  )

  const tarballPath = join(packDir, packageFilename(packageJson))
  if (!existsSync(tarballPath)) {
    throw new Error(`Packed tarball was not created: ${tarballPath}`)
  }

  return {
    packageName: packageJson.name,
    tarballPath,
  }
}

const ensureRepoPackagesReady = ({ packageNames, buildCache }: EnsureRepoPackagesArgs): void => {
  for (const packageName of sortRepoPackages(packageNames)) {
    const previousFailure = buildCache.failedPackages.get(packageName)
    if (previousFailure) {
      throw previousFailure
    }

    if (buildCache.builtPackages.has(packageName)) {
      continue
    }

    try {
      if (buildCache.buildEnabled) {
        logInfo(`Building ${packageName}...`)
        bun(
          {
            cwd: getRepoPackageDir(packageName),
          },
          "run",
          "build",
        )
      }

      const distDir = getRepoDistDir(packageName)
      if (!existsSync(distDir)) {
        throw new Error(`Dist directory not found for ${packageName}: ${distDir}. Re-run with --build.`)
      }

      if (!buildCache.buildEnabled) {
        assertDistVersionMatchesSource({ packageName })
      }

      if (packageName === "@opentui/core") {
        const nativePackageDir = getNativePackageDir()
        if (!existsSync(nativePackageDir)) {
          throw new Error(`Native package directory not found: ${nativePackageDir}. Re-run with --build.`)
        }
      }
    } catch (error) {
      const wrapped =
        error instanceof Error
          ? new Error(`Failed to prepare ${packageName}: ${error.message}`, { cause: error })
          : new Error(`Failed to prepare ${packageName}`)
      buildCache.failedPackages.set(packageName, wrapped)
      throw wrapped
    }

    buildCache.builtPackages.add(packageName)
  }
}

const normalizeFileDependency = ({ cwd, filePath }: { cwd: string; filePath: string }): string => {
  const relativePath = relative(cwd, filePath).replaceAll("\\", "/")
  return `file:${relativePath.startsWith(".") ? relativePath : `./${relativePath}`}`
}

const rewriteFixturePackageJson = ({
  packageJson,
  destinationDir,
  localPackageNames,
  tarballs,
}: RewriteFixturePackageJsonArgs): DistTestPackageJson => {
  const dependencies = { ...(packageJson.dependencies ?? {}) }
  const overrides = { ...(packageJson.overrides ?? {}) }
  const resolutions = { ...(packageJson.resolutions ?? {}) }

  for (const packageName of localPackageNames) {
    const tarballPath = tarballs.get(packageName)
    if (!tarballPath) {
      throw new Error(`Missing tarball for local dependency ${packageName}`)
    }

    const fileDependency = normalizeFileDependency({
      cwd: destinationDir,
      filePath: tarballPath,
    })

    dependencies[packageName] = fileDependency
    overrides[packageName] = fileDependency
    resolutions[packageName] = fileDependency
  }

  if (localPackageNames.includes("@opentui/core")) {
    const nativeTarballPath = tarballs.get(nativePackageName)
    if (!nativeTarballPath) {
      throw new Error(`Missing tarball for local dependency ${nativePackageName}`)
    }

    dependencies[nativePackageName] = normalizeFileDependency({
      cwd: destinationDir,
      filePath: nativeTarballPath,
    })
  }

  return {
    ...packageJson,
    dependencies,
    overrides,
    resolutions,
  }
}

const prepareFixtureTarballs = ({ fixture, buildCache }: PrepareFixtureTarballsArgs): Map<string, string> => {
  const tarballs = new Map<string, string>()

  if (fixture.localPackageNames.length === 0) {
    return tarballs
  }

  ensureRepoPackagesReady({
    packageNames: fixture.localPackageNames,
    buildCache,
  })

  mkdirSync(fixture.paths.packDir, { recursive: true })

  for (const packageName of sortRepoPackages(fixture.localPackageNames)) {
    logInfo(`Packing ${packageName}...`)
    const packedPackage = packPackage({
      packageDir: getRepoDistDir(packageName),
      packDir: fixture.paths.packDir,
      npmCacheDir: fixture.paths.npmCacheDir,
    })
    tarballs.set(packedPackage.packageName, packedPackage.tarballPath)

    if (packageName === "@opentui/core") {
      logInfo(`Packing ${nativePackageName}...`)
      const packedNativePackage = packPackage({
        packageDir: getNativePackageDir(),
        packDir: fixture.paths.packDir,
        npmCacheDir: fixture.paths.npmCacheDir,
      })
      tarballs.set(packedNativePackage.packageName, packedNativePackage.tarballPath)
    }
  }

  return tarballs
}

const installDependencies = ({ fixture }: { fixture: DistTestFixture }): void => {
  if (fixture.runtime === "bun") {
    bun(
      {
        cwd: fixture.paths.destinationDir,
        tmpDir: fixture.paths.bunTmpDir,
      },
      "install",
      "--backend=copyfile",
      "--cache-dir",
      fixture.paths.bunCacheDir,
    )
    return
  }

  npm(
    {
      cwd: fixture.paths.destinationDir,
      cacheDir: fixture.paths.npmCacheDir,
    },
    "install",
    "--audit=false",
    "--fund=false",
    "--legacy-peer-deps",
  )
}

const runPackageScript = ({ fixture, scriptName }: { fixture: DistTestFixture; scriptName: string }): void => {
  if (fixture.runtime === "bun") {
    bun(
      {
        cwd: fixture.paths.destinationDir,
        tmpDir: fixture.paths.bunTmpDir,
      },
      "run",
      scriptName,
    )
    return
  }

  npm(
    {
      cwd: fixture.paths.destinationDir,
      cacheDir: fixture.paths.npmCacheDir,
    },
    "run",
    scriptName,
  )
}

const prepareFixtureDirectory = ({ fixture }: { fixture: DistTestFixture }): void => {
  rmSync(fixture.paths.destinationDir, {
    recursive: true,
    force: true,
  })

  copyDirectoryContents({
    srcDir: fixture.sourceTestDir,
    destDir: fixture.paths.destinationDir,
  })

  for (const dirPath of [
    fixture.paths.tmpDir,
    fixture.paths.npmCacheDir,
    fixture.paths.bunCacheDir,
    fixture.paths.bunTmpDir,
    fixture.paths.packDir,
  ]) {
    mkdirSync(dirPath, { recursive: true })
  }
}

const collectInstalledPackagePaths = ({
  nodeModulesDir,
  packageName,
}: {
  nodeModulesDir: string
  packageName: string
}): string[] => {
  if (!existsSync(nodeModulesDir)) {
    return []
  }

  const packagePathSegments = packageName.split("/")
  const matches = new Set<string>()
  const visitedNodeModules = new Set<string>()

  const visitNodeModules = (currentNodeModulesDir: string): void => {
    const normalizedDir = resolve(currentNodeModulesDir)
    if (visitedNodeModules.has(normalizedDir) || !existsSync(normalizedDir)) {
      return
    }

    visitedNodeModules.add(normalizedDir)

    const candidatePackageDir = join(normalizedDir, ...packagePathSegments)
    if (existsSync(join(candidatePackageDir, "package.json"))) {
      matches.add(candidatePackageDir)
    }

    for (const entry of readdirSync(normalizedDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".bin") {
        continue
      }

      if (entry.name.startsWith("@")) {
        const scopeDir = join(normalizedDir, entry.name)
        for (const scopedEntry of readdirSync(scopeDir, { withFileTypes: true })) {
          if (!scopedEntry.isDirectory()) {
            continue
          }

          visitNodeModules(join(scopeDir, scopedEntry.name, "node_modules"))
        }
        continue
      }

      visitNodeModules(join(normalizedDir, entry.name, "node_modules"))
    }
  }

  visitNodeModules(nodeModulesDir)
  return [...matches].sort()
}

const verifyLocalPackageInstall = ({ fixture }: VerifyLocalPackageInstallArgs): void => {
  if (fixture.localPackageNames.length === 0) {
    return
  }

  const nodeModulesDir = join(fixture.paths.destinationDir, "node_modules")
  const failures: string[] = []

  for (const packageName of fixture.localPackageNames) {
    const installedPaths = collectInstalledPackagePaths({
      nodeModulesDir,
      packageName,
    })

    if (installedPaths.length !== 1) {
      const renderedPaths =
        installedPaths.length === 0
          ? "none found"
          : installedPaths.map((installedPath) => `\n    - ${installedPath}`).join("")
      failures.push(
        `${packageName}: expected exactly 1 installed copy, found ${installedPaths.length}${installedPaths.length === 0 ? ` (${renderedPaths})` : ` at:${renderedPaths}`}`,
      )
    }
  }

  if (failures.length > 0) {
    throw new Error(`Local package install verification failed:\n  ${failures.join("\n  ")}`)
  }
}

const getFixtureLabel = ({ fixture, invocationDir }: { fixture: DistTestFixture; invocationDir: string }): string => {
  return relative(invocationDir, fixture.sourceTestDir) || fixture.sourceTestDir
}

const toDisplayPath = (path: string): string => path.replaceAll("\\", "/")

const getRelativeCommandPath = ({ fromDir, toPath }: { fromDir: string; toPath: string }): string => {
  const relativePath = toDisplayPath(relative(fromDir, toPath))
  if (!relativePath) {
    return "."
  }

  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`
}

const getDistTestRerunCommand = ({
  fixture,
  invocationDir,
  buildEnabled,
}: {
  fixture: DistTestFixture
  invocationDir: string
  buildEnabled: boolean
}): string => {
  const scriptPath = getRelativeCommandPath({
    fromDir: invocationDir,
    toPath: join(repoRoot, "scripts", "dist-test.ts"),
  })
  const fixtureLabel = getFixtureLabel({
    fixture,
    invocationDir,
  })

  return ["bun", scriptPath, ...(buildEnabled ? ["--build"] : []), fixtureLabel].join(" ")
}

const annotateError = ({ error, fixture, invocationDir, phase, rerunCommands = [] }: AnnotateErrorArgs): Error => {
  const baseError = error instanceof Error ? error : new Error(String(error))
  const details = [
    `  phase: ${phase}`,
    `  in dir: ${fixture.paths.destinationDir}`,
    `  fixture: ${getFixtureLabel({ fixture, invocationDir })}`,
  ]

  if (rerunCommands.length > 0) {
    details.push("  rerun:")
    for (const rerunCommand of rerunCommands) {
      details.push(`    | ${rerunCommand}`)
    }
  }

  baseError.message += `\n${details.join("\n")}`
  return baseError
}

const runFixture = ({ fixture, invocationDir, buildCache }: RunFixtureArgs): void => {
  const fixtureLabel = getFixtureLabel({ fixture, invocationDir })
  const packageJsonPath = join(fixture.paths.destinationDir, "package.json")
  const packageManager = fixture.runtime === "bun" ? "bun" : "npm"

  console.log("")
  logInfo(`Fixture: ${fixtureLabel}`)

  try {
    prepareFixtureDirectory({ fixture })
  } catch (error) {
    throw annotateError({
      error,
      fixture,
      invocationDir,
      phase: "prepare fixture directory",
      rerunCommands: [
        getDistTestRerunCommand({
          fixture,
          invocationDir,
          buildEnabled: buildCache.buildEnabled,
        }),
      ],
    })
  }

  logSuccess(`Prepared dist test directory: ${fixture.paths.destinationDir}`)
  logInfo(`Runtime: ${fixture.runtime}`)

  let packageJson: DistTestPackageJson
  try {
    packageJson = readPackageJson<DistTestPackageJson>({
      filePath: packageJsonPath,
    })
  } catch (error) {
    throw annotateError({
      error,
      fixture,
      invocationDir,
      phase: "load fixture package.json",
      rerunCommands: [
        getDistTestRerunCommand({
          fixture,
          invocationDir,
          buildEnabled: buildCache.buildEnabled,
        }),
      ],
    })
  }

  if (fixture.localPackageNames.length > 0) {
    logInfo(`Preparing local packages: ${fixture.localPackageNames.join(", ")}`)
    try {
      const tarballs = prepareFixtureTarballs({
        fixture,
        buildCache,
      })
      packageJson = rewriteFixturePackageJson({
        packageJson,
        destinationDir: fixture.paths.destinationDir,
        localPackageNames: fixture.localPackageNames,
        tarballs,
      })
      writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")
    } catch (error) {
      throw annotateError({
        error,
        fixture,
        invocationDir,
        phase: "prepare local packages",
        rerunCommands: [
          getDistTestRerunCommand({
            fixture,
            invocationDir,
            buildEnabled: buildCache.buildEnabled,
          }),
        ],
      })
    }

    logSuccess("Local package tarballs prepared")
  }

  if (hasInstallableDependencies(packageJson)) {
    logInfo(`Installing dependencies with ${packageManager}...`)
    try {
      installDependencies({ fixture })
    } catch (error) {
      const installCommand =
        fixture.runtime === "bun"
          ? `cd ${fixture.paths.destinationDir} && bun install --backend=copyfile --cache-dir ${fixture.paths.bunCacheDir}`
          : `cd ${fixture.paths.destinationDir} && npm install --audit=false --fund=false --legacy-peer-deps`

      throw annotateError({
        error,
        fixture,
        invocationDir,
        phase: "install dependencies",
        rerunCommands: [
          installCommand,
          getDistTestRerunCommand({
            fixture,
            invocationDir,
            buildEnabled: buildCache.buildEnabled,
          }),
        ],
      })
    }

    logSuccess("Dependencies installed")
  }

  if (fixture.localPackageNames.length > 0) {
    logInfo("Verifying local package installs...")
    try {
      verifyLocalPackageInstall({
        fixture,
      })
    } catch (error) {
      throw annotateError({
        error,
        fixture,
        invocationDir,
        phase: "verify local package installs",
        rerunCommands: [
          `cd ${fixture.paths.destinationDir} && find node_modules -path '*/package.json' | sort`,
          getDistTestRerunCommand({
            fixture,
            invocationDir,
            buildEnabled: buildCache.buildEnabled,
          }),
        ],
      })
    }

    logSuccess("Local package installs verified")
  }

  if (packageJson.scripts?.build) {
    logInfo(`Running build script with ${packageManager}...`)
    try {
      runPackageScript({
        fixture,
        scriptName: "build",
      })
    } catch (error) {
      throw annotateError({
        error,
        fixture,
        invocationDir,
        phase: "run build script",
        rerunCommands: [
          `cd ${fixture.paths.destinationDir} && ${packageManager} run build`,
          getDistTestRerunCommand({
            fixture,
            invocationDir,
            buildEnabled: buildCache.buildEnabled,
          }),
        ],
      })
    }

    logSuccess("Build complete")
  }

  if (!packageJson.scripts?.test) {
    throw annotateError({
      error: new Error(`Test package is missing a "test" script: ${packageJsonPath}`),
      fixture,
      invocationDir,
      phase: "validate test script",
      rerunCommands: [
        getDistTestRerunCommand({
          fixture,
          invocationDir,
          buildEnabled: buildCache.buildEnabled,
        }),
      ],
    })
  }

  logInfo(`Running test script with ${packageManager}...`)
  try {
    runPackageScript({
      fixture,
      scriptName: "test",
    })
  } catch (error) {
    throw annotateError({
      error,
      fixture,
      invocationDir,
      phase: "run test script",
      rerunCommands: [
        `cd ${fixture.paths.destinationDir} && ${packageManager} run test`,
        getDistTestRerunCommand({
          fixture,
          invocationDir,
          buildEnabled: buildCache.buildEnabled,
        }),
      ],
    })
  }

  logSuccess("Dist test passed")
}

const getFixtureOutputNames = (sourceTestDirs: string[]): string[] => {
  return sourceTestDirs.map((sourceTestDir) => {
    const repoRelativePath = relative(repoRoot, sourceTestDir).replaceAll("\\", "/")
    const trimmedPath = repoRelativePath.startsWith("packages/")
      ? repoRelativePath.slice("packages/".length)
      : repoRelativePath
    const outputName = trimmedPath.replaceAll("/", "-")

    if (!outputName) {
      throw new Error(`Unable to derive output directory name for ${sourceTestDir}`)
    }

    return outputName
  })
}

const createFixturePaths = ({ destinationDir }: { destinationDir: string }): FixturePaths => {
  const tmpDir = join(destinationDir, ".tmp")

  return {
    destinationDir,
    tmpDir,
    npmCacheDir: join(tmpDir, "npm-cache"),
    bunCacheDir: join(tmpDir, "bun-cache"),
    bunTmpDir: join(tmpDir, "bun-tmp"),
    packDir: join(tmpDir, "packs"),
  }
}

const createFixtures = ({ invocationDir, args, outputRootDir }: CreateFixturesArgs): DistTestFixture[] => {
  const sourceTestDirs = args.testDirs.map((testDir) => resolve(invocationDir, testDir))
  const outputNames = getFixtureOutputNames(sourceTestDirs)

  return sourceTestDirs.map((sourceTestDir, index) => {
    if (!existsSync(sourceTestDir)) {
      throw new Error(`Test directory does not exist: ${sourceTestDir}`)
    }

    const packageJsonPath = join(sourceTestDir, "package.json")
    if (!existsSync(packageJsonPath)) {
      throw new Error(`Test directory must contain a package.json: ${packageJsonPath}`)
    }

    const packageJson = readPackageJson<DistTestPackageJson>({
      filePath: packageJsonPath,
    })
    const runtime = args.runtime ?? inferRuntime(packageJson)
    const destinationDir = join(outputRootDir, outputNames[index])

    return {
      sourceTestDir,
      packageJson,
      runtime,
      localPackageNames: getLocalRepoDependencies(packageJson),
      paths: createFixturePaths({
        destinationDir,
      }),
    }
  })
}

const main = (): void => {
  console.log("OpenTUI Dist Test")
  console.log("=".repeat(50))

  const invocationDir = process.cwd()
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    return
  }

  if (args.testDirs.length === 0) {
    throw new Error("Missing required dist-test fixture path")
  }

  const outputRootDir = args.outDir ? resolve(invocationDir, args.outDir) : mkdtempSync(join(tmpdir(), "dist-test-"))
  const fixtures = createFixtures({
    invocationDir,
    args,
    outputRootDir,
  })
  const buildCache: RepoBuildCache = {
    buildEnabled: args.build,
    builtPackages: new Set<string>(),
    failedPackages: new Map<string, Error>(),
  }

  logInfo(`Output root: ${outputRootDir}`)

  for (const fixture of fixtures) {
    try {
      runFixture({
        fixture,
        invocationDir,
        buildCache,
      })
    } catch (error) {
      const fixtureLabel = getFixtureLabel({
        fixture,
        invocationDir,
      })
      logError(`Fixture failed: ${fixtureLabel}`)
      throw error
    }
  }
}

main()
