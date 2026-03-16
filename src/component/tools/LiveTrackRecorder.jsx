/**
 * LiveTrackRecorder.jsx -- SurveyMap Pro v5.0 (Merged)
 * -----------------------------------------------------------------------------
 * Best of v1 + v2:
 *  ✅ AlpineQuest minimised pill (map stays visible)
 *  ✅ Camera access -- photo waypoints with preview + name + note modal
 *  ✅ Waypoints: name + description/note (2 fields)
 *  ✅ Track color picker (6 colors)
 *  ✅ GPX / KML / KMZ / GeoJSON / CSV export
 *  ✅ Battery level per GPS point
 *  ✅ Auto-pause detection (stopped moving)
 *  ✅ Moving time vs total time vs stopped time
 *  ✅ Max speed, avg speed, pace
 *  ✅ Start/End flags on map
 *  ✅ IndexedDB persistence every 10 points
 *  ✅ Fully self-contained (no useTrackRecorder hook needed)
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import L from "leaflet";

/* --- Constants ------------------------------------------------------------ */
const MIN_DISTANCE_M   = 3;
const AUTO_PAUSE_SPEED = 0.3;   // m/s (~1 km/h)
const AUTO_PAUSE_SECS  = 8;
const DB_NAME          = "SurveyMapPro";
const DB_VERSION       = 2;
const STORE_TRACKS     = "tracks";
const STORE_PHOTOS     = "photos";

const TRACK_COLORS = [
  { name:"Red",    hex:"#ef4444" },
  { name:"Blue",   hex:"#3b82f6" },
  { name:"Green",  hex:"#22c55e" },
  { name:"Orange", hex:"#f97316" },
  { name:"Purple", hex:"#a855f7" },
  { name:"Cyan",   hex:"#06b6d4" },
];

/* --- Theme ---------------------------------------------------------------- */
const TH = {
  bg:     "rgba(3,7,18,0.98)",
  card:   "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.08)",
  text:   "#e2eeff",
  sub:    "rgba(160,195,240,0.35)",
  green:  "#22c55e",
  red:    "#ef4444",
  amber:  "#f59e0b",
  blue:   "#3b82f6",
  purple: "#8b5cf6",
  cyan:   "#06b6d4",
  teal:   "#14b8a6",
};

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

function fmtSpeed(ms) { return `${((ms||0)*3.6).toFixed(1)} km/h`; }

function fmtPace(ms) {
  if (!ms || ms < 0.1) return "--";
  const spm = 1000/ms, mm = Math.floor(spm/60), ss = Math.round(spm%60);
  return `${mm}:${String(ss).padStart(2,"0")} /km`;
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

/* --- XML escape ----------------------------------------------------------- */
function esc(s) {
  return String(s||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* --- GPX ------------------------------------------------------------------ */
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
<gpx version="1.1" creator="SurveyMap Pro"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(track.name)}</name><time>${track.startTime}</time></metadata>
${wpts}
  <trk><name>${esc(track.name)}</name>
    <extensions><color>${track.color||"#ef4444"}</color></extensions>
    <trkseg>${tpts}</trkseg>
  </trk>
</gpx>`;
}

/* --- KML ------------------------------------------------------------------ */
function buildKML(track) {
  const hex = (track.color||"#ef4444").replace("#","");
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

/* --- GeoJSON --------------------------------------------------------------- */
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

/* --- CSV ------------------------------------------------------------------- */
function buildCSV(track) {
  const rows = ["lat,lng,alt,time,speed,accuracy,battery"];
  (track.points||[]).forEach(p => {
    rows.push(`${p.lat},${p.lng},${p.alt??0},${p.time},${p.speed??0},${p.accuracy??0},${p.battery??""}`);
  });
  return rows.join("\n");
}

/* --- KMZ ------------------------------------------------------------------- */
async function buildKMZ(track, photoMap) {
  const hex = (track.color||"#ef4444").replace("#","");
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

/* --- ZIP builder ----------------------------------------------------------- */
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

/* --- Download ------------------------------------------------------------- */
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
        <div style="width:3px;height:32px;background:${color};border-radius:2px;"></div>
        <div style="background:${color};color:#fff;font-size:9px;font-weight:800;
          padding:3px 6px;border-radius:0 4px 4px 0;letter-spacing:.04em;
          font-family:'DM Sans',sans-serif;white-space:nowrap;">${label}</div>
      </div></div>`,
    iconSize:[60,32],iconAnchor:[3,32],popupAnchor:[30,-34],
  });
}

const WPT_ICON = L.divIcon({
  className:"",
  html:`<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
    <div style="width:30px;height:30px;border-radius:50%;background:#3b82f6;border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;font-size:14px;">[Pin]</div>
    <div style="width:3px;height:10px;background:#3b82f6;margin-top:-1px;border-radius:0 0 2px 2px;"></div>
  </div>`,
  iconSize:[30,42],iconAnchor:[15,42],popupAnchor:[0,-44],
});

const PHOTO_ICON = L.divIcon({
  className:"",
  html:`<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
    <div style="width:30px;height:30px;border-radius:50%;background:#f97316;border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;font-size:14px;">[Cam]</div>
    <div style="width:3px;height:10px;background:#f97316;margin-top:-1px;border-radius:0 0 2px 2px;"></div>
  </div>`,
  iconSize:[30,42],iconAnchor:[15,42],popupAnchor:[0,-44],
});

