import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")
const projectRootDir = resolve(rootDir, "../..")
const distDir = join(rootDir, "dist")

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))

console.log("Building @opentui/3d...")

rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

// Copy TypeScript source (Bun runs TS directly)
cpSync(join(rootDir, "src"), join(distDir, "src"), { recursive: true })

// Process package.json - replace workspace:* with actual version
const processedDeps = { ...packageJson.dependencies }
if (processedDeps["@opentui/core"] === "workspace:*") {
  processedDeps["@opentui/core"] = packageJson.version
}

writeFileSync(
  join(distDir, "package.json"),
  JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      repository: packageJson.repository,
      module: "src/index.ts",
      main: "src/index.ts",
      types: "src/index.ts",
      type: "module",
      license: packageJson.license,
      exports: {
        ".": {
          types: "./src/index.ts",
          import: "./src/index.ts",
        },
      },
      dependencies: processedDeps,
      optionalDependencies: packageJson.optionalDependencies,
      engines: packageJson.engines,
    },
    null,
    2,
  ),
)

// Copy LICENSE
const licensePath = join(projectRootDir, "LICENSE")
if (existsSync(licensePath)) {
  copyFileSync(licensePath, join(distDir, "LICENSE"))
}

// Copy README if exists
const readmePath = join(rootDir, "README.md")
if (existsSync(readmePath)) {
  copyFileSync(readmePath, join(distDir, "README.md"))
}

console.log("Built at:", distDir)
