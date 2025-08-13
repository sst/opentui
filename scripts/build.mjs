import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { dirname, join, relative, resolve } from "path"
import { fileURLToPath } from "url"
import process from "process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")
const licensePath = join(rootDir, "LICENSE")
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))

const args = process.argv.slice(2)
const buildLib = args.find((arg) => arg === "--lib")
const buildNative = args.find((arg) => arg === "--native")
const isDev = args.includes("--dev") || process.env.NODE_ENV !== "production"

const variants = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "win32", arch: "x64" },
  { platform: "win32", arch: "arm64" },
]

if (!buildLib && !buildNative) {
  console.error("Error: Please specify --lib, --native, or both")
  process.exit(1)
}

const getZigTarget = (platform, arch) => {
  const platformMap = { darwin: "macos", win32: "windows", linux: "linux" }
  const archMap = { x64: "x86_64", arm64: "aarch64" }
  return `${archMap[arch] ?? arch}-${platformMap[platform] ?? platform}`
}

const replaceLinks = (text) => {
  return packageJson.homepage
    ? text.replace(
        /(\[.*?\]\()(\.\/.*?\))/g,
        (_, p1, p2) => `${p1}${packageJson.homepage}/blob/HEAD/${p2.replace("./", "")}`,
      )
    : text
}

const requiredFields = ["name", "version", "license", "repository", "description"]
const missingRequired = requiredFields.filter(field => !packageJson[field])
if (missingRequired.length > 0) {
  console.error(`Error: Missing required fields in package.json: ${missingRequired.join(", ")}`)
  process.exit(1)
}

if (buildNative) {
  console.log(`Building native ${isDev ? "dev" : "prod"} binaries...`)

  const zigBuild = spawnSync("zig", ["build", `-Doptimize=${isDev ? "Debug" : "ReleaseFast"}`], {
    cwd: join(rootDir, "src", "zig"),
    stdio: "inherit",
  })
  
  if (zigBuild.error) {
    console.error("Error: Zig is not installed or not in PATH")
    process.exit(1)
  }
  
  if (zigBuild.status !== 0) {
    console.error("Error: Zig build failed")
    process.exit(1)
  }

  for (const { platform, arch } of variants) {
    const nativeName = `${packageJson.name}-${platform}-${arch}`
    const nativeDir = join(rootDir, "node_modules", nativeName)
    const libDir = join(rootDir, "src", "zig", "lib", getZigTarget(platform, arch))

    rmSync(nativeDir, { recursive: true, force: true })
    mkdirSync(nativeDir, { recursive: true })

    for (const name of ["libopentui", "opentui"]) {
      for (const ext of [".so", ".dll", ".dylib"]) {
        const src = join(libDir, `${name}${ext}`)
        if (existsSync(src)) copyFileSync(src, join(nativeDir, `${name}${ext}`))
      }
    }

    writeFileSync(
      join(nativeDir, "package.json"),
      JSON.stringify(
        {
          name: nativeName,
          version: packageJson.version,
          description: `Prebuilt ${platform}-${arch} binaries for ${packageJson.name}`,
          license: packageJson.license,
          author: packageJson.author,
          homepage: packageJson.homepage,
          repository: packageJson.repository,
          bugs: packageJson.bugs,
          keywords: [...(packageJson.keywords ?? []), "prebuild", "prebuilt"],
          os: [platform],
          cpu: [arch],
        },
        null,
        2,
      ),
    )

    writeFileSync(
      join(nativeDir, "README.md"),
      replaceLinks(`## ${nativeName}\n\n> Prebuilt ${platform}-${arch} binaries for \`${packageJson.name}\`.`),
    )

    if (existsSync(licensePath)) copyFileSync(licensePath, join(nativeDir, "LICENSE"))
    console.log("Built:", nativeName)
  }
}

if (buildLib) {
  console.log("Building library...")

  const distDir = join(rootDir, "dist")
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })

  const externalDeps = [
    ...Object.keys(packageJson.optionalDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ]

  // Build main entry point
  spawnSync(
    "bun",
    [
      "build",
      "--target=bun",
      "--outdir=dist",
      ...externalDeps.flatMap((dep) => ["--external", dep]),
      packageJson.module,
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  )

  // Build additional entry points
  const entryPoints = ["src/3d.ts"]
  for (const entryPoint of entryPoints) {
    const entryName = entryPoint.split("/").pop().replace(".ts", "")
    spawnSync(
      "bun",
      [
        "build",
        "--target=bun",
        `--outfile=dist/${entryName}.js`,
        ...externalDeps.flatMap((dep) => ["--external", dep]),
        entryPoint,
      ],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    )
  }

  console.log("Generating TypeScript declarations...")
  
  const tsconfigBuildPath = join(rootDir, "tsconfig.build.json")
  const tsconfigBuild = {
    extends: "./tsconfig.json",
    compilerOptions: {
      declaration: true,
      emitDeclarationOnly: true,
      outDir: "./dist",
      noEmit: false,
      rootDir: "./src",
      types: ["bun", "node", "three"],
      skipLibCheck: true,
    },
    include: ["src/**/*"],
    exclude: ["**/*.test.ts", "**/*.spec.ts", "src/examples/**/*", "src/benchmark/**/*", "src/zig/**/*"]
  }
  
  writeFileSync(tsconfigBuildPath, JSON.stringify(tsconfigBuild, null, 2))
  
  const tscResult = spawnSync("npx", ["tsc", "-p", tsconfigBuildPath], {
    cwd: rootDir,
    stdio: "inherit",
  })
  
  rmSync(tsconfigBuildPath, { force: true })
  
  if (tscResult.status !== 0) {
    console.warn("Warning: TypeScript declaration generation failed")
  } else {
    console.log("TypeScript declarations generated")
  }

  // Configure exports for multiple entry points
  const exports = {
    ".": {
      import: "./index.js",
      require: "./index.js",
      types: "./index.d.ts"
    },
    "./3d": {
      import: "./3d.js",
      require: "./3d.js",
      types: "./3d.d.ts"
    }
  }

  const optionalDeps = Object.fromEntries(
    variants.map(({ platform, arch }) => [`${packageJson.name}-${platform}-${arch}`, `^${packageJson.version}`]),
  )

  writeFileSync(
    join(distDir, "package.json"),
    JSON.stringify(
      {
        name: packageJson.name,
        module: "index.js",
        main: "index.js",
        types: "index.d.ts",
        type: packageJson.type,
        version: packageJson.version,
        description: packageJson.description,
        keywords: packageJson.keywords,
        license: packageJson.license,
        author: packageJson.author,
        homepage: packageJson.homepage,
        repository: packageJson.repository,
        bugs: packageJson.bugs,
        exports,
        dependencies: packageJson.dependencies,
        optionalDependencies: {
          ...packageJson.optionalDependencies,
          ...optionalDeps,
        },
      },
      null,
      2,
    ),
  )

  writeFileSync(join(distDir, "README.md"), replaceLinks(readFileSync(join(rootDir, "README.md"), "utf8")))
  if (existsSync(licensePath)) copyFileSync(licensePath, join(distDir, "LICENSE"))

  console.log("Library built at:", distDir)
}
