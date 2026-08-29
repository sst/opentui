import { expect, test } from "bun:test"
import { NativeImage } from "@opentui/core"
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, OrthographicCamera, Scene } from "three"
import { createPixelRenderer, packRgba } from "./pixel-renderer.js"

test("packing handles BGRA, RGBA, row padding, and subarray views", () => {
  for (const format of ["rgba8", "bgra8"] as const) {
    const data = new Uint8Array([99, 1, 2, 3, 4, 99, 99, 99, 99, 5, 6, 7, 8, 99]).subarray(1, 13)
    const output = new Uint8Array(8)
    packRgba({ data, width: 1, height: 2, stride: 8, format }, output)
    expect([...output]).toEqual(format === "rgba8" ? [1, 2, 3, 4, 5, 6, 7, 8] : [3, 2, 1, 4, 7, 6, 5, 8])
  }
})

for (const mapping of ["view", "pointer"] as const) {
  for (const release of [undefined, "baseline", "command-buffers", "passes", "combined"] as const) {
    const mode = release ?? "combined"
    test.skipIf(process.env.GPU_TESTS !== "1")(
      `${mapping}/${release ?? "default"} preserves GPU colors, padding, and ownership over many frames`,
      async () => {
        const gpu = await createPixelRenderer(
          65,
          33,
          mapping,
          release === undefined ? undefined : { release, cacheCanvasView: true },
        )
        const scene = new Scene()
        scene.background = new Color("#102030")
        const geometry = new BoxGeometry()
        const material = new MeshBasicMaterial({ color: "red" })
        scene.add(new Mesh(geometry, material))
        const camera = new OrthographicCamera(-2, 2, 1, -1, 0.1, 100)
        camera.position.z = 3
        try {
          await expect(
            gpu.draw(scene, camera, () => {
              throw new Error("consumer failed")
            }),
          ).rejects.toThrow("consumer failed")
          const { value } = await gpu.draw(scene, camera, (frame) => {
            expect(frame.stride).toBe(512)
            const rgba = new Uint8Array(65 * 33 * 4)
            packRgba(frame, rgba)
            expect([...rgba.slice(0, 4)]).toEqual([16, 32, 48, 255])
            expect([...rgba.slice(-4)]).toEqual([16, 32, 48, 255])
            const middle = (16 * 65 + 32) * 4
            expect([...rgba.slice(middle, middle + 4)]).toEqual([255, 0, 0, 255])
            return {
              expected: rgba,
              image: NativeImage.fromPixels(frame.data, frame.width, frame.height, {
                stride: frame.stride,
                format: frame.format,
                alpha: "opaque",
              }),
            }
          })
          try {
            expect(value.image.raw().data).toEqual(value.expected)
          } finally {
            value.image.dispose()
          }
          const rgba = new Uint8Array(65 * 33 * 4)
          const before = gpu.ownership()
          const frames = 120
          for (let index = 0; index < frames; index++) {
            material.color.set(index % 2 ? "lime" : "red")
            const draw = gpu.draw(scene, camera, (frame) => {
              expect(frame.stride).toBe(512)
              expect(frame.data.byteLength).toBe(frame.stride * 33)
              rgba.fill(99)
              packRgba(frame, rgba)
              expect([...rgba.subarray(0, 4)]).toEqual([16, 32, 48, 255])
              expect([...rgba.subarray(-4)]).toEqual([16, 32, 48, 255])
              const middle = (16 * 65 + 32) * 4
              expect([...rgba.subarray(middle, middle + 4)]).toEqual(index % 2 ? [0, 255, 0, 255] : [255, 0, 0, 255])
              if (index % 17 === 0) throw new Error("consumer failed")
            })
            if (index % 17 === 0) await expect(draw).rejects.toThrow("consumer failed")
            else await draw
          }
          const after = gpu.ownership()
          expect(after.passesCreated - before.passesCreated).toBe(2 * frames)
          expect(after.commandBuffersCreated - before.commandBuffersCreated).toBe(3 * frames)
          expect(after.encodersCreated).toBe(after.encodersReleased)
          expect(after.passesCreated).toBe(after.passesEnded)
          expect(after.commandBuffersCreated).toBe(after.commandBuffersSubmitted)
          expect(after.passesReleased).toBe(mode === "passes" || mode === "combined" ? after.passesCreated : 0)
          expect(after.commandBuffersReleased).toBe(
            mode === "command-buffers" || mode === "combined" ? after.commandBuffersCreated : 0,
          )
          expect(after.canvasViewsCreated).toBe(1)
          expect(after.cachedCanvasViews).toBe(1)
          expect(after.pendingEncoders + after.pendingPasses + after.pendingCommandBuffers).toBe(0)
          const pending = gpu.draw(scene, camera, () => {})
          expect(() => gpu.dispose()).toThrow("pending readback")
          await expect(gpu.draw(scene, camera, () => {})).rejects.toThrow("busy")
          await pending
        } finally {
          geometry.dispose()
          material.dispose()
          gpu.dispose()
        }
        gpu.dispose()
        expect(gpu.ownership().canvasViewsReleased).toBe(1)
        expect(gpu.ownership().cachedCanvasViews).toBe(0)
        await expect(gpu.draw(scene, camera, () => {})).rejects.toThrow("disposed")
      },
      30_000,
    )
  }
}
