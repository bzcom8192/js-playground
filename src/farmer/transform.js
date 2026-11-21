// JS Farmer — source transform (pure string → string, unit-tested in node).
//
// Lets the player write TFWR-style blocking code without `await`:
//
//   while (true) { if (can_harvest()) harvest(); move(North); }
//
// becomes
//
//   while ((await __loopGuard(), (true))) { if (can_harvest()) await harvest(); await move(North); }
//
// Rules (token-aware: strings, template literals, comments and regex literals
// are never touched):
//  1. Calls to drone ACTIONS (harvest, plant, move, …) get `await `.
//  2. A function (declaration, expression, arrow, or object/class method)
//     becomes `async` when it needs to: it calls an action or another async
//     user function, contains a user-written `await`, or — for *named*
//     functions — contains a loop (so waiting loops can yield). Computed as a
//     fixpoint so helpers calling helpers work in any order. Calls to those
//     functions (by name, or `.name(` for methods) get `await ` too.
//     Anonymous callbacks that don't need it stay synchronous, so
//     `arr.sort((a, b) => a - b)` keeps working.
//  3. Loop guards: `while (c)` → `while ((await __loopGuard(), (c)))`,
//     `for (a; c; b)` → `for (a; (await __loopGuard(), (c)); b)`,
//     `for (x of y)` → `for await (x of __loopIter(y))`,
//     `for (k in o)` → `for await (k of __loopKeys(o))`.
//     The guard lives in the loop header, so it runs on every iteration
//     (including after `continue`) without having to find the end of a
//     brace-less loop body. `do … while (c)` is covered by its `while`.
//     Loops inside synchronous callbacks get `__loopGuardSync()` instead.
//  4. Property calls (`obj.move()`) of action names are never rewritten.
//  5. No newlines are ever inserted, so error line numbers match the editor.

export const ACTIONS = [
  "harvest",
  "plant",
  "move",
  "till",
  "clear",
  "swap",
  "use_item",
  "trade",
  "unlock",
  "do_a_flip",
  "spawn_drone",
];
const ACTION_SET = new Set(ACTIONS);

const REGEX_AFTER_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const NOT_METHOD_NAMES = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "with",
  "typeof",
  "await",
  "yield",
]);

// Longest first.
const PUNCTS = [
  ">>>=",
  "...",
  "===",
  "!==",
  "**=",
  "<<=",
  ">>=",
  ">>>",
  "&&=",
  "||=",
  "??=",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "**",
  "<<",
  ">>",
];

const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$‌‍]/u;

// ---------- tokenizer ----------

function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q && src[j] !== "\n") {
    if (src[j] === "\\") j++;
    j++;
  }
  return Math.min(j + 1, src.length);
}

// Skip a `${ … }` expression starting right after "${"; returns index after "}".
function skipTemplateExpr(src, i) {
  let depth = 1;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === "'" || c === '"') {
      j = skipString(src, j);
      continue;
    }
    if (c === "`") {
      j = skipTemplate(src, j);
      continue;
    }
    if (c === "/" && src[j + 1] === "/") {
      const e = src.indexOf("\n", j);
      j = e < 0 ? src.length : e;
      continue;
    }
    if (c === "/" && src[j + 1] === "*") {
      const e = src.indexOf("*/", j + 2);
      j = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return src.length;
}

function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") return j + 1;
    if (c === "$" && src[j + 1] === "{") {
      j = skipTemplateExpr(src, j + 2);
      continue;
    }
    j++;
  }
  return src.length;
}

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.type === "ident") return REGEX_AFTER_KEYWORDS.has(prev.value);
  if (prev.type === "punct") {
    return ![")", "]", "}", "++", "--"].includes(prev.value);
  }
  return false; // after num / str / regex
}

function scanRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\n") return -1;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

