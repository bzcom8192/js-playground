// JS Farmer — TypeScript-style annotation stripping (pure string → string,
// unit-tested in node). Lets the player write
//
//   function go(arg: GroundType): boolean { … }
//
// in the editor (Monaco runs in TypeScript mode for farmer files) while the
// runtime still executes plain JavaScript. No compiler dependency: this is a
// token-aware, hand-written pass in the spirit of transform.js.
//
// Rules:
//  - Type syntax is BLANKED (every char except "\n" becomes a space), never
//    deleted, so line AND column numbers of the result match the editor.
//  - Strings, template literals, comments and regex literals are never
//    touched (they are single tokens of the shared tokenizer).
//  - Every construct is parsed with a small type grammar; if the parse does
//    not end where it must (e.g. `{` after a return type), that construct is
//    left untouched instead of guessing — the original code then surfaces as
//    a normal SyntaxError with the right line number.
//
// Handled:
//   (a: T, b?: U, c: V = 1, { x }: W, ...rest: X[])   parameter annotations
//   function f(): T {      (x: T): U => …    m(): T {  return types
//   function f<T, U extends X = Y>(…)                  type parameters (declarations)
//   let|const|var x: T = …, y: U                        variable annotations
//   expr as T              expr!.prop   expr![i]       casts / non-null assertions
//   catch (e: unknown)
//   type X<T> = …;         interface X<T> extends Y { … }   (whole statement)
// Not handled (left as-is → TS-only syntax errors at run time): enum,
// namespace, declare, class members (field types, modifiers, implements,
// class generics), call-site type arguments f<T>(x), generic arrows
// <T>(x: T) => x, overload signatures, `this` parameters, angle-bracket
// casts <T>x, conditional types.

import { tokenize } from "./transform.js";

const OPEN = { "(": ")", "[": "]", "{": "}" };
const CLOSE = { ")": "(", "]": "[", "}": "{" };

// Identifiers that can never start a type (bail out instead).
const NOT_TYPE_START = new Set([
  "in",
  "of",
  "instanceof",
  "return",
  "function",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "var",
  "let",
  "const",
  "class",
  "new",
  "delete",
  "throw",
  "try",
  "catch",
  "finally",
  "with",
  "yield",
  "await",
  "import",
  "export",
  "default",
  "extends",
  "implements",
  "super",
  "as",
  "satisfies",
]);
const TYPE_PREFIX = new Set(["keyof", "typeof", "readonly", "unique", "infer"]);
// Keywords before `(` that make it NOT a method / function parameter list.
const NOT_METHOD = new Set([
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
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "in",
  "of",
  "instanceof",
  "else",
  "do",
]);
const METHOD_PREV = new Set(["{", ",", ";", "}"]);
const METHOD_PREV_IDENT = new Set(["async", "get", "set", "static"]);
// Tokens after which `as` / `!` belong to a TS expression (an operand ended).
const OPERAND_END_PUNCT = new Set([")", "]", "}"]);
const NOT_OPERAND_IDENT = new Set([
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
  "let",
  "const",
  "var",
  "import",
  "export",
  "as",
]);

