#!/usr/bin/env bun
//
// OpenTUI x xterm.js -- shared Pong in the browser.
//
// Starts a Bun HTTP + WebSocket server that serves xterm.js and mirrors one
// server-side Pong match across every connected browser tab. Each tab gets its
// own CliRenderer wired to WebSocket-backed stdin/stdout streams: renderer
// output is allocated a NativeSpanFeed and sent as ANSI bytes to xterm.js, while
// keyboard bytes and resize events flow back to CliRenderer.stdin and
// renderer.resize().
//
// Run:
//   bun run packages/examples/src/xterm-web-demo/server.ts
//   PORT=8080 bun run packages/examples/src/xterm-web-demo/server.ts
// Then open http://localhost:3000/ or the configured PORT.
//
// Controls: Up/k or Down/j move, Space serves/pauses/resumes, r resets, q or
// Ctrl+C quits the tab session.

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Readable, Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import type { ServerWebSocket } from "bun"

import {
  BoxRenderable,
  CliRenderEvents,
  CliRenderer,
  StyledText,
  TextRenderable,
  createCliRenderer,
  dim,
  fg,
  type KeyEvent,
  type TextChunk,
} from "@opentui/core"

const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEX_HTML = readFileSync(join(__dirname, "index.html"), "utf8")

interface Session {
  renderer: CliRenderer | null
  stdin: Readable | null
  scoreText: TextRenderable | null
  metaText: TextRenderable | null
  boardText: TextRenderable | null
  hintText: TextRenderable | null
  cols: number
  rows: number
  sessionId: string
  theme: SessionTheme
  closed: boolean
  pendingWrite: ((error?: Error | null) => void) | null
}

interface SessionTheme {
  borderColor: string
  cardColor: string
  scoreColor: string
  accentColor: string
}

type RoundState = "serve" | "live" | "paused"

const SESSION_THEMES: SessionTheme[] = [
  {
    borderColor: "#38bdf8",
    cardColor: "#162235",
    scoreColor: "#fde68a",
    accentColor: "#67e8f9",
  },
  {
    borderColor: "#f472b6",
    cardColor: "#30182a",
    scoreColor: "#f9a8d4",
    accentColor: "#f5d0fe",
  },
  {
    borderColor: "#a78bfa",
    cardColor: "#261f4d",
    scoreColor: "#ddd6fe",
    accentColor: "#c4b5fd",
  },
]

const ACTIVE_SESSIONS = new Set<ServerWebSocket<Session>>()

const BOARD_WIDTH = 40
const BOARD_HEIGHT = 12
const BOARD_PIXEL_WIDTH = BOARD_WIDTH * 2
const BOARD_PIXEL_HEIGHT = BOARD_HEIGHT * 4
const CARD_WIDTH = 52
const CARD_HEIGHT = 23
const PADDLE_HEIGHT = 3
const PADDLE_HALF_HEIGHT = (PADDLE_HEIGHT - 1) / 2
const PADDLE_PIXEL_WIDTH = 2
const PADDLE_PIXEL_HEIGHT = PADDLE_HEIGHT * 4
const PLAYER_PADDLE_X = 1
const CPU_PADDLE_X = BOARD_WIDTH - 2
const SERVE_DELAY_TICKS = 18
const GAME_TICK_MS = 33
const BALL_SPEED_X = 0.42
const BALL_VERTICAL_SPEEDS = [-0.18, -0.12, 0.12, 0.18] as const
const PLAYER_PADDLE_STEP = 0.75
const CPU_PADDLE_SPEED = 0.14
const CPU_CENTER_SPEED = 0.06
const CPU_REACTION_X = BOARD_WIDTH * 0.58
const CPU_AIM_OFFSET_RANGE = 1.75
const TRAIL_LENGTH = 6
const BRAILLE_DOT_MASKS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const
const BOARD_STYLE_EMPTY = 0
const BOARD_STYLE_CENTER = 1
const BOARD_STYLE_TRAIL_3 = 2
const BOARD_STYLE_TRAIL_2 = 3
const BOARD_STYLE_TRAIL_1 = 4
const BOARD_STYLE_CPU_PADDLE = 5
const BOARD_STYLE_PLAYER_PADDLE = 6
const BOARD_STYLE_BALL = 7

