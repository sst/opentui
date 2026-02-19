import {
  BoxRenderable,
  CliRenderer,
  SimpleTableRenderable,
  TextRenderable,
  bold,
  createCliRenderer,
  fg,
  green,
  red,
  t,
  type BorderStyle,
  type KeyEvent,
  yellow,
} from "../index"
import type { SimpleTableContent } from "../renderables/SimpleTable"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let container: BoxRenderable | null = null
let primaryTable: SimpleTableRenderable | null = null
let unicodeTable: SimpleTableRenderable | null = null
let controlsText: TextRenderable | null = null
let keyboardHandler: ((key: KeyEvent) => void) | null = null

let contentIndex = 0
let wrapIndex = 1
let borderIndex = 0

const WRAP_MODES: Array<"none" | "word" | "char"> = ["none", "word", "char"]
const BORDER_STYLES: BorderStyle[] = ["single", "rounded", "double", "heavy"]

const primaryContentSets: SimpleTableContent[] = [
  [
    [[bold("Service")], [bold("Status")], [bold("Notes")]],
    ["api", [green("OK")], t`${fg("#94a3b8")("latency")} 28ms`],
    ["worker", [yellow("DEGRADED")], "queue depth: 124"],
    ["billing", [red("ERROR")], "retrying payment provider"],
  ],
  [
    [[bold("Region")], [bold("Requests")], [bold("Trend")]],
    ["us-east-1", "1.2M", [green("+12.4%")]],
    ["eu-west-1", "890K", [green("+5.1%")]],
    ["ap-south-1", "540K", [red("-2.0%")]],
  ],
  [
    [[bold("Task")], [bold("Owner")], [bold("ETA")]],
    ["Wrap regression", "core", [green("done")]],
    ["Unicode layout", "render", "in review"],
    ["Snapshot pass", "qa", "today"],
  ],
]

const unicodeContentSets: SimpleTableContent[] = [
  [
    [[bold("Locale")], [bold("Sample")]],
    ["ja-JP", "東京の夜景と絵文字 🌃✨"],
    ["zh-CN", "你好世界，布局检查中 🚀"],
    ["ko-KR", "한글과 이모지 조합 테스트 😄"],
  ],
  [
    [[bold("Expression")], [bold("Meaning")]],
    ["山川异域", "Different lands, shared sky 🌏"],
    ["꽃길만 걷자", "Walk only flower paths 🌸"],
    ["加油", "Keep pushing forward 💪"],
  ],
  [
    [[bold("Column")], [bold("Wrapped Text")]],
    ["mixed", "CJK and emoji wrapping: こんにちは世界 🌍 followed by long english text for width checks"],
    ["emoji", "Faces 😀😃😄😁😆 and symbols 🧪📦🛰️ across constrained columns"],
  ],
]

function currentWrapMode(): "none" | "word" | "char" {
  return WRAP_MODES[wrapIndex] ?? "word"
}

function currentBorderStyle(): BorderStyle {
  return BORDER_STYLES[borderIndex] ?? "single"
}

function updateControlsText(): void {
  if (!controlsText) return

  controlsText.content = t`${bold("SimpleTable Demo")}  ${fg("#94a3b8")("1/2/3 dataset • W wrap • B border")}
Current: dataset ${fg("#7dd3fc")(String(contentIndex + 1))} | wrap ${fg("#a5b4fc")(currentWrapMode())} | border ${fg("#f9a8d4")(currentBorderStyle())}`
}

function applyTableState(): void {
  if (!primaryTable || !unicodeTable) return

  primaryTable.content = primaryContentSets[contentIndex] ?? primaryContentSets[0]
  unicodeTable.content = unicodeContentSets[contentIndex] ?? unicodeContentSets[0]

  primaryTable.wrapMode = currentWrapMode()
  unicodeTable.wrapMode = currentWrapMode()

  primaryTable.borderStyle = currentBorderStyle()
  unicodeTable.borderStyle = currentBorderStyle()

  updateControlsText()
}

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor("#0b1020")

  container = new BoxRenderable(renderer, {
    id: "simple-table-demo-container",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
    backgroundColor: "#0b1020",
  })
  renderer.root.add(container)

  controlsText = new TextRenderable(renderer, {
    id: "simple-table-demo-controls",
    content: "",
    fg: "#e2e8f0",
    wrapMode: "none",
  })

  const primaryLabel = new TextRenderable(renderer, {
    id: "simple-table-demo-primary-label",
    content: t`${bold("Operational Table")}`,
    fg: "#cbd5e1",
  })

  primaryTable = new SimpleTableRenderable(renderer, {
    id: "simple-table-demo-primary",
    width: "100%",
    wrapMode: currentWrapMode(),
    borderStyle: currentBorderStyle(),
    borderColor: "#7aa2f7",
    fg: "#e2e8f0",
    bg: "transparent",
    content: primaryContentSets[contentIndex] ?? primaryContentSets[0],
  })

  const unicodeLabel = new TextRenderable(renderer, {
    id: "simple-table-demo-unicode-label",
    content: t`${bold("Unicode/CJK/Emoji Table")}`,
    fg: "#cbd5e1",
  })

  unicodeTable = new SimpleTableRenderable(renderer, {
    id: "simple-table-demo-unicode",
    width: "100%",
    wrapMode: currentWrapMode(),
    borderStyle: currentBorderStyle(),
    borderColor: "#34d399",
    fg: "#e2e8f0",
    bg: "transparent",
    content: unicodeContentSets[contentIndex] ?? unicodeContentSets[0],
  })

  container.add(controlsText)
  container.add(primaryLabel)
  container.add(primaryTable)
  container.add(unicodeLabel)
  container.add(unicodeTable)

  keyboardHandler = (key: KeyEvent) => {
    if (key.ctrl || key.meta) return

    if (key.name === "1" || key.name === "2" || key.name === "3") {
      contentIndex = Number(key.name) - 1
      applyTableState()
      return
    }

    if (key.name === "w") {
      wrapIndex = (wrapIndex + 1) % WRAP_MODES.length
      applyTableState()
      return
    }

    if (key.name === "b") {
      borderIndex = (borderIndex + 1) % BORDER_STYLES.length
      applyTableState()
    }
  }

  renderer.keyInput.on("keypress", keyboardHandler)
  applyTableState()
}

export function destroy(renderer: CliRenderer): void {
  if (keyboardHandler) {
    renderer.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  container?.destroyRecursively()
  container = null
  primaryTable = null
  unicodeTable = null
  controlsText = null

  contentIndex = 0
  wrapIndex = 1
  borderIndex = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
