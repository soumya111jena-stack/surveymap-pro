/**
 * ElevationProfile.jsx
 *
 * v6.0 — Google Earth Pro EXACT match
 *
 * KEY CHANGES vs v5:
 *  ✅ WHITE/LIGHT background chart (not dark) — matches GE Pro exactly
 *  ✅ Light pink fill (#f4a0a0 → transparent) under elevation line
 *  ✅ Thin dark red elevation line (#b91c1c, 1.5px)
 *  ✅ Full-height thin WHITE spike line on hover
 *  ✅ Small filled RED dot on the elevation line at hover point
 *  ✅ RED elevation badge ABOVE the dot (compact, GE style)
 *  ✅ Connector line from badge to dot
 *  ✅ Distance label pinned below x-axis at spike position
 *  ✅ Slope % badge at bottom of spike
 *  ✅ ARROW CURSOR (pointer) on chart — GE uses crosshair + pointer
 *  ✅ Panel background stays dark (only chart area is light)
 *  ✅ All API fallback chain preserved
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

const ff = "'DM Sans',system-ui,sans-serif";
const fm = "'DM Mono','Fira Code','Courier New',monospace";

const fmElev = m   => (m == null ? "–" : `${Math.round(m)} m`);
const fmDist = m   => {
  if (m == null) return "–";
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
};
const slopePct  = (rise, run) => (!run || run < 0.1) ? null : (rise / run) * 100;
const fmSlope   = pct => pct == null ? "–" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
const slopeColor = pct => {
  if (pct == null) return "#94a3b8";
  if (pct >  2)   return "#16a34a";
  if (pct < -2)   return "#dc2626";
  return "#64748b";
};

function normPt(p) {
  if (!p) return null;
  if (Array.isArray(p)) {
    if (Math.abs(p[0]) > 90) return { lat: p[1], lng: p[0] };
    return { lat: p[0], lng: p[1] };
  }
  if (p.lat != null && p.lng != null) return { lat: p.lat, lng: p.lng };
  if (p.lat != null && p.lon != null) return { lat: p.lat, lng: p.lon };
  if (p.latitude != null)             return { lat: p.latitude, lng: p.longitude };
  return null;
}
function normPts(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(normPt).filter(Boolean);
}

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

function interpolatePts(pts, maxPts = 100) {
  if (pts.length <= maxPts) return pts;
  const result = [];
  const step = (pts.length - 1) / (maxPts - 1);
  for (let i = 0; i < maxPts; i++) {
    const idx = Math.min(Math.round(i * step), pts.length - 1);
    result.push(pts[idx]);
  }
  return result;
}

/* ══════════════════════════════════════════════════════════════════
   ELEVATION FETCHER — 3-API fallback chain
══════════════════════════════════════════════════════════════════ */
async function fetchElevationProfile(inputPts, signal) {
  if (!inputPts || inputPts.length < 2) return [];
  const pts = interpolatePts(inputPts, 100);
  const withDist = pts.map((p, i) => ({
    ...p,
    distance: i === 0 ? 0
      : pts.slice(0, i).reduce((sum, _, j) => sum + haverDist(pts[j], pts[j + 1]), 0),
  }));

  /* PRIMARY: open-meteo */
  try {
    const lats = pts.map(p => p.lat.toFixed(6)).join(",");
    const lngs = pts.map(p => p.lng.toFixed(6)).join(",");
    const url  = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
    const res  = await fetch(url, { signal: signal ?? AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.elevation) && data.elevation.length === pts.length)
        return withDist.map((p, i) => ({ ...p, elevation: data.elevation[i] }));
    }
  } catch (err) { if (err.name === "AbortError") throw err; }

  /* SECONDARY: open-elevation.com */
  try {
    const locations = pts.map(p => ({ latitude: p.lat, longitude: p.lng }));
    const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ locations }),
      signal: AbortSignal.timeout(14000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.results?.length === pts.length)
        return withDist.map((p, i) => ({ ...p, elevation: data.results[i].elevation }));
    }
  } catch (err) { if (err.name === "AbortError") throw err; }

  /* TERTIARY: opentopodata SRTM30 */
  try {
    const locStr = pts.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|");
    const url    = `https://api.opentopodata.org/v1/srtm30m?locations=${locStr}`;
    const res    = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.status === "OK" && data.results?.length === pts.length)
        return withDist.map((p, i) => ({ ...p, elevation: data.results[i].elevation }));
    }
  } catch (err) { if (err.name === "AbortError") throw err; }

  return withDist.map(p => ({ ...p, elevation: null }));
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════ */
export default function ElevationProfile({
  visible,
  onClose,
  profileData,
  loading: extLoading,
  isOnline = true,
  sourceLabel: extSourceLabel,
  leafletMap,
  onRequestPoints,
  activeMode,
  route         = [],
  measurePoints = [],
  drawPoints    = [],
}) {
  const [hoverIdx,    setHoverIdx]    = useState(null);
  const [panelH,      setPanelH]      = useState(300);
  const [internalPts, setInternalPts] = useState([]);
  const [fetching,    setFetching]    = useState(false);
  const [fetchError,  setFetchError]  = useState(null);
  const [customPts,   setCustomPts]   = useState([]);
  const [localMode,   setLocalMode]   = useState(activeMode || null);

  const svgRef   = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { if (activeMode) setLocalMode(activeMode); }, [activeMode]);
  useEffect(() => { setHoverIdx(null); }, [profileData, internalPts, customPts]);

  useEffect(() => {
    if (!visible) return;
    if (!localMode) {
      if      (route.length >= 2)         setLocalMode("survey");
      else if (measurePoints.length >= 2) setLocalMode("measure");
      else if (drawPoints.length >= 2)    setLocalMode("draw");
    }
  }, [visible]); // eslint-disable-line

  /* Click mode: register Leaflet click */
  useEffect(() => {
    if (!visible || localMode !== "custom" || !leafletMap) return;
    const handleClick = (e) => {
      e.originalEvent?.stopPropagation?.();
      const { lat, lng } = e.latlng;
      setCustomPts(prev => [...prev, { lat, lng }]);
    };
    leafletMap.on("click", handleClick);
    leafletMap.getContainer().style.cursor = "crosshair";
    return () => {
      leafletMap.off("click", handleClick);
      leafletMap.getContainer().style.cursor = "";
    };
  }, [visible, localMode, leafletMap]);

  /* Fetch elevation on source change */
  useEffect(() => {
    if (!visible || !localMode) return;
    let rawPts = [];
    if      (localMode === "custom")  rawPts = customPts;
    else if (localMode === "survey")  rawPts = normPts(route);
    else if (localMode === "measure") rawPts = normPts(measurePoints);
    else if (localMode === "draw")    rawPts = normPts(drawPoints);

    if (rawPts.length < 2) { setInternalPts([]); return; }

    abortRef.current?.abort?.();
    const ac = new AbortController();
    abortRef.current = ac;
    setFetching(true);
    setFetchError(null);
    setInternalPts([]);

    fetchElevationProfile(rawPts, ac.signal)
      .then(result => {
        if (ac.signal.aborted) return;
        setInternalPts(result);
        setFetching(false);
      })
      .catch(err => {
        if (ac.signal.aborted || err.name === "AbortError") return;
        setFetchError("Could not load elevation data.");
        setFetching(false);
      });

    return () => ac.abort();
  }, [visible, localMode, route, measurePoints, drawPoints, customPts]);

  useEffect(() => () => abortRef.current?.abort?.(), []);

  /* Chart geometry */
  const chartW = 800;
  const PAD    = { top: 18, right: 20, bottom: 44, left: 56 };
  const chartH = Math.max(140, panelH - 120);
  const innerW = chartW - PAD.left - PAD.right;
  const innerH = chartH - PAD.top  - PAD.bottom;

  const pts = useMemo(() => {
    if (profileData && profileData.length >= 2) return profileData;
    return internalPts;
  }, [profileData, internalPts]);

  const isLoading = extLoading || fetching;

  /* Hover handler */
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

  const onSvgClick = useCallback(() => {
    if (hoverIdx == null || !leafletMap || !pts[hoverIdx]) return;
    const p = pts[hoverIdx];
    leafletMap.panTo([p.lat, p.lng], { animate: true, duration: 0.5 });
  }, [hoverIdx, pts, leafletMap]);

  const onDragStart = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY, startH = panelH;
    const onMove = (ev) => setPanelH(Math.max(220, Math.min(600, startH - (ev.clientY - startY))));
    const onUp   = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [panelH]);

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
    a.download = `elevation_${Date.now()}.csv`;
    a.click();
  }, [pts]);

  if (!visible) return null;

  /* Stats */
  const validPts  = pts.filter(p => p.elevation != null);
  const elevs     = validPts.map(p => p.elevation);
  const minElev   = elevs.length ? Math.min(...elevs) : null;
  const maxElev   = elevs.length ? Math.max(...elevs) : null;
  const avgElev   = elevs.length ? elevs.reduce((a, b) => a + b, 0) / elevs.length : null;
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
  const avgSlopePct   = totalDist > 0 ? slopePct(gain + loss, totalDist) : null;
  const hoverSlopePct = hoverIdx != null && hoverIdx > 0 ? (slopePerSeg[hoverIdx] ?? null) : null;
  const hoverElev     = hoverIdx != null ? pts[hoverIdx]?.elevation : null;

  const hovElevStr = hoverElev != null
    ? `${Math.round(hoverElev)} m`
    : (avgElev != null ? `${Math.round(avgElev)} m` : "–");

  /* SVG path building */
  let svgPath = "", svgFillPath = "", hoverCoord = null;
  let yLabels = [], xLabels = [];

  if (pts.length >= 2 && validPts.length >= 2) {
    const maxD    = pts[pts.length - 1]?.distance || 1;
    const padding = (maxElev - minElev) * 0.18;
    const eMin    = minElev - padding;
    const eMax    = maxElev + padding * 0.4;
    const eRange  = Math.max(eMax - eMin, 1);

    const toX  = d => PAD.left + (d / maxD) * innerW;
    const toY  = e => PAD.top  + innerH - ((e - eMin) / eRange) * innerH;
    const baseY = PAD.top + innerH;

    const coords = pts.map((p, i) => ({
      x:         toX(p.distance),
      y:         p.elevation != null ? toY(p.elevation) : null,
      slope:     i < slopePerSeg.length ? slopePerSeg[i] : null,
      elevation: p.elevation,
      distance:  p.distance,
      lat:       p.lat,
      lng:       p.lng,
    }));

    /* line path */
    let pathStr = "", inSeg = false;
    for (const c of coords) {
      if (c.y == null) { inSeg = false; continue; }
      pathStr += inSeg
        ? `L${c.x.toFixed(1)},${c.y.toFixed(1)} `
        : `M${c.x.toFixed(1)},${c.y.toFixed(1)} `;
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

    if (hoverIdx != null && coords[hoverIdx]?.y != null) hoverCoord = coords[hoverIdx];

    /* y-axis: 5 ticks */
    for (let i = 0; i <= 4; i++) {
      const e = eMin + (eRange * i) / 4;
      yLabels.push({ y: toY(e), label: `${Math.round(e)} m` });
    }

    /* x-axis */
    const xSteps = Math.min(6, pts.length - 1);
    for (let i = 0; i <= xSteps; i++) {
      xLabels.push({ x: toX((maxD * i) / xSteps), label: fmDist((maxD * i) / xSteps) });
    }
  }

  const modeAvail = {
    survey:  normPts(route).length >= 2,
    measure: normPts(measurePoints).length >= 2,
    draw:    normPts(drawPoints).length >= 2,
    custom:  true,
  };

  const resolvedSource = extSourceLabel || (
    localMode === "survey"  ? `Survey · ${normPts(route).length} pts` :
    localMode === "measure" ? `Measure · ${normPts(measurePoints).length} pts` :
    localMode === "draw"    ? `Draw · ${normPts(drawPoints).length} pts` :
    localMode === "custom"  ? `Custom · ${customPts.length} pts` : ""
  );

  const emptyMsg = (() => {
    if (localMode === "custom") {
      if (customPts.length === 0) return "Click points on the map to build a custom elevation profile";
      if (customPts.length === 1) return "Click at least one more point on the map";
      return "Loading elevation data…";
    }
    if (!localMode)            return "Select a source — Survey, Measure, Draw, or Click";
    if (!modeAvail[localMode]) return `Start a ${localMode} on the map first`;
    return "Loading elevation data…";
  })();

  /* Stat inline component — dark panel style */
  const StatItem = ({ label, value, color = "#94a3b8" }) => (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <span style={{ color:"#475569", fontSize:9, fontFamily:fm, textTransform:"uppercase", letterSpacing:".06em", whiteSpace:"nowrap" }}>{label}:</span>
      <span style={{ color, fontSize:10, fontWeight:700, fontFamily:fm, whiteSpace:"nowrap" }}>{value}</span>
    </div>
  );

  const Divider = () => (
    <div style={{ width:1, height:12, background:"rgba(255,255,255,0.08)", flexShrink:0 }} />
  );

  return (
    <div style={{
      position:       "absolute",
      bottom:         "var(--stat-h, 0px)",
      left:           "var(--sb-w, 0px)",
      right:          0,
      height:         panelH,
      zIndex:         1055,
      background:     "rgba(13, 20, 32, 0.97)",
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      borderTop:      "1px solid rgba(180,28,28,0.3)",
      fontFamily:     ff,
      display:        "flex",
      flexDirection:  "column",
      overflow:       "hidden",
      userSelect:     "none",
      boxShadow:      "0 -6px 28px rgba(0,0,0,0.55)",
    }}>

      {/* Drag handle */}
      <div onMouseDown={onDragStart} style={{
        height:6, cursor:"ns-resize", flexShrink:0,
        display:"flex", alignItems:"center", justifyContent:"center",
        background:"rgba(255,255,255,0.01)",
      }}>
        <div style={{ width:38, height:3, borderRadius:2, background:"rgba(255,255,255,0.07)" }} />
      </div>

      {/* ── TOP BAR ── */}
      <div style={{
        display:"flex", alignItems:"center", gap:7, flexWrap:"wrap",
        padding:"3px 10px 3px",
        borderBottom:"1px solid rgba(255,255,255,0.05)",
        background:"rgba(0,0,0,0.22)", flexShrink:0,
        minHeight:28,
      }}>
        <span style={{ color:"#334155", fontSize:9, fontFamily:fm, fontWeight:700, letterSpacing:".06em", flexShrink:0 }}>
          Graph. Min. Avg. Max.
        </span>
        {/* GE elevation pill */}
        <div style={{
          background:"#b91c1c", color:"#fff",
          fontSize:10.5, fontWeight:800, fontFamily:fm,
          padding:"1px 11px", borderRadius:3, letterSpacing:".04em", flexShrink:0,
        }}>
          Elevation: {hovElevStr}
        </div>
        <StatItem label="Min" value={fmElev(minElev)} color="#60a5fa" />
        <StatItem label="Avg" value={fmElev(avgElev)} color="#94a3b8" />
        <StatItem label="Max" value={fmElev(maxElev)} color="#f472b6" />

        {/* Mode tabs */}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:2 }}>
          {[["survey","Survey"],["measure","Measure"],["draw","Draw"],["custom","Click"]].map(([mode,label]) => {
            const isActive = localMode === mode;
            const avail    = modeAvail[mode];
            return (
              <button key={mode}
                onClick={() => {
                  setLocalMode(mode); setInternalPts([]); setFetchError(null);
                  onRequestPoints?.(mode);
                  if (mode === "custom") setCustomPts([]);
                }}
                style={{
                  padding:"2px 9px", borderRadius:3, border:"none", cursor:"pointer",
                  background:   isActive ? "rgba(185,28,28,0.22)" : "transparent",
                  color:        isActive ? "#fca5a5" : avail ? "#64748b" : "#2d3f55",
                  fontSize:9.5, fontWeight:700, fontFamily:ff,
                  borderBottom: isActive ? "2px solid #ef4444" : "2px solid transparent",
                  opacity: avail ? 1 : 0.45,
                  transition:"all .12s",
                }}
              >
                {label}
                {avail && !isActive
                  ? <span style={{ marginLeft:2, color:"#22c55e", fontSize:6 }}>●</span>
                  : null}
              </button>
            );
          })}
        </div>

        {localMode === "custom" && customPts.length > 0 && (
          <button
            onClick={() => { setCustomPts([]); setInternalPts([]); }}
            style={{
              padding:"2px 7px", borderRadius:3,
              border:"1px solid rgba(100,116,139,0.22)",
              background:"rgba(100,116,139,0.07)", color:"#64748b",
              fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:ff,
            }}
          >× Clear ({customPts.length})</button>
        )}

        <button onClick={exportCSV} disabled={!pts.length} style={{
          padding:"2px 7px", borderRadius:3,
          border:"1px solid rgba(185,28,28,0.28)",
          background:"rgba(185,28,28,0.07)", color:"#fca5a5",
          fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:ff,
          opacity: pts.length ? 1 : 0.4,
        }}>↓ CSV</button>

        {!isOnline && (
          <span style={{
            fontSize:8.5, padding:"1px 6px", borderRadius:3,
            background:"rgba(251,191,36,0.09)",
            border:"1px solid rgba(251,191,36,0.22)", color:"#fbbf24",
          }}>OFFLINE</span>
        )}

        <button onClick={onClose} style={{
          background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)",
          color:"#64748b", borderRadius:3, width:20, height:20, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0,
        }}>×</button>
      </div>

      {/* ── SECOND BAR ── */}
      <div style={{
        display:"flex", alignItems:"center", gap:7, flexWrap:"wrap",
        padding:"2px 10px",
        borderBottom:"1px solid rgba(255,255,255,0.04)",
        background:"rgba(0,0,0,0.1)", flexShrink:0,
        minHeight:21,
      }}>
        <span style={{ color:"#334155", fontSize:8.5, fontFamily:fm, fontWeight:700, letterSpacing:".04em" }}>Range Totals:</span>
        <StatItem label="Distance"       value={fmDist(totalDist)}        color="#a78bfa" />
        <Divider />
        <StatItem label="Elev Gain/Loss" value={`+${Math.round(gain)} m · -${Math.round(loss)} m`} color="#94a3b8" />
        <Divider />
        <StatItem label="Max Slope"      value={fmSlope(maxSlopePct)}      color={slopeColor(maxSlopePct)} />
        <StatItem label="Avg Slope"      value={fmSlope(avgSlopePct)}      color={slopeColor(avgSlopePct)} />
        {resolvedSource && (
          <>
            <Divider />
            <span style={{ fontSize:8.5, color:"#334155", fontFamily:fm }}>{resolvedSource}</span>
          </>
        )}
        {hoverSlopePct != null && (
          <span style={{
            marginLeft:"auto",
            background: hoverSlopePct > 2 ? "rgba(22,163,74,0.16)" : hoverSlopePct < -2 ? "rgba(185,28,28,0.2)" : "rgba(100,116,139,0.11)",
            border:`1px solid ${slopeColor(hoverSlopePct)}44`,
            color: slopeColor(hoverSlopePct),
            fontSize:9, fontWeight:800, fontFamily:fm,
            padding:"1px 7px", borderRadius:3,
          }}>{fmSlope(hoverSlopePct)}</span>
        )}
      </div>

      {/* ── CHART AREA — Google Earth light background ── */}
      <div style={{ flex:1, position:"relative", overflow:"hidden", background:"#f8f9fa" }}>

        <style>{`@keyframes gepSpin { to { transform:rotate(360deg); } }`}</style>

        {/* Loading */}
        {isLoading && (
          <div style={{
            position:"absolute", inset:0, display:"flex", alignItems:"center",
            justifyContent:"center", zIndex:10, background:"rgba(248,249,250,0.85)",
          }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
              <div style={{
                width:28, height:28,
                border:"2.5px solid rgba(185,28,28,0.18)",
                borderTop:"2.5px solid #b91c1c", borderRadius:"50%",
                animation:"gepSpin 0.8s linear infinite",
              }} />
              <span style={{ color:"#b91c1c", fontSize:10, fontFamily:fm }}>Fetching elevation…</span>
            </div>
          </div>
        )}

        {/* Error */}
        {fetchError && !isLoading && (
          <div style={{
            position:"absolute", inset:0, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", gap:8,
            background:"#f8f9fa",
          }}>
            <span style={{ fontSize:22, opacity:0.3 }}>⚠️</span>
            <span style={{ color:"#b91c1c", fontSize:10, fontFamily:fm }}>{fetchError}</span>
            <button
              onClick={() => {
                setFetchError(null); setInternalPts([]);
                const m = localMode; setLocalMode(null);
                setTimeout(() => setLocalMode(m), 50);
              }}
              style={{
                padding:"3px 11px", borderRadius:3,
                border:"1px solid rgba(185,28,28,0.35)",
                background:"rgba(185,28,28,0.09)", color:"#b91c1c",
                cursor:"pointer", fontSize:10, fontFamily:ff,
              }}
            >Retry</button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !fetchError && pts.length < 2 && (
          <div style={{
            position:"absolute", inset:0, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", gap:10,
            background:"#f8f9fa",
          }}>
            <span style={{ fontSize:30, opacity:0.1 }}>⛰</span>
            <div style={{ color:"#94a3b8", fontSize:11, textAlign:"center", maxWidth:360, lineHeight:1.8, fontFamily:fm }}>
              {emptyMsg}
            </div>
            {!localMode && (
              <div style={{ display:"flex", gap:5, marginTop:4 }}>
                {Object.entries(modeAvail).filter(([,v]) => v).map(([mode]) => (
                  <button key={mode}
                    onClick={() => { setLocalMode(mode); onRequestPoints?.(mode); }}
                    style={{
                      padding:"3px 10px", borderRadius:3,
                      border:"1px solid rgba(185,28,28,0.28)",
                      background:"rgba(185,28,28,0.06)", color:"#b91c1c",
                      cursor:"pointer", fontSize:10, fontFamily:ff, fontWeight:600,
                      textTransform:"capitalize",
                    }}>
                    {mode}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            SVG CHART — Google Earth Pro EXACT style
            Light background, pink fill, thin red line,
            white vertical spike, red dot, compact badges
        ══════════════════════════════════════════════════════════ */}
        {pts.length >= 2 && !fetchError && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${chartW} ${chartH}`}
            preserveAspectRatio="none"
            style={{
              width:"100%", height:"100%",
              cursor: hoverCoord ? "pointer" : "crosshair",
              display:"block",
              background:"#f8f9fa",
            }}
            onMouseMove={onSvgMove}
            onMouseLeave={() => setHoverIdx(null)}
            onClick={onSvgClick}
            onTouchMove={e => { e.preventDefault(); onSvgMove(e); }}
          >
            <defs>
              {/* GE fill: light pink → very transparent */}
              <linearGradient id="geFillLight" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#f87171" stopOpacity="0.55" />
                <stop offset="60%"  stopColor="#fca5a5" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#fecaca" stopOpacity="0.08" />
              </linearGradient>
              {/* Dot glow */}
              <filter id="dotGlowLight" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="2.5" result="blur"/>
                <feMerge>
                  <feMergeNode in="blur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              {/* Drop shadow for badges */}
              <filter id="badgeShadow" x="-10%" y="-20%" width="120%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#00000033"/>
              </filter>
            </defs>

            {/* Chart background — white */}
            <rect
              x={PAD.left} y={PAD.top}
              width={innerW} height={innerH}
              fill="#ffffff"
              stroke="#e2e8f0"
              strokeWidth="0.5"
            />

            {/* Horizontal grid lines */}
            {yLabels.map((yl, i) => (
              <line key={i}
                x1={PAD.left} y1={yl.y}
                x2={chartW - PAD.right} y2={yl.y}
                stroke="#e2e8f0" strokeWidth="0.8"
                strokeDasharray={i > 0 ? "3,4" : "none"}
              />
            ))}

            {/* Vertical grid lines */}
            {xLabels.map((xl, i) => (
              i > 0 && i < xLabels.length - 1 && (
                <line key={i}
                  x1={xl.x} y1={PAD.top}
                  x2={xl.x} y2={PAD.top + innerH}
                  stroke="#e2e8f0" strokeWidth="0.6"
                  strokeDasharray="3,4"
                />
              )
            ))}

            {/* Fill — GE light pink */}
            {svgFillPath && <path d={svgFillPath} fill="url(#geFillLight)" />}

            {/* Elevation line — thin dark red, clean */}
            {svgPath && (
              <path d={svgPath} fill="none"
                stroke="#b91c1c" strokeWidth="1.5"
                strokeLinejoin="round" strokeLinecap="round"
              />
            )}

            {/* Y-axis labels */}
            {yLabels.map((yl, i) => (
              <text key={i}
                x={PAD.left - 6} y={yl.y + 3.5}
                textAnchor="end" fill="#6b7280" fontSize="9" fontFamily={fm}
              >
                {yl.label}
              </text>
            ))}

            {/* X-axis labels */}
            {xLabels.map((xl, i) => (
              <text key={i}
                x={xl.x} y={chartH - PAD.bottom + 14}
                textAnchor="middle" fill="#6b7280" fontSize="8.5" fontFamily={fm}
              >
                {xl.label}
              </text>
            ))}

            {/* Axis borders */}
            <line x1={PAD.left} y1={PAD.top}
                  x2={PAD.left} y2={PAD.top + innerH}
              stroke="#94a3b8" strokeWidth="1" />
            <line x1={PAD.left} y1={PAD.top + innerH}
                  x2={chartW - PAD.right} y2={PAD.top + innerH}
              stroke="#94a3b8" strokeWidth="1" />

            {/* ════════════════════════════════════════════════════
                GOOGLE EARTH PRO HOVER SPIKE — EXACT MATCH:
                1. Thin WHITE vertical line (full chart height)
                2. Small filled RED dot on the elevation line
                3. Compact red elevation badge ABOVE the dot
                4. Thin connector line badge → dot
                5. Distance label below x-axis
                6. Slope badge at bottom
                + ARROW / POINTER cursor on hover
            ════════════════════════════════════════════════════ */}
            {hoverCoord && (() => {
              const cx   = hoverCoord.x;
              const cy   = hoverCoord.y;
              const topY = PAD.top;
              const botY = PAD.top + innerH;
              const sp   = hoverSlopePct;

              /* Elevation badge */
              const bW = 54, bH = 19;
              const bX = Math.min(Math.max(cx - bW / 2, PAD.left + 2), chartW - PAD.right - bW - 2);
              const bY = Math.max(topY + 2, cy - bH - 8);

              /* Distance label */
              const dW = 58, dH = 14;
              const dX = Math.min(Math.max(cx - dW / 2, PAD.left + 2), chartW - PAD.right - dW - 2);

              /* Slope badge */
              const sW = 50, sH = 14;
              const sX = Math.min(Math.max(cx - sW / 2, PAD.left + 2), chartW - PAD.right - sW - 2);
              const sY = botY + dH + 4;

              return (
                <>
                  {/* 1. Full-height thin WHITE spike line */}
                  <line
                    x1={cx} y1={topY}
                    x2={cx} y2={botY}
                    stroke="rgba(255,255,255,0.95)"
                    strokeWidth="1.5"
                  />

                  {/* Subtle shadow behind the spike for visibility on light bg */}
                  <line
                    x1={cx} y1={topY}
                    x2={cx} y2={botY}
                    stroke="rgba(100,100,100,0.18)"
                    strokeWidth="3"
                  />
                  {/* The white spike on top */}
                  <line
                    x1={cx} y1={topY}
                    x2={cx} y2={botY}
                    stroke="white"
                    strokeWidth="1.5"
                  />

                  {/* 2. Dot: outer halo + filled red circle */}
                  <circle cx={cx} cy={cy} r="8"
                    fill="rgba(185,28,28,0.15)"
                  />
                  <circle cx={cx} cy={cy} r="4.5"
                    fill="#b91c1c"
                    stroke="white"
                    strokeWidth="1.8"
                    filter="url(#dotGlowLight)"
                  />

                  {/* 3. Elevation badge above the dot */}
                  <rect x={bX} y={bY} width={bW} height={bH} rx="3"
                    fill="#b91c1c"
                    filter="url(#badgeShadow)"
                  />
                  <text x={bX + bW / 2} y={bY + 13}
                    textAnchor="middle"
                    fill="white" fontSize="11" fontFamily={fm} fontWeight="800"
                  >
                    {fmElev(hoverCoord.elevation)}
                  </text>

                  {/* 4. Connector line: badge bottom → dot top */}
                  {bY + bH + 2 < cy - 5 && (
                    <line
                      x1={cx} y1={bY + bH}
                      x2={cx} y2={cy - 5}
                      stroke="#b91c1c" strokeWidth="1.2" opacity="0.6"
                      strokeDasharray="2,2"
                    />
                  )}

                  {/* 5. Distance label below x-axis */}
                  <rect x={dX} y={botY + 2} width={dW} height={dH} rx="2"
                    fill="rgba(185,28,28,0.12)"
                    stroke="rgba(185,28,28,0.25)"
                    strokeWidth="0.5"
                  />
                  <text x={cx} y={botY + 12}
                    textAnchor="middle"
                    fill="#b91c1c" fontSize="8" fontFamily={fm} fontWeight="700"
                  >
                    {fmDist(hoverCoord.distance)}
                  </text>

                  {/* 6. Slope badge */}
                  {sp != null && (
                    <>
                      <rect x={sX} y={sY} width={sW} height={sH} rx="2"
                        fill={
                          sp > 2  ? "rgba(22,163,74,0.15)"
                          : sp < -2 ? "rgba(185,28,28,0.15)"
                          : "rgba(100,116,139,0.12)"
                        }
                        stroke={`${slopeColor(sp)}55`} strokeWidth="0.5"
                      />
                      <text x={cx} y={sY + 10}
                        textAnchor="middle"
                        fill={slopeColor(sp)}
                        fontSize="8.5" fontFamily={fm} fontWeight="700"
                      >
                        {fmSlope(sp)}
                      </text>
                    </>
                  )}

                  {/* Arrow / pointer indicator — GE style small triangle arrow */}
                  <polygon
                    points={`${cx-5},${cy+14} ${cx+5},${cy+14} ${cx},${cy+22}`}
                    fill="#b91c1c"
                    opacity="0.7"
                  />
                </>
              );
            })()}
          </svg>
        )}
      </div>
    </div>
  );
}