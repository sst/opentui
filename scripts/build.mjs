import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { dirname, join, relative, resolve } from "path"
import { fileURLToPath } from "url"
import process from "process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")
const licensePath = join(rootDir, "LICENSE.md")
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))

const args = process.argv.slice(2)
const buildLib = args.find((arg) => arg === "--lib")
const buildNative = args.find((arg) => arg === "--native")
const isDev = Boolean(args.find((arg) => arg === "--dev")) ?? process.env.NODE_ENV !== "production"

const variants = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "win32", arch: "x64" },
  { platform: "win32", arch: "arm64" },
]

if ([buildLib, buildNative].filter(Boolean).length < 1) process.exit(1)

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

if (buildNative) {
  console.log(`Building native ${isDev ? "dev" : "prod"} binaries...`)

  spawnSync("zig", ["build", `-Doptimize=${isDev ? "Debug" : "ReleaseFast"}`], {
    cwd: join(rootDir, "src", "zig"),
    stdio: "inherit",
  })

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

    if (existsSync(licensePath)) copyFileSync(licensePath, join(nativeDir, "LICENSE.md"))
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

  let exports = packageJson.exports
  try {
    exports = JSON.parse(JSON.stringify(exports).replaceAll(`${relative(rootDir, distDir)}/`, ""))
  } catch {}

  const optionalDeps = Object.fromEntries(
    variants.map(({ platform, arch }) => [`${packageJson.name}-${platform}-${arch}`, `^${packageJson.version}`]),
  )

  writeFileSync(
    join(distDir, "package.json"),
    JSON.stringify(
      {
        name: packageJson.name,
        module: "index.js",
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
  if (existsSync(licensePath)) copyFileSync(licensePath, join(distDir, "LICENSE.md"))

  console.log("Library built at:", distDir)
}
