export const ANSI = {
  switchToAlternateScreen: "\x1b[?1049h",
  switchToMainScreen: "\x1b[?1049l",
  reset: "\x1b[0m",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",

  resetCursorColor: "\x1b]12;default\x07",
  saveCursorState: "\x1b[s",
  restoreCursorState: "\x1b[u",

  scrollDown: (lines: number) => `\x1b[${lines}T`,
  scrollUp: (lines: number) => `\x1b[${lines}S`,

  moveCursor: (row: number, col: number) => `\x1b[${row};${col}H`,
  moveCursorAndClear: (row: number, col: number) => `\x1b[${row};${col}H\x1b[J`,
  clearFromCursor: "\x1b[J",

  setRgbBackground: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
  resetBackground: "\x1b[49m",

  clearRendererSpace: (height: number) => `\x1b[${height}A\x1b[1G\x1b[J`,

  // Bracketed paste mode
  bracketedPasteStart: "\u001b[200~",
  bracketedPasteEnd: "\u001b[201~",
}