export function tokenize(src) {
  const tokens = [];
  let prevSig = null;
  let i = 0;
  const n = src.length;
  const push = (type, end) => {
    const t = { type, value: src.slice(i, end), start: i, end };
    tokens.push(t);
    if (type !== "ws" && type !== "comment") prevSig = t;
    i = end;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(src[j])) j++;
      push("ws", j);
    } else if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      push("comment", e < 0 ? n : e);
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      push("comment", e < 0 ? n : e + 2);
    } else if (c === '"' || c === "'") {
      push("str", skipString(src, i));
    } else if (c === "`") {
      push("str", skipTemplate(src, i));
    } else if (c === "/" && regexAllowed(prevSig) && scanRegex(src, i) > 0) {
      push("regex", scanRegex(src, i));
    } else if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_CONTINUE.test(src[j])) j++;
      push("ident", j);
    } else if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] || ""))) {
      let j = i + 1;
      while (j < n) {
        if (/[eE]/.test(src[j]) && /[+-]/.test(src[j + 1] || "") && !/^0[xX]/.test(src.slice(i, j))) {
          j += 2;
        } else if (/[\w.]/.test(src[j])) j++;
        else break;
      }
      push("num", j);
    } else {
      const p = PUNCTS.find((s) => src.startsWith(s, i));
      push("punct", i + (p ? p.length : 1));
    }
  }
  return tokens;
}

// ---------- analysis ----------

const OPEN = { "(": ")", "[": "]", "{": "}" };
const CLOSE = { ")": "(", "]": "[", "}": "{" };
const OBJECT_LITERAL_BEFORE = new Set([
  "=",
  "(",
  ",",
  ":",
  "[",
  "?",
  "||",
  "&&",
  "??",
  "=>",
  "return",
]);

