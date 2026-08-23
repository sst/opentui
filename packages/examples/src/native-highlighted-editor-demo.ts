import {
  BoxRenderable,
  CliRenderer,
  LineNumberRenderable,
  SyntaxStyle,
  TextareaRenderable,
  TextRenderable,
  createCliRenderer,
  getTreeSitterClient,
  stringWidth,
  type ExtmarksController,
  type KeyEvent,
} from "@opentui/core"
import { NativeTreeSitterHighlighter } from "./lib/native-tree-sitter-highlighter.js"

const initialCode = `// Toggle between static extmarks and incremental Tree-sitter.
interface User {
  id: number
  name: string
}

function greet(user: User): string {
  const message = "Hello, " + user.name
  return message
}

console.log(greet({ id: 7, name: "Ada" }))`

type HighlightMode = "static" | "incremental"

let container: BoxRenderable | null = null
let editor: TextareaRenderable | null = null
let lineNumbers: LineNumberRenderable | null = null
let status: TextRenderable | null = null
let syntaxStyle: SyntaxStyle | null = null
let extmarks: ExtmarksController | null = null
let incrementalHighlighter: NativeTreeSitterHighlighter | null = null
let keyboardHandler: ((key: KeyEvent) => void) | null = null
let mode: HighlightMode = "static"
let installedRangeCount = 0

function createDemoSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: "#F0F6FC" },
    comment: { fg: "#8B949E", italic: true },
    string: { fg: "#A5D6FF" },
    keyword: { fg: "#FF7B72", bold: true },
    type: { fg: "#79C0FF" },
    function: { fg: "#D2A8FF", bold: true },
    variable: { fg: "#FFA657" },
    property: { fg: "#7EE787" },
    punctuation: { fg: "#C9D1D9" },
    operator: { fg: "#FF7B72" },
    number: { fg: "#D2A8FF" },
  })
}

function utf16IndexToDisplayOffset(text: string, index: number): number {
  const lines = text.slice(0, index).split("\n")
  return lines.reduce((offset, line) => offset + stringWidth(line), 0) + lines.length - 1
}

function addMatches(
  controller: ExtmarksController,
  text: string,
  pattern: RegExp,
  styleId: number,
  typeId: number,
  priority: number,
): number {
  let count = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    controller.create({
      start: utf16IndexToDisplayOffset(text, match.index),
      end: utf16IndexToDisplayOffset(text, match.index + match[0].length),
      styleId,
      typeId,
      priority,
      data: { token: match[0] },
    })
    count++
  }
  return count
}

function installStaticHighlights(
  target: TextareaRenderable,
  controller: ExtmarksController,
  style: SyntaxStyle,
): number {
  const text = target.plainText
  const commentType = controller.registerType("syntax.comment")
  const stringType = controller.registerType("syntax.string")
  const keywordType = controller.registerType("syntax.keyword")
  const typeType = controller.registerType("syntax.type")
  const numberType = controller.registerType("syntax.number")

  return (
    addMatches(controller, text, /\/\/[^\n]*/g, style.getStyleId("comment")!, commentType, 100) +
    addMatches(controller, text, /"(?:\\.|[^"\\])*"/g, style.getStyleId("string")!, stringType, 90) +
    addMatches(
      controller,
      text,
      /\b(?:interface|function|const|return)\b/g,
      style.getStyleId("keyword")!,
      keywordType,
      70,
    ) +
    addMatches(controller, text, /\b(?:User|string|number)\b/g, style.getStyleId("type")!, typeType, 60) +
    addMatches(controller, text, /\b\d+\b/g, style.getStyleId("number")!, numberType, 50)
  )
}

function enterStaticMode(): void {
  const target = editor
  const style = syntaxStyle
  if (!target || target.isDestroyed || !style) return

  const retiring = incrementalHighlighter
  incrementalHighlighter = null
  void retiring?.dispose()
  extmarks = target.extmarks
  installedRangeCount = installStaticHighlights(target, extmarks, style)
  mode = "static"
}

function enterIncrementalMode(renderer: CliRenderer): void {
  const target = editor
  const style = syntaxStyle
  if (!target || target.isDestroyed || !style) return

  extmarks?.destroy()
  extmarks = null
  installedRangeCount = 0
  mode = "incremental"
  incrementalHighlighter = new NativeTreeSitterHighlighter({
    editBuffer: target.editBuffer,
    syntaxStyle: style,
    client: getTreeSitterClient(),
    requestRender: () => renderer.requestRender(),
    initialContent: target.plainText,
  })
}

