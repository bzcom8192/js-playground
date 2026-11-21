import { EXAMPLES } from "./examples.js";
import * as W from "./world.js";

const API = [
  {
    title: "Actions — take time (200 ticks), no await needed",
    items: [
      ["harvest()", "Harvest the tile. Ripe → yield; unripe → destroyed (unripe grass is left alone). On the dinosaur: cuts off that segment and its tail → Bone."],
      ["plant(entity)", "Plant Entities.X (Plant unlock + its own unlock). Seed cost is paid automatically. Entities.Dinosaur hatches the dinosaur."],
      ["move(dir)", "North / East / South / West. Wraps around the edges. Hedges block it (returns false)."],
      ["till()", "Grassland ⇄ Soil, removes the entity. Needs Carrots. Not on the dinosaur / an apple."],
      ["swap(dir)", "Swap entity with neighbour (no wrap). Needs Cactus. Not with the dinosaur / an apple."],
      ["use_item(item, n=1)", "Items.Water: +0.25 water. Items.Fertilizer: −2 s growth (on a grown Bush with Mazes: spawns a maze)."],
      ["trade(item, n=1)", "Fertilizer = 1 Pumpkin, Water = 1 Carrot."],
      ["unlock(Unlocks.X)", "Buy the next level from code."],
      ["clear()", "Reset farm to empty grassland (no maze, no dinosaur), this drone to (0,0)."],
      ["do_a_flip()", "600 ticks of pure style."],
      ["spawn_drone()", "Megafarm: a new drone on this tile runs this same program from the top. false when locked or at the cap."],
    ],
  },
  {
    title: "Senses — instant (1 tick). 🔒 = needs Senses, returns null before",
    items: [
      ["can_harvest() 🔒", "Is the entity under the drone ripe? (Dinosaur: always; Apple: never.)"],
      ["get_entity_type() 🔒", "Entities.X or null."],
      ["get_ground_type() 🔒", "Grounds.Grassland / Grounds.Soil."],
      ["get_pos_x() / get_pos_y() 🔒", "Drone position, (0,0) = South-West."],
      ["measure(dir?) 🔒", "Sunflower petals (7–15) / cactus size (0–9), here or at a neighbour. In a maze: direction of the treasure."],
      ["get_water() 🔒", "Water level 0…1 here."],
      ["get_world_size()", "Farm side length."],
      ["num_items(item)", "Inventory count."],
      ["get_cost(thing)", "Unlock cost or seed cost, e.g. {Wood: 1, Hay: 1}. Cactus/Grass → unlock."],
      ["num_unlocked(thing)", "Unlock level (entities map to their unlock)."],
      ["can_move(dir)", "Always true in an open field; false into a Hedge or over a maze's edge."],
      ["get_time() / get_tick_count()", "Seconds since Run (one clock for all drones) / this drone's ticks."],
      ["num_drones() / max_drones()", "Drones on the farm / the cap (farm size with Megafarm, else 1)."],
      ["print(...) / quick_print(...)", "Write to the Log (console.log works too)."],
    ],
  },
  {
    title: "Constants",
    items: [
      ["Entities", "Grass, Bush, Tree, Carrot, Pumpkin, Sunflower, Cactus, Dead_Pumpkin, Hedge, Treasure, Dinosaur, Apple"],
      ["Items", "Hay, Wood, Carrot, Pumpkin, Power, Cactus, Fertilizer, Water, Gold, Bone"],
      ["Grounds", "Grassland, Soil"],
      ["Unlocks", "Speed, Expand, Plant, Senses, Grass, Carrots, Trees, Watering, Pumpkins, Sunflowers, Fertilizer, Cactus, Mazes, Dinosaurs, Megafarm"],
      ["North East South West", "Directions (plain strings)."],
    ],
  },
];

