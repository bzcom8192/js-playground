# RESULT 3: Real 3D board with Three.js (JS Farmer, `#/farmer`)

Branch: `farmer-game` (on top of `f92225e`). Everything in BRIEF3-3D.md is implemented.

- **Scope:** rendering only. The engine, API, transform, runner, save format (`farmer_save_v1`), files model,
  floating windows, inventory, buttons and the Playground page are unchanged.
- **Mechanics:** no numbers or mechanics changed.
- **New dependency:** `three` (^0.187.0) is the only one. It is plain three.js inside a React component; no
  react-three-fiber.

```bash
npm run dev            # http://localhost:5173/#/farmer   and   #/farmer?demo=1
npm run test:farmer    # 82 tests (70 old + 12 new)
npm run lint && npm run build
```

## Screenshots (1920×1080, headless Chromium)
- Demo farm (`#/farmer?demo=1`): **`~/farmer-3d-demo.png`** (`/home/builder/farmer-3d-demo.png`)
- Fresh 1×1 farm (`#/farmer`, empty storage): **`~/farmer-3d-fresh-1x1.png`** (`/home/builder/farmer-3d-fresh-1x1.png`)

### Compared with `~/tfwr-3d-reference.png`
- **Camera angle:** fixed perspective camera looking North from the South, pitched 55° (brief: ≈50°), FOV 22°.
  - The far edge projects about 0.8× the near edge, so the far side is slightly smaller, like the reference.
  - With 50° and a wider FOV the board looked flatter and more distorted than the reference, so I settled one
    notch steeper.
  - There is no drift or orbit.
- **Light warmth:**
  - Warm sun `#ffcf8c` from the upper left (and a bit to the front, so the slab front and pumpkin faces are
    lit like in the reference), with soft PCF shadows.
  - Hemisphere ambient: sky `#d8e8f5`, ground `#8a5f33`.
  - ACES tone mapping. The background is the page's `#7ea6bb` (transparent canvas).
- **Wheat density:** 100 stalks with ears per tile, golden at maturity. A mature patch reads as dense gold,
  with the grassland only peeking through. It is slightly less of a solid "carpet" than in the original game.
- **Pumpkin size:**
  - A single pumpkin is about 0.8 tile wide, flat-shaded and ribbed (10 lobes) with a stem.
  - Giant k×k pumpkins span their group, about 1.07·k tiles wide with a slight overhang, close to the reference's
    big pumpkins.
- **Board size:**
  - The 8×8 demo board's near edge is about 725 px wide at 1080p (reference ≈ 710 px).
  - The board grows with the farm: a 1×1 is a small plot, and 12×12 fills the left 55 % area.

## What was built

| File | Role |
|---|---|
| `src/farmer/FarmBoard3D.jsx` | React component. It owns the `WebGLRenderer`, the canvas, the `ResizeObserver` and the rAF loop. On unmount it disposes everything (scene, kit, shadow map, render lists, renderer, `forceContextLoss`, canvas removed). Pixel ratio is capped at 2 |
| `src/farmer/board3d/FarmScene.js` | Scene graph (no React or renderer, so it is testable in node): tiles, slab, entities, giant pumpkins, drone, lights, camera fit, per-frame animation |
| `src/farmer/board3d/models.js` | The model kit. Low-poly models built only from primitives, plus the small canvas textures |
| `src/farmer/board3d/layout.js` | Pure math: tile↔world, growth, pop and harvest curves, model keys, wrap detection, target board size |
| `src/farmer/board3d/webgl.js` | `hasWebGL()` |
| `src/farmer/FarmBoardView.jsx` | Picks 3D or 2D and renders the toggle. The 3D board is lazy-loaded (`three` is in its own 568 kB / 144 kB gzip chunk, so the Playground never loads it) |
| `src/farmer/board3d.test.mjs` | 12 node tests |
| `src/farmer/FarmerPage.jsx` | Two-line change: renders `FarmBoardView` instead of `FarmBoard` |

