// The farm renderer: the three.js board. The classic 2D DOM board remains
// only as an automatic fallback when WebGL is unavailable or fails —
// there is no manual 3D/2D toggle (the original game has none).
import { lazy, Suspense, useState } from "react";
import FarmBoard from "./FarmBoard.jsx";
import { hasWebGL } from "./board3d/webgl.js";

const FarmBoard3D = lazy(() => import("./FarmBoard3D.jsx"));

export default function FarmBoardView({ game, moveMs, paused }) {
  const [glOk, setGlOk] = useState(() => typeof document !== "undefined" && hasWebGL());

  return (
    <div className="relative w-full h-full">
      {glOk ? (
        <Suspense fallback={null}>
          <FarmBoard3D game={game} moveMs={moveMs} paused={paused} onFail={() => setGlOk(false)} />
        </Suspense>
      ) : (
        <FarmBoard game={game} moveMs={moveMs} paused={paused} />
      )}
    </div>
  );
}
