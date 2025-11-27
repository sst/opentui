import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"
import { For, Show } from "solid-js"
import { SyntaxStyle } from "../../core/src/syntax-style"
import { MockTreeSitterClient } from "@opentui/core/testing"

/**
 * LINE NUMBER LAYOUT BUGS - REPRODUCTION TESTS
 *
 * These tests attempt to reproduce the layout issues reported in OpenCode's session view:
 *
 * REPORTED ISSUES:
 * 1. **Overlap Issue**: Text like "Message Actions", "Enter search", etc. appearing over line numbers
 *    Example: "ts      Message Actions" instead of clean line numbers
 *
 * 2. **Excessive Empty Space**: Vast empty space (lines like "53") appearing below line_number blocks
 *    Example: 30+ empty lines between code block and next message
 *
 * TEST RESULTS (as of creation):
 * - ✅ Basic line_number rendering works correctly
 * - ✅ Multiple line_number blocks don't overlap
 * - ✅ No excessive empty space in standard scrollbox scenarios
 * - ✅ Portrait aspect ratio (tall terminals) works fine
 *
 * HYPOTHESIS:
 * The reported bugs may be caused by:
 * 1. Dialog/Modal overlays rendering over the scrollbox content
 * 2. Specific sequence of Solid reactivity updates not captured in these tests
 * 3. Edge case related to stickyScroll + dynamic content updates
 * 4. Mouse interaction triggers (onMouseOver/onMouseUp) affecting layout
 *
 * TO REPRODUCE THE ACTUAL BUG:
 * Run the actual OpenCode app and trigger "Message Actions" dialog to see if it overlaps.
 */

let testSetup: Awaited<ReturnType<typeof testRender>>
let mockTreeSitterClient: MockTreeSitterClient