The old 2D board (`FarmBoard.jsx`) is untouched.

### 3D/2D toggle (where it is)
- A small **`3D | 2D` segmented pill at the bottom-right corner of the farm area**, on the same row as the status
  pill. 3D is the default.
- The choice is remembered in `localStorage["farmer_board_v1"]`, a UI preference only; the save is untouched.
- If WebGL is unavailable, or the context is lost, the board falls back to 2D automatically and the 3D button is
  disabled with a tooltip.

### Ground and slab
- **Tiles:** each tile is a low box (0.93 × 0.16) with a 0.07 groove between tiles. The top face has a canvas
  texture with a light/dark rim for a bevel feel:
  - **Soil:** warm brown with 4 east–west plough rows and speckles.
  - **Grassland:** speckled green.
  - The sides are earthy brown.
- **Slab:** a thicker slab sits under the board.
  - Its top is dark earth, visible in the grooves.
  - Its sides use a strata/plank canvas texture.
  - Instanced grey rocks run along the front and right base.
  - Its thickness scales with the farm size, so a 1×1 plot isn't a tall cube.
- **Water:** a translucent blue plane (canvas ripple texture) slightly above the tile. Opacity follows the water
  level, using 10 shared materials.

### Entities (all primitives, flat-shaded, vertex-coloured)
- **Wheat (Grass):**
  - 100 thin 3-sided stalks plus octahedron ears, merged into one geometry (3 seeded variants shared by every
    wheat tile).
  - Growth scales mostly in height (0.18 → 1) and lerps the colour green → gold.
  - Each wheat tile has its own cloned material, so the tint is per tile.
- **Bush:** 3 icosahedron blobs; purple berries when mature.
- **Tree:** trunk cylinder plus 3 icosahedron canopy blobs, about 1 tile tall.
- **Carrot:** 4 leafy tufts of thin cones. When mature, an orange shoulder pokes out of the soil and two tufts get a
  small purple flower.
- **Pumpkin:** a ribbed, squashed sphere (vertex displacement, groove shading, dimpled top) with a stem.
  - A grown k×k group renders as **one** pumpkin spanning the group. It uses `findGiantPumpkins` from v2, which
    shares the harvest rule.
  - **Dead pumpkin:** the same mesh in grey, squashed and tilted.
- **Sunflower:** a thin stem and two leaves. The head is 12 petals around a brown disc, tilted toward the camera.
- **Cactus:**
  - Stacked capsule segments with lighter vertical rib strips and one arm.
  - A pink flower when mature.
  - The height grows slightly with `size` (0–9), which is visual only.
- **Drone:**
  - **Model:** a ribbed pumpkin body with eyes and a straw hat (flat cylinder brim, red band, cone top) pushed back
    so the face reads from above. X-arms carry four spinning rotors.
  - **Hover:** it hovers about 0.95 above the tile with a gentle bob, over a soft canvas blob shadow that shrinks
    and grows with the bob.
  - **Movement:** it **glides**, using an exponential approach toward the logical tile at a rate scaled to the
    current move duration. It **turns to face its travel direction**. A wrap-around move teleports instead of
    sliding across the board.
  - **`do_a_flip()`:** a full flip with a small hop.

### Animation and performance
- **Rebuilds only on change.**
  - Each frame `sync()` compares every tile's entity *object identity* and a model key (type, plus grown for
    bush, carrot and cactus, plus cactus size), along with ground and water level.
  - Only tiles whose key changed are rebuilt. Giant pumpkins are recomputed only when some entity changed.
  - Steady state does zero rebuilds, and a test asserts this.
- **Per frame:**
  - growth scaling, using a smoothed display progress (it follows the 10 Hz engine ticks continuously)
  - the wheat tint
  - planting and harvest pops
  - drone glide, bob and rotors
  - There is no camera work per frame; the camera is re-fit only on resize or farm-size change.
