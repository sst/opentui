import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"
import process from "process"

interface PackageJson {
  name: string
  version: string
  license?: string
  repository?: any
  description?: string
  homepage?: string
  author?: string
  bugs?: any
  keywords?: string[]
  module?: string
  main?: string
  types?: string
  type?: string
  exports?: any
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  engines?: Record<string, string>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")
const projectRootDir = resolve(rootDir, "../..")
const licensePath = join(projectRootDir, "LICENSE")
const packageJson: PackageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))

const args = process.argv.slice(2)
const isCi = args.includes("--ci")

console.log("Building @opentui/3d library...")

const distDir = join(rootDir, "dist")
rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

if (!packageJson.module) {
  console.error("Error: 'module' field not found in package.json")
  process.exit(1)
}

console.log("Building main entry point...")
const mainBuildResult = await Bun.build({
  entrypoints: [join(rootDir, packageJson.module)],
  target: "bun",
  outdir: distDir,
  packages: "external",
  splitting: true,
})

if (!mainBuildResult.success) {
  console.error("Build failed:", mainBuildResult.logs)
  process.exit(1)
}

console.log("Generating TypeScript declarations...")
const tsconfigBuildPath = join(rootDir, "tsconfig.build.json")
const tscResult: SpawnSyncReturns<Buffer> = spawnSync("bunx", ["tsc", "-p", tsconfigBuildPath], {
  cwd: rootDir,
  stdio: "inherit",
})

if (tscResult.status !== 0) {
  if (isCi) {
    console.error("Error: TypeScript declaration generation failed")
    process.exit(1)
  }
  console.warn("Warning: TypeScript declaration generation failed")
} else {
  console.log("TypeScript declarations generated")
}

const exports = {
  ".": {
    types: "./src/index.d.ts",
    import: "./index.js",
    require: "./index.js",
  },
}

const processedDependencies = { ...packageJson.dependencies }
if (processedDependencies["@opentui/core"] === "workspace:*") {
  processedDependencies["@opentui/core"] = packageJson.version
}

writeFileSync(
  join(distDir, "package.json"),
  JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      repository: packageJson.repository,
      module: "index.js",
      main: "index.js",
      types: "src/index.d.ts",
      type: packageJson.type,
      license: packageJson.license,
      exports,
      dependencies: processedDependencies,
      optionalDependencies: packageJson.optionalDependencies,
      engines: packageJson.engines,
    },
    null,
    2,
  ),
)

const readmePath = join(rootDir, "README.md")
if (existsSync(readmePath)) {
  copyFileSync(readmePath, join(distDir, "README.md"))
}

if (existsSync(licensePath)) {
  copyFileSync(licensePath, join(distDir, "LICENSE"))
}

console.log("Library built at:", distDir)
