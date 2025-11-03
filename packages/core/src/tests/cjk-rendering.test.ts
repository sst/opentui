import { test, expect } from "bun:test"
import { TextNodeRenderable } from "../renderables/TextNode.ts"
import { TextBuffer, type TextChunk } from "../text-buffer.ts"
import { resolveRenderLib } from "../zig.ts"
import { StyledText } from "../lib/styled-text.ts"

// Helper function to get UTF-8 bytes
function getUTF8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

// Test data
const testData = {
  korean: ["한글", "안녕하세요"],
  chinese: ["你好", "世界"],
  japanese: ["こんにちは", "テスト"],
  mixed: ["한글English中文にほんご"],
}

// CJK Test Data
const CJK_TEST_DATA = {
  korean: [
    {
      text: "한",
      utf8Bytes: [0xed, 0x95, 0x9c],
      codePoint: 0xd55c,
      description: "Single Korean syllable",
    },
    {
      text: "가",
      utf8Bytes: [0xea, 0xb0, 0x80],
      codePoint: 0xac00,
      description: "Initial/Medial/Final consonant combination",
    },
    {
      text: "ㄱ",
      utf8Bytes: [0xe3, 0x84, 0xb1],
      codePoint: 0x3131,
      description: "Initial consonant",
    },
    {
      text: "ㅏ",
      utf8Bytes: [0xe3, 0x85, 0x8f],
      codePoint: 0x314f,
      description: "Medial vowel",
    },
    {
      text: "한글",
      utf8Bytes: [0xed, 0x95, 0x9c, 0xea, 0xb8, 0x80],
      codePoint: null,
      description: "Composite Korean text",
    },
  ],
  chinese: [
    {
      text: "世",
      utf8Bytes: [0xe4, 0xb8, 0x96],
      codePoint: 0x4e16,
      description: "Character corrupted in React tests",
    },
    {
      text: "界",
      utf8Bytes: [0xe7, 0x95, 0x8c],
      codePoint: 0x754c,
      description: "Phase 1 corrupted character",
    },
    {
      text: "你",
      utf8Bytes: [0xe4, 0xbd, 0xa0],
      codePoint: 0x4f60,
      description: "Simplified Chinese character",
    },
    {
      text: "國",
      utf8Bytes: [0xe5, 0x9c, 0x8b],
      codePoint: 0x570b,
      description: "Traditional Chinese character",
    },
  ],
  japanese: [
    {
      text: "あ",
      utf8Bytes: [0xe3, 0x81, 0x82],
      codePoint: 0x3042,
      description: "히라가나",
    },
    {
      text: "ア",
      utf8Bytes: [0xe3, 0x82, 0xa2],
      codePoint: 0x30a2,
      description: "가타카나",
    },
    {
      text: "世",
      utf8Bytes: [0xe4, 0xb8, 0x96],
      codePoint: 0x4e16,
      description: "칸지",
    },
  ],
  mixed: [
    {
      text: "Hello 世界 🌍",
      utf8Bytes: [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xe4, 0xb8, 0x96, 0xe7, 0x95, 0x8c, 0x20, 0xf0, 0x9f, 0x8c, 0x8d],
      codePoint: null,
      description: "CJK + ASCII + Emoji",
    },
  ],
}

// Tier 1: TextNode 격리 테스트
test("TextNode.fromString should preserve UTF-8 bytes", () => {
  for (const [lang, texts] of Object.entries(testData)) {
    for (const text of texts) {
      const node = TextNodeRenderable.fromString(text)
      expect(node.children).toHaveLength(1)
      expect(node.children[0]).toBe(text)

      // Verify UTF-8 byte accuracy
      const expectedBytes = getUTF8Bytes(text)
      const actualBytes = getUTF8Bytes(node.children[0] as string)
      expect(actualBytes).toEqual(expectedBytes)

      console.log(`${lang}: "${text}" - bytes preserved: ${expectedBytes.length === actualBytes.length}`)
    }
  }
})

