I think sp# SpriteAnimator, TiledSprite, and Animation (3D Sprite Animation API)

This page documents the sprite animation system implemented in `packages/core/src/3d/animation/SpriteAnimator.ts`. It covers the Animation helper, TiledSprite instance, and the SpriteAnimator manager that creates and updates animated, instanced sprites.

## Key concepts

- Sprite sheets are represented by `SpriteResource` objects (see sprites.md).
- Animations are defined per-sprite with a mapping of animation names to `AnimationDefinition` objects (number of frames, offsets, frame duration, looping, flip flags).
- The animator uses instanced rendering (InstancedMesh) with per-instance attributes for frame index and flip flags, allowing many sprites to be drawn efficiently.

## Types / Interfaces

- `AnimationStateConfig` — config provided for a specific animation (imagePath, sheetNumFrames, animNumFrames, animFrameOffset, frameDuration, loop, initialFrame, flipX, flipY)
- `ResolvedAnimationState` — resolved state with texture and tileset sizes
- `SpriteDefinition` — top-level sprite definition: `initialAnimation` and `animations` map
- `SpriteDefinition` example:
  ```ts
  const spriteDef: SpriteDefinition = {
    initialAnimation: "idle",
    animations: {
      idle: { resource, animNumFrames: 4, frameDuration: 100, loop: true },
      run: { resource, animNumFrames: 6, frameDuration: 75, loop: true },
    },
    scale: 1.0
  }
  ```

## Class: Animation (internal per-sprite animation instance)

Used internally by `TiledSprite`. Main responsibilities:
- Track `currentLocalFrame`, `timeAccumulator`, `isPlaying`, `_isActive`
- Manage per-instance attributes:
  - `a_frameIndexInstanced` (frame index per instance)
  - `a_flipInstanced` (flipX / flipY per instance)
- Methods:
  - `activate(worldTransform: Matrix4)` — enable and place the instance
  - `deactivate()` — hide and stop updates
  - `updateVisuals(worldTransform: Matrix4)` — update instance matrix transform
  - `updateTime(deltaTimeMs: number): boolean` — advance frames based on `frameDuration`; returns true if frame attribute updated
  - `play()`, `stop()`, `goToFrame()`, `setFrameDuration()`, `getResource()`, `releaseInstanceSlot()`

Notes:
- Frame attributes are updated by setting `frameAttribute.setX(instanceIndex, absoluteFrame)` and marking `needsUpdate = true`.

## Class: TiledSprite

Represents a single logical sprite (which may contain multiple instanced animations internally, e.g., frames from different sprite sheets).

Constructor:
```ts
new TiledSprite(
  id: string,
  userSpriteDefinition: SpriteDefinition,
  animator: SpriteAnimator,
  animationInstanceParams: Array<{ name, state, resource, index, instanceManager, frameAttribute, flipAttribute }>
)
```

Public API:
- `play()`, `stop()`, `goToFrame(frame)`, `setFrameDuration(ms)`
- `setPosition(Vector3)`, `setRotation(Quaternion)`, `setScale(Vector3)` and `setTransform(position, quaternion, scale)`
- `setAnimation(animationName: string): Promise<void>` — switch animation (activates/deactivates instance slots accordingly)
- `update(deltaTime: number)` — called by animator to advance animation timing
- `destroy()` — release instance slots and cleanup
- `visible` getter/setter — toggles per-instance activation (hiding / showing)
- Accessors: `getCurrentAnimationName()`, `getWorldTransform()`, `getWorldPlaneSize()`, `definition`, `currentTransform`

Notes:
- `TiledSprite` computes instance matrix scale based on sprite definition scale and sheet aspect ratio to preserve pixel aspect.
- The class stores a transform object used to compute world matrix for the instanced mesh.

## Class: SpriteAnimator

Manager that creates TiledSprite instances and manages instance pools.

Constructor:
```ts
new SpriteAnimator(scene: THREE.Scene)
```

Primary methods:
- `async createSprite(userSpriteDefinition: SpriteDefinition, materialFactory?: () => NodeMaterial): Promise<TiledSprite>`
  - Resolves resources and instance managers for each animation resource, acquires instance slots, creates per-instance attributes, constructs `TiledSprite`.
- `update(deltaTime: number): void` — calls `update` on each TiledSprite (advance time)
- `removeSprite(id: string)`: void — destroy and free instance slot(s)
- `removeAllSprites()`: void

Instance manager caching:
- `getOrCreateInstanceManager(resource, maxInstances, renderOrder, depthWrite, materialFactory)`
  - Builds `geometry` with instanced attributes:
    - `a_frameIndexInstanced` (Float32Array, 1 element per instance)
    - `a_flipInstanced` (Float32Array, 2 elements per instance)
  - Creates material via `createSpriteAnimationMaterial(...)` which builds a NodeMaterial using the resource texture and per-instance attributes.

Material and shader notes:
- The material uses three/tsl nodes to compute final UV based on per-instance frame index and flip flags.
- `createSpriteAnimationMaterial` packs the per-instance attributes and sets `material.colorNode` to the sampled texture color.

Example usage:
```ts
const animator = new SpriteAnimator(scene)
const mySprite = await animator.createSprite(spriteDefinition)
animator.update(deltaTimeMs) // in your loop
mySprite.setPosition(new THREE.Vector3(1,2,0))
mySprite.setAnimation('run')
```

Performance tips:
- Choose `maxInstances` sufficiently large when creating sprite definitions to avoid `acquireInstanceSlot` failures.
- Materials are created per resource + options combination and reused via instance manager caching.
- Use `removeSprite` to free instance slots when sprites are no longer needed.

Next steps:
- Document `SpriteParticleGenerator.ts` (particle spawning helper) and then finalize 3D animation docs.
</write_to_file>
