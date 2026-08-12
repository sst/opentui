import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const coreDir = resolve(rootDir, "../core")
const distDir = join(rootDir, "dist")

if (!process.argv.includes("--skip-build")) run("bun", ["run", "build"], rootDir)

const manifest = JSON.parse(readFileSync(join(distDir, "package.json"), "utf8")) as {
  name?: string
  engines?: { bun?: string }
  dependencies?: Record<string, string>
  exports?: Record<string, unknown>
}
if (manifest.name !== "@opentui/mermaid") throw new Error("built package name is incorrect")
if (manifest.engines?.bun !== ">=1.3.0") throw new Error("built package dropped its Bun engine requirement")
if (!manifest.exports?.["."]) throw new Error("built package has no root export")
if (!manifest.exports?.["./package.json"]) throw new Error("built package has no package.json export")
if (!manifest.dependencies?.["@opentui/core"]?.match(/^\d+\.\d+\.\d+/)) {
  throw new Error("built package did not resolve its @opentui/core workspace version")
}

const temporaryDir = mkdtempSync(join(tmpdir(), "opentui-mermaid-dist-"))
try {
  assertDeclarationImportsResolve(distDir)
  const consumerDependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([name]) => name !== "@opentui/core"),
  )
  writeFileSync(
    join(temporaryDir, "package.json"),
    `${JSON.stringify({ private: true, type: "module", dependencies: consumerDependencies }, null, 2)}\n`,
  )
  run("bun", ["install", "--ignore-scripts"], temporaryDir)

  const scopeDir = join(temporaryDir, "node_modules", "@opentui")
  mkdirSync(scopeDir, { recursive: true })
  cpSync(distDir, join(scopeDir, "mermaid"), { recursive: true })
  cpSync(join(coreDir, "dist"), join(scopeDir, "core"), { recursive: true })

  const nativePackagesDir = join(coreDir, "node_modules", "@opentui")
  for (const entry of readdirSync(nativePackagesDir)) {
    if (!entry.startsWith("core-")) continue
    cpSync(join(nativePackagesDir, entry), join(scopeDir, entry), { recursive: true })
  }

  const consumerPath = join(temporaryDir, "consumer.ts")
  writeFileSync(
    consumerPath,
    `import {
  detectMermaidDiagram,
  renderFlowchartDiagram,
  renderSequenceDiagram,
  renderStateDiagram,
  renderTimelineDiagram,
  type FlowchartDiagram,
  type SequenceDiagram,
  type StateDiagram,
  type TimelineDiagram,
} from "@opentui/mermaid"

const sources = [
  ["flowchart", "flowchart LR\\n  A --> B", renderFlowchartDiagram],
  ["sequence", "sequenceDiagram\\n  A->>B: hello", renderSequenceDiagram],
  ["state", "stateDiagram-v2\\n  A --> B", renderStateDiagram],
  ["timeline", "timeline\\n  2026 : shipped", renderTimelineDiagram],
] as const

for (const [kind, source, render] of sources) {
  if (detectMermaidDiagram(source) !== kind) throw new Error(\`failed to detect \${kind}\`)
  if (!render(source).trim()) throw new Error(\`failed to render \${kind}\`)
}

const typecheck: FlowchartDiagram | SequenceDiagram | StateDiagram | TimelineDiagram | undefined = undefined
void typecheck
console.log("@opentui/mermaid dist consumer passed")
`,
  )

  const typeScriptCli = join(rootDir, "node_modules", "typescript", "bin", "tsc")
  run(
    process.execPath,
    [
      typeScriptCli,
      "--noEmit",
      "--skipLibCheck",
      "--target",
      "ESNext",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      consumerPath,
    ],
    temporaryDir,
  )
  run(process.execPath, [consumerPath], temporaryDir)
} finally {
  rmSync(temporaryDir, { recursive: true, force: true })
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`)
}

function assertDeclarationImportsResolve(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      assertDeclarationImportsResolve(path)
      continue
    }
    if (!entry.name.endsWith(".d.ts")) continue
    const source = readFileSync(path, "utf8")
    for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      const specifier = match[1]!
      const target = resolve(dirname(path), extname(specifier) === ".js" ? `${specifier.slice(0, -3)}.d.ts` : specifier)
      if (!existsSync(target)) throw new Error(`${path} references missing declaration ${specifier}`)
    }
  }
}
