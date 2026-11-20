import { useState, useRef, useEffect } from "react";
import { lintCode, convertToMonacoMarkers } from "../utils/linter";

// ---------------------------------------------------------------------------
// Global Monaco setup. Theme, tokenizer, compiler options and the console
// typings are process-wide singletons in Monaco, so register them ONCE per page
// load instead of on every mount (AUDIT.md #5).
// ---------------------------------------------------------------------------
let globalSetupDone = false;

function setupMonacoOnce(monaco) {
  if (globalSetupDone) return;
  globalSetupDone = true;

  // Configure JavaScript language features
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monaco.languages.typescript.ModuleKind.CommonJS,
    noEmit: true,
    esModuleInterop: true,
    jsx: monaco.languages.typescript.JsxEmit.React,
    reactNamespace: "React",
    allowJs: true,
    typeRoots: ["node_modules/@types"],
  });

  // Enable eager model sync for better syntax highlighting
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);

  // Add common JavaScript globals for better IntelliSense
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    `
    declare const console: Console;
    interface Console {
      log(...data: any[]): void;
      error(...data: any[]): void;
      warn(...data: any[]): void;
      info(...data: any[]): void;
      clear(): void;
    }
    `,
    "ts:console.d.ts",
  );

  // Define custom theme with proper syntax highlighting
  // Monaco's JavaScript tokens: identifier, keyword, string, number, etc.
  monaco.editor.defineTheme("custom-dark", {
    base: "vs-dark",
    inherit: false,
    rules: [
      // Keywords like: const, let, var, function, return, if, else, for, while, true, false, null, undefined
      { token: "keyword", foreground: "569CD6", fontStyle: "bold" },
      { token: "keyword.js", foreground: "569CD6" },

      // Methods (like .log, .push, .map) - Yellow
      { token: "method", foreground: "DCDCAA" },

      // Identifiers (variable names, object names like 'console') - Light Blue
      { token: "identifier", foreground: "9CDCFE" },
      { token: "identifier.js", foreground: "9CDCFE" },
      { token: "variable", foreground: "9CDCFE" },
      { token: "variable.js", foreground: "9CDCFE" },

      // Types and classes
      { token: "type", foreground: "4EC9B0" },
      { token: "type.identifier", foreground: "4EC9B0" },
      { token: "class", foreground: "4EC9B0" },

      // Strings
      { token: "string", foreground: "CE9178" },
      { token: "string.js", foreground: "CE9178" },
      { token: "string.escape", foreground: "D7BA7D" },

      // Numbers
      { token: "number", foreground: "B5CEA8" },
      { token: "number.js", foreground: "B5CEA8" },
      { token: "number.float", foreground: "B5CEA8" },
      { token: "number.hex", foreground: "B5CEA8" },
      { token: "number.octal", foreground: "B5CEA8" },
      { token: "number.binary", foreground: "B5CEA8" },

      // Comments
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "comment.js", foreground: "6A9955" },
      { token: "comment.line", foreground: "6A9955" },
      { token: "comment.block", foreground: "6A9955" },

      // Operators
      { token: "operator", foreground: "D4D4D4" },
      { token: "operator.js", foreground: "D4D4D4" },

      // Delimiters
      { token: "delimiter", foreground: "D4D4D4" },
      { token: "delimiter.paren", foreground: "FFD700" },
      { token: "delimiter.parenthesis", foreground: "FFD700" },
      { token: "delimiter.square", foreground: "FFD700" },
      { token: "delimiter.bracket", foreground: "FFD700" },
      { token: "delimiter.curly", foreground: "FFD700" },
      { token: "delimiter.brace", foreground: "FFD700" },

      // Regexp
      { token: "regexp", foreground: "D16969" },
      { token: "regexp.js", foreground: "D16969" },

      // Tag (for JSX/HTML)
      { token: "tag", foreground: "569CD6" },
      { token: "metatag", foreground: "569CD6" },

      // Attributes
      { token: "attribute.name", foreground: "9CDCFE" },
      { token: "attribute.value", foreground: "CE9178" },

      // Other
      { token: "", foreground: "D4D4D4" },
    ],
    colors: {
      "editor.background": "#1e1e1e",
      "editor.foreground": "#D4D4D4",
      "editor.lineHighlightBackground": "#2A2A2A",
      "editorCursor.foreground": "#AEAFAD",
      "editor.selectionBackground": "#264F78",
      "editorLineNumber.foreground": "#858585",
      "editorLineNumber.activeForeground": "#C6C6C6",
    },
  });

  // Custom tokenizer to differentiate methods from identifiers
  monaco.languages.setMonarchTokensProvider("javascript", {
    tokenizer: {
      root: [
        // Comments
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@block_comment"],

        [/\.[a-zA-Z_$][\w$]*/, "method"],
        [
          /[a-zA-Z_$][\w$]*/,
          {
            cases: {
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/'/, "string", "@string_single"],
        [/`/, "string", "@string_backtick"],
        [/0[xX][0-9a-fA-F]+/, "number.hex"],
        [/0[bB][01]+/, "number.binary"],
        [/0[oO][0-7]+/, "number.octal"],
        [/\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
        [/[;,.]/, "delimiter"],
        [/[()]/, "delimiter.parenthesis"],
        [/[[\]]/, "delimiter.bracket"],
        [/[{}]/, "delimiter.brace"],
      ],
      block_comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      string_double: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],
      string_single: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, "string", "@pop"],
      ],
      string_backtick: [
        [/[^\\`]+/, "string"],
        [/\\./, "string.escape"],
        [/`/, "string", "@pop"],
      ],
    },
    keywords: [
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "debugger",
      "default",
      "delete",
      "do",
      "else",
      "export",
      "extends",
      "false",
      "finally",
      "for",
      "function",
      "if",
      "import",
      "in",
      "instanceof",
      "let",
      "new",
      "null",
      "return",
      "super",
      "switch",
      "this",
      "throw",
      "true",
      "try",
      "typeof",
      "undefined",
      "var",
      "void",
      "while",
      "with",
      "yield",
      "async",
      "await",
      "of",
    ],
  });
}

// Page-specific typings (e.g. the Farmer API) are ref-counted per fileName so
// they exist only while an editor that asked for them is mounted. Pages
// unmount on route change, so the playground never sees farmer globals.
const extraLibRegistry = new Map(); // fileName -> { content, refs, disposable }

function acquireExtraLib(monaco, lib) {
  if (!lib || !lib.fileName || !lib.content) return () => {};
  const defaults = monaco.languages.typescript.javascriptDefaults;
  let entry = extraLibRegistry.get(lib.fileName);
  if (entry && entry.content !== lib.content) {
    entry.disposable.dispose();
    entry.disposable = defaults.addExtraLib(lib.content, lib.fileName);
    entry.content = lib.content;
  } else if (!entry) {
    entry = {
      content: lib.content,
      refs: 0,
      disposable: defaults.addExtraLib(lib.content, lib.fileName),
    };
    extraLibRegistry.set(lib.fileName, entry);
  }
  entry.refs++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.refs--;
    if (entry.refs <= 0) {
      entry.disposable.dispose();
      extraLibRegistry.delete(lib.fileName);
    }
  };
}

/**
 * Shared Monaco editor.
 * Props: { value, onChange, fallback, onRun?, onSave?, extraLib?, lintGlobals? }
 *  - onRun:  Ctrl/Cmd+Enter inside the editor
 *  - onSave: Ctrl/Cmd+S inside the editor (browser "Save page" is suppressed)
 *  - extraLib: { content, fileName } extra .d.ts for IntelliSense
 *  - lintGlobals: { name: "readonly" } extra ESLint globals
 *  - lintFilter: (messages) => messages — optional post-filter of lint results
 * Callbacks are read through refs, so passing inline functions does NOT
 * recreate the editor (AUDIT.md #2).
 */
export default function MonacoEditor({
  value,
  onChange,
  fallback,
  onRun,
  onSave,
  extraLib,
  lintGlobals,
  lintFilter,
}) {
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const valueRef = useRef(value);
  const lastEmittedRef = useRef(value);
  const applyingExternalRef = useRef(false);

  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  const lintGlobalsRef = useRef(lintGlobals);
  const lintFilterRef = useRef(lintFilter);
  // Captured once: which optional features the editor is created with.
  const initRef = useRef({ hasRun: !!onRun, hasSave: !!onSave, extraLib });

  useEffect(() => {
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
    onSaveRef.current = onSave;
    lintGlobalsRef.current = lintGlobals;
    lintFilterRef.current = lintFilter;
  });

  // External value changes (snapshot load, reset, import, example load).
  useEffect(() => {
    valueRef.current = value;
    const editor = editorRef.current;
    if (!editor) return;
    // Echo of what the editor itself just emitted → nothing to do (AUDIT.md #3).
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const model = editor.getModel();
    if (!model || model.getValue() === value) return;
    // Replace through an edit operation instead of setValue(), so the change
    // is undoable (Ctrl+Z restores the previous code) and doesn't echo back.
    applyingExternalRef.current = true;
    try {
      editor.pushUndoStop();
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: value }],
        () => null,
      );
      editor.pushUndoStop();
      editor.setPosition({ lineNumber: 1, column: 1 });
    } finally {
      applyingExternalRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    let isMounted = true;
    let lintTimeout = null;
    const disposables = [];
    let releaseLib = () => {};

    const initMonaco = async () => {
      if (editorRef.current || !containerRef.current) return;

      const monaco = await import("monaco-editor");

      if (!isMounted) return;

      setupMonacoOnce(monaco);
      releaseLib = acquireExtraLib(monaco, initRef.current.extraLib);


      const editor = monaco.editor.create(containerRef.current, {
        value: valueRef.current,
        language: "javascript",
        theme: "custom-dark",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'Fira Code', 'Consolas', monospace",
        scrollBeyondLastLine: false,
        padding: { top: 16 },
        roundedSelection: false,
        renderLineHighlight: "all",

        tabCompletion: "off",
        acceptSuggestionOnEnter: "on",
        quickSuggestions: { other: true, comments: true, strings: true },
        autoClosingBrackets: "always",
        autoIndent: "full",
        formatOnType: true,
        formatOnPaste: true,
        suggestOnTriggerCharacters: true,
        wordBasedSuggestions: "currentDocument",
      });
      editorRef.current = editor;
      lastEmittedRef.current = valueRef.current;

      // Tab accepts the suggestion while the widget is open; otherwise Monaco's
      // default Tab (indent) applies. addAction is scoped to this editor and
      // disposable — the old addCommand() leaked a global keybinding (AUDIT.md #6).
      disposables.push(
        editor.addAction({
          id: "jsplay.acceptSuggestionTab",
          label: "Accept Suggestion",
          keybindings: [monaco.KeyCode.Tab],
          keybindingContext: "suggestWidgetVisible",
          run: (ed) => ed.trigger("keyboard", "acceptSelectedSuggestion", {}),
        }),
      );

      if (initRef.current.hasRun) {
        disposables.push(
          editor.addAction({
            id: "jsplay.run",
            label: "Run Code",
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
            run: () => onRunRef.current?.(),
          }),
        );
      }
      if (initRef.current.hasSave) {
        disposables.push(
          editor.addAction({
            id: "jsplay.save",
            label: "Save",
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
            run: () => onSaveRef.current?.(),
          }),
        );
      }

      // Duplicate line with Alt+Shift+Arrow like on Windows. Monaco remaps
      // its built-in Copy Line actions to Ctrl+Alt+Shift+Arrow on Linux
      // (Alt+Shift is the classic X11 layout-switch combo), so the Windows
      // chord does nothing there — rebind it explicitly.
      disposables.push(
        editor.addAction({
          id: "jsplay.copyLinesDown",
          label: "Copy Line Down",
          keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.DownArrow],
          run: (ed) => ed.trigger("keyboard", "editor.action.copyLinesDownAction", {}),
        }),
        editor.addAction({
          id: "jsplay.copyLinesUp",
          label: "Copy Line Up",
          keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.UpArrow],
          run: (ed) => ed.trigger("keyboard", "editor.action.copyLinesUpAction", {}),
        }),
      );

      const runLint = () => {
        const model = editor.getModel();
        if (!isMounted || !model || model.isDisposed()) return;
        let messages = lintCode(model.getValue(), lintGlobalsRef.current);
        if (lintFilterRef.current) messages = lintFilterRef.current(messages);
        const markers = convertToMonacoMarkers(messages);
        monaco.editor.setModelMarkers(model, "eslint", markers);
      };

      // Lint on content change
      disposables.push(
        editor.onDidChangeModelContent(() => {
          if (!applyingExternalRef.current) {
            const currentVal = editor.getValue();
            lastEmittedRef.current = currentVal;
            valueRef.current = currentVal;
            onChangeRef.current?.(currentVal);
          }

          // Debounce linting
          clearTimeout(lintTimeout);
          lintTimeout = setTimeout(runLint, 500);
        }),
      );

      // Initial lint
      runLint();

      setLoaded(true);
    };

    initMonaco();

    return () => {
      isMounted = false;
      clearTimeout(lintTimeout); // AUDIT.md #4
      disposables.forEach((d) => d.dispose());
      releaseLib();
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <div className={`absolute inset-0 ${loaded ? "hidden" : "block"}`}>
        {fallback}
      </div>
      <div
        ref={containerRef}
        className={`absolute inset-0 w-full h-full ${
          loaded ? "opacity-100 z-10" : "opacity-0 -z-10"
        }`}
      />
    </>
  );
}
