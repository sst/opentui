const ART_WIDTH = 84
const ART_HEIGHT = 30
const DIVIDER_TOP = 12
const DIVIDER_BOTTOM = 18
const CELL_COUNT = ART_WIDTH * ART_HEIGHT
const TERMINAL_COLUMNS = ART_WIDTH / 2
const TERMINAL_ROWS = ART_HEIGHT / 3

export type DividerVariant =
  | "hairline"
  | "periodic-dots"
  | "periodic-dashes"
  | "harmonic"
  | "standing-wave"
  | "braid"
  | "sinc"
  | "gaussian"
  | "lens"
  | "lens-outline"
  | "diamond-field"
  | "bow-tie"
  | "superellipse"
  | "parabolic-rails"
  | "catenary"
  | "chevrons"
  | "orbit-nodes"
  | "phase-lattice"
  | "interference"
  | "radial-pulse"

type Geometry = Exclude<DividerVariant, "diamond-field">
type Neighborhood = "horizontal" | "cross" | "diagonal"

interface DividerConfig {
  geometry: Geometry | "diamond"
  states: number
  threshold: number
  neighborhood: Neighborhood
  depth: number
  phaseX: number
  phaseY: number
}

const CONFIGS: Record<DividerVariant, DividerConfig> = {
  hairline: {
    geometry: "hairline",
    states: 3,
    threshold: 1,
    neighborhood: "horizontal",
    depth: 12,
    phaseX: 6,
    phaseY: 1,
  },
  "periodic-dots": {
    geometry: "periodic-dots",
    states: 4,
    threshold: 1,
    neighborhood: "horizontal",
    depth: 14,
    phaseX: 4,
    phaseY: 1,
  },
  "periodic-dashes": {
    geometry: "periodic-dashes",
    states: 3,
    threshold: 1,
    neighborhood: "horizontal",
    depth: 10,
    phaseX: 5,
    phaseY: 1,
  },
  harmonic: {
    geometry: "harmonic",
    states: 4,
    threshold: 1,
    neighborhood: "diagonal",
    depth: 12,
    phaseX: 7,
    phaseY: 1,
  },
  "standing-wave": {
    geometry: "standing-wave",
    states: 3,
    threshold: 1,
    neighborhood: "cross",
    depth: 16,
    phaseX: 4,
    phaseY: 1,
  },
  braid: { geometry: "braid", states: 5, threshold: 1, neighborhood: "diagonal", depth: 14, phaseX: 6, phaseY: 2 },
  sinc: { geometry: "sinc", states: 4, threshold: 1, neighborhood: "diagonal", depth: 12, phaseX: 5, phaseY: 1 },
  gaussian: { geometry: "gaussian", states: 5, threshold: 1, neighborhood: "cross", depth: 14, phaseX: 8, phaseY: 2 },
  lens: { geometry: "lens", states: 4, threshold: 1, neighborhood: "cross", depth: 12, phaseX: 6, phaseY: 1 },
  "lens-outline": {
    geometry: "lens-outline",
    states: 3,
    threshold: 1,
    neighborhood: "diagonal",
    depth: 10,
    phaseX: 7,
    phaseY: 1,
  },
  "diamond-field": {
    geometry: "diamond",
    states: 4,
    threshold: 1,
    neighborhood: "cross",
    depth: 16,
    phaseX: 9,
    phaseY: 1,
  },
  "bow-tie": { geometry: "bow-tie", states: 5, threshold: 1, neighborhood: "cross", depth: 15, phaseX: 3, phaseY: 1 },
  superellipse: {
    geometry: "superellipse",
    states: 5,
    threshold: 1,
    neighborhood: "cross",
    depth: 13,
    phaseX: 8,
    phaseY: 1,
  },
  "parabolic-rails": {
    geometry: "parabolic-rails",
    states: 3,
    threshold: 1,
    neighborhood: "diagonal",
    depth: 12,
    phaseX: 5,
    phaseY: 1,
  },
  catenary: {
    geometry: "catenary",
    states: 5,
    threshold: 1,
    neighborhood: "diagonal",
    depth: 18,
    phaseX: 7,
    phaseY: 2,
  },
  chevrons: {
    geometry: "chevrons",
    states: 4,
    threshold: 1,
    neighborhood: "diagonal",
    depth: 10,
    phaseX: 9,
    phaseY: 1,
  },
  "orbit-nodes": {
    geometry: "orbit-nodes",
    states: 3,
    threshold: 1,
    neighborhood: "cross",
    depth: 16,
    phaseX: 4,
    phaseY: 2,
  },
  "phase-lattice": {
    geometry: "phase-lattice",
    states: 4,
    threshold: 1,
    neighborhood: "diagonal",
    depth: 12,
    phaseX: 6,
    phaseY: 1,
  },
  interference: {
    geometry: "interference",
    states: 5,
    threshold: 1,
    neighborhood: "diagonal",
    depth: 14,
    phaseX: 4,
    phaseY: 1,
  },
  "radial-pulse": {
    geometry: "radial-pulse",
    states: 5,
    threshold: 1,
    neighborhood: "cross",
    depth: 10,
    phaseX: 10,
    phaseY: 2,
  },
}

