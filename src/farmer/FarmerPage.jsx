import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import "../monacoEnv";
import ShortcutsModal from "../components/ShortcutsModal";
import PlayIcon from "../components/icons/PlayIcon";
import usePageShortcuts from "../hooks/usePageShortcuts";
import { EDITOR_SHORTCUTS, FARMER_SHORTCUTS } from "../shortcuts";
import { ROUTES } from "../router";
import { lintCode } from "../utils/linter";
import { ENTITY_INFO, ITEM_ICONS, ITEM_ORDER } from "./constants.js";
import { DEFAULT_CODE } from "./examples.js";
import { FARMER_GLOBALS, FARMER_LIB, FARMER_LIB_FILE } from "./farmerLib.js";
import * as W from "./world.js";
import useFarmEngine from "./useFarmEngine.js";
import FarmGrid from "./FarmGrid.jsx";
import UnlocksPanel from "./UnlocksPanel.jsx";
import DocsPanel from "./DocsPanel.jsx";
import LogPanel from "./LogPanel.jsx";

const MonacoEditor = lazy(() => import("../components/MonacoEditor"));

const CODE_KEY = "farmer_code";
const EXTRA_LIB = { content: FARMER_LIB, fileName: FARMER_LIB_FILE };
const SHORTCUT_SECTIONS = [
  { title: "JS Farmer", items: FARMER_SHORTCUTS },
  { title: "Editor", items: EDITOR_SHORTCUTS },
];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const STATUS_STYLE = {
  idle: ["bg-gray-600", "Idle"],
  running: ["bg-green-400 animate-pulse", "Running"],
  done: ["bg-sky-400", "Finished"],
  stopped: ["bg-gray-400", "Stopped"],
  error: ["bg-red-500", "Error"],
};

function loadCode() {
  try {
    const saved = localStorage.getItem(CODE_KEY);
    return saved !== null ? saved : DEFAULT_CODE;
  } catch {
    return DEFAULT_CODE;
  }
}

