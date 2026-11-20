import { useEffect } from "react";
import XIcon from "./icons/XIcon";

function Keys({ keys }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-gray-600 bg-gray-800 text-gray-200"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Keyboard-shortcut reference. sections: [{ title, items: [{ keys, desc }] }] */
export default function ShortcutsModal({ open, onClose, sections }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative w-full max-w-lg max-h-[80vh] flex flex-col bg-[#161b22] border border-gray-700 rounded-lg shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-gray-700 flex justify-between items-center bg-[#1e1e1e] rounded-t-lg">
          <h2 className="font-bold text-gray-100">⌨ Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" title="Close (Esc)">
            <XIcon />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {sections.map((s) => (
            <section key={s.title}>
              <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
                {s.title}
              </h3>
              <ul className="space-y-1.5">
                {s.items.map((it) => (
                  <li key={it.desc} className="flex items-center justify-between gap-4 text-sm text-gray-300">
                    <span>{it.desc}</span>
                    <Keys keys={it.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-[11px] text-gray-500">On macOS use ⌘ instead of Ctrl.</p>
        </div>
      </div>
    </div>
  );
}
