import { expect, test } from "bun:test"
import { NativeImage } from "@opentui/core"
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, OrthographicCamera, Scene } from "three"
import { createPixelRenderer } from "./pixel-renderer.js"

test.skipIf(process.env.GPU_TESTS !== "1")(
  "preserves GPU colors, padding, and native ownership over many frames",
  async () => {
    const gpu = await createPixelRenderer(65, 33)
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
      const before = gpu.ownership()
      const frames = 120
      for (let index = 0; index < frames; index++) {
        material.color.set(index % 2 ? "lime" : "red")
        const draw = gpu.draw(scene, camera, (frame) => {
          expect(frame.width).toBe(65)
          expect(frame.height).toBe(33)
          expect(frame.stride).toBe(512)
          expect(frame.data.byteLength).toBe(frame.stride * 33)
          if (index % 17 === 0) throw new Error("consumer failed")
          return NativeImage.fromPixels(frame.data, frame.width, frame.height, {
            stride: frame.stride,
            format: frame.format,
            alpha: "opaque",
          })
        })
        if (index % 17 === 0) {
          await expect(draw).rejects.toThrow("consumer failed")
          continue
        }
        const image = await draw
        try {
          const rgba = image.raw().data
          expect(rgba).toHaveLength(65 * 33 * 4)
          expect([...rgba.subarray(0, 4)]).toEqual([16, 32, 48, 255])
          expect([...rgba.subarray(-4)]).toEqual([16, 32, 48, 255])
          const middle = (16 * 65 + 32) * 4
          expect([...rgba.subarray(middle, middle + 4)]).toEqual(index % 2 ? [0, 255, 0, 255] : [255, 0, 0, 255])
        } finally {
          image.dispose()
        }
      }
      const after = gpu.ownership()
      expect(after.passesCreated - before.passesCreated).toBe(2 * frames)
      expect(after.commandBuffersCreated - before.commandBuffersCreated).toBe(3 * frames)
      expect(after.encodersCreated).toBe(after.encodersReleased)
      expect(after.passesCreated).toBe(after.passesEnded)
      expect(after.commandBuffersCreated).toBe(after.commandBuffersSubmitted)
      expect(after.passesReleased).toBe(after.passesCreated)
      expect(after.commandBuffersReleased).toBe(after.commandBuffersCreated)
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
