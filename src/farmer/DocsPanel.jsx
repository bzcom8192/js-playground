import { UNLOCK_BY_ID } from "./constants.js";
import { EXAMPLES } from "./examples.js";
import * as W from "./world.js";

const API = [
  {
    title: "Actions: 200 ticks each, and no await to write",
    items: [
      ["harvest()", "Gather what is on the tile. Ripe pays; unripe is lost (young grass is spared). On the dinosaur it cuts that segment and the tail behind it into Bone."],
      ["plant(entity)", "Plant Entities.X; needs the Seed Hopper and the plant's own upgrade. The seed is paid for you. Rice wants Soil with water ≥ 0.5; Entities.Dinosaur sets an egg."],
      ["move(dir)", "North, East, South or West. Over one edge and in at the other. A Hedge stops the bot (false)."],
      ["till()", "Grassland ⇄ Soil; clears the tile. Needs the Plough Blade. Not on the dinosaur or an apple."],
      ["swap(dir)", "Trade places with the neighbour's plant, never over the edge. Needs the Cactus Bench. Not with the dinosaur or an apple."],
      ["use_item(item, n=1)", "Water: +0.25 water. Fertilizer: 2 s of growth, or a labyrinth when used on a full-grown Bush with Hedge Labyrinth."],
      ["trade(item, n=1)", "The market sells Fertilizer (1 Pumpkin) and Water (1 Carrot), and pays 2 Gold per Rice."],
      ["unlock(Unlocks.X)", "Buy the next level of an upgrade from code."],
      ["clear()", "Bare grassland everywhere, no labyrinth, no dinosaur; this bot goes to (0, 0)."],
      ["spin_in_place()", "One turn on the spot. 600 ticks: good for waiting."],
      ["deliver_contract(id)", "Hand over one of today's orders (id from get_contracts()) and collect the reward. false when short, too late, already done or unknown."],
      ["spawn_bot()", "Bot Crew: one more bot on this tile, running this same program from line 1. false without the upgrade or with everyone out."],
    ],
  },
  {
    title: "Sensors: 1 tick. 🔒 = null until you have the Sensor Mast",
    items: [
      ["can_harvest() 🔒", "Is it full-grown? (The dinosaur always, an apple never.)"],
      ["get_entity_type() 🔒", "Entities.X, or null on an empty tile."],
      ["get_ground_type() 🔒", "Grounds.Grassland or Grounds.Soil."],
      ["get_pos_x() / get_pos_y() 🔒", "Where this bot stands. (0, 0) is the South-West corner."],
      ["measure(dir?) 🔒", "Petals of a Sunflower (7–15) or size of a Cactus (0–9), here or next door. In a labyrinth: which way the treasure lies."],
      ["get_water() 🔒", "How wet the tile is, 0…1."],
      ["get_world_size()", "Tiles along one side of the farm."],
      ["num_items(item)", "How much of it is in the store room."],
      ["get_cost(thing)", "Price of an upgrade or a seed, e.g. {Wood: 1, Hay: 1}. Cactus, Grass and Rice mean the upgrade."],
      ["num_unlocked(thing)", "Level of an upgrade; for a plant, of the upgrade it belongs to."],
      ["can_move(dir)", "false into a Hedge or over a labyrinth's outer edge, otherwise true."],
      ["get_time() / get_tick_count()", "Seconds since Run, the same for every bot / ticks this bot has used."],
      ["get_contracts()", "Today's orders: [{ id, item, amount, reward, rewardItem, ticksLeft, status }]."],
      ["get_arena_goal()", "In a race: { item, amount }, e.g. { item: \"Hay\", amount: 500 }. At home: null."],
      ["get_weather()", "\"Sunny\", \"Rain\", \"Storm\" or \"Drought\" (null in the arena)."],
      ["get_forecast()", "25 ops a look! { next, inTicks }: what comes next for sure, and when give or take 20%."],
      ["num_bots() / max_bots()", "Bots on the farm / how many may be (the farm's width with Bot Crew, else 1)."],
      ["print(...) / quick_print(...)", "A line in the Output tab. console.log does the same."],
    ],
  },
  {
    title: "Names to use in code",
    items: [
      ["Entities", "Grass, Bush, Tree, Carrot, Pumpkin, Sunflower, Cactus, Dead_Pumpkin, Hedge, Treasure, Dinosaur, Apple, Rice, Dead_Rice"],
      ["Items", "Hay, Wood, Carrot, Pumpkin, Power, Cactus, Rice, Fertilizer, Water, Gold, Bone"],
      ["Grounds", "Grassland, Soil"],
      ["Unlocks", "Speed, Expand, Plant, Senses, Grass, Carrots, Trees, Watering, Pumpkins, Sunflowers, Fertilizer, Rice, Cactus, Mazes, Dinosaurs, Megafarm (the Workshop shows which is which)"],
      ["North East South West", "Directions; plain strings, like the weather names."],
    ],
  },
];

