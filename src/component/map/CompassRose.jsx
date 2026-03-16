/**
 * CompassRose.jsx — AlpineQuest EXACT replica
 *
 * Key insight from screenshot:
 *  • MAP DOES NOT ROTATE — stays fixed North-up always
 *  • COMPASS NEEDLE rotates to show real magnetic heading
 *  • Blue directional arrow on map at your location
 *  • Blue FOV triangle (field of view cone) on map
 *  • Heading label: "49.0° NE" shown separately (passed up to parent)
 *  • Standard compass: N top, E right, S bottom, W left
 *  • Drag compass ring → does nothing to map, just shows visual
 */
import { useRef, useState, useCallback, useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

const norm  = d => ((d % 360) + 360) % 360;
const toRad = d => d * Math.PI / 180;

function bearingLabel(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(norm(deg) / 22.5) % 16];
}

// ── Blue directional arrow + FOV cone on the map (like AQ) ──────────────────
function DirectionArrow({ map, heading, position }) {
  const layerRef = useRef(null);
  const arrowRef = useRef(null);

  useEffect(() => {
    if (!map || position == null) return;

    // Remove old layers
    layerRef.current?.remove();
    arrowRef.current?.remove();

    const { lat, lng } = position;
    const h = norm(heading);

    // FOV cone — blue triangle pointing in heading direction
    // Calculate 3 points of the triangle extending from position
    const R = 0.018; // ~2km radius in degrees
    const fovHalf = 25; // ±25° half-angle
    const tipLat  = lat + R * Math.cos(toRad(h));
    const tipLng  = lng + R * Math.sin(toRad(h)) / Math.cos(toRad(lat));
    const l1Lat   = lat + R * 0.7 * Math.cos(toRad(h - fovHalf));
    const l1Lng   = lng + R * 0.7 * Math.sin(toRad(h - fovHalf)) / Math.cos(toRad(lat));
    const l2Lat   = lat + R * 0.7 * Math.cos(toRad(h + fovHalf));
    const l2Lng   = lng + R * 0.7 * Math.sin(toRad(h + fovHalf)) / Math.cos(toRad(lat));

    layerRef.current = L.polygon(
      [[tipLat, tipLng], [l1Lat, l1Lng], [lat, lng], [l2Lat, l2Lng]],
      { color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.22, weight: 0, interactive: false }
    ).addTo(map);

    // Arrow marker — blue triangle pointing in heading direction
    const arrowIcon = L.divIcon({
      className: "",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      html: `<div style="
        width:28px;height:28px;
        transform:rotate(${h}deg);
        display:flex;align-items:center;justify-content:center;
      ">
        <svg width="28" height="28" viewBox="0 0 28 28">
          <polygon points="14,2 8,22 14,18 20,22"
            fill="#2563eb" stroke="#fff" stroke-width="1.5"
            stroke-linejoin="round" opacity="0.97"/>
        </svg>
      </div>`,
    });

    arrowRef.current = L.marker([lat, lng], {
      icon: arrowIcon, zIndexOffset: 2000, interactive: false
    }).addTo(map);

    return () => {
      layerRef.current?.remove();
      arrowRef.current?.remove();
    };
  }, [map, heading, position]);

  return null;
}

