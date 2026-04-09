/**
 * FeaturePropertiesPanel.jsx — SurveyMap Pro v5.9.8
 *
 * Exact Google Earth Pro "Edit Path / Edit Polygon / Edit Placemark" dialog.
 * Branding: "SurveyMap Pro" — no "Google Earth" name anywhere.
 *
 * TABS: Description | Style, Color | View | Altitude | Measurements
 *
 * FIXES vs original:
 *   1. ringPerim() — no longer double-adds the closing leg when the GeoJSON
 *      ring already repeats coords[0] at the end.
 *   2. Measurements tab — all units shown simultaneously; active unit
 *      highlighted in amber; every row has its own copy button.
 *   3. dp (decimal places) carried through every unit consistently.
 *   4. LineString closed-loop detection — if first & last point are the same
 *      (or within ~1 m), area is computed exactly like Google Earth Pro does
 *      for paths that form a closed shape (hectares, m², km², ac, ft², mi²).
 *   5. "Close path" checkbox — on the Style, Color tab AND the Measurements tab.
 *      Toggling it virtually closes an open LineString (adds the closing leg to
 *      total length and computes enclosed area in all 6 area units), matching
 *      Google Earth Pro's "Close path" checkbox on the Edit Path dialog.
 *      The checkbox state is persisted via onSave({ ..., closePath: true }).
 *
 * Opens via:
 *   1. Double-click on any KML / KMZ / SHP / GeoJSON feature on the map
 *   2. Right-click → "Properties" from FeatureContextMenu
 *   3. Clicking a saved drawing in My Places sidebar
 */

import { useState, useEffect } from "react";

