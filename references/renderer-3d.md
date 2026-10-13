# The Three.js renderer: reading the board's video state

The renderer is a pure function of the board's video RAM, sprite RAM and video latches.
It never decides anything about gameplay - if the arcade did not draw it, it does not happen;
if the arcade drew it, it appears at the same place and time. "3D" means *how* the same
information is shown.

## Contents
1. Coordinate mapping
2. Sprites → voxel models
3. Rotation-frame sprites → one model + heading (with the numeric check)
4. Tilemap → text plane + HUD rows
5. Effects keyed to original state
6. Boot fast-forward
7. Camera tilt presets with auto-fit
8. Classic 2D view toggle

---

## 1. Coordinate mapping

Work in **display space** (after the monitor rotation): e.g. 224x288 for ROT90 games.
`world.x = (X - W/2) * S`, `world.z = (Y - H/2) * S`, `y` is up, `S ≈ 0.1` (one arcade
pixel = one voxel). For ROT90: native (x, y) → display (W-1-y, x); a native sprite at
(sx, sy) has its display centre at `X = W - (sy + 8)`, `Y = sx + 8`.

## 2. Sprites → voxel models

- Decode each sprite once into pen indices; build geometry lazily per
  `(code, colour, flipx, flipy)` and cache it in a `Map`.
- Each opaque pixel becomes a box; make interior pixels taller (1.1 / 2.2 / 3.2 voxel heights
  by 4- and 8-neighbour count) so silhouettes bulge like toys, and shade top/side/bottom faces
  differently in the vertex colours so pixels read as blocks.
- One merged `BufferGeometry` per model with vertex colours, a shared
  `MeshStandardMaterial({vertexColors})` with a small emissive boost injected via
  `onBeforeCompile` (`totalEmissiveRadiance += diffuseColor.rgb * uGlow`). Use a hotter
  material (higher glow) for explosions, scores and bullets.
- A mesh pool sized for the sprite RAM (x4 for double-size sprites); hide unused meshes each frame.

## 3. Rotation-frame sprites → one model + heading

Arcade games store pre-rotated frames (Galaga: groups of 8 codes, frames 0-6 = 90° apart in
15° steps, frame 7 = an alternate upright/flap frame) and use flip bits for other quadrants.
Replace them with the upright model rotated to the encoded heading, smoothed per sprite slot
(`angLerp` toward the target, bank from turn rate). This gives continuous 3D rotation while the
heading still comes 100 % from the original program.

**Do not trust your reasoning about rotation direction - measure it.** In Galaga the first
guess was mirrored (232 of 240 cases wrong) and looked plausible on screen. The check:

```js
// For every frame f (0..6) x flipx x flipy: rotate the upright image by your computed heading
// and compare with the true decoded frame; also find the best of the 24 x 15° angles.
// rotImg(src, a): clockwise rotation in screen coords (y down), nearest-neighbour.
// iou(a, b): |a∧b| / |a∨b| over opaque pixels.
// Pass when your angle == best angle (or within 15°) for the vast majority; the remaining
// cases should be near-ties (insect shapes with X-shaped wings are nearly 90°-symmetric).
```

Galaga's confirmed mapping: `th = (6 - f) * 15°`, display direction `dx = -sin(th)`,
`dy = -cos(th)`; native `flipy` mirrors X (`dx = -dx`), native `flipx` mirrors Y (`dy = -dy`);
`heading = atan2(-dx, -dy)` for a mesh whose nose is -Z. Rotation groups were codes 0-31 and
80-126 (excluding non-rotation codes such as score sprites); everything else is drawn as a raw
voxelised image.

## 4. Tilemap → text plane + HUD rows

- Render characters into a `CanvasTexture` (4 texture pixels per arcade pixel, nearest
  filtering when drawing chars), on a plane slightly above the battle plane, transparent,
  `toneMapped:false` so text glows lightly with bloom. Redraw only tiles whose code/colour
  changed (keep a shadow array).
- Rows that are pure HUD (score rows at the top, lives/badges at the bottom) go to 2D canvases
  pinned to the screen edges instead - they stay readable at any camera angle.
- The plane keeps everything the game draws with characters aligned with the sprites (score
  tables next to their icons, "READY", "STAGE 1", tractor beams...).

## 5. Effects keyed to original state

Effects must be *triggered by* things the original draws or sends, never invented:

- **Explosion debris**: when a sprite slot switches from a model sprite to an explosion
  sprite, burst instanced voxel debris in the previous model's colours.
- **Volumetric beam / big effects drawn with tiles**: find the tile codes (log codes seen on
  screen during the effect), take the bounding box each frame, and fit a 3D mesh to it.
  Require a *compact, dense* cluster (Galaga: width ≤ 8 tiles, height ≤ 16, ≥35 % fill) -
  otherwise boot garbage or text will trigger it. Keep it subtle (opacity ~0.25-0.3).
- **Camera shake**: on the sound/explosion command the program sends when the player dies.
- **Starfield**: enable/speed from the star-control latch (Galaga speeds table
  `[-1,-2,-3,0,3,2,1,0]` indexed by latch bits 0-2, enable = bit 5).

## 6. Boot fast-forward

Power-on self-tests fill video RAM with garbage and test patterns. In 3D these glow and
trigger effect detectors. Detect "booted" from board state (Galaga: sub CPUs released **and**
starfield enabled, or frame > 1100) and until then run frames at high speed (60 per pump
call), silently, with the tile plane and sprites hidden. The program still runs every
instruction; only wall-clock time is compressed. The 2D view can still show the real boot.

## 7. Camera tilt presets with auto-fit

Offer presets (탑뷰 0°, 약하게 20°, 기본 40°, 강하게 55°, 극적 68°) on buttons + `T` key,
saved in localStorage. For each tilt, solve the camera:
- place camera at `(0, cos t * d, lookZ + sin t * d)` looking at `(0, 0, lookZ)`;
  at t≈0 use `up = (0,0,-1)` to avoid the degenerate look-at;
- binary-search the smallest `d` where all four playfield corners project inside
  `|x| ≤ 0.96`, `y ∈ [-0.86, 0.84]` (room for the HUD rows), and scan `lookZ` to balance top
  and bottom margins; cache per (tilt, aspect, fov); recompute on resize;
- interpolate tilt/distance/aim exponentially when switching; scale idle camera sway by tilt.

## 8. Classic 2D view toggle

Keep the 2D reference renderer from bring-up and switch to it with `V`. It is the ground
truth when anything in 3D looks wrong, and players like comparing.