let playerScore = 0
let cpuScore = 0
let rallyCount = 0
let playerPaddleY = (BOARD_HEIGHT - 1) / 2
let cpuPaddleY = (BOARD_HEIGHT - 1) / 2
let ballX = (BOARD_WIDTH - 1) / 2
let ballY = (BOARD_HEIGHT - 1) / 2
let ballVX = 0
let ballVY = 0
let serveDirection: -1 | 1 = -1
let serveTicksRemaining = SERVE_DELAY_TICKS
let roundState: RoundState = "serve"
let ballTrail: Array<{ x: number; y: number }> = []
let cpuAimOffset = 0

function createSessionId() {
  return crypto.randomUUID().slice(0, 4).toUpperCase()
}

function pickSessionTheme(sessionId: string) {
  return SESSION_THEMES[sessionId.charCodeAt(0) % SESSION_THEMES.length]
}

function finishPendingWrite(session: Session) {
  const pendingWrite = session.pendingWrite
  if (!pendingWrite) return
  session.pendingWrite = null
  pendingWrite()
}

function setTextContent(renderable: TextRenderable | null, content: StyledText | string) {
  if (!renderable) return
  try {
    renderable.content = content
  } catch {
    // Renderer teardown can destroy TextBuffer instances before the WS close
    // callback clears our references.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function clampPaddle(value: number) {
  return clamp(value, PADDLE_HALF_HEIGHT, BOARD_HEIGHT - 1 - PADDLE_HALF_HEIGHT)
}

function formatScore(value: number) {
  return value.toString().padStart(2, "0")
}

function pickServeDirection(): -1 | 1 {
  return Math.random() > 0.5 ? 1 : -1
}

function pickServeLift() {
  return BALL_VERTICAL_SPEEDS[Math.floor(Math.random() * BALL_VERTICAL_SPEEDS.length)]
}

function rollCpuAimOffset() {
  cpuAimOffset = (Math.random() * 2 - 1) * CPU_AIM_OFFSET_RANGE
}

function resetBall(direction: -1 | 1) {
  serveDirection = direction
  serveTicksRemaining = SERVE_DELAY_TICKS
  roundState = "serve"
  rallyCount = 0
  ballTrail = []
  rollCpuAimOffset()
  ballX = (BOARD_WIDTH - 1) / 2
  ballY = (BOARD_HEIGHT - 1) / 2
  ballVX = 0
  ballVY = 0
}

function resetSharedGame() {
  playerScore = 0
  cpuScore = 0
  playerPaddleY = (BOARD_HEIGHT - 1) / 2
  cpuPaddleY = (BOARD_HEIGHT - 1) / 2
  resetBall(pickServeDirection())
}

function launchBall() {
  roundState = "live"
  ballVX = BALL_SPEED_X * serveDirection
  ballVY = pickServeLift()

  if (serveDirection === 1) {
    rollCpuAimOffset()
  }
}

function togglePause() {
  if (roundState === "serve") {
    launchBall()
    return
  }

  if (roundState === "paused") {
    roundState = "live"
    return
  }

  roundState = "paused"
}

function movePlayerPaddle(delta: number) {
  playerPaddleY = clampPaddle(playerPaddleY + delta)
}

function moveCpuPaddle() {
  const centerY = (BOARD_HEIGHT - 1) / 2
  const trackingBall = roundState === "live" && ballVX > 0 && ballX >= CPU_REACTION_X
  const targetY = trackingBall ? clampPaddle(ballY + cpuAimOffset) : centerY
  const speed = trackingBall ? CPU_PADDLE_SPEED : CPU_CENTER_SPEED
  const delta = targetY - cpuPaddleY
  if (Math.abs(delta) < speed) {
    cpuPaddleY = targetY
    return
  }

  cpuPaddleY = clampPaddle(cpuPaddleY + Math.sign(delta) * speed)
}

function isPaddleHit(centerY: number, targetY: number) {
  return Math.abs(targetY - centerY) <= PADDLE_HALF_HEIGHT + 0.15
}

function bounceOffPaddle(centerY: number, direction: -1 | 1, targetY: number) {
  const offset = clamp(targetY - centerY, -PADDLE_HALF_HEIGHT, PADDLE_HALF_HEIGHT)
  const horizontalSpeed = BALL_SPEED_X + Math.min(rallyCount, 8) * 0.03
  ballVX = horizontalSpeed * direction
  ballVY = clamp(offset * 0.12 + ballVY * 0.45, -0.42, 0.42)

  if (direction === 1) {
    rollCpuAimOffset()
  }

  if (Math.abs(ballVY) < 0.08) {
    const sign = offset === 0 ? (Math.random() > 0.5 ? 1 : -1) : Math.sign(offset)
    ballVY = 0.08 * sign
  }

  rallyCount += 1
}

function scorePoint(winner: "player" | "cpu") {
  if (winner === "player") {
    playerScore += 1
    resetBall(1)
    return
  }

  cpuScore += 1
  resetBall(-1)
}

function recordBallTrail() {
  ballTrail.unshift({ x: ballX, y: ballY })
  if (ballTrail.length > TRAIL_LENGTH) {
    ballTrail.length = TRAIL_LENGTH
  }
}

function plainChunk(text: string): TextChunk {
  return {
    __isChunk: true,
    text,
    attributes: 0,
  }
}

function styleBoardRun(style: number, text: string): TextChunk {
  if (style === BOARD_STYLE_EMPTY) {
    return plainChunk(text)
  }

  if (style === BOARD_STYLE_CENTER) {
    return dim(fg("#475569")(text))
  }

  if (style === BOARD_STYLE_TRAIL_3) {
    return dim(fg("#1d4ed8")(text))
  }

  if (style === BOARD_STYLE_TRAIL_2) {
    return dim(fg("#38bdf8")(text))
  }

  if (style === BOARD_STYLE_TRAIL_1) {
    return fg("#93c5fd")(text)
  }

  if (style === BOARD_STYLE_CPU_PADDLE) {
    return fg("#c084fc")(text)
  }

  if (style === BOARD_STYLE_PLAYER_PADDLE) {
    return fg("#67e8f9")(text)
  }

  return fg("#fde68a")(text)
}

function setBraillePixel(maskBuffer: Uint8Array, styleBuffer: Uint8Array, x: number, y: number, style: number) {
  if (x < 0 || y < 0 || x >= BOARD_PIXEL_WIDTH || y >= BOARD_PIXEL_HEIGHT) return

  const cellX = Math.floor(x / 2)
  const cellY = Math.floor(y / 4)
  const cellIndex = cellY * BOARD_WIDTH + cellX
  maskBuffer[cellIndex] |= BRAILLE_DOT_MASKS[y % 4][x % 2]
  styleBuffer[cellIndex] = Math.max(styleBuffer[cellIndex] ?? BOARD_STYLE_EMPTY, style)
}

function drawBrailleRect(
  maskBuffer: Uint8Array,
  styleBuffer: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  style: number,
) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setBraillePixel(maskBuffer, styleBuffer, col, row, style)
    }
  }
}

