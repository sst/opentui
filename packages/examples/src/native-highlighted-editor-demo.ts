import {
  BoxRenderable,
  CliRenderer,
  LineNumberRenderable,
  SyntaxStyle,
  TextareaRenderable,
  TextRenderable,
  createCliRenderer,
  stringWidth,
  type ExtmarksController,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const initialCode = `// These highlights are native extmarks created exactly once.
interface User {
  id: number
  name: string
}

function greet(user: User): string {
  const message = "Hello, " + user.name
  return message
}

console.log(greet({ id: 7, name: "Ada" }))`

let container: BoxRenderable | null = null
let editor: TextareaRenderable | null = null
let lineNumbers: LineNumberRenderable | null = null
let status: TextRenderable | null = null
let syntaxStyle: SyntaxStyle | null = null
let extmarks: ExtmarksController | null = null
let installedRangeCount = 0

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

function installHighlightsOnce(target: TextareaRenderable, controller: ExtmarksController, style: SyntaxStyle): number {
  const text = target.plainText
  const commentType = controller.registerType("syntax.comment")
  const stringType = controller.registerType("syntax.string")
  const keywordType = controller.registerType("syntax.keyword")
  const typeType = controller.registerType("syntax.type")
  const numberType = controller.registerType("syntax.number")

  const comment = style.registerStyle("demo.comment", { fg: "#8B949E", italic: true })
  const string = style.registerStyle("demo.string", { fg: "#A5D6FF" })
  const keyword = style.registerStyle("demo.keyword", { fg: "#FF7B72", bold: true })
  const type = style.registerStyle("demo.type", { fg: "#79C0FF" })
  const number = style.registerStyle("demo.number", { fg: "#D2A8FF" })

  return (
    addMatches(controller, text, /\/\/[^\n]*/g, comment, commentType, 100) +
    addMatches(controller, text, /"(?:\\.|[^"\\])*"/g, string, stringType, 90) +
    addMatches(controller, text, /\b(?:interface|function|const|return)\b/g, keyword, keywordType, 70) +
    addMatches(controller, text, /\b(?:User|string|number)\b/g, type, typeType, 60) +
    addMatches(controller, text, /\b\d+\b/g, number, numberType, 50)
  )
}

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#0D1117")
  syntaxStyle = SyntaxStyle.create()

  container = new BoxRenderable(renderer, {
    id: "native-highlighted-editor",
    padding: 1,
    flexDirection: "column",
  })
  renderer.root.add(container)

  const editorBox = new BoxRenderable(renderer, {
    id: "native-highlighted-editor-box",
    title: "Native Edit-Following Code Highlights",
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
  installedRangeCount = installHighlightsOnce(editor, extmarks, syntaxStyle)

  const help = new TextRenderable(renderer, {
    content: "Highlights are created once. Edit, split lines, delete, and undo; native ranges follow.",
    fg: "#FFA657",
    height: 1,
  })
  status = new TextRenderable(renderer, { fg: "#A5D6FF", height: 1 })
  container.add(help)
  container.add(status)

  renderer.setFrameCallback(() => {
    if (!editor || editor.isDestroyed || !extmarks || !status) return
    const cursor = editor.logicalCursor
    const offset = editor.cursorOffset
    const current = extmarks.getAtOffset(offset)
    status.content = `Native ranges: ${extmarks.getAll().length}/${installedRangeCount} | highlight passes: 1 | line ${cursor.row + 1}, col ${cursor.col + 1} | inside: ${current.length}`
  })

  editor.focus()
}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()
  extmarks?.destroy()
  syntaxStyle?.destroy()
  container?.destroyRecursively()
  container = null
  editor = null
  lineNumbers = null
  status = null
  syntaxStyle = null
  extmarks = null
  installedRangeCount = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({ targetFps: 60, exitOnCtrlC: true })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
