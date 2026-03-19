/**
 * LiveTrackRecorder.jsx -- SurveyMap Pro v5.1 (Professional Mobile UI)
 * Redesigned: compact typography, refined dark instrument-panel aesthetic
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import L from "leaflet";

/* --- Constants ------------------------------------------------------------ */
const MIN_DISTANCE_M   = 3;
const AUTO_PAUSE_SPEED = 0.3;
const AUTO_PAUSE_SECS  = 8;
const DB_NAME          = "SurveyMapPro";
const DB_VERSION       = 2;
const STORE_TRACKS     = "tracks";
const STORE_PHOTOS     = "photos";

const TRACK_COLORS = [
  { name:"Crimson", hex:"#e63946" },
  { name:"Azure",   hex:"#4895ef" },
  { name:"Jade",    hex:"#2dc653" },
  { name:"Ember",   hex:"#f4a261" },
  { name:"Violet",  hex:"#9b72cf" },
  { name:"Teal",    hex:"#4cc9f0" },
];

/* --- Design tokens -------------------------------------------------------- */
const T = {
  bg:       "#080d17",
  surface:  "rgba(255,255,255,0.033)",
  surfaceHi:"rgba(255,255,255,0.06)",
  border:   "rgba(255,255,255,0.07)",
  borderHi: "rgba(255,255,255,0.13)",
  text:     "#dde8f8",
  textDim:  "rgba(180,205,240,0.45)",
  textFaint:"rgba(140,170,210,0.25)",
  red:    "#e63946",
  amber:  "#f4a261",
  green:  "#2dc653",
  blue:   "#4895ef",
  violet: "#9b72cf",
  cyan:   "#4cc9f0",
  teal:   "#06d6a0",
  pink:   "#f72585",
};

const FONT_MONO = `"JetBrains Mono","Fira Code","Cascadia Code",ui-monospace,monospace`;
const FONT_UI   = `"Geist","DM Sans","Outfit",system-ui,sans-serif`;

