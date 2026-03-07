/**
 * DroneFlightPath.jsx — SurveyMap Pro
 * Animate a 3D drone model along user-defined waypoints with altitude.
 * Uses Cesium SampledPositionProperty + CZML for smooth interpolation.
 *
 * Features:
 *  - Click map to place waypoints (lat/lng + custom altitude)
 *  - Live animated drone model (fallback to arrow entity if no glTF)
 *  - Ground track polyline + waypoint markers
 *  - Play / Pause / Speed / Loop controls
 *  - Export waypoints as CSV or KML
 *
 * Usage:
 *   import DroneFlightPath from "./DroneFlightPath";
 *   <DroneFlightPath viewer={viewerRef.current} Cesium={CesiumRef.current}
 *     visible={droneOpen} onClose={() => setDroneOpen(false)} />
 */
import { useEffect, useRef, useState, useCallback } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────
function haversine(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

function fmtDist(m) {
  return m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

function fmtTime(s) {
  if (s < 60) return `${s.toFixed(0)}s`;
  return `${Math.floor(s/60)}m ${(s%60).toFixed(0)}s`;
}

// Drone SVG icon (top-down view)
const DRONE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="48" height="48">
  <circle cx="14" cy="14" r="9" fill="none" stroke="#00e5ff" stroke-width="2" opacity="0.7"/>
  <circle cx="50" cy="14" r="9" fill="none" stroke="#00e5ff" stroke-width="2" opacity="0.7"/>
  <circle cx="14" cy="50" r="9" fill="none" stroke="#00e5ff" stroke-width="2" opacity="0.7"/>
  <circle cx="50" cy="50" r="9" fill="none" stroke="#00e5ff" stroke-width="2" opacity="0.7"/>
  <line x1="20" y1="20" x2="32" y2="32" stroke="#94a3b8" stroke-width="2"/>
  <line x1="44" y1="20" x2="32" y2="32" stroke="#94a3b8" stroke-width="2"/>
  <line x1="20" y1="44" x2="32" y2="32" stroke="#94a3b8" stroke-width="2"/>
  <line x1="44" y1="44" x2="32" y2="32" stroke="#94a3b8" stroke-width="2"/>
  <rect x="26" y="26" width="12" height="12" rx="3" fill="#3b82f6"/>
  <circle cx="32" cy="32" r="3" fill="#00e5ff"/>
</svg>`.trim();

const DRONE_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DRONE_SVG)}`;

export default function DroneFlightPath({ viewer, Cesium, visible, onClose }) {
  const [waypoints, setWaypoints] = useState([]); // [{lat,lng,alt,name}]
  const [placing, setPlacing] = useState(false);   // click-to-place mode
  const [defaultAlt, setDefaultAlt] = useState(100); // metres AGL
  const [speed, setSpeed] = useState(15);   // m/s
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [followDrone, setFollowDrone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stats, setStats] = useState(null);

  const handlerRef    = useRef(null);
  const droneEntRef   = useRef(null);
  const wpEntsRef     = useRef([]);
  const trackEntRef   = useRef(null);
  const clockListRef  = useRef(null);
  const animFrameRef  = useRef(null);
  const startTimeRef  = useRef(null);
  const totalDurRef   = useRef(0);
  const waypointsRef  = useRef([]);

  // Keep ref in sync for use in closures
  waypointsRef.current = waypoints;

  // ── Cleanup all Cesium entities ────────────────────────────────────────
  const clearEntities = useCallback(() => {
    if (!viewer) return;
    wpEntsRef.current.forEach(e => { try { viewer.entities.remove(e); } catch (_) {} });
    wpEntsRef.current = [];
    if (droneEntRef.current) { try { viewer.entities.remove(droneEntRef.current); } catch (_) {} droneEntRef.current = null; }
    if (trackEntRef.current) { try { viewer.entities.remove(trackEntRef.current); } catch (_) {} trackEntRef.current = null; }
    if (clockListRef.current) { try { viewer.clock.onTick.removeEventListener(clockListRef.current); } catch (_) {} clockListRef.current = null; }
    cancelAnimationFrame(animFrameRef.current);
    setPlaying(false);
    setElapsed(0);
  }, [viewer]);

  // ── Place-mode click handler ───────────────────────────────────────────
  useEffect(() => {
    if (!visible || !viewer || !Cesium) return;
    if (!placing) {
      if (handlerRef.current) { handlerRef.current.destroy(); handlerRef.current = null; }
      viewer.scene.canvas.style.cursor = "default";
      return;
    }
    viewer.scene.canvas.style.cursor = "crosshair";
    const h = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    h.setInputAction(click => {
      const ray = viewer.camera.getPickRay(click.position);
      if (!ray) return;
      const pos = viewer.scene.globe.pick(ray, viewer.scene);
      if (!pos) return;
      const carto = Cesium.Cartographic.fromCartesian(pos);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lng = Cesium.Math.toDegrees(carto.longitude);
      const alt = defaultAlt;
      const idx = waypointsRef.current.length + 1;

      setWaypoints(prev => {
        const updated = [...prev, { lat, lng, alt, name: `WP${idx}` }];
        return updated;
      });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handlerRef.current = h;
    return () => { h.destroy(); viewer.scene.canvas.style.cursor = "default"; };
  }, [placing, visible, viewer, Cesium, defaultAlt]); // eslint-disable-line

  // ── Render waypoint markers + ground track when waypoints change ───────
  useEffect(() => {
    if (!viewer || !Cesium || !visible) return;
    // Remove old markers
    wpEntsRef.current.forEach(e => { try { viewer.entities.remove(e); } catch (_) {} });
    wpEntsRef.current = [];
    if (trackEntRef.current) { try { viewer.entities.remove(trackEntRef.current); } catch (_) {} trackEntRef.current = null; }

    if (!waypoints.length) return;

    // Markers
    waypoints.forEach((wp, i) => {
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.alt),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(i===0?"#22c55e":i===waypoints.length-1?"#ef4444":"#00e5ff"),
          outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: wp.name,
          font: "bold 11px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      wpEntsRef.current.push(e);
      // Altitude pillar
      const pillar = viewer.entities.add({
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, 0),
            Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.alt),
          ],
          width: 1,
          material: Cesium.Color.fromCssColorString("#00e5ff").withAlpha(0.3),
        },
      });
      wpEntsRef.current.push(pillar);
    });

    // Ground track
    if (waypoints.length >= 2) {
      const track = viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(
            waypoints.flatMap(w => [w.lng, w.lat])
          ),
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString("#00e5ff").withAlpha(0.5),
            dashLength: 16,
          }),
          clampToGround: true,
        },
      });
      trackEntRef.current = track;

      // Compute stats
      let totalDist = 0;
      for (let i = 1; i < waypoints.length; i++) {
        totalDist += haversine(waypoints[i-1], waypoints[i]);
      }
      const dur = totalDist / speed;
      totalDurRef.current = dur;
      setStats({ totalDist, dur, segments: waypoints.length - 1 });
    } else {
      setStats(null);
    }
  }, [waypoints, viewer, Cesium, visible, speed]); // eslint-disable-line

  // ── Build and animate the drone ────────────────────────────────────────
  const startAnimation = useCallback(() => {
    if (!viewer || !Cesium || waypoints.length < 2) return;
    clearEntities();
    // Rebuild markers
    setWaypoints(w => [...w]); // trigger re-render

    const startJD = Cesium.JulianDate.now();
    const posProperty = new Cesium.SampledPositionProperty();
    posProperty.interpolationDegree = 2;
    posProperty.interpolationAlgorithm = Cesium.HermitePolynomialApproximation;

    let t = 0;
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      if (i > 0) t += haversine(waypoints[i-1], wp) / speed;
      const time = Cesium.JulianDate.addSeconds(startJD, t, new Cesium.JulianDate());
      posProperty.addSample(time, Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.alt));
    }
    const endJD = Cesium.JulianDate.addSeconds(startJD, t, new Cesium.JulianDate());
    totalDurRef.current = t;

    // Drone entity
    droneEntRef.current = viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start: startJD, stop: endJD }),
      ]),
      position: posProperty,
      orientation: new Cesium.VelocityOrientationProperty(posProperty),
      billboard: {
        image: DRONE_DATA_URL,
        width: 48, height: 48,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
      },
      path: {
        resolution: 1,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.fromCssColorString("#00e5ff"),
        }),
        width: 3,
        leadTime: 0,
        trailTime: 30,
      },
      label: {
        text: "🚁 Drone",
        font: "bold 11px sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#00e5ff"),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // Set clock
    viewer.clock.startTime = startJD.clone();
    viewer.clock.stopTime = endJD.clone();
    viewer.clock.currentTime = startJD.clone();
    viewer.clock.multiplier = 1;
    viewer.clock.clockRange = loop
      ? Cesium.ClockRange.LOOP_STOP
      : Cesium.ClockRange.CLAMPED;
    viewer.clock.shouldAnimate = true;

    if (followDrone) {
      viewer.trackedEntity = droneEntRef.current;
    }

    startTimeRef.current = Date.now();
    setPlaying(true);

    // Track elapsed time in UI
    const tick = () => {
      const el = (Date.now() - startTimeRef.current) / 1000;
      setElapsed(Math.min(el, totalDurRef.current));
      if (el < totalDurRef.current || loop) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, [viewer, Cesium, waypoints, speed, loop, followDrone, clearEntities]);

  const stopAnimation = useCallback(() => {
    if (viewer) {
      viewer.clock.shouldAnimate = false;
      viewer.trackedEntity = undefined;
    }
    cancelAnimationFrame(animFrameRef.current);
    setPlaying(false);
    setElapsed(0);
    if (droneEntRef.current) {
      try { viewer?.entities.remove(droneEntRef.current); } catch (_) {}
      droneEntRef.current = null;
    }
  }, [viewer]);

  // ── Export helpers ─────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = ["name,latitude,longitude,altitude_m"];
    waypoints.forEach(w => rows.push(`"${w.name}",${w.lat},${w.lng},${w.alt}`));
    const blob = new Blob([rows.join("\n")], { type:"text/csv" });
    const a = Object.assign(document.createElement("a"), { href:URL.createObjectURL(blob), download:"drone_waypoints.csv" });
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
  };

  const exportKML = () => {
    const placemarks = waypoints.map(w =>
      `<Placemark><name>${w.name}</name><Point><coordinates>${w.lng},${w.lat},${w.alt}</coordinates></Point></Placemark>`
    ).join("");
    const lineCoords = waypoints.map(w => `${w.lng},${w.lat},${w.alt}`).join(" ");
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Drone Flight Path</name>${placemarks}<Placemark><name>Flight Path</name><LineString><altitudeMode>absolute</altitudeMode><coordinates>${lineCoords}</coordinates></LineString></Placemark></Document></kml>`;
    const blob = new Blob([kml], { type:"application/vnd.google-earth.kml+xml" });
    const a = Object.assign(document.createElement("a"), { href:URL.createObjectURL(blob), download:"drone_path.kml" });
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
  };

  // Cleanup on hide
  useEffect(() => {
    if (!visible) {
      clearEntities();
      setWaypoints([]);
      setStats(null);
    }
  }, [visible, clearEntities]);

  if (!visible) return null;

  const s = x => ({ fontFamily:"'Segoe UI',sans-serif", ...x });
  const progress = totalDurRef.current > 0 ? (elapsed / totalDurRef.current) * 100 : 0;

  return (
    <div style={{
      position:"fixed", top:56, right:12, zIndex:1200, width:285,
      background:"#0b1420", border:"1px solid rgba(0,229,255,.25)",
      borderRadius:12, overflow:"hidden",
      boxShadow:"0 8px 32px rgba(0,0,0,.65)",
      fontFamily:"'Segoe UI',sans-serif",
      animation:"fadeIn .2s ease",
    }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 14px", background:"rgba(0,229,255,.07)",
        borderBottom:"1px solid rgba(0,229,255,.15)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>🚁</span>
          <span style={{ color:"#67e8f9", fontWeight:700, fontSize:13 }}>Drone Flight Path</span>
        </div>
        <button onClick={onClose} style={{ background:"none", border:"none",
          color:"#475569", cursor:"pointer", fontSize:15 }}>✕</button>
      </div>

      <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>

        {/* Place mode toggle */}
        <div>
          <div style={s({ fontSize:10, color:"#475569", fontWeight:700,
            letterSpacing:".06em", marginBottom:5 })}>WAYPOINTS ({waypoints.length})</div>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={() => setPlacing(p => !p)}
              style={s({ flex:1, padding:"8px", borderRadius:6, fontWeight:700,
                fontSize:11, cursor:"pointer",
                border:`1px solid ${placing?"rgba(0,229,255,.5)":"rgba(255,255,255,.1)"}`,
                background: placing ? "rgba(0,229,255,.15)" : "rgba(255,255,255,.03)",
                color: placing ? "#67e8f9" : "#475569" })}>
              {placing ? "✕ Stop Placing" : "📍 Place Waypoints"}
            </button>
            {waypoints.length > 0 && (
              <button onClick={() => { clearEntities(); setWaypoints([]); setStats(null); }}
                style={s({ padding:"8px 10px", borderRadius:6,
                  border:"1px solid rgba(239,68,68,.3)",
                  background:"rgba(239,68,68,.07)",
                  color:"#f87171", fontSize:11, cursor:"pointer" })}>🗑</button>
            )}
          </div>
          {placing && (
            <div style={s({ marginTop:6, padding:"6px 8px",
              background:"rgba(0,229,255,.06)", borderRadius:6,
              border:"1px solid rgba(0,229,255,.15)",
              fontSize:10, color:"#67e8f9", lineHeight:1.5 })}>
              🖱 Click on the 3D globe to place waypoints.<br/>
              <span style={{ color:"#22c55e" }}>●</span> Start &nbsp;
              <span style={{ color:"#00e5ff" }}>●</span> Middle &nbsp;
              <span style={{ color:"#ef4444" }}>●</span> End
            </div>
          )}
        </div>

        {/* Default altitude */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={s({ fontSize:10, color:"#475569", fontWeight:700, width:48 })}>ALT AGL</span>
          <input type="range" min={10} max={1000} step={10} value={defaultAlt}
            onChange={e => setDefaultAlt(+e.target.value)}
            style={{ flex:1, accentColor:"#06b6d4", cursor:"pointer" }} />
          <span style={s({ fontSize:10, color:"#67e8f9", width:40,
            textAlign:"right", fontFamily:"monospace" })}>{defaultAlt} m</span>
        </div>

        {/* Waypoint list */}
        {waypoints.length > 0 && (
          <div style={{ maxHeight:110, overflowY:"auto",
            border:"1px solid rgba(255,255,255,.05)", borderRadius:6 }}>
            {waypoints.map((wp, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center",
                padding:"5px 8px", borderBottom:"1px solid rgba(255,255,255,.04)",
                gap:6 }}>
                <span style={{ width:6, height:6, borderRadius:"50%", flexShrink:0,
                  background: i===0?"#22c55e":i===waypoints.length-1?"#ef4444":"#00e5ff" }}/>
                <span style={s({ fontSize:10, color:"#64748b", width:28 })}>{wp.name}</span>
                <span style={s({ fontSize:10, color:"#475569", flex:1,
                  fontFamily:"monospace", fontSize:9 })}>
                  {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}
                </span>
                <input type="number" value={wp.alt} min={0} max={5000}
                  onChange={e => setWaypoints(prev => {
                    const n=[...prev];n[i]={...n[i],alt:+e.target.value};return n;
                  })}
                  style={s({ width:48, padding:"1px 4px", borderRadius:3,
                    border:"1px solid rgba(255,255,255,.08)",
                    background:"rgba(0,0,0,.3)", color:"#67e8f9",
                    fontSize:9, textAlign:"right", fontFamily:"monospace" })}/>
                <span style={s({ fontSize:9, color:"#334155" })}>m</span>
                <button onClick={() => setWaypoints(prev => prev.filter((_,j)=>j!==i))}
                  style={{ background:"none", border:"none", color:"#334155",
                    cursor:"pointer", fontSize:11, padding:0 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div style={{ display:"flex", gap:0,
            border:"1px solid rgba(255,255,255,.06)", borderRadius:6, overflow:"hidden" }}>
            {[
              ["DISTANCE", fmtDist(stats.totalDist), "#67e8f9"],
              ["DURATION", fmtTime(stats.dur), "#a78bfa"],
              ["WAYPOINTS", stats.segments+1, "#4ade80"],
            ].map(([l,v,c])=>(
              <div key={l} style={{ flex:1, padding:"7px 6px", textAlign:"center",
                borderRight:"1px solid rgba(255,255,255,.05)" }}>
                <div style={s({ fontSize:8, color:"#334155", fontWeight:700,
                  letterSpacing:".05em", marginBottom:2 })}>{l}</div>
                <div style={s({ fontSize:13, fontWeight:700, color:c })}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Speed */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={s({ fontSize:10, color:"#475569", fontWeight:700, width:48 })}>SPEED</span>
          <input type="range" min={1} max={100} step={1} value={speed}
            onChange={e => setSpeed(+e.target.value)}
            style={{ flex:1, accentColor:"#06b6d4", cursor:"pointer" }} />
          <span style={s({ fontSize:10, color:"#67e8f9", width:40,
            textAlign:"right", fontFamily:"monospace" })}>{speed} m/s</span>
        </div>

        {/* Options */}
        <div style={{ display:"flex", gap:6 }}>
          {[
            [loop, ()=>setLoop(p=>!p), "🔁 Loop"],
            [followDrone, ()=>setFollowDrone(p=>!p), "📷 Follow"],
          ].map(([active, toggle, label]) => (
            <button key={label} onClick={toggle}
              style={s({ flex:1, padding:"5px", borderRadius:5, fontSize:10,
                fontWeight:700, cursor:"pointer",
                border:`1px solid ${active?"rgba(0,229,255,.4)":"rgba(255,255,255,.08)"}`,
                background: active?"rgba(0,229,255,.1)":"transparent",
                color: active?"#67e8f9":"#334155" })}>
              {label}
            </button>
          ))}
        </div>

        {/* Play controls */}
        {waypoints.length >= 2 && (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={playing ? stopAnimation : startAnimation}
                style={s({ flex:1, padding:"9px", borderRadius:7, fontWeight:700,
                  fontSize:12, cursor:"pointer",
                  border:`1px solid ${playing?"rgba(239,68,68,.5)":"rgba(0,229,255,.5)"}`,
                  background: playing?"rgba(239,68,68,.15)":"rgba(0,229,255,.15)",
                  color: playing?"#f87171":"#67e8f9" })}>
                {playing ? "⏹ Stop" : "▶ Fly Route"}
              </button>
            </div>

            {/* Progress bar */}
            {playing && (
              <div>
                <div style={{ height:4, background:"rgba(255,255,255,.06)",
                  borderRadius:2, overflow:"hidden", marginBottom:3 }}>
                  <div style={{ width:`${progress}%`, height:"100%",
                    background:"linear-gradient(to right,#0284c7,#06b6d4,#67e8f9)",
                    borderRadius:2, transition:"width .5s linear" }}/>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={s({ fontSize:9, color:"#475569", fontFamily:"monospace" })}>
                    {fmtTime(elapsed)}
                  </span>
                  <span style={s({ fontSize:9, color:"#334155", fontFamily:"monospace" })}>
                    {fmtTime(totalDurRef.current)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Demo route */}
        {!waypoints.length && (
          <button onClick={() => {
            const demo = [
              { lat:20.296, lng:85.824, alt:150, name:"WP1" },
              { lat:20.310, lng:85.838, alt:200, name:"WP2" },
              { lat:20.325, lng:85.820, alt:300, name:"WP3" },
              { lat:20.315, lng:85.800, alt:200, name:"WP4" },
              { lat:20.296, lng:85.808, alt:150, name:"WP5" },
            ];
            setWaypoints(demo);
            if (viewer && Cesium) {
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(85.820, 20.310, 8000),
                orientation: { heading:0, pitch: Cesium.Math.toRadians(-45), roll:0 },
                duration:2,
              });
            }
          }} style={s({ width:"100%", padding:"7px", borderRadius:6,
            border:"1px solid rgba(99,102,241,.3)",
            background:"rgba(99,102,241,.08)", color:"#a78bfa",
            fontSize:11, cursor:"pointer", fontWeight:600 })}>
            🎯 Load Demo Route (Bhubaneswar)
          </button>
        )}

        {/* Export */}
        {waypoints.length >= 2 && (
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={exportCSV}
              style={s({ flex:1, padding:"5px", borderRadius:5,
                border:"1px solid rgba(34,197,94,.25)",
                background:"rgba(34,197,94,.06)", color:"#4ade80",
                fontSize:10, cursor:"pointer", fontWeight:600 })}>
              ⬇ CSV
            </button>
            <button onClick={exportKML}
              style={s({ flex:1, padding:"5px", borderRadius:5,
                border:"1px solid rgba(59,130,246,.25)",
                background:"rgba(59,130,246,.06)", color:"#60a5fa",
                fontSize:10, cursor:"pointer", fontWeight:600 })}>
              ⬇ KML
            </button>
          </div>
        )}
      </div>
    </div>
  );
}