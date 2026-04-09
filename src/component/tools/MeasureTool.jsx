/**
 * MeasureTool.jsx — SurveyMap Pro
 * Google Earth Pro-style measurement tool:
 *  • Every click adds a numbered node with a white dot + black border
 *  • Each segment shows its distance label at the midpoint (yellow pill)
 *  • Running total label follows the last point (green pill, top)
 *  • Dashed orange preview line tracks mouse cursor
 *  • Double-click finishes; right-click clears
 *  • Panel shows: Live Measurement (all segments) | Area | Manual Entry
 *  • Right-click on KML/KMZ/CSV/GeoJSON layers → Properties panel
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { haversine, formatDist, UNIT_DEFS } from "../map/measureUtils";

const UNITS = UNIT_DEFS;

const AREA_UNITS = [
  { key: "m2",  label: "Square metres",     abbr: "m²",  factor: 1,           dp: 2 },
  { key: "km2", label: "Square kilometres", abbr: "km²", factor: 1e-6,         dp: 6 },
  { key: "ha",  label: "Hectares",          abbr: "ha",  factor: 1e-4,         dp: 4 },
  { key: "ac",  label: "Acres",             abbr: "ac",  factor: 0.000247105,  dp: 4 },
  { key: "ft2", label: "Square feet",       abbr: "ft²", factor: 10.7639,      dp: 2 },
  { key: "mi2", label: "Square miles",      abbr: "mi²", factor: 3.861e-7,     dp: 8 },
];

// ── CSS injected once ─────────────────────────────────────────────────────────
const LABEL_CSS = `
  /* Segment distance label — yellow pill */
  .mt-seg-label {
    background: rgba(10, 14, 26, 0.92);
    color: #fbbf24;
    border: 1.5px solid rgba(251,191,36,0.55);
    border-radius: 5px;
    padding: 2px 7px;
    font-size: 10.5px;
    font-weight: 800;
    font-family: 'Courier New', monospace;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    letter-spacing: 0.02em;
  }
  /* Running total label — green pill */
  .mt-total-label {
    background: rgba(10, 14, 26, 0.95);
    color: #22c55e;
    border: 1.5px solid rgba(34,197,94,0.55);
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 800;
    font-family: 'Courier New', monospace;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 10px rgba(0,0,0,0.6);
  }
  /* Node index label — tiny grey */
  .mt-node-label {
    background: rgba(10,14,26,0.88);
    color: #e2e8f0;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 9px;
    font-family: 'Courier New', monospace;
    font-weight: 700;
    pointer-events: none;
    white-space: nowrap;
  }
  /* Area centroid label — blue pill */
  .mt-area-label {
    background: rgba(10,14,26,0.93);
    color: #60a5fa;
    border: 1.5px solid rgba(96,165,250,0.5);
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 800;
    font-family: 'Courier New', monospace;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 10px rgba(0,0,0,0.55);
  }
  /* Google Earth context menu */
  .ge-context-menu {
    position: fixed;
    z-index: 9999;
    background: #fff;
    border: 1px solid #bbb;
    border-radius: 3px;
    box-shadow: 3px 5px 16px rgba(0,0,0,0.28);
    min-width: 200px;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    overflow: hidden;
  }
  .ge-context-item {
    padding: 6px 18px;
    cursor: pointer;
    color: #202124;
    user-select: none;
  }
  .ge-context-item:hover { background: #e8f0fe; }
  .ge-context-divider { border-top: 1px solid #e0e0e0; margin: 3px 0; }
  .ge-context-item.disabled { color: #aaa; cursor: default; }
  .ge-context-item.disabled:hover { background: none; }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function toUnit(metres, key) {
  const u = UNITS.find(u => u.key === key);
  return u ? metres * u.factor : metres;
}
function fromUnit(value, key) {
  const u = UNITS.find(u => u.key === key);
  return u ? value / u.factor : value;
}
function fmtVal(metres, key) {
  const u = UNITS.find(u => u.key === key);
  if (!u) return metres.toFixed(2);
  return toUnit(metres, key).toFixed(u.dp);
}
function toAreaUnit(m2, key) {
  const u = AREA_UNITS.find(u => u.key === key);
  return u ? m2 * u.factor : m2;
}
function fmtArea(m2, key) {
  const u = AREA_UNITS.find(u => u.key === key);
  if (!u) return m2.toFixed(2);
  return toAreaUnit(m2, key).toFixed(u.dp);
}

// Smart distance formatter — picks best unit automatically
function smartDist(metres) {
  if (metres >= 1000)  return `${(metres / 1000).toFixed(3)} km`;
  if (metres >= 1)     return `${metres.toFixed(2)} m`;
  return `${(metres * 100).toFixed(1)} cm`;
}

// Spherical-excess polygon area (m²)
function calcPolygonArea(points) {
  if (points.length < 3) return 0;
  const R = 6371000;
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = points[i][0] * Math.PI / 180;
    const lat2 = points[j][0] * Math.PI / 180;
    const dLng = (points[j][1] - points[i][1]) * Math.PI / 180;
    area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R * R / 2);
}

function calcTotal(points) {
  let t = 0;
  for (let i = 1; i < points.length; i++) t += haversine(points[i - 1], points[i]);
  return t;
}

// ── Properties Dialog ─────────────────────────────────────────────────────────
function PropertiesDialog({ layer, onClose }) {
  const [activeTab, setActiveTab] = useState("Measurements");
  const [name, setName] = useState(
    layer?.name || layer?.feature?.properties?.name || "Unnamed Layer"
  );
  const props    = layer?.feature?.properties || {};
  const geomType = layer?.feature?.geometry?.type || "Unknown";
  const coords   = layer?.feature?.geometry?.coordinates || [];

  const measurements = (() => {
    if (!layer?.feature) return null;
    const gt = geomType.toLowerCase();
    if (gt === "linestring" || gt === "multilinestring") {
      const pts = gt === "linestring"
        ? coords.map(c => [c[1], c[0]])
        : coords.flat().map(c => [c[1], c[0]]);
      return { type: "line", length: calcTotal(pts), pts };
    }
    if (gt === "polygon" || gt === "multipolygon") {
      const ring = gt === "polygon" ? coords[0] : coords[0][0];
      const pts  = ring.map(c => [c[1], c[0]]);
      return { type: "polygon", perimeter: calcTotal(pts), area: calcPolygonArea(pts), pts };
    }
    if (gt === "point") {
      return { type: "point", lat: coords[1], lng: coords[0] };
    }
    return null;
  })();

  const tabs = ["Description", "Style, Color", "View", "Altitude", "Measurements"];

  return (
    <div style={{
      position:"fixed", top:0, left:0, right:0, bottom:0,
      background:"rgba(0,0,0,0.45)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:9998, fontFamily:"'Segoe UI',Arial,sans-serif",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background:"#f0f0f0", border:"2px solid #888", borderRadius:4,
        minWidth:540, maxWidth:600,
        boxShadow:"4px 8px 24px rgba(0,0,0,0.4)", overflow:"hidden",
      }}>
        {/* Title bar */}
        <div style={{
          background:"linear-gradient(180deg,#5b7fc1,#3a5fa0)",
          padding:"6px 10px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
        }}>
          <span style={{ color:"#fff", fontWeight:700, fontSize:13 }}>
            Google Earth — Edit Path
          </span>
          <button onClick={onClose} style={{
            background:"#c0392b", border:"none", color:"#fff",
            width:18, height:18, borderRadius:2, cursor:"pointer",
            fontSize:11, fontWeight:700, lineHeight:"18px", textAlign:"center",
          }}>×</button>
        </div>

        {/* Name field */}
        <div style={{ padding:"10px 14px 6px", background:"#f5f5f5", borderBottom:"1px solid #ccc" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <label style={{ fontSize:13, color:"#333", minWidth:38 }}>Name:</label>
            <input value={name} onChange={e => setName(e.target.value)} style={{
              flex:1, padding:"4px 8px", border:"2px inset #999",
              fontSize:13, background:"#fff", color:"#000", outline:"none",
            }}/>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", background:"#d8d8d8", borderBottom:"1px solid #aaa", padding:"4px 6px 0" }}>
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding:"4px 12px", fontSize:12,
              background: activeTab===tab ? "#f0f0f0" : "transparent",
              border: activeTab===tab ? "1px solid #aaa" : "1px solid transparent",
              borderBottom: activeTab===tab ? "1px solid #f0f0f0" : "1px solid #aaa",
              borderRadius:"3px 3px 0 0",
              cursor:"pointer", color:"#333",
              marginBottom: activeTab===tab ? -1 : 0, position:"relative",
            }}>{tab}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ background:"#f0f0f0", padding:16, minHeight:280 }}>
          {activeTab === "Description" && (
            <div>
              <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                {["Add link...","Add web image...","Add local image..."].map(btn => (
                  <button key={btn} style={{ padding:"3px 10px", fontSize:12, background:"#e0e0e0", border:"1px solid #aaa", borderRadius:2, cursor:"pointer" }}>{btn}</button>
                ))}
              </div>
              <textarea style={{ width:"100%", height:200, border:"2px inset #999", resize:"none", fontSize:13, padding:6, boxSizing:"border-box", fontFamily:"'Segoe UI',sans-serif", background:"#fff" }} placeholder="Description..." defaultValue={props.description||""}/>
            </div>
          )}
          {activeTab === "Style, Color" && (
            <div style={{ fontSize:13, color:"#444" }}>
              <div style={{ marginBottom:12 }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>Line Style</div>
                <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                  <label>Color: <input type="color" defaultValue="#ff8800" style={{ marginLeft:8, width:40, height:24 }}/></label>
                  <label>Width: <input type="range" min={1} max={10} defaultValue={2} style={{ marginLeft:8, width:80 }}/></label>
                </div>
              </div>
              <div>
                <div style={{ fontWeight:700, marginBottom:6 }}>Area Style</div>
                <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                  <label>Fill Color: <input type="color" defaultValue="#ff880044" style={{ marginLeft:8, width:40, height:24 }}/></label>
                  <label>Opacity: <input type="range" min={0} max={100} defaultValue={30} style={{ marginLeft:8, width:80 }}/></label>
                </div>
              </div>
            </div>
          )}
          {activeTab === "View" && (
            <div style={{ fontSize:13, color:"#444" }}>
              <div style={{ marginBottom:8 }}><b>Geometry Type:</b> {geomType}</div>
              {measurements?.type === "point" && (<><div><b>Latitude:</b> {measurements.lat?.toFixed(6)}°</div><div><b>Longitude:</b> {measurements.lng?.toFixed(6)}°</div></>)}
              {measurements?.pts && <div><b>Points:</b> {measurements.pts.length}</div>}
              <div style={{ marginTop:10 }}>
                <b>Properties:</b>
                {Object.entries(props).length === 0
                  ? <span style={{ color:"#888" }}> None</span>
                  : <ul style={{ marginTop:4, paddingLeft:18 }}>
                      {Object.entries(props).map(([k,v]) => (
                        <li key={k} style={{ fontSize:12 }}><b>{k}:</b> {String(v)}</li>
                      ))}
                    </ul>
                }
              </div>
            </div>
          )}
          {activeTab === "Altitude" && (
            <div style={{ fontSize:13, color:"#444" }}>
              <p>Altitude mode: <b>Clamp to ground</b></p>
              <label><input type="radio" name="alt" defaultChecked/> Clamp to ground</label><br/>
              <label><input type="radio" name="alt"/> Relative to ground</label><br/>
              <label><input type="radio" name="alt"/> Absolute</label>
            </div>
          )}
          {activeTab === "Measurements" && (
            <MeasurementsTab measurements={measurements} geomType={geomType}/>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"8px 14px", background:"#e8e8e8", borderTop:"1px solid #bbb", display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={{ padding:"4px 20px", fontSize:13, background:"#f0f0f0", border:"1px solid #aaa", borderRadius:2, cursor:"pointer" }}>OK</button>
          <button onClick={onClose} style={{ padding:"4px 20px", fontSize:13, background:"#f0f0f0", border:"1px solid #aaa", borderRadius:2, cursor:"pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function MeasurementsTab({ measurements, geomType }) {
  const [areaUnit, setAreaUnit] = useState("ha");
  const [distUnit, setDistUnit] = useState("km");
  if (!measurements) return (
    <div style={{ color:"#666", fontSize:13, padding:"20px 0" }}>
      No measurement data available for this geometry type ({geomType}).
    </div>
  );
  const { type, length, perimeter, area, lat, lng } = measurements;
  return (
    <div style={{ fontSize:13 }}>
      {type === "point" && (
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <tbody>
            <tr style={{ borderBottom:"1px solid #ddd" }}><td style={{ padding:"6px 4px", color:"#555", width:140 }}>Latitude</td><td style={{ padding:"6px 4px", fontFamily:"monospace", fontWeight:700 }}>{lat?.toFixed(8)}°</td></tr>
            <tr><td style={{ padding:"6px 4px", color:"#555" }}>Longitude</td><td style={{ padding:"6px 4px", fontFamily:"monospace", fontWeight:700 }}>{lng?.toFixed(8)}°</td></tr>
          </tbody>
        </table>
      )}
      {type === "line" && (
        <>
          <div style={{ fontWeight:700, marginBottom:8, color:"#333" }}>Line Measurements</div>
          <div style={{ marginBottom:8 }}>
            <label style={{ marginRight:8, color:"#555" }}>Display unit:</label>
            <select value={distUnit} onChange={e => setDistUnit(e.target.value)} style={{ border:"1px solid #aaa", padding:"2px 6px", fontSize:12 }}>
              {UNITS.map(u => <option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
            </select>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <tbody>
              <tr style={{ background:"#e8f0e8", borderBottom:"2px solid #4a7" }}>
                <td style={{ padding:"8px 6px", fontWeight:700, color:"#2a6" }}>Total Length</td>
                <td style={{ padding:"8px 6px", fontFamily:"monospace", fontWeight:800, color:"#2a6", fontSize:15 }}>
                  {fmtVal(length, distUnit)} {UNITS.find(u => u.key === distUnit)?.abbr}
                </td>
              </tr>
              {UNITS.filter(u => u.key !== distUnit).map(u => (
                <tr key={u.key} style={{ borderBottom:"1px solid #e0e0e0" }}>
                  <td style={{ padding:"5px 6px", color:"#666" }}>{u.label}</td>
                  <td style={{ padding:"5px 6px", fontFamily:"monospace" }}>{fmtVal(length, u.key)} {u.abbr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {type === "polygon" && (
        <>
          <div style={{ fontWeight:700, marginBottom:10, color:"#333" }}>Polygon Measurements</div>
          <div style={{ marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ color:"#555", minWidth:80 }}>Area unit:</span>
            <select value={areaUnit} onChange={e => setAreaUnit(e.target.value)} style={{ border:"1px solid #aaa", padding:"2px 6px", fontSize:12 }}>
              {AREA_UNITS.map(u => <option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
            </select>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", marginBottom:10 }}>
            <tbody>
              <tr style={{ background:"#e8eef8", borderBottom:"2px solid #48a" }}>
                <td style={{ padding:"8px 6px", fontWeight:700, color:"#26a" }}>Area</td>
                <td style={{ padding:"8px 6px", fontFamily:"monospace", fontWeight:800, color:"#26a", fontSize:15 }}>
                  {fmtArea(area, areaUnit)} {AREA_UNITS.find(u => u.key === areaUnit)?.abbr}
                </td>
              </tr>
              {AREA_UNITS.filter(u => u.key !== areaUnit).map(u => (
                <tr key={u.key} style={{ borderBottom:"1px solid #e0e0e0" }}>
                  <td style={{ padding:"4px 6px", color:"#666" }}>{u.label}</td>
                  <td style={{ padding:"4px 6px", fontFamily:"monospace" }}>{fmtArea(area, u.key)} {u.abbr}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ color:"#555", minWidth:80 }}>Dist unit:</span>
            <select value={distUnit} onChange={e => setDistUnit(e.target.value)} style={{ border:"1px solid #aaa", padding:"2px 6px", fontSize:12 }}>
              {UNITS.map(u => <option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
            </select>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <tbody>
              <tr style={{ background:"#f0ece8", borderBottom:"2px solid #a74" }}>
                <td style={{ padding:"6px 6px", fontWeight:700, color:"#853" }}>Perimeter</td>
                <td style={{ padding:"6px 6px", fontFamily:"monospace", fontWeight:700, color:"#853" }}>
                  {fmtVal(perimeter, distUnit)} {UNITS.find(u => u.key === distUnit)?.abbr}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── Context Menu ──────────────────────────────────────────────────────────────
function ContextMenu({ x, y, layer, onClose, onShowProperties, onDelete, onZoomTo }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const h = () => onClose();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const items = [
    { label:"Cut",                   action:null,              disabled:true  },
    { label:"Copy",                  action:null,              disabled:true  },
    { label:"Delete",                action:onDelete,          disabled:false },
    { divider:true },
    { label:"Rename",                action:null,              disabled:true  },
    { label:"Save Place As...",      action:null,              disabled:true  },
    { label:"Email...",              action:null,              disabled:true  },
    { divider:true },
    { label:"Snapshot View",         action:null,              disabled:true  },
    { label:"Show Elevation Profile",action:null,              disabled:true  },
    { divider:true },
    { label:"Zoom To",               action:onZoomTo,          disabled:false },
    { divider:true },
    { label:"Properties",            action:onShowProperties,  disabled:false },
  ];

  return (
    <div ref={menuRef} className="ge-context-menu" style={{ left:x, top:y }} onMouseDown={e => e.stopPropagation()}>
      {items.map((item,i) => (
        item.divider
          ? <div key={i} className="ge-context-divider"/>
          : <div key={i} className={`ge-context-item${item.disabled?" disabled":""}`}
              onClick={() => { if (!item.disabled && item.action) { item.action(); onClose(); } }}>
              {item.label}
            </div>
      ))}
    </div>
  );
}

// ── Main MeasureTool ──────────────────────────────────────────────────────────
export default function MeasureTool({
  measureMode,
  measurePoints,
  setMeasurePoints,
  measureUnit,
  setMeasureUnit,
  onFinish,
  overlayLayers = [],
}) {
  const map = useMap();

  // Map layer refs
  const lineRef        = useRef(null);   // solid orange polyline
  const polygonRef     = useRef(null);   // filled polygon (area mode)
  const previewRef     = useRef(null);   // dashed preview line
  const totalLabelRef  = useRef(null);   // running total tooltip
  const areaLabelRef   = useRef(null);   // area centroid tooltip

  // Per-point arrays
  const markersRef     = useRef([]);     // L.circleMarker dots
  const nodeLabelsRef  = useRef([]);     // permanent Pt N tooltips on each dot
  const segLabelsRef   = useRef([]);     // midpoint segment distance tooltips

  // Panel state
  const [panelOpen,   setPanelOpen]   = useState(false);
  const [activeTab,   setActiveTab]   = useState("live");
  const [manualVal,   setManualVal]   = useState("");
  const [manualUnit,  setManualUnit]  = useState("m");
  const [copiedKey,   setCopiedKey]   = useState("");
  const [totalMetres, setTotalMetres] = useState(0);
  const [areaM2,      setAreaM2]      = useState(0);
  const [drawMode,    setDrawMode]    = useState("line"); // "line" | "polygon"
  const [areaUnit,    setAreaUnit]    = useState("ha");

  // Context menu / properties state
  const [contextMenu,     setContextMenu]     = useState(null);
  const [propertiesLayer, setPropertiesLayer] = useState(null);

  // Inject CSS once
  useEffect(() => {
    if (!document.getElementById("mt-style")) {
      const s = document.createElement("style");
      s.id = "mt-style";
      s.textContent = LABEL_CSS;
      document.head.appendChild(s);
    }
  }, []);

  // ── Right-click on overlay layers ─────────────────────────────────────────
  useEffect(() => {
    const handlers = [];
    overlayLayers.forEach(layerInfo => {
      const { leafletLayer } = layerInfo;
      if (!leafletLayer) return;
      const handler = (e) => {
        L.DomEvent.stop(e);
        setContextMenu({
          x: e.originalEvent.clientX,
          y: e.originalEvent.clientY,
          layer: layerInfo,
        });
      };
      leafletLayer.on("contextmenu", handler);
      handlers.push({ leafletLayer, handler });
    });
    return () => handlers.forEach(({ leafletLayer, handler }) => leafletLayer.off("contextmenu", handler));
  }, [overlayLayers]);

  // ── Clear all drawing elements ─────────────────────────────────────────────
  const clearAll = useCallback(() => {
    if (lineRef.current)       { lineRef.current.remove();       lineRef.current = null; }
    if (polygonRef.current)    { polygonRef.current.remove();    polygonRef.current = null; }
    if (previewRef.current)    { previewRef.current.remove();    previewRef.current = null; }
    if (totalLabelRef.current) { totalLabelRef.current.remove(); totalLabelRef.current = null; }
    if (areaLabelRef.current)  { areaLabelRef.current.remove();  areaLabelRef.current = null; }

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    nodeLabelsRef.current.forEach(l => l.remove());
    nodeLabelsRef.current = [];

    segLabelsRef.current.forEach(l => l.remove());
    segLabelsRef.current = [];

    setMeasurePoints([]);
    setTotalMetres(0);
    setAreaM2(0);
  }, [setMeasurePoints]);

  // ── Add a permanent numbered node label ───────────────────────────────────
  function addNodeLabel(point, idx) {
    const lbl = L.tooltip({
      permanent: true,
      direction: "top",
      className: "mt-node-label",
      offset: [0, -14],
    })
      .setLatLng(point)
      .setContent(`${idx}`)
      .addTo(map);
    nodeLabelsRef.current.push(lbl);
  }

  // ── Rebuild all segment labels from scratch ────────────────────────────────
  function rebuildSegLabels(points, unit) {
    segLabelsRef.current.forEach(l => l.remove());
    segLabelsRef.current = [];

    const effectiveUnit = unit || "auto";

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dist = haversine(a, b);
      const mid  = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

      let text;
      if (effectiveUnit === "auto") {
        text = smartDist(dist);
      } else {
        const u = UNITS.find(u => u.key === effectiveUnit);
        text = `${fmtVal(dist, effectiveUnit)} ${u?.abbr || "m"}`;
      }

      const lbl = L.tooltip({
        permanent: true,
        direction: "center",
        className: "mt-seg-label",
        offset: [0, 0],
      })
        .setLatLng(mid)
        .setContent(text)
        .addTo(map);

      segLabelsRef.current.push(lbl);
    }
  }

  // ── Update total label at the last point ──────────────────────────────────
  function updateTotalLabel(points, totalM, unit) {
    if (totalLabelRef.current) { totalLabelRef.current.remove(); totalLabelRef.current = null; }
    if (points.length < 2) return;

    const lastPt  = points[points.length - 1];
    const effUnit = unit || "auto";
    const text    = effUnit === "auto"
      ? `Total: ${smartDist(totalM)}`
      : `Total: ${fmtVal(totalM, effUnit)} ${UNITS.find(u => u.key === effUnit)?.abbr || "m"}`;

    totalLabelRef.current = L.tooltip({
      permanent: true,
      direction: "top",
      className: "mt-total-label",
      offset: [0, -20],
    })
      .setLatLng(lastPt)
      .setContent(text)
      .addTo(map);
  }

  // ── Update polygon fill + area label ──────────────────────────────────────
  function updatePolygonFill(points) {
    if (points.length < 3) {
      if (polygonRef.current) { polygonRef.current.remove(); polygonRef.current = null; }
      if (areaLabelRef.current) { areaLabelRef.current.remove(); areaLabelRef.current = null; }
      return;
    }

    if (!polygonRef.current) {
      polygonRef.current = L.polygon(points, {
        color: "#ff8800", weight: 2, opacity: 0.9,
        fillColor: "#ff8800", fillOpacity: 0.12,
      }).addTo(map);
    } else {
      polygonRef.current.setLatLngs(points);
    }

    const area    = calcPolygonArea(points);
    setAreaM2(area);

    const latAvg  = points.reduce((s, p) => s + p[0], 0) / points.length;
    const lngAvg  = points.reduce((s, p) => s + p[1], 0) / points.length;
    const u       = AREA_UNITS.find(u => u.key === areaUnit) || AREA_UNITS[0];

    if (areaLabelRef.current) areaLabelRef.current.remove();
    areaLabelRef.current = L.tooltip({
      permanent: true, direction: "center",
      className: "mt-area-label", offset: [0, 0],
    })
      .setLatLng([latAvg, lngAvg])
      .setContent(`Area: ${fmtArea(area, areaUnit)} ${u.abbr}`)
      .addTo(map);
  }

  // ── Re-render all labels when unit / areaUnit changes ────────────────────
  useEffect(() => {
    if (measurePoints.length >= 2) {
      rebuildSegLabels(measurePoints, measureUnit);
      updateTotalLabel(measurePoints, calcTotal(measurePoints), measureUnit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureUnit]);

  useEffect(() => {
    if (areaM2 > 0 && areaLabelRef.current) {
      const u = AREA_UNITS.find(u => u.key === areaUnit) || AREA_UNITS[0];
      areaLabelRef.current.setContent(`Area: ${fmtArea(areaM2, areaUnit)} ${u.abbr}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaUnit]);

  // Hide preview line when measure mode turns off
  useEffect(() => {
    if (!measureMode && previewRef.current) {
      previewRef.current.remove();
      previewRef.current = null;
    }
  }, [measureMode]);

  function copyVal(key, metres) {
    const u   = UNITS.find(u => u.key === key);
    const txt = `${toUnit(metres, key).toFixed(u.dp)} ${u.abbr}`;
    navigator.clipboard?.writeText(txt).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 1800);
  }

  const manualMetres = (() => {
    const v = parseFloat(manualVal);
    if (!isFinite(v) || v < 0) return null;
    return fromUnit(v, manualUnit);
  })();

  // ── Map events ────────────────────────────────────────────────────────────
  useMapEvents({
    click(e) {
      if (!measureMode) return;

      const point   = [e.latlng.lat, e.latlng.lng];
      const updated = [...measurePoints, point];
      setMeasurePoints(updated);

      const total = calcTotal(updated);
      setTotalMetres(total);

      // 1. Draw / extend the solid orange polyline
      if (!lineRef.current) {
        lineRef.current = L.polyline(updated, {
          color: "#ff8c00", weight: 2.5, opacity: 1,
        }).addTo(map);
      } else {
        lineRef.current.setLatLngs(updated);
      }

      // 2. Add a white dot with orange border at this point
      const dot = L.circleMarker(point, {
        radius: 5,
        color: "#ff8c00",
        weight: 2,
        fillColor: "#ffffff",
        fillOpacity: 1,
      }).addTo(map);
      markersRef.current.push(dot);

      // 3. Permanent numbered label above the dot
      addNodeLabel(point, updated.length);

      // 4. Rebuild all segment labels
      rebuildSegLabels(updated, measureUnit);

      // 5. Update running-total label at the last point
      updateTotalLabel(updated, total, measureUnit);

      // 6. Polygon fill (area mode, ≥ 3 pts)
      if (drawMode === "polygon" && updated.length >= 3) {
        updatePolygonFill(updated);
      }

      // Auto-open panel after second point
      if (updated.length === 2) setPanelOpen(true);
    },

    mousemove(e) {
      if (!measureMode || measurePoints.length === 0) return;
      const last = measurePoints[measurePoints.length - 1];
      if (!previewRef.current) {
        previewRef.current = L.polyline([last, e.latlng], {
          color: "#ff8c00", weight: 2, opacity: 0.55, dashArray: "8,6",
        }).addTo(map);
      } else {
        previewRef.current.setLatLngs([last, e.latlng]);
      }
    },

    dblclick() {
      if (!measureMode) return;
      if (previewRef.current) { previewRef.current.remove(); previewRef.current = null; }
      if (onFinish) onFinish();
    },

    contextmenu() {
      if (!measureMode) return;
      clearAll();
      setPanelOpen(false);
    },
  });

  // Close context menu on map click
  useEffect(() => {
    if (!contextMenu) return;
    const h = () => setContextMenu(null);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [contextMenu]);

  // ── Render nothing when inactive and panel is closed ─────────────────────
  if (!measureMode && !panelOpen) return (
    <>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} layer={contextMenu.layer}
          onClose={() => setContextMenu(null)}
          onShowProperties={() => setPropertiesLayer(contextMenu.layer)}
          onDelete={() => {}}
          onZoomTo={() => {
            if (contextMenu.layer?.leafletLayer) {
              const b = contextMenu.layer.leafletLayer.getBounds?.();
              if (b) map.fitBounds(b, { padding:[40,40] });
            }
          }}
        />
      )}
      {propertiesLayer && (
        <PropertiesDialog layer={propertiesLayer} onClose={() => setPropertiesLayer(null)}/>
      )}
    </>
  );

  const displayMetres = activeTab === "live" ? totalMetres : (manualMetres ?? 0);

  return (
    <>
      {/* Context menu & Properties dialog */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} layer={contextMenu.layer}
          onClose={() => setContextMenu(null)}
          onShowProperties={() => { setPropertiesLayer(contextMenu.layer); setContextMenu(null); }}
          onDelete={() => setContextMenu(null)}
          onZoomTo={() => {
            if (contextMenu.layer?.leafletLayer) {
              const b = contextMenu.layer.leafletLayer.getBounds?.();
              if (b) map.fitBounds(b, { padding:[40,40] });
            }
            setContextMenu(null);
          }}
        />
      )}
      {propertiesLayer && (
        <PropertiesDialog layer={propertiesLayer} onClose={() => setPropertiesLayer(null)}/>
      )}

      {/* ── Measurement Panel ── */}
      <div style={{
        position:"absolute", bottom:40, left:"50%",
        transform:"translateX(-50%)", zIndex:1200,
        width:480, maxWidth:"calc(100vw - 24px)",
        pointerEvents:"none",
        fontFamily:"'Segoe UI', system-ui, sans-serif",
      }}>
        <div style={{
          pointerEvents:"auto",
          background:"#0b1220",
          borderRadius:12,
          border:"1px solid rgba(255,140,0,0.3)",
          boxShadow:"0 8px 40px rgba(0,0,0,0.75)",
          overflow:"hidden",
        }}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          <style>{`
            @keyframes mtFadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
            .mt-tab{cursor:pointer;padding:7px 14px;font-size:11px;font-weight:700;border:none;background:transparent;letter-spacing:.05em;transition:all .15s;font-family:'Segoe UI',sans-serif;}
            .mt-mode-btn{cursor:pointer;padding:3px 11px;font-size:11px;font-weight:700;border-radius:4px;border:1px solid rgba(255,255,255,.1);transition:all .15s;font-family:'Segoe UI',sans-serif;}
            .mt-seg-row:hover{background:rgba(255,255,255,.04)!important;}
          `}</style>

          {/* Header */}
          <div style={{
            background:"#111927",
            borderBottom:"1px solid rgba(255,255,255,.07)",
            padding:"10px 14px",
            display:"flex", alignItems:"center", justifyContent:"space-between",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:9 }}>
              <div style={{
                width:28, height:28, borderRadius:7,
                background:"linear-gradient(135deg,#ff8800,#fbbf24)",
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:15,
              }}>📏</div>
              <div>
                <div style={{ color:"#f1f5f9", fontWeight:700, fontSize:13 }}>Measurement Converter</div>
                <div style={{ color:"#475569", fontSize:10 }}>
                  {measureMode
                    ? `${measurePoints.length} point${measurePoints.length!==1?"s":""} — double-click to finish`
                    : `${measurePoints.length} points measured`}
                </div>
              </div>
            </div>
            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
              {/* Draw mode toggle */}
              {measureMode && (
                <div style={{ display:"flex", gap:4 }}>
                  <button className="mt-mode-btn" onClick={() => setDrawMode("line")} style={{
                    background: drawMode==="line" ? "rgba(255,140,0,.2)" : "transparent",
                    color:      drawMode==="line" ? "#fbbf24" : "#64748b",
                    borderColor:drawMode==="line" ? "rgba(255,140,0,.4)" : "rgba(255,255,255,.1)",
                  }}>〰 Line</button>
                  <button className="mt-mode-btn" onClick={() => setDrawMode("polygon")} style={{
                    background: drawMode==="polygon" ? "rgba(96,165,250,.2)" : "transparent",
                    color:      drawMode==="polygon" ? "#60a5fa" : "#64748b",
                    borderColor:drawMode==="polygon" ? "rgba(96,165,250,.4)" : "rgba(255,255,255,.1)",
                  }}>⬡ Area</button>
                </div>
              )}
              {measureMode && measurePoints.length >= 2 && (
                <button onClick={() => { if (onFinish) onFinish(); }} style={{
                  padding:"4px 11px", borderRadius:5, border:"none",
                  background:"#16a34a", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer",
                }}>✓ Finish</button>
              )}
              {measurePoints.length > 0 && (
                <button onClick={() => { clearAll(); setPanelOpen(false); }} style={{
                  padding:"4px 10px", borderRadius:5,
                  border:"1px solid rgba(239,68,68,.35)",
                  background:"rgba(239,68,68,.08)", color:"#f87171",
                  fontSize:11, fontWeight:700, cursor:"pointer",
                }}>✕ Clear</button>
              )}
              <button onClick={() => setPanelOpen(p => !p)} style={{
                background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:17,
              }}>{panelOpen ? "▼" : "▲"}</button>
            </div>
          </div>

          {panelOpen && (
            <>
              {/* Tabs */}
              <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,.06)", background:"#0d1520" }}>
                {[
                  { id:"live",   label:"📍 Live Measurement" },
                  { id:"area",   label:"⬡ Area"              },
                  { id:"manual", label:"✏️ Manual Entry"     },
                ].map(tab => (
                  <button key={tab.id} className="mt-tab" onClick={() => setActiveTab(tab.id)} style={{
                    color:      activeTab===tab.id ? "#fbbf24" : "#475569",
                    borderBottom:`2px solid ${activeTab===tab.id ? "#fbbf24" : "transparent"}`,
                  }}>{tab.label}</button>
                ))}
              </div>

              {/* ── Live tab ── */}
              {activeTab === "live" && (
                <div style={{ padding:"12px 14px" }}>
                  {totalMetres === 0 ? (
                    <div style={{ textAlign:"center", padding:"18px 0", color:"#334155", fontSize:12, fontStyle:"italic" }}>
                      Click on the map to place measurement points…
                    </div>
                  ) : (
                    <>
                      {/* Big total */}
                      <div style={{
                        background:"rgba(255,140,0,.07)", border:"1px solid rgba(255,140,0,.2)",
                        borderRadius:9, padding:"10px 14px", marginBottom:12,
                        display:"flex", alignItems:"center", justifyContent:"space-between",
                      }}>
                        <div>
                          <div style={{ color:"#64748b", fontSize:9, fontWeight:700, letterSpacing:".07em", marginBottom:3 }}>
                            TOTAL DISTANCE · {measurePoints.length} PTS
                          </div>
                          <div style={{ color:"#fbbf24", fontSize:24, fontWeight:800, fontFamily:"'Courier New',monospace", lineHeight:1 }}>
                            {measureUnit === "auto"
                              ? smartDist(totalMetres)
                              : `${fmtVal(totalMetres, measureUnit)} ${UNITS.find(u=>u.key===measureUnit)?.abbr}`}
                          </div>
                        </div>
                        <button onClick={() => copyVal(measureUnit||"m", totalMetres)} style={{
                          padding:"5px 12px", borderRadius:5,
                          border:`1px solid ${copiedKey===(measureUnit||"m")?"rgba(74,222,128,.4)":"rgba(255,255,255,.1)"}`,
                          background:copiedKey===(measureUnit||"m")?"rgba(74,222,128,.1)":"rgba(255,255,255,.04)",
                          color:copiedKey===(measureUnit||"m")?"#4ade80":"#64748b",
                          fontSize:11, fontWeight:600, cursor:"pointer",
                        }}>{copiedKey===(measureUnit||"m")?"✓ Copied":"Copy"}</button>
                      </div>

                      {/* Google Earth Pro-style segment table */}
                      {measurePoints.length >= 2 && (
                        <div style={{
                          background:"rgba(255,255,255,.02)",
                          border:"1px solid rgba(255,255,255,.06)",
                          borderRadius:8, overflow:"hidden", marginBottom:10,
                        }}>
                          {/* Table header */}
                          <div style={{
                            display:"grid",
                            gridTemplateColumns:"44px 1fr 1fr 1fr",
                            padding:"5px 10px",
                            background:"rgba(255,255,255,.04)",
                            borderBottom:"1px solid rgba(255,255,255,.06)",
                          }}>
                            {["Seg","From → To","Distance","Cumulative"].map(h => (
                              <div key={h} style={{ color:"#334155", fontSize:9, fontWeight:700, letterSpacing:".06em", textTransform:"uppercase" }}>{h}</div>
                            ))}
                          </div>

                          {/* Table rows */}
                          <div style={{ maxHeight:180, overflowY:"auto" }}>
                            {measurePoints.slice(1).map((pt, i) => {
                              const segDist = haversine(measurePoints[i], pt);
                              const cumDist = calcTotal(measurePoints.slice(0, i + 2));
                              const isLast  = i === measurePoints.length - 2;
                              return (
                                <div key={i} className="mt-seg-row" style={{
                                  display:"grid",
                                  gridTemplateColumns:"44px 1fr 1fr 1fr",
                                  padding:"5px 10px",
                                  borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,.04)",
                                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.015)",
                                }}>
                                  <div style={{ color:"#64748b", fontSize:10, fontFamily:"'Courier New',monospace", display:"flex", alignItems:"center" }}>
                                    <span style={{ color:"#fbbf24", fontWeight:700 }}>S{i+1}</span>
                                  </div>
                                  <div style={{ color:"#94a3b8", fontSize:9.5, fontFamily:"'Courier New',monospace", display:"flex", alignItems:"center" }}>
                                    Pt{i+1}→Pt{i+2}
                                  </div>
                                  <div style={{ color:"#fde68a", fontSize:10.5, fontFamily:"'Courier New',monospace", fontWeight:700, display:"flex", alignItems:"center" }}>
                                    {measureUnit === "auto" ? smartDist(segDist) : `${fmtVal(segDist, measureUnit)} ${UNITS.find(u=>u.key===measureUnit)?.abbr}`}
                                  </div>
                                  <div style={{ color:"#6ee7b7", fontSize:10, fontFamily:"'Courier New',monospace", display:"flex", alignItems:"center" }}>
                                    {measureUnit === "auto" ? smartDist(cumDist) : `${fmtVal(cumDist, measureUnit)} ${UNITS.find(u=>u.key===measureUnit)?.abbr}`}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Summary footer */}
                          <div style={{
                            display:"grid",
                            gridTemplateColumns:"44px 1fr 1fr 1fr",
                            padding:"6px 10px",
                            background:"rgba(255,140,0,.07)",
                            borderTop:"1px solid rgba(255,140,0,.2)",
                          }}>
                            <div/>
                            <div style={{ color:"#92400e", fontSize:9, fontWeight:700, letterSpacing:".05em", display:"flex", alignItems:"center" }}>
                              {measurePoints.length-1} SEG{measurePoints.length!==2?"S":""}
                            </div>
                            <div/>
                            <div style={{ color:"#fbbf24", fontSize:11, fontFamily:"'Courier New',monospace", fontWeight:800, display:"flex", alignItems:"center" }}>
                              {measureUnit === "auto" ? smartDist(totalMetres) : `${fmtVal(totalMetres, measureUnit)} ${UNITS.find(u=>u.key===measureUnit)?.abbr}`}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Unit quick-select */}
                      <div style={{ marginTop:6 }}>
                        <div style={{ color:"#334155", fontSize:9, fontWeight:700, letterSpacing:".06em", marginBottom:5 }}>UNIT</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                          {[{key:"auto",label:"Auto"},...UNITS.map(u=>({key:u.key,label:u.abbr}))].map(({key,label}) => {
                            const on = (measureUnit||"auto") === key;
                            return (
                              <button key={key} onClick={() => setMeasureUnit && setMeasureUnit(key)} style={{
                                padding:"3px 9px", borderRadius:4, cursor:"pointer", fontSize:10.5, fontWeight:600,
                                background: on ? "rgba(255,140,0,.18)" : "rgba(255,255,255,.035)",
                                border:`1px solid ${on ? "rgba(255,140,0,.45)" : "rgba(255,255,255,.07)"}`,
                                color: on ? "#fbbf24" : "#475569",
                                fontFamily:"'Courier New',monospace",
                              }}>{label}</button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Area tab ── */}
              {activeTab === "area" && (
                <div style={{ padding:"12px 14px" }}>
                  {areaM2 === 0 ? (
                    <div style={{ textAlign:"center", padding:"18px 0", color:"#334155", fontSize:12, fontStyle:"italic" }}>
                      Switch to ⬡ Area mode and draw ≥ 3 points to calculate area…
                    </div>
                  ) : (
                    <>
                      {/* Big area */}
                      <div style={{
                        background:"rgba(96,165,250,.07)", border:"1px solid rgba(96,165,250,.2)",
                        borderRadius:9, padding:"10px 14px", marginBottom:10,
                        display:"flex", alignItems:"center", justifyContent:"space-between",
                      }}>
                        <div>
                          <div style={{ color:"#64748b", fontSize:9, fontWeight:700, letterSpacing:".07em", marginBottom:3 }}>
                            AREA · {measurePoints.length} PTS
                          </div>
                          <div style={{ color:"#60a5fa", fontSize:22, fontWeight:800, fontFamily:"'Courier New',monospace", lineHeight:1 }}>
                            {fmtArea(areaM2, areaUnit)}
                            <span style={{ fontSize:12, color:"#1e40af", marginLeft:5 }}>
                              {AREA_UNITS.find(u=>u.key===areaUnit)?.abbr}
                            </span>
                          </div>
                        </div>
                        <select value={areaUnit} onChange={e => setAreaUnit(e.target.value)} style={{
                          padding:"5px 9px", borderRadius:6,
                          border:"1px solid rgba(96,165,250,.3)",
                          background:"#1e2d45", color:"#e2e8f0",
                          fontSize:11, outline:"none", cursor:"pointer",
                        }}>
                          {AREA_UNITS.map(u => <option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
                        </select>
                      </div>

                      {/* All area units grid */}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:10 }}>
                        {AREA_UNITS.map(u => (
                          <div key={u.key} onClick={() => setAreaUnit(u.key)} style={{
                            padding:"7px 9px", borderRadius:7,
                            background:u.key===areaUnit?"rgba(96,165,250,.13)":"rgba(255,255,255,.025)",
                            border:`1px solid ${u.key===areaUnit?"rgba(96,165,250,.42)":"rgba(255,255,255,.05)"}`,
                            cursor:"pointer",
                          }}>
                            <div style={{ color:u.key===areaUnit?"#93c5fd":"#64748b", fontSize:9, fontWeight:700, marginBottom:1 }}>
                              {u.label.toUpperCase()}
                            </div>
                            <div style={{ color:u.key===areaUnit?"#dbeafe":"#e2e8f0", fontSize:12.5, fontFamily:"'Courier New',monospace", fontWeight:700 }}>
                              {fmtArea(areaM2, u.key)}
                              <span style={{ fontSize:9, color:"#475569", marginLeft:3 }}>{u.abbr}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Perimeter */}
                      {totalMetres > 0 && (
                        <div style={{
                          background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.06)",
                          borderRadius:7, padding:"8px 10px",
                        }}>
                          <div style={{ color:"#334155", fontSize:9, fontWeight:700, letterSpacing:".07em", marginBottom:4 }}>PERIMETER</div>
                          <div style={{ color:"#fbbf24", fontSize:14, fontFamily:"'Courier New',monospace", fontWeight:700 }}>
                            {measureUnit === "auto"
                              ? smartDist(totalMetres)
                              : `${fmtVal(totalMetres, measureUnit)} ${UNITS.find(u=>u.key===measureUnit)?.abbr}`}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Manual entry tab ── */}
              {activeTab === "manual" && (
                <div style={{ padding:"12px 14px" }}>
                  <div style={{
                    background:"rgba(167,139,250,.06)", border:"1px solid rgba(167,139,250,.18)",
                    borderRadius:8, padding:"10px 12px", marginBottom:10,
                  }}>
                    <div style={{ color:"#a78bfa", fontSize:10, fontWeight:700, letterSpacing:".07em", marginBottom:8 }}>
                      ENTER A DISTANCE TO CONVERT
                    </div>
                    <div style={{ display:"flex", gap:7, alignItems:"center" }}>
                      <input type="number" min="0" step="any"
                        value={manualVal} onChange={e => setManualVal(e.target.value)}
                        placeholder="e.g. 1500"
                        style={{
                          flex:1, padding:"8px 10px", borderRadius:6,
                          border:"1px solid rgba(255,255,255,.1)",
                          background:"rgba(255,255,255,.04)",
                          color:"#e2e8f0", fontSize:13, outline:"none", fontFamily:"'Courier New',monospace",
                        }}
                      />
                      <select value={manualUnit} onChange={e => setManualUnit(e.target.value)} style={{
                        padding:"8px 10px", borderRadius:6,
                        border:"1px solid rgba(255,255,255,.1)",
                        background:"#1e2d45", color:"#e2e8f0",
                        fontSize:12, outline:"none", cursor:"pointer",
                      }}>
                        {UNITS.map(u => <option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Unit conversion grid */}
                  {manualMetres !== null && manualMetres > 0 && (
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                      {UNITS.map(u => {
                        const val = toUnit(manualMetres, u.key).toFixed(u.dp);
                        return (
                          <div key={u.key} style={{
                            padding:"7px 9px", borderRadius:7,
                            background:"rgba(255,255,255,.025)",
                            border:"1px solid rgba(255,255,255,.05)",
                            display:"flex", alignItems:"center", justifyContent:"space-between",
                          }}>
                            <div>
                              <div style={{ color:"#64748b", fontSize:9, fontWeight:700 }}>{u.label.toUpperCase()}</div>
                              <div style={{ color:"#e2e8f0", fontSize:12, fontFamily:"'Courier New',monospace", fontWeight:700 }}>
                                {val}<span style={{ fontSize:9, color:"#475569", marginLeft:3 }}>{u.abbr}</span>
                              </div>
                            </div>
                            <button onClick={() => {
                              const txt = `${val} ${u.abbr}`;
                              navigator.clipboard?.writeText(txt).catch(()=>{});
                              setCopiedKey(u.key);
                              setTimeout(() => setCopiedKey(""), 1800);
                            }} style={{
                              padding:"2px 7px", borderRadius:4, fontSize:9, fontWeight:700, cursor:"pointer",
                              border:`1px solid ${copiedKey===u.key?"rgba(74,222,128,.45)":"rgba(255,255,255,.08)"}`,
                              background:copiedKey===u.key?"rgba(74,222,128,.1)":"transparent",
                              color:copiedKey===u.key?"#4ade80":"#334155",
                            }}>{copiedKey===u.key?"✓":"Copy"}</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Collapsed summary bar */}
          {!panelOpen && totalMetres > 0 && (
            <div style={{
              padding:"7px 14px", background:"#0d1520",
              display:"flex", alignItems:"center", gap:10, flexWrap:"wrap",
            }}>
              <span style={{ color:"#fbbf24", fontSize:11, fontFamily:"'Courier New',monospace", fontWeight:800 }}>
                {measureUnit==="auto" ? smartDist(totalMetres) : `${fmtVal(totalMetres, measureUnit||"m")} ${UNITS.find(u=>u.key===(measureUnit||"m"))?.abbr}`}
              </span>
              <span style={{ color:"#334155", fontSize:10, fontFamily:"'Courier New',monospace" }}>
                {measurePoints.length} pts · {measurePoints.length - 1} seg{measurePoints.length!==2?"s":""}
              </span>
              {areaM2 > 0 && (
                <span style={{ color:"#60a5fa", fontSize:10, fontFamily:"'Courier New',monospace", fontWeight:800 }}>
                  | {fmtArea(areaM2, areaUnit)}{AREA_UNITS.find(u=>u.key===areaUnit)?.abbr}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}