const RULES = [
  ["Grass 🌱", "1 s, regrows by itself on empty Grassland → 1 Hay × (Grass level + 1)."],
  ["Bush 🌿", "4 s, any ground → 1 Wood × Trees level."],
  ["Tree 🌳", "7 s, ×2 slower per adjacent tree (checkerboard!) → 5 Wood × Trees level."],
  ["Carrot 🥕", "6 s, Soil, seed 1 Wood + 1 Hay → 1 Carrot × Carrots level."],
  [
    "Pumpkin 🎃",
    "3 s, Soil, seed 1 Carrot. 20% rot into Dead_Pumpkin (harvest just clears it). Harvesting a ripe pumpkin clears its whole connected group of ripe pumpkins: a solid k×k square gives k³, any other shape gives its size. × Pumpkins level.",
  ],
  [
    "Sunflower 🌻",
    "5 s, Soil, seed 1 Carrot → Power = ⌊√(sunflowers on farm)⌋, ×8 if ≥ 10 sunflowers and this one has the most petals.",
  ],
  [
    "Power ⚡",
    "While you have Power, every action costs 1 Power and runs 2× faster.",
  ],
  [
    "Cactus 🌵",
    "2 s, Soil, seed 1 Pumpkin, size 0–9. Harvesting a ripe cactus harvests EVERY cactus. n = ripe cacti. If every pair of neighbouring ripe cacti is sorted (West ≤ East and South ≤ North) you get n², otherwise n. Unripe cacti are lost. × Cactus level.",
  ],
  ["Water 💧", "Growth speed × (1 + 4 × water). Water evaporates (−0.02/s). Tank: +1 every 10 s ÷ Watering level, cap 5 + 5 × level."],
  ["Fertilizer 🧪", "Skips 2 s of growth on the plant under the drone."],
  ["Speed ⏩", "×2 drone speed per level (on top of the speed selector)."],
  ["Expand 🗺️", "1→2→3→4→5→6→7→8→10→12. Clears the farm."],
];

const MAZES = [
  ["Spawn", "Stand on a fully grown Bush and use_item(Items.Fertilizer) (Mazes unlocked). The whole farm becomes a hedge maze; the fertilizer is only used if a maze appears."],
  ["Layout", "A perfect maze: every path tile is reachable and there is exactly one way between any two. Hedges 🟩 are walls; the farm edge is a wall too (no wrap-around in a maze). You start where you stood."],
  ["Treasure 💰", "Sits on the path tile farthest from your start. measure() returns its direction from you: the axis with the larger distance wins (ties → East/West); null when you are on it."],
  ["Gold 🪙", "harvest() on the treasure → Gold = farm tiles (size²) × Mazes level. The maze disappears and the farm is empty Grassland again."],
  ["Meanwhile", "plant, till, swap and trade fail inside a maze. clear() (or Expand) removes the maze without a reward. Try example 7 (a wall follower)."],
  ["Seed & records 🏆", "Every maze comes from a seed (printed in Output: Maze seed: …). Same seed + farm size + start tile → the same maze. Solving a maze spawned in the same run records its ticks and ops (every API call = 1 op); see the 🏆 Records window, where you can also replay a seed."],
];

const DINOSAURS = [
  ["Hatch", "plant(Entities.Dinosaur) on an empty (or grass) tile, Dinosaurs unlocked, 10 Gold. It starts 1 tile long. One dinosaur per farm."],
  ["Roaming", "Every 0.3 s of game time its head steps to a random free neighbour: empty ground, grass (trampled) or an apple. Never into its own body, a hedge or a crop, never across the edge; boxed in, it waits. The drone flies over it."],
  ["Apples 🍎", "While it lives, an apple appears every 1.5 s on a random empty/grass tile (at most 1 per 16 tiles, min 1). Walking onto one eats it: +1 length. You can't harvest, plant on, till or swap apples."],
  ["Bone 🦴", "harvest() on a segment cuts off it and everything behind it: Bone = (segments removed)² × Dinosaurs level. The head takes the whole dinosaur (length²), the tail tip pays 1. When it's gone (apples vanish too) you can hatch a new one."],
  ["Meanwhile", "get_entity_type() is Entities.Dinosaur on every segment; the info strip shows which one (head 1/5…). Spawning a maze, clear() or Expand removes the dinosaur and apples. Try example 8."],
];

