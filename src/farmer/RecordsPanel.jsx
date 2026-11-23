// Records window, the Almanac (v3 phase 1): this run's metrics and the
// save-level contract totals. Personal records only — no server. BRIEF22: the
// replay-seed box, the best maze runs and the best dinosaur harvest are gone.
import { STRIP_REFRESH_MS } from "./statusStrip.js";
import useSampled from "./useSampled.js";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

function Section({ title, children }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">{title}</h3>
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
        <Stat label="ticks" value={fmt(f.ticks)} title="Run clock in ticks (longest bot timeline)" />
        <Stat label="ops" value={fmt(f.ops)} title="Farmer API calls, all bots combined" />
        <Stat label="lines" value={fmt(f.lines)} title="Non-empty lines in the file you ran" />
        <Stat label="chars" value={fmt(f.chars)} title="Characters in the file you ran" />
      </div>
    </Section>
  );
}

// Save-level contract stats (v3 phase 2): one small row.
function ContractStats({ stats }) {
  const done = stats?.completed || 0;
  const bonus = Object.entries(stats?.bonus || {}).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-stone-600" title="Daily contracts delivered and the bonus they paid, in total">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">Contracts 📜</span>
      <span className="font-mono font-bold text-stone-800">{fmt(done)} completed</span>
      {bonus.map(([item, n]) => (
        <span key={item} className="font-mono">
          +{fmt(n)} {item}
        </span>
      ))}
    </div>
  );
}

export default function RecordsPanel({ game, stats }) {
  return (
    <div className="p-3 space-y-4 text-sm text-stone-800">
      <RunStats stats={stats} />
      <ContractStats stats={game.records?.contracts} />
      <p className="text-[10px] text-stone-400 leading-relaxed">Your own records, kept on this device with the farm (and in Save Data).</p>
    </div>
  );
}
