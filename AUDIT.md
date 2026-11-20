# Editor & Keyboard-Shortcut Audit

Scope: the shared `MonacoEditor` component, the playground page (`App.jsx`), and the
keyboard handling on both pages (playground + the new JS Farmer page).
Baseline: commit `430a864` (main). "Old" line refs point to that commit; "new" refs
point to branch `farmer-game`.

Each item was checked against the actual code, and where possible in headless Chromium
against the built app (`vite preview`) through the DevTools protocol. Items checked only
by reading code are marked *(by inspection)*.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 0 | **Critical** | Playground crashes on the default demo (React #31) | **Fixed** |
| 1 | High | Ctrl/Cmd+Enter is documented but doesn't exist | **Fixed** |
| 2 | Medium (latent) | Editor re-created whenever `onChange` changes identity | **Fixed** |
| 3 | Low | External value sync uses `setValue()` (wipes undo) | **Fixed** (undo kept) |
| 4 | Medium | Lint timer not cleared on unmount → TypeError | **Fixed** |
| 5 | Medium | Global Monaco registrations on every mount; no page-scoped typings | **Fixed** |
| 6 | Low | Tab `addCommand` leaks a global keybinding | **Fixed** (behavior kept) |
| 7 | Low | Fallback textarea Tab handler reads `code` from the render closure | **Fixed** |
| 8 | Medium | No list of shortcuts anywhere in the UI | **Fixed** |
| 9 | Medium | Ctrl+S opens the browser's "Save page" dialog | **Fixed** |
| 10 | Medium (Farmer) | Farmer API names flagged as undefined | **Fixed**; playground: no double report |
| 11 | Low | Custom Monarch tokenizer vs formatOnType/Paste | Noted |
| 12a | Medium | No Esc to close the History sidebar | **Fixed** |
| 12b | Low | `playground_autorun` is written but never read | Noted |
| 12c | Medium | Playground runs code synchronously, so an infinite loop freezes the tab | Noted |
| 12d | Low | Playground lint uses `ecmaVersion: 2020`, so valid newer syntax shows as a parse error | Noted |
| 12e | Info | `@monaco-editor/react` dependency is unused | Noted |

---

## 0. Playground crashes when logging an object — Critical — FIXED
*Not in the original hypothesis list; found during browser verification.*

- **Where:** old `src/App.jsx:561` — `<Suspense fallback={<span>{part.value}</span>}>`.
- **What:** `ObjectInspector` (and its siblings) are `lazy()` components. The first time an
  object is logged, the chunk is still loading, so the Suspense fallback renders
  `{part.value}`, which is a plain object. React throws error #31 ("Objects are not valid as a
  React child"), and because there is no error boundary the **whole page unmounts**.
  The default demo code logs an object (`console.log(user)`), so pressing **Run** on a
  fresh visit produced a blank page.
- **Verified:** I built the original commit in a temporary worktree and clicked Run in
  headless Chromium. The exception was `Minified React error #31 … object with keys {id, name, roles, config}`.
  The same check on this branch now shows the console output with no exceptions.
- **Fix:** the fallback renders `"…"` for objects and `String(value)` otherwise (new
  `src/App.jsx:598-606`). This is a one-line, behavior-preserving fix.

## 1. Ctrl/Cmd+Enter doesn't exist — High — FIXED
- **Where:** README.md:41 and :136 claim it; old `MonacoEditor.jsx` registers no such
  keybinding, and `App.jsx` has no global key handler. Inside Monaco, Ctrl+Enter ran
  Monaco's default "insert line below" instead.
- **Fix:** `MonacoEditor` has a new optional `onRun` prop. It registers an editor action
  bound to `KeyMod.CtrlCmd | KeyCode.Enter` (new `MonacoEditor.jsx:390-399`), which replaces
  the insert-line default only when `onRun` is given. The playground wires it to
  `executeCode` (new `App.jsx:529`). The Farmer page wires it to Run/Stop.
  A page-level handler (`src/hooks/usePageShortcuts.js`) covers focus outside the editor,
  **including the fallback textarea**. Monaco calls `preventDefault()` and `stopPropagation()`
  on keys it handles, so the action never fires twice.
- **Verified (Chromium):** Ctrl+Enter inside the editor runs the playground code (console
  shows output, line count unchanged) and toggles Run→Stop on the Farmer page.

## 2. Editor re-created when `onChange` changes — Medium (latent) — FIXED
- **Where:** old `MonacoEditor.jsx:317` — the init effect depends on `[onChange]`.
- **Reality check:** the playground passes `setCode`, which is identity-stable, so the
  playground itself never hit this. Any inline callback would have disposed and re-created
  the editor on every render, losing undo, cursor and focus and causing a flicker. The Farmer
  page needs inline/derived callbacks.
- **Fix:** `onChange`, `onRun`, `onSave` and `lintGlobals` are read through refs that are
  updated after each render (new `:300-305`). The init effect runs once (`[]`, new `:454`).

## 3. External value sync via `setValue()` — Low — FIXED
- **Where:** old `MonacoEditor.jsx:10-15`.
- **Reality check:** the hypothesis said the change "echoes back to `onChange`". That is **not
  true** in the old code: `valueRef` was updated before `setValue`, so the change handler's
  `currentVal !== valueRef.current` guard suppressed the echo. The real problem is that
  `setValue()` **wipes the undo stack**, so after loading a snapshot, resetting, or importing
  there was no way back with Ctrl+Z.
- **Fix:** (new `:308-332`)
  - Values the editor emitted itself are recognized (`lastEmittedRef`) and skipped.
  - Real external values replace the text with `model.pushEditOperations` between
    `pushUndoStop()`s, so **loading a snapshot or example is undoable** with Ctrl+Z.
  - An explicit `applyingExternalRef` flag ensures programmatic replaces never reach `onChange`.
  - The cursor still moves to 1:1, as before.
- **Remaining:** none known. A theoretical race, where React re-renders with an *older* emitted
  value while the user is still typing, is not handled. React 19 renders keyboard-triggered
  updates synchronously, so it should not occur.

## 4. Lint timeout not cleared — Medium — FIXED
- **Where:** old `MonacoEditor.jsx:278-295` (local `lintTimeout`, never cleared).
- **What:** unmounting within 500 ms of a keystroke let the timer fire after cleanup had set
  `editorRef.current = null`. Then `editorRef.current.getModel()` threw a **TypeError**.
  This became reachable once pages unmount on route change.
- **Fix:** the timer is cleared in cleanup (new `:446`). The lint callback also bails out if
  unmounted or if the model is disposed (new `:411-418`).

## 5. Global Monaco singletons re-registered on each mount — Medium — FIXED
- **Where:** old `MonacoEditor.jsx:28-63` (compiler options + `console.d.ts`), `:67`
  (`defineTheme`), `:148` (`setMonarchTokensProvider`, whose disposable was dropped).
- **Fix:** `setupMonacoOnce()` (new `:11`) registers the theme, tokenizer, compiler options
  and console typings once per page load. A new `extraLib` prop (`{content, fileName}`) is
  ref-counted per fileName (`acquireExtraLib`, new `:238`) and disposed when the last editor
  using it unmounts.
- **Verified (Chromium):** after switching Farmer → Playground, the playground flags
  `harvest()` as undefined again, so the farmer typings and globals are gone. Switching
  back and forth produced no console errors.

## 6. Tab handling — Low — FIXED (behavior unchanged)
- **Where:** old `MonacoEditor.jsx:269-275` — `addCommand(KeyCode.Tab, …, "suggestWidgetVisible")`.
- **Reality check:** Tab still indents when no suggestion widget is open, because the command
  only matches inside that context. Monaco's own default also accepts a suggestion on Tab, so
  the command is redundant but harmless **as behavior**. However, in Monaco 0.55
  `addCommand` (`standaloneCodeEditor.js:84-93`) registers a **global** dynamic keybinding.
  It has no `editorId` precondition, it throws away its disposable, and its handler closes over
  the old component's `editorRef`. Every remount (now: every route switch) leaked another
  global Tab binding pointing at a disposed editor.
- **Fix:** replaced with `editor.addAction({ keybindings: [Tab], keybindingContext:
  "suggestWidgetVisible" })` (new `:380-387`). This is editor-scoped and disposed on unmount.

## 7. Fallback textarea Tab handler uses the render closure — Low — FIXED
- **Where:** old `App.jsx:176-187` used `code` from the render closure.
- **Reality check:** the handler was re-created every render, so the value was rarely stale.
  The textarea is only visible while Monaco loads, or if loading fails.
- **Fix:** it now reads the live `e.target.value` (new `App.jsx:178-191`). Ctrl/Cmd+Enter and
  Ctrl/Cmd+S from the textarea reach the page-level handler (#1, #9).

## 8. No discoverable shortcut list — Medium — FIXED
- **Fix:** new shared `src/components/ShortcutsModal.jsx` (Esc / backdrop closes it), opened
  by a **⌨** header button on both pages, or by `?` when focus is **not** in the editor or a
  form field, so typing `?` is never hijacked. The modal lists only shortcuts that actually
  work (`src/shortcuts.js`): Ctrl/Cmd+Enter, Ctrl/Cmd+S, Esc, `?`, plus Monaco built-ins
  (Ctrl+F, Ctrl+H, Shift+Alt+F, Ctrl+/, Ctrl+Space, Tab, Alt+↑/↓, Ctrl+D, Ctrl+Z, F1).
- **Verified (Chromium):** `?` opens the modal, and Esc closes it.

## 9. Ctrl+S triggers the browser's Save-page dialog — Medium — FIXED
- **Fix:** an `onSave` prop registers a Ctrl/Cmd+S editor action (new `MonacoEditor.jsx:400-409`).
  The page-level handler calls `preventDefault()` everywhere else on the page.
  - Playground: Ctrl+S saves a snapshot, exactly like the Save button (it also opens History).
  - Farmer: Ctrl+S saves `farmer_code` and `farmer_save_v1` immediately and shows a "✓ Saved" note.
- **Verified (Chromium):** both behaviors.

## 10. Lint and TS diagnostics on the Farmer page — Medium — FIXED
- **Reality check:** the red squiggles for unknown names come from **ESLint `no-undef`**, not
  from the TypeScript service. Monaco's TS worker does not report semantic errors such as
  "Cannot find name" for plain JS unless `checkJs` is on.
- **Verified (Chromium):** with `harvest(); not_defined_xyz();` in the editor:
  - playground: 2 error squiggles (ESLint only, no TS duplicates)
  - Farmer page: 1 (only `not_defined_xyz`)
- **Fix:** `lintCode(code, extraGlobals)` (`src/utils/linter.js:9`, cached per globals object),
  plus a new `lintGlobals` prop. The Farmer page passes `FARMER_GLOBALS` and a full JSDoc'd
  `farmer-api.d.ts` through `extraLib` (`src/farmer/farmerLib.js`), which gives IntelliSense
  and hover docs. The playground is unchanged.

## 11. formatOnType/formatOnPaste with the custom Monarch tokenizer — Low — NOTED
*(by inspection)*

Formatting edits come from the TypeScript worker's formatter, which uses the real TS parser.
They don't use the Monarch tokenizer, so template literals are not corrupted by formatting.
The tokenizer itself (old `:148-243`) is simplistic, which affects **highlighting and
bracket matching only**:
- no regex-literal rule, so `/"/` starts a "string" until the next quote;
- `${…}` inside templates is coloured as string;
- operators are untokenized.

Left as is to avoid churn.

## 12. Other findings
- **a. Esc doesn't close the History sidebar — FIXED.** The sidebar (old `App.jsx:329`) only
  closed via its X button or backdrop. Esc now closes it (`usePageShortcuts` `onEscape`), and
  also the Shortcuts modal and the Farmer "⋯" menu. *Verified in Chromium.*
- **b. `playground_autorun` is write-only — NOTED.** The value is saved (old `App.jsx:101`), but
  `isAutoRun` always starts `false` (old `:70`), so the preference is never restored. Not fixed:
  restoring it would auto-run code on page load, which is a behavior change.
- **c. Synchronous execution — NOTED.** The playground runs `new Function(...)` synchronously
  (old `App.jsx:160`), so `while(true){}` freezes the tab with no way to stop it. The Farmer
  page solves this with its transform and loop guards. Porting that to the playground would
  change its semantics (sync → async), so it's out of scope.
- **d. `ecmaVersion: 2020` in `src/utils/eslintConfig.js:4` — NOTED.** Valid ES2021+ syntax
  (`??=`, `1_000`, class fields, top-level `await`) shows as an ESLint "Parsing error" squiggle
  even though it runs. A one-word fix (`"latest"`) was left to the owner because it changes
  playground lint output. The Farmer page relies on the runtime's own syntax check, so it is
  unaffected.
- **e. `@monaco-editor/react` is unused — NOTED.** It is listed in `dependencies` but imported
  nowhere. Not removed, because the brief asks not to change dependencies.
- The old `handleKeyDown` is not dead code: it serves the fallback textarea, which is visible
  until Monaco loads (or forever if Monaco fails to load). It was kept and fixed (#7).

## Backward compatibility
`MonacoEditor` props are now `{value, onChange, fallback, onRun?, onSave?, extraLib?, lintGlobals?}`.
All new props are optional. Without `onRun`/`onSave` the editor keeps Monaco's default
Ctrl+Enter/Ctrl+S behavior. The playground's localStorage keys (`playground_code`,
`playground_history`, `playground_autorun`) are unchanged; the Chromium check confirmed the
key set.
