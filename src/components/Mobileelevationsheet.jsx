/**
 * MobileElevationSheet.jsx  --  src/components/MobileElevationSheet.jsx
 * -----------------------------------------------------------------------------
 * AlpineQuest-style elevation profile for mobile.
 *
 * Features:
 *  ✅ Live chart -- SVG polyline + gradient fill, auto-scales
 *  ✅ Touch-scrub -- drag finger along chart to see elevation at any point
 *  ✅ Mode picker -- Survey / Measure / Draw / Custom (tap map points)
 *  ✅ Stats row -- Min, Max, Start, End, Total Gain, Total Loss
 *  ✅ Distance axis labels
 *  ✅ Loading spinner while fetching
 *  ✅ Empty state per mode
 *  ✅ Custom mode: shows tap-to-add instructions; each tap adds a point
 *  ✅ Clear / Reset button for custom mode
 *
 * -- Wiring in SurveyMap.jsx --------------------------------------------------
 *
 * 1. IMPORT:
 *      import MobileElevationSheet from "../components/MobileElevationSheet.jsx";
 *
 * 2. Fix ElevationClickCapture so it fires on mobile sheet too.
 *    Change the existing line:
 *      <ElevationClickCapture elevOpen={elevOpen} activeSheet={activeSheet} elevMode={elevMode} onMapClick={handleMapClickForElev}/>
 *    To:
 *      <ElevationClickCapture
 *        elevOpen={elevOpen || activeSheet === "elevation"}
 *        activeSheet={activeSheet}
 *        elevMode={elevMode}
 *        onMapClick={handleMapClickForElev}
 *      />
 *
 * 3. In the handleMenuAction "openElevation" handler, change:
 *      if (isMobile) { handleElevModeRequest(elevMode || "survey"); setActiveSheet("elevation"); }
 *    To:
 *      if (isMobile) { setActiveSheet("elevation"); if (elevMode) handleElevModeRequest(elevMode); }
 *
 * 4. Inside <MobileBottomSheet>, replace the existing elevation block with:
 *      {activeSheet === "elevation" && (
 *        <MobileElevationSheet
 *          elevMode={elevMode}
 *          elevProfileData={elevProfileData}
 *          elevLoading={elevLoading}
 *          elevSourceLabel={elevSourceLabel}
 *          customElevPts={customElevPts}
 *          route={route}
 *          measurePoints={measurePoints}
 *          drawPoints={drawPoints}
 *          onModeRequest={(mode) => {
 *            setElevMode(mode);
 *            handleElevModeRequest(mode);
 *          }}
 *          onClearCustom={() => {
 *            setCustomElevPts([]);
 *            setElevProfileData([]);
 *            setElevSourceLabel("");
 *          }}
 *          onClose={() => setActiveSheet(null)}
 *        />
 *      )}
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { SheetHeader, SheetDivider } from "./UIComponents.jsx";

/* --- Colour palette ------------------------------------------------------- */
const C = {
  blue:   "#38bdf8",
  green:  "#4ade80",
  red:    "#f87171",
  amber:  "#fbbf24",
  purple: "#c084fc",
  teal:   "#2dd4bf",
  sub:    "rgba(160,195,240,0.32)",
  card:   "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.07)",
};

/* --- Helpers --------------------------------------------------------------- */
function fmtDist(m) {
  if (m == null || isNaN(m)) return "--";
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function haversineM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

/* --- Stat card ------------------------------------------------------------ */
function Stat({ label, value, color = C.blue, unit = "" }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "7px 8px", minWidth: 0,
    }}>
      <div style={{
        fontSize: 8, fontWeight: 700, letterSpacing: "0.09em",
        color: "rgba(255,255,255,0.18)", textTransform: "uppercase",
        fontFamily: "'DM Mono',monospace", marginBottom: 3,
      }}>{label}</div>
      <div style={{
        fontSize: 14, fontWeight: 800, color,
        fontFamily: "'DM Mono',monospace", lineHeight: 1,
        whiteSpace: "nowrap",
      }}>
        {value ?? "--"}
        {value != null && unit && (
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", marginLeft: 2 }}>{unit}</span>
        )}
      </div>
    </div>
  );
}