- **Pops:**
  - **Plant:** 0.6 → about 1.04 → 1 over 0.28 s.
  - **Harvest:** the old model swells by 12 % and shrinks away over 0.24 s.
  - **Giant pumpkins** pop in and out the same way.
- **Pause:** the animation clock stops, so growth, drone glide, bob, rotors and flips all freeze. A pop already in
  progress finishes.
- **Render on demand:** when paused or static, no frame is drawn unless something changed.
- **Cost:**
  - **Model:** one draw call per model; geometries are cached per variant and shared.
  - **Shadow map:** 1024² for farms up to 6×6, 2048² above. The shadow camera is fitted to the board.
  - **12×12 farm, all wheat:** about 206 k triangles and fewer than 500 meshes.
  - **JS work per frame** (`sync` + `update`), 12×12 in the browser: **0.07 ms**.
  - **Real GPU frame rate:** I couldn't measure a laptop GPU's fps on this box. Headless Chromium only has
    SwiftShader (software GL), which draws a 12×12 board at about 3 fps. That is CPU rasterisation, not the
    scene's JS cost.

## Verification
```
$ npm run test:farmer   → tests 82, pass 82, fail 0
$ npm run lint          → 0 problems
$ npm run build         → ✓ built (FarmerPage 79.6 kB; FarmBoard3D chunk incl. three 568 kB / 144 kB gzip)
```

**New tests** (`board3d.test.mjs`):
- tile↔world mapping, with North as −z
- wrap detection and angle lerp
- growth, pop and harvest curves (the pop peak stays below 1.1)
- model keys
- target size grows with the farm
- the kit builds every entity type, giant, slab and drone, shares geometry across tiles, and disposes clean
- demo-farm sync: the right number of builds, 2 giants, hidden giant cells, no rebuild in steady state
- harvest pop, planting pop, growth without rebuild, water plane
- pause freezes growth and the drone
- the drone glides, faces its travel, and teleports on a wrap
- camera pitch, near edge wider than far edge, centred, sized to the target
- 12×12 wheat triangle and mesh budget, plus per-frame CPU

**Live headless-Chromium checks** (SwiftShader):
- The demo renders the seeded 8×8 farm in 3D, including both giant pumpkins.
- A fresh 1×1 farm renders.
- On a 12×12 save, running a harvest/replant program rebuilds only the changed tiles, with harvest and plant pops.
- While paused, the drone stays frozen.
- The 2D toggle removes the canvas (the WebGL context is disposed) and persists `2d`; switching back to 3D
  recreates it.
- The Playground still renders and does not load three.js.
- There were no console errors or warnings.

## Simplifications and notes
- **Wheat** is a merged mesh per tile (shared geometry), not true instancing. It is the same cost class, and it
  let me keep per-tile growth and tint with one draw call per tile.
- **Water** is a tinted plane over the soil. Over orange soil the result reads slate-blue rather than pure blue.
  There is no wet-soil darkening and no animated ripples.
- **Soft shadows:** three r187 removed `PCFSoftShadowMap` (it now warns and falls back), so I used `PCFShadowMap`
  with a small blur radius.
- **Drone shadow** is only the blob (the drone doesn't cast a real shadow), so there is no double shadow.
- **Hidden giant tiles** show bare soil under the giant pumpkin, as in v2.
- **The 2D board** is unchanged from v2 and only kept as the fallback, per the brief.
- **QA hook:** the board's wrapper element carries `__farm3d` (the `FarmScene`) for automated checks. It is not
  used by the app.

## Commit / push
Committed on `farmer-game`. The push result is in the section below.

### Push status
- Committed locally on `farmer-game` as `7e95a86`, with the same author as the earlier farmer commits.
- `git push origin farmer-game` **failed**: `remote: Permission to bzcom8192/js-playground.git denied to
  develop-swf` (HTTP 403). This is the same auth problem as in RESULT/RESULT2. The commits stay local; pull them
  via bundle.
