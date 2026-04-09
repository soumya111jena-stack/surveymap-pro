/**
 * AreaPropertiesPanel.jsx — SurveyMap Pro v5.9.3
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Earth Pro-style Properties / Area panel.
 *
 * Handles ALL geometry types from KML / KMZ / SHP / GeoJSON / drawn features:
 *   Polygon, MultiPolygon        → Area (6 units) + Perimeter
 *   LineString, MultiLineString  → Total length + per-segment table
 *   Point, MultiPoint            → Coordinates (decimal + DMS + UTM)
 *   GeometryCollection           → Aggregated area + length
 *   FeatureCollection            → Iterates every feature, sums area / length
 *
 * Drop-in replacement — same props as before:
 *   <AreaPropertiesPanel drawing={...}        onClose={...} />
 *   <AreaPropertiesPanel geojsonFeature={...} onClose={...} />
 */

import { useState, useMemo } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   Unit tables
───────────────────────────────────────────────────────────────────────────── */
const DIST_UNITS = [
  { key:"m",   abbr:"m",   label:"Metres",        factor:1,           dp:2 },
  { key:"km",  abbr:"km",  label:"Kilometres",    factor:1e-3,        dp:4 },
  { key:"mi",  abbr:"mi",  label:"Miles",         factor:1/1609.344,  dp:5 },
  { key:"ft",  abbr:"ft",  label:"Feet",          factor:3.28084,     dp:2 },
  { key:"yd",  abbr:"yd",  label:"Yards",         factor:1.09361,     dp:2 },
  { key:"nmi", abbr:"nmi", label:"Nautical mi",   factor:1/1852,      dp:5 },
];

const AREA_UNITS = [
  { key:"m2",  abbr:"m²",   label:"Square metres",     factor:1,           dp:2  },
  { key:"km2", abbr:"km²",  label:"Square kilometres", factor:1e-6,        dp:6  },
  { key:"ha",  abbr:"ha",   label:"Hectares",          factor:1e-4,        dp:4  },
  { key:"ac",  abbr:"ac",   label:"Acres",             factor:1/4046.856,  dp:4  },
  { key:"ft2", abbr:"ft²",  label:"Square feet",       factor:10.7639,     dp:1  },
  { key:"mi2", abbr:"mi²",  label:"Square miles",      factor:3.861e-7,    dp:8  },
];

/* ─────────────────────────────────────────────────────────────────────────────
   Geodesy
───────────────────────────────────────────────────────────────────────────── */
function haversine(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat/2)**2 +
    Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

/** Spherical-excess area for a flat ring of {lat,lng} in m² */
function ringArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const R = 6371000, n = ring.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i+1) % n;
    const lat1 = ring[i].lat * Math.PI/180;
    const lat2 = ring[j].lat * Math.PI/180;
    const dLon = (ring[j].lng - ring[i].lng) * Math.PI/180;
    area += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R*R / 2);
}

/** Polygon with holes: outer ring minus hole rings */
function polygonArea(rings) {
  if (!rings || rings.length === 0) return 0;
  let area = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) area -= ringArea(rings[i]);
  return Math.max(0, area);
}