const HORIZONTAL = [
  [-1, 0],
  [1, 0],
] as const
const CROSS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const
const DIAGONAL = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const

function activeInGeometry(geometry: DividerConfig["geometry"], x: number, y: number): boolean {
  if (x < 4 || x >= ART_WIDTH - 4 || y < DIVIDER_TOP || y > DIVIDER_BOTTOM) return false
  const centerX = (ART_WIDTH - 1) / 2
  const centerY = (DIVIDER_TOP + DIVIDER_BOTTOM) / 2
  const u = (x - centerX) / 37.5
  const v = y - centerY
  const near = (value: number) => Math.abs(value) < 0.48
  const triangle = 2 * Math.abs(2 * (u * 3 - Math.floor(u * 3 + 0.5))) - 1
  if (geometry === "hairline") return near(v)
  if (geometry === "periodic-dots") return near(v) && Math.cos((x * Math.PI) / 2) > 0.9
  if (geometry === "periodic-dashes") return near(v) && Math.cos((x * Math.PI) / 5) > -0.35
  if (geometry === "harmonic") return near(v - Math.sin(u * Math.PI * 2) * 2.4)
  if (geometry === "standing-wave") return near(Math.abs(v) - Math.abs(Math.sin(u * Math.PI * 2)) * 2.5)
  if (geometry === "braid") return near(v - Math.sin(u * Math.PI * 3) * 2) || near(v + Math.sin(u * Math.PI * 3) * 2)
  if (geometry === "sinc") {
    const angle = u * Math.PI * 3
    return near(v - (Math.abs(angle) < 0.001 ? 1 : Math.sin(angle) / angle) * 3)
  }
  if (geometry === "gaussian") return Math.abs(v) <= 0.35 + 2.65 * Math.exp(-u * u * 4)
  if (geometry === "lens") return Math.abs(v) <= 0.25 + 2.75 * (1 - u * u)
  if (geometry === "lens-outline") return near(Math.abs(v) - (0.2 + 2.7 * (1 - u * u)))
  if (geometry === "diamond") return Math.abs(v) <= 0.25 + 3 * (1 - Math.abs(u))
  if (geometry === "bow-tie") return Math.abs(v) <= 0.25 + 2.6 * Math.abs(u)
  if (geometry === "superellipse") return Math.abs(u) ** 4 + (Math.abs(v) / 3.1) ** 4 <= 1
  if (geometry === "parabolic-rails") return near(Math.abs(v) - (0.2 + 2.7 * u * u))
  if (geometry === "catenary") return near(v - (Math.cosh(u * 1.8) - 1) * 1.35 + 1.5)
  if (geometry === "chevrons") return near(v - triangle * 2.4)
  if (geometry === "orbit-nodes") {
    const nodeX = Math.round((x - 6) / 12) * 12 + 6
    return near(v) || Math.abs(Math.hypot(x - nodeX, v) - 2.1) < 0.48
  }
  if (geometry === "phase-lattice") {
    return Math.abs(v) <= 0.25 + 2.6 * (1 - u * u) && Math.cos((x * Math.PI) / 3 + (v * Math.PI) / 2) > -0.1
  }
  if (geometry === "interference") {
    const first = Math.sin(u * Math.PI * 2.5) * 1.7
    const second = Math.sin(u * Math.PI * 4 - 0.8) * 1.1
    return near(v - first - second) || near(v - first + second)
  }
  return near(v) || (Math.abs(u) < 0.42 && Math.abs(Math.hypot(u * 3.2, v) - 1.9) < 0.48)
}

