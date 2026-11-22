// Floating, draggable, resizable window (desktop) that degrades to a plain
// stacked panel on small screens (floating = false).
import { useRef, useState } from "react";
import { clampRect, HEADER_H, MIN_H, MIN_W } from "./useFarmerFiles.js";
import { Glyph, MARIGOLD, TEAL } from "./farmerUi.jsx";

/** Labelled pill: the main action(s) of a window. */
export function PillButton({ color = TEAL, title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="shrink-0 flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold text-white hover:brightness-110 active:brightness-95 transition-[filter]"
      style={{ background: color }}
    >
      {children}
    </button>
  );
}

/** Quiet round icon button (minimize, close). */
export function GhostButton({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[#75627a] hover:text-[#2e2438] hover:bg-[#ecdcc8] transition-colors"
    >
      {children}
    </button>
  );
}

/**
 * Props: title, rect {x,y,w,h,z,minimized}, floating, onFocus, onRect(rect),
 * onMinimize, onClose, actions (header buttons), accent (spine colour), children,
 * bodyClass, label
 */
export default function FloatingWindow({
  title,
  rect,
  floating,
  onFocus,
  onRect,
  onMinimize,
  onClose,
  actions,
  accent = MARIGOLD,
  children,
  bodyClass = "bg-[#1e1e1e]",
  mobileBodyClass = "h-80",
  label,
  closeTitle = "Close",
}) {
  const [live, setLive] = useState(null); // rect while dragging/resizing
  const dragRef = useRef(null);
  const r = live || rect;
  const minimized = rect.minimized;

  const begin = (mode) => (e) => {
    if (!floating || e.button !== 0) return;
    if (mode === "move" && e.target.closest("button,input,select")) return;
    e.preventDefault();
    onFocus?.();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, start: { ...rect } };
    document.body.classList.add("farmer-dragging");
    setLive({ ...rect });
  };
  const moveTo = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const next =
      d.mode === "move"
        ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy }
        : {
            ...d.start,
            w: Math.max(MIN_W, Math.min(d.start.w + dx, window.innerWidth - d.start.x)),
            h: Math.max(MIN_H, Math.min(d.start.h + dy, window.innerHeight - d.start.y)),
          };
    setLive(clampRect(next));
  };
  const end = (e) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    document.body.classList.remove("farmer-dragging");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      void err;
    }
    if (live) onRect?.({ x: live.x, y: live.y, w: live.w, h: live.h });
    setLive(null);
  };

  const style = floating
    ? { position: "absolute", left: r.x, top: r.y, width: r.w, height: minimized ? HEADER_H : r.h, zIndex: 20 + (r.z || 0) }
    : undefined;

  return (
    <section
      aria-label={label || title}
      className={`flex flex-col rounded-md overflow-hidden border border-[#2e2438] border-l-[6px] shadow-[0_14px_34px_-10px_rgba(70,36,60,.5)] ${
        floating ? "" : "relative w-full"
      }`}
      style={{ ...style, borderLeftColor: accent }}
      onPointerDownCapture={() => onFocus?.()}
    >
      <header
        className={`shrink-0 flex items-center gap-1.5 pl-3 pr-1.5 bg-[#fdf6ea] border-b border-[#e3d3c0] ${
          floating ? "cursor-grab active:cursor-grabbing touch-none" : ""
        }`}
        style={{ height: HEADER_H }}
        onPointerDown={begin("move")}
        onPointerMove={moveTo}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => {
          if (!e.target.closest("button,input,select")) onMinimize?.();
        }}
      >
        <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-[#2e2438] select-none">{title}</span>
        {actions}
        {onMinimize && (
          <GhostButton title={minimized ? "Restore" : "Minimize"} onClick={onMinimize}>
            {minimized ? Glyph.restore : Glyph.minimize}
          </GhostButton>
        )}
        {onClose && (
          <GhostButton title={closeTitle} onClick={onClose}>
            {Glyph.close}
          </GhostButton>
        )}
      </header>
      {/* Kept mounted while minimized so editors keep their undo history. */}
      <div className={`relative ${bodyClass} ${floating ? "flex-1 min-h-0" : mobileBodyClass} ${minimized ? "hidden" : ""}`}>
          {children}
          {floating && (
            <div
              className="absolute right-0 bottom-0 w-4 h-4 z-30 cursor-nwse-resize touch-none"
              title="Resize"
              onPointerDown={begin("resize")}
              onPointerMove={moveTo}
              onPointerUp={end}
              onPointerCancel={end}
            >
              <svg viewBox="0 0 16 16" className="w-full h-full text-[#978295]" aria-hidden="true">
                <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          )}
        </div>
    </section>
  );
}
