// Picks the farm renderer: the three.js board (default) or the old 2D DOM
// board, with a small 3D/2D toggle in the board's bottom-right corner.
// The choice is remembered in `farmer_board_v1` (UI only, not the save).
import { lazy, Suspense, useState } from "react";
import FarmBoard from "./FarmBoard.jsx";
import { hasWebGL } from "./board3d/webgl.js";

const FarmBoard3D = lazy(() => import("./FarmBoard3D.jsx"));

const MODE_KEY = "farmer_board_v1";

function loadMode() {
  try {
    return localStorage.getItem(MODE_KEY) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

export default function FarmBoardView({ game, moveMs, paused }) {
  const [mode, setModeState] = useState(loadMode);
  const [glOk, setGlOk] = useState(() => typeof document !== "undefined" && hasWebGL());

  const setMode = (m) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage full / disabled: the toggle still works for this session */
    }
  };

  const show3d = mode === "3d" && glOk;

  return (
    <div className="relative w-full h-full">
      {show3d ? (
        <Suspense fallback={null}>
          <FarmBoard3D game={game} moveMs={moveMs} paused={paused} onFail={() => setGlOk(false)} />
        </Suspense>
      ) : (
        <FarmBoard game={game} moveMs={moveMs} paused={paused} />
      )}
      <div
        className="absolute right-2 bottom-1 z-[55] flex rounded-md overflow-hidden text-[11px] font-bold shadow bg-black/30 backdrop-blur-sm"
        role="group"
        aria-label="Board view"
      >
        {["3d", "2d"].map((m) => {
          const active = (m === "3d") === show3d;
          const disabled = m === "3d" && !glOk;
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => setMode(m)}
              aria-pressed={active}
              title={disabled ? "3D needs WebGL, which is not available here" : m === "3d" ? "3D board" : "Classic 2D board"}
              className={`px-2 py-0.5 ${active ? "bg-[#6f9419] text-white" : "text-white/70 hover:text-white"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {m.toUpperCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
