import { useEffect, useRef, useState } from "react";
import { sameFields } from "./statusStrip.js";

/**
 * Returns `value` as it was at the last sample: the latest value is picked up
 * at most once every `ms` milliseconds. The first render shows the current
 * value right away; equal samples don't re-render.
 */
export default function useSampled(value, ms, equal = sameFields) {
  const latest = useRef(value);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    latest.current = value;
  });
  // The next sample is scheduled `ms` after the previous one was committed
  // (this effect re-runs after each shown change), so visible updates are
  // never closer together than `ms`, even when timers or renders run late.
  useEffect(() => {
    let id;
    const sample = () => {
      if (equal(shown, latest.current)) id = setTimeout(sample, ms);
      else setShown(latest.current);
    };
    id = setTimeout(sample, ms);
    return () => clearTimeout(id);
  }, [shown, ms, equal]);
  return shown;
}