/* --- Chart ---------------------------------------------------------------- */
function ElevChart({ data, loading }) {
  const svgRef    = useRef(null);
  const [cursor,  setCursor]  = useState(null); // { x, y, elev, dist, idx }
  const [hovering,setHovering]= useState(false);

  const W = 340, H = 130, PL = 38, PR = 12, PT = 14, PB = 28;
  const CW = W - PL - PR, CH = H - PT - PB;

  const elevs = data.map(p => p.elevation ?? 0);
  const minE  = elevs.length ? Math.min(...elevs) : 0;
  const maxE  = elevs.length ? Math.max(...elevs) : 100;
  const rangeE = Math.max(maxE - minE, 10);

  // Build cumulative distances
  const dists = data.map((p, i) => {
    if (i === 0) return 0;
    return data.slice(0, i).reduce((acc, _, j) => {
      if (j === 0) return 0;
      return acc + haversineM(
        { lat: data[j-1].lat, lng: data[j-1].lng },
        { lat: data[j].lat,   lng: data[j].lng }
      );
    }, 0) + haversineM(
      { lat: data[i-1].lat, lng: data[i-1].lng },
      { lat: data[i].lat,   lng: data[i].lng }
    );
  });
  const totalDist = dists[dists.length - 1] || 1;

  // Map to SVG coords
  const pts = data.map((p, i) => ({
    x: PL + (dists[i] / totalDist) * CW,
    y: PT + (1 - (elevs[i] - minE) / rangeE) * CH,
    elev: elevs[i],
    dist: dists[i],
  }));

  const polyStr  = pts.map(p => `${p.x},${p.y}`).join(" ");
  const fillStr  = `${PL},${PT+CH} ` + pts.map(p=>`${p.x},${p.y}`).join(" ") + ` ${pts[pts.length-1]?.x||PL},${PT+CH}`;

  // Y-axis labels (3 ticks)
  const yTicks = [0, 0.5, 1].map(f => ({
    y:  PT + (1 - f) * CH,
    v:  Math.round(minE + f * rangeE),
  }));

  // X-axis labels
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    x: PL + f * CW,
    v: fmtDist(f * totalDist),
  }));

  // Touch/mouse scrub
  const handleMove = useCallback((clientX) => {
    const svg = svgRef.current;
    if (!svg || pts.length < 2) return;
    const rect   = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const relX   = (clientX - rect.left) * scaleX;
    const svgX   = Math.max(PL, Math.min(PL + CW, relX));
    // Find nearest point
    let nearest = 0, minDx = Infinity;
    pts.forEach((p, i) => {
      const dx = Math.abs(p.x - svgX);
      if (dx < minDx) { minDx = dx; nearest = i; }
    });
    const p = pts[nearest];
    setCursor({ x: p.x, y: p.y, elev: p.elev, dist: p.dist, idx: nearest });
  }, [pts]);

  if (loading) {
    return (
      <div style={{
        height: 130, display: "flex", alignItems: "center", justifyContent: "center",
        background: C.card, borderRadius: 14, border: `1px solid ${C.border}`,
        color: C.blue, fontSize: 12, gap: 8,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          style={{ animation: "spin 0.9s linear infinite" }}>
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
        </svg>
        Fetching elevation data...
      </div>
    );
  }

  if (!data.length) return null;

  return (
    <div style={{ position: "relative", userSelect: "none" }}>
      <svg
        ref={svgRef}
        viewBox={"0 0 " + W + " " + H}
        style={{ width: "100%", height: 130, display: "block",
          borderRadius: 14, background: "rgba(255,255,255,0.025)",
          border: `1px solid ${C.border}`, touchAction: "none" }}
        onMouseMove={e => { setHovering(true); handleMove(e.clientX); }}
        onMouseLeave={() => { setHovering(false); setCursor(null); }}
        onTouchStart={e => { setHovering(true); handleMove(e.touches[0].clientX); }}
        onTouchMove={e => { e.preventDefault(); handleMove(e.touches[0].clientX); }}
        onTouchEnd={() => { setHovering(false); setCursor(null); }}
      >
        <defs>
          <linearGradient id="egFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={C.blue} stopOpacity="0.30"/>
            <stop offset="100%" stopColor={C.blue} stopOpacity="0.02"/>
          </linearGradient>
          <clipPath id="egClip">
            <rect x={PL} y={PT} width={CW} height={CH}/>
          </clipPath>
        </defs>

        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <line key={i} x1={PL} y1={t.y} x2={PL+CW} y2={t.y}
            stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        ))}

        {/* Fill */}
        <polygon points={fillStr} fill="url(#egFill)" clipPath="url(#egClip)"/>

        {/* Line */}
        <polyline points={polyStr} fill="none" stroke={C.blue}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          clipPath="url(#egClip)"/>

        {/* Y-axis labels */}
        {yTicks.map((t, i) => (
          <text key={i} x={PL-4} y={t.y+3} fontSize="7" fill="rgba(255,255,255,0.25)"
            textAnchor="end" fontFamily="DM Mono,monospace">{t.v}m</text>
        ))}

        {/* X-axis labels */}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H-6} fontSize="7" fill="rgba(255,255,255,0.2)"
            textAnchor="middle" fontFamily="DM Mono,monospace">{t.v}</text>
        ))}

        {/* Cursor scrubber */}
        {hovering && cursor && (
          <>
            <line x1={cursor.x} y1={PT} x2={cursor.x} y2={PT+CH}
              stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3,3"/>
            <circle cx={cursor.x} cy={cursor.y} r="4"
              fill={C.blue} stroke="#fff" strokeWidth="1.5"/>
            {/* Tooltip bubble */}
            {(() => {
              const bw = 64, bh = 26;
              const bx = Math.min(Math.max(cursor.x - bw/2, PL), PL+CW-bw);
              const by = cursor.y - bh - 6 < PT ? cursor.y + 8 : cursor.y - bh - 6;
              return (
                <g>
                  <rect x={bx} y={by} width={bw} height={bh} rx="5"
                    fill="rgba(8,14,28,0.95)" stroke={C.blue} strokeWidth="1"/>
                  <text x={bx+bw/2} y={by+10} fontSize="8.5" fill={C.blue}
                    textAnchor="middle" fontFamily="DM Mono,monospace" fontWeight="800">
                    {Math.round(cursor.elev)} m
                  </text>
                  <text x={bx+bw/2} y={by+21} fontSize="7" fill="rgba(255,255,255,0.35)"
                    textAnchor="middle" fontFamily="DM Mono,monospace">
                    {fmtDist(cursor.dist)}
                  </text>
                </g>
              );
            })()}
          </>
        )}
      </svg>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN EXPORT
