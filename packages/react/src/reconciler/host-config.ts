import type { Renderable, TextRenderable } from "@opentui/core"
import { createContext } from "react"
import type { HostConfig, ReactContext } from "react-reconciler"
import { DefaultEventPriority, NoEventPriority } from "react-reconciler/constants"
import { getComponentCatalogue } from "../components"
import type { Container, HostContext, Instance, Props, PublicInstance, TextInstance, Type } from "../types/host"
import { getNextId } from "../utils/id"
import { setInitialProperties, updateProperties } from "../utils/index"

let currentUpdatePriority = NoEventPriority

// https://github.com/facebook/react/tree/main/packages/react-reconciler#practical-examples
export const hostConfig: HostConfig<
  Type,
  Props,
  Container,
  Instance,
  TextInstance,
  unknown, // SuspenseInstance
  unknown, // HydratableInstance
  unknown, // FormInstance
  PublicInstance,
  HostContext,
  unknown, // ChildSet
  unknown, // TimeoutHandle
  unknown, // NoTimeout
  unknown // TransitionStatus
> = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,

  // Create instances of opentui components
  createInstance(type: Type, props: Props, rootContainerInstance: Container, hostContext: HostContext) {
    const id = getNextId(type)
    const components = getComponentCatalogue()

    if (!components[type]) {
      throw new Error(`[Reconciler] Unknown component type: ${type}`)
    }

    return new components[type](rootContainerInstance.ctx, {})
  },

  // Append a child to a parent
  appendChild(parent: Instance, child: Instance) {
    parent.add(child)
  },

  // Remove a child from a parent
  removeChild(parent: Instance, child: Instance) {
    parent.remove(child.id)
  },

  // Insert a child before another child
  insertBefore(parent: Instance, child: Instance, beforeChild: Instance) {
    parent.insertBefore(child, beforeChild)
  },

  // Insert a child at a specific index
  insertInContainerBefore(parent: Container, child: Instance, beforeChild: Instance) {
    parent.insertBefore(child, beforeChild)
  },

  // Remove a child from container
  removeChildFromContainer(parent: Container, child: Instance) {
    parent.remove(child.id)
  },

  // Prepare for commit
  prepareForCommit(containerInfo: Container) {
    return null
  },

  // Reset after commit
  resetAfterCommit(containerInfo: Container) {
    // Trigger a render update if needed
    containerInfo.requestRender()
  },

  // Get root container
  getRootHostContext(rootContainerInstance: Container) {
    return {}
  },

  // Get child context
  getChildHostContext(parentHostContext: HostContext, type: Type, rootContainerInstance: Container) {
    return parentHostContext
  },

  // Should set text content
  shouldSetTextContent(type: Type, props: Props) {
    // For text components, we want to handle StyledText and TextChunk children specially
    if (type === "text") {
      return true
    }

    return false
  },

  // Create text instance
  createTextInstance(text: string, rootContainerInstance: Container, hostContext: HostContext) {
    const components = getComponentCatalogue()
    return new components["text"](rootContainerInstance.ctx, {
      id: getNextId("text"),
      content: text,
    }) as TextInstance
  },

  // Schedule timeout
  scheduleTimeout: setTimeout,

  // Cancel timeout
  cancelTimeout: clearTimeout,

  // No timeout
  noTimeout: -1,

  // Should attempt synchronous flush
  shouldAttemptEagerTransition() {
    return false
  },

  // Finalize initial children
  finalizeInitialChildren(
    instance: Instance,
    type: Type,
    props: Props,
    rootContainerInstance: Container,
    hostContext: HostContext,
  ) {
    setInitialProperties(instance, type, props)
    return false
  },

  // Commit mount
  commitMount(instance: Instance, type: Type, props: Props, internalInstanceHandle: any) {
    // We could focus the instance here, but we're handling focus in setInitialProperties
  },

  // Commit update
  commitUpdate(instance: Instance, type: Type, oldProps: Props, newProps: Props, internalInstanceHandle: any) {
    updateProperties(instance, type, oldProps, newProps)
    instance.requestRender()
  },

  // Commit text update
  commitTextUpdate(textInstance: TextInstance, oldText: string, newText: string) {
    textInstance.content = newText
    textInstance.requestRender()
  },

  // Append child to container
  appendChildToContainer(container: Container, child: Instance) {
    container.add(child)
  },

  appendInitialChild(parent: Instance, child: Instance) {
    parent.add(child)
  },

  // Hide instance
  hideInstance(instance: Instance) {
    instance.visible = false
    instance.requestRender()
  },

  // Unhide instance
  unhideInstance(instance: Instance, props: Props) {
    instance.visible = true
    instance.requestRender()
  },

  // Hide text instance
  hideTextInstance(textInstance: TextInstance) {
    textInstance.visible = false
    textInstance.requestRender()
  },

  // Unhide text instance
  unhideTextInstance(textInstance: TextInstance, text: string) {
    textInstance.visible = true
    textInstance.requestRender()
  },

  // Clear container
  clearContainer(container: Container) {
    // Remove all children
    const children = container.getChildren()
    children.forEach((child) => container.remove(child.id))
  },

  // Misc
  setCurrentUpdatePriority(newPriority: number) {
    currentUpdatePriority = newPriority
  },

  getCurrentUpdatePriority: () => currentUpdatePriority,

  resolveUpdatePriority() {
    if (currentUpdatePriority !== NoEventPriority) {
      return currentUpdatePriority
    }

    return DefaultEventPriority
  },

  maySuspendCommit() {
    return false
  },

  NotPendingTransition: null,

  HostTransitionContext: createContext(null) as unknown as ReactContext<null>,

  resetFormInstance() {},

  requestPostPaintCallback() {},

  trackSchedulerEvent() {},

  resolveEventType() {
    return null
  },

  resolveEventTimeStamp() {
    return -1.1
  },

  preloadInstance() {
    return true
  },

  startSuspendingCommit() {},

  suspendInstance() {},

  waitForCommitToBeReady() {
    return null
  },

  detachDeletedInstance(instance: Instance) {
    if (!instance.parent) {
      instance.destroy()
    }
  },

  getPublicInstance(instance: Renderable | TextRenderable) {
    return instance
  },

  preparePortalMount(containerInfo: Container) {},

  isPrimaryRenderer: true,

  getInstanceFromNode() {
    return null
  },

  beforeActiveInstanceBlur() {},

  afterActiveInstanceBlur() {},

  prepareScopeUpdate() {},

  getInstanceFromScope() {
    return null
  },
}
