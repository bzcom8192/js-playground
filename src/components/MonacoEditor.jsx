import { useState, useRef, useEffect } from "react";
import { lintCode, convertToMonacoMarkers } from "../utils/linter";

export default function MonacoEditor({ value, onChange, fallback }) {
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
    if (editorRef.current && editorRef.current.getValue() !== value) {
      editorRef.current.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    let isMounted = true;

    const initMonaco = async () => {
      if (editorRef.current || !containerRef.current) return;

      const monaco = await import("monaco-editor");

      if (!isMounted) return;

      // Configure JavaScript language features
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution:
          monaco.languages.typescript.ModuleResolutionKind.NodeJs,
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
            [/\d+/, "number"],
            [/[;,.]/, "delimiter"],
            [/[()]/, "delimiter.parenthesis"],
            [/[[\]]/, "delimiter.bracket"],
            [/[{}]/, "delimiter.brace"],
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

      editorRef.current = monaco.editor.create(containerRef.current, {
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

      editorRef.current.addCommand(
        monaco.KeyCode.Tab,
        () => {
          editorRef.current.trigger("keyboard", "acceptSelectedSuggestion", {});
        },
        "suggestWidgetVisible",
      );

      // Lint on content change
      let lintTimeout;
      editorRef.current.onDidChangeModelContent(() => {
        const currentVal = editorRef.current.getValue();
        if (currentVal !== valueRef.current) {
          onChange(currentVal);
        }

        // Debounce linting
        clearTimeout(lintTimeout);
        lintTimeout = setTimeout(() => {
          const lintMessages = lintCode(currentVal);
          const markers = convertToMonacoMarkers(lintMessages);
          const model = editorRef.current.getModel();
          if (model) {
            monaco.editor.setModelMarkers(model, "eslint", markers);
          }
        }, 500);
      });

      // Initial lint
      const initialLintMessages = lintCode(valueRef.current);
      const initialMarkers = convertToMonacoMarkers(initialLintMessages);
      const model = editorRef.current.getModel();
      if (model) {
        monaco.editor.setModelMarkers(model, "eslint", initialMarkers);
      }

      setLoaded(true);
    };

    initMonaco();

    return () => {
      isMounted = false;
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, [onChange]);

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
