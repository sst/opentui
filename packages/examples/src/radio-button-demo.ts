import {
  type CliRenderer,
  createCliRenderer,
  t,
  fg,
  bold,
  BoxRenderable,
  TextRenderable,
  RenderableEvents,
} from "@opentui/core"
import { RadioButtonRenderable, RadioButtonRenderableEvents, type RadioButtonDesign } from "@opentui/forms"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

let renderer: CliRenderer | null = null
let rootBox: BoxRenderable | null = null
let statusText: TextRenderable | null = null
let keyboardHandler: ((key: any) => void) | null = null

const allButtons: RadioButtonRenderable[] = []
let focusIndex = 0

const COL_X = [2, 31, 60]
const COL_W = 27

const BUILTIN_ROW_Y = [4, 14]
const CUSTOM_ROW_Y = 27

const ITEMS = [
  { label: "Option Alpha", value: "alpha" },
  { label: "Option Beta", value: "beta" },
  { label: "Option Gamma", value: "gamma" },
]

interface GroupDef {
  design: RadioButtonDesign
  name: string
  checkedColor: string
  focusBg: string
  colIdx: number
  y: number
}

const BUILTIN_GROUPS: GroupDef[] = [
  {
    design: "classic",
    name: "classic  ○ / ◉",
    checkedColor: "#7EB8F7",
    focusBg: "#0a1520",
    colIdx: 0,
    y: BUILTIN_ROW_Y[0],
  },
  {
    design: "filled",
    name: "filled   [ ] / [●]",
    checkedColor: "#F79A3E",
    focusBg: "#1a0e00",
    colIdx: 1,
    y: BUILTIN_ROW_Y[0],
  },
  {
    design: "minimal",
    name: "minimal  · / •",
    checkedColor: "#B8F77E",
    focusBg: "#081500",
    colIdx: 2,
    y: BUILTIN_ROW_Y[0],
  },
  {
    design: "arrow",
    name: "arrow    ▷ / ▶",
    checkedColor: "#FF6B6B",
    focusBg: "#1a0000",
    colIdx: 0,
    y: BUILTIN_ROW_Y[1],
  },
  {
    design: "paren",
    name: "paren    ( ) / (●)",
    checkedColor: "#C8A0FF",
    focusBg: "#0f0018",
    colIdx: 1,
    y: BUILTIN_ROW_Y[1],
  },
]

const CUSTOM_GROUPS: GroupDef[] = [
  { design: ["🔥", "💥"], name: "🔥 / 💥", checkedColor: "#FF6B35", focusBg: "#1a0800", colIdx: 0, y: CUSTOM_ROW_Y },
  {
    design: ["[_]", "[X]"],
    name: "[_] / [X]",
    checkedColor: "#00FF99",
    focusBg: "#001a0e",
    colIdx: 1,
    y: CUSTOM_ROW_Y,
  },
  { design: ["-", "+"], name: "-  / +", checkedColor: "#FFDD44", focusBg: "#141200", colIdx: 2, y: CUSTOM_ROW_Y },
]

function setStatus(msg: string, color = "#FFCC00"): void {
  if (statusText) statusText.content = t`${fg(color)("▸")} ${fg(color)(msg)}`
}

function moveFocus(delta: number): void {
  if (allButtons.length === 0) return
  allButtons[focusIndex]?.blur()
  focusIndex = (focusIndex + delta + allButtons.length) % allButtons.length
  allButtons[focusIndex]?.focus()
}

function label(rend: CliRenderer, parent: BoxRenderable, content: any, x: number, y: number, w = 80) {
  parent.add(
    new TextRenderable(rend, {
      content,
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: 1,
      zIndex: 10,
    }),
  )
}

