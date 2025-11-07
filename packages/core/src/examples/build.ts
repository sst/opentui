#!/usr/bin/env bun

import { mkdirSync, existsSync } from "fs"
import { join, dirname, relative } from "path"
import { fileURLToPath } from "url"
import { platform, arch } from "os"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, "..", "..")
const examplesDir = join(rootDir, "src", "examples")

// Get current platform and architecture
const currentPlatform = platform()
const currentArch = arch()

// Map Node.js os.arch() to Bun's target format
const getBunArch = (nodeArch: string): string => {
  switch (nodeArch) {
    case "x64":
      return "x64"
    case "arm64":
      return "arm64"
    default:
      return nodeArch
  }
}

const getBunPlatform = (nodePlatform: string): string => {
  switch (nodePlatform) {
    case "darwin":
      return "darwin"
    case "win32":
      return "windows"
    case "linux":
      return "linux"
    default:
      return nodePlatform
  }
}

const bunArch = getBunArch(currentArch)
const bunPlatform = getBunPlatform(currentPlatform)

console.log(`Building examples executable for ${bunPlatform}-${bunArch}...`)

// Ensure dist directory exists
const distDir = join(rootDir, "dist", "examples")
mkdirSync(distDir, { recursive: true })

// Get version from package.json
const packageJson = JSON.parse(await Bun.file(join(rootDir, "package.json")).text())
const version = packageJson.version

// Build the executable
const buildResult = await Bun.build({
  conditions: ["browser"],
  tsconfig: join(rootDir, "tsconfig.json"),
  sourcemap: "external",
  compile: {
    target: `bun-${bunPlatform}-${bunArch}` as any,
    outfile: join(distDir, "opencode-examples"),
    execArgv: [`--user-agent=opencode-examples/${version}`, `--env-file=""`, `--`],
    windows: {},
  },
  entrypoints: [join(examplesDir, "index.ts")],
  define: {
    OPENCODE_VERSION: `'${version}'`,
    OPENCODE_CHANNEL: `'dev'`,
  },
})

if (buildResult.logs.length > 0) {
  console.log("Build logs:")
  buildResult.logs.forEach((log) => {
    if (log.level === "error") {
      console.error("ERROR:", log.message)
    } else if (log.level === "warning") {
      console.warn("WARNING:", log.message)
    } else {
      console.log("INFO:", log.message)
    }
  })
}

if (buildResult.success) {
  console.log(`✅ Successfully built executable: ${join(distDir, "opencode-examples")}`)
  
  // Make it executable on Unix-like systems
  if (bunPlatform !== "windows") {
    await Bun.$`chmod +x ${join(distDir, "opencode-examples")}`
  }
  
  console.log("Run the executable with:")
  console.log(`  ${join(distDir, "opencode-examples")}`)
} else {
  console.error("❌ Build failed")
  process.exit(1)
}