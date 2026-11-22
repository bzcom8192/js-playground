// React glue for the farm: world state, real-time game loop, code runtime,
// log buffering and persistence (localStorage key `farmer_save_v1`).
import { useCallback, useEffect, useRef, useState } from "react";
import { UNLOCK_BY_ID } from "./constants.js";
import * as W from "./world.js";
import { createRuntime } from "./runtime.js";
import { createDemoGame, isDemoHash } from "./demo.js";
import * as C from "./contracts.js";
import { BOTS, GOALS, deltaText, recordMatch } from "./arena.js";
import { tickEventLines } from "./weather.js";
import { submitRecord } from "./onlineApi.js";

export const SAVE_KEY = "farmer_save_v1";
const FRAME_MS = 33; // UI refresh (~30 fps)
const TICK_MS = 100; // world simulation step (~10 ticks/s)
const SAVE_EVERY_MS = 3000;
const MAX_LOGS = 500;
const DAY_CHECK_MS = 1000; // how often the loop checks for a new day (contracts)

function loadGame() {
  if (typeof window !== "undefined" && isDemoHash(window.location.hash)) {
    return { game: createDemoGame(), demo: true };
  }
  return loadSavedGame();
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const game = W.deserialize(data);
      W.ensureWeather(game); // old saves gain their weather seed on first load
      return { game };
    }
  } catch (e) {
    void e;
  }
  return { game: W.newFarm() };
}

let logId = 0;

