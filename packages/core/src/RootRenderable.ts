import { OptimizedBuffer } from "./buffer.js"
import {
  bumpLayoutGeneration,
  getLayoutGeneration,
  getRenderListRevision,
  LayoutEvents,
  Renderable,
  type RenderCommand,
} from "./Renderable.js"
import type { RGBA } from "./lib/RGBA.js"
import type { RenderContext } from "./types.js"
import Yoga, { Direction, FlexDirection } from "./yoga.js"

type DirtyRows = { start: number; end: number }

export class RootRenderable extends Renderable {
  private renderList: RenderCommand[] = []
  private _currentRenderable: Renderable | undefined
  private appliedLayoutGeneration = -1
  private appliedRenderListRevision = -1
  private renderListReusable = false
  private dirtyRenderables = new Set<Renderable>()
  private spareDirtyRenderables = new Set<Renderable>()
  private fullCompositionRequired = true

  constructor(ctx: RenderContext) {
    super(ctx, { id: "__root__", zIndex: 0, visible: true, width: ctx.width, height: ctx.height, enableLayout: true })
    this.yogaNode.free()
    this.yogaNode = Yoga.Node.createForOpenTUI()
    this.yogaNode.setWidth(ctx.width)
    this.yogaNode.setHeight(ctx.height)
    this.yogaNode.setFlexDirection(FlexDirection.Column)
    this.calculateLayout()
  }

  public get currentRenderable(): Renderable | undefined {
    return this._currentRenderable
  }

  public takeCurrentRenderable(): Renderable | undefined {
    const renderable = this._currentRenderable
    this._currentRenderable = undefined
    return renderable
  }

  public invalidate(renderable?: Renderable): void {
    if (!renderable) {
      this.dirtyRenderables.clear()
      this.fullCompositionRequired = true
    } else if (this.fullCompositionRequired) {
      return
    } else {
      this.dirtyRenderables.add(renderable)
      if (this.dirtyRenderables.size > 3) {
        this.dirtyRenderables.clear()
        this.fullCompositionRequired = true
      }
    }
  }

  public forceFullComposition(): void {
    this.fullCompositionRequired = true
  }

  public render(
    buffer: OptimizedBuffer,
    deltaTime: number,
    backgroundColor?: RGBA,
    forceFull = false,
    clearBeforePaint = true,
  ): void {
    this._currentRenderable = undefined
    if (!this.visible) return

    for (const renderable of this._ctx.getLifecyclePasses()) {
      if (!renderable.isDestroyed) renderable.onLifecyclePass?.call(renderable)
    }

    const layoutWasDirty = Boolean(this.yogaNode.isDirty())
    if (layoutWasDirty) this.calculateLayout()
    else this.syncExternalLayoutGeneration()

    const layoutGeneration = getLayoutGeneration(this._ctx)
    const renderListRevision = getRenderListRevision(this._ctx)
    const renderListChanged =
      !this.renderListReusable ||
      this.appliedLayoutGeneration !== layoutGeneration ||
      this.appliedRenderListRevision !== renderListRevision

    if (renderListChanged) {
      this.renderList.length = 0
      super.updateLayout(deltaTime, this.renderList)
      this.appliedLayoutGeneration = layoutGeneration
      this.appliedRenderListRevision = getRenderListRevision(this._ctx)
      this.renderListReusable = this.canReuseCurrentRenderList()
    }

    const fullComposition =
      forceFull ||
      this.fullCompositionRequired ||
      layoutWasDirty ||
      renderListChanged ||
      !this.renderListReusable ||
      this.dirtyRenderables.size > 3 ||
      (this.dirtyRenderables.size > 0 && backgroundColor === undefined)

    if (fullComposition) {
      this.dirtyRenderables.clear()
      this.fullCompositionRequired = false
      try {
        this.renderFull(buffer, deltaTime, backgroundColor, clearBeforePaint)
      } catch (error) {
        this.fullCompositionRequired = true
        buffer.clearScissorRects()
        buffer.clearOpacity()
        this._ctx.clearHitGridScissorRects()
        this._ctx.setHitGridWritesEnabled(true)
        throw error
      }
      return
    }

    const dirtyRenderables = this.dirtyRenderables
    this.dirtyRenderables = this.spareDirtyRenderables
    this.dirtyRenderables.clear()
    this.fullCompositionRequired = false

    try {
      const rows = collectDirtyRows(dirtyRenderables, this._ctx.height)
      if (rows.length === 0) {
        this._ctx.preserveHitGrid()
        return
      }

      for (const row of rows) {
        if (!buffer.clearRows(row.start, row.end - row.start, backgroundColor!)) {
          return this.renderFull(buffer, deltaTime, backgroundColor, true)
        }
      }

      this._ctx.setHitGridWritesEnabled(false)
      try {
        for (const row of rows) {
          buffer.pushScissorRect(0, row.start, buffer.width, row.end - row.start)
          try {
            this.executeRenderList(buffer, deltaTime, false, row)
          } finally {
            buffer.clearScissorRects()
            buffer.clearOpacity()
          }
        }
      } finally {
        this._ctx.setHitGridWritesEnabled(true)
      }
      this._ctx.preserveHitGrid()
    } catch (error) {
      this.fullCompositionRequired = true
      for (const renderable of dirtyRenderables) this.dirtyRenderables.add(renderable)
      buffer.clearScissorRects()
      buffer.clearOpacity()
      this._ctx.clearHitGridScissorRects()
      this._ctx.setHitGridWritesEnabled(true)
      throw error
    } finally {
      dirtyRenderables.clear()
      this.spareDirtyRenderables = dirtyRenderables
    }
  }