function buildGroup(rend: CliRenderer, parent: BoxRenderable, grp: GroupDef, groupId: string): RadioButtonRenderable[] {
  const x = COL_X[grp.colIdx]

  label(rend, parent, t`${bold(fg(grp.checkedColor)(grp.name))}`, x, grp.y, COL_W)

  const buttons: RadioButtonRenderable[] = []

  ITEMS.forEach((item, i) => {
    const btn = new RadioButtonRenderable(rend, {
      label: item.label,
      value: `${groupId}:${item.value}`,
      design: grp.design,
      group: groupId,
      checked: i === 0,
      position: "absolute",
      left: x,
      top: grp.y + 2 + i * 2,
      width: COL_W,
      height: 1,
      zIndex: 10,
      checkedTextColor: grp.checkedColor,
      focusedBackgroundColor: grp.focusBg,
    })

    btn.on(RenderableEvents.FOCUSED, () => {
      focusIndex = allButtons.indexOf(btn)
    })

    btn.on(RadioButtonRenderableEvents.SELECTED, () => {
      const ind = Array.isArray(grp.design) ? `${grp.design[0]} / ${grp.design[1]}` : grp.design
      setStatus(`"${item.label}"  [${ind}]`, grp.checkedColor)
    })

    parent.add(btn)
    buttons.push(btn)
  })

  return buttons
}

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#07070f")

  rootBox = new BoxRenderable(renderer, { id: "radio-root", zIndex: 5 })
  renderer.root.add(rootBox)

  const W = 90

  // title
  label(renderer, rootBox, t`${bold(fg("#FFFFFF")("Radio Button Designs"))}`, 2, 0, W)

  label(
    renderer,
    rootBox,
    t`${fg("#445566")("┄┄┄")}  ${bold(fg("#7799BB")("BUILT-IN"))}  ${fg("#445566")("┄".repeat(50))}`,
    2,
    2,
    W,
  )

  allButtons.length = 0

  BUILTIN_GROUPS.forEach((grp, i) => {
    const btns = buildGroup(renderer!, rootBox!, grp, `builtin-${i}`)
    allButtons.push(...btns)
  })

  const CUSTOM_HDR_Y = CUSTOM_ROW_Y - 2

  label(
    renderer,
    rootBox,
    t`${fg("#443300")("┄┄┄")}  ${bold(fg("#DDAA44")("CUSTOM"))}  ${fg("#443300")("┄".repeat(52))}`,
    2,
    CUSTOM_HDR_Y,
    W,
  )

  CUSTOM_GROUPS.forEach((grp, i) => {
    const btns = buildGroup(renderer!, rootBox!, grp, `custom-${i}`)
    allButtons.push(...btns)
  })

  const BOTTOM_Y = CUSTOM_ROW_Y + 9

  statusText = new TextRenderable(renderer, {
    id: "radio-status",
    content: t`${fg("#334455")("▸")} ${fg("#334455")("Focus a button and press Space / Enter to select.")}`,
    position: "absolute",
    left: 2,
    top: BOTTOM_Y,
    width: W,
    height: 1,
    zIndex: 10,
  })
  rootBox.add(statusText)

  label(
    renderer,
    rootBox,
    t`${fg("#2a2a3a")("Tab / Shift+Tab: move focus   Space / Enter: select   Q: quit")}`,
    2,
    BOTTOM_Y + 1,
    W,
  )

  keyboardHandler = (key: any) => {
    if (key.name === "tab" && !key.shift) moveFocus(1)
    else if (key.name === "tab" && key.shift) moveFocus(-1)
    else if (key.name === "q") rendererInstance.stop()
  }
  rendererInstance.keyInput.on("keypress", keyboardHandler)

  focusIndex = 0
  allButtons[0]?.focus()
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyboardHandler) {
    rendererInstance.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }
  for (const btn of allButtons) btn.destroy()
  allButtons.length = 0
  if (rootBox) {
    rendererInstance.root.remove(rootBox.id)
    rootBox.destroy()
    rootBox = null
  }
  statusText = null
  renderer = null
}

if (import.meta.main) {
  const rend = await createCliRenderer({ exitOnCtrlC: true })
  run(rend)
  setupCommonDemoKeys(rend)
  rend.start()
}
