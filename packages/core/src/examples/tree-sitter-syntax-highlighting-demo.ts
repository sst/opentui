import {
  CliRenderer,
  createCliRenderer,
  CodeRenderable,
  BoxRenderable,
  TextRenderable,
  type ParsedKey,
  ScrollBoxRenderable,
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

---

For more info, visit [github.com/opentui](https://github.com)`,
  },
]

let renderer: CliRenderer | null = null
let keyboardHandler: ((key: ParsedKey) => void) | null = null
let parentContainer: BoxRenderable | null = null
let codeScrollBox: ScrollBoxRenderable | null = null
let codeDisplay: CodeRenderable | null = null
let timingText: TextRenderable | null = null
let syntaxStyle: SyntaxStyle | null = null
let currentExampleIndex = 0

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
    title: "Tree-Sitter Syntax Highlighting Demo",
    titleAlignment: "center",
    border: true,
  })
  parentContainer.add(titleBox)

  const instructionsText = new TextRenderable(renderer, {
    id: "instructions",
    content: "ESC to return | ← → to switch examples | Demonstrating CodeRenderable with tree-sitter highlighting",
    fg: "#888888",
  })
  titleBox.add(instructionsText)

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
    contentOptions: {
      paddingLeft: 1,
    },
  })
  parentContainer.add(codeScrollBox)

  // Create syntax style similar to GitHub Dark theme
  syntaxStyle = SyntaxStyle.fromStyles({
    // JS/TS styles
    keyword: { fg: parseColor("#FF7B72"), bold: true }, // red keywords
    "keyword.import": { fg: parseColor("#FF7B72"), bold: true }, // red import/export
    "keyword.coroutine": { fg: parseColor("#FF9492") }, // lighter red for async/await
    "keyword.operator": { fg: parseColor("#FF7B72") }, // red operator keywords (new, typeof, etc)
    string: { fg: parseColor("#A5D6FF") }, // blue strings
    comment: { fg: parseColor("#8B949E"), italic: true }, // gray comments
    number: { fg: parseColor("#79C0FF") }, // light blue numbers
    boolean: { fg: parseColor("#79C0FF") }, // light blue booleans
    constant: { fg: parseColor("#79C0FF") }, // light blue constants
    function: { fg: parseColor("#D2A8FF") }, // purple functions
    "function.call": { fg: parseColor("#D2A8FF") }, // purple function calls
    "function.method.call": { fg: parseColor("#D2A8FF") }, // purple method calls
    constructor: { fg: parseColor("#FFA657") }, // orange constructors
    type: { fg: parseColor("#FFA657") }, // orange types
    operator: { fg: parseColor("#FF7B72") }, // red operators
    variable: { fg: parseColor("#E6EDF3") }, // light gray variables
    "variable.member": { fg: parseColor("#79C0FF") }, // light blue properties/members
    property: { fg: parseColor("#79C0FF") }, // light blue properties
    bracket: { fg: parseColor("#F0F6FC") }, // white brackets
    "punctuation.bracket": { fg: parseColor("#F0F6FC") }, // white brackets
    "punctuation.delimiter": { fg: parseColor("#C9D1D9") }, // light gray delimiters (commas, semicolons)
    punctuation: { fg: parseColor("#F0F6FC") }, // white punctuation

    // Markdown specific styles (matching tree-sitter capture names)
    "markup.heading": { fg: parseColor("#58A6FF"), bold: true }, // medium blue generic headings
    "markup.heading.1": { fg: parseColor("#79C0FF"), bold: true }, // bright blue H1
    "markup.heading.2": { fg: parseColor("#A5D6FF"), bold: true }, // light blue H2
    "markup.heading.3": { fg: parseColor("#D2A8FF"), bold: true }, // purple H3
    "markup.heading.4": { fg: parseColor("#FFA657"), bold: true }, // orange H4
    "markup.heading.5": { fg: parseColor("#FF7B72"), bold: true }, // red H5
    "markup.heading.6": { fg: parseColor("#8B949E"), bold: true }, // gray H6
    "markup.bold": { fg: parseColor("#F0F6FC"), bold: true }, // white bold
    "markup.strong": { fg: parseColor("#F0F6FC"), bold: true }, // white strong (same as bold)
    "markup.italic": { fg: parseColor("#F0F6FC"), italic: true }, // white italic
    "markup.list": { fg: parseColor("#FF7B72") }, // red list markers
    "markup.quote": { fg: parseColor("#8B949E"), italic: true }, // gray quotes
    "markup.raw": { fg: parseColor("#A5D6FF"), bg: parseColor("#161B22") }, // blue inline code
    "markup.raw.block": { fg: parseColor("#A5D6FF"), bg: parseColor("#161B22") }, // blue code blocks with dark bg
    "markup.raw.inline": { fg: parseColor("#A5D6FF"), bg: parseColor("#161B22") }, // blue inline code
    "markup.link": { fg: parseColor("#58A6FF"), underline: true }, // blue links
    "markup.link.label": { fg: parseColor("#A5D6FF") }, // light blue link labels
    "markup.link.url": { fg: parseColor("#58A6FF") }, // blue URLs
    label: { fg: parseColor("#7EE787") }, // green language labels in code blocks
    spell: { fg: parseColor("#E6EDF3") }, // light gray normal text
    nospell: { fg: parseColor("#E6EDF3") }, // light gray nospell text
    conceal: { fg: parseColor("#6E7681") }, // darker gray for concealed chars (markdown syntax)
    "punctuation.special": { fg: parseColor("#8B949E") }, // gray special punctuation

    default: { fg: parseColor("#E6EDF3") }, // light gray default (distinct from white)
  })

  // Create code display using CodeRenderable
  codeDisplay = new CodeRenderable(renderer, {
    id: "code-display",
    content: examples[currentExampleIndex].code,
    filetype: examples[currentExampleIndex].filetype,
    syntaxStyle,
    bg: "#0D1117",
    selectable: true,
    selectionBg: "#264F78",
    selectionFg: "#FFFFFF",
  })
  codeScrollBox.add(codeDisplay)

  timingText = new TextRenderable(renderer, {
    id: "timing-display",
    content: "Initializing...",
    fg: "#A5D6FF",
  })
  parentContainer.add(timingText)

  timingText.content = `Using CodeRenderable with ${examples[currentExampleIndex].name} highlighting (${currentExampleIndex + 1}/${examples.length})`

  keyboardHandler = (key: ParsedKey) => {
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
        if (timingText) {
          timingText.content = `Using CodeRenderable with ${example.name} highlighting (${currentExampleIndex + 1}/${examples.length})`
        }
      }
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
  parentContainer = null
  codeScrollBox = null
  codeDisplay = null
  timingText = null
  syntaxStyle = null

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
