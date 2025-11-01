import { expect, test } from "bun:test"

import { capture } from "./console"
import { createTestRenderer } from "./testing/test-renderer"
import { createCapturingStdout } from "./testing/stdout-mocks"

test("javascript mode keeps stdout interception active and capture records writes", async () => {
  const mockStdout = createCapturingStdout()
  const originalWrite = mockStdout.write

  const { renderer } = await createTestRenderer({
    outputMode: "javascript",
    stdout: mockStdout,
    disableStdoutInterception: false,
  })

  try {
    expect(mockStdout.write).not.toBe(originalWrite)

    capture.claimOutput()
    mockStdout.write("external log\n")
    expect(capture.claimOutput()).toBe("external log\n")

    ;(renderer as any).writeOut("frame bytes\n")
    expect(mockStdout.written).toContain("frame bytes\n")
  } finally {
    renderer.destroy()
  }
})
