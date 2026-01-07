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
            h("textareaRenderable", {
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
            h("textareaRenderable", {
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
            h("textareaRenderable", {
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
            h("textareaRenderable", {
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
            h("boxRenderable", { border: true, borderColor: "#444444" }, [
              h("boxRenderable", { flexDirection: "row" }, [
                h(
                  "boxRenderable",
                  { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                  [h("textRenderable", { attributes: TextAttributes.BOLD, fg: "#00ff00" }, ">")],
                ),
                h("boxRenderable", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                  h("textareaRenderable", {
                    initialValue: "Hello from the prompt",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                    cursorColor: "#00ff00",
                  }),
                ]),
                h("boxRenderable", { backgroundColor: "#1e1e1e", width: 1 }),
              ]),
              h("boxRenderable", { flexDirection: "row", justifyContent: "space-between" }, [
                h("textRenderable", { wrapMode: "none" }, [
                  h("spanRenderable", { style: { fg: "#888888" } }, "provider"),
                  " ",
                  h("spanRenderable", { style: { bold: true } }, "model-name"),
                ]),
                h("textRenderable", { fg: "#888888" }, "ctrl+p commands"),
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
            h("boxRenderable", { border: true, borderColor: "#444444", width: "100%" }, [
              h("boxRenderable", { flexDirection: "row", width: "100%" }, [
                h(
                  "boxRenderable",
                  { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                  [h("textRenderable", { attributes: TextAttributes.BOLD, fg: "#00ff00" }, ">")],
                ),
                h("boxRenderable", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                  h("textareaRenderable", {
                    initialValue:
                      "This is a very long prompt that will wrap across multiple lines in the textarea. It should maintain proper layout with the indicator on the left.",
                    wrapMode: "word",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                  }),
                ]),
                h("boxRenderable", { backgroundColor: "#1e1e1e", width: 1 }),
              ]),
              h("boxRenderable", { flexDirection: "row" }, [
                h("textRenderable", { wrapMode: "none" }, [
                  h("spanRenderable", { style: { fg: "#888888" } }, "openai"),
                  " ",
                  h("spanRenderable", { style: { bold: true } }, "gpt-4"),
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
            h("boxRenderable", { border: true, borderColor: "#ff9900" }, [
              h("boxRenderable", { flexDirection: "row" }, [
                h(
                  "boxRenderable",
                  { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                  [h("textRenderable", { attributes: TextAttributes.BOLD, fg: "#ff9900" }, "!")],
                ),
                h("boxRenderable", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                  h("textareaRenderable", {
                    initialValue: "ls -la",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                    cursorColor: "#ff9900",
                  }),
                ]),
                h("boxRenderable", { backgroundColor: "#1e1e1e", width: 1 }),
              ]),
              h("boxRenderable", { flexDirection: "row" }, [h("textRenderable", { fg: "#888888" }, "shell mode")]),
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
            h("boxRenderable", { border: true, title: "Chat" }, [
              h("boxRenderable", { border: true, borderColor: "#00ff00", marginBottom: 1 }, [
                h("boxRenderable", { flexDirection: "row" }, [
                  h("boxRenderable", { width: 5, backgroundColor: "#2d2d2d" }, [
                    h("textRenderable", { fg: "#00ff00" }, "User"),
                  ]),
                  h("boxRenderable", { paddingLeft: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                    h("textareaRenderable", {
                      initialValue: "What is the weather like today?",
                      wrapMode: "word",
                      backgroundColor: "#1e1e1e",
                      textColor: "#ffffff",
                    }),
                  ]),
                ]),
              ]),
              h("boxRenderable", { border: true, borderColor: "#0088ff" }, [
                h("boxRenderable", { flexDirection: "row" }, [
                  h("boxRenderable", { width: 5, backgroundColor: "#2d2d2d" }, [
                    h("textRenderable", { fg: "#0088ff" }, "AI"),
                  ]),
                  h("boxRenderable", { paddingLeft: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                    h("textareaRenderable", {
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
            h("boxRenderable", { style: { width: 50, border: true }, title: "Layout Test" }, [
              h("boxRenderable", { flexDirection: "row", gap: 1 }, [
                h("boxRenderable", { width: 20, border: true, borderColor: "#00ff00" }, [
                  h("textRenderable", { fg: "#00ff00" }, "Input 1:"),
                  h("textareaRenderable", {
                    initialValue: "Left panel content",
                    wrapMode: "word",
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                    flexShrink: 1,
                  }),
                ]),
                h("boxRenderable", { flexGrow: 1, border: true, borderColor: "#0088ff" }, [
                  h("textRenderable", { fg: "#0088ff" }, "Input 2:"),
                  h("textareaRenderable", {
                    initialValue: "Right panel with longer content that may wrap",
                    wrapMode: "word",
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                    flexShrink: 1,
                  }),
                ]),
              ]),
              h("boxRenderable", { border: true, borderColor: "#ff9900", marginTop: 1 }, [
                h("textRenderable", { fg: "#ff9900" }, "Bottom input:"),
                h("textareaRenderable", {
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
            h("boxRenderable", { border: true }, [
              h("boxRenderable", { flexDirection: "row" }, [
                h("boxRenderable", { width: indicatorWidth.value, backgroundColor: "#f00" }, [
                  h("textRenderable", {}, ">"),
                ]),
                h("boxRenderable", { backgroundColor: "#0f0", flexGrow: 1 }, [
                  h("textRenderable", {}, "Content that takes up space"),
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
            h("boxRenderable", { border: true, width: 25, height: 10 }, [
              h("boxRenderable", { flexDirection: "column", height: "100%" }, [
                h("boxRenderable", { height: headerHeight.value, backgroundColor: "#f00" }, [
                  h("textRenderable", {}, "Header"),
                ]),
                h("boxRenderable", { backgroundColor: "#0f0", flexGrow: 1 }, [
                  h("textareaRenderable", { initialValue: "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8" }),
                ]),
                h("boxRenderable", { height: 2, backgroundColor: "#00f" }, [h("textRenderable", {}, "Footer")]),
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
            h("boxRenderable", { border: true }, [
              h("boxRenderable", { flexDirection: "row" }, [
                h("boxRenderable", { width: 3, backgroundColor: "#2d2d2d" }, [h("textRenderable", {}, ">")]),
                h("boxRenderable", { backgroundColor: "#1e1e1e", flexGrow: 1, paddingTop: 1, paddingBottom: 1 }, [
                  h("textareaRenderable", {
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
            h("boxRenderable", { border: true, borderColor: "#444444" }, [
              h("boxRenderable", { flexDirection: "row" }, [
                h(
                  "boxRenderable",
                  { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                  [h("textRenderable", { attributes: TextAttributes.BOLD, fg: "#00ff00" }, ">")],
                ),
                h("boxRenderable", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                  h("textareaRenderable", {
                    initialValue: "",
                    placeholder: "Enter your prompt here...",
                    placeholderColor: "#666666",
                    flexShrink: 1,
                    backgroundColor: "#1e1e1e",
                    textColor: "#ffffff",
                  }),
                ]),
                h("boxRenderable", { backgroundColor: "#1e1e1e", width: 1 }),
              ]),
              h("boxRenderable", { flexDirection: "row" }, [h("textRenderable", { fg: "#888888" }, "Ready to chat")]),
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
            h("boxRenderable", { border: true }, [
              h("boxRenderable", { flexDirection: "row" }, [
                h("boxRenderable", { width: 3, backgroundColor: "#2d2d2d" }, [h("textRenderable", {}, ">")]),
                h("boxRenderable", { backgroundColor: "#1e1e1e", flexGrow: 1, paddingTop: 1, paddingBottom: 1 }, [
                  h("textareaRenderable", {
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
            h("boxRenderable", {}, [
              h("boxRenderable", { border: true, borderColor: "#444444" }, [
                h("boxRenderable", { flexDirection: "row" }, [
                  h(
                    "boxRenderable",
                    { width: 3, justifyContent: "center", alignItems: "center", backgroundColor: "#2d2d2d" },
                    [h("textRenderable", { attributes: TextAttributes.BOLD, fg: "#00ff00" }, ">")],
                  ),
                  h("boxRenderable", { paddingTop: 1, paddingBottom: 1, backgroundColor: "#1e1e1e", flexGrow: 1 }, [
                    h("textareaRenderable", {
                      initialValue: "Explain how async/await works in JavaScript and provide some examples",
                      wrapMode: "word",
                      flexShrink: 1,
                      backgroundColor: "#1e1e1e",
                      textColor: "#ffffff",
                      cursorColor: "#00ff00",
                    }),
                  ]),
                  h("boxRenderable", {
                    backgroundColor: "#1e1e1e",
                    width: 1,
                    justifyContent: "center",
                    alignItems: "center",
                  }),
                ]),
                h("boxRenderable", { flexDirection: "row", justifyContent: "space-between" }, [
                  h("textRenderable", { flexShrink: 0, wrapMode: "none" }, [
                    h("spanRenderable", { style: { fg: "#888888" } }, "openai"),
                    " ",
                    h("spanRenderable", { style: { bold: true } }, "gpt-4-turbo"),
                  ]),
                  h("textRenderable", {}, ["ctrl+p ", h("spanRenderable", { style: { fg: "#888888" } }, "commands")]),
                ]),
              ]),
              h("boxRenderable", { marginTop: 1 }, [
                h(
                  "textRenderable",
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
