# WGPURenderer / ThreeCliRenderer (3D Renderer API)

This page documents the ThreeCliRenderer class which integrates Three.js WebGPU rendering with OpenTUI's CLI renderer. Implementation reference: `packages/core/src/3d/WGPURenderer.ts`.

ThreeCliRenderer renders a Three.js `Scene` to a GPU-backed canvas (CLICanvas) and copies the resulting pixels into an OpenTUI `OptimizedBuffer`. It supports optional supersampling (CPU or GPU) and exposes render statistics.

## Key types

- Scene — three.js scene to render
- PerspectiveCamera / OrthographicCamera — three.js cameras
- OptimizedBuffer — OpenTUI framebuffer (see buffer.md)
- SuperSampleType — enum: NONE | GPU | CPU
- SuperSampleAlgorithm — defined in `canvas` module

## SuperSampleType

```ts
export enum SuperSampleType {
  NONE = "none",
  GPU = "gpu",
  CPU = "cpu",
}
```

Controls supersampling mode used by the renderer.

## Interface: ThreeCliRendererOptions

```ts
export interface ThreeCliRendererOptions {
  width: number
  height: number
  focalLength?: number
  backgroundColor?: RGBA
  superSample?: SuperSampleType
  alpha?: boolean
  autoResize?: boolean
  libPath?: string
}
```

- width/height: output terminal cell dimensions
- focalLength: optional camera focal length (used to compute FOV)
- backgroundColor: RGBA background color for clear
- superSample: initial supersampling mode (NONE/CPU/GPU)
- alpha: whether to use alpha in clear color
- autoResize: if true (default), ThreeCliRenderer listens to CliRenderer resize events
- libPath: optional native lib path passed to setupGlobals

## Class: ThreeCliRenderer

### Constructor

```ts
new ThreeCliRenderer(cliRenderer: CliRenderer, options: ThreeCliRendererOptions)
```

- `cliRenderer` — OpenTUI CliRenderer instance used to receive resize/debug events and to integrate lifecycle.
- `options` — see ThreeCliRendererOptions.

### Lifecycle

- async init(): Promise<void>
  - Creates a WebGPU device, constructs a `CLICanvas` and a `WebGPURenderer` (three.js).
  - Initializes three renderer and sets render method to internal draw function.
  - Should be called before use.

- destroy(): void
  - Removes event listeners, disposes the three renderer, releases GPU references; resets internal state.

### Rendering

- async drawScene(root: Scene, buffer: OptimizedBuffer, deltaTime: number): Promise<void>
  - Public entry: draws the provided scene into the provided OptimizedBuffer. Internally calls `renderMethod` which is set to either `doDrawScene` or a no-op depending on initialization.

- private async doDrawScene(root, camera, buffer, deltaTime): Promise<void>
  - Internal implementation that:
    1. Calls `threeRenderer.render(root, camera)`
    2. Calls `canvas.readPixelsIntoBuffer(buffer)` to transfer GPU pixels into the OptimizedBuffer
    3. Measures render/readback timings (renderTimeMs, readbackTimeMs, totalDrawTimeMs)
  - It guards against concurrent calls (logs and returns if called concurrently).

### Cameras and viewport

- setActiveCamera(camera: PerspectiveCamera | OrthographicCamera): void
- getActiveCamera(): PerspectiveCamera | OrthographicCamera
- get aspectRatio(): number
  - Computes the aspect ratio based on configured aspect override, renderer resolution, or terminal dimensions.

- setSize(width: number, height: number, forceUpdate: boolean = false): void
  - Updates output size, recomputes renderWidth/renderHeight (accounts for supersampling), resizes the CLICanvas and three renderer, and updates camera.aspect and projection matrix.

### Supersampling control & stats

- toggleSuperSampling(): void
  - Cycles between NONE -> CPU -> GPU -> NONE and updates canvas state & sizes.

- setSuperSampleAlgorithm(superSampleAlgorithm: SuperSampleAlgorithm): void
- getSuperSampleAlgorithm(): SuperSampleAlgorithm

- saveToFile(filePath: string): Promise<void>
  - Proxy to canvas.saveToFile(filePath) to write a screenshot.

- toggleDebugStats(): void
  - Toggle internal flag to show render stats overlay.

- renderStats(buffer: OptimizedBuffer): void
  - Writes a small debug overlay of timing stats into the provided OptimizedBuffer using `buffer.drawText(...)`.

### Performance notes

- `ThreeCliRenderer` measures:
  - `renderTimeMs` — time to run threeRenderer.render
  - `readbackTimeMs` — time to transfer pixels to the OptimizedBuffer
  - `canvas.mapAsyncTimeMs` — time to map GPU readback buffer
  - `canvas.superSampleDrawTimeMs` — time spent converting supersampled output to framebuffer
- When `doRenderStats` is enabled (debug overlay), `renderStats` writes formatted timing lines into the buffer.

### Event integration

- By default (`autoResize !== false`) the renderer registers a handler on `cliRenderer` resize events to call `setSize(...)`.
- It listens for `CliRenderEvents.DEBUG_OVERLAY_TOGGLE` to update debug stat visibility.

## Example usage

```ts
import { createCliRenderer } from '@opentui/core'
import { ThreeCliRenderer, SuperSampleType } from '@opentui/core/3d/WGPURenderer' // pseudo import
import { Scene, PerspectiveCamera } from 'three'

async function main() {
  const cli = await createCliRenderer()
  const threeRenderer = new ThreeCliRenderer(cli, {
    width: 80,
    height: 24,
    superSample: SuperSampleType.GPU,
    alpha: false
  })

  await threeRenderer.init()

  const scene = new Scene()
  const camera = threeRenderer.getActiveCamera() as PerspectiveCamera

  // On each frame, create or reuse an OptimizedBuffer and render:
  const buffer = cli.root.getBuffer() // pseudocode — use actual renderer buffer access
  await threeRenderer.drawScene(scene, buffer, 16)
}
```

## Integration notes

- `ThreeCliRenderer` relies on `CLICanvas` to handle readback and supersampling. See `packages/core/docs/api/3d/canvas.md`.
- Use GPU supersampling (GPU) for best quality and performance when a GPU is available; CPU supersampling is a fallback.
- The `WebGPURenderer` (three.js) expects an HTMLCanvas-like object — `CLICanvas` provides a `GPUCanvasContextMock` for use in non-browser environments.

---

Next steps I can take:
- Document the sprite subsystem (SpriteResourceManager, SpriteUtils, animations) and the physics adapters (Planck and Rapier).
- Create an examples page showing a minimal three.js scene wired to ThreeCliRenderer.
