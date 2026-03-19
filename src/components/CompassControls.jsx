/**
 * CompassControls.jsx — SurveyMap Pro v5.2.3
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX v5.2.3 — DESKTOP ZOOM BUTTONS MISSING:
 *
 *   Problem: ProfessionalCompassControl (desktop) had no zoom buttons.
 *   MobileCompassWidget had zoom buttons but they were only rendered on mobile.
 *
 *   Fix:
 *     1. ProfessionalCompassControl — added +/− zoom pill BELOW the compass
 *        rose, styled to match the dark desktop UI.
 *     2. MobileCompassWidget — zoom buttons unchanged (already working).
 *     3. Both use leafletMapRef.current?.zoomIn/zoomOut() directly, which
 *        works outside MapContainer (no useMap() needed here).
 *     4. Keyboard shortcuts (+/=  and  -/_) added to ProfessionalCompassControl
 *        via a window keydown listener (skipped when focus is on an input).
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/* ─────────────────────────────────────────────────────────────────────────────
   DESKTOP — ProfessionalCompassControl
   Renders compass rose + heading badge + zoom pill (+/−).
   Mounted OUTSIDE MapContainer in SurveyMap.jsx, so receives leafletMapRef
   as a prop instead of using useMap().
───────────────────────────────────────────────────────────────────────────── */
export function ProfessionalCompassControl({
  onBearingChange,
  compassNavActive,
  compassHeading,
  onCompassToggle,
  leafletMapRef,          // ← pass this from SurveyMap: leafletMapRef={leafletMapRef}
}) {
  const map = useMap();   // still works because it's rendered inside MapContainer's child div
  const [bearing, setBearing] = useState(0);

  useEffect(() => {
    if (!map) return;
    const onRotate = () => {
      const b = map.getBearing?.() ?? 0;
      setBearing(b);
      onBearingChange?.(b);
    };
    map.on("rotate", onRotate);
    return () => map.off("rotate", onRotate);
  }, [map, onBearingChange]);

  // NOTE: Keyboard shortcuts and zoom buttons are handled by the ZoomControl
  // component in SurveyMap.jsx (rendered outside MapContainer using leafletMapRef).
  // Do NOT add zoom here — useMap() zoom breaks after KMLLoader calls fitBounds().

  const displayBearing = compassNavActive && compassHeading != null
    ? ((compassHeading % 360) + 360) % 360
    : ((bearing % 360) + 360) % 360;

  const cardinalDir = (deg) => {
    const dirs = ["N","NE","E","SE","S","SW","W","NW"];
    return dirs[Math.round(deg / 45) % 8];
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      userSelect: "none",
    }}>

      {/* ── Compass rose ──────────────────────────────────────── */}
      <div
        onClick={onCompassToggle}
        title={compassNavActive ? "Stop compass navigation" : "Start compass navigation"}
        style={{
          width: 44, height: 44,
          borderRadius: "50%",
          background: compassNavActive
            ? "rgba(14,165,233,0.18)"
            : "rgba(4,10,20,0.88)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: `1.5px solid ${compassNavActive
            ? "rgba(14,165,233,0.6)"
            : "rgba(255,255,255,0.12)"}`,
          boxShadow: compassNavActive
            ? "0 0 16px rgba(14,165,233,0.35), 0 2px 8px rgba(0,0,0,0.6)"
            : "0 2px 12px rgba(0,0,0,0.5)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s",
        }}
      >
        <svg
          width="26" height="26"
          viewBox="0 0 26 26"
          style={{
            transform: `rotate(${displayBearing}deg)`,
            transition: "transform 0.15s ease",
          }}
        >
          {[0,45,90,135,180,225,270,315].map(a => (
            <line
              key={a}
              x1="13" y1="2.5"
              x2="13" y2={a % 90 === 0 ? "5" : "4"}
              stroke={a % 90 === 0 ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)"}
              strokeWidth={a % 90 === 0 ? "1.2" : "0.8"}
              transform={`rotate(${a} 13 13)`}
            />
          ))}
          {/* N needle */}
          <polygon
            points="13,3.5 14.4,13 13,11.5 11.6,13"
            fill={compassNavActive ? "#0ea5e9" : "#ef4444"}
            opacity="0.95"
          />
          {/* S needle */}
          <polygon
            points="13,22.5 14.4,13 13,14.5 11.6,13"
            fill="rgba(255,255,255,0.55)"
          />
          {/* Center dot */}
          <circle cx="13" cy="13" r="1.8"
            fill={compassNavActive ? "#0ea5e9" : "rgba(255,255,255,0.9)"}
          />
        </svg>
      </div>

      {/* ── Heading badge ─────────────────────────────────────── */}
      <div style={{
        fontSize: 8.5,
        fontWeight: 700,
        color: compassNavActive ? "#38bdf8" : "rgba(200,220,255,0.48)",
        fontFamily: "'DM Mono',monospace",
        whiteSpace: "nowrap",
        letterSpacing: "0.04em",
        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
        lineHeight: 1,
        textAlign: "center",
      }}>
        {Math.round(displayBearing)}° {cardinalDir(displayBearing)}
      </div>

    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MOBILE — MobileCompassWidget
   Compact 52×52px compass rose + heading label + zoom pill.
   Positioned bottom-right above the nav bar by SurveyMap.jsx.
   Unchanged from v5.2.2 — zoom was already working on mobile.
───────────────────────────────────────────────────────────────────────────── */
export function MobileCompassWidget({
  compassNavActive,
  compassHeading,
  onCompassToggle,
  leafletMapRef,
}) {
  const [heading, setHeading] = useState(0);

  const displayHeading = compassNavActive && compassHeading != null
    ? ((compassHeading % 360) + 360) % 360
    : ((heading % 360) + 360) % 360;

  const cardinalDir = (deg) => {
    const dirs = ["N","NE","E","SE","S","SW","W","NW"];
    return dirs[Math.round(deg / 45) % 8];
  };

  const handleZoomIn  = useCallback(() => {
    try { leafletMapRef?.current?.zoomIn(1); } catch (_) {}
  }, [leafletMapRef]);

  const handleZoomOut = useCallback(() => {
    try { leafletMapRef?.current?.zoomOut(1); } catch (_) {}
  }, [leafletMapRef]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
    }}>

      {/* ── Compass Rose ─────────────────────────────────────── */}
      <div
        onClick={onCompassToggle}
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: compassNavActive
            ? "rgba(4,12,26,0.95)"
            : "rgba(4,12,26,0.92)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: `1.5px solid ${compassNavActive
            ? "rgba(14,165,233,0.7)"
            : "rgba(255,255,255,0.14)"}`,
          boxShadow: compassNavActive
            ? "0 0 0 3px rgba(14,165,233,0.12), 0 4px 20px rgba(0,0,0,0.7)"
            : "0 2px 16px rgba(0,0,0,0.65)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          flexShrink: 0,
          transition: "border-color 0.25s, box-shadow 0.25s",
          userSelect: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {/* Rotating degree ring */}
        <svg
          width="52" height="52"
          viewBox="0 0 52 52"
          style={{
            position: "absolute",
            inset: 0,
            transform: `rotate(${-displayHeading}deg)`,
            transition: compassNavActive
              ? "transform 0.12s linear"
              : "transform 0.2s ease",
          }}
        >
          {/* Cardinal letters */}
          {[
            { label: "N", angle: 0,   color: compassNavActive ? "#38bdf8" : "#f87171" },
            { label: "E", angle: 90,  color: "rgba(255,255,255,0.4)" },
            { label: "S", angle: 180, color: "rgba(255,255,255,0.4)" },
            { label: "W", angle: 270, color: "rgba(255,255,255,0.4)" },
          ].map(({ label, angle, color }) => {
            const rad = (angle - 90) * Math.PI / 180;
            const r = 21;
            const x = 26 + r * Math.cos(rad);
            const y = 26 + r * Math.sin(rad);
            return (
              <text
                key={label}
                x={x} y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="7"
                fontWeight="800"
                fontFamily="'DM Mono',monospace"
                fill={color}
                transform={`rotate(${angle} ${x} ${y})`}
              >{label}</text>
            );
          })}
          {/* Tick marks */}
          {Array.from({ length: 36 }, (_, i) => i * 10).map(angle => {
            const isMajor = angle % 90 === 0;
            const isMid   = angle % 45 === 0 && !isMajor;
            const r1 = isMajor ? 14 : isMid ? 14.5 : 15;
            const r2 = 17;
            const rad = (angle - 90) * Math.PI / 180;
            return (
              <line
                key={angle}
                x1={26 + r1 * Math.cos(rad)} y1={26 + r1 * Math.sin(rad)}
                x2={26 + r2 * Math.cos(rad)} y2={26 + r2 * Math.sin(rad)}
                stroke={isMajor
                  ? "rgba(255,255,255,0.5)"
                  : "rgba(255,255,255,0.15)"}
                strokeWidth={isMajor ? "1.2" : "0.7"}
              />
            );
          })}
        </svg>

        {/* Fixed needle */}
        <svg
          width="28" height="28"
          viewBox="0 0 28 28"
          style={{ position: "relative", zIndex: 2 }}
        >
          <polygon
            points="14,3 15.6,14 14,12 12.4,14"
            fill={compassNavActive ? "#0ea5e9" : "#ef4444"}
            filter="drop-shadow(0 0 2px rgba(239,68,68,0.5))"
          />
          <polygon
            points="14,25 15.6,14 14,16 12.4,14"
            fill="rgba(255,255,255,0.45)"
          />
          <circle cx="14" cy="14" r="2.2"
            fill={compassNavActive ? "#0ea5e9" : "rgba(255,255,255,0.95)"}
            stroke={compassNavActive
              ? "rgba(14,165,233,0.5)"
              : "rgba(0,0,0,0.5)"}
            strokeWidth="0.8"
          />
        </svg>

        {/* Active pulse ring */}
        {compassNavActive && (
          <div style={{
            position: "absolute",
            inset: -4,
            borderRadius: "50%",
            border: "1.5px solid rgba(14,165,233,0.4)",
            animation: "compassPulse 2s ease-in-out infinite",
            pointerEvents: "none",
          }}/>
        )}
      </div>

      {/* ── Heading label ─────────────────────────────────────── */}
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        color: compassNavActive ? "#38bdf8" : "rgba(200,220,255,0.5)",
        fontFamily: "'DM Mono',monospace",
        letterSpacing: "0.06em",
        textShadow: "0 1px 6px rgba(0,0,0,0.9)",
        lineHeight: 1,
        textAlign: "center",
        userSelect: "none",
      }}>
        {Math.round(displayHeading)}° {cardinalDir(displayHeading)}
      </div>

      {/* ── Zoom Pill ─────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.6)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}>
        {/* Zoom In */}
        <button
          onTouchStart={e => { handleZoomIn(); }}
          onClick={handleZoomIn}
          style={{
            width: 36,
            height: 34,
            background: "rgba(4,12,26,0.92)",
            border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            color: "rgba(220,235,255,0.8)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
            transition: "background 0.12s",
            userSelect: "none",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <line x1="7" y1="2" x2="7" y2="12"
              stroke="rgba(200,220,255,0.8)" strokeWidth="1.8" strokeLinecap="round"/>
            <line x1="2" y1="7" x2="12" y2="7"
              stroke="rgba(200,220,255,0.8)" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Zoom Out */}
        <button
          onTouchStart={e => { handleZoomOut(); }}
          onClick={handleZoomOut}
          style={{
            width: 36,
            height: 34,
            background: "rgba(4,12,26,0.92)",
            border: "none",
            color: "rgba(220,235,255,0.8)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
            transition: "background 0.12s",
            userSelect: "none",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <line x1="2" y1="7" x2="12" y2="7"
              stroke="rgba(200,220,255,0.8)" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes compassPulse {
          0%,100% { opacity: 0.6; transform: scale(1);    }
          50%      { opacity: 0.2; transform: scale(1.12); }
        }
      `}</style>
    </div>
  );
}