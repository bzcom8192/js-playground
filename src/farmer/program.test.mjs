// Multi-file programs: extractDeclarations / buildProgram.
// Run with: npm run test:farmer
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDeclarations, listDeclarations, topLevelNames, transform } from "./transform.js";
import { buildProgram, mapLine } from "./program.js";
import { createRuntime } from "./runtime.js";
import * as W from "./world.js";

const squash = (s) => s.replace(/\s+/g, " ").trim();
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test("extractDeclarations keeps top-level function declarations", () => {
  const src = "function go_home() {\n  move(West);\n}\nasync function b(x) { return x; }\nfunction* gen() { yield 1; }";
  const out = extractDeclarations(src);
  assert.equal(squash(out), squash(src));
  assert.deepEqual(
    listDeclarations(src).map((d) => [d.name, d.kind]),
    [["go_home", "function"], ["b", "function"], ["gen", "function"]],
  );
});

test("extractDeclarations keeps arrow and function-expression consts", () => {
  const src = [
    "const a = (n) => {\n  move(North);\n};",
    "let b = x => x * 2",
    "var c = async () => harvest();",
    "const d = function (y) { return y; };",
    "const e = async function named() {}",
  ].join("\n");
  const out = extractDeclarations(src);
  assert.equal(squash(out), squash(src));
  assert.deepEqual([...topLevelNames(src)], ["a", "b", "c", "d", "e"]);
});

test("extractDeclarations drops top-level loops, calls, assignments and plain variables", () => {
  const src = [
    "let count = 0;",
    "const size = get_world_size();",
    "function helper() { return 1; }",
    "while (true) {",
    "  harvest();",
    "  count += 1;",
    "}",
    "for (let i = 0; i < 3; i++) move(North);",
    "count = helper();",
    "if (x) { function nested() {} }",
    "const obj = { f: () => 1 };",
  ].join("\n");
  const out = extractDeclarations(src);
  assert.equal(squash(out), "function helper() { return 1; }");
  // Newlines are kept so line numbers still match the original file.
  assert.equal(out.split("\n").length, src.split("\n").length);
  assert.equal(out.split("\n")[2], "function helper() { return 1; }");
});

test("extractDeclarations is safe with strings, templates, comments and regexes", () => {
  const src = [
    "// function fake1() {}",
    "/* const fake2 = () => 1; */",
    'const s = "function fake3() {}";',
    "const t = `${'}'} function fake4() {}`;",
    "const r = /function fake5() {}/;",
    "function real() {\n  // a } brace in a comment\n  return \"}\" + `}` + '{';\n}",
    "const arrow = () => '}'",
  ].join("\n");
  const out = extractDeclarations(src);
  assert.deepEqual(
    listDeclarations(src).filter((d) => d.kind === "function").map((d) => d.name),
    ["real", "arrow"],
  );
  assert.ok(!/fake/.test(out), out);
  assert.ok(out.includes("function real() {\n  // a } brace in a comment\n  return \"}\" + `}` + '{';\n}"));
  assert.ok(out.includes("const arrow = () => '}'"));
  assert.doesNotThrow(() => new AsyncFunction(out));
});

test("expression-bodied arrows end at the line break (ASI) or semicolon", () => {
  const src = "const inc = (n) => n +\n  1\nharvest()\nconst two = () => 2; move(North)";
  const out = extractDeclarations(src);
  assert.ok(out.includes("const inc = (n) => n +\n  1"));
  assert.ok(out.includes("const two = () => 2;"));
  assert.ok(!out.includes("harvest"));
  assert.ok(!out.includes("move"));
});

test("extractDeclarations skips excluded names", () => {
  const src = "function a() {}\nconst b = () => 1;\nfunction c() {}";
  const out = extractDeclarations(src, ["b", "c"]);
  assert.equal(squash(out), "function a() {}");
});

test("name collision: the main file's own declaration wins (also for const arrows)", () => {
  const files = [
    { id: 1, name: "crops", code: "function go_home() { return 'main'; }\nprint(go_home(), shared());" },
    {
      id: 2,
      name: "f0",
      code: "const go_home = () => 'helper';\nfunction shared() { return 'f0'; }\nprint('top-level ignored');",
    },
    { id: 3, name: "f1", code: "const shared = () => 'f1';\nfunction extra() {}" },
  ];
  const prog = buildProgram(files, 1);
  // helper `const go_home` would be a redeclaration error → skipped
  assert.ok(!prog.code.includes("'helper'"));
  // between helpers, the first file wins
  assert.ok(prog.code.includes("function shared() { return 'f0'; }"));
  assert.ok(!prog.code.includes("'f1'"));
  assert.ok(prog.code.includes("function extra() {}"));
  assert.ok(!prog.code.includes("top-level ignored"));
  const out = [];
  const fn = new AsyncFunction("print", transform(prog.code));
  return fn((...a) => out.push(a.join(" "))).then(() => assert.deepEqual(out, ["main f0"]));
});

