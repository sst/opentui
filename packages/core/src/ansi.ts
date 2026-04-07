export const ANSI = {
  switchToAlternateScreen: "\x1b[?1049h",
  switchToMainScreen: "\x1b[?1049l",
  reset: "\x1b[0m",

  scrollDown: (lines: number) => `\x1b[${lines}T`,
  scrollUp: (lines: number) => `\x1b[${lines}S`,

  moveCursor: (row: number, col: number) => `\x1b[${row};${col}H`,
  moveCursorAndClear: (row: number, col: number) => `\x1b[${row};${col}H\x1b[J`,

  setRgbBackground: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
  setAnsi16Background: (index: number) => index < 8 ? `\x1b[${40 + index}m` : `\x1b[${100 + (index - 8)}m`,
  setAnsi16Foreground: (index: number) => index < 8 ? `\x1b[${30 + index}m` : `\x1b[${90 + (index - 8)}m`,
  resetBackground: "\x1b[49m",

  // Bracketed paste mode
  bracketedPasteStart: "\u001b[200~",
  bracketedPasteEnd: "\u001b[201~",
}
