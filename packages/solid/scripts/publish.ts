import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")

const packageJson: PackageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))

console.log(
  `
Please confirm the following before continuing:

1. The "version" field in package.json has been updated.
2. The @opentui/core package has been published with the same version.
3. The changes have been pushed to GitHub.

Continue? (y/n)
`.trim(),
)

const confirm: SpawnSyncReturns<Buffer> = spawnSync(
  "node",
  [
    "-e",
    `
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data) => {
      const input = data.toString().toLowerCase();
      if (input === 'y') process.exit(0);
      if (input === 'n' || input === '\\x03') process.exit(1);
    });
    `,
  ],
  {
    shell: false,
    stdio: "inherit",
  },
)

if (confirm.status !== 0) {
  console.log("Aborted.")
  process.exit(1)
}

try {
  const versions: string[] = JSON.parse(
    spawnSync("npm", ["view", packageJson.name, "versions", "--json"], {}).stdout.toString().trim(),
  )

  if (versions.includes(packageJson.version)) {
    console.error(`Error: ${packageJson.name}@${packageJson.version} already exists on npm.`)
    console.warn("Please update the version before publishing.")
    process.exit(1)
  }
} catch {}

const distDir = join(rootDir, "dist")
if (!existsSync(distDir)) {
  console.error("Error: dist directory not found. Please run 'bun run build' first.")
  process.exit(1)
}

const distPackageJson: PackageJson = JSON.parse(readFileSync(join(distDir, "package.json"), "utf8"))

if (distPackageJson.version !== packageJson.version) {
  console.error(`Error: Version mismatch between source and dist package.json`)
  console.error(`  Source version: ${packageJson.version}`)
  console.error(`  Dist version: ${distPackageJson.version}`)
  console.error("Please rebuild the package with 'bun run build'.")
  process.exit(1)
}

if (distPackageJson.dependencies?.["@opentui/core"] !== packageJson.version) {
  console.error(`Error: @opentui/core dependency version mismatch in dist`)
  console.error(`  Expected: ${packageJson.version}`)
  console.error(`  Found: ${distPackageJson.dependencies?.["@opentui/core"]}`)
  console.error("Please rebuild the package with 'bun run build'.")
  process.exit(1)
}

// Setup npm auth if token is provided
if (process.env.NPM_AUTH_TOKEN) {
  const npmrcPath = join(process.env.HOME as string, ".npmrc")
  const npmrcContent = `//registry.npmjs.org/:_authToken=${process.env.NPM_AUTH_TOKEN}\n`

  if (existsSync(npmrcPath)) {
    const existing = readFileSync(npmrcPath, "utf8")
    if (!existing.includes("//registry.npmjs.org/:_authToken")) {
      writeFileSync(npmrcPath, existing + "\n" + npmrcContent)
    }
  } else {
    writeFileSync(npmrcPath, npmrcContent)
  }
}

const npmAuth: SpawnSyncReturns<Buffer> = spawnSync("npm", ["whoami"], {})
if (npmAuth.status !== 0) {
  console.error("Error: NPM authentication failed. Please run 'npm login' or ensure NPM_AUTH_TOKEN is set")
  process.exit(1)
}

const publish: SpawnSyncReturns<Buffer> = spawnSync("npm", ["publish", "--access=public"], {
  cwd: distDir,
  stdio: "inherit",
})

if (publish.status !== 0) {
  console.error(`Error: Failed to publish '${packageJson.name}@${packageJson.version}'.`)
  process.exit(1)
}

console.log(`✅ Successfully published '${packageJson.name}@${packageJson.version}'`)
