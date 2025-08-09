import { ContainerElement, Element, type ElementOptions } from "../element"
import { TabSelectElement, TabSelectElementEvents, GroupRenderable, RenderableEvents } from "../../index"
import type { CliRenderer, TabSelectOption } from "../../index"
import type { ColorInput } from "../../types"

export interface TabObject {
  title: string
  init(tabGroup: ContainerElement): void
  update?(deltaMs: number, tabGroup: ContainerElement): void
  show?(): void
  hide?(): void
}

interface Tab {
  title: string
  tabObject: TabObject
  group: ContainerElement
  initialized: boolean
}

export interface TabControllerElementOptions extends ElementOptions {
  tabBarHeight?: number
  tabBarBackgroundColor?: ColorInput
  selectedBackgroundColor?: ColorInput
  selectedTextColor?: ColorInput
  selectedDescriptionColor?: ColorInput
  showDescription?: boolean
  showUnderline?: boolean
  showScrollArrows?: boolean
}

export enum TabControllerElementEvents {
  TAB_CHANGED = "tabChanged",
}

export class TabControllerElement extends Element {
  public tabs: Tab[] = []
  private currentTabIndex = 0
  private tabSelectElement: TabSelectElement
  private tabBarHeight: number
  private frameCallback: ((deltaMs: number) => Promise<void>) | null = null

  constructor(
    id: string,
    private renderer: CliRenderer,
    options: TabControllerElementOptions,
  ) {
    super(id, options)

    this.tabBarHeight = options.tabBarHeight || 4

    this.tabSelectElement = new TabSelectElement(`${id}-tabs`, {
      width: "100%",
      height: this.tabBarHeight,
      options: [],
      zIndex: this.zIndex + 100,
      selectedBackgroundColor: options.selectedBackgroundColor || "#333333",
      selectedTextColor: options.selectedTextColor || "#FFFF00",
      textColor: this.textColor,
      selectedDescriptionColor: options.selectedDescriptionColor || "#FFFFFF",
      backgroundColor: options.tabBarBackgroundColor || this._backgroundColor,
      borderStyle: this.borderStyle,
      borderColor: this.borderColor,
      focusedBorderColor: this.focusedBorderColor,
      showDescription: options.showDescription ?? true,
      showUnderline: options.showUnderline ?? true,
      showScrollArrows: options.showScrollArrows ?? true,
    })

    this.tabSelectElement.on(TabSelectElementEvents.SELECTION_CHANGED, (index: number) => {
      this.switchToTab(index)
    })

    this.add(this.tabSelectElement)

    this.frameCallback = async (deltaMs) => {
      this.update(deltaMs)
    }
    this.renderer.setFrameCallback(this.frameCallback)
  }

  public addTab(tabObject: TabObject): Tab {
    const tabGroup = new ContainerElement(`${this.id}-tab-${this.tabs.length}`, {
      position: {
        left: 0,
        top: this.tabBarHeight,
      },
      zIndex: this.zIndex + 50,
      visible: false,
      width: "100%",
      height: 1,
    })

    this.add(tabGroup)

    const tab: Tab = {
      title: tabObject.title,
      tabObject,
      group: tabGroup,
      initialized: false,
    }
    this.tabs.push(tab)

    this.updateTabSelectOptions()
    return tab
  }

  private updateTabSelectOptions(): void {
    const options: TabSelectOption[] = this.tabs.map((tab, index) => ({
      name: tab.title,
      description: `Tab ${index + 1}/${this.tabs.length} - Use Left/Right arrows to navigate | Press Ctrl+C to exit | D: toggle debug`,
      value: index,
    }))

    this.tabSelectElement.setOptions(options)

    if (this.tabs.length === 1) {
      const firstTab = this.getCurrentTab()
      firstTab.group.visible = true
      this.initializeTab(firstTab)

      if (firstTab.tabObject.show) {
        firstTab.tabObject.show()
      }
    }
  }

  private initializeTab(tab: Tab): void {
    if (!tab.initialized) {
      tab.tabObject.init(tab.group)
      tab.initialized = true
    }
  }

  public getCurrentTab(): Tab {
    return this.tabs[this.currentTabIndex]
  }

  public getCurrentTabGroup(): GroupRenderable {
    return this.getCurrentTab().group
  }

  public switchToTab(index: number): void {
    if (index < 0 || index >= this.tabs.length) return
    if (index === this.currentTabIndex) return

    const currentTab = this.getCurrentTab()
    currentTab.group.visible = false
    if (currentTab.tabObject.hide) {
      currentTab.tabObject.hide()
    }

    this.currentTabIndex = index
    this.tabSelectElement.setSelectedIndex(index)

    const newTab = this.getCurrentTab()
    newTab.group.visible = true

    this.initializeTab(newTab)

    if (newTab.tabObject.show) {
      newTab.tabObject.show()
    }

    this.emit(TabControllerElementEvents.TAB_CHANGED, index, newTab)
  }

  public nextTab(): void {
    this.switchToTab((this.currentTabIndex + 1) % this.tabs.length)
  }

  public previousTab(): void {
    this.switchToTab((this.currentTabIndex - 1 + this.tabs.length) % this.tabs.length)
  }

  public update(deltaMs: number): void {
    const currentTab = this.getCurrentTab()
    if (currentTab && currentTab.tabObject.update) {
      currentTab.tabObject.update(deltaMs, currentTab.group)
    }
  }

  public getCurrentTabIndex(): number {
    return this.currentTabIndex
  }

  public getTabSelectElement(): TabSelectElement {
    return this.tabSelectElement
  }

  public focus(): void {
    this.tabSelectElement.focus()
    this.emit(RenderableEvents.FOCUSED)
  }

  public blur(): void {
    this.tabSelectElement.blur()
    this.emit(RenderableEvents.BLURRED)
  }

  public get focused(): boolean {
    return this.tabSelectElement.focused
  }

  public onResize(width: number, height: number): void {
    if (this.width === width && this.height === height) return

    this.width = width
    this.height = height

    this.tabSelectElement.width = width
    this.tabSelectElement.height = this.tabBarHeight

    for (const tab of this.tabs) {
      tab.group.y = this.tabBarHeight
      tab.group.width = width
      tab.group.height = height - this.tabBarHeight
    }
    super.onResize(width, height)
  }

  protected destroySelf(): void {
    this.blur()

    if (this.frameCallback) {
      this.renderer.removeFrameCallback(this.frameCallback)
      this.frameCallback = null
    }

    for (const tab of this.tabs) {
      tab.group.destroy()
    }

    this.tabSelectElement.destroy()

    this.removeAllListeners()
  }
}