const POS_ICON = L.divIcon({
  className:"",
  html:`<div style="width:18px;height:18px;border-radius:50%;background:#06b6d4;
    border:3px solid #fff;box-shadow:0 0 12px rgba(6,182,212,0.9);"></div>`,
  iconSize:[18,18],iconAnchor:[9,9],
});

/* --- Stat cell ------------------------------------------------------------ */
function Cell({ label, value, unit, color=TH.text }) {
  return (
    <div style={{ background:TH.card, border:`1px solid ${TH.border}`, borderRadius:10,
      padding:"7px 9px", display:"flex", flexDirection:"column", gap:2 }}>
      <div style={{ fontSize:7.5, fontWeight:700, letterSpacing:"0.09em",
        color:"rgba(255,255,255,0.18)", textTransform:"uppercase",
        fontFamily:"DM Mono,monospace" }}>{label}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
        <span style={{ fontSize:15, fontWeight:800, color,
          fontFamily:"DM Mono,monospace", lineHeight:1 }}>{value??"--"}</span>
        {value!=null&&unit&&<span style={{ fontSize:8.5, color:"rgba(255,255,255,0.22)" }}>{unit}</span>}
      </div>
    </div>
  );
}

/* --- Modal ---------------------------------------------------------------- */
function Modal({ children, onClose }) {
  return (
    <div style={{
      position:"fixed",inset:0,zIndex:9999,
      background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px",
    }} onClick={e=>e.target===e.currentTarget&&onClose?.()}>
      <div style={{
        background:"rgba(8,14,28,0.99)",borderRadius:16,
        border:"1px solid rgba(255,255,255,0.1)",
        padding:22,width:"100%",maxWidth:340,
        boxShadow:"0 24px 80px rgba(0,0,0,0.85)",
        fontFamily:"DM Sans,system-ui,sans-serif",
      }}>{children}</div>
    </div>
  );
}

function MInput({ label, value, onChange, placeholder, multiline, autoFocus }) {
  const s = {
    width:"100%",padding:"9px 12px",borderRadius:9,
    border:"1px solid rgba(255,255,255,0.12)",
    background:"rgba(255,255,255,0.06)",color:"#f1f5f9",
    fontSize:13,outline:"none",fontFamily:"inherit",
    marginBottom:10,boxSizing:"border-box",resize:"vertical",
  };
  return (
    <div>
      {label&&<div style={{ color:"rgba(255,255,255,0.25)",fontSize:9.5,fontWeight:700,
        letterSpacing:".08em",marginBottom:4 }}>{label}</div>}
      {multiline
        ? <textarea autoFocus={autoFocus} rows={3} value={value}
            onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={s}/>
        : <input autoFocus={autoFocus} value={value}
            onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={s}/>
      }
    </div>
  );
}

