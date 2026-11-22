// Identity colours of the field bots (3D board and 2D fallback): the stripe
// around the body. Bot 0 wears DRONE_BAND_0; Megafarm bot k (k ≥ 1) wears
// DRONE_BANDS[(k − 1) % length], so a crew can be told apart at a glance.
export const DRONE_BAND_0 = "#b5462b";
export const DRONE_BANDS = ["#2f6fd0", "#2f9e4f", "#8e4fd0", "#f0c419", "#1fa8a8", "#e0569a", "#f4f4f4", "#2b2b2b", "#ff7a1a", "#7ad0ff", "#9cd34a"];
export const droneBand = (i) => (i <= 0 ? DRONE_BAND_0 : DRONE_BANDS[(i - 1) % DRONE_BANDS.length]);

// Status light on the bot's mast: what the program is doing. "done" and
// "stopped" count as idle.
export const STATUS_LIGHT = { idle: "#f6efdf", running: "#35d08f", paused: "#ffb52e", error: "#ff3b5c" };
export const statusLight = (status) => STATUS_LIGHT[status] ?? STATUS_LIGHT.idle;