function drawPaddle(maskBuffer: Uint8Array, styleBuffer: Uint8Array, centerY: number, x: number, style: number) {
  const top = clamp(Math.round((centerY - PADDLE_HALF_HEIGHT) * 4), 0, BOARD_PIXEL_HEIGHT - PADDLE_PIXEL_HEIGHT)
  drawBrailleRect(maskBuffer, styleBuffer, x, top, PADDLE_PIXEL_WIDTH, PADDLE_PIXEL_HEIGHT, style)
}

function drawBall(maskBuffer: Uint8Array, styleBuffer: Uint8Array) {
  const ballPixelX = clamp(Math.round(ballX * 2), 0, BOARD_PIXEL_WIDTH - 2)
  const ballPixelY = clamp(Math.round(ballY * 4), 0, BOARD_PIXEL_HEIGHT - 2)

  drawBrailleRect(maskBuffer, styleBuffer, ballPixelX, ballPixelY, 2, 2, BOARD_STYLE_BALL)

  if (roundState === "serve") {
    setBraillePixel(
      maskBuffer,
      styleBuffer,
      clamp(ballPixelX + serveDirection, 0, BOARD_PIXEL_WIDTH - 1),
      ballPixelY + 1,
      BOARD_STYLE_BALL,
    )
  }

  if (roundState === "paused") {
    setBraillePixel(
      maskBuffer,
      styleBuffer,
      ballPixelX + 1,
      clamp(ballPixelY + 2, 0, BOARD_PIXEL_HEIGHT - 1),
      BOARD_STYLE_BALL,
    )
  }
}

