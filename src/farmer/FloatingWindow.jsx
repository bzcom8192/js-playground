// Floating, draggable, resizable window (desktop) that degrades to a plain
// stacked panel on small screens (floating = false).
import { useRef, useState } from "react";
import { clampRect, HEADER_H, MIN_H, MIN_W } from "./useFarmerFiles.js";
import { Glyph, OLIVE } from "./farmerUi.jsx";

export function SquareButton({ color = OLIVE, title, onClick, children, size = 24, className = "" }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`shrink-0 flex items-center justify-center rounded-[5px] text-white shadow-[0_1px_2px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.25)] hover:brightness-115 active:brightness-95 transition-[filter] ${className}`}
      style={{ background: color, width: size, height: size }}
    >
      {children}
    </button>
  );
}

/**
 * Props: title, rect {x,y,w,h,z,minimized}, floating, onFocus, onRect(rect),
 * onMinimize, onClose, left (header-left nodes), children, bodyClass, label
 */
export default function FloatingWindow({
  title,
  rect,
  floating,
  onFocus,
  onRect,
  onMinimize,
  onClose,
  left,
  children,
  bodyClass = "bg-[#1b1b1b]",
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
      className={`flex flex-col rounded-xl overflow-hidden border border-black/25 shadow-[0_18px_44px_-6px_rgba(18,38,58,.55),0_2px_6px_rgba(0,0,0,.25)] ${
        floating ? "" : "relative w-full"
      }`}
      style={style}
      onPointerDownCapture={() => onFocus?.()}
    >
      <header
        className={`shrink-0 flex items-center gap-1.5 px-1.5 bg-gradient-to-b from-[#a7adb0] to-[#939a9e] border-b border-black/20 ${
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
        {left}
        <span className="farmer-title ml-1 flex-1 min-w-0 truncate text-[15px] font-bold text-white select-none">{title}</span>
        {onMinimize && (
          <SquareButton title={minimized ? "Restore" : "Minimize"} onClick={onMinimize}>
            {minimized ? Glyph.restore : Glyph.minimize}
          </SquareButton>
        )}
        {onClose && (
          <SquareButton title={closeTitle} onClick={onClose}>
            {Glyph.close}
          </SquareButton>
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
              <svg viewBox="0 0 16 16" className="w-full h-full text-white/35" aria-hidden="true">
                <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          )}
        </div>
    </section>
  );
}
