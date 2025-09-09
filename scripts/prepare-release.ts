import { readFileSync, writeFileSync } from "fs"
import { join, resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"
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
let version = args[0]

if (!version) {
  console.error("Error: Please provide a version number")
  console.error("Usage: bun scripts/prepare-release.ts <version>")
  console.error("Example: bun scripts/prepare-release.ts 0.2.0")
  console.error("         bun scripts/prepare-release.ts '*' (auto-increment patch)")
  process.exit(1)
}

// Handle auto-increment case
if (version === "*") {
  try {
    const corePackageJsonPath = join(rootDir, "packages", "core", "package.json")
    const corePackageJson: PackageJson = JSON.parse(readFileSync(corePackageJsonPath, "utf8"))
    const currentVersion = corePackageJson.version

    // Parse current version and increment patch
    const versionParts = currentVersion.split(".")
    if (versionParts.length !== 3) {
      console.error(`Error: Invalid current version format: ${currentVersion}`)
      process.exit(1)
    }

    const major = parseInt(versionParts[0])
    const minor = parseInt(versionParts[1])
    const patch = parseInt(versionParts[2]) + 1

    version = `${major}.${minor}.${patch}`
    console.log(`Auto-incrementing version from ${currentVersion} to ${version}`)
  } catch (error) {
    console.error(`Error: Failed to read current version: ${error}`)
    process.exit(1)
  }
}

if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(version)) {
  console.error(`Error: Invalid version format: ${version}`)
  console.error("Version should follow semver format (e.g., 1.0.0, 1.0.0-beta.1)")
  process.exit(1)
}

console.log(`\nPreparing release ${version} for all packages...\n`)

const corePackageJsonPath = join(rootDir, "packages", "core", "package.json")
console.log("Updating @opentui/core...")

try {
  const corePackageJson: PackageJson = JSON.parse(readFileSync(corePackageJsonPath, "utf8"))

  corePackageJson.version = version

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

const reactPackageJsonPath = join(rootDir, "packages", "react", "package.json")
console.log("\nUpdating @opentui/react...")

try {
  const reactPackageJson: PackageJson = JSON.parse(readFileSync(reactPackageJsonPath, "utf8"))

  reactPackageJson.version = version

  writeFileSync(reactPackageJsonPath, JSON.stringify(reactPackageJson, null, 2) + "\n")
  console.log(`  @opentui/react updated to version ${version}`)
  console.log(`  Note: @opentui/core dependency will be set to ${version} during build`)
} catch (error) {
  console.error(`  Failed to update @opentui/react: ${error}`)
  process.exit(1)
}

const solidPackageJsonPath = join(rootDir, "packages", "solid", "package.json")
console.log("\nUpdating @opentui/solid...")

try {
  const solidPackageJson: PackageJson = JSON.parse(readFileSync(solidPackageJsonPath, "utf8"))

  solidPackageJson.version = version

  writeFileSync(solidPackageJsonPath, JSON.stringify(solidPackageJson, null, 2) + "\n")
  console.log(`  @opentui/solid updated to version ${version}`)
  console.log(`  Note: @opentui/core dependency will be set to ${version} during build`)
} catch (error) {
  console.error(`  Failed to update @opentui/solid: ${error}`)
  process.exit(1)
}

const vuePackageJsonPath = join(rootDir, "packages", "vue", "package.json")
console.log("\nUpdating @opentui/vue...")

try {
  const vuePackageJson: PackageJson = JSON.parse(readFileSync(vuePackageJsonPath, "utf8"))

  vuePackageJson.version = version

  writeFileSync(vuePackageJsonPath, JSON.stringify(vuePackageJson, null, 2) + "\n")
  console.log(`  @opentui/vue updated to version ${version}`)
  console.log(`  Note: @opentui/core dependency will be set to ${version} during build`)
} catch (error) {
  console.error(`  Failed to update @opentui/vue: ${error}`)
  process.exit(1)
}

console.log("\nUpdating bun.lock...")
try {
  execSync("bun install", { cwd: rootDir, stdio: "inherit" })
  console.log("  bun.lock updated successfully")
} catch (error) {
  console.error(`  Failed to update bun.lock: ${error}`)
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
