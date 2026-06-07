import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { expect, spyOn, test } from "bun:test"
import { utils } from "ssh2"
import { createServer } from "../../index.js"
import { createHarness, HOST_KEY } from "../support.js"

const { track, tmpDir } = createHarness()

test("generates and persists a missing host key with 0600 permissions", async () => {
  const path = join(tmpDir(), "host_key")
  expect(existsSync(path)).toBe(false)
  const s = track(createServer({ hostKey: { path }, auth: "open", startupBanner: false }).serve(() => {}))
  await s.listen(0)
  expect(existsSync(path)).toBe(true)
  // 0600 is a Unix-only guarantee. Windows has no POSIX mode bits — it reports 0666
  // for any writable file regardless of chmod — so the perms assertion can't hold there.
  if (process.platform !== "win32") {
    expect(statSync(path).mode & 0o777).toBe(0o600)
  }
})

test("reuses the same host key (stable fingerprint) across restarts", async () => {
  const path = join(tmpDir(), "host_key")
  const a = track(createServer({ hostKey: { path }, auth: "open", startupBanner: false }).serve(() => {}))
  const infoA = await a.listen(0)
  const b = track(createServer({ hostKey: { path }, auth: "open", startupBanner: false }).serve(() => {}))
  const infoB = await b.listen(0)
  expect(infoB.fingerprint).toBe(infoA.fingerprint)
})

test("generated host keys are validated before persisting and retried", () => {
  const path = join(tmpDir(), "host_key")
  let calls = 0
  const spy = spyOn(utils, "generateKeyPairSync").mockImplementation(() => {
    calls++
    return { private: calls === 1 ? "not a key" : HOST_KEY, public: "" } as never
  })
  try {
    track(createServer({ hostKey: { path }, auth: "open", startupBanner: false }).serve(() => {}))
    expect(calls).toBe(2)
    expect(readFileSync(path, "utf8")).toBe(HOST_KEY)
  } finally {
    spy.mockRestore()
  }
})
