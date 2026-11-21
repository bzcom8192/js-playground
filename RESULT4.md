# RESULT 4: Farmer editor — TypeScript annotations + relaxed linter

Branch: `farmer-game` (on top of `203f479`). Everything in BRIEF4-TS.md is implemented. Not pushed.

```bash
npm run test:farmer    # 100 tests (86 old + 14 new in src/farmer/stripTypes.test.mjs) — all pass
npm run lint           # 0 problems
npm run build          # ✓ built
```

No new dependency. Type stripping is hand-written, like `transform.js`.

## Task A: annotations work in the Farmer editor

### What changed
- **`src/components/MonacoEditor.jsx`**
  - New `language` prop, default `"javascript"`. It is read once, when the editor is created. The Playground
    doesn't pass it, so it stays JavaScript.
  - New `lintPreprocess(code) → code` prop: the code is rewritten before ESLint sees it. `lintFilter` now
    receives `(messages, originalCode)`.
  - `typescriptDefaults` is configured once, leniently:
    - target ES2020
    - `strict`, `noImplicitAny`, `noImplicitThis`, `noImplicitReturns`, `noUnused*` all off
    - unreachable code and unused labels allowed
    - `lib: ["es2020"]`, **no DOM** (see "Uncertain" below)
  - The console typings are registered for TypeScript too.
  - Extra libs (the farmer API) are now registered with **both** `javascriptDefaults` and
    `typescriptDefaults`, so `GroundType`, `EntityType`, `ItemType`, `UnlockType` and `Direction` resolve in
    annotations.
  - The farmer lib is still ref-counted, so it only exists while the Farmer page is mounted.
  - TS diagnostic codes ignored in TS mode (`diagnosticCodesToIgnore`): 2304, 2552, 2584 (cannot find name),
    2300, 2393, 2451 (duplicate or redeclared identifiers), 1108, 1308, 1375, 1378 (top-level
    `return`/`await`).
    - **Why:** the TS worker treats every open editor as one shared global script and can't see closed
      windows. Each Farmer file is actually its own program.
    - Undefined names are still reported by ESLint, which already gets the correct per-file globals
      (the farmer API plus other files' functions).
- **`src/farmer/stripTypes.js`** (new): `stripTypes(code)`, `typeRanges(code)` and `dropStripArtifacts(messages, code)`.
- **`src/farmer/program.js`**: `buildProgram` strips every file **once**, at assembly time.
  - Declaration extraction (`listDeclarations`, `topLevelNames`, `extractDeclarations`), the auto-await
    `transform`, the syntax pre-check and the runtime therefore only see plain JS.
  - `prog.mainFile` is still the original file object.
- **`src/farmer/FarmerPage.jsx`**
  - `CodeWindow` passes `language="typescript"` and `lintPreprocess={stripTypes}`.
  - The lint filter drops strip artifacts (below).
  - The per-file lint-globals memo lists declarations from stripped code, so annotated helpers still count as
    importable functions.

### How stripping works
- **Tokens:** it uses the existing `tokenize` from `transform.js`. Strings, templates, comments and regex
  literals are single tokens, so they are never touched.
- **Blanked, not deleted:** type syntax is replaced by spaces, and newlines are kept. Output length, every
  newline offset, line numbers *and columns* are all identical to the editor.
- **Strict parsing:** each construct is parsed with a small type grammar that supports:
  - unions and intersections
  - `keyof` and `typeof`
  - generics `<…>`, including `>>`
  - `T[]` and `T[K]`
  - object, tuple and parenthesized types
  - function types
  - literal types
  - `x is T`

  If the parse doesn't end exactly where it must (a `{` after a function return type, `=>` after an arrow
  return type, and so on), that construct is **left untouched**. The player then gets a normal SyntaxError
  with the right line, never silently corrupted code.

Supported (all tested):

