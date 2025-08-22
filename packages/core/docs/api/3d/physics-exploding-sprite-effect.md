# PhysicsExplodingSpriteEffect & PhysicsExplosionManager

This document describes the physics-driven exploding-sprite effect used by OpenTUI's 3D animation subsystem. Reference implementation: `packages/core/src/3d/animation/PhysicsExplodingSpriteEffect.ts`.

The physics-driven effect uses a physics engine (abstracted by the project's physics adapter interface) to simulate particle rigid bodies and synchronizes their transforms into an instanced mesh for rendering.

## Key types

- PhysicsExplosionEffectParameters — configuration for particle physics (force, damping, restitution, density, etc.)
- PhysicsExplosionCreationData — resource + UV + transform needed to create an effect
- PhysicsExplosionHandle — a handle returned on creation that can restore the original sprite

The effect depends on the physics abstraction implemented by the project's adapters (see `packages/core/src/3d/physics/physics-interface.ts` and corresponding Planck/Rapier adapters).

## PhysicsExplosionEffectParameters (fields)

```ts
interface PhysicsExplosionEffectParameters {
  numRows: number
  numCols: number
  durationMs: number
  explosionForce: number
  forceVariation: number
  torqueStrength: number
  gravityScale: number
  fadeOut: boolean
  linearDamping: number
  angularDamping: number
  restitution: number
  friction: number
  density: number
  materialFactory: () => NodeMaterial
}
```

Defaults available in `DEFAULT_PHYSICS_EXPLOSION_PARAMETERS`. Use `userParams` to override.

## Class: PhysicsExplodingSpriteEffect

Constructor
```ts
new PhysicsExplodingSpriteEffect(
  scene: THREE.Scene,
  physicsWorld: PhysicsWorld,
  resource: SpriteResource,
  frameUvOffset: THREE.Vector2,
  frameUvSize: THREE.Vector2,
  spriteWorldTransform: THREE.Matrix4,
  userParams?: Partial<PhysicsExplosionEffectParameters>
)
```

- `physicsWorld`: instance implementing the physics adapter interface (PhysicsWorld).
- The effect creates per-particle rigid bodies and colliders through the physicsWorld, applies impulses/torque, and tracks each particle's rigid body.
- It maintains an `InstancedMesh` used for rendering; per-instance UV offsets are stored in an InstancedBufferAttribute.

Public methods
- `update(deltaTimeMs: number): void` — queries each particle rigid body for translation/rotation and writes instance matrices to the InstancedMesh. Disposes when time >= duration.
- `dispose(): void` — removes mesh from scene, releases it to MeshPool, and removes rigid bodies from physics world.

Behavior notes
- For each particle:
  - A rigid body is created with `translation`, `linearDamping`, `angularDamping` (via physicsWorld.createRigidBody).
  - A collider matching particle size is created and attached.
  - An impulse and torque impulse are applied to simulate explosion.
- The effect synchronizes physics transforms to the instanced mesh each `update` call.
- The effect uses a shared NodeMaterial (cached per texture) to sample the sprite UVs.

## PhysicsExplosionManager

Purpose: manage many physics-driven explosions, pool geometry/materials, and provide helpers to create explosions for sprites.

API
```ts
class PhysicsExplosionManager {
  constructor(scene: THREE.Scene, physicsWorld: PhysicsWorld)

  fillPool(resource: SpriteResource, count: number, params?: Partial<PhysicsExplosionEffectParameters>): void

  createExplosionForSprite(spriteToExplode: TiledSprite, userParams?: Partial<PhysicsExplosionEffectParameters>): Promise<PhysicsExplosionHandle | null>

  update(deltaTimeMs: number): void

  disposeAll(): void
}
```

- `createExplosionForSprite` removes the supplied sprite, creates the physics particles and returns a handle with `restoreSprite(spriteAnimator)` to recreate the sprite when needed.
- `fillPool` preallocates pooled meshes for a given resource to reduce allocation overhead.

## Physics adapter requirements (overview)

The physics-driven effects rely on the project's physics adapter interface. The adapter must provide:
- PhysicsWorld: ability to `createRigidBody(desc)`, `createCollider(desc, body)`, `removeRigidBody(body)`, and `create`/`destroy` lifecycle.
- PhysicsRigidBody: must expose `applyImpulse`, `applyTorqueImpulse`, `getTranslation()` and `getRotation()` (rotation scalar for 2D), and similar.
- Physics types referenced in the code: PhysicsRigidBody, PhysicsWorld, PhysicsRigidBodyDesc, PhysicsColliderDesc, PhysicsVector2.

See `packages/core/src/3d/physics/physics-interface.ts` for exact method names and required shapes. Available adapters: Planck and Rapier (PlanckPhysicsAdapter.ts and RapierPhysicsAdapter.ts).

## Example usage (pseudocode)

```ts
// Assuming scene and physicsWorld are initialized, and spriteAnimator exists
const manager = new PhysicsExplosionManager(scene, physicsWorld)
const handle = await manager.createExplosionForSprite(myTiledSprite, { explosionForce: 30, durationMs: 2500 })
// Optionally restore later:
if (handle) {
  await handle.restoreSprite(spriteAnimator)
}
```

## Recommendations and notes

- Ensure physicsWorld is stepped/updated by your application loop (outside this class) so rigid bodies advance and `update(...)` reads correct transforms.
- Tune `explosionForce`, `forceVariation`, `torqueStrength`, and `density` per your scene scale and physics adapter units.
- Use `fillPool` to pre-warm mesh pools for frequently used configurations.

---

Next steps:
- Document `SpriteAnimator.ts` and `SpriteParticleGenerator.ts` (animation & particle API).
- Document physics adapter implementations (Planck / Rapier) with configuration examples.
