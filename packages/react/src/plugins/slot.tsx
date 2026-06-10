import {
  createSlotRegistry,
  SlotRegistry,
  type CliRenderer,
  type Plugin,
  type PluginContext,
  type PluginErrorEvent,
  type ResolvedSlotRenderer,
  type SlotMode,
  type SlotRegistryOptions,
} from "@opentui/core"
import React, { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

export type { SlotMode }
type SlotMap = Record<string, object>

export type ReactPlugin<TSlots extends SlotMap, TContext extends PluginContext = PluginContext> = Plugin<
  ReactNode,
  TSlots,
  TContext
>

export type ReactSlotProps<
  TSlots extends SlotMap,
  K extends keyof TSlots,
  TContext extends PluginContext = PluginContext,
> = {
  registry: SlotRegistry<ReactNode, TSlots, TContext>
  name: K
  mode?: SlotMode
  children?: ReactNode
  pluginFailurePlaceholder?: (failure: PluginErrorEvent) => ReactNode
} & TSlots[K]

export type ReactBoundSlotProps<TSlots extends SlotMap, K extends keyof TSlots> = {
  name: K
  mode?: SlotMode
  children?: ReactNode
} & TSlots[K]

export type ReactRegistrySlotComponent<TSlots extends SlotMap, TContext extends PluginContext = PluginContext> = <
  K extends keyof TSlots,
>(
  props: ReactSlotProps<TSlots, K, TContext>,
) => ReactNode

export type ReactSlotComponent<TSlots extends SlotMap> = <K extends keyof TSlots>(
  props: ReactBoundSlotProps<TSlots, K>,
) => ReactNode

export interface ReactSlotOptions {
  pluginFailurePlaceholder?: (failure: PluginErrorEvent) => ReactNode
}

export function createReactSlotRegistry<TSlots extends SlotMap, TContext extends PluginContext = PluginContext>(
  renderer: CliRenderer,
  context: TContext,
  options: SlotRegistryOptions = {},
): SlotRegistry<ReactNode, TSlots, TContext> {
  // React slots intentionally use one registry key per renderer instance.
  // Use createSlotRegistry from @opentui/core with a custom key for independent registries.
  return createSlotRegistry<ReactNode, TSlots, TContext>(renderer, "react:slot-registry", context, options)
}

type PluginErrorBoundaryProps = {
  registry: SlotRegistry<ReactNode, any, any>
  pluginFailurePlaceholder?: (failure: PluginErrorEvent) => ReactNode
  pluginId: string
  slotName: string
  resetToken: number
  fallbackOnFailure?: ReactNode
  children: ReactNode
}

type PluginErrorBoundaryState = {
  failure: PluginErrorEvent | null
}

function renderPluginFailurePlaceholder(
  registry: SlotRegistry<ReactNode, any, any>,
  pluginFailurePlaceholder: ((failure: PluginErrorEvent) => ReactNode) | undefined,
  failure: PluginErrorEvent,
  pluginId: string,
  slot: string,
): ReactNode {
  if (!pluginFailurePlaceholder) {
    return null
  }

  try {
    return pluginFailurePlaceholder(failure)
  } catch (error) {
    registry.reportPluginError({
      pluginId,
      slot,
      phase: "error_placeholder",
      source: "react",
      error,
    })

    return null
  }
}

class PluginErrorBoundary extends React.Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props)
    this.state = { failure: null }
  }

  override componentDidCatch(error: Error): void {
    const failure = this.props.registry.reportPluginError({
      pluginId: this.props.pluginId,
      slot: this.props.slotName,
      phase: "render",
      source: "react",
      error,
    })

    this.setState({ failure })
  }

  override componentDidUpdate(previousProps: PluginErrorBoundaryProps): void {
    if (previousProps.resetToken !== this.props.resetToken && this.state.failure) {
      this.setState({ failure: null })
    }
  }

  override render(): ReactNode {
    if (this.state.failure) {
      const placeholder = renderPluginFailurePlaceholder(
        this.props.registry,
        this.props.pluginFailurePlaceholder,
        this.state.failure,
        this.props.pluginId,
        this.props.slotName,
      )

      if (placeholder === null || placeholder === undefined || placeholder === false) {
        return this.props.fallbackOnFailure ?? null
      }

      return placeholder
    }

    return this.props.children
  }
}

function getSlotProps<TSlots extends SlotMap, K extends keyof TSlots, TContext extends PluginContext = PluginContext>(
  props: ReactSlotProps<TSlots, K, TContext>,
): TSlots[K] {
  const {
    children: _children,
    mode: _mode,
    name: _name,
    registry: _registry,
    pluginFailurePlaceholder: _pluginFailurePlaceholder,
    ...slotProps
  } = props
  return slotProps as TSlots[K]
}

