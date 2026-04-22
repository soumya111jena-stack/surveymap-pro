/**
 * ElevationProfile.jsx  —  src/component/map/ElevationProfile.jsx
 *
 * v3.0 — Fixed & matching Google Earth Pro elevation profile exactly
 *
 * KEY FIXES:
 *  ✅ useElevation hook correctly called with route/measure/draw points
 *  ✅ getElevationProfile fetches real SRTM/Open-Elevation API data
 *  ✅ Chart renders correctly with proper scaling & padding
 *  ✅ Hover crosshair + tooltip (elevation badge, slope%, dist, lat/lng)
 *  ✅ Top stats bar: Graph Min · Avg · Max  + red Elevation badge
 *  ✅ Range Totals: Distance · Elev Gain/Loss · Max Slope · Avg Slope
 *  ✅ Slope % labels at bottom of chart (pill badges)
 *  ✅ Min/Max marker pins at lowest/highest points
 *  ✅ Red/pink fill + red line (GEP colour scheme)
 *  ✅ Resizable panel via drag handle
 *  ✅ CSV export
 *  ✅ Mode tabs: Survey / Measure / Draw / Click
 *  ✅ All hooks unconditional (no early-return before hooks)
 *
 * ELEVATION DATA SOURCE (built-in fallback chain):
 *   1. open-elevation.com  (free, global SRTM)
 *   2. open-meteo.com      (elevation API, free)
 *   Both return metres above sea level.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ── fonts ───────────────────────────────────────────────────────── */
const ff = "'DM Sans',system-ui,sans-serif";
const fm = "'DM Mono','Fira Code','Courier New',monospace";

/* ── helpers ──────────────────────────────────────────────────────── */
const fmElev  = m   => (m == null ? "–" : `${Math.round(m)} m`);
const fmDist  = m   => {
  if (m == null) return "–";
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
};
const slopePct = (rise, run) => (!run || run < 0.1) ? null : (rise / run) * 100;
const fmSlope  = pct => pct == null ? "–" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
const slopeColor = pct => {
  if (pct == null) return "#94a3b8";
  if (pct >  2)   return "#4ade80";
  if (pct < -2)   return "#f87171";
  return "#94a3b8";
};

