// Online window: the body of the daily maze race section (v5 phase 3). Shows one
// dailyView() (onlineDaily.js) and my last local run; OnlinePanel does the work.
import { dailyFailText } from "./dailyRace.js";
import { TEAL } from "./farmerUi.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const btn = "px-3 py-1 rounded text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100";

function Row({ r }) {
  return (
    <tr className={r.mine ? "bg-lime-100 font-semibold text-lime-900" : "odd:bg-white even:bg-stone-50 text-stone-700"}>
      <td className="px-1 py-0.5 font-mono w-8">{r.rank}</td>
      <td className="truncate max-w-0 w-full">
        {r.name}
        {r.mine ? " (you)" : ""}
      </td>
      <td className="px-1 text-right font-mono whitespace-nowrap">
        {fmt(r.ticks)} / {fmt(r.ops)}
      </td>
    </tr>
  );
}

function Board({ view }) {
  if (!view.rows.length) return <p className="text-center text-stone-400 text-xs py-2">No one has raced today. Be the first!</p>;
  return (
    <table className="w-full text-[11px] tabular-nums">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-stone-400">
          <th className="text-left font-semibold py-0.5">#</th>
          <th className="text-left font-semibold">Name</th>
          <th className="text-right font-semibold">Ticks / ops</th>
        </tr>
      </thead>
      <tbody>
        {view.rows.map((r) => (
          <Row key={r.playerId} r={r} />
        ))}
        {view.outside && (
          <>
            <tr>
              <td colSpan={3} className="text-center text-stone-400 leading-none">
                …
              </td>
            </tr>
            <Row r={view.outside} />
          </>
        )}
      </tbody>
    </table>
  );
}

/**
 * Props: view (dailyView(); null: loading, false: the server has no daily race),
 * run ({ date, fileName, solved, ticks, ops, … }: my last local run, or null),
 * msg ({ ok, text } or null), busy ("run" | "submit" | null), canRun, canSubmit,
 * submitHint, fileName, onRun, onSubmit, onPractice(seed).
 */
export default function DailyRace({ view, run, msg, busy, canRun, canSubmit, submitHint, fileName, onRun, onSubmit, onPractice }) {
  if (view === null) return <p className="text-center text-stone-400 text-xs py-2">Loading…</p>;
  if (!view) return <p className="text-center text-stone-400 text-xs py-2">This server has no daily race.</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-stone-400">สนามวันนี้</div>
          <div className="font-bold font-mono tabular-nums">{view.date}</div>
          <div className="text-[11px] text-stone-500">
            seed <span className="font-mono">{view.seed}</span>{" "}
            <button onClick={() => onPractice(view.seed)} className="underline hover:text-stone-800" title="Put this seed in the Almanac's replay-seed box, to rehearse the maze on your own farm">
              ฝึกซ้อม
            </button>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-stone-400">My best today</div>
          {view.mine ? (
            <>
              <div className="font-mono font-bold tabular-nums">
                {fmt(view.mine.ticks)} / {fmt(view.mine.ops)}
              </div>
              <div className="text-[11px] text-stone-500">rank {view.mine.rank}</div>
            </>
          ) : (
            <div className="font-mono text-stone-400">—</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button onClick={onRun} disabled={!canRun} className={btn} style={{ background: TEAL }} title="Run your program on today's course. Your farm is not touched">
          {busy === "run" ? "Running…" : "วิ่งสนามวันนี้"}
        </button>
        <button onClick={onSubmit} disabled={!canSubmit} className={btn} style={{ background: "#b83a5e" }} title={submitHint}>
          {busy === "submit" ? "…" : "ส่งผล"}
        </button>
        <span className="min-w-0 truncate text-[11px] text-stone-400">{fileName}</span>
      </div>

      {run && (
        <p className={`text-xs break-words ${run.solved ? "text-stone-700" : "text-red-600"}`} aria-live="polite">
          {run.solved ? (
            <>
              🏁 {run.fileName}: <span className="font-mono font-bold">{fmt(run.ticks)}</span> ticks · <span className="font-mono font-bold">{fmt(run.ops)}</span> ops
              {run.date !== view.date && <span className="text-stone-400"> (course of {run.date})</span>}
            </>
          ) : (
            `${run.fileName}: ${dailyFailText(run)}`
          )}
        </p>
      )}
      {msg && <p className={`text-xs break-words ${msg.ok ? "text-lime-700" : "text-red-600"}`}>{msg.text}</p>}

      <div className="rounded-lg border border-stone-200 bg-white p-1.5">
        <Board view={view} />
      </div>
      {view.yesterday && (
        <p className="text-[11px] text-stone-600">
          🏆 ผู้ชนะเมื่อวาน ({view.yesterday.date}): <span className="font-semibold">{view.yesterday.name}</span> · <span className="font-mono">{fmt(view.yesterday.ticks)}</span> ticks
        </p>
      )}
      <p className="text-[10px] text-stone-400 leading-relaxed">
        One maze a day for everyone (new at midnight, Bangkok time), {view.size}×{view.size}. It already stands when your program starts, with the bot on (0, 0): no bush or
        fertilizer needed, and the clock runs from the start. Fewest ticks to the treasure, then fewest ops. Only the server&apos;s own run of your program counts.
        ฝึกซ้อม is practice only; the shape is the same on an {view.size}×{view.size} farm when the maze is grown on (0, 0).
      </p>
    </div>
  );
}
