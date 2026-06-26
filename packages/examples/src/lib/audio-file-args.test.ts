import { expect, test } from "bun:test"

import { parseAudioFileArgs } from "./audio-file-args.js"

test("uses the bundled track when no file is supplied", () => {
  expect(parseAudioFileArgs([])).toEqual({ filePath: undefined })
})

test("accepts short and long file arguments", () => {
  expect(parseAudioFileArgs(["-f", "music/one.wav"])).toEqual({ filePath: "music/one.wav" })
  expect(parseAudioFileArgs(["--file", "/tmp/two.mp3"])).toEqual({ filePath: "/tmp/two.mp3" })
})

test("accepts a command separator before the file argument", () => {
  expect(parseAudioFileArgs(["--", "-f", "music.wav"])).toEqual({ filePath: "music.wav" })
})

test("rejects missing values and unknown arguments", () => {
  expect(() => parseAudioFileArgs(["-f"])).toThrow("-f requires an audio file path")
  expect(() => parseAudioFileArgs(["--wat"])).toThrow("Unknown argument: --wat")
})
