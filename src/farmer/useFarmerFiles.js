// Code files + floating-window layout for the Farmer page.
//  farmer_files_v1 : { v: 1, nextId, files: [{ id, name, code }] }
//  farmer_ui_v1    : { v: 1, zTop, active, windows: { [fileId | "info" | "unlocks" | "records" | "contracts" | "arena"]: { x, y, w, h, z, minimized, open } } }
//  farmer_code     : kept as a mirror of the FIRST file (the migrated/seeded
//                    "crops" file), for backward compatibility.
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CODE, HELPER_CODE } from "./examples.js";

export const FILES_KEY = "farmer_files_v1";
export const UI_KEY = "farmer_ui_v1";
export const CODE_KEY = "farmer_code";
export const MIN_W = 320;
export const MIN_H = 200;
export const HEADER_H = 36;

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (e) {
    void e;
  }
};

export function seedFiles() {
  return {
    nextId: 3,
    files: [
      { id: 1, name: "crops", code: DEFAULT_CODE },
      { id: 2, name: "f0", code: HELPER_CODE },
    ],
  };
}

function loadFiles() {
  try {
    const data = JSON.parse(read(FILES_KEY));
    if (data && data.v === 1 && Array.isArray(data.files) && data.files.length) {
      const files = data.files
        .filter((f) => f && Number.isInteger(f.id) && typeof f.code === "string")
        .map((f) => ({ id: f.id, name: String(f.name || `f${f.id}`).slice(0, 32), code: f.code }));
      if (files.length) {
        const maxId = Math.max(...files.map((f) => f.id));
        return { files, nextId: Math.max(Number(data.nextId) || 0, maxId + 1), migrated: false };
      }
    }
  } catch (e) {
    void e;
  }
  // Migration from v1 (single `farmer_code` string) → file #1 "crops".
  const legacy = read(CODE_KEY);
  if (legacy !== null) return { files: [{ id: 1, name: "crops", code: legacy }], nextId: 2, migrated: true };
  return { ...seedFiles(), migrated: false };
}

const viewport = () => ({
  vw: typeof window !== "undefined" ? window.innerWidth : 1280,
  vh: typeof window !== "undefined" ? window.innerHeight : 800,
});

export function clampRect(r, { vw, vh } = viewport()) {
  const w = Math.max(MIN_W, Math.min(r.w, vw));
  const h = Math.max(MIN_H, Math.min(r.h, vh));
  return {
    ...r,
    w,
    h,
    x: Math.round(Math.max(0, Math.min(r.x, vw - w))),
    y: Math.round(Math.max(0, Math.min(r.y, vh - HEADER_H))),
  };
}

/** Default (first-run) rect for a window key; `index` cascades extra files. */
export function defaultRect(key, files, vp = viewport()) {
  const { vw, vh } = vp;
  const first = files[0]?.id;
  const second = files[1]?.id;
  let r;
  if (key === "info") r = { x: vw * 0.06, y: vh * 0.13, w: Math.min(560, vw * 0.42), h: vh * 0.72, open: false };
  else if (key === "unlocks") r = { x: vw * 0.36, y: vh * 0.1, w: Math.min(440, vw * 0.34), h: vh * 0.76, open: false };
  else if (key === "records") r = { x: vw * 0.4, y: vh * 0.12, w: Math.min(420, vw * 0.32), h: vh * 0.7, open: false };
  else if (key === "contracts") r = { x: vw * 0.44, y: vh * 0.14, w: Math.min(400, vw * 0.3), h: vh * 0.56, open: false };
  else if (key === "arena") r = { x: vw * 0.48, y: vh * 0.12, w: Math.min(420, vw * 0.32), h: vh * 0.72, open: false };
  else if (String(key) === String(first)) r = { x: vw * 0.52, y: vh * 0.18, w: vw * 0.46, h: vh * 0.62, open: true };
  else if (String(key) === String(second)) r = { x: vw * 0.62, y: vh * 0.78, w: vw * 0.26, h: vh * 0.2, open: true };
  else {
    const i = Math.max(0, files.findIndex((f) => String(f.id) === String(key)));
    r = { x: vw * 0.3 + 28 * (i % 6), y: vh * 0.16 + 28 * (i % 6), w: vw * 0.36, h: vh * 0.42, open: true };
  }
  return { ...clampRect(r, vp), z: 1, minimized: false, open: r.open };
}

function loadUi(files) {
  let data = null;
  try {
    data = JSON.parse(read(UI_KEY));
  } catch (e) {
    void e;
  }
  const saved = data && data.v === 1 && data.windows && typeof data.windows === "object" ? data.windows : {};
  const windows = {};
  for (const key of [...files.map((f) => String(f.id)), "info", "unlocks", "records", "contracts", "arena"]) {
    const s = saved[key];
    if (s && [s.x, s.y, s.w, s.h].every(Number.isFinite)) {
      windows[key] = {
        ...clampRect({ x: s.x, y: s.y, w: s.w, h: s.h }),
        z: Number(s.z) || 1,
        minimized: !!s.minimized,
        open: !!s.open,
      };
    } else {
      windows[key] = defaultRect(key, files);
    }
  }
  const zTop = Math.max(Number(data?.zTop) || 1, ...Object.values(windows).map((w) => w.z));
  const active = files.some((f) => f.id === data?.active) ? data.active : files[0].id;
  return { windows, zTop, active };
}

