import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "../../lib/RGBA.js"
import { TreeSitterClient } from "../../lib/tree-sitter/index.js"
import { CliRenderer } from "../../renderer.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { createTestStdin, TestWriteStream } from "../../testing/test-streams.js"
import { CodeRenderable } from "../Code.js"
import { MarkdownRenderable } from "../Markdown.js"

class CapturedStdout extends TestWriteStream {
  readonly writes: Buffer[] = []
  override _write(chunk: Uint8Array, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(Buffer.from(chunk))
    callback()
  }
}

interface LinkSegment {
  text: string
  row: number
  id: string
  url: string
}
function linkSegments(bytes: Buffer): LinkSegment[] {
  const input = bytes.toString("utf8")
  const result: Array<LinkSegment & { endColumn: number }> = []
  let row = 1
  let column = 1
  let id = ""
  let url = ""

  for (let offset = 0; offset < input.length; ) {
    if (input.startsWith("\x1b]8;", offset)) {
      const end = input.indexOf("\x1b\\", offset)
      const payload = input.slice(offset + 4, end)
      const separator = payload.indexOf(";")
      const params = separator < 0 ? payload : payload.slice(0, separator)
      const target = separator < 0 ? "" : payload.slice(separator + 1)
      id = params.startsWith("id=") ? params.slice(3) : ""
      url = target
      offset = end + 2
      continue
    }
    if (input.startsWith("\x1b[", offset)) {
      const match = /^\x1b\[([0-9;?]*)([A-Za-z])/u.exec(input.slice(offset))
      if (!match) {
        offset++
        continue
      }
      const values = match[1].split(";").map((value) => Number(value || 1))
      if (match[2] === "H" || match[2] === "f") [row, column] = [values[0] ?? 1, values[1] ?? 1]
      if (match[2] === "A") row -= values[0] ?? 1
      if (match[2] === "B") row += values[0] ?? 1
      if (match[2] === "C") column += values[0] ?? 1
      if (match[2] === "D") column -= values[0] ?? 1
      if (match[2] === "G") column = values[0] ?? 1
      offset += match[0].length
      continue
    }
    const char = String.fromCodePoint(input.codePointAt(offset)!)
    if (url && char >= " ") {
      const previous = result.at(-1)
      if (
        previous &&
        previous.row === row &&
        previous.endColumn === column &&
        previous.id === id &&
        previous.url === url
      ) {
        previous.text += char
        previous.endColumn++
      } else result.push({ text: char, row, id, url, endColumn: column + 1 })
    }
    if (char >= " ") column++
    offset += char.length
  }
  return result.map(({ endColumn, ...segment }) => segment)
}
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromInts(255, 255, 255, 255) } })
let treeSitterClient: TreeSitterClient
let renderer: CliRenderer | undefined
beforeAll(async () => {
  const dataPath = join(tmpdir(), "tree-sitter-markdown-link-test-data")
  await mkdir(dataPath, { recursive: true })
  treeSitterClient = new TreeSitterClient({ dataPath })
  await treeSitterClient.initialize()
})
afterEach(() => renderer?.destroy())
afterAll(() => treeSitterClient.destroy())
async function render(content: string, width = 160, hyperlinks = true) {
  const stdout = new CapturedStdout(width, 30) as CapturedStdout & NodeJS.WriteStream
  renderer = new CliRenderer(createTestStdin(), stdout, width, 30, { useThread: false, remote: true })
  if (hyperlinks) (renderer as any).lib.processCapabilityResponse(renderer.rendererPtr, "\x1bP>|kitty(0.40.1)\x1b\\")
  const markdown = new MarkdownRenderable(renderer, {
    content,
    syntaxStyle,
    treeSitterClient,
    tableOptions: { widthMode: "content", wrapMode: "char" },
  })
  renderer.root.add(markdown)

  for (let attempt = 0; attempt < 20; attempt++) {
    await (renderer as any).loop()
    const pending = markdown
      .getChildren()
      .filter((child): child is CodeRenderable => child instanceof CodeRenderable && child.isHighlighting)
    if (pending.length === 0) break
    await Promise.all(pending.map((child) => child.highlightingDone))
  }
  await (renderer as any).loop()
  await (renderer as any)._feed.idle()
  await new Promise<void>((resolve) => setImmediate(resolve))
  const bytes = Buffer.concat(stdout.writes)
  return { bytes, links: linkSegments(bytes) }
}
const linked = (text: string, url: string) => ({
  text,
  row: expect.any(Number),
  id: expect.stringMatching(/^.+$/),
  url,
})
test("renders readable Markdown without OSC 8 when hyperlinks are unsupported", async () => {
  const rendered = await render("[label](https://example.com) HTTPS://BARE.EXAMPLE", 160, false)
  expect(rendered.links).toEqual([])
  expect(rendered.bytes.includes(Buffer.from("label"))).toBe(true)
  expect(rendered.bytes.includes(Buffer.from("\x1b]8;"))).toBe(false)
})
test("emits exact non-empty targets for labels, entities, bare URLs, and exclusion adjacency", async () => {
  const rendered = await render(
    "[a&amp;b](https://example.test/?a=1&amp;b=2) HTTPS://EXAMPLE.COM, https://safe.test`https://code.test`",
  )
  expect(rendered.links).toContainEqual(linked("a&b", "https://example.test/?a=1&b=2"))
  expect(rendered.links).toContainEqual(linked("HTTPS://EXAMPLE.COM", "HTTPS://EXAMPLE.COM"))
  expect(rendered.links).toContainEqual(linked("https://safe.test", "https://safe.test"))
  expect(rendered.links.some((link) => link.url.includes("code.test"))).toBe(false)
})
test("preserves one non-empty id across wrapped prose and table links", async () => {
  const url = "HTTPS://EXAMPLE.COM/A/VERY/LONG/PATH"
  const rendered = await render(`${url}\n\n| URL |\n| --- |\n| ${url} |`, 18)
  const ids = new Set(rendered.links.filter((link) => link.url === url).map((link) => link.id))
  expect(rendered.links.filter((link) => link.url === url).length).toBeGreaterThan(2)
  expect(ids).toEqual(new Set([expect.stringMatching(/^.+$/)]))
})

