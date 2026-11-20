// Shared colours + white inline-SVG glyphs for the Farmer window chrome.
export const OLIVE = "#6f9419";
export const ORANGE = "#e8641e";

// ---------- glyphs (inline SVG, white) ----------
const svg = (children) => (
  <svg viewBox="0 0 12 12" width={12} height={12} fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);
export const Glyph = {
  play: svg(
    <>
      <path d="M3 1.5 L10.5 6 L3 10.5 Z" />
    </>,
  ),
  stop: svg(
    <>
      <rect x="2" y="2" width="8" height="8" rx="1" />
    </>,
  ),
  pause: svg(
    <>
      <rect x="2.2" y="1.8" width="2.8" height="8.4" rx=".6" />
      <rect x="7" y="1.8" width="2.8" height="8.4" rx=".6" />
    </>,
  ),
  minimize: svg(
    <>
      <rect x="1.5" y="5" width="9" height="2.2" rx=".8" />
    </>,
  ),
  restore: svg(
    <>
      <rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </>,
  ),
  close: svg(
    <>
      <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </>,
  ),
};