const uniqueName = (files, base, exceptId) => {
  const taken = new Set(files.filter((f) => f.id !== exceptId).map((f) => f.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
};

export default function useFarmerFiles() {
  const [init] = useState(() => {
    const f = loadFiles();
    return { ...f, ui: loadUi(f.files) };
  });
  const [files, setFiles] = useState(init.files);
  const [ui, setUi] = useState(init.ui);
  const nextIdRef = useRef(init.nextId);
  const migratedRef = useRef(init.migrated);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  });

  // Persist files (+ the farmer_code mirror) — debounced.
  useEffect(() => {
    const id = setTimeout(() => {
      write(FILES_KEY, JSON.stringify({ v: 1, nextId: nextIdRef.current, files }));
      if (files[0]) write(CODE_KEY, files[0].code);
    }, 300);
    return () => clearTimeout(id);
  }, [files]);

  useEffect(() => {
    const id = setTimeout(() => write(UI_KEY, JSON.stringify({ v: 1, ...ui })), 300);
    return () => clearTimeout(id);
  }, [ui]);

  // Keep windows inside the viewport when it shrinks.
  useEffect(() => {
    const onResize = () =>
      setUi((u) => ({
        ...u,
        windows: Object.fromEntries(Object.entries(u.windows).map(([k, w]) => [k, { ...w, ...clampRect(w) }])),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const saveNow = useCallback(() => {
    write(FILES_KEY, JSON.stringify({ v: 1, nextId: nextIdRef.current, files: filesRef.current }));
    if (filesRef.current[0]) write(CODE_KEY, filesRef.current[0].code);
  }, []);

  const updateCode = useCallback((id, code) => {
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, code } : f)));
  }, []);

  const focus = useCallback((key) => {
    setUi((u) => {
      const w = u.windows[key];
      if (!w) return u;
      const isFile = !Number.isNaN(Number(key));
      const active = isFile ? Number(key) : u.active;
      // Already alone on top → nothing to do (avoids re-renders on every click).
      const onTop = w.z === u.zTop && Object.entries(u.windows).every(([k, o]) => k === String(key) || o.z < w.z);
      if (onTop && u.active === active) return u;
      const zTop = onTop ? u.zTop : u.zTop + 1;
      return { ...u, zTop, active, windows: { ...u.windows, [key]: { ...w, z: zTop } } };
    });
  }, []);

  const patchWindow = useCallback((key, patch) => {
    setUi((u) => {
      const w = u.windows[key];
      if (!w) return u;
      return { ...u, windows: { ...u.windows, [key]: { ...w, ...patch } } };
    });
  }, []);

  const setOpen = useCallback(
    (key, open) => {
      key = String(key);
      setUi((u) => {
        const w = u.windows[key] || defaultRect(key, filesRef.current);
        const zTop = open ? u.zTop + 1 : u.zTop;
        const next = { ...w, open, minimized: open ? false : w.minimized, z: open ? zTop : w.z };
        const isFile = !Number.isNaN(Number(key));
        return {
          ...u,
          zTop,
          active: open && isFile ? Number(key) : u.active,
          windows: { ...u.windows, [key]: open ? { ...next, ...clampRect(next) } : next },
        };
      });
    },
    [],
  );

  const newFile = useCallback(() => {
    const id = nextIdRef.current++;
    const fs = filesRef.current;
    let n = 0;
    while (fs.some((f) => f.name === `f${n}`)) n++;
    const file = { id, name: `f${n}`, code: `// ${`f${n}`} — helper file.\n// Its top-level functions can be used from any other file.\n` };
    const next = [...fs, file];
    setFiles(next);
    setUi((u) => {
      const zTop = u.zTop + 1;
      return { ...u, zTop, active: id, windows: { ...u.windows, [id]: { ...defaultRect(id, next), z: zTop } } };
    });
    return id;
  }, []);

  const renameFile = useCallback((id, name) => {
    const clean = String(name).trim().slice(0, 32);
    if (!clean) return false;
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, name: uniqueName(fs, clean, id) } : f)));
    return true;
  }, []);

  const deleteFile = useCallback((id) => {
    const fs = filesRef.current;
    if (fs.length <= 1) return false;
    const rest = fs.filter((f) => f.id !== id);
    setFiles(rest);
    setUi((u) => {
      const windows = { ...u.windows };
      delete windows[id];
      return { ...u, windows, active: u.active === id ? rest[0].id : u.active };
    });
    return true;
  }, []);

  /** Replace all code files with an imported set (already sanitized by
   *  saveData.parseImport). Window layout falls back to defaults for the
   *  imported files — layout is not part of an export. */
  const importFiles = useCallback((data) => {
    nextIdRef.current = data.nextId;
    setFiles(data.files);
    setUi(loadUi(data.files));
  }, []);

  /** Reset Save: back to the two seeded files and the default layout. */
  const resetFiles = useCallback(() => {
    const seed = seedFiles();
    nextIdRef.current = seed.nextId;
    write(FILES_KEY, null);
    write(UI_KEY, null);
    write(CODE_KEY, null);
    setFiles(seed.files);
    setUi(loadUi(seed.files));
  }, []);

  return {
    files,
    ui,
    migrated: migratedRef.current,
    updateCode,
    focus,
    patchWindow,
    setOpen,
    newFile,
    renameFile,
    deleteFile,
    importFiles,
    resetFiles,
    saveNow,
  };
}
