// v5: what the Online window's "ประวัติ" section shows for one event of
// GET /api/players/me/history. Pure (no React, no DOM), so it is testable.
import { GOALS, TICK_CAP } from "./arena.js";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
export const signed = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "±0");

/** label (Thai) + tone of an outcome. */
export const HISTORY_OUTCOMES = Object.freeze({
  win: Object.freeze({ label: "ชนะ", tone: "good" }),
  lose: Object.freeze({ label: "แพ้", tone: "bad" }),
  draw: Object.freeze({ label: "เสมอ", tone: "even" }),
  expired: Object.freeze({ label: "หมดอายุ", tone: "muted" }),
});

/** "40,000t", "DNF" (did not reach the goal), "—" (nobody ran). */
export const ticksText = (ticks) => (!Number.isInteger(ticks) ? "—" : ticks > TICK_CAP ? "DNF" : `${fmt(ticks)}t`);

/** Local "YYYY-MM-DD HH:MM", or "" for a missing / broken time. */
export function timeText(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** One event → the row's texts, or null for an event this client can't show. */
export function historyRow(ev) {
  const o = Object.hasOwn(HISTORY_OUTCOMES, ev?.outcome ?? "") ? HISTORY_OUTCOMES[ev.outcome] : null;
  if (!o || !Number.isInteger(ev.challengeId)) return null;
  const expired = ev.outcome === "expired";
  return {
    key: ev.challengeId,
    outcome: ev.outcome,
    label: o.label,
    tone: o.tone,
    authored: ev.role === "author",
    opponent: expired ? null : String(ev.opponentName ?? "?"),
    goal: GOALS[ev.goal]?.label ?? String(ev.goal),
    ticks: expired ? ticksText(ev.myTicks) : `${ticksText(ev.myTicks)} / ${ticksText(ev.opponentTicks)}`,
    elo: expired ? "—" : signed(ev.eloDelta),
    eloTone: expired || !ev.eloDelta ? "even" : ev.eloDelta > 0 ? "good" : "bad",
    when: timeText(ev.closedAt),
    created: timeText(ev.createdAt),
  };
}

/** The whole answer → rows (bad events are skipped; a bad answer is empty). */
export const historyRows = (data) => (Array.isArray(data?.events) ? data.events.map(historyRow).filter(Boolean) : []);
