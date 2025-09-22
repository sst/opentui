const encoder = new TextEncoder()
const decoder = new TextDecoder()

type Command = string[]

enum Platform {
  Mac = "darwin",
  Windows = "win32",
}

function runCommand(cmd: Command, input?: string): { success: boolean; output?: string } {
  try {
    const result = Bun.spawnSync({
      cmd,
      stdin: input ? encoder.encode(input) : undefined,
      stdout: "pipe",
      stderr: "inherit",
    })

    if (result.success) {
      const out = result.stdout ? decoder.decode(result.stdout) : ""
      return { success: true, output: out }
    }
  } catch (error) {
    // Command not available; ignore
  }

  return { success: false }
}

function platformCopyCommands(): Command[] {
  switch (process.platform) {
    case Platform.Mac:
      return [["pbcopy"]]
    case Platform.Windows:
      return [["cmd", "/c", "clip"]]
    default:
      return [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]]
  }
}

function platformPasteCommands(): Command[] {
  switch (process.platform) {
    case Platform.Mac:
      return [["pbpaste"]]
    case Platform.Windows:
      return [["powershell", "-NoProfile", "-Command", "Get-Clipboard"]]
    default:
      return [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]
  }
}

export function copyTextToClipboard(text: string): boolean {
  for (const cmd of platformCopyCommands()) {
    const result = runCommand(cmd, text)
    if (result.success) {
      return true
    }
  }
  return false
}

export function pasteTextFromClipboard(): string {
  for (const cmd of platformPasteCommands()) {
    const result = runCommand(cmd)
    if (result.success && typeof result.output === "string") {
      return result.output.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    }
  }
  return ""
}
