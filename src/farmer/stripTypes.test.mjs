// TypeScript-style annotation stripping (stripTypes) + annotated programs end to end.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import { Linter } from "eslint-linter-browserify";
import { dropStripArtifacts, stripTypes, typeRanges } from "./stripTypes.js";
import { listDeclarations, topLevelNames, transform } from "./transform.js";
import { buildProgram } from "./program.js";
import { createRuntime } from "./runtime.js";
import { createDemoGame } from "./demo.js";
import { EXAMPLES, HELPER_CODE } from "./examples.js";
import { FARMER_GLOBALS } from "./farmerLib.js";
import { eslintConfig } from "../utils/eslintConfig.js";
import * as W from "./world.js";

const squash = (s) => s.replace(/\s+/g, "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** stripTypes(src) must keep length + every newline, parse as JS, and equal `expected` modulo whitespace. */
function strips(src, expected) {
  const out = stripTypes(src);
  assert.equal(out.length, src.length, "length preserved");
  assert.deepEqual(
    [...out].flatMap((c, i) => (c === "\n" ? [i] : [])),
    [...src].flatMap((c, i) => (c === "\n" ? [i] : [])),
    "newlines at the same offsets",
  );
  assert.equal(squash(out), squash(expected));
  new AsyncFunction(out); // valid JavaScript
  return out;
}

test("parameter annotations and optional parameters", () => {
  strips("function go(arg: GroundType) { till() }", "function go(arg) { till() }");
  strips("function f(a?: number, b?: string) {}", "function f(a, b) {}");
  strips(
    "function f(a: number = 1, { x, y }: Pos, [p]: number[], ...rest: Array<ItemType>) {}",
    "function f(a = 1, { x, y }, [p], ...rest) {}",
  );
  strips("function f(cb: (n: number, d?: Direction) => void, o: { a: number; b?: string }) {}", "function f(cb, o) {}");
  strips("function f(m: Map<string, Array<number>>, k: keyof typeof Grounds) {}", "function f(m, k) {}");
  strips("function f(d: Direction | null, t: 'a' | \"b\" | -1) {}", "function f(d, t) {}");
});

test("return types: function declarations, expressions, arrows, methods", () => {
  strips("function f(): boolean {\n  return true\n}", "function f() {\n return true\n}");
  strips("function f(): { a: number } { return { a: 1 } }", "function f() { return { a: 1 } }");
  strips("function isSoil(g: GroundType): g is 'Soil' { return g === 'Soil' }", "function isSoil(g) { return g === 'Soil' }");
  strips("const f = function (x: number): string { return '' + x }", "const f = function (x) { return '' + x }");
  strips("const f = (x: GroundType): boolean => x === Grounds.Soil", "const f = (x) => x === Grounds.Soil");
  strips("const g = async (a: number, b?: number): Promise<void> => { await a }", "const g = async (a, b) => { await a }");
  strips("const h = (): Array<Array<number>> => []", "const h = () => []");
  strips(
    "const o = { go(d: Direction): boolean { return true }, k: 1 }\nclass A { run(n: number): void {} static make(): A { return new A() } }",
    "const o = { go(d) { return true }, k: 1 }\nclass A { run(n) {} static make() { return new A() } }",
  );
  strips("try { x() } catch (e: unknown) { print(e) }", "try { x() } catch (e) { print(e) }");
});

test("variable annotations", () => {
  strips("let g: GroundType = get_ground_type()", "let g = get_ground_type()");
  strips("let a: number[] = [], b: Map<string, number> = new Map(), c: string", "let a = [], b = new Map(), c");
  strips("let n: number\nlet m: number;\nvar s: string", "let n\nlet m;\nvar s");
  strips("const { x, y }: { x: number, y: number } = pos", "const { x, y } = pos");
  strips("for (let i: number = 0; i < 3; i++) {}", "for (let i = 0; i < 3; i++) {}");
  strips("let f: (d: Direction) => boolean = move", "let f = move");
});

test("as casts and non-null assertions", () => {
  strips("const t = get_entity_type() as EntityType", "const t = get_entity_type()");
  strips("plant((x as EntityType))\nconst k = Object.keys(Items) as ItemType[]", "plant((x))\nconst k = Object.keys(Items)");
  strips("const v = (a as number) + 1, w = b as const", "const v = (a) + 1, w = b");
  strips("const z = cfg!.size + list![0]!.n + m()!.k", "const z = cfg.size + list[0].n + m().k");
  // `!` that is real JavaScript stays
  const js = "if (c) ![1].includes(x) && f()\nconst q = !a.b, r = a !== b";
  assert.equal(stripTypes(js), js);
});

test("type aliases and interfaces are blanked (lines kept)", () => {
  const src = [
    "type Step = { dir: Direction, n: number }",
    "type U =",
    "  | 'a'",
    "  | 'b';",
    "type Pair<T> = [T, T]",
    "interface Report extends Base<number>, Other {",
    "  harvested: number",
    "  go(d: Direction): void",
    "}",
    "let after = 1",
  ].join("\n");
  const out = strips(src, "let after = 1");
  assert.equal(out.split("\n")[9], "let after = 1");
  assert.equal(out.split("\n").length, 10);
});

test("generic parameters on function declarations", () => {
  strips("function first<T>(items: T[]): T { return items[0] }", "function first(items) { return items[0] }");
  strips(
    "function pick<K extends keyof typeof Items, V = Map<K, Array<number>>>(k: K): V { return null }",
    "function pick(k) { return null }",
  );
  strips("const f = function id<T>(x: T): T { return x }", "const f = function id(x) { return x }");
});

test("strings, comments, templates and regex with type-looking text are untouched", () => {
  const src = [
    "const s = 'a: number' + \"(x: T) => U\" // let x: number = 1",
    "/* function f(a: T): U {} */ const t = `x: ${y} as Foo ${'p?: q'}`",
    "const r = /a: b|(c?: d)/g, q = x ? (y) : z",
    "const o = { a: 1, b: c ? d : e }",
    "switch (k) { case 1: break; default: print(k ? 1 : 2) }",
    "label: for (;;) { break label }",
    "const yy = cond ? (aa) : bb => bb",
    "f(a ? b : c)\nconst { a: renamed } = obj",
  ].join("\n");
  assert.equal(stripTypes(src), src);
  assert.deepEqual(typeRanges(src), []);
});

test("plain JavaScript (all examples) is returned unchanged", () => {
  for (const ex of EXAMPLES) assert.equal(stripTypes(ex.code), ex.code, ex.name);
  assert.equal(stripTypes(HELPER_CODE), HELPER_CODE);
});

test("unsupported / malformed constructs are left untouched, never corrupted", () => {
  for (const src of [
    "enum Color { Red, Green }",
    "function f(a: ) {}",
    "let x: = 1",
    "type = 5",
    "const t = type",
  ]) {
    assert.equal(stripTypes(src), src, src);
  }
});

test("declaration extraction sees stripped code", () => {
  const src = "type T = number\nfunction go(arg: GroundType): void { move(North) }\nconst h = (n: number): number => n * 2\nlet g: GroundType = 'Soil'";
  const decls = listDeclarations(stripTypes(src));
  assert.deepEqual(
    decls.map((d) => [d.name, d.kind]),
    [["go", "function"], ["h", "function"], ["g", "other"]],
  );
  assert.deepEqual([...topLevelNames(stripTypes(src))], ["go", "h", "g"]);
  // auto-await still applies after stripping
  assert.match(transform(stripTypes(src)), /async function go\(arg\s*\)\s*\{ await move\(North\) \}/);
});

// The annotated demo program from BRIEF4 (no semicolons, a GroundType parameter, …).
const ANNOTATED_HELPER = `// helper file with types
function go_to(x: number, y: number): void {
  while (get_pos_x() !== x) move(East)
  while (get_pos_y() !== y) move(North)
}
`;
const ANNOTATED_MAIN = `// Annotated demo — TypeScript-style types, no semicolons
type Step = { dir: Direction, n: number }
interface Report {
  harvested: number
  ground: GroundType
}

function on_ground(want: GroundType, fallback?: GroundType): boolean {
  return get_ground_type() === (fallback ?? want)
}

const walk = (s: Step): void => {
  for (let i: number = 0; i < s.n; i++) move(s.dir)
}

function first<T>(items: T[]): T {
  return items[0]
}

go_to(0, 0)
const report: Report = { harvested: 0, ground: get_ground_type() as GroundType }
const steps: Step[] = [{ dir: North, n: 2 }, { dir: East, n: 3 }]
for (const s of steps) {
  walk(s)
  if (can_harvest()) {
    harvest()
    report.harvested++
  }
  if (!on_ground(Grounds.Soil)) till()
}
report.ground = get_ground_type() as GroundType
print("harvested", report.harvested, "ground", report.ground, "first", first(steps).dir)
throw new Error("boom")
`;

test("annotated multi-file program builds and runs on the demo farm", async () => {
  const files = [
    { id: 1, name: "main", code: ANNOTATED_MAIN },
    { id: 2, name: "f0", code: ANNOTATED_HELPER },
  ];
  const prog = buildProgram(files, 1);
  assert.equal(prog.mainFile.code, ANNOTATED_MAIN, "mainFile keeps the original code");
  assert.equal(prog.code.split("\n").length, ANNOTATED_MAIN.split("\n").length + ANNOTATED_HELPER.split("\n").length);
  for (const seg of prog.segments) new AsyncFunction(seg.code);

  const s = createDemoGame();
  let t = 0;
  const logs = [];
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e),
    now: () => t,
    sleep: async (ms) => {
      W.tick(s, ms / 1000, Math.random);
      t += ms;
    },
    yieldFn: async () => {},
  });
  const helperLines = prog.segments[0].lines;
  const status = await rt.run(prog.code, {
    mapLine: (line) => ({ main: line > helperLines, name: "x", line: line - helperLines }),
  });
  assert.equal(status, "error"); // the deliberate throw on the last line
  const texts = logs.map((l) => l.text);
  assert.ok(texts.some((x) => /^harvested \d+ ground (Grassland|Soil) first North$/.test(x)), texts.join(" | "));
  // error line numbers still point at the editor line (line 33 of main)
  const errLine = ANNOTATED_MAIN.split("\n").findIndex((l) => l.startsWith("throw")) + 1;
  assert.ok(texts.some((x) => x.startsWith(`Line ${errLine}: Error: boom`)), texts.join(" | "));
  assert.deepEqual([s.drone.x, s.drone.y], [3, 2]);
});

