/**
 * HeatmapLayer.jsx — SurveyMap Pro
 * Renders a WebGL heatmap on the Cesium 3D globe from lat/lng point data.
 * Uses a custom Canvas-based imagery provider — no external lib needed.
 *
 * Usage:
 *   import HeatmapLayer from "./HeatmapLayer";
 *   <HeatmapLayer viewer={viewerRef.current} Cesium={CesiumRef.current} />
 *
 * Or integrate the hook useHeatmap() directly into Globe3DView.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import Papa from "papaparse";

// ── Constants ──────────────────────────────────────────────────────────────
const LAT_KEYS = ["latitude","lat","y","ylat","lat_deg"];
const LNG_KEYS = ["longitude","lng","lon","long","x","xlon","lng_deg"];
const WEIGHT_KEYS = ["weight","value","intensity","magnitude","count","score","density","w"];

function findCol(headers, keys) {
  return headers.find(h => keys.includes(h.toLowerCase().trim())) ||
         headers.find(h => keys.some(k => h.toLowerCase().includes(k)));
}

// ── Core heatmap renderer ─────────────────────────────────────────────────
// Draws gaussian blobs on a canvas tile, returns ImageData
function renderHeatmapTile(points, tileX, tileY, tileLevel, tileSize, radius, colorStops) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = tileSize;
  const ctx = canvas.getContext("2d");

  // Convert tile to degrees bounds
  const n = Math.pow(2, tileLevel);
  const lon0 = (tileX / n) * 360 - 180;
  const lon1 = ((tileX + 1) / n) * 360 - 180;
  const latRad0 = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n)));
  const latRad1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + 1) / n)));
  const lat0 = latRad0 * 180 / Math.PI;
  const lat1 = latRad1 * 180 / Math.PI;

  // Filter only points in this tile (with radius padding)
  const lonPad = (lon1 - lon0) * (radius / tileSize) * 3;
  const latPad = (lat0 - lat1) * (radius / tileSize) * 3;
  const local = points.filter(p =>
    p.lng >= lon0 - lonPad && p.lng <= lon1 + lonPad &&
    p.lat >= lat1 - latPad && p.lat <= lat0 + latPad
  );
  if (!local.length) return null;

  // Draw intensity layer (alpha = intensity)
  const alphaCanvas = document.createElement("canvas");
  alphaCanvas.width = alphaCanvas.height = tileSize;
  const aC = alphaCanvas.getContext("2d");

  for (const pt of local) {
    const px = ((pt.lng - lon0) / (lon1 - lon0)) * tileSize;
    const py = ((lat0 - pt.lat) / (lat0 - lat1)) * tileSize;
    const r = radius * (pt.weight || 1);
    const grad = aC.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, `rgba(0,0,0,${Math.min(0.9, 0.4 * (pt.weight || 1))})`);
    grad.addColorStop(0.4, `rgba(0,0,0,${Math.min(0.5, 0.2 * (pt.weight || 1))})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    aC.fillStyle = grad;
    aC.beginPath();
    aC.arc(px, py, r, 0, Math.PI * 2);
    aC.fill();
  }

  // Colorize using gradient lookup
  const imgData = aC.getImageData(0, 0, tileSize, tileSize);
  const palette = buildPalette(colorStops);
  const out = ctx.createImageData(tileSize, tileSize);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const alpha = imgData.data[i + 3];
    if (alpha === 0) continue;
    const idx = Math.min(255, Math.floor(alpha));
    out.data[i]     = palette[idx * 4];
    out.data[i + 1] = palette[idx * 4 + 1];
    out.data[i + 2] = palette[idx * 4 + 2];
    out.data[i + 3] = Math.min(230, alpha * 2);
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// Build 256-entry RGBA palette from color stops
function buildPalette(stops) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 1;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  stops.forEach(([pos, color]) => grad.addColorStop(pos, color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 1);
  return ctx.getImageData(0, 0, 256, 1).data;
}

// Color ramp presets
const RAMPS = {
  fire:    [[0,"rgba(0,0,128,0)"],[0.2,"rgba(0,0,255,0.6)"],[0.4,"rgba(0,255,255,0.8)"],[0.6,"rgba(0,255,0,1)"],[0.8,"rgba(255,255,0,1)"],[1,"rgba(255,0,0,1)"]],
  cool:    [[0,"rgba(0,0,0,0)"],[0.3,"rgba(0,100,255,0.5)"],[0.6,"rgba(0,200,255,0.8)"],[1,"rgba(255,255,255,1)"]],
  plasma:  [[0,"rgba(0,0,0,0)"],[0.25,"rgba(80,0,150,0.7)"],[0.5,"rgba(200,0,100,0.85)"],[0.75,"rgba(255,120,0,1)"],[1,"rgba(255,255,0,1)"]],
  density: [[0,"rgba(0,0,0,0)"],[0.2,"rgba(0,80,0,0.4)"],[0.5,"rgba(255,255,0,0.75)"],[0.8,"rgba(255,100,0,0.9)"],[1,"rgba(200,0,0,1)"]],
};

// ── Custom Cesium ImageryProvider ─────────────────────────────────────────
function createHeatmapProvider(Cesium, points, radius, ramp) {
  const tileSize = 256;
  const colorStops = RAMPS[ramp] || RAMPS.fire;

  return new Cesium.UrlTemplateImageryProvider({
    url: "https://placeholder/{z}/{x}/{y}", // dummy — we override requestImage
    maximumLevel: 18,
    minimumLevel: 0,
    tileWidth: tileSize,
    tileHeight: tileSize,
    credit: "SurveyMap Pro Heatmap",
    // Override the actual tile fetcher
    requestImage: (x, y, level) => {
      return new Promise((resolve) => {
        const canvas = renderHeatmapTile(points, x, y, level, tileSize, radius, colorStops);
        resolve(canvas || document.createElement("canvas"));
      });
    },
  });
}

// ── Main Component ────────────────────────────────────────────────────────
export default function HeatmapLayer({ viewer, Cesium, visible, onClose }) {
  const [points, setPoints] = useState([]); // [{lat,lng,weight}]
  const [radius, setRadius] = useState(40);
  const [ramp, setRamp] = useState("fire");
  const [opacity, setOpacity] = useState(0.75);
  const [status, setStatus] = useState(null); // null|"loading"|"done"|"error"
  const [stats, setStats] = useState(null);
  const layerRef = useRef(null);
  const fileRef = useRef(null);

  // ── Rebuild heatmap whenever points/settings change ────────────────────
  useEffect(() => {
    if (!viewer || !Cesium || !visible) return;
    // Remove old layer
    if (layerRef.current) {
      try { viewer.imageryLayers.remove(layerRef.current, true); } catch (_) {}
      layerRef.current = null;
    }
    if (!points.length) return;

    // Normalize weights 0-1
    const maxW = Math.max(...points.map(p => p.weight));
    const normalized = points.map(p => ({ ...p, weight: maxW > 0 ? p.weight / maxW : 1 }));

    const provider = createHeatmapProvider(Cesium, normalized, radius, ramp);
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = opacity;
    layerRef.current = layer;
  }, [points, radius, ramp, visible, viewer, Cesium]); // eslint-disable-line

  // Sync opacity without rebuild
  useEffect(() => {
    if (layerRef.current) layerRef.current.alpha = opacity;
  }, [opacity]);

  // Cleanup on unmount/hide
  useEffect(() => {
    if (!visible && layerRef.current) {
      try { viewer?.imageryLayers.remove(layerRef.current, true); } catch (_) {}
      layerRef.current = null;
    }
  }, [visible]); // eslint-disable-line

  const handleFile = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setStatus("loading");
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete(res) {
        const rows = res.data;
        if (!rows.length) { setStatus("error"); return; }
        const headers = Object.keys(rows[0]);
        const latKey = findCol(headers, LAT_KEYS);
        const lngKey = findCol(headers, LNG_KEYS);
        const wKey   = findCol(headers, WEIGHT_KEYS);
        if (!latKey || !lngKey) { setStatus("error"); return; }

        const pts = rows.slice(0, 50000).map(r => {
          const lat = parseFloat(r[latKey]);
          const lng = parseFloat(r[lngKey]);
          const weight = wKey ? (parseFloat(r[wKey]) || 1) : 1;
          return isFinite(lat) && isFinite(lng) ? { lat, lng, weight } : null;
        }).filter(Boolean);

        if (!pts.length) { setStatus("error"); return; }

        const weights = pts.map(p => p.weight);
        setStats({
          count: pts.length,
          minW: Math.min(...weights).toFixed(2),
          maxW: Math.max(...weights).toFixed(2),
          hasWeight: !!wKey,
          weightCol: wKey,
        });
        setPoints(pts);
        setStatus("done");

        // Fly to data bounds
        if (viewer) {
          const lats = pts.map(p => p.lat);
          const lngs = pts.map(p => p.lng);
          viewer.camera.flyTo({
            destination: Cesium.Rectangle.fromDegrees(
              Math.min(...lngs), Math.min(...lats),
              Math.max(...lngs), Math.max(...lats)
            ),
            duration: 2,
          });
        }
      },
      error() { setStatus("error"); },
    });
  }, [viewer, Cesium]); // eslint-disable-line

  if (!visible) return null;

  const F = "font-family:'Segoe UI',sans-serif";
  const s = (x) => ({ fontFamily: "'Segoe UI',sans-serif", ...x });

  return (
    <div style={{
      position: "fixed", top: 56, right: 12, zIndex: 1200,
      width: 272, background: "#0f1923",
      border: "1px solid rgba(239,68,68,.3)",
      borderRadius: 12, overflow: "hidden",
      boxShadow: "0 8px 32px rgba(0,0,0,.6)",
      fontFamily: "'Segoe UI',sans-serif",
      animation: "fadeIn .2s ease",
    }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 14px", background:"rgba(239,68,68,.1)",
        borderBottom:"1px solid rgba(239,68,68,.2)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>🌡️</span>
          <span style={{ color:"#fca5a5", fontWeight:700, fontSize:13 }}>Heatmap</span>
        </div>
        <button onClick={onClose} style={{ background:"none", border:"none",
          color:"#475569", cursor:"pointer", fontSize:15 }}>✕</button>
      </div>

      <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>

        {/* Upload */}
        <div>
          <div style={s({ fontSize:10, color:"#475569", fontWeight:700,
            letterSpacing:".06em", marginBottom:5 })}>DATA SOURCE</div>
          <button onClick={() => fileRef.current?.click()}
            style={s({ width:"100%", padding:"8px", borderRadius:6,
              border:"1px dashed rgba(239,68,68,.35)",
              background: status==="done" ? "rgba(34,197,94,.07)" : "rgba(239,68,68,.06)",
              color: status==="done" ? "#4ade80" : "#f87171",
              fontSize:11, cursor:"pointer", fontWeight:600 })}>
            {status === "loading" ? "⏳ Parsing…"
              : status === "done"  ? `✅ ${stats?.count?.toLocaleString()} points loaded`
              : status === "error" ? "❌ Error — try again"
              : "📂 Upload CSV with lat/lng"}
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile}
            style={{ display:"none" }} />
          {stats && (
            <div style={s({ fontSize:10, color:"#475569", marginTop:4, lineHeight:1.5 })}>
              {stats.hasWeight
                ? <>Weight: <span style={{ color:"#fbbf24" }}>{stats.weightCol}</span> · range {stats.minW}–{stats.maxW}</>
                : "No weight column — all points equal intensity"
              }
            </div>
          )}
        </div>

        {/* Color ramp */}
        <div>
          <div style={s({ fontSize:10, color:"#475569", fontWeight:700,
            letterSpacing:".06em", marginBottom:5 })}>COLOR RAMP</div>
          <div style={{ display:"flex", gap:4 }}>
            {Object.entries({
              fire:"🔥 Fire", cool:"❄️ Cool", plasma:"🔮 Plasma", density:"🌿 Density"
            }).map(([k, label]) => (
              <button key={k} onClick={() => setRamp(k)}
                style={s({ flex:1, padding:"4px 2px", borderRadius:4, fontSize:9,
                  fontWeight:700, cursor:"pointer",
                  border:`1px solid ${ramp===k?"rgba(239,68,68,.5)":"rgba(255,255,255,.08)"}`,
                  background: ramp===k ? "rgba(239,68,68,.18)" : "transparent",
                  color: ramp===k ? "#fca5a5" : "#475569" })}>
                {label}
              </button>
            ))}
          </div>
          {/* Ramp preview */}
          <div style={{ marginTop:5, height:8, borderRadius:3,
            background: ramp==="fire"    ? "linear-gradient(to right,#00008b,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000)"
                      : ramp==="cool"    ? "linear-gradient(to right,#000,#0064ff,#00c8ff,#fff)"
                      : ramp==="plasma"  ? "linear-gradient(to right,#000,#500096,#c80064,#ff7800,#ffff00)"
                      :                   "linear-gradient(to right,#000,#005000,#ffff00,#ff6400,#c80000)"
          }}/>
        </div>

        {/* Radius */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={s({ fontSize:10, color:"#475569", fontWeight:700, width:42 })}>RADIUS</span>
          <input type="range" min={10} max={120} step={5} value={radius}
            onChange={e => setRadius(+e.target.value)}
            style={{ flex:1, accentColor:"#ef4444", cursor:"pointer" }} />
          <span style={s({ fontSize:10, color:"#fca5a5", width:26, textAlign:"right",
            fontFamily:"monospace" })}>{radius}px</span>
        </div>

        {/* Opacity */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={s({ fontSize:10, color:"#475569", fontWeight:700, width:42 })}>OPACITY</span>
          <input type="range" min={0.1} max={1} step={0.05} value={opacity}
            onChange={e => setOpacity(+e.target.value)}
            style={{ flex:1, accentColor:"#ef4444", cursor:"pointer" }} />
          <span style={s({ fontSize:10, color:"#fca5a5", width:26, textAlign:"right",
            fontFamily:"monospace" })}>{Math.round(opacity*100)}%</span>
        </div>

        {/* Demo button */}
        {!points.length && (
          <button onClick={() => {
            // Generate demo points — simulates city density
            const base = { lat: 20.2961, lng: 85.8245 }; // Bhubaneswar
            const demo = Array.from({ length: 800 }, (_, i) => ({
              lat: base.lat + (Math.random() - 0.5) * 0.3,
              lng: base.lng + (Math.random() - 0.5) * 0.3,
              weight: Math.pow(Math.random(), 2), // skewed toward low
            }));
            // Add hotspot clusters
            for (let c = 0; c < 5; c++) {
              const cx = base.lat + (Math.random() - 0.5) * 0.2;
              const cy = base.lng + (Math.random() - 0.5) * 0.2;
              for (let i = 0; i < 120; i++) {
                demo.push({
                  lat: cx + (Math.random() - 0.5) * 0.02,
                  lng: cy + (Math.random() - 0.5) * 0.02,
                  weight: 0.7 + Math.random() * 0.3,
                });
              }
            }
            setPoints(demo);
            setStatus("done");
            setStats({ count: demo.length, hasWeight: true, weightCol: "demo", minW: "0", maxW: "1" });
            if (viewer && Cesium) {
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(85.8245, 20.2961, 35000),
                duration: 2,
              });
            }
          }} style={s({ width:"100%", padding:"7px", borderRadius:6,
            border:"1px solid rgba(99,102,241,.3)",
            background:"rgba(99,102,241,.08)", color:"#a78bfa",
            fontSize:11, cursor:"pointer", fontWeight:600 })}>
            🎯 Load Demo (Bhubaneswar)
          </button>
        )}

        {points.length > 0 && (
          <button onClick={() => { setPoints([]); setStatus(null); setStats(null); }}
            style={s({ width:"100%", padding:"6px", borderRadius:6,
              border:"1px solid rgba(100,116,139,.25)",
              background:"transparent", color:"#475569",
              fontSize:11, cursor:"pointer" })}>
            🗑 Clear Heatmap
          </button>
        )}

        <div style={s({ fontSize:10, color:"#334155", lineHeight:1.5 })}>
          💡 CSV needs <code style={{ color:"#60a5fa" }}>lat</code> &amp; <code style={{ color:"#60a5fa" }}>lng</code> columns. Optional <code style={{ color:"#fbbf24" }}>weight</code> column for intensity. Max 50,000 points.
        </div>
      </div>
    </div>
  );
}