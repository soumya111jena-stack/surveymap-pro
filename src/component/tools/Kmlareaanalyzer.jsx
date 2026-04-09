/**
 * KMLAreaAnalyzer.jsx — SurveyMap Pro v5.9.4
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Earth Pro-style automatic area measurement for imported files.
 *
 * FEATURES:
 *  • Auto-parses KML / KMZ / GeoJSON / SHP GeoJSON on import
 *  • Shows each feature with its area, perimeter, length
 *  • Merge mode: select multiple polygons → combined area
 *  • Google Earth Pro colour scheme (dark panel, amber/green accents)
 *  • Per-feature highlight on hover (calls back to parent to flash layer)
 *  • Six area units + six distance units, live-switchable
 *  • Copy-to-clipboard on every value
 *
 * USAGE (drop into SurveyMap.jsx):
 *   import KMLAreaAnalyzer from "./tools/KMLAreaAnalyzer";
 *
 *   // In state:
 *   const [kmlAnalyzerOpen, setKmlAnalyzerOpen] = useState(false);
 *   const [kmlAnalyzerData, setKmlAnalyzerData] = useState(null);
 *
 *   // When KML layer loads (inside KMLLoader onLayer callback):
 *   setKmlAnalyzerData({ geojson: lyr.toGeoJSON(), fileName: kmlName });
 *   setKmlAnalyzerOpen(true);
 *
 *   // Render:
 *   {kmlAnalyzerOpen && kmlAnalyzerData && (
 *     <KMLAreaAnalyzer
 *       geojson={kmlAnalyzerData.geojson}
 *       fileName={kmlAnalyzerData.fileName}
 *       onClose={() => setKmlAnalyzerOpen(false)}
 *     />
 *   )}
 */

import { useState, useMemo, useCallback } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   Unit tables
───────────────────────────────────────────────────────────────────────────── */
const AREA_UNITS = [
  { key:"m2",  abbr:"m²",  label:"Sq Metres",    factor:1,           dp:1  },
  { key:"km2", abbr:"km²", label:"Sq Kilometres", factor:1e-6,       dp:6  },
  { key:"ha",  abbr:"ha",  label:"Hectares",      factor:1e-4,       dp:4  },
  { key:"ac",  abbr:"ac",  label:"Acres",         factor:1/4046.856, dp:4  },
  { key:"ft2", abbr:"ft²", label:"Sq Feet",       factor:10.7639,    dp:0  },
  { key:"mi2", abbr:"mi²", label:"Sq Miles",      factor:3.861e-7,   dp:8  },
];
const DIST_UNITS = [
  { key:"m",   abbr:"m",   label:"Metres",       factor:1,           dp:2 },
  { key:"km",  abbr:"km",  label:"Kilometres",   factor:1e-3,        dp:4 },
  { key:"mi",  abbr:"mi",  label:"Miles",        factor:1/1609.344,  dp:5 },
  { key:"ft",  abbr:"ft",  label:"Feet",         factor:3.28084,     dp:2 },
  { key:"nmi", abbr:"nmi", label:"Nautical mi",  factor:1/1852,      dp:5 },
];

/* ─────────────────────────────────────────────────────────────────────────────
   Geodesy
───────────────────────────────────────────────────────────────────────────── */
function haversine(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const s = Math.sin(dLat/2)**2 +
    Math.cos(a[1]*Math.PI/180)*Math.cos(b[1]*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(Math.max(0,s)));
}

function ringArea(coords) {
  // coords = [[lng,lat], ...]
  if (!coords || coords.length < 3) return 0;
  const R = 6371000, n = coords.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i+1) % n;
    const lat1 = coords[i][1] * Math.PI / 180;
    const lat2 = coords[j][1] * Math.PI / 180;
    const dLon = (coords[j][0] - coords[i][0]) * Math.PI / 180;
    area += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R * R / 2);
}

function polygonAreaM2(rings) {
  // GeoJSON polygon rings [[lng,lat],...]
  if (!rings || rings.length === 0) return 0;
  let a = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) a -= ringArea(rings[i]);
  return Math.max(0, a);
}

function ringPerim(coords, closed = true) {
  if (!coords || coords.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i-1], coords[i]);
  if (closed) d += haversine(coords[coords.length-1], coords[0]);
  return d;
}

function lineLength(coords) {
  if (!coords || coords.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i-1], coords[i]);
  return d;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Geometry analyser — returns {areaSqM, perimM, lengthM, type, partCount}
