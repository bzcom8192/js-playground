import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../monacoEnv";
import ShortcutsModal from "../components/ShortcutsModal";
import usePageShortcuts from "../hooks/usePageShortcuts";
import { EDITOR_SHORTCUTS, FARMER_SHORTCUTS } from "../shortcuts";
import { ROUTES } from "../router";
import { lintCode } from "../utils/linter";
import { ENTITY_INFO, ITEM_ICONS } from "./constants.js";
import { FARMER_GLOBALS, FARMER_LIB, FARMER_LIB_FILE } from "./farmerLib.js";
import { listDeclarations } from "./transform.js";
import { dropStripArtifacts, stripTypes } from "./stripTypes.js";
import { buildProgram, mapLine } from "./program.js";
import { formatCount } from "./format.js";
import { STRIP_REFRESH_MS, stripFields } from "./statusStrip.js";
import useSampled from "./useSampled.js";
import * as W from "./world.js";
import useFarmEngine, { SAVE_KEY } from "./useFarmEngine.js";
import useFarmerFiles, { FILES_KEY } from "./useFarmerFiles.js";
import { buildExport, parseImport } from "./saveData.js";
import FarmBoardView from "./FarmBoardView.jsx";
import FloatingWindow, { PillButton } from "./FloatingWindow.jsx";
import { BERRY, GAME_NAME, Glyph, INK, MARIGOLD, TEAL } from "./farmerUi.jsx";
import UnlocksPanel from "./UnlocksPanel.jsx";
import DocsPanel from "./DocsPanel.jsx";
import RecordsPanel from "./RecordsPanel.jsx";
import ContractsPanel from "./ContractsPanel.jsx";
import ArenaPanel from "./ArenaPanel.jsx";
import OnlinePanel from "./OnlinePanel.jsx";
import { isDeliverable } from "./contracts.js";
import { programSize } from "./records.js";
import LogPanel from "./LogPanel.jsx";
import WeatherPanel from "./WeatherPanel.jsx";

const MonacoEditor = lazy(() => import("../components/MonacoEditor"));

const EXTRA_LIB = { content: FARMER_LIB, fileName: FARMER_LIB_FILE };
const SHORTCUT_SECTIONS = [
  { title: GAME_NAME, items: FARMER_SHORTCUTS },
  { title: "Editor", items: EDITOR_SHORTCUTS },
];
// ESLint globals per set of imported helper names (stable identity per set).
const GLOBALS_CACHE = new Map();
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Store room order: what grows, then what helps it grow, then what it buys.
const INVENTORY = ["Hay", "Wood", "Carrot", "Pumpkin", "Cactus", "Rice", "Water", "Fertilizer", "Power", "Gold", "Bone"];
// Rice shares Hay's 🌾 icon; a green-gold tint tells the two slots apart.
const ITEM_TINT = { Rice: "hue-rotate(38deg) saturate(1.25)" };

const STATUS_LABEL = {
  idle: ["bg-stone-300", "Idle"],
  running: ["bg-lime-400 animate-pulse", "Running"],
  paused: ["bg-orange-400", "Paused"],
  done: ["bg-sky-300", "Finished"],
  stopped: ["bg-stone-300", "Stopped"],
  error: ["bg-red-500", "Error"],
};

