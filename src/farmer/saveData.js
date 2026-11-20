// Export / import of the player's data as a single JSON file.
// "Game data" = the world save (`farmer_save_v1`) + the code files
// (`farmer_files_v1`). Window layout (`farmer_ui_v1`) is per-machine UI
// state and is deliberately NOT exported.
export const EXPORT_FORMAT = "js-farmer-save";
export const EXPORT_VERSION = 1;

export function buildExport({ save = null, files = null } = {}, now = new Date()) {
  return {
    format: EXPORT_FORMAT,
    v: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    save,
    files,
  };
}

/** Same acceptance rules as the files loader: v1, non-empty file list,
 *  integer ids, string code; names trimmed to 32 chars. Returns a clean
 *  `{ v: 1, nextId, files }` or null. */
export function sanitizeFilesData(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.files) || !data.files.length) return null;
  const files = data.files
    .filter((f) => f && Number.isInteger(f.id) && typeof f.code === "string")
    .map((f) => ({ id: f.id, name: String(f.name || `f${f.id}`).slice(0, 32), code: f.code }));
  if (!files.length) return null;
  const maxId = Math.max(...files.map((f) => f.id));
  return { v: 1, nextId: Math.max(Number(data.nextId) || 0, maxId + 1), files };
}

/** Parse an import file's text. The save itself is only shape-checked here;
 *  `world.deserialize` sanitizes every field when it is applied. */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!data || data.format !== EXPORT_FORMAT || data.v !== EXPORT_VERSION) {
    return { ok: false, error: "That file is not a JS Farmer save export." };
  }
  const save = data.save && typeof data.save === "object" ? data.save : null;
  if (save && save.v !== 1) return { ok: false, error: "The save inside that file has an unknown version." };
  let files = null;
  if (data.files) {
    files = sanitizeFilesData(data.files);
    if (!files) return { ok: false, error: "The code files inside that file are damaged." };
  }
  if (!save && !files) return { ok: false, error: "That file contains no save and no code files." };
  return { ok: true, save, files, exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : null };
}
