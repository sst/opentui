import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { defineComponent, h, Fragment } from "vue"
import { testRender } from "../src/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Vue Renderer | Layout Tests", () => {
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

  describe("Basic Text Rendering", () => {
    it("should render simple text correctly", async () => {
      const TestComponent = defineComponent({
        render() {
          return h("Text", {}, "Hello World")
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 20,
        height: 5,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render multiline text correctly", async () => {
      const TestComponent = defineComponent({
        render() {
          return h("box", {}, [
            h("Text", {}, "Line 1"),
            h("Text", {}, "Line 2"),
            h("Text", {}, "Line 3"),
          ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 15,
        height: 5,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render text with dynamic content", async () => {
      const counter = 42

      const TestComponent = defineComponent({
        render() {
          return h("Text", {}, `Counter: ${counter}`)
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 20,
        height: 3,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Box Layout Rendering", () => {
    it("should render basic box layout correctly", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(
            "box",
            {
              style: { width: 20, height: 5, border: true },
            },
            [h("Text", {}, "Inside Box")],
          )
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 25,
        height: 8,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render nested boxes correctly", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(
            "box",
            {
              style: { width: 30, height: 10, border: true },
              title: "Parent Box",
            },
            [
              h(
                "box",
                {
                  style: { left: 2, top: 2, width: 10, height: 3, border: true },
                },
                [h("Text", {}, "Nested")],
              ),
              h(
                "Text",
                {
                  style: { left: 15, top: 2 },
                },
                "Sibling",
              ),
            ],
          )
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 35,
        height: 12,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render absolute positioned boxes", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(Fragment, [
            h(
              "box",
              {
                style: {
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 10,
                  height: 3,
                  border: true,
                  backgroundColor: "red",
                },
              },
              [h("Text", {}, "Box 1")],
            ),
            h(
              "box",
              {
                style: {
                  position: "absolute",
                  left: 12,
                  top: 2,
                  width: 10,
                  height: 3,
                  border: true,
                  backgroundColor: "blue",
                },
              },
              [h("Text", {}, "Box 2")],
            ),
          ])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 25,
        height: 8,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should auto-enable border when borderStyle is set", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(
            "box",
            {
              style: { width: 20, height: 5 },
              borderStyle: "single",
            },
            [h("Text", {}, "With Border")],
          )
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 25,
        height: 8,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should auto-enable border when borderColor is set", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(
            "box",
            {
              style: { width: 20, height: 5 },
              borderColor: "cyan",
            },
            [h("Text", {}, "Colored Border")],
          )
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 25,
        height: 8,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Complex Layouts", () => {
    it("should render complex nested layout correctly", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(
            "box",
            {
              style: { width: 40, border: true },
              title: "Complex Layout",
            },
            [
              h(
                "box",
                {
                  style: { left: 2, width: 15, height: 5, border: true, backgroundColor: "#333" },
                },
                [
                  h("Text", { style: { fg: "cyan" }, wrapMode: "none" }, "Header Section"),
                  h("Text", { style: { fg: "yellow" }, wrapMode: "none" }, "Menu Item 1"),
                  h("Text", { style: { fg: "yellow" }, wrapMode: "none" }, "Menu Item 2"),
                ],
              ),
              h(
                "box",
                {
                  style: { left: 18, width: 18, height: 8, border: true, backgroundColor: "#222" },
                },
                [
                  h("Text", { style: { fg: "green" }, wrapMode: "none" }, "Content Area"),
                  h("Text", { style: { fg: "white" }, wrapMode: "none" }, "Some content here"),
                  h("Text", { style: { fg: "white" }, wrapMode: "none" }, "More content"),
                  h("Text", { style: { fg: "magenta" }, wrapMode: "none" }, "Footer text"),
                ],
              ),
              h("Text", { style: { left: 2, fg: "gray" } }, "Status: Ready"),
            ],
          )
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 45,
        height: 18,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render text with mixed styling and layout", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(
            "box",
            {
              style: { width: 35, height: 8, border: true },
            },
            [
              h("Text", {}, [
                h("Span", { style: { fg: "red", bold: true } }, "ERROR:"),
                " Something went wrong",
              ]),
              h("Text", {}, [
                h("Span", { style: { fg: "yellow" } }, "WARNING:"),
                " Check your settings",
              ]),
              h("Text", {}, [
                h("Span", { style: { fg: "green" } }, "SUCCESS:"),
                " All systems operational",
              ]),
            ],
          )
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

    it("should render scrollbox with sticky scroll and spacer", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(
            "box",
            {
              maxHeight: "100%",
              maxWidth: "100%",
            },
            [
              h(
                "scrollbox",
                {
                  scrollbarOptions: { visible: false },
                  stickyScroll: true,
                  stickyStart: "bottom",
                  paddingTop: 1,
                  paddingBottom: 1,
                  title: "scroll area",
                  rootOptions: {
                    flexGrow: 0,
                  },
                  border: true,
                },
                [h("box", { border: true, height: 10, title: "hi" })],
              ),
              h(
                "box",
                {
                  border: true,
                  height: 10,
                  title: "spacer",
                  flexShrink: 0,
                },
                [h("Text", {}, "spacer")],
              ),
            ],
          )
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 30,
        height: 25,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Empty and Edge Cases", () => {
    it("should handle empty component", async () => {
      const TestComponent = defineComponent({
        render() {
          return h(Fragment, [])
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 10,
        height: 5,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should handle component with no children", async () => {
      const TestComponent = defineComponent({
        render() {
          return h("box", { style: { width: 10, height: 5 } })
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 15,
        height: 8,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should handle very small dimensions", async () => {
      const TestComponent = defineComponent({
        render() {
          return h("Text", {}, "Hi")
        },
      })

      testSetup = await testRender(TestComponent, {
        width: 5,
        height: 3,
      })

      await testSetup.renderOnce()
      const frame = testSetup.captureCharFrame()
      expect(frame).toMatchSnapshot()
    })
  })
})