// ── Main CompassRose ─────────────────────────────────────────────────────────
export default function CompassRose({ size = 70, onHeadingChange }) {
  const map = useMap();

  const [heading,  setHeading]  = useState(0);    // device magnetic heading
  const [active,   setActive]   = useState(false); // compass enabled
  const [position, setPosition] = useState(null);  // {lat, lng}
  const [smoothH,  setSmoothH]  = useState(0);     // smoothed heading for SVG

  const targetH  = useRef(0);
  const currentH = useRef(0);
  const animRef  = useRef(null);
  const watchRef = useRef(null);

  // ── smooth needle animation ───────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const diff = (norm(targetH.current - currentH.current + 180) - 180);
      if (Math.abs(diff) > 0.2) {
        currentH.current = norm(currentH.current + diff * 0.16);
        setSmoothH(currentH.current);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // ── device orientation → heading ──────────────────────────────────────────
  const onOrientation = useCallback((e) => {
    let h = null;
    if (e.webkitCompassHeading != null)     h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = norm(360 - e.alpha);
    else if (e.alpha != null)               h = norm(360 - e.alpha);
    if (h == null) return;
    h = norm(h);
    targetH.current = h;
    setHeading(h);
    onHeadingChange?.(h);
  }, [onHeadingChange]);

  const attachOrientation = useCallback(() => {
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation",         onOrientation, true);
  }, [onOrientation]);

  useEffect(() => {
    if (typeof DeviceOrientationEvent?.requestPermission !== "function") {
      attachOrientation();
    }
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation",         onOrientation, true);
    };
  }, [onOrientation, attachOrientation]);

  // ── GPS position for arrow on map ─────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    watchRef.current = navigator.geolocation?.watchPosition(
      pos => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [active]);

  // ── tap to enable ─────────────────────────────────────────────────────────
  const handleTap = useCallback(async () => {
    if (active) return;
    if (typeof DeviceOrientationEvent?.requestPermission === "function") {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r === "granted") attachOrientation();
      } catch (_) {}
    }
    setActive(true);
  }, [active, attachOrientation]);

  // ── SVG compass values — needle rotates, ring stays fixed ─────────────────
  const s = size, cx = s/2, cy = s/2, R = cx - 2;
  // Needle points to magnetic north: rotate by -smoothH so needle
  // always points toward actual N when device is held at heading smoothH
  const needleRot = norm(-smoothH);
  const isNorth   = smoothH < 2 || smoothH > 358;

  return (
    <>
      <style>{`
        .aqcr2 { -webkit-tap-highlight-color:transparent; user-select:none; -webkit-user-select:none; touch-action:none; }
        @keyframes aq2-pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        .aq2-active-ring { animation: aq2-pulse 1.6s ease infinite; }
      `}</style>

      {/* Direction arrow on map */}
      {active && position && (
        <DirectionArrow map={map} heading={smoothH} position={position} />
      )}

      {/* ── Compass widget ── */}
      <div
        className="aqcr2"
        style={{
          width: s, height: s,
          cursor: active ? "default" : "pointer",
          filter: "drop-shadow(0 3px 18px rgba(0,0,0,0.95))",
          flexShrink: 0,
        }}
        onClick={!active ? handleTap : undefined}
        title={active ? `${smoothH.toFixed(1)}° ${bearingLabel(smoothH)}` : "Tap to enable compass"}
      >
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} overflow="visible">
          <defs>
            <radialGradient id="crbg2" cx="50%" cy="35%" r="65%">
              <stop offset="0%"   stopColor="#1e1e1e"/>
              <stop offset="100%" stopColor="#070707"/>
            </radialGradient>
          </defs>

          {/* Outer body */}
          <circle cx={cx} cy={cy} r={R}
            fill="url(#crbg2)"
            stroke={active ? "rgba(34,197,94,0.65)" : "rgba(255,255,255,0.15)"}
            strokeWidth={active ? "1.8" : "1"}
          />
          {active && (
            <circle cx={cx} cy={cy} r={R}
              fill="none" stroke="rgba(34,197,94,0.3)" strokeWidth="3.5"
              className="aq2-active-ring"
            />
          )}

          {/* ── FIXED degree ring — N E S W don't move ── */}
          {/* Tick marks (fixed) */}
          {Array.from({length:72},(_,i)=>i*5).map(a => {
            const isC=a%90===0, isS=a%45===0;
            return (
              <line key={a}
                x1={cx} y1={cy-R+1.5}
                x2={cx} y2={cy-R+(isC?8:isS?5.5:3)}
                stroke={isC?"rgba(255,255,255,0.6)":"rgba(255,255,255,0.16)"}
                strokeWidth={isC?"1.3":"0.65"}
                transform={`rotate(${a} ${cx} ${cy})`}
              />
            );
          })}

          {/* Cardinal labels — FIXED, never rotate */}
          {/* N=top, E=right, S=bottom, W=left — real compass */}
          {[
            ["N",  0,   "rgba(255,255,255,0.95)", 9.5],
            ["E",  90,  "rgba(255,255,255,0.35)", 7.5],
            ["S",  180, "rgba(255,255,255,0.35)", 7.5],
            ["W",  270, "rgba(255,255,255,0.35)", 7.5],
          ].map(([l, a, c, fs]) => {
            const rad = toRad(a - 90), tr = R - 14;
            return (
              <text key={l}
                x={cx + tr*Math.cos(rad)}
                y={cy + tr*Math.sin(rad) + 3.5}
                textAnchor="middle" fill={c} fontSize={fs}
                fontWeight="700" fontFamily="'DM Sans',sans-serif"
              >{l}</text>
            );
          })}

          {/* ── ROTATING needle — points to magnetic north ── */}
          <g transform={`rotate(${needleRot} ${cx} ${cy})`}>
            {/* North tip — RED (like AlpineQuest) */}
            <polygon
              points={`${cx},${cy-R+7} ${cx-5.5},${cy+3} ${cx},${cy-2} ${cx+5.5},${cy+3}`}
              fill={active ? "#e11d48" : "rgba(255,255,255,0.55)"}
              opacity="0.97"
            />
            {/* South tip — grey */}
            <polygon
              points={`${cx},${cy+R-7} ${cx-4.5},${cy-3} ${cx},${cy+2} ${cx+4.5},${cy-3}`}
              fill="rgba(185,185,185,0.38)"
            />
            {/* EW stubs */}
            <line x1={cx-R+5} y1={cy} x2={cx-R+11} y2={cy}
              stroke="rgba(255,255,255,0.15)" strokeWidth="1.2"/>
            <line x1={cx+R-11} y1={cy} x2={cx+R-5} y2={cy}
              stroke="rgba(255,255,255,0.15)" strokeWidth="1.2"/>
          </g>

          {/* ── Center hub ── */}
          <circle cx={cx} cy={cy} r="8"
            fill="#111" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8"/>
          <circle cx={cx} cy={cy} r="4.5"
            fill={active ? "#22c55e" : "rgba(255,255,255,0.2)"}
            stroke="rgba(0,0,0,0.8)" strokeWidth="1"
          />
          <circle cx={cx} cy={cy} r="1.8" fill="rgba(0,0,0,0.65)"/>

          {/* Heading text at bottom of dial */}
          {active && (
            <text x={cx} y={s-3} textAnchor="middle"
              fill="rgba(255,255,255,0.5)" fontSize="6"
              fontFamily="'JetBrains Mono',monospace" fontWeight="600"
            >{Math.round(smoothH)}°</text>
          )}
          {!active && (
            <text x={cx} y={s-3.5} textAnchor="middle"
              fill="rgba(255,255,255,0.18)" fontSize="5.5"
              fontFamily="'DM Sans',sans-serif"
            >tap</text>
          )}
        </svg>
      </div>

      {/* Heading label below compass — "49.0° NE" like AlpineQuest */}
      {active && (
        <div style={{
          marginTop: 4, textAlign: "center",
          background: "rgba(10,10,10,0.82)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, padding: "3px 8px",
          display: "inline-flex", alignItems: "center", gap: 5,
          alignSelf: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
        }}>
          {/* Mini needle indicator */}
          <svg width="9" height="13" viewBox="0 0 9 13" style={{flexShrink:0}}>
            <polygon points="4.5,0 1.5,7 4.5,5.5 7.5,7"
              fill="#e11d48" opacity="0.95"/>
            <polygon points="4.5,13 1.5,6 4.5,7.5 7.5,6"
              fill="rgba(185,185,185,0.4)"/>
          </svg>
          <span style={{
            color:"#fff", fontSize:11, fontWeight:700,
            fontFamily:"'JetBrains Mono',monospace", letterSpacing:".02em",
          }}>
            {smoothH.toFixed(1)}°
          </span>
          <span style={{
            color:"rgba(255,255,255,0.5)", fontSize:10, fontWeight:600,
            fontFamily:"'DM Sans',sans-serif",
          }}>
            {bearingLabel(smoothH)}
          </span>
        </div>
      )}
    </>
  );
}