// Tiny hash router (no react-router, keeps static deploys working).
//   "" / "#/"   → playground
//   "#/farmer"  → JS Farmer
import { useEffect, useState } from "react";

export const ROUTES = { playground: "#/", farmer: "#/farmer" };

export function routeFromHash(hash) {
  const h = (hash || "").replace(/^#/, "").replace(/\/+$/, "");
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
