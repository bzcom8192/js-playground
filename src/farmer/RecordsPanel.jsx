// Records window (v3 phase 1): this run's metrics, the replay-seed input, the
// best maze run per Mazes level with a histogram of your own attempts, and the
// best dinosaur harvest. Personal records only — there is no server.
import { useState } from "react";
import { parseSeed } from "./maze.js";
import { hasRecords, histogram } from "./records.js";
import { STRIP_REFRESH_MS } from "./statusStrip.js";
import useSampled from "./useSampled.js";
import { OLIVE } from "./farmerUi.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const RECENT_SHOWN = 10;

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

function Stat({ label, value, title }) {
  return (
    <div className="flex flex-col items-center px-2 py-1 rounded bg-white border border-stone-200 min-w-0" title={title}>
      <span className="font-mono font-bold tabular-nums text-stone-800 truncate max-w-full">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-stone-400">{label}</span>
    </div>
  );
}

// Current run counters, sampled like the info strip (no re-render per tick).
function RunStats({ stats }) {
  const f = useSampled(
    { ticks: stats.runTicks ?? 0, ops: stats.ops ?? 0, lines: stats.lines ?? 0, chars: stats.chars ?? 0, running: !!stats.running },
    STRIP_REFRESH_MS,
  );
  return (
    <Section title={f.running ? "This run" : "Last run"}>
      <div className="grid grid-cols-4 gap-1.5 text-xs">
        <Stat label="ticks" value={fmt(f.ticks)} title="Run clock in ticks (longest drone timeline)" />
        <Stat label="ops" value={fmt(f.ops)} title="Farmer API calls, all drones combined" />
        <Stat label="lines" value={fmt(f.lines)} title="Non-empty lines in the file you ran" />
        <Stat label="chars" value={fmt(f.chars)} title="Characters in the file you ran" />
      </div>
    </Section>
  );
}

function SeedInput({ pending, onSetSeed }) {
  const [draft, setDraft] = useState("");
  const seed = parseSeed(draft);
  const submit = (e) => {
    e.preventDefault();
    if (seed === null) return;
    onSetSeed(seed);
    setDraft("");
  };
  return (
    <Section title="Replay seed">
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="numeric"
          placeholder="e.g. 123456789"
          aria-label="Maze seed to replay"
          className={`flex-1 min-w-0 px-2 py-1 rounded border bg-white font-mono text-xs text-stone-800 ${
            draft && seed === null ? "border-red-400" : "border-stone-300"
          }`}
        />
        <button
          type="submit"
          disabled={seed === null}
          className="px-2.5 py-1 rounded text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
          style={{ background: OLIVE }}
        >
          Use next
        </button>
      </form>
      {pending !== null ? (
        <p className="text-[11px] text-stone-600 flex items-center gap-1.5">
          Next maze uses seed <span className="font-mono font-semibold">{pending}</span>
          <button onClick={() => onSetSeed(null)} className="text-stone-400 hover:text-red-600" title="Back to a random seed">
            ✕
          </button>
        </p>
      ) : (
        <p className="text-[11px] text-stone-400">
          Same seed + farm size + start tile → the same maze. Seeds are printed in the Output log.
        </p>
      )}
    </Section>
  );
}

