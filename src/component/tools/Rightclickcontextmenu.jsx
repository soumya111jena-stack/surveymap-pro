/**
 * RightClickContextMenu.jsx — SurveyMap Pro v5.9.5
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Earth Pro-style right-click context menu + feature Properties panel.
 *
 * FEATURES:
 *  • Right-click on KML / KMZ / SHP / GeoJSON features → context menu
 *  • "Properties" option opens full details panel (like Google Earth Pro)
 *  • Properties panel shows: name, type, area (all units), perimeter, length,
 *    coordinates, attributes table, WGS-84 info
 *  • Also shows: "What's here?", "Zoom to feature", "Copy coordinates"
 *  • Works with Leaflet layers via contextmenu event
 *  • Hook: useRightClickMenu — attach to any Leaflet layer group
 *
 * USAGE in SurveyMap.jsx:
 *
 *   import { useRightClickMenu } from "./tools/RightClickContextMenu";
 *   import FeaturePropertiesPanel from "./tools/RightClickContextMenu";
 *
 *   // In SurveyMap component:
 *   const rightClick = useRightClickMenu();
 *
 *   // When attaching to a Leaflet layer (e.g. inside KMLLoader onLayer):
 *   rightClick.attachToLayer(lyr, { fileName: kmlName, fileType: "kml" });
 *
 *   // Render:
 *   <rightClick.ContextMenu />
 *   {rightClick.propertiesFeature && (
 *     <FeaturePropertiesPanel
 *       feature={rightClick.propertiesFeature}
 *       onClose={rightClick.closeProperties}
 *     />
 *   )}
 */

import { useState, useCallback, useRef, useEffect } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   Geodesy (same as KMLAreaAnalyzer for consistency)
───────────────────────────────────────────────────────────────────────────── */
function haversine(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.max(0, s)));
}

function ringArea(coords) {
  if (!coords || coords.length < 3) return 0;
  const R = 6371000, n = coords.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = coords[i][1] * Math.PI / 180;
    const lat2 = coords[j][1] * Math.PI / 180;
    const dLon = (coords[j][0] - coords[i][0]) * Math.PI / 180;
    area += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R * R / 2);
}

function polygonAreaM2(rings) {
  if (!rings || rings.length === 0) return 0;
  let a = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) a -= ringArea(rings[i]);
  return Math.max(0, a);
}