/* ─── Geodesy ──────────────────────────────────────────────────────────────── */
function haversine(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
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

/**
 * FIX: GeoJSON polygon rings already repeat coords[0] at the end.
 * We check before adding the closing leg to avoid double-counting.
 */
function ringPerim(coords) {
  if (!coords || coords.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  const last  = coords[coords.length - 1];
  const first = coords[0];
  // Only add closing leg if the ring is not already closed
  if (last[0] !== first[0] || last[1] !== first[1]) {
    d += haversine(last, first);
  }
  return d;
}

function lineLength(coords) {
  if (!coords || coords.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/**
 * Google Earth Pro behaviour: a Path whose first and last vertices are
 * the same point (or within CLOSE_THRESHOLD metres) is treated as a
 * closed shape and its enclosed area is reported alongside the length.
 */
const CLOSE_THRESHOLD_M = 1.0; // metres — same tolerance GEP uses

function isClosedLine(coords) {
  if (!coords || coords.length < 3) return false;
  const dist = haversine(coords[0], coords[coords.length - 1]);
  return dist <= CLOSE_THRESHOLD_M;
}

/* ─── Unit tables ─────────────────────────────────────────────────────────── */
const DIST_UNITS = [
  { key: "m",   label: "Meters",         factor: 1,            dp: 3 },
  { key: "km",  label: "Kilometers",     factor: 1e-3,         dp: 6 },
  { key: "mi",  label: "Miles",          factor: 1 / 1609.344, dp: 6 },
  { key: "ft",  label: "Feet",           factor: 3.28084,      dp: 2 },
  { key: "yd",  label: "Yards",          factor: 1.09361,      dp: 2 },
  { key: "nmi", label: "Nautical Miles", factor: 1 / 1852,     dp: 6 },
];

const AREA_UNITS = [
  { key: "m2",  label: "Square Meters",     symbol: "m²",  factor: 1,             dp: 2 },
  { key: "km2", label: "Square Kilometers", symbol: "km²", factor: 1e-6,          dp: 6 },
  { key: "ha",  label: "Hectares",          symbol: "ha",  factor: 1e-4,          dp: 4 },
  { key: "ac",  label: "Acres",             symbol: "ac",  factor: 1 / 4046.856,  dp: 4 },
  { key: "ft2", label: "Square Feet",       symbol: "ft²", factor: 10.7639,       dp: 1 },
  { key: "mi2", label: "Square Miles",      symbol: "mi²", factor: 3.861e-7,      dp: 8 },
];

/* ─── Strip altitude from [lng, lat, alt] triples ─────────────────────────── */
function strip(coord) {
  if (!coord || coord.length < 2) return null;
  const lng = parseFloat(coord[0]);
  const lat = parseFloat(coord[1]);
  if (isNaN(lng) || isNaN(lat)) return null;
  return [lng, lat];
}

function stripRing(ring) {
  if (!ring || ring.length < 2) return [];
  return ring.map(strip).filter(Boolean);
}

/* ─── Compute stats from a GeoJSON geometry ───────────────────────────────── */
function computeStats(geom) {
  if (!geom || !geom.type) return null;
  const t = geom.type;

  if (t === "Polygon") {
    if (!geom.coordinates || !geom.coordinates[0]) return null;
    const rings = geom.coordinates.map(stripRing);
    if (!rings[0] || rings[0].length < 3) return null;
    return {
      kind:     "polygon",
      areaSqM:  polygonAreaM2(rings),
      perimM:   ringPerim(rings[0]),
      coords:   rings[0],
    };
  }

  if (t === "MultiPolygon") {
    if (!geom.coordinates || geom.coordinates.length === 0) return null;
    let areaSqM = 0, perimM = 0, firstCoords = [];
    geom.coordinates.forEach(poly => {
      if (!poly || !poly[0]) return;
      const rings = poly.map(stripRing);
      if (rings[0]?.length >= 3) {
        areaSqM += polygonAreaM2(rings);
        perimM  += ringPerim(rings[0]);
        if (!firstCoords.length) firstCoords = rings[0];
      }
    });
    if (!firstCoords.length) return null;
    return { kind: "polygon", areaSqM, perimM, coords: firstCoords };
  }

  if (t === "LineString") {
    if (!geom.coordinates || geom.coordinates.length < 2) return null;
    const coords = geom.coordinates.map(strip).filter(Boolean);
    if (coords.length < 2) return null;
    const closed = isClosedLine(coords);
    return {
      kind:     "line",
      lengthM:  lineLength(coords),
      coords,
      // If the path forms a closed loop, compute enclosed area — matches GEP behaviour
      areaSqM:  closed ? ringArea(coords) : null,
      isClosed: closed,
    };
  }

  if (t === "MultiLineString") {
    if (!geom.coordinates) return null;
    let lengthM = 0, totalArea = 0;
    const allCoords = [];
    geom.coordinates.forEach(ls => {
      const coords = (ls || []).map(strip).filter(Boolean);
      lengthM += lineLength(coords);
      if (isClosedLine(coords)) totalArea += ringArea(coords);
      allCoords.push(...coords);
    });
    if (allCoords.length < 2) return null;
    const closed = isClosedLine(allCoords);
    return {
      kind:     "line",
      lengthM,
      coords:   allCoords,
      areaSqM:  totalArea > 0 ? totalArea : (closed ? ringArea(allCoords) : null),
      isClosed: closed || totalArea > 0,
    };
  }

  if (t === "Point") {
    if (!geom.coordinates || geom.coordinates.length < 2) return null;
    const lng = parseFloat(geom.coordinates[0]);
    const lat = parseFloat(geom.coordinates[1]);
    const alt = parseFloat(geom.coordinates[2]) || 0;
    if (isNaN(lng) || isNaN(lat)) return null;
    return { kind: "point", lat, lng, alt };
  }

  if (t === "MultiPoint") {
    if (!geom.coordinates || !geom.coordinates[0]) return null;
    const c   = geom.coordinates[0];
    const lng = parseFloat(c[0]);
    const lat = parseFloat(c[1]);
    const alt = parseFloat(c[2]) || 0;
    if (isNaN(lng) || isNaN(lat)) return null;
    return { kind: "point", lat, lng, alt };
  }

  if (t === "GeometryCollection") {
    for (const g of (geom.geometries || [])) {
      const s = computeStats(g);
      if (s) return s;
    }
    return null;
  }

  return null;
}

/* ─── Convert drawing points → stats ─────────────────────────────────────── */
function drawingToStats(drawing) {
  if (!drawing?.points?.length) return null;
  const pts = drawing.points;
  if (drawing.type === "marker") {
    return { kind: "point", lat: pts[0]?.lat ?? 0, lng: pts[0]?.lng ?? 0, alt: 0 };
  }
  const coords = pts.map(p => [p.lng ?? p.lon ?? 0, p.lat ?? 0]);
  if (drawing.type === "polygon" && coords.length >= 3) {
    const ring = [...coords, coords[0]];
    return {
      kind:    "polygon",
      areaSqM: polygonAreaM2([ring]),
      perimM:  ringPerim(ring),
      coords:  ring,
    };
  }
  // Detect closed drawn path — same GEP logic
  const closed = isClosedLine(coords);
  return {
    kind:     "line",
    lengthM:  lineLength(coords),
    coords,
    areaSqM:  closed ? ringArea(coords) : null,
    isClosed: closed,
  };
}

/* ─── Number formatter ────────────────────────────────────────────────────── */
function fmt(val, dp = 3) {
  if (val == null || isNaN(val)) return "—";
  return val.toLocaleString(undefined, {
    minimumFractionDigits:  dp,
    maximumFractionDigits:  dp,
  });
}

/* ─── CopyBtn ─────────────────────────────────────────────────────────────── */
function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
      title="Copy to clipboard"
      style={{
        padding: "1px 7px", borderRadius: 3, cursor: "pointer",
        fontSize: 10, border: `1px solid ${ok ? "#5a9a5a" : "#4a5a6a"}`,
        background: ok ? "#2a4a2a" : "#1e2d3a",
        color: ok ? "#7dba7d" : "#8ab4c8",
        fontFamily: "monospace", flexShrink: 0,
      }}
    >{ok ? "✓" : "⎘"}</button>
  );
}

/* ─── Tab button ──────────────────────────────────────────────────────────── */
function TabBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px", fontSize: 11,
        fontFamily: "'Segoe UI', Arial, sans-serif",
        cursor: "pointer", border: "1px solid",
        borderColor: active
          ? "#6a8fa8 #6a8fa8 #1e3040"
          : "#4a6070 #4a6070 #4a6070",
        borderRadius: "4px 4px 0 0",
        background: active
          ? "linear-gradient(180deg,#2a4560 0%,#1e3040 100%)"
          : "linear-gradient(180deg,#1a2535 0%,#16202e 100%)",
        color:  active ? "#d8eaf8" : "#7a9ab0",
        marginRight: 2, position: "relative",
        bottom:      active ? -1 : 0,
        fontWeight:  active ? 600 : 400,
        zIndex:      active ? 2 : 1,
      }}
    >{label}</button>
  );
}