| Construct | Example |
|---|---|
| parameter annotations | `function go(arg: GroundType)`, destructured `({ x }: Pos)`, rest `...r: T[]`, with defaults `a: number = 1` |
| optional params | `(arg?: T)` |
| return types | `function f(): boolean {`, `(x: T): U => …`, `async (…): Promise<void> => …`, methods `go(d: Direction): boolean {` (object literals and class bodies), `function f(): { a: number } {` |
| variable annotations | `let g: GroundType = …`, several declarators, `for (let i: number = 0; …)`, destructuring |
| casts | `x as GroundType`, `as ItemType[]`, `as const` |
| non-null | `x!.y`, `x![i]` |
| type-only declarations | `type X<T> = …` (including multi-line `\| …` unions) and `interface X<T> extends A, B { … }`, blanked whole |
| generics on function declarations/expressions | `function f<T extends X = Y>(…)` (cheap, so done) |
| `catch (e: unknown)` | |

### Strip limits (left untouched, so they surface as a SyntaxError when run; TS mode marks them fine)
- `enum`, `namespace`, `declare …`, overload signatures without a body
- **class members:** field annotations `x: number = 0`, `public`/`private`/`readonly` modifiers (including
  constructor parameter properties), `implements`, class generics `class A<T>`
- **call-site type arguments** `f<T>(x)`, generic arrows `<T>(x: T) => x`, generic methods `m<T>() {}`,
  angle-bracket casts `<T>x`
- `this` parameters, conditional types (`A extends B ? C : D`), `satisfies`
- **Inside template literals:** `${x as T}` is not stripped, because the whole template is one token and the
  brief says templates must not be touched.
- **Known theoretical false positive:** `if (c) {} as(x)`, i.e. calling a function named `as` right after a
  block on the same line, would be blanked. I accepted this.

### Linting annotated code
- ESLint lints the stripped code. Positions are identical, so markers line up and there is no fatal parse
  error.