══════════════════════════════════════════════════════════════════════════ */
export default function MobileElevationSheet({
  elevMode,
  elevProfileData = [],
  elevLoading,
  elevSourceLabel,
  customElevPts = [],
  route = [],
  measurePoints = [],
  drawPoints = [],
  onModeRequest,
  onClearCustom,
  onClose,
}) {
  /* --- Derived stats ----------------------------------------------------- */
  const stats = React.useMemo(() => {
    if (!elevProfileData.length) return null;
    const elevs = elevProfileData.map(p => p.elevation ?? 0);
    const minE   = Math.min(...elevs);
    const maxE   = Math.max(...elevs);
    const startE = elevs[0];
    const endE   = elevs[elevs.length - 1];
    let gain = 0, loss = 0;
    for (let i = 1; i < elevs.length; i++) {
      const d = elevs[i] - elevs[i-1];
      if (d > 0) gain += d; else loss += Math.abs(d);
    }
    return {
      min:   Math.round(minE),
      max:   Math.round(maxE),
      start: Math.round(startE),
      end:   Math.round(endE),
      gain:  Math.round(gain),
      loss:  Math.round(loss),
      range: Math.round(maxE - minE),
    };
  }, [elevProfileData]);

  /* --- Mode availability -------------------------------------------------- */
  const modes = [
    { key:"survey",  label:"Survey",  icon:"⛳", available: route.length >= 2,         count: route.length },
    { key:"measure", label:"Measure", icon:"[?]", available: measurePoints.length >= 2, count: measurePoints.length },
    { key:"draw",    label:"Draw",    icon:"✏️",  available: drawPoints.length >= 2,    count: drawPoints.length },
    { key:"custom",  label:"Custom",  icon:"[?]", available: true,                       count: customElevPts.length },
  ];

  return (
    <>
      {/* Header */}
      <SheetHeader
        title="Elevation Profile"
        sub={elevLoading
          ? "Loading elevation data..."
          : stats
            ? `${stats.min}m – ${stats.max}m . +${stats.gain}m gain`
            : elevSourceLabel || "AlpineQuest-style profile"}
        onClose={onClose}
        iconColor="#38bdf8"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 18l4-9 4 5 4-7 4 11"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        }
      />
      <SheetDivider/>

      <div style={{ padding: "10px 16px 28px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* -- Mode picker -- */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
          {modes.map(m => {
            const on = elevMode === m.key;
            return (
              <button key={m.key}
                onClick={() => m.available && onModeRequest(m.key)}
                style={{
                  padding: "10px 4px",
                  borderRadius: 11, cursor: m.available ? "pointer" : "not-allowed",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  background: on ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.035)",
                  border: `1.5px solid ${on ? "rgba(56,189,248,0.5)" : "rgba(255,255,255,0.07)"}`,
                  opacity: m.available ? 1 : 0.35,
                  transition: "all 0.18s",
                }}>
                <span style={{ fontSize: 16 }}>{m.icon}</span>
                <span style={{
                  fontSize: 10, fontWeight: on ? 700 : 500,
                  color: on ? "#38bdf8" : "rgba(185,215,245,0.45)",
                  fontFamily: "'DM Sans',sans-serif",
                }}>{m.label}</span>
                {m.key !== "custom" && m.count > 0 && (
                  <span style={{
                    fontSize: 8, color: on ? "#7dd3fc" : "rgba(255,255,255,0.2)",
                    fontFamily: "'DM Mono',monospace",
                  }}>{m.count} pts</span>
                )}
                {m.key === "custom" && m.count > 0 && (
                  <span style={{
                    fontSize: 8, color: on ? "#7dd3fc" : "rgba(255,255,255,0.2)",
                    fontFamily: "'DM Mono',monospace",
                  }}>{m.count} pts</span>
                )}
              </button>
            );
          })}
        </div>

        {/* -- Custom mode instruction -- */}
        {elevMode === "custom" && (
          <div style={{
            padding: "10px 14px",
            background: "rgba(56,189,248,0.07)",
            border: "1px solid rgba(56,189,248,0.2)",
            borderRadius: 11, display: "flex",
            alignItems: "center", justifyContent: "space-between", gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 12, color: "#7dd3fc", fontWeight: 600 }}>
                [?] Tap map to add points
              </div>
              <div style={{ fontSize: 10, color: "rgba(56,189,248,0.45)", marginTop: 2 }}>
                {customElevPts.length === 0
                  ? "Tap at least 2 points on the map"
                  : `${customElevPts.length} point${customElevPts.length!==1?"s":""} added`}
              </div>
            </div>
            {customElevPts.length > 0 && (
              <button onClick={onClearCustom} style={{
                padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                color: "#f87171", fontSize: 10, fontWeight: 700,
                fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap",
              }}>Clear</button>
            )}
          </div>
        )}

        {/* -- Loading -- */}
        {elevLoading && (
          <div style={{
            height: 130, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: C.card, borderRadius: 14, border: `1px solid ${C.border}`,
            gap: 8,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke={C.blue} strokeWidth="2.5"
              style={{ animation: "spin 0.9s linear infinite" }}>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
            </svg>
            <span style={{ fontSize: 12, color: C.blue }}>Fetching elevation data...</span>
            <span style={{ fontSize: 10, color: C.sub }}>Open-Elevation API</span>
          </div>
        )}

        {/* -- Chart -- */}
        {!elevLoading && elevProfileData.length >= 2 && (
          <ElevChart data={elevProfileData} loading={false}/>
        )}

        {/* -- Stats grid -- */}
        {!elevLoading && stats && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <Stat label="Min Elev"   value={(stats.min)}   unit="m" color={C.blue}/>
            <Stat label="Max Elev"   value={(stats.max)}   unit="m" color={C.red}/>
            <Stat label="Range"      value={(stats.range)} unit="m" color={C.amber}/>
            <Stat label="Start Elev" value={(stats.start)} unit="m" color={C.teal}/>
            <Stat label="End Elev"   value={(stats.end)}   unit="m" color={C.purple}/>
            <Stat label="↑ Gain"     value={"+" + (stats.gain)} unit="m" color={C.green}/>
          </div>
        )}

        {/* -- Profile points count -- */}
        {!elevLoading && elevProfileData.length >= 2 && (
          <div style={{
            padding: "7px 12px", borderRadius: 9,
            background: "rgba(56,189,248,0.04)",
            border: "1px solid rgba(56,189,248,0.1)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 10, color: C.sub, fontFamily: "'DM Mono',monospace" }}>
              {elevProfileData.length} elevation points
            </span>
            <span style={{ fontSize: 10, color: C.sub, fontFamily: "'DM Mono',monospace" }}>
              {elevSourceLabel}
            </span>
          </div>
        )}

        {/* -- Empty state -- */}
        {!elevLoading && elevProfileData.length < 2 && (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", gap: 10, padding: "24px 16px",
            background: C.card, borderRadius: 14, border: `1px solid ${C.border}`,
          }}>
            <span style={{ fontSize: 36 }}>[Mtn]️</span>
            <div style={{
              color: "rgba(255,255,255,0.28)", fontSize: 13,
              fontFamily: "'DM Sans',sans-serif", textAlign: "center", lineHeight: 1.65,
            }}>
              {!elevMode
                ? "Select a mode above to view elevation data"
                : elevMode === "survey"  && route.length < 2
                  ? "Record a survey route first (tap Survey in toolbar)"
                  : elevMode === "measure" && measurePoints.length < 2
                    ? "Add measure points first (tap Measure in bottom nav)"
                    : elevMode === "draw" && drawPoints.length < 2
                      ? "Draw a path first (tap Draw in bottom nav)"
                      : elevMode === "custom"
                        ? "Tap points on the map above"
                        : "Tap a mode button above to load elevation"}
            </div>
            {/* Quick action hints */}
            {elevMode !== "custom" && (
              <button onClick={() => onModeRequest("custom")} style={{
                padding: "8px 20px", borderRadius: 10, cursor: "pointer",
                background: "rgba(56,189,248,0.1)",
                border: "1px dashed rgba(56,189,248,0.3)",
                color: C.blue, fontSize: 12, fontWeight: 600,
                fontFamily: "'DM Sans',sans-serif",
              }}>
                Try Custom mode →
              </button>
            )}
          </div>
        )}

      </div>
    </>
  );
}