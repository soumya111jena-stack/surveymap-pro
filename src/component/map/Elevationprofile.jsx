/**
 * ElevationProfile.jsx  —  src/component/map/ElevationProfile.jsx
 *
 * FIXED: All hooks are called unconditionally BEFORE any early return.
 * Previously `if (!visible) return null` was placed before useCallback
 * hooks, violating React's Rules of Hooks.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

const ff = "'DM Sans',system-ui,sans-serif";
const fm = "'DM Mono',monospace";

function formatElev(m) {
  if (m == null) return "–";
  return `${Math.round(m)} m`;
}
function formatDist(m) {
  if (m == null) return "–";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}
function formatSlope(rise, run) {
  if (!run) return "–";
  return `${((rise / run) * 100).toFixed(1)}%`;
}

export default function ElevationProfile({
  visible,
  onClose,
  profileData,
  loading,
  isOnline,
  sourceLabel,
  leafletMap,
  onRequestPoints,
  activeMode,
}) {
  // ════════════════════════════════════════════════════════════════
  //  ALL HOOKS FIRST — no conditional returns allowed above here
  // ════════════════════════════════════════════════════════════════
  const [hoverIdx, setHoverIdx] = useState(null);
  const [panelH,   setPanelH]   = useState(260);
  const svgRef = useRef(null);

  // Reset hover index whenever profile data changes
  useEffect(() => {
    setHoverIdx(null);
  }, [profileData]);

  // Chart layout constants — derived values, not hooks, safe anywhere
  const chartW = 580;
  const PAD    = { top: 10, right: 10, bottom: 24, left: 44 };
  const chartH = Math.max(90, panelH - 180);
  const innerW = chartW - PAD.left - PAD.right;
  const innerH = chartH - PAD.top  - PAD.bottom;

  const pts = profileData || [];

  // SVG mouse move — find nearest data point under cursor
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

  // Click on chart → pan map to that point
  const onSvgClick = useCallback(() => {
    if (hoverIdx == null || !leafletMap || !pts[hoverIdx]) return;
    const p = pts[hoverIdx];
    leafletMap.panTo([p.lat, p.lng], { animate: true, duration: 0.5 });
  }, [hoverIdx, pts, leafletMap]);

  // Panel resize drag from top edge
  const onDragStart = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelH;
    const onMove = (ev) =>
      setPanelH(Math.max(200, Math.min(550, startH - (ev.clientY - startY))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [panelH]);

  // CSV export
  const exportCSV = useCallback(() => {
    if (!pts.length) return;
    const header = "index,latitude,longitude,elevation_m,distance_m\n";
    const rows   = pts.map((p, i) =>
      `${i},${p.lat.toFixed(6)},${p.lng.toFixed(6)},${
        p.elevation?.toFixed(1) ?? ""
      },${p.distance.toFixed(1)}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `elevation_profile_${Date.now()}.csv`;
    a.click();
  }, [pts]);

  // ════════════════════════════════════════════════════════════════
  //  Safe to return null here — all hooks have already been called
  // ════════════════════════════════════════════════════════════════
  if (!visible) return null;

  // ── Stats ────────────────────────────────────────────────────────
  const validPts = pts.filter(p => p.elevation != null);
  const elevs    = validPts.map(p => p.elevation);
  const minElev  = elevs.length ? Math.min(...elevs) : null;
  const maxElev  = elevs.length ? Math.max(...elevs) : null;
  const gain     = validPts.reduce((acc, p, i) => {
    if (i === 0) return acc;
    const d = p.elevation - validPts[i - 1].elevation;
    return acc + (d > 0 ? d : 0);
  }, 0);
  const loss = validPts.reduce((acc, p, i) => {
    if (i === 0) return acc;
    const d = p.elevation - validPts[i - 1].elevation;
    return acc + (d < 0 ? -d : 0);
  }, 0);
  const totalDist = pts.length ? (pts[pts.length - 1]?.distance ?? 0) : 0;
  const avgSlope  = totalDist > 0 ? formatSlope(gain + loss, totalDist) : "–";

  // ── Build SVG paths ───────────────────────────────────────────────
  let svgPath = "", svgFill = "", hoverData = null;
  let yLabels = [], xLabels = [];

  if (pts.length >= 2 && validPts.length >= 2) {
    const maxD   = pts[pts.length - 1]?.distance || 1;
    const eMin   = minElev - (maxElev - minElev) * 0.08;
    const eRange = Math.max(maxElev - eMin, 1);

    const toX = d => PAD.left + (d / maxD)             * innerW;
    const toY = e => PAD.top  + innerH - ((e - eMin) / eRange) * innerH;

    const coords = pts.map(p => ({
      x: toX(p.distance),
      y: p.elevation != null ? toY(p.elevation) : null,
      ...p,
    }));

    let pathStr = "", fillStr = "", inSeg = false;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (c.y == null) { inSeg = false; continue; }
      if (!inSeg) {
        pathStr += `M${c.x.toFixed(1)},${c.y.toFixed(1)} `;
        fillStr += `M${c.x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${c.x.toFixed(1)},${c.y.toFixed(1)} `;
        inSeg = true;
      } else {
        pathStr += `L${c.x.toFixed(1)},${c.y.toFixed(1)} `;
        fillStr += `L${c.x.toFixed(1)},${c.y.toFixed(1)} `;
      }
    }
    const lastValid = coords.filter(c => c.y != null).at(-1);
    if (lastValid) {
      fillStr += `L${lastValid.x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;
    }
    svgPath = pathStr;
    svgFill = fillStr;

    if (hoverIdx != null && coords[hoverIdx]?.y != null) {
      hoverData = coords[hoverIdx];
    }

    // Y-axis tick labels
    for (let i = 0; i <= 4; i++) {
      const e = eMin + (eRange * i) / 4;
      yLabels.push({ y: toY(e), label: `${Math.round(e)}` });
    }
    // X-axis tick labels
    const xSteps = Math.min(5, pts.length - 1);
    for (let i = 0; i <= xSteps; i++) {
      xLabels.push({ x: toX((maxD * i) / xSteps), label: formatDist((maxD * i) / xSteps) });
    }
  }

  // ── Stat card helper ──────────────────────────────────────────────
  const statCard = (label, value, color = "#60a5fa") => (
    <div key={label} style={{
      background: "rgba(255,255,255,0.04)",
      border:     "1px solid rgba(255,255,255,0.07)",
      borderRadius: 8, padding: "7px 8px", flex: 1, minWidth: 58,
    }}>
      <div style={{ color:"#475569", fontSize:9, fontWeight:700, letterSpacing:".09em", textTransform:"uppercase", marginBottom:3, fontFamily:fm }}>{label}</div>
      <div style={{ color, fontSize:13, fontWeight:800, fontFamily:fm, lineHeight:1 }}>{value}</div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{
      position:       "absolute",
      bottom:         "var(--stat-h)",
      left:           "var(--sb-w)",
      right:          0,
      height:         panelH,
      zIndex:         1055,
      background:     "rgba(4,10,20,0.97)",
      backdropFilter: "blur(20px)",
      borderTop:      "1.5px solid rgba(74,158,255,0.35)",
      fontFamily:     ff,
      display:        "flex",
      flexDirection:  "column",
      overflow:       "hidden",
    }}>

      {/* Drag-to-resize handle */}
      <div
        onMouseDown={onDragStart}
        style={{ height:6, cursor:"ns-resize", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, background:"rgba(255,255,255,0.02)" }}
      >
        <div style={{ width:40, height:3, borderRadius:2, background:"rgba(255,255,255,0.15)" }}/>
      </div>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 12px 6px", borderBottom:"1px solid rgba(255,255,255,0.06)", flexShrink:0, flexWrap:"wrap" }}>
        <span style={{ fontSize:15 }}>⛰</span>
        <span style={{ color:"#c8e0f8", fontWeight:700, fontSize:13 }}>Elevation Profile</span>

        {sourceLabel ? (
          <span style={{ fontSize:10, color:"#475569", fontFamily:fm }}>{sourceLabel}</span>
        ) : null}

        {!isOnline ? (
          <span style={{ fontSize:9, padding:"2px 7px", borderRadius:10, background:"rgba(251,191,36,0.12)", border:"1px solid rgba(251,191,36,0.3)", color:"#fbbf24" }}>
            OFFLINE — cached data
          </span>
        ) : null}

        {/* Source mode tabs */}
        <div style={{ display:"flex", gap:3, marginLeft:"auto" }}>
          {[["survey","Survey"],["measure","Measure"],["draw","Draw"],["custom","Click"]].map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => onRequestPoints?.(mode)}
              style={{
                padding:"3px 9px", borderRadius:12, border:"none", cursor:"pointer",
                background:   activeMode === mode ? "rgba(74,158,255,0.25)" : "rgba(255,255,255,0.05)",
                color:        activeMode === mode ? "#60a5fa" : "#475569",
                fontSize:10, fontWeight:700, fontFamily:ff,
                borderBottom: activeMode === mode ? "2px solid #3b82f6" : "2px solid transparent",
                transition:   "all .15s",
              }}
            >{label}</button>
          ))}
        </div>

        <button
          onClick={exportCSV}
          disabled={!pts.length}
          title="Export as CSV"
          style={{ padding:"3px 10px", borderRadius:7, border:"1px solid rgba(74,158,255,0.3)", background:"rgba(74,158,255,0.1)", color:"#60a5fa", fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:ff, opacity: pts.length ? 1 : 0.4 }}
        >↓ CSV</button>

        <button
          onClick={onClose}
          style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#94a3b8", borderRadius:6, width:24, height:24, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}
        >×</button>
      </div>

      {/* Body */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", minHeight:0 }}>

        {/* Chart area */}
        <div style={{ flex:1, position:"relative", overflow:"hidden", padding:"4px 6px 0" }}>

          {loading && (
            <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", zIndex:10, background:"rgba(4,10,20,0.6)" }}>
              <span style={{ color:"#60a5fa", fontSize:12, fontFamily:fm }}>⏳ Fetching elevation data…</span>
            </div>
          )}

          {!loading && pts.length < 2 && (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8 }}>
              <span style={{ fontSize:28, opacity:.2 }}>⛰</span>
              <div style={{ color:"#334155", fontSize:11, textAlign:"center", maxWidth:280, lineHeight:1.6 }}>
                {activeMode === "custom"
                  ? "Click points on the map to build an elevation profile"
                  : "Pick a source tab above, or start a Survey / Measure / Draw path"}
              </div>
            </div>
          )}

          {pts.length >= 2 && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chartW} ${chartH}`}
              preserveAspectRatio="none"
              style={{ width:"100%", height:"100%", cursor:"crosshair", display:"block" }}
              onMouseMove={onSvgMove}
              onMouseLeave={() => setHoverIdx(null)}
              onClick={onSvgClick}
              onTouchMove={e => { e.preventDefault(); onSvgMove(e); }}
            >
              <defs>
                <linearGradient id="epFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.45"/>
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.04"/>
                </linearGradient>
                <linearGradient id="epLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="#60a5fa"/>
                  <stop offset="50%"  stopColor="#38bdf8"/>
                  <stop offset="100%" stopColor="#818cf8"/>
                </linearGradient>
              </defs>

              {yLabels.map((yl, i) => (
                <line key={i} x1={PAD.left} y1={yl.y} x2={chartW - PAD.right} y2={yl.y}
                  stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
              ))}

              {svgFill && <path d={svgFill} fill="url(#epFill)"/>}
              {svgPath && <path d={svgPath} fill="none" stroke="url(#epLine)" strokeWidth="2" strokeLinejoin="round"/>}

              {yLabels.map((yl, i) => (
                <text key={i} x={PAD.left - 5} y={yl.y + 4} textAnchor="end"
                  fill="#475569" fontSize="9" fontFamily={fm}>{yl.label}</text>
              ))}
              {xLabels.map((xl, i) => (
                <text key={i} x={xl.x} y={chartH - 4} textAnchor="middle"
                  fill="#334155" fontSize="9" fontFamily={fm}>{xl.label}</text>
              ))}

              <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH}
                stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
              <line x1={PAD.left} y1={PAD.top + innerH} x2={chartW - PAD.right} y2={PAD.top + innerH}
                stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>

              {hoverData && (() => {
                const ttW = 118, ttH = 48;
                const ttX = Math.min(hoverData.x + 8, chartW - ttW - PAD.right);
                const ttY = Math.max(PAD.top + 2, hoverData.y - ttH - 8);
                return (
                  <>
                    <line x1={hoverData.x} y1={PAD.top} x2={hoverData.x} y2={PAD.top + innerH}
                      stroke="rgba(99,202,255,0.4)" strokeWidth="1" strokeDasharray="3 3"/>
                    <circle cx={hoverData.x} cy={hoverData.y} r="5"
                      fill="#38bdf8" stroke="#060e1a" strokeWidth="2"/>
                    <rect x={ttX} y={ttY} width={ttW} height={ttH} rx="5"
                      fill="rgba(4,10,20,0.96)" stroke="rgba(74,158,255,0.4)" strokeWidth="1"/>
                    <text x={ttX+8} y={ttY+16} fill="#38bdf8" fontSize="11" fontFamily={fm} fontWeight="700">
                      {formatElev(hoverData.elevation)}
                    </text>
                    <text x={ttX+8} y={ttY+30} fill="#475569" fontSize="9" fontFamily={fm}>
                      {formatDist(hoverData.distance)} from start
                    </text>
                    <text x={ttX+8} y={ttY+42} fill="#1e293b" fontSize="8" fontFamily={fm}>
                      {hoverData.lat?.toFixed(5)}, {hoverData.lng?.toFixed(5)}
                    </text>
                  </>
                );
              })()}
            </svg>
          )}
        </div>

        {/* Stats panel */}
        <div style={{ width:148, flexShrink:0, borderLeft:"1px solid rgba(255,255,255,0.06)", padding:"8px", display:"flex", flexDirection:"column", gap:5, overflowY:"auto" }}>
          {validPts.length >= 2 ? (
            <>
              {statCard("Min",      formatElev(minElev),        "#38bdf8")}
              {statCard("Max",      formatElev(maxElev),        "#f472b6")}
              {statCard("↑ Gain",   `+${Math.round(gain)} m`,  "#4ade80")}
              {statCard("↓ Loss",   `-${Math.round(loss)} m`,  "#f87171")}
              {statCard("Distance", formatDist(totalDist),      "#a78bfa")}
              {statCard("Slope",    avgSlope,                   "#fbbf24")}
              <div style={{ color:"#1e293b", fontSize:9, fontFamily:fm, marginTop:2, textAlign:"center", lineHeight:1.5 }}>
                {validPts.length} pts ·{" "}
                {pts.length - validPts.length > 0
                  ? <span style={{ color:"#fbbf24" }}>{pts.length - validPts.length} uncached</span>
                  : <span style={{ color:"#22c55e" }}>all cached ✓</span>}
              </div>
            </>
          ) : (
            <div style={{ color:"#1e293b", fontSize:10, textAlign:"center", marginTop:24, fontFamily:fm }}>
              {loading ? "Loading…" : "No data yet"}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}