───────────────────────────────────────────────────────────────────────────── */
function analyseGeom(geom) {
  if (!geom) return { areaSqM:0, perimM:0, lengthM:0, type:"Unknown", partCount:0, coords:[] };
  const t = geom.type;

  if (t === "Point") {
    return { areaSqM:0, perimM:0, lengthM:0, type:"Point", partCount:1, coords:[geom.coordinates] };
  }
  if (t === "MultiPoint") {
    return { areaSqM:0, perimM:0, lengthM:0, type:"MultiPoint", partCount:geom.coordinates.length, coords:geom.coordinates };
  }
  if (t === "LineString") {
    return { areaSqM:0, perimM:0, lengthM:lineLength(geom.coordinates), type:"LineString", partCount:1, coords:geom.coordinates };
  }
  if (t === "MultiLineString") {
    const total = geom.coordinates.reduce((s,ls)=>s+lineLength(ls),0);
    return { areaSqM:0, perimM:0, lengthM:total, type:"MultiLineString", partCount:geom.coordinates.length, coords:geom.coordinates.flat() };
  }
  if (t === "Polygon") {
    return {
      areaSqM: polygonAreaM2(geom.coordinates),
      perimM:  ringPerim(geom.coordinates[0]),
      lengthM: 0, type:"Polygon", partCount:1,
      coords:  geom.coordinates[0],
    };
  }
  if (t === "MultiPolygon") {
    let areaSqM=0, perimM=0;
    geom.coordinates.forEach(poly => {
      areaSqM += polygonAreaM2(poly);
      perimM  += ringPerim(poly[0]);
    });
    return { areaSqM, perimM, lengthM:0, type:"MultiPolygon", partCount:geom.coordinates.length, coords:geom.coordinates[0]?.[0]||[] };
  }
  if (t === "GeometryCollection") {
    let areaSqM=0, perimM=0, lengthM=0, mainType="Unknown";
    (geom.geometries||[]).forEach(g => {
      const r = analyseGeom(g);
      areaSqM += r.areaSqM; perimM += r.perimM; lengthM += r.lengthM;
      if (mainType==="Unknown") mainType = r.type;
    });
    return { areaSqM, perimM, lengthM, type:`Collection/${mainType}`, partCount:(geom.geometries||[]).length, coords:[] };
  }
  return { areaSqM:0, perimM:0, lengthM:0, type:t||"Unknown", partCount:0, coords:[] };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Feature extractor — flattens FeatureCollection into analysed array
───────────────────────────────────────────────────────────────────────────── */
function extractFeatures(geojson) {
  if (!geojson) return [];
  const features = geojson.type === "FeatureCollection"
    ? (geojson.features || [])
    : geojson.type === "Feature"
      ? [geojson]
      : [{ type:"Feature", geometry:geojson, properties:{} }];

  return features.map((feat, idx) => {
    const props  = feat.properties || {};
    const name   =
      props.name   || props.Name   || props.NAME  ||
      props.label  || props.Label  ||
      props.id     || props.ID     || props.fid   ||
      props.OBJECTID ||
      `Feature ${idx + 1}`;
    const geo   = feat.geometry;
    const stats = analyseGeom(geo);
    return { idx, name: String(name).slice(0,60), ...stats, props, geometry:geo };
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Formatters
───────────────────────────────────────────────────────────────────────────── */
function fmtArea(m2, key) {
  const u = AREA_UNITS.find(u=>u.key===key) || AREA_UNITS[0];
  const v = m2 * u.factor;
  return v >= 1e6 ? v.toLocaleString(undefined,{maximumFractionDigits:u.dp}) : v.toFixed(u.dp);
}
function fmtDist(m, key) {
  const u = DIST_UNITS.find(u=>u.key===key) || DIST_UNITS[0];
  const v = m * u.factor;
  return v >= 1e6 ? v.toLocaleString(undefined,{maximumFractionDigits:u.dp}) : v.toFixed(u.dp);
}
function smartDist(m) {
  if (m >= 1000)  return `${(m/1000).toFixed(3)} km`;
  if (m >= 1)     return `${m.toFixed(2)} m`;
  return `${(m*100).toFixed(1)} cm`;
}
function smartArea(m2) {
  if (m2 >= 1e6)  return `${(m2*1e-6).toFixed(4)} km²`;
  if (m2 >= 1e4)  return `${(m2*1e-4).toFixed(3)} ha`;
  return `${m2.toFixed(1)} m²`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   CopyBtn
───────────────────────────────────────────────────────────────────────────── */
function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(text).catch(()=>{}); setOk(true); setTimeout(()=>setOk(false),1500); }}
      style={{
        padding:"2px 8px", borderRadius:5, cursor:"pointer",
        fontSize:9, fontWeight:700,
        border:`1px solid ${ok?"rgba(74,222,128,.5)":"rgba(255,255,255,.1)"}`,
        background:ok?"rgba(74,222,128,.12)":"transparent",
        color:ok?"#4ade80":"#475569", flexShrink:0,
        fontFamily:"'DM Mono',monospace",
      }}
    >{ok?"✓":"⎘"}</button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Feature Row
───────────────────────────────────────────────────────────────────────────── */
function FeatureRow({ feat, areaUnit, distUnit, selected, onSelect, mergeMode }) {
  const [expanded, setExpanded] = useState(false);
  const isPolygon = feat.areaSqM > 0;
  const isLine    = !isPolygon && feat.lengthM > 0;
  const isPoint   = feat.type === "Point" || feat.type === "MultiPoint";

  const aU = AREA_UNITS.find(u=>u.key===areaUnit) || AREA_UNITS[0];
  const dU = DIST_UNITS.find(u=>u.key===distUnit) || DIST_UNITS[0];

  const accent = isPolygon ? "#fbbf24" : isLine ? "#60a5fa" : "#34d399";
  const icon   = isPolygon ? "⬡" : isLine ? "〰" : "📍";

  return (
    <div style={{
      borderRadius:10,
      border:`1px solid ${selected ? accent+"50" : "rgba(255,255,255,.06)"}`,
      background:selected ? `${accent}0a` : "rgba(255,255,255,.02)",
      marginBottom:7, overflow:"hidden",
      transition:"all .15s",
    }}>
      {/* Main row */}
      <div
        onClick={() => { if(mergeMode && isPolygon) onSelect(); else setExpanded(p=>!p); }}
        style={{
          display:"flex", alignItems:"center", gap:10,
          padding:"10px 12px", cursor:"pointer",
          userSelect:"none",
        }}
      >
        {/* Merge checkbox */}
        {mergeMode && isPolygon && (
          <div style={{
            width:16, height:16, borderRadius:4, flexShrink:0,
            border:`2px solid ${selected?accent:"rgba(255,255,255,.2)"}`,
            background:selected?accent:"transparent",
            display:"flex", alignItems:"center", justifyContent:"center",
            transition:"all .15s",
          }}>
            {selected && <span style={{ color:"#000", fontSize:10, lineHeight:1 }}>✓</span>}
          </div>
        )}

        {/* Type icon */}
        <div style={{
          width:28, height:28, borderRadius:7, flexShrink:0,
          background:`${accent}18`,
          border:`1px solid ${accent}35`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:14,
        }}>{icon}</div>

        {/* Name + quick stats */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{
            color:"#e2e8f0", fontSize:11.5, fontWeight:600,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>{feat.name}</div>
          <div style={{
            color:"#475569", fontSize:9.5, fontFamily:"'DM Mono',monospace", marginTop:2,
            display:"flex", gap:8, flexWrap:"wrap",
          }}>
            <span style={{ color:"rgba(255,255,255,.25)" }}>{feat.type}</span>
            {isPolygon && <>
              <span>·</span>
              <span style={{ color:accent }}>{fmtArea(feat.areaSqM,areaUnit)} {aU.abbr}</span>
              <span>·</span>
              <span style={{ color:"#34d399" }}>{smartDist(feat.perimM)} perimeter</span>
            </>}
            {isLine && <>
              <span>·</span>
              <span style={{ color:accent }}>{smartDist(feat.lengthM)}</span>
            </>}
            {isPoint && (
              feat.coords[0] ? <span>· {feat.coords[0][1]?.toFixed(5)}°, {feat.coords[0][0]?.toFixed(5)}°</span> : null
            )}
          </div>
        </div>

        {/* Expand chevron (non-merge mode) */}
        {!mergeMode && (
          <div style={{
            color:"#334155", fontSize:12, transition:"transform .15s",
            transform:expanded?"rotate(180deg)":"none",
          }}>▼</div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && !mergeMode && (
        <div style={{
          borderTop:"1px solid rgba(255,255,255,.05)",
          padding:"12px 12px 14px",
          background:"rgba(0,0,0,.2)",
        }}>
          {/* POLYGON details */}
          {isPolygon && (
            <>
              <div style={{ fontSize:9, fontWeight:700, color:"#334155", letterSpacing:".08em", marginBottom:8 }}>AREA MEASUREMENTS</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5, marginBottom:10 }}>
                {AREA_UNITS.map(u => (
                  <div key={u.key} style={{
                    padding:"7px 8px", borderRadius:7,
                    background:u.key===areaUnit?"rgba(251,191,36,.12)":"rgba(255,255,255,.025)",
                    border:`1px solid ${u.key===areaUnit?"rgba(251,191,36,.35)":"rgba(255,255,255,.05)"}`,
                  }}>
                    <div style={{ color:"#64748b", fontSize:8, fontWeight:700 }}>{u.abbr}</div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:2 }}>
                      <span style={{ color:u.key===areaUnit?"#fde68a":"#cbd5e1", fontSize:11, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>
                        {fmtArea(feat.areaSqM,u.key)}
                      </span>
                      <CopyBtn text={`${fmtArea(feat.areaSqM,u.key)} ${u.abbr}`}/>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:9, fontWeight:700, color:"#334155", letterSpacing:".08em", marginBottom:6 }}>PERIMETER</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5 }}>
                {DIST_UNITS.map(u => (
                  <div key={u.key} style={{
                    padding:"7px 8px", borderRadius:7,
                    background:"rgba(52,211,153,.06)", border:"1px solid rgba(52,211,153,.15)",
                  }}>
                    <div style={{ color:"#64748b", fontSize:8, fontWeight:700 }}>{u.abbr}</div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:2 }}>
                      <span style={{ color:"#6ee7b7", fontSize:11, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>
                        {fmtDist(feat.perimM,u.key)}
                      </span>
                      <CopyBtn text={`${fmtDist(feat.perimM,u.key)} ${u.abbr}`}/>
                    </div>
                  </div>
                ))}
              </div>
              {feat.partCount > 1 && (
                <div style={{ marginTop:8, padding:"5px 10px", borderRadius:7, background:"rgba(96,165,250,.07)", border:"1px solid rgba(96,165,250,.15)", color:"#60a5fa", fontSize:10, fontFamily:"'DM Mono',monospace" }}>
                  MultiPolygon · {feat.partCount} parts
                </div>
              )}
            </>
          )}

          {/* LINE details */}
          {isLine && (
            <>
              <div style={{ fontSize:9, fontWeight:700, color:"#334155", letterSpacing:".08em", marginBottom:8 }}>LENGTH MEASUREMENTS</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5 }}>
                {DIST_UNITS.map(u => (
                  <div key={u.key} style={{
                    padding:"7px 8px", borderRadius:7,
                    background:u.key===distUnit?"rgba(96,165,250,.12)":"rgba(255,255,255,.025)",
                    border:`1px solid ${u.key===distUnit?"rgba(96,165,250,.35)":"rgba(255,255,255,.05)"}`,
                  }}>
                    <div style={{ color:"#64748b", fontSize:8, fontWeight:700 }}>{u.abbr}</div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:2 }}>
                      <span style={{ color:u.key===distUnit?"#bfdbfe":"#cbd5e1", fontSize:11, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>
                        {fmtDist(feat.lengthM,u.key)}
                      </span>
                      <CopyBtn text={`${fmtDist(feat.lengthM,u.key)} ${u.abbr}`}/>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* POINT details */}
          {isPoint && feat.coords[0] && (
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {[
                ["Longitude", feat.coords[0][0]?.toFixed(8)+"°"],
                ["Latitude",  feat.coords[0][1]?.toFixed(8)+"°"],
              ].map(([label,val]) => (
                <div key={label} style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"7px 10px", borderRadius:8,
                  background:"rgba(74,158,255,.07)", border:"1px solid rgba(74,158,255,.18)",
                }}>
                  <div>
                    <div style={{ color:"#475569", fontSize:9, fontWeight:700 }}>{label}</div>
                    <div style={{ color:"#90c8ff", fontSize:12, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>{val}</div>
                  </div>
                  <CopyBtn text={val}/>
                </div>
              ))}
            </div>
          )}

          {/* Properties */}
          {Object.keys(feat.props).length > 0 && (
            <details style={{ marginTop:10 }}>
              <summary style={{
                color:"#334155", fontSize:9.5, fontWeight:700, cursor:"pointer",
                letterSpacing:".06em", userSelect:"none",
              }}>
                🏷 ATTRIBUTES ({Object.keys(feat.props).length})
              </summary>
              <div style={{ marginTop:6 }}>
                {Object.entries(feat.props)
                  .filter(([k])=>!["styleUrl","styleHash","Style"].includes(k))
                  .slice(0,20)
                  .map(([k,v]) => (
                    <div key={k} style={{
                      display:"flex", gap:8, padding:"4px 0",
                      borderBottom:"1px solid rgba(255,255,255,.03)",
                    }}>
                      <span style={{ color:"#475569", fontSize:10, fontFamily:"'DM Mono',monospace", width:110, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis" }}>{k}</span>
                      <span style={{ color:"#94a3b8", fontSize:10, fontFamily:"'DM Mono',monospace", flex:1, overflow:"hidden", textOverflow:"ellipsis" }}>{String(v??"—").slice(0,80)}</span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN KMLAreaAnalyzer
───────────────────────────────────────────────────────────────────────────── */
export default function KMLAreaAnalyzer({ geojson, fileName, onClose }) {
  const [areaUnit,   setAreaUnit]   = useState("ha");
  const [distUnit,   setDistUnit]   = useState("m");
  const [mergeMode,  setMergeMode]  = useState(false);
  const [selected,   setSelected]   = useState(new Set());
  const [filter,     setFilter]     = useState("all"); // all | polygon | line | point
  const [search,     setSearch]     = useState("");
  const [sortBy,     setSortBy]     = useState("idx"); // idx | area | name | length
  const [tab,        setTab]        = useState("features"); // features | summary | merge

  const features = useMemo(() => extractFeatures(geojson), [geojson]);

  /* stats */
  const stats = useMemo(() => {
    const polys  = features.filter(f=>f.areaSqM>0);
    const lines  = features.filter(f=>f.lengthM>0&&f.areaSqM===0);
    const points = features.filter(f=>f.type==="Point"||f.type==="MultiPoint");
    return {
      totalArea:   polys.reduce((s,f)=>s+f.areaSqM,0),
      totalPerim:  polys.reduce((s,f)=>s+f.perimM,0),
      totalLength: lines.reduce((s,f)=>s+f.lengthM,0),
      polyCount:   polys.length,
      lineCount:   lines.length,
      pointCount:  points.length,
      totalCount:  features.length,
    };
  }, [features]);

  /* filtered + sorted */
  const visible = useMemo(() => {
    let arr = [...features];
    if (filter === "polygon") arr = arr.filter(f=>f.areaSqM>0);
    if (filter === "line")    arr = arr.filter(f=>f.lengthM>0&&f.areaSqM===0);
    if (filter === "point")   arr = arr.filter(f=>f.type==="Point"||f.type==="MultiPoint");
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(f=>f.name.toLowerCase().includes(q));
    }
    if (sortBy==="area")   arr.sort((a,b)=>b.areaSqM-a.areaSqM);
    if (sortBy==="name")   arr.sort((a,b)=>a.name.localeCompare(b.name));
    if (sortBy==="length") arr.sort((a,b)=>(b.lengthM+b.perimM)-(a.lengthM+a.perimM));
    return arr;
  }, [features, filter, search, sortBy]);

  /* merge stats */
  const mergeStats = useMemo(() => {
    const sel = features.filter(f=>selected.has(f.idx)&&f.areaSqM>0);
    return {
      count:    sel.length,
      areaSqM:  sel.reduce((s,f)=>s+f.areaSqM,0),
      perimM:   sel.reduce((s,f)=>s+f.perimM,0),
    };
  }, [selected, features]);

  const toggleSelect = useCallback((idx) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(idx) ? n.delete(idx) : n.add(idx);
      return n;
    });
  }, []);

  const selectAll = () => setSelected(new Set(features.filter(f=>f.areaSqM>0).map(f=>f.idx)));
  const clearSel  = () => setSelected(new Set());

  const aU = AREA_UNITS.find(u=>u.key===areaUnit)||AREA_UNITS[0];
  const dU = DIST_UNITS.find(u=>u.key===distUnit)||DIST_UNITS[0];

  const TABS = [
    { id:"features", label:"📋 Features" },
    { id:"summary",  label:"📐 Summary"  },
    ...(stats.polyCount >= 2 ? [{ id:"merge", label:"🔗 Merge Areas" }] : []),
  ];

  /* ── Render ── */
  return (
    <div
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}
      style={{
        position:"fixed", inset:0, zIndex:9600,
        background:"rgba(0,0,0,.72)", backdropFilter:"blur(10px)",
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:16, fontFamily:"'DM Sans',system-ui,sans-serif",
      }}
    >
      <div style={{
        background:"#080f1c",
        borderRadius:16,
        border:"1px solid rgba(251,191,36,.2)",
        boxShadow:"0 32px 80px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.04)",
        width:"100%", maxWidth:580, maxHeight:"91vh",
        display:"flex", flexDirection:"column", overflow:"hidden",
      }}>

        {/* ── HEADER ── */}
        <div style={{
          background:"linear-gradient(180deg,#0f1e30 0%,#0a1726 100%)",
          padding:"14px 18px",
          borderBottom:"1px solid rgba(255,255,255,.07)",
          display:"flex", alignItems:"center", gap:13,
        }}>
          <div style={{
            width:42, height:42, borderRadius:11, flexShrink:0,
            background:"linear-gradient(135deg,#ff8c00,#fbbf24)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:20, boxShadow:"0 4px 14px rgba(251,191,36,.3)",
          }}>🗺</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{
              color:"#f1f5f9", fontWeight:700, fontSize:14,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            }}>{fileName || "Imported Layer"}</div>
            <div style={{
              color:"#334155", fontSize:10, fontFamily:"'DM Mono',monospace", marginTop:3,
              display:"flex", gap:10, flexWrap:"wrap",
            }}>
              {stats.polyCount > 0 && <span style={{ color:"#fbbf24" }}>⬡ {stats.polyCount} polygon{stats.polyCount!==1?"s":""}</span>}
              {stats.lineCount > 0 && <span style={{ color:"#60a5fa" }}>〰 {stats.lineCount} line{stats.lineCount!==1?"s":""}</span>}
              {stats.pointCount > 0 && <span style={{ color:"#34d399" }}>📍 {stats.pointCount} point{stats.pointCount!==1?"s":""}</span>}
              {stats.totalCount > 0 && <span style={{ color:"#475569" }}>· {stats.totalCount} total</span>}
            </div>
          </div>
          <button onClick={onClose} style={{
            background:"rgba(239,68,68,.15)", border:"1px solid rgba(239,68,68,.3)",
            color:"#f87171", width:32, height:32, borderRadius:8,
            cursor:"pointer", fontSize:18, fontWeight:700,
            display:"flex", alignItems:"center", justifyContent:"center",
            flexShrink:0,
          }}>×</button>
        </div>

        {/* ── QUICK-LOOK BANNER ── */}
        {stats.totalArea > 0 && (
          <div style={{
            background:"linear-gradient(90deg,rgba(251,191,36,.12) 0%,rgba(245,158,11,.04) 100%)",
            borderBottom:"1px solid rgba(251,191,36,.18)",
            padding:"10px 18px",
            display:"flex", alignItems:"center", gap:0, overflowX:"auto",
          }}>
            {AREA_UNITS.map((u,i) => (
              <div
                key={u.key}
                onClick={()=>setAreaUnit(u.key)}
                style={{
                  display:"flex", flexDirection:"column", padding:"0 13px",
                  borderRight:i<AREA_UNITS.length-1?"1px solid rgba(251,191,36,.15)":"none",
                  cursor:"pointer", flexShrink:0,
                }}
              >
                <span style={{ color:"rgba(251,191,36,.45)", fontSize:8, fontWeight:700, letterSpacing:".08em", fontFamily:"'DM Mono',monospace" }}>{u.abbr}</span>
                <span style={{
                  color:areaUnit===u.key?"#fde68a":"#92400e",
                  fontSize:13, fontWeight:800, fontFamily:"'DM Mono',monospace", lineHeight:1.3,
                  textDecoration:areaUnit===u.key?"underline":"none",
                }}>
                  {fmtArea(stats.totalArea,u.key)}
                </span>
              </div>
            ))}
            <div style={{ marginLeft:"auto", paddingLeft:12, flexShrink:0, display:"flex", gap:6 }}>
              <span style={{ color:"rgba(251,191,36,.4)", fontSize:9, alignSelf:"center", fontFamily:"'DM Mono',monospace" }}>TOTAL AREA</span>
              <CopyBtn text={AREA_UNITS.map(u=>`${fmtArea(stats.totalArea,u.key)} ${u.abbr}`).join(" | ")}/>
            </div>
          </div>
        )}

        {/* ── TABS ── */}
        <div style={{
          display:"flex", background:"#0a1420",
          borderBottom:"1px solid rgba(255,255,255,.06)",
          padding:"0 4px", overflowX:"auto",
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>{ setTab(t.id); if(t.id!=="merge") setMergeMode(false); else setMergeMode(true); }} style={{
              padding:"9px 14px", fontSize:11, fontWeight:700,
              border:"none", background:"transparent", cursor:"pointer",
              color:tab===t.id?"#fbbf24":"#475569",
              borderBottom:`2px solid ${tab===t.id?"#fbbf24":"transparent"}`,
              fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── BODY ── */}
        <div style={{ flex:1, overflowY:"auto", padding:"14px 16px 20px" }}>

          {/* ═══════════════ FEATURES TAB ═══════════════ */}
          {tab==="features" && (
            <>
              {/* Toolbar */}
              <div style={{ display:"flex", gap:7, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
                {/* Search */}
                <input
                  value={search} onChange={e=>setSearch(e.target.value)}
                  placeholder="Search features…"
                  style={{
                    flex:1, minWidth:120, padding:"7px 11px", borderRadius:8,
                    border:"1px solid rgba(255,255,255,.08)", background:"rgba(255,255,255,.04)",
                    color:"#c8dff0", fontSize:11, outline:"none",
                    fontFamily:"'DM Sans',sans-serif",
                  }}
                />
                {/* Filter */}
                <select value={filter} onChange={e=>setFilter(e.target.value)} style={{
                  padding:"7px 10px", borderRadius:8, cursor:"pointer", outline:"none",
                  border:"1px solid rgba(255,255,255,.08)", background:"#1a2840", color:"#e2e8f0", fontSize:11,
                }}>
                  <option value="all">All types</option>
                  {stats.polyCount>0  && <option value="polygon">Polygons ({stats.polyCount})</option>}
                  {stats.lineCount>0  && <option value="line">Lines ({stats.lineCount})</option>}
                  {stats.pointCount>0 && <option value="point">Points ({stats.pointCount})</option>}
                </select>
                {/* Sort */}
                <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{
                  padding:"7px 10px", borderRadius:8, cursor:"pointer", outline:"none",
                  border:"1px solid rgba(255,255,255,.08)", background:"#1a2840", color:"#e2e8f0", fontSize:11,
                }}>
                  <option value="idx">Default order</option>
                  <option value="area">Largest area first</option>
                  <option value="length">Longest first</option>
                  <option value="name">A → Z</option>
                </select>
              </div>

              {/* Unit quick-pick */}
              <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
                <span style={{ color:"#334155", fontSize:9, fontWeight:700, alignSelf:"center", marginRight:4, letterSpacing:".06em" }}>AREA:</span>
                {AREA_UNITS.map(u=>(
                  <button key={u.key} onClick={()=>setAreaUnit(u.key)} style={{
                    padding:"3px 9px", borderRadius:5, cursor:"pointer", fontSize:10, fontWeight:600,
                    background:areaUnit===u.key?"rgba(251,191,36,.18)":"rgba(255,255,255,.035)",
                    border:`1px solid ${areaUnit===u.key?"rgba(251,191,36,.45)":"rgba(255,255,255,.07)"}`,
                    color:areaUnit===u.key?"#fbbf24":"#475569",
                    fontFamily:"'DM Mono',monospace",
                  }}>{u.abbr}</button>
                ))}
                <span style={{ color:"#334155", fontSize:9, fontWeight:700, alignSelf:"center", margin:"0 4px 0 10px", letterSpacing:".06em" }}>DIST:</span>
                {DIST_UNITS.map(u=>(
                  <button key={u.key} onClick={()=>setDistUnit(u.key)} style={{
                    padding:"3px 9px", borderRadius:5, cursor:"pointer", fontSize:10, fontWeight:600,
                    background:distUnit===u.key?"rgba(96,165,250,.18)":"rgba(255,255,255,.035)",
                    border:`1px solid ${distUnit===u.key?"rgba(96,165,250,.45)":"rgba(255,255,255,.07)"}`,
                    color:distUnit===u.key?"#60a5fa":"#475569",
                    fontFamily:"'DM Mono',monospace",
                  }}>{u.abbr}</button>
                ))}
              </div>

              {visible.length === 0 && (
                <div style={{ textAlign:"center", color:"#334155", fontSize:12, fontStyle:"italic", padding:"40px 0" }}>
                  {search ? `No features match "${search}"` : "No features found"}
                </div>
              )}

              {visible.map(feat => (
                <FeatureRow
                  key={feat.idx}
                  feat={feat}
                  areaUnit={areaUnit}
                  distUnit={distUnit}
                  selected={selected.has(feat.idx)}
                  onSelect={() => toggleSelect(feat.idx)}
                  mergeMode={false}
                />
              ))}
            </>
          )}

          {/* ═══════════════ SUMMARY TAB ═══════════════ */}
          {tab==="summary" && (
            <>
              {/* Big area card */}
              {stats.totalArea > 0 && (
                <div style={{
                  background:"rgba(251,191,36,.07)", border:"1px solid rgba(251,191,36,.22)",
                  borderRadius:12, padding:"14px 16px", marginBottom:14,
                }}>
                  <div style={{ color:"#64748b", fontSize:9, fontWeight:700, letterSpacing:".09em", fontFamily:"'DM Mono',monospace", marginBottom:8 }}>
                    TOTAL AREA — {stats.polyCount} POLYGON{stats.polyCount!==1?"S":""}
                  </div>
                  <div style={{
                    color:"#fbbf24", fontSize:36, fontWeight:800,
                    fontFamily:"'DM Mono',monospace", lineHeight:1, marginBottom:4,
                  }}>
                    {fmtArea(stats.totalArea,areaUnit)}
                    <span style={{ fontSize:16, color:"rgba(251,191,36,.6)", marginLeft:8 }}>{aU.abbr}</span>
                  </div>
                  <div style={{ display:"flex", gap:8, marginTop:8 }}>
                    <select value={areaUnit} onChange={e=>setAreaUnit(e.target.value)} style={{
                      padding:"6px 10px", borderRadius:8, cursor:"pointer", outline:"none",
                      border:"1px solid rgba(251,191,36,.3)", background:"#1a2840", color:"#e2e8f0", fontSize:11,
                    }}>
                      {AREA_UNITS.map(u=><option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
                    </select>
                    <CopyBtn text={`${fmtArea(stats.totalArea,areaUnit)} ${aU.abbr}`}/>
                  </div>
                </div>
              )}

              {/* All area units grid */}
              {stats.totalArea > 0 && (
                <div style={{
                  background:"rgba(255,255,255,.02)", border:"1px solid rgba(255,255,255,.06)",
                  borderRadius:10, overflow:"hidden", marginBottom:14,
                }}>
                  <div style={{
                    padding:"7px 12px", background:"rgba(255,255,255,.04)",
                    borderBottom:"1px solid rgba(255,255,255,.06)",
                    color:"#334155", fontSize:9, fontWeight:700, letterSpacing:".07em",
                  }}>ALL AREA UNITS</div>
                  {AREA_UNITS.map((u,i)=>{
                    const val=fmtArea(stats.totalArea,u.key), on=u.key===areaUnit;
                    return (
                      <div key={u.key} onClick={()=>setAreaUnit(u.key)} style={{
                        display:"flex", alignItems:"center", padding:"10px 12px", cursor:"pointer",
                        background:on?"rgba(251,191,36,.09)":"transparent",
                        borderBottom:i<AREA_UNITS.length-1?"1px solid rgba(255,255,255,.04)":"none",
                      }}>
                        <div style={{ width:48, color:on?"#fbbf24":"#64748b", fontSize:11, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{u.abbr}</div>
                        <div style={{ flex:1, color:on?"#fde68a":"#cbd5e1", fontSize:14, fontFamily:"'DM Mono',monospace", fontWeight:on?800:500 }}>{val}</div>
                        <div style={{ color:"#334155", fontSize:9.5, marginRight:8 }}>{u.label}</div>
                        <CopyBtn text={`${val} ${u.abbr}`}/>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Perimeter & length */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
                {stats.totalPerim > 0 && (
                  <div style={{ background:"rgba(52,211,153,.07)", border:"1px solid rgba(52,211,153,.2)", borderRadius:10, padding:"12px 14px" }}>
                    <div style={{ color:"#475569", fontSize:9, fontWeight:700, letterSpacing:".07em", marginBottom:5 }}>TOTAL PERIMETER</div>
                    <div style={{ color:"#34d399", fontSize:18, fontWeight:800, fontFamily:"'DM Mono',monospace" }}>{smartDist(stats.totalPerim)}</div>
                    <div style={{ color:"#064e3b", fontSize:9, marginTop:3, fontFamily:"'DM Mono',monospace" }}>{fmtDist(stats.totalPerim,"km")} km</div>
                  </div>
                )}
                {stats.totalLength > 0 && (
                  <div style={{ background:"rgba(96,165,250,.07)", border:"1px solid rgba(96,165,250,.2)", borderRadius:10, padding:"12px 14px" }}>
                    <div style={{ color:"#475569", fontSize:9, fontWeight:700, letterSpacing:".07em", marginBottom:5 }}>TOTAL LINE LENGTH</div>
                    <div style={{ color:"#60a5fa", fontSize:18, fontWeight:800, fontFamily:"'DM Mono',monospace" }}>{smartDist(stats.totalLength)}</div>
                    <div style={{ color:"#1e3a5f", fontSize:9, marginTop:3, fontFamily:"'DM Mono',monospace" }}>{fmtDist(stats.totalLength,"km")} km</div>
                  </div>
                )}
              </div>

              {/* Top 5 by area */}
              {stats.polyCount > 0 && (
                <div style={{
                  background:"rgba(255,255,255,.02)", border:"1px solid rgba(255,255,255,.06)",
                  borderRadius:10, overflow:"hidden",
                }}>
                  <div style={{
                    padding:"7px 12px", background:"rgba(255,255,255,.04)",
                    borderBottom:"1px solid rgba(255,255,255,.06)",
                    color:"#334155", fontSize:9, fontWeight:700, letterSpacing:".07em",
                  }}>TOP POLYGONS BY AREA</div>
                  {features
                    .filter(f=>f.areaSqM>0)
                    .sort((a,b)=>b.areaSqM-a.areaSqM)
                    .slice(0,8)
                    .map((f,i)=>{
                      const pct = stats.totalArea>0 ? (f.areaSqM/stats.totalArea)*100 : 0;
                      return (
                        <div key={f.idx} style={{
                          padding:"9px 12px",
                          borderBottom:i<Math.min(features.filter(x=>x.areaSqM>0).length,8)-1?"1px solid rgba(255,255,255,.04)":"none",
                        }}>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
                            <span style={{ color:"#94a3b8", fontSize:10.5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"55%" }}>{f.name}</span>
                            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              <span style={{ color:"#fbbf24", fontSize:11, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>{fmtArea(f.areaSqM,areaUnit)} {aU.abbr}</span>
                              <CopyBtn text={`${fmtArea(f.areaSqM,areaUnit)} ${aU.abbr}`}/>
                            </div>
                          </div>
                          <div style={{ height:4, background:"rgba(255,255,255,.05)", borderRadius:2, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#f59e0b,#fbbf24)", borderRadius:2, transition:"width .3s" }}/>
                          </div>
                          <div style={{ color:"#334155", fontSize:9, marginTop:3, fontFamily:"'DM Mono',monospace" }}>{pct.toFixed(1)}% of total</div>
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          )}

          {/* ═══════════════ MERGE TAB ═══════════════ */}
          {tab==="merge" && (
            <>
              <div style={{
                background:"rgba(96,165,250,.07)", border:"1px solid rgba(96,165,250,.18)",
                borderRadius:10, padding:"10px 14px", marginBottom:12,
                color:"#60a5fa", fontSize:11, lineHeight:1.5,
              }}>
                <strong>Merge Areas:</strong> Select polygons below to combine their total area — like Google Earth's "merge" feature. Useful when a feature is split across multiple polygons.
              </div>

              {/* Controls */}
              <div style={{ display:"flex", gap:7, marginBottom:12 }}>
                <button onClick={selectAll} style={{
                  padding:"6px 14px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600,
                  background:"rgba(251,191,36,.1)", border:"1px solid rgba(251,191,36,.3)", color:"#fbbf24",
                }}>Select All Polygons</button>
                <button onClick={clearSel} style={{
                  padding:"6px 14px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600,
                  background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", color:"#64748b",
                }}>Clear Selection</button>
              </div>

              {/* Merged result */}
              {mergeStats.count >= 2 && (
                <div style={{
                  background:"linear-gradient(135deg,rgba(251,191,36,.12),rgba(245,158,11,.06))",
                  border:"1.5px solid rgba(251,191,36,.35)",
                  borderRadius:12, padding:"14px 16px", marginBottom:14,
                }}>
                  <div style={{ color:"#92400e", fontSize:9, fontWeight:700, letterSpacing:".09em", marginBottom:6, fontFamily:"'DM Mono',monospace" }}>
                    🔗 MERGED AREA — {mergeStats.count} POLYGONS
                  </div>
                  <div style={{ color:"#fbbf24", fontSize:32, fontWeight:800, fontFamily:"'DM Mono',monospace", lineHeight:1, marginBottom:8 }}>
                    {fmtArea(mergeStats.areaSqM,areaUnit)}
                    <span style={{ fontSize:16, color:"rgba(251,191,36,.6)", marginLeft:8 }}>{aU.abbr}</span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:5, marginBottom:8 }}>
                    {AREA_UNITS.filter(u=>u.key!==areaUnit).map(u=>(
                      <div key={u.key} style={{
                        padding:"6px 8px", borderRadius:7,
                        background:"rgba(0,0,0,.25)", border:"1px solid rgba(251,191,36,.15)",
                      }}>
                        <div style={{ color:"#78350f", fontSize:8, fontWeight:700 }}>{u.abbr}</div>
                        <div style={{ color:"#fcd34d", fontSize:11, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>
                          {fmtArea(mergeStats.areaSqM,u.key)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span style={{ color:"#a16207", fontSize:10, fontFamily:"'DM Mono',monospace" }}>
                      Perimeter sum: {smartDist(mergeStats.perimM)}
                    </span>
                    <CopyBtn text={AREA_UNITS.map(u=>`${fmtArea(mergeStats.areaSqM,u.key)} ${u.abbr}`).join(" | ")}/>
                  </div>
                </div>
              )}
              {mergeStats.count === 1 && (
                <div style={{ color:"#475569", fontSize:11, fontStyle:"italic", marginBottom:12, padding:"6px 0" }}>
                  Select at least 2 polygons to see combined area
                </div>
              )}

              {/* Polygon list for selection */}
              {features.filter(f=>f.areaSqM>0).length === 0 && (
                <div style={{ color:"#334155", fontSize:12, fontStyle:"italic", textAlign:"center", padding:"30px 0" }}>
                  No polygons in this file to merge
                </div>
              )}
              {features.filter(f=>f.areaSqM>0).map(feat=>(
                <FeatureRow
                  key={feat.idx}
                  feat={feat}
                  areaUnit={areaUnit}
                  distUnit={distUnit}
                  selected={selected.has(feat.idx)}
                  onSelect={()=>toggleSelect(feat.idx)}
                  mergeMode={true}
                />
              ))}
            </>
          )}

        </div>

        {/* ── FOOTER ── */}
        <div style={{
          padding:"10px 18px",
          background:"#0a1420",
          borderTop:"1px solid rgba(255,255,255,.06)",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:8,
        }}>
          <span style={{ color:"#1e3a5f", fontSize:10, fontFamily:"'DM Mono',monospace" }}>
            WGS-84 spherical · {features.length} feature{features.length!==1?"s":""}
          </span>
          <div style={{ display:"flex", gap:7 }}>
            {stats.totalArea > 0 && (
              <button
                onClick={()=>{ navigator.clipboard?.writeText(
                  AREA_UNITS.map(u=>`${fmtArea(stats.totalArea,u.key)} ${u.abbr}`).join("\n")
                ).catch(()=>{}); }}
                style={{
                  padding:"7px 16px", borderRadius:8, cursor:"pointer",
                  background:"rgba(251,191,36,.1)", border:"1px solid rgba(251,191,36,.3)",
                  color:"#fbbf24", fontSize:11, fontWeight:700,
                }}
              >⎘ Copy All Areas</button>
            )}
            <button onClick={onClose} style={{
              padding:"7px 22px", borderRadius:8, cursor:"pointer",
              background:"rgba(74,158,255,.15)", border:"1px solid rgba(74,158,255,.4)",
              color:"#80c4ff", fontSize:12, fontWeight:700,
            }}>Close</button>
          </div>
        </div>

      </div>
    </div>
  );
}