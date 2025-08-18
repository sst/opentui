import { readFileSync, writeFileSync } from "fs"
import { join, resolve, dirname } from "path"
import { fileURLToPath } from "url"
import process from "process"

interface PackageJson {
  version: string
  optionalDependencies?: Record<string, string>
  [key: string]: any
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")
const packageJsonPath = join(rootDir, "package.json")

const args = process.argv.slice(2)
const version = args[0]

if (!version) {
  console.error("Error: Please provide a version number")
  console.error("Usage: node scripts/prepare-release.ts <version>")
  console.error("Example: node scripts/prepare-release.ts 0.2.0")
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(version)) {
  console.error(`Error: Invalid version format: ${version}`)
  console.error("Version should follow semver format (e.g., 1.0.0, 1.0.0-beta.1)")
  process.exit(1)
}

console.log(`Updating package.json to version ${version}...`)

const packageJson: PackageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))

packageJson.version = version

if (packageJson.optionalDependencies) {
  for (const depName in packageJson.optionalDependencies) {
    if (depName.startsWith("@opentui/core-")) {
      packageJson.optionalDependencies[depName] = version
      console.log(`Updated ${depName} to ${version}`)
    }
  }
}

writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")

console.log(`✅ Successfully updated package.json to version ${version}`)