function useIsDesktop() {
  const q = "(min-width: 768px)";
  const [ok, setOk] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setOk(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return ok;
}

// ---------- store room + top bar ----------

/** The inventory: a rail down the left side (a wrapping strip on phones). */
function StoreRoom({ items }) {
  return (
    <section
      aria-label="Store room"
      className="rounded-md border border-[#2e2438]/80 bg-[#fdf6ea]/95 text-[#2e2438] p-1.5 grid grid-cols-4 gap-x-2 md:flex md:flex-col md:w-[112px] md:max-h-full md:overflow-y-auto"
    >
      {INVENTORY.map((k) => (
        <div
          key={k}
          title={`${k}: ${(items[k] || 0).toLocaleString("en-US")}`}
          className={`flex items-center gap-2 px-1 py-1 select-none md:border-b md:last:border-b-0 border-[#ecdcc8] ${items[k] > 0 ? "" : "opacity-45"}`}
        >
          <span className="text-[19px] leading-none w-6 text-center shrink-0" style={ITEM_TINT[k] ? { filter: ITEM_TINT[k] } : undefined} aria-hidden="true">
            {ITEM_ICONS[k]}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[14px] font-bold tabular-nums">{formatCount(items[k])}</span>
            <span className="block text-[10px] text-[#75627a] truncate">{k}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

/** One entry of the top bar: opens / closes a window. */
function NavTab({ label, title, onClick, active, badge = 0 }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={!!active}
      onClick={onClick}
      className={`shrink-0 h-full px-3 flex items-center gap-1.5 text-[13px] font-medium border-b-[3px] transition-colors ${
        active ? "text-white border-[#f0b03f] bg-white/10" : "text-[#d9cbe0] border-transparent hover:text-white hover:bg-white/5"
      }`}
    >
      {label}
      {badge > 0 && (
        <span className="min-w-4 h-4 px-1 rounded-full text-[10px] font-bold leading-4 text-center text-[#2e2438]" style={{ background: MARIGOLD }}>
          {badge}
        </span>
      )}
    </button>
  );
}

function FilesMenu({ files, windows, onNew, onToggle, onDelete, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-[9000]" onClick={onClose} />
      <div
        role="menu"
        className="absolute right-2 top-full mt-1 z-[9001] w-64 rounded-md bg-[#fdf6ea] shadow-xl border border-[#2e2438] text-stone-800 text-sm overflow-hidden"
      >
        <button
          role="menuitem"
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 font-semibold hover:bg-stone-100"
        >
          <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs" style={{ background: TEAL }}>
            +
          </span>
          New file
        </button>
        <div className="border-t border-stone-200 px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-stone-400 font-semibold">
          Files
        </div>
        <div className="max-h-72 overflow-y-auto pb-1">
          {files.map((f) => {
            const open = windows[f.id]?.open;
            return (
              <div key={f.id} className="flex items-center group hover:bg-stone-100">
                <button
                  role="menuitem"
                  onClick={() => onToggle(f.id)}
                  className="flex-1 min-w-0 text-left px-3 py-1.5 flex items-center gap-2"
                  title={open ? "Bring to front" : "Reopen"}
                >
                  <span className={`w-2 h-2 rounded-full ${open ? "bg-[#1c7a72]" : "bg-stone-300"}`} />
                  <span className="truncate font-mono">{f.name}</span>
                  {!open && <span className="ml-auto text-[11px] text-stone-400">reopen</span>}
                </button>
                <button
                  onClick={() => onDelete(f.id)}
                  disabled={files.length <= 1}
                  className="px-2 py-1.5 text-stone-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-stone-400"
                  title={files.length <= 1 ? "Can't delete the last file" : `Delete ${f.name}…`}
                  aria-label={`Delete ${f.name}`}
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ---------- status pill ----------

function StatusPill({ game, stats, status, paused, demo, toast }) {
  // The engine mutates `game` and re-renders at ~30 fps; show a snapshot
  // sampled every STRIP_REFRESH_MS so the numbers stay readable.
  const f = useSampled(stripFields(game, stats, status, paused), STRIP_REFRESH_MS);
  const [dot, label] = STATUS_LABEL[f.status] || STATUS_LABEL.idle;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1 w-fit mx-auto rounded-md bg-[#fdf6ea]/95 border border-[#2e2438]/80 text-[#2e2438] text-[11px] sm:text-xs font-mono max-w-full">
      <span className="whitespace-nowrap">
        📍 ({f.x}, {f.y})
      </span>
      {f.drones !== undefined && (
        <span className="whitespace-nowrap" title={`${f.drones} bots on the farm (this strip follows bot 0)`}>
          🤖×{f.drones}
        </span>
      )}
      <span className="opacity-50">·</span>
      <span className="whitespace-nowrap">{f.what}</span>
      {f.water !== null && <span className="whitespace-nowrap">💧{f.water}%</span>}
      {f.weather !== undefined && (
        <>
          <span className="opacity-50">·</span>
          <span className="whitespace-nowrap" title="Weather (the forecast is in Field Guide → Weather)">
            {f.weather}
          </span>
        </>
      )}
      <span className="opacity-50">·</span>
      <span className="whitespace-nowrap">⏱ {f.elapsed}s</span>
      <span className="opacity-50">·</span>
      <span className="whitespace-nowrap">{f.ticks} ticks</span>
      {f.measure !== null && (
        <>
          <span className="opacity-50">·</span>
          <span className="whitespace-nowrap">📏 {f.measure}</span>
        </>
      )}
      <span className="opacity-50">·</span>
      <span className="whitespace-nowrap flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${dot}`} /> {label}
      </span>
      {demo && (
        <span
          className="ml-1 px-1.5 rounded bg-[#f0b03f] text-[10px] font-bold uppercase"
          title="A show farm; nothing on it is saved. Edit, run, save or buy something and you are back on your own farm."
        >
          Demo
        </span>
      )}
      {toast && <span className="ml-1 font-bold text-lime-700">{toast}</span>}
    </div>
  );
}

// ---------- code window ----------

function CodeWindow({ file, win, floating, isRunning, paused, lintGlobals, ownFunctions, onRun, onStop, onPause, onSave, onChange, windowProps }) {
  const ownRef = useRef(ownFunctions);
  useEffect(() => {
    ownRef.current = ownFunctions;
  });
  // ESLint sees the type-stripped code (lintPreprocess); positions are
  // unchanged, but blanked annotations must not count as "multiple spaces".
  // A helper file's top-level functions are used by OTHER files → not "unused".
  const lintFilter = useCallback(
    (msgs, code) =>
      dropStripArtifacts(msgs, code).filter((m) => {
        if (m.ruleId !== "no-unused-vars") return true;
        const name = /'([^']+)'/.exec(m.message)?.[1];
        return !ownRef.current.has(name);
      }),
    [],
  );

  const actions = isRunning ? (
    <>
      <PillButton color={INK} title={paused ? "Resume" : "Pause (program + farm)"} onClick={onPause}>
        {paused ? Glyph.play : Glyph.pause} {paused ? "Resume" : "Pause"}
      </PillButton>
      <PillButton color={BERRY} title={`Stop ${file.name}`} onClick={onStop}>
        {Glyph.stop} Stop
      </PillButton>
    </>
  ) : (
    <PillButton color={TEAL} title={`Run ${file.name} (Ctrl/⌘+Enter)`} onClick={onRun}>
      {Glyph.play} Run
    </PillButton>
  );

  return (
    <FloatingWindow {...windowProps} title={<span className="font-mono">{file.name}</span>} rect={win} floating={floating} actions={actions} accent={TEAL} label={`Code: ${file.name}`}>
      <Suspense fallback={<div className="p-4 text-gray-500 text-sm">Loading editor…</div>}>
        <MonacoEditor
          value={file.code}
          onChange={onChange}
          onRun={() => (isRunning ? onStop() : onRun())}
          onSave={onSave}
          extraLib={EXTRA_LIB}
          language="typescript"
          lintGlobals={lintGlobals}
          lintFilter={lintFilter}
          lintPreprocess={stripTypes}
          fallback={
            <textarea
              value={file.code}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 w-full h-full p-4 bg-[#1e1e1e] text-gray-300 font-mono text-sm leading-6 resize-none focus:outline-none custom-scrollbar"
              spellCheck="false"
              autoCapitalize="off"
              autoComplete="off"
              style={{ fontFamily: "'Fira Code', 'Consolas', monospace" }}
            />
          }
        />
      </Suspense>
    </FloatingWindow>
  );
}

// ---------- files tab ----------

function FilesPanel({ files, windows, active, onToggle, onRename, onDelete, onNew }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const commit = () => {
    if (editing !== null) onRename(editing, draft);
    setEditing(null);
  };
  return (
    <div className="p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Files</span>
        <button onClick={onNew} className="px-2.5 py-1 rounded text-xs font-semibold text-white hover:brightness-110" style={{ background: TEAL }}>
          + New File
        </button>
      </div>
      <ul className="space-y-1">
        {files.map((f) => {
          const open = windows[f.id]?.open;
          return (
            <li key={f.id} className={`flex items-center gap-2 px-2 py-1.5 rounded border ${f.id === active ? "border-gray-600 bg-white/5" : "border-gray-800"}`}>
              <input
                type="checkbox"
                checked={!!open}
                onChange={() => onToggle(f.id, !open)}
                title={open ? "Close window" : "Open window"}
                aria-label={`${open ? "Close" : "Open"} ${f.name}`}
                className="accent-[#1c7a72]"
              />
              {editing === f.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 font-mono text-gray-100 text-xs"
                  aria-label="File name"
                />
              ) : (
                <button
                  className="flex-1 min-w-0 text-left font-mono text-gray-200 truncate hover:text-white"
                  onClick={() => onToggle(f.id, true)}
                  onDoubleClick={() => {
                    setEditing(f.id);
                    setDraft(f.name);
                  }}
                  title="Click: open / bring to front · Double-click: rename"
                >
                  {f.name}
                </button>
              )}
              <span className="text-[11px] text-gray-600 tabular-nums">{f.code.split("\n").length} ln</span>
              <button
                onClick={() => {
                  setEditing(f.id);
                  setDraft(f.name);
                }}
                className="text-gray-500 hover:text-gray-200 px-1"
                title={`Rename ${f.name}`}
                aria-label={`Rename ${f.name}`}
              >
                ✎
              </button>
              <button
                onClick={() => onDelete(f.id)}
                disabled={files.length <= 1}
                className="text-gray-500 hover:text-red-400 px-1 disabled:opacity-30"
                title={files.length <= 1 ? "Can't delete the last file" : `Delete ${f.name}…`}
                aria-label={`Delete ${f.name}`}
              >
                🗑
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Run starts the file of that window. From the other files it can call the functions, and nothing else of them runs.
      </p>
    </div>
  );
}

// ---------- page ----------

export default function FarmerPage() {
  const engine = useFarmEngine();
  const { view, status, logs, paused, demo } = engine;
  const game = view.game;
  const running = status === "running";
  const desktop = useIsDesktop();

  const fm = useFarmerFiles();
  const { files, ui } = fm;
  const windows = ui.windows;
  const activeFile = files.find((f) => f.id === ui.active) || files[0];

  const [runningFileId, setRunningFileId] = useState(null);
  const [infoTab, setInfoTab] = useState("docs");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [seedDraft, setSeedDraft] = useState(""); // the Almanac's replay-seed box

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(id);
  }, [toast]);

  const { run, stop, reportError, saveNow, pushLog, exitDemo, setPaused } = engine;

  // ---- per-file lint globals: farmer API + other files' top-level functions ----
  const declared = useMemo(
    () =>
      Object.fromEntries(
        files.map((f) => {
          const all = listDeclarations(stripTypes(f.code));
          return [f.id, { fns: all.filter((d) => d.kind === "function").map((d) => d.name), names: new Set(all.map((d) => d.name)) }];
        }),
      ),
    [files],
  );
  const lintGlobalsFor = (id) => {
    const own = declared[id]?.names || new Set();
    const extra = [...new Set(files.filter((f) => f.id !== id).flatMap((f) => declared[f.id]?.fns || []))].filter((n) => !own.has(n)).sort();
    const key = extra.join(",");
    let g = GLOBALS_CACHE.get(key);
    if (!g) {
      g = { ...FARMER_GLOBALS, ...Object.fromEntries(extra.map((n) => [n, "readonly"])) };
      GLOBALS_CACHE.set(key, g);
    }
    return g;
  };

  // ---- run / stop / pause ----
  const runFile = useCallback(
    (id) => {
      let prog;
      try {
        prog = buildProgram(files, id);
      } catch (err) {
        reportError(String(err.message || err));
        return;
      }
      // Syntax pre-check per file segment, for a clear file + line number.
      for (const seg of prog.segments) {
        try {
          new AsyncFunction(seg.code);
        } catch (err) {
          if (err instanceof SyntaxError) {
            const fatal = lintCode(seg.code, FARMER_GLOBALS).find((m) => m.fatal);
            const isMain = seg.fileId === id;
            const where = fatal ? (isMain ? `Line ${fatal.line}: ` : `${seg.name}, line ${fatal.line}: `) : isMain ? "" : `${seg.name}: `;
            exitDemo();
            reportError(`${where}SyntaxError: ${err.message}`);
            setInfoTab("log");
            fm.setOpen("info", true);
            return;
          }
        }
      }
      setRunningFileId(id);
      run(prog.code, {
        label: prog.mainFile.name,
        mapLine: (line) => mapLine(prog.segments, line),
        program: programSize(prog.mainFile.code),
      });
    },
    [files, run, reportError, exitDemo, fm],
  );

  const toggleFile = useCallback(
    (id) => {
      if (running && runningFileId === id) stop();
      else runFile(id);
    },
    [running, runningFileId, stop, runFile],
  );

  const handleSave = useCallback(() => {
    exitDemo();
    fm.saveNow();
    setToast(saveNow() ? "✓ Saved" : "Save failed");
  }, [fm, saveNow, exitDemo]);

  usePageShortcuts({
    onRun: () => toggleFile(activeFile.id),
    onSave: handleSave,
    onHelp: () => setShortcutsOpen(true),
    onEscape: () => setMenuOpen(false),
  });

  // Errors → show the Output tab (also when one Megafarm drone fails while
  // the others keep running).
  const [prevStatus, setPrevStatus] = useState(status);
  const [prevErrorSeq, setPrevErrorSeq] = useState(engine.errorSeq);
  if (prevStatus !== status || prevErrorSeq !== engine.errorSeq) {
    const failed = (prevStatus !== status && status === "error") || prevErrorSeq !== engine.errorSeq;
    setPrevStatus(status);
    setPrevErrorSeq(engine.errorSeq);
    if (failed) {
      setInfoTab("log");
      if (!windows.info?.open) fm.setOpen("info", true);
    }
  }

  const editCode = useCallback(
    (id, code) => {
      exitDemo();
      fm.updateCode(id, code);
    },
    [fm, exitDemo],
  );

  const handleClearFarm = () => {
    if (confirm("Clear the farm? Every plant goes and all ground turns back into grassland.")) engine.clearFarm();
  };

  const importInputRef = useRef(null);

  const readStoredJson = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const handleExportData = () => {
    saveNow(); // flush the in-memory farm + files to storage first
    fm.saveNow();
    const data = buildExport({ save: readStoredJson(SAVE_KEY), files: readStoredJson(FILES_KEY) });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `semicolon-acres-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    pushLog("info", "💾 Exported game data (farm save + code files) as a JSON file.");
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const parsed = parseImport(await file.text());
    if (!parsed.ok) {
      pushLog("error", `Import failed: ${parsed.error}`);
      return;
    }
    const when = parsed.exportedAt ? ` exported ${parsed.exportedAt.slice(0, 10)}` : "";
    if (!confirm(`Import game data${when}? This REPLACES your current farm and code files.`)) return;
    if (parsed.save) engine.importSave(parsed.save);
    if (parsed.files) fm.importFiles(parsed.files);
    setRunningFileId(null);
    pushLog("info", "📥 Imported game data — farm and code files replaced.");
  };

  const handleResetSave = () => {
    if (confirm(`Start ${GAME_NAME} from scratch? Items, upgrades, the farm and ALL code files are deleted. This cannot be undone.`)) {
      engine.resetSave();
      fm.resetFiles();
      setRunningFileId(null);
    }
  };

  const handleLoadExample = (ex) => {
    const target = activeFile;
    if (target.code.trim() && target.code !== ex.code && !confirm(`Replace the code in “${target.name}” with the example “${ex.name}”?`)) return;
    editCode(target.id, ex.code);
    fm.setOpen(target.id, true);
    pushLog("info", `📄 Loaded example "${ex.name}" into ${target.name} (Ctrl+Z in the editor to undo)`);
  };

  const handleDelete = (id) => {
    const f = files.find((x) => x.id === id);
    if (!f || files.length <= 1) return;
    if (!confirm(`Delete the file “${f.name}”? Its code is lost.`)) return;
    fm.deleteFile(id);
  };

  const toggleWindow = (key) => fm.setOpen(key, !windows[key]?.open);

  const power = game.items.Power > 0 ? 2 : 1;
  const moveMs = Math.min(150, 200 / (W.speedMultiplier(game) * power));
  const affordable = Object.keys(game.unlocks).filter((id) => W.unlockStatus(game, id) === "affordable").length;
  const deliverable = (game.contracts?.contracts || []).filter((c) => isDeliverable(game, c)).length;

  const windowProps = (key, extra = {}) => ({
    floating: desktop,
    onFocus: () => fm.focus(key),
    onRect: (r) => fm.patchWindow(key, r),
    onMinimize: () => fm.patchWindow(key, { minimized: !windows[key]?.minimized }),
    onClose: () => fm.setOpen(key, false),
    ...extra,
  });

  const openFiles = files.filter((f) => windows[f.id]?.open);
  // On mobile, show windows in a stable order (files first, then Field Guide, Workshop, Almanac, Contracts, Arena, Online).
  const codeWindows = openFiles.map((f) => (
    <CodeWindow
      key={f.id}
      file={f}
      win={windows[f.id]}
      floating={desktop}
      windowProps={{ ...windowProps(String(f.id)), closeTitle: "Close (reopen from the + menu)" }}
      isRunning={running && runningFileId === f.id}
      paused={paused}
      lintGlobals={lintGlobalsFor(f.id)}
      ownFunctions={new Set(declared[f.id]?.fns || [])}
      onRun={() => runFile(f.id)}
      onStop={stop}
      onPause={() => setPaused(!paused)}
      onSave={handleSave}
      onChange={(code) => editCode(f.id, code)}
    />
  ));

  const infoWindow = windows.info?.open && (
    <FloatingWindow key="info" title="Field Guide" rect={windows.info} {...windowProps("info")} bodyClass="bg-[#2a2033] flex flex-col" mobileBodyClass="h-[28rem]">
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-gray-800 select-none" role="tablist">
        {[
          ["docs", "Guide"],
          ["log", `Output${logs.length ? ` (${logs.length})` : ""}`],
          ["files", `Files (${files.length})`],
          ["weather", "Weather"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={infoTab === id}
            onClick={() => setInfoTab(id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-md transition-colors ${
              infoTab === id ? "bg-[#3d3048] text-gray-100" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
        {infoTab === "log" && logs.length > 0 && (
          <button onClick={engine.clearLog} className="ml-auto text-[11px] text-gray-500 hover:text-red-400 px-2">
            Clear
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 text-gray-200">
        {infoTab === "docs" && <DocsPanel game={game} onLoadExample={handleLoadExample} targetName={activeFile.name} />}
        {infoTab === "log" && <LogPanel logs={logs} />}
        {infoTab === "weather" && <WeatherPanel game={game} />}
        {infoTab === "files" && (
          <FilesPanel
            files={files}
            windows={windows}
            active={activeFile.id}
            onToggle={(id, open) => fm.setOpen(id, open)}
            onRename={fm.renameFile}
            onDelete={handleDelete}
            onNew={fm.newFile}
          />
        )}
      </div>
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-t border-gray-800 text-[11px]">
        <button onClick={handleExportData} className="text-gray-400 hover:text-white" title="Download the farm and all code files as one JSON file">
          💾 Save Data
        </button>
        <button onClick={() => importInputRef.current?.click()} className="text-gray-400 hover:text-white" title="Replace the farm and all code files with a downloaded one">
          📥 Import Data
        </button>
        <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
        <button onClick={handleResetSave} className="ml-auto px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 text-white font-semibold">
          Reset Save…
        </button>
      </div>
    </FloatingWindow>
  );

  const unlocksWindow = windows.unlocks?.open && (
    <FloatingWindow
      key="unlocks"
      title={`Workshop${affordable ? ` · ${affordable} within reach` : ""}`}
      rect={windows.unlocks}
      {...windowProps("unlocks")}
      bodyClass="bg-[#fdf6ea] flex flex-col"
      mobileBodyClass="h-[28rem]"
    >
      <div className="flex-1 overflow-y-auto min-h-0 bg-stone-50">
        <UnlocksPanel game={game} onBuy={engine.buy} />
      </div>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-stone-200 bg-[#f8ecdb] text-xs text-stone-700">
        <button
          onClick={handleClearFarm}
          className="ml-auto px-3 py-1 rounded border border-stone-300 hover:border-red-400 hover:text-red-600 font-semibold"
          title="Clear the farm"
        >
          Clear Farm
        </button>
      </div>
    </FloatingWindow>
  );

  const recordsWindow = windows.records?.open && (
    <FloatingWindow key="records" title="Almanac" rect={windows.records} {...windowProps("records")} bodyClass="bg-[#fdf6ea] flex flex-col" mobileBodyClass="h-[28rem]">
      <div className="flex-1 overflow-y-auto min-h-0 bg-stone-50">
        <RecordsPanel game={game} stats={view.stats} seedDraft={seedDraft} onSeedDraft={setSeedDraft} onSetSeed={engine.setPendingSeed} onSetDinoSeed={engine.setPendingDinoSeed} />
      </div>
    </FloatingWindow>
  );

  const contractsWindow = windows.contracts?.open && (
    <FloatingWindow
      key="contracts"
      title={`Contracts${deliverable ? ` · ${deliverable} ready` : ""}`}
      rect={windows.contracts}
      {...windowProps("contracts")}
      bodyClass="bg-[#fdf6ea] flex flex-col"
      mobileBodyClass="h-[24rem]"
    >
      <div className="flex-1 overflow-y-auto min-h-0 bg-stone-50">
        <ContractsPanel game={game} onDeliver={engine.deliverContract} />
      </div>
    </FloatingWindow>
  );

  const arenaWindow = windows.arena?.open && (
    <FloatingWindow
      key="arena"
      title={`Arena · rating ${game.arena?.rating ?? 1000}`}
      rect={windows.arena}
      {...windowProps("arena")}
      bodyClass="bg-[#fdf6ea] flex flex-col"
      mobileBodyClass="h-[30rem]"
    >
      <div className="flex-1 overflow-y-auto min-h-0 bg-stone-50">
        <ArenaPanel game={game} files={files} activeId={activeFile.id} demo={demo} onRecord={engine.recordArenaMatch} onExitDemo={exitDemo} />
      </div>
    </FloatingWindow>
  );

  const onlineWindow = windows.online?.open && (
    <FloatingWindow key="online" title="Online" rect={windows.online} {...windowProps("online")} bodyClass="bg-[#fdf6ea] flex flex-col" mobileBodyClass="h-[32rem]">
      <div className="flex-1 overflow-y-auto min-h-0 bg-stone-50">
        <OnlinePanel
          files={files}
          activeId={activeFile.id}
          demo={demo}
          pushLog={pushLog}
          onExitDemo={exitDemo}
        />
      </div>
    </FloatingWindow>
  );

  const tabs = [
    ["info", "Field Guide", "How everything works, program output, files, weather"],
    ["unlocks", "Workshop", `Upgrades${affordable ? ` (${affordable} within reach)` : ""}`, affordable],
    ["records", "Almanac", "Your best maze and dinosaur runs, attempts, replay seed"],
    ["contracts", "Contracts", `Today's orders${deliverable ? ` (${deliverable} ready to deliver)` : ""}`, deliverable],
    ["arena", "Arena", "Race a program against a rival (ELO rating)"],
    ["online", "Online", "Your online identity, friend challenges and match history"],
  ];

  return (
    <div
      className={`acres farmer-bg relative w-full min-h-screen md:h-screen md:overflow-hidden text-gray-200 font-sans flex flex-col md:block ${
        paused ? "farmer-paused" : ""
      }`}
    >
      {shortcutsOpen && (
        <div className="relative z-[9500]">
          <ShortcutsModal open onClose={() => setShortcutsOpen(false)} sections={SHORTCUT_SECTIONS} />
        </div>
      )}

      {/* Top bar: the name on the left, every window as a labelled tab. */}
      <header className="relative z-[8000] md:absolute md:inset-x-0 md:top-0 bg-[#2e2438] text-white flex flex-col md:flex-row md:items-stretch md:h-12">
        <h1 className="flex items-center gap-2 px-4 h-11 md:h-full shrink-0 text-[16px] font-bold tracking-tight">
          {Glyph.brand}
          {GAME_NAME}
        </h1>
        <nav aria-label="Windows" className="flex items-stretch h-10 md:h-full min-w-0 overflow-x-auto md:ml-auto">
          {tabs.map(([key, label, title, badge]) => (
            <NavTab key={key} label={label} title={title} badge={badge} active={windows[key]?.open} onClick={() => toggleWindow(key)} />
          ))}
          <NavTab label="Files" title="Code files: new / reopen / delete" active={menuOpen} onClick={() => setMenuOpen((o) => !o)} />
          <button onClick={() => setShortcutsOpen(true)} className="shrink-0 px-3 text-[13px] text-[#d9cbe0] hover:text-white" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
            ⌨
          </button>
          <a href={ROUTES.playground} className="shrink-0 px-3 flex items-center text-[13px] text-[#d9cbe0] hover:text-white" title="Back to the JS Playground">
            ← Playground
          </a>
        </nav>
        {menuOpen && (
          <FilesMenu
            files={files}
            windows={windows}
            onClose={() => setMenuOpen(false)}
            onNew={() => {
              setMenuOpen(false);
              fm.newFile();
            }}
            onToggle={(id) => {
              setMenuOpen(false);
              fm.setOpen(id, true);
            }}
            onDelete={(id) => {
              setMenuOpen(false);
              handleDelete(id);
            }}
          />
        )}
      </header>

      {/* Left rail: the store room. */}
      <div className="relative z-[10] p-3 pb-0 md:p-0 md:absolute md:left-4 md:top-16 md:bottom-4">
        <StoreRoom items={game.items} />
      </div>

      {/* Farm, between the rail and the code; the info strip sits above it. */}
      <div className="relative w-full h-[92vw] max-h-[72vh] md:max-h-none md:h-auto md:absolute md:left-[140px] md:top-12 md:bottom-0 md:w-[calc(55%-140px)]">
        <div className="absolute left-3 right-3 top-2 md:top-4 z-[5]">
          <StatusPill game={game} stats={view.stats} status={status} paused={paused} demo={demo} toast={toast} />
        </div>
        <div className="absolute inset-0 pt-10 md:pt-12">
          <FarmBoardView game={game} moveMs={moveMs} paused={paused} status={status} />
        </div>
      </div>

      {/* Windows: floating on desktop, stacked under the farm on mobile. */}
      {desktop ? (
        <>
          {codeWindows}
          {infoWindow}
          {unlocksWindow}
          {recordsWindow}
          {contractsWindow}
          {arenaWindow}
          {onlineWindow}
        </>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          {codeWindows}
          {infoWindow}
          {unlocksWindow}
          {recordsWindow}
          {contractsWindow}
          {arenaWindow}
          {onlineWindow}
        </div>
      )}
    </div>
  );
}
