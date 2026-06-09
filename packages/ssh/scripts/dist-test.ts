import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const temp = mkdtempSync(join(tmpdir(), "opentui-ssh-dist-"))
let tarball: string | undefined

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout
}

try {
  for (const file of readdirSync(join(root, "dist"))) {
    if (file.startsWith("opentui-ssh-") && file.endsWith(".tgz")) unlinkSync(join(root, "dist", file))
  }
  const packed = JSON.parse(run("npm", ["pack", "--json"], join(root, "dist"))) as [{ filename: string }]
  tarball = join(root, "dist", packed[0].filename)
  const coreStub = join(temp, "core-stub")
  mkdirSync(coreStub)
  writeFileSync(
    join(coreStub, "package.json"),
    JSON.stringify({ name: "@opentui/core", version: "0.4.0", type: "module", exports: "./index.js" }),
  )
  writeFileSync(
    join(coreStub, "index.js"),
    'export const CliRenderEvents = { DESTROY: "destroy" }; export async function createCliRenderer() {}\n',
  )
  writeFileSync(
    join(temp, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "@opentui/core": "file:./core-stub", "@opentui/ssh": `file:${tarball}` },
    }),
  )
  writeFileSync(
    join(temp, "consumer.ts"),
    'import { createServer, logging, ConfigError } from "@opentui/ssh"; if (typeof createServer !== "function" || typeof logging !== "function" || typeof ConfigError !== "function") process.exit(1)\n',
  )
  run("bun", ["install"], temp)
  run("bun", ["consumer.ts"], temp)
  console.log("Packed SSH consumer smoke test passed")
} finally {
  if (tarball && existsSync(tarball)) unlinkSync(tarball)
  rmSync(temp, { recursive: true, force: true })
}