/* --- Helpers --------------------------------------------------------------- */
function haversine(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

export function formatDuration(ms) {
  const s = Math.floor((ms||0)/1000);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

export function formatDist(m) {
  if (m >= 1000) return `${(m/1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function fmtSpeed(ms) { return ((ms||0)*3.6).toFixed(1); }

function fmtPace(ms) {
  if (!ms || ms < 0.1) return "--";
  const spm = 1000/ms, mm = Math.floor(spm/60), ss = Math.round(spm%60);
  return `${mm}:${String(ss).padStart(2,"0")}`;
}

function nowISO() { return new Date().toISOString(); }
function buildId()  { return `track_${Date.now()}`; }

async function getBattery() {
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      return Math.round(b.level * 100);
    }
  } catch (_) {}
  return null;
}

/* --- IndexedDB ------------------------------------------------------------ */
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS))
        db.createObjectStore(STORE_TRACKS, { keyPath:"id" });
      if (!db.objectStoreNames.contains(STORE_PHOTOS))
        db.createObjectStore(STORE_PHOTOS, { keyPath:"id" });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function esc(s) {
  return String(s||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* --- Export builders ------------------------------------------------------ */
function buildGPX(track) {
  const wpts = (track.waypoints||[]).map(w => `
  <wpt lat="${w.lat}" lon="${w.lng}">
    <ele>${w.alt??0}</ele><time>${w.time}</time>
    <name>${esc(w.name)}</name><desc>${esc(w.note||"")}</desc>
    <sym>${w.photo?"Camera":"Flag, Blue"}</sym>
  </wpt>`).join("");
  const tpts = (track.points||[]).map(p =>
    `      <trkpt lat="${p.lat}" lon="${p.lng}">
        <ele>${p.alt??0}</ele><time>${p.time}</time>
        <extensions><speed>${p.speed??0}</speed><accuracy>${p.accuracy??0}</accuracy>${p.battery!=null?`<battery>${p.battery}</battery>`:""}</extensions>
      </trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SurveyMap Pro" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(track.name)}</name><time>${track.startTime}</time></metadata>
${wpts}
  <trk><name>${esc(track.name)}</name>
    <extensions><color>${track.color||"#e63946"}</color></extensions>
    <trkseg>${tpts}</trkseg>
  </trk>
</gpx>`;
}

function buildKML(track) {
  const hex = (track.color||"#e63946").replace("#","");
  const [r,g,b] = [hex.slice(0,2),hex.slice(2,4),hex.slice(4,6)];
  const kmlColor = `ff${b}${g}${r}`;
  const coords = (track.points||[]).map(p=>`${p.lng},${p.lat},${p.alt??0}`).join(" ");
  const pmarks = (track.waypoints||[]).map(w=>`
  <Placemark><name>${esc(w.name)}</name>
    <description>${esc(w.note||"")}</description>
    <TimeStamp><when>${w.time}</when></TimeStamp>
    <Point><coordinates>${w.lng},${w.lat},${w.alt??0}</coordinates></Point>
  </Placemark>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${esc(track.name)}</name>
  <Style id="ts"><LineStyle><color>${kmlColor}</color><width>3</width></LineStyle></Style>
  <Placemark><name>${esc(track.name)}</name><styleUrl>#ts</styleUrl>
    <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
  </Placemark>${pmarks}
</Document></kml>`;
}

function buildGeoJSON(track) {
  const features = [{
    type:"Feature",
    properties:{ name:track.name, color:track.color, distance:track.stats?.distance||0 },
    geometry:{ type:"LineString", coordinates:(track.points||[]).map(p=>[p.lng,p.lat,p.alt??0]) }
  },
  ...(track.waypoints||[]).map(w=>({
    type:"Feature",
    properties:{ name:w.name, note:w.note, time:w.time, photo:w.photo },
    geometry:{ type:"Point", coordinates:[w.lng,w.lat,w.alt??0] }
  }))];
  return JSON.stringify({ type:"FeatureCollection", features }, null, 2);
}

function buildCSV(track) {
  const rows = ["lat,lng,alt,time,speed,accuracy,battery"];
  (track.points||[]).forEach(p => {
    rows.push(`${p.lat},${p.lng},${p.alt??0},${p.time},${p.speed??0},${p.accuracy??0},${p.battery??""}`);
  });
  return rows.join("\n");
}

async function buildKMZ(track, photoMap) {
  const hex = (track.color||"#e63946").replace("#","");
  const [r,g,b] = [hex.slice(0,2),hex.slice(2,4),hex.slice(4,6)];
  const kmlColor = `ff${b}${g}${r}`;
  const coords = (track.points||[]).map(p=>`${p.lng},${p.lat},${p.alt??0}`).join(" ");
  const pmarks = (track.waypoints||[]).map((w,i)=>{
    const photoTag = w.photo
      ? `<description><![CDATA[<img src="files/photo_${i}.jpg" width="300"/><br/>${esc(w.note||"")}]]></description>`
      : `<description>${esc(w.note||"")}</description>`;
    return `<Placemark><name>${esc(w.name)}</name>${photoTag}
      <TimeStamp><when>${w.time}</when></TimeStamp>
      <Point><coordinates>${w.lng},${w.lat},${w.alt??0}</coordinates></Point>
    </Placemark>`;
  }).join("");
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${esc(track.name)}</name>
  <Style id="ts"><LineStyle><color>${kmlColor}</color><width>3</width></LineStyle></Style>
  <Placemark><name>${esc(track.name)}</name><styleUrl>#ts</styleUrl>
    <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
  </Placemark>${pmarks}
</Document></kml>`;
  const files = [{ name:"doc.kml", data:new TextEncoder().encode(kml) }];
  (track.waypoints||[]).forEach((w,i) => {
    if (w.photo && photoMap[w.photoId]) {
      const b64 = photoMap[w.photoId];
      const bin = atob(b64.split(",")[1]||b64);
      const arr = new Uint8Array(bin.length);
      for (let j=0;j<bin.length;j++) arr[j]=bin.charCodeAt(j);
      files.push({ name:`files/photo_${i}.jpg`, data:arr });
    }
  });
  return buildZip(files);
}

function buildZip(files) {
  const tbl = (() => {
    const t = new Uint32Array(256);
    for (let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[i]=c;}
    return t;
  })();
  function crc32(d){let c=0xffffffff;for(const b of d)c=tbl[(c^b)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;}
  function u16(n){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,n,true);return a;}
  function u32(n){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n,true);return a;}
  const parts=[],cd=[];let offset=0;
  for(const f of files){
    const name=new TextEncoder().encode(f.name),data=f.data,crc=crc32(data);
    const lh=new Uint8Array([0x50,0x4b,0x03,0x04,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      ...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0x00,0x00,...name]);
    parts.push(lh,data);cd.push({name,data,crc,offset,size:data.length});offset+=lh.length+data.length;
  }
  const cdStart=offset;
  for(const f of cd){
    const e=new Uint8Array([0x50,0x4b,0x01,0x02,0x14,0x00,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      ...u32(f.crc),...u32(f.size),...u32(f.size),...u16(f.name.length),0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      0x00,0x00,...u32(f.offset),...f.name]);
    parts.push(e);offset+=e.length;
  }
  parts.push(new Uint8Array([0x50,0x4b,0x05,0x06,0x00,0x00,0x00,0x00,...u16(cd.length),...u16(cd.length),
    ...u32(offset-cdStart),...u32(cdStart),0x00,0x00]));
  const total=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(total);let pos=0;
  for(const p of parts){out.set(p,pos);pos+=p.length;}
  return out;
}

function dl(content, filename, mime) {
  const blob = content instanceof Uint8Array
    ? new Blob([content],{type:mime}) : new Blob([content],{type:mime});
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"),{href:url,download:filename}).click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

/* --- Leaflet icons -------------------------------------------------------- */
function flagIcon(color, label) {
  return L.divIcon({
    className:"",
    html:`<div style="display:flex;flex-direction:column;align-items:flex-start;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.6))">
      <div style="display:flex;align-items:center">
        <div style="width:2px;height:28px;background:${color};border-radius:2px;"></div>
        <div style="background:${color};color:#fff;font-size:8px;font-weight:800;
          padding:2px 6px;border-radius:0 4px 4px 0;letter-spacing:.06em;
          font-family:'JetBrains Mono',monospace;white-space:nowrap;">${label}</div>
      </div></div>`,
    iconSize:[60,28],iconAnchor:[3,28],popupAnchor:[30,-30],
  });
}

const WPT_ICON = L.divIcon({
  className:"",
  html:`<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
    <div style="width:26px;height:26px;border-radius:50%;background:#4895ef;border:2.5px solid #fff;
      display:flex;align-items:center;justify-content:center;font-size:12px;">📍</div>
    <div style="width:2px;height:8px;background:#4895ef;margin-top:-1px;border-radius:0 0 2px 2px;"></div>
  </div>`,
  iconSize:[26,36],iconAnchor:[13,36],popupAnchor:[0,-38],
});

const PHOTO_ICON = L.divIcon({
  className:"",
  html:`<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
    <div style="width:26px;height:26px;border-radius:50%;background:#f4a261;border:2.5px solid #fff;
      display:flex;align-items:center;justify-content:center;font-size:12px;">📷</div>
    <div style="width:2px;height:8px;background:#f4a261;margin-top:-1px;border-radius:0 0 2px 2px;"></div>
  </div>`,
  iconSize:[26,36],iconAnchor:[13,36],popupAnchor:[0,-38],
});

const POS_ICON = L.divIcon({
  className:"",
  html:`<div style="width:14px;height:14px;border-radius:50%;background:#4cc9f0;
    border:2.5px solid #fff;box-shadow:0 0 10px rgba(76,201,240,0.9);"></div>`,
  iconSize:[14,14],iconAnchor:[7,7],
});

/* --- Compact stat cell ---------------------------------------------------- */
function StatCell({ label, value, unit, color=T.text, wide=false }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 7,
      padding: "5px 8px 6px",
      display: "flex",
      flexDirection: "column",
      gap: 1,
      gridColumn: wide ? "span 2" : undefined,
    }}>
      <div style={{
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: "0.11em",
        color: T.textFaint,
        textTransform: "uppercase",
        fontFamily: FONT_MONO,
        lineHeight: 1,
      }}>{label}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap: 2 }}>
        <span style={{
          fontSize: 13,
          fontWeight: 700,
          color,
          fontFamily: FONT_MONO,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
        }}>{value ?? "--"}</span>
        {value != null && unit && (
          <span style={{
            fontSize: 8,
            color: T.textFaint,
            fontFamily: FONT_MONO,
            letterSpacing: "0.04em",
          }}>{unit}</span>
        )}
      </div>
    </div>
  );
}

/* --- Divider -------------------------------------------------------------- */
function Divider() {
  return <div style={{ height:1, background:T.border, margin:"0 -14px" }}/>;
}

/* --- Modal ---------------------------------------------------------------- */
function Modal({ children, onClose }) {
  return (
    <div
      style={{
        position:"fixed",inset:0,zIndex:9999,
        background:"rgba(0,0,0,0.72)",backdropFilter:"blur(12px)",
        WebkitBackdropFilter:"blur(12px)",
        display:"flex",alignItems:"flex-end",justifyContent:"center",
        padding:"0 0 env(safe-area-inset-bottom,0)",
      }}
      onClick={e=>e.target===e.currentTarget&&onClose?.()}
    >
      <div style={{
        background:"#0d1525",
        borderRadius:"16px 16px 0 0",
        border:`1px solid ${T.borderHi}`,
        borderBottom:"none",
        padding:"20px 18px 28px",
        width:"100%",
        maxWidth:420,
        boxShadow:"0 -20px 60px rgba(0,0,0,0.7)",
        fontFamily: FONT_UI,
      }}>
        {/* Handle */}
        <div style={{ display:"flex",justifyContent:"center",marginBottom:16 }}>
          <div style={{ width:36,height:3,borderRadius:2,background:"rgba(255,255,255,0.15)" }}/>
        </div>
        {children}
      </div>
    </div>
  );
}