function ringPerim(coords) {
  if (!coords || coords.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  d += haversine(coords[coords.length - 1], coords[0]);
  return d;
}

function lineLength(coords) {
  if (!coords || coords.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Unit tables
───────────────────────────────────────────────────────────────────────────── */
const AREA_UNITS = [
  { key: "m2",  abbr: "m²",  label: "Square Metres",    factor: 1,            dp: 1 },
  { key: "km2", abbr: "km²", label: "Square Kilometres", factor: 1e-6,        dp: 6 },
  { key: "ha",  abbr: "ha",  label: "Hectares",          factor: 1e-4,        dp: 4 },
  { key: "ac",  abbr: "ac",  label: "Acres",             factor: 1 / 4046.856, dp: 4 },
  { key: "ft2", abbr: "ft²", label: "Square Feet",       factor: 10.7639,     dp: 0 },
  { key: "mi2", abbr: "mi²", label: "Square Miles",      factor: 3.861e-7,    dp: 8 },
];

const DIST_UNITS = [
  { key: "m",   abbr: "m",   label: "Metres",       factor: 1,           dp: 2 },
  { key: "km",  abbr: "km",  label: "Kilometres",   factor: 1e-3,        dp: 4 },
  { key: "mi",  abbr: "mi",  label: "Miles",        factor: 1 / 1609.344, dp: 5 },
  { key: "ft",  abbr: "ft",  label: "Feet",         factor: 3.28084,     dp: 2 },
  { key: "nmi", abbr: "nmi", label: "Nautical Mi",  factor: 1 / 1852,    dp: 5 },
];

/* ─────────────────────────────────────────────────────────────────────────────
   Formatters
───────────────────────────────────────────────────────────────────────────── */
function fmtArea(m2, key) {
  const u = AREA_UNITS.find(u => u.key === key) || AREA_UNITS[0];
  const v = m2 * u.factor;
  return v >= 1e6 ? v.toLocaleString(undefined, { maximumFractionDigits: u.dp }) : v.toFixed(u.dp);
}

function fmtDist(m, key) {
  const u = DIST_UNITS.find(u => u.key === key) || DIST_UNITS[0];
  const v = m * u.factor;
  return v >= 1e6 ? v.toLocaleString(undefined, { maximumFractionDigits: u.dp }) : v.toFixed(u.dp);
}

function smartArea(m2) {
  if (m2 >= 1e6) return `${(m2 * 1e-6).toFixed(4)} km²`;
  if (m2 >= 1e4) return `${(m2 * 1e-4).toFixed(3)} ha`;
  return `${m2.toFixed(1)} m²`;
}

function smartDist(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(3)} km`;
  if (m >= 1)    return `${m.toFixed(2)} m`;
  return `${(m * 100).toFixed(1)} cm`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Analyse a GeoJSON geometry → stats object
───────────────────────────────────────────────────────────────────────────── */
export function analyseGeometry(geom) {
  if (!geom) return { areaSqM: 0, perimM: 0, lengthM: 0, type: "Unknown", coords: [], centroid: null };
  const t = geom.type;
  let areaSqM = 0, perimM = 0, lengthM = 0, coords = [], centroid = null;

  if (t === "Point") {
    coords = [geom.coordinates];
    centroid = { lat: geom.coordinates[1], lng: geom.coordinates[0] };
  } else if (t === "MultiPoint") {
    coords = geom.coordinates;
    if (coords[0]) centroid = { lat: coords[0][1], lng: coords[0][0] };
  } else if (t === "LineString") {
    coords = geom.coordinates;
    lengthM = lineLength(coords);
    if (coords[0]) centroid = { lat: coords[0][1], lng: coords[0][0] };
  } else if (t === "MultiLineString") {
    coords = geom.coordinates.flat();
    lengthM = geom.coordinates.reduce((s, ls) => s + lineLength(ls), 0);
    if (coords[0]) centroid = { lat: coords[0][1], lng: coords[0][0] };
  } else if (t === "Polygon") {
    coords = geom.coordinates[0] || [];
    areaSqM = polygonAreaM2(geom.coordinates);
    perimM  = ringPerim(coords);
    // Centroid approximation
    const lats = coords.map(c => c[1]), lngs = coords.map(c => c[0]);
    centroid = {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
    };
  } else if (t === "MultiPolygon") {
    geom.coordinates.forEach(poly => {
      areaSqM += polygonAreaM2(poly);
      perimM  += ringPerim(poly[0] || []);
    });
    coords = geom.coordinates[0]?.[0] || [];
    if (coords[0]) centroid = { lat: coords[0][1], lng: coords[0][0] };
  } else if (t === "GeometryCollection") {
    (geom.geometries || []).forEach(g => {
      const r = analyseGeometry(g);
      areaSqM += r.areaSqM; perimM += r.perimM; lengthM += r.lengthM;
      if (!centroid) centroid = r.centroid;
    });
  }

  return { areaSqM, perimM, lengthM, type: t, coords, centroid };
}

/* ─────────────────────────────────────────────────────────────────────────────
   CopyBtn
───────────────────────────────────────────────────────────────────────────── */
function CopyBtn({ text, label }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).catch(() => {});
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
      title={`Copy ${label || ""}`}
      style={{
        padding: "2px 8px", borderRadius: 5, cursor: "pointer",
        fontSize: 9, fontWeight: 700,
        border: `1px solid ${ok ? "rgba(74,222,128,.5)" : "rgba(255,255,255,.1)"}`,
        background: ok ? "rgba(74,222,128,.12)" : "transparent",
        color: ok ? "#4ade80" : "#475569", flexShrink: 0,
        fontFamily: "'DM Mono',monospace",
      }}
    >{ok ? "✓ Copied" : "⎘ Copy"}</button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   StatRow — label + value + copy
───────────────────────────────────────────────────────────────────────────── */
function StatRow({ label, value, accent, mono, copyText }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "7px 12px",
      borderBottom: "1px solid rgba(255,255,255,.04)",
    }}>
      <span style={{ color: "#475569", fontSize: 11, minWidth: 120 }}>{label}</span>
      <span style={{
        color: accent || "#e2e8f0", fontSize: 11.5,
        fontFamily: mono ? "'DM Mono',monospace" : "inherit",
        fontWeight: 600, flex: 1, textAlign: "right", marginRight: 8,
      }}>{value}</span>
      {copyText && <CopyBtn text={copyText} label={label} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   FeaturePropertiesPanel — the main Google Earth Pro-style Properties dialog
───────────────────────────────────────────────────────────────────────────── */
export default function FeaturePropertiesPanel({ feature, onClose }) {
  const [areaUnit, setAreaUnit] = useState("ha");
  const [distUnit, setDistUnit] = useState("m");
  const [tab, setTab] = useState("details"); // details | area | attributes | location

  if (!feature) return null;

  const props   = feature.properties || {};
  const geom    = feature.geometry;
  const stats   = analyseGeometry(geom);
  const name    = props.name || props.Name || props.NAME ||
                  props.label || props.id || props.OBJECTID ||
                  feature._name || "Unnamed Feature";
  const fileType = feature._fileType || "";
  const fileName = feature._fileName || "";

  const isPolygon = stats.areaSqM > 0;
  const isLine    = !isPolygon && stats.lengthM > 0;
  const isPoint   = stats.type === "Point" || stats.type === "MultiPoint";

  const typeColor = isPolygon ? "#fbbf24" : isLine ? "#60a5fa" : "#34d399";
  const typeIcon  = isPolygon ? "⬡" : isLine ? "〰" : "📍";

  const aU = AREA_UNITS.find(u => u.key === areaUnit) || AREA_UNITS[0];
  const dU = DIST_UNITS.find(u => u.key === distUnit) || DIST_UNITS[0];

  const TABS = [
    { id: "details",    label: "📋 Details" },
    ...(isPolygon ? [{ id: "area", label: "📐 Area" }] : []),
    ...(isLine    ? [{ id: "area", label: "📏 Length" }] : []),
    ...(Object.keys(props).length > 0 ? [{ id: "attributes", label: "🏷 Attributes" }] : []),
    ...(stats.centroid ? [{ id: "location", label: "📍 Location" }] : []),
  ];

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9700,
        background: "rgba(0,0,0,.75)", backdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, fontFamily: "'DM Sans',system-ui,sans-serif",
      }}
    >
      <div style={{
        background: "#080f1c",
        borderRadius: 16,
        border: `1px solid ${typeColor}30`,
        boxShadow: "0 32px 80px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.04)",
        width: "100%", maxWidth: 520, maxHeight: "90vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {/* ── HEADER ── */}
        <div style={{
          background: "linear-gradient(180deg,#0f1e30 0%,#0a1726 100%)",
          padding: "14px 18px",
          borderBottom: "1px solid rgba(255,255,255,.07)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          {/* Type icon badge */}
          <div style={{
            width: 44, height: 44, borderRadius: 11, flexShrink: 0,
            background: `${typeColor}18`,
            border: `1px solid ${typeColor}40`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20,
          }}>{typeIcon}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: "#f1f5f9", fontWeight: 700, fontSize: 15,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{String(name).slice(0, 60)}</div>
            <div style={{
              color: "#334155", fontSize: 10, fontFamily: "'DM Mono',monospace",
              marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap",
            }}>
              <span style={{ color: typeColor }}>{stats.type}</span>
              {fileName && <span style={{ color: "#1e3a5f" }}>· {fileName.slice(0, 20)}</span>}
              {fileType && <span style={{ color: "#1e293b", background: "rgba(255,255,255,.04)", padding: "0 5px", borderRadius: 4 }}>{fileType.toUpperCase()}</span>}
            </div>
          </div>

          {/* Google Earth Pro-style close */}
          <button onClick={onClose} style={{
            background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)",
            color: "#f87171", width: 32, height: 32, borderRadius: 8,
            cursor: "pointer", fontSize: 18, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>×</button>
        </div>

        {/* ── QUICK STATS BANNER ── */}
        {(isPolygon || isLine) && (
          <div style={{
            background: `linear-gradient(90deg,${typeColor}12,transparent)`,
            borderBottom: `1px solid ${typeColor}20`,
            padding: "8px 18px",
            display: "flex", alignItems: "center", gap: 20,
          }}>
            {isPolygon && <>
              <div style={{ textAlign: "center" }}>
                <div style={{ color: `${typeColor}70`, fontSize: 8, fontWeight: 700, letterSpacing: ".07em", fontFamily: "'DM Mono',monospace" }}>AREA</div>
                <div style={{ color: typeColor, fontSize: 15, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>{smartArea(stats.areaSqM)}</div>
              </div>
              <div style={{ width: 1, height: 30, background: "rgba(255,255,255,.07)" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ color: "rgba(52,211,153,.6)", fontSize: 8, fontWeight: 700, letterSpacing: ".07em", fontFamily: "'DM Mono',monospace" }}>PERIMETER</div>
                <div style={{ color: "#34d399", fontSize: 15, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>{smartDist(stats.perimM)}</div>
              </div>
            </>}
            {isLine && (
              <div style={{ textAlign: "center" }}>
                <div style={{ color: `${typeColor}70`, fontSize: 8, fontWeight: 700, letterSpacing: ".07em", fontFamily: "'DM Mono',monospace" }}>LENGTH</div>
                <div style={{ color: typeColor, fontSize: 15, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>{smartDist(stats.lengthM)}</div>
              </div>
            )}
            <div style={{ flex: 1 }} />
            <CopyBtn
              text={isPolygon
                ? `Area: ${smartArea(stats.areaSqM)} | Perimeter: ${smartDist(stats.perimM)}`
                : `Length: ${smartDist(stats.lengthM)}`}
              label="summary"
            />
          </div>
        )}

        {/* ── TABS ── */}
        <div style={{
          display: "flex", background: "#0a1420",
          borderBottom: "1px solid rgba(255,255,255,.06)",
          padding: "0 4px", overflowX: "auto",
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "9px 14px", fontSize: 11, fontWeight: 700,
              border: "none", background: "transparent", cursor: "pointer",
              color: tab === t.id ? "#fbbf24" : "#475569",
              borderBottom: `2px solid ${tab === t.id ? "#fbbf24" : "transparent"}`,
              fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── BODY ── */}
        <div style={{ flex: 1, overflowY: "auto" }}>

          {/* ═══ DETAILS TAB ═══ */}
          {tab === "details" && (
            <div>
              <div style={{ padding: "10px 12px 4px", color: "#334155", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", fontFamily: "'DM Mono',monospace" }}>FEATURE INFO</div>
              <StatRow label="Name"        value={String(name).slice(0, 60)}   copyText={String(name)} />
              <StatRow label="Geometry"    value={stats.type}                  accent={typeColor} />
              <StatRow label="Source File" value={fileName || "—"}            mono />
              <StatRow label="File Type"   value={fileType?.toUpperCase() || "—"} />

              {isPolygon && <>
                <div style={{ padding: "10px 12px 4px", color: "#334155", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", fontFamily: "'DM Mono',monospace", marginTop: 4 }}>MEASUREMENTS</div>
                <StatRow label="Area"        value={`${fmtArea(stats.areaSqM, areaUnit)} ${aU.abbr}`} accent="#fbbf24" mono copyText={`${fmtArea(stats.areaSqM, areaUnit)} ${aU.abbr}`} />
                <StatRow label="Perimeter"   value={`${fmtDist(stats.perimM, distUnit)} ${dU.abbr}`}  accent="#34d399" mono copyText={`${fmtDist(stats.perimM, distUnit)} ${dU.abbr}`} />
                <StatRow label="Area (ha)"   value={`${fmtArea(stats.areaSqM, "ha")} ha`}             mono copyText={`${fmtArea(stats.areaSqM, "ha")} ha`} />
                <StatRow label="Area (ac)"   value={`${fmtArea(stats.areaSqM, "ac")} ac`}             mono copyText={`${fmtArea(stats.areaSqM, "ac")} ac`} />
              </>}

              {isLine && <>
                <div style={{ padding: "10px 12px 4px", color: "#334155", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", fontFamily: "'DM Mono',monospace", marginTop: 4 }}>MEASUREMENTS</div>
                <StatRow label="Length"      value={`${fmtDist(stats.lengthM, distUnit)} ${dU.abbr}`} accent="#60a5fa" mono copyText={`${fmtDist(stats.lengthM, distUnit)} ${dU.abbr}`} />
                <StatRow label="Length (km)" value={`${fmtDist(stats.lengthM, "km")} km`}             mono />
                <StatRow label="Length (mi)" value={`${fmtDist(stats.lengthM, "mi")} mi`}             mono />
              </>}

              {isPoint && stats.coords[0] && <>
                <div style={{ padding: "10px 12px 4px", color: "#334155", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", fontFamily: "'DM Mono',monospace", marginTop: 4 }}>COORDINATES</div>
                <StatRow label="Latitude"    value={`${stats.coords[0][1]?.toFixed(8)}°`} accent="#34d399" mono copyText={`${stats.coords[0][1]?.toFixed(8)}`} />
                <StatRow label="Longitude"   value={`${stats.coords[0][0]?.toFixed(8)}°`} accent="#34d399" mono copyText={`${stats.coords[0][0]?.toFixed(8)}`} />
                {stats.coords[0][2] != null && <StatRow label="Altitude" value={`${stats.coords[0][2]?.toFixed(2)} m`} mono />}
              </>}

              <div style={{ padding: "10px 12px 4px", color: "#334155", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", fontFamily: "'DM Mono',monospace", marginTop: 4 }}>COORDINATE SYSTEM</div>
              <StatRow label="Datum"       value="WGS-84 (EPSG:4326)" />
              <StatRow label="Projection"  value="Geographic (unprojected)" />
              <StatRow label="Coordinates" value="Longitude / Latitude" />
            </div>
          )}

          {/* ═══ AREA / LENGTH TAB ═══ */}
          {tab === "area" && (
            <div style={{ padding: "14px 16px" }}>
              {/* Unit picker */}
              {isPolygon && (
                <>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: ".08em", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>AREA — ALL UNITS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 14 }}>
                    {AREA_UNITS.map(u => {
                      const val = fmtArea(stats.areaSqM, u.key);
                      const on = u.key === areaUnit;
                      return (
                        <div
                          key={u.key}
                          onClick={() => setAreaUnit(u.key)}
                          style={{
                            padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                            background: on ? "rgba(251,191,36,.12)" : "rgba(255,255,255,.025)",
                            border: `1px solid ${on ? "rgba(251,191,36,.4)" : "rgba(255,255,255,.06)"}`,
                          }}
                        >
                          <div style={{ color: "#64748b", fontSize: 8, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{u.abbr}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 3 }}>
                            <span style={{ color: on ? "#fde68a" : "#cbd5e1", fontSize: 11, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{val}</span>
                            <CopyBtn text={`${val} ${u.abbr}`} />
                          </div>
                          <div style={{ color: "#1e3a5f", fontSize: 8, marginTop: 2 }}>{u.label}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: ".08em", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>PERIMETER — ALL UNITS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
                    {DIST_UNITS.map(u => {
                      const val = fmtDist(stats.perimM, u.key);
                      return (
                        <div key={u.key} style={{
                          padding: "8px 10px", borderRadius: 8,
                          background: "rgba(52,211,153,.06)",
                          border: "1px solid rgba(52,211,153,.15)",
                        }}>
                          <div style={{ color: "#64748b", fontSize: 8, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{u.abbr}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 3 }}>
                            <span style={{ color: "#6ee7b7", fontSize: 11, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{val}</span>
                            <CopyBtn text={`${val} ${u.abbr}`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {isLine && (
                <>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: ".08em", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>LENGTH — ALL UNITS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
                    {DIST_UNITS.map(u => {
                      const val = fmtDist(stats.lengthM, u.key);
                      const on = u.key === distUnit;
                      return (
                        <div
                          key={u.key}
                          onClick={() => setDistUnit(u.key)}
                          style={{
                            padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                            background: on ? "rgba(96,165,250,.12)" : "rgba(255,255,255,.025)",
                            border: `1px solid ${on ? "rgba(96,165,250,.4)" : "rgba(255,255,255,.06)"}`,
                          }}
                        >
                          <div style={{ color: "#64748b", fontSize: 8, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{u.abbr}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 3 }}>
                            <span style={{ color: on ? "#bfdbfe" : "#cbd5e1", fontSize: 11, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{val}</span>
                            <CopyBtn text={`${val} ${u.abbr}`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ ATTRIBUTES TAB ═══ */}
          {tab === "attributes" && (
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: ".08em", marginBottom: 10, fontFamily: "'DM Mono',monospace" }}>
                ATTRIBUTES ({Object.keys(props).length})
              </div>
              {Object.entries(props)
                .filter(([k]) => !["styleUrl", "styleHash", "Style"].includes(k))
                .map(([k, v]) => (
                  <div key={k} style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.04)",
                  }}>
                    <span style={{
                      color: "#475569", fontSize: 10, fontFamily: "'DM Mono',monospace",
                      width: 130, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", paddingTop: 1,
                    }}>{k}</span>
                    <span style={{
                      color: "#94a3b8", fontSize: 10.5, flex: 1,
                      wordBreak: "break-all",
                    }}>{String(v ?? "—")}</span>
                    <CopyBtn text={String(v ?? "")} label={k} />
                  </div>
                ))}
              {Object.keys(props).length === 0 && (
                <div style={{ color: "#334155", fontSize: 11, fontStyle: "italic", textAlign: "center", padding: "30px 0" }}>
                  No attributes found
                </div>
              )}
            </div>
          )}

          {/* ═══ LOCATION TAB ═══ */}
          {tab === "location" && stats.centroid && (
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: ".08em", marginBottom: 10, fontFamily: "'DM Mono',monospace" }}>CENTROID / POSITION</div>

              {[
                ["Latitude",  `${stats.centroid.lat.toFixed(8)}°`, `${stats.centroid.lat.toFixed(8)}`],
                ["Longitude", `${stats.centroid.lng.toFixed(8)}°`, `${stats.centroid.lng.toFixed(8)}`],
                ["Decimal",   `${stats.centroid.lat.toFixed(6)}, ${stats.centroid.lng.toFixed(6)}`, `${stats.centroid.lat.toFixed(6)}, ${stats.centroid.lng.toFixed(6)}`],
              ].map(([label, val, copy]) => (
                <div key={label} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 12px", borderRadius: 8, marginBottom: 6,
                  background: "rgba(74,158,255,.07)", border: "1px solid rgba(74,158,255,.18)",
                }}>
                  <div>
                    <div style={{ color: "#475569", fontSize: 9, fontWeight: 700 }}>{label}</div>
                    <div style={{ color: "#90c8ff", fontSize: 12, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{val}</div>
                  </div>
                  <CopyBtn text={copy} label={label} />
                </div>
              ))}

              {/* Google Maps link */}
              <button
                onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${stats.centroid.lat},${stats.centroid.lng}`, "_blank")}
                style={{
                  width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 9,
                  background: "rgba(52,211,153,.09)", border: "1px solid rgba(52,211,153,.25)",
                  color: "#34d399", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                }}
              >
                <span style={{ fontSize: 14 }}>🗺</span> Open in Google Maps ↗
              </button>

              {/* Coordinates of the ring */}
              {stats.coords.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: ".08em", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>
                    VERTICES ({stats.coords.length})
                  </div>
                  <div style={{ maxHeight: 160, overflowY: "auto", background: "rgba(255,255,255,.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,.06)" }}>
                    {stats.coords.slice(0, 50).map((c, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "4px 10px", borderBottom: "1px solid rgba(255,255,255,.03)",
                        fontSize: 9.5, fontFamily: "'DM Mono',monospace",
                      }}>
                        <span style={{ color: "#334155", width: 28 }}>{i + 1}</span>
                        <span style={{ color: "#64748b", flex: 1 }}>{c[1]?.toFixed(6)}°, {c[0]?.toFixed(6)}°</span>
                        <CopyBtn text={`${c[1]?.toFixed(6)}, ${c[0]?.toFixed(6)}`} />
                      </div>
                    ))}
                    {stats.coords.length > 50 && (
                      <div style={{ padding: "6px 10px", color: "#334155", fontSize: 9, fontStyle: "italic" }}>
                        + {stats.coords.length - 50} more vertices
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => navigator.clipboard?.writeText(
                      stats.coords.map(c => `${c[1]?.toFixed(8)}, ${c[0]?.toFixed(8)}`).join("\n")
                    ).catch(() => {})}
                    style={{
                      width: "100%", marginTop: 6, padding: "8px 0", borderRadius: 8,
                      background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
                      color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer",
                    }}
                  >⎘ Copy All Coordinates</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div style={{
          padding: "10px 18px",
          background: "#0a1420",
          borderTop: "1px solid rgba(255,255,255,.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}>
          <span style={{ color: "#1e3a5f", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>
            WGS-84 · {stats.type}
          </span>
          <div style={{ display: "flex", gap: 7 }}>
            {isPolygon && (
              <button
                onClick={() => navigator.clipboard?.writeText(
                  AREA_UNITS.map(u => `${fmtArea(stats.areaSqM, u.key)} ${u.abbr}`).join("\n")
                ).catch(() => {})}
                style={{
                  padding: "7px 14px", borderRadius: 8, cursor: "pointer",
                  background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.3)",
                  color: "#fbbf24", fontSize: 11, fontWeight: 700,
                }}
              >⎘ Copy All Areas</button>
            )}
            <button onClick={onClose} style={{
              padding: "7px 22px", borderRadius: 8, cursor: "pointer",
              background: "rgba(74,158,255,.15)", border: "1px solid rgba(74,158,255,.4)",
              color: "#80c4ff", fontSize: 12, fontWeight: 700,
            }}>Close</button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   RightClickContextMenu — the floating context menu (Google Earth Pro style)
───────────────────────────────────────────────────────────────────────────── */
export function RightClickContextMenu({ menu, onClose, onProperties, onZoomTo, onCopyCoords, onWhatHere }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (!menu.visible) return null;

  const items = [
    {
      icon: "📋", label: "Properties",
      sub: menu.feature ? `${menu.feature.geometry?.type || "Feature"}` : "",
      action: onProperties, accent: "#fbbf24",
    },
    { divider: true },
    { icon: "🔍", label: "Zoom to feature",     sub: "Fit map to bounds",         action: onZoomTo },
    { icon: "📍", label: "What's here?",         sub: "Show coordinates",          action: onWhatHere },
    { icon: "⎘",  label: "Copy coordinates",     sub: "Lat / Lng to clipboard",    action: onCopyCoords },
    { divider: true },
    { icon: "🗺",  label: "Open in Google Maps", sub: "Opens new tab",
      action: () => {
        if (menu.latlng) window.open(`https://www.google.com/maps/search/?api=1&query=${menu.latlng.lat},${menu.latlng.lng}`, "_blank");
        onClose();
      }
    },
  ];

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: Math.min(menu.x, window.innerWidth - 240),
        top: Math.min(menu.y, window.innerHeight - 300),
        zIndex: 9800,
        background: "#0d1b2e",
        border: "1px solid rgba(251,191,36,.25)",
        borderRadius: 10,
        boxShadow: "0 12px 48px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.04)",
        minWidth: 220,
        fontFamily: "'DM Sans',system-ui,sans-serif",
        overflow: "hidden",
        animation: "ctxFadeIn .1s ease",
      }}
    >
      <style>{`@keyframes ctxFadeIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}`}</style>

      {/* Header */}
      <div style={{
        padding: "9px 14px 8px",
        background: "rgba(251,191,36,.08)",
        borderBottom: "1px solid rgba(251,191,36,.15)",
      }}>
        <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700 }}>
          {menu.feature?.properties?.name ||
           menu.feature?.properties?.Name ||
           menu.feature?._name ||
           "Map Feature"}
        </div>
        <div style={{ color: "#334155", fontSize: 9.5, fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
          {menu.feature?.geometry?.type || "GeoJSON Feature"}
          {menu.latlng && ` · ${menu.latlng.lat.toFixed(5)}°, ${menu.latlng.lng.toFixed(5)}°`}
        </div>
      </div>

      {/* Items */}
      {items.map((item, i) =>
        item.divider
          ? <div key={i} style={{ height: 1, background: "rgba(255,255,255,.06)", margin: "3px 0" }} />
          : (
            <div
              key={i}
              onClick={() => { item.action?.(); if (!item.keepOpen) onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "9px 14px",
                cursor: "pointer",
                userSelect: "none",
                transition: "background .1s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.07)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: item.accent || "#e2e8f0", fontSize: 12, fontWeight: item.accent ? 700 : 500 }}>{item.label}</div>
                {item.sub && <div style={{ color: "#334155", fontSize: 9.5, fontFamily: "'DM Mono',monospace", marginTop: 1 }}>{item.sub}</div>}
              </div>
              {item.label === "Properties" && <span style={{ color: "#fbbf24", fontSize: 10 }}>↗</span>}
            </div>
          )
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   useRightClickMenu — hook to manage context menu state + attach to layers
───────────────────────────────────────────────────────────────────────────── */
export function useRightClickMenu(leafletMapRef) {
  const [menu, setMenu] = useState({ visible: false, x: 0, y: 0, feature: null, latlng: null });
  const [propertiesFeature, setPropertiesFeature] = useState(null);

  const openMenu = useCallback((x, y, feature, latlng) => {
    setMenu({ visible: true, x, y, feature, latlng });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu(p => ({ ...p, visible: false }));
  }, []);

  const openProperties = useCallback(() => {
    setPropertiesFeature(menu.feature);
    closeMenu();
  }, [menu.feature, closeMenu]);

  const closeProperties = useCallback(() => {
    setPropertiesFeature(null);
  }, []);

  /**
   * Attach right-click listener to a Leaflet layer group.
   * meta: { fileName, fileType } — stored on each feature
   */
  const attachToLayer = useCallback((leafletLayer, meta = {}) => {
    if (!leafletLayer) return;
    const attachSingle = (layer) => {
      layer.on("contextmenu", (e) => {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();

        // Build a GeoJSON feature from the Leaflet layer
        let geojsonFeature = null;
        try {
          geojsonFeature = layer.toGeoJSON ? layer.toGeoJSON() : null;
        } catch (_) {}

        if (geojsonFeature) {
          geojsonFeature._name = geojsonFeature.properties?.name ||
                                  geojsonFeature.properties?.Name ||
                                  meta.fileName || "Feature";
          geojsonFeature._fileName = meta.fileName || "";
          geojsonFeature._fileType = meta.fileType || "";
        }

        openMenu(
          e.originalEvent.clientX,
          e.originalEvent.clientY,
          geojsonFeature,
          e.latlng
        );
      });
    };

    if (leafletLayer.eachLayer) {
      leafletLayer.eachLayer(attachSingle);
    } else {
      attachSingle(leafletLayer);
    }
  }, [openMenu]);

  const handleZoomTo = useCallback(() => {
    if (!menu.feature || !leafletMapRef?.current) return;
    try {
      const L = window.L;
      if (!L) return;
      const bounds = L.geoJSON(menu.feature).getBounds();
      if (bounds.isValid()) leafletMapRef.current.fitBounds(bounds, { padding: [30, 30] });
    } catch (_) {}
    closeMenu();
  }, [menu.feature, leafletMapRef, closeMenu]);

  const handleCopyCoords = useCallback(() => {
    if (menu.latlng) {
      navigator.clipboard?.writeText(`${menu.latlng.lat.toFixed(8)}, ${menu.latlng.lng.toFixed(8)}`).catch(() => {});
    }
    closeMenu();
  }, [menu.latlng, closeMenu]);

  const handleWhatHere = useCallback(() => {
    if (menu.latlng) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${menu.latlng.lat},${menu.latlng.lng}`, "_blank");
    }
    closeMenu();
  }, [menu.latlng, closeMenu]);

  const ContextMenu = useCallback(() => (
    <RightClickContextMenu
      menu={menu}
      onClose={closeMenu}
      onProperties={openProperties}
      onZoomTo={handleZoomTo}
      onCopyCoords={handleCopyCoords}
      onWhatHere={handleWhatHere}
    />
  ), [menu, closeMenu, openProperties, handleZoomTo, handleCopyCoords, handleWhatHere]);

  return {
    menu,
    propertiesFeature,
    openMenu,
    closeMenu,
    openProperties,
    closeProperties,
    attachToLayer,
    ContextMenu,
  };
}