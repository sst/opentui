import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

for (const reportFailure of [false, true]) {
  test.skipIf(process.env.TERMINAL_TESTS !== "1" || process.platform !== "linux")(
    `parser timeout restores the terminal${reportFailure ? " before a report-write failure" : ""}`,
    async () => {
      const directory = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "magick-cleanup-"))
      const report = reportFailure ? directory : join(directory, "report.json")
      const bench = fileURLToPath(new URL("./bench.ts", import.meta.url))
      const code = `Bun.spawnSync(["stty","cols","100","rows","32"],{stdin:"inherit"});process.argv=["bun",${JSON.stringify(bench)},"--terminal","--frames=1","--warmup=1",${JSON.stringify(`--output=${report}`)}];await import(${JSON.stringify(bench)});`
      try {
        const child = Bun.spawn(
          [
            "timeout",
            "12s",
            "script",
            "--return",
            "--quiet",
            "--command",
            `bun -e '${code.replaceAll("'", "'\\''")}'`,
            join(directory, "transcript"),
          ],
          { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
        )
        const [exitCode, output, error] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(exitCode).toBe(1)
        expect(output).toContain("\x1b[?25h")
        expect(output).toContain("\x1b[?1049l")
        if (!reportFailure) {
          const result = JSON.parse(await readFile(report, "utf8"))
          expect(result.error).toContain("Terminal parser probe timed out")
        } else expect(output + error).toContain("EISDIR")
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    15_000,
  )
}