class CellularDivider {
  private readonly context: CanvasRenderingContext2D
  private readonly mask = new Uint8Array(CELL_COUNT)
  private readonly current = new Uint8Array(CELL_COUNT)
  private readonly saved = new Uint8Array(CELL_COUNT)
  private readonly next = new Uint8Array(CELL_COUNT)
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")
  private frame = 0
  private startedAt = performance.now()
  private visible = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly config: DividerConfig,
  ) {
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas 2D is required for cellular dividers")
    this.context = context
    new ResizeObserver(this.resize).observe(canvas)
    new IntersectionObserver(this.visibility, { rootMargin: "100px" }).observe(canvas)
    this.reducedMotion.addEventListener("change", this.motionPreference)
    this.resize()
  }

  private readonly resize = () => {
    const bounds = this.canvas.getBoundingClientRect()
    const ratio = Math.min(devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(bounds.width * ratio))
    this.canvas.height = Math.max(1, Math.round(bounds.height * ratio))
    this.draw(this.reducedMotion.matches ? 0 : (performance.now() - this.startedAt) / 1000)
  }

  private readonly visibility = (entries: IntersectionObserverEntry[]) => {
    this.visible = entries[0]?.isIntersecting ?? false
    if (this.visible) this.start()
    else cancelAnimationFrame(this.frame)
  }

  private readonly motionPreference = () => {
    this.startedAt = performance.now()
    if (this.reducedMotion.matches) {
      cancelAnimationFrame(this.frame)
      this.draw(0)
    } else if (this.visible) this.start()
  }

  private start(): void {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(this.animate)
  }

  private readonly animate = (now: number) => {
    this.draw((now - this.startedAt) / 1000)
    if (this.visible && !this.reducedMotion.matches) this.frame = requestAnimationFrame(this.animate)
  }

  private initialize(): void {
    this.mask.fill(0)
    this.current.fill(0)
    for (let y = DIVIDER_TOP; y <= DIVIDER_BOTTOM; y += 1) {
      for (let x = 0; x < ART_WIDTH; x += 1) {
        if (!activeInGeometry(this.config.geometry, x, y)) continue
        const index = y * ART_WIDTH + x
        this.mask[index] = 1
        this.current[index] =
          (((Math.floor(x / this.config.phaseX) + y * this.config.phaseY) % this.config.states) + this.config.states) %
          this.config.states
      }
    }
  }

  private step(): void {
    this.next.set(this.current)
    const offsets =
      this.config.neighborhood === "horizontal" ? HORIZONTAL : this.config.neighborhood === "cross" ? CROSS : DIAGONAL
    for (let y = DIVIDER_TOP; y <= DIVIDER_BOTTOM; y += 1) {
      for (let x = 0; x < ART_WIDTH; x += 1) {
        const index = y * ART_WIDTH + x
        if (this.mask[index] === 0) continue
        const target = (this.current[index] + 1) % this.config.states
        let successors = 0
        for (const [dx, dy] of offsets) {
          const neighbor = (y + dy) * ART_WIDTH + x + dx
          if (this.mask[neighbor] !== 0 && this.current[neighbor] === target) successors += 1
        }
        if (successors >= this.config.threshold) this.next[index] = target
      }
    }
    this.current.set(this.next)
  }

  private draw(time: number): void {
    const progress = (1 - Math.cos(((time % 10) / 10) * Math.PI * 2)) * 0.5 * this.config.depth
    const generation = Math.floor(progress)
    const blend = progress - generation
    this.initialize()
    for (let step = 0; step < generation; step += 1) this.step()
    this.saved.set(this.current)
    this.step()

    const style = getComputedStyle(this.canvas)
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.context.fillStyle = style.color
    const cellWidth = this.canvas.width / TERMINAL_COLUMNS
    const cellHeight = this.canvas.height / TERMINAL_ROWS
    for (let cellY = 0; cellY < TERMINAL_ROWS; cellY += 1) {
      for (let cellX = 0; cellX < TERMINAL_COLUMNS; cellX += 1) {
        let intensity = 0
        for (let dy = 0; dy < 3; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const index = (cellY * 3 + dy) * ART_WIDTH + cellX * 2 + dx
            if (this.mask[index] === 0) continue
            const first = 88 + this.saved[index] * (150 / Math.max(1, this.config.states - 1))
            const second = 88 + this.current[index] * (150 / Math.max(1, this.config.states - 1))
            intensity = Math.max(intensity, first + (second - first) * blend)
          }
        }
        if (intensity === 0) continue
        this.context.globalAlpha = 0.25 + intensity / 340
        for (let dy = 0; dy < 3; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const index = (cellY * 3 + dy) * ART_WIDTH + cellX * 2 + dx
            if (this.mask[index] === 0) continue
            const left = Math.round(cellX * cellWidth + (dx * cellWidth) / 2)
            const right = Math.round(cellX * cellWidth + ((dx + 1) * cellWidth) / 2)
            const top = Math.round(cellY * cellHeight + (dy * cellHeight) / 3)
            const bottom = Math.round(cellY * cellHeight + ((dy + 1) * cellHeight) / 3)
            this.context.fillRect(left, top, right - left, bottom - top)
          }
        }
      }
    }
    this.context.globalAlpha = 1
  }
}

export function mountCellularDividers(root: ParentNode = document): void {
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>("canvas[data-cellular-divider]")) {
    if (canvas.dataset.mounted === "true") continue
    const variant = canvas.dataset.cellularDivider as DividerVariant
    const config = CONFIGS[variant]
    if (!config) continue
    canvas.dataset.mounted = "true"
    new CellularDivider(canvas, config)
  }
}