// TextChunk conversion test
test("TextNode.toChunks should preserve character data", () => {
  for (const [lang, texts] of Object.entries(testData)) {
    for (const text of texts) {
      const node = TextNodeRenderable.fromString(text)
      const chunks = node.toChunks()

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
      expect(chunks[0].__isChunk).toBe(true)

      // Verify UTF-8 bytes of chunk text
      const expectedBytes = getUTF8Bytes(text)
      const actualBytes = getUTF8Bytes(chunks[0].text)
      expect(actualBytes).toEqual(expectedBytes)

      console.log(`${lang}: "${text}" - chunk text bytes preserved: ${expectedBytes.length === actualBytes.length}`)
    }
  }
})

// TextBuffer initialization test
test("TextBuffer should initialize with CJK text", () => {
  const lib = resolveRenderLib()
  const buffer = lib.createTextBuffer("wcwidth")

  try {
    for (const [lang, texts] of Object.entries(testData)) {
      for (const text of texts) {
        buffer.setText(text)

        // Verify buffer state
        expect(buffer.length).toBeGreaterThan(0)
        expect(buffer.byteSize).toBeGreaterThan(0)

        // Confirm stored bytes are correct (verified via getPlainText)
        const retrievedText = buffer.getPlainText()
        expect(retrievedText).toBe(text)

        // Compare UTF-8 bytes
        const expectedBytes = getUTF8Bytes(text)
        const actualBytes = getUTF8Bytes(retrievedText)
        expect(actualBytes).toEqual(expectedBytes)

        console.log(`${lang}: "${text}" - buffer bytes: ${buffer.byteSize}, expected: ${expectedBytes.length}`)
      }
    }
  } finally {
    buffer.destroy()
  }
})

// Zig processing verification
test("Zig processing should handle CJK characters correctly", () => {
  const lib = resolveRenderLib()
  const buffer = lib.createTextBuffer("wcwidth")

  try {
    for (const [lang, texts] of Object.entries(testData)) {
      for (const text of texts) {
        console.log(
          `Before setText: "${text}" - bytes: ${getUTF8Bytes(text).length}, content: [${getUTF8Bytes(text).join(", ")}]`,
        )
        buffer.setText(text)
        console.log(
          `After setText: length=${buffer.length}, byteSize=${buffer.byteSize}, retrieved="${buffer.getPlainText()}", bytes: [${getUTF8Bytes(buffer.getPlainText()).join(", ")}]`,
        )

        // Verify results after Zig processing
        const length = buffer.length
        const byteSize = buffer.byteSize
        const retrievedText = buffer.getPlainText()

        // Verify byte size and text (length may be visual/display length)
        expect(byteSize).toBe(getUTF8Bytes(text).length)
        expect(retrievedText).toBe(text)

        // Verify UTF-8 byte integrity
        const expectedBytes = getUTF8Bytes(text)
        const actualBytes = getUTF8Bytes(retrievedText)
        expect(actualBytes).toEqual(expectedBytes)

        console.log(`${lang}: "${text}" - length: ${length}, byteSize: ${byteSize}, corruption check passed`)
      }
    }
  } finally {
    buffer.destroy()
  }
})

// Full rendering pipeline test
test("Full rendering pipeline should preserve CJK text", () => {
  const lib = resolveRenderLib()
  const buffer = lib.createTextBuffer("wcwidth")

  try {
    for (const [lang, texts] of Object.entries(testData)) {
      for (const text of texts) {
        // Create TextNode
        const node = TextNodeRenderable.fromString(text)

        // Convert to TextChunks
        const chunks = node.toChunks()

        // Set chunks in TextBuffer (using setStyledText)
        const styledText = new StyledText(chunks)
        buffer.setStyledText(styledText)

        // Verify final text
        const finalText = buffer.getPlainText()
        expect(finalText).toBe(text)

        // Verify UTF-8 bytes
        const expectedBytes = getUTF8Bytes(text)
        const actualBytes = getUTF8Bytes(finalText)
        expect(actualBytes).toEqual(expectedBytes)

        console.log(`${lang}: "${text}" - full pipeline preserved: ${expectedBytes.length === actualBytes.length}`)
      }
    }
  } finally {
    buffer.destroy()
  }
})
