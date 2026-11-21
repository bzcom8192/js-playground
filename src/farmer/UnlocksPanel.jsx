import { ITEM_ICONS, UNLOCKS } from "./constants.js";
import * as W from "./world.js";

function CostChips({ cost, items }) {
  return (
    <span className="flex flex-wrap gap-1">
      {Object.entries(cost).map(([item, amt]) => (
        <span
          key={item}
          className={`px-1.5 py-0.5 rounded text-[11px] font-mono border ${
            (items[item] || 0) >= amt
              ? "border-stone-300 text-stone-700 bg-stone-100"
              : "border-red-300 text-red-700 bg-red-50"
          }`}
          title={`${amt} ${item} (you have ${items[item] || 0})`}
        >
          {ITEM_ICONS[item]} {amt.toLocaleString("en-US")}
        </span>
      ))}
    </span>
  );
}

function Pips({ level, max }) {
  if (max <= 1) return null;
  return (
    <span className="flex items-center gap-0.5" title={`Level ${level} / ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < level ? "bg-[#6f9419]" : "bg-stone-300"}`} />
      ))}
    </span>
  );
}

export default function UnlocksPanel({ game, onBuy }) {
  return (
    <div className="p-2 space-y-1.5">
      {UNLOCKS.map((u) => {
        const level = W.level(game, u.id);
        const status = W.unlockStatus(game, u.id);
        const blocked = status === "blocked";
        return (
          <div
            key={u.id}
            className={`flex items-center gap-3 p-2 rounded-md border ${
              blocked ? "border-stone-200 opacity-50" : "border-stone-200 bg-white shadow-sm"
            }`}
          >
            <span className="text-xl w-7 text-center shrink-0">{u.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-stone-800">{u.name}</span>
                <Pips level={level} max={u.maxLevel} />
                {u.maxLevel === 1 && level === 1 && <span className="text-[11px] text-[#5b7a12] font-bold">✓</span>}
              </div>
              <div className="text-[11px] text-stone-500 leading-snug">{u.desc}</div>
              {status !== "maxed" && (
                <div className="mt-1">
                  {blocked ? (
                    <span className="text-[11px] text-stone-500">🔒 Requires {u.requires}</span>
                  ) : (
                    <CostChips cost={u.cost(level)} items={game.items} />
                  )}
                </div>
              )}
            </div>
            {status === "maxed" ? (
              <span className="text-[11px] text-stone-400 shrink-0">Maxed</span>
            ) : (
              <button
                onClick={() => onBuy(u.id)}
                disabled={status !== "affordable"}
                className="shrink-0 px-3 py-1 text-xs font-semibold rounded bg-[#6f9419] text-white hover:brightness-110 disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed transition-colors"
              >
                {level === 0 ? "Unlock" : "Upgrade"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