const WEATHER = [
  ["Segments", "The sky can change every 1,200 world ticks (10 per second of farm time, so about 2 minutes). Your save has its own weather seed. On pause it stands still."],
  ["☀️ Sunny", "Nothing special."],
  ["🌧 Rain", "Soil soaks up 0.03 water per second, 0.01 more than it loses."],
  ["🏜 Drought", "Tiles dry 3× faster, and plants on tiles below 0.5 water grow at half pace."],
  ["⛈ Storm", "Everything grows 1.5× faster, but three lightning strikes take 1–3 plants each. The ground is unharmed; the Output tab tells you."],
  ["get_forecast()", "Looking ahead has a price: 25 ops a call, and records count ops. The weather it names is certain, the time is not (±20%)."],
  ["Arena", "There is no weather in races; both calls give null there."],
];

const RULES = [
  ["Grass 🌱", "1 s. Comes back by itself on bare Grassland. 1 Hay × (Meadow Mix level + 1)."],
  ["Bush 🌿", "4 s on any ground. 1 Wood × Woodlot level."],
  ["Tree 🌳", "7 s, doubled for each tree directly beside it, so leave gaps. 5 Wood × Woodlot level."],
  ["Carrot 🥕", "6 s on Soil, seed 1 Wood + 1 Hay. 1 Carrot × Plough Blade level."],
  [
    "Pumpkin 🎃",
    "3 s on Soil, seed 1 Carrot. One in five spoils (Dead_Pumpkin; harvest() clears it). Cutting a ripe one takes every ripe pumpkin connected to it: k³ when they form a full k×k block, otherwise one each. × Pumpkin Patch level.",
  ],
  [
    "Sunflower 🌻",
    "5 s on Soil, seed 1 Carrot. Power = ⌊√(sunflowers on the farm)⌋, ×8 when there are at least 10 and no other has more petals than this one.",
  ],
  ["Power ⚡", "As long as there is some, every action burns 1 Power and takes half the time."],
  [
    "Cactus 🌵",
    "2 s on Soil, seed 1 Pumpkin, size 0–9. Cutting one ripe cactus takes the whole bench; unripe ones are lost. With n ripe: n² when no neighbour is out of order (West ≤ East, South ≤ North), else n. × Cactus Bench level.",
  ],
  [
    "Rice 🌾",
    "9 s (6 s at level 2) on Soil, seed 1 Carrot. Needs water ≥ 0.5 to plant and ≥ 0.2 to grow; more than 200 dry world ticks in a row (20 s) and it is Dead_Rice, which harvest() only clears. 3 Rice a plant, 5 at level 2, and trade(Items.Rice) pays 2 Gold each.",
  ],
  ["Water 💧", "Growth × (1 + 4 × water). Tiles lose 0.02 a second. The barrel gains 1 every 10 s ÷ level and holds 5 + 5 × level."],
  ["Fertilizer 🧪", "2 s of growth for the plant under the bot."],
  ["Overclock ⏩", "Each level doubles the bots' pace."],
  ["New Acres 🗺️", "1→2→3→4→5→6→7→8→10→12 tiles a side. The farm is levelled each time."],
];

const MAZES = [
  ["Growing one", "Use Fertilizer on a full-grown Bush (Hedge Labyrinth built). The whole farm turns into hedges; the Fertilizer is spent only if that works."],
  ["Layout", "Every path tile can be reached, and there is one way between any two. Hedges 🟩 and the farm's edge are solid, so no driving round the back. The bot begins where it stood."],
  ["Treasure 💰", "On the path tile farthest from your start. measure() names the direction to it: the longer axis, East/West on a tie, null once you are there."],
  ["Gold 🪙", "harvest() on it pays farm tiles × level. The hedges go and bare Grassland is left."],
  ["Until then", "plant, till, swap and trade are closed. clear() or New Acres ends the labyrinth unpaid. Example 7 finds the way by touch."],
  ["Seeds 🏆", "The Output tab prints each labyrinth's seed. Same seed, farm size and start tile: same hedges. One that you grow and solve in a single run enters the Almanac with ticks and ops (every API call is 1 op), where a seed can also be set for the next one."],
];

const DINOSAURS = [
  ["The egg", "plant(Entities.Dinosaur) on an empty or grass tile for 10 Gold (Dinosaur Egg built). One tile long, one per farm."],
  ["Wandering", "Every 0.3 s of game time the head picks a free tile next door: bare ground, grass (it is trampled) or an apple. Not its own body, a hedge, a crop or the edge. Hemmed in, it waits. Bots straddle it."],
  ["Apples 🍎", "While it lives, one appears every 1.5 s on a free tile, up to one per 16 tiles (at least 1). Each one eaten adds a tile. Bots can't gather them or work their tile."],
  ["Bone 🦴", "Cutting a segment takes everything behind it as well: (segments)² × level. The head means all of it, the tail tip means 1. When nothing is left, so are the apples, and you can set another egg."],
  ["Good to know", "Every segment reads as Entities.Dinosaur, and the strip above the farm says which one. A labyrinth, clear() or New Acres ends it. See example 8."],
];

