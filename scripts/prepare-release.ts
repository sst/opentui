import { readFileSync, writeFileSync } from "fs"
import { join, resolve, dirname } from "path"
import { fileURLToPath } from "url"
import process from "process"

interface PackageJson {
  name: string
  version: string
  optionalDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  [key: string]: any
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")

const args = process.argv.slice(2)
const version = args[0]

if (!version) {
  console.error("Error: Please provide a version number")
  console.error("Usage: bun scripts/prepare-release.ts <version>")
  console.error("Example: bun scripts/prepare-release.ts 0.2.0")
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(version)) {
  console.error(`Error: Invalid version format: ${version}`)
  console.error("Version should follow semver format (e.g., 1.0.0, 1.0.0-beta.1)")
  process.exit(1)
}

console.log(`\nPreparing release ${version} for all packages...\n`)

// Update @opentui/core package
const corePackageJsonPath = join(rootDir, "packages", "core", "package.json")
console.log("Updating @opentui/core...")

try {
  const corePackageJson: PackageJson = JSON.parse(readFileSync(corePackageJsonPath, "utf8"))
  
  // Update version
  corePackageJson.version = version
  
  // Update optionalDependencies for native packages
  if (corePackageJson.optionalDependencies) {
    for (const depName in corePackageJson.optionalDependencies) {
      if (depName.startsWith("@opentui/core-")) {
        corePackageJson.optionalDependencies[depName] = version
        console.log(`  Updated ${depName} to ${version}`)
      }
    }
  }
  
  writeFileSync(corePackageJsonPath, JSON.stringify(corePackageJson, null, 2) + "\n")
  console.log(`  @opentui/core updated to version ${version}`)
} catch (error) {
  console.error(`  Failed to update @opentui/core: ${error}`)
  process.exit(1)
}

// Update @opentui/solid package
const solidPackageJsonPath = join(rootDir, "packages", "solid", "package.json")
console.log("\nUpdating @opentui/solid...")

try {
  const solidPackageJson: PackageJson = JSON.parse(readFileSync(solidPackageJsonPath, "utf8"))
  
  // Update version
  solidPackageJson.version = version
  
  // Note: We keep @opentui/core as "workspace:*" in source.
  // The build script will automatically replace it with the current version.
  
  writeFileSync(solidPackageJsonPath, JSON.stringify(solidPackageJson, null, 2) + "\n")
  console.log(`  @opentui/solid updated to version ${version}`)
  console.log(`  Note: @opentui/core dependency will be set to ${version} during build`)
} catch (error) {
  console.error(`  Failed to update @opentui/solid: ${error}`)
  process.exit(1)
}

console.log(`
Successfully prepared release ${version} for all packages!

Next steps:
1. Review the changes: git diff
2. Build the packages: bun run build
3. Commit the changes: git add -A && git commit -m "Release v${version}" && git push
4. Publish to npm: bun run publish
5. Push to GitHub: git push
`)