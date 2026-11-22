// Tiny hash router (no react-router, keeps static deploys working).
//   "" / "#/"   → playground
//   "#/farmer"  → Semicolon Acres   ("#/farmer?demo=1" → demo farm, see farmer/demo.js)
import { useEffect, useState } from "react";

export const ROUTES = { playground: "#/", farmer: "#/farmer" };

export function routeFromHash(hash) {
  // "#/farmer?demo=1" → query is ignored here (the page reads it).
  const h = (hash || "").replace(/^#/, "").replace(/\?.*$/, "").replace(/\/+$/, "");
  return h === "/farmer" ? "farmer" : "playground";
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
