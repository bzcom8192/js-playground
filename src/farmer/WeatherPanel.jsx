// Info window → Weather tab: the current weather, the (approximate) forecast
// and what each weather does. Sampled once a second (no per-tick re-render).
import { WEATHER_REFRESH_MS, sameFields, weatherFields } from "./statusStrip.js";
import useSampled from "./useSampled.js";
import { WATER_DECAY_PER_SEC } from "./constants.js";
import {
  DROUGHT_DRY_GROWTH,
  DROUGHT_EVAPORATION,
  DROUGHT_WET_WATER,
  FORECAST_OPS,
  RAIN_WATER_PER_SEC,
  SEGMENT_TICKS,
  STORM_GROWTH,
  STORM_MAX_TILES,
  STORM_STRIKES,
  WEATHER_ICONS,
  WEATHER_STATES,
  WEATHER_TICKS_PER_SEC,
} from "./weather.js";

const sameOrNull = (a, b) => (a === null || b === null ? a === b : sameFields(a, b));

const WEATHER_EFFECT_TEXT = {
  Sunny: "Normal growth and evaporation.",
  Rain: `Soil tiles slowly gain water (+${RAIN_WATER_PER_SEC}/s, net +${(RAIN_WATER_PER_SEC - WATER_DECAY_PER_SEC).toFixed(2)}/s after evaporation).`,
  Storm: `Growth ×${STORM_GROWTH}, but lightning strikes ${STORM_STRIKES}× per storm, destroying 1–${STORM_MAX_TILES} crops each time (the ground stays).`,
  Drought: `Water evaporates ${DROUGHT_EVAPORATION}× faster; growth ×${DROUGHT_DRY_GROWTH} on tiles with water < ${DROUGHT_WET_WATER}.`,
};

export default function WeatherPanel({ game }) {
  const f = useSampled(weatherFields(game), WEATHER_REFRESH_MS, sameOrNull);
  const minutes = (SEGMENT_TICKS / WEATHER_TICKS_PER_SEC / 60).toFixed(0);
  return (
    <div className="p-3 space-y-3 text-xs leading-relaxed">
      {f ? (
        <>
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>
              {WEATHER_ICONS[f.now]}
            </span>
            <div>
              <div className="text-sm font-semibold text-gray-100">{f.now}</div>
              <div className="text-gray-400">{WEATHER_EFFECT_TEXT[f.now]}</div>
            </div>
          </div>
          <div className="rounded border border-gray-800 bg-[#1d1d1d] px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1">Forecast (approximate)</div>
            <div className="text-gray-200">
              Next: {WEATHER_ICONS[f.next]} {f.next}
              {f.next === f.now ? " (no change)" : ""} in ~{f.inTicks.toLocaleString("en-US")} ticks (≈ {f.approxSeconds} s)
            </div>
            <div className="text-gray-500 mt-1">
              The same blurred estimate <code>get_forecast()</code> returns: the next weather is exact, the time is ±20% and never exact.
            </div>
          </div>
        </>
      ) : (
        <div className="text-gray-400">No weather on this farm.</div>
      )}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">How weather works</h3>
        <dl className="space-y-1">
          {WEATHER_STATES.map((w) => (
            <div key={w} className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-2">
              <dt className="text-gray-200">
                {WEATHER_ICONS[w]} {w}
              </dt>
              <dd className="text-gray-400">{WEATHER_EFFECT_TEXT[w]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-gray-500 mt-2">
          The weather changes every {SEGMENT_TICKS.toLocaleString("en-US")} world ticks ({WEATHER_TICKS_PER_SEC} per second of farm time, ≈ {minutes} min) and
          only moves while the farm does (not while paused). It comes from your save's own seed. From code: <code>get_weather()</code> (1 op) and{" "}
          <code>get_forecast()</code> ({FORECAST_OPS} ops).
        </p>
      </section>
    </div>
  );
}
