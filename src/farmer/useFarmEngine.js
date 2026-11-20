// React glue for the farm: world state, real-time game loop, code runtime,
// log buffering and persistence (localStorage key `farmer_save_v1`).
import { useCallback, useEffect, useRef, useState } from "react";
import * as W from "./world.js";
import { createRuntime } from "./runtime.js";
import { createDemoGame, isDemoHash } from "./demo.js";

export const SAVE_KEY = "farmer_save_v1";
const FRAME_MS = 33; // UI refresh (~30 fps)
const TICK_MS = 100; // world simulation step (~10 ticks/s)
const SAVE_EVERY_MS = 3000;
const MAX_LOGS = 500;

function loadGame() {
  if (typeof window !== "undefined" && isDemoHash(window.location.hash)) {
    return { game: createDemoGame(), uiSpeed: 1, demo: true };
  }
  return loadSavedGame();
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return { game: W.deserialize(data), uiSpeed: [1, 2, 4, 8].includes(data.uiSpeed) ? data.uiSpeed : 1 };
    }
  } catch (e) {
    void e;
  }
  return { game: W.createGame(), uiSpeed: 1 };
}

let logId = 0;

export default function useFarmEngine() {
  const [initial] = useState(loadGame);
  const gameRef = useRef(initial.game);
  const uiSpeedRef = useRef(initial.uiSpeed);
  const runtimeRef = useRef(null);
  const logBuffer = useRef([]);
  const dirtyRef = useRef(true);
  const demoRef = useRef(!!initial.demo);
  const pausedRef = useRef(false);

  const [uiSpeed, setUiSpeedState] = useState(initial.uiSpeed);
  const [status, setStatus] = useState("idle");
  const [paused, setPausedState] = useState(false);
  const [demo, setDemo] = useState(!!initial.demo);
  const [logs, setLogs] = useState([]);
  const [view, setView] = useState(() => ({
    game: initial.game,
    stats: { running: false, ticks: 0, actions: 0, elapsed: 0, lastMeasure: null },
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
        JSON.stringify({ ...W.serialize(gameRef.current), uiSpeed: uiSpeedRef.current }),
      );
      return true;
    } catch (e) {
      void e;
      return false;
    }
  }, []);

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
      onStatus: (s) => {
        setStatus(s);
        if (s !== "running") {
          pausedRef.current = false;
          setPausedState(false);
        }
      },
      getUiSpeed: () => uiSpeedRef.current,
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
    const id = setInterval(() => {
      const t = performance.now();
      let changed = dirtyRef.current;
      if (t - lastTick >= TICK_MS) {
        const dt = Math.min(2, (t - lastTick) / 1000); // clamp (background tabs)
        lastTick = t;
        if (!pausedRef.current && !demoRef.current) {
          // Pause freezes the world too (growth, water, regrowth). The demo
          // farm is a static showcase (frozen until you leave demo mode).
          W.tick(gameRef.current, dt);
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
  }, [save]);

  // Leave demo mode: back to the real save (nothing of the demo is kept).
  const exitDemo = useCallback(() => {
    if (!demoRef.current) return false;
    runtimeRef.current?.stop(true);
    demoRef.current = false;
    setDemo(false);
    setStatus("idle");
    const real = loadSavedGame();
    gameRef.current = real.game;
    uiSpeedRef.current = real.uiSpeed;
    setUiSpeedState(real.uiSpeed);
    dirtyRef.current = true;
    if (typeof window !== "undefined" && isDemoHash(window.location.hash)) {
      window.history.replaceState(null, "", "#/farmer");
    }
    pushLog("info", "Left the demo farm, back to your saved farm.");
    return true;
  }, [pushLog]);

  /** run(code, { label, mapLine }) — label is shown in the log ("▶ Run crops"). */
  const run = useCallback(
    (code, { label, mapLine } = {}) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      exitDemo();
      pausedRef.current = false;
      setPausedState(false);
      pushLog("info", label ? `▶ Run ${label}` : "▶ Run");
      rt.run(code, { mapLine });
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

  const setUiSpeed = useCallback((s) => {
    uiSpeedRef.current = s;
    setUiSpeedState(s);
  }, []);

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
        pushLog("info", `🔓 ${id} → level ${gameRef.current.unlocks[id]}`);
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
    gameRef.current = W.createGame();
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
    logs,
    uiSpeed,
    setUiSpeed,
    paused,
    setPaused,
    demo,
    exitDemo,
    run,
    stop,
    isRunning,
    clearFarm,
    buy,
    resetSave,
    saveNow: save,
    clearLog,
    pushLog,
    reportError,
  };
}
