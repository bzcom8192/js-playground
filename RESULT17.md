# RESULT17 — v5 phase 1b: retheme to *Semicolon Acres*

Branch `farmer-game`. Nothing was pushed.

| Commit | What |
|---|---|
| `3ba8a66` | BRIEF16 work, parked on its own (step 0) |
| `0b27bc2` | The retheme |
| (this file) | RESULT17 summary |

## Tests

| | Step 0 (BRIEF16) | After the retheme |
|---|---|---|
| Farmer | 264 / 264 | **266 / 266** (+2) |
| Server | 33 / 33 | **33 / 33** |
| Lint, build | clean | clean |

- New tests: `spawn_bot` / `num_bots` / `max_bots` / `spin_in_place` behave exactly like their
  earlier names (same output, ops, ticks, positions); a program that declares one of the new
  names itself still runs.
- Changed tests only follow renamed text, the new model API (`buildBot`, wheels, status light)
  and the new demo layout.
- **Mechanics check:** 60 arena runs/matches (programs saved from the BRIEF16 commit, old API
  names), the full cost/growth tables and two maze verifications were recorded before the
  first edit and replayed after: byte-identical. The script was a throwaway, not in the repo.
- Looked at in headless Chromium, no page errors: demo at 1920×1080
  (`~/semicolon-acres-demo.png`), fresh 1×1 farm running and paused, a save with an old-name
  crew program, Workshop, Field Guide, phone width, 2D fallback. Not looked at: the red error
  light (unit-tested only), the dinosaur and hedge recolour, Almanac / Arena / Online windows.

## Name

**Semicolon Acres**: JavaScript's semicolon plus farmland; the mark is a semicolon whose tail
is a leaf. One web search on 2026-11-22 found no game with that title (there is an unrelated
farming sim called *ACRES*). "Loop & Loam" was dropped because it seems to be a game-jam entry.
This is not a trademark check; do one, plus domain and stores, before launch.

## The bot

An over-the-row field robot: a cream box on four wheeled legs that straddles the crop, tilted
solar roof, one round lens, seed probe underneath, light on a mast. It drives (wheels roll) and
turns on the spot instead of flying and flipping. Light: cream idle, green running, amber
paused, red error. The existing per-drone colours are now a stripe around the body. Bots that
share a tile stand slightly apart. Own 2D sprite for the no-WebGL fallback. UI says "bot"; the
Guide introduces it as บอทไร่.

## Look and layout

- Palette: morning paper, aubergine ink, teal (actions), marigold (accents), berry (stop).
  Panels follow through re-inked Tailwind ramps under `.acres` (`src/index.css`).
- Board: raised planter box with a pale rim and brass-capped posts (the earth slab and rocks are
  gone); cool soil, sage grass, rose heirloom pumpkins, teal hedges, violet dinosaur with fins.
- Layout: dark top bar with labelled tabs, store-room rail on the left, info strip above the
  farm, code right, panels over the farm. Windows: coloured spine, paper title, Run/Stop pills.
- The demo farm and its item counts are new; the old ones matched the old reference screenshot.
- Saved window positions are kept, but moved below the new top bar if they were under it.

## Copy

Rewritten: unlock names and texts (shown with their code id, e.g. "Overclock `Unlocks.Speed`"),
Field Guide, IntelliSense docs, starter/helper/example programs, window titles, weather texts,
log and error wording, README. Info → Field Guide, Unlocks → Workshop, Records → Almanac, arena
opponents → rivals. No mention of the other game is left in `src`, `server` or the README.

## Intentionally unchanged

Rules, numbers, unlock ids/order/prices, ticks and ops, farming verbs, `Entities` / `Items` /
`Unlocks` names, storage keys, file formats (`js-farmer-save`, `js-farmer-identity`), API
routes and category ids, `/opt/js-farmer` deploy paths, internal names like `game.drone`.

## Decisions and caveats

1. **Beyond the brief:** `do_a_flip` also got an original name, `spin_in_place()`, plus
   `num_bots()` / `max_bots()`. The old names are silent aliases, not shown in the Guide.
2. **Old programs that use a new name** (`const num_bots = 3`) keep working: their own
   top-level declaration wins.
3. The download file names are now `semicolon-acres-…json`; older files still import.
4. Seeded files are now `morning` and `toolshed`; existing players keep their own files.
5. `RESULT16.md` was never written; this run did not add it. Briefs stay untracked as before.
6. **What still resembles the earlier model:** the brief keeps the mechanics, progression,
   numbers and API shape (`get_entity_type`, `Entities.X`, fused pumpkins, sorted cactus,
   fertilizer maze, dinosaur and apples). Name, character, art, look and text are now ours, but
   people who know that game will recognise the progression. Before a public launch it is worth
   retuning the unlock order and numbers, replacing the dinosaur set piece, and leading with our
   own systems (weather, rice, contracts, arena, verified online). This is a design view, not
   legal advice.
7. The buildbox has no Thai font, so Thai text shows as boxes in screenshots made here.