test("rejects table and image controls before native OSC or control output", async () => {
  const attack = "https://safe.test/\x07\x1b]8;;https://evil.test"
  const encoded = "https://safe.test/&#7;&#27;]8;;https://evil.test"
  const rendered = await render(`| links |\n| --- |\n| ${attack} |\n| ![image](${encoded}) |`)
  expect(rendered.links.some((link) => link.url.includes("evil.test"))).toBe(false)
  expect(rendered.bytes.includes(Buffer.from(attack))).toBe(false)
  expect(rendered.bytes.includes(Buffer.from("\x1b]8;;https://evil.test"))).toBe(false)
})

test("keeps concealed entity replacement cells linked", async () => {
  const rendered = await render("[a&amp;b](https://x.test)")
  expect(rendered.links).toContainEqual(linked("a&b", "https://x.test"))
})

test("preserves literal ampersands in link targets", async () => {
  const rendered = await render(
    "[escaped](https://x.test/?q=\\&copy;) https://x.test/?a=1&copy [entity](https://x.test/?a=1&amp;b=2)",
  )
  expect(rendered.links).toContainEqual(linked("escaped", "https://x.test/?q=&copy;"))
  expect(rendered.links).toContainEqual(linked("https://x.test/?a=1&copy", "https://x.test/?a=1&copy"))
  expect(rendered.links).toContainEqual(linked("entity", "https://x.test/?a=1&b=2"))
})

test("links a normal label after an escaped image marker", async () => {
  const rendered = await render("\\![label](https://x.test)")
  expect(rendered.links).toContainEqual(linked("label", "https://x.test"))
})
