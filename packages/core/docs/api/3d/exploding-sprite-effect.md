# ExplodingSpriteEffect & ExplosionManager

This page documents the GPU-driven exploding sprite particle effect used by the 3D animation subsystem. Implementation reference: `packages/core/src/3d/animation/ExplodingSpriteEffect.ts`.

The effect slices a sprite into a grid of smaller particles and launches them outward using instanced GPU particles with per-instance velocity, angular velocity, UV offsets, and lifetime. A manager class (`ExplosionManager`) provides pooling and convenience helpers to create explosions from existing sprite instances.

## Key types

- ExplosionEffectParameters — configuration for number of particles, lifetime, strength, gravity, etc.
- ExplosionCreationData — data required to create an explosion (resource, UV offsets, transform).
- ExplosionHandle — returned handle allowing restoration of original sprite after explosion.

## ExplosionEffectParameters (fields)

```ts
interface ExplosionEffectParameters {
  numRows: number
  numCols: number
  durationMs: number
  strength: number
  strengthVariation: number
  gravity: number
  gravityScale: number
  fadeOut: boolean
  angularVelocityMin: THREE.Vector3
  angularVelocityMax: THREE.Vector3
  initialVelocityYBoost: number
  zVariationStrength: number
  materialFactory: () => NodeMaterial
}
```

Default parameters (`DEFAULT_EXPLOSION_PARAMETERS`) are provided; override fields via `userParams` in the constructor.

Important notes:
- `numRows` x `numCols` determines the number of particles.
- `durationMs` is lifetime in milliseconds.
- `strength` controls particle initial velocity magnitude; `strengthVariation` adds random spread.
- `gravity` and `gravityScale` control vertical acceleration applied to particles.
- `fadeOut`: if true particles fade out near the end of lifetime.
- `materialFactory`: factory returning a NodeMaterial for GPU shading (defaults provided).

## Class: ExplodingSpriteEffect

Constructor
```ts
new ExplodingSpriteEffect(
  scene: THREE.Scene,
  resource: SpriteResource,
  frameUvOffset: THREE.Vector2,
  frameUvSize: THREE.Vector2,
  spriteWorldTransform: THREE.Matrix4,
  userParams?: Partial<ExplosionEffectParameters>,
)
```
- `resource`: a SpriteResource (from SpriteResourceManager) containing texture and meshPool.
- `frameUvOffset` and `frameUvSize`: UV offsets and size for the particular sprite frame being exploded.
- `spriteWorldTransform`: world transform of the original sprite (particles start at sprite location).
- `userParams`: partial overrides of the default parameters.

Public properties and methods:
- `isActive: boolean` — whether effect is active
- `update(deltaTimeMs: number): void` — advance particle time; disposes effect when lifetime exceeded
- `dispose(): void` — removes instanced mesh from scene and returns mesh to pool

Behavior details:
- Creates an InstancedMesh with `numParticles` instances and per-instance attributes:
  - `a_particleData` (vec4) — local particle position, seed, life variation
  - `a_velocity` (vec4) — initial velocity vector
  - `a_angularVel` (vec4) — angular velocity for orientation over time
  - `a_uvOffset` (vec4) — uv offset and uv size for the particle's subtexture
- The material is constructed via `NodeMaterial` and stores uniform refs for time/duration/gravity. The particle vertex transforms are computed in the shader using these attributes and uniforms.
- On each frame, the effect updates `time` uniform (via `onBeforeRender`) and the GPU material computes positions/colors/opacities.

## ExplosionManager

Purpose: keep track of active explosions and provide pooling/factory helpers.

API
```ts
class ExplosionManager {
  constructor(scene: THREE.Scene)

  fillPool(resource: SpriteResource, count: number, params?: Partial<ExplosionEffectParameters>): void

  createExplosionForSprite(spriteToExplode: TiledSprite, userParams?: Partial<ExplosionEffectParameters>): ExplosionHandle | null

  update(deltaTimeMs: number): void

  disposeAll(): void
}
```

- `fillPool`: pre-fill mesh pools for a resource for performance.
- `createExplosionForSprite`: destroys the given sprite and replaces it with an ExplodingSpriteEffect; returns `ExplosionHandle` which can be used to restore the original sprite via `restoreSprite(spriteAnimator)`.
- `update`: advances all active explosions and removes finished effects.

## Examples

Create and trigger an explosion for a sprite (pseudocode):
```ts
const manager = new ExplosionManager(scene)
const explosionHandle = manager.createExplosionForSprite(myTiledSprite, { strength: 6, durationMs: 1500 })

// Optionally restore later:
if (explosionHandle) {
  await explosionHandle.restoreSprite(spriteAnimator)
}
```

## Implementation details and GPU nodes

- The implementation uses `three/tsl` nodes and `three/webgpu` NodeMaterial to implement particle computations in the shader.
- The material template is cached per resource + particle grid configuration.
- Ensure the NodeMaterial produced by `materialFactory` is compatible with the attributes and node graph built by `_buildTemplateMaterial`.

---

Next steps:
- Document PhysicsExplodingSpriteEffect (physics-driven explosion), SpriteAnimator, and SpriteParticleGenerator to complete the animation docs.