test("a helper const arrow is usable from the main file (prepended before main code)", async () => {
  const files = [
    { id: 1, name: "crops", code: "print(double(21));" },
    { id: 2, name: "f0", code: "const double = (n) => n * 2;\nwhile (true) {}" },
  ];
  const { code } = buildProgram(files, 1);
  const out = [];
  await new AsyncFunction("print", "__loopGuard", transform(code))((v) => out.push(v), async () => {});
  assert.deepEqual(out, [42]);
});

test("mapLine maps combined-program lines back to files", () => {
  const files = [
    { id: 1, name: "crops", code: "a();\nb();\nc();" },
    { id: 2, name: "f0", code: "// helpers\nfunction go_home() {\n  move(West);\n}" },
  ];
  const { segments, code } = buildProgram(files, 1);
  assert.equal(segments.length, 2);
  const lines = code.split("\n");
  assert.equal(lines.length, 4 + 3);
  assert.deepEqual(mapLine(segments, 3), { fileId: 2, name: "f0", line: 3, main: false });
  assert.deepEqual(mapLine(segments, 6), { fileId: 1, name: "crops", line: 2, main: true });
  assert.equal(lines[5], "b();");
});

test("a helper that calls drone actions is awaited when used from the main file", async () => {
  const s = W.createGame();
  s.unlocks.Expand = 1;
  s.size = 2;
  s.tiles = [W.newTile(), W.newTile(), W.newTile(), W.newTile()];
  const files = [
    { id: 1, name: "crops", code: "move(East);\nmove(North);\ngo_home();\nprint(get_world_size());" },
    { id: 2, name: "f0", code: "function go_home() {\n  move(West);\n  move(South);\n}" },
  ];
  const { code } = buildProgram(files, 1);
  let t = 0;
  const logs = [];
  const rt = createRuntime({
    getState: () => s,
    onLog: (e) => logs.push(e.text),
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    yieldFn: async () => {},
  });
  assert.equal(await rt.run(code), "done");
  assert.deepEqual([s.drone.x, s.drone.y], [0, 0]);
  assert.deepEqual(logs, ["2"]);
});

test("pause halts actions and run time; resume continues; stop works while paused", async () => {
  const s = W.createGame();
  let t = 0;
  const rt = createRuntime({
    getState: () => s,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
      await new Promise((r) => setImmediate(r));
    },
    yieldFn: () => new Promise((r) => setImmediate(r)),
  });
  const spin = () => new Promise((r) => setImmediate(r));
  const done = rt.run("while (true) { do_a_flip(); }");
  for (let i = 0; i < 50; i++) await spin();
  assert.ok(s.drone.flips > 0);
  rt.setPaused(true);
  assert.equal(rt.isPaused(), true);
  for (let i = 0; i < 5; i++) await spin(); // let the in-flight slice settle
  const flips = s.drone.flips;
  const elapsed = rt.stats().elapsed;
  for (let i = 0; i < 200; i++) await spin(); // virtual time keeps passing (pause polls sleep)
  assert.equal(s.drone.flips, flips, "no actions while paused");
  assert.ok(Math.abs(rt.stats().elapsed - elapsed) < 0.06, "run time frozen while paused");
  rt.setPaused(false);
  for (let i = 0; i < 50; i++) await spin();
  assert.ok(s.drone.flips > flips, "resumes");
  rt.setPaused(true);
  rt.stop();
  assert.equal(await done, "stopped");
  assert.equal(rt.isPaused(), false);
});

test("runtime errors inside a helper file are reported with that file's name and line", async () => {
  const s = W.createGame();
  const files = [
    { id: 1, name: "crops", code: "// main\nboom();" },
    { id: 2, name: "f0", code: "// helpers\n\nfunction boom() {\n  throw new Error('kaboom');\n}" },
  ];
  const prog = buildProgram(files, 1);
  const logs = [];
  const rt = createRuntime({ getState: () => s, onLog: (e) => logs.push(e.text), yieldFn: async () => {} });
  assert.equal(await rt.run(prog.code, { mapLine: (l) => mapLine(prog.segments, l) }), "error");
  assert.deepEqual(logs, ["f0, line 4: Error: kaboom"]);

  logs.length = 0;
  const main = buildProgram([{ id: 1, name: "crops", code: "let a = 1;\nnull.x;" }, files[1]], 1);
  await rt.run(main.code, { mapLine: (l) => mapLine(main.segments, l) });
  assert.match(logs[0], /^Line 2: TypeError/);
});
