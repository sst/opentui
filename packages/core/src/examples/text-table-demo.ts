import {
  BoxRenderable,
  CliRenderer,
  ScrollBoxRenderable,
  TextTableRenderable,
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
import type { Selection } from "../lib/selection"
import type { TextTableColumnWidthMode, TextTableContent } from "../renderables/TextTable"
import type { TextChunk } from "../text-buffer"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let container: BoxRenderable | null = null
let primaryTable: TextTableRenderable | null = null
let unicodeTable: TextTableRenderable | null = null
let controlsText: TextRenderable | null = null
let tableAreaScrollBox: ScrollBoxRenderable | null = null
let selectionStatusText: TextRenderable | null = null
let selectionMetaText: TextRenderable | null = null
let selectionScrollBox: ScrollBoxRenderable | null = null
let keyboardHandler: ((key: KeyEvent) => void) | null = null
let selectionHandler: ((selection: Selection) => void) | null = null

let contentIndex = 0
let wrapIndex = 1
let borderIndex = 0
let columnWidthModeIndex = 0
let cellPaddingIndex = 0
let borderEnabled = true
let outerBorderEnabled = true
let showBordersEnabled = true

const WRAP_MODES: Array<"none" | "word" | "char"> = ["none", "word", "char"]
const BORDER_STYLES: BorderStyle[] = ["single", "rounded", "double", "heavy"]
const COLUMN_WIDTH_MODES: TextTableColumnWidthMode[] = ["content", "fill"]
const CELL_PADDING_VALUES: number[] = [0, 1, 2]

function cell(text: string): TextChunk[] {
  return [
    {
      __isChunk: true,
      text,
    },
  ]
}

const primaryContentSets: TextTableContent[] = [
  [
    [[bold("Service")], [bold("Status")], [bold("Notes")]],
    [cell("api"), [green("OK")], [fg("#94a3b8")("latency"), ...cell(" 28ms")]],
    [cell("worker"), [yellow("DEGRADED")], cell("queue depth: 124")],
    [cell("billing"), [red("ERROR")], cell("retrying payment provider")],
  ],
  [
    [[bold("Region")], [bold("Requests")], [bold("Trend")]],
    [cell("us-east-1"), cell("1.2M"), [green("+12.4%")]],
    [cell("eu-west-1"), cell("890K"), [green("+5.1%")]],
    [cell("ap-south-1"), cell("540K"), [red("-2.0%")]],
  ],
  [
    [[bold("Task")], [bold("Owner")], [bold("ETA")]],
    [cell("Wrap regression"), cell("core"), [green("done")]],
    [cell("Unicode layout"), cell("render"), cell("in review")],
    [cell("Snapshot pass"), cell("qa"), cell("today")],
  ],
]

const unicodeContentSets: TextTableContent[] = [
  [
    [[bold("Locale")], [bold("Sample")]],
    [cell("ja-JP"), cell("東京の夜景と絵文字 🌃✨")],
    [cell("zh-CN"), cell("你好世界，布局检查中 🚀")],
    [cell("ko-KR"), cell("한글과 이모지 조합 테스트 😄")],
  ],
  [
    [[bold("Expression")], [bold("Meaning")]],
    [cell("山川异域"), cell("Different lands, shared sky 🌏")],
    [cell("꽃길만 걷자"), cell("Walk only flower paths 🌸")],
    [cell("加油"), cell("Keep pushing forward 💪")],
  ],
  [
    [[bold("Column")], [bold("Wrapped Text")]],
    [cell("mixed"), cell("CJK and emoji wrapping: こんにちは世界 🌍 followed by long english text for width checks")],
    [cell("emoji"), cell("Faces 😀😃😄😁😆 and symbols 🧪📦🛰️ across constrained columns")],
  ],
]

function currentWrapMode(): "none" | "word" | "char" {
  return WRAP_MODES[wrapIndex] ?? "word"
}

function currentBorderStyle(): BorderStyle {
  return BORDER_STYLES[borderIndex] ?? "single"
}

function currentColumnWidthMode(): TextTableColumnWidthMode {
  return COLUMN_WIDTH_MODES[columnWidthModeIndex] ?? "content"
}

function currentCellPadding(): number {
  return CELL_PADDING_VALUES[cellPaddingIndex] ?? 0
}

function updateControlsText(): void {
  if (!controlsText) return

  controlsText.content = t`${bold("TextTable Demo")}  ${fg("#94a3b8")("1/2/3 dataset • W wrap • B style • M width • P padding • N inner • O outer • H draw • drag to select • C clear")}
Current: dataset ${fg("#7dd3fc")(String(contentIndex + 1))} | wrap ${fg("#a5b4fc")(currentWrapMode())} | style ${fg("#f9a8d4")(currentBorderStyle())} | width ${fg("#fcd34d")(currentColumnWidthMode())} | padding ${fg("#fda4af")(String(currentCellPadding()))} | inner ${fg("#93c5fd")(borderEnabled ? "on" : "off")} | outer ${fg("#86efac")(outerBorderEnabled ? "on" : "off")} | draw ${fg("#67e8f9")(showBordersEnabled ? "on" : "off")}`
}

function clearSelectionStatus(message: string): void {
  if (!selectionMetaText || !selectionStatusText) return
  selectionMetaText.content = message
  selectionStatusText.content = ""
  if (selectionScrollBox) {
    selectionScrollBox.scrollTop = 0
  }
}

function applyTableState(): void {
  if (!primaryTable || !unicodeTable) return

  primaryTable.content = primaryContentSets[contentIndex] ?? primaryContentSets[0]
  unicodeTable.content = unicodeContentSets[contentIndex] ?? unicodeContentSets[0]

  primaryTable.wrapMode = currentWrapMode()
  unicodeTable.wrapMode = currentWrapMode()

  primaryTable.borderStyle = currentBorderStyle()
  unicodeTable.borderStyle = currentBorderStyle()

  primaryTable.columnWidthMode = currentColumnWidthMode()
  unicodeTable.columnWidthMode = currentColumnWidthMode()

  primaryTable.cellPadding = currentCellPadding()
  unicodeTable.cellPadding = currentCellPadding()

  primaryTable.border = borderEnabled
  unicodeTable.border = borderEnabled

  primaryTable.outerBorder = outerBorderEnabled
  unicodeTable.outerBorder = outerBorderEnabled

  primaryTable.showBorders = showBordersEnabled
  unicodeTable.showBorders = showBordersEnabled

  updateControlsText()
}

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#0b1020")

  container = new BoxRenderable(renderer, {
    id: "text-table-demo-container",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
    backgroundColor: "#0b1020",
  })
  renderer.root.add(container)

  controlsText = new TextRenderable(renderer, {
    id: "text-table-demo-controls",
    content: "",
    fg: "#e2e8f0",
    wrapMode: "word",
    selectable: false,
  })

  tableAreaScrollBox = new ScrollBoxRenderable(renderer, {
    id: "text-table-demo-table-area-scroll",
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: false,
    border: false,
    backgroundColor: "transparent",
    contentOptions: {
      flexDirection: "column",
      gap: 1,
    },
  })

  const primaryLabel = new TextRenderable(renderer, {
    id: "text-table-demo-primary-label",
    content: t`${bold("Operational Table")}`,
    fg: "#cbd5e1",
    selectable: false,
  })

  primaryTable = new TextTableRenderable(renderer, {
    id: "text-table-demo-primary",
    width: "100%",
    wrapMode: currentWrapMode(),
    borderStyle: currentBorderStyle(),
    borderColor: "#7aa2f7",
    fg: "#e2e8f0",
    bg: "transparent",
    content: primaryContentSets[contentIndex] ?? primaryContentSets[0],
  })

  const unicodeLabel = new TextRenderable(renderer, {
    id: "text-table-demo-unicode-label",
    content: t`${bold("Unicode/CJK/Emoji Table")}`,
    fg: "#cbd5e1",
    selectable: false,
  })

  unicodeTable = new TextTableRenderable(renderer, {
    id: "text-table-demo-unicode",
    width: "100%",
    wrapMode: currentWrapMode(),
    borderStyle: currentBorderStyle(),
    borderColor: "#34d399",
    fg: "#e2e8f0",
    bg: "transparent",
    content: unicodeContentSets[contentIndex] ?? unicodeContentSets[0],
  })

  const selectionBox = new BoxRenderable(renderer, {
    id: "text-table-demo-selection-box",
    width: "100%",
    height: 10,
    flexGrow: 0,
    flexShrink: 0,
    border: true,
    borderStyle: "single",
    borderColor: "#64748b",
    title: "Selected Text",
    titleAlignment: "left",
    padding: 1,
    backgroundColor: "#111827",
  })

  selectionMetaText = new TextRenderable(renderer, {
    id: "text-table-demo-selection-meta",
    content: "No selection yet",
    fg: "#93c5fd",
    selectable: false,
  })

  selectionScrollBox = new ScrollBoxRenderable(renderer, {
    id: "text-table-demo-selection-scroll",
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    scrollY: true,
    scrollX: false,
    border: false,
    backgroundColor: "transparent",
  })

  tableAreaScrollBox.verticalScrollbarOptions = { visible: false }
  selectionScrollBox.verticalScrollbarOptions = { visible: false }

  selectionStatusText = new TextRenderable(renderer, {
    id: "text-table-demo-selection-text",
    content: "",
    fg: "#e2e8f0",
    wrapMode: "word",
    width: "100%",
    selectable: false,
  })

  selectionBox.add(selectionMetaText)
  selectionBox.add(selectionScrollBox)
  selectionScrollBox.add(selectionStatusText)

  tableAreaScrollBox.add(controlsText)
  tableAreaScrollBox.add(primaryLabel)
  tableAreaScrollBox.add(primaryTable)
  tableAreaScrollBox.add(unicodeLabel)
  tableAreaScrollBox.add(unicodeTable)

  container.add(tableAreaScrollBox)
  container.add(selectionBox)

  selectionHandler = (selection: Selection) => {
    if (!selectionMetaText || !selectionStatusText) return

    const selectedText = selection.getSelectedText()
    if (!selectedText) {
      clearSelectionStatus("Empty selection")
      return
    }

    const lines = selectedText.split("\n").length
    const chars = selectedText.length
    selectionMetaText.content = `Selected ${lines} line${lines === 1 ? "" : "s"} (${chars} chars)`
    selectionStatusText.content = selectedText
    if (selectionScrollBox) {
      selectionScrollBox.scrollTop = 0
    }
  }

  renderer.on("selection", selectionHandler)

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
      return
    }

    if (key.name === "m") {
      columnWidthModeIndex = (columnWidthModeIndex + 1) % COLUMN_WIDTH_MODES.length
      applyTableState()
      return
    }

    if (key.name === "p") {
      cellPaddingIndex = (cellPaddingIndex + 1) % CELL_PADDING_VALUES.length
      applyTableState()
      return
    }

    if (key.name === "n") {
      borderEnabled = !borderEnabled
      applyTableState()
      return
    }

    if (key.name === "o") {
      outerBorderEnabled = !outerBorderEnabled
      applyTableState()
      return
    }

    if (key.name === "h") {
      showBordersEnabled = !showBordersEnabled
      applyTableState()
      return
    }

    if (key.name === "c") {
      renderer.clearSelection()
      clearSelectionStatus("Selection cleared")
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

  if (selectionHandler) {
    renderer.off("selection", selectionHandler)
    selectionHandler = null
  }

  container?.destroyRecursively()
  container = null
  primaryTable = null
  unicodeTable = null
  controlsText = null
  tableAreaScrollBox = null
  selectionStatusText = null
  selectionMetaText = null
  selectionScrollBox = null

  contentIndex = 0
  wrapIndex = 1
  borderIndex = 0
  columnWidthModeIndex = 0
  cellPaddingIndex = 0
  borderEnabled = true
  outerBorderEnabled = true
  showBordersEnabled = true
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
    enableMouseMovement: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
