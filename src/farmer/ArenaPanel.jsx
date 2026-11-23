// Arena window (v3 phase 3): race one of your files against a built-in rival on
// two identical fresh 8×8 farms, headless and deterministic (see arena.js),
// then update your ELO rating. Pick a file, an opponent and a goal, press
// Run Match; the result, the rating change and the last 20 matches follow.
import { useRef, useState } from "react";
import { BOTS, BOT_IDS, GOALS, GOAL_IDS, TICK_CAP, deltaText, eloDelta } from "./arena.js";
import { playMatch } from "./arenaClient.js";
import { ITEM_ICONS } from "./constants.js";
import { parseSeed } from "./rng.js";
import { buildProgram } from "./program.js";
import { TEAL } from "./farmerUi.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

const RESULT_CHIP = {
  win: "bg-lime-100 text-lime-800",
  draw: "bg-stone-200 text-stone-600",
  loss: "bg-red-100 text-red-700",
};
const RESULT_LABEL = { win: "Win", draw: "Draw", loss: "Loss" };

function Section({ title, children, right }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Select({ label, value, onChange, disabled, children }) {
  return (
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-stone-400">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="px-1.5 py-1 rounded border border-stone-300 bg-white text-xs text-stone-800 min-w-0 disabled:opacity-60"
      >
        {children}
      </select>
    </label>
  );
}

function Progress({ p, goal, botName }) {
  const pct = (v) => `${Math.min(100, (v / goal.amount) * 100)}%`;
  const bar = (label, v, color) => (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-12 shrink-0 text-stone-500 truncate">{label}</span>
      <div className="flex-1 h-2 rounded bg-stone-200 overflow-hidden">
        <div className="h-full rounded" style={{ width: pct(v), background: color }} />
      </div>
      <span className="w-20 shrink-0 text-right font-mono tabular-nums text-stone-700">
        {fmt(v)} {ITEM_ICONS[goal.item]}
      </span>
    </div>
  );
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-2 space-y-1.5" aria-live="polite">
      <div className="flex justify-between text-[11px] text-stone-500">
        <span className="font-semibold">Racing…</span>
        <span className="font-mono tabular-nums">
          {fmt(p.ticks)} / {fmt(p.cap)} ticks
        </span>
      </div>
      {bar("You", p.you, TEAL)}
      {bar(botName, p.bot, "#b83a5e")}
    </div>
  );
}

