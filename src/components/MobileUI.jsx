// ─── MobileUI.jsx — Mobile-specific UI: search bar, bottom nav, HUD ──────────
import React, { useState } from "react";
import { bearingLabel, toDMS, zoomToAltitude } from "../utils/mapUtils.js";

/* ── Mobile Search Bar ───────────────────────────────────────────────────────── */
export function MobileSearchBar({ searchQuery, setSearchQuery, onSearch, searchLoading }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:1330, height:58,
      background:"rgba(5,9,19,0.97)", backdropFilter:"blur(32px) saturate(180%)",
      WebkitBackdropFilter:"blur(32px) saturate(180%)",
      borderBottom:"1px solid rgba(255,255,255,0.055)",
      display:"flex", alignItems:"center", padding:"0 12px", gap:10 }}>

      {/* App icon */}
      <div style={{ width:36, height:36, borderRadius:11, flexShrink:0,
        background:"linear-gradient(145deg,#1a3a8a 0%,#2563eb 60%,#1d4ed8 100%)",
        display:"flex", alignItems:"center", justifyContent:"center",
        boxShadow:"0 3px 16px rgba(37,99,235,0.45), inset 0 1px 0 rgba(255,255,255,0.15)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="white" stroke="none"/>
        </svg>
      </div>

      {/* Search input */}
      <div style={{ flex:1, position:"relative", height:38,
        background: focused ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.055)",
        borderRadius:13,
        border:`1px solid ${focused ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.09)"}`,
        transition:"all 0.2s", display:"flex", alignItems:"center",
        boxShadow: focused ? "0 0 0 3px rgba(59,130,246,0.1)" : "none" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2"
          style={{ position:"absolute", left:11, pointerEvents:"none" }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSearch()}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder="Search places, coordinates…"
          style={{ width:"100%", height:"100%", padding:"0 36px 0 34px", background:"none",
            border:"none", outline:"none", color:"#d8eaff", fontSize:14,
            fontFamily:"'DM Sans',sans-serif", caretColor:"#60a5fa" }}/>
        {searchQuery && (
          <button onClick={() => setSearchQuery("")}
            style={{ position:"absolute", right:9, background:"none", border:"none",
              cursor:"pointer", color:"rgba(255,255,255,0.28)", padding:2, display:"flex", alignItems:"center" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Search button */}
      <button onClick={onSearch} disabled={searchLoading} style={{
        width:38, height:38, borderRadius:12, flexShrink:0,
        background: searchLoading ? "rgba(59,130,246,0.18)" : "rgba(37,99,235,0.95)",
        border:"none", cursor: searchLoading ? "not-allowed" : "pointer",
        display:"flex", alignItems:"center", justifyContent:"center",
        boxShadow: searchLoading ? "none" : "0 3px 14px rgba(37,99,235,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
        transition:"all 0.2s" }}>
        {searchLoading
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.7)" strokeWidth="2.5" style={{ animation:"spin 0.8s linear infinite" }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
      </button>
    </div>
  );
}

/* ── Mobile Bottom Navigation Bar ───────────────────────────────────────────── */
export function MobileBottomNav({ onOpen, onCompassToggle, compassNavActive, drawMode, measureMode, surveyMode, isTracking, activeSheet }) {
  const tabs = [
    { key:"layers",      label:"Layers",  active: activeSheet === "layers",                color:"#3b82f6",
      icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> },
    { key:"draw",        label:"Draw",    active: drawMode || activeSheet === "draw",      color:"#f59e0b",
      icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> },
    { key:"measure",     label:"Measure", active: measureMode || activeSheet === "measure",color:"#10b981",
      icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M21 6H3a1 1 0 00-1 1v3a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zM7 10v4M12 10v6M17 10v4"/></svg> },
    { key:"__compass__", label:"Compass", active: compassNavActive,                        color:"#0ea5e9",
      icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg> },
    { key:"more",        label:"More",    active: activeSheet === "more",                  color:"#8b5cf6",
      icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg> },
  ];

  return (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:1200, height:76,
      background:"rgba(4,8,18,0.98)", backdropFilter:"blur(40px) saturate(200%)",
      WebkitBackdropFilter:"blur(40px) saturate(200%)",
      borderTop:"1px solid rgba(255,255,255,0.055)",
      display:"flex", alignItems:"stretch",
      paddingBottom:"env(safe-area-inset-bottom, 0px)" }}>
      {tabs.map(({ key, label, active, color, icon }) => {
        const isCompass = key === "__compass__";
        return (
          <button key={key}
            onClick={() => isCompass ? onCompassToggle() : onOpen(key)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", gap:3, background:"none", border:"none",
              cursor:"pointer", padding:"6px 0 10px", position:"relative",
              WebkitTapHighlightColor:"transparent" }}>
            {active && <div style={{ position:"absolute", top:0, left:"30%", right:"30%", height:2.5,
              background:`linear-gradient(90deg,transparent,${color},transparent)`,
              borderRadius:"0 0 3px 3px", boxShadow:`0 0 8px ${color}` }}/>}
            <div style={{ width:42, height:36, display:"flex", alignItems:"center", justifyContent:"center",
              borderRadius:12, position:"relative",
              background: active ? `${color}18` : "transparent", transition:"background 0.2s" }}>
              <div style={{ width:22, height:22, color: active ? color : "rgba(160,190,230,0.4)",
                transition:"color 0.2s",
                animation: isCompass && active ? "spin 4s linear infinite" : "none" }}>
                {icon}
              </div>
              {isCompass && active && <div style={{ position:"absolute", top:4, right:4,
                width:7, height:7, borderRadius:"50%", background:"#0ea5e9",
                boxShadow:"0 0 10px #0ea5e9", animation:"blink 0.8s infinite" }}/>}
            </div>
            <span style={{ fontSize:10, fontWeight: active ? 700 : 500,
              color: active ? color : "rgba(140,168,210,0.36)",
              letterSpacing:"0.02em", fontFamily:"'DM Sans',sans-serif",
              transition:"color 0.2s" }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Compact Mobile HUD — 3 slim info strips below search bar ───────────────── */
export function CompactMobileHUD({ mousePos, mapZoom, compassHeading, compassNavActive, cursorElevation }) {
  const hasPos  = mousePos && !isNaN(mousePos.lat) && !isNaN(mousePos.lng);
  const heading = (((compassHeading ?? 0) % 360) + 360) % 360;
  const altM    = cursorElevation != null ? Math.round(cursorElevation) : null;
  const sats = 13, totalSats = 16, accM = 5, speed = "0.0";

  const scaleM     = Math.round(zoomToAltitude(mapZoom) / 40);
  const scaleLabel = scaleM >= 1000 ? `${Math.round(scaleM/100)/10} km` : `${scaleM} m`;
  const scaleRatio = `1:${(Math.round(zoomToAltitude(mapZoom)/1000)*1000).toLocaleString()}`;

  const card = { background:"rgba(8,14,28,0.96)", backdropFilter:"blur(28px) saturate(180%)", WebkitBackdropFilter:"blur(28px) saturate(180%)" };
  const mono = { fontFamily:"'DM Mono',monospace" };
  const sans = { fontFamily:"'DM Sans',sans-serif" };

  return (
    <div style={{ position:"relative", top:0, left:0, right:0, zIndex:1320, pointerEvents:"none" }}>
      <div style={{ ...card, padding:"7px 12px 0", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
        {/* Coordinates row */}
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:4 }}>
          <div>
            <div style={{ ...mono, fontSize:17, fontWeight:700, color:"#ffffff", letterSpacing:"0.015em", lineHeight:1.25 }}>
              {hasPos ? toDMS(mousePos.lat,"N","S") : "—°——′——.——″  N"}
            </div>
            <div style={{ ...mono, fontSize:15, fontWeight:500, color:"rgba(200,225,255,0.72)", letterSpacing:"0.015em", lineHeight:1.25 }}>
              {hasPos ? toDMS(mousePos.lng,"E","W") : "—°——′——.——″  E"}
            </div>
          </div>
          {/* Scale + sats */}
          <div style={{ ...sans, fontSize:11, color:"rgba(200,220,255,0.65)", textAlign:"right", lineHeight:1.55, flexShrink:0, paddingTop:1 }}>
            <div style={{ fontWeight:600, color:"rgba(220,235,255,0.85)" }}>{scaleRatio}&nbsp;&nbsp;{sats}/{totalSats}</div>
            <div style={{ display:"flex", alignItems:"center", gap:4, justifyContent:"flex-end", marginTop:2 }}>
              <div style={{ position:"relative", width:48, height:8 }}>
                <div style={{ position:"absolute", top:3, left:0, right:0, height:2, background:"rgba(200,225,255,0.5)" }}/>
                <div style={{ position:"absolute", top:1, left:0, width:2, height:6, background:"rgba(200,225,255,0.5)" }}/>
                <div style={{ position:"absolute", top:1, right:0, width:2, height:6, background:"rgba(200,225,255,0.5)" }}/>
              </div>
              <span style={{ fontSize:10 }}>{scaleLabel}</span>
            </div>
          </div>
        </div>
        {/* GNSS row */}
        <div style={{ display:"flex", alignItems:"center", paddingBottom:5,
          borderBottom:"1px solid rgba(255,255,255,0.06)", flexWrap:"wrap", rowGap:2 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ marginRight:5, flexShrink:0 }}>
            <path d="M1 6C3.5 3.5 6.5 2 12 2s8.5 1.5 11 4" stroke={compassNavActive?"#4ade80":"#38bdf8"} strokeWidth="2" strokeLinecap="round"/>
            <path d="M4 9.5C6 7.5 8.5 6.5 12 6.5s6 1 8 3" stroke={compassNavActive?"#4ade80":"#38bdf8"} strokeWidth="2" strokeLinecap="round"/>
            <path d="M7 13c1.5-1.5 3-2 5-2s3.5.5 5 2" stroke={compassNavActive?"#4ade80":"#38bdf8"} strokeWidth="2" strokeLinecap="round"/>
            <circle cx="12" cy="17" r="2" fill={compassNavActive?"#4ade80":"#38bdf8"}/>
          </svg>
          <span style={{ ...sans, fontSize:11, color:"rgba(220,235,255,0.82)", fontWeight:500, marginRight:6 }}>Outdoor GPS/GNSS ({sats}/{totalSats} sats)</span>
          <span style={{ ...sans, fontSize:11, color:"rgba(180,210,255,0.55)" }}>±{accM} m&nbsp;&nbsp;</span>
          <span style={{ ...sans, fontSize:11, color:"rgba(180,210,255,0.55)" }}>{altM != null ? `↑${altM} m` : "↑ — m"}&nbsp;&nbsp;</span>
          <span style={{ ...sans, fontSize:11, color:"rgba(180,210,255,0.55)" }}>{speed} km/h</span>
        </div>
        {/* Heading row */}
        <div style={{ display:"flex", alignItems:"center", paddingTop:4, paddingBottom:5 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            style={{ marginRight:6, flexShrink:0, transform:`rotate(${heading}deg)`, transition:"transform 0.2s linear" }}>
            <path d="M12 2L4.5 20.5l7.5-4 7.5 4L12 2z" fill={compassNavActive?"#4ade80":"#38bdf8"} fillOpacity="0.9"/>
          </svg>
          <span style={{ ...mono, fontSize:13, fontWeight:600, color: compassNavActive?"#4ade80":"#e0f0ff" }}>
            {heading.toFixed(1)}°&nbsp;{bearingLabel(heading)}
          </span>
          <div style={{ marginLeft:"auto", width:7, height:7, borderRadius:"50%",
            background: compassNavActive?"#22c55e":"#3b82f6",
            boxShadow:  compassNavActive?"0 0 7px #22c55e":"0 0 7px #3b82f6" }}/>
        </div>
      </div>
    </div>
  );
}