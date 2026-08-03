import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  ghosttyVtArchivePath,
  ghosttyVtHeadersSha256,
  ghosttyVtManifestTargets,
  type GhosttyVtConfig,
  type GhosttyVtTarget,
  sha256,
  validGhosttyVtTargets,
} from "../scripts/ghostty-vt-sdk"

const config: GhosttyVtConfig = {
  repository: "https://example.com/ghostty.git",
  revision: "revision",
  version: "version",
  zigVersion: "0.15.2",
  simd: false,
  symbolVisibility: "hidden",
  macosMinimumVersion: "13.0.0",
  patchRevision: 1,
}

const targets: GhosttyVtTarget[] = [
  { zig: "aarch64-macos.13.0", output: "aarch64-macos", archive: "libghostty-vt.a" },
  { zig: "x86_64-linux-gnu.2.17", output: "x86_64-linux", archive: "libghostty-vt.a" },
]

let testRoot: string | undefined

afterEach(() => {
  if (testRoot) rmSync(testRoot, { recursive: true, force: true })
  testRoot = undefined
})

describe("Ghostty VT SDK cache", () => {
  test("does not trust or re-record an archive whose checksum changed", () => {
    testRoot = mkdtempSync(join(tmpdir(), "opentui-ghostty-vt-sdk-"))
    mkdirSync(join(testRoot, "include", "ghostty"), { recursive: true })
    writeFileSync(join(testRoot, "include", "ghostty", "vt.h"), "header")

    for (const target of targets) {
      const archive = ghosttyVtArchivePath(testRoot, target)
      mkdirSync(dirname(archive), { recursive: true })
      writeFileSync(archive, target.output)
    }

    writeFileSync(
      join(testRoot, "manifest.json"),
      JSON.stringify({
        ...config,
        headersSha256: ghosttyVtHeadersSha256(testRoot),
        targets: Object.fromEntries(
          targets.map((target) => [
            target.output,
            {
              archive: target.archive,
              sha256: sha256(ghosttyVtArchivePath(testRoot!, target)),
              zig: target.zig,
            },
          ]),
        ),
      }),
    )

    writeFileSync(ghosttyVtArchivePath(testRoot, targets[0]), "changed archive")

    const validTargets = validGhosttyVtTargets(testRoot, config, targets)
    expect(validTargets).toEqual(new Set([targets[1].output]))
    expect(ghosttyVtManifestTargets(testRoot, targets, validTargets)).toEqual({
      [targets[1].output]: {
        archive: targets[1].archive,
        sha256: sha256(ghosttyVtArchivePath(testRoot, targets[1])),
        zig: targets[1].zig,
      },
    })
  })
})