function ResultCard({ r, onRematch, disabled }) {
  const goal = GOALS[r.goal];
  const bot = BOTS[r.bot];
  const title = r.result === "win" ? "🏆 You win!" : r.result === "loss" ? `${bot.name} wins` : "Draw";
  const amount = (label, side) => (
    <div className="flex flex-col items-center px-2 py-1 rounded bg-stone-50 border border-stone-200 min-w-0">
      <span className="font-mono font-bold tabular-nums text-stone-800">
        {fmt(side.amount)} {ITEM_ICONS[goal.item]}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-stone-400 truncate max-w-full">
        {label}
        {side.drones > 1 ? ` · ${side.drones} bots` : ""}
      </span>
    </div>
  );
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-stone-800">{title}</span>
        {r.recorded ? (
          <span
            className={`font-mono font-bold tabular-nums ${r.delta > 0 ? "text-lime-700" : r.delta < 0 ? "text-red-600" : "text-stone-500"}`}
            title="Rating change (ELO, K = 32)"
          >
            {deltaText(r.delta)} → {fmt(r.rating)}
          </span>
        ) : (
          <span className="text-[11px] text-stone-400">not rated</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {amount("You", r.sides.you)}
        {amount(bot.name, r.sides.bot)}
      </div>
      <p className="text-[11px] text-stone-600 break-words">{r.text}</p>
      <div className="flex items-center justify-between text-[10px] text-stone-400">
        <span className="font-mono">
          {goal.label} · {fmt(r.ticks)} ticks · seed {r.seed}
        </span>
        <button onClick={onRematch} disabled={disabled} className="text-stone-500 hover:text-stone-800 disabled:opacity-40" title="Same seed, same opponent and goal">
          ↻ Rematch
        </button>
      </div>
    </div>
  );
}

function History({ matches }) {
  if (!matches.length) return <p className="text-center text-stone-400 text-xs py-3">No matches yet.</p>;
  return (
    <ol className="space-y-1">
      {[...matches].reverse().map((m, i) => (
        <li key={`${m.at}-${i}`} className="flex items-center gap-2 text-[11px] rounded bg-white border border-stone-200 px-2 py-1">
          <span className={`w-11 text-center rounded px-1 font-semibold uppercase text-[10px] ${RESULT_CHIP[m.result]}`}>{RESULT_LABEL[m.result]}</span>
          <span className="flex-1 min-w-0 truncate text-stone-700">
            vs {BOTS[m.bot]?.name ?? m.bot} · {GOALS[m.goal]?.label ?? m.goal}
          </span>
          <span className="font-mono tabular-nums text-stone-500">{fmt(m.ticks)}t</span>
          <span className={`w-9 text-right font-mono tabular-nums font-semibold ${m.delta > 0 ? "text-lime-700" : m.delta < 0 ? "text-red-600" : "text-stone-400"}`}>
            {deltaText(m.delta)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function ArenaPanel({ game, files, activeId, demo, onRecord, onExitDemo }) {
  const [fileId, setFileId] = useState(activeId);
  const [botId, setBotId] = useState("pro");
  const [goalId, setGoalId] = useState("hay500");
  const [seedText, setSeedText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const busy = useRef(false);

  const arena = game.arena || { rating: 1000, matches: [] };
  const file = files.find((f) => f.id === Number(fileId)) || files.find((f) => f.id === activeId) || files[0];
  const bot = BOTS[botId];
  const goal = GOALS[goalId];
  const seed = parseSeed(seedText);
  const seedBad = seedText.trim() !== "" && seed === null;

  // again: { seed, bot, goal } of a past result (Rematch), else the form.
  const start = async (again = null) => {
    if (busy.current || demo) return;
    const useBot = again?.bot ?? botId;
    const useGoal = again?.goal ?? goalId;
    if (again) {
      setBotId(useBot);
      setGoalId(useGoal);
    }
    let prog;
    try {
      prog = buildProgram(files, file.id);
    } catch (err) {
      setError(String(err.message || err));
      return;
    }
    busy.current = true;
    setRunning(true);
    setError(null);
    setResult(null);
    const tag = { goalId: useGoal, botId: useBot };
    setProgress({ ticks: 0, you: 0, bot: 0, cap: TICK_CAP, ...tag });
    try {
      const m = await playMatch({
        code: prog.code,
        segments: prog.segments,
        bot: useBot,
        goal: useGoal,
        seed: again?.seed ?? seed ?? undefined,
        onProgress: (p) => setProgress({ ...p, ...tag }),
      });
      const rec = onRecord({ ...m, file: file.name });
      setResult({ ...m, recorded: !!rec?.recorded, delta: rec?.delta ?? 0, rating: rec?.rating ?? arena.rating });
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      busy.current = false;
      setRunning(false);
      setProgress(null);
    }
  };

  if (demo) {
    return (
      <div className="p-4 space-y-3 text-sm text-stone-700">
        <p className="font-semibold">No races on the demo farm.</p>
        <p className="text-xs text-stone-500 leading-relaxed">
          Matches change your rating, and the rating lives in your own save, which the demo never writes. Go back to your farm to play rated matches.
        </p>
        <button onClick={onExitDemo} className="px-3 py-1.5 rounded text-xs font-semibold text-white hover:brightness-110" style={{ background: TEAL }}>
          Back to my farm
        </button>
      </div>
    );
  }

  const preview = (d) => `${d > 0 ? "+" : ""}${d}`;

  return (
    <div className="p-3 space-y-4 text-sm text-stone-800">
      <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400">Your rating</div>
          <div className="font-mono font-black text-2xl tabular-nums leading-tight">{fmt(arena.rating)}</div>
        </div>
        <div className="text-right text-[11px] text-stone-500">
          <div>
            vs {bot.name} ({bot.rating})
          </div>
          <div className="font-mono tabular-nums" title="Rating change for a win / draw / loss against this rival">
            W {preview(eloDelta(arena.rating, bot.rating, "win"))} · D {preview(eloDelta(arena.rating, bot.rating, "draw"))} · L{" "}
            {preview(eloDelta(arena.rating, bot.rating, "loss"))}
          </div>
        </div>
      </div>

      <Section title="New race">
        <div className="grid grid-cols-3 gap-1.5">
          <Select label="Your file" value={String(file.id)} onChange={setFileId} disabled={running}>
            {files.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.name}
              </option>
            ))}
          </Select>
          <Select label="Rival" value={botId} onChange={setBotId} disabled={running}>
            {BOT_IDS.map((id) => (
              <option key={id} value={id}>
                {BOTS[id].name} ({BOTS[id].rating})
              </option>
            ))}
          </Select>
          <Select label="Goal" value={goalId} onChange={setGoalId} disabled={running}>
            {GOAL_IDS.map((id) => (
              <option key={id} value={id}>
                {GOALS[id].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            disabled={running}
            inputMode="numeric"
            placeholder="seed (blank = random)"
            aria-label="Match seed"
            className={`flex-1 min-w-0 px-2 py-1 rounded border bg-white font-mono text-xs text-stone-800 ${seedBad ? "border-red-400" : "border-stone-300"}`}
          />
          <button
            onClick={() => start()}
            disabled={running || seedBad}
            className="px-3 py-1 rounded text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
            style={{ background: TEAL }}
          >
            {running ? "Running…" : "Start race"}
          </button>
        </div>
        <p className="text-[10px] text-stone-400 leading-relaxed">
          {bot.desc} Both farms are fresh 8×8 fields from the same seed with the arena unlocks (everything up to Megafarm; Speed 0; no
          Rice). First to hold {goal.label} wins; after {fmt(TICK_CAP)} ticks the bigger amount wins. An error loses. Your file runs with its
          helper files, as with Run. <code>get_arena_goal()</code> tells your program the goal.
        </p>
        <details className="text-[11px] text-stone-500">
          <summary className="cursor-pointer select-none">{bot.name}&apos;s code</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-stone-900 text-stone-100 p-2 text-[10px] leading-snug">{bot.code}</pre>
        </details>
      </Section>

      {progress && <Progress p={progress} goal={GOALS[progress.goalId] || goal} botName={BOTS[progress.botId]?.name || bot.name} />}
      {error && <p className="text-xs text-red-600 break-words">{error}</p>}
      {result && <ResultCard r={result} disabled={running} onRematch={() => start({ seed: result.seed, bot: result.bot, goal: result.goal })} />}

      <Section title={`History (last ${arena.matches.length || 0})`}>
        <History matches={arena.matches} />
      </Section>
    </div>
  );
}