/** Source ranges ([start, end) offsets) that are TypeScript-only syntax. */
export function typeRanges(src) {
  // Significant tokens; `>>` / `>>>` split into single `>` so nested type
  // arguments (`Array<Array<T>>`) close correctly. The split only matters to
  // this pass — the output text is the original source minus blanked ranges.
  const S = [];
  for (const t of tokenize(src)) {
    if (t.type === "ws" || t.type === "comment") continue;
    if (t.type === "punct" && /^>>>?$/.test(t.value)) {
      for (let i = t.start; i < t.end; i++) S.push({ type: "punct", value: ">", start: i, end: i + 1 });
    } else S.push(t);
  }
  const N = S.length;
  const val = (k) => (k >= 0 && k < N ? S[k].value : undefined);
  const isP = (k, v) => k >= 0 && k < N && S[k].type === "punct" && S[k].value === v;
  const isI = (k, v) => k >= 0 && k < N && S[k].type === "ident" && (v === undefined || S[k].value === v);
  const nlBefore = (k) => k > 0 && k < N && src.slice(S[k - 1].end, S[k].start).includes("\n");

  // Bracket matching (round / square / curly only).
  const match = new Array(N).fill(-1);
  const parent = new Array(N).fill(-1);
  const stack = [];
  for (let k = 0; k < N; k++) {
    parent[k] = stack.length ? stack[stack.length - 1] : -1;
    if (S[k].type !== "punct") continue;
    const v = S[k].value;
    if (OPEN[v]) stack.push(k);
    else if (CLOSE[v]) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (val(stack[s]) === CLOSE[v]) {
          match[stack[s]] = k;
          match[k] = stack[s];
          parent[k] = parent[stack[s]];
          stack.length = s;
          break;
        }
      }
    }
  }
  const group = (k) => (match[k] > k ? match[k] + 1 : -1); // index after the group at k

  // ---- type grammar: each returns the index AFTER the parsed type, or -1 ----
  function typeArgs(k) {
    // k at `<`
    let j = k + 1;
    if (isP(j, ">")) return -1;
    for (;;) {
      j = type(j);
      if (j < 0) return -1;
      if (isP(j, ",")) {
        j++;
        continue;
      }
      return isP(j, ">") ? j + 1 : -1;
    }
  }
  function operand(k) {
    let j = k;
    while (isI(j) && TYPE_PREFIX.has(val(j)) && !isP(j + 1, ",") && !isP(j + 1, ">")) j++;
    if (j >= N) return -1;
    const t = S[j];
    if (isP(j, "-") && S[j + 1]?.type === "num") j += 2;
    else if (isP(j, "(")) {
      const g = group(j);
      if (g < 0) return -1;
      if (isP(g, "=>")) return type(g + 1); // function type (a: T) => U
      j = g; // parenthesized type
    } else if (isP(j, "<")) {
      // generic function type <T>(x: T) => U
      const g = typeParams(j);
      if (g < 0 || !isP(g, "(") || !isP(group(g), "=>")) return -1;
      return type(group(g) + 1);
    } else if (isP(j, "{") || isP(j, "[")) {
      j = group(j);
      if (j < 0) return -1;
    } else if (t.type === "str" || t.type === "num") j++;
    else if (t.type === "ident" && !NOT_TYPE_START.has(t.value)) {
      j++;
      while (isP(j, ".") && isI(j + 1)) j += 2;
      if (isP(j, "<")) {
        const a = typeArgs(j);
        if (a > 0) j = a;
      }
      if (isI(j, "is") && !nlBefore(j)) return type(j + 1); // type predicate `x is T`
    } else return -1;
    // postfix T[] / T[K]
    while (isP(j, "[") && !nlBefore(j)) {
      const g = group(j);
      if (g < 0) return -1;
      j = g;
    }
    return j;
  }
  function type(k) {
    let j = k;
    if (isP(j, "|") || isP(j, "&")) j++;
    j = operand(j);
    while (j > 0 && (isP(j, "|") || isP(j, "&"))) j = operand(j + 1);
    return j;
  }
  // `<T, U extends X = Y>` (declarations) — k at `<`; balanced angle count.
  function typeParams(k) {
    let depth = 0;
    for (let j = k; j < N; j++) {
      if (isP(j, "<")) depth++;
      else if (isP(j, ">")) {
        depth--;
        if (depth === 0) return j > k + 1 ? j + 1 : -1;
      } else if (isP(j, ";") || CLOSE[val(j)]) return -1;
      else if (OPEN[val(j)] && S[j].type === "punct") {
        if (match[j] < j) return -1;
        j = match[j];
      }
    }
    return -1;
  }

  const ranges = [];
  const blank = (a, b) => {
    // token indices [a, b) → source range
    if (b > a) ranges.push([S[a].start, S[b - 1].end]);
  };

  // A type annotation `: T` at k (k at `:`) that must end at one of `ends`
  // (predicate on the token index after the type). Returns end or -1.
  const annotation = (k, ends) => {
    if (!isP(k, ":")) return -1;
    const e = type(k + 1);
    return e > 0 && ends(e) ? e : -1;
  };

  // Is `(` at k inside a ternary or `case` clause (so `(…) : x` is not a return type)?
  const inTernaryOrCase = (k) => {
    let q = 0;
    for (let j = k - 1; j >= 0 && j > parent[k]; j--) {
      if (isP(j, ";") || isP(j, ",") || isP(j, "{") || isP(j, "}")) break;
      if ((isP(j, ")") || isP(j, "]")) && match[j] >= 0) {
        j = match[j];
        continue;
      }
      if (isP(j, "?")) q++;
      else if (isP(j, ":")) q--;
      else if (isI(j, "case")) return true;
    }
    return q > 0;
  };

  // Parameter list `(…)` at k: blank `?` and `: T` of every parameter.
  // All-or-nothing: an unexpected shape leaves the whole list untouched.
  const params = (k) => {
    const close = match[k];
    if (close < k) return false;
    const local = [];
    let j = k + 1;
    while (j < close) {
      if (isP(j, "...")) j++;
      if (isI(j) && !NOT_TYPE_START.has(val(j))) j++;
      else if (isP(j, "{") || isP(j, "[")) j = group(j);
      else return false;
      if (j < 0) return false;
      if (isP(j, "?")) {
        local.push([j, j + 1]);
        j++;
      }
      if (isP(j, ":")) {
        const e = annotation(j, (e) => e <= close && (e === close || isP(e, ",") || isP(e, "=")));
        if (e < 0) return false;
        local.push([j, e]);
        j = e;
      }
      if (isP(j, "=")) {
        // default value: skip to the next `,` at this depth
        j++;
        while (j > 0 && j < close && !isP(j, ",")) j = OPEN[val(j)] && S[j].type === "punct" ? group(j) : j + 1;
        if (j < 0 || j > close) return false;
      }
      if (j === close) break;
      if (!isP(j, ",")) return false;
      j++;
    }
    for (const [a, b] of local) blank(a, b);
    return true;
  };

  // Return type after the parameter list ending at `close`; must be followed by `want`.
  const returnType = (close, want) => {
    const e = annotation(close + 1, (e) => isP(e, want));
    if (e > 0) blank(close + 1, e);
    return e;
  };

  const handledParens = new Set();

  for (let k = 0; k < N; k++) {
    const t = S[k];
    const stmtStart = k === 0 || isP(k - 1, ";") || isP(k - 1, "{") || isP(k - 1, "}") || nlBefore(k);

    // ---- type X = …;   interface X { … } ----
    if (t.type === "ident" && (t.value === "type" || t.value === "interface") && stmtStart && !isP(k - 1, ".")) {
      if (!isI(k + 1) || nlBefore(k + 1) || NOT_TYPE_START.has(val(k + 1))) continue;
      let j = k + 2;
      if (isP(j, "<")) j = typeParams(j);
      if (j < 0) continue;
      let end = -1;
      if (t.value === "type") {
        if (!isP(j, "=")) continue;
        const e = type(j + 1);
        if (e < 0) continue;
        if (isP(e, ";")) end = e + 1;
        else if (e >= N || nlBefore(e) || isP(e, "}")) end = e;
      } else {
        if (isI(j, "extends")) {
          j++;
          for (;;) {
            j = type(j);
            if (j < 0 || !isP(j, ",")) break;
            j++;
          }
        }
        if (j > 0 && isP(j, "{") && match[j] > j) end = match[j] + 1;
      }
      if (end > 0) {
        blank(k, end);
        k = end - 1;
      }
      continue;
    }

    // ---- function [*] [name] [<T>] ( … ) [: R] { ----
    if (t.type === "ident" && t.value === "function" && !isP(k - 1, ".")) {
      let j = k + 1;
      if (isP(j, "*")) j++;
      if (isI(j)) j++;
      if (isP(j, "<")) {
        const g = typeParams(j);
        if (g < 0 || !isP(g, "(")) continue;
        blank(j, g);
        j = g;
      }
      if (!isP(j, "(") || match[j] < j) continue;
      handledParens.add(j);
      if (params(j) && !isP(match[j] + 1, "{")) returnType(match[j], "{");
      continue;
    }

    if (t.type === "punct" && t.value === "(" && !handledParens.has(k) && match[k] > k) {
      const close = match[k];
      // ---- arrow:  ( … ) =>   ( … ): R => ----
      if (isP(close + 1, "=>")) {
        params(k);
        continue;
      }
      if (isP(close + 1, ":") && !inTernaryOrCase(k)) {
        const e = annotation(close + 1, (e) => isP(e, "=>"));
        if (e > 0) {
          if (params(k)) blank(close + 1, e);
          continue;
        }
      }
      // ---- catch (e: T) ----
      if (isI(k - 1, "catch")) {
        params(k);
        continue;
      }
      // ---- method shorthand  name( … ) [: R] {  (object literal / class body) ----
      const prev = k - 2;
      if (
        isI(k - 1) &&
        !NOT_METHOD.has(val(k - 1)) &&
        isP(parent[k], "{") &&
        (prev <= parent[k] || METHOD_PREV.has(val(prev)) || isP(prev, "*") || (isI(prev) && METHOD_PREV_IDENT.has(val(prev))))
      ) {
        if (isP(close + 1, "{")) params(k);
        else if (isP(close + 1, ":")) {
          const e = annotation(close + 1, (e) => isP(e, "{"));
          if (e > 0 && params(k)) blank(close + 1, e);
        }
      }
      continue;
    }

    // ---- let|const|var  a: T = …, b: U ----
    if (t.type === "ident" && (t.value === "let" || t.value === "const" || t.value === "var") && !isP(k - 1, ".")) {
      let j = k + 1;
      for (;;) {
        if (isI(j)) j++;
        else if (isP(j, "{") || isP(j, "[")) j = group(j);
        else break;
        if (j < 0) break;
        if (isP(j, ":")) {
          const e = annotation(
            j,
            (e) => e >= N || isP(e, "=") || isP(e, ",") || isP(e, ";") || isP(e, ")") || isP(e, "}") || isI(e, "of") || isI(e, "in") || nlBefore(e),
          );
          if (e < 0) break;
          blank(j, e);
          j = e;
        }
        if (!isP(j, "=")) {
          if (isP(j, ",")) {
            j++;
            continue;
          }
          break;
        }
        // skip the initializer: up to `,` / `;` / closer at this depth, or a new statement line
        j++;
        while (j < N) {
          if (isP(j, ",") || isP(j, ";") || (S[j].type === "punct" && CLOSE[S[j].value])) break;
          if (nlBefore(j) && S[j].type === "ident" && !isP(j - 1, ".") && S[j - 1].type !== "punct") break;
          if (S[j].type === "punct" && OPEN[S[j].value]) {
            if (match[j] < j) break;
            j = match[j] + 1;
          } else j++;
        }
        if (!isP(j, ",")) break;
        j++;
      }
      continue;
    }

    // ---- expr as T ----
    if (t.type === "ident" && t.value === "as" && !nlBefore(k) && k > 0) {
      const p = S[k - 1];
      const operandEnd =
        (p.type === "ident" && !NOT_OPERAND_IDENT.has(p.value)) ||
        p.type === "num" ||
        p.type === "str" ||
        p.type === "regex" ||
        (p.type === "punct" && OPERAND_END_PUNCT.has(p.value));
      if (!operandEnd) continue;
      const e = isI(k + 1, "const") ? k + 2 : type(k + 1);
      if (e > 0) {
        blank(k, e);
        k = e - 1;
      }
      continue;
    }

    // ---- expr!.prop  /  expr![i] (non-null assertion) ----
    // `x !.y` / `x ![…]` on one line is never valid JS — except `if (c) ![…]…`
    // and `{} ![…]`, so `![` only counts after an identifier or `]`.
    if (t.type === "punct" && t.value === "!" && k > 0 && !nlBefore(k)) {
      const p = S[k - 1];
      const dot = isP(k + 1, ".") || isP(k + 1, "?.");
      const index = isP(k + 1, "[");
      const afterIdent = p.type === "ident" && !NOT_OPERAND_IDENT.has(p.value);
      if ((dot && (afterIdent || (p.type === "punct" && OPERAND_END_PUNCT.has(p.value)))) || (index && (afterIdent || isP(k - 1, "]")))) {
        blank(k, k + 1);
      }
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

/**
 * stripTypes(code) → plain JavaScript with TypeScript annotations blanked out.
 * Same length, same line breaks: offsets, lines and columns all match `code`.
 */
export function stripTypes(code) {
  const ranges = typeRanges(code);
  if (!ranges.length) return code;
  let out = "";
  let cur = 0;
  for (const [start, b] of ranges) {
    if (b <= cur) continue; // nested in a range that is already blanked
    const a = Math.max(start, cur);
    out += code.slice(cur, a) + code.slice(a, b).replace(/[^\n]/g, " ");
    cur = b;
  }
  return out + code.slice(cur);
}

// Whitespace-layout rules that would only be reacting to the blanks left by
// stripTypes (e.g. `let g: GroundType = 1` → "multiple spaces before '='").
const WHITESPACE_RULES = new Set(["no-multi-spaces", "no-trailing-spaces"]);

/**
 * Drops lint messages caused by stripping: whitespace-rule messages whose
 * span touches a blanked type range of `code` (the ORIGINAL code). Other
 * messages pass through unchanged.
 */
export function dropStripArtifacts(messages, code) {
  if (!messages.some((m) => WHITESPACE_RULES.has(m.ruleId))) return messages;
  const ranges = typeRanges(code);
  if (!ranges.length) return messages;
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") lineStarts.push(i + 1);
  const offset = (line, col) => (lineStarts[line - 1] ?? code.length) + col - 1;
  return messages.filter((m) => {
    if (!WHITESPACE_RULES.has(m.ruleId)) return true;
    const a = offset(m.line, m.column);
    const b = m.endLine ? offset(m.endLine, m.endColumn) : a;
    return !ranges.some(([s, e]) => s <= b && e >= a);
  });
}
