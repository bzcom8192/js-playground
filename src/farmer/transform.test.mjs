// Run with: npm run test:farmer   (plain `node --test`, no extra deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import { transform, tokenize } from "./transform.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const compiles = (code) =>
  assert.doesNotThrow(
    () => new AsyncFunction("__loopGuard", "__loopGuardSync", "__loopIter", "__loopKeys", code),
    `should compile:\n${code}`,
  );

test("action calls get await", () => {
  const out = transform("harvest();\nmove(North);\nplant(Entities.Bush);");
  assert.equal(out, "await harvest();\nawait move(North);\nawait plant(Entities.Bush);");
  compiles(out);
});

test("sense calls are left synchronous", () => {
  assert.equal(transform("if (can_harvest()) harvest();"), "if (can_harvest()) await harvest();");
  assert.equal(transform("const x = get_pos_x();"), "const x = get_pos_x();");
});

test("existing await is not doubled", () => {
  assert.equal(transform("await harvest();"), "await harvest();");
});

test("user function becomes async and its calls are awaited", () => {
  const src = "function go(n) {\n  move(East);\n}\ngo(3);\nlet y = go(1) || 2;";
  const out = transform(src);
  assert.equal(out, "async function go(n) {\n  await move(East);\n}\nawait go(3);\nlet y = await go(1) || 2;");
  compiles(out);
});

test("helpers calling helpers (declared later) are async via fixpoint", () => {
  const out = transform("function a() { return b(); }\nfunction b() { harvest(); }\na();");
  assert.equal(
    out,
    "async function a() { return await b(); }\nasync function b() { await harvest(); }\nawait a();",
  );
});

test("pure helper without actions stays sync (usable as sort comparator)", () => {
  const src = "function cmp(a, b) { return a - b; }\n[3, 1].sort(cmp);\nconst s = [2, 1].sort((a, b) => a - b);";
  assert.equal(transform(src), src);
});

test("arrow function assignment", () => {
  const out = transform("const f = () => { harvest(); };\nconst g = d => move(d);\nf(); g(North);");
  assert.equal(
    out,
    "const f = async () => { await harvest(); };\nconst g = async d => await move(d);\nawait f(); await g(North);",
  );
  compiles(out);
});

test("function expression assignment", () => {
  const out = transform("const f = function () { till(); };\nf();");
  assert.equal(out, "const f = async function () { await till(); };\nawait f();");
});

test("strings, templates, comments and regex literals are untouched", () => {
  const src =
    'print("move(North) harvest()");\n' +
    "print('till()');\n" +
    "// harvest();\n" +
    "/* plant(Entities.Bush); while (true) {} */\n" +
    "const t = `a ${'b'} move(North) ${`nested ${1}`}`;\n" +
    "const re = /move\\(North\\)/g;";
  assert.equal(transform(src), src);
});

test("property calls are untouched", () => {
  const src = "obj.move(); drone.harvest(1); a?.plant(x); this.till();";
  assert.equal(transform(src), src);
});

test("keywords and declarations are not awaited", () => {
  const src = "function harvest_all() {}\nif (x) {}\nswitch (y) {}";
  assert.equal(transform(src), src);
});

test("while loop gets a guard in its header", () => {
  const out = transform("while (true) {\n  harvest();\n}");
  assert.equal(out, "while ((await __loopGuard(), (true))) {\n  await harvest();\n}");
  compiles(out);
});

test("brace-less loop bodies and do/while", () => {
  const out = transform("while (true) harvest();\ndo harvest(); while (!can_harvest())");
  assert.equal(
    out,
    "while ((await __loopGuard(), (true))) await harvest();\ndo await harvest(); while ((await __loopGuard(), (!can_harvest())))",
  );
});

test("classic for loops (incl. empty condition)", () => {
  assert.equal(
    transform("for (let i = 0; i < 3; i++) move(East);"),
    "for (let i = 0; (await __loopGuard(), (i < 3)); i++) await move(East);",
  );
  assert.equal(transform("for (;;) {}"), "for (; (await __loopGuard(), true);) {}");
});

test("for...of / for...in become guarded async iteration", () => {
  assert.equal(
    transform("for (const d of [North, East]) move(d);"),
    "for await (const d of __loopIter([North, East])) await move(d);",
  );
  assert.equal(transform("for (const k in obj) print(k);"), "for await (const k of __loopKeys(obj)) print(k);");
});

test("nested loops each get a guard", () => {
  const out = transform(
    "for (let x = 0; x < n; x++) {\n  for (let y = 0; y < n; y++) {\n    while (!can_harvest()) {}\n    harvest();\n  }\n}",
  );
  assert.equal((out.match(/await __loopGuard\(\)/g) || []).length, 3);
  compiles(out);
});

test("named function with a loop (waiting helper) becomes async", () => {
  const out = transform("function wait() { while (!can_harvest()) {} }\nwait();");
  assert.equal(out, "async function wait() { while ((await __loopGuard(), (!can_harvest()))) {} }\nawait wait();");
});

test("loops inside sync callbacks get the sync guard", () => {
  const out = transform("[1].forEach(() => { for (let i = 0; i < 3; i++) {} });");
  assert.equal(out, "[1].forEach(() => { for (let i = 0; (__loopGuardSync(), (i < 3)); i++) {} });");
});

test("object and class methods", () => {
  const out = transform(
    "class D { go() { move(North); } get x() { return 1; } }\nconst o = { run() { harvest(); } };\nnew D().go(); o.run();",
  );
  assert.equal(
    out,
    "class D { async go() { await move(North); } get x() { return 1; } }\nconst o = { async run() { await harvest(); } };\nawait new D().go(); await o.run();",
  );
  compiles(out);
});

test("ASI-style code without semicolons keeps working", () => {
  const out = transform("let a = 1\nmove(North)\nharvest()");
  assert.equal(out, "let a = 1\nawait move(North)\nawait harvest()");
  compiles(out);
});

test("transform never adds newlines (error line numbers stay correct)", () => {
  const src = "function f() {\n  for (const x of [1]) {\n    while (true) { harvest(); break; }\n  }\n}\nf();";
  const out = transform(src);
  assert.equal(out.split("\n").length, src.split("\n").length);
});

test("tokenizer distinguishes division from regex", () => {
  const kinds = tokenize("a / b / c; x = /re/g").filter((t) => t.type !== "ws").map((t) => t.type);
  assert.deepEqual(kinds, ["ident", "punct", "ident", "punct", "ident", "punct", "ident", "punct", "regex"]);
});
