import { createEffect, createSignal, onCleanup, splitProps } from "solid-js"
import { createElement, insert, useRenderer } from "@opentui/solid"
import { useKeyboard } from "@opentui/solid"
import type { JSX } from "solid-js"
import {
  SlottableDiffRenderable,
  type BoxRenderable,
  type DiffLineClickInfo,
  type SlottableDiffOptions,
} from "@opentui/core"

interface Comment {
  id: string
  lineIndex: number
  text: string
  author: string
  timestamp: Date
}

const exampleDiff = `--- a/calculator.ts
+++ b/calculator.ts
@@ -1,13 +1,20 @@
 class Calculator {
   add(a: number, b: number): number {
     return a + b;
   }
 
-  subtract(a: number, b: number): number {
-    return a - b;
+  subtract(a: number, b: number, c: number = 0): number {
+    return a - b - c;
   }
 
   multiply(a: number, b: number): number {
     return a * b;
   }
+
+  divide(a: number, b: number): number {
+    if (b === 0) {
+      throw new Error("Division by zero");
+    }
+    return a / b;
+  }
 }`

interface CommentInputProps {
  lineIndex: number
  onSubmit: (text: string) => void
  onCancel: () => void
}

function CommentInput(props: CommentInputProps) {
  const [value, setValue] = createSignal("")

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onCancel()
    }
  })

  const handleSubmit = (inputValue: any) => {
    const text = (typeof inputValue === "string" ? inputValue : inputValue?.value || "").trim()
    if (text) {
      props.onSubmit(text)
    }
  }

  return (
    <box
      border
      borderStyle="rounded"
      borderColor="#61afef"
      backgroundColor="#21252b"
      padding={1}
      width="100%"
      flexDirection="column"
    >
      <text fg="#abb2bf">💬 Add comment for line {props.lineIndex + 1}:</text>
      <box marginTop={1}>
        <input
          focused
          placeholder="Type your comment here..."
          value={value()}
          onInput={(e: any) => setValue(e.value || e || "")}
          onSubmit={handleSubmit}
          flexGrow={1}
        />
      </box>
      <text fg="#6b7280" marginTop={1}>
        Enter to submit | Escape to cancel
      </text>
    </box>
  )
}

interface CommentDisplayProps {
  comment: Comment
}

function CommentDisplay(props: CommentDisplayProps) {
  return (
    <box
      border
      borderStyle="rounded"
      borderColor="#3fb950"
      backgroundColor="#161b22"
      padding={1}
      width="100%"
      flexDirection="column"
    >
      <text fg="#3fb950">💬 {props.comment.author} commented:</text>
      <text fg="#e6edf3" marginTop={1}>
        {props.comment.text}
      </text>
      <text fg="#6b7280" marginTop={1}>
        {props.comment.timestamp.toLocaleTimeString()}
      </text>
    </box>
  )
}