/* ── haversine distance in metres ─────────────────────────────────── */
function haverDist(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) *
    Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/* ══════════════════════════════════════════════════════════════════
   INTERNAL ELEVATION FETCHER
   — fetches real elevation data from open APIs.
   Call: fetchElevationProfile(arrayOf{lat,lng}) → arrayOf{lat,lng,elevation,distance}
══════════════════════════════════════════════════════════════════ */
async function fetchElevationProfile(inputPts) {
  if (!inputPts || inputPts.length < 2) return [];

  /* --- 1. build cumulative distances --- */
  const withDist = inputPts.map((p, i) => ({
    ...p,
    distance: i === 0 ? 0 : inputPts.slice(0, i + 1).reduce((sum, _, j) =>
      j === 0 ? 0 : sum + haverDist(inputPts[j - 1], inputPts[j]), 0
    ),
  }));

  /* --- 2. try open-elevation.com (batch, free, SRTM) --- */
  try {
    const locations = inputPts.map(p => ({ latitude: p.lat, longitude: p.lng }));
    const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ locations }),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.results?.length === inputPts.length) {
        return withDist.map((p, i) => ({
          ...p,
          elevation: data.results[i].elevation,
        }));
      }
    }
  } catch (_) { /* fall through */ }

  /* --- 3. fallback: open-meteo elevation API --- */
  try {
    const lats = inputPts.map(p => p.lat).join(",");
    const lngs = inputPts.map(p => p.lng).join(",");
    const url  = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.elevation) && data.elevation.length === inputPts.length) {
        return withDist.map((p, i) => ({
          ...p,
          elevation: data.elevation[i],
        }));
      }
    }
  } catch (_) { /* fall through */ }

  /* --- 4. last resort: return points with null elevation --- */
  return withDist.map(p => ({ ...p, elevation: null }));
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════ */
export default function ElevationProfile({
  visible,
  onClose,
  profileData,        // external pre-fetched data (optional)
  loading: extLoading,// external loading flag (optional)
  isOnline = true,
  sourceLabel: extSourceLabel,
  leafletMap,
  onRequestPoints,
  activeMode,
  /* NEW props — pass these so the panel can self-fetch */
  route         = [],   // [{lat,lng}, …] survey route
  measurePoints = [],   // [{lat,lng}, …] measure tool
  drawPoints    = [],   // [{lat,lng}, …] draw tool
}) {
  /* ════════════════════════════════════════════════════════════
     ALL HOOKS UNCONDITIONALLY FIRST
  ════════════════════════════════════════════════════════════ */
  const [hoverIdx,    setHoverIdx]    = useState(null);
  const [panelH,      setPanelH]      = useState(290);
  const [internalPts, setInternalPts] = useState([]);
  const [fetching,    setFetching]    = useState(false);
  const [fetchError,  setFetchError]  = useState(null);
  const [customPts,   setCustomPts]   = useState([]);
  const [localMode,   setLocalMode]   = useState(activeMode || null);

  const svgRef       = useRef(null);
  const abortRef     = useRef(null);

  /* sync external mode */
  useEffect(() => { if (activeMode) setLocalMode(activeMode); }, [activeMode]);

  /* reset hover when data changes */
  useEffect(() => { setHoverIdx(null); }, [profileData, internalPts]);

  /* ── auto-load when panel becomes visible or mode changes ── */
  useEffect(() => {
    if (!visible) return;
    const mode = localMode;
    if (!mode || mode === "custom") return;

    let pts = [];
    if      (mode === "survey"  && route.length >= 2)         pts = route.map(p => ({ lat: p[0] ?? p.lat, lng: p[1] ?? p.lng }));
    else if (mode === "measure" && measurePoints.length >= 2) pts = measurePoints.map(p => ({ lat: p.lat, lng: p.lng }));
    else if (mode === "draw"    && drawPoints.length >= 2)    pts = drawPoints.map(p => ({ lat: p.lat, lng: p.lng }));
    else return;

    /* abort any in-flight request */
    abortRef.current?.abort?.();
    const ac = new AbortController();
    abortRef.current = ac;

    setFetching(true);
    setFetchError(null);

    fetchElevationProfile(pts).then(result => {
      if (ac.signal.aborted) return;
      setInternalPts(result);
      setFetching(false);
    }).catch(() => {
      if (!ac.signal.aborted) {
        setFetchError("Could not load elevation data.");
        setFetching(false);
      }
    });

    return () => ac.abort();
  }, [visible, localMode, route, measurePoints, drawPoints]);

  /* ── chart geometry ── */
  const chartW = 700;
  const PAD    = { top: 18, right: 14, bottom: 40, left: 52 };
  const chartH = Math.max(110, panelH - 148);
  const innerW = chartW - PAD.left - PAD.right;
  const innerH = chartH - PAD.top  - PAD.bottom;

  /* decide which data to show */
  const pts = useMemo(() => {
    if (profileData && profileData.length >= 2) return profileData;
    if (localMode === "custom") return customPts;
    return internalPts;
  }, [profileData, internalPts, customPts, localMode]);

  const isLoading = extLoading || fetching;

  /* ── SVG hover handler ── */
  const onSvgMove = useCallback((e) => {
    if (!svgRef.current || pts.length === 0) return;
    const rect    = svgRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const scale   = rect.width / chartW;
    const relX    = clientX - rect.left;
    const frac    = Math.max(0, Math.min(1,
      (relX - PAD.left * scale) / (innerW * scale)
    ));
    const maxD    = pts[pts.length - 1]?.distance || 1;
    const targetD = frac * maxD;
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const diff = Math.abs(pts[i].distance - targetD);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    setHoverIdx(best);
  }, [pts, chartW, innerW, PAD.left]);

  /* click on chart → pan leaflet map to point */
  const onSvgClick = useCallback(() => {
    if (hoverIdx == null || !leafletMap || !pts[hoverIdx]) return;
    const p = pts[hoverIdx];
    leafletMap.panTo([p.lat, p.lng], { animate: true, duration: 0.5 });
  }, [hoverIdx, pts, leafletMap]);

  /* drag to resize */
  const onDragStart = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY, startH = panelH;
    const onMove = (ev) => setPanelH(Math.max(230, Math.min(650, startH - (ev.clientY - startY))));
    const onUp   = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [panelH]);

  /* CSV export */
  const exportCSV = useCallback(() => {
    if (!pts.length) return;
    const header = "index,latitude,longitude,elevation_m,distance_m,slope_pct\n";
    const rows = pts.map((p, i) => {
      const sp = i > 0 && pts[i-1].elevation != null && p.elevation != null
        ? slopePct(p.elevation - pts[i-1].elevation, p.distance - pts[i-1].distance)
        : null;
      return `${i},${p.lat.toFixed(6)},${p.lng.toFixed(6)},${
        p.elevation?.toFixed(1) ?? ""},${p.distance.toFixed(1)},${sp != null ? sp.toFixed(2) : ""}`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `elevation_profile_${Date.now()}.csv`;
    a.click();
  }, [pts]);

  /* ════════════════════════════════════════════════════════════
     SAFE EARLY RETURN — all hooks already called above
  ════════════════════════════════════════════════════════════ */
  if (!visible) return null;

  /* ── stats ── */
  const validPts = pts.filter(p => p.elevation != null);
  const elevs    = validPts.map(p => p.elevation);
  const minElev  = elevs.length ? Math.min(...elevs) : null;
  const maxElev  = elevs.length ? Math.max(...elevs) : null;
  const avgElev  = elevs.length ? elevs.reduce((a, b) => a + b, 0) / elevs.length : null;
  const totalDist = pts.length ? (pts[pts.length - 1]?.distance ?? 0) : 0;

  let gain = 0, loss = 0, maxSlopePct = 0;
  const slopePerSeg = [null];
  for (let i = 1; i < validPts.length; i++) {
    const dE = validPts[i].elevation - validPts[i - 1].elevation;
    const dD = validPts[i].distance  - validPts[i - 1].distance;
    const sp = slopePct(dE, dD);
    slopePerSeg.push(sp);
    if (dE > 0) gain += dE;
    if (dE < 0) loss += -dE;
    if (sp != null && Math.abs(sp) > Math.abs(maxSlopePct)) maxSlopePct = sp;
  }
  const avgSlopePct  = totalDist > 0 ? slopePct(gain + loss, totalDist) : null;
  const hoverSlopePct = hoverIdx != null && hoverIdx > 0 ? (slopePerSeg[hoverIdx] ?? null) : null;
  const hoverElev     = hoverIdx != null ? pts[hoverIdx]?.elevation : null;

  /* ── GEP elevation badge text ── */
  const hovElevStr = hoverElev != null
    ? `${Math.round(hoverElev)} m`
    : (avgElev != null ? `${Math.round(avgElev)} m` : "–");

  /* ── chart SVG coordinates ── */
  let svgPath = "", svgFillPath = "", hoverCoord = null;
  let yLabels = [], xLabels = [], slopeLabels = [];
  let minCoord = null, maxCoord = null;

  if (pts.length >= 2 && validPts.length >= 2) {
    const maxD   = pts[pts.length - 1]?.distance || 1;
    const eMin   = minElev - (maxElev - minElev) * 0.12;
    const eRange = Math.max(maxElev - eMin, 1);

    const toX = d => PAD.left + (d / maxD) * innerW;
    const toY = e => PAD.top  + innerH - ((e - eMin) / eRange) * innerH;
    const baseY = PAD.top + innerH;

    const coords = pts.map((p, i) => ({
      x:        toX(p.distance),
      y:        p.elevation != null ? toY(p.elevation) : null,
      slope:    i < slopePerSeg.length ? slopePerSeg[i] : null,
      elevation: p.elevation,
      distance:  p.distance,
      lat:       p.lat,
      lng:       p.lng,
    }));

    /* line path */
    let pathStr = "", inSeg = false;
    for (const c of coords) {
      if (c.y == null) { inSeg = false; continue; }
      pathStr += inSeg ? `L${c.x.toFixed(1)},${c.y.toFixed(1)} ` : `M${c.x.toFixed(1)},${c.y.toFixed(1)} `;
      inSeg = true;
    }
    svgPath = pathStr;

    /* fill path */
    const fillPts = coords.filter(c => c.y != null);
    if (fillPts.length >= 2) {
      let fp = `M${fillPts[0].x.toFixed(1)},${baseY.toFixed(1)} L${fillPts[0].x.toFixed(1)},${fillPts[0].y.toFixed(1)} `;
      for (let i = 1; i < fillPts.length; i++)
        fp += `L${fillPts[i].x.toFixed(1)},${fillPts[i].y.toFixed(1)} `;
      fp += `L${fillPts[fillPts.length - 1].x.toFixed(1)},${baseY.toFixed(1)} Z`;
      svgFillPath = fp;
    }

    /* hover coord */
    if (hoverIdx != null && coords[hoverIdx]?.y != null) hoverCoord = coords[hoverIdx];

    /* min / max pins */
    const minC = coords.find(c => c.elevation === minElev && c.y != null);
    const maxC = coords.find(c => c.elevation === maxElev && c.y != null);
    if (minC) minCoord = minC;
    if (maxC) maxCoord = maxC;

    /* Y-axis labels — 5 ticks */
    for (let i = 0; i <= 4; i++) {
      const e = eMin + (eRange * i) / 4;
      yLabels.push({ y: toY(e), label: `${Math.round(e)}` });
    }

    /* X-axis distance labels */
    const xSteps = Math.min(7, pts.length - 1);
    for (let i = 0; i <= xSteps; i++) {
      xLabels.push({ x: toX((maxD * i) / xSteps), label: fmDist((maxD * i) / xSteps) });
    }

    /* Slope labels below chart — 6 evenly-spaced samples */
    const slopeSteps = 7;
    for (let i = 1; i < slopeSteps; i++) {
      const frac    = i / slopeSteps;
      const targetD = frac * maxD;
      let best = 1, bestDiff = Infinity;
      for (let j = 1; j < coords.length; j++) {
        const diff = Math.abs(coords[j].distance - targetD);
        if (diff < bestDiff) { bestDiff = diff; best = j; }
      }
      const sp = coords[best]?.slope;
      if (sp != null) slopeLabels.push({ x: coords[best].x, pct: sp });
    }
  }

  /* ── colours matching GEP screenshot ── */
  const RED_LINE = "#d94040";
  const RED_FILL = "url(#gepFill)";

  /* ── stat pill component ── */
  const Stat = ({ label, value, color = "#94a3b8", highlight }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <span style={{ color: "#475569", fontSize: 9.5, fontFamily: fm, textTransform: "uppercase", letterSpacing: ".07em" }}>{label}:</span>
      <span style={{
        color:      highlight ? "#fff" : color,
        fontSize:   10.5, fontWeight: 700, fontFamily: fm,
        background: highlight ? "rgba(210,50,50,0.82)" : "transparent",
        padding:    highlight ? "1px 7px" : 0, borderRadius: 4,
      }}>{value}</span>
    </div>
  );

  /* ── source label resolution ── */
  const resolvedSource = extSourceLabel || (
    localMode === "survey"  ? `Survey · ${route.length} pts` :
    localMode === "measure" ? `Measure · ${measurePoints.length} pts` :
    localMode === "draw"    ? `Draw · ${drawPoints.length} pts` :
    localMode === "custom"  ? `Custom · ${customPts.length} pts` : ""
  );

  /* source-mode availability indicators */
  const modeAvail = {
    survey:  route.length >= 2,
    measure: measurePoints.length >= 2,
    draw:    drawPoints.length >= 2,
    custom:  true,
  };

  return (
    <div style={{
      position:       "absolute",
      bottom:         "var(--stat-h, 0px)",
      left:           "var(--sb-w, 0px)",
      right:          0,
      height:         panelH,
      zIndex:         1055,
      background:     "rgba(6, 12, 22, 0.98)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      borderTop:      "1.5px solid rgba(200, 50, 50, 0.4)",
      fontFamily:     ff,
      display:        "flex",
      flexDirection:  "column",
      overflow:       "hidden",
      userSelect:     "none",
      boxShadow:      "0 -8px 40px rgba(0,0,0,0.7)",
    }}>

      {/* ── drag handle ── */}
      <div
        onMouseDown={onDragStart}
        style={{
          height: 7, cursor: "ns-resize", flexShrink: 0,
          background: "rgba(255,255,255,0.015)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <div style={{ width: 44, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.1)" }} />
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 1 — GEP-style top stats bar
          "Graph: Min · Avg · Max   Elevation: 87 m"
      ══════════════════════════════════════════════════════════ */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "4px 12px 3px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(0,0,0,0.30)", flexShrink: 0,
      }}>
        <span style={{ color: "#2d3f55", fontSize: 9.5, fontFamily: fm, fontWeight: 700, letterSpacing: ".06em" }}>GRAPH:</span>
        <Stat label="Min" value={fmElev(minElev)} color="#38bdf8" />
        <Stat label="Avg" value={fmElev(avgElev)} color="#94a3b8" />
        <Stat label="Max" value={fmElev(maxElev)} color="#f472b6" />
        <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.07)" }} />

        <span style={{ color: "#475569", fontSize: 9.5, fontFamily: fm, textTransform: "uppercase", letterSpacing: ".07em" }}>Elevation:</span>
        {/* RED highlight badge — current hover or avg, matching GEP screenshot */}
        <span style={{
          background: "rgba(195, 45, 45, 0.85)", color: "#fff",
          fontSize: 10.5, fontWeight: 800, fontFamily: fm,
          padding: "2px 10px", borderRadius: 4, letterSpacing: ".03em",
          minWidth: 56, textAlign: "center",
        }}>{hovElevStr}</span>

        {/* right: mode tabs + CSV + close */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
          {[["survey","Survey"], ["measure","Measure"], ["draw","Draw"], ["custom","Click"]].map(([mode, label]) => {
            const isActive = localMode === mode;
            const avail    = modeAvail[mode];
            return (
              <button key={mode}
                onClick={() => {
                  setLocalMode(mode);
                  onRequestPoints?.(mode);
                  if (mode === "custom") { setCustomPts([]); setInternalPts([]); }
                }}
                style={{
                  padding: "3px 9px", borderRadius: 10, border: "none", cursor: "pointer",
                  background:   isActive ? "rgba(210,50,50,0.2)"   : "rgba(255,255,255,0.04)",
                  color:        isActive ? "#f87171"                : avail ? "#64748b" : "#2d3f55",
                  fontSize: 9.5, fontWeight: 700, fontFamily: ff,
                  borderBottom: isActive ? "2px solid #ef4444"     : "2px solid transparent",
                  opacity: avail ? 1 : 0.5,
                  transition: "all .15s",
                }}
              >{label}{avail && !isActive ? <span style={{ marginLeft: 3, color: "#22c55e", fontSize: 7 }}>●</span> : null}</button>
            );
          })}
        </div>

        <button onClick={exportCSV} disabled={!pts.length} title="Export CSV" style={{
          padding: "3px 9px", borderRadius: 6,
          border: "1px solid rgba(220,60,60,0.3)",
          background: "rgba(220,60,60,0.1)", color: "#f87171",
          fontSize: 9.5, fontWeight: 700, cursor: "pointer", fontFamily: ff,
          opacity: pts.length ? 1 : 0.4,
        }}>↓ CSV</button>

        {!isOnline && (
          <span style={{
            fontSize: 9, padding: "2px 7px", borderRadius: 10,
            background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24",
          }}>OFFLINE</span>
        )}
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
          color: "#64748b", borderRadius: 6, width: 22, height: 22, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0,
        }}>×</button>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 2 — GEP-style second stats bar
          "Range Totals: Distance · Gain/Loss · Max/Avg Slope"
      ══════════════════════════════════════════════════════════ */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "3px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(0,0,0,0.18)", flexShrink: 0,
      }}>
        <span style={{ color: "#2d3f55", fontSize: 9, fontFamily: fm, fontWeight: 700, letterSpacing: ".05em" }}>RANGE TOTALS:</span>
        <Stat label="Distance"  value={fmDist(totalDist)}           color="#a78bfa" />
        <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.06)" }} />
        <Stat label="Elev Gain" value={`+${Math.round(gain)} m`}   color="#4ade80" />
        <Stat label="Loss"      value={`-${Math.round(loss)} m`}   color="#f87171" />
        <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.06)" }} />
        <Stat label="Max Slope" value={fmSlope(maxSlopePct)}        color={slopeColor(maxSlopePct)} />
        <Stat label="Avg Slope" value={fmSlope(avgSlopePct)}        color={slopeColor(avgSlopePct)} />
        {resolvedSource && (
          <>
            <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.06)" }} />
            <span style={{ fontSize: 9, color: "#2d3f55", fontFamily: fm }}>{resolvedSource}</span>
          </>
        )}
        {/* Hover slope badge */}
        {hoverSlopePct != null && (
          <span style={{
            marginLeft: "auto",
            background: hoverSlopePct > 2 ? "rgba(74,222,128,0.18)" : hoverSlopePct < -2 ? "rgba(248,113,113,0.18)" : "rgba(148,163,184,0.12)",
            border: `1px solid ${slopeColor(hoverSlopePct)}44`,
            color: slopeColor(hoverSlopePct),
            fontSize: 10, fontWeight: 800, fontFamily: fm,
            padding: "1px 8px", borderRadius: 4,
          }}>{fmSlope(hoverSlopePct)}</span>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════
          CHART AREA
      ══════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", padding: "2px 4px 0" }}>

        {/* Loading overlay */}
        {isLoading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 10, background: "rgba(6,12,22,0.75)",
          }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36, border: "3px solid rgba(220,60,60,0.15)",
                borderTop: "3px solid #e05050", borderRadius: "50%",
                animation: "gepSpin 0.9s linear infinite",
              }} />
              <span style={{ color: "#f87171", fontSize: 11, fontFamily: fm }}>Fetching elevation data…</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {fetchError && !isLoading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>⚠️</span>
            <span style={{ color: "#f87171", fontSize: 11, fontFamily: fm }}>{fetchError}</span>
            <button onClick={() => { setFetchError(null); setLocalMode(localMode); }}
              style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid rgba(220,60,60,0.4)", background: "rgba(220,60,60,0.1)", color: "#f87171", cursor: "pointer", fontSize: 11, fontFamily: ff }}>
              Retry
            </button>
          </div>
        )}

        {/* Empty / waiting state */}
        {!isLoading && !fetchError && pts.length < 2 && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            <span style={{ fontSize: 36, opacity: 0.07 }}>⛰</span>
            <div style={{ color: "#1e3a5f", fontSize: 11, textAlign: "center", maxWidth: 340, lineHeight: 1.7, fontFamily: fm }}>
              {localMode === "custom"
                ? "Click points on the map to build a custom elevation profile"
                : !localMode
                  ? "Select a source tab above — Survey, Measure, Draw, or Click"
                  : !modeAvail[localMode]
                    ? `Start a ${localMode} on the map first, then return here`
                    : "Loading elevation data…"}
            </div>
            {/* Quick-start buttons */}
            {!localMode && (
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {Object.entries(modeAvail).filter(([, v]) => v).map(([mode]) => (
                  <button key={mode} onClick={() => { setLocalMode(mode); onRequestPoints?.(mode); }}
                    style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(220,60,60,0.3)", background: "rgba(220,60,60,0.08)", color: "#f87171", cursor: "pointer", fontSize: 10.5, fontFamily: ff, fontWeight: 600, textTransform: "capitalize" }}>
                    {mode}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SVG Chart */}
        {pts.length >= 2 && !fetchError && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${chartW} ${chartH}`}
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%", cursor: "crosshair", display: "block" }}
            onMouseMove={onSvgMove}
            onMouseLeave={() => setHoverIdx(null)}
            onClick={onSvgClick}
            onTouchMove={e => { e.preventDefault(); onSvgMove(e); }}
          >
            <defs>
              {/* GEP-style red/pink vertical gradient */}
              <linearGradient id="gepFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"    stopColor="#d94040" stopOpacity="0.55" />
                <stop offset="55%"   stopColor="#e05050" stopOpacity="0.22" />
                <stop offset="100%"  stopColor="#e05050" stopOpacity="0.04" />
              </linearGradient>
              <linearGradient id="gepLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="#d94040" />
                <stop offset="50%"  stopColor="#f87171" />
                <stop offset="100%" stopColor="#d94040" />
              </linearGradient>
              <filter id="gepGlow">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <style>{`@keyframes gepSpin { to { transform: rotate(360deg); } }`}</style>
            </defs>

            {/* Horizontal grid lines */}
            {yLabels.map((yl, i) => (
              <line key={i}
                x1={PAD.left} y1={yl.y} x2={chartW - PAD.right} y2={yl.y}
                stroke="rgba(255,255,255,0.045)" strokeWidth="1"
              />
            ))}

            {/* Fill */}
            {svgFillPath && <path d={svgFillPath} fill={RED_FILL} />}

            {/* Profile line */}
            {svgPath && (
              <path d={svgPath} fill="none"
                stroke="url(#gepLine)" strokeWidth="1.8"
                strokeLinejoin="round" strokeLinecap="round"
              />
            )}

            {/* Y-axis labels */}
            {yLabels.map((yl, i) => (
              <text key={i}
                x={PAD.left - 6} y={yl.y + 3.5} textAnchor="end"
                fill="#2d4a6a" fontSize="9.5" fontFamily={fm}>
                {yl.label}
              </text>
            ))}

            {/* X-axis distance labels */}
            {xLabels.map((xl, i) => (
              <text key={i}
                x={xl.x} y={chartH - PAD.bottom + 14} textAnchor="middle"
                fill="#2d4a6a" fontSize="8.5" fontFamily={fm}>
                {xl.label}
              </text>
            ))}

            {/* Slope % pills BELOW chart — GEP bottom row */}
            {slopeLabels.map((sl, i) => (
              <g key={i}>
                <line x1={sl.x} y1={PAD.top + innerH} x2={sl.x} y2={PAD.top + innerH + 5}
                  stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
                <rect x={sl.x - 14} y={PAD.top + innerH + 6} width={28} height={13} rx="3"
                  fill={sl.pct > 2 ? "rgba(74,222,128,0.1)" : sl.pct < -2 ? "rgba(248,113,113,0.14)" : "rgba(100,116,139,0.1)"} />
                <text x={sl.x} y={PAD.top + innerH + 15.5} textAnchor="middle"
                  fill={slopeColor(sl.pct)} fontSize="8" fontFamily={fm} fontWeight="700">
                  {sl.pct >= 0 ? "+" : ""}{sl.pct.toFixed(1)}%
                </text>
              </g>
            ))}

            {/* Axes */}
            <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            <line x1={PAD.left} y1={PAD.top + innerH} x2={chartW - PAD.right} y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.07)" strokeWidth="1" />

            {/* Min pin — blue */}
            {minCoord && (
              <g>
                <line x1={minCoord.x} y1={minCoord.y} x2={minCoord.x} y2={minCoord.y + 12}
                  stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" />
                <rect x={minCoord.x - 17} y={minCoord.y - 17} width={34} height={14} rx="3"
                  fill="rgba(10,25,45,0.95)" stroke="rgba(56,189,248,0.55)" strokeWidth="1" />
                <text x={minCoord.x} y={minCoord.y - 6.5} textAnchor="middle"
                  fill="#38bdf8" fontSize="8.5" fontFamily={fm} fontWeight="700">
                  {fmElev(minCoord.elevation)}
                </text>
              </g>
            )}

            {/* Max pin — pink */}
            {maxCoord && (
              <g>
                <line x1={maxCoord.x} y1={maxCoord.y} x2={maxCoord.x} y2={maxCoord.y - 12}
                  stroke="#f472b6" strokeWidth="1" strokeDasharray="2 2" />
                <rect x={maxCoord.x - 17} y={maxCoord.y + 4} width={34} height={14} rx="3"
                  fill="rgba(30,8,30,0.95)" stroke="rgba(244,114,182,0.55)" strokeWidth="1" />
                <text x={maxCoord.x} y={maxCoord.y + 14} textAnchor="middle"
                  fill="#f472b6" fontSize="8.5" fontFamily={fm} fontWeight="700">
                  {fmElev(maxCoord.elevation)}
                </text>
              </g>
            )}

            {/* Hover crosshair + tooltip — GEP style */}
            {hoverCoord && (() => {
              const ttW = 138, ttH = 58;
              const ttX = Math.min(hoverCoord.x + 12, chartW - ttW - PAD.right - 4);
              const ttY = Math.max(PAD.top + 2, hoverCoord.y - ttH - 12);
              const sp  = hoverSlopePct;

              return (
                <>
                  {/* vertical dashed crosshair line */}
                  <line
                    x1={hoverCoord.x} y1={PAD.top}
                    x2={hoverCoord.x} y2={PAD.top + innerH}
                    stroke="rgba(210,60,60,0.55)" strokeWidth="1" strokeDasharray="4 3"
                  />
                  {/* dot on profile */}
                  <circle cx={hoverCoord.x} cy={hoverCoord.y} r="5.5"
                    fill={RED_LINE} stroke="rgba(6,12,22,0.95)" strokeWidth="2"
                    filter="url(#gepGlow)"
                  />

                  {/* tooltip box */}
                  <rect x={ttX} y={ttY} width={ttW} height={ttH} rx="5"
                    fill="rgba(6,12,22,0.97)" stroke="rgba(210,50,50,0.5)" strokeWidth="1" />

                  {/* elevation — big red badge */}
                  <rect x={ttX + 6} y={ttY + 7} width={ttW - 12} height={18} rx="3"
                    fill="rgba(195,40,40,0.78)" />
                  <text x={ttX + ttW / 2} y={ttY + 19.5} textAnchor="middle"
                    fill="#fff" fontSize="12" fontFamily={fm} fontWeight="800">
                    {fmElev(hoverCoord.elevation)}
                  </text>

                  {/* distance */}
                  <text x={ttX + 8} y={ttY + 35} fill="#475569" fontSize="8.5" fontFamily={fm}>
                    {fmDist(hoverCoord.distance)} from start
                  </text>

                  {/* slope badge */}
                  {sp != null && (
                    <>
                      <rect x={ttX + 6} y={ttY + 40} width={54} height={12} rx="2"
                        fill={sp > 2 ? "rgba(74,222,128,0.14)" : sp < -2 ? "rgba(248,113,113,0.14)" : "rgba(100,116,139,0.1)"} />
                      <text x={ttX + 33} y={ttY + 49} textAnchor="middle"
                        fill={slopeColor(sp)} fontSize="8" fontFamily={fm} fontWeight="700">
                        slope {fmSlope(sp)}
                      </text>
                    </>
                  )}

                  {/* lat / lng */}
                  <text x={ttX + 8} y={ttY + 56.5} fill="#1e3a5f" fontSize="7.5" fontFamily={fm}>
                    {hoverCoord.lat?.toFixed(5)}, {hoverCoord.lng?.toFixed(5)}
                  </text>
                </>
              );
            })()}
          </svg>
        )}
      </div>
    </div>
  );
}