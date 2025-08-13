import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")
const packedDir = join(rootDir, "packed")

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))

const args = process.argv.slice(2)
const skipBuild = args.includes("--skip-build")
const verbose = args.includes("--verbose")

if (!skipBuild) {
  console.log("Building packages first...")
  const buildResult = spawnSync("bun", ["run", "build"], {
    cwd: rootDir,
    stdio: "inherit",
  })
  
  if (buildResult.status !== 0) {
    console.error("Error: Build failed")
    process.exit(1)
  }
}

const libDir = join(rootDir, "dist")
if (!existsSync(libDir)) {
  console.error("Error: dist directory not found. Please run 'bun run build' first.")
  process.exit(1)
}

rmSync(packedDir, { recursive: true, force: true })
mkdirSync(packedDir, { recursive: true })

const packagesToPack = []
const libPackageJson = JSON.parse(readFileSync(join(libDir, "package.json"), "utf8"))

packagesToPack.push({
  name: libPackageJson.name,
  dir: libDir,
  type: "library"
})

for (const pkgName of Object.keys(libPackageJson.optionalDependencies || {}).filter((x) =>
  x.startsWith(packageJson.name),
)) {
  const nativeDir = join(rootDir, "node_modules", pkgName)
  if (existsSync(nativeDir)) {
    packagesToPack.push({
      name: pkgName,
      dir: nativeDir,
      type: "native"
    })
  } else {
    console.warn(`Warning: Native package directory not found: ${nativeDir}`)
  }
}

console.log(`\nPacking ${packagesToPack.length} packages...\n`)

const packedFiles = []
const errors = []

for (const pkg of packagesToPack) {
  try {
    console.log(`Packing ${pkg.name} (${pkg.type})...`)
    
    const packResult = spawnSync("npm", ["pack", "--pack-destination", packedDir], {
      cwd: pkg.dir,
      stdio: verbose ? "inherit" : "pipe"
    })
    
    if (packResult.status !== 0) {
      const error = packResult.stderr?.toString() || "Unknown error"
      errors.push({ package: pkg.name, error })
      console.error(`    Failed to pack ${pkg.name}`)
      if (!verbose) {
        console.error(`     ${error.trim()}`)
      }
      continue
    }
    
    const output = packResult.stdout?.toString().trim()
    const packedFile = output.split('\n').pop()
    const fullPath = join(packedDir, packedFile)
    
    if (existsSync(fullPath)) {
      const stats = statSync(fullPath)
      const sizeKB = (stats.size / 1024).toFixed(2)
      
      packedFiles.push({
        name: pkg.name,
        type: pkg.type,
        file: packedFile,
        path: fullPath,
        size: stats.size,
        sizeKB
      })
      
      console.log(`  ✓ Packed: ${packedFile} (${sizeKB} KB)`)
      
      if (verbose) {
        const listResult = spawnSync("tar", ["-tzf", fullPath], {
          cwd: packedDir
        })
        if (listResult.status === 0) {
          const files = listResult.stdout.toString().trim().split('\n')
          console.log(`    Files: ${files.length} files`)
          if (files.length <= 20) {
            files.forEach(f => console.log(`      - ${f}`))
          } else {
            files.slice(0, 10).forEach(f => console.log(`      - ${f}`))
            console.log(`      ... and ${files.length - 10} more files`)
          }
        }
      }
    } else {
      errors.push({ package: pkg.name, error: "Packed file not found" })
      console.error(`    Packed file not found for ${pkg.name}`)
    }
  } catch (error) {
    errors.push({ package: pkg.name, error: error.message })
    console.error(`    Error packing ${pkg.name}: ${error.message}`)
  }
}

console.log("\n" + "=".repeat(60))
console.log("PACKING SUMMARY")
console.log("=".repeat(60))

if (packedFiles.length > 0) {
  console.log(`\n✓ Successfully packed ${packedFiles.length} packages:`)
  
  const library = packedFiles.filter(p => p.type === "library")
  const native = packedFiles.filter(p => p.type === "native")
  
  if (library.length > 0) {
    console.log("\n  Library:")
    library.forEach(p => {
      console.log(`    - ${p.file} (${p.sizeKB} KB)`)
    })
  }
  
  if (native.length > 0) {
    console.log("\n  Native binaries:")
    native.forEach(p => {
      console.log(`    - ${p.file} (${p.sizeKB} KB)`)
    })
  }
  
  const totalSize = packedFiles.reduce((sum, p) => sum + p.size, 0)
  const totalSizeKB = (totalSize / 1024).toFixed(2)
  console.log(`\n  Total size: ${totalSizeKB} KB`)
}

if (errors.length > 0) {
  console.log(`\n  Failed to pack ${errors.length} packages:`)
  errors.forEach(e => {
    console.log(`  - ${e.package}: ${e.error}`)
  })
}

if (packedFiles.length > 0) {
  console.log(`\nPacked files saved to: ${packedDir}`)
  console.log("\nYou can inspect the packed files with:")
  console.log("  tar -tzf packed/<filename>.tgz    # List contents")
  console.log("  tar -xzf packed/<filename>.tgz    # Extract contents")
  console.log("\nTo publish these packages, run:")
  console.log("  bun run publish")
}

if (errors.length > 0) {
  process.exit(1)
}