function Inventory({ items }) {
  return (
    <div className="flex flex-wrap gap-1.5 justify-center">
      {ITEM_ORDER.map((k) => (
        <span
          key={k}
          title={k}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-mono ${
            items[k] > 0 ? "border-gray-700 bg-gray-800/70 text-gray-100" : "border-gray-800 text-gray-600"
          }`}
        >
          <span className={items[k] > 0 ? "" : "grayscale opacity-50"}>{ITEM_ICONS[k]}</span>
          {items[k].toLocaleString("en-US")}
        </span>
      ))}
    </div>
  );
}

function StatusLine({ game, stats, status }) {
  const tile = W.droneTile(game);
  const e = tile.entity;
  const [dot, label] = STATUS_STYLE[status] || STATUS_STYLE.idle;
  const aps = stats.elapsed > 0 ? stats.actions / stats.elapsed : 0;
  const part = "whitespace-nowrap";
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400 font-mono">
      <span className={part}>
        📍 ({game.drone.x}, {game.drone.y})
      </span>
      <span className={part}>
        {e
          ? `${ENTITY_INFO[e.type]?.icon} ${e.type}${e.progress < 1 ? ` ${Math.floor(e.progress * 100)}%` : " ✓"}`
          : "∅ empty"}
      </span>
      <span className={part}>{tile.ground}</span>
      <span className={part}>💧 {Math.round(tile.water * 100)}%</span>
      <span className={part}>⏱ {stats.elapsed.toFixed(1)}s</span>
      <span className={part}>{stats.ticks.toLocaleString("en-US")} ticks</span>
      <span className={part}>{aps.toFixed(1)} act/s</span>
      {stats.lastMeasure !== null && stats.lastMeasure !== undefined && (
        <span className={part}>📏 {stats.lastMeasure}</span>
      )}
      <span className={`${part} flex items-center gap-1.5 text-gray-300`}>
        <span className={`w-2 h-2 rounded-full ${dot}`} /> {label}
      </span>
    </div>
  );
}

export default function FarmerPage() {
  const engine = useFarmEngine();
  const { view, status, logs, uiSpeed } = engine;
  const game = view.game;
  const running = status === "running";

  const [code, setCode] = useState(loadCode);
  const [tab, setTab] = useState("log");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(CODE_KEY, code);
    } catch (e) {
      void e;
    }
  }, [code]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(id);
  }, [toast]);

  const { run, stop, isRunning, reportError, saveNow, pushLog } = engine;

  const startRun = useCallback(() => {
    // Syntax pre-check on the player's original code, for a clear line number.
    try {
      new AsyncFunction(code);
    } catch (err) {
      if (err instanceof SyntaxError) {
        const fatal = lintCode(code, FARMER_GLOBALS).find((m) => m.fatal);
        reportError(fatal ? `Line ${fatal.line}: SyntaxError: ${err.message}` : `SyntaxError: ${err.message}`);
        setTab("log");
        return;
      }
    }
    run(code);
  }, [code, run, reportError]);

  const toggleRun = useCallback(() => {
    if (isRunning()) stop();
    else startRun();
  }, [isRunning, stop, startRun]);

  const handleSave = useCallback(() => {
    try {
      localStorage.setItem(CODE_KEY, code);
    } catch (e) {
      void e;
    }
    setToast(saveNow() ? "✓ Saved" : "Save failed");
  }, [code, saveNow]);

  usePageShortcuts({
    onRun: toggleRun,
    onSave: handleSave,
    onHelp: () => setShortcutsOpen(true),
    onEscape: () => setMenuOpen(false),
  });

  // Status changes to "error" → show the log.
  const [prevStatus, setPrevStatus] = useState(status);
  if (prevStatus !== status) {
    setPrevStatus(status);
    if (status === "error") setTab("log");
  }

  const handleClearFarm = () => {
    if (confirm("Clear the farm? All plants are removed and the ground resets to grassland.")) {
      engine.clearFarm();
    }
  };

  const handleResetSave = () => {
    setMenuOpen(false);
    if (confirm("Reset ALL JS Farmer progress (items, unlocks, farm) and your farm code? This cannot be undone.")) {
      engine.resetSave();
      try {
        localStorage.removeItem(CODE_KEY);
      } catch (e) {
        void e;
      }
      setCode(DEFAULT_CODE);
    }
  };

  const handleLoadExample = (ex) => {
    setCode(ex.code);
    pushLog("info", `📄 Loaded example "${ex.name}" (Ctrl+Z in the editor to undo)`);
  };

  const power = game.items.Power > 0 ? 2 : 1;
  const moveMs = Math.min(150, 200 / (W.speedMultiplier(game) * uiSpeed * power));
  const affordable = countAffordable(game);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-200 font-sans relative overflow-hidden">
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} sections={SHORTCUT_SECTIONS} />

      {/* --- Header --- */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 bg-[#1e1e1e] border-b border-gray-800 shadow-xl z-20 h-16 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-green-700 rounded-lg flex items-center justify-center text-lg shadow-green-900/50 shadow-lg shrink-0">
            🚜
          </div>
          <h1 className="text-lg font-bold text-gray-100 tracking-tight hidden sm:block">JS Farmer</h1>
          <a
            href={ROUTES.playground}
            className="ml-1 px-2.5 py-1 text-xs font-medium rounded-full border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors whitespace-nowrap"
            title="Back to the JS Playground"
          >
            Playground
          </a>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {toast && <span className="text-xs text-green-400 hidden sm:inline">{toast}</span>}
          <select
            value={uiSpeed}
            onChange={(e) => engine.setUiSpeed(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-gray-300"
            title="Execution speed"
          >
            {[1, 2, 4, 8].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button
            onClick={handleClearFarm}
            className="hidden sm:block px-3 py-1.5 text-xs font-medium rounded-md border border-gray-700 text-gray-400 hover:text-red-300 hover:border-red-900 transition-colors"
            title="Clear the farm"
          >
            Clear Farm
          </button>
          <button
            onClick={() => setShortcutsOpen(true)}
            className="hidden sm:block px-2 py-1.5 text-sm text-gray-400 hover:text-white rounded hover:bg-gray-800 transition-colors"
            title="Keyboard shortcuts (?)"
          >
            ⌨
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="px-2 py-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-800 transition-colors"
              title="More"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 mt-1 z-40 w-44 py-1 bg-[#161b22] border border-gray-700 rounded-md shadow-2xl text-sm"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      handleClearFarm();
                    }}
                    className="sm:hidden w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-800"
                  >
                    Clear Farm
                  </button>
                  <button
                    role="menuitem"
                    onClick={handleResetSave}
                    className="w-full text-left px-3 py-1.5 text-red-300 hover:bg-gray-800"
                  >
                    Reset Save…
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={toggleRun}
            title="Run / Stop (Ctrl/⌘+Enter)"
            className={`flex items-center gap-2 px-4 sm:px-5 py-2 text-sm font-bold text-white rounded-md transition-all active:scale-95 ${
              running ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-900/30"
            }`}
          >
            {running ? (
              <>
                <span className="w-3 h-3 bg-white rounded-sm" /> Stop
              </>
            ) : (
              <>
                <PlayIcon /> Run
              </>
            )}
          </button>
        </div>
      </header>

      {/* --- Workspace --- */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Farm */}
        <div className="md:flex-1 h-[45%] md:h-auto flex flex-col gap-2 p-3 border-b md:border-b-0 md:border-r border-gray-800 bg-[#0d1117] min-h-0 min-w-0">
          <Inventory items={game.items} />
          <div className="flex-1 min-h-0">
            <FarmGrid game={game} moveMs={moveMs} />
          </div>
          <StatusLine game={game} stats={view.stats} status={status} />
        </div>

        {/* Editor + tabs */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-1 relative min-h-[8rem]">
            <Suspense fallback={<div className="p-4 text-gray-600 text-sm">Loading editor…</div>}>
              <MonacoEditor
                value={code}
                onChange={setCode}
                onRun={toggleRun}
                onSave={handleSave}
                extraLib={EXTRA_LIB}
                lintGlobals={FARMER_GLOBALS}
                fallback={
                  <textarea
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="absolute inset-0 w-full h-full p-6 bg-[#1e1e1e] text-gray-300 font-mono text-sm leading-6 resize-none focus:outline-none custom-scrollbar"
                    spellCheck="false"
                    autoCapitalize="off"
                    autoComplete="off"
                    style={{ fontFamily: "'Fira Code', 'Consolas', monospace" }}
                  />
                }
              />
            </Suspense>
          </div>

          <div className="h-[40%] md:h-[42%] flex flex-col border-t border-gray-800 bg-[#0d1117] min-h-0">
            <div className="flex items-center justify-between px-2 bg-[#1e1e1e] border-b border-gray-800 select-none">
              <div className="flex" role="tablist">
                {[
                  ["log", `Log${logs.length ? ` (${logs.length})` : ""}`],
                  ["unlocks", `Unlocks${affordable ? ` · ${affordable}` : ""}`],
                  ["docs", "Docs"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                      tab === id
                        ? "text-gray-100 border-blue-500"
                        : "text-gray-500 border-transparent hover:text-gray-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "log" && logs.length > 0 && (
                <button onClick={engine.clearLog} className="text-[11px] text-gray-500 hover:text-red-400 px-2">
                  Clear
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
              {tab === "log" && <LogPanel logs={logs} />}
              {tab === "unlocks" && <UnlocksPanel game={game} onBuy={engine.buy} />}
              {tab === "docs" && <DocsPanel game={game} onLoadExample={handleLoadExample} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function countAffordable(game) {
  return Object.keys(game.unlocks).filter((id) => W.unlockStatus(game, id) === "affordable").length;
}