function toggleMode(renderer: CliRenderer): void {
  if (mode === "static") enterIncrementalMode(renderer)
  else enterStaticMode()
  renderer.requestRender()
}

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#0D1117")
  syntaxStyle = createDemoSyntaxStyle()
  mode = "static"

  container = new BoxRenderable(renderer, {
    id: "native-highlighted-editor",
    padding: 1,
    flexDirection: "column",
  })
  renderer.root.add(container)

  const editorBox = new BoxRenderable(renderer, {
    id: "native-highlighted-editor-box",
    title: "Native Static / Incremental TypeScript Highlights",
    border: true,
    borderStyle: "single",
    borderColor: "#3FB950",
    backgroundColor: "#0D1117",
    flexGrow: 1,
  })
  container.add(editorBox)

  editor = new TextareaRenderable(renderer, {
    id: "native-highlighted-editor-textarea",
    initialValue: initialCode,
    textColor: "#F0F6FC",
    cursorColor: "#3FB950",
    selectionBg: "#264F78",
    selectionFg: "#FFFFFF",
    wrapMode: "none",
    syntaxStyle,
  })
  lineNumbers = new LineNumberRenderable(renderer, {
    id: "native-highlighted-editor-lines",
    target: editor,
    minWidth: 3,
    paddingRight: 1,
    fg: "#6E7681",
    bg: "#161B22",
    width: "100%",
    height: "100%",
  })
  editorBox.add(lineNumbers)

  extmarks = editor.extmarks
  installedRangeCount = installStaticHighlights(editor, extmarks, syntaxStyle)

  const help = new TextRenderable(renderer, {
    content:
      "Ctrl+T toggles static/incremental highlighting. Edit, split, delete, undo, and redo to drive UTF-8 deltas.",
    fg: "#FFA657",
    height: 1,
  })
  status = new TextRenderable(renderer, { fg: "#A5D6FF", height: 3 })
  container.add(help)
  container.add(status)

  keyboardHandler = (key: KeyEvent): void => {
    if (key.ctrl && !key.meta && key.name === "t") {
      key.preventDefault()
      key.stopPropagation()
      toggleMode(renderer)
    }
  }
  renderer.keyInput.on("keypress", keyboardHandler)

  renderer.setFrameCallback(async () => {
    if (!editor || editor.isDestroyed || !status) return
    const cursor = editor.logicalCursor
    if (mode === "static") {
      const rangeCount = extmarks?.getAll().length ?? 0
      status.content = `mode=static | native ranges=${rangeCount}/${installedRangeCount} | parse=static | query=static\nedits incremental/reset=0/0 | changed=0B | queried=0B | highlight publications=1\nline=${cursor.row + 1} col=${cursor.col + 1}`
      return
    }

    const stats = incrementalHighlighter?.getStats()
    const rangeCount = incrementalHighlighter?.getRangeCount() ?? 0
    status.content = `mode=incremental | native ranges=${rangeCount} | parse=${stats?.parseKind ?? "pending"} | query=${stats?.queryKind ?? "pending"}\nedits incremental/reset=${stats?.incrementalCount ?? 0}/${stats?.resetCount ?? 0} | changed=${stats?.changedByteCount ?? 0}B | queried=${stats?.queriedByteCount ?? 0}B | highlight publications=${stats?.publicationCount ?? 0}\nline=${cursor.row + 1} col=${cursor.col + 1}${stats?.error ? ` | error=${stats.error}` : ""}`
  })

  editor.focus()
}

export async function destroy(renderer: CliRenderer): Promise<void> {
  renderer.clearFrameCallbacks()
  if (keyboardHandler) renderer.keyInput.off("keypress", keyboardHandler)
  keyboardHandler = null
  const retiring = incrementalHighlighter
  incrementalHighlighter = null
  await retiring?.dispose()
  extmarks?.destroy()
  extmarks = null
  container?.destroyRecursively()
  syntaxStyle?.destroy()
  container = null
  editor = null
  lineNumbers = null
  status = null
  syntaxStyle = null
  installedRangeCount = 0
  mode = "static"
}

if (import.meta.main) {
  const renderer = await createCliRenderer({ targetFps: 60, exitOnCtrlC: true })
  run(renderer)
}
