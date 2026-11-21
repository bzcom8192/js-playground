// Hat band colours for the drones (3D board and 2D fallback). Drone 0 keeps
// the original red band; Megafarm drone k (k ≥ 1) wears
// DRONE_BANDS[(k − 1) % length], so helpers can be told apart at a glance.
export const DRONE_BAND_0 = "#b5462b";
export const DRONE_BANDS = ["#2f6fd0", "#2f9e4f", "#8e4fd0", "#f0c419", "#1fa8a8", "#e0569a", "#f4f4f4", "#2b2b2b", "#ff7a1a", "#7ad0ff", "#9cd34a"];
export const droneBand = (i) => (i <= 0 ? DRONE_BAND_0 : DRONE_BANDS[(i - 1) % DRONE_BANDS.length]);
