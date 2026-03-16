// ─── CompassControls.jsx — Desktop compass + Mobile AlpineQuest compass ──────
import React, { useState, useRef, useCallback, useEffect } from "react";
import { useMap } from "react-leaflet";
import { bearingLabel } from "../utils/mapUtils.js";

/* ════════════════════════════════════════════════════════════════════
   DESKTOP PROFESSIONAL COMPASS CONTROL
   Drag the rose ring to rotate the map. Click centre to reset North.
════════════════════════════════════════════════════════════════════ */
export function ProfessionalCompassControl({ onBearingChange, compassNavActive, compassHeading, onCompassToggle }) {
  const map = useMap();
  const [bearing, setBearing]   = useState(0);
  const [hov, setHov]           = useState({});
  const [rotating, setRotating] = useState(false);
  const rotRef  = useRef(null);
  const roseRef = useRef(null);
  const PAN     = 180;

  const updateBearing = useCallback((norm) => { setBearing(norm); onBearingChange?.(norm); }, [onBearingChange]);

  useEffect(() => {
    const sync = () => { const b = map.getBearing?.() ?? 0; updateBearing(((b % 360) + 360) % 360); };
    sync();
    map.on("rotate moveend zoomend", sync);
    return () => map.off("rotate moveend zoomend", sync);
  }, [map, updateBearing]);

  useEffect(() => {
    const container = map.getContainer();
    let active = false, startX = 0, startBearing = 0;
    const applyBearing = (nb) => {
      const norm = ((nb % 360) + 360) % 360;
      if (map.setBearing) { map.setBearing(norm); }
      else { const p = map.getPanes().mapPane; const sz = map.getSize(); p.style.transformOrigin = `${sz.x/2}px ${sz.y/2}px`; p.style.transform = `rotate(${norm}deg)`; }
      updateBearing(norm);
    };
    const onMouseDown   = (e) => { if (e.button !== 2) return; e.preventDefault(); active = true; startX = e.clientX; startBearing = map.getBearing?.() ?? bearing; map.dragging.disable(); };
    const onMouseMove   = (e) => { if (!active) return; applyBearing(startBearing + (e.clientX - startX) * 0.5); };
    const onMouseUp     = ()  => { if (!active) return; active = false; map.dragging.enable(); };
    const onContextMenu = (e) => e.preventDefault();
    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("contextmenu", onContextMenu);
    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("contextmenu", onContextMenu);
    };
  }, [map, bearing, updateBearing]);

  const getAngle = (e, cx, cy) => {
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    return (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
  };

  const onRingPointerDown = useCallback((e) => {
    if (e.target.closest(".compass-cap")) return;
    e.preventDefault(); e.stopPropagation();
    const rect = roseRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    rotRef.current = { cx, cy, startAngle: getAngle(e, cx, cy), startBearing: map.getBearing?.() ?? bearing };
    setRotating(true); map.dragging.disable(); map.scrollWheelZoom.disable();
  }, [map, bearing]);

  useEffect(() => {
    if (!rotating) return;
    const applyBearing = (nb) => {
      const norm = ((nb % 360) + 360) % 360;
      if (map.setBearing) { map.setBearing(norm); }
      else { const p = map.getPanes().mapPane; const sz = map.getSize(); p.style.transformOrigin = `${sz.x/2}px ${sz.y/2}px`; p.style.transform = `rotate(${norm}deg)`; }
      updateBearing(norm);
    };
    const onMove = (e) => { if (!rotRef.current) return; const { cx, cy, startAngle, startBearing } = rotRef.current; applyBearing(startBearing + getAngle(e, cx, cy) - startAngle); };
    const onUp   = () => { setRotating(false); map.dragging.enable(); map.scrollWheelZoom.enable(); rotRef.current = null; };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false }); window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, [rotating, map, updateBearing]);

  const resetNorth = useCallback((e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (map.setBearing) { map.setBearing(0, { animate: true, duration: 0.5 }); }
    else { const p = map.getPanes().mapPane; p.style.transition = "transform 0.4s ease"; p.style.transform = "rotate(0deg)"; setTimeout(() => { p.style.transition = ""; }, 450); }
    updateBearing(0);
  }, [map, updateBearing]);

  const pan = (dx, dy) => map.panBy([dx, dy], { animate: true, duration: 0.25 });
  const h   = (k, v)  => setHov(p => ({ ...p, [k]: v }));

  const btnStyle = (key) => ({
    width:30, height:30, borderRadius:8, cursor:"pointer",
    display:"flex", alignItems:"center", justifyContent:"center",
    background:  hov[key] ? "rgba(74,158,255,0.28)" : "rgba(6,14,26,0.90)",
    border:     `1px solid ${hov[key] ? "rgba(74,158,255,0.7)" : "rgba(255,255,255,0.13)"}`,
    color:       hov[key] ? "#fff" : "rgba(155,195,255,0.75)",
    backdropFilter:"blur(14px)",
    boxShadow:   hov[key] ? "0 0 10px rgba(74,158,255,0.28)" : "0 2px 8px rgba(0,0,0,0.55)",
    transition:"all 0.15s", flexShrink:0,
  });

  const zBtnStyle = (key, isTop) => ({
    width:30, height:30, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
    background:  hov[key] ? "rgba(74,158,255,0.28)" : "rgba(6,14,26,0.90)",
    border:     `1px solid ${hov[key] ? "rgba(74,158,255,0.6)" : "rgba(255,255,255,0.13)"}`,
    borderBottom: isTop ? "1px solid rgba(255,255,255,0.07)" : undefined,
    color:        hov[key] ? "#fff" : "rgba(155,195,255,0.82)",
    backdropFilter:"blur(14px)", transition:"all 0.15s",
    fontSize:20, fontWeight:300, lineHeight:1,
    borderRadius: isTop ? "8px 8px 0 0" : "0 0 8px 8px",
  });

  const displayBearing = Math.round(((bearing % 360) + 360) % 360);

  return (
    <div style={{ position:"absolute", top:10, right:10, zIndex:1000,
      display:"flex", flexDirection:"column", alignItems:"center",
      gap:6, userSelect:"none", pointerEvents:"all" }}>

      {/* Heading badge */}
      <div onClick={onCompassToggle}
        title={compassNavActive ? "Stop Compass Nav" : "Start Compass Nav"}
        style={{ fontSize:9, fontFamily:"'DM Mono',monospace", letterSpacing:"0.08em",
          color:  compassNavActive ? "#4ade80" : bearing !== 0 ? "#4a9eff" : "rgba(255,255,255,0.3)",
          background: compassNavActive ? "rgba(34,197,94,0.14)" : "rgba(6,14,26,0.75)",
          padding:"2px 8px", borderRadius:5, cursor:"pointer",
          border:`1px solid ${compassNavActive ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.07)"}`,
          transition:"all 0.2s", display:"flex", alignItems:"center", gap:4 }}>
        {compassNavActive && <span style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80",
          display:"inline-block", animation:"blink 1s infinite", boxShadow:"0 0 5px #4ade80" }}/>}
        {compassNavActive ? `${Math.round(((compassHeading ?? 0) % 360 + 360) % 360)}°`
          : displayBearing !== 0 ? `${displayBearing}°` : "N 0°"}
      </div>

      {/* Rose */}
      <div ref={roseRef}
        onMouseDown={onRingPointerDown} onTouchStart={onRingPointerDown}
        onMouseEnter={() => h("rose", true)} onMouseLeave={() => h("rose", false)}
        title="Drag ring to rotate map • Click centre to reset North"
        style={{ width:90, height:90, position:"relative", touchAction:"none",
          cursor: rotating ? "grabbing" : "grab",
          filter: rotating ? "drop-shadow(0 0 16px rgba(74,158,255,0.7))"
            : hov.rose ? "drop-shadow(0 0 10px rgba(74,158,255,0.45))"
            : "drop-shadow(0 4px 18px rgba(0,0,0,0.8))",
          transition: rotating ? "none" : "filter 0.2s" }}>
        <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
          <defs>
            <radialGradient id="cBg" cx="42%" cy="36%" r="64%"><stop offset="0%" stopColor="#0e2040"/><stop offset="100%" stopColor="#050c1a"/></radialGradient>
            <radialGradient id="cFace" cx="50%" cy="44%" r="60%"><stop offset="0%" stopColor="#142e52" stopOpacity="0.95"/><stop offset="100%" stopColor="#060e1e"/></radialGradient>
            <linearGradient id="cNRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5a5a"/><stop offset="50%" stopColor="#cc1111"/><stop offset="100%" stopColor="#7a0808"/></linearGradient>
            <linearGradient id="cNSilver" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#e0eeff"/><stop offset="50%" stopColor="#8aabcc"/><stop offset="100%" stopColor="#3a5a7a"/></linearGradient>
            <radialGradient id="cCap" cx="38%" cy="32%" r="68%"><stop offset="0%" stopColor="#2a70c0"/><stop offset="100%" stopColor="#0a1a2e"/></radialGradient>
            <filter id="cShadow"><feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#000" floodOpacity="0.8"/></filter>
          </defs>
          <g style={{ transform:`rotate(${-bearing}deg)`, transformOrigin:"45px 45px", transition: rotating ? "none" : "transform 0.12s linear" }}>
            <circle cx="45" cy="45" r="43" fill="url(#cBg)"
              stroke={compassNavActive ? "rgba(34,197,94,0.7)" : rotating ? "rgba(74,158,255,0.85)" : hov.rose ? "rgba(74,158,255,0.55)" : "rgba(255,255,255,0.1)"}
              strokeWidth={compassNavActive ? 2 : 1.5}/>
            <circle cx="45" cy="45" r="35" fill="url(#cFace)"/>
            {Array.from({ length: 36 }).map((_, i) => {
              const a = (i * 10 * Math.PI) / 180; const maj = i % 3 === 0; const r1 = maj ? 39 : 41, r2 = maj ? 32 : 37;
              return <line key={i} x1={45+r1*Math.sin(a)} y1={45-r1*Math.cos(a)} x2={45+r2*Math.sin(a)} y2={45-r2*Math.cos(a)}
                stroke={maj ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)"} strokeWidth={maj ? 1.3 : 0.6}/>;
            })}
            <text x="45" y="17" textAnchor="middle" fontSize="10" fontWeight="800" fill="#ef4444" fontFamily="'DM Mono',monospace">N</text>
            <text x="45" y="78" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="rgba(165,200,255,0.55)" fontFamily="'DM Mono',monospace">S</text>
            <text x="78" y="48.5" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="rgba(165,200,255,0.55)" fontFamily="'DM Mono',monospace">E</text>
            <text x="12" y="48.5" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="rgba(165,200,255,0.55)" fontFamily="'DM Mono',monospace">W</text>
          </g>
          <g filter="url(#cShadow)">
            <polygon points="45,13 48.5,45 45,38 41.5,45" fill="url(#cNRed)"/>
            <polygon points="45,77 48.5,45 45,52 41.5,45" fill="url(#cNSilver)"/>
          </g>
          <g className="compass-cap" onClick={resetNorth} style={{ cursor:"pointer" }}>
            <circle cx="45" cy="45" r="9" fill="url(#cCap)" stroke="rgba(100,160,255,0.4)" strokeWidth="1.2"/>
            <circle cx="45" cy="45" r="5" fill="rgba(255,255,255,0.92)"/>
            <circle cx="45" cy="45" r="2.5" fill="rgba(74,158,255,0.9)"/>
          </g>
        </svg>
      </div>

      {/* Zoom +/- */}
      <div style={{ display:"flex", flexDirection:"column", borderRadius:8, overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,0.5)" }}>
        <button style={zBtnStyle("zi", true)} onClick={() => map.zoomIn()} onMouseEnter={() => h("zi", true)} onMouseLeave={() => h("zi", false)}>+</button>
        <button style={zBtnStyle("zo", false)} onClick={() => map.zoomOut()} onMouseEnter={() => h("zo", true)} onMouseLeave={() => h("zo", false)}>−</button>
      </div>

      {/* Pan D-pad */}
      <div style={{ display:"grid", gridTemplateColumns:"30px 30px 30px", gap:3 }}>
        <div/>
        <button style={btnStyle("u")} onClick={() => pan(0, -PAN)} onMouseEnter={() => h("u",true)} onMouseLeave={() => h("u",false)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <div/>
        <button style={btnStyle("l")} onClick={() => pan(-PAN, 0)} onMouseEnter={() => h("l",true)} onMouseLeave={() => h("l",false)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ width:30, height:30, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(14,28,52,0.7)", border:"1px solid rgba(74,158,255,0.1)" }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(74,158,255,0.35)" strokeWidth="2.5"><circle cx="12" cy="12" r="4"/></svg>
        </div>
        <button style={btnStyle("r")} onClick={() => pan(PAN, 0)} onMouseEnter={() => h("r",true)} onMouseLeave={() => h("r",false)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div/>
        <button style={btnStyle("d")} onClick={() => pan(0, PAN)} onMouseEnter={() => h("d",true)} onMouseLeave={() => h("d",false)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div/>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MOBILE ALPINE-QUEST COMPASS WIDGET
   Map stays NORTH-UP. Only the needle rotates to show device heading.
════════════════════════════════════════════════════════════════════ */
export function MobileCompassWidget({ compassNavActive, compassHeading, onCompassToggle, leafletMapRef }) {
  const heading      = (((compassHeading ?? 0) % 360) + 360) % 360;
  const dirLabel     = bearingLabel(Math.round(heading));
  const needleRotation = -heading; // counter-rotate so red tip always points geo-north

  const zoomMap = (dir) => { const map = leafletMapRef?.current; if (!map) return; dir > 0 ? map.zoomIn() : map.zoomOut(); };

  return (
    <div style={{ position:"fixed", top:"200px", right:12, zIndex:1320,
      display:"flex", flexDirection:"column", alignItems:"center",
      gap:6, userSelect:"none", pointerEvents:"all", fontFamily:"'DM Mono',monospace" }}>

      {/* Rose */}
      <div onClick={onCompassToggle}
        title={compassNavActive ? "Stop compass navigation" : "Start compass navigation"}
        style={{ width:72, height:72, position:"relative", cursor:"pointer",
          filter: compassNavActive ? "drop-shadow(0 0 14px rgba(34,197,94,0.65))" : "drop-shadow(0 4px 18px rgba(0,0,0,0.8))",
          transition:"filter 0.3s" }}>
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
          <defs>
            <radialGradient id="aqBg" cx="42%" cy="36%" r="64%"><stop offset="0%" stopColor="#0a1a30"/><stop offset="100%" stopColor="#040810"/></radialGradient>
            <radialGradient id="aqFace" cx="50%" cy="44%" r="60%"><stop offset="0%" stopColor="#0d2038" stopOpacity="0.98"/><stop offset="100%" stopColor="#050c18"/></radialGradient>
            <linearGradient id="aqNeedle" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5050"/><stop offset="45%" stopColor="#dc1818"/><stop offset="100%" stopColor="#7a0808"/></linearGradient>
            <linearGradient id="aqNeedleS" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#e8f4ff"/><stop offset="50%" stopColor="#7090b0"/><stop offset="100%" stopColor="#2e4a62"/></linearGradient>
            <radialGradient id="aqCap" cx="38%" cy="32%" r="68%"><stop offset="0%" stopColor="#1e5fa0"/><stop offset="100%" stopColor="#08152a"/></radialGradient>
            <filter id="aqNeedleShadow"><feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.8"/></filter>
          </defs>
          <circle cx="36" cy="36" r="34.5" fill="url(#aqBg)"
            stroke={compassNavActive ? "rgba(34,197,94,0.9)" : "rgba(255,255,255,0.14)"}
            strokeWidth={compassNavActive ? 2.5 : 1.5}/>
          {compassNavActive && <circle cx="36" cy="36" r="33.5" fill="none" stroke="rgba(34,197,94,0.3)" strokeWidth="3" style={{ animation:"compassPulse 2s ease-in-out infinite" }}/>}
          <circle cx="36" cy="36" r="28" fill="url(#aqFace)"/>
          {Array.from({ length: 36 }).map((_, i) => {
            const a = i * 10 * Math.PI / 180; const isCard = i % 9 === 0; const isMaj = i % 3 === 0;
            const r1 = isCard ? 32 : isMaj ? 31 : 33; const r2 = isCard ? 24 : isMaj ? 26 : 29;
            return <line key={i} x1={36+r1*Math.sin(a)} y1={36-r1*Math.cos(a)} x2={36+r2*Math.sin(a)} y2={36-r2*Math.cos(a)}
              stroke={isCard?"rgba(255,255,255,0.6)":isMaj?"rgba(255,255,255,0.28)":"rgba(255,255,255,0.09)"}
              strokeWidth={isCard?1.6:isMaj?1:0.5}/>;
          })}
          <text x="36" y="13.5" textAnchor="middle" fontSize="9.5" fontWeight="900" fill="#ef4444" fontFamily="'DM Mono',monospace">N</text>
          <text x="36" y="62"   textAnchor="middle" fontSize="8"   fontWeight="600" fill="rgba(140,185,240,0.5)" fontFamily="'DM Mono',monospace">S</text>
          <text x="62" y="39"   textAnchor="middle" fontSize="8"   fontWeight="600" fill="rgba(140,185,240,0.5)" fontFamily="'DM Mono',monospace">E</text>
          <text x="10" y="39"   textAnchor="middle" fontSize="8"   fontWeight="600" fill="rgba(140,185,240,0.5)" fontFamily="'DM Mono',monospace">W</text>
          {/* Rotating needle */}
          <g filter="url(#aqNeedleShadow)" style={{ transform:`rotate(${needleRotation}deg)`, transformOrigin:"36px 36px",
            transition: compassNavActive ? "transform 0.12s linear" : "none" }}>
            <polygon points="36,10 39,36 36,29 33,36" fill="url(#aqNeedle)"/>
            <polygon points="36,62 39,36 36,43 33,36" fill="url(#aqNeedleS)"/>
          </g>
          <circle cx="36" cy="36" r="7" fill="url(#aqCap)" stroke="rgba(34,197,94,0.4)" strokeWidth="1.2"/>
          <circle cx="36" cy="36" r="4.5" fill="rgba(255,255,255,0.92)"/>
          <circle cx="36" cy="36" r="2.2" fill={compassNavActive ? "#4ade80" : "#3b82f6"}/>
        </svg>
      </div>

      {/* Heading badge */}
      <div style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:10,
        background:"rgba(4,10,22,0.88)", backdropFilter:"blur(16px)",
        border:`1.5px solid ${compassNavActive ? "rgba(34,197,94,0.55)" : "rgba(255,255,255,0.12)"}`,
        boxShadow:"0 3px 14px rgba(0,0,0,0.65)", pointerEvents:"none", whiteSpace:"nowrap" }}>
        <svg width="7" height="7" viewBox="0 0 8 8"><path d="M4 0L8 4L4 8L0 4Z" fill={compassNavActive ? "#4ade80" : "#ef4444"} opacity="0.9"/></svg>
        <span style={{ fontSize:12, fontWeight:700, color: compassNavActive ? "#86efac" : "#dbeafe", letterSpacing:"0.04em" }}>
          {heading.toFixed(1)}° {dirLabel}
        </span>
      </div>

      {/* Zoom +/- */}
      <div style={{ display:"flex", flexDirection:"column", borderRadius:10, overflow:"hidden",
        boxShadow:"0 3px 14px rgba(0,0,0,0.65)", border:"1px solid rgba(255,255,255,0.1)" }}>
        {[1, -1].map((dir, i) => (
          <button key={dir} onClick={() => zoomMap(dir)} style={{
            width:34, height:34, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
            background:"rgba(5,12,26,0.90)", backdropFilter:"blur(16px)", border:"none",
            borderBottom: i === 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
            color:"rgba(180,215,255,0.88)", fontSize:20, fontWeight:300, lineHeight:1 }}>
            {dir > 0 ? "+" : "−"}
          </button>
        ))}
      </div>
    </div>
  );
}