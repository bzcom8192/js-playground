// JS Farmer — multi-file programs (pure, unit-tested in node).
//
// Running file F: every OTHER file contributes only its top-level function
// declarations (TFWR's `from helper import *`), prepended BEFORE F's code.
// Name collisions: F's own top-level names win (a helper with the same name is
// skipped — a helper `const f = () => …` followed by F's `function f` would
// otherwise be a redeclaration SyntaxError). Between helper files, the first
// file (in file-list order) wins.
//
// TypeScript-style annotations are stripped ONCE per file here (stripTypes
// keeps lines and columns), so declaration extraction, the auto-await
// transform and the runtime only ever see plain JavaScript.

import { extractDeclarations, listDeclarations, topLevelNames } from "./transform.js";
import { stripTypes } from "./stripTypes.js";

const lineCount = (s) => s.split("\n").length;

/**
 * buildProgram(files, mainId) → { code, segments, mainFile }
 *  files: [{ id, name, code }]
 *  segments: [{ fileId, name, code, startLine, lines }] — startLine is 1-based
 *            in `code`; the main file is the last segment. Segment code is
 *            the type-stripped JavaScript.
 *  mainFile: the main file as passed in (original, unstripped code).
 */
export function buildProgram(rawFiles, mainId) {
  const files = rawFiles.map((f) => ({ ...f, code: stripTypes(f.code) }));
  const main = files.find((f) => f.id === mainId);
  if (!main) throw new Error(`No file with id ${mainId}`);
  const taken = topLevelNames(main.code);
  const segments = [];
  let line = 1;
  for (const f of files) {
    if (f.id === mainId) continue;
    const decls = listDeclarations(f.code).filter((d) => d.kind === "function" && !taken.has(d.name));
    if (!decls.length) continue;
    const code = extractDeclarations(f.code, taken);
    decls.forEach((d) => taken.add(d.name));
    segments.push({ fileId: f.id, name: f.name, code, startLine: line, lines: lineCount(code) });
    line += lineCount(code);
  }
  segments.push({ fileId: main.id, name: main.name, code: main.code, startLine: line, lines: lineCount(main.code) });
  return { code: segments.map((s) => s.code).join("\n"), segments, mainFile: rawFiles.find((f) => f.id === mainId) };
}

/** Maps a 1-based line of the combined program back to { name, line, main }. */
export function mapLine(segments, line) {
  for (const s of segments) {
    if (line >= s.startLine && line < s.startLine + s.lines) {
      return { fileId: s.fileId, name: s.name, line: line - s.startLine + 1, main: s === segments[segments.length - 1] };
    }
  }
  return null;
}