  private renderFull(buffer: OptimizedBuffer, deltaTime: number, backgroundColor?: RGBA, clear = true): void {
    if (clear) {
      if (backgroundColor) buffer.clear(backgroundColor)
      else buffer.clear()
    }
    this._ctx.clearHitGridScissorRects()
    this.executeRenderList(buffer, deltaTime, true)
  }

  private executeRenderList(
    buffer: OptimizedBuffer,
    deltaTime: number,
    updateHitGrid: boolean,
    dirtyRows?: DirtyRows,
  ): void {
    for (let i = 1; i < this.renderList.length; i++) {
      const command = this.renderList[i]
      switch (command.action) {
        case "render":
          if (!command.renderable.isDestroyed && (!dirtyRows || intersectsRows(command.renderable, dirtyRows))) {
            this._currentRenderable = command.renderable
            command.renderable.render(buffer, deltaTime)
            this._currentRenderable = undefined
          }
          break
        case "pushScissorRect":
          buffer.pushScissorRect(command.x, command.y, command.width, command.height)
          if (updateHitGrid)
            this._ctx.pushHitGridScissorRect(command.screenX, command.screenY, command.width, command.height)
          break
        case "popScissorRect":
          buffer.popScissorRect()
          if (updateHitGrid) this._ctx.popHitGridScissorRect()
          break
        case "pushOpacity":
          buffer.pushOpacity(command.opacity)
          break
        case "popOpacity":
          buffer.popOpacity()
          break
      }
    }
  }

  protected propagateLiveCount(delta: number): void {
    const oldCount = this._liveCount
    this._liveCount += delta
    if (oldCount === 0 && this._liveCount > 0) this._ctx.requestLive()
    else if (oldCount > 0 && this._liveCount === 0) this._ctx.dropLive()
  }

  public calculateLayout(): void {
    this.yogaNode.calculateLayout(this.width, this.height, Direction.LTR)
    bumpLayoutGeneration(this._ctx)
    this.yogaNode.markLayoutSeen()
    this.emit(LayoutEvents.LAYOUT_CHANGED)
  }

  private syncExternalLayoutGeneration(): void {
    if (!this.yogaNode.hasNewLayout()) return
    bumpLayoutGeneration(this._ctx)
    this.yogaNode.markLayoutSeen()
  }

  private canReuseCurrentRenderList(): boolean {
    if (this._liveCount > 0) return false
    for (const command of this.renderList) {
      if (command.action === "render" && !command.renderable.canReuseRenderCommandList()) return false
    }
    return true
  }

  public resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.emit(LayoutEvents.RESIZED, { width, height })
  }
}

function intersectsRows(renderable: Renderable, rows: DirtyRows): boolean {
  const start = renderable.screenY
  const end = start + renderable.height
  return end > rows.start && start < rows.end
}

function collectDirtyRows(renderables: ReadonlySet<Renderable>, height: number): DirtyRows[] {
  const rows: DirtyRows[] = []
  for (const renderable of renderables) {
    if (renderable.isDestroyed || !renderable.visible) continue
    const start = Math.max(0, Math.floor(renderable.screenY))
    const end = Math.min(height, Math.ceil(renderable.screenY + renderable.height))
    if (start < end) rows.push({ start, end })
  }
  rows.sort((left, right) => left.start - right.start || left.end - right.end)

  const merged: DirtyRows[] = []
  for (const row of rows) {
    const previous = merged[merged.length - 1]
    if (previous && row.start <= previous.end) previous.end = Math.max(previous.end, row.end)
    else merged.push({ ...row })
  }
  return merged
}