function drawBallTrail(maskBuffer: Uint8Array, styleBuffer: Uint8Array) {
  for (let age = ballTrail.length - 1; age >= 0; age -= 1) {
    const point = ballTrail[age]
    if (!point) continue

    const style = age <= 1 ? BOARD_STYLE_TRAIL_1 : age <= 3 ? BOARD_STYLE_TRAIL_2 : BOARD_STYLE_TRAIL_3
    const trailX = clamp(Math.round(point.x * 2), 0, BOARD_PIXEL_WIDTH - 1)
    const trailY = clamp(Math.round(point.y * 4), 0, BOARD_PIXEL_HEIGHT - 2)

    setBraillePixel(maskBuffer, styleBuffer, trailX, trailY, style)
    setBraillePixel(maskBuffer, styleBuffer, trailX, trailY + 1, style)
  }
}

function buildBoardFrame() {
  const maskBuffer = new Uint8Array(BOARD_WIDTH * BOARD_HEIGHT)
  const styleBuffer = new Uint8Array(BOARD_WIDTH * BOARD_HEIGHT)
  const centerLineX = Math.floor(BOARD_PIXEL_WIDTH / 2)

  // Braille gives us a 2x4 sub-cell grid per terminal character so the ball
  // can move between columns instead of snapping on every frame.
  for (let y = 2; y < BOARD_PIXEL_HEIGHT - 2; y += 6) {
    drawBrailleRect(maskBuffer, styleBuffer, centerLineX, y, 1, 3, BOARD_STYLE_CENTER)
  }

  drawPaddle(maskBuffer, styleBuffer, playerPaddleY, PLAYER_PADDLE_X * 2, BOARD_STYLE_PLAYER_PADDLE)
  drawPaddle(maskBuffer, styleBuffer, cpuPaddleY, CPU_PADDLE_X * 2, BOARD_STYLE_CPU_PADDLE)
  drawBallTrail(maskBuffer, styleBuffer)
  drawBall(maskBuffer, styleBuffer)

  const chunks: TextChunk[] = []

  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    let runText = ""
    let runStyle = styleBuffer[row * BOARD_WIDTH] ?? BOARD_STYLE_EMPTY

    for (let col = 0; col < BOARD_WIDTH; col += 1) {
      const cellIndex = row * BOARD_WIDTH + col
      const mask = maskBuffer[cellIndex]
      const style = styleBuffer[cellIndex] ?? BOARD_STYLE_EMPTY
      const char = mask === 0 ? " " : String.fromCodePoint(0x2800 + mask)

      if (col === 0) {
        runStyle = style
        runText = char
        continue
      }

      if (style === runStyle) {
        runText += char
        continue
      }

      chunks.push(styleBoardRun(runStyle, runText))
      runStyle = style
      runText = char
    }

    chunks.push(styleBoardRun(runStyle, runText))

    if (row < BOARD_HEIGHT - 1) {
      chunks.push(plainChunk("\n"))
    }
  }

  return new StyledText(chunks)
}

function buildScoreLine() {
  return `PLAYER ${formatScore(playerScore)}   CPU ${formatScore(cpuScore)}   RALLY ${formatScore(rallyCount)}`
}

function buildMetaLine(session: Session) {
  return `Tabs ${ACTIVE_SESSIONS.size}   Session ${session.sessionId}   ${session.cols}x${session.rows}`
}

function renderAllUi() {
  const boardFrame = buildBoardFrame()
  const scoreLine = buildScoreLine()

  for (const ws of ACTIVE_SESSIONS) {
    setTextContent(ws.data.scoreText, scoreLine)
    setTextContent(ws.data.metaText, buildMetaLine(ws.data))
    setTextContent(ws.data.boardText, boardFrame)
  }
}

function cleanupSession(ws: ServerWebSocket<Session>) {
  ACTIVE_SESSIONS.delete(ws)
  ws.data.scoreText = null
  ws.data.metaText = null
  ws.data.boardText = null
  ws.data.hintText = null

  if (ACTIVE_SESSIONS.size === 0) {
    resetSharedGame()
  }
}

