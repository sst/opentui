import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { defineComponent, h, ref } from "vue"
import { testRender } from "../src/test-utils"
import { TextAttributes } from "@opentui/core"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Vue Renderer | Textarea Layout Tests", () => {
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

  describe("Basic Textarea Rendering", () => {
    it("should render simple textarea correctly", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("Textarea", {
              initialValue: "Hello World",
              width: 20,
              height: 5,
              backgroundColor: "#1e1e1e",
              textColor: "#ffffff",
            })
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 30,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render multiline textarea content", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("Textarea", {
              initialValue: "Line 1\nLine 2\nLine 3",
              width: 20,
              height: 10,
              backgroundColor: "#1e1e1e",
              textColor: "#ffffff",
            })
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 30,
        height: 15,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render textarea with word wrapping", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("Textarea", {
              initialValue: "This is a very long line that should wrap to multiple lines when word wrapping is enabled",
              wrapMode: "word",
              width: 20,
              backgroundColor: "#1e1e1e",
              textColor: "#ffffff",
            })
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 30,
        height: 15,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render textarea with placeholder", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("Textarea", {
              initialValue: "",
              placeholder: "Type something here...",
              placeholderColor: "#666666",
              width: 30,
              height: 5,
              backgroundColor: "#1e1e1e",
              textColor: "#ffffff",
            })
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 40,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Prompt-like Layout", () => {
    it("should render textarea in prompt-style layout with indicator", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true, borderColor: "#444444" }, [
              h("box", { flexDirection: "row" }, [
                h(
                  "box",
                  { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                  [h("Text", { attributes: TextAttributes.BOLD, fg: "#00ff00" }, ">")],
                ),
                h("box", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                  h("Textarea", {
                    initialValue: "Hello from the prompt",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                    cursorColor: "#00ff00",
                  }),
                ]),
                h("box", { backgroundColor: "#1e1e1e", width: 1 }),
              ]),
              h("box", { flexDirection: "row", justifyContent: "space-between" }, [
                h("Text", { wrapMode: "none" }, [
                  h("Span", { style: { fg: "#888888" } }, "provider"),
                  " ",
                  h("Span", { style: { bold: true } }, "model-name"),
                ]),
                h("Text", { fg: "#888888" }, "ctrl+p commands"),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 60,
        height: 15,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render textarea with long wrapping text in prompt layout", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true, borderColor: "#444444", width: "100%" }, [
              h("box", { flexDirection: "row", width: "100%" }, [
                h(
                  "box",
                  { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                  [h("Text", { attributes: TextAttributes.BOLD, fg: "#00ff00" }, ">")],
                ),
                h("box", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                  h("Textarea", {
                    initialValue:
                      "This is a very long prompt that will wrap across multiple lines in the textarea. It should maintain proper layout with the indicator on the left.",
                    wrapMode: "word",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                  }),
                ]),
                h("box", { backgroundColor: "#1e1e1e", width: 1 }),
              ]),
              h("box", { flexDirection: "row" }, [
                h("Text", { wrapMode: "none" }, [
                  h("Span", { style: { fg: "#888888" } }, "openai"),
                  " ",
                  h("Span", { style: { bold: true } }, "gpt-4"),
                ]),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 50,
        height: 20,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render textarea in shell mode with different indicator", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true, borderColor: "#ff9900" }, [
              h("box", { flexDirection: "row" }, [
                h(
                  "box",
                  { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                  [h("Text", { attributes: TextAttributes.BOLD, fg: "#ff9900" }, "!")],
                ),
                h("box", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                  h("Textarea", {
                    initialValue: "ls -la",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                    cursorColor: "#ff9900",
                  }),
                ]),
                h("box", { backgroundColor: "#1e1e1e", width: 1 }),
              ]),
              h("box", { flexDirection: "row" }, [h("Text", { fg: "#888888" }, "shell mode")]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 50,
        height: 12,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Complex Layouts with Multiple Textareas", () => {
    it("should render multiple textareas in a column layout", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true, title: "Chat" }, [
              h("box", { border: true, borderColor: "#00ff00", marginBottom: 1 }, [
                h("box", { flexDirection: "row" }, [
                  h("box", { width: 5, backgroundColor: "#2d2d2d" }, [
                    h("Text", { fg: "#00ff00" }, "User"),
                  ]),
                  h("box", { paddingLeft: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                    h("Textarea", {
                      initialValue: "What is the weather like today?",
                      wrapMode: "word",
                      backgroundColor: "#1e1e1e",
                      textColor: "#ffffff",
                    }),
                  ]),
                ]),
              ]),
              h("box", { border: true, borderColor: "#0088ff" }, [
                h("box", { flexDirection: "row" }, [
                  h("box", { width: 5, backgroundColor: "#2d2d2d" }, [
                    h("Text", { fg: "#0088ff" }, "AI"),
                  ]),
                  h("box", { paddingLeft: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                    h("Textarea", {
                      initialValue:
                        "I don't have access to real-time weather data, but I can help you find that information through various weather services.",
                      wrapMode: "word",
                      backgroundColor: "#1e1e1e",
                      textColor: "#ffffff",
                    }),
                  ]),
                ]),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 60,
        height: 25,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should handle nested boxes with textareas at different positions", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { style: { width: 50, border: true }, title: "Layout Test" }, [
              h("box", { flexDirection: "row", gap: 1 }, [
                h("box", { width: 20, border: true, borderColor: "#00ff00" }, [
                  h("Text", { fg: "#00ff00" }, "Input 1:"),
                  h("Textarea", {
                    initialValue: "Left panel content",
                    wrapMode: "word",
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                    flexShrink: 1,
                  }),
                ]),
                h("box", { flexGrow: 1, border: true, borderColor: "#0088ff" }, [
                  h("Text", { fg: "#0088ff" }, "Input 2:"),
                  h("Textarea", {
                    initialValue: "Right panel with longer content that may wrap",
                    wrapMode: "word",
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                    flexShrink: 1,
                  }),
                ]),
              ]),
              h("box", { border: true, borderColor: "#ff9900", marginTop: 1 }, [
                h("Text", { fg: "#ff9900" }, "Bottom input:"),
                h("Textarea", {
                  initialValue: "Bottom panel spanning full width",
                  wrapMode: "word",
                  backgroundColor: "#1e1e1e",
                  textColor: "#ffffff",
                  flexShrink: 1,
                }),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 55,
        height: 25,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("FlexShrink Regression Tests", () => {
    it("should not shrink box when width is set via setter", async () => {
      const indicatorWidth = ref<number | undefined>(undefined)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true }, [
              h("box", { flexDirection: "row" }, [
                h("box", { width: indicatorWidth.value, backgroundColor: "#f00" }, [
                  h("Text", {}, ">"),
                ]),
                h("box", { backgroundColor: "#0f0", flexGrow: 1 }, [
                  h("Text", {}, "Content that takes up space"),
                ]),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 5 })

      await testSetup.renderOnce()

      indicatorWidth.value = 5
      await testSetup.renderOnce()

      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should not shrink box when height is set via setter in column layout", async () => {
      const headerHeight = ref<number | undefined>(undefined)

      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true, width: 25, height: 10 }, [
              h("box", { flexDirection: "column", height: "100%" }, [
                h("box", { height: headerHeight.value, backgroundColor: "#f00" }, [
                  h("Text", {}, "Header"),
                ]),
                h("box", { backgroundColor: "#0f0", flexGrow: 1 }, [
                  h("Textarea", { initialValue: "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8" }),
                ]),
                h("box", { height: 2, backgroundColor: "#00f" }, [h("Text", {}, "Footer")]),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, { width: 30, height: 15 })

      await testSetup.renderOnce()

      headerHeight.value = 3
      await testSetup.renderOnce()

      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Edge Cases and Styling", () => {
    it("should render textarea with focused colors", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true }, [
              h("box", { flexDirection: "row" }, [
                h("box", { width: 3, backgroundColor: "#2d2d2d" }, [h("Text", {}, ">")]),
                h("box", { backgroundColor: "#1e1e1e", flexGrow: 1, paddingTop: 1, paddingBottom: 1 }, [
                  h("Textarea", {
                    initialValue: "Focused textarea",
                    backgroundColor: "#1e1e1e",
                    textColor: "#888888",
                    focusedBackgroundColor: "#2d2d2d",
                    focusedTextColor: "#ffffff",
                    flexShrink: 1,
                  }),
                ]),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 40,
        height: 10,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render empty textarea with placeholder in prompt layout", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true, borderColor: "#444444" }, [
              h("box", { flexDirection: "row" }, [
                h(
                  "box",
                  { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                  [h("Text", { attributes: TextAttributes.BOLD, fg: "#00ff00" }, ">")],
                ),
                h("box", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                  h("Textarea", {
                    initialValue: "",
                    placeholder: "Enter your prompt here...",
                    placeholderColor: "#666666",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                  }),
                ]),
                h("box", { backgroundColor: "#1e1e1e", width: 1 }),
              ]),
              h("box", { flexDirection: "row" }, [h("Text", { fg: "#888888" }, "Ready to chat")]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 50,
        height: 12,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render textarea with very long single line", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", { border: true }, [
              h("box", { flexDirection: "row" }, [
                h("box", { width: 3, backgroundColor: "#2d2d2d" }, [h("Text", {}, ">")]),
                h("box", { backgroundColor: "#1e1e1e", flexGrow: 1, paddingTop: 1, paddingBottom: 1 }, [
                  h("Textarea", {
                    initialValue: "ThisIsAVeryLongLineWithNoSpacesThatWillWrapByCharacterWhenCharWrappingIsEnabled",
                    wrapMode: "char",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                  }),
                ]),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 40,
        height: 15,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render full prompt-like layout with all components", async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h("box", {}, [
              h("box", { border: true, borderColor: "#444444" }, [
                h("box", { flexDirection: "row" }, [
                  h(
                    "box",
                    { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                    [h("Text", { attributes: TextAttributes.BOLD, fg: "#00ff00" }, ">")],
                  ),
                  h("box", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                    h("Textarea", {
                      initialValue: "Explain how async/await works in JavaScript and provide some examples",
                      wrapMode: "word",
                      flexShrink: 1,
                      backgroundColor: "#1e1e1e",
                      textColor: "#ffffff",
                      cursorColor: "#00ff00",
                    }),
                  ]),
                  h("box", {
                    backgroundColor: "#1e1e1e",
                    width: 1,
                    justifyContent: "center",
                    alignItems: "center",
                  }),
                ]),
                h("box", { flexDirection: "row", justifyContent: "space-between" }, [
                  h("Text", { flexShrink: 0, wrapMode: "none" }, [
                    h("Span", { style: { fg: "#888888" } }, "openai"),
                    " ",
                    h("Span", { style: { bold: true } }, "gpt-4-turbo"),
                  ]),
                  h("Text", {}, ["ctrl+p ", h("Span", { style: { fg: "#888888" } }, "commands")]),
                ]),
              ]),
              h("box", { marginTop: 1 }, [
                h(
                  "Text",
                  { fg: "#666666", wrapMode: "word" },
                  "Tip: Use arrow keys to navigate through history when cursor is at the start",
                ),
              ]),
            ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 70,
        height: 20,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })
})
