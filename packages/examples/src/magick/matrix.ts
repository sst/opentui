import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

interface Case {
  name: string
  terminal: "offscreen" | "ghostty" | "kitty" | "wezterm"
  args: string[]
}

const { values } = parseArgs({
  options: {
    cases: { type: "string" },
    output: { type: "string", default: "experiments/magick/results/matrix" },
    timeout: { type: "string", default: "60" },
    "window-size": { type: "string" },
  },
})
if (!values.cases) throw new Error("Use --cases=<JSON array of {name,terminal,args}>")
const cases: Case[] = await Bun.file(values.cases).json()
if (!Array.isArray(cases) || cases.length === 0 || cases.length > 500) throw new Error("Expected 1-500 benchmark cases")
const names = new Set<string>()
for (const item of cases) {
  if (!/^[a-z0-9-]+$/.test(item.name) || names.has(item.name))
    throw new Error("Case names must be unique lowercase identifiers")
  if (!["offscreen", "ghostty", "kitty", "wezterm"].includes(item.terminal))
    throw new Error(`Unknown terminal: ${item.terminal}`)
  if (
    !Array.isArray(item.args) ||
    item.args.some(
      (arg) =>
        typeof arg !== "string" || /^--(output|run-id|window-class|window-size|terminal($|=)|terminal-pid)/.test(arg),
    )
  )
    throw new Error("Cases may not override runner output or terminal ownership")
  names.add(item.name)
}
const timeoutMs = Number(values.timeout) * 1000
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) throw new Error("Invalid --timeout")
const output = resolve(values.output!)
await mkdir(output, { recursive: true })
const bench = join(dirname(fileURLToPath(import.meta.url)), "bench.ts")
const terminals = {
  ghostty: [
    "ghostty",
    "--gtk-single-instance=false",
    "--config-default-files=false",
    "--font-size=6",
    "--window-width=120",
    "--window-height=40",
    "--title=magick-benchmark",
    "-e",
  ],
  kitty: [
    "kitty",
    "--config",
    "NONE",
    "-o",
    "font_size=6",
    "-o",
    "initial_window_width=120c",
    "-o",
    "initial_window_height=40c",
    "-o",
    "confirm_os_window_close=0",
    "--title=magick-benchmark",
  ],
  wezterm: [
    "wezterm-gui",
    "--skip-config",
    "--config",
    "enable_wayland=false",
    "--config",
    "font_size=12",
    "--config",
    "initial_cols=120",
    "--config",
    "initial_rows=40",
    "start",
    "--always-new-process",
    "--cwd",
    process.cwd(),
    "--",
  ],
}
const records: Record<string, unknown>[] = []
const checksums = new Map<string, string>()
for (const item of cases) {
  const report = join(output, `${item.name}.json`)
  const runId = randomUUID()
  const args = [bench, ...item.args, `--output=${report}`, `--run-id=${runId}`]
  const windowClass = `org.opentui.magick.b${runId.replaceAll("-", "")}`
  const prefix = item.terminal === "offscreen" ? [] : [...terminals[item.terminal]]
  if (values["window-size"] && item.terminal !== "offscreen") {
    args.push(`--window-class=${windowClass}`, `--window-size=${values["window-size"]}`)
    const end = item.terminal === "kitty" ? prefix.length : prefix.length - 1
    prefix.splice(end, 0, `--class=${windowClass}`)
  }
  const command =
    item.terminal === "offscreen"
      ? ["bun", ...args]
      : [...prefix, "sh", "-c", 'exec bun "$0" --terminal --terminal-pid="$PPID" "$@"', ...args]
  process.stderr.write(`Running ${item.name}\n`)
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "ignore",
    stderr: Bun.file(join(output, `${item.name}.log`)),
  })
  let timedOut = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
    killTimer = setTimeout(() => child.kill("SIGKILL"), 5000)
  }, timeoutMs)
  const exitCode = await child.exited
  clearTimeout(timer)
  clearTimeout(killTimer)
  let data: Record<string, any> = {}
  try {
    data = await Bun.file(report).json()
  } catch {
    data.error = "Benchmark report missing or invalid"
  }
  if (data.settings?.["run-id"] !== runId) data.error = "No report from this invocation"
  if (data.settings?.["validate-output"] && data.validation?.acknowledged !== true) {
    data.error ??= "No terminal image acknowledgement"
  }
  if (!data.error) {
    const key = JSON.stringify([
      data.settings.width,
      data.settings.height,
      data.settings.particles,
      data.settings.noise,
    ])
    const expected = checksums.get(key)
    if (expected && data.firstFrameSha256 !== expected)
      data.error = "GPU image pixels differ from the first case with this workload"
    else checksums.set(key, data.firstFrameSha256)
  }
  const record = {
    name: item.name,
    terminal: item.terminal,
    exitCode,
    timedOut,
    error: data.error ?? null,
    total: data.summary?.totalMs,
    prepare: data.summary?.prepareMs,
    throughput: data.throughput,
    geometry: data.geometry,
    window: data.window,
    firstFrameSha256: data.firstFrameSha256,
    revision: data.revision,
    librarySha256: data.librarySha256,
    transport: data.transportAtEnd,
    fileFraction: data.summary?.file?.mean,
    zlibFraction: data.summary?.zlib?.mean,
    validation: data.validation,
  }
  records.push(record)
  await Bun.write(join(output, "index.json"), JSON.stringify(records, null, 2) + "\n")
  if (timedOut || exitCode !== 0 || data.error) {
    process.stderr.write(`FAILED ${item.name}: ${data.error ?? exitCode}\n`)
    process.exitCode = 1
  } else if (data.validation) process.stderr.write(`${item.name}: image acknowledgement checked\n`)
  else process.stderr.write(`${item.name}: P95 ${data.summary.totalMs.p95.toFixed(3)} ms\n`)
}
