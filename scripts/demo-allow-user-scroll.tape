# VHS script to record the allowUserScroll demo
# This demonstrates the new allowUserScroll feature that disables user scrolling
# while still allowing automatic/programmatic scrolling

Output demos/allow-user-scroll-demo.gif

# Set terminal size for optimal viewing
Set FontSize 14
Set Width 1200
Set Height 800
Set Framerate 30
Set LoopOffset 15%
Set Padding 40

# Wait for the application to start
Type "cd packages/core"
Enter
Sleep 1s

# Run the demo directly
Type "bun run src/examples/allow-user-scroll-demo.ts"
Enter
Sleep 4s

# The demo automatically runs through 7 phases:
# 1. Add 30 lines of content (both auto-scroll to bottom)
# 2. User scrolls UP on left 15x (works - shows earlier lines)
# 3. User tries to scroll UP on right 15x (BLOCKED - stays at bottom)
# 4. More UP scrolling on left 10x (shows full scroll range)
# 5. More blocked scrolling on right 10x (still doesn't move)
# 6. Slider thumb drag on LEFT (works - scrolls content)
# 7. Slider thumb drag on RIGHT (BLOCKED - no movement)

# Wait for the full automatic demo sequence (~16 seconds)
Sleep 20s

# Show final state
Sleep 2s

# Exit the demo
Type "q"
Sleep 2s
