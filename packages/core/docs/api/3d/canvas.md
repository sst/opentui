# CLICanvas (3D Canvas API)

This document describes the terminal/CLI canvas used by the 3D/WebGPU rendering subsystem. Implementation reference: `packages/core/src/3d/canvas.ts`.

CLICanvas is a lightweight, testable canvas abstraction used by the WGPURenderer to provide a GPU-backed drawing surface and to read pixels back into OpenTUI buffers for terminal rendering.

Important types
- GPUDevice: WebGPU device (via bun-webgpu / platform WebGPU)
- OptimizedBuffer: OpenTUI optimized framebuffer for terminal cells (see buffer.md)
- SuperSampleType: enum exported by `WGPURenderer` — controls supersampling mode
- SuperSampleAlgorithm: enum defined in this module (STANDARD | PRE_SQUEEZED)

## SuperSampleAlgorithm

```ts
export enum SuperSampleAlgorithm {
  STANDARD = 0,
  PRE_SQUEEZED = 1,
}
```

Use this enum to choose the compute shader algorithm for GPU supersampling.

## Class: CLICanvas

Constructor
```ts
new CLICanvas(
  device: GPUDevice,
  width: number,
  height: number,
  superSample: SuperSampleType,
  sampleAlgo: SuperSampleAlgorithm = SuperSampleAlgorithm.STANDARD
)
```
- device: the WebGPU device used for creating buffers, pipelines and submitting commands.
- width/height: render dimensions (in pixels).
- superSample: initial SuperSampleType used by WGPURenderer (NONE | CPU | GPU or similar defined in WGPURenderer).
- sampleAlgo: choose a supersampling algorithm.

Primary properties
- width: number — current render width (pixels)
- height: number — current render height (pixels)
- superSample: SuperSampleType — current supersample mode
- superSampleAlgorithm: SuperSampleAlgorithm — selected compute algorithm
- superSampleDrawTimeMs: number — measured time spent drawing supersampled output
- mapAsyncTimeMs: number — measured time spent mapping GPU readback buffers
- (internal) computePipeline, computeBindGroupLayout, computeOutputBuffer, computeReadbackBuffer, etc.

Public methods

- setSuperSampleAlgorithm(superSampleAlgorithm: SuperSampleAlgorithm): void
  - Switch the compute shader algorithm; updates internal state and schedules buffer updates.

- getSuperSampleAlgorithm(): SuperSampleAlgorithm

- getContext(type: string, attrs?: WebGLContextAttributes)
  - Supported type: `"webgpu"`.
  - When `"webgpu"` is requested, CLICanvas prepares GPU readback / compute buffers and returns a GPUCanvasContext (here a GPUCanvasContextMock).
  - Throws for other `type` values.

- setSize(width: number, height: number): void
  - Resize the internal canvas/context and readback buffers. Also schedules compute buffer updates.

- setSuperSample(superSample: SuperSampleType): void
  - Change supersampling mode (NONE / CPU / GPU / ...).

- async saveToFile(filePath: string): Promise<void>
  - Capture the current texture, copy it to a GPU buffer, map it, and write an image file.
  - Handles row padding and BGRA vs RGBA formats.
  - Uses `jimp` to produce an image file (path must include extension).
  - Useful for debugging or saving screenshots of the GPU render output.

- async readPixelsIntoBuffer(buffer: OptimizedBuffer): Promise<void>
  - Read pixels from the current texture into the provided OptimizedBuffer.
  - Behavior depends on `superSample`:
    - `SuperSampleType.GPU`: runs compute shader supersampling and then unpacks compute output into the OptimizedBuffer via `buffer.drawPackedBuffer(...)`.
    - `SuperSampleType.CPU`: uses the readback buffer and calls `buffer.drawSuperSampleBuffer(...)`.
    - Otherwise: maps the readback buffer and converts pixel bytes into RGBA floats and writes them into `buffer` by calling `buffer.setCell(...)` per cell.
  - Handles BGRA vs RGBA formats and aligned bytes-per-row when mapping GPU readback buffers.

Notes on compute pipeline and buffers
- CLICanvas builds a compute pipeline for supersampling:
  - `initComputePipeline()` creates shader module, bind group layout and compute pipeline.
  - `updateComputeParams()` writes a uniform buffer containing width/height/algorithm.
  - `updateComputeBuffers(width,height)` allocates storage and readback buffers sized to match the compute shader's output layout (must match WGSL shader).
  - `runComputeShaderSuperSampling(texture, buffer)` dispatches the compute shader, copies compute output to readback buffer, maps it, and then calls `buffer.drawPackedBuffer(...)` with the mapped pointer.

Performance and alignment
- The code carefully computes `alignedBytesPerRow` (ceil to 256) when copying textures to GPU buffers — this is required by many GPU APIs.
- The compute output packing uses a specific cell byte layout (48 bytes per cell in the implementation). This must exactly match the WGSL shader layout in `shaders/supersampling.wgsl`.

Example: Capture and store the GPU render into an OptimizedBuffer
```ts
// device and renderer provided by WGPURenderer
const canvas = new CLICanvas(device, width, height, superSampleType, SuperSampleAlgorithm.STANDARD);
const optimized = OptimizedBuffer.create(width, height, { respectAlpha: false });

// After a frame is presented by your WebGPU code:
await canvas.readPixelsIntoBuffer(optimized);

// Now `optimized` contains character-like pixel representations (canvas uses '█' for pixels)
```

Example: Save screenshot to disk
```ts
await canvas.saveToFile('/tmp/opentui-screenshot.png')
```

Implementation notes and debugging
- The WGSL shader used for compute supersampling is embedded at build time: `shaders/supersampling.wgsl`.
- If you change the WGSL shader, ensure the compute output packing / `cellBytesSize` calculation in `updateComputeBuffers` is updated accordingly.
- The code uses a `GPUCanvasContextMock` (from bun-webgpu) to emulate canvas behavior in non-browser contexts.

Related docs
- See `packages/core/docs/api/3d/shaders.md` for details on the WGSL shader and how it maps to compute outputs.
- See `packages/core/src/3d/WGPURenderer.ts` for the renderer that uses `CLICanvas` (documented next).

---

Next steps I will take (unless you prefer otherwise):
- Read and document `WGPURenderer.ts` (expose public API, options, and how it integrates with CliRenderer).
- Document sprite-related modules: `SpriteResourceManager.ts`, `SpriteUtils.ts`, `TextureUtils.ts`, and animation classes in `3d/animation/`.
- Document physics adapters: `PlanckPhysicsAdapter.ts` and `RapierPhysicsAdapter.ts`.

If you'd like me to proceed, I will read the next file `packages/core/src/3d/WGPURenderer.ts` and generate a corresponding doc page.
