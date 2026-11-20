// Inventory count format (like the reference): 616, 9k, 10.1k, 3.26k, 1.5M.
// Up to 2 decimals, trailing zeros trimmed, truncated (never overstates).
export function formatCount(n) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n < 1000) return String(n);
  const [div, unit] = n < 1e6 ? [1e3, "k"] : n < 1e9 ? [1e6, "M"] : [1e9, "B"];
  const v = Math.floor((n / div) * 100) / 100;
  return `${v.toFixed(2).replace(/\.?0+$/, "")}${unit}`;
}
