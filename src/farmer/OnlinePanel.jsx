// Online window (v4 phase 1): identity and the friend arena, against the Node
// server in server/ (same-origin /api; see onlineApi.js). Offline-first: if the
// API does not answer, the window says so ("เซิร์ฟเวอร์ไม่ตอบสนอง") and nothing
// else in the game changes. The demo farm can look but not register or race.
// v4 phase 2: friend challenges are replay-verified by the server (✓).
// v5: identity export / import (its own file, not Save Data), challenges
// expire after 7 days, and a match history (ประวัติ) with the ELO changes.
// BRIEF22: the maze / dino leaderboard and the daily maze race are gone.
import { useCallback, useEffect, useRef, useState } from "react";
import { GOALS, GOAL_IDS, TICK_CAP } from "./arena.js";
import { playSolo } from "./arenaClient.js";
import { ITEM_ICONS } from "./constants.js";
import { randomSeed } from "./maze.js";
import { buildProgram } from "./program.js";
import { TEAL } from "./farmerUi.jsx";
import { CODE_MAX, NAME_MAX } from "./onlineRules.js";
import {
  IDENTITY_FILE_MAX,
  OFFLINE_MESSAGE,
  buildIdentityExport,
  clearIdentity,
  identityFileName,
  loadIdentity,
  onlineApi,
  saveIdentity,
  verifyIdentityImport,
} from "./onlineApi.js";
import { historyRows, signed, timeText } from "./onlineHistory.js";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

const OUTCOME = {
  win: { title: "🏆 You win!", cls: "text-lime-700" },
  loss: { title: "You lose", cls: "text-red-600" },
  draw: { title: "Draw", cls: "text-stone-600" },
};

