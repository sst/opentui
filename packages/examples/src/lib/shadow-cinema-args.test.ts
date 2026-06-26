import { expect, test } from "bun:test"

import { parseShadowCinemaArgs } from "./shadow-cinema-args.js"

test("accepts one positional video path", () => {
  expect(parseShadowCinemaArgs(["clips/shadow.mp4"])).toEqual({ videoPath: "clips/shadow.mp4" })
})

test("accepts --video and a separator-prefixed positional path", () => {
  expect(parseShadowCinemaArgs(["--video", "/tmp/shadow.mp4"])).toEqual({ videoPath: "/tmp/shadow.mp4" })
  expect(parseShadowCinemaArgs(["--", "-shadow.mp4"])).toEqual({ videoPath: "-shadow.mp4" })
})

test("requires exactly one path", () => {
  expect(() => parseShadowCinemaArgs([])).toThrow("required")
  expect(() => parseShadowCinemaArgs(["one.mp4", "two.mp4"])).toThrow("exactly one")
  expect(() => parseShadowCinemaArgs(["one.mp4", "--video", "two.mp4"])).toThrow("exactly one")
})

test("rejects missing values and unknown options", () => {
  expect(() => parseShadowCinemaArgs(["--video"])).toThrow("--video requires an MP4 path")
  expect(() => parseShadowCinemaArgs(["--wat"])).toThrow("Unknown argument: --wat")
})
