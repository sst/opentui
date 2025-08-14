import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))

console.log(
  `
Please confirm the following before continuing:

1. The "version" field in package.json has been updated.
2. The changes have been pushed to GitHub.

Continue? (y/n)
`.trim(),
)

const confirm = spawnSync(
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
  const versions = JSON.parse(
    spawnSync("npm", ["view", packageJson.name, "versions", "--json"], {}).stdout.toString().trim(),
  )

  if (versions.includes(packageJson.version)) {
    console.error("Error: package.json version has not been incremented.")
    console.warn("Please update the version before publishing.")
    process.exit(1)
  }
} catch {}

const libDir = join(rootDir, "dist")
if (!existsSync(libDir)) {
  console.error("Error: dist directory not found. Please run 'bun run build' first.")
  process.exit(1)
}

const mismatches = []
const packageJsons = {
  [libDir]: JSON.parse(readFileSync(join(libDir, "package.json"), "utf8")),
}

for (const pkgName of Object.keys(packageJsons[libDir].optionalDependencies).filter((x) =>
  x.startsWith(packageJson.name),
)) {
  const nativeDir = join(rootDir, "node_modules", pkgName)
  if (!existsSync(nativeDir)) {
    console.error(`Error: Native package directory not found: ${nativeDir}`)
    console.error("Please run 'bun run build:native' first.")
    process.exit(1)
  }
  packageJsons[nativeDir] = JSON.parse(readFileSync(join(nativeDir, "package.json"), "utf8"))
}

for (const [dir, { name, version }] of Object.entries(packageJsons)) {
  if (version !== packageJson.version) {
    mismatches.push({
      name,
      dir,
      expected: packageJson.version,
      actual: version,
    })
  }
}

if (mismatches.length > 0) {
  console.error("Error: Version mismatch detected between root package and build packages:")
  mismatches.forEach((m) => console.error(`  - ${m.name}: expected ${m.expected}, found ${m.actual}\n  ^ "${m.dir}"`))
  process.exit(1)
}

if (process.env.NPM_AUTH_TOKEN) {
  const npmrcPath = join(process.env.HOME, ".npmrc")
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

Object.entries(packageJsons).forEach(([dir, { name, version }]) => {
  try {
    const versions = JSON.parse(
      spawnSync("npm", ["view", name, "versions", "--json"], {
        cwd: dir,
      })
        .stdout.toString()
        .trim(),
    )

    if (Array.isArray(versions) && versions.includes(version)) {
      console.error("Error: package.json version has not been incremented.")
      console.warn("Please update the version before publishing.")
      process.exit(1)
    }
  } catch {}

  const npmAuth = spawnSync("npm", ["whoami"], {})
  if (npmAuth.status !== 0) {
    console.error("Error: NPM authentication failed. Please run 'npm login' or ensure NPM_AUTH_TOKEN is set")
    process.exit(1)
  }

  const publish = spawnSync("npm", ["publish", "--access=public"], {
    cwd: dir,
    stdio: "inherit",
  })
  if (publish.status !== 0) {
    console.error(`Error: Failed to publish '${name}@${version}'.`)
    process.exit(1)
  }

  console.log(`Package '${name}@${version}' published.`)
})
