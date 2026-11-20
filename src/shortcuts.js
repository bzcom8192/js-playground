// The REAL keyboard shortcuts of both pages (shown in the Shortcuts modal).
// Editor entries are Monaco built-ins; the rest are wired in the pages.

export const MOD = "Ctrl/⌘";

export const EDITOR_SHORTCUTS = [
  { keys: [MOD, "F"], desc: "Find" },
  { keys: [MOD, "H"], desc: "Replace" },
  { keys: ["Shift", "Alt", "F"], desc: "Format document" },
  { keys: [MOD, "/"], desc: "Toggle line comment" },
  { keys: [MOD, "Space"], desc: "Trigger IntelliSense" },
  { keys: ["Tab"], desc: "Accept suggestion (when the list is open), otherwise indent" },
  { keys: ["Alt", "↑ / ↓"], desc: "Move line up / down" },
  { keys: [MOD, "D"], desc: "Add selection to next match" },
  { keys: [MOD, "Z"], desc: "Undo (also undoes snapshot / example loads)" },
  { keys: ["F1"], desc: "Command palette" },
];

export const PLAYGROUND_SHORTCUTS = [
  { keys: [MOD, "Enter"], desc: "Run code" },
  { keys: [MOD, "S"], desc: "Save snapshot to History" },
  { keys: ["Esc"], desc: "Close History / dialogs" },
  { keys: ["?"], desc: "Show shortcuts (when not typing)" },
];

export const FARMER_SHORTCUTS = [
  { keys: [MOD, "Enter"], desc: "Run / Stop the focused file's window" },
  { keys: [MOD, "S"], desc: "Save all files + farm now" },
  { keys: ["Esc"], desc: "Close dialogs / menus" },
  { keys: ["?"], desc: "Show shortcuts (when not typing)" },
];