export function transform(src) {
  const all = tokenize(src);
  const S = all.filter((t) => t.type !== "ws" && t.type !== "comment");
  const N = S.length;
  const val = (k) => (k >= 0 && k < N ? S[k].value : undefined);
  const isPunct = (k, v) => k >= 0 && k < N && S[k].type === "punct" && S[k].value === v;
  const isIdent = (k, v) =>
    k >= 0 && k < N && S[k].type === "ident" && (v === undefined || S[k].value === v);

  // Bracket matching + parent opener of every token.
  const match = new Array(N).fill(-1);
  const parent = new Array(N).fill(-1);
  const stack = [];
  for (let k = 0; k < N; k++) {
    parent[k] = stack.length ? stack[stack.length - 1] : -1;
    if (S[k].type !== "punct") continue;
    const v = S[k].value;
    if (OPEN[v]) stack.push(k);
    else if (CLOSE[v]) {
      // tolerate mismatches: pop until the right opener (best effort)
      let o = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (val(stack[s]) === CLOSE[v]) {
          o = stack[s];
          stack.length = s;
          break;
        }
      }
      if (o >= 0) {
        match[o] = k;
        match[k] = o;
        parent[k] = parent[o];
      }
    }
  }

  const isClassBody = (o) => {
    for (let k = o - 1, steps = 0; k >= 0 && steps < 12; k--, steps++) {
      if (isIdent(k, "class")) return true;
      if (["{", "}", ";", "=>"].includes(val(k)) && S[k].type === "punct") return false;
    }
    return false;
  };
  const isObjectLiteral = (o) => {
    const p = S[o - 1];
    if (!p) return false;
    return OBJECT_LITERAL_BEFORE.has(p.value);
  };

  // ---- find functions ----
  const fns = [];
  const nameDefs = new Set(); // sig-token indices that are definition names
  const nameFromAssignment = (before, fn) => {
    // `name = <fn>`  or  `name: <fn>`
    if (isPunct(before, "=") && isIdent(before - 1)) {
      if (isPunct(before - 2, ".") || isPunct(before - 2, "?.")) fn.methodName = val(before - 1);
      else fn.name = val(before - 1);
    } else if (isPunct(before, ":") && isIdent(before - 1)) {
      fn.methodName = val(before - 1);
    }
  };

  for (let k = 0; k < N; k++) {
    const t = S[k];
    if (t.type === "ident" && t.value === "function" && !isPunct(k - 1, ".")) {
      const fn = {
        asyncPos: t.start,
        alreadyAsync: isIdent(k - 1, "async"),
        noAsync: false,
        name: null,
        methodName: null,
      };
      let j = k + 1;
      if (isPunct(j, "*")) {
        fn.noAsync = true; // generators stay generators
        j++;
      }
      if (isIdent(j)) {
        fn.name = val(j);
        nameDefs.add(j);
        j++;
      } else {
        nameFromAssignment(fn.alreadyAsync ? k - 2 : k - 1, fn);
      }
      if (!isPunct(j, "(") || match[j] < 0) continue;
      const b = match[j] + 1;
      if (!isPunct(b, "{") || match[b] < 0) continue;
      fn.bodyStart = b;
      fn.bodyEnd = match[b];
      fns.push(fn);
    } else if (t.type === "punct" && t.value === "=>") {
      let ps;
      if (isPunct(k - 1, ")") && match[k - 1] >= 0) ps = match[k - 1];
      else if (isIdent(k - 1)) ps = k - 1;
      else continue;
      const fn = {
        asyncPos: S[ps].start,
        alreadyAsync: isIdent(ps - 1, "async"),
        noAsync: false,
        name: null,
        methodName: null,
      };
      nameFromAssignment(fn.alreadyAsync ? ps - 2 : ps - 1, fn);
      if (isPunct(k + 1, "{") && match[k + 1] >= 0) {
        fn.bodyStart = k + 1;
        fn.bodyEnd = match[k + 1];
      } else {
        // expression body: up to the first `,` / `;` / closer at this depth
        let e = k + 1;
        while (e < N) {
          const v = S[e].type === "punct" ? S[e].value : null;
          if (v && OPEN[v] && match[e] > e) {
            e = match[e] + 1;
            continue;
          }
          if (v && (CLOSE[v] || v === "," || v === ";")) break;
          e++;
        }
        fn.bodyStart = k + 1;
        fn.bodyEnd = e - 1;
      }
      fns.push(fn);
    } else if (
      t.type === "ident" &&
      !NOT_METHOD_NAMES.has(t.value) &&
      isPunct(k + 1, "(") &&
      match[k + 1] > 0 &&
      isPunct(match[k + 1] + 1, "{") &&
      !isPunct(k - 1, ".") &&
      parent[k] >= 0 &&
      isPunct(parent[k], "{") &&
      (isClassBody(parent[k]) || isObjectLiteral(parent[k]))
    ) {
      // object / class method shorthand:  name(args) { … }
      const b = match[k + 1] + 1;
      if (match[b] < 0) continue;
      const prev = val(k - 1);
      const fn = {
        asyncPos: t.start,
        alreadyAsync: prev === "async",
        noAsync: prev === "get" || prev === "set" || prev === "*" || t.value === "constructor",
        name: null,
        methodName: t.value,
        bodyStart: b,
        bodyEnd: match[b],
      };
      nameDefs.add(k);
      fns.push(fn);
    }
  }

  // Owner function of every token (innermost function body containing it).
  const owner = new Array(N).fill(-1);
  fns
    .map((f, i) => i)
    .sort((a, b) => fns[b].bodyEnd - fns[b].bodyStart - (fns[a].bodyEnd - fns[a].bodyStart))
    .forEach((i) => {
      for (let k = fns[i].bodyStart; k <= fns[i].bodyEnd; k++) owner[k] = i;
    });

  // ---- call sites, loops, user awaits ----
  const calls = []; // { k, name, prop }
  const loops = []; // k of while/for
  const userAwaits = [];
  for (let k = 0; k < N; k++) {
    const t = S[k];
    if (t.type !== "ident") continue;
    const afterDot = isPunct(k - 1, ".") || isPunct(k - 1, "?.");
    if ((t.value === "while" || t.value === "for") && !afterDot && isPunct(k + 1, "(")) {
      loops.push(k);
      continue;
    }
    if (t.value === "for" && isIdent(k + 1, "await")) continue;
    if (t.value === "await" && !afterDot) {
      userAwaits.push(k);
      continue;
    }
    if (!isPunct(k + 1, "(") || nameDefs.has(k)) continue;
    if (isIdent(k - 1, "function") || isIdent(k - 1, "new")) continue;
    calls.push({ k, name: t.value, prop: afterDot });
  }

  // ---- fixpoint: which functions must be async ----
  const needy = fns.map((f) => f.alreadyAsync);
  const asyncNames = new Set();
  const asyncMethods = new Set();
  const markNeedy = (i) => {
    if (i < 0 || needy[i] || fns[i].noAsync) return false;
    needy[i] = true;
    return true;
  };
  const register = () => {
    fns.forEach((f, i) => {
      if (!needy[i]) return;
      if (f.name) {
        asyncNames.add(f.name);
        asyncMethods.add(f.name);
      }
      if (f.methodName) asyncMethods.add(f.methodName);
    });
  };
  for (const k of userAwaits) markNeedy(owner[k]);
  for (const k of loops) {
    const i = owner[k];
    if (i >= 0 && (fns[i].name || fns[i].methodName)) markNeedy(i);
  }
  const callAwaits = (c) =>
    c.prop ? asyncMethods.has(c.name) : ACTION_SET.has(c.name) || asyncNames.has(c.name);
  for (let changed = true; changed; ) {
    changed = false;
    register();
    for (const c of calls) {
      if (callAwaits(c) && markNeedy(owner[c.k])) changed = true;
    }
  }
  register();
  const asyncCtx = (k) => owner[k] < 0 || needy[owner[k]];

  // ---- edits ----
  const edits = []; // { pos, order, text, del }
  const ins = (pos, text, order) => edits.push({ pos, order, text, del: 0 });

  fns.forEach((f, i) => {
    if (needy[i] && !f.alreadyAsync && !f.noAsync) ins(f.asyncPos, "async ", 2);
  });

  const isValueIdent = (k) =>
    isIdent(k) && !REGEX_AFTER_KEYWORDS.has(val(k)) && !NOT_METHOD_NAMES.has(val(k));
  const chainStart = (k) => {
    // k = index of the method name; walk back over `a.b[0].c(…).`
    let s = k;
    while (isPunct(s - 1, ".") || isPunct(s - 1, "?.")) {
      let p = s - 2; // last token of the object expression
      while (p >= 0 && (isPunct(p, ")") || isPunct(p, "]")) && match[p] >= 0) {
        const o = match[p];
        // `x(…)` / `x[…]` → keep walking; a bare `( … )` group starts the chain
        if (isValueIdent(o - 1) || isPunct(o - 1, ")") || isPunct(o - 1, "]")) p = o - 1;
        else {
          p = o;
          break;
        }
      }
      if (p < 0) break;
      s = p;
      if (!isValueIdent(s)) break;
    }
    if (isIdent(s - 1, "new")) s--;
    return s;
  };

  for (const c of calls) {
    if (!callAwaits(c) || !asyncCtx(c.k)) continue;
    const s = c.prop ? chainStart(c.k) : c.k;
    if (isIdent(s - 1, "await")) continue;
    ins(S[s].start, "await ", 2);
  }

  for (const k of loops) {
    const open = k + 1;
    const close = match[open];
    if (close < 0) continue;
    const isAsync = asyncCtx(k);
    const guard = isAsync ? "await __loopGuard()" : "__loopGuardSync()";
    if (val(k) === "while") {
      if (close === open + 1) continue; // `while ()` – syntax error anyway
      ins(S[open + 1].start, `(${guard}, (`, 1);
      ins(S[close].start, "))", 0);
      continue;
    }
    // for (…)
    const semis = [];
    let kw = -1;
    for (let j = open + 1; j < close; j++) {
      if (parent[j] !== open) continue;
      if (isPunct(j, ";")) semis.push(j);
      else if (kw < 0 && (isIdent(j, "of") || isIdent(j, "in")) && j > open + 1) kw = j;
    }
    if (semis.length >= 2) {
      const [s1, s2] = semis;
      if (s2 === s1 + 1) ins(S[s1].end, ` (${guard}, true)`, 1);
      else {
        ins(S[s1 + 1].start, `(${guard}, (`, 1);
        ins(S[s2].start, "))", 0);
      }
    } else if (kw > 0 && isAsync && kw + 1 < close) {
      ins(S[k].end, " await", 1);
      if (val(kw) === "in") {
        edits.push({ pos: S[kw].start, order: 1, text: "of", del: S[kw].end - S[kw].start });
        ins(S[kw + 1].start, "__loopKeys(", 1);
      } else {
        ins(S[kw + 1].start, "__loopIter(", 1);
      }
      ins(S[close].start, ")", 0);
    }
  }

  edits.sort((a, b) => a.pos - b.pos || a.order - b.order);
  let out = "";
  let cur = 0;
  for (const e of edits) {
    if (e.pos < cur) continue; // overlapping edit (shouldn't happen) – skip
    out += src.slice(cur, e.pos) + e.text;
    cur = e.pos + e.del;
  }
  out += src.slice(cur);
  return out;
}

