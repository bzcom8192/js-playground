// Online window: the "ส่งคะแนน Dino" button next to the dino board (BRIEF21).
// Dino scores are sent automatically only on a new LOCAL best, but the board
// counts the program's run on the server's benchmark farm. The button sends the
// current program on demand. Pure (no React, no DOM), so it is testable.

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

/** Is the button on, and why not? The rules of the window's other write buttons. */
export function dinoButton({ demo = false, offline = false, busy = false, identity = null, badIdentity = false } = {}) {
  if (demo) return { enabled: false, hint: "Off on the demo farm" };
  if (offline) return { enabled: false, hint: "The server is offline" };
  if (!identity) return { enabled: false, hint: "Join above to submit" };
  if (badIdentity) return { enabled: false, hint: "The server does not know this identity" };
  if (busy) return { enabled: false, hint: "Wait for the current request" };
  return { enabled: true, hint: "Send your current program; the server runs it on the benchmark farm and keeps its own result" };
}

/**
 * The message for a stored dino result (the answer of POST /api/scores), with
 * the numbers the SERVER measured. entries: the dino board as shown, to tell
 * whether the player's earlier best still counts.
 */
export function dinoResultText(stored, { fileName, entries = [], meId = null } = {}) {
  let text = `✓ ${fileName}: ${fmt(stored.value)} Bone on the benchmark farm (${fmt(stored.ticks)} ticks · ${fmt(stored.ops)} ops).`;
  const best = entries.find((e) => e.playerId === meId)?.value ?? null;
  if (best === null) text += " Your first dino score on the board.";
  else if (stored.value > best) text += ` New best (it was ${fmt(best)}).`;
  else text += ` Your earlier ${fmt(best)} Bone still counts.`;
  return text;
}
