#!/usr/bin/env bun

import { fileURLToPath } from "node:url"

import { defaultBenchmarkCases } from "./js-benchmark-cases.js"
import { manifestHash, runBenchmarks, type BenchmarkCase, type HarnessOptions } from "./js-benchmark-harness.js"

export const PROTOCOL: HarnessOptions = {
  protocolVersion: 1,
  measurement: {
    target_batch_ms: 200,
    warmup_batches: 5,
    measured_batches: 20,
    max_rsd_ppm: 50_000,
  },
  minBatchIterations: 1,
  maxBatchIterations: 1_000_000_000,
  maxCaseNs: 15_000_000_000,
  maxProcessNs: 75_000_000_000,
}

interface OutputWriter {
  write(data: string): unknown
  flush(): unknown
}

interface CliDependencies {
  cases?: readonly BenchmarkCase[]
  options?: HarnessOptions
  stdout: OutputWriter
  stderr: OutputWriter
  bunVersion?: string
  zigVersion?: string
}

export async function runBenchmarkCli(args: readonly string[], dependencies: CliDependencies): Promise<number> {
  const diagnostic = async (message: string) => {
    dependencies.stderr.write(`${message}\n`)
    await dependencies.stderr.flush()
  }

  if (args.length !== 1 || args[0] !== "--format=json") {
    await diagnostic("usage: bench:js --format=json")
    return 2
  }

  try {
    const options = dependencies.options ?? PROTOCOL
    const { manifest, results } = await runBenchmarks(dependencies.cases ?? defaultBenchmarkCases, options)
    const document = {
      schema_version: 1,
      benchmark_suite: "core-default",
      protocol_version: options.protocolVersion,
      bun_version: dependencies.bunVersion ?? Bun.version,
      zig_version: dependencies.zigVersion ?? readZigVersion(),
      manifest: { hash: manifestHash(manifest), ...manifest },
      results,
    }
    dependencies.stdout.write(`${JSON.stringify(document)}\n`)
    await dependencies.stdout.flush()
    return 0
  } catch (error) {
    await diagnostic(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function readZigVersion(): string {
  const process = Bun.spawnSync(["zig", "version"], {
    cwd: fileURLToPath(new URL("../zig", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
  })
  if (process.exitCode !== 0) throw new Error(`zig version failed: ${process.stderr.toString().trim()}`)
  const version = process.stdout.toString().trim()
  if (!version) throw new Error("zig version returned an empty version")
  return version
}

if (import.meta.main) {
  // Capture protocol writers before any benchmark initializes a renderer.
  const stdout = Bun.stdout.writer()
  const stderr = Bun.stderr.writer()
  process.exitCode = await runBenchmarkCli(process.argv.slice(2), { stdout, stderr })
}