// ---------- multi-file programs: top-level declarations ----------
//
// Running file F runs F's code; every other file contributes ONLY its
// top-level function declarations (like TFWR's `from helper import *`):
//   function name(…) { … }            (also async / generator)
//   const|let|var name = (…) => …     (also `x => …`, `async (…) => …`)
//   const|let|var name = function …   (also async)
// Everything else at the top level of a helper file (loops, calls, plain
// assignments, other variables, nested declarations) is ignored.

const CONTINUES_EXPR = new Set([")", "]", "}"]);

/**
 * Scans the top level of `src` and lists its declarations.
 * → [{ name, kind: "function" | "other", start, end }]
 * kind "function" = an importable function declaration (see above);
 * start/end are source offsets of the whole statement (for "function").
 */
export function listDeclarations(src) {
  const all = tokenize(src);
  const S = all.filter((t) => t.type !== "ws" && t.type !== "comment");
  const N = S.length;
  const val = (k) => (k >= 0 && k < N ? S[k].value : undefined);
  const isP = (k, v) => k >= 0 && k < N && S[k].type === "punct" && S[k].value === v;
  const isI = (k, v) => k >= 0 && k < N && S[k].type === "ident" && (v === undefined || S[k].value === v);

  // depth + bracket matching
  const depth = new Array(N).fill(0);
  const match = new Array(N).fill(-1);
  const stack = [];
  for (let k = 0; k < N; k++) {
    depth[k] = stack.length;
    if (S[k].type !== "punct") continue;
    const v = S[k].value;
    if (OPEN[v]) stack.push(k);
    else if (CLOSE[v]) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (val(stack[s]) === CLOSE[v]) {
          match[stack[s]] = k;
          match[k] = stack[s];
          stack.length = s;
          break;
        }
      }
      depth[k] = stack.length;
    }
  }

  const newlineBefore = (k) => k > 0 && /\n/.test(src.slice(S[k - 1].end, S[k].start));
  const endsValue = (k) =>
    k >= 0 && (S[k].type !== "punct" || CONTINUES_EXPR.has(S[k].value));
  const stmtStart = (k) =>
    k === 0 ||
    isP(k - 1, ";") ||
    (isP(k - 1, "}") && depth[k - 1] === 0) ||
    (newlineBefore(k) && endsValue(k - 1));

  // End (exclusive sig index) of an expression starting at k, at depth 0.
  const exprEnd = (k) => {
    let e = k;
    while (e < N) {
      if (isP(e, ";") && depth[e] === 0) return e;
      if (isP(e, ",") && depth[e] === 0) return e;
      if (e > k && depth[e] === 0 && newlineBefore(e) && endsValue(e - 1) && S[e].type !== "punct") {
        return e;
      }
      if (S[e].type === "punct" && OPEN[S[e].value] && match[e] > e) e = match[e] + 1;
      else e++;
    }
    return N;
  };
  const withSemi = (e) => (isP(e + 1, ";") ? e + 1 : e); // e = last token index

  // Function value at k (`function …`, `async function …`, arrow) → last token index, or -1.
  const functionValueEnd = (k) => {
    let j = k;
    if (isI(j, "async") && !newlineBefore(j + 1)) j++;
    if (isI(j, "function")) {
      j++;
      if (isP(j, "*")) j++;
      if (isI(j)) j++;
      if (!isP(j, "(") || match[j] < 0) return -1;
      const b = match[j] + 1;
      return isP(b, "{") && match[b] > b ? match[b] : -1;
    }
    let arrow;
    if (isP(j, "(") && match[j] > j && isP(match[j] + 1, "=>")) arrow = match[j] + 1;
    else if (isI(j) && isP(j + 1, "=>")) arrow = j + 1;
    else return -1;
    if (isP(arrow + 1, "{") && match[arrow + 1] > arrow) {
      // `=> { … }` possibly followed by more expression (rare) — stop at the brace.
      return match[arrow + 1];
    }
    return exprEnd(arrow + 1) - 1;
  };

  const out = [];
  for (let k = 0; k < N; k++) {
    if (depth[k] !== 0 || S[k].type !== "ident" || !stmtStart(k)) continue;
    const v = S[k].value;
    if (v === "function" || (v === "async" && isI(k + 1, "function"))) {
      const f = v === "async" ? k + 1 : k;
      const nameK = isP(f + 1, "*") ? f + 2 : f + 1;
      const end = functionValueEnd(k);
      if (!isI(nameK) || end < 0) continue;
      const last = withSemi(end);
      out.push({ name: val(nameK), kind: "function", start: S[k].start, end: S[last].end });
      k = last;
    } else if (v === "class" && isI(k + 1)) {
      out.push({ name: val(k + 1), kind: "other", start: S[k].start, end: S[k + 1].end });
    } else if (v === "const" || v === "let" || v === "var") {
      // Single declarator holding a function → importable.
      if (isI(k + 1) && isP(k + 2, "=")) {
        const end = functionValueEnd(k + 3);
        if (end >= 0 && !isP(end + 1, ",")) {
          const last = withSemi(end);
          out.push({ name: val(k + 1), kind: "function", start: S[k].start, end: S[last].end });
          k = last;
          continue;
        }
      }
      // Anything else: collect declared names (best effort, incl. simple destructuring).
      let j = k + 1;
      while (j < N) {
        if (isI(j)) out.push({ name: val(j), kind: "other", start: S[j].start, end: S[j].end });
        else if ((isP(j, "{") || isP(j, "[")) && match[j] > j) {
          for (let q = j + 1; q < match[j]; q++) {
            if (isI(q) && depth[q] === depth[j] + 1 && !isP(q + 1, ":") && !isP(q - 1, "=")) {
              out.push({ name: val(q), kind: "other", start: S[q].start, end: S[q].end });
            }
          }
          j = match[j];
        } else break;
        j++;
        if (isP(j, "=")) j = exprEnd(j + 1);
        if (isP(j, ",")) {
          j++;
          continue;
        }
        break;
      }
    }
  }
  return out;
}

/** Names declared at the top level of `src` (functions, variables, classes). */
export function topLevelNames(src) {
  return new Set(listDeclarations(src).map((d) => d.name));
}

/**
 * Keeps only the importable top-level function declarations of `code`
 * (see listDeclarations), skipping any whose name is in `exclude`.
 * Everything else is removed EXCEPT newlines, so line numbers in the result
 * match the original file (error messages can point at the helper file).
 */
export function extractDeclarations(code, exclude = []) {
  const skip = exclude instanceof Set ? exclude : new Set(exclude);
  let out = "";
  let cur = 0;
  const keepNewlines = (s) => s.replace(/[^\n]/g, "");
  for (const d of listDeclarations(code)) {
    if (d.kind !== "function" || skip.has(d.name)) continue;
    out += keepNewlines(code.slice(cur, d.start)) + code.slice(d.start, d.end);
    cur = d.end;
  }
  return out + keepNewlines(code.slice(cur));
}