const CONTRACTS = [
  ["Every day", "Three orders at local midnight, drawn from the date: players with the same upgrades and farm size get the same three."],
  ["What", "Only things you can make: Hay and Wood; Carrot, Pumpkin, Rice and Cactus once unlocked; Gold with the labyrinth; Bone with the egg. The amounts follow your farm's size."],
  ["Reward", "About 1.5 × what the goods are worth, in Gold (orders for Gold or Bone pay Bone). Deliver with the button or deliver_contract(id). The Almanac keeps the total."],
  ["Deadline", "Counted in ticks your programs use, the same as get_tick_count(). When they or the day run out, so does the order."],
];

const ARENA = [
  ["The race", "One of your files against a rival. Each gets its own fresh 8×8 farm from the same seed, on one virtual clock, so it is over in seconds."],
  ["The farm", "All upgrades up to Bot Crew at level 1 (8 bots), Overclock 0, no labyrinth, egg or rice, no orders, an empty store room. unlock() works."],
  ["The goal", "First to hold 500 Hay, 800 Wood or 300 Pumpkin. After 200,000 ticks (1 tick = 1 ms, an action 200) the larger amount wins, and equal is a draw."],
  ["Fair play", "An error loses on the spot. A loop without actions is slowed down and runs out of time. Math.random() is seeded too, so the same seed and programs give the same race."],
  ["Rivals", "Rookie 800, Pro 1200, Ace 1600: ordinary programs you can read in the window. You begin at 1000 (ELO, K = 32); the save keeps your last 20 races."],
];

const MEGAFARM = [
  ["One more", "spawn_bot() (Bot Crew built) puts a bot on the tile of the one that calls it. 200 ticks; false without the upgrade, with everyone out, or outside a run."],
  ["One plan", "Each bot runs the SAME file from line 1, at the same time. Give them different work by where they stand or by num_bots() (example 9)."],
  ["How many", "max_bots() is the farm's width, one per column (12 on 12×12). num_bots() also counts those whose program is over."],
  ["Together", "Farm, store room and upgrades are shared; a call acts on the bot that makes it. Several fit on one tile, but only the first to cut a plant gets it."],
  ["Trouble", "Pause and Stop hold for the crew. An error ends only the bot that made it (\"Bot 2: …\" in Output). The next Run starts with bot 0 alone; the others, also those from a save, go home."],
];

export default function DocsPanel({ game, onLoadExample, targetName = "the editor" }) {
  return (
    <div className="p-3 space-y-4 text-xs">
      <div className="flex items-center gap-2">
        <label htmlFor="farmer-example" className="text-gray-400 font-semibold shrink-0">
          Example programs
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
          <option value="">Load one into “{targetName}”…</option>
          {EXAMPLES.map((ex) => {
            const missing = ex.needs.filter((u) => !W.isUnlocked(game, u));
            return (
              <option key={ex.id} value={ex.id}>
                {ex.name}
                {missing.length ? ` — 🔒 ${missing.map((u) => UNLOCK_BY_ID[u].name).join(", ")}` : ""}
              </option>
            );
          })}
        </select>
      </div>
      <p className="text-gray-400 leading-relaxed">
        Your bot (บอทไร่) does what its file says, in plain JavaScript. Actions wait for themselves, in your own functions too. One exception:
        callbacks such as <code className="text-gray-300">forEach</code> can&apos;t wait, so write a <code className="text-gray-300">for…of</code> loop. The light on the
        bot&apos;s mast is green while it works, amber on pause and red after an error.
      </p>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Files &amp; windows</h3>
        <ul className="space-y-1 text-gray-400 leading-relaxed list-disc pl-4">
          <li>
            A window is a file. <span className="text-gray-200">Run</span> (or <code className="text-gray-300">Ctrl+Enter</code> in the editor) starts that one
            and ends whatever ran before.
          </li>
          <li>
            The <span className="text-gray-200">top-level functions</span> of the other files can be called from it:{" "}
            <code className="text-gray-300">function f() {"{…}"}</code>, <code className="text-gray-300">const f = (…) =&gt; …</code> or{" "}
            <code className="text-gray-300">const f = function …</code>. Nothing else in those files runs.
          </li>
          <li>Two functions with one name: the running file&apos;s wins, then the file higher up in the Files list.</li>
          <li>
            <span className="text-gray-200">Pause</span> holds the program and the farm, so nothing grows meanwhile.
          </li>
          <li>Drag a window by its title, size it from the lower right corner. Closed files are waiting under Files.</li>
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
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Hedge labyrinths 🧩</h3>
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
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">The dinosaur 🦕</h3>
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
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Bot crew 🏭</h3>
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
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Contracts 📜</h3>
        <dl className="space-y-1">
          {CONTRACTS.map(([name, desc]) => (
            <div key={name} className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-2">
              <dt className="text-gray-200">{name}</dt>
              <dd className="text-gray-400">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Arena ⚔️</h3>
        <dl className="space-y-1">
          {ARENA.map(([name, desc]) => (
            <div key={name} className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-2">
              <dt className="text-gray-200">{name}</dt>
              <dd className="text-gray-400">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Weather 🌦</h3>
        <dl className="space-y-1">
          {WEATHER.map(([name, desc]) => (
            <div key={name} className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-2">
              <dt className="text-gray-200">{name}</dt>
              <dd className="text-gray-400">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">What grows and how</h3>
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
