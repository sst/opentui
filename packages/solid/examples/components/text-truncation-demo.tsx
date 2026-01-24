import { bold, cyan, green, magenta, t, yellow } from "@opentui/core"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import { createMemo, createSignal, onMount, onCleanup } from "solid-js"

const singleLineText1 =
  "This is a very long single line of text that will definitely exceed the width of most terminal windows and should be truncated when truncation is enabled"
const singleLineText2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz"
const singleLineText3 = "🌟 Unicode test: こんにちは世界 Hello World 你好世界 안녕하세요 🚀 More emoji: 🎨🎭🎪🎬🎮🎯"
const multilineText1 =
  "This is a multiline text block that demonstrates how truncation works with word wrapping enabled. Each line that exceeds the viewport width will be truncated independently. Try resizing the terminal to see how it behaves!"
const multilineText2 = `Line 1: This is a long line without wrapping
Line 2: Another very long line that will be truncated when enabled
Line 3: Short line
Line 4: Yet another extremely long line with lots of text to demonstrate middle truncation behavior`

export function TextTruncationDemo() {
  const renderer = useRenderer()
  const [truncateEnabled, setTruncateEnabled] = createSignal(false)
  const [wrapMode, setWrapMode] = createSignal<"none" | "char" | "word">("none")
  const [leftGrow, setLeftGrow] = createSignal(1)
  const [rightGrow, setRightGrow] = createSignal(1)

  const [statusText, setStatusText] = createSignal("Select text to see details here")
  const [selectionStartText, setSelectionStartText] = createSignal("")
  const [selectionMiddleText, setSelectionMiddleText] = createSignal("")
  const [selectionEndText, setSelectionEndText] = createSignal("")

  onMount(() => {
    renderer.setBackgroundColor("#0d1117")
  })

  const footerContent = createMemo(() => {
    const truncateStatus = truncateEnabled() ? "ENABLED" : "DISABLED"
    const truncateColor = truncateEnabled() ? green : yellow
    const wrapColor = wrapMode() === "none" ? yellow : cyan
    return t`Truncate: ${truncateColor(bold(truncateStatus))} | Wrap: ${wrapColor(bold(wrapMode().toUpperCase()))} | ${cyan("T")}: toggle truncate | ${cyan("W")}: cycle wrap | ${cyan("R")}: resize | ${cyan("C")}: clear selection | ${cyan("Ctrl+C")}: exit`
  })

  const styledContent = createMemo(
    () =>
      t`This paragraph mixes ${bold(cyan("styled"))} text with ${magenta("color")} accents, ${green("emphasis")}, and ${yellow("highlighted")}
segments to exercise truncation on formatted content.`,
  )

  const updateSelectionTexts = (selectedText: string) => {
    const lines = selectedText.split("\n")
    const totalLength = selectedText.length

    if (lines.length > 1) {
      setStatusText(`Selected ${lines.length} lines (${totalLength} chars):`)
      setSelectionStartText(lines[0] || "")
      setSelectionMiddleText("...")
      setSelectionEndText(lines[lines.length - 1] || "")
    } else if (selectedText.length > 60) {
      setStatusText(`Selected ${totalLength} chars:`)
      setSelectionStartText(selectedText.substring(0, 30))
      setSelectionMiddleText("...")
      setSelectionEndText(selectedText.substring(selectedText.length - 30))
    } else {
      setStatusText(`Selected ${totalLength} chars:`)
      setSelectionStartText(`"${selectedText}"`)
      setSelectionMiddleText("")
      setSelectionEndText("")
    }
  }

  useSelectionHandler((selection) => {
    const selectedText = selection?.getSelectedText()
    if (selectedText) {
      updateSelectionTexts(selectedText)
    } else {
      setStatusText("Empty selection")
      setSelectionStartText("")
      setSelectionMiddleText("")
      setSelectionEndText("")
    }
  })

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault()
      renderer.destroy()
      return
    }
    if (key.name === "t") {
      setTruncateEnabled((current) => !current)
    }
    if (key.name === "w") {
      setWrapMode((current) => (current === "none" ? "char" : current === "char" ? "word" : "none"))
    }
    if (key.name === "r") {
      const left = leftGrow()
      const right = rightGrow()
      if (left === 1 && right === 1) {
        setLeftGrow(2)
        setRightGrow(1)
      } else if (left === 2 && right === 1) {
        setLeftGrow(1)
        setRightGrow(2)
      } else {
        setLeftGrow(1)
        setRightGrow(1)
      }
    }
    if (key.name === "c" && !key.ctrl) {
      renderer.clearSelection()
      setStatusText("Selection cleared")
      setSelectionStartText("")
      setSelectionMiddleText("")
      setSelectionEndText("")
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0d1117">
      <box
        height={3}
        backgroundColor="#161b22"
        borderStyle="single"
        borderColor="#30363d"
        alignItems="center"
        justifyContent="center"
        border
      >
        <text fg="#58a6ff" content="Text Truncation Demo - Press 'T' to toggle truncation" />
      </box>
      <box flexGrow={1} flexDirection="row" gap={1} padding={1}>
        <box flexGrow={leftGrow()} flexDirection="column" gap={1}>
          <box
            minHeight={5}
            backgroundColor="#161b22"
            borderStyle="rounded"
            borderColor="#58a6ff"
            title="Single Line Text 1"
            padding={1}
            border
          >
            <text content={singleLineText1} fg="#c9d1d9" wrapMode={wrapMode()} truncate={truncateEnabled()} />
          </box>
          <box
            minHeight={5}
            backgroundColor="#161b22"
            borderStyle="rounded"
            borderColor="#3fb950"
            title="Single Line Text 2"
            padding={1}
            border
          >
            <text content={singleLineText2} fg="#3fb950" wrapMode={wrapMode()} truncate={truncateEnabled()} />
          </box>
          <box
            minHeight={7}
            backgroundColor="#161b22"
            borderStyle="rounded"
            borderColor="#d29922"
            title="Single Line Text 3 (Unicode)"
            padding={1}
            border
          >
            <text content={singleLineText3} fg="#d29922" wrapMode={wrapMode()} truncate={truncateEnabled()} />
          </box>
        </box>
        <box flexGrow={rightGrow()} flexDirection="column" gap={1}>
          <box
            flexGrow={1}
            backgroundColor="#161b22"
            borderStyle="rounded"
            borderColor="#f778ba"
            title="Multiline Text (Word Wrap)"
            padding={1}
            border
          >
            <text content={multilineText1} fg="#f778ba" wrapMode={wrapMode()} truncate={truncateEnabled()} />
          </box>
          <box
            flexGrow={1}
            backgroundColor="#161b22"
            borderStyle="rounded"
            borderColor="#bc8cff"
            title="Multiline Text"
            padding={1}
            border
          >
            <text content={multilineText2} fg="#bc8cff" wrapMode={wrapMode()} truncate={truncateEnabled()} />
          </box>
          <box
            flexGrow={1}
            backgroundColor="#161b22"
            borderStyle="rounded"
            borderColor="#ff7b72"
            title="Styled Text with Truncation"
            padding={1}
            border
          >
            <text content={styledContent()} fg="#c9d1d9" wrapMode={wrapMode()} truncate={truncateEnabled()} />
          </box>
        </box>
      </box>
      <box
        height={3}
        backgroundColor="#161b22"
        borderStyle="single"
        borderColor="#30363d"
        alignItems="center"
        justifyContent="center"
        border
      >
        <text fg="#8b949e" content={footerContent()} />
      </box>
      <box
        height={7}
        backgroundColor="#0d1117"
        borderStyle="single"
        borderColor="#30363d"
        title="Selection"
        titleAlignment="left"
        flexDirection="column"
        gap={1}
        padding={1}
        border
      >
        <text fg="#8b949e" content={statusText()} />
        <text fg="#7dd3fc" content={selectionStartText()} />
        <text fg="#94a3b8" content={selectionMiddleText()} />
        <text fg="#7dd3fc" content={selectionEndText()} />
      </box>
    </box>
  )
}
