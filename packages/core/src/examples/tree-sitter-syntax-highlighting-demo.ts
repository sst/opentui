import { CliRenderer, createCliRenderer, TextRenderable, BoxRenderable, type ParsedKey } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { parseColor } from "../lib/RGBA"
import { getTreeSitterClient, treeSitterToStyledText, SyntaxStyle } from "../lib/tree-sitter"

// Example TypeScript code to highlight
const exampleCode = `interface User {
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
console.log(\`Adults: \${manager.getAdults().length}\`);`

let renderer: CliRenderer | null = null
let keyboardHandler: ((key: ParsedKey) => void) | null = null
let parentContainer: BoxRenderable | null = null
let codeDisplay: TextRenderable | null = null
let timingText: TextRenderable | null = null
let syntaxStyle: SyntaxStyle | null = null
let currentFiletype: "typescript" | "javascript" = "typescript"

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
    content: "ESC to return | R to re-highlight | T to toggle language | Demonstrating tree-sitter direct highlighting",
    fg: "#888888",
  })
  titleBox.add(instructionsText)

  const codeBox = new BoxRenderable(renderer, {
    id: "code-box",
    borderStyle: "single",
    borderColor: "#6BCF7F",
    backgroundColor: "#0D1117",
    title: "TypeScript Code (Tree-Sitter)",
    titleAlignment: "left",
    paddingLeft: 1,
    border: true,
  })
  parentContainer.add(codeBox)

  // Create syntax style similar to GitHub Dark theme
  syntaxStyle = new SyntaxStyle({
    keyword: { fg: parseColor("#FF7B72"), bold: true }, // red keywords
    string: { fg: parseColor("#A5D6FF") }, // blue strings
    comment: { fg: parseColor("#8B949E"), italic: true }, // gray comments
    number: { fg: parseColor("#79C0FF") }, // light blue numbers
    function: { fg: parseColor("#D2A8FF") }, // purple functions
    type: { fg: parseColor("#FFA657") }, // orange types
    operator: { fg: parseColor("#FF7B72") }, // red operators
    variable: { fg: parseColor("#FFA657") }, // orange variables
    property: { fg: parseColor("#79C0FF") }, // light blue properties
    bracket: { fg: parseColor("#F0F6FC") }, // white brackets
    punctuation: { fg: parseColor("#F0F6FC") }, // white punctuation
    default: { fg: parseColor("#F0F6FC") }, // white default
  })

  // Create code display and timing text directly (like HAST demo)
  codeDisplay = new TextRenderable(renderer, {
    id: "code-display",
    content: "Initializing tree-sitter...",
    bg: "#0D1117",
    selectable: true,
    selectionBg: "#264F78",
    selectionFg: "#FFFFFF",
  })
  codeBox.add(codeDisplay)

  timingText = new TextRenderable(renderer, {
    id: "timing-display",
    content: "Initializing...",
    fg: "#A5D6FF",
  })
  parentContainer.add(timingText)

  await highlightCode(currentFiletype)

  keyboardHandler = (key: ParsedKey) => {
    if (key.name === "r" || key.name === "R") {
      // Re-highlight with current language
      highlightCode(currentFiletype)
    } else if (key.name === "t" || key.name === "T") {
      // Toggle between TypeScript and JavaScript highlighting
      if (currentFiletype === "typescript") {
        currentFiletype = "javascript"
        codeBox.title = "JavaScript Code (Tree-Sitter)"
      } else {
        currentFiletype = "typescript"
        codeBox.title = "TypeScript Code (Tree-Sitter)"
      }
      highlightCode(currentFiletype)
    }
  }

  rendererInstance.keyInput.on("keypress", keyboardHandler)
}

async function highlightCode(filetype: "typescript" | "javascript") {
  if (!syntaxStyle || !codeDisplay || !timingText) return

  try {
    const client = getTreeSitterClient()

    syntaxStyle.clearCache()
    const transformStart = performance.now()

    const styledText = await treeSitterToStyledText(exampleCode, filetype, syntaxStyle, client)

    const transformEnd = performance.now()
    const transformTime = (transformEnd - transformStart).toFixed(2)

    codeDisplay.content = styledText
    timingText.content = `Tree-sitter highlighting: ${transformTime}ms (Cache: ${syntaxStyle.getCacheSize()} entries) | Language: ${filetype.toUpperCase()}`

    console.log(`Tree-sitter highlighting completed in ${transformTime}ms`)
    console.log(`Style cache entries: ${syntaxStyle.getCacheSize()}`)
    console.log(`Styled text chunks: ${styledText.chunks.length}`)
  } catch (error) {
    console.error("Error highlighting code:", error)
    if (timingText) {
      timingText.content = `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyboardHandler) {
    rendererInstance.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  parentContainer?.destroy()
  parentContainer = null
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