export default function useFarmEngine() {
  const [initial] = useState(loadGame);
  const gameRef = useRef(initial.game);
  const runtimeRef = useRef(null);
  const logBuffer = useRef([]);
  const dirtyRef = useRef(true);
  const demoRef = useRef(!!initial.demo);
  const pausedRef = useRef(false);

  const [status, setStatus] = useState("idle");
  const [paused, setPausedState] = useState(false);
  const [demo, setDemo] = useState(!!initial.demo);
  const [logs, setLogs] = useState([]);
  // Bumped on every drone error, also while other drones keep running (Megafarm).
  const [errorSeq, setErrorSeq] = useState(0);
  // Bumped after an auto-submitted online score (the Online window refreshes).
  const [onlineSeq, setOnlineSeq] = useState(0);
  const [view, setView] = useState(() => ({
    game: initial.game,
    stats: { running: false, ticks: 0, actions: 0, elapsed: 0, lastMeasure: null, runTicks: 0, ops: 0, lines: 0, chars: 0 },
    frame: 0,
  }));

  const pushLog = useCallback((kind, text) => {
    logBuffer.current.push({ id: ++logId, kind, text });
  }, []);

  const save = useCallback(() => {
    if (demoRef.current) return false; // the demo farm is never saved
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify(W.serialize(gameRef.current)),
      );
      return true;
    } catch (e) {
      void e;
      return false;
    }
  }, []);

  // Today's contracts: on load (first loop pass) and when the date changes
  // while the page is open, the old day's contracts expire and a fresh set
  // is generated. Also expires overdue ones (e.g. a save loaded past them).
  const checkDay = useCallback(() => {
    const res = C.ensureContracts(gameRef.current, C.localDate());
    for (const line of C.rolloverLines(res)) pushLog("info", line);
    if (res.generated || res.expired.length) dirtyRef.current = true;
  }, [pushLog]);

  // Runtime (created once).
  useEffect(() => {
    const rt = createRuntime({
      getState: () => gameRef.current,
      onChange: () => {
        dirtyRef.current = true;
      },
      onLog: ({ kind, text }) => {
        if (kind === "clear") {
          logBuffer.current = [{ id: ++logId, kind: "clear", text: "" }];
        } else {
          logBuffer.current.push({ id: ++logId, kind, text });
          if (logBuffer.current.length > MAX_LOGS * 2) {
            logBuffer.current = logBuffer.current.slice(-MAX_LOGS);
          }
        }
      },
      onDroneError: () => setErrorSeq((n) => n + 1),
      // v4 Online: a new LOCAL best goes to the leaderboard if this browser
      // has an identity. Fire-and-forget: failures are silent, gameplay never
      // waits on the network (a demo farm never records, so never submits).
      onRecord: (ev) => {
        if (demoRef.current) return;
        void submitRecord(ev).then((r) => {
          if (!r.sent) {
            // The server replayed the maze run and could not reproduce it.
            if (r.rejected) logBuffer.current.push({ id: ++logId, kind: "warn", text: `🌐 The online leaderboard did not accept this record: ${r.reason}` });
            return;
          }
          const maze = r.score.category === "maze";
          const what = maze ? `Maze L${r.score.level}` : "Dino";
          const st = r.stored;
          const verified = maze && st?.verified ? ` — ✓ verified by the server${st.corrected ? ` (${st.ticks.toLocaleString("en-US")} ticks · ${st.ops.toLocaleString("en-US")} ops)` : ""}` : "";
          logBuffer.current.push({ id: ++logId, kind: "info", text: `🌐 Sent your new best (${what}) to the online leaderboard${verified}` });
          setOnlineSeq((n) => n + 1);
        });
      },
      onStatus: (s) => {
        setStatus(s);
        if (s !== "running") {
          pausedRef.current = false;
          setPausedState(false);
        }
      },
    });
    runtimeRef.current = rt;
    return () => {
      rt.stop(true);
      runtimeRef.current = null;
    };
  }, []);

  // Game loop: world ticks at ~10/s, UI refreshes at ~30 fps, autosave every 3 s.
  useEffect(() => {
    let lastTick = performance.now();
    let lastSave = lastTick;
    let lastDayCheck = -Infinity;
    const id = setInterval(() => {
      const t = performance.now();
      if (t - lastDayCheck >= DAY_CHECK_MS) {
        lastDayCheck = t;
        checkDay();
      }
      let changed = dirtyRef.current;
      if (t - lastTick >= TICK_MS) {
        const dt = Math.min(2, (t - lastTick) / 1000); // clamp (background tabs)
        lastTick = t;
        if (!pausedRef.current && !demoRef.current) {
          // Pause freezes the world too (growth, water, regrowth, weather).
          const [, events] = W.withEvents(() => W.tick(gameRef.current, dt));
          for (const [kind, text] of tickEventLines(events)) pushLog(kind, text);
          changed = true;
        } else if (!pausedRef.current) {
          // The demo farm is a static showcase (frozen until you leave demo
          // mode); only its (fixed-seed, never saved) weather moves on.
          W.advanceWeatherClock(gameRef.current, dt);
          changed = true;
        }
      }
      if (logBuffer.current.length) {
        const batch = logBuffer.current;
        logBuffer.current = [];
        setLogs((prev) => {
          const ci = batch.map((e) => e.kind).lastIndexOf("clear");
          const base = ci >= 0 ? [] : prev;
          const add = ci >= 0 ? batch.slice(ci + 1) : batch;
          const next = base.concat(add);
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
        });
      }
      if (changed) {
        dirtyRef.current = false;
        const rt = runtimeRef.current;
        setView((v) => ({
          game: gameRef.current,
          stats: rt ? rt.stats() : v.stats,
          frame: v.frame + 1,
        }));
      }
      if (t - lastSave >= SAVE_EVERY_MS) {
        lastSave = t;
        save();
      }
    }, FRAME_MS);
    const onHide = () => save();
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(id);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
      save();
    };
  }, [save, checkDay, pushLog]);

  // Leave demo mode: back to the real save (nothing of the demo is kept).
  const exitDemo = useCallback(() => {
    if (!demoRef.current) return false;
    runtimeRef.current?.stop(true);
    demoRef.current = false;
    setDemo(false);
    setStatus("idle");
    const real = loadSavedGame();
    gameRef.current = real.game;
    dirtyRef.current = true;
    if (typeof window !== "undefined" && isDemoHash(window.location.hash)) {
      window.history.replaceState(null, "", "#/farmer");
    }
    pushLog("info", "Back on your own farm.");
    return true;
  }, [pushLog]);

  /** run(code, { label, mapLine, program }) — label is shown in the log ("▶ Run crops");
   *  program = { lines, chars } of the main file (run metrics / records). */
  const run = useCallback(
    (code, { label, mapLine, program } = {}) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      exitDemo();
      pausedRef.current = false;
      setPausedState(false);
      pushLog("info", label ? `▶ Run ${label}` : "▶ Run");
      rt.run(code, { mapLine, program });
    },
    [pushLog, exitDemo],
  );

  const stop = useCallback(() => runtimeRef.current?.stop(), []);

  const setPaused = useCallback((p) => {
    const rt = runtimeRef.current;
    if (!rt) return;
    rt.setPaused(p);
    pausedRef.current = rt.isPaused();
    setPausedState(rt.isPaused());
    dirtyRef.current = true;
  }, []);
  const isRunning = useCallback(() => !!runtimeRef.current?.isRunning(), []);

  /** Replace the current farm with an imported save (see saveData.js). */
  const importSave = useCallback(
    (data) => {
      runtimeRef.current?.stop(true);
      if (demoRef.current) {
        demoRef.current = false;
        setDemo(false);
        if (typeof window !== "undefined" && isDemoHash(window.location.hash)) {
          window.history.replaceState(null, "", "#/farmer");
        }
      }
      setStatus("idle");
      pausedRef.current = false;
      setPausedState(false);
      gameRef.current = W.deserialize(data);
      W.ensureWeather(gameRef.current);
      dirtyRef.current = true;
      save();
    },
    [save],
  );

  /** Records window: the seed the next maze uses (null = random). Saved at once. */
  const setPendingSeed = useCallback(
    (seed) => {
      exitDemo();
      gameRef.current.pendingSeed = seed;
      dirtyRef.current = true;
      save();
    },
    [exitDemo, save],
  );

  /** Contracts window: the Deliver button (same code path as deliver_contract). */
  const deliverContract = useCallback(
    (id) => {
      // The demo's contracts are only for show: leave the demo, deliver nothing.
      if (exitDemo()) return false;
      checkDay();
      const res = C.deliverContract(gameRef.current, id);
      if (res.ok) {
        pushLog("info", C.deliveredText(res.contract));
        save();
      } else {
        pushLog("warn", `Deliver: ${res.msg}`);
      }
      dirtyRef.current = true;
      return res.ok;
    },
    [exitDemo, checkDay, pushLog, save],
  );

  /** Arena window: apply a finished match to the rating + history and save.
   *  The match itself ran on throwaway worlds (arena.js); this is the only
   *  write to the player's state. No rating on the demo farm. */
  const recordArenaMatch = useCallback(
    (match) => {
      if (demoRef.current) return null;
      const res = recordMatch(gameRef.current, match);
      const label = { win: "win", draw: "draw", loss: "loss" }[match.result];
      pushLog(
        "info",
        `⚔️ Arena: ${label} vs ${BOTS[match.bot].name} (${GOALS[match.goal].label}, ${match.ticks.toLocaleString("en-US")} ticks) ` +
          `— rating ${deltaText(res.delta)} → ${res.rating}`,
      );
      dirtyRef.current = true;
      save();
      return res;
    },
    [pushLog, save],
  );

  const clearFarm = useCallback(() => {
    exitDemo();
    W.clearFarm(gameRef.current);
    dirtyRef.current = true;
  }, [exitDemo]);

  const buy = useCallback(
    (id) => {
      exitDemo();
      const res = W.buyUnlock(gameRef.current, id);
      if (res.ok) {
        pushLog("info", `🔧 ${UNLOCK_BY_ID[id].name} → level ${gameRef.current.unlocks[id]}`);
        save();
      } else if (res.msg) {
        pushLog("warn", res.msg);
      }
      dirtyRef.current = true;
      return res.ok;
    },
    [pushLog, save, exitDemo],
  );

  const resetSave = useCallback(() => {
    runtimeRef.current?.stop(true);
    if (demoRef.current) {
      demoRef.current = false;
      setDemo(false);
    }
    setStatus("idle");
    gameRef.current = W.newFarm();
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      void e;
    }
    logBuffer.current = [{ id: ++logId, kind: "clear", text: "" }];
    dirtyRef.current = true;
  }, []);

  // Errors detected before the runtime starts (e.g. syntax pre-check).
  const reportError = useCallback(
    (text) => {
      runtimeRef.current?.stop(true);
      pushLog("error", text);
      setStatus("error");
    },
    [pushLog],
  );

  const clearLog = useCallback(() => {
    logBuffer.current = [];
    setLogs([]);
  }, []);

  return {
    view,
    status,
    errorSeq,
    onlineSeq,
    logs,
    paused,
    setPaused,
    demo,
    exitDemo,
    run,
    stop,
    isRunning,
    importSave,
    clearFarm,
    setPendingSeed,
    deliverContract,
    recordArenaMatch,
    buy,
    resetSave,
    saveNow: save,
    clearLog,
    pushLog,
    reportError,
  };
}
