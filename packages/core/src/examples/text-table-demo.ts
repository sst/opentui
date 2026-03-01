import {
  BoxRenderable,
  CliRenderer,
  ScrollBoxRenderable,
  TextTableRenderable,
  TextRenderable,
  bold,
  createCliRenderer,
  fg,
  t,
  type BorderStyle,
  type KeyEvent,
} from "../index"
import type { Selection } from "../lib/selection"
import type { TextTableColumnFitter, TextTableColumnWidthMode, TextTableContent } from "../renderables/TextTable"
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
let columnFitterIndex = 0
let cellPaddingIndex = 0
let borderEnabled = true
let outerBorderEnabled = true
let showBordersEnabled = true

const PALETTE = {
  bg: "#000000",
  panel: "#0d0d0d",
  tablePrimaryBg: "transparent",
  tableUnicodeBg: "transparent",
  text: "#f0f0f0",
  muted: "#666666",
  soft: "#bbbbbb",
  rose: "#e8c97a",
  ember: "#b8a0ff",
  flame: "#ffffff",
  eye: "#00d4aa",
  border: "#2a2a2a",
} as const

const WRAP_MODES: Array<"none" | "word" | "char"> = ["none", "word", "char"]
const BORDER_STYLES: BorderStyle[] = ["single", "rounded", "double", "heavy"]
const COLUMN_WIDTH_MODES: TextTableColumnWidthMode[] = ["content", "full"]
const COLUMN_FITTERS: TextTableColumnFitter[] = ["proportional", "balanced"]
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
    [cell("api"), [fg(PALETTE.eye)("OK")], [fg(PALETTE.muted)("latency"), ...cell(" 28ms")]],
    [cell("worker"), [fg(PALETTE.ember)("DEGRADED")], cell("queue depth: 124")],
    [cell("billing"), [fg(PALETTE.flame)("ERROR")], cell("retrying payment provider")],
  ],
  [
    [[bold("Region")], [bold("Requests")], [bold("Trend")]],
    [cell("us-east-1"), cell("1.2M"), [fg(PALETTE.eye)("+12.4%")]],
    [cell("eu-west-1"), cell("890K"), [fg(PALETTE.soft)("+5.1%")]],
    [cell("ap-south-1"), cell("540K"), [fg(PALETTE.flame)("-2.0%")]],
  ],
  [
    [[bold("Task")], [bold("Owner")], [bold("ETA")]],
    [
      cell(
        "Wrap regression in operational status dashboard with dynamic row heights and constrained layout validation",
      ),
      cell("core platform and runtime reliability squad"),
      [
        fg(PALETTE.eye)(
          "done after validating none, word, and char wrap modes across narrow, medium, wide, and ultra-wide terminal widths",
        ),
      ],
    ],
    [
      cell(
        "Unicode layout stabilization for mixed Latin, punctuation, symbols, and long identifiers in adjacent columns",
      ),
      cell("render pipeline maintainers with fallback shaping support"),
      cell(
        "in review with follow-up checks for border style transitions, cell padding variants, and selection range consistency",
      ),
    ],
    [
      cell("Snapshot pass for table rendering in content mode and full mode with heavy and double border combinations"),
      cell("qa automation and visual diff triage group"),
      cell(
        "today pending final baseline updates for oversized fixtures that intentionally stress wrapping behavior on high-resolution terminals",
      ),
    ],
    [
      cell(
        "Document edge cases where long tokens without spaces force char wrapping and reveal per-cell clipping regressions",
      ),
      cell("developer experience and docs tooling"),
      cell(
        "planned for this sprint once final reproducible examples are captured and linked to regression tracking tickets",
      ),
    ],
    [
      cell(
        "Performance sweep of wrapping algorithm under large datasets to confirm stable frame times during rapid key toggling",
      ),
      cell("runtime performance task force"),
      cell("scheduled after review, with benchmark runs on laptop and desktop terminals at 200-plus column widths"),
    ],
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
    [
      cell("mixed-languages"),
      cell(
        "CJK and emoji wrapping stress case: こんにちは世界 and 안녕하세요 세계 and 你好，世界 followed by long English prose that keeps flowing to test whether each cell wraps naturally even when the terminal is extremely wide and the row still needs multiple visual lines for readability 🌍🚀",
      ),
    ],
    [
      cell("emoji-and-symbols"),
      cell(
        "Faces 😀😃😄😁😆 plus symbols 🧪📦🛰️🔧📊 mixed with version tags like release-candidate-build-2026-02-very-long-token-without-breaks to ensure char wrapping remains stable and no glyph alignment issues appear at column boundaries",
      ),
    ],
    [
      cell("long-cjk-phrase"),
      cell(
        "長文の日本語テキストと中文段落和한국어문장을連続して配置し、その後に additional English context describing renderer behavior, border intersection handling, and selection extraction so that this single cell remains a reliable wrapping torture test.",
      ),
    ],
    [
      cell("mixed-punctuation"),
      cell(
        "Wrap behavior with punctuation-heavy content: [alpha]{beta}(gamma)<delta>|epsilon| then repeated fragments, commas, semicolons, and slashes to verify token boundaries do not break border drawing logic or spacing consistency in neighboring columns.",
      ),
    ],
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

function currentColumnFitter(): TextTableColumnFitter {
  return COLUMN_FITTERS[columnFitterIndex] ?? "proportional"
}

function currentCellPadding(): number {
  return CELL_PADDING_VALUES[cellPaddingIndex] ?? 0
}

function updateControlsText(): void {
  if (!controlsText) return

  controlsText.content = t`${bold("TextTable Demo")}  ${fg(PALETTE.muted)("1/2/3 dataset • W wrap • B style • M width • F fitter • P padding • N inner • O outer • H draw • drag to select • C clear")}
Current: dataset ${fg(PALETTE.soft)(String(contentIndex + 1))} | wrap ${fg(PALETTE.rose)(currentWrapMode())} | style ${fg(PALETTE.ember)(currentBorderStyle())} | width ${fg(PALETTE.eye)(currentColumnWidthMode())} | fitter ${fg(PALETTE.rose)(currentColumnFitter())} | padding ${fg(PALETTE.soft)(String(currentCellPadding()))} | inner ${fg(PALETTE.rose)(borderEnabled ? "on" : "off")} | outer ${fg(PALETTE.ember)(outerBorderEnabled ? "on" : "off")} | draw ${fg(PALETTE.eye)(showBordersEnabled ? "on" : "off")}`
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

  primaryTable.columnFitter = currentColumnFitter()
  unicodeTable.columnFitter = currentColumnFitter()

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
  renderer.setBackgroundColor("transparent")

  container = new BoxRenderable(renderer, {
    id: "text-table-demo-container",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
    backgroundColor: "transparent",
  })
  renderer.root.add(container)

  controlsText = new TextRenderable(renderer, {
    id: "text-table-demo-controls",
    content: "",
    fg: PALETTE.text,
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
    fg: PALETTE.ember,
    selectable: false,
  })

  primaryTable = new TextTableRenderable(renderer, {
    id: "text-table-demo-primary",
    width: "100%",
    wrapMode: currentWrapMode(),
    columnFitter: currentColumnFitter(),
    borderStyle: currentBorderStyle(),
    borderColor: PALETTE.ember,
    fg: PALETTE.text,
    bg: PALETTE.tablePrimaryBg,
    content: primaryContentSets[contentIndex] ?? primaryContentSets[0],
  })

  const unicodeLabel = new TextRenderable(renderer, {
    id: "text-table-demo-unicode-label",
    content: t`${bold("Unicode/CJK/Emoji Table")}`,
    fg: PALETTE.rose,
    selectable: false,
  })

  unicodeTable = new TextTableRenderable(renderer, {
    id: "text-table-demo-unicode",
    width: "100%",
    wrapMode: currentWrapMode(),
    columnFitter: currentColumnFitter(),
    borderStyle: currentBorderStyle(),
    borderColor: PALETTE.rose,
    fg: PALETTE.text,
    bg: PALETTE.tableUnicodeBg,
    content: unicodeContentSets[contentIndex] ?? unicodeContentSets[0],
  })

  const selectionBox = new BoxRenderable(renderer, {
    id: "text-table-demo-selection-box",
    width: "100%",
    height: 10,
    flexGrow: 0,
    flexShrink: 0,
    border: true,
    borderStyle: "double",
    borderColor: PALETTE.border,
    title: "Selected Text",
    titleAlignment: "left",
    padding: 1,
    backgroundColor: PALETTE.panel,
  })

  selectionMetaText = new TextRenderable(renderer, {
    id: "text-table-demo-selection-meta",
    content: "No selection yet",
    fg: PALETTE.eye,
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
    fg: PALETTE.text,
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

    if (key.name === "f") {
      columnFitterIndex = (columnFitterIndex + 1) % COLUMN_FITTERS.length
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
  columnFitterIndex = 0
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