const MEGAFARM = [
  ["Spawn", "spawn_drone() (Megafarm unlocked) puts a new drone on the caller's tile. It takes 200 ticks and returns true, or false when locked, at the cap, or outside a running program."],
  ["Same program", "The new drone runs the SAME program from the top, the file you pressed ▶ on, in parallel with the others. So branch on where you are or on num_drones() to give each drone its own job (example 9)."],
  ["Cap", "max_drones() = the farm's side length (12 on 12×12, 1 on 1×1): one drone per column. num_drones() counts every drone on the farm, including drones whose program already ended."],
  ["Shared", "All drones share the farm, the inventory and the unlocks. Every function acts on the drone that calls it (position, harvest, plant, measure, mazes, dinosaurs). Drones fly, so several can share a tile; the first harvest wins, the others find it empty."],
  ["Stop & errors", "❚❚ / ■ pause and stop every drone. An error stops only the drone that threw it (the Log says which: \"Drone 2: …\"); the others keep going. Each new Run starts with drone 0 alone; leftover drones (also from a save) wait idle until then."],
];

export default function DocsPanel({ game, onLoadExample, targetName = "the editor" }) {
  return (
    <div className="p-3 space-y-4 text-xs">
      <div className="flex items-center gap-2">
        <label htmlFor="farmer-example" className="text-gray-400 font-semibold shrink-0">
          Examples
        </label>
        <select
          id="farmer-example"
          value=""
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.target.value);
            if (ex) onLoadExample(ex);
          }}
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs"
        >
          <option value="">Load an example into “{targetName}”…</option>
          {EXAMPLES.map((ex) => {
            const missing = ex.needs.filter((u) => !W.isUnlocked(game, u));
            return (
              <option key={ex.id} value={ex.id}>
                {ex.name}
                {missing.length ? ` — 🔒 ${missing.join(", ")}` : ""}
              </option>
            );
          })}
        </select>
      </div>
      <p className="text-gray-500 leading-relaxed">
        Write plain JavaScript — no <code className="text-gray-300">await</code> needed. Your own
        functions can call drone actions. Callbacks like <code className="text-gray-300">forEach</code>{" "}
        don&apos;t wait for actions: use <code className="text-gray-300">for…of</code> loops instead.
      </p>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Files &amp; windows</h3>
        <ul className="space-y-1 text-gray-400 leading-relaxed list-disc pl-4">
          <li>
            Each code window is a file. <span className="text-gray-200">▶</span> runs <em>that</em> file (or{" "}
            <code className="text-gray-300">Ctrl+Enter</code> inside it). Starting a run stops the previous one.
          </li>
          <li>
            Every <em>other</em> file contributes only its <span className="text-gray-200">top-level functions</span>{" "}
            (<code className="text-gray-300">function f() {"{…}"}</code>,{" "}
            <code className="text-gray-300">const f = (…) =&gt; …</code>,{" "}
            <code className="text-gray-300">const f = function …</code>) — like <code className="text-gray-300">from f0 import *</code>.
            Their other top-level code (loops, calls, variables) is ignored.
          </li>
          <li>
            Name clash: the running file&apos;s own top-level name wins; between helper files, the first file in the
            Files list wins.
          </li>
          <li>
            <span className="text-gray-200">❚❚</span> pauses the program <em>and</em> the farm (no growth); ▶ resumes.{" "}
            <span className="text-gray-200">■</span> stops.
          </li>
          <li>Drag a window by its title bar, resize from the bottom-right corner, — minimizes, ✕ closes (reopen via +).</li>
        </ul>
      </section>

      {API.map((g) => (
        <section key={g.title}>
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">{g.title}</h3>
          <dl className="space-y-1">
            {g.items.map(([name, desc]) => (
              <div key={name} className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2">
                <dt className="font-mono text-amber-200/90 break-words">{name}</dt>
                <dd className="text-gray-400">{desc}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Mazes 🧩</h3>
        <dl className="space-y-1">
          {MAZES.map(([name, desc]) => (
            <div key={name} className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-2">
              <dt className="text-gray-200">{name}</dt>
              <dd className="text-gray-400">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Dinosaurs 🦕</h3>
        <dl className="space-y-1">
          {DINOSAURS.map(([name, desc]) => (
            <div key={name} className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-2">
              <dt className="text-gray-200">{name}</dt>
              <dd className="text-gray-400">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Megafarm 🏭</h3>
        <dl className="space-y-1">
          {MEGAFARM.map(([name, desc]) => (
            <div key={name} className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-2">
              <dt className="text-gray-200">{name}</dt>
              <dd className="text-gray-400">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Farming rules</h3>
        <dl className="space-y-1">
          {RULES.map(([name, desc]) => (
            <div key={name} className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-2">
              <dt className="text-gray-200">{name}</dt>
              <dd className="text-gray-400">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