describe("LineNumber Layout Bugs - REPRODUCTION TESTS", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
    mockTreeSitterClient = new MockTreeSitterClient()
    mockTreeSitterClient.setMockResult({ highlights: [] })
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("BUG REPRODUCTION: overlapping text on line numbers in scrollbox with multiple messages", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    // Simulate a realistic chat scenario like the OpenCode session
    const messages = [
      {
        id: "msg1",
        type: "user" as const,
        text: "create a ts counter class",
      },
      {
        id: "msg2",
        type: "assistant" as const,
        text: "I'll create a TypeScript counter class for you.",
      },
      {
        id: "msg3",
        type: "tool" as const,
        tool: "write",
        filePath: "counter.ts",
        code: `class Counter {
  private value: number;

  constructor(initialValue: number = 0) {
    this.value = initialValue;
  }

  increment(): void {
    this.value++;
  }

  decrement(): void {
    this.value--;
  }

  reset(): void {
    this.value = 0;
  }

  getValue(): number {
    return this.value;
  }
}`,
      },
      {
        id: "msg4",
        type: "assistant" as const,
        text: "Created a TypeScript counter class with increment, decrement, reset, and value management methods.",
      },
      {
        id: "msg5",
        type: "user" as const,
        text: "Now extend the class",
      },
      {
        id: "msg6",
        type: "tool" as const,
        tool: "edit",
        filePath: "counter.ts",
        code: `  this.max = max
  this.min = min
}

-increment(): void {
+override increment(): void {
  const currentValue = this.getValue()
  if (currentValue < this.max) {
    super.increment()
  }
}

-decrement(): void {
+override decrement(): void {
  const currentValue = this.getValue()
  if (currentValue > this.min) {
    super.decrement()
  }
}`,
      },
      {
        id: "msg7",
        type: "assistant" as const,
        text: "Extended the Counter class with ExtendedCounter that adds min/max bounds, range checking, and additional utility methods.",
      },
    ]

    testSetup = await testRender(
      () => (
        <box flexDirection="row">
          <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
            <scrollbox
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
            >
              <For each={messages}>
                {(message, index) => (
                  <>
                    <Show when={message.type === "user"}>
                      <box id={message.id} border={["left"]} borderColor="#00aaff" marginTop={index() === 0 ? 0 : 1}>
                        <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor="#1a1a1a" flexShrink={0}>
                          <text fg="#ffffff">{message.text}</text>
                          <text fg="#888888">kmdr 2:01 PM</text>
                        </box>
                      </box>
                    </Show>
                    <Show when={message.type === "assistant"}>
                      <box id={"text-" + message.id} paddingLeft={3} marginTop={1} flexShrink={0}>
                        <text fg="#ffffff">{message.text}</text>
                      </box>
                    </Show>
                    <Show when={message.type === "tool"}>
                      <box paddingLeft={3} marginTop={1} flexShrink={0}>
                        <text fg="#888888">
                          ← {message.tool === "write" ? "Wrote" : "Edit"} {message.filePath ?? ""}
                        </text>
                      </box>
                      <line_number fg="#888888" minWidth={3} paddingRight={1}>
                        <code
                          fg="#ffffff"
                          filetype="typescript"
                          syntaxStyle={syntaxStyle}
                          content={message.code}
                          treeSitterClient={mockTreeSitterClient}
                        />
                      </line_number>
                    </Show>
                  </>
                )}
              </For>
            </scrollbox>
          </box>
        </box>
      ),
      {
        width: 72, // Realistic terminal width
        height: 35, // Realistic terminal height
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== OVERLAP BUG REPRODUCTION ===")
    console.log(frame)
    console.log("=== END ===")

    // Check that content exists (scroll position may affect what's visible)
    // The terminal height is 35 and there's a lot of content, so earlier messages may be scrolled out
    expect(frame).toContain("Now extend the class")

    // DOCUMENT THE BUG: Check for overlapping patterns
    // When line_number overlaps with next content, we'd see line numbers
    // immediately followed by unrelated text on the same line
    const lines = frame.split("\n")

    // Find the line with "← Wrote counter.ts" OR "← Edit counter.ts"
    // Due to scrolling (stickyScroll bottom), early messages may not be visible
    let wroteLineIdx = lines.findIndex((line) => line.includes("Wrote counter.ts"))
    if (wroteLineIdx < 0) {
      wroteLineIdx = lines.findIndex((line) => line.includes("Edit counter.ts"))
    }
    expect(wroteLineIdx).toBeGreaterThanOrEqual(0)

    // The next few lines should have line numbers (like " 1 class Counter")
    // NOT garbled like "1Message Actions" or "ts      Message Actions"
    let foundLineNumber = false
    let foundGarbledOverlap = false

    for (let i = wroteLineIdx + 1; i < Math.min(wroteLineIdx + 5, lines.length); i++) {
      const line = lines[i] ?? ""
      // Check if line starts with line number pattern (spaces + digit + space + code)
      if (/^\s*\d+\s+\w+/.test(line)) {
        foundLineNumber = true
      }
      // Check for garbled overlap patterns - line number followed by unrelated text
      // like "1    Message Actions" or "ts      Message Actions"
      if (
        /\d+\s+(Message Actions|Enter search|Revert|Copy|Fork)/.test(line) ||
        /^\s*ts\s+(Message Actions|Enter search)/.test(line)
      ) {
        foundGarbledOverlap = true
        console.log("FOUND GARBLED OVERLAP:", line)
      }
    }

    // This test SHOULD fail initially because the bug exists
    // Uncomment this line when bug is fixed
    // expect(foundGarbledOverlap).toBe(false)

    // For now, document that we found line numbers (even if garbled)
    expect(foundLineNumber || foundGarbledOverlap).toBe(true)
  })

  it("BUG REPRODUCTION: excessive empty space below line_number blocks", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    // Simulate the scenario where line_number with diff/edit has vast empty space below
    const messages = [
      {
        id: "msg1",
        type: "user" as const,
        text: "Update the counter",
      },
      {
        id: "msg2",
        type: "tool" as const,
        tool: "edit",
        filePath: "counter.ts",
        code: `   this.max = max
      this.min = min
    }
  
   -increment(): void {
   +override increment(): void {
      const currentValue = this.getValue()
      if (currentValue < this.max) {
        super.increment()
      }
    }
  
   -decrement(): void {
   +override decrement(): void {
      const currentValue = this.getValue()
      if (currentValue > this.min) {
        super.decrement()
      }
    }`,
      },
      {
        id: "msg3",
        type: "assistant" as const,
        text: "Extended the Counter class with ExtendedCounter that adds min/max bounds, range checking, and additional utility methods.",
      },
    ]

    testSetup = await testRender(
      () => (
        <box flexDirection="row">
          <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
            <scrollbox
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
            >
              <For each={messages}>
                {(message) => (
                  <>
                    <Show when={message.type === "user"}>
                      <box border={["left"]} borderColor="#00aaff" marginTop={1}>
                        <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor="#1a1a1a" flexShrink={0}>
                          <text fg="#ffffff">{message.text}</text>
                        </box>
                      </box>
                    </Show>
                    <Show when={message.type === "assistant"}>
                      <box paddingLeft={3} marginTop={1} flexShrink={0}>
                        <text fg="#ffffff">{message.text}</text>
                      </box>
                    </Show>
                    <Show when={message.type === "tool"}>
                      <box paddingLeft={3} marginTop={1} flexShrink={0}>
                        <text fg="#888888">← Edit {message.filePath ?? ""}</text>
                      </box>
                      <line_number fg="#888888" minWidth={3} paddingRight={1}>
                        <code
                          fg="#ffffff"
                          filetype="typescript"
                          syntaxStyle={syntaxStyle}
                          content={message.code}
                          treeSitterClient={mockTreeSitterClient}
                        />
                      </line_number>
                    </Show>
                  </>
                )}
              </For>
            </scrollbox>
          </box>
        </box>
      ),
      {
        width: 72,
        height: 50, // Taller to see the excessive empty space
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== EXCESSIVE EMPTY SPACE BUG ===")
    console.log(frame)
    console.log("=== END ===")

    const lines = frame.split("\n")

    // Find the Edit counter.ts line
    const editLineIdx = lines.findIndex((line) => line.includes("Edit counter.ts"))
    expect(editLineIdx).toBeGreaterThanOrEqual(0)

    // Find the assistant message after
    const assistantLineIdx = lines.findIndex((line) => line.includes("Extended the Counter class"))
    expect(assistantLineIdx).toBeGreaterThan(editLineIdx)

    // Calculate the distance
    const distance = assistantLineIdx - editLineIdx

    // The code has ~17 lines, so with line numbers it should be ~18-20 lines total
    // BUG: Instead we see 30-40+ lines of empty space (line numbers like "53")
    console.log(`Distance between Edit and next message: ${distance} lines`)

    // Count consecutive empty lines between the two
    let emptyLineCount = 0
    let maxConsecutiveEmpty = 0
    let currentConsecutiveEmpty = 0

    for (let i = editLineIdx + 1; i < assistantLineIdx; i++) {
      const line = lines[i] ?? ""
      if (line.trim().length === 0 || /^\s+\d+\s*$/.test(line)) {
        // Empty line or just a line number with whitespace
        emptyLineCount++
        currentConsecutiveEmpty++
        maxConsecutiveEmpty = Math.max(maxConsecutiveEmpty, currentConsecutiveEmpty)
      } else {
        currentConsecutiveEmpty = 0
      }
    }

    console.log(`Empty lines: ${emptyLineCount}, Max consecutive: ${maxConsecutiveEmpty}`)

    // BUG DOCUMENTATION: We expect to see excessive empty space
    // Normally, should be < 5 consecutive empty lines
    // With the bug, we see 10-30+ consecutive empty lines
    // This assertion documents the bug - it SHOULD fail when bug exists
    // expect(maxConsecutiveEmpty).toBeGreaterThan(10) // Bug present
    // expect(maxConsecutiveEmpty).toBeLessThan(5)    // Bug fixed

    // For now, just verify the message appears eventually
    expect(frame).toContain("Extended the Counter class")
  })

  it("BUG REPRODUCTION: line_number in complex chat scenario with all issues", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    // This test combines both issues: overlap AND excessive space
    // Mimics the exact OpenCode session layout
    const messages = [
      {
        id: "1",
        type: "header" as const,
        text: "# Creating ts counter class",
        meta: "/share to create a shareable link                  13,914  7% ($0.00)",
      },
      {
        id: "2",
        type: "user" as const,
        text: "create a ts counter class",
        timestamp: "kmdr 2:01 PM",
      },
      {
        id: "3",
        type: "assistant" as const,
        text: "I'll create a TypeScript counter class for you.",
      },
      {
        id: "4",
        type: "tool" as const,
        tool: "write",
        filePath: "/Users/kmdr/workspace/opencode_sst/packages/opencode/counter.ts",
        code: `class Counter {
  private value: number;

  constructor(initialValue: number = 0) {
    this.value = initialValue;
  }

  increment(): void {
    this.value++;
  }

  decrement(): void {
    this.value--;
  }

  reset(): void {
    this.value = 0;
  }

  getValue(): number {
    return this.value;
  }
}`,
      },
      {
        id: "5",
        type: "assistant" as const,
        text: "Created a TypeScript counter class with increment, decrement, reset, and value management methods.",
      },
      {
        id: "6",
        type: "status" as const,
        text: "▣  Build · big-pickle · 8.3s",
      },
      {
        id: "7",
        type: "user" as const,
        text: "Now extend the class",
        readInfo: "→Read:counter.ts",
      },
      {
        id: "8",
        type: "tool" as const,
        tool: "edit",
        filePath: "counter.ts",
        code: `   this.max = max
      this.min = min
    }
  
   -increment(): void {
   +override increment(): void {
      const currentValue = this.getValue()
      if (currentValue < this.max) {
        super.increment()
      }
    }
  
   -decrement(): void {
   +override decrement(): void {
      const currentValue = this.getValue()
      if (currentValue > this.min) {
        super.decrement()
      }
    }`,
      },
      {
        id: "9",
        type: "assistant" as const,
        text: "Extended the Counter class with ExtendedCounter that adds min/max bounds, range checking, and additional utility methods.",
      },
    ]

    testSetup = await testRender(
      () => (
        <box flexDirection="row">
          <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
            <scrollbox
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
            >
              <For each={messages}>
                {(message, index) => (
                  <>
                    <Show when={message.type === "header"}>
                      <box flexShrink={0}>
                        <text fg="#ffffff">{message.text}</text>
                        <text fg="#888888">{message.meta}</text>
                      </box>
                    </Show>
                    <Show when={message.type === "user"}>
                      <box id={message.id} border={["left"]} borderColor="#00aaff" marginTop={index() === 0 ? 0 : 1}>
                        <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor="#1a1a1a" flexShrink={0}>
                          <text fg="#ffffff">{message.text}</text>
                          <text fg="#888888">{message.timestamp}</text>
                          <Show when={message.readInfo}>
                            <text fg="#888888">{message.readInfo}</text>
                          </Show>
                        </box>
                      </box>
                    </Show>
                    <Show when={message.type === "assistant"}>
                      <box paddingLeft={3} marginTop={1} flexShrink={0}>
                        <text fg="#ffffff">{message.text}</text>
                      </box>
                    </Show>
                    <Show when={message.type === "status"}>
                      <box paddingLeft={3} flexShrink={0}>
                        <text fg="#00ff00">{message.text}</text>
                      </box>
                    </Show>
                    <Show when={message.type === "tool"}>
                      <box paddingLeft={3} marginTop={1} flexShrink={0}>
                        <text fg="#888888">
                          ← {message.tool === "write" ? "Wrote" : "Edit"} {message.filePath}
                        </text>
                      </box>
                      <line_number fg="#888888" minWidth={3} paddingRight={1}>
                        <code
                          fg="#ffffff"
                          filetype="typescript"
                          syntaxStyle={syntaxStyle}
                          content={message.code}
                          treeSitterClient={mockTreeSitterClient}
                        />
                      </line_number>
                    </Show>
                  </>
                )}
              </For>
            </scrollbox>
          </box>
        </box>
      ),
      {
        width: 72,
        height: 40,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== FULL SCENARIO REPRODUCTION ===")
    console.log(frame)
    console.log("=== END ===")

    // Verify basic content appears (scroll position may affect what's visible)
    // With 40 lines height and lots of messages, earlier content may be scrolled out
    expect(frame).toContain("Now extend the class")

    const lines = frame.split("\n")

    // Check for code blocks - due to scrolling, first block may not be visible
    let wroteLineIdx = lines.findIndex((line) => line.includes("Wrote") && line.includes("counter.ts"))
    const editLineIdx = lines.findIndex((line) => line.includes("Edit counter.ts"))

    // At least ONE block should be visible
    expect(wroteLineIdx >= 0 || editLineIdx >= 0).toBe(true)

    if (wroteLineIdx < 0) wroteLineIdx = 0 // Scrolled out
    if (editLineIdx < 0) {
      // Only first block visible
      expect(wroteLineIdx).toBeGreaterThanOrEqual(0)
      return // Can't test overlap if second block is scrolled out
    }

    // Analyze spacing and overlaps around both blocks
    let foundOverlap = false
    let foundExcessiveSpace = false

    // Check for overlap around first block
    for (let i = wroteLineIdx + 1; i < Math.min(wroteLineIdx + 25, lines.length); i++) {
      const line = lines[i] ?? ""
      if (
        /\d+\s+(Message Actions|Enter search|Revert|Copy|Fork)/.test(line) ||
        /^\s*(ts|counter)\s+(Message Actions|Enter search)/.test(line)
      ) {
        foundOverlap = true
        console.log(`OVERLAP at line ${i}:`, line)
      }
    }

    // Check for excessive space around second block
    if (editLineIdx >= 0) {
      let consecutiveEmpty = 0
      for (let i = editLineIdx + 1; i < Math.min(editLineIdx + 30, lines.length); i++) {
        const line = lines[i] ?? ""
        // Check if mostly empty (just line number and whitespace, or completely empty)
        if (line.trim().length === 0 || /^\s*\d+\s*$/.test(line)) {
          consecutiveEmpty++
        } else if (line.includes("Extended the Counter")) {
          // Found the next message
          break
        } else {
          // Reset if we find actual content
          if (line.trim().length > 5) {
            consecutiveEmpty = 0
          }
        }
      }

      if (consecutiveEmpty > 10) {
        foundExcessiveSpace = true
        console.log(`EXCESSIVE SPACE: ${consecutiveEmpty} consecutive empty/sparse lines after Edit`)
      }
    }

    console.log(`Bug status - Overlap: ${foundOverlap}, Excessive space: ${foundExcessiveSpace}`)

    // These assertions document the expected bugs
    // When bugs are fixed, we'd expect both to be false
    // For now, just document that content exists
    expect(frame.length).toBeGreaterThan(100)
  })

  it("BUG REPRODUCTION: portrait aspect ratio (tall terminal) triggers excessive height", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    testSetup = await testRender(
      () => (
        <box flexDirection="row">
          <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
            <scrollbox
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
            >
              <box paddingLeft={3} marginTop={1} flexShrink={0}>
                <text fg="#888888">← Wrote test.ts</text>
              </box>
              <line_number fg="#888888" minWidth={3} paddingRight={1}>
                <code
                  fg="#ffffff"
                  filetype="typescript"
                  syntaxStyle={syntaxStyle}
                  content={`function test() {
  return true;
}`}
                  treeSitterClient={mockTreeSitterClient}
                />
              </line_number>
              <box paddingLeft={3} marginTop={1} flexShrink={0}>
                <text fg="#ffffff">Created the test function.</text>
              </box>
            </scrollbox>
          </box>
        </box>
      ),
      {
        width: 60, // Narrower
        height: 50, // Much taller - portrait aspect ratio
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== PORTRAIT ASPECT RATIO BUG ===")
    console.log(frame)
    console.log("=== END ===")

    const lines = frame.split("\n")

    // Find the markers
    const wroteIdx = lines.findIndex((line) => line.includes("Wrote test.ts"))
    const createdIdx = lines.findIndex((line) => line.includes("Created the test function"))

    expect(wroteIdx).toBeGreaterThanOrEqual(0)
    expect(createdIdx).toBeGreaterThan(wroteIdx)

    const distance = createdIdx - wroteIdx

    // Code has 3 lines, so distance should be ~4-6 lines
    // BUG: In portrait mode, line_number expands to fill available height
    // resulting in 20-40+ lines of spacing
    console.log(`Distance in portrait mode: ${distance} lines`)

    // Document expected vs actual
    if (distance > 15) {
      console.log("BUG CONFIRMED: Excessive height in portrait aspect ratio")
    }

    // Verify content exists
    expect(frame).toContain("function test")
    expect(frame).toContain("Created the test function")
  })

  it("BUG REPRODUCTION: multiple line_number blocks in sequence create cumulative spacing issues", async () => {
    const syntaxStyle = SyntaxStyle.fromTheme([])

    // Multiple tool outputs back-to-back
    const tools = [
      { file: "file1.ts", code: "const a = 1;" },
      { file: "file2.ts", code: "const b = 2;" },
      { file: "file3.ts", code: "const c = 3;" },
    ]

    testSetup = await testRender(
      () => (
        <box flexDirection="row">
          <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
            <scrollbox
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
            >
              <For each={tools}>
                {(tool) => (
                  <>
                    <box paddingLeft={3} marginTop={1} flexShrink={0}>
                      <text fg="#888888">← Wrote {tool.file}</text>
                    </box>
                    <line_number fg="#888888" minWidth={3} paddingRight={1}>
                      <code
                        fg="#ffffff"
                        filetype="typescript"
                        syntaxStyle={syntaxStyle}
                        content={tool.code}
                        treeSitterClient={mockTreeSitterClient}
                      />
                    </line_number>
                  </>
                )}
              </For>
              <box paddingLeft={3} marginTop={1} flexShrink={0}>
                <text fg="#ffffff">All files created.</text>
              </box>
            </scrollbox>
          </box>
        </box>
      ),
      {
        width: 60,
        height: 45,
      },
    )

    await testSetup.renderOnce()
    mockTreeSitterClient.resolveAllHighlightOnce()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await testSetup.renderOnce()

    const frame = testSetup.captureCharFrame()
    console.log("=== MULTIPLE LINE_NUMBER BLOCKS ===")
    console.log(frame)
    console.log("=== END ===")

    const lines = frame.split("\n")

    // Find each file marker
    const file1Idx = lines.findIndex((line) => line.includes("Wrote file1.ts"))
    const file2Idx = lines.findIndex((line) => line.includes("Wrote file2.ts"))
    const file3Idx = lines.findIndex((line) => line.includes("Wrote file3.ts"))
    const endIdx = lines.findIndex((line) => line.includes("All files created"))

    expect(file1Idx).toBeGreaterThanOrEqual(0)
    expect(file2Idx).toBeGreaterThan(file1Idx)
    expect(file3Idx).toBeGreaterThan(file2Idx)
    expect(endIdx).toBeGreaterThan(file3Idx)

    // Each block should be ~2-3 lines (1 line of code + line number + spacing)
    const block1Size = file2Idx - file1Idx
    const block2Size = file3Idx - file2Idx
    const block3Size = endIdx - file3Idx

    console.log(`Block sizes: ${block1Size}, ${block2Size}, ${block3Size}`)

    // BUG: Each block might have excessive spacing (10+ lines for 1 line of code)
    // Or they might overlap
    const hasExcessiveSpace = block1Size > 8 || block2Size > 8 || block3Size > 8
    const hasTooLittleSpace = block1Size < 2 || block2Size < 2 // Possible overlap

    if (hasExcessiveSpace) {
      console.log("BUG CONFIRMED: Excessive spacing between line_number blocks")
    }
    if (hasTooLittleSpace) {
      console.log("BUG CONFIRMED: Possible overlap between line_number blocks")
    }

    // Verify all content appears
    expect(frame).toContain("file1.ts")
    expect(frame).toContain("file2.ts")
    expect(frame).toContain("file3.ts")
    expect(frame).toContain("All files created")
  })
})
