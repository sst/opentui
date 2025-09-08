import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

interface PackageJson {
  name: string
  version: string
  optionalDependencies?: Record<string, string>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")

const packageJson: PackageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))

console.log(`Publishing @opentui/core@${packageJson.version}...`)
console.log("Make sure you've run the pre-publish validation script first!")

const libDir = join(rootDir, "dist")
const packageJsons: Record<string, PackageJson> = {
  [libDir]: JSON.parse(readFileSync(join(libDir, "package.json"), "utf8")),
}

// Load all native package.json files
for (const pkgName of Object.keys(packageJsons[libDir].optionalDependencies!).filter((x) =>
  x.startsWith(packageJson.name),
)) {
  const nativeDir = join(rootDir, "node_modules", pkgName)
  packageJsons[nativeDir] = JSON.parse(readFileSync(join(nativeDir, "package.json"), "utf8"))
}

// Publish all packages (main + native packages)
Object.entries(packageJsons).forEach(([dir, { name, version }]) => {
  console.log(`\nPublishing ${name}@${version}...`)

  const isSnapshot = version.includes("-snapshot") || /^0\.0\.0-\d{8}-[a-f0-9]{8}$/.test(version)
  const publishArgs = ["publish", "--access=public"]

  if (isSnapshot) {
    publishArgs.push("--tag", "snapshot")
    console.log(`  Publishing as snapshot (--tag snapshot)`)
  }

  const publish: SpawnSyncReturns<Buffer> = spawnSync("npm", publishArgs, {
    cwd: dir,
    stdio: "inherit",
  })

  if (publish.status !== 0) {
    console.error(`Failed to publish '${name}@${version}'.`)
    process.exit(1)
  }

  console.log(`Successfully published '${name}@${version}'`)
})

console.log(`\nAll @opentui/core packages published successfully!`)
