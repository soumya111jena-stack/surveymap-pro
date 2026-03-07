/**
 * measureUtils.js — SurveyMap Pro
 * Pure utility functions for measurement. NO JSX here — plain JS only.
 * Used by MeasureTool.jsx and any other component that needs distance math.
 */

// ─── Haversine distance (metres) between two [lat, lng] points ───────────────
export function haversine(a, b) {
  const R = 6371000;
  const r = x => x * Math.PI / 180;
  const dLat = r(b[0] - a[0]);
  const dLon = r(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// ─── Format metres into a human-readable string ──────────────────────────────
// unit: "auto" | "m" | "km" | "mi" | "ft" | "yd" | "nmi" | "chain" | "furlong"
export function formatDist(metres, unit = "auto") {
  if (!isFinite(metres) || metres < 0) return "—";
  switch (unit) {
    case "auto":
      return metres >= 1000
        ? (metres / 1000).toFixed(2) + " km"
        : metres.toFixed(1) + " m";
    case "m":      return metres.toFixed(2) + " m";
    case "km":     return (metres / 1000).toFixed(4) + " km";
    case "mi":     return (metres / 1609.344).toFixed(4) + " mi";
    case "ft":     return (metres / 0.3048).toFixed(2) + " ft";
    case "yd":     return (metres / 0.9144).toFixed(2) + " yd";
    case "nmi":    return (metres / 1852).toFixed(4) + " nmi";
    case "chain":  return (metres / 20.1168).toFixed(3) + " ch";
    case "furlong":return (metres / 201.168).toFixed(3) + " fur";
    default:       return metres.toFixed(2) + " m";
  }
}

// ─── Convert metres to a specific unit value (number only, no label) ─────────
export function convertDist(metres, unit) {
  switch (unit) {
    case "m":       return metres;
    case "km":      return metres / 1000;
    case "mi":      return metres / 1609.344;
    case "ft":      return metres / 0.3048;
    case "yd":      return metres / 0.9144;
    case "nmi":     return metres / 1852;
    case "chain":   return metres / 20.1168;
    case "furlong": return metres / 201.168;
    default:        return metres;
  }
}

// ─── Convert a value in a given unit back to metres ──────────────────────────
export function toMetres(value, unit) {
  switch (unit) {
    case "m":       return value;
    case "km":      return value * 1000;
    case "mi":      return value * 1609.344;
    case "ft":      return value * 0.3048;
    case "yd":      return value * 0.9144;
    case "nmi":     return value * 1852;
    case "chain":   return value * 20.1168;
    case "furlong": return value * 201.168;
    default:        return value;
  }
}

// ─── Total distance of an array of [lat, lng] points ────────────────────────
export function calcTotal(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return total;
}

// ─── Midpoint between two [lat, lng] points ──────────────────────────────────
export function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// ─── Bearing (degrees, 0=N, clockwise) between two points ───────────────────
export function bearing(a, b) {
  const r = x => x * Math.PI / 180;
  const dLon = r(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(r(b[0]));
  const x =
    Math.cos(r(a[0])) * Math.sin(r(b[0])) -
    Math.sin(r(a[0])) * Math.cos(r(b[0])) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ─── All unit definitions (used by MeasureTool panel) ───────────────────────
export const UNIT_DEFS = [
  { key: "m",        label: "Meters",         abbr: "m",   icon: "📏", factor: 1,            dp: 2 },
  { key: "km",       label: "Kilometers",     abbr: "km",  icon: "🗺️", factor: 1 / 1000,      dp: 4 },
  { key: "mi",       label: "Miles",          abbr: "mi",  icon: "🛣️", factor: 1 / 1609.344,  dp: 4 },
  { key: "ft",       label: "Feet",           abbr: "ft",  icon: "📐", factor: 1 / 0.3048,    dp: 2 },
  { key: "yd",       label: "Yards",          abbr: "yd",  icon: "⛳", factor: 1 / 0.9144,    dp: 2 },
  { key: "nmi",      label: "Nautical Miles", abbr: "nmi", icon: "⚓", factor: 1 / 1852,      dp: 4 },
  { key: "chain",    label: "Chains",         abbr: "ch",  icon: "🔗", factor: 1 / 20.1168,   dp: 3 },
  { key: "furlong",  label: "Furlongs",       abbr: "fur", icon: "🏇", factor: 1 / 201.168,   dp: 3 },
];