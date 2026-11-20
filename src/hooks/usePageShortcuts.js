import { useEffect, useRef } from "react";

const isTyping = (target) => {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest(".monaco-editor")) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};

/**
 * Page-level keyboard shortcuts (window keydown, bubble phase).
 * Inside Monaco, Ctrl/Cmd+Enter and Ctrl/Cmd+S are handled by editor actions,
 * which call preventDefault/stopPropagation — so nothing fires twice here.
 * This covers focus anywhere else on the page, including the fallback textarea.
 */
export default function usePageShortcuts({ onRun, onSave, onHelp, onEscape }) {
  const ref = useRef({ onRun, onSave, onHelp, onEscape });
  useEffect(() => {
    ref.current = { onRun, onSave, onHelp, onEscape };
  });

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      const h = ref.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "Enter" && h.onRun) {
        e.preventDefault();
        h.onRun();
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s" && h.onSave) {
        e.preventDefault(); // suppress the browser's "Save page" dialog
        h.onSave();
      } else if (e.key === "Escape" && h.onEscape) {
        h.onEscape();
      } else if (e.key === "?" && !mod && !e.altKey && h.onHelp && !isTyping(e.target)) {
        e.preventDefault();
        h.onHelp();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