function MActions({ onConfirm, onCancel, confirmLabel="Save" }) {
  return (
    <div style={{ display:"flex",gap:8,marginTop:4 }}>
      <button onClick={onConfirm} style={{
        flex:1,padding:10,borderRadius:8,border:"none",
        background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",
        color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",
      }}>{confirmLabel}</button>
      <button onClick={onCancel} style={{
        flex:1,padding:10,borderRadius:8,
        border:"1px solid rgba(255,255,255,0.1)",
        background:"transparent",color:"rgba(255,255,255,0.38)",
        fontSize:13,cursor:"pointer",fontFamily:"inherit",
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
  /* -- Map ref ----------------------------------------------------------- */
  const internalRef = useRef(null);
  useEffect(()=>{ internalRef.current = mapProp??null; },[mapProp]);
  const mapRef = leafletMapRef ?? internalRef;
  const getMap = () => mapRef.current;

  /* -- Recording state --------------------------------------------------- */
  const [status,       setStatus]       = useState("idle");   // idle|recording|paused|stopped
  const [trackName,    setTrackName]    = useState("");
  const [trackColor,   setTrackColor]   = useState(TRACK_COLORS[0].hex);
  const [editingName,  setEditingName]  = useState(false);
  const [showColors,   setShowColors]   = useState(false);
  const [autoPaused,   setAutoPaused]   = useState(false);
  const [minimised,    setMinimised]    = useState(false);
  const [confirmStop,  setConfirmStop]  = useState(false);
  const [tab,          setTab]          = useState("stats");  // stats|waypoints|photos
  const [showExport,   setShowExport]   = useState(false);
  const [exporting,    setExporting]    = useState(null);

  /* -- Stats ------------------------------------------------------------- */
  const [stats, setStats] = useState({
    distance:0, totalDuration:0, movingDuration:0, stoppedDuration:0,
    speed:0, maxSpeed:0, avgSpeed:0, ascent:0, descent:0, points:0, battery:null,
  });

  /* -- Waypoints (UI state) ----------------------------------------------- */
  const [waypoints, setWaypoints]       = useState([]);
  const [showWptModal,  setShowWptModal]  = useState(false);
  const [wptName, setWptName]           = useState("");
  const [wptNote, setWptNote]           = useState("");

  /* -- Photo modal ------------------------------------------------------- */
  const [pendingPhoto,  setPendingPhoto]  = useState(null); // {dataURL,lat,lng,alt}
  const [photoName,     setPhotoName]     = useState("");
  const [photoNote,     setPhotoNote]     = useState("");
  const photoInputRef = useRef(null);

  /* -- Mutable refs ------------------------------------------------------ */
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

  /* -- Leaflet layer refs ------------------------------------------------ */
  const layerGroupRef = useRef(null);
  const polylineRef   = useRef(null);
  const posMarkerRef  = useRef(null);

  /* -- Sync refs --------------------------------------------------------- */
  useEffect(()=>{ statusRef.current    = status;     },[status]);
  useEffect(()=>{ trackNameRef.current = trackName;  },[trackName]);
  useEffect(()=>{ trackColorRef.current= trackColor; },[trackColor]);

  /* -- Init layer group -------------------------------------------------- */
  useEffect(()=>{
    const map = getMap();
    if (!map) return;
    layerGroupRef.current = L.layerGroup().addTo(map);
    return ()=>{ layerGroupRef.current?.remove(); };
  // eslint-disable-next-line
  },[mapProp]);

  /* -- Persist helper ---------------------------------------------------- */
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
        stats: {
          distance: pointsRef.current.reduce((s,_,i,a)=>i===0?0:s+haversine(a[i-1],a[i]),0),
        },
        savedAt: nowISO(),
      });
      for (const [id, data] of Object.entries(photosRef.current)) {
        await dbPut(STORE_PHOTOS, { id, data });
      }
    } catch (e) { console.warn("persist:", e); }
  },[]);

  /* -- Timer ------------------------------------------------------------- */
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

        // Auto-pause logic
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

  /* -- GPS point handler ------------------------------------------------- */
  const handleGPSPoint = useCallback(async pos => {
    if (statusRef.current === "paused") return;
    const { latitude:lat, longitude:lng, altitude:alt, speed, accuracy } = pos.coords;
    if (!isFinite(lat)||!isFinite(lng)) return;

    const battery = await getBattery();
    const pt = { lat, lng, alt:alt??0, speed:speed??0, accuracy:accuracy??0,
                 time:nowISO(), battery };

    if (lastPtRef.current && haversine(lastPtRef.current, pt) < MIN_DISTANCE_M) return;

    pointsRef.current.push(pt);
    lastPtRef.current = pt;

    // Update polyline
    polylineRef.current?.addLatLng([lat,lng]);

    // First point -- START flag + fly
    if (pointsRef.current.length === 1) {
      const map = getMap();
      map?.flyTo([lat,lng],16,{animate:true,duration:1.2});
      L.marker([lat,lng],{ icon:flagIcon("#22c55e","START"), zIndexOffset:900 })
        .bindTooltip("Start",{permanent:false,direction:"top"})
        .addTo(layerGroupRef.current);
    }

    // Position dot
    if (posMarkerRef.current) {
      posMarkerRef.current.setLatLng([lat,lng]);
    } else {
      posMarkerRef.current = L.marker([lat,lng],{ icon:POS_ICON, zIndexOffset:1000 })
        .addTo(layerGroupRef.current);
    }

    // Auto-pan
    const map = getMap();
    if (map && !map.getBounds().contains([lat,lng])) {
      map.panTo([lat,lng],{animate:true,duration:0.8});
    }

    // Recalculate distance + elevation
    const pts = pointsRef.current;
    let dist=0, asc=0, desc=0;
    for (let i=1;i<pts.length;i++){
      dist += haversine(pts[i-1],pts[i]);
      const dh = (pts[i].alt??0)-(pts[i-1].alt??0);
      if (dh>0) asc+=dh; else desc+=Math.abs(dh);
    }
    setStats(s=>({...s, distance:dist, ascent:asc, descent:desc,
                        points:pts.length, battery }));

    if (pts.length%10===0) persist();
  // eslint-disable-next-line
  },[]);

  /* -- Start ------------------------------------------------------------- */
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
    setMinimised(true);   // auto-minimise so map is visible
    onRecordingChange?.(true);

    // Create polyline with chosen color
    polylineRef.current = L.polyline([],{
      color: trackColorRef.current, weight:4, opacity:0.9,
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
  // eslint-disable-next-line
  },[handleGPSPoint]);

  /* -- Pause / Resume ---------------------------------------------------- */
  const pauseRecording  = useCallback(()=>{
    pauseStartRef.current = Date.now();
    lastMoveRef.current   = null;
    setStatus("paused");
  },[]);

  const resumeRecording = useCallback(()=>{
    if (pauseStartRef.current) pausedMsRef.current += Date.now()-pauseStartRef.current;
    setStatus("recording");
  },[]);

  /* -- Stop -------------------------------------------------------------- */
  const stopRecording = useCallback(async ()=>{
    navigator.geolocation.clearWatch(watchIdRef.current);
    // Place END flag
    if (lastPtRef.current) {
      const {lat,lng} = lastPtRef.current;
      L.marker([lat,lng],{ icon:flagIcon("#ef4444","END"), zIndexOffset:900 })
        .bindTooltip("End",{permanent:false,direction:"top"})
        .addTo(layerGroupRef.current);
    }
    // Remove position dot
    posMarkerRef.current?.remove();
    posMarkerRef.current = null;

    await persist();
    setStatus("stopped");
    setMinimised(false);
    setShowExport(true);
    onRecordingChange?.(false);
  },[persist]);

  /* -- Discard ----------------------------------------------------------- */
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

  /* -- Waypoint ----------------------------------------------------------- */
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

  /* -- Photo capture ------------------------------------------------------ */
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

    const thumb = `<img src="${dataURL}" style="width:200px;height:140px;object-fit:cover;border-radius:6px;display:block;"/>`;
    L.marker([lat,lng],{icon:PHOTO_ICON})
      .bindPopup(`<div style="padding:4px"><b>${wpt.name}</b><br/>${thumb}${wpt.note?`<div style="font-size:11px;margin-top:4px">${wpt.note}</div>`:""}</div>`,{maxWidth:240})
      .addTo(layerGroupRef.current);
    setPendingPhoto(null);
  },[pendingPhoto,photoName,photoNote]);

  /* -- Export helpers ----------------------------------------------------- */
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
  // eslint-disable-next-line
  },[trackName,trackColor,stats,persist]);

  /* -- Cleanup ------------------------------------------------------------ */
  useEffect(()=>()=>{
    navigator.geolocation.clearWatch(watchIdRef.current);
    clearInterval(timerRef.current);
  },[]);

  /* ---------------------------------------------------------------------
     RENDER GUARDS
  --------------------------------------------------------------------- */
  if (!visible) return null;

  const isRecording = status==="recording";
  const isPaused    = status==="paused";
  const isStopped   = status==="stopped";
  const isIdle      = status==="idle";
  const accentColor = isRecording
    ? (autoPaused ? TH.amber : TH.red)
    : isPaused  ? TH.amber
    : isStopped ? TH.green
    : TH.blue;

  const distStr = stats.distance>=1000
    ? `${(stats.distance/1000).toFixed(2)}` : `${Math.round(stats.distance)}`;
  const distUnit = stats.distance>=1000 ? "km" : "m";
  const durStr  = formatDuration(stats.totalDuration);
  const spdStr  = ((stats.speed||0)*3.6).toFixed(1);

  /* --- MINIMISED PILL ------------------------------------------------ */
  if (minimised) {
    return (
      <>
        <style>{`@keyframes recpulse{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
        <div onClick={()=>setMinimised(false)} style={{
          position:"fixed", bottom:82, left:"50%",
          transform:"translateX(-50%)",
          zIndex:2200,
          display:"flex", alignItems:"center", gap:10,
          padding:"10px 20px",
          background:TH.bg,
          backdropFilter:"blur(30px)",
          WebkitBackdropFilter:"blur(30px)",
          border:`1.5px solid ${isRecording&&!autoPaused?"rgba(239,68,68,0.5)":"rgba(255,255,255,0.1)"}`,
          borderRadius:40,
          boxShadow: isRecording&&!autoPaused
            ?"0 4px 30px rgba(239,68,68,0.3)":"0 4px 20px rgba(0,0,0,0.5)",
          cursor:"pointer", userSelect:"none",
          minWidth:260, justifyContent:"space-between",
        }}>
          {/* Status dot + name */}
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <div style={{
              width:9,height:9,borderRadius:"50%",background:accentColor,flexShrink:0,
              animation:isRecording&&!autoPaused?"recpulse 1s infinite":"none",
              boxShadow:`0 0 8px ${accentColor}`,
            }}/>
            <span style={{ fontSize:12,fontWeight:700,color:TH.text,
              maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
              {isRecording||isPaused ? trackName : "Track Recorder"}
            </span>
            {autoPaused&&<span style={{ fontSize:9,color:TH.amber,fontWeight:700,
              background:"rgba(245,158,11,0.15)",padding:"2px 6px",borderRadius:6,
              border:"1px solid rgba(245,158,11,0.3)" }}>PAUSED</span>}
          </div>
          {/* Stats */}
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            {[
              [distStr,distUnit,TH.blue],
              [durStr,"time",TH.cyan],
              [spdStr,"km/h",TH.amber],
            ].map(([v,u,c],i)=>(
              <React.Fragment key={i}>
                {i>0&&<div style={{ width:1,height:22,background:TH.border }}/>}
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:14,fontWeight:800,color:c,
                    fontFamily:"DM Mono,monospace",lineHeight:1 }}>{v}</div>
                  <div style={{ fontSize:8,color:TH.sub }}>{u}</div>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </>
    );
  }

  /* --- FULL PANEL --------------------------------------------------- */
  return (
    <>
      <style>{`
        @keyframes recpulse{0%,100%{opacity:1}50%{opacity:.25}}
        @keyframes slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}
        .ltr-s::-webkit-scrollbar{width:2px}
        .ltr-s::-webkit-scrollbar-thumb{background:rgba(139,92,246,.3);border-radius:2px}
      `}</style>

      {/* -- Camera input (hidden) -- */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
        style={{ display:"none" }} onChange={handlePhotoCapture}/>

      {/* -- Waypoint modal -- */}
      {showWptModal && (
        <Modal onClose={()=>setShowWptModal(false)}>
          <div style={{ color:TH.text,fontWeight:700,fontSize:15,marginBottom:3 }}>[Pin] Add Waypoint</div>
          <div style={{ color:"rgba(255,255,255,0.28)",fontSize:11,marginBottom:14 }}>
            GPS: {lastPtRef.current?.lat.toFixed(5)}, {lastPtRef.current?.lng.toFixed(5)}
          </div>
          <MInput label="NAME" autoFocus value={wptName} onChange={setWptName}
            placeholder={"WPT " + (waypointsRef.current.length+1)}/>
          <MInput label="NOTE / DESCRIPTION" value={wptNote} onChange={setWptNote}
            placeholder="Optional description..." multiline/>
          <MActions onConfirm={confirmWaypoint} onCancel={()=>setShowWptModal(false)}/>
        </Modal>
      )}

      {/* -- Photo annotation modal -- */}
      {pendingPhoto && (
        <Modal onClose={()=>setPendingPhoto(null)}>
          <div style={{ color:TH.text,fontWeight:700,fontSize:15,marginBottom:3 }}>[Cam] Add Photo Waypoint</div>
          <div style={{ color:"rgba(255,255,255,0.28)",fontSize:11,marginBottom:10 }}>
            GPS: {pendingPhoto.lat.toFixed(5)}, {pendingPhoto.lng.toFixed(5)}
          </div>
          <img src={pendingPhoto.dataURL} alt="preview" style={{
            width:"100%",height:150,objectFit:"cover",
            borderRadius:10,marginBottom:12,display:"block",
            border:"1px solid rgba(255,255,255,0.08)",
          }}/>
          <MInput label="PHOTO NAME" autoFocus value={photoName} onChange={setPhotoName}
            placeholder={"Photo " + (Object.keys(photosRef.current).length+1)}/>
          <MInput label="NOTE" value={photoNote} onChange={setPhotoNote}
            placeholder="What are you seeing here?" multiline/>
          <MActions onConfirm={confirmPhoto} onCancel={()=>setPendingPhoto(null)} confirmLabel="Save Photo"/>
        </Modal>
      )}

      {/* -- Backdrop -- */}
      <div onClick={()=>setMinimised(true)} style={{
        position:"fixed",inset:0,zIndex:2099,
        background:"rgba(0,0,0,0.35)",backdropFilter:"blur(2px)",
        WebkitBackdropFilter:"blur(2px)",
      }}/>

      {/* -- Main panel -- */}
      <div style={{
        position:"fixed",bottom:0,left:0,right:0,
        zIndex:2100,
        maxHeight:"55vh",
        background:TH.bg,
        backdropFilter:"blur(40px) saturate(180%)",
        WebkitBackdropFilter:"blur(40px) saturate(180%)",
        borderTop:`1.5px solid ${accentColor}40`,
        borderRadius:"18px 18px 0 0",
        display:"flex",flexDirection:"column",
        fontFamily:"DM Sans,sans-serif",
        boxShadow:"0 -8px 50px rgba(0,0,0,0.8)",
        animation:"slideup 0.25s cubic-bezier(.16,1,.3,1)",
        transition:"border-color 0.3s",
      }}>

        {/* Drag handle */}
        <div style={{ flexShrink:0,paddingTop:10,paddingBottom:2,
          display:"flex",justifyContent:"center" }}>
          <div style={{ width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.16)" }}/>
        </div>

        {/* Header */}
        <div style={{ flexShrink:0,display:"flex",alignItems:"center",
          padding:"6px 14px 8px",gap:10,borderBottom:`1px solid ${TH.border}` }}>

          {/* Status icon */}
          <div style={{ width:32,height:32,borderRadius:9,flexShrink:0,
            background: isRecording
              ? autoPaused ? "rgba(245,158,11,0.14)" : "rgba(239,68,68,0.14)"
              : isPaused  ? "rgba(245,158,11,0.14)"
              : isStopped ? "rgba(34,197,94,0.12)"
              : "rgba(59,130,246,0.12)",
            border:`1px solid ${accentColor}40`,
            display:"flex",alignItems:"center",justifyContent:"center",position:"relative" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={accentColor} strokeWidth="2" strokeLinecap="round">
              {isRecording&&!autoPaused
                ? <rect x="3" y="3" width="18" height="18" rx="3" fill={TH.red} stroke="none"/>
                : isPaused||autoPaused
                  ? <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>
                  : isStopped
                    ? <polyline points="20 6 9 17 4 12"/>
                    : <polygon points="5 3 19 12 5 21 5 3"/>
              }
            </svg>
            {isRecording&&!autoPaused&&(
              <div style={{ position:"absolute",top:3,right:3,width:5,height:5,
                borderRadius:"50%",background:TH.red,
                animation:"recpulse 1s infinite",boxShadow:`0 0 5px ${TH.red}` }}/>
            )}
          </div>

          {/* Track name */}
          <div style={{ flex:1,minWidth:0 }}>
            {editingName && !isIdle ? (
              <input autoFocus value={trackName}
                onChange={e=>setTrackName(e.target.value)}
                onBlur={()=>setEditingName(false)}
                onKeyDown={e=>e.key==="Enter"&&setEditingName(false)}
                style={{ background:"transparent",border:"none",
                  borderBottom:`1px solid ${TH.blue}`,color:TH.text,
                  fontSize:13,fontWeight:700,outline:"none",
                  width:"100%",fontFamily:"inherit" }}/>
            ) : (
              <div onClick={()=>!isIdle&&setEditingName(true)} style={{
                fontSize:13,fontWeight:700,color:TH.text,
                cursor:isIdle?"default":"text",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
              }}>
                {isIdle ? "Live Track Recorder" : trackName}
              </div>
            )}
            <div style={{ fontSize:9.5,color:TH.sub,marginTop:2,
              fontFamily:"DM Mono,monospace" }}>
              {isRecording ? autoPaused ? `[Pause] Not moving . ${stats.points} pts`
                           : `o REC . ${stats.points} pts . ±${lastPtRef.current?.accuracy!=null?Math.round(lastPtRef.current.accuracy):"?"}m`
               : isPaused  ? `[Pause] Paused . ${stats.points} pts`
               : isStopped ? `✓ Saved . ${stats.points} pts`
               : "AlpineQuest-style GPS recorder"}
            </div>
          </div>

          {/* Color picker (idle/stopped only) */}
          {(isIdle||isStopped) && (
            <div style={{ position:"relative",flexShrink:0 }}>
              <button onClick={()=>setShowColors(p=>!p)} style={{
                width:22,height:22,borderRadius:"50%",background:trackColor,
                border:"2px solid rgba(255,255,255,0.3)",cursor:"pointer",
                boxShadow:`0 0 8px ${trackColor}60`,
              }} title="Track color"/>
              {showColors && (
                <div style={{
                  position:"absolute",bottom:30,right:0,
                  background:"#0f172a",border:`1px solid ${TH.border}`,
                  borderRadius:10,padding:10,display:"flex",gap:6,
                  boxShadow:"0 8px 24px rgba(0,0,0,0.6)",zIndex:10,
                }}>
                  {TRACK_COLORS.map(c=>(
                    <button key={c.hex} onClick={()=>{setTrackColor(c.hex);setShowColors(false);}} style={{
                      width:22,height:22,borderRadius:"50%",background:c.hex,
                      border:"none",cursor:"pointer",
                      outline:trackColor===c.hex?"2px solid #fff":"2px solid transparent",
                      outlineOffset:2,
                    }} title={c.name}/>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Minimise + Close */}
          <div style={{ display:"flex",gap:5,flexShrink:0 }}>
            {(isRecording||isPaused) && (
              <button onClick={()=>setMinimised(true)} style={{
                width:28,height:28,borderRadius:8,cursor:"pointer",
                background:TH.card,border:`1px solid ${TH.border}`,
                color:"rgba(255,255,255,0.35)",display:"flex",
                alignItems:"center",justifyContent:"center" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            )}
            <button onClick={onClose} style={{
              width:28,height:28,borderRadius:8,cursor:"pointer",
              background:TH.card,border:`1px solid ${TH.border}`,
              color:"rgba(255,255,255,0.35)",display:"flex",
              alignItems:"center",justifyContent:"center" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* -- IDLE -- */}
        {isIdle && (
          <div style={{ padding:"18px 16px 22px",textAlign:"center",flexShrink:0 }}>
            <div style={{ color:"rgba(255,255,255,0.18)",fontSize:11,marginBottom:14,lineHeight:1.6 }}>
              [Pin] GPS path . [Cam] Photo waypoints . ⬆ Elevation<br/>
              [?] Export GPX . KML . KMZ . GeoJSON . CSV
            </div>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:14 }}>
              <span style={{ color:"rgba(255,255,255,0.22)",fontSize:11 }}>Track color:</span>
              <div style={{ width:14,height:14,borderRadius:"50%",background:trackColor,
                border:"2px solid rgba(255,255,255,0.25)" }}/>
              <span style={{ color:trackColor,fontSize:11,fontWeight:700 }}>
                {TRACK_COLORS.find(c=>c.hex===trackColor)?.name}
              </span>
            </div>
            <button onClick={startRecording} style={{
              width:"100%",maxWidth:280,padding:15,borderRadius:14,border:"none",
              background:"linear-gradient(135deg,#dc2626,#ef4444)",
              color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",
              letterSpacing:".03em",boxShadow:"0 8px 24px rgba(239,68,68,0.4)",
              display:"flex",alignItems:"center",justifyContent:"center",gap:10,
              fontFamily:"inherit",margin:"0 auto",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="8"/>
              </svg>
              Start Recording
            </button>
          </div>
        )}

        {/* -- RECORDING / PAUSED / STOPPED -- */}
        {!isIdle && (
          <>
            {/* Tabs */}
            <div style={{ flexShrink:0,display:"flex",
              borderBottom:`1px solid ${TH.border}` }}>
              {[
                ["stats",    "[?] Stats"],
                ["waypoints",`[Pin] Wpts (${waypoints.filter(w=>!w.photo).length})`],
                ["photos",   `[Cam] Photos (${waypoints.filter(w=>w.photo).length})`],
              ].map(([id,label])=>(
                <button key={id} onClick={()=>setTab(id)} style={{
                  flex:1,padding:"8px 4px 7px",background:"transparent",border:"none",
                  borderBottom:`2px solid ${tab===id?accentColor:"transparent"}`,
                  color:tab===id?TH.text:TH.sub,
                  fontWeight:tab===id?700:400,fontSize:11,cursor:"pointer",
                  fontFamily:"inherit",transition:"all .15s",
                }}>{label}</button>
              ))}
            </div>

            {/* Tab content */}
            <div className="ltr-s" style={{ flex:1,overflowY:"auto",
              overflowX:"hidden",padding:"10px 14px 12px" }}>

              {/* Stats tab */}
              {tab==="stats" && (
                <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                  {/* Auto-pause badge */}
                  {autoPaused && (
                    <div style={{ padding:"6px 10px",borderRadius:9,
                      background:"rgba(245,158,11,0.08)",
                      border:"1px solid rgba(245,158,11,0.2)",
                      color:"#fbbf24",fontSize:10,textAlign:"center",fontWeight:600 }}>
                      [Pause] Auto-paused -- not moving
                    </div>
                  )}
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5 }}>
                    <Cell label="Distance"  value={distStr}  unit={distUnit} color={TH.blue}/>
                    <Cell label="Total Time" value={durStr}                  color={TH.cyan}/>
                    <Cell label="Speed"     value={spdStr}   unit="km/h"    color={TH.amber}/>
                    <Cell label="Moving"    value={formatDuration(stats.movingDuration)}   color={TH.green}/>
                    <Cell label="Stopped"   value={formatDuration(stats.stoppedDuration)}  color={TH.red}/>
                    <Cell label="Pts"       value={stats.points}                           color={TH.sub}/>
                    <Cell label="Ascent"    value={"+" + (Math.round(stats.ascent))}  unit="m" color={TH.green}/>
                    <Cell label="Descent"   value={"-" + (Math.round(stats.descent))} unit="m" color={TH.red}/>
                    <Cell label="Max Spd"   value={((stats.maxSpeed||0)*3.6).toFixed(1)} unit="km/h" color={TH.purple}/>
                    <Cell label="Avg Spd"   value={((stats.avgSpeed||0)*3.6).toFixed(1)}  unit="km/h" color={TH.teal}/>
                    <Cell label="Pace"      value={fmtPace(stats.avgSpeed)}               color="#f9a8d4"/>
                    <Cell label="Battery"   value={stats.battery!=null?`${stats.battery}%`:"--"}
                      color={stats.battery!=null&&stats.battery<20?"#f87171":"#86efac"}/>
                  </div>
                  {/* GPS accuracy row */}
                  {lastPtRef.current && (
                    <div style={{ display:"flex",alignItems:"center",gap:6,
                      padding:"5px 10px",borderRadius:8,
                      background:"rgba(6,182,212,0.05)",
                      border:"1px solid rgba(6,182,212,0.1)" }}>
                      <div style={{ width:5,height:5,borderRadius:"50%",background:TH.cyan,flexShrink:0 }}/>
                      <span style={{ color:"rgba(255,255,255,0.25)",fontSize:10 }}>
                        GPS ±{Math.round(lastPtRef.current.accuracy??0)} m accuracy
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Waypoints tab */}
              {tab==="waypoints" && (
                <div>
                  {waypoints.filter(w=>!w.photo).length===0 ? (
                    <div style={{ textAlign:"center",color:"rgba(255,255,255,0.18)",
                      fontSize:12,padding:"20px 0" }}>
                      <div style={{ fontSize:28,marginBottom:8 }}>[Pin]</div>
                      No waypoints yet
                    </div>
                  ) : waypoints.filter(w=>!w.photo).map(w=>(
                    <div key={w.id} style={{ padding:"9px 11px",borderRadius:8,marginBottom:5,
                      background:"rgba(59,130,246,0.06)",
                      border:"1px solid rgba(59,130,246,0.12)" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                        <span style={{ fontSize:14 }}>[Pin]</span>
                        <span style={{ color:TH.text,fontWeight:600,fontSize:12,flex:1 }}>{w.name}</span>
                        <span style={{ color:TH.sub,fontSize:9,fontFamily:"DM Mono,monospace" }}>
                          {new Date(w.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                        </span>
                      </div>
                      {w.note&&<div style={{ color:"rgba(255,255,255,0.35)",fontSize:11,
                        marginLeft:22,fontStyle:"italic",marginTop:2 }}>{w.note}</div>}
                      <div style={{ color:TH.sub,fontSize:9,marginLeft:22,
                        fontFamily:"DM Mono,monospace",marginTop:2 }}>
                        {w.lat.toFixed(5)}, {w.lng.toFixed(5)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Photos tab */}
              {tab==="photos" && (
                <div>
                  {waypoints.filter(w=>w.photo).length===0 ? (
                    <div style={{ textAlign:"center",color:"rgba(255,255,255,0.18)",
                      fontSize:12,padding:"20px 0" }}>
                      <div style={{ fontSize:28,marginBottom:8 }}>[Cam]</div>
                      No photos yet
                    </div>
                  ) : (
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                      {waypoints.filter(w=>w.photo).map(w=>(
                        <div key={w.id} style={{ borderRadius:10,overflow:"hidden",
                          border:"1px solid rgba(249,115,22,0.2)",
                          background:"rgba(249,115,22,0.04)" }}>
                          {photosRef.current[w.photoId] && (
                            <img src={photosRef.current[w.photoId]} alt={w.name}
                              style={{ width:"100%",height:90,objectFit:"cover",display:"block" }}/>
                          )}
                          <div style={{ padding:"6px 8px" }}>
                            <div style={{ color:TH.text,fontSize:11,fontWeight:600 }}>{w.name}</div>
                            {w.note&&<div style={{ color:TH.sub,fontSize:10,
                              fontStyle:"italic",marginTop:1 }}>{w.note}</div>}
                            <div style={{ color:TH.sub,fontSize:9,marginTop:1 }}>
                              {new Date(w.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Export panel (after stop) */}
              {isStopped && showExport && (
                <div style={{ marginTop:8 }}>
                  <div style={{ padding:"10px 12px",borderRadius:10,marginBottom:10,
                    background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.12)" }}>
                    <div style={{ color:"rgba(255,255,255,0.28)",fontSize:10,
                      textAlign:"center",marginBottom:6 }}>Track saved ✓</div>
                    <div style={{ display:"flex",justifyContent:"space-around" }}>
                      {[
                        [formatDist(stats.distance),"Distance"],
                        [formatDuration(stats.totalDuration),"Total"],
                        [formatDuration(stats.movingDuration),"Moving"],
                        [`${stats.points}`,"Points"],
                      ].map(([v,l])=>(
                        <div key={l} style={{ textAlign:"center" }}>
                          <div style={{ color:TH.text,fontWeight:700,fontSize:11,
                            fontFamily:"DM Mono,monospace" }}>{v}</div>
                          <div style={{ color:TH.sub,fontSize:9 }}>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:6 }}>
                    {[
                      ["gpx","GPX","#3b82f6"],
                      ["kml","KML","#22c55e"],
                      ["kmz","KMZ","#10b981"],
                      ["geojson","JSON","#14b8a6"],
                      ["csv","CSV","#f59e0b"],
                    ].map(([k,lb,c])=>(
                      <button key={k} onClick={()=>doExport(k)} disabled={!!exporting} style={{
                        padding:"11px 4px",borderRadius:9,border:"none",cursor:"pointer",
                        background:`linear-gradient(135deg,${c}cc,${c})`,
                        color:"#fff",fontWeight:700,fontSize:11,fontFamily:"inherit",
                        opacity:exporting&&exporting!==k?0.4:1,
                        display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                      }}>
                        <span style={{ fontSize:16 }}>⬇</span>
                        <span>{exporting===k?"...":lb}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={discardTrack} style={{
                    width:"100%",padding:9,borderRadius:9,
                    border:`1px solid ${TH.border}`,background:"transparent",
                    color:TH.sub,fontSize:11,cursor:"pointer",fontFamily:"inherit",
                  }}>Start New Track</button>
                </div>
              )}
            </div>

            {/* Action buttons (recording/paused) */}
            {!isStopped && (
              <div style={{ flexShrink:0,display:"flex",gap:6,
                padding:"8px 12px 14px",borderTop:`1px solid ${TH.border}` }}>

                {/* Waypoint */}
                <button onClick={addWaypoint}
                  disabled={!isRecording&&!isPaused} style={{
                  flex:1,padding:"10px 4px",borderRadius:10,cursor:"pointer",
                  background:"rgba(59,130,246,0.1)",
                  border:"1px solid rgba(59,130,246,0.25)",
                  color:"#60a5fa",fontWeight:600,fontSize:11,
                  fontFamily:"inherit",
                  opacity:(!isRecording&&!isPaused)?0.4:1,
                  display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                }}>
                  <span style={{ fontSize:18 }}>[Pin]</span>
                  <span>Waypoint</span>
                </button>

                {/* Photo -- triggers camera */}
                <button onClick={addPhoto}
                  disabled={!isRecording&&!isPaused} style={{
                  flex:1,padding:"10px 4px",borderRadius:10,cursor:"pointer",
                  background:"rgba(249,115,22,0.1)",
                  border:"1px solid rgba(249,115,22,0.25)",
                  color:"#fb923c",fontWeight:600,fontSize:11,
                  fontFamily:"inherit",
                  opacity:(!isRecording&&!isPaused)?0.4:1,
                  display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                }}>
                  <span style={{ fontSize:18 }}>[Cam]</span>
                  <span>Photo</span>
                </button>

                {/* Pause / Resume */}
                {isRecording ? (
                  <button onClick={pauseRecording} style={{
                    flex:1,padding:"10px 4px",borderRadius:10,cursor:"pointer",
                    background:"rgba(245,158,11,0.1)",
                    border:"1px solid rgba(245,158,11,0.25)",
                    color:TH.amber,fontWeight:600,fontSize:11,fontFamily:"inherit",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                  }}>
                    <span style={{ fontSize:18 }}>[Pause]</span><span>Pause</span>
                  </button>
                ) : (
                  <button onClick={resumeRecording} style={{
                    flex:1,padding:"10px 4px",borderRadius:10,cursor:"pointer",
                    background:"rgba(34,197,94,0.1)",
                    border:"1px solid rgba(34,197,94,0.25)",
                    color:TH.green,fontWeight:600,fontSize:11,fontFamily:"inherit",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                  }}>
                    <span style={{ fontSize:18 }}>[Play]</span><span>Resume</span>
                  </button>
                )}

                {/* Stop */}
                <button onClick={()=>{
                  if (!confirmStop) { setConfirmStop(true); return; }
                  setConfirmStop(false); stopRecording(); setTab("stats");
                }} style={{
                  flex:1,padding:"10px 4px",borderRadius:10,cursor:"pointer",
                  background: confirmStop?"rgba(239,68,68,0.8)":"rgba(239,68,68,0.1)",
                  border:"1px solid rgba(239,68,68,0.4)",
                  color:confirmStop?"#fff":TH.red,fontWeight:700,fontSize:11,
                  fontFamily:"inherit",transition:"all .18s",
                  display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                }}>
                  <span style={{ fontSize:18 }}>[Stop]</span>
                  <span>{confirmStop?"Confirm":"Stop"}</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}