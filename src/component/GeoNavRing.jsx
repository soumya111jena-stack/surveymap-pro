/**
 * GeoNavRing.jsx — Google Earth–style Navigation Ring for CesiumJS
 * FIXED v2:
 *  - Smaller ring (68px) — no longer dominates the corner
 *  - Arrow buttons repositioned to match new size
 *  - All events fully isolated from Cesium canvas
 *  - Cesium camera controller disabled only during ring drag
 */

import { useEffect, useRef, useState, useCallback } from "react";

export default function GeoNavRing({ viewerRef, CesiumRef, compassHeading, ready }) {
  const ringRef      = useRef(null);
  const isDragging   = useRef(false);
  const startAngle   = useRef(0);
  const startHead    = useRef(0);
  const tipTimer     = useRef(null);

  const [dragging,  setDragging]  = useState(false);
  const [hovered,   setHovered]   = useState(false);
  const [showTip,   setShowTip]   = useState(false);
  const [activeBtn, setActiveBtn] = useState(null);

  const holdTimer    = useRef(null);
  const holdInterval = useRef(null);

  const setCesiumInput = useCallback((enabled) => {
    try {
      const ctrl = viewerRef.current?.scene?.screenSpaceCameraController;
      if (!ctrl) return;
      ctrl.enableRotate    = enabled;
      ctrl.enableTranslate = enabled;
      ctrl.enableZoom      = enabled;
      ctrl.enableTilt      = enabled;
      ctrl.enableLook      = enabled;
    } catch (_) {}
  }, [viewerRef]);

  const resetNorth = useCallback(() => {
    if (!ready || !viewerRef.current || viewerRef.current.isDestroyed()) return;
    const cam = viewerRef.current.camera;
    cam.flyTo({
      destination: cam.positionWC.clone(),
      orientation: { heading: 0, pitch: cam.pitch, roll: 0 },
      duration: 0.8,
      easingFunction: CesiumRef.current.EasingFunction.CUBIC_OUT,
    });
  }, [ready, viewerRef, CesiumRef]);

  const tiltCamera = useCallback((deltaRad) => {
    if (!ready || !viewerRef.current || viewerRef.current.isDestroyed()) return;
    const Cesium = CesiumRef.current;
    const cam    = viewerRef.current.camera;
    const pitch  = Math.max(
      Cesium.Math.toRadians(-90),
      Math.min(Cesium.Math.toRadians(0), cam.pitch + deltaRad)
    );
    cam.flyTo({
      destination: cam.positionWC.clone(),
      orientation: { heading: cam.heading, pitch, roll: 0 },
      duration: 0.25,
      easingFunction: Cesium.EasingFunction.CUBIC_OUT,
    });
  }, [ready, viewerRef, CesiumRef]);

  const orbitCamera = useCallback((deltaRad) => {
    if (!ready || !viewerRef.current || viewerRef.current.isDestroyed()) return;
    const Cesium = CesiumRef.current;
    const cam    = viewerRef.current.camera;
    cam.flyTo({
      destination: cam.positionWC.clone(),
      orientation: { heading: cam.heading + deltaRad, pitch: cam.pitch, roll: 0 },
      duration: 0.25,
      easingFunction: Cesium.EasingFunction.CUBIC_OUT,
    });
  }, [ready, viewerRef, CesiumRef]);

  const stopHold = useCallback(() => {
    clearTimeout(holdTimer.current);
    clearInterval(holdInterval.current);
    holdTimer.current = holdInterval.current = null;
  }, []);

  const startHold = useCallback((action) => {
    stopHold();
    action();
    holdTimer.current = setTimeout(() => {
      holdInterval.current = setInterval(action, 110);
    }, 340);
  }, [stopHold]);

  useEffect(() => () => stopHold(), [stopHold]);

  const angleFromCenter = (e, el) => {
    const r  = el.getBoundingClientRect();
    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;
    const px = e.touches ? e.touches[0].clientX : e.clientX;
    const py = e.touches ? e.touches[0].clientY : e.clientY;
    return Math.atan2(py - cy, px - cx);
  };

  const onRingDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!ready || !viewerRef.current || viewerRef.current.isDestroyed()) return;

    const rect  = ringRef.current.getBoundingClientRect();
    const cx    = rect.left + rect.width  / 2;
    const cy    = rect.top  + rect.height / 2;
    const px    = e.touches ? e.touches[0].clientX : e.clientX;
    const py    = e.touches ? e.touches[0].clientY : e.clientY;
    const dist  = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    const inner = (rect.width / 2) * 0.50;

    if (dist < inner) return;

    isDragging.current = true;
    startAngle.current = angleFromCenter(e, ringRef.current);
    startHead.current  = viewerRef.current.camera.heading;
    setDragging(true);
    setCesiumInput(false);
  }, [ready, viewerRef, setCesiumInput]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current || !viewerRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const delta      = angleFromCenter(e, ringRef.current) - startAngle.current;
      const newHeading = startHead.current + delta;
      try {
        viewerRef.current.camera.setView({
          destination: viewerRef.current.camera.positionWC.clone(),
          orientation: {
            heading: newHeading,
            pitch:   viewerRef.current.camera.pitch,
            roll:    0,
          },
        });
      } catch (_) {}
    };

    const onUp = (e) => {
      if (!isDragging.current) return;
      e.stopPropagation();
      isDragging.current = false;
      setDragging(false);
      setCesiumInput(true);
    };

    window.addEventListener("mousemove", onMove, { capture: true });
    window.addEventListener("mouseup",   onUp,   { capture: true });
    window.addEventListener("touchmove", onMove, { capture: true, passive: false });
    window.addEventListener("touchend",  onUp,   { capture: true });
    return () => {
      window.removeEventListener("mousemove", onMove, { capture: true });
      window.removeEventListener("mouseup",   onUp,   { capture: true });
      window.removeEventListener("touchmove", onMove, { capture: true });
      window.removeEventListener("touchend",  onUp,   { capture: true });
    };
  }, [viewerRef, setCesiumInput]);

  const handleMouseEnter = () => {
    clearTimeout(tipTimer.current);
    setHovered(true);
    setShowTip(true);
  };
  const handleMouseLeave = () => {
    setHovered(false);
    tipTimer.current = setTimeout(() => setShowTip(false), 600);
  };

  const stopAll = (e) => e.stopPropagation();

  // ── Sizes (reduced from 96 → 68) ─────────────────────────────────────────
  const SIZE  = 68;
  const HALF  = SIZE / 2;
  const ABTN  = 16;

  const ArrowBtn = ({ label, onPress, btnStyle }) => (
    <button
      title={label}
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setActiveBtn(label); startHold(onPress); }}
      onMouseUp={(e)   => { e.stopPropagation(); stopHold(); setActiveBtn(null); }}
      onMouseLeave={(e)=> { e.stopPropagation(); stopHold(); setActiveBtn(null); }}
      onTouchStart={(e)=> { e.stopPropagation(); e.preventDefault(); setActiveBtn(label); startHold(onPress); }}
      onTouchEnd={(e)  => { e.stopPropagation(); stopHold(); setActiveBtn(null); }}
      style={{
        position: "absolute",
        width: ABTN, height: ABTN,
        border: "none",
        borderRadius: "50%",
        background: activeBtn === label
          ? "rgba(96,165,250,0.6)"
          : "rgba(16,32,64,0.75)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: activeBtn === label ? "#fff" : "#90b8e0",
        transition: "background .1s, color .1s",
        zIndex: 12,
        boxShadow: activeBtn === label
          ? "0 0 8px rgba(96,165,250,0.5)"
          : "0 1px 4px rgba(0,0,0,0.6)",
        ...btnStyle,
      }}
    >
      <svg width={7} height={7} viewBox="0 0 10 10" fill="currentColor">
        {label === "Tilt up"     && <polygon points="5,1 9,9 1,9" />}
        {label === "Tilt down"   && <polygon points="5,9 9,1 1,1" />}
        {label === "Orbit left"  && <polygon points="1,5 9,1 9,9" />}
        {label === "Orbit right" && <polygon points="9,5 1,1 1,9" />}
      </svg>
    </button>
  );

  const heading = Math.round(((compassHeading % 360) + 360) % 360);

  return (
    <div
      onMouseDown={stopAll}
      onMouseUp={stopAll}
      onMouseMove={stopAll}
      onTouchStart={stopAll}
      onTouchEnd={stopAll}
      onTouchMove={stopAll}
      onClick={stopAll}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "fixed",
        bottom: 200,
        right: 10,
        zIndex: 1300,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        pointerEvents: "all",
      }}
    >
      {/* Tooltip */}
      {showTip && (
        <div style={{
          position: "absolute",
          bottom: SIZE + 30,
          right: 0,
          background: "rgba(6,12,26,0.95)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 7,
          padding: "4px 9px",
          fontSize: 9,
          color: "rgba(255,255,255,0.85)",
          whiteSpace: "nowrap",
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontWeight: 500,
          pointerEvents: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
          zIndex: 9999,
        }}>
          Drag to rotate · click{" "}
          <b style={{ color: "#60a5fa" }}>N</b>
          {" "}to reset north
        </div>
      )}

      {/* Heading readout */}
      <div
        onClick={(e) => { e.stopPropagation(); resetNorth(); }}
        title="Click to reset North"
        style={{
          background: "rgba(6,12,26,0.90)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 4,
          padding: "1px 6px",
          fontSize: 8.5,
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          color: dragging ? "#60a5fa" : "rgba(255,255,255,0.55)",
          fontWeight: 700,
          letterSpacing: ".06em",
          backdropFilter: "blur(12px)",
          cursor: "pointer",
          transition: "color .15s",
          userSelect: "none",
        }}
      >
        {String(heading).padStart(3, "0")}°
      </div>

      {/* Navigation Ring */}
      <div
        ref={ringRef}
        onMouseDown={onRingDown}
        onTouchStart={onRingDown}
        style={{
          width: SIZE,
          height: SIZE,
          position: "relative",
          cursor: dragging ? "grabbing" : "grab",
          flexShrink: 0,
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >
        {/* Rotating SVG */}
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{
            position: "absolute",
            inset: 0,
            transform: `rotate(${compassHeading}deg)`,
            transition: dragging ? "none" : "transform 0.08s linear",
            pointerEvents: "none",
          }}
        >
          <defs>
            <radialGradient id="gnrBg" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="rgba(16,28,56,0.97)" />
              <stop offset="100%" stopColor="rgba(6,12,26,0.99)"  />
            </radialGradient>
            <radialGradient id="gnrGlow" cx="50%" cy="50%" r="50%">
              <stop offset="50%" stopColor="transparent" />
              <stop offset="100%"
                stopColor={hovered || dragging ? "rgba(59,130,246,0.25)" : "transparent"}
              />
            </radialGradient>
            <filter id="gnrShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="4"
                floodColor="rgba(0,0,0,0.8)" floodOpacity="1" />
            </filter>
          </defs>

          {/* Outer disc */}
          <circle cx={HALF} cy={HALF} r={HALF - 1}
            fill="url(#gnrBg)"
            stroke={hovered || dragging ? "rgba(96,165,250,0.65)" : "rgba(255,255,255,0.18)"}
            strokeWidth="1.5"
            filter="url(#gnrShadow)"
          />
          <circle cx={HALF} cy={HALF} r={HALF - 1} fill="url(#gnrGlow)" strokeWidth="0" />

          {/* Tick marks every 30° */}
          {Array.from({ length: 12 }, (_, i) => {
            const ang    = (i * 30 * Math.PI) / 180;
            const isCard = i % 3 === 0;
            const r1     = HALF - 2;
            const r2     = HALF - (isCard ? 8 : 5);
            return (
              <line key={i}
                x1={HALF + r1 * Math.sin(ang)} y1={HALF - r1 * Math.cos(ang)}
                x2={HALF + r2 * Math.sin(ang)} y2={HALF - r2 * Math.cos(ang)}
                stroke={isCard ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)"}
                strokeWidth={isCard ? 1.5 : 0.8}
                strokeLinecap="round"
              />
            );
          })}

          {/* Red N wedge */}
          <polygon
            points={`${HALF},2 ${HALF - 3},${HALF * 0.52} ${HALF + 3},${HALF * 0.52}`}
            fill="#ef4444"
          />
          {/* N text */}
          <text x={HALF} y={11}
            textAnchor="middle" dominantBaseline="middle"
            fill="#fff" fontSize="8" fontWeight="900"
            fontFamily="'DM Sans', system-ui, sans-serif"
          >N</text>

          {/* S text */}
          <text x={HALF} y={SIZE - 6}
            textAnchor="middle" dominantBaseline="middle"
            fill="rgba(255,255,255,0.3)" fontSize="7" fontWeight="700"
            fontFamily="'DM Sans', system-ui, sans-serif"
          >S</text>

          {/* Inner separator */}
          <circle cx={HALF} cy={HALF} r={HALF * 0.50}
            fill="rgba(4,9,20,0.85)"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="1"
          />
        </svg>

        {/* N click hotspot */}
        <button
          title="Reset to North"
          onClick={(e) => { e.stopPropagation(); resetNorth(); }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 1, left: "50%",
            transform: "translateX(-50%)",
            width: 16, height: 16,
            borderRadius: "50%",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            zIndex: 20,
          }}
        />

        {/* Inner joystick arrows — repositioned for SIZE=68 */}
        <ArrowBtn label="Tilt up"     onPress={() => tiltCamera(+0.07)}
          btnStyle={{ top: HALF - ABTN / 2 - 8, left: "50%", transform: "translateX(-50%)" }} />
        <ArrowBtn label="Tilt down"   onPress={() => tiltCamera(-0.07)}
          btnStyle={{ bottom: HALF - ABTN / 2 - 8, left: "50%", transform: "translateX(-50%)" }} />
        <ArrowBtn label="Orbit left"  onPress={() => orbitCamera(-0.07)}
          btnStyle={{ left: HALF - ABTN / 2 - 8, top: "50%", transform: "translateY(-50%)" }} />
        <ArrowBtn label="Orbit right" onPress={() => orbitCamera(+0.07)}
          btnStyle={{ right: HALF - ABTN / 2 - 8, top: "50%", transform: "translateY(-50%)" }} />

        {/* Centre dot */}
        <div style={{
          position: "absolute",
          top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: 7, height: 7,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(148,196,255,0.95) 0%, rgba(59,130,246,0.5) 100%)",
          border: "1px solid rgba(255,255,255,0.35)",
          boxShadow: "0 0 4px rgba(96,165,250,0.5)",
          pointerEvents: "none",
          zIndex: 6,
        }} />
      </div>
    </div>
  );
}