function stepGame() {
  if (ACTIVE_SESSIONS.size === 0 || roundState === "paused") return

  moveCpuPaddle()

  if (roundState === "serve") {
    serveTicksRemaining -= 1
    if (serveTicksRemaining <= 0) {
      launchBall()
    }
    renderAllUi()
    return
  }

  recordBallTrail()

  let nextX = ballX + ballVX
  let nextY = ballY + ballVY

  if (nextY <= 0 || nextY >= BOARD_HEIGHT - 1) {
    ballVY *= -1
    nextY = clamp(nextY, 0, BOARD_HEIGHT - 1)
  }

  if (ballVX < 0 && nextX <= PLAYER_PADDLE_X + 1) {
    if (isPaddleHit(playerPaddleY, nextY)) {
      ballX = PLAYER_PADDLE_X + 1
      ballY = nextY
      bounceOffPaddle(playerPaddleY, 1, nextY)
      nextX = ballX + ballVX
      nextY = ballY + ballVY
    } else if (nextX < 0) {
      scorePoint("cpu")
      renderAllUi()
      return
    }
  }

  if (ballVX > 0 && nextX >= CPU_PADDLE_X - 1) {
    if (isPaddleHit(cpuPaddleY, nextY)) {
      ballX = CPU_PADDLE_X - 1
      ballY = nextY
      bounceOffPaddle(cpuPaddleY, -1, nextY)
      nextX = ballX + ballVX
      nextY = ballY + ballVY
    } else if (nextX > BOARD_WIDTH - 1) {
      scorePoint("player")
      renderAllUi()
      return
    }
  }

  ballX = clamp(nextX, 0, BOARD_WIDTH - 1)
  ballY = clamp(nextY, 0, BOARD_HEIGHT - 1)
  renderAllUi()
}

resetSharedGame()
setInterval(stepGame, GAME_TICK_MS)

function closeSession(ws: ServerWebSocket<Session>, code = 1000, reason = "quit") {
  if (ws.data.closed) return
  ws.data.closed = true
  finishPendingWrite(ws.data)
  try {
    ws.close(code, reason)
  } catch {
    // Socket may already be closing.
  }
}

/**
 * Minimal duplex stream pair for the renderer. The stdin is a plain
 * Readable whose data events are driven by the WebSocket; the stdout is
 * a Writable that forwards each chunk to the WebSocket as a binary frame.
 */
function createSessionStreams(ws: ServerWebSocket<Session>, initialCols: number, initialRows: number) {
  // Renderer attaches a `data` listener to stdin and expects bytes.
  // A no-op `read()` keeps the stream in flowing mode without auto-end.
  const stdin = new Readable({ read() {} })

  const stdout = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      // Copy into a fresh buffer so we don't hold a view into the feed's
      // chunk memory (which is reclaimed once this callback fires).
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk)
      try {
        const sendResult = ws.sendBinary(bytes)
        if (sendResult === -1) {
          ws.data.pendingWrite = callback
          return
        }
        if (sendResult === 0) {
          closeSession(ws, 1011, "socket-send-failed")
        }
      } catch {
        closeSession(ws, 1011, "socket-send-failed")
      }
      callback()
    },
  })
  ;(stdout as unknown as { columns: number }).columns = initialCols
  ;(stdout as unknown as { rows: number }).rows = initialRows

  return {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    rawStdin: stdin,
  }
}

function setupPongUI(ws: ServerWebSocket<Session>, renderer: CliRenderer, session: Session) {
  renderer.setBackgroundColor("#08111f")

  const container = new BoxRenderable(renderer, {
    id: "xterm-demo-root",
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 0,
  })

  const card = new BoxRenderable(renderer, {
    id: "xterm-demo-card",
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: session.theme.cardColor,
    borderStyle: "double",
    borderColor: session.theme.borderColor,
    title: " OpenTUI web pong ",
    titleAlignment: "center",
    border: true,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: 1,
  })

  const scoreText = new TextRenderable(renderer, {
    id: "xterm-demo-score",
    content: "",
    fg: session.theme.scoreColor,
  })
  card.add(scoreText)

  const metaText = new TextRenderable(renderer, {
    id: "xterm-demo-meta",
    content: "",
    fg: session.theme.accentColor,
  })
  card.add(metaText)

  const boardBox = new BoxRenderable(renderer, {
    id: "xterm-demo-board-box",
    width: BOARD_WIDTH + 2,
    height: BOARD_HEIGHT + 2,
    backgroundColor: "#020617",
    borderStyle: "single",
    borderColor: session.theme.borderColor,
    border: true,
  })

  const boardText = new TextRenderable(renderer, {
    id: "xterm-demo-board",
    content: "",
    fg: "#cbd5e1",
  })
  boardBox.add(boardText)
  card.add(boardBox)

  const hintText = new TextRenderable(renderer, {
    id: "xterm-demo-hint",
    content: "arrows or j/k   space play   r reset   q quit",
    fg: "#94a3b8",
  })
  card.add(hintText)

  container.add(card)
  renderer.root.add(container)

  session.scoreText = scoreText
  session.metaText = metaText
  session.boardText = boardText
  session.hintText = hintText

  renderAllUi()

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (!session.renderer) return
    const sequence = key.sequence ?? ""

    if ((key.ctrl && key.name === "c") || key.name === "q") {
      closeSession(ws)
      return
    }

    if (key.name === "up" || key.name === "k" || key.name === "w") {
      movePlayerPaddle(-PLAYER_PADDLE_STEP)
      renderAllUi()
      return
    }

    if (key.name === "down" || key.name === "j" || key.name === "s") {
      movePlayerPaddle(PLAYER_PADDLE_STEP)
      renderAllUi()
      return
    }

    if (key.name === "space" || sequence === " ") {
      togglePause()
      renderAllUi()
      return
    }

    if (key.name === "r") {
      resetSharedGame()
      renderAllUi()
    }
  })
}

