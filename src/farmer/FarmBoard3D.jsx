// The 3D farm board: plain three.js inside a React component (no r3f).
// The scene graph lives in board3d/FarmScene.js; this component owns the
// WebGL renderer, the canvas, the resize observer and the frame loop, and
// disposes all of it on unmount.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { FarmScene } from "./board3d/FarmScene.js";

export default function FarmBoard3D({ game, moveMs, paused, onFail }) {
  const wrapRef = useRef(null);
  const live = useRef({ game, moveMs, paused, onFail });

  // Latest props for the frame loop (the game object is mutated in place by
  // the engine, so the loop always sees live state between React renders).
  useEffect(() => {
    live.current = { game, moveMs, paused, onFail };
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (err) {
      live.current.onFail?.(err);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0); // the page's blue-grey shows through
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.setAttribute("aria-label", "Farm (3D view)");
    wrap.appendChild(canvas);

    const farm = new FarmScene();
    let needsRender = true;

    const resize = () => {
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      renderer.setSize(w, h, false);
      farm.fit(w, h);
      needsRender = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const onLost = (ev) => {
      ev.preventDefault();
      live.current.onFail?.(new Error("WebGL context lost"));
    };
    canvas.addEventListener("webglcontextlost", onLost);

    let raf = 0;
    let last = performance.now();
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = (now - last) / 1000;
      last = now;
      const { game: g, paused: p, moveMs: m } = live.current;
      const sizeBefore = farm.n;
      if (farm.sync(g)) needsRender = true;
      if (farm.n !== sizeBefore) resize();
      if (farm.update(dt, { paused: p, moveMs: m })) needsRender = true;
      if (needsRender) {
        renderer.render(farm.scene, farm.camera);
        needsRender = false;
      }
    };
    resize();
    raf = requestAnimationFrame(frame);

    // Dev/QA hook: lets automated screenshots check what is on the board.
    wrap.__farm3d = farm;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      delete wrap.__farm3d;
      farm.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, []);

  return <div ref={wrapRef} className="w-full h-full min-h-0" />;
}
