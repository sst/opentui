import {
  CliRenderer,
  createCliRenderer,
  CodeRenderable,
  BoxRenderable,
  TextRenderable,
  type ParsedKey,
  ScrollBoxRenderable,
  LineNumberRenderable,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { parseColor } from "../lib/RGBA"
import { SyntaxStyle } from "../syntax-style"

// Code examples to cycle through
const examples = [
  {
    name: "TypeScript",
    filetype: "typescript" as const,
    code: `interface User {
  name: string;
  age: number;
  email?: string;
}

class UserManager {
  private users: User[] = [];

  constructor(initialUsers: User[] = []) {
    this.users = initialUsers;
  }

  addUser(user: User): void {
    if (!user.name || user.age < 0) {
      throw new Error("Invalid user data");
    }
    this.users.push(user);
  }

  findUser(name: string): User | undefined {
    return this.users.find(u => u.name === name);
  }

  getUserCount(): number {
    return this.users.length;
  }

  // Get users over a certain age
  getAdults(minAge: number = 18): User[] {
    return this.users.filter(user => user.age >= minAge);
  }
}

// Usage example
const manager = new UserManager();
manager.addUser({ name: "Alice", age: 25, email: "alice@example.com" });
manager.addUser({ name: "Bob", age: 17 });

console.log(\`Total users: \${manager.getUserCount()}\`);
console.log(\`Adults: \${manager.getAdults().length}\`);`,
  },
  {
    name: "JavaScript",
    filetype: "javascript" as const,
    code: `// React Component Example
import React, { useState, useEffect } from 'react';

function TodoApp() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    // Load todos from localStorage
    const saved = localStorage.getItem('todos');
    if (saved) {
      setTodos(JSON.parse(saved));
    }
  }, []);

  const addTodo = () => {
    if (input.trim()) {
      const newTodo = {
        id: Date.now(),
        text: input,
        completed: false
      };
      setTodos([...todos, newTodo]);
      setInput('');
    }
  };

  const toggleTodo = (id) => {
    setTodos(todos.map(todo =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  return (
    <div className="todo-app">
      <h1>My Todo List</h1>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && addTodo()}
      />
      <button onClick={addTodo}>Add</button>
      <ul>
        {todos.map(todo => (
          <li key={todo.id} onClick={() => toggleTodo(todo.id)}>
            {todo.completed ? '✓' : '○'} {todo.text}
          </li>
        ))}
      </ul>
    </div>
  );
}`,
  },
  {
    name: "Markdown",
    filetype: "markdown" as const,
    code: `# OpenTUI Documentation

## Getting Started

OpenTUI is a modern terminal UI framework built on **tree-sitter** and WebGPU.

### Features

- 🚀 Fast rendering with WebGPU
- 🎨 Syntax highlighting via tree-sitter
- 📦 Component-based architecture
- ⌨️ Rich keyboard input handling

### Installation

\`\`\`bash
bun install opentui
\`\`\`

### Quick Example

\`\`\`typescript
import { createCliRenderer, BoxRenderable } from 'opentui';

const renderer = await createCliRenderer();
const box = new BoxRenderable(renderer, {
  border: true,
  title: "Hello World"
});
renderer.root.add(box);
\`\`\`

## API Reference

### CodeRenderable

The \`CodeRenderable\` component provides syntax highlighting:

| Property | Type | Description |
|----------|------|-------------|
| content | string | Code to display |
| filetype | string | Language type |
| syntaxStyle | SyntaxStyle | Styling rules |

> **Note**: Tree-sitter parsers are loaded lazily for performance.

CJK: 알겠습니다. Task 에이전트에 ktlint + detekt 검사를 위임하겠습니다.

---

For more info, visit [github.com/opentui](https://github.com)`,
  },
  {
    name: "Zig",
    filetype: "zig" as const,
    code: `const std = @import("std");
const Allocator = std.mem.Allocator;

/// A simple text buffer implementation
pub const TextBuffer = struct {
    allocator: Allocator,
    lines: std.ArrayList([]u8),
    dirty: bool,

    pub fn init(allocator: Allocator) !TextBuffer {
        return TextBuffer{
            .allocator = allocator,
            .lines = std.ArrayList([]u8).init(allocator),
            .dirty = false,
        };
    }

    pub fn deinit(self: *TextBuffer) void {
        for (self.lines.items) |line| {
            self.allocator.free(line);
        }
        self.lines.deinit();
    }

    /// Insert a line at the specified position
    pub fn insertLine(self: *TextBuffer, line_num: usize, content: []const u8) !void {
        const line = try self.allocator.dupe(u8, content);
        errdefer self.allocator.free(line);

        try self.lines.insert(line_num, line);
        self.dirty = true;
    }

    /// Get the content of a line
    pub fn getLine(self: *const TextBuffer, line_num: usize) ?[]const u8 {
        if (line_num >= self.lines.items.len) return null;
        return self.lines.items[line_num];
    }

    /// Count total characters in buffer
    pub fn countChars(self: *const TextBuffer) usize {
        var total: usize = 0;
        for (self.lines.items) |line| {
            total += line.len;
        }
        return total;
    }
};

test "TextBuffer basic operations" {
    const allocator = std.testing.allocator;
    var buffer = try TextBuffer.init(allocator);
    defer buffer.deinit();

    try buffer.insertLine(0, "Hello, World!");
    try buffer.insertLine(1, "This is Zig.");

    try std.testing.expectEqual(@as(usize, 2), buffer.lines.items.len);
    try std.testing.expect(buffer.dirty);
    
    const first_line = buffer.getLine(0).?;
    try std.testing.expectEqualStrings("Hello, World!", first_line);
}`,
  },
]

let renderer: CliRenderer | null = null
let keyboardHandler: ((key: ParsedKey) => void) | null = null
let parentContainer: BoxRenderable | null = null
let codeScrollBox: ScrollBoxRenderable | null = null
let codeDisplay: CodeRenderable | null = null
let codeWithLineNumbers: LineNumberRenderable | null = null
let timingText: TextRenderable | null = null
let syntaxStyle: SyntaxStyle | null = null
let helpModal: BoxRenderable | null = null
let currentExampleIndex = 0
let concealEnabled = true
let highlightsEnabled = false
let diagnosticsEnabled = false
let showingHelp = false

export async function run(rendererInstance: CliRenderer): Promise<void> {
  renderer = rendererInstance
  renderer.start()
  renderer.setBackgroundColor("#0D1117")

  parentContainer = new BoxRenderable(renderer, {
    id: "parent-container",
    zIndex: 10,
    padding: 1,
  })
  renderer.root.add(parentContainer)

  const titleBox = new BoxRenderable(renderer, {
    id: "title-box",
    height: 3,
    borderStyle: "double",
    borderColor: "#4ECDC4",
    backgroundColor: "#0D1117",
    title: "Code Demo - Syntax Highlighting + Line Numbers",
    titleAlignment: "center",
    border: true,
  })
  parentContainer.add(titleBox)

  const instructionsText = new TextRenderable(renderer, {
    id: "instructions",
    content: "ESC to return | Press ? for keybindings",
    fg: "#888888",
  })
  titleBox.add(instructionsText)

  // Create help modal (hidden by default)
  helpModal = new BoxRenderable(renderer, {
    id: "help-modal",
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 60,
    height: 16,
    marginLeft: -30, // Center horizontally
    marginTop: -8, // Center vertically
    border: true,
    borderStyle: "double",
    borderColor: "#4ECDC4",
    backgroundColor: "#0D1117",
    title: "Keybindings",
    titleAlignment: "center",
    padding: 2,
    zIndex: 100,
    visible: false,
  })

  const helpContent = new TextRenderable(renderer, {
    id: "help-content",
    content: `Navigation:
  ← → : Switch between code examples

View Controls:
  L : Toggle line numbers
  C : Toggle concealment (Markdown links, etc.)

Diff Highlighting:
  H : Toggle diff highlights (+ green, - red)

Diagnostics:
  D : Toggle diagnostic signs (❌ ⚠️  💡)

Other:
  ? : Toggle this help screen
  ESC : Return to main menu`,
    fg: "#E6EDF3",
  })

  helpModal.add(helpContent)
  renderer.root.add(helpModal)

  codeScrollBox = new ScrollBoxRenderable(renderer, {
    id: "code-scroll-box",
    borderStyle: "single",
    borderColor: "#6BCF7F",
    backgroundColor: "#0D1117",
    title: `${examples[currentExampleIndex].name} (CodeRenderable)`,
    titleAlignment: "left",
    border: true,
    scrollY: true,
    scrollX: false,
    flexGrow: 1,
    flexShrink: 1,
  })
  parentContainer.add(codeScrollBox)

  // Create syntax style similar to GitHub Dark theme
  syntaxStyle = SyntaxStyle.fromStyles({
    // JS/TS styles
    keyword: { fg: parseColor("#FF7B72"), bold: true },
    "keyword.import": { fg: parseColor("#FF7B72"), bold: true },
    "keyword.coroutine": { fg: parseColor("#FF9492") },
    "keyword.operator": { fg: parseColor("#FF7B72") },
    string: { fg: parseColor("#A5D6FF") },
    comment: { fg: parseColor("#8B949E"), italic: true },
    number: { fg: parseColor("#79C0FF") },
    boolean: { fg: parseColor("#79C0FF") },
    constant: { fg: parseColor("#79C0FF") },
    function: { fg: parseColor("#D2A8FF") },
    "function.call": { fg: parseColor("#D2A8FF") },
    "function.method.call": { fg: parseColor("#D2A8FF") },
    constructor: { fg: parseColor("#FFA657") },
    type: { fg: parseColor("#FFA657") },
    operator: { fg: parseColor("#FF7B72") },
    variable: { fg: parseColor("#E6EDF3") },
    "variable.member": { fg: parseColor("#79C0FF") },
    property: { fg: parseColor("#79C0FF") },
    bracket: { fg: parseColor("#F0F6FC") },
    "punctuation.bracket": { fg: parseColor("#F0F6FC") },
    "punctuation.delimiter": { fg: parseColor("#C9D1D9") },
    punctuation: { fg: parseColor("#F0F6FC") },

    // Markdown specific styles (matching tree-sitter capture names)
    "markup.heading": { fg: parseColor("#58A6FF"), bold: true },
    "markup.heading.1": { fg: parseColor("#00FF88"), bold: true, underline: true },
    "markup.heading.2": { fg: parseColor("#00D7FF"), bold: true },
    "markup.heading.3": { fg: parseColor("#FF69B4") },
    "markup.heading.4": { fg: parseColor("#FFA657"), bold: true },
    "markup.heading.5": { fg: parseColor("#FF7B72"), bold: true },
    "markup.heading.6": { fg: parseColor("#8B949E"), bold: true },
    "markup.bold": { fg: parseColor("#F0F6FC"), bold: true },
    "markup.strong": { fg: parseColor("#F0F6FC"), bold: true },
    "markup.italic": { fg: parseColor("#F0F6FC"), italic: true },
    "markup.list": { fg: parseColor("#FF7B72") },
    "markup.quote": { fg: parseColor("#8B949E"), italic: true },
    "markup.raw": { fg: parseColor("#A5D6FF"), bg: parseColor("#161B22") },
    "markup.raw.block": { fg: parseColor("#A5D6FF"), bg: parseColor("#161B22") },
    "markup.raw.inline": { fg: parseColor("#A5D6FF"), bg: parseColor("#161B22") },
    "markup.link": { fg: parseColor("#58A6FF"), underline: true },
    "markup.link.label": { fg: parseColor("#A5D6FF"), underline: true },
    "markup.link.url": { fg: parseColor("#58A6FF"), underline: true },
    label: { fg: parseColor("#7EE787") },
    spell: { fg: parseColor("#E6EDF3") },
    nospell: { fg: parseColor("#E6EDF3") },
    conceal: { fg: parseColor("#6E7681") },
    "punctuation.special": { fg: parseColor("#8B949E") },

    default: { fg: parseColor("#E6EDF3") },
  })

  // Create code display using CodeRenderable wrapped in LineNumberRenderable
  codeDisplay = new CodeRenderable(renderer, {
    id: "code-display",
    content: examples[currentExampleIndex].code,
    filetype: examples[currentExampleIndex].filetype,
    syntaxStyle,
    selectable: true,
    selectionBg: "#264F78",
    selectionFg: "#FFFFFF",
    conceal: concealEnabled,
    width: "100%",
  })

  codeWithLineNumbers = new LineNumberRenderable(renderer, {
    id: "code-with-lines",
    target: codeDisplay,
    minWidth: 3,
    paddingRight: 1,
    fg: "#6b7280",
    bg: "#161b22",
    width: "100%",
  })

  codeScrollBox.add(codeWithLineNumbers)

  timingText = new TextRenderable(renderer, {
    id: "timing-display",
    content: "Initializing...",
    fg: "#A5D6FF",
    wrapMode: "word",
    flexShrink: 0,
  })
  parentContainer.add(timingText)

  const updateTimingText = () => {
    if (timingText) {
      const lineNums = codeWithLineNumbers?.showLineNumbers ? "ON" : "OFF"
      const diff = highlightsEnabled ? "ON" : "OFF"
      const diag = diagnosticsEnabled ? "ON" : "OFF"
      timingText.content = `${examples[currentExampleIndex].name} (${currentExampleIndex + 1}/${examples.length}) | Conceal: ${concealEnabled ? "ON" : "OFF"} | Lines: ${lineNums} | Diff: ${diff} | Diag: ${diag}`
    }
  }

  updateTimingText()

  keyboardHandler = (key: ParsedKey) => {
    // Handle help modal toggle
    if (key.raw === "?" && helpModal) {
      showingHelp = !showingHelp
      helpModal.visible = showingHelp
      return
    }

    // Don't process other keys when help is showing
    if (showingHelp) return

    if (key.name === "right" || key.name === "left") {
      // Navigate between examples
      if (key.name === "right") {
        currentExampleIndex = (currentExampleIndex + 1) % examples.length
      } else {
        currentExampleIndex = (currentExampleIndex - 1 + examples.length) % examples.length
      }

      const example = examples[currentExampleIndex]
      if (codeScrollBox) {
        codeScrollBox.title = `${example.name} (CodeRenderable)`
      }

      if (codeDisplay) {
        codeDisplay.content = example.code
        codeDisplay.filetype = example.filetype
        updateTimingText()
      }
    } else if (key.name === "c" && !key.ctrl && !key.meta) {
      // Toggle conceal
      concealEnabled = !concealEnabled
      if (codeDisplay) {
        codeDisplay.conceal = concealEnabled
      }
      updateTimingText()
    } else if (key.name === "l" && !key.ctrl && !key.meta) {
      // Toggle line numbers
      if (codeWithLineNumbers) {
        codeWithLineNumbers.showLineNumbers = !codeWithLineNumbers.showLineNumbers
      }
      updateTimingText()
    } else if (key.name === "h" && !key.ctrl && !key.meta) {
      // Toggle diff highlights
      if (codeWithLineNumbers && codeDisplay) {
        highlightsEnabled = !highlightsEnabled
        if (highlightsEnabled) {
          // Add diff-style highlights for demonstration
          const lineCount = codeDisplay.virtualLineCount
          for (let i = 0; i < lineCount; i += 7) {
            if (i % 14 === 0) {
              codeWithLineNumbers.setLineColor(i, "#1a4d1a")
              codeWithLineNumbers.setLineSign(i, { after: " +", afterColor: "#22c55e" })
            } else {
              codeWithLineNumbers.setLineColor(i, "#4d1a1a")
              codeWithLineNumbers.setLineSign(i, { after: " -", afterColor: "#ef4444" })
            }
          }
        } else {
          codeWithLineNumbers.clearAllLineColors()
          // Clear only after signs
          const currentSigns = codeWithLineNumbers.getLineSigns()
          for (const [line, sign] of currentSigns) {
            if (sign.after) {
              if (sign.before) {
                codeWithLineNumbers.setLineSign(line, { before: sign.before, beforeColor: sign.beforeColor })
              } else {
                codeWithLineNumbers.clearLineSign(line)
              }
            }
          }
        }
      }
      updateTimingText()
    } else if (key.name === "d" && !key.ctrl && !key.meta) {
      // Toggle diagnostics
      if (codeWithLineNumbers && codeDisplay) {
        diagnosticsEnabled = !diagnosticsEnabled
        if (diagnosticsEnabled) {
          // Add diagnostic signs for demonstration
          const lineCount = codeDisplay.virtualLineCount
          for (let i = 0; i < lineCount; i += 9) {
            if (i % 27 === 0) {
              codeWithLineNumbers.setLineSign(i, { before: "❌", beforeColor: "#ef4444" })
            } else if (i % 18 === 0) {
              codeWithLineNumbers.setLineSign(i, { before: "⚠️", beforeColor: "#f59e0b" })
            } else {
              codeWithLineNumbers.setLineSign(i, { before: "💡", beforeColor: "#3b82f6" })
            }
          }
        } else {
          // Clear only before signs
          const currentSigns = codeWithLineNumbers.getLineSigns()
          for (const [line, sign] of currentSigns) {
            if (sign.before) {
              if (sign.after) {
                codeWithLineNumbers.setLineSign(line, { after: sign.after, afterColor: sign.afterColor })
              } else {
                codeWithLineNumbers.clearLineSign(line)
              }
            }
          }
        }
      }
      updateTimingText()
    }
  }

  rendererInstance.keyInput.on("keypress", keyboardHandler)
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyboardHandler) {
    rendererInstance.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  parentContainer?.destroy()
  helpModal?.destroy()
  parentContainer = null
  codeScrollBox = null
  codeDisplay = null
  codeWithLineNumbers = null
  timingText = null
  syntaxStyle = null
  helpModal = null

  renderer = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