- **No fake spacing warnings:** `no-multi-spaces` is kept unchanged (it's not in the Stylistic section), but
  blanking `let g: GroundType = 1` leaves extra spaces. So the farmer path drops `no-multi-spaces` and
  `no-trailing-spaces` messages **only where they touch a blanked type range** (`dropStripArtifacts`). Real
  double spaces elsewhere are still reported.

### Tests (`src/farmer/stripTypes.test.mjs`, 14 tests)
- **Constructs:** each one in the table above. For every case, a `strips()` helper checks that:
  - the length is the same
  - every newline is at the same offset
  - the output equals the expected JS
  - the output compiles as an `AsyncFunction`
- **Left alone:**
  - strings, comments, templates and regexes containing `: Type`, `?:`, `as Foo` or `(x: T) => U` text
  - object literals, `case x:`, labels, ternaries (including `c ? (x) : y => y`), destructuring renames
  - all shipped examples and the helper file (returned byte-identical)
- **Unsupported or malformed input** (`enum`, `function f(a: )`, `let x: = 1`, `type = 5`) comes back
  untouched.
- **Declarations:** `listDeclarations` and `topLevelNames` work on stripped code, and auto-await still applies
  (`async function go(arg) { await move(North) }`).
- **End to end:** an annotated two-file program (helper `go_to(x: number, y: number): void`, plus the demo
  below) goes through `buildProgram` and runs in `createRuntime` on `createDemoGame()`. It checks:
  - the printed output
  - the final drone position (3, 2)
  - that an error thrown on the last line is reported as `Line 33: Error: boom`, so line mapping survives
    stripping
- **Lint:** the annotated program is a fatal parse error for raw espree, and has **zero** messages after
  strip and filter.
- **Relaxed linter:** missing semicolons, `;;`, spacing and blank lines give no messages. `no-undef`,
  `use-isnan` and `no-dupe-keys` still fire.

### Real-browser check (headless Chromium over CDP on `vite preview`; for my own checking)
I seeded three files:
- `crops`: the annotated demo, no semicolons
- `f0`: an annotated helper
- `bad`: `harvst()` plus `let zz: number = "text"`

I also seeded a farm save equal to the demo farm. Results:
- **`crops` and `f0`:** 0 squiggles in the rendered lines, and 0 error or warning marks on the
  overview ruler, which covers the whole file.
- **`bad` (control):** 2 errors (ESLint `no-undef` and TS "string not assignable to number") plus a warning,
  so marker detection works.
- **▶ Run crops** printed `harvested 1 ground Soil first North`, status *Finished*, drone at (3, 2).
- **Playground** still mounts its editor. It never passes `language`, so it stays `javascript`.

The annotated demo program:
```ts
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
```

I also ran Monaco's bundled TypeScript (`typescriptServices.js`) in node, with exactly these compiler options
and ignore codes, over all 6 examples, the helper and this demo. It found **0 shown diagnostics**: only
ignored 2451s for `const n` declared in two examples.

## Task B: linter relaxed (`src/utils/eslintConfig.js`, shared with the Playground)

These were set to `"off"`: the whole "Stylistic Issues" section (26 rules) plus `no-extra-semi`.

| Rule | Was |
|---|---|
| `array-bracket-spacing` | warn |
| `block-spacing` | warn |
| `brace-style` | warn |
| `comma-spacing` | warn |
| `comma-style` | warn |
| `computed-property-spacing` | warn |
| `eol-last` | warn |
| `func-call-spacing` | warn |
| `key-spacing` | warn |
| `keyword-spacing` | warn |
| `linebreak-style` | warn |
| `new-parens` | error |
| `no-array-constructor` | error |
| `no-mixed-spaces-and-tabs` | error |
| `no-multiple-empty-lines` | warn |
| `no-new-object` | error |
| `no-tabs` | error |
| `no-trailing-spaces` | warn |
| `object-curly-spacing` | warn |
| `semi` | error |
| `semi-spacing` | warn |
| `space-before-blocks` | warn |
| `space-before-function-paren` | warn |
| `space-in-parens` | warn |
| `space-infix-ops` | warn |
| `space-unary-ops` | warn |
| `no-extra-semi` (Possible Errors section) | error |

- **Unchanged:** every other rule and severity, including all correctness rules (`no-undef`, `no-dupe-args`,
  `no-redeclare`, `use-isnan`, …).
- **No `quotes` rule:** the config never had one, so there was nothing to turn off.

## Uncertain / worth a look
- **Two formatting rules outside the Stylistic section are still on**, as the brief said to keep other
  severities: `no-multi-spaces` (Best Practices) and `arrow-spacing` (ES6). Both are pure formatting. If the
  owner still sees style nagging (`a  = 1`, `x=>x`), turning these off is a one-line change each.
- **Farmer files are now type-checked (leniently).** Valid-JS patterns that TS rejects even with `strict` off
  now show a TS error in the Farmer editor. Example: `const o = {}; o.a = 1` gives "Property 'a' does not
  exist on type '{}'".
  - I kept these on purpose: the same check catches typos like `Entities.Pumpkn`.
  - If it annoys the owner, add 2339 to `diagnosticCodesToIgnore`.
  - None of the shipped examples trigger anything.
- **Misspelled type names aren't flagged.** Because "Cannot find name" (2304) is ignored in TS mode, a typo
  like `arg: GroundTyp` gets no marker and just behaves as `any`. Undefined *values* are still caught by
  ESLint.
- **No DOM typings in TS mode** (`lib: ["es2020"]`).
  - **Why:** with DOM, the player's own names clashed with DOM globals. For example, `interface Report` merged
    with DOM `Report` and produced a bogus "missing properties body, type, url" error.
  - **Effect:** farmer code doesn't get DOM IntelliSense.
- **Not done:** I didn't add an annotated example to the Docs examples list; the brief didn't ask for it.
