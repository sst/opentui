#!/usr/bin/env bun

import { createSignal, onMount, createEffect } from 'solid-js'
import { render, useRenderer, useTerminalDimensions } from '../index'

function TmuxFourPane() {
  const renderer = useRenderer()
  const dim = useTerminalDimensions()

  // Use default terminal size if not available yet
  const cols = () => dim().width
  const rows = () => dim().height
  
  // Resizable splits - start at 50/50
  const [verticalSplit, setVerticalSplit] = createSignal(40)
  const [horizontalSplit, setHorizontalSplit] = createSignal(12)
  const [isDragging, setIsDragging] = createSignal<'horizontal' | 'vertical' | null>(null)
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 })
  const [isResizing, setIsResizing] = createSignal(false)
  const [focusedPane, setFocusedPane] = createSignal<1 | 2 | 3 | 4>(1)
  
  onMount(() => {
    // Update splits when renderer is ready
    setVerticalSplit(Math.floor(cols() / 2))
    setHorizontalSplit(Math.floor(rows() / 2))
  })
  
  // Calculate pane dimensions
  const leftWidth = () => verticalSplit()
  const rightX = () => verticalSplit() + 1
  const rightWidth = () => cols() - rightX()
  const topHeight = () => horizontalSplit()
  const bottomY = () => horizontalSplit() + 1
  const bottomHeight = () => rows() - bottomY()
  
  // Calculate inner terminal dimensions (account for box borders)
  const innerLeftWidth = () => Math.max(10, leftWidth() - 2)
  const innerRightWidth = () => Math.max(10, rightWidth() - 2)
  const innerTopHeight = () => Math.max(5, topHeight() - 2)
  const innerBottomHeight = () => Math.max(5, bottomHeight() - 2)
  
  // Mouse handlers for dividers
  const handleVerticalMouseDown = (event: any) => {
    setIsDragging('vertical')
    setIsResizing(true)
  }
  
  const handleHorizontalMouseDown = (event: any) => {
    setIsDragging('horizontal')
    setIsResizing(true)
  }
  
  const handleVerticalMouseDrag = (event: any) => {
    if (isDragging() === 'vertical') {
      const constrainedX = Math.max(10, Math.min(cols() - 10, event.x))
      setVerticalSplit(constrainedX)
    }
  }
  
  const handleHorizontalMouseDrag = (event: any) => {
    if (isDragging() === 'horizontal') {
      const constrainedY = Math.max(5, Math.min(rows() - 5, event.y))
      setHorizontalSplit(constrainedY)
    }
  }
  
  const handleMouseUp = () => {
    setIsDragging(null)
    setIsResizing(false)
  }
  
  const handleMouseDragEnd = () => {
    setIsDragging(null)
    setIsResizing(false)
  }
  
  // Terminal refs
  let term1: any, term2: any, term3: any, term4: any
  
  // Handle pane focus
  const focusPane = (pane: 1 | 2 | 3 | 4) => {
    setFocusedPane(pane)
    // Focus the appropriate terminal
    const terminals = [term1, term2, term3, term4]
    const term = terminals[pane - 1]
    if (term && term.focus) {
      term.focus()
    }
  }
  
  return (
    <>
      {/* Top Left Pane */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={leftWidth()}
        height={topHeight()}
        border={true}
        borderStyle="single"
        borderColor={focusedPane() === 1 ? '#0ff' : isDragging() ? '#888' : '#666'}
        title="Pane 1 (Top Left)"
        backgroundColor="black"
        onMouseDown={() => focusPane(1)}
      >
        <box
          position="relative"
          left={1}
          top={1}
          width={innerLeftWidth()}
          height={innerTopHeight()}
        >
          <terminal
            ref={(r) => term1 = r}
            width={innerLeftWidth() - 1}
            height={innerTopHeight() - 1}
            cols={innerLeftWidth() - 1}
            rows={innerTopHeight() - 1}
            shell="bash"
            showBorder={false}
            backgroundColor="#000000"
            autoFocus={focusedPane() === 1}
          />
        </box>
      </box>

      {/* Top Right Pane */}
      <box
        position="absolute"
        left={rightX()}
        top={0}
        width={rightWidth()}
        height={topHeight()}
        border={true}
        borderStyle="single"
        borderColor={focusedPane() === 2 ? '#0ff' : isDragging() ? '#888' : '#666'}
        title="Pane 2 (Top Right)"
        backgroundColor="black"
        onMouseDown={() => focusPane(2)}
      >
        <box
          position="relative"
          left={1}
          top={1}
          width={innerRightWidth()}
          height={innerTopHeight()}
        >
          <terminal
            ref={(r) => term2 = r}
            width={innerRightWidth() - 1}
            height={innerTopHeight() - 1}
            cols={innerRightWidth() - 1}
            rows={innerTopHeight() - 1}
            shell="bash"
            showBorder={false}
            backgroundColor="#000000"
            autoFocus={focusedPane() === 2}
          />
        </box>
      </box>

      {/* Bottom Left Pane */}
      <box
        position="absolute"
        left={0}
        top={bottomY()}
        width={leftWidth()}
        height={bottomHeight()}
        border={true}
        borderStyle="single"
        borderColor={focusedPane() === 3 ? '#0ff' : isDragging() ? '#888' : '#666'}
        title="Pane 3 (Bottom Left)"
        backgroundColor="black"
        onMouseDown={() => focusPane(3)}
      >
        <box
          position="relative"
          left={1}
          top={1}
          width={innerLeftWidth()}
          height={innerBottomHeight()}
        >
          <terminal
            ref={(r) => term3 = r}
            width={innerLeftWidth() - 1}
            height={innerBottomHeight() - 1}
            cols={innerLeftWidth() - 1 }
            rows={innerBottomHeight() - 1}
            shell="bash"
            showBorder={false}
            backgroundColor="#000000"
            autoFocus={focusedPane() === 3}
          />
        </box>
      </box>

      {/* Bottom Right Pane */}
      <box
        position="absolute"
        left={rightX()}
        top={bottomY()}
        width={rightWidth()}
        height={bottomHeight()}
        border={true}
        borderStyle="single"
        borderColor={focusedPane() === 4 ? '#0ff' : isDragging() ? '#888' : '#666'}
        title="Pane 4 (Bottom Right)"
        backgroundColor="black"
        onMouseDown={() => focusPane(4)}
      >
        <box
          position="relative"
          left={1}
          top={1}
          width={innerRightWidth()}
          height={innerBottomHeight()}
        >
          <terminal
            ref={(r) => term4 = r}
            width={innerRightWidth() - 1}
            height={innerBottomHeight() - 1}
            cols={innerRightWidth() - 1}
            rows={innerBottomHeight() - 1}
            shell="bash"
            showBorder={false}
            backgroundColor="#000000"
            autoFocus={focusedPane() === 4}
          />
        </box>
      </box>

      {/* Vertical Divider - Hit Area */}
      <box
        position="absolute"
        left={verticalSplit() - 2}
        top={0}
        width={5}
        height={rows()}
        backgroundColor="transparent"
        zIndex={10}
        onMouseDown={handleVerticalMouseDown}
        onMouseDrag={handleVerticalMouseDrag}
        onMouseUp={handleMouseUp}
        onMouseDragEnd={handleMouseDragEnd}
      />
      {/* Vertical Divider - Visual */}
      <box
        position="absolute"
        left={verticalSplit()}
        top={0}
        width={1}
        height={rows()}
        backgroundColor={isDragging() === 'vertical' ? '#0ff' : '#444'}
        zIndex={9}
      />

      {/* Horizontal Divider - Hit Area */}
      <box
        position="absolute"
        left={0}
        top={horizontalSplit() - 2}
        width={cols()}
        height={5}
        backgroundColor="transparent"
        zIndex={10}
        onMouseDown={handleHorizontalMouseDown}
        onMouseDrag={handleHorizontalMouseDrag}
        onMouseUp={handleMouseUp}
        onMouseDragEnd={handleMouseDragEnd}
      />
      {/* Horizontal Divider - Visual */}
      <box
        position="absolute"
        left={0}
        top={horizontalSplit()}
        width={cols()}
        height={1}
        backgroundColor={isDragging() === 'horizontal' ? '#0ff' : '#444'}
        zIndex={9}
      />
      
      {/* Center cross section where dividers meet */}
      <box
        position="absolute"
        left={verticalSplit()}
        top={horizontalSplit()}
        width={1}
        height={1}
        backgroundColor="#666"
        zIndex={11}
      />
    </>
  )
}

// Main entry point
async function main() {
  try {
    // Load the libvterm-enabled library if available
    const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
    const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
    const ext = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so"
    const libPath = new URL(`../../core/src/zig/lib/${arch}-${os}/libopentui.${ext}`, import.meta.url).pathname
    
    const { setRenderLibPath } = await import("@opentui/core")
    setRenderLibPath(libPath)
    console.log("✅ tmux-like 4-pane terminal with libvterm")
    console.log("Click and drag the dividers to resize panes!")
  } catch (e) {
    console.warn("⚠️  Could not load libvterm library, using fallback")
  }

  // Start the app
  await render(() => <TmuxFourPane />, {
    exitOnCtrlC: true,
    targetFps: 30,
  })
  
  process.on("SIGINT", () => {
    process.exit(0)
  })
}

if (import.meta.main) {
  main().catch(console.error)
}