function MInput({ label, value, onChange, placeholder, multiline, autoFocus }) {
  const s = {
    width:"100%",padding:"8px 11px",borderRadius:8,
    border:`1px solid ${T.borderHi}`,
    background:"rgba(255,255,255,0.05)",color:T.text,
    fontSize:12,outline:"none",fontFamily: FONT_UI,
    marginBottom:10,boxSizing:"border-box",resize:"vertical",
    lineHeight:1.5,
  };
  return (
    <div>
      {label && (
        <div style={{
          color: T.textFaint,fontSize:9,fontWeight:700,
          letterSpacing:".1em",marginBottom:4,textTransform:"uppercase",
          fontFamily: FONT_MONO,
        }}>{label}</div>
      )}
      {multiline
        ? <textarea autoFocus={autoFocus} rows={3} value={value}
            onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={s}/>
        : <input autoFocus={autoFocus} value={value}
            onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={s}/>
      }
    </div>
  );
}

function MActions({ onConfirm, onCancel, confirmLabel="Save", confirmColor=T.blue }) {
  return (
    <div style={{ display:"flex",gap:8,marginTop:6 }}>
      <button onClick={onConfirm} style={{
        flex:2,padding:"10px 0",borderRadius:9,border:"none",
        background: confirmColor,
        color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily: FONT_UI,
        letterSpacing:".02em",
      }}>{confirmLabel}</button>
      <button onClick={onCancel} style={{
        flex:1,padding:"10px 0",borderRadius:9,
        border:`1px solid ${T.border}`,
        background:"transparent",color:T.textDim,
        fontSize:12,cursor:"pointer",fontFamily: FONT_UI,
      }}>Cancel</button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════ */
export default function LiveTrackRecorder({
  map: mapProp, leafletMapRef,
  visible, onClose, onRecordingChange,
}) {
  const internalRef = useRef(null);
  useEffect(()=>{ internalRef.current = mapProp??null; },[mapProp]);
  const mapRef = leafletMapRef ?? internalRef;
  const getMap = () => mapRef.current;

  const [status,       setStatus]       = useState("idle");
  const [trackName,    setTrackName]    = useState("");
  const [trackColor,   setTrackColor]   = useState(TRACK_COLORS[0].hex);
  const [editingName,  setEditingName]  = useState(false);
  const [showColors,   setShowColors]   = useState(false);
  const [autoPaused,   setAutoPaused]   = useState(false);
  const [minimised,    setMinimised]    = useState(false);
  const [confirmStop,  setConfirmStop]  = useState(false);
  const [tab,          setTab]          = useState("stats");
  const [showExport,   setShowExport]   = useState(false);
  const [exporting,    setExporting]    = useState(null);

  const [stats, setStats] = useState({
    distance:0, totalDuration:0, movingDuration:0, stoppedDuration:0,
    speed:0, maxSpeed:0, avgSpeed:0, ascent:0, descent:0, points:0, battery:null,
  });

  const [waypoints, setWaypoints]     = useState([]);
  const [showWptModal, setShowWptModal] = useState(false);
  const [wptName, setWptName]         = useState("");
  const [wptNote, setWptNote]         = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [photoName,    setPhotoName]   = useState("");
  const [photoNote,    setPhotoNote]   = useState("");
  const photoInputRef = useRef(null);

  const trackIdRef    = useRef(null);
  const pointsRef     = useRef([]);
  const waypointsRef  = useRef([]);
  const photosRef     = useRef({});
  const startTimeRef  = useRef(null);
  const pausedMsRef   = useRef(0);
  const pauseStartRef = useRef(null);
  const lastPtRef     = useRef(null);
  const timerRef      = useRef(null);
  const watchIdRef    = useRef(null);
  const maxSpeedRef   = useRef(0);
  const statusRef     = useRef("idle");
  const trackNameRef  = useRef("");
  const trackColorRef = useRef(TRACK_COLORS[0].hex);
  const movingMsRef   = useRef(0);
  const lastMoveRef   = useRef(null);
  const stillSinceRef = useRef(null);

  const layerGroupRef = useRef(null);
  const polylineRef   = useRef(null);
  const posMarkerRef  = useRef(null);

  useEffect(()=>{ statusRef.current     = status;     },[status]);
  useEffect(()=>{ trackNameRef.current  = trackName;  },[trackName]);
  useEffect(()=>{ trackColorRef.current = trackColor; },[trackColor]);

  useEffect(()=>{
    const map = getMap();
    if (!map) return;
    layerGroupRef.current = L.layerGroup().addTo(map);
    return ()=>{ layerGroupRef.current?.remove(); };
  },[mapProp]);

  const persist = useCallback(async () => {
    if (!trackIdRef.current) return;
    try {
      await dbPut(STORE_TRACKS, {
        id: trackIdRef.current,
        name: trackNameRef.current,
        color: trackColorRef.current,
        startTime: new Date(startTimeRef.current).toISOString(),
        points: pointsRef.current,
        waypoints: waypointsRef.current,
        stats: { distance: pointsRef.current.reduce((s,_,i,a)=>i===0?0:s+haversine(a[i-1],a[i]),0) },
        savedAt: nowISO(),
      });
      for (const [id, data] of Object.entries(photosRef.current)) {
        await dbPut(STORE_PHOTOS, { id, data });
      }
    } catch (e) { console.warn("persist:", e); }
  },[]);

  useEffect(()=>{
    if (status==="recording") {
      timerRef.current = setInterval(async ()=>{
        const now   = Date.now();
        const total = now - startTimeRef.current - pausedMsRef.current;
        const pts   = pointsRef.current;
        let curSpeed = 0;
        if (pts.length >= 2) {
          const dt = (new Date(pts.at(-1).time) - new Date(pts.at(-2).time)) / 1000;
          if (dt > 0) curSpeed = haversine(pts.at(-2), pts.at(-1)) / dt;
        }
        if (curSpeed < AUTO_PAUSE_SPEED) {
          if (!stillSinceRef.current) stillSinceRef.current = now;
          if (now - stillSinceRef.current > AUTO_PAUSE_SECS*1000) {
            setAutoPaused(true);
            lastMoveRef.current = null;
          }
        } else {
          stillSinceRef.current = null;
          setAutoPaused(false);
          if (lastMoveRef.current) movingMsRef.current += now - lastMoveRef.current;
          lastMoveRef.current = now;
        }
        if (curSpeed > maxSpeedRef.current) maxSpeedRef.current = curSpeed;
        const movMs = movingMsRef.current;
        const dist  = pts.reduce((s,_,i,a)=>i===0?0:s+haversine(a[i-1],a[i]),0);
        const avgSpd = movMs>0 ? dist/(movMs/1000) : 0;
        const batt  = await getBattery();
        setStats(s=>({
          ...s,
          totalDuration: total,
          movingDuration: movMs,
          stoppedDuration: Math.max(0, total-movMs),
          speed: curSpeed,
          maxSpeed: maxSpeedRef.current,
          avgSpeed: avgSpd,
          battery: batt,
        }));
      },1000);
    } else {
      clearInterval(timerRef.current);
    }
    return ()=>clearInterval(timerRef.current);
  },[status]);

  const handleGPSPoint = useCallback(async pos => {
    if (statusRef.current === "paused") return;
    const { latitude:lat, longitude:lng, altitude:alt, speed, accuracy } = pos.coords;
    if (!isFinite(lat)||!isFinite(lng)) return;
    const battery = await getBattery();
    const pt = { lat, lng, alt:alt??0, speed:speed??0, accuracy:accuracy??0, time:nowISO(), battery };
    if (lastPtRef.current && haversine(lastPtRef.current, pt) < MIN_DISTANCE_M) return;
    pointsRef.current.push(pt);
    lastPtRef.current = pt;
    polylineRef.current?.addLatLng([lat,lng]);
    if (pointsRef.current.length === 1) {
      const map = getMap();
      map?.flyTo([lat,lng],16,{animate:true,duration:1.2});
      L.marker([lat,lng],{ icon:flagIcon("#2dc653","START"), zIndexOffset:900 })
        .bindTooltip("Start",{permanent:false,direction:"top"})
        .addTo(layerGroupRef.current);
    }
    if (posMarkerRef.current) {
      posMarkerRef.current.setLatLng([lat,lng]);
    } else {
      posMarkerRef.current = L.marker([lat,lng],{ icon:POS_ICON, zIndexOffset:1000 })
        .addTo(layerGroupRef.current);
    }
    const map = getMap();
    if (map && !map.getBounds().contains([lat,lng])) {
      map.panTo([lat,lng],{animate:true,duration:0.8});
    }
    const pts = pointsRef.current;
    let dist=0, asc=0, desc=0;
    for (let i=1;i<pts.length;i++){
      dist += haversine(pts[i-1],pts[i]);
      const dh = (pts[i].alt??0)-(pts[i-1].alt??0);
      if (dh>0) asc+=dh; else desc+=Math.abs(dh);
    }
    setStats(s=>({...s, distance:dist, ascent:asc, descent:desc, points:pts.length, battery }));
    if (pts.length%10===0) persist();
  },[]);

  const startRecording = useCallback(()=>{
    if (!getMap()) return;
    const id   = buildId();
    const name = `Track ${new Date().toLocaleDateString("en-IN",
      {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}`;
    trackIdRef.current   = id;
    pointsRef.current    = [];
    waypointsRef.current = [];
    photosRef.current    = {};
    startTimeRef.current = Date.now();
    pausedMsRef.current  = 0;
    maxSpeedRef.current  = 0;
    movingMsRef.current  = 0;
    lastMoveRef.current  = null;
    stillSinceRef.current= null;
    lastPtRef.current    = null;
    setTrackName(name);
    setWaypoints([]);
    setAutoPaused(false);
    setConfirmStop(false);
    setShowExport(false);
    setStats({ distance:0,totalDuration:0,movingDuration:0,stoppedDuration:0,
               speed:0,maxSpeed:0,avgSpeed:0,ascent:0,descent:0,points:0,battery:null });
    setStatus("recording");
    setMinimised(true);
    onRecordingChange?.(true);
    polylineRef.current = L.polyline([],{
      color: trackColorRef.current, weight:3.5, opacity:0.9,
      lineCap:"round", lineJoin:"round",
    }).addTo(layerGroupRef.current);
    if (!navigator.geolocation) {
      alert("GPS not available on this device.");
      setStatus("idle"); return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleGPSPoint,
      err => console.warn("GPS error:",err.message),
      { enableHighAccuracy:true, maximumAge:2000, timeout:15000 }
    );
  },[handleGPSPoint]);

  const pauseRecording  = useCallback(()=>{
    pauseStartRef.current = Date.now();
    lastMoveRef.current   = null;
    setStatus("paused");
  },[]);

  const resumeRecording = useCallback(()=>{
    if (pauseStartRef.current) pausedMsRef.current += Date.now()-pauseStartRef.current;
    setStatus("recording");
  },[]);

  const stopRecording = useCallback(async ()=>{
    navigator.geolocation.clearWatch(watchIdRef.current);
    if (lastPtRef.current) {
      const {lat,lng} = lastPtRef.current;
      L.marker([lat,lng],{ icon:flagIcon("#e63946","END"), zIndexOffset:900 })
        .bindTooltip("End",{permanent:false,direction:"top"})
        .addTo(layerGroupRef.current);
    }
    posMarkerRef.current?.remove();
    posMarkerRef.current = null;
    await persist();
    setStatus("stopped");
    setMinimised(false);
    setShowExport(true);
    onRecordingChange?.(false);
  },[persist]);

  const discardTrack = useCallback(()=>{
    navigator.geolocation.clearWatch(watchIdRef.current);
    layerGroupRef.current?.clearLayers();
    posMarkerRef.current = polylineRef.current = null;
    pointsRef.current = waypointsRef.current = [];
    photosRef.current = {};
    movingMsRef.current = 0;
    maxSpeedRef.current = 0;
    setStatus("idle");
    setMinimised(false);
    setShowExport(false);
    setConfirmStop(false);
    setWaypoints([]);
    setAutoPaused(false);
    onRecordingChange?.(false);
    setStats({ distance:0,totalDuration:0,movingDuration:0,stoppedDuration:0,
               speed:0,maxSpeed:0,avgSpeed:0,ascent:0,descent:0,points:0,battery:null });
  },[]);

  const addWaypoint = useCallback(()=>{
    if (!lastPtRef.current) return;
    setWptName(""); setWptNote(""); setShowWptModal(true);
  },[]);

  const confirmWaypoint = useCallback(()=>{
    if (!lastPtRef.current) return;
    const {lat,lng,alt} = lastPtRef.current;
    const wpt = {
      id:`wpt_${Date.now()}`, lat, lng, alt,
      name: wptName.trim()||`WPT ${waypointsRef.current.length+1}`,
      note: wptNote.trim(), time:nowISO(), photo:false, photoId:null,
    };
    waypointsRef.current.push(wpt);
    setWaypoints([...waypointsRef.current]);
    L.marker([lat,lng],{icon:WPT_ICON})
      .bindPopup(`<b>${wpt.name}</b>${wpt.note?`<br/><span style="font-size:11px">${wpt.note}</span>`:""}`)
      .addTo(layerGroupRef.current);
    setShowWptModal(false);
  },[wptName,wptNote]);

  const addPhoto = useCallback(()=>{
    if (!lastPtRef.current) return;
    photoInputRef.current?.click();
  },[]);

  const handlePhotoCapture = useCallback(e=>{
    const file = e.target.files?.[0];
    if (!file||!lastPtRef.current) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = ev=>{
      const {lat,lng,alt} = lastPtRef.current;
      setPendingPhoto({ dataURL:ev.target.result, lat, lng, alt });
      setPhotoName(`Photo ${Object.keys(photosRef.current).length+1}`);
      setPhotoNote("");
    };
    reader.readAsDataURL(file);
  },[]);

  const confirmPhoto = useCallback(()=>{
    if (!pendingPhoto) return;
    const {dataURL,lat,lng,alt} = pendingPhoto;
    const photoId = `photo_${Date.now()}`;
    photosRef.current[photoId] = dataURL;
    const wpt = {
      id:`wpt_${Date.now()}`, lat, lng, alt,
      name: photoName.trim()||`Photo ${Object.keys(photosRef.current).length}`,
      note: photoNote.trim(), time:nowISO(), photo:true, photoId,
    };
    waypointsRef.current.push(wpt);
    setWaypoints([...waypointsRef.current]);
    const thumb = `<img src="${dataURL}" style="width:200px;height:130px;object-fit:cover;border-radius:6px;display:block;"/>`;
    L.marker([lat,lng],{icon:PHOTO_ICON})
      .bindPopup(`<div style="padding:4px"><b>${wpt.name}</b><br/>${thumb}${wpt.note?`<div style="font-size:11px;margin-top:4px">${wpt.note}</div>`:""}</div>`,{maxWidth:240})
      .addTo(layerGroupRef.current);
    setPendingPhoto(null);
  },[pendingPhoto,photoName,photoNote]);

  const trackObj = () => ({
    id: trackIdRef.current, name:trackName, color:trackColor,
    startTime: new Date(startTimeRef.current).toISOString(),
    points: pointsRef.current, waypoints: waypointsRef.current,
    stats: { distance:stats.distance },
  });

  const safeName = () => trackName.replace(/[^a-z0-9]/gi,"_")||"track";

  const doExport = useCallback(async fmt=>{
    setExporting(fmt);
    try {
      await persist();
      const t = trackObj();
      if (fmt==="gpx")     dl(buildGPX(t),      `${safeName()}.gpx`,     "application/gpx+xml");
      if (fmt==="kml")     dl(buildKML(t),      `${safeName()}.kml`,     "application/vnd.google-earth.kml+xml");
      if (fmt==="kmz")     dl(await buildKMZ(t,photosRef.current), `${safeName()}.kmz`, "application/vnd.google-earth.kmz");
      if (fmt==="geojson") dl(buildGeoJSON(t),  `${safeName()}.geojson`, "application/geo+json");
      if (fmt==="csv")     dl(buildCSV(t),      `${safeName()}.csv`,     "text/csv");
    } finally { setExporting(null); }
  },[trackName,trackColor,stats,persist]);

  useEffect(()=>()=>{
    navigator.geolocation.clearWatch(watchIdRef.current);
    clearInterval(timerRef.current);
  },[]);

  if (!visible) return null;

  const isRecording = status==="recording";
  const isPaused    = status==="paused";
  const isStopped   = status==="stopped";
  const isIdle      = status==="idle";

  const accentColor = isRecording
    ? (autoPaused ? T.amber : T.red)
    : isPaused  ? T.amber
    : isStopped ? T.green
    : T.blue;

  const distVal  = stats.distance >= 1000
    ? (stats.distance/1000).toFixed(2) : `${Math.round(stats.distance)}`;
  const distUnit = stats.distance >= 1000 ? "km" : "m";

  /* ── MINIMISED PILL ─────────────────────────────────────────────────── */
  if (minimised) {
    return (
      <>
        <style>{`@keyframes recpulse{0%,100%{opacity:1}50%{opacity:.15}}`}</style>
        <div onClick={()=>setMinimised(false)} style={{
          position:"fixed", bottom:76, left:"50%",
          transform:"translateX(-50%)",
          zIndex:2200,
          display:"flex", alignItems:"center", gap:10,
          padding:"8px 14px 8px 12px",
          background:"rgba(6,10,22,0.96)",
          backdropFilter:"blur(24px)",
          WebkitBackdropFilter:"blur(24px)",
          border:`1px solid ${isRecording&&!autoPaused?"rgba(230,57,70,0.4)":"rgba(255,255,255,0.09)"}`,
          borderRadius:100,
          boxShadow: isRecording&&!autoPaused
            ?"0 4px 24px rgba(230,57,70,0.25)":"0 4px 20px rgba(0,0,0,0.5)",
          cursor:"pointer", userSelect:"none",
          minWidth:240, justifyContent:"space-between",
          fontFamily: FONT_UI,
        }}>
          <div style={{ display:"flex",alignItems:"center",gap:7 }}>
            <div style={{
              width:7,height:7,borderRadius:"50%",background:accentColor,flexShrink:0,
              animation:isRecording&&!autoPaused?"recpulse 1.2s infinite":"none",
              boxShadow:`0 0 6px ${accentColor}`,
            }}/>
            <span style={{ fontSize:11,fontWeight:600,color:T.text,
              maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
              {isRecording||isPaused ? trackName : "Track Recorder"}
            </span>
            {autoPaused && (
              <span style={{ fontSize:8,color:T.amber,fontWeight:700,
                background:"rgba(244,162,97,0.12)",padding:"1px 5px",borderRadius:4,
                border:"1px solid rgba(244,162,97,0.25)",letterSpacing:".06em" }}>PAUSED</span>
            )}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            {[
              [distVal, distUnit,    T.blue],
              [formatDuration(stats.totalDuration), "", T.cyan],
              [fmtSpeed(stats.speed), "km/h", T.amber],
            ].map(([v,u,c],i)=>(
              <React.Fragment key={i}>
                {i>0 && <div style={{ width:1,height:18,background:T.border }}/>}
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:12,fontWeight:700,color:c,fontFamily:FONT_MONO,lineHeight:1 }}>{v}</div>
                  {u && <div style={{ fontSize:7.5,color:T.textFaint,fontFamily:FONT_MONO }}>{u}</div>}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </>
    );
  }

  /* ── FULL PANEL ─────────────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        @keyframes recpulse{0%,100%{opacity:1}50%{opacity:.15}}
        @keyframes slideup{from{transform:translateY(100%);opacity:.6}to{transform:translateY(0);opacity:1}}
        .ltr-scroll::-webkit-scrollbar{width:2px}
        .ltr-scroll::-webkit-scrollbar-thumb{background:rgba(72,149,239,.25);border-radius:2px}
        .ltr-scroll{scrollbar-width:thin;scrollbar-color:rgba(72,149,239,.2) transparent}
        .action-btn:active{transform:scale(.96);transition:transform .08s}
        .tab-btn{transition:color .15s,border-color .15s}
      `}</style>

      <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
        style={{ display:"none" }} onChange={handlePhotoCapture}/>

      {/* Waypoint modal */}
      {showWptModal && (
        <Modal onClose={()=>setShowWptModal(false)}>
          <div style={{ color:T.text,fontWeight:700,fontSize:14,marginBottom:2,fontFamily:FONT_UI }}>
            📍 Add Waypoint
          </div>
          <div style={{ color:T.textFaint,fontSize:10,marginBottom:14,fontFamily:FONT_MONO }}>
            {lastPtRef.current?.lat.toFixed(6)}, {lastPtRef.current?.lng.toFixed(6)}
          </div>
          <MInput label="Name" autoFocus value={wptName} onChange={setWptName}
            placeholder={`WPT ${waypointsRef.current.length+1}`}/>
          <MInput label="Note / Description" value={wptNote} onChange={setWptNote}
            placeholder="Optional note..." multiline/>
          <MActions onConfirm={confirmWaypoint} onCancel={()=>setShowWptModal(false)}
            confirmLabel="Save Waypoint" confirmColor={T.blue}/>
        </Modal>
      )}

      {/* Photo modal */}
      {pendingPhoto && (
        <Modal onClose={()=>setPendingPhoto(null)}>
          <div style={{ color:T.text,fontWeight:700,fontSize:14,marginBottom:2,fontFamily:FONT_UI }}>
            📷 Photo Waypoint
          </div>
          <div style={{ color:T.textFaint,fontSize:10,marginBottom:10,fontFamily:FONT_MONO }}>
            {pendingPhoto.lat.toFixed(6)}, {pendingPhoto.lng.toFixed(6)}
          </div>
          <img src={pendingPhoto.dataURL} alt="preview" style={{
            width:"100%",height:130,objectFit:"cover",
            borderRadius:10,marginBottom:12,display:"block",
            border:`1px solid ${T.border}`,
          }}/>
          <MInput label="Photo Name" autoFocus value={photoName} onChange={setPhotoName}
            placeholder={`Photo ${Object.keys(photosRef.current).length+1}`}/>
          <MInput label="Note" value={photoNote} onChange={setPhotoNote}
            placeholder="What are you seeing here?" multiline/>
          <MActions onConfirm={confirmPhoto} onCancel={()=>setPendingPhoto(null)}
            confirmLabel="Save Photo" confirmColor={T.amber}/>
        </Modal>
      )}

      {/* Backdrop */}
      <div onClick={()=>setMinimised(true)} style={{
        position:"fixed",inset:0,zIndex:2099,
        background:"rgba(0,0,0,0.3)",backdropFilter:"blur(1px)",
        WebkitBackdropFilter:"blur(1px)",
      }}/>

      {/* ── MAIN PANEL ── */}
      <div style={{
        position:"fixed",bottom:0,left:0,right:0,
        zIndex:2100,
        maxHeight:"58vh",
        background:"rgba(7,11,22,0.98)",
        backdropFilter:"blur(40px) saturate(200%)",
        WebkitBackdropFilter:"blur(40px) saturate(200%)",
        borderTop:`1.5px solid ${accentColor}35`,
        borderRadius:"14px 14px 0 0",
        display:"flex",flexDirection:"column",
        fontFamily: FONT_UI,
        boxShadow:"0 -8px 40px rgba(0,0,0,0.8), 0 -1px 0 rgba(255,255,255,0.04) inset",
        animation:"slideup 0.22s cubic-bezier(.16,1,.3,1)",
        transition:"border-color 0.3s",
      }}>

        {/* Handle */}
        <div style={{ flexShrink:0,paddingTop:8,paddingBottom:0,
          display:"flex",justifyContent:"center" }}>
          <div style={{ width:34,height:3,borderRadius:2,background:"rgba(255,255,255,0.12)" }}/>
        </div>

        {/* ── HEADER ── */}
        <div style={{ flexShrink:0,display:"flex",alignItems:"center",
          padding:"7px 12px 8px",gap:9 }}>

          {/* Status icon */}
          <div style={{
            width:30,height:30,borderRadius:8,flexShrink:0,
            background:`${accentColor}14`,
            border:`1px solid ${accentColor}28`,
            display:"flex",alignItems:"center",justifyContent:"center",position:"relative",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke={accentColor} strokeWidth="2.5" strokeLinecap="round">
              {isRecording&&!autoPaused
                ? <rect x="4" y="4" width="16" height="16" rx="3" fill={T.red} stroke="none"/>
                : isPaused||autoPaused
                  ? <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>
                  : isStopped
                    ? <polyline points="20 6 9 17 4 12" strokeWidth="2.5"/>
                    : <polygon points="5 3 19 12 5 21 5 3" fill={T.blue} stroke="none"/>
              }
            </svg>
            {isRecording&&!autoPaused && (
              <div style={{ position:"absolute",top:3,right:3,width:4,height:4,
                borderRadius:"50%",background:T.red,
                animation:"recpulse 1.2s infinite",boxShadow:`0 0 4px ${T.red}` }}/>
            )}
          </div>

          {/* Name + subtitle */}
          <div style={{ flex:1,minWidth:0 }}>
            {editingName && !isIdle ? (
              <input autoFocus value={trackName}
                onChange={e=>setTrackName(e.target.value)}
                onBlur={()=>setEditingName(false)}
                onKeyDown={e=>e.key==="Enter"&&setEditingName(false)}
                style={{ background:"transparent",border:"none",
                  borderBottom:`1px solid ${T.blue}55`,color:T.text,
                  fontSize:12,fontWeight:600,outline:"none",
                  width:"100%",fontFamily:FONT_UI }}/>
            ) : (
              <div
                onClick={()=>!isIdle&&setEditingName(true)}
                style={{
                  fontSize:12,fontWeight:600,color:T.text,
                  cursor:isIdle?"default":"text",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                  lineHeight:1.3,
                }}
              >
                {isIdle ? "Live Track Recorder" : trackName}
              </div>
            )}
            <div style={{
              fontSize:9,color:T.textDim,marginTop:1.5,
              fontFamily: FONT_MONO, letterSpacing:".03em",
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
            }}>
              {isRecording
                ? autoPaused
                  ? `⏸  Not moving · ${stats.points} pts`
                  : `● REC · ${stats.points} pts · ±${Math.round(lastPtRef.current?.accuracy??0)}m`
                : isPaused  ? `⏸  Paused · ${stats.points} pts`
                : isStopped ? `✓  Saved · ${stats.points} pts`
                : "GPS track recorder · waypoints · export"}
            </div>
          </div>

          {/* Color swatch */}
          {(isIdle||isStopped) && (
            <div style={{ position:"relative",flexShrink:0 }}>
              <button onClick={()=>setShowColors(p=>!p)} style={{
                width:18,height:18,borderRadius:"50%",background:trackColor,
                border:"2px solid rgba(255,255,255,0.25)",cursor:"pointer",padding:0,
                boxShadow:`0 0 6px ${trackColor}50`,
              }} title="Track color"/>
              {showColors && (
                <div style={{
                  position:"absolute",bottom:26,right:0,
                  background:"#0a1222",border:`1px solid ${T.border}`,
                  borderRadius:9,padding:8,display:"flex",gap:5,
                  boxShadow:"0 8px 24px rgba(0,0,0,0.7)",zIndex:10,
                }}>
                  {TRACK_COLORS.map(c=>(
                    <button key={c.hex} onClick={()=>{setTrackColor(c.hex);setShowColors(false);}} style={{
                      width:18,height:18,borderRadius:"50%",background:c.hex,
                      border:"none",cursor:"pointer",padding:0,
                      outline:trackColor===c.hex?"2px solid #fff":"2px solid transparent",
                      outlineOffset:2,
                    }} title={c.name}/>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Controls */}
          <div style={{ display:"flex",gap:4,flexShrink:0 }}>
            {(isRecording||isPaused) && (
              <button onClick={()=>setMinimised(true)} style={{
                width:26,height:26,borderRadius:7,cursor:"pointer",
                background:T.surface,border:`1px solid ${T.border}`,
                color:T.textFaint,display:"flex",
                alignItems:"center",justifyContent:"center",padding:0,
              }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            )}
            <button onClick={onClose} style={{
              width:26,height:26,borderRadius:7,cursor:"pointer",
              background:T.surface,border:`1px solid ${T.border}`,
              color:T.textFaint,display:"flex",
              alignItems:"center",justifyContent:"center",padding:0,
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <Divider/>

        {/* ── IDLE STATE ── */}
        {isIdle && (
          <div style={{ padding:"16px 14px 20px",textAlign:"center",flexShrink:0 }}>
            <div style={{ color:T.textFaint,fontSize:10,marginBottom:14,lineHeight:1.7,
              letterSpacing:".01em" }}>
              📍 GPS path recording &nbsp;·&nbsp; 📷 Photo waypoints<br/>
              ↑ Elevation tracking &nbsp;·&nbsp; 💾 GPX · KML · GeoJSON export
            </div>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"center",
              gap:5,marginBottom:14 }}>
              <span style={{ color:T.textFaint,fontSize:10 }}>Color:</span>
              <div style={{ width:11,height:11,borderRadius:"50%",background:trackColor,
                border:"1.5px solid rgba(255,255,255,0.2)" }}/>
              <span style={{ color:trackColor,fontSize:10,fontWeight:600 }}>
                {TRACK_COLORS.find(c=>c.hex===trackColor)?.name}
              </span>
            </div>
            <button onClick={startRecording} style={{
              display:"inline-flex",alignItems:"center",justifyContent:"center",gap:7,
              padding:"12px 32px",borderRadius:12,border:"none",
              background:`linear-gradient(135deg,#c1121f,${T.red})`,
              color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",
              letterSpacing:".04em",boxShadow:"0 6px 20px rgba(230,57,70,0.38)",
              fontFamily: FONT_UI,
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="8"/>
              </svg>
              START RECORDING
            </button>
          </div>
        )}

        {/* ── ACTIVE STATE (recording / paused / stopped) ── */}
        {!isIdle && (
          <>
            {/* Tabs */}
            <div style={{ flexShrink:0,display:"flex",
              borderBottom:`1px solid ${T.border}` }}>
              {[
                ["stats",     "Stats"],
                ["waypoints", `Waypoints (${waypoints.filter(w=>!w.photo).length})`],
                ["photos",    `Photos (${waypoints.filter(w=>w.photo).length})`],
              ].map(([id,label])=>(
                <button key={id} className="tab-btn" onClick={()=>setTab(id)} style={{
                  flex:1,padding:"7px 4px 6px",background:"transparent",border:"none",
                  borderBottom:`2px solid ${tab===id?accentColor:"transparent"}`,
                  color:tab===id?T.text:T.textFaint,
                  fontWeight:tab===id?600:400,fontSize:9.5,cursor:"pointer",
                  fontFamily: FONT_UI, letterSpacing:".02em",
                }}>{label}</button>
              ))}
            </div>

            {/* Scrollable content */}
            <div className="ltr-scroll" style={{ flex:1,overflowY:"auto",
              overflowX:"hidden",padding:"8px 12px 10px" }}>

              {/* ── STATS TAB ── */}
              {tab==="stats" && (
                <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                  {autoPaused && (
                    <div style={{ padding:"5px 10px",borderRadius:7,
                      background:"rgba(244,162,97,0.06)",
                      border:"1px solid rgba(244,162,97,0.18)",
                      color:"#f4a261",fontSize:9,textAlign:"center",fontWeight:600,
                      letterSpacing:".05em" }}>
                      ⏸ AUTO-PAUSED — NOT MOVING
                    </div>
                  )}
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4 }}>
                    <StatCell label="Distance"  value={distVal}                unit={distUnit}  color={T.blue}/>
                    <StatCell label="Total Time" value={formatDuration(stats.totalDuration)}   color={T.cyan}/>
                    <StatCell label="Speed"     value={fmtSpeed(stats.speed)}  unit="km/h"      color={T.amber}/>
                    <StatCell label="Moving"    value={formatDuration(stats.movingDuration)}   color={T.green}/>
                    <StatCell label="Stopped"   value={formatDuration(stats.stoppedDuration)}  color={T.red}/>
                    <StatCell label="Points"    value={stats.points}                           color={T.textDim}/>
                    <StatCell label="Ascent"    value={`+${Math.round(stats.ascent)}`} unit="m" color={T.green}/>
                    <StatCell label="Descent"   value={`-${Math.round(stats.descent)}`} unit="m" color={T.red}/>
                    <StatCell label="Max Speed" value={fmtSpeed(stats.maxSpeed)} unit="km/h"   color={T.violet}/>
                    <StatCell label="Avg Speed" value={fmtSpeed(stats.avgSpeed)} unit="km/h"   color={T.teal}/>
                    <StatCell label="Pace"      value={fmtPace(stats.avgSpeed)}  unit="/km"     color={T.pink}/>
                    <StatCell label="Battery"
                      value={stats.battery!=null?`${stats.battery}%`:"--"}
                      color={stats.battery!=null&&stats.battery<20?"#f87171":"#86efac"}/>
                  </div>
                  {lastPtRef.current && (
                    <div style={{ display:"flex",alignItems:"center",gap:5,
                      padding:"4px 8px",borderRadius:6,
                      background:"rgba(76,201,240,0.04)",
                      border:"1px solid rgba(76,201,240,0.09)" }}>
                      <div style={{ width:4,height:4,borderRadius:"50%",background:T.cyan,flexShrink:0 }}/>
                      <span style={{ color:T.textFaint,fontSize:9,fontFamily:FONT_MONO }}>
                        GPS ±{Math.round(lastPtRef.current.accuracy??0)}m accuracy
                        &nbsp;·&nbsp;
                        {lastPtRef.current.lat.toFixed(5)}, {lastPtRef.current.lng.toFixed(5)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ── WAYPOINTS TAB ── */}
              {tab==="waypoints" && (
                <div>
                  {waypoints.filter(w=>!w.photo).length===0 ? (
                    <div style={{ textAlign:"center",color:T.textFaint,
                      fontSize:11,padding:"18px 0" }}>
                      <div style={{ fontSize:22,marginBottom:6,opacity:.5 }}>📍</div>
                      No waypoints yet
                    </div>
                  ) : waypoints.filter(w=>!w.photo).map(w=>(
                    <div key={w.id} style={{ padding:"8px 10px",borderRadius:8,marginBottom:4,
                      background:"rgba(72,149,239,0.05)",
                      border:"1px solid rgba(72,149,239,0.1)" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                        <span style={{ fontSize:11 }}>📍</span>
                        <span style={{ color:T.text,fontWeight:600,fontSize:11,flex:1 }}>{w.name}</span>
                        <span style={{ color:T.textFaint,fontSize:8.5,fontFamily:FONT_MONO }}>
                          {new Date(w.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                        </span>
                      </div>
                      {w.note && (
                        <div style={{ color:T.textFaint,fontSize:10,
                          marginLeft:18,fontStyle:"italic",marginTop:2 }}>{w.note}</div>
                      )}
                      <div style={{ color:T.textFaint,fontSize:8.5,marginLeft:18,
                        fontFamily:FONT_MONO,marginTop:2,opacity:.7 }}>
                        {w.lat.toFixed(5)}, {w.lng.toFixed(5)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── PHOTOS TAB ── */}
              {tab==="photos" && (
                <div>
                  {waypoints.filter(w=>w.photo).length===0 ? (
                    <div style={{ textAlign:"center",color:T.textFaint,
                      fontSize:11,padding:"18px 0" }}>
                      <div style={{ fontSize:22,marginBottom:6,opacity:.5 }}>📷</div>
                      No photos yet
                    </div>
                  ) : (
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6 }}>
                      {waypoints.filter(w=>w.photo).map(w=>(
                        <div key={w.id} style={{ borderRadius:9,overflow:"hidden",
                          border:"1px solid rgba(244,162,97,0.15)",
                          background:"rgba(244,162,97,0.04)" }}>
                          {photosRef.current[w.photoId] && (
                            <img src={photosRef.current[w.photoId]} alt={w.name}
                              style={{ width:"100%",height:80,objectFit:"cover",display:"block" }}/>
                          )}
                          <div style={{ padding:"5px 7px" }}>
                            <div style={{ color:T.text,fontSize:10,fontWeight:600 }}>{w.name}</div>
                            {w.note && (
                              <div style={{ color:T.textFaint,fontSize:9,
                                fontStyle:"italic",marginTop:1 }}>{w.note}</div>
                            )}
                            <div style={{ color:T.textFaint,fontSize:8.5,marginTop:1,fontFamily:FONT_MONO }}>
                              {new Date(w.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── EXPORT PANEL ── */}
              {isStopped && showExport && (
                <div style={{ marginTop:6 }}>
                  <div style={{ padding:"8px 10px",borderRadius:8,marginBottom:8,
                    background:"rgba(45,198,83,0.05)",border:"1px solid rgba(45,198,83,0.12)" }}>
                    <div style={{ color:T.textFaint,fontSize:9,textAlign:"center",
                      marginBottom:6,letterSpacing:".05em" }}>TRACK SAVED ✓</div>
                    <div style={{ display:"flex",justifyContent:"space-around" }}>
                      {[
                        [formatDist(stats.distance),"Distance"],
                        [formatDuration(stats.totalDuration),"Total"],
                        [formatDuration(stats.movingDuration),"Moving"],
                        [`${stats.points}`,"Points"],
                      ].map(([v,l])=>(
                        <div key={l} style={{ textAlign:"center" }}>
                          <div style={{ color:T.text,fontWeight:700,fontSize:11,
                            fontFamily:FONT_MONO }}>{v}</div>
                          <div style={{ color:T.textFaint,fontSize:8 }}>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:5 }}>
                    {[
                      ["gpx","GPX","#4895ef"],
                      ["kml","KML","#2dc653"],
                      ["kmz","KMZ","#06d6a0"],
                      ["geojson","JSON","#4cc9f0"],
                      ["csv","CSV","#f4a261"],
                    ].map(([k,lb,c])=>(
                      <button key={k} onClick={()=>doExport(k)} disabled={!!exporting} style={{
                        padding:"9px 4px",borderRadius:8,border:"none",cursor:"pointer",
                        background:`${c}18`,
                        border:`1px solid ${c}30`,
                        color:c,fontWeight:700,fontSize:10,fontFamily: FONT_UI,
                        opacity:exporting&&exporting!==k?0.35:1,
                        display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                        transition:"opacity .15s",
                      }}>
                        <span style={{ fontSize:13 }}>↓</span>
                        <span style={{ letterSpacing:".05em" }}>{exporting===k?"···":lb}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={discardTrack} style={{
                    width:"100%",padding:"8px 0",borderRadius:8,
                    border:`1px solid ${T.border}`,background:"transparent",
                    color:T.textFaint,fontSize:10,cursor:"pointer",fontFamily: FONT_UI,
                    letterSpacing:".02em",
                  }}>+ New Track</button>
                </div>
              )}
            </div>

            {/* ── ACTION BUTTONS ── */}
            {!isStopped && (
              <>
                <Divider/>
                <div style={{ flexShrink:0,display:"flex",gap:5,
                  padding:"7px 10px 10px" }}>
                  {[
                    {
                      label:"Waypoint", icon:"📍",
                      color:T.blue, bg:"rgba(72,149,239,0.1)", border:"rgba(72,149,239,0.22)",
                      onClick: addWaypoint,
                      disabled: !isRecording&&!isPaused,
                    },
                    {
                      label:"Photo", icon:"📷",
                      color:T.amber, bg:"rgba(244,162,97,0.1)", border:"rgba(244,162,97,0.22)",
                      onClick: addPhoto,
                      disabled: !isRecording&&!isPaused,
                    },
                    isRecording ? {
                      label:"Pause", icon:"⏸",
                      color:T.amber, bg:"rgba(244,162,97,0.1)", border:"rgba(244,162,97,0.22)",
                      onClick: pauseRecording, disabled:false,
                    } : {
                      label:"Resume", icon:"▶",
                      color:T.green, bg:"rgba(45,198,83,0.1)", border:"rgba(45,198,83,0.22)",
                      onClick: resumeRecording, disabled:false,
                    },
                    {
                      label: confirmStop ? "Confirm?" : "Stop",
                      icon: confirmStop ? "!" : "■",
                      color: T.red,
                      bg: confirmStop ? "rgba(230,57,70,0.22)" : "rgba(230,57,70,0.1)",
                      border: "rgba(230,57,70,0.35)",
                      onClick: ()=>{
                        if (!confirmStop) { setConfirmStop(true); return; }
                        setConfirmStop(false); stopRecording(); setTab("stats");
                      },
                      disabled:false,
                    },
                  ].map(({ label,icon,color,bg,border,onClick,disabled })=>(
                    <button key={label} className="action-btn" onClick={onClick}
                      disabled={disabled} style={{
                      flex:1,padding:"7px 0 8px",borderRadius:9,cursor:"pointer",
                      background: bg,
                      border:`1px solid ${border}`,
                      color,fontWeight:600,fontSize:9.5,
                      fontFamily: FONT_UI, letterSpacing:".03em",
                      opacity:disabled?0.35:1,
                      display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                      transition:"opacity .15s",
                    }}>
                      <span style={{ fontSize:15,lineHeight:1 }}>{icon}</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}