export default function InteractiveDiffDemo() {
  const [comments, setComments] = createSignal<Comment[]>([])
  const [activeInputLine, setActiveInputLine] = createSignal<number | null>(null)

  const buildLineSlots = (): Map<number, JSX.Element> => {
    const slots = new Map<number, JSX.Element>()

    // Add comment input if active
    const activeLine = activeInputLine()
    if (activeLine !== null) {
      slots.set(
        activeLine,
        <CommentInput
          lineIndex={activeLine}
          onSubmit={(text) => handleSubmitComment(activeLine, text)}
          onCancel={handleCancelComment}
        />,
      )
    }

    // Add submitted comments
    for (const comment of comments()) {
      slots.set(comment.lineIndex, <CommentDisplay comment={comment} />)
    }

    return slots
  }

  const handleLineClick = (info: DiffLineClickInfo) => {
    if (activeInputLine() === info.visualLineIndex) {
      setActiveInputLine(null)
    } else {
      setActiveInputLine(info.visualLineIndex)
    }
  }

  const handleSubmitComment = (lineIndex: number, text: string) => {
    const newComment: Comment = {
      id: `${lineIndex}-${Date.now()}`,
      lineIndex,
      text,
      author: "You",
      timestamp: new Date(),
    }
    setComments([...comments(), newComment])
    setActiveInputLine(null)
  }

  const handleCancelComment = () => {
    setActiveInputLine(null)
  }

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      {/* Header */}
      <box flexDirection="column" backgroundColor="#0D1117" padding={1} border borderColor="#4ECDC4">
        <text fg="#4ECDC4">Diff Review Demo - Declarative Reactive Slots</text>
        <text fg="#888888">Click any line to add a comment </text>
      </box>

      <scrollbox width="100%" flexGrow={1}>
        <SlottableDiff
          diff={exampleDiff}
          view="split"
          onLineClick={handleLineClick}
          lineSlots={buildLineSlots()}
          addedBg="#1a4d1a"
          removedBg="#4d1a1a"
          addedSignColor="#22c55e"
          removedSignColor="#ef4444"
          lineNumberFg="#6b7280"
          lineNumberBg="#161b22"
          addedLineNumberBg="#0d3a0d"
          removedLineNumberBg="#3a0d0d"
          fg="#e6edf3"
        />
      </scrollbox>
    </box>
  )
}

interface SlottableDiffProps extends SlottableDiffOptions {
  ref?: (el: SlottableDiffRenderable) => void
  lineSlots?: Map<number, JSX.Element>
}

/**
 * SlottableDiff component - declarative wrapper for SlottableDiffRenderable
 * the same pattern as Portal.
 *
 * Features:
 * - Native rendering performance from SlottableDiffRenderable
 * - Reactive slot management via lineSlots prop
 * - Full SolidJS reactivity for slot contents (buttons, inputs, etc.)
 */
export function SlottableDiff(props: SlottableDiffProps): JSX.Element {
  const renderer = useRenderer()
  let diffRef: SlottableDiffRenderable | null = null
  const slotContainers = new Map<number, BoxRenderable>()
  const [local, _] = splitProps(props, ["lineSlots", "ref"])

  const diffRenderable = new SlottableDiffRenderable(renderer, {
    id: `slottable-diff-${Date.now()}`,
    ...props,
  })
  diffRef = diffRenderable

  // Call ref callback if provided
  if (local.ref) {
    local.ref(diffRenderable)
  }

  // Reactive effect to manage slots
  createEffect(() => {
    const slots = local.lineSlots
    if (!diffRef) return

    const currentSlotIndices = new Set(slotContainers.keys())
    const newSlotIndices = slots ? new Set(slots.keys()) : new Set<number>()

    // Remove old slots
    for (const lineIndex of currentSlotIndices) {
      if (!newSlotIndices.has(lineIndex)) {
        diffRef.removeSlot(lineIndex)
        const container = slotContainers.get(lineIndex)
        if (container) {
          container.destroy()
          slotContainers.delete(lineIndex)
        }
      }
    }

    // Add/update slots
    if (slots) {
      for (const [lineIndex, jsxElement] of slots) {
        let container = slotContainers.get(lineIndex)

        if (!container) {
          // Create new container using createElement
          container = createElement("box") as BoxRenderable
          slotContainers.set(lineIndex, container)
        } else {
          // Clear existing content
          for (const child of container.getChildren()) {
            container.remove(child.id)
          }
        }

        // Use insert() to render JSX into container
        insert(container, () => jsxElement)

        // Add container to diff if not already there
        if (!diffRef.hasSlot(lineIndex)) {
          diffRef.insertSlot(lineIndex, container)
        }
      }
    }
  })

  // Cleanup on unmount
  onCleanup(() => {
    for (const container of slotContainers.values()) {
      container.destroy()
    }
    slotContainers.clear()
    if (diffRef) {
      diffRef.destroy()
    }
  })

  // Return the renderable as the component
  return diffRenderable as unknown as JSX.Element
}