async function startSession(ws: ServerWebSocket<Session>) {
  const { stdin, stdout, rawStdin } = createSessionStreams(ws, ws.data.cols, ws.data.rows)
  ws.data.stdin = rawStdin

  const renderer = await createCliRenderer({
    stdin,
    stdout,
    width: ws.data.cols,
    height: ws.data.rows,
    exitOnCtrlC: false, // we handle quit ourselves so we can tidy the socket
    exitSignals: [],
    targetFps: 30,
  })

  renderer.on(CliRenderEvents.DESTROY, () => {
    cleanupSession(ws)
  })

  ws.data.renderer = renderer
  setupPongUI(ws, renderer, ws.data)
}

function handleResize(ws: ServerWebSocket<Session>, cols: number, rows: number) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return
  ws.data.cols = cols
  ws.data.rows = rows
  if (ws.data.renderer) {
    ws.data.renderer.resize(cols, rows)
  }
  renderAllUi()
}

const server = Bun.serve<Session>({
  port: Number(process.env.PORT ?? 3000),
  fetch(req, srv) {
    const url = new URL(req.url)
    if (url.pathname === "/ws") {
      const sessionId = createSessionId()
      const theme = pickSessionTheme(sessionId)
      const ok = srv.upgrade(req, {
        data: {
          renderer: null,
          stdin: null,
          scoreText: null,
          metaText: null,
          boardText: null,
          hintText: null,
          cols: 80,
          rows: 24,
          sessionId,
          theme,
          closed: false,
          pendingWrite: null,
        } satisfies Session,
      })
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" } })
    }
    return new Response("Not found", { status: 404 })
  },
  websocket: {
    async open(ws) {
      try {
        await startSession(ws)
        ACTIVE_SESSIONS.add(ws)
        renderAllUi()
      } catch (err) {
        console.error("failed to start session", err)
        ws.close(1011, "session-start-failed")
      }
    },

    drain(ws) {
      finishPendingWrite(ws.data)
    },

    message(ws, message) {
      if (ws.data.closed) return

      // Binary frames are raw keyboard bytes from xterm.
      if (message instanceof Buffer || message instanceof Uint8Array) {
        if (!ws.data.stdin) return
        const bytes = message instanceof Buffer ? message : Buffer.from(message)
        ws.data.stdin.push(bytes)
        return
      }

      // JSON control frames (currently just `resize`).
      if (typeof message === "string") {
        try {
          const parsed = JSON.parse(message) as { type?: string; cols?: number; rows?: number }
          if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
            handleResize(ws, parsed.cols, parsed.rows)
          }
        } catch {
          // Ignore malformed control frames.
        }
      }
    },

    close(ws) {
      ws.data.closed = true
      finishPendingWrite(ws.data)
      cleanupSession(ws)
      renderAllUi()
      if (ws.data.renderer) {
        try {
          ws.data.renderer.destroy()
        } catch (err) {
          console.error("error destroying renderer on WS close", err)
        }
      }
      ws.data.renderer = null
      try {
        ws.data.stdin?.push(null)
      } catch {
        // ignore
      }
      ws.data.stdin = null
    },
  },
})

console.log(`OpenTUI web pong ready on http://localhost:${server.port}/`)
