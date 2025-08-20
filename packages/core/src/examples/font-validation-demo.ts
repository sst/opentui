#!/usr/bin/env bun
import { createCliRenderer, ASCIIFontRenderable, BoxRenderable, type FontDefinition, validateFontDefinition } from ".."

// Test invalid font definitions
const invalidFonts = [
  {
    name: "Missing lines",
    font: {
      name: "invalid1",
      letterspace_size: 1,
      letterspace: [" "],
      chars: { "A": ["A"] }
    }
  },
  {
    name: "Wrong letterspace length",
    font: {
      name: "invalid2",
      lines: 2,
      letterspace_size: 1,
      letterspace: [" "], // Should be 2 items
      chars: { "A": ["▄", "█"] }
    }
  },
  {
    name: "Character line count mismatch",
    font: {
      name: "invalid3",
      lines: 2,
      letterspace_size: 1,
      letterspace: [" ", " "],
      chars: { "A": ["▄"] } // Should have 2 lines
    }
  },
  {
    name: "Invalid colors",
    font: {
      name: "invalid4",
      lines: 1,
      letterspace_size: 1,
      letterspace: [" "],
      colors: -1, // Must be positive
      chars: { "A": ["A"] }
    }
  }
]

// Valid font definition
const validFont: FontDefinition = {
  name: "valid",
  lines: 2,
  letterspace_size: 1,
  letterspace: [" ", " "],
  chars: {
    "T": ["▀█▀", " █ "],
    "E": ["█▀▀", "██▄"],
    "S": ["█▀▀", "▄▄█"],
    " ": ["   ", "   "]
  }
}

async function main() {
  console.log("Testing font validation...\n")

  // Test invalid fonts
  for (const { name, font } of invalidFonts) {
    try {
      validateFontDefinition(font)
      console.log(`❌ ${name}: Should have failed but didn't`)
    } catch (error) {
      console.log(`✅ ${name}: Correctly rejected - ${error.message}`)
    }
  }

  // Test valid font
  try {
    validateFontDefinition(validFont)
    console.log(`✅ Valid font: Correctly accepted`)
  } catch (error) {
    console.log(`❌ Valid font: Should have passed but failed - ${error.message}`)
  }

  console.log("\nTesting ASCIIFontRenderable with invalid font...")
  
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
  })

  const container = new BoxRenderable("container", {
    width: "100%",
    height: "100%",
    padding: 2,
    flexDirection: "column",
    gap: 2,
  })

  // This should work - valid font
  try {
    const validText = new ASCIIFontRenderable("valid", {
      text: "TEST",
      font: validFont,
      fg: "#00ff00"
    })
    container.add(validText)
    console.log("✅ ASCIIFontRenderable accepted valid font")
  } catch (error) {
    console.log(`❌ ASCIIFontRenderable rejected valid font: ${error.message}`)
  }

  // This should fail - invalid font
  try {
    const invalidText = new ASCIIFontRenderable("invalid", {
      text: "FAIL",
      font: invalidFonts[0].font as FontDefinition,
      fg: "#ff0000"
    })
    container.add(invalidText)
    console.log("❌ ASCIIFontRenderable accepted invalid font")
  } catch (error) {
    console.log(`✅ ASCIIFontRenderable correctly rejected invalid font`)
  }

  renderer.root.add(container)
  renderer.start()

  setTimeout(() => {
    renderer.destroy()
    process.exit(0)
  }, 2000)
}

main().catch(console.error)