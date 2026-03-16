/**
 * LiveTrackRecorder.jsx — SurveyMap Pro v4.0
 * ─────────────────────────────────────────────────────────────────────────────
 * AlpineQuest-style compact bottom drawer.
 * - Only takes ~45% screen height so MAP STAYS VISIBLE above it
 * - Minimise button collapses to a tiny floating pill (map fully visible)
 * - Expand to full stats view
 * - Professional dark UI matching AlpineQuest exactly
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useRef, useEffect } from "react";
import {
  useTrackRecorder, formatDuration, formatDist,
} from "./useTrackRecorder.js";

/* ── Theme ───────────────────────────────────────────────────────────────── */
const T = {
  bg:     "rgba(3,7,18,0.97)",
  card:   "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.08)",
  text:   "#e2eeff",
  sub:    "rgba(160,195,240,0.35)",
  green:  "#22c55e",
  red:    "#ef4444",
  amber:  "#f59e0b",
  blue:   "#3b82f6",
  purple: "#8b5cf6",
  cyan:   "#06b6d4",
  teal:   "#14b8a6",
};

/* ── Tiny stat cell ──────────────────────────────────────────────────────── */
function Cell({ label, value, unit, color = T.text, wide = false }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`,
      borderRadius: 10, padding: "8px 10px",
      gridColumn: wide ? "span 2" : "span 1",
      display: "flex", flexDirection: "column", gap: 2,
    }}>
      <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.09em",
        color: "rgba(255,255,255,0.18)", textTransform: "uppercase",
        fontFamily: "'DM Mono',monospace" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color,
          fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>{value ?? "—"}</span>
        {value != null && unit &&
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)" }}>{unit}</span>}
      </div>
    </div>
  );
}

/* ── Export row ─────────────────────────────────────────────────────────── */
function ExportRow({ track, onExport }) {
  const [busy, setBusy] = useState(null);
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
      {[["gpx","GPX","#3b82f6"],["kml","KML","#22c55e"],["kmz","KMZ","#10b981"],
        ["geojson","JSON","#14b8a6"],["csv","CSV","#f59e0b"]].map(([k,lb,c]) => (
        <button key={k} onClick={async () => { setBusy(k); await onExport(track,k); setBusy(null); }}
          disabled={!!busy} style={{
          padding:"5px 11px", borderRadius:8, cursor:"pointer",
          background:`${c}14`, border:`1px solid ${c}40`, color:c,
          fontSize:11, fontWeight:700, fontFamily:"'DM Mono',monospace",
          opacity: busy && busy!==k ? 0.4 : 1,
        }}>{busy===k?"…":lb}</button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════ */
export default function LiveTrackRecorder({
  map: leafletMapProp, leafletMapRef,
  visible, onClose, onRecordingChange,
}) {
  /* ── Map ref normalisation ───────────────────────────────────────────── */
  const internalRef = useRef(null);
  useEffect(() => { internalRef.current = leafletMapProp ?? null; }, [leafletMapProp]);
  const mapRef = leafletMapRef ?? internalRef;

  /* ── Hook ────────────────────────────────────────────────────────────── */
  const {
    isRecording, isPaused, points, stats, savedTracks, trackName, setTrackName,
    startRecording, pauseRecording, resumeRecording, stopRecording,
    exportTrack, removeTrack, toggleTrackVisibility,
  } = useTrackRecorder(mapRef);

  /* ── UI state ────────────────────────────────────────────────────────── */
  const [tab,         setTab]         = useState("record");   // "record" | "saved"
  const [minimised,   setMinimised]   = useState(false);
  const [nameInput,   setNameInput]   = useState("Track");
  const [confirmStop, setConfirmStop] = useState(false);
  const [expandedId,  setExpandedId]  = useState(null);

  useEffect(() => { onRecordingChange?.(isRecording); }, [isRecording]);

  /* ── When recording starts → auto-minimise so map is visible ────────── */
  useEffect(() => {
    if (isRecording && !isPaused) setMinimised(true);
  }, [isRecording]);

  if (!visible) return null;

  /* ── Derived display values ─────────────────────────────────────────── */
  const distKm  = (stats.distance / 1000).toFixed(2);
  const distM   = Math.round(stats.distance);
  const distStr = stats.distance >= 1000 ? `${distKm}` : `${distM}`;
  const distUnit= stats.distance >= 1000 ? "km" : "m";
  const durStr  = formatDuration(Math.floor(stats.duration));
  const spdStr  = ((stats.currentSpeed ?? 0) * 3.6).toFixed(1);
  const avgStr  = ((stats.avgSpeed ?? 0) * 3.6).toFixed(1);
  const maxStr  = ((stats.maxSpeed ?? 0) * 3.6).toFixed(1);
  const eleStr  = stats.currentElevation != null ? Math.round(stats.currentElevation) : null;
  const acc     = stats.currentAccuracy  != null ? Math.round(stats.currentAccuracy)  : null;
  const accClr  = acc == null ? T.sub : acc < 10 ? T.green : acc < 25 ? T.amber : T.red;
  const pts     = points.length;
  const recClr  = isPaused ? T.amber : T.red;

  /* ── Floating minimised pill (map fully visible) ─────────────────────── */
  if (minimised) {
    return (
      <>
        <style>{`@keyframes recpulse{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
        <div
          onClick={() => setMinimised(false)}
          style={{
            position: "fixed",
            bottom: 82, left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2200,
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 20px",
            background: T.bg,
            backdropFilter: "blur(30px)",
            WebkitBackdropFilter: "blur(30px)",
            border: `1.5px solid ${isRecording && !isPaused ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 40,
            boxShadow: isRecording && !isPaused
              ? "0 4px 30px rgba(239,68,68,0.3)"
              : "0 4px 20px rgba(0,0,0,0.5)",
            cursor: "pointer",
            userSelect: "none",
            minWidth: 260,
            justifyContent: "space-between",
          }}
        >
          {/* Left: status dot + name */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{
              width:9, height:9, borderRadius:"50%", background:recClr, flexShrink:0,
              animation: isRecording && !isPaused ? "recpulse 1s infinite" : "none",
              boxShadow: `0 0 8px ${recClr}`,
            }}/>
            <span style={{ fontSize:12, fontWeight:700, color:T.text,
              maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {isRecording ? trackName : "Track Recorder"}
            </span>
            {isPaused && <span style={{ fontSize:9, color:T.amber, fontWeight:700,
              background:"rgba(245,158,11,0.15)", padding:"2px 6px", borderRadius:6,
              border:"1px solid rgba(245,158,11,0.3)" }}>PAUSED</span>}
          </div>

          {/* Right: key stats */}
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:14, fontWeight:800, color:T.blue,
                fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{distStr}</div>
              <div style={{ fontSize:8, color:T.sub }}>{distUnit}</div>
            </div>
            <div style={{ width:1, height:24, background:T.border }}/>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:14, fontWeight:800, color:T.cyan,
                fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{durStr}</div>
              <div style={{ fontSize:8, color:T.sub }}>time</div>
            </div>
            <div style={{ width:1, height:24, background:T.border }}/>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:14, fontWeight:800, color:T.amber,
                fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{spdStr}</div>
              <div style={{ fontSize:8, color:T.sub }}>km/h</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── Full panel ──────────────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        @keyframes recpulse{0%,100%{opacity:1}50%{opacity:.25}}
        @keyframes slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}
        .ltr-scroll::-webkit-scrollbar{width:2px}
        .ltr-scroll::-webkit-scrollbar-thumb{background:rgba(139,92,246,.3);border-radius:2px}
      `}</style>

      {/* ── Backdrop (semi-transparent so map shows through) ── */}
      <div
        onClick={() => setMinimised(true)}
        style={{
          position: "fixed", inset: 0,
          zIndex: 2099,
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      />

      {/* ── Panel — max 50vh so map always visible above ── */}
      <div style={{
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        zIndex: 2100,
        maxHeight: "50vh",
        minHeight: 0,
        background: T.bg,
        backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
        borderTop: `1.5px solid ${isRecording && !isPaused ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: "18px 18px 0 0",
        display: "flex", flexDirection: "column",
        fontFamily: "'DM Sans',sans-serif",
        boxShadow: "0 -8px 50px rgba(0,0,0,0.8)",
        animation: "slideup 0.25s cubic-bezier(.16,1,.3,1)",
        transition: "border-color 0.3s",
      }}>

        {/* ── Drag handle ── */}
        <div style={{ flexShrink:0, paddingTop:10, paddingBottom:2,
          display:"flex", justifyContent:"center" }}>
          <div style={{ width:40, height:4, borderRadius:2,
            background:"rgba(255,255,255,0.16)" }}/>
        </div>

        {/* ── Header ── */}
        <div style={{ flexShrink:0, display:"flex", alignItems:"center",
          padding:"8px 16px 8px", gap:10,
          borderBottom:`1px solid ${T.border}` }}>

          {/* Status indicator */}
          <div style={{ width:34, height:34, borderRadius:10, flexShrink:0,
            background: isRecording
              ? isPaused ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)"
              : "rgba(59,130,246,0.12)",
            border:`1px solid ${isRecording ? isPaused ? "rgba(245,158,11,0.4)" : "rgba(239,68,68,0.4)" : "rgba(59,130,246,0.3)"}`,
            display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke={isRecording ? isPaused ? T.amber : T.red : T.blue} strokeWidth="2">
              {isRecording
                ? isPaused
                  ? <><line x1="6" y1="4" x2="6" y2="20"/><polygon points="10 4 22 12 10 20 10 4"/></>
                  : <rect x="3" y="3" width="18" height="18" rx="3" fill={T.red}/>
                : <><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill={T.blue}/></>}
            </svg>
            {isRecording && !isPaused && (
              <div style={{ position:"absolute", top:4, right:4,
                width:6, height:6, borderRadius:"50%", background:T.red,
                animation:"recpulse 1s infinite", boxShadow:`0 0 5px ${T.red}` }}/>
            )}
          </div>

          {/* Track name (editable) */}
          <div style={{ flex:1, minWidth:0 }}>
            {isRecording
              ? <div style={{ fontSize:13, fontWeight:700, color:T.text,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {trackName}
                </div>
              : <input value={nameInput} onChange={e => setNameInput(e.target.value)}
                  placeholder="Track name…"
                  style={{ width:"100%", background:"transparent", border:"none",
                    borderBottom:`1px solid rgba(59,130,246,0.3)`, color:T.text,
                    fontSize:13, fontWeight:700, outline:"none",
                    fontFamily:"'DM Sans',sans-serif", paddingBottom:2 }}/>
            }
            <div style={{ fontSize:10, color:T.sub, marginTop:2,
              fontFamily:"'DM Mono',monospace" }}>
              {isRecording
                ? isPaused
                  ? `⏸ Paused · ${pts} pts`
                  : `● REC · ${pts} pts · ±${acc ?? "?"}m`
                : savedTracks.length > 0
                  ? `${savedTracks.length} saved track${savedTracks.length!==1?"s":""}`
                  : "AlpineQuest GPS recorder"}
            </div>
          </div>

          {/* Minimise + Close */}
          <div style={{ display:"flex", gap:5, flexShrink:0 }}>
            <button onClick={() => setMinimised(true)} style={{
              width:30, height:30, borderRadius:8, cursor:"pointer",
              background:"rgba(255,255,255,0.04)", border:`1px solid ${T.border}`,
              color:"rgba(255,255,255,0.4)", display:"flex",
              alignItems:"center", justifyContent:"center" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button onClick={onClose} style={{
              width:30, height:30, borderRadius:8, cursor:"pointer",
              background:"rgba(255,255,255,0.04)", border:`1px solid ${T.border}`,
              color:"rgba(255,255,255,0.4)", display:"flex",
              alignItems:"center", justifyContent:"center" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── Tab bar (only show when recording or has saved tracks) ── */}
        {(isRecording || savedTracks.length > 0) && (
          <div style={{ flexShrink:0, display:"flex",
            borderBottom:`1px solid ${T.border}`, padding:"0 16px" }}>
            {[["record","● Record"],["saved",`⊞ Saved (${savedTracks.length})`]].map(([k,lb]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                padding:"8px 14px 7px", background:"transparent", border:"none",
                borderBottom:`2px solid ${tab===k ? (k==="record"?T.red:T.purple) : "transparent"}`,
                color: tab===k ? T.text : T.sub,
                fontSize:11, fontWeight: tab===k ? 700 : 400,
                cursor:"pointer", fontFamily:"'DM Sans',sans-serif",
                transition:"all .15s",
              }}>{lb}</button>
            ))}
          </div>
        )}

        {/* ── Scrollable content ── */}
        <div className="ltr-scroll" style={{ flex:1, overflowY:"auto",
          overflowX:"hidden", padding:"10px 14px 16px" }}>

          {/* ════ RECORD TAB ════ */}
          {tab === "record" && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

              {/* Not yet recording → start form */}
              {!isRecording && (
                <button onClick={() => { startRecording(nameInput.trim()||"Track"); }}
                  style={{
                    padding:"14px 0", borderRadius:14, cursor:"pointer",
                    background:"linear-gradient(135deg,rgba(239,68,68,0.95),rgba(220,38,38,0.9))",
                    border:"1px solid rgba(239,68,68,0.5)", color:"#fff",
                    fontWeight:800, fontSize:15, display:"flex",
                    alignItems:"center", justifyContent:"center", gap:10,
                    boxShadow:"0 4px 24px rgba(239,68,68,0.35)",
                    fontFamily:"'DM Sans',sans-serif",
                  }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="8"/>
                  </svg>
                  Start Recording
                </button>
              )}

              {/* Recording → live stats grid */}
              {isRecording && (
                <>
                  {/* Accuracy bar */}
                  <div style={{ display:"flex", alignItems:"center", gap:8,
                    padding:"7px 12px", borderRadius:10,
                    background: isPaused ? "rgba(245,158,11,0.07)" : "rgba(34,197,94,0.07)",
                    border:`1px solid ${isPaused ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.18)"}` }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", flexShrink:0,
                      background: isPaused ? T.amber : T.green,
                      animation: isPaused ? "none" : "recpulse 1.2s infinite",
                      boxShadow:`0 0 6px ${isPaused ? T.amber : T.green}` }}/>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8"
                      style={{ color: isPaused ? T.amber : T.green, flexShrink:0 }}>
                      <path d="M1.5 8.5a13 13 0 0121 0M5 12a10 10 0 0114 0M8.5 15.5a6 6 0 017 0"/>
                      <circle cx="12" cy="19" r="1" fill="currentColor"/>
                    </svg>
                    <span style={{ fontSize:11, fontWeight:600,
                      color: isPaused ? "#fbbf24" : "#86efac" }}>
                      {isPaused ? "Paused" : "GPS Recording"}
                    </span>
                    {acc != null && (
                      <span style={{ marginLeft:"auto", fontSize:10,
                        color:accClr, fontFamily:"'DM Mono',monospace" }}>±{acc}m</span>
                    )}
                  </div>

                  {/* Stats grid — 3 columns */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                    <Cell label="Distance" value={distStr} unit={distUnit} color={T.blue}/>
                    <Cell label="Duration" value={durStr}               color={T.cyan}/>
                    <Cell label="Speed"    value={spdStr} unit="km/h"   color={T.amber}/>
                    <Cell label="Ascent"   value={`+${Math.round(stats.ascent)}`}  unit="m" color={T.green}/>
                    <Cell label="Descent"  value={`-${Math.round(stats.descent)}`} unit="m" color={T.red}/>
                    <Cell label="Pts"      value={pts}                  color={T.sub}/>
                    {eleStr != null &&
                      <Cell label="Elevation" value={eleStr} unit="m"  color="#34d399"/>}
                    <Cell label="Avg"      value={avgStr}  unit="km/h"  color={T.teal}/>
                    <Cell label="Max"      value={maxStr}  unit="km/h"  color={T.purple}/>
                  </div>
                </>
              )}

              {/* Control buttons */}
              {isRecording && (
                <div style={{ display:"flex", gap:8 }}>
                  {/* Pause / Resume */}
                  <button
                    onClick={isPaused ? resumeRecording : pauseRecording}
                    style={{
                      flex:1, padding:"12px 0", borderRadius:12, cursor:"pointer",
                      background: isPaused
                        ? "rgba(34,197,94,0.14)" : "rgba(245,158,11,0.12)",
                      border:`1px solid ${isPaused ? "rgba(34,197,94,0.4)" : "rgba(245,158,11,0.35)"}`,
                      color: isPaused ? T.green : T.amber,
                      fontWeight:700, fontSize:13, display:"flex",
                      alignItems:"center", justifyContent:"center", gap:7,
                      fontFamily:"'DM Sans',sans-serif",
                    }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.2">
                      {isPaused
                        ? <polygon points="5 3 19 12 5 21 5 3"/>
                        : <><rect x="6" y="4" width="4" height="16"/>
                            <rect x="14" y="4" width="4" height="16"/></>}
                    </svg>
                    {isPaused ? "Resume" : "Pause"}
                  </button>

                  {/* Stop */}
                  <button
                    onClick={() => {
                      if (!confirmStop) { setConfirmStop(true); return; }
                      setConfirmStop(false);
                      stopRecording();
                      setTab("saved");
                    }}
                    style={{
                      flex:1, padding:"12px 0", borderRadius:12, cursor:"pointer",
                      background: confirmStop
                        ? "rgba(239,68,68,0.85)" : "rgba(239,68,68,0.12)",
                      border:"1px solid rgba(239,68,68,0.45)",
                      color: confirmStop ? "#fff" : T.red,
                      fontWeight:700, fontSize:13, display:"flex",
                      alignItems:"center", justifyContent:"center", gap:7,
                      transition:"all .18s", fontFamily:"'DM Sans',sans-serif",
                    }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.2">
                      <rect x="3" y="3" width="18" height="18" rx="3"/>
                    </svg>
                    {confirmStop ? "Confirm Stop" : "Stop"}
                  </button>
                </div>
              )}

              {/* Cancel confirm */}
              {confirmStop && (
                <button onClick={() => setConfirmStop(false)} style={{
                  padding:"9px 0", borderRadius:10, cursor:"pointer",
                  background:"transparent", border:`1px solid ${T.border}`,
                  color:T.sub, fontSize:12, fontFamily:"'DM Sans',sans-serif",
                }}>Cancel</button>
              )}

              {/* Hint when idle */}
              {!isRecording && (
                <div style={{ padding:"10px 14px", background:"rgba(59,130,246,0.05)",
                  border:"1px solid rgba(59,130,246,0.12)", borderRadius:10,
                  fontSize:11, color:"rgba(130,170,220,0.45)", lineHeight:1.6 }}>
                  📍 GPS points · elevation · speed · accuracy<br/>
                  📏 Distance · ascent · descent<br/>
                  💾 Export GPX · KML · KMZ · GeoJSON · CSV
                </div>
              )}
            </div>
          )}

          {/* ════ SAVED TAB ════ */}
          {tab === "saved" && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {savedTracks.length === 0 ? (
                <div style={{ textAlign:"center", padding:"24px 0",
                  color:"rgba(255,255,255,0.18)", fontSize:13 }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>🗺️</div>
                  No saved tracks yet
                </div>
              ) : (
                savedTracks.slice().reverse().map(track => {
                  const isExp = expandedId === track.id;
                  const km2 = (track.stats.distance/1000).toFixed(2);
                  const dur2 = formatDuration(Math.floor(track.stats.duration));
                  return (
                    <div key={track.id} style={{
                      background:T.card,
                      border:`1px solid ${isExp?"rgba(139,92,246,0.3)":T.border}`,
                      borderRadius:12, overflow:"hidden",
                    }}>
                      {/* Track row */}
                      <div onClick={() => setExpandedId(isExp?null:track.id)}
                        style={{ display:"flex", alignItems:"center",
                          gap:10, padding:"10px 12px", cursor:"pointer" }}>
                        <div style={{ width:32, height:32, borderRadius:9, flexShrink:0,
                          background:"rgba(139,92,246,0.15)",
                          border:"1px solid rgba(139,92,246,0.3)",
                          display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke={T.purple} strokeWidth="1.8">
                            <path d="M3 12c0-5 3-9 9-9s9 4 9 9-3 9-9 9"/>
                            <path d="M12 7v5l3 3"/>
                          </svg>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12, fontWeight:700, color:T.text,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {track.name}
                          </div>
                          <div style={{ fontSize:9.5, color:T.sub,
                            fontFamily:"'DM Mono',monospace", marginTop:1 }}>
                            {km2} km · {dur2} · {track.points.length} pts
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:4, flexShrink:0 }}
                          onClick={e => e.stopPropagation()}>
                          <button onClick={() => toggleTrackVisibility(track.id)} style={{
                            width:26,height:26,borderRadius:7,cursor:"pointer",
                            background:track.hidden?"rgba(255,255,255,0.04)":"rgba(139,92,246,0.12)",
                            border:`1px solid ${track.hidden?T.border:"rgba(139,92,246,0.3)"}`,
                            color:track.hidden?T.sub:T.purple,
                            display:"flex",alignItems:"center",justifyContent:"center" }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                              stroke="currentColor" strokeWidth="1.8">
                              {track.hidden
                                ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                                : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                            </svg>
                          </button>
                          <button onClick={() => removeTrack(track.id)} style={{
                            width:26,height:26,borderRadius:7,cursor:"pointer",
                            background:"rgba(239,68,68,0.08)",
                            border:"1px solid rgba(239,68,68,0.2)",
                            color:"rgba(239,68,68,0.5)",
                            display:"flex",alignItems:"center",justifyContent:"center" }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                              stroke="currentColor" strokeWidth="1.8">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExp && (
                        <div style={{ padding:"0 12px 12px",
                          borderTop:`1px solid ${T.border}` }}>
                          <div style={{ display:"grid",
                            gridTemplateColumns:"1fr 1fr 1fr", gap:5, marginTop:10 }}>
                            {[
                              ["Distance", km2, "km", T.blue],
                              ["Duration", dur2, "",  T.cyan],
                              ["Points", track.points.length, "", T.sub],
                              ["Ascent", `+${Math.round(track.stats.ascent||0)}`, "m", T.green],
                              ["Descent",`-${Math.round(track.stats.descent||0)}`,"m", T.red],
                              ["Max Spd",((track.stats.maxSpeed||0)*3.6).toFixed(1),"km/h",T.purple],
                            ].map(([lb,val,u,c])=>(
                              <Cell key={lb} label={lb} value={val} unit={u} color={c}/>
                            ))}
                          </div>
                          <div style={{ fontSize:9, fontWeight:700, color:T.sub,
                            letterSpacing:"0.1em", textTransform:"uppercase",
                            fontFamily:"'DM Mono',monospace", marginTop:12, marginBottom:4 }}>
                            Export
                          </div>
                          <ExportRow track={track} onExport={exportTrack}/>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}