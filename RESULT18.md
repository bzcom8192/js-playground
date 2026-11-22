# RESULT18 — 3D detail pass (BRIEF18)

Branch `farmer-game`, on top of `3edc6e3`. Nothing was pushed.

| Commit | What |
|---|---|
| `11db834` | The detail pass (code + tests) |
| (this file) | RESULT18 summary |

## Tests

| | Before | After |
|---|---|---|
| Farmer | 266 / 266 | **271 / 271** (+5) |
| Server | 33 / 33 | **33 / 33** |
| Lint, build | clean | clean |

- New tests: triangle budget, smooth/indexed/shared crop geometry with ripe ≠ young, bot
  materials, soil relief and tile variants, shadow redraw rules.
- **Mechanics:** 36 solo arena runs (3 bots × goals × 4 seeds), arena verification, two seeded
  mazes, all constants and a fresh save were hashed on `3edc6e3` and on this tree: identical
  SHA-256 (`c3a260ce…`). BRIEF17's own 60-run script was a throwaway, so this is a new one,
  also not in the repo. Only `FarmBoard3D.jsx`, `board3d/*` and `board3d.test.mjs` changed.

## What was detailed

| Model | Triangles/tile before → after | Detail |
|---|---|---|
| Wheat | 1,400 → 1,344 | 64 stalks with nodding heads, kernel rows light/dark, leaf blades |
| Rice | 756 → 1,098 | 3×3 hills, curved stalks, arching panicles, blades; slumped dead variant |
| Bush | 180 → 974 | five smooth lobes, loose leaves, twigs; ripe = round red berries |
| Tree | 84 → 1,268 | flared ridged trunk, limbs, 8-lobe layered canopy, leaves, peach tuft + blossoms |
| Carrot | 248 → 1,072 | leafy tops with leaflets; ripe = orange shoulder with growth rings + cream flower |
| Pumpkin | 680 → 922 (giant 3,330) | round ribs, deep stem well, ridged stem, leaves; giants add a tendril |
| Sunflower | 244 → 492 | two petal rows, domed disc with a seed spiral, broad leaves |
| Cactus | 368–448 → 808–1,000 | 8 real ribs, elbow arms (second from size 4), spines, open flower when ripe |
| Bot | 832 → 4,952 | below |

- **Bot:** bevelled hull, lid and side rails, lens in a brass bezel, panel seams and bolts, framed
  roof with busbar grid, bolted mast plate + collar + light dish, legs with sleeves and forks,
  tyres with slanted lugs, hubs with spokes. Four materials: paint (roughness 0.42), metal
  (0.36 / metalness 0.4), rubber (0.96), glass (0.12). Animation code untouched.
- **Scene:** soil tops are really furrowed, with a 256 px furrow/clod/pebble texture; meadow
  texture plus short blades; two variants of each. Planter: planks with staggered joints and grain,
  battens with brass nails, bevelled rim, inner bead, skirting, two-step brass caps.
  Key light 2.7 → 3.1, fill 1.5 → 1.35. Camera, framing, background, palette unchanged.

## Triangles

**Budget: full 12×12 demo farm < 180k; 12×12 of any single crop < 300k** (both tested; the older
400k wheat test stays). "Full 12×12" = the demo layout repeated to 12×12.

| Scene | Triangles before → after | Vertices | Draw calls (main pass) |
|---|---|---|---|
| Demo 8×8 | 35,614 → 69,822 | 105k → 60k | 461 → 208 |
| Full 12×12 | 72,202 → **137,524** | 214k → 114k | 1,010 → 437 |
| 12×12 all wheat (heaviest crop) | 204,606 → 206,004 | 611k → 167k | 1,047 → 474 |
| 12×12 all trees (second) | 15,102 → 197,136 | 42k → 179k | 1,047 → 474 |

Triangles actually submitted per frame (both passes, idle): demo 69,392 → 69,716, full 12×12
141,072 → 137,286, all wheat 406,124 → about 205,000.

## fps

**Method:** production builds of `3edc6e3` and this tree, headless Chromium on SwiftShader
(software GL; no GPU here), 1920×1080, `?demo=1`. fps = rAF count over 12 s. CPU = GPU-process
CPU time per frame over a synchronous render + `readPixels` loop, which ignores scheduling.
Runs alternate before/after; medians of 3 rounds.

| Final build | fps before → after | CPU ms/frame before → after |
|---|---|---|
| **Demo 8×8** | **1.77 → 1.75** | 1,176 → 1,172 |
| Full 12×12 | 1.16 → 1.18 | 1,596 → 1,779 (+11 %) |

- Absolute fps is low because another session's Chromium took most of the 4 cores throughout.
  Earlier, with the box quiet, the baseline demo ran at 3.1–3.2 fps. Never compare across windows.
- Full 12×12 fps is noisy: the three rounds above gave parity, two earlier contended batches of
  near-final builds gave 1.23 → 1.04 and 1.10 → 0.81. Read it as "equal to somewhat slower".
- Everything growing (12×12): 1.12 → 1.15 fps, 1,930 → 1,937 CPU ms, medians of 3, measured just
  before the last trim. A single later run of the trimmed build was 1.28 → 1.18.
- All wheat 12×12: CPU about 3,200–3,400 → 2,500–2,600 ms.
- Not measured: a real GPU.

## Backed off

The first version ran the demo at 1.8–2.0 fps against 3.2. Reduced until it recovered:
wheat/rice stalks to camera-facing ribbons and heads to 3 sides; fewer rice stalks; single-sheet
leaves; canopy lobes, carrots, cacti, pumpkins (60×14 → 40×11, giant 120×36 → 80×20) trimmed; most
small bot and planter bevels back to boxes; mudguards dropped (they also hid the wheels); shadow
map 4096 → 2560 (was 2048; small farms 1024 → 2048).

Paid for by: shadow map redrawn only when a caster changes (every 3rd frame while plants merely
grow), 2 draws per tile instead of 6, indexed geometry, Lambert for matte surfaces and Phong for
rind, texture anisotropy 4 → 1, and only the gaps of the slab's top being drawn.

## Screenshots (1920×1080, buildbox)

- After (deliverable): `~/semicolon-acres-demo-brief18.png`
- Before: `~/semicolon-acres-demo-brief18-before.png`

Also looked at, no page or console errors: 3×3 close-ups of every crop young and ripe, 1×1 running,
four bots with all four status lights, hedge / chest / apple / dinosaur.

## Decisions and caveats

1. **PCFSoft does not exist any more.** three r187 removed `PCFSoftShadowMap`: asking for it logs a
   warning and gives `PCFShadowMap`, which is now the soft filter. Kept that, radius 3 → 4.
2. **"Instanced":** the farm never used `InstancedMesh`; each tile is a mesh sharing one cached
   geometry per variant. That is unchanged: no per-tile geometry.
3. Hedge, chest, apple and dinosaur were not in the brief and stay flat-shaded. They now look
   coarser than the rest; smoothing them is the obvious follow-up.
4. Stalk ribbons and the front-only planks rely on the fixed camera. A turning camera would need both
   rebuilt (`ribbon()` in `geom.js`, `planksGeometry()` in `planter.js`).
5. Pumpkins sit 0.04 lower: they used to float slightly above the soil. Rim ends no longer stick out
   of the slim posts on tiny farms.
6. Growing plants' shadows can lag by up to two frames.
7. `models.js` was split into `geom`, `crops`, `bot`, `planter` and `textures`.
8. As RESULT17 noted, progression and API shape are still close to the game this project started
   from. This pass adds no likeness to it: every model is our own design.
