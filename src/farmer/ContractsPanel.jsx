// Contracts window (v3 phase 2): today's three seeded delivery orders — item +
// amount, reward, ticks left, status — with a Deliver button when you have
// the items. The button uses the same code path as deliver_contract(id).
import { ITEM_ICONS } from "./constants.js";
import { isDeliverable, ticksLeft } from "./contracts.js";
import { STRIP_REFRESH_MS } from "./statusStrip.js";
import useSampled from "./useSampled.js";
import { TEAL } from "./farmerUi.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

const STATUS_CHIP = {
  active: "bg-lime-100 text-lime-800",
  done: "bg-sky-100 text-sky-800",
  expired: "bg-stone-200 text-stone-500",
};

function ContractCard({ c, game, onDeliver }) {
  const have = game.items[c.item] || 0;
  const ready = isDeliverable(game, c);
  const active = c.status === "active";
  return (
    <div className={`rounded-lg border bg-white p-2 space-y-1.5 ${active ? "border-stone-200" : "border-stone-200/60 opacity-70"}`}>
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none" aria-hidden="true">
          {ITEM_ICONS[c.item]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono font-bold text-stone-800 tabular-nums truncate">
            {fmt(c.amount)} {c.item}
          </div>
          <div className="text-[11px] text-stone-500 tabular-nums">
            {active ? `have ${fmt(Math.min(have, c.amount))} / ${fmt(c.amount)}` : c.id}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono font-semibold text-stone-800 tabular-nums" title={`Reward: ${fmt(c.reward)} ${c.rewardItem}`}>
            +{fmt(c.reward)} {ITEM_ICONS[c.rewardItem]}
          </div>
          <span className={`inline-block mt-0.5 px-1.5 rounded text-[10px] uppercase tracking-wider font-semibold ${STATUS_CHIP[c.status]}`}>
            {c.status}
          </span>
        </div>
      </div>
      {active && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500">
          <span className="tabular-nums" title="Counts down while your programs run (farm clock, same ticks as get_tick_count)">
            ⏳ {fmt(ticksLeft(game, c))} ticks left
          </span>
          {ready ? (
            <button
              onClick={() => onDeliver(c.id)}
              className="px-2.5 py-1 rounded text-xs font-semibold text-white hover:brightness-110"
              style={{ background: TEAL }}
            >
              Deliver
            </button>
          ) : (
            <span className="text-stone-400">need {fmt(c.amount - Math.min(have, c.amount))} more</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function ContractsPanel({ game, onDeliver }) {
  const day = game.contracts;
  const list = day?.contracts || [];
  // The farm clock and the inventory change every tick while a program runs:
  // sample them like the info strip (no re-render per tick).
  const live = { clock: game.clock || 0 };
  for (const c of list) live[c.item] = game.items[c.item] || 0;
  const sampled = useSampled(live, STRIP_REFRESH_MS);
  const view = { ...game, clock: sampled.clock, items: { ...game.items, ...sampled } };
  delete view.items.clock;
  return (
    <div className="p-3 space-y-3 text-sm text-stone-800">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">Today&apos;s contracts</h3>
        {day && <span className="text-[11px] font-mono text-stone-400">{day.date}</span>}
      </div>
      {list.length ? (
        <div className="space-y-2">
          {list.map((c) => (
            <ContractCard key={c.id} c={c} game={view} onDeliver={onDeliver} />
          ))}
        </div>
      ) : (
        <p className="text-center text-stone-500 text-xs py-6">Preparing today&apos;s contracts…</p>
      )}
      <p className="text-[10px] text-stone-400 leading-relaxed">
        New contracts every day at local midnight, the same for every player with the same unlocks and farm size.
        Deadlines count down only while your programs run. From code: <code>get_contracts()</code> and{" "}
        <code>deliver_contract(id)</code>.
      </p>
    </div>
  );
}
