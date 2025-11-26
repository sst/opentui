import { createSignal, onMount } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"

export default function LineNumberDemo() {
  const [showLineNumbers, setShowLineNumbers] = createSignal(true)
  const [showDiffHighlights, setShowDiffHighlights] = createSignal(false)
  const [showDiagnostics, setShowDiagnostics] = createSignal(false)

  const codeContent = `function fibonacci(n: number): number {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

const results = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  .map(fibonacci)

console.log('Fibonacci sequence:', results)

// Calculate the sum
const sum = results.reduce((acc, val) => acc + val, 0)
console.log('Sum:', sum)

// Find even numbers
const evens = results.filter(n => n % 2 === 0)
console.log('Even numbers:', evens)`

  const syntaxStyle = SyntaxStyle.fromStyles({
    keyword: { fg: "#C792EA" },
    function: { fg: "#82AAFF" },
    string: { fg: "#C3E88D" },
    number: { fg: "#F78C6C" },
    comment: { fg: "#546E7A" },
    type: { fg: "#FFCB6B" },
    operator: { fg: "#89DDFF" },
    variable: { fg: "#EEFFFF" },
    default: { fg: "#A6ACCD" },
  })

  let lineNumberRef: any

  onMount(() => {
    // Set up diff highlights
    if (showDiffHighlights()) {
      lineNumberRef?.setLineColor(1, "#1a4d1a") // Line 2: added
      lineNumberRef?.setLineSign(1, { after: " +", afterColor: "#22c55e" })

      lineNumberRef?.setLineColor(5, "#4d1a1a") // Line 6: removed
      lineNumberRef?.setLineSign(5, { after: " -", afterColor: "#ef4444" })

      lineNumberRef?.setLineColor(10, "#1a4d1a") // Line 11: added
      lineNumberRef?.setLineSign(10, { after: " +", afterColor: "#22c55e" })
    }

    // Set up diagnostics
    if (showDiagnostics()) {
      lineNumberRef?.setLineSign(0, { before: "⚠️", beforeColor: "#f59e0b" })
      lineNumberRef?.setLineSign(7, { before: "💡", beforeColor: "#3b82f6" })
      lineNumberRef?.setLineSign(13, { before: "❌", beforeColor: "#ef4444" })
    }
  })

  useKeyboard((key) => {
    if (key.name === "l" && !key.ctrl && !key.meta) {
      toggleLineNumbers()
    } else if (key.name === "h" && !key.ctrl && !key.meta) {
      toggleDiffHighlights()
    } else if (key.name === "d" && !key.ctrl && !key.meta) {
      toggleDiagnostics()
    }
  })

  const toggleLineNumbers = () => {
    setShowLineNumbers(!showLineNumbers())
  }

  const toggleDiffHighlights = () => {
    const newValue = !showDiffHighlights()
    setShowDiffHighlights(newValue)

    if (newValue) {
      lineNumberRef?.setLineColor(1, "#1a4d1a")
      lineNumberRef?.setLineSign(1, { after: " +", afterColor: "#22c55e" })
      lineNumberRef?.setLineColor(5, "#4d1a1a")
      lineNumberRef?.setLineSign(5, { after: " -", afterColor: "#ef4444" })
      lineNumberRef?.setLineColor(10, "#1a4d1a")
      lineNumberRef?.setLineSign(10, { after: " +", afterColor: "#22c55e" })
    } else {
      lineNumberRef?.clearAllLineColors()
      // Clear only after signs
      if (!showDiagnostics()) {
        lineNumberRef?.clearAllLineSigns()
      } else {
        lineNumberRef?.setLineSign(1, {})
        lineNumberRef?.setLineSign(5, {})
        lineNumberRef?.setLineSign(10, {})
      }
    }
  }

  const toggleDiagnostics = () => {
    const newValue = !showDiagnostics()
    setShowDiagnostics(newValue)

    if (newValue) {
      lineNumberRef?.setLineSign(0, { before: "⚠️", beforeColor: "#f59e0b" })
      lineNumberRef?.setLineSign(7, { before: "💡", beforeColor: "#3b82f6" })
      lineNumberRef?.setLineSign(13, { before: "❌", beforeColor: "#ef4444" })
    } else {
      // Clear only before signs
      if (!showDiffHighlights()) {
        lineNumberRef?.clearAllLineSigns()
      } else {
        lineNumberRef?.setLineSign(0, {})
        lineNumberRef?.setLineSign(7, {})
        lineNumberRef?.setLineSign(13, {})
      }
    }
  }

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      <box flexDirection="column" backgroundColor="#0D1117" padding={1} border borderColor="#30363D">
        <text fg="#4ECDC4" bold>
          Line Numbers Demo
        </text>
        <text fg="#888888">Keybindings:</text>
        <text fg="#AAAAAA"> L - Toggle line numbers ({showLineNumbers() ? "ON" : "OFF"})</text>
        <text fg="#AAAAAA"> H - Toggle diff highlights ({showDiffHighlights() ? "ON" : "OFF"})</text>
        <text fg="#AAAAAA"> D - Toggle diagnostics ({showDiagnostics() ? "ON" : "OFF"})</text>
      </box>

      <box flexGrow={1} border borderStyle="single" borderColor="#4ECDC4" backgroundColor="#0D1117">
        <line_number
          ref={lineNumberRef}
          fg="#6b7280"
          bg="#161b22"
          minWidth={3}
          paddingRight={1}
          showLineNumbers={showLineNumbers()}
          width="100%"
          height="100%"
        >
          <code
            content={codeContent}
            filetype="typescript"
            syntaxStyle={syntaxStyle}
            selectable
            selectionBg="#264F78"
            selectionFg="#FFFFFF"
            width="100%"
            height="100%"
          />
        </line_number>
      </box>
    </box>
  )
}
