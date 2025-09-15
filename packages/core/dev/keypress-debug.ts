#!/usr/bin/env bun
import { parseKeypress } from "../src/lib/parse.keypress.ts"

console.log("Keypress Debug Tool")
console.log("Press keys to see their parsed output. Press Ctrl+C to exit.\n")

// Set stdin to raw mode to capture individual keypresses
process.stdin.setRawMode(true)
process.stdin.resume()

// Listen for keypress data
process.stdin.on("data", (data: Buffer) => {
  // Check for Ctrl+C to exit
  if (data.toString() === "\x03") {
    console.log("\nExiting keypress debug tool...")
    process.stdin.setRawMode(false)
    process.exit(0)
  }

  const parsed = parseKeypress(data)

  console.log("Input data:", JSON.stringify(data.toString()))
  console.log("Raw:", JSON.stringify(parsed.raw))
  console.log("Parsed:", {
    name: parsed.name,
    ctrl: parsed.ctrl,
    meta: parsed.meta,
    shift: parsed.shift,
    option: parsed.option,
    number: parsed.number,
    sequence: JSON.stringify(parsed.sequence),
    code: parsed.code,
  })
  console.log("---")
})

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\nExiting keypress debug tool...")
  process.stdin.setRawMode(false)
  process.exit(0)
})