function Section({ title, right, children }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

const VERIFIED_TITLE = "Verified: the server replayed this program and measured the run itself";

const btn = "px-3 py-1 rounded text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100";

const smallBtn = "px-2 py-0.5 rounded text-[11px] font-semibold border border-stone-300 bg-white text-stone-600 hover:border-stone-500 disabled:opacity-50 disabled:hover:border-stone-300";
const TONE = { good: "text-lime-700", bad: "text-red-600", even: "text-stone-500", muted: "text-stone-400" };

function History({ rows }) {
  if (rows === null) return <p className="text-center text-stone-400 text-xs py-2">Loading…</p>;
  if (!rows) return <p className="text-center text-stone-400 text-xs py-2">The history could not be loaded.</p>;
  if (!rows.length) return <p className="text-center text-stone-400 text-xs py-2">No finished challenges yet.</p>;
  return (
    <ul className="space-y-0.5">
      {rows.map((r) => (
        <li key={r.key} className="px-1.5 py-1 rounded text-[11px] odd:bg-white even:bg-stone-50" title={`Challenge #${r.key} · created ${r.created} · ended ${r.when}`}>
          <div className="flex items-center gap-2">
            <span className={`w-14 shrink-0 font-bold ${TONE[r.tone]}`}>{r.label}</span>
            <span className="flex-1 min-w-0 truncate text-stone-700">
              {r.opponent === null ? <span className="text-stone-400">no one answered</span> : <span className="font-semibold">{r.opponent}</span>}
              <span className="text-stone-400"> · {r.goal}</span>
            </span>
            <span className={`shrink-0 font-mono font-bold tabular-nums ${TONE[r.eloTone]}`} title="ELO change">
              {r.elo}
            </span>
          </div>
          <div className="flex justify-between gap-2 text-[10px] text-stone-400 font-mono tabular-nums">
            <span className="truncate" title="Your ticks / the opponent's ticks (measured by the server)">
              {r.authored ? "posted" : "answered"} · {r.ticks}
            </span>
            <span className="shrink-0">{r.when}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SoloProgress({ p, goal }) {
  const pct = Math.min(100, ((p.you || 0) / goal.amount) * 100);
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-2 space-y-1" aria-live="polite">
      <div className="flex justify-between text-[11px] text-stone-500">
        <span className="font-semibold">{p.label}</span>
        <span className="font-mono tabular-nums">
          {fmt(p.ticks)} / {fmt(p.cap || TICK_CAP)} ticks
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <div className="flex-1 h-2 rounded bg-stone-200 overflow-hidden">
          <div className="h-full rounded" style={{ width: `${pct}%`, background: TEAL }} />
        </div>
        <span className="w-20 shrink-0 text-right font-mono text-stone-700">
          {fmt(p.you)} {ITEM_ICONS[goal.item]}
        </span>
      </div>
    </div>
  );
}

function AnswerCard({ r }) {
  const o = OUTCOME[r.result] || OUTCOME.draw;
  const goal = GOALS[r.goal];
  const t = (ticks) => (ticks > TICK_CAP ? "did not finish" : `${fmt(ticks)} ticks`);
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-2 space-y-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-bold ${o.cls}`}>
          {o.title} <span className="font-normal text-stone-500">vs {r.author.name}</span>
        </span>
        <span className={`font-mono font-bold tabular-nums ${r.you.delta > 0 ? "text-lime-700" : r.you.delta < 0 ? "text-red-600" : "text-stone-500"}`} title="ELO change (K = 32)">
          {signed(r.you.delta)} → {fmt(r.you.elo)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="rounded bg-stone-50 border border-stone-200 px-2 py-1">
          <div className="text-[10px] uppercase tracking-wider text-stone-400">You</div>
          <div className="font-mono">
            {t(r.you.ticks)} · {fmt(r.you.ops)} ops
          </div>
        </div>
        <div className="rounded bg-stone-50 border border-stone-200 px-2 py-1">
          <div className="text-[10px] uppercase tracking-wider text-stone-400 truncate">{r.author.name}</div>
          <div className="font-mono">
            {t(r.author.ticks)} · {fmt(r.author.ops)} ops
          </div>
        </div>
      </div>
      <p className="text-[10px] text-stone-400 font-mono">
        {goal?.label} · seed {r.seed} · {r.author.name} {signed(r.author.delta)} → {fmt(r.author.elo)}
      </p>
      {r.verified && (
        <p className="text-[10px] text-lime-700" title={VERIFIED_TITLE}>
          ✓ verified — both runs were replayed and measured by the server
        </p>
      )}
      {r.authorCode && (
        <details className="text-[11px] text-stone-500">
          <summary className="cursor-pointer select-none">{r.author.name}&apos;s code</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-stone-900 text-stone-100 p-2 text-[10px] leading-snug">{r.authorCode}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * Props: files, activeId (the main program = the active file, run with its
 * helper files like ▶), demo, pushLog(kind, text), onExitDemo().
 */
export default function OnlinePanel({ files, activeId, demo, pushLog = () => {}, onExitDemo, api = onlineApi }) {
  const [identity, setIdentity] = useState(() => loadIdentity());
  const [profile, setProfile] = useState(null);
  const [badIdentity, setBadIdentity] = useState(false);
  const [offline, setOffline] = useState(false);
  const [challenges, setChallenges] = useState(null);
  const [history, setHistory] = useState(null); // null: loading, false: not available, else rows
  const [nameText, setNameText] = useState("");
  const [busy, setBusy] = useState(null); // "register" | "import" | "create" | `accept:<id>`
  const [idMsg, setIdMsg] = useState(null); // { ok, text }: the outcome of an export / import
  const [progress, setProgress] = useState(null);
  const [goalId, setGoalId] = useState("hay500");
  const [answer, setAnswer] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [reloadSeq, setReloadSeq] = useState(0);
  const busyRef = useRef(false);
  const importRef = useRef(null);

  const file = files.find((f) => f.id === activeId) || files[0];
  const token = identity?.token;

  // Network error → offline banner; API error → message.
  const handle = useCallback((err) => {
    if (err?.offline) setOffline(true);
    else setError(String(err?.message || err));
  }, []);

  // Load everything the window shows (on open, Retry, after a change).
  // All state updates happen after the awaits (never synchronously in the effect).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, me, hist] = await Promise.all([
          api.listChallenges(),
          token
            ? api.me(token).catch((err) => {
                if (err?.status === 401) return null; // unknown token (e.g. the server's DB was reset)
                throw err;
              })
            : Promise.resolve(undefined),
          token
            ? api.history(token).then(historyRows, (err) => {
                if (err?.offline) throw err;
                return false; // unknown token, or a server without the endpoint: the rest still works
              })
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        setOffline(false);
        setChallenges(list.challenges || []);
        setHistory(hist);
        if (me !== undefined) {
          setProfile(me);
          setBadIdentity(me === null);
        }
      } catch (err) {
        if (alive) handle(err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, token, reloadSeq, handle]);

  const reload = () => {
    setError(null);
    setReloadSeq((n) => n + 1);
  };

  const run = async (kind, fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError(null);
    setNotice(null);
    setIdMsg(null);
    try {
      await fn();
    } catch (err) {
      handle(err);
    } finally {
      busyRef.current = false;
      setBusy(null);
      setProgress(null);
    }
  };

  // Switch this window to an identity the server just confirmed.
  const adopt = (id, me) => {
    setIdentity(id);
    setProfile(me);
    setBadIdentity(false);
    setHistory(null);
    setAnswer(null);
    setNameText("");
    setReloadSeq((n) => n + 1);
  };

  const register = () =>
    run("register", async () => {
      if (demo) return;
      const r = await api.register(nameText);
      const id = { playerId: r.playerId, name: r.name, token: r.token };
      saveIdentity(id);
      adopt(id, { playerId: r.playerId, name: r.name, elo: r.elo });
      pushLog("info", `🌐 Joined online as ${r.name} (ELO ${r.elo})`);
    });

  const forget = () => {
    if (!confirm(`Forget the online identity “${identity?.name}” on this browser? Without an exported copy (ส่งออกบัญชี) it cannot be recovered, and you would need a new name.`)) return;
    clearIdentity();
    setIdentity(null);
    setProfile(null);
    setBadIdentity(false);
    setHistory(null);
    setIdMsg(null);
  };

  // The identity file is a credential: say so before it is written.
  const exportIdentity = () => {
    if (!identity) return;
    if (
      !confirm(
        `ส่งออกบัญชี “${identity.name}”?\n\n⚠ The file contains your secret token. Anyone who has the file can play as you, and the token cannot be changed. Keep it private: don't share or publish it.`,
      )
    )
      return;
    const blob = new Blob([JSON.stringify(buildIdentityExport(identity), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = identityFileName(identity.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setIdMsg({ ok: true, text: "Exported. Keep the file private: whoever has it can play as you." });
  };

  const importIdentity = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!picked || demo) return;
    return run("import", async () => {
      try {
        // Verified by the server first; only then asked about and saved.
        const text = picked.size > IDENTITY_FILE_MAX ? null : await picked.text();
        const { identity: id, profile: me } = await verifyIdentityImport(text, api);
        if (
          identity &&
          identity.token !== id.token &&
          !confirm(
            `Play as “${id.name}” (ELO ${me.elo}) on this browser? This REPLACES the current identity “${identity.name}”. Without an exported copy (ส่งออกบัญชี) that one cannot be recovered.`,
          )
        )
          return;
        if (!saveIdentity(id)) throw new Error("This browser did not let the game store the identity.");
        adopt(id, me);
        setIdMsg({ ok: true, text: `Imported: playing as ${id.name}.` });
        pushLog("info", `🌐 Imported the online identity ${id.name} (ELO ${me.elo})`);
      } catch (err) {
        if (err?.offline) throw err;
        setIdMsg({ ok: false, text: `Import failed: ${err?.message || err}` });
      }
    });
  };

  // The player's main program: the active file with its helper files.
  const program = () => {
    const prog = buildProgram(files, file.id);
    if (!prog.code.trim()) throw new Error(`“${file.name}” is empty — write a program first.`);
    if (prog.code.length > CODE_MAX) throw new Error(`Your program is too long to upload (${fmt(prog.code.length)} > ${fmt(CODE_MAX)} characters).`);
    return prog;
  };

  const create = () =>
    run("create", async () => {
      if (demo || !token) return;
      const prog = program();
      const goal = GOALS[goalId];
      const seed = randomSeed();
      setProgress({ label: `Your run · ${goal.label}`, ticks: 0, you: 0, cap: TICK_CAP, goal: goalId });
      const solo = await playSolo({
        code: prog.code,
        segments: prog.segments,
        goal: goalId,
        seed,
        onProgress: (p) => setProgress({ ...p, label: `Your run · ${goal.label}`, goal: goalId }),
      });
      if (!solo.reached) {
        throw new Error(
          solo.error
            ? `Your program failed: ${solo.error}`
            : `Your program did not reach ${goal.label} within ${fmt(TICK_CAP)} ticks (held ${fmt(solo.amount)}). No challenge was posted.`,
        );
      }
      // The server replays the code and stores ITS ticks / ops (the claim is ignored).
      const c = await api.createChallenge(token, { goal: goalId, seed, code: prog.code, authorTicks: solo.ticks, authorOps: solo.ops });
      const differs = c.authorTicks !== solo.ticks || c.authorOps !== solo.ops;
      setNotice(
        `Challenge #${c.id} posted ✓ verified: ${goal.label} in ${fmt(c.authorTicks)} ticks · ${fmt(c.authorOps)} ops (seed ${seed}).` +
          (differs ? ` The server's replay differs from your run (${fmt(solo.ticks)} ticks · ${fmt(solo.ops)} ops); its numbers count.` : ""),
      );
      pushLog("info", `🌐 Posted a friend challenge: ${goal.label} in ${fmt(c.authorTicks)} ticks, verified (${file.name})`);
      setReloadSeq((n) => n + 1);
    });

  const accept = (c) =>
    run(`accept:${c.id}`, async () => {
      if (demo || !token) return;
      const prog = program();
      setAnswer(null);
      const full = await api.getChallenge(c.id); // still open? (and the author's code for afterwards)
      if (full.status !== "open") {
        setReloadSeq((n) => n + 1);
        throw new Error(full.status === "expired" ? "This challenge has expired (หมดอายุ)." : "Someone answered this challenge first.");
      }
      const goal = GOALS[full.goal];
      if (!goal) throw new Error(`Unknown goal ${full.goal}`);
      const label = `Racing ${full.authorName} · ${goal.label}`;
      setProgress({ label, ticks: 0, you: 0, cap: TICK_CAP, goal: full.goal });
      const solo = await playSolo({
        code: prog.code,
        segments: prog.segments,
        goal: full.goal,
        seed: full.seed,
        onProgress: (p) => setProgress({ ...p, label, goal: full.goal }),
      });
      const r = await api.answerChallenge(token, c.id, { ticks: solo.ticks, ops: solo.ops, code: prog.code }).catch((err) => {
        if (err?.status === 409 || err?.status === 410) setReloadSeq((n) => n + 1); // answered / expired meanwhile: refresh the list
        throw err;
      });
      setAnswer({ ...r, goal: full.goal, seed: full.seed, authorCode: full.code, error: solo.error });
      setProfile((p) => (p ? { ...p, elo: r.you.elo } : p));
      const word = { win: "win", loss: "loss", draw: "draw" }[r.result] || r.result;
      pushLog(
        "info",
        `🌐 Friend arena: ${word} vs ${r.author.name} (${goal.label}, ${r.you.ticks <= TICK_CAP ? `${fmt(r.you.ticks)} ticks` : "did not finish"} vs ${fmt(r.author.ticks)}, verified) — ELO ${signed(r.you.delta)} → ${r.you.elo}`,
      );
      setReloadSeq((n) => n + 1);
    });

  if (offline) {
    return (
      <div className="p-4 space-y-3 text-sm text-stone-700">
        <p className="font-semibold">🌐 {OFFLINE_MESSAGE}</p>
        <p className="text-xs text-stone-500 leading-relaxed">
          The online server could not be reached. Everything else in the game works as before; your records stay on this device.
        </p>
        <button onClick={reload} className={btn} style={{ background: TEAL }}>
          ↻ Retry
        </button>
      </div>
    );
  }

  const locked = demo || !!busy;
  const elo = profile?.elo;

  return (
    <div className="p-3 space-y-4 text-sm text-stone-800">
      {demo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 flex items-center justify-between gap-2">
          <span>Demo farm: you can look around, but joining and racing are off.</span>
          {onExitDemo && (
            <button onClick={onExitDemo} className="shrink-0 font-semibold underline">
              Back to my farm
            </button>
          )}
        </div>
      )}

      <Section title="Identity">
        {identity ? (
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-stone-400">Playing as</div>
              <div className="font-bold truncate">{identity.name}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-stone-400">ELO</div>
              <div className="font-mono font-black text-xl tabular-nums leading-tight">{elo === undefined ? "…" : fmt(elo)}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              value={nameText}
              onChange={(e) => setNameText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && nameText.trim() && !locked && register()}
              disabled={locked}
              maxLength={NAME_MAX}
              placeholder="your name (1–24 characters)"
              aria-label="Online name"
              className="flex-1 min-w-0 px-2 py-1 rounded border border-stone-300 bg-white text-xs text-stone-800 disabled:opacity-60"
            />
            <button onClick={register} disabled={locked || !nameText.trim()} className={btn} style={{ background: TEAL }}>
              {busy === "register" ? "…" : "เข้าร่วม"}
            </button>
          </div>
        )}
        {badIdentity && (
          <p className="text-[11px] text-red-600">
            The server does not know this identity (its data may have been reset).{" "}
            <button onClick={forget} className="underline font-semibold">
              Forget it
            </button>{" "}
            and join again.
          </p>
        )}
        {identity && !badIdentity && (
          <p className="text-[10px] text-stone-400 leading-relaxed">
            Your token is stored on this browser only (not in Save Data);
            export it to play as {identity.name} elsewhere or to keep a backup.{" "}
            <button onClick={forget} className="underline hover:text-stone-600" disabled={!!busy}>
              Forget identity
            </button>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {identity && !badIdentity && (
            <button onClick={exportIdentity} disabled={locked} className={smallBtn} title="Download this identity as a file. The file is a credential: keep it private">
              ส่งออกบัญชี
            </button>
          )}
          <button onClick={() => importRef.current?.click()} disabled={locked} className={smallBtn} title="Use an identity file exported from another browser">
            {busy === "import" ? "…" : "นำเข้าบัญชี"}
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" onChange={importIdentity} className="hidden" aria-label="Identity file" />
        </div>
        {idMsg && <p className={`text-[11px] break-words ${idMsg.ok ? "text-lime-700" : "text-red-600"}`}>{idMsg.text}</p>}
      </Section>

      <Section title="Friend Arena">
        <div className="flex items-end gap-1.5">
          <label className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-[10px] uppercase tracking-wider text-stone-400">Goal</span>
            <select
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              disabled={locked}
              className="px-1.5 py-1 rounded border border-stone-300 bg-white text-xs text-stone-800 disabled:opacity-60"
            >
              {GOAL_IDS.map((id) => (
                <option key={id} value={id}>
                  {GOALS[id].label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={create} disabled={locked || !identity || badIdentity} className={btn} style={{ background: TEAL }} title="Run your program on a fresh random seed, then post it as a challenge">
            {busy === "create" ? "Running…" : "สร้างคำท้า"}
          </button>
        </div>
        <p className="text-[10px] text-stone-400 leading-relaxed">
          Uses <span className="font-semibold text-stone-500">{file.name}</span> (with its helper files, as with Run) on the fixed 8×8 arena farm. Fewer ticks to the
          goal wins, then fewer ops. ELO K = 32. An unanswered challenge expires after 7 days.{!identity && " Join above to race."}
        </p>

        {progress && <SoloProgress p={progress} goal={GOALS[progress.goal] || GOALS[goalId]} />}
        {error && <p className="text-xs text-red-600 break-words">{error}</p>}
        {notice && <p className="text-xs text-lime-700 break-words">{notice}</p>}
        {answer && <AnswerCard r={answer} />}

        <div className="space-y-1">
          {challenges === null ? (
            <p className="text-center text-stone-400 text-xs py-2">Loading…</p>
          ) : challenges.length === 0 ? (
            <p className="text-center text-stone-400 text-xs py-2">No open challenges. Post one!</p>
          ) : (
            challenges.map((c) => {
              const own = c.authorId === identity?.playerId;
              return (
                <div key={c.id} className="flex items-center gap-2 text-[11px] rounded bg-white border border-stone-200 px-2 py-1">
                  <span className="flex-1 min-w-0 truncate text-stone-700">
                    <span className="font-semibold">{c.authorName}</span>
                    <span className="text-stone-400"> ({c.authorElo})</span> · {GOALS[c.goal]?.label ?? c.goal}
                  </span>
                  {c.verified && (
                    <span className="text-[10px] text-lime-700 whitespace-nowrap" title={VERIFIED_TITLE}>
                      ✓ verified
                    </span>
                  )}
                  <span className="font-mono tabular-nums text-stone-500" title={`${fmt(c.authorOps)} ops · seed ${c.seed}${c.expiresAt ? ` · expires ${timeText(c.expiresAt)}` : ""}`}>
                    {fmt(c.authorTicks)}t
                  </span>
                  <button
                    onClick={() => accept(c)}
                    disabled={locked || !identity || own || badIdentity}
                    className="px-2 py-0.5 rounded text-[11px] font-semibold text-white bg-[#b83a5e] hover:brightness-110 disabled:opacity-40"
                    title={own ? "Your own challenge" : "Race your current program on this seed"}
                  >
                    {busy === `accept:${c.id}` ? "…" : own ? "yours" : "ท้าแข่ง"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </Section>

      {identity && !badIdentity && (
        <Section title="ประวัติ">
          <div className="rounded-lg border border-stone-200 bg-white p-1 max-h-48 overflow-y-auto">
            <History rows={history} />
          </div>
          <p className="text-[10px] text-stone-400">Your latest 20 finished challenges: your ticks / the opponent&apos;s, and your ELO change.</p>
        </Section>
      )}
    </div>
  );
}