export function createSlot<TSlots extends SlotMap, TContext extends PluginContext = PluginContext>(
  registry: SlotRegistry<ReactNode, TSlots, TContext>,
  options: ReactSlotOptions = {},
): ReactSlotComponent<TSlots> {
  return function BoundSlot<K extends keyof TSlots>(props: ReactBoundSlotProps<TSlots, K>): ReactNode {
    return (
      <Slot<TSlots, TContext, K>
        {...(props as ReactBoundSlotProps<TSlots, K>)}
        registry={registry}
        pluginFailurePlaceholder={options.pluginFailurePlaceholder}
      />
    )
  }
}

export function Slot<
  TSlots extends SlotMap,
  TContext extends PluginContext = PluginContext,
  K extends keyof TSlots = keyof TSlots,
>(props: ReactSlotProps<TSlots, K, TContext>): ReactNode {
  const [version, setVersion] = useState(0)
  const registry = props.registry
  const slotName = String(props.name)
  const renderFailuresByPluginRef = useRef<Map<string, PluginErrorEvent>>(new Map())
  const pendingRenderReportsRef = useRef<Map<string, { pluginId: string; slot: string; error: Error }>>(new Map())

  useEffect(() => {
    return registry.subscribe(() => {
      setVersion((current) => current + 1)
    })
  }, [registry])

  useEffect(() => {
    if (pendingRenderReportsRef.current.size === 0) {
      return
    }

    const pendingReports = [...pendingRenderReportsRef.current.values()]
    pendingRenderReportsRef.current.clear()

    for (const report of pendingReports) {
      const failure = registry.reportPluginError({
        pluginId: report.pluginId,
        slot: report.slot,
        phase: "render",
        source: "react",
        error: report.error,
      })

      renderFailuresByPluginRef.current.set(`${report.slot}:${report.pluginId}:render`, failure)
    }
  })

  const entries = useMemo<Array<ResolvedSlotRenderer<ReactNode, TSlots[K], TContext>>>(
    () => registry.resolveEntries(props.name),
    [registry, props.name, version],
  )
  const slotProps = getSlotProps(props)

  const renderEntry = (
    entry: ResolvedSlotRenderer<ReactNode, TSlots[K], TContext>,
    fallbackOnFailure?: ReactNode,
  ): ReactNode => {
    const key = `${slotName}:${entry.id}`
    const failureKey = `${slotName}:${entry.id}:render`

    try {
      const rendered = entry.renderer(registry.context, slotProps)
      renderFailuresByPluginRef.current.delete(failureKey)
      pendingRenderReportsRef.current.delete(failureKey)
      return (
        <PluginErrorBoundary
          key={key}
          registry={registry}
          pluginFailurePlaceholder={props.pluginFailurePlaceholder}
          pluginId={entry.id}
          slotName={slotName}
          resetToken={version}
          fallbackOnFailure={fallbackOnFailure}
        >
          {rendered}
        </PluginErrorBoundary>
      )
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : typeof error === "string" ? new Error(error) : new Error(String(error))
      const lastFailure = renderFailuresByPluginRef.current.get(failureKey)
      const isSameFailure = lastFailure && lastFailure.error.message === normalizedError.message

      if (!isSameFailure) {
        const queued = pendingRenderReportsRef.current.get(failureKey)
        if (!queued || queued.error.message !== normalizedError.message) {
          pendingRenderReportsRef.current.set(failureKey, {
            pluginId: entry.id,
            slot: slotName,
            error: normalizedError,
          })
        }
      }

      const failure: PluginErrorEvent =
        isSameFailure && lastFailure
          ? lastFailure
          : {
              pluginId: entry.id,
              slot: slotName,
              phase: "render",
              source: "react",
              error: normalizedError,
              timestamp: Date.now(),
            }

      renderFailuresByPluginRef.current.set(failureKey, failure)

      const placeholder = renderPluginFailurePlaceholder(
        registry,
        props.pluginFailurePlaceholder,
        failure,
        entry.id,
        slotName,
      )
      if (placeholder === null || placeholder === undefined || placeholder === false) {
        return fallbackOnFailure ?? null
      }

      return <Fragment key={key}>{placeholder}</Fragment>
    }
  }

  if (entries.length === 0) {
    return <>{props.children}</>
  }

  if (props.mode === "single_winner") {
    const winner = entries[0]
    if (!winner) {
      return <>{props.children}</>
    }

    const rendered = renderEntry(winner, props.children)
    if (rendered === null || rendered === undefined || rendered === false) {
      return <>{props.children}</>
    }

    return <>{rendered}</>
  }

  if (props.mode === "replace") {
    if (entries.length === 1) {
      const rendered = renderEntry(entries[0], props.children)
      if (rendered === null || rendered === undefined || rendered === false) {
        return <>{props.children}</>
      }

      return <>{rendered}</>
    }

    const renderedEntries = entries.map((entry) => renderEntry(entry))
    const hasPluginOutput = renderedEntries.some((node) => node !== null && node !== undefined && node !== false)

    if (!hasPluginOutput) {
      return <>{props.children}</>
    }

    return <>{renderedEntries}</>
  }

  return (
    <>
      {props.children}
      {entries.map((entry) => renderEntry(entry))}
    </>
  )
}
