export const ANSI = {
  switchToAlternateScreen: "\x1b[?1049h",
  switchToMainScreen: "\x1b[?1049l",
  reset: "\x1b[0m",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",

  resetCursorColor: "\x1b]12;default\x07",
  saveCursorState: "\x1b[s",
  restoreCursorState: "\x1b[u",

  queryPixelSize: "\u001b[14t",

  scrollDown: (lines: number) => `\x1b[${lines}T`,
  scrollUp: (lines: number) => `\x1b[${lines}S`,

  moveCursor: (row: number, col: number) => `\x1b[${row};${col}H`,
  moveCursorAndClear: (row: number, col: number) => `\x1b[${row};${col}H\x1b[J`,
  clearFromCursor: "\x1b[J",

  setRgbBackground: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
  resetBackground: "\x1b[49m",

  enableMouseTracking: "\x1b[?1000h",
  disableMouseTracking: "\x1b[?1000l",
  enableButtonEventTracking: "\x1b[?1002h",
  disableButtonEventTracking: "\x1b[?1002l",
  enableAnyEventTracking: "\x1b[?1003h",
  disableAnyEventTracking: "\x1b[?1003l",
  enableSGRMouseMode: "\x1b[?1006h",
  disableSGRMouseMode: "\x1b[?1006l",

  makeRoomForRenderer: (height: number) => "\n".repeat(height) + `\x1b[${height}A`,
  clearRendererSpace: (height: number) => `\x1b[${height}A\x1b[1G\x1b[J`,
}
