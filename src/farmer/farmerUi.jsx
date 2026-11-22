// The game's name, shared colours and inline-SVG glyphs.
export const GAME_NAME = "Semicolon Acres";

export const TEAL = "#1c7a72"; // primary actions
export const BERRY = "#b83a5e"; // stop / pause
export const MARIGOLD = "#f0b03f"; // accents, badges
export const INK = "#2e2438";

// ---------- glyphs (inline SVG, currentColor) ----------
const svg = (children) => (
  <svg viewBox="0 0 12 12" width={12} height={12} fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);
export const Glyph = {
  /** The game's mark: a semicolon whose tail is a leaf. */
  brand: (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
      <circle cx="12" cy="6.5" r="4" fill={MARIGOLD} />
      <path d="M8 13 C13 11.5 17.5 14 16.5 18 C15.5 21.5 11.5 23 7.5 22.5 C10.5 20.5 11 18.5 8 13 Z" fill="#5fc7a8" />
    </svg>
  ),
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