function Histogram({ attempts, best }) {
  const buckets = histogram(attempts.map((a) => a.ticks));
  if (!buckets.length) return null;
  const max = Math.max(...buckets.map((b) => b.count));
  return (
    <div>
      <div className="flex items-end gap-0.5 h-12 border-b border-stone-300" role="img" aria-label="Attempts by ticks">
        {buckets.map((b) => {
          const hasBest = best && best.ticks >= b.from && best.ticks <= b.to;
          return (
            <div
              key={b.from}
              className="flex-1 rounded-t-sm"
              style={{ height: b.count ? `${Math.max(6, (b.count / max) * 100)}%` : 0, background: hasBest ? OLIVE : "#a8a29e" }}
              title={`${fmt(b.from)}${b.to !== b.from ? `–${fmt(b.to)}` : ""} ticks: ${b.count} attempt${b.count === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] font-mono text-stone-400 mt-0.5">
        <span>{fmt(buckets[0].from)}</span>
        <span>ticks</span>
        <span>{fmt(buckets[buckets.length - 1].to)}</span>
      </div>
    </div>
  );
}

function SeedButton({ seed, onSetSeed }) {
  return (
    <button
      onClick={() => onSetSeed(seed)}
      className="font-mono text-stone-700 hover:text-[#6f9419] underline decoration-dotted"
      title="Replay: the next maze uses this seed"
    >
      {seed}
    </button>
  );
}

function MazeLevel({ level, entry, onSetSeed }) {
  const [more, setMore] = useState(false);
  const { best, attempts } = entry;
  const recent = attempts.slice(-RECENT_SHOWN).reverse();
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-2 space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-stone-800">🧩 Mazes level {level}</span>
        <span className="text-stone-400">
          {attempts.length} attempt{attempts.length === 1 ? "" : "s"}
        </span>
      </div>
      {best && (
        <div className="text-xs text-stone-600 flex flex-wrap gap-x-2 gap-y-0.5">
          <span className="font-mono font-bold text-stone-800">🏆 {fmt(best.ticks)} ticks</span>
          <span className="font-mono">{fmt(best.ops)} ops</span>
          <span>
            seed <SeedButton seed={best.seed} onSetSeed={onSetSeed} />
          </span>
          <span className="text-stone-400">
            {best.size}×{best.size} from ({best.sx}, {best.sy})
          </span>
        </div>
      )}
      <Histogram attempts={attempts} best={best} />
      {attempts.length > 0 && (
        <button onClick={() => setMore((m) => !m)} className="text-[11px] text-stone-500 hover:text-stone-800">
          {more ? "▾ Hide recent attempts" : "▸ Recent attempts"}
        </button>
      )}
      {more && (
        <ul className="text-[11px] font-mono text-stone-600 space-y-0.5">
          {recent.map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex gap-2">
              <span className="w-20 text-right tabular-nums">{fmt(a.ticks)} t</span>
              <span className="w-16 text-right tabular-nums">{fmt(a.ops)} ops</span>
              <SeedButton seed={a.seed} onSetSeed={onSetSeed} />
            </li>
          ))}
          {attempts.length > RECENT_SHOWN && (
            <li className="text-stone-400 font-sans">…and {attempts.length - RECENT_SHOWN} older (in the histogram)</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function RecordsPanel({ game, stats, onSetSeed }) {
  const recs = game.records;
  const levels = Object.keys(recs?.mazes || {})
    .map(Number)
    .sort((a, b) => a - b);
  return (
    <div className="p-3 space-y-4 text-sm text-stone-800">
      <RunStats stats={stats} />
      <SeedInput pending={game.pendingSeed ?? null} onSetSeed={onSetSeed} />
      {!hasRecords(recs) ? (
        <p className="text-center text-stone-500 text-xs py-6">No records yet — solve a maze!</p>
      ) : (
        <>
          {levels.length > 0 && (
            <Section title="Best maze runs">
              <div className="space-y-2">
                {levels.map((l) => (
                  <MazeLevel key={l} level={l} entry={recs.mazes[String(l)]} onSetSeed={onSetSeed} />
                ))}
              </div>
            </Section>
          )}
          <Section title="Best dinosaur harvest">
            {recs.dino ? (
              <div className="rounded-lg border border-stone-200 bg-white p-2 text-xs text-stone-600 flex flex-wrap gap-x-2">
                <span className="font-mono font-bold text-stone-800">🦴 {fmt(recs.dino.bone)} Bone</span>
                <span>{recs.dino.cut} segments cut</span>
                <span className="text-stone-400">Dinosaurs level {recs.dino.level}</span>
              </div>
            ) : (
              <p className="text-[11px] text-stone-400">No dinosaur harvest yet.</p>
            )}
          </Section>
        </>
      )}
      <p className="text-[10px] text-stone-400 leading-relaxed">
        Personal records on this device only (saved with your farm and in Save Data). Best = fewest ticks, then fewest ops.
      </p>
    </div>
  );
}