function ringPerimeter(ring, closed = true) {
  if (!ring || ring.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < ring.length; i++) d += haversine(ring[i-1], ring[i]);
  if (closed) d += haversine(ring[ring.length-1], ring[0]);
  return d;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Coordinate → {lat,lng}
───────────────────────────────────────────────────────────────────────────── */
function coordPt(c) { return { lat: c[1], lng: c[0] }; }

/* ─────────────────────────────────────────────────────────────────────────────
   Geometry extractor
   Returns { areaSqM, perimM, lengthM, rings, pts, type, count, polyCount }
   Works recursively on GeometryCollection and FeatureCollection.
───────────────────────────────────────────────────────────────────────────── */
function extractGeometry(geom) {
  if (!geom) return null;

  // FeatureCollection — iterate all features
  if (geom.type === "FeatureCollection") {
    const feats = geom.features || [];
    let areaSqM=0, perimM=0, lengthM=0, allRings=[], allPts=[], mainType=null;
    feats.forEach(f => {
      const g = extractGeometry(f.geometry);
      if (!g) return;
      areaSqM += g.areaSqM; perimM += g.perimM; lengthM += g.lengthM;
      allRings.push(...g.rings); allPts.push(...g.pts);
      if (!mainType) mainType = g.type;
    });
    return { areaSqM, perimM, lengthM, rings:allRings, pts:allPts,
             type: mainType||"FeatureCollection", count: feats.length };
  }

  // Feature wrapper
  if (geom.type === "Feature") return extractGeometry(geom.geometry);

  const t = geom.type;

  if (t === "Point") {
    const pt = coordPt(geom.coordinates);
    return { areaSqM:0, perimM:0, lengthM:0, rings:[], pts:[pt], type:"Point" };
  }

  if (t === "MultiPoint") {
    const pts = geom.coordinates.map(coordPt);
    return { areaSqM:0, perimM:0, lengthM:0, rings:[], pts, type:"MultiPoint" };
  }

  if (t === "LineString") {
    const pts = geom.coordinates.map(coordPt);
    return { areaSqM:0, perimM:0, lengthM:ringPerimeter(pts,false), rings:[], pts, type:"LineString" };
  }

  if (t === "MultiLineString") {
    const all = geom.coordinates.map(ls=>ls.map(coordPt));
    return { areaSqM:0, perimM:0, lengthM:all.reduce((s,ls)=>s+ringPerimeter(ls,false),0),
             rings:[], pts:all.flat(), type:"MultiLineString" };
  }

  if (t === "Polygon") {
    const rings = geom.coordinates.map(r=>r.map(coordPt));
    return { areaSqM:polygonArea(rings), perimM:ringPerimeter(rings[0],true), lengthM:0,
             rings, pts:rings[0]||[], type:"Polygon" };
  }

  if (t === "MultiPolygon") {
    let areaSqM=0, perimM=0; const allRings=[], firstPts=[];
    geom.coordinates.forEach((poly,pi)=>{
      const rings = poly.map(r=>r.map(coordPt));
      areaSqM += polygonArea(rings);
      perimM  += ringPerimeter(rings[0],true);
      allRings.push(...rings);
      if (pi===0) firstPts.push(...(rings[0]||[]));
    });
    return { areaSqM, perimM, lengthM:0, rings:allRings, pts:firstPts,
             type:"MultiPolygon", polyCount:geom.coordinates.length };
  }

  if (t === "GeometryCollection") {
    let areaSqM=0, perimM=0, lengthM=0, allRings=[], allPts=[], mainType=null;
    (geom.geometries||[]).forEach(g=>{
      const r = extractGeometry(g); if (!r) return;
      areaSqM+=r.areaSqM; perimM+=r.perimM; lengthM+=r.lengthM;
      allRings.push(...r.rings); allPts.push(...r.pts);
      if (!mainType) mainType = r.type;
    });
    return { areaSqM, perimM, lengthM, rings:allRings, pts:allPts, type:mainType||"GeometryCollection" };
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Normalise drawing / geojsonFeature into unified shape
───────────────────────────────────────────────────────────────────────────── */
function normalise(drawing, geojsonFeature) {
  // From DrawTool
  if (drawing) {
    const pts = (drawing.points || []).map(p=>
      Array.isArray(p) ? {lat:p[0],lng:p[1]} : {lat:p.lat,lng:p.lng}
    );
    const geoType = drawing.type==="polygon" ? "Polygon"
      : drawing.type==="marker" ? "Point" : "LineString";
    const fakeGeom = {
      type: geoType,
      coordinates: geoType==="Point"
        ? [pts[0]?.lng||0, pts[0]?.lat||0]
        : geoType==="Polygon"
          ? [pts.map(p=>[p.lng,p.lat])]
          : pts.map(p=>[p.lng,p.lat]),
    };
    const info = extractGeometry(fakeGeom);
    return { name:drawing.name||"Drawing", props:null, ...info, rawPts:pts };
  }

  // From imported KML / KMZ / SHP / GeoJSON
  if (geojsonFeature) {
    const feat = geojsonFeature;
    const geom = feat.type==="Feature" ? feat.geometry
      : feat.type==="FeatureCollection" ? feat
      : feat; // bare geometry

    const props = feat.type==="Feature" ? (feat.properties||{})
      : feat.type==="FeatureCollection" ? (feat.features?.[0]?.properties||{})
      : {};

    const name =
      props.name || props.Name || props.NAME ||
      props.label || props.Label ||
      props.description?.slice?.(0,40) ||
      props.id || props.ID || props.fid ||
      "Imported Feature";

    const info = extractGeometry(geom);
    if (!info) return { name, props, areaSqM:0, perimM:0, lengthM:0, rings:[], pts:[], type:"Unknown", rawPts:[] };
    return { name, props, ...info, rawPts:info.pts };
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Format helpers
───────────────────────────────────────────────────────────────────────────── */
function fmtNum(val, dp) {
  if (val >= 1_000_000) return val.toLocaleString(undefined,{maximumFractionDigits:dp});
  return val.toFixed(dp);
}
function fmtArea(m2, key) {
  const u = AREA_UNITS.find(u=>u.key===key)||AREA_UNITS[0];
  return fmtNum(m2*u.factor, u.dp);
}
function fmtDist(m, key) {
  const u = DIST_UNITS.find(u=>u.key===key)||DIST_UNITS[0];
  return fmtNum(m*u.factor, u.dp);
}
function smartDist(m) {
  if (m>=1000) return `${(m/1000).toFixed(3)} km`;
  if (m>=1)    return `${m.toFixed(2)} m`;
  return `${(m*100).toFixed(1)} cm`;
}
function toDMS(deg, pos, neg) {
  const d=Math.abs(deg), D=Math.floor(d), M=Math.floor((d-D)*60);
  const S=((d-D)*3600-M*60).toFixed(3);
  return `${D}°${M}′${S}″ ${deg>=0?pos:neg}`;
}
function toUTM(lat,lng) {
  const zone = Math.floor((lng+180)/6)+1;
  const band = "CDEFGHJKLMNPQRSTUVWX"[Math.min(Math.floor((lat+80)/8),19)]||"N";
  return `Zone ${zone}${band}`;
}
function centroid(pts) {
  if (!pts||!pts.length) return null;
  return { lat:pts.reduce((s,p)=>s+p.lat,0)/pts.length, lng:pts.reduce((s,p)=>s+p.lng,0)/pts.length };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────────────────────────────────────── */
function CopyBtn({ text, small }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={()=>{ navigator.clipboard?.writeText(text).catch(()=>{}); setOk(true); setTimeout(()=>setOk(false),1500); }} style={{
      padding:small?"2px 7px":"3px 9px", borderRadius:5, cursor:"pointer",
      fontSize:9.5, fontWeight:700, fontFamily:"'DM Mono',monospace",
      border:`1px solid ${ok?"rgba(74,222,128,.4)":"rgba(255,255,255,.08)"}`,
      background:ok?"rgba(74,222,128,.1)":"transparent",
      color:ok?"#4ade80":"#475569", flexShrink:0,
    }}>{ok?"✓ Copied":"⎘ Copy"}</button>
  );
}

function StatRow({ icon, label, value, unit, accent="#60a5fa", children }) {
  return (
    <div style={{
      background:`${accent}0e`, border:`1px solid ${accent}30`,
      borderRadius:10, padding:"13px 15px", marginBottom:10,
    }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{
            color:"rgba(100,116,139,1)", fontSize:9, fontWeight:700,
            letterSpacing:".09em", textTransform:"uppercase",
            fontFamily:"'DM Mono',monospace", marginBottom:5,
          }}>{icon} {label}</div>
          <div style={{
            color:accent, fontSize:28, fontWeight:800,
            fontFamily:"'DM Mono',monospace", lineHeight:1,
          }}>
            {value}
            {unit&&<span style={{ fontSize:14, color:`${accent}90`, marginLeft:6, fontWeight:600 }}>{unit}</span>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export default function AreaPropertiesPanel({ drawing, geojsonFeature, onClose }) {
  const [distUnit, setDistUnit] = useState("m");
  const [areaUnit, setAreaUnit] = useState("ha");
  const [tab, setTab]           = useState("measurements");

  const info = useMemo(()=>normalise(drawing,geojsonFeature),[drawing,geojsonFeature]);
  if (!info) return null;

  const { name, props, areaSqM, perimM, lengthM, rawPts, type, count, polyCount } = info;

  const isPolygon = ["Polygon","MultiPolygon","FeatureCollection","GeometryCollection"].includes(type) && areaSqM>0;
  const isLine    = ["LineString","MultiLineString"].includes(type)||(lengthM>0&&areaSqM===0);
  const isPoint   = type==="Point"||type==="MultiPoint";

  const dU = DIST_UNITS.find(u=>u.key===distUnit)||DIST_UNITS[0];
  const aU = AREA_UNITS.find(u=>u.key===areaUnit)||AREA_UNITS[0];
  const cen = centroid(rawPts);

  const propEntries = props
    ? Object.entries(props).filter(([k])=>!["styleUrl","styleHash","Style"].includes(k))
    : [];

  const typeLabel =
    type==="MultiPolygon"      ? `MultiPolygon (${polyCount||"?"} parts)` :
    type==="FeatureCollection" ? `Feature Collection (${count||"?"} features)` :
    type;

  const TABS = [
    { id:"measurements", label:"📐 Area & Measurements" },
    { id:"details",      label:"📋 Summary"             },
    ...(propEntries.length?[{ id:"properties", label:`🏷 Attributes (${propEntries.length})` }]:[]),
  ];

  return (
    <div onClick={e=>{ if(e.target===e.currentTarget) onClose(); }} style={{
      position:"fixed", inset:0, zIndex:9500,
      background:"rgba(0,0,0,0.65)", backdropFilter:"blur(10px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:16, fontFamily:"'DM Sans',system-ui,sans-serif",
    }}>
      <div style={{
        background:"#0b1220", borderRadius:16,
        border:"1px solid rgba(255,160,20,.22)",
        boxShadow:"0 28px 70px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.04)",
        width:"100%", maxWidth:540, maxHeight:"92vh",
        display:"flex", flexDirection:"column", overflow:"hidden",
      }}>

        {/* ── Header ── */}
        <div style={{
          background:"linear-gradient(180deg,#121f35 0%,#0e1928 100%)",
          padding:"15px 18px", borderBottom:"1px solid rgba(255,255,255,.07)",
          display:"flex", alignItems:"center", gap:13,
        }}>
          <div style={{
            width:40, height:40, borderRadius:11, flexShrink:0,
            background: isPolygon
              ? "linear-gradient(135deg,#ff8c00,#fbbf24)"
              : isLine
              ? "linear-gradient(135deg,#3b82f6,#06b6d4)"
              : "linear-gradient(135deg,#10b981,#34d399)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:20, boxShadow:"0 4px 12px rgba(0,0,0,.4)",
          }}>
            {isPolygon?"⬡":isLine?"〰":"📍"}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{
              color:"#f1f5f9", fontWeight:700, fontSize:14.5,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            }}>{name}</div>
            <div style={{
              color:"#475569", fontSize:10, fontFamily:"'DM Mono',monospace", marginTop:3,
              display:"flex", alignItems:"center", gap:8, flexWrap:"wrap",
            }}>
              <span>{typeLabel}</span>
              <span>·</span>
              <span>{rawPts.length} coords</span>
              {isPolygon&&areaSqM>0&&<>
                <span>·</span>
                <span style={{ color:"#fbbf24" }}>{fmtArea(areaSqM,"ha")} ha</span>
              </>}
            </div>
          </div>
          <button onClick={onClose} style={{
            background:"rgba(239,68,68,.15)", border:"1px solid rgba(239,68,68,.3)",
            color:"#f87171", width:32, height:32, borderRadius:8,
            cursor:"pointer", fontSize:18, fontWeight:700,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>×</button>
        </div>

        {/* ── Quick-look banner (the Google Earth coloured strip) ── */}
        {isPolygon && areaSqM>0 && (
          <div style={{
            background:"linear-gradient(90deg,rgba(251,191,36,.13) 0%,rgba(245,158,11,.05) 100%)",
            borderBottom:"1px solid rgba(251,191,36,.2)",
            padding:"10px 18px",
            display:"flex", alignItems:"center", gap:0, overflowX:"auto",
          }}>
            {AREA_UNITS.map((u,i)=>(
              <div key={u.key} onClick={()=>setAreaUnit(u.key)} style={{
                display:"flex", flexDirection:"column", padding:"0 14px",
                borderRight:i<AREA_UNITS.length-1?"1px solid rgba(251,191,36,.15)":"none",
                cursor:"pointer", flexShrink:0,
              }}>
                <span style={{ color:"rgba(251,191,36,.5)", fontSize:8, fontWeight:700, letterSpacing:".08em", fontFamily:"'DM Mono',monospace" }}>
                  {u.abbr}
                </span>
                <span style={{
                  color: areaUnit===u.key?"#fde68a":"#a16207",
                  fontSize:13, fontWeight:800, fontFamily:"'DM Mono',monospace", lineHeight:1.3,
                  textDecoration:areaUnit===u.key?"underline":"none",
                }}>
                  {fmtArea(areaSqM,u.key)}
                </span>
              </div>
            ))}
            <div style={{ marginLeft:"auto", paddingLeft:12, flexShrink:0 }}>
              <CopyBtn text={AREA_UNITS.map(u=>`${fmtArea(areaSqM,u.key)} ${u.abbr}`).join(" | ")}/>
            </div>
          </div>
        )}
        {isLine && lengthM>0 && (
          <div style={{
            background:"linear-gradient(90deg,rgba(59,130,246,.12) 0%,rgba(6,182,212,.05) 100%)",
            borderBottom:"1px solid rgba(59,130,246,.2)",
            padding:"10px 18px",
            display:"flex", alignItems:"center", gap:0, overflowX:"auto",
          }}>
            {DIST_UNITS.map((u,i)=>(
              <div key={u.key} onClick={()=>setDistUnit(u.key)} style={{
                display:"flex", flexDirection:"column", padding:"0 14px",
                borderRight:i<DIST_UNITS.length-1?"1px solid rgba(59,130,246,.15)":"none",
                cursor:"pointer", flexShrink:0,
              }}>
                <span style={{ color:"rgba(96,165,250,.5)", fontSize:8, fontWeight:700, letterSpacing:".08em", fontFamily:"'DM Mono',monospace" }}>{u.abbr}</span>
                <span style={{
                  color: distUnit===u.key?"#bfdbfe":"#1e40af",
                  fontSize:13, fontWeight:800, fontFamily:"'DM Mono',monospace", lineHeight:1.3,
                }}>{fmtDist(lengthM,u.key)}</span>
              </div>
            ))}
            <div style={{ marginLeft:"auto", paddingLeft:12, flexShrink:0 }}>
              <CopyBtn text={DIST_UNITS.map(u=>`${fmtDist(lengthM,u.key)} ${u.abbr}`).join(" | ")}/>
            </div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{
          display:"flex", background:"#0d1724",
          borderBottom:"1px solid rgba(255,255,255,.06)", padding:"0 4px",
          overflowX:"auto",
        }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:"9px 14px", fontSize:11, fontWeight:700,
              border:"none", background:"transparent", cursor:"pointer",
              color:tab===t.id?"#fbbf24":"#475569",
              borderBottom:`2px solid ${tab===t.id?"#fbbf24":"transparent"}`,
              fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap",
              transition:"color .15s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── Body ── */}
        <div style={{ overflowY:"auto", padding:"16px 18px 24px", flex:1 }}>

          {/* ════ MEASUREMENTS ════════════════════════════════════ */}
          {tab==="measurements" && (<>

            {/* POLYGON */}
            {isPolygon && areaSqM>0 && (<>
              <StatRow icon="⬡" label="Area" value={fmtArea(areaSqM,areaUnit)} unit={aU.abbr} accent="#fbbf24">
                <select value={areaUnit} onChange={e=>setAreaUnit(e.target.value)} style={{
                  padding:"6px 10px", borderRadius:8, outline:"none", cursor:"pointer",
                  border:"1px solid rgba(251,191,36,.3)", background:"#1a2840", color:"#e2e8f0", fontSize:11,
                }}>
                  {AREA_UNITS.map(u=><option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
                </select>
              </StatRow>

              {/* All area units — full table like Google Earth */}
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
                  const val=fmtArea(areaSqM,u.key), on=u.key===areaUnit;
                  return (
                    <div key={u.key} onClick={()=>setAreaUnit(u.key)} style={{
                      display:"flex", alignItems:"center", padding:"10px 12px", cursor:"pointer",
                      background:on?"rgba(251,191,36,.09)":"transparent",
                      borderBottom:i<AREA_UNITS.length-1?"1px solid rgba(255,255,255,.04)":"none",
                      transition:"background .12s",
                    }}>
                      <div style={{ width:52, color:on?"#fbbf24":"#64748b", fontSize:10.5, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{u.abbr}</div>
                      <div style={{ flex:1, color:on?"#fde68a":"#cbd5e1", fontSize:14, fontFamily:"'DM Mono',monospace", fontWeight:on?800:500 }}>{val}</div>
                      <div style={{ color:"#334155", fontSize:9.5, marginRight:10 }}>{u.label}</div>
                      <CopyBtn text={`${val} ${u.abbr}`} small/>
                    </div>
                  );
                })}
              </div>

              <StatRow icon="📏" label="Perimeter" value={fmtDist(perimM,distUnit)} unit={dU.abbr} accent="#34d399">
                <select value={distUnit} onChange={e=>setDistUnit(e.target.value)} style={{
                  padding:"6px 10px", borderRadius:8, outline:"none", cursor:"pointer",
                  border:"1px solid rgba(52,211,153,.3)", background:"#1a2840", color:"#e2e8f0", fontSize:11,
                }}>
                  {DIST_UNITS.map(u=><option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
                </select>
              </StatRow>
              <div style={{
                display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:5, marginBottom:4,
              }}>
                {DIST_UNITS.map(u=>{
                  const val=fmtDist(perimM,u.key), on=u.key===distUnit;
                  return (
                    <div key={u.key} onClick={()=>setDistUnit(u.key)} style={{
                      padding:"7px 9px", borderRadius:8, cursor:"pointer",
                      background:on?"rgba(52,211,153,.1)":"rgba(255,255,255,.025)",
                      border:`1px solid ${on?"rgba(52,211,153,.35)":"rgba(255,255,255,.05)"}`,
                    }}>
                      <div style={{ color:on?"#6ee7b7":"#475569", fontSize:9, fontWeight:700, marginBottom:2 }}>{u.abbr}</div>
                      <div style={{ color:on?"#d1fae5":"#e2e8f0", fontSize:12, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>{val}</div>
                    </div>
                  );
                })}
              </div>
            </>)}

            {/* LINE */}
            {isLine && lengthM>0 && (<>
              <StatRow icon="〰" label="Total Length" value={fmtDist(lengthM,distUnit)} unit={dU.abbr} accent="#60a5fa">
                <select value={distUnit} onChange={e=>setDistUnit(e.target.value)} style={{
                  padding:"6px 10px", borderRadius:8, outline:"none", cursor:"pointer",
                  border:"1px solid rgba(96,165,250,.3)", background:"#1a2840", color:"#e2e8f0", fontSize:11,
                }}>
                  {DIST_UNITS.map(u=><option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>)}
                </select>
              </StatRow>

              <div style={{
                background:"rgba(255,255,255,.02)", border:"1px solid rgba(255,255,255,.06)",
                borderRadius:10, overflow:"hidden", marginBottom:14,
              }}>
                <div style={{
                  padding:"7px 12px", background:"rgba(255,255,255,.04)",
                  borderBottom:"1px solid rgba(255,255,255,.06)",
                  color:"#334155", fontSize:9, fontWeight:700, letterSpacing:".07em",
                }}>ALL DISTANCE UNITS</div>
                {DIST_UNITS.map((u,i)=>{
                  const val=fmtDist(lengthM,u.key), on=u.key===distUnit;
                  return (
                    <div key={u.key} onClick={()=>setDistUnit(u.key)} style={{
                      display:"flex", alignItems:"center", padding:"10px 12px", cursor:"pointer",
                      background:on?"rgba(96,165,250,.09)":"transparent",
                      borderBottom:i<DIST_UNITS.length-1?"1px solid rgba(255,255,255,.04)":"none",
                      transition:"background .12s",
                    }}>
                      <div style={{ width:52, color:on?"#60a5fa":"#64748b", fontSize:10.5, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{u.abbr}</div>
                      <div style={{ flex:1, color:on?"#bfdbfe":"#cbd5e1", fontSize:14, fontFamily:"'DM Mono',monospace", fontWeight:on?800:500 }}>{val}</div>
                      <div style={{ color:"#334155", fontSize:9.5, marginRight:10 }}>{u.label}</div>
                      <CopyBtn text={`${val} ${u.abbr}`} small/>
                    </div>
                  );
                })}
              </div>

              {/* Segment table */}
              {rawPts.length>=2&&(
                <div style={{
                  background:"rgba(255,255,255,.02)", border:"1px solid rgba(255,255,255,.06)",
                  borderRadius:10, overflow:"hidden",
                }}>
                  <div style={{
                    display:"grid", gridTemplateColumns:"40px 80px 1fr 1fr",
                    padding:"7px 10px", background:"rgba(255,255,255,.04)",
                    borderBottom:"1px solid rgba(255,255,255,.06)",
                  }}>
                    {["Seg","Pts","Distance","Cumulative"].map(h=>(
                      <div key={h} style={{ color:"#334155", fontSize:9, fontWeight:700, letterSpacing:".06em" }}>{h}</div>
                    ))}
                  </div>
                  <div style={{ maxHeight:200, overflowY:"auto" }}>
                    {rawPts.slice(1).map((pt,i)=>{
                      const seg=haversine(rawPts[i],pt);
                      const cum=rawPts.slice(0,i+2).reduce((s,p,j)=>j===0?0:s+haversine(rawPts[j-1],p),0);
                      return (
                        <div key={i} style={{
                          display:"grid", gridTemplateColumns:"40px 80px 1fr 1fr",
                          padding:"5px 10px",
                          background:i%2===0?"transparent":"rgba(255,255,255,.015)",
                          borderBottom:i<rawPts.length-2?"1px solid rgba(255,255,255,.03)":"none",
                        }}>
                          <div style={{ color:"#fbbf24", fontSize:10, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>S{i+1}</div>
                          <div style={{ color:"#475569", fontSize:9.5, fontFamily:"'DM Mono',monospace" }}>Pt{i+1}→{i+2}</div>
                          <div style={{ color:"#fde68a", fontSize:10.5, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>{smartDist(seg)}</div>
                          <div style={{ color:"#6ee7b7", fontSize:10, fontFamily:"'DM Mono',monospace" }}>{smartDist(cum)}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{
                    display:"grid", gridTemplateColumns:"40px 80px 1fr 1fr",
                    padding:"7px 10px", background:"rgba(251,191,36,.06)",
                    borderTop:"1px solid rgba(251,191,36,.18)",
                  }}>
                    <div/><div style={{ color:"#92400e", fontSize:9, fontWeight:700 }}>{rawPts.length-1} segs</div>
                    <div/>
                    <div style={{ color:"#fbbf24", fontSize:11, fontFamily:"'DM Mono',monospace", fontWeight:800 }}>{smartDist(lengthM)}</div>
                  </div>
                </div>
              )}
            </>)}

            {/* POINT */}
            {isPoint && rawPts.length>0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {[
                  ["📍 Latitude (decimal)",  rawPts[0].lat.toFixed(8)+"°"],
                  ["📍 Longitude (decimal)", rawPts[0].lng.toFixed(8)+"°"],
                  ["🧭 Latitude DMS",        toDMS(rawPts[0].lat,"N","S")],
                  ["🧭 Longitude DMS",       toDMS(rawPts[0].lng,"E","W")],
                  ["🗺 UTM Zone",            toUTM(rawPts[0].lat,rawPts[0].lng)],
                ].map(([label,val])=>(
                  <div key={label} style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"10px 13px", borderRadius:9,
                    background:"rgba(74,158,255,.07)", border:"1px solid rgba(74,158,255,.18)",
                  }}>
                    <div>
                      <div style={{ color:"#475569", fontSize:9, fontWeight:700, marginBottom:3 }}>{label}</div>
                      <div style={{ color:"#90c8ff", fontSize:13.5, fontFamily:"'DM Mono',monospace", fontWeight:700 }}>{val}</div>
                    </div>
                    <CopyBtn text={val}/>
                  </div>
                ))}
              </div>
            )}

            {!isPolygon&&!isLine&&!isPoint&&(
              <div style={{ color:"#475569", fontSize:12, fontStyle:"italic", textAlign:"center", padding:"40px 0" }}>
                No geometry could be calculated for this feature.
              </div>
            )}
          </>)}

          {/* ════ SUMMARY ═════════════════════════════════════════ */}
          {tab==="details" && (
            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
              {[
                ["Feature name",   name],
                ["Geometry type",  typeLabel],
                ["Coordinates",    String(rawPts.length)],
                ...(isPolygon&&areaSqM>0?[
                  ["Area  (m²)",   fmtArea(areaSqM,"m2")+" m²"],
                  ["Area  (km²)",  fmtArea(areaSqM,"km2")+" km²"],
                  ["Area  (ha)",   fmtArea(areaSqM,"ha")+" ha"],
                  ["Area  (acres)",fmtArea(areaSqM,"ac")+" ac"],
                  ["Area  (ft²)",  fmtArea(areaSqM,"ft2")+" ft²"],
                  ["Area  (mi²)",  fmtArea(areaSqM,"mi2")+" mi²"],
                  ["Perimeter",    smartDist(perimM)],
                ]:[]),
                ...(isLine&&lengthM>0?[
                  ["Length",    smartDist(lengthM)],
                  ["Length km", fmtDist(lengthM,"km")+" km"],
                  ["Length mi", fmtDist(lengthM,"mi")+" mi"],
                  ["Segments",  String(rawPts.length-1)],
                ]:[]),
                ...(cen?[
                  ["Centroid lat", cen.lat.toFixed(6)+"°"],
                  ["Centroid lng", cen.lng.toFixed(6)+"°"],
                ]:[]),
              ].map(([label,val])=>(
                <div key={label} style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"8px 12px", borderRadius:8,
                  background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.06)",
                }}>
                  <div>
                    <div style={{ color:"#475569", fontSize:9.5, fontWeight:700 }}>{label}</div>
                    <div style={{ color:"#e2e8f0", fontSize:12.5, fontFamily:"'DM Mono',monospace" }}>{val}</div>
                  </div>
                  <CopyBtn text={val}/>
                </div>
              ))}
            </div>
          )}

          {/* ════ ATTRIBUTES ══════════════════════════════════════ */}
          {tab==="properties" && (
            <div>
              {propEntries.length===0?(
                <div style={{ color:"#475569", fontSize:12, fontStyle:"italic", textAlign:"center", padding:"32px 0" }}>
                  No attributes attached to this feature.
                </div>
              ):(
                <div style={{
                  background:"rgba(255,255,255,.02)", border:"1px solid rgba(255,255,255,.06)",
                  borderRadius:10, overflow:"hidden",
                }}>
                  <div style={{
                    padding:"7px 12px", background:"rgba(255,255,255,.04)",
                    borderBottom:"1px solid rgba(255,255,255,.06)",
                    color:"#334155", fontSize:9, fontWeight:700, letterSpacing:".07em",
                  }}>{propEntries.length} ATTRIBUTE{propEntries.length!==1?"S":""}</div>
                  {propEntries.map(([k,v],i)=>(
                    <div key={k} style={{
                      display:"flex", alignItems:"center", padding:"9px 12px",
                      background:i%2===0?"transparent":"rgba(255,255,255,.015)",
                      borderBottom:i<propEntries.length-1?"1px solid rgba(255,255,255,.04)":"none",
                    }}>
                      <div style={{
                        width:120, color:"#94a3b8", fontSize:10, fontWeight:700,
                        fontFamily:"'DM Mono',monospace", flexShrink:0,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      }}>{k}</div>
                      <div style={{
                        flex:1, color:"#cbd5e1", fontSize:11.5,
                        fontFamily:"'DM Mono',monospace",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      }}>{String(v??"—")}</div>
                      <CopyBtn text={String(v??"")} small/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div style={{
          padding:"10px 18px", background:"#0d1724",
          borderTop:"1px solid rgba(255,255,255,.06)",
          display:"flex", alignItems:"center", justifyContent:"space-between",
        }}>
          <span style={{ color:"#1e3a5f", fontSize:10, fontFamily:"'DM Mono',monospace" }}>
            WGS-84 spherical · SurveyMap Pro
          </span>
          <button onClick={onClose} style={{
            padding:"8px 24px", borderRadius:9, cursor:"pointer",
            background:"rgba(74,158,255,.15)", border:"1px solid rgba(74,158,255,.4)",
            color:"#80c4ff", fontSize:12, fontWeight:700,
          }}>OK</button>
        </div>

      </div>
    </div>
  );
}

