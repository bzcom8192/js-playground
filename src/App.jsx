import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as monaco from 'monaco-editor';

// Import workers for local Monaco (Vite/Webpack 5 compatible)
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

// --- Icons ---
const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const BoltIcon = ({ active }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-yellow-400" : "text-gray-400"}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
  </svg>
);

const ChevronRight = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="9 18 15 12 9 6"></polyline></svg>
);

const HistoryIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
);

const SaveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
    <polyline points="17 21 17 13 7 13 7 21"></polyline>
    <polyline points="7 3 7 8 15 8"></polyline>
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
);

const SmallDownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
);

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="17 8 12 3 7 8"></polyline>
    <line x1="12" y1="3" x2="12" y2="15"></line>
  </svg>
);

const CodeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
    </svg>
);

// --- Monaco Component ---

const MonacoEditor = ({ value, onChange, fallback }) => {
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const valueRef = useRef(value);

  // Sync value ref for events
  useEffect(() => {
    valueRef.current = value;
    if (editorRef.current && editorRef.current.getValue() !== value) {
        // Only update if different to prevent cursor jumping
        editorRef.current.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (editorRef.current) return; // Already initialized

    if (containerRef.current) {
      editorRef.current = monaco.editor.create(containerRef.current, {
          value: valueRef.current,
          language: 'javascript',
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: "'Fira Code', 'Consolas', monospace",
          scrollBeyondLastLine: false,
          padding: { top: 16 },
          roundedSelection: false,
          renderLineHighlight: 'all',

          // --- Interaction Improvements ---
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

        // FIX: Bind Tab key to accept selected suggestion when widget is visible
        editorRef.current.addCommand(monaco.KeyCode.Tab, () => {
           editorRef.current.trigger('keyboard', 'acceptSelectedSuggestion', {});
        }, 'suggestWidgetVisible');

        editorRef.current.onDidChangeModelContent(() => {
          const currentVal = editorRef.current.getValue();
          if (currentVal !== valueRef.current) {
             onChange(currentVal);
          }
        });

      setLoaded(true);
    }
    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []); // Run once on mount

  return (
    <>
      <div className={`absolute inset-0 ${loaded ? 'hidden' : 'block'}`}>
        {fallback}
      </div>
      <div
        ref={containerRef}
        className={`absolute inset-0 w-full h-full ${loaded ? 'opacity-100 z-10' : 'opacity-0 -z-10'}`}
      />
    </>
  );
};

// --- Smart Components ---

const NumberToggle = ({ value }) => {
  const [isHex, setIsHex] = useState(false);
  if (isNaN(value) || !isFinite(value)) return <span className="text-purple-400 font-bold">{String(value)}</span>;

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setIsHex(!isHex); }}
      className="cursor-pointer text-blue-400 hover:text-blue-300 border-b border-dotted border-blue-500/50 hover:border-blue-300 font-bold transition-colors"
      title="Toggle Decimal / Hex"
    >
      {isHex ? `0x${value.toString(16).toUpperCase()}` : value}
    </span>
  );
};

const BooleanToggle = ({ value }) => {
  const [mode, setMode] = useState(0);
  const display = [
    { t: 'true', f: 'false' },
    { t: 'Yes', f: 'No' },
    { t: '1', f: '0' }
  ];

  const text = value ? display[mode].t : display[mode].f;
  const color = value ? 'text-green-400' : 'text-red-400';

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setMode((m) => (m + 1) % 3); }}
      className={`cursor-pointer ${color} hover:underline decoration-dotted underline-offset-4 font-bold transition-all`}
      title="Toggle format (True/Yes/1)"
    >
      {text}
    </span>
  );
};

const SmartString = ({ value }) => {
  const isColor = /^(#[0-9a-f]{3,8}|rgba?\s*\(|hsla?\s*\()/i.test(value);
  const isUrl = /^(https?:\/\/[^\s]+)/i.test(value);

  if (isColor) {
    return (
      <span className="inline-flex items-center gap-1.5 bg-gray-800/50 px-1.5 rounded border border-gray-700/50 align-middle mx-1">
        <span
          className="w-3 h-3 rounded-[2px] border border-white/20 shadow-sm"
          style={{ backgroundColor: value }}
        />
        <span className="text-[#ce9178] font-mono">"{value}"</span>
      </span>
    );
  }

  if (isUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 underline hover:text-blue-300 break-all decoration-dotted underline-offset-4"
        onClick={(e) => e.stopPropagation()}
      >
        "{value}"
      </a>
    );
  }

  return <span className="text-[#ce9178] whitespace-pre-wrap">"{value}"</span>;
};

const ObjectInspector = ({ value }) => {
  const [expanded, setExpanded] = useState(false);

  const safeStr = (v) => {
    try { return JSON.stringify(v, null, 2); }
    catch (e) { return '[Circular]'; }
  };

  const isArray = Array.isArray(value);
  const isEmpty = isArray ? value.length === 0 : Object.keys(value).length === 0;

  if (isEmpty) {
    return <span className="text-gray-500 italic">{isArray ? '[]' : '{}'}</span>;
  }

  const preview = isArray
    ? `Array(${value.length})`
    : `{ ${Object.keys(value).slice(0, 3).join(', ')}${Object.keys(value).length > 3 ? '...' : ''} }`;

  return (
    <div className="inline-block align-top">
      {!expanded ? (
        <span
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="cursor-pointer text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 px-1 rounded transition-colors flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3" />
          <span className="italic">{preview}</span>
        </span>
      ) : (
        <div className="relative group">
           <div
             onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
             className="absolute left-[-16px] top-1 cursor-pointer text-gray-500 hover:text-white"
           >
             <ChevronRight className="w-3 h-3 rotate-90" />
           </div>
           <pre className="text-xs text-green-300/90 bg-[#161b22] p-2 rounded border border-gray-700/50 overflow-x-auto mt-1 ml-1 shadow-xl">
             {safeStr(value)}
           </pre>
        </div>
      )}
    </div>
  );
};

const DEFAULT_CODE = `// Smart Console Features:
// 1. Numbers: Click to toggle Hex/Dec
console.log(255, 0xFF);

// 2. Booleans: Click to toggle True/Yes/1
console.log(true, false);

// 3. Smart Strings: Colors and URLs
console.log("#ef4444", "rgb(34, 197, 94)");
console.log("https://react.dev");

// 4. Objects: Expandable/Collapsible
const user = {
  id: 1,
  name: "Alice",
  roles: ["admin", "editor"],
  config: { theme: "dark", active: true }
};
console.log(user);
`;

export default function App() {
  // --- State ---
  const [code, setCode] = useState(() => {
    try {
      const savedCode = localStorage.getItem('playground_code');
      return savedCode !== null ? savedCode : DEFAULT_CODE;
    } catch (e) {
      console.warn('LocalStorage access denied', e);
      return DEFAULT_CODE;
    }
  });

  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);

  const [isAutoRun, setIsAutoRun] = useState(false);

  // History State
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('playground_history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const consoleEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, error]);

  // --- Persistence Effects ---
  useEffect(() => {
    try {
      localStorage.setItem('playground_code', code);
    } catch (e) {}
  }, [code]);

  useEffect(() => {
    try {
      localStorage.setItem('playground_autorun', String(isAutoRun));
    } catch (e) {}
  }, [isAutoRun]);

  useEffect(() => {
    try {
      localStorage.setItem('playground_history', JSON.stringify(history));
    } catch (e) {}
  }, [history]);

  // --- Logic ---

  const safeStringify = (arg) => {
    try {
      if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
      return String(arg);
    } catch (e) {
      return '[Circular]';
    }
  };

  const processArgs = (args) => {
    return args.map(arg => {
      if (arg === null) return { type: 'null', value: 'null' };
      if (arg === undefined) return { type: 'undefined', value: 'undefined' };
      if (typeof arg === 'number') return { type: 'number', value: arg };
      if (typeof arg === 'boolean') return { type: 'boolean', value: arg };
      if (typeof arg === 'string') return { type: 'string', value: arg };
      if (typeof arg === 'object') {
        return { type: 'object', value: arg };
      }
      return { type: 'text', value: String(arg) };
    });
  };

  const executeCode = useCallback(() => {
    setLogs([]);
    setError(null);

    const mockConsole = {
      log: (...args) => setLogs(p => [...p, { type: 'log', parts: processArgs(args), id: Math.random() }]),
      warn: (...args) => setLogs(p => [...p, { type: 'warn', parts: processArgs(args), id: Math.random() }]),
      error: (...args) => setLogs(p => [...p, { type: 'error', parts: processArgs(args), id: Math.random() }]),
      info: (...args) => setLogs(p => [...p, { type: 'info', parts: processArgs(args), id: Math.random() }]),
      clear: () => setLogs([])
    };

    try {
      const run = new Function('console', code);
      run(mockConsole);
    } catch (err) {
      setError(err.toString());
    }
  }, [code]);

  // --- Auto Run ---
  useEffect(() => {
    if (!isAutoRun) return;
    const timeoutId = setTimeout(executeCode, 800);
    return () => clearTimeout(timeoutId);
  }, [code, isAutoRun, executeCode]);

  // --- Handlers ---

  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      setCode(code.substring(0, start) + '  ' + code.substring(end));
      setTimeout(() => { if (e.target) e.target.selectionStart = e.target.selectionEnd = start + 2; }, 0);
    }
  };

  const handleReset = () => {
    if (confirm("Are you sure you want to reset the code to default?")) {
      setCode(DEFAULT_CODE);
      setLogs([]);
    }
  };

  const handleSaveSnapshot = () => {
    const newEntry = {
      id: Date.now(),
      timestamp: new Date().toLocaleString(),
      code: code,
      preview: code.substring(0, 100).replace(/\n/g, ' ') + (code.length > 100 ? '...' : '')
    };
    // Keep max 50 entries
    setHistory(prev => [newEntry, ...prev].slice(0, 50));
    setIsHistoryOpen(true); // Open panel to show confirmation basically
  };

  const handleLoadSnapshot = (snapshot) => {
    if (confirm(`Replace current code with snapshot from ${snapshot.timestamp}?`)) {
      setCode(snapshot.code);
      setIsHistoryOpen(false);
    }
  };

  const handleDeleteSnapshot = (id, e) => {
    e.stopPropagation();
    if(confirm("Delete this snapshot?")) {
      setHistory(prev => prev.filter(item => item.id !== id));
    }
  };

  // --- Import / Export Handlers ---

  const exportFile = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCurrentSession = () => {
    const data = {
      code,
      exportedAt: new Date().toISOString(),
      type: 'js-playground-session'
    };
    exportFile(data, `session-current-${new Date().toISOString().slice(0,10)}.json`);
  };

  const handleExportHistoryItem = (e, item) => {
    e.stopPropagation();
    const data = {
      code: item.code,
      exportedAt: new Date().toISOString(),
      sourceSnapshotTimestamp: item.timestamp,
      type: 'js-playground-session'
    };
    const safeName = item.timestamp.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    exportFile(data, `session-${safeName}.json`);
  };

  const triggerImport = () => {
    fileInputRef.current?.click();
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.type === 'js-playground-session') {
           const isFullBackup = Array.isArray(data.history) && data.history.length > 0;
           if (isFullBackup) {
             if(confirm("This file contains a full history backup. Do you want to overwrite your entire history and current code?")) {
               setCode(data.code || '');
               setHistory(data.history);
             }
           } else {
             if(confirm("Import this session? It will replace your current code workspace.")) {
               setCode(data.code || '');
             }
           }
        } else {
          if (confirm("File doesn't look like a playground session. Import as raw text code?")) {
              setCode(event.target.result);
          }
        }
      } catch (err) {
        alert('Failed to parse file. Ensure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-200 font-sans relative overflow-hidden">

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImport}
        className="hidden"
        accept=".json"
      />

      {/* --- History Sidebar (Slide Over) --- */}
      {isHistoryOpen && (
        <div className="absolute inset-0 z-50 flex">
           <div
             className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
             onClick={() => setIsHistoryOpen(false)}
           />
           <div className="relative w-80 bg-[#161b22] border-r border-gray-700 h-full flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
              <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-[#1e1e1e]">
                <h2 className="font-bold text-gray-100 flex items-center gap-2">
                  <HistoryIcon /> History
                </h2>
                <button onClick={() => setIsHistoryOpen(false)} className="text-gray-400 hover:text-white">
                  <XIcon />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {history.length === 0 ? (
                  <div className="text-gray-500 text-sm text-center mt-10 p-4">
                    No snapshots saved.<br/>Click the Save icon in the header to keep your work.
                  </div>
                ) : (
                  history.map(item => (
                    <div
                      key={item.id}
                      onClick={() => handleLoadSnapshot(item)}
                      className="group p-3 rounded-lg border border-gray-700/50 bg-[#0d1117] hover:border-blue-500/50 hover:bg-gray-800 transition-all cursor-pointer relative"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xs font-semibold text-blue-400">{item.timestamp}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleExportHistoryItem(e, item)}
                            className="p-1 text-gray-500 hover:text-blue-400 transition-colors"
                            title="Export this session to file"
                          >
                            <SmallDownloadIcon />
                          </button>
                          <button
                            onClick={(e) => handleDeleteSnapshot(item.id, e)}
                            className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                            title="Delete snapshot"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 font-mono truncate opacity-80">
                        {item.preview}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 border-t border-gray-800 text-xs text-center text-gray-600">
                Stored locally in browser
              </div>
           </div>
        </div>
      )}

      {/* --- Header --- */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#1e1e1e] border-b border-gray-800 shadow-xl z-10 h-16">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white text-lg shadow-blue-900/50 shadow-lg">JS</div>
          <h1 className="text-lg font-bold text-gray-100 tracking-tight hidden sm:block">Playground</h1>
        </div>

        <div className="flex items-center gap-3">

          {/* Group 1: Session Management */}
          <div className="flex items-center bg-gray-800/50 rounded-md p-1 border border-gray-700">
            <button
                onClick={triggerImport}
                className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-all"
                title="Import Session (JSON)"
            >
                <UploadIcon />
            </button>
            <button
                onClick={handleExportCurrentSession}
                className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-all"
                title="Export Current Session (JSON)"
            >
                <DownloadIcon />
            </button>
            <div className="w-px h-4 bg-gray-700 mx-1"></div>
            <button
                onClick={() => setIsHistoryOpen(true)}
                className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-all"
                title="View History"
            >
                <HistoryIcon />
            </button>
            <button
                onClick={handleSaveSnapshot}
                className="p-1.5 text-gray-400 hover:text-green-400 rounded hover:bg-gray-700 transition-all"
                title="Save Snapshot"
            >
                <SaveIcon />
            </button>
          </div>

          <div className="h-6 w-px bg-gray-700 mx-1 hidden sm:block"></div>

          {/* Group 2: Run Controls */}
          <button
            onClick={() => setIsAutoRun(!isAutoRun)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border transition-all
              ${isAutoRun ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
          >
            <BoltIcon active={isAutoRun} />
            <span className="hidden lg:inline">Auto Run</span>
          </button>

          <button onClick={() => setLogs([])} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-400 hover:text-red-400 transition-colors" title="Clear Console">
            <TrashIcon />
          </button>

          <button onClick={executeCode} className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-900/30 transition-all active:scale-95">
            <PlayIcon /> Run
          </button>
        </div>
      </header>

      {/* --- Workspace --- */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* Editor */}
        <div className="flex-1 flex flex-col border-r border-gray-800 min-h-[50%] md:min-h-auto relative group">
          <div className="px-4 py-2 bg-[#1e1e1e] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-800 flex justify-between select-none">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-2">
                <CodeIcon /> Editor
              </span>
              <button onClick={handleReset} className="text-[10px] text-gray-500 hover:text-red-400 normal-case transition-colors">
                (Reset)
              </button>
            </div>
          </div>
          <div className="flex-1 relative">
             <MonacoEditor
               value={code}
               onChange={setCode}
               fallback={
                 <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="absolute inset-0 w-full h-full p-6 bg-[#1e1e1e] text-gray-300 font-mono text-sm leading-6 resize-none focus:outline-none focus:ring-0 selection:bg-blue-500/30 placeholder-gray-700 custom-scrollbar"
                  spellCheck="false"
                  autoCapitalize="off"
                  autoComplete="off"
                  placeholder="// Type your JavaScript code here..."
                  style={{ fontFamily: "'Fira Code', 'Consolas', monospace" }}
                  lang="javascript"
                />
               }
             />
          </div>
        </div>

        {/* Console */}
        <div className="flex-1 flex flex-col bg-[#0d1117] min-h-[40%] md:min-h-auto">
          <div className="px-4 py-2 bg-[#1e1e1e] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-800 flex justify-between select-none">
            <span>Console</span>
            <span className="text-[10px] normal-case opacity-50">Interactive Output</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-2 custom-scrollbar">
            {logs.length === 0 && !error && (
              <div className="text-gray-700 italic flex flex-col items-center justify-center h-full opacity-50 select-none">
                <span>Output will appear here...</span>
              </div>
            )}

            {logs.map((log) => (
              <div key={log.id} className={`relative pl-2 border-l-2 py-1 break-words font-medium group/line
                ${log.type === 'error' ? 'border-red-500/50 bg-red-900/10 text-red-300' :
                  log.type === 'warn' ? 'border-yellow-500/50 bg-yellow-900/10 text-yellow-300' :
                  'border-gray-700 text-gray-300 hover:bg-gray-800/30'}`}>

                <span className={`inline-block mr-2 opacity-60 select-none font-bold align-top
                  ${log.type === 'error' ? 'text-red-500' :
                    log.type === 'warn' ? 'text-yellow-500' :
                    'text-blue-500'}`}>
                  {log.type === 'log' ? '›' : log.type === 'warn' ? '⚠' : log.type === 'error' ? '✖' : 'ℹ'}
                </span>

                <div className="inline-block align-top break-all">
                  {log.parts.map((part, i) => (
                    <span key={i} className="mr-2 last:mr-0 inline-block">
                      {part.type === 'number' ? <NumberToggle value={part.value} /> :
                       part.type === 'boolean' ? <BooleanToggle value={part.value} /> :
                       part.type === 'string' ? <SmartString value={part.value} /> :
                       part.type === 'object' ? <ObjectInspector value={part.value} /> :
                       part.type === 'null' ? <span className="text-gray-500 font-bold">null</span> :
                       part.type === 'undefined' ? <span className="text-gray-600 italic">undefined</span> :
                       <span>{part.value}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}

            {error && (
              <div className="mt-2 p-3 bg-red-950/30 border-l-4 border-red-500 text-red-400 break-words shadow-sm text-xs md:text-sm">
                <div className="font-bold uppercase mb-1">Runtime Error</div>
                {error}
              </div>
            )}

            <div ref={consoleEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
