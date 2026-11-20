// React glue for the farm: world state, real-time game loop, code runtime,
// log buffering and persistence (localStorage key `farmer_save_v1`).
import { useCallback, useEffect, useRef, useState } from "react";
import * as W from "./world.js";
import { createRuntime } from "./runtime.js";

export const SAVE_KEY = "farmer_save_v1";
const FRAME_MS = 33; // UI refresh (~30 fps)
const TICK_MS = 100; // world simulation step (~10 ticks/s)
const SAVE_EVERY_MS = 3000;
const MAX_LOGS = 500;

function loadGame() {
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

  const [uiSpeed, setUiSpeedState] = useState(initial.uiSpeed);
  const [status, setStatus] = useState("idle");
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
      onStatus: (s) => setStatus(s),
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
        W.tick(gameRef.current, dt);
        changed = true;
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

  const run = useCallback(
    (code) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      pushLog("info", "▶ Run");
      rt.run(code);
    },
    [pushLog],
  );

  const stop = useCallback(() => runtimeRef.current?.stop(), []);
  const isRunning = useCallback(() => !!runtimeRef.current?.isRunning(), []);

  const setUiSpeed = useCallback((s) => {
    uiSpeedRef.current = s;
    setUiSpeedState(s);
  }, []);

  const clearFarm = useCallback(() => {
    W.clearFarm(gameRef.current);
    dirtyRef.current = true;
  }, []);

  const buy = useCallback(
    (id) => {
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
    [pushLog, save],
  );

  const resetSave = useCallback(() => {
    runtimeRef.current?.stop(true);
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