test("annotated program lints clean (no markers) on the stripped code", () => {
  const linter = new Linter();
  const config = {
    ...eslintConfig,
    languageOptions: {
      ...eslintConfig.languageOptions,
      globals: { ...eslintConfig.languageOptions.globals, ...FARMER_GLOBALS, go_to: "readonly" },
    },
  };
  const code = ANNOTATED_MAIN.replace('throw new Error("boom")\n', "");
  // Raw TS would be a fatal parse error for espree:
  assert.ok(linter.verify(code, config).some((m) => m.fatal));
  const msgs = dropStripArtifacts(linter.verify(stripTypes(code), config), code);
  assert.deepEqual(msgs, []);
});

test("dropStripArtifacts only drops whitespace messages that touch a blanked range", () => {
  const code = "let g: GroundType = 1\nlet  h = 2";
  const msgs = [
    { ruleId: "no-multi-spaces", line: 1, column: 6, endLine: 1, endColumn: 19 },
    { ruleId: "no-multi-spaces", line: 2, column: 4, endLine: 2, endColumn: 6 },
    { ruleId: "no-undef", line: 1, column: 1, endLine: 1, endColumn: 4 },
  ];
  assert.deepEqual(
    dropStripArtifacts(msgs, code).map((m) => [m.ruleId, m.line]),
    [["no-multi-spaces", 2], ["no-undef", 1]],
  );
});

test("relaxed linter: missing semicolons and style are not reported", () => {
  const linter = new Linter();
  const config = {
    ...eslintConfig,
    languageOptions: { ...eslintConfig.languageOptions, globals: { ...eslintConfig.languageOptions.globals, ...FARMER_GLOBALS } },
  };
  const msgs = linter.verify("const a = 'x'\nconst b = [ 1,2 ];;\nif(a){print(a,b)}\n\n\n\n", config);
  assert.deepEqual(msgs.map((m) => m.ruleId), []);
  // correctness rules still apply
  const rules = (code) => linter.verify(code, config).map((m) => m.ruleId);
  assert.ok(rules("print(undefinedThing)").includes("no-undef"));
  assert.ok(rules("let a = 1\nif (a == NaN) {}").includes("use-isnan"));
  assert.ok(rules("const o = { a: 1, a: 2 }\nprint(o)").includes("no-dupe-keys"));
});
