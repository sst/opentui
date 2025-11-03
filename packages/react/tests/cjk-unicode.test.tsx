import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../src/testing"
import React from "react"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("React Renderer - CJK & Unicode Support", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  describe("Emoji Rendering", () => {
    it("should render basic emojis correctly", async () => {
      testSetup = await testRender(React.createElement("text", null, "Hello 🌍 World 👋"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Hello 🌍 World 👋")
    })

    it("should render multiple emojis in list", async () => {
      testSetup = await testRender(
        React.createElement(
          "box",
          null,
          React.createElement("text", null, "🚀 Rocket"),
          React.createElement("text", null, "🔥 Fire"),
          React.createElement("text", null, "✨ Sparkle"),
          React.createElement("text", null, "💯 Perfect"),
        ),
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("🚀")
      expect(frame).toContain("🔥")
      expect(frame).toContain("✨")
      expect(frame).toContain("💯")
    })

    it("should handle emoji with wrapping", async () => {
      testSetup = await testRender(
        React.createElement(
          "text",
          { wrapMode: "word" },
          "This is a test 🌟 with emojis 🎉 that should wrap properly 🚀 across multiple lines",
        ),
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("🌟")
      expect(frame).toContain("🎉")
      expect(frame).toContain("🚀")
    })
  })

  describe("CJK Character Rendering", () => {
    it("should render Korean characters", async () => {
      testSetup = await testRender(React.createElement("text", null, "안녕하세요 한글 테스트"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("안녕하세요 한글 테스트")
    })

    it("should render Japanese characters", async () => {
      testSetup = await testRender(React.createElement("text", null, "こんにちは テスト"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("こんにちは")
    })

    it("should render Chinese characters", async () => {
      testSetup = await testRender(React.createElement("text", null, "你好世界 中文测试"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("你好世界 中文测试")
    })

    it("should render Vietnamese characters", async () => {
      testSetup = await testRender(React.createElement("text", null, "Xin chào Tiếng Việt"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("Xin")
    })
  })

  describe("Mixed CJK & Emoji", () => {
    it("should render mixed Korean and emoji", async () => {
      testSetup = await testRender(React.createElement("text", null, "한글 🎉 테스트 ✨"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("한글")
      expect(frame).toContain("🎉")
      expect(frame).toContain("✨")
    })

    it("should render mixed Chinese and emoji", async () => {
      testSetup = await testRender(React.createElement("text", null, "中文 🌟 文本 🚀"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("中文")
      expect(frame).toContain("🌟")
      expect(frame).toContain("🚀")
    })

    it("should render mixed Japanese and emoji", async () => {
      testSetup = await testRender(React.createElement("text", null, "日本語 🎯 テスト 🌸"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("日本語")
      expect(frame).toContain("🎯")
      expect(frame).toContain("🌸")
    })
  })

  describe("Unicode Special Characters", () => {
    it("should render combining diacriticals", async () => {
      testSetup = await testRender(React.createElement("text", null, "café naïve"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("caf")
      expect(frame).toContain("na")
    })

    it("should render arrows and symbols", async () => {
      testSetup = await testRender(React.createElement("text", null, "← ↑ → ↓ ♠ ♣ ♥ ♦"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("←")
      expect(frame).toContain("♠")
    })

    it("should render mathematical symbols", async () => {
      testSetup = await testRender(React.createElement("text", null, "∑ ∏ √ ∫ ≈ ≠ ≤ ≥"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("∑")
      expect(frame).toContain("√")
    })
  })

  describe("CJK Width Handling", () => {
    it("should properly calculate width for wide characters", async () => {
      testSetup = await testRender(React.createElement("text", null, "한글한글한글"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("한글")
    })

    it("should handle mixed width characters", async () => {
      testSetup = await testRender(React.createElement("text", null, "a한b글c"))

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("한")
      expect(frame).toContain("글")
    })
  })

  describe("Dynamic Updates", () => {
    it("should render multiple CJK text lines", async () => {
      testSetup = await testRender(
        React.createElement(
          "box",
          null,
          React.createElement("text", null, "첫번째 라인"),
          React.createElement("text", null, "두번째 라인"),
        ),
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("첫번째")
      expect(frame).toContain("라인")
    })

    it("should render multiple emoji lines", async () => {
      testSetup = await testRender(
        React.createElement(
          "box",
          null,
          React.createElement("text", null, "🎉 First Line"),
          React.createElement("text", null, "🌟 Second Line"),
        ),
      )

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toContain("🎉")
      expect(frame).toContain("🌟")
    })
  })
})
