# 3D Sprite Subsystem

This page documents the sprite-related utilities used by the 3D renderer: mesh pooling, instanced sprite management, sprite resources, and the SpriteResourceManager. Implementation references: `packages/core/src/3d/SpriteResourceManager.ts` and `packages/core/src/3d/TextureUtils.ts`.

Primary exported classes:
- MeshPool
- InstanceManager
- SpriteResource
- SpriteResourceManager

---

## MeshPool

Purpose: reuse InstancedMesh objects to avoid repeated allocation/dispose during dynamic scenes.

API
```ts
class MeshPool {
  acquireMesh(poolId: string, options: {
    geometry: () => THREE.BufferGeometry
    material: THREE.Material
    maxInstances: number
    name?: string
  }): THREE.InstancedMesh

  releaseMesh(poolId: string, mesh: THREE.InstancedMesh): void

  fill(poolId: string, options: MeshPoolOptions, count: number): void

  clearPool(poolId: string): void

  clearAllPools(): void
}
```

Notes:
- `acquireMesh` returns an existing pooled InstancedMesh if available or creates a new one.
- `releaseMesh` returns a mesh into the pool for later reuse.
- `fill` preallocates `count` meshes for a pool.
- `clearPool` disposes geometry and materials of meshes in the pool.
- `clearAllPools` clears every pool.

Example:
```ts
const pool = new MeshPool()

const mesh = pool.acquireMesh('sprites', {
  geometry: () => new THREE.PlaneGeometry(1, 1),
  material: spriteMaterial,
  maxInstances: 100,
  name: 'spriteMesh'
})

// use mesh in scene...
pool.releaseMesh('sprites', mesh)
```

---

## InstanceManager

Purpose: manage a single `THREE.InstancedMesh` and provide slot allocation for instances (acquire/release per-instance transforms).

API
```ts
class InstanceManager {
  constructor(scene: Scene, geometry: THREE.BufferGeometry, material: THREE.Material, options: {
    maxInstances: number
    renderOrder?: number
    depthWrite?: boolean
    name?: string
    frustumCulled?: boolean
    matrix?: THREE.Matrix4
  })

  acquireInstanceSlot(): number
  releaseInstanceSlot(instanceIndex: number): void
  getInstanceCount(): number
  getMaxInstances(): number
  get hasFreeIndices(): boolean
  get mesh(): THREE.InstancedMesh
  dispose(): void
}
```

Behavior:
- Constructor creates an `InstancedMesh` with `maxInstances` capacity and registers it on `scene`.
- `acquireInstanceSlot()` returns an available instance index; throws if none available.
- `releaseInstanceSlot()` marks the index free and resets the instance transform to a hidden matrix.
- `mesh` returns the underlying InstancedMesh for adding instance-specific attributes (colors/UVs) or custom settings.
- `dispose()` removes the mesh from the scene and disposes geometry/material.

Example:
```ts
const manager = new InstanceManager(scene, new THREE.PlaneGeometry(1,1), spriteMaterial, { maxInstances: 100, name: 'sprites' })
const idx = manager.acquireInstanceSlot()

// set transform
const mat = new THREE.Matrix4().makeTranslation(x, y, z)
manager.mesh.setMatrixAt(idx, mat)
manager.mesh.instanceMatrix.needsUpdate = true

// later
manager.releaseInstanceSlot(idx)
```

---

## SpriteResource

Purpose: represent a loaded sprite sheet texture and provide a `MeshPool` and helpers for instance managers.

API
```ts
class SpriteResource {
  constructor(texture: THREE.DataTexture, sheetProperties: {
    imagePath: string
    sheetTilesetWidth: number
    sheetTilesetHeight: number
    sheetNumFrames: number
  }, scene: Scene)

  get texture(): THREE.DataTexture
  get sheetProperties(): SheetProperties
  get meshPool(): MeshPool

  createInstanceManager(geometry: THREE.BufferGeometry, material: THREE.Material, options: InstanceManagerOptions): InstanceManager

  get uvTileSize(): THREE.Vector2

  dispose(): void
}
```

Notes:
- `uvTileSize` returns the normalized tile size for UV mapping based on `sheetNumFrames`.
- `createInstanceManager` is a convenience to create an `InstanceManager` bound to this resource and scene.
- `dispose` clears the internal mesh pools.

Example:
```ts
const tex = await TextureUtils.fromFile('spritesheet.png')
const sheet = { imagePath: 'spritesheet.png', sheetTilesetWidth: tex.image.width, sheetTilesetHeight: tex.image.height, sheetNumFrames: 8 }
const resource = new SpriteResource(tex, sheet, scene)
const manager = resource.createInstanceManager(new THREE.PlaneGeometry(1,1), spriteMaterial, { maxInstances: 200 })
```

---

## SpriteResourceManager

Purpose: central manager to create/load sprite sheet textures (via TextureUtils), cache them, and provide `SpriteResource` objects.

API
```ts
class SpriteResourceManager {
  constructor(scene: Scene)

  getOrCreateResource(texture: THREE.DataTexture, sheetProps: SheetProperties): Promise<SpriteResource>

  createResource(config: { imagePath: string, sheetNumFrames: number }): Promise<SpriteResource>

  clearCache(): void
}
```

Behavior:
- `createResource` loads texture via `TextureUtils.fromFile(imagePath)` and builds `SheetProperties` from the loaded texture dimensions and `sheetNumFrames`.
- Resources and raw texture objects are cached by `imagePath` key.
- `clearCache` clears both resource and texture caches.

Example:
```ts
const manager = new SpriteResourceManager(scene)
const resource = await manager.createResource({ imagePath: 'spritesheet.png', sheetNumFrames: 8 })
const instanceManager = resource.createInstanceManager(geometry, material, { maxInstances: 100 })
```

---

## TextureUtils (note)

The manager uses `TextureUtils.fromFile(path)` to load a `THREE.DataTexture`. Refer to `packages/core/src/3d/TextureUtils.ts` for exact signature and supported file formats.

---

## Recommendations

- Use `SpriteResourceManager` to centralize loading of sprite atlases and reuse textures across scenes.
- Use `MeshPool` and `InstanceManager` for high-performance instanced rendering — they avoid frequent allocation and GPU buffer churn.
- When using sprite sheets, compute UV offsets using `SpriteResource.uvTileSize` and set instance UV attributes accordingly.