/* ─── UnitSectionHeader ───────────────────────────────────────────────────── */
function UnitSectionHeader({ title, unit, units, onUnit }) {
  return (
    <tr>
      <td
        colSpan={2}
        style={{
          padding: "8px 14px 4px",
          color: "#7a9aaa", fontSize: 9.5,
          fontWeight: 700, letterSpacing: "0.08em",
          background: "#162030",
          borderBottom: "1px solid #2a3a4a",
          borderTop:    "1px solid #2a3a4a",
        }}
      >
        {title}
        {units && (
          <select
            value={unit}
            onChange={e => onUnit(e.target.value)}
            style={{
              marginLeft: 8,
              background: "#0e1a25", border: "1px solid #3a5060",
              color: "#9ab8cc", fontSize: 10,
              padding: "1px 4px", borderRadius: 3, cursor: "pointer",
            }}
          >
            {units.map(u => (
              <option key={u.key} value={u.key}>{u.label}</option>
            ))}
          </select>
        )}
      </td>
    </tr>
  );
}

/* ─── AllUnitsRows ────────────────────────────────────────────────────────── */
/**
 * Renders every unit in the given list as a table row.
 * The active unit row is highlighted and uses a larger, amber-colored value.
 */
function AllUnitsRows({ valueM, units, activeKey }) {
  return units.map(u => {
    const converted = valueM * u.factor;
    const display   = fmt(converted, u.dp ?? 3);
    const isActive  = u.key === activeKey;
    return (
      <tr key={u.key} style={{ background: isActive ? "rgba(251,191,36,0.06)" : "transparent" }}>
        <td style={{
          padding:    "4px 10px 4px 14px",
          color:      isActive ? "#9ab8cc" : "#5a7888",
          fontSize:   isActive ? 11.5 : 10,
          fontFamily: "'Segoe UI', Arial, sans-serif",
          whiteSpace: "nowrap",
          verticalAlign: "middle",
          width: 160,
        }}>
          {u.label}{u.symbol ? ` (${u.symbol})` : ""}
        </td>
        <td style={{ padding: "4px 8px", verticalAlign: "middle" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              color:      isActive ? "#f0c060" : "#8ab8c8",
              fontFamily: "'Courier New', monospace",
              fontSize:   isActive ? 12 : 10.5,
              fontWeight: isActive ? 700 : 400,
              minWidth:   110,
              textAlign:  "right",
            }}>{display}</span>
            <CopyBtn text={`${display} ${u.label}`} />
          </div>
        </td>
      </tr>
    );
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export default function FeaturePropertiesPanel({
  drawing,
  geojsonFeature,
  onClose,
  onSave,
}) {
  const isDrawing = !!drawing;

  const rawName = isDrawing
    ? drawing.name
    : (geojsonFeature?.properties?.name  ||
       geojsonFeature?.properties?.Name  ||
       geojsonFeature?.properties?.NAME  ||
       geojsonFeature?.properties?.title ||
       geojsonFeature?._name             ||
       "Unnamed Feature");

  const rawDesc = isDrawing
    ? (drawing.description || "")
    : (geojsonFeature?.properties?.description ||
       geojsonFeature?.properties?.Description || "");

  const rawColor = isDrawing
    ? (drawing.color || "#ff8800")
    : (geojsonFeature?.properties?.color  ||
       geojsonFeature?.properties?.stroke || "#ff8800");

  const stats = isDrawing
    ? drawingToStats(drawing)
    : computeStats(geojsonFeature?.geometry);

  const props    = geojsonFeature?.properties || {};
  const fileType = geojsonFeature?._fileType  || "";
  const fileName = geojsonFeature?._fileName  || "";

  const [name,    setName]    = useState(rawName  || "");
  const [desc,    setDesc]    = useState(rawDesc  || "");
  const [color,   setColor]   = useState(rawColor);
  const [width,   setWidth]   = useState(drawing?.width   ?? 2);
  const [opacity, setOpacity] = useState(drawing?.opacity ?? 100);
  const [tab,     setTab]     = useState(isDrawing ? "Description" : "Measurements");

  // Active unit keys — used only for highlighting, not filtering
  const [areaUnit,  setAreaUnit]  = useState("m2");
  const [perimUnit, setPerimUnit] = useState("m");
  const [lenUnit,   setLenUnit]   = useState("m");

  // "Close path" toggle — mirrors Google Earth Pro's checkbox on Edit Path dialog.
  // When true for a LineString, we virtually close the path (join last → first),
  // recalculate total length, and show enclosed area in all units.
  const autoDetectedClosed = stats?.kind === "line" && (stats?.isClosed ?? false);
  const [closePath, setClosePath] = useState(autoDetectedClosed);

  // Effective stats for a line, taking closePath toggle into account
  const effectiveStats = (() => {
    if (!stats || stats.kind !== "line") return stats;
    const coords = stats.coords || [];
    if (!closePath) return { ...stats, areaSqM: null, isClosed: false };
    // Virtual close: add closing leg distance if not already closed
    const last  = coords[coords.length - 1];
    const first = coords[0];
    const closingLeg = (last && first && (last[0] !== first[0] || last[1] !== first[1]))
      ? haversine(last, first) : 0;
    return {
      ...stats,
      lengthM:  stats.lengthM + closingLeg,
      areaSqM:  ringArea(coords),
      isClosed: true,
    };
  })();

  /* ── Title / icon based on geometry type ────────────────────────────────── */
  const kindLabel = (() => {
    if (isDrawing) {
      if (drawing.type === "polygon") return "Edit Polygon";
      if (drawing.type === "marker")  return "Edit Placemark";
      return "Edit Path";
    }
    if (!stats) return "Feature Properties";
    if (stats.kind === "polygon") return "Edit Polygon";
    if (stats.kind === "point")   return "Edit Placemark";
    return "Edit Path";
  })();

  const typeIcon  = !stats ? "📄"
    : stats.kind === "polygon" ? "⬡"
    : stats.kind === "point"   ? "📍"
    : "〰";

  const typeColor = !stats ? "#94a3b8"
    : stats.kind === "polygon" ? "#fbbf24"
    : stats.kind === "point"   ? "#34d399"
    : "#60a5fa";

  const TABS = ["Description", "Style, Color", "View", "Altitude", "Measurements"];

  const handleSave = () => {
    if (isDrawing && onSave) {
      onSave({ ...drawing, name, description: desc, color, width, opacity, closePath });
    }
    onClose();
  };

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  /* ── DMS helper ─────────────────────────────────────────────────────────── */
  function toDMS(deg, pos, neg) {
    const d    = Math.abs(deg);
    const dInt = Math.floor(d);
    const mAll = (d - dInt) * 60;
    const mInt = Math.floor(mAll);
    const sec  = (mAll - mInt) * 60;
    return `${dInt}°${mInt}'${sec.toFixed(2)}" ${deg >= 0 ? pos : neg}`;
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9700,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Segoe UI', Arial, sans-serif",
      }}
    >
      <div style={{
        background: "linear-gradient(180deg,#1e2e40 0%,#18273a 100%)",
        border: "1px solid #3a5068",
        borderRadius: 6,
        boxShadow: "0 8px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04)",
        width: 480, minHeight: 380,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {/* ── Title bar ── */}
        <div style={{
          background: "linear-gradient(180deg,#2a3d52 0%,#1e3048 100%)",
          borderBottom: "1px solid #3a5068",
          padding: "7px 12px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "default", userSelect: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, color: typeColor }}>{typeIcon}</span>
            <span style={{ color: "#d8eaf8", fontWeight: 600, fontSize: 12.5 }}>
              SurveyMap Pro — {kindLabel}
            </span>
            {fileName && (
              <span style={{
                color: "#5a7888", fontSize: 10,
                fontFamily: "monospace", marginLeft: 4,
              }}>
                [{fileType.toUpperCase()}] {fileName.slice(0, 24)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(220,50,50,0.2)",
              border: "1px solid rgba(220,50,50,0.4)",
              color: "#f08080", width: 20, height: 20, borderRadius: 3,
              cursor: "pointer", fontSize: 14, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
            }}
          >×</button>
        </div>

        {/* ── Name row ── */}
        <div style={{
          padding: "10px 14px 6px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <label style={{ color: "#9ab8cc", fontSize: 11.5, flexShrink: 0, width: 40 }}>Name:</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            readOnly={!isDrawing}
            style={{
              flex: 1, padding: "4px 8px",
              background: isDrawing ? "#0e1a25" : "rgba(14,26,37,0.5)",
              border: "1px solid #3a5068", borderRadius: 3,
              color: "#d8eaf8", fontSize: 12, outline: "none",
              fontFamily: "'Segoe UI', Arial, sans-serif",
              cursor: isDrawing ? "text" : "default",
            }}
          />
        </div>

        {/* ── Tab strip ── */}
        <div style={{
          padding: "6px 12px 0",
          background: "linear-gradient(180deg,#182535 0%,#16202e 100%)",
          borderBottom: "1px solid #3a5068",
          display: "flex", alignItems: "flex-end",
        }}>
          {TABS.map(t => (
            <TabBtn key={t} label={t} active={tab === t} onClick={() => setTab(t)} />
          ))}
        </div>

        {/* ── Tab content ── */}
        <div style={{ flex: 1, overflow: "auto", background: "#1a2d3e", padding: 0 }}>

          {/* ════ DESCRIPTION ════ */}
          {tab === "Description" && (
            <div style={{ padding: "14px" }}>
              <div style={{ color: "#7a9aaa", fontSize: 10, marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em" }}>DESCRIPTION</div>
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                readOnly={!isDrawing}
                placeholder={isDrawing ? "Add a description…" : "No description"}
                rows={4}
                style={{
                  width: "100%", padding: "8px",
                  background: isDrawing ? "#0e1a25" : "rgba(14,26,37,0.4)",
                  border: "1px solid #3a5068", borderRadius: 3,
                  color: "#c8dff0", fontSize: 11.5, resize: "vertical",
                  fontFamily: "'Segoe UI', Arial, sans-serif",
                  outline: "none", boxSizing: "border-box",
                }}
              />

              {/* Attributes table */}
              {Object.keys(props).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: "#7a9aaa", fontSize: 10, marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em" }}>
                    ATTRIBUTES ({Object.keys(props).length})
                  </div>
                  <div style={{
                    background: "#0e1a25", border: "1px solid #2a4050",
                    borderRadius: 3, overflow: "hidden",
                  }}>
                    {Object.entries(props)
                      .filter(([k]) => !["styleUrl", "styleHash", "Style"].includes(k))
                      .slice(0, 20)
                      .map(([k, v], i, arr) => (
                        <div key={k} style={{
                          display: "flex", alignItems: "center", padding: "5px 10px",
                          borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                          gap: 8,
                        }}>
                          <span style={{
                            color: "#5a8090", fontSize: 10, width: 110, flexShrink: 0,
                            fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis",
                          }}>{k}</span>
                          <span style={{
                            color: "#a8c8d8", fontSize: 10.5, flex: 1,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{String(v ?? "—")}</span>
                          <CopyBtn text={String(v ?? "")} />
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Geometry badge */}
              {stats && (
                <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{
                    padding: "2px 10px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                    background: stats.kind === "polygon" ? "rgba(251,191,36,0.12)"
                      : stats.kind === "point"   ? "rgba(52,211,153,0.12)"
                      : "rgba(96,165,250,0.12)",
                    border: `1px solid ${stats.kind === "polygon" ? "rgba(251,191,36,0.3)"
                      : stats.kind === "point" ? "rgba(52,211,153,0.3)" : "rgba(96,165,250,0.3)"}`,
                    color: stats.kind === "polygon" ? "#fbbf24"
                      : stats.kind === "point" ? "#34d399" : "#60a5fa",
                  }}>
                    {stats.kind === "polygon" ? "Polygon" : stats.kind === "point" ? "Point" : "LineString"}
                  </span>
                  {fileType && (
                    <span style={{ color: "#3a5868", fontSize: 10, fontFamily: "monospace" }}>
                      {fileType.toUpperCase()} · {fileName}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ════ STYLE, COLOR ════ */}
          {tab === "Style, Color" && (
            <div style={{ padding: "14px" }}>
              <div style={{ color: "#7a9aaa", fontSize: 10, marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em" }}>LINES</div>
              <div style={{
                background: "#0e1a25", border: "1px solid #2a4050",
                borderRadius: 3, padding: "10px 12px", marginBottom: 12,
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", rowGap: 8, alignItems: "center" }}>
                  <label style={{ color: "#9ab8cc", fontSize: 11 }}>Color:</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="color" value={color}
                      onChange={e => setColor(e.target.value)}
                      disabled={!isDrawing}
                      style={{
                        width: 36, height: 24, padding: 0,
                        border: "1px solid #3a5068", borderRadius: 2,
                        cursor: isDrawing ? "pointer" : "default", background: "none",
                      }}
                    />
                    <span style={{ color: "#6a8898", fontFamily: "monospace", fontSize: 11 }}>
                      {color.toUpperCase()}
                    </span>
                  </div>

                  <label style={{ color: "#9ab8cc", fontSize: 11 }}>Width:</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="range" min={1} max={10} value={width}
                      onChange={e => setWidth(Number(e.target.value))}
                      disabled={!isDrawing} style={{ flex: 1 }}
                    />
                    <span style={{ color: "#d8eaf8", fontSize: 11, minWidth: 20, textAlign: "right" }}>{width}</span>
                  </div>

                  <label style={{ color: "#9ab8cc", fontSize: 11 }}>Opacity:</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="range" min={0} max={100} value={opacity}
                      onChange={e => setOpacity(Number(e.target.value))}
                      disabled={!isDrawing} style={{ flex: 1 }}
                    />
                    <span style={{ color: "#d8eaf8", fontSize: 11, minWidth: 30, textAlign: "right" }}>{opacity}%</span>
                  </div>
                </div>
              </div>

              {stats?.kind === "polygon" && (
                <>
                  <div style={{ color: "#7a9aaa", fontSize: 10, marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em" }}>AREA FILL</div>
                  <div style={{ background: "#0e1a25", border: "1px solid #2a4050", borderRadius: 3, padding: "10px 12px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", rowGap: 8, alignItems: "center" }}>
                      <label style={{ color: "#9ab8cc", fontSize: 11 }}>Fill Color:</label>
                      <input
                        type="color" defaultValue="#ff880044"
                        disabled={!isDrawing}
                        style={{ width: 36, height: 24, padding: 0, border: "1px solid #3a5068", borderRadius: 2 }}
                      />
                      <label style={{ color: "#9ab8cc", fontSize: 11 }}>Fill Opacity:</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="range" min={0} max={100} defaultValue={40} disabled={!isDrawing} style={{ flex: 1 }} />
                        <span style={{ color: "#d8eaf8", fontSize: 11, minWidth: 30 }}>40%</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ── Close Path checkbox — shown for any LineString (drawn or imported) ── */}
              {stats?.kind === "line" && (
                <div style={{
                  marginTop: 12,
                  background: "#0e1a25", border: "1px solid #2a4050",
                  borderRadius: 3, padding: "10px 12px",
                }}>
                  <div style={{ color: "#7a9aaa", fontSize: 10, marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em" }}>PATH OPTIONS</div>
                  <label style={{
                    display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                    userSelect: "none",
                  }}>
                    {/* Custom GEP-style checkbox */}
                    <div
                      onClick={() => setClosePath(v => !v)}
                      style={{
                        width: 16, height: 16, borderRadius: 2, flexShrink: 0,
                        border: `1px solid ${closePath ? "#4a9eff" : "#3a5068"}`,
                        background: closePath ? "#1a4a7a" : "#0a1420",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s",
                      }}
                    >
                      {closePath && (
                        <svg width="10" height="10" viewBox="0 0 10 10">
                          <polyline points="1.5,5 4,7.5 8.5,2" stroke="#4a9eff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div onClick={() => setClosePath(v => !v)}>
                      <div style={{ color: "#c8dff0", fontSize: 11.5 }}>Close path</div>
                      <div style={{ color: "#5a7888", fontSize: 10, marginTop: 2 }}>
                        Connects the last point back to the first — shows enclosed area in Measurements
                      </div>
                    </div>
                  </label>
                  {closePath && (
                    <div style={{
                      marginTop: 8, padding: "6px 10px", borderRadius: 3,
                      background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.2)",
                      color: "#6ab0e8", fontSize: 10,
                    }}>
                      ✓ Path is closed — enclosed area now shown in the Measurements tab
                    </div>
                  )}
                </div>
              )}

              {!isDrawing && stats?.kind !== "line" && (
                <div style={{ marginTop: 10, color: "#5a7888", fontSize: 10.5, fontStyle: "italic" }}>
                  Style editing is only available for drawn shapes.
                </div>
              )}
            </div>
          )}

          {/* ════ VIEW ════ */}
          {tab === "View" && (
            <div style={{ padding: "14px" }}>
              <div style={{ color: "#7a9aaa", fontSize: 10, marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em" }}>VIEW SETTINGS</div>
              <div style={{ background: "#0e1a25", border: "1px solid #2a4050", borderRadius: 3, padding: "10px 12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 8, alignItems: "center" }}>
                  {[
                    ["Center (Lat)", stats?.kind === "point"
                      ? `${stats.lat?.toFixed(6)}°`
                      : stats?.coords?.[0] ? `${stats.coords[0][1]?.toFixed(6)}°` : "—"],
                    ["Center (Lng)", stats?.kind === "point"
                      ? `${stats.lng?.toFixed(6)}°`
                      : stats?.coords?.[0] ? `${stats.coords[0][0]?.toFixed(6)}°` : "—"],
                    ["Range",   "—"],
                    ["Heading", "0.000°"],
                    ["Tilt",    "0.000°"],
                  ].map(([label, val]) => (
                    <>
                      <label key={label + "l"} style={{ color: "#9ab8cc", fontSize: 11 }}>{label}:</label>
                      <span  key={label + "v"} style={{ color: "#d8eaf8", fontFamily: "monospace", fontSize: 11 }}>{val}</span>
                    </>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 10, color: "#5a7888", fontSize: 10 }}>Coordinate system: WGS-84 (EPSG:4326)</div>
            </div>
          )}

          {/* ════ ALTITUDE ════ */}
          {tab === "Altitude" && (
            <div style={{ padding: "14px" }}>
              <div style={{ color: "#7a9aaa", fontSize: 10, marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em" }}>ALTITUDE MODE</div>
              <div style={{ background: "#0e1a25", border: "1px solid #2a4050", borderRadius: 3, padding: "10px 12px" }}>
                {["Clamped to ground", "Relative to ground", "Absolute"].map((mode, i) => (
                  <label key={mode} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                    <input type="radio" name="altmode" defaultChecked={i === 0} style={{ accentColor: "#4a9eff" }} />
                    <span style={{ color: "#c8dff0", fontSize: 11.5 }}>{mode}</span>
                  </label>
                ))}
                <div style={{ marginTop: 10, borderTop: "1px solid #2a4050", paddingTop: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 6, alignItems: "center" }}>
                    <label style={{ color: "#9ab8cc", fontSize: 11 }}>Altitude:</label>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        defaultValue={stats?.kind === "point" ? (stats.alt || 0).toFixed(2) : "0"}
                        disabled={!isDrawing}
                        style={{
                          width: 80, padding: "3px 6px",
                          background: "#0a1420", border: "1px solid #3a5068",
                          borderRadius: 3, color: "#d8eaf8", fontSize: 11, fontFamily: "monospace",
                        }}
                      />
                      <select style={{
                        background: "#0e1a25", border: "1px solid #3a5068",
                        color: "#9ab8cc", fontSize: 11, padding: "3px 4px", borderRadius: 3,
                      }}>
                        <option>Meters</option>
                        <option>Feet</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ MEASUREMENTS ════ */}
          {tab === "Measurements" && (
            <div>
              {!stats && (
                <div style={{ padding: "30px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>📄</div>
                  <div style={{ color: "#5a7888", fontSize: 11, fontStyle: "italic" }}>
                    No geometry available for this feature.
                    <br />
                    <span style={{ fontSize: 10, marginTop: 6, display: "block", color: "#3a5060" }}>
                      This may be a folder or style-only node.
                    </span>
                  </div>
                </div>
              )}

              {/* ── Polygon ── */}
              {stats?.kind === "polygon" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>

                  {/* AREA section */}
                  <thead>
                    <UnitSectionHeader
                      title="AREA"
                      unit={areaUnit}
                      units={AREA_UNITS}
                      onUnit={setAreaUnit}
                    />
                  </thead>
                  <tbody>
                    <AllUnitsRows
                      valueM={stats.areaSqM}
                      units={AREA_UNITS}
                      activeKey={areaUnit}
                    />
                  </tbody>

                  {/* PERIMETER section */}
                  <thead>
                    <UnitSectionHeader
                      title="PERIMETER"
                      unit={perimUnit}
                      units={DIST_UNITS}
                      onUnit={setPerimUnit}
                    />
                  </thead>
                  <tbody>
                    <AllUnitsRows
                      valueM={stats.perimM}
                      units={DIST_UNITS}
                      activeKey={perimUnit}
                    />
                    <tr>
                      <td style={{
                        padding: "6px 10px 6px 14px", color: "#9ab8cc", fontSize: 11,
                        borderTop: "1px solid #1e3040",
                      }}>Vertices</td>
                      <td style={{ padding: "6px 8px", borderTop: "1px solid #1e3040" }}>
                        <span style={{ color: "#d8eaf8", fontFamily: "monospace", fontSize: 11 }}>
                          {stats.coords ? stats.coords.length : "—"}
                        </span>
                      </td>
                    </tr>
                  </tbody>

                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{
                        padding: "8px 14px", borderTop: "1px solid #1e3040",
                        color: "#3a5868", fontSize: 9.5, fontFamily: "monospace",
                      }}>
                        WGS-84 · Geographic · Spherical Haversine
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* ── Line ── */}
              {stats?.kind === "line" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>

                  {/* "Close path" quick-toggle row at top of Measurements tab */}
                  <tbody>
                    <tr>
                      <td colSpan={2} style={{
                        padding: "8px 14px 6px",
                        background: "#111e2a",
                        borderBottom: "1px solid #1e3040",
                      }}>
                        <label style={{
                          display: "flex", alignItems: "center", gap: 8,
                          cursor: "pointer", userSelect: "none",
                        }}>
                          <div
                            onClick={() => setClosePath(v => !v)}
                            style={{
                              width: 14, height: 14, borderRadius: 2, flexShrink: 0,
                              border: `1px solid ${closePath ? "#4a9eff" : "#3a5068"}`,
                              background: closePath ? "#1a4a7a" : "#0a1420",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            {closePath && (
                              <svg width="9" height="9" viewBox="0 0 10 10">
                                <polyline points="1.5,5 4,7.5 8.5,2" stroke="#4a9eff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <span
                            onClick={() => setClosePath(v => !v)}
                            style={{ color: closePath ? "#7ab8e8" : "#7a9ab0", fontSize: 11 }}
                          >
                            Close path {closePath ? "— showing enclosed area" : ""}
                          </span>
                        </label>
                      </td>
                    </tr>
                  </tbody>

                  {/* LENGTH section — uses effectiveStats so closing leg is included */}
                  <thead>
                    <UnitSectionHeader
                      title={closePath ? "TOTAL LENGTH (closed)" : "LENGTH"}
                      unit={lenUnit}
                      units={DIST_UNITS}
                      onUnit={setLenUnit}
                    />
                  </thead>
                  <tbody>
                    <AllUnitsRows
                      valueM={effectiveStats.lengthM}
                      units={DIST_UNITS}
                      activeKey={lenUnit}
                    />
                    <tr>
                      <td style={{
                        padding: "6px 10px 6px 14px", color: "#9ab8cc", fontSize: 11,
                        borderTop: "1px solid #1e3040",
                      }}>Points</td>
                      <td style={{ padding: "6px 8px", borderTop: "1px solid #1e3040" }}>
                        <span style={{ color: "#d8eaf8", fontFamily: "monospace", fontSize: 11 }}>
                          {stats.coords ? stats.coords.length : "—"}
                          {closePath && (
                            <span style={{ color: "#4a7888", fontSize: 10, marginLeft: 6 }}>
                              +1 closing segment
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  </tbody>

                  {/*
                    ENCLOSED AREA — shown when "Close path" is checked OR the path
                    was already geometrically closed (first == last vertex).
                    Matches Google Earth Pro's exact behaviour.
                  */}
                  {effectiveStats.isClosed && effectiveStats.areaSqM != null && (
                    <>
                      <thead>
                        <tr>
                          <td colSpan={2} style={{
                            padding: "6px 14px 2px",
                            color: "#7a9aaa", fontSize: 9.5, fontWeight: 700,
                            letterSpacing: "0.08em", background: "#162030",
                            borderBottom: "1px solid #2a3a4a",
                            borderTop: "1px solid #2a3a4a",
                          }}>
                            ENCLOSED AREA
                            <span style={{
                              marginLeft: 8, fontSize: 9, fontWeight: 400,
                              color: "#4a9eff", fontStyle: "italic",
                            }}>
                              {stats.isClosed ? "(geometrically closed)" : "(close path enabled)"}
                            </span>
                            <select
                              value={areaUnit}
                              onChange={e => setAreaUnit(e.target.value)}
                              style={{
                                marginLeft: 8, background: "#0e1a25",
                                border: "1px solid #3a5060", color: "#9ab8cc",
                                fontSize: 10, padding: "1px 4px", borderRadius: 3, cursor: "pointer",
                              }}
                            >
                              {AREA_UNITS.map(u => (
                                <option key={u.key} value={u.key}>{u.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      </thead>
                      <tbody>
                        <AllUnitsRows
                          valueM={effectiveStats.areaSqM}
                          units={AREA_UNITS}
                          activeKey={areaUnit}
                        />
                      </tbody>
                    </>
                  )}

                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{
                        padding: "8px 14px", borderTop: "1px solid #1e3040",
                        color: "#3a5868", fontSize: 9.5, fontFamily: "monospace",
                      }}>
                        WGS-84 · Geographic · Spherical Haversine
                        {effectiveStats.isClosed && (
                          <span style={{ marginLeft: 8, color: "#5a9878" }}>· closed path</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* ── Point ── */}
              {stats?.kind === "point" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <td colSpan={2} style={{
                        padding: "8px 14px 4px", color: "#7a9aaa", fontSize: 9.5,
                        fontWeight: 700, letterSpacing: "0.08em",
                        background: "#162030", borderBottom: "1px solid #2a3a4a",
                      }}>POSITION</td>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Latitude",  `${stats.lat?.toFixed(8)}°`,        `${stats.lat?.toFixed(8)}`],
                      ["Longitude", `${stats.lng?.toFixed(8)}°`,        `${stats.lng?.toFixed(8)}`],
                      ["Altitude",  `${(stats.alt || 0).toFixed(2)} m`, `${(stats.alt || 0).toFixed(2)} m`],
                    ].map(([label, val, copy]) => (
                      <tr key={label}>
                        <td style={{ padding: "7px 10px 7px 14px", color: "#9ab8cc", fontSize: 11.5, whiteSpace: "nowrap" }}>{label}</td>
                        <td style={{ padding: "7px 8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{
                              color: "#f0c060", fontFamily: "monospace", fontSize: 12,
                              fontWeight: 600, minWidth: 110, textAlign: "right",
                            }}>{val}</span>
                            <CopyBtn text={copy} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {/* DMS row */}
                    <tr>
                      <td colSpan={2} style={{ padding: "6px 14px", borderTop: "1px solid #1e3040" }}>
                        <div style={{ color: "#5a7888", fontSize: 10, fontFamily: "monospace" }}>
                          {stats.lat != null && stats.lng != null &&
                            `${toDMS(stats.lat, "N", "S")}  ${toDMS(stats.lng, "E", "W")}`
                          }
                        </div>
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{
                        padding: "8px 14px", borderTop: "1px solid #1e3040",
                        color: "#3a5868", fontSize: 9.5, fontFamily: "monospace",
                      }}>
                        WGS-84 · Geographic · Decimal Degrees + DMS
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "8px 14px",
          background: "linear-gradient(180deg,#1a2a3a 0%,#16202e 100%)",
          borderTop: "1px solid #2a3a50",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            onClick={handleSave}
            style={{
              padding: "5px 24px", borderRadius: 3, cursor: "pointer",
              background: "linear-gradient(180deg,#2a4a6a,#1e3a58)",
              border: "1px solid #4a7090", color: "#c8e0f8",
              fontSize: 12, fontWeight: 600, fontFamily: "'Segoe UI', Arial, sans-serif",
            }}
          >OK</button>
          <button
            onClick={onClose}
            style={{
              padding: "5px 18px", borderRadius: 3, cursor: "pointer",
              background: "linear-gradient(180deg,#1e2e40,#18242e)",
              border: "1px solid #3a4a58", color: "#8ab0c0",
              fontSize: 12, fontFamily: "'Segoe UI', Arial, sans-serif",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}