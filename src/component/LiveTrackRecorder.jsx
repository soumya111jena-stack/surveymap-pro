/**
 * LiveTrackRecorder.jsx — SurveyMap Pro
 * FIXED VERSION — Real-time GPS track works like AlpineQuest
 *
 * Key fixes:
 *  1. statusRef pattern → GPS callback never reads stale status
 *  2. watchPosition restarted only once; callback always current via ref
 *  3. polylineRef guarded — never used before assigned
 *  4. layerGroup never cleared on unmount while recording
 *  5. map.flyTo only on FIRST point, panTo on subsequent out-of-view points
 *  6. Accuracy circle drawn + updated (AlpineQuest style)
 *  7. GPS error shown in UI — not swallowed silently
 */

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_DISTANCE_M = 3;
const DB_NAME        = "SurveyMapPro";
const DB_VERSION     = 2;
const STORE_TRACKS   = "tracks";
const STORE_PHOTOS   = "photos";
const STORE_OBS      = "observations";
const API_ENDPOINT   = "/api/observations";

// ── Helpers ───────────────────────────────────────────────────────────────────
function haversine(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function fmtDist(m)      { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; }
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
function fmtSpeed(mps)   { return `${(mps * 3.6).toFixed(1)} km/h`; }
function nowISO()        { return new Date().toISOString(); }
function buildTrackId()  { return `track_${Date.now()}`; }
function buildObsId()    { return `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

// ── IndexedDB ─────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS))
        db.createObjectStore(STORE_TRACKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_PHOTOS))
        db.createObjectStore(STORE_PHOTOS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_OBS))
        db.createObjectStore(STORE_OBS, { keyPath: "id" });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Submit to admin panel ─────────────────────────────────────────────────────
async function submitToAdminPanel(obs) {
  const payload = {
    id: obs.id, trackId: obs.trackId,
    lat: obs.lat, lng: obs.lng, alt: obs.alt ?? 0, accuracy: obs.accuracy ?? 0,
    capturedAt: obs.capturedAt, writeup: obs.writeup,
    photoBase64: obs.photoBase64, photoMimeType: obs.photoMimeType || "image/jpeg",
    deviceInfo: navigator.userAgent, submittedAt: nowISO(),
  };
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Server ${res.status}`);
  return res.json();
}

// ── GPX Export ────────────────────────────────────────────────────────────────
function buildGPX(track) {
  const wpts = track.waypoints.map(w => `
  <wpt lat="${w.lat}" lon="${w.lng}">
    <ele>${w.alt ?? 0}</ele><time>${w.time}</time>
    <name>${escapeXML(w.name)}</name>
    <desc>${escapeXML(w.writeup || w.note || "")}</desc>
    <sym>${w.photo ? "Camera" : "Flag, Blue"}</sym>
  </wpt>`).join("");
  const trkpts = track.points.map(p =>
    `      <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.alt ?? 0}</ele><time>${p.time}</time>` +
    `<extensions><speed>${p.speed ?? 0}</speed></extensions></trkpt>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SurveyMap Pro"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXML(track.name)}</name><time>${track.startTime}</time></metadata>
${wpts}
  <trk><name>${escapeXML(track.name)}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>`;
}
function escapeXML(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── KMZ Export ────────────────────────────────────────────────────────────────
async function buildKMZ(track, photoMap) {
  const placemarks = track.waypoints.map((w, i) => {
    const photoTag = w.photo
      ? `<description><![CDATA[${w.writeup ? `<p>${escapeXML(w.writeup)}</p>` : ""}<img src="files/photo_${i}.jpg" width="300"/>]]></description>`
      : `<description>${escapeXML(w.note || "")}</description>`;
    return `<Placemark><name>${escapeXML(w.name)}</name>${photoTag}
      <TimeStamp><when>${w.time}</when></TimeStamp>
      <Point><coordinates>${w.lng},${w.lat},${w.alt ?? 0}</coordinates></Point></Placemark>`;
  }).join("");
  const coords = track.points.map(p => `${p.lng},${p.lat},${p.alt ?? 0}`).join(" ");
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${escapeXML(track.name)}</name>
  <Placemark><name>Track</name>
    <Style><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
  </Placemark>${placemarks}
</Document></kml>`;
  const files = [{ name: "doc.kml", data: new TextEncoder().encode(kml) }];
  track.waypoints.forEach((w, i) => {
    if (w.photo && photoMap[w.photoId]) {
      const b64 = photoMap[w.photoId];
      const bin = atob(b64.split(",")[1] || b64);
      const arr = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
      files.push({ name: `files/photo_${i}.jpg`, data: arr });
    }
  });
  return buildZip(files);
}

function buildZip(files) {
  const parts = [], centralDir = [];
  let offset = 0;
  function crc32(data) {
    const table = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c; } return t; })();
    let crc = 0xffffffff; for (const b of data) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
  }
  function u16(n) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n, true); return a; }
  function u32(n) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, true); return a; }
  for (const file of files) {
    const name = new TextEncoder().encode(file.name), data = file.data, crc = crc32(data);
    const lh = new Uint8Array([0x50,0x4b,0x03,0x04,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0x00,0x00,...name]);
    parts.push(lh, data); centralDir.push({ name, data, crc, offset, size: data.length }); offset += lh.length + data.length;
  }
  const cdStart = offset;
  for (const f of centralDir) {
    const cd = new Uint8Array([0x50,0x4b,0x01,0x02,0x14,0x00,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(f.crc),...u32(f.size),...u32(f.size),...u16(f.name.length),0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(f.offset),...f.name]);
    parts.push(cd); offset += cd.length;
  }
  const eocd = new Uint8Array([0x50,0x4b,0x05,0x06,0x00,0x00,0x00,0x00,...u16(centralDir.length),...u16(centralDir.length),...u32(offset - cdStart),...u32(cdStart),0x00,0x00]);
  parts.push(eocd);
  const total = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(total); let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// ── Leaflet Icons ─────────────────────────────────────────────────────────────
function makeWptIcon(color, emoji) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
      <div style="width:32px;height:32px;border-radius:50%;background:${color};border:3px solid #fff;
        display:flex;align-items:center;justify-content:center;font-size:16px;">${emoji}</div>
      <div style="width:3px;height:10px;background:${color};margin-top:-1px;border-radius:0 0 2px 2px;"></div>
    </div>`,
    iconSize: [32, 44], iconAnchor: [16, 44], popupAnchor: [0, -46],
  });
}
const WPT_ICON      = makeWptIcon("#3b82f6", "📌");
const PHOTO_ICON    = makeWptIcon("#f97316", "📷");
const PHOTO_ICON_OK = makeWptIcon("#22c55e", "📷");
const START_ICON    = makeWptIcon("#22c55e", "▶");

// AlpineQuest-style position dot with accuracy pulse ring
function makePosIcon(accuracy, zoom) {
  // Rough pixel radius for accuracy circle overlay on the dot icon
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;">
      <div style="width:18px;height:18px;border-radius:50%;background:#06b6d4;border:3px solid #fff;
        box-shadow:0 0 0 2px rgba(6,182,212,0.4);z-index:2;position:relative;"></div>
      <div style="position:absolute;width:18px;height:18px;border-radius:50%;
        background:rgba(6,182,212,0.18);border:1.5px solid rgba(6,182,212,0.5);
        animation:gps-ring 2s ease-out infinite;"></div>
    </div>
    <style>
      @keyframes gps-ring{0%{transform:scale(1);opacity:0.8}100%{transform:scale(3.5);opacity:0}}
    </style>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  });
}
const POS_ICON = makePosIcon();

// ── Photo Writeup Modal ───────────────────────────────────────────────────────
function PhotoWriteupModal({ photoDataURL, gpsInfo, onSubmit, onSaveDraft, onCancel }) {
  const [writeup, setWriteup] = useState("");
  const textRef = useRef(null);
  useEffect(() => { setTimeout(() => textRef.current?.focus(), 60); }, []);
  const canSubmit = writeup.trim().length > 0;
  return (
    <div style={{ position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",display:"flex",alignItems:"flex-end",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      <div style={{ width:"100%",maxWidth:520,background:"linear-gradient(180deg,#0d1929 0%,#080e1c 100%)",borderRadius:"20px 20px 0 0",border:"1px solid rgba(249,115,22,0.2)",borderBottom:"none",boxShadow:"0 -16px 60px rgba(0,0,0,0.8)",animation:"slideUp .28s cubic-bezier(.16,1,.3,1)",overflow:"hidden" }}>
        <div style={{ height:3,background:"linear-gradient(90deg,#f97316,#ef4444,#f97316)" }} />
        <div style={{ padding:"10px 0 0",textAlign:"center" }}><div style={{ width:36,height:4,borderRadius:2,background:"rgba(255,255,255,0.15)",display:"inline-block" }} /></div>
        <div style={{ display:"flex",alignItems:"center",gap:10,padding:"12px 18px 8px" }}>
          <div style={{ width:34,height:34,borderRadius:10,flexShrink:0,background:"rgba(249,115,22,0.15)",border:"1px solid rgba(249,115,22,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17 }}>📷</div>
          <div>
            <div style={{ color:"#f1f5f9",fontWeight:700,fontSize:15 }}>Field Observation</div>
            <div style={{ color:"#475569",fontSize:10.5,fontFamily:"'DM Mono',monospace" }}>{gpsInfo.lat.toFixed(5)}, {gpsInfo.lng.toFixed(5)} · ±{Math.round(gpsInfo.accuracy ?? 0)} m</div>
          </div>
          <button onClick={onCancel} style={{ marginLeft:"auto",background:"none",border:"none",color:"#475569",fontSize:22,cursor:"pointer" }}>×</button>
        </div>
        <div style={{ margin:"0 18px 14px",borderRadius:12,overflow:"hidden",border:"1px solid rgba(249,115,22,0.18)" }}>
          <img src={photoDataURL} alt="captured" style={{ width:"100%",maxHeight:190,objectFit:"cover",display:"block" }} />
        </div>
        <div style={{ padding:"0 18px 14px" }}>
          <textarea ref={textRef} value={writeup} onChange={e => setWriteup(e.target.value)}
            placeholder="Describe what you observed — field conditions, measurements, anomalies…"
            rows={4} style={{ width:"100%",padding:"10px 13px",borderRadius:10,resize:"none",outline:"none",border:`1px solid ${canSubmit?"rgba(249,115,22,0.5)":"rgba(255,255,255,0.1)"}`,background:canSubmit?"rgba(249,115,22,0.04)":"rgba(255,255,255,0.04)",color:"#e2e8f0",fontSize:13,lineHeight:1.6,fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box" }} />
          <div style={{ fontSize:9.5,color:"#334155",marginTop:3 }}>{writeup.length} chars</div>
        </div>
        <div style={{ display:"flex",gap:10,padding:"0 18px 26px" }}>
          <button onClick={onSaveDraft} style={{ flex:1,padding:"12px",borderRadius:10,cursor:"pointer",border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.05)",color:"#64748b",fontWeight:600,fontSize:13,fontFamily:"inherit" }}>Save Draft</button>
          <button onClick={() => canSubmit && onSubmit(writeup.trim())} disabled={!canSubmit}
            style={{ flex:2,padding:"12px",borderRadius:10,cursor:canSubmit?"pointer":"not-allowed",border:"none",fontWeight:700,fontSize:14,fontFamily:"inherit",background:canSubmit?"linear-gradient(135deg,#ea580c,#f97316)":"rgba(255,255,255,0.07)",color:canSubmit?"#fff":"#334155",boxShadow:canSubmit?"0 6px 20px rgba(249,115,22,0.35)":"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            <span>📤</span> Submit Observation
          </button>
        </div>
      </div>
      <style>{`@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
    </div>
  );
}

// ── Observation Detail Modal ──────────────────────────────────────────────────
function ObservationDetailModal({ obs, onClose, onRetry }) {
  const s = ({ submitted:{color:"#4ade80",bg:"rgba(34,197,94,0.1)",border:"rgba(34,197,94,0.3)",label:"Submitted ✓"}, pending:{color:"#fbbf24",bg:"rgba(251,191,36,0.1)",border:"rgba(251,191,36,0.3)",label:"Submitting…"}, failed:{color:"#f87171",bg:"rgba(239,68,68,0.1)",border:"rgba(239,68,68,0.3)",label:"Submit failed"}, draft:{color:"#94a3b8",bg:"rgba(100,116,139,0.12)",border:"rgba(100,116,139,0.3)",label:"Draft"} })[obs.submitStatus] || { color:"#94a3b8",bg:"rgba(100,116,139,0.12)",border:"rgba(100,116,139,0.3)",label:"Draft" };
  return (
    <div style={{ position:"fixed",inset:0,zIndex:9998,background:"rgba(0,0,0,0.72)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      <div style={{ width:"100%",maxWidth:400,background:"#0a0f1e",borderRadius:16,border:"1px solid rgba(255,255,255,0.1)",boxShadow:"0 20px 70px rgba(0,0,0,0.8)",overflow:"hidden",animation:"fadeInScale .2s ease" }}>
        {obs.photoBase64 && (
          <div style={{ position:"relative" }}>
            <img src={obs.photoBase64} alt="" style={{ width:"100%",height:180,objectFit:"cover",display:"block" }} />
            <div style={{ position:"absolute",inset:0,background:"linear-gradient(to top,rgba(10,15,30,1) 0%,transparent 55%)" }} />
            <div style={{ position:"absolute",bottom:10,left:14,right:14,display:"flex",justifyContent:"space-between",alignItems:"flex-end" }}>
              <span style={{ color:"#fff",fontWeight:700,fontSize:14 }}>{obs.name}</span>
              <span style={{ padding:"2px 8px",borderRadius:20,fontSize:9.5,fontWeight:700,fontFamily:"'DM Mono',monospace",background:s.bg,border:`1px solid ${s.border}`,color:s.color }}>{s.label}</span>
            </div>
            <button onClick={onClose} style={{ position:"absolute",top:10,right:10,background:"rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.7)",borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center" }}>×</button>
          </div>
        )}
        <div style={{ padding:16 }}>
          <div style={{ display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"rgba(6,182,212,0.07)",borderRadius:8,border:"1px solid rgba(6,182,212,0.14)",marginBottom:12 }}>
            <span>📍</span>
            <div>
              <div style={{ color:"#67e8f9",fontSize:10.5,fontFamily:"'DM Mono',monospace" }}>{parseFloat(obs.lat).toFixed(6)}°, {parseFloat(obs.lng).toFixed(6)}°</div>
              <div style={{ color:"#334155",fontSize:9.5 }}>{new Date(obs.capturedAt).toLocaleString()}</div>
            </div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:9,padding:"10px 12px",marginBottom:14 }}>
            <div style={{ color:"rgba(255,255,255,0.25)",fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5 }}>Observation Notes</div>
            <div style={{ color:obs.writeup?"#cbd5e1":"#334155",fontSize:12.5,lineHeight:1.65,fontStyle:obs.writeup?"normal":"italic" }}>{obs.writeup || "No writeup — saved as draft."}</div>
          </div>
          <div style={{ display:"flex",gap:8,alignItems:"center" }}>
            <span style={{ padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,background:s.bg,border:`1px solid ${s.border}`,color:s.color }}>{s.label}</span>
            {(obs.submitStatus === "failed" || obs.submitStatus === "draft") && (
              <button onClick={() => onRetry(obs)} style={{ flex:1,padding:"8px",borderRadius:8,cursor:"pointer",border:`1px solid ${obs.submitStatus==="failed"?"rgba(239,68,68,0.35)":"rgba(249,115,22,0.35)"}`,background:obs.submitStatus==="failed"?"rgba(239,68,68,0.1)":"rgba(249,115,22,0.1)",color:obs.submitStatus==="failed"?"#f87171":"#fb923c",fontSize:11,fontWeight:700,fontFamily:"inherit" }}>
                {obs.submitStatus === "failed" ? "↺ Retry Submit" : "📤 Submit Now"}
              </button>
            )}
          </div>
          {obs.submitError && (
            <div style={{ marginTop:8,padding:"6px 10px",borderRadius:7,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",color:"#f87171",fontSize:10 }}>Error: {obs.submitError}</div>
          )}
        </div>
      </div>
      <style>{`@keyframes fadeInScale{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function LiveTrackRecorder({ map, visible, onClose, onRecordingChange }) {
  const [status, setStatus]             = useState("idle");
  const [trackName, setTrackName]       = useState("");
  const [editingName, setEditingName]   = useState(false);
  const [stats, setStats]               = useState({ distance:0, duration:0, speed:0, ascent:0, descent:0, points:0 });
  const [waypoints, setWaypoints]       = useState([]);
  const [showWptModal, setShowWptModal] = useState(false);
  const [wptName, setWptName]           = useState("");
  const [showExport, setShowExport]     = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [tab, setTab]                   = useState("stats");
  const [gpsError, setGpsError]         = useState(null);    // FIX: show GPS errors
  const [gpsAccuracy, setGpsAccuracy]   = useState(null);    // FIX: show accuracy

  const [pendingPhoto, setPendingPhoto]   = useState(null);
  const [showWriteup, setShowWriteup]     = useState(false);
  const [observations, setObservations]   = useState([]);
  const [viewingObs, setViewingObs]       = useState(null);
  const markerMapRef = useRef({});

  // ── FIX: statusRef so GPS callback never reads stale closure status ───────
  const statusRef     = useRef("idle");
  const setStatusSync = (s) => { statusRef.current = s; setStatus(s); };

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
  const polylineRef   = useRef(null);
  const markersRef    = useRef([]);
  const posMarkerRef  = useRef(null);
  const accCircleRef  = useRef(null);           // FIX: accuracy circle like AlpineQuest
  const layerGroupRef = useRef(null);
  const photoInputRef = useRef(null);
  const trackNameRef  = useRef("");             // FIX: avoid stale trackName in persist

  // Keep trackNameRef in sync
  useEffect(() => { trackNameRef.current = trackName; }, [trackName]);

  // ── Load saved observations on mount ─────────────────────────────────────
  useEffect(() => {
    dbGetAll(STORE_OBS).then(all => {
      if (all?.length) setObservations(all.sort((a, b) => b.capturedAt > a.capturedAt ? 1 : -1));
    }).catch(() => {});
  }, []);

  // ── Init layer group ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const lg = L.layerGroup().addTo(map);
    layerGroupRef.current = lg;
    return () => {
      // FIX: only remove layer group on unmount, not on every status change
      lg.remove();
    };
  }, [map]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "recording") {
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current - pausedMsRef.current;
        const pts = pointsRef.current;
        let spd = 0;
        if (pts.length >= 2) {
          const last = pts[pts.length - 1], prev = pts[pts.length - 2];
          const dt = (new Date(last.time) - new Date(prev.time)) / 1000;
          if (dt > 0) spd = haversine(prev, last) / dt;
        }
        setStats(s => ({ ...s, duration: elapsed, speed: spd }));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  // ── persistTrack ──────────────────────────────────────────────────────────
  const persistTrack = useCallback(async () => {
    if (!trackIdRef.current) return;
    await dbPut(STORE_TRACKS, {
      id: trackIdRef.current,
      name: trackNameRef.current,
      startTime: new Date(startTimeRef.current).toISOString(),
      points: pointsRef.current,
      waypoints: waypointsRef.current,
      savedAt: nowISO(),
    });
    for (const [photoId, data] of Object.entries(photosRef.current)) {
      await dbPut(STORE_PHOTOS, { id: photoId, data });
    }
  }, []);  // FIX: no trackName dep — uses ref instead

  // ── FIX: GPS callback — reads statusRef, never stale ─────────────────────
  const handleGPSPoint = useCallback((pos) => {
    // Read from ref — this callback is registered once and lives in watchPosition forever
    if (statusRef.current === "paused" || statusRef.current === "idle" || statusRef.current === "stopped") return;

    const { latitude: lat, longitude: lng, altitude: alt, speed, accuracy } = pos.coords;
    if (!isFinite(lat) || !isFinite(lng)) return;

    setGpsError(null);
    setGpsAccuracy(Math.round(accuracy ?? 0));

    const pt = { lat, lng, alt: alt ?? 0, speed: speed ?? 0, accuracy: accuracy ?? 0, time: nowISO() };

    // Filter: skip if too close (but always accept first point)
    if (lastPtRef.current && haversine(lastPtRef.current, pt) < MIN_DISTANCE_M) {
      // Still update position marker even if point not added to track
      updatePositionMarker(lat, lng, accuracy);
      return;
    }

    pointsRef.current.push(pt);
    lastPtRef.current = pt;

    // FIX: guard — polyline must exist before calling addLatLng
    if (polylineRef.current) {
      polylineRef.current.addLatLng([lat, lng]);
    }

    // First point → fly to location, add start marker
    if (pointsRef.current.length === 1) {
      map?.flyTo([lat, lng], 17, { animate: true, duration: 1.5 });
      L.marker([lat, lng], { icon: START_ICON })
        .bindTooltip("Start", { permanent: true, direction: "top", className: "start-tooltip" })
        .addTo(layerGroupRef.current);
    }

    updatePositionMarker(lat, lng, accuracy);

    // Auto-pan if position moves out of view (AlpineQuest behavior)
    if (map && !map.getBounds().pad(-0.1).contains([lat, lng])) {
      map.panTo([lat, lng], { animate: true, duration: 0.6 });
    }

    // Recalculate stats
    const pts = pointsRef.current;
    let dist = 0, asc = 0, desc = 0;
    for (let i = 1; i < pts.length; i++) {
      dist += haversine(pts[i - 1], pts[i]);
      const dh = (pts[i].alt ?? 0) - (pts[i - 1].alt ?? 0);
      if (dh > 0.3) asc += dh; else if (dh < -0.3) desc += Math.abs(dh);
    }
    setStats(s => ({ ...s, distance: dist, ascent: asc, descent: desc, points: pts.length }));

    if (pts.length % 10 === 0) persistTrack();
  }, [map, persistTrack]);  // FIX: no 'status' dep

  // ── FIX: GPS error handler shown in UI ───────────────────────────────────
  const handleGPSError = useCallback((err) => {
    const msgs = {
      1: "Location permission denied. Please allow GPS access.",
      2: "GPS position unavailable. Move to open sky.",
      3: "GPS timeout. Retrying…",
    };
    setGpsError(msgs[err.code] || `GPS error: ${err.message}`);
    console.warn("GPS error:", err.code, err.message);
  }, []);

  // ── Position marker + accuracy circle (AlpineQuest style) ─────────────────
  function updatePositionMarker(lat, lng, accuracy) {
    if (!layerGroupRef.current) return;

    // Update or create position dot
    if (posMarkerRef.current) {
      posMarkerRef.current.setLatLng([lat, lng]);
    } else {
      posMarkerRef.current = L.marker([lat, lng], { icon: POS_ICON, zIndexOffset: 1000 })
        .addTo(layerGroupRef.current);
    }

    // FIX: accuracy circle like AlpineQuest
    if (accuracy && accuracy < 200) {
      if (accCircleRef.current) {
        accCircleRef.current.setLatLng([lat, lng]).setRadius(accuracy);
      } else {
        accCircleRef.current = L.circle([lat, lng], {
          radius: accuracy,
          color: "#06b6d4",
          fillColor: "#06b6d4",
          fillOpacity: 0.08,
          weight: 1.5,
          opacity: 0.5,
          dashArray: "4 4",
        }).addTo(layerGroupRef.current);
      }
    }
  }

  // ── startRecording ────────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    if (!map) return;
    if (!navigator.geolocation) {
      setGpsError("GPS not available on this device.");
      return;
    }

    const id   = buildTrackId();
    const name = `Track ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`;

    trackIdRef.current   = id;
    pointsRef.current    = [];
    waypointsRef.current = [];
    photosRef.current    = {};
    startTimeRef.current = Date.now();
    pausedMsRef.current  = 0;
    lastPtRef.current    = null;

    setTrackName(name);
    trackNameRef.current = name;
    setWaypoints([]);
    setGpsError(null);
    setStats({ distance:0, duration:0, speed:0, ascent:0, descent:0, points:0 });
    setStatusSync("recording");
    onRecordingChange?.(true);

    // FIX: create polyline BEFORE starting watch — so handleGPSPoint can use it
    polylineRef.current = L.polyline([], {
      color: "#ef4444",
      weight: 4,
      opacity: 0.92,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(layerGroupRef.current);

    // FIX: watchPosition once — handleGPSPoint uses statusRef so it handles pause/resume correctly
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleGPSPoint,
      handleGPSError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }, [map, handleGPSPoint, handleGPSError]);

  // FIX: pause/resume update statusRef immediately — watchPosition stays active
  const pauseRecording = useCallback(() => {
    pauseStartRef.current = Date.now();
    setStatusSync("paused");
  }, []);

  const resumeRecording = useCallback(() => {
    if (pauseStartRef.current) {
      pausedMsRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    setStatusSync("recording");
  }, []);

  const stopRecording = useCallback(async () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (posMarkerRef.current) {
      posMarkerRef.current.remove();
      posMarkerRef.current = null;
    }
    if (accCircleRef.current) {
      accCircleRef.current.remove();
      accCircleRef.current = null;
    }
    await persistTrack();
    setStatusSync("stopped");
    onRecordingChange?.(false);
    setShowExport(true);
  }, [persistTrack]);

  const discardTrack = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    layerGroupRef.current?.clearLayers();
    posMarkerRef.current  = null;
    accCircleRef.current  = null;
    polylineRef.current   = null;
    markersRef.current    = [];
    markerMapRef.current  = {};
    pointsRef.current     = [];
    waypointsRef.current  = [];
    photosRef.current     = {};
    setStatusSync("idle");
    onRecordingChange?.(false);
    setWaypoints([]);
    setGpsError(null);
    setGpsAccuracy(null);
    setStats({ distance:0, duration:0, speed:0, ascent:0, descent:0, points:0 });
    setShowExport(false);
  }, []);

  // ── Waypoint ───────────────────────────────────────────────────────────────
  const addWaypoint = useCallback(() => {
    if (!lastPtRef.current) { setGpsError("Waiting for GPS fix…"); return; }
    setWptName(""); setShowWptModal(true);
  }, []);

  const confirmWaypoint = useCallback((name, note = "") => {
    if (!lastPtRef.current) return;
    const { lat, lng, alt } = lastPtRef.current;
    const wpt = { id:`wpt_${Date.now()}`, lat, lng, alt, name:name.trim()||`WPT ${waypointsRef.current.length+1}`, note, time:nowISO(), photo:false, photoId:null, writeup:"" };
    waypointsRef.current.push(wpt);
    setWaypoints([...waypointsRef.current]);
    L.marker([lat, lng], { icon: WPT_ICON })
      .bindPopup(`<b>${wpt.name}</b>${note?`<br/>${note}`:""}`)
      .addTo(layerGroupRef.current);
    setShowWptModal(false);
  }, []);

  // ── Photo capture ──────────────────────────────────────────────────────────
  const addPhotoWaypoint = useCallback(() => {
    if (!lastPtRef.current) { setGpsError("Waiting for GPS fix…"); return; }
    photoInputRef.current?.click();
  }, []);

  const handlePhotoCapture = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file || !lastPtRef.current) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = ev => {
      setPendingPhoto({ dataURL: ev.target.result, gpsInfo: { ...lastPtRef.current }, mimeType: file.type || "image/jpeg" });
      setShowWriteup(true);
    };
    reader.readAsDataURL(file);
  }, []);

  const commitPhoto = useCallback(async (writeup, isDraft = false) => {
    if (!pendingPhoto) return;
    const { dataURL, gpsInfo, mimeType } = pendingPhoto;
    const obsId   = buildObsId();
    const photoId = `photo_${Date.now()}`;
    photosRef.current[photoId] = dataURL;
    const wpt = { id:`wpt_${Date.now()}`, lat:gpsInfo.lat, lng:gpsInfo.lng, alt:gpsInfo.alt??0, name:`Photo ${Object.keys(photosRef.current).length}`, note:writeup, writeup, time:nowISO(), photo:true, photoId, obsId };
    waypointsRef.current.push(wpt); setWaypoints([...waypointsRef.current]);
    const obs = { id:obsId, trackId:trackIdRef.current, name:wpt.name, lat:gpsInfo.lat, lng:gpsInfo.lng, alt:gpsInfo.alt??0, accuracy:gpsInfo.accuracy??0, capturedAt:nowISO(), writeup, photoBase64:dataURL, photoMimeType:mimeType, photoId, submitStatus:isDraft?"draft":"pending", submitError:null, submittedAt:null };
    await dbPut(STORE_OBS, obs);
    setObservations(prev => [obs, ...prev]);
    const popupHtml = `<div style="padding:4px;font-family:'DM Sans',sans-serif;max-width:220px;"><b>${wpt.name}</b><img src="${dataURL}" style="width:100%;max-height:140px;object-fit:cover;border-radius:6px;display:block;margin:6px 0;"/>${writeup?`<div style="font-size:11px;">${writeup.slice(0,120)}</div>`:""}</div>`;
    const m = L.marker([gpsInfo.lat, gpsInfo.lng], { icon: PHOTO_ICON, zIndexOffset: 900 })
      .bindPopup(popupHtml, { maxWidth: 240 }).addTo(layerGroupRef.current);
    markersRef.current.push(m); markerMapRef.current[obsId] = m;
    setShowWriteup(false); setPendingPhoto(null);
    if (!isDraft) {
      try {
        await submitToAdminPanel(obs);
        const updated = { ...obs, submitStatus:"submitted", submittedAt:nowISO() };
        await dbPut(STORE_OBS, updated);
        setObservations(prev => prev.map(o => o.id===obsId ? updated : o));
        markerMapRef.current[obsId]?.setIcon(PHOTO_ICON_OK);
      } catch (err) {
        const failed = { ...obs, submitStatus:"failed", submitError:err.message };
        await dbPut(STORE_OBS, failed);
        setObservations(prev => prev.map(o => o.id===obsId ? failed : o));
      }
    }
  }, [pendingPhoto]);

  const retrySubmit = useCallback(async (obs) => {
    setViewingObs(null);
    const pending = { ...obs, submitStatus:"pending", submitError:null };
    await dbPut(STORE_OBS, pending);
    setObservations(prev => prev.map(o => o.id===obs.id ? pending : o));
    try {
      await submitToAdminPanel(obs);
      const updated = { ...obs, submitStatus:"submitted", submittedAt:nowISO() };
      await dbPut(STORE_OBS, updated);
      setObservations(prev => prev.map(o => o.id===obs.id ? updated : o));
      markerMapRef.current[obs.id]?.setIcon(PHOTO_ICON_OK);
    } catch (err) {
      const failed = { ...obs, submitStatus:"failed", submitError:err.message };
      await dbPut(STORE_OBS, failed);
      setObservations(prev => prev.map(o => o.id===obs.id ? failed : o));
    }
  }, []);

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportGPX = useCallback(async () => {
    setExporting(true);
    try {
      await persistTrack();
      const gpx  = buildGPX({ id:trackIdRef.current, name:trackNameRef.current, startTime:new Date(startTimeRef.current).toISOString(), points:pointsRef.current, waypoints:waypointsRef.current });
      const blob = new Blob([gpx], { type:"application/gpx+xml" });
      const url  = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href:url, download:`${trackNameRef.current.replace(/[^a-z0-9]/gi,"_")}.gpx` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally { setExporting(false); }
  }, [persistTrack]);

  const exportKMZ = useCallback(async () => {
    setExporting(true);
    try {
      await persistTrack();
      const kmzData = await buildKMZ({ name:trackNameRef.current, startTime:new Date(startTimeRef.current).toISOString(), points:pointsRef.current, waypoints:waypointsRef.current }, photosRef.current);
      const blob    = new Blob([kmzData], { type:"application/vnd.google-earth.kmz" });
      const url     = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href:url, download:`${trackNameRef.current.replace(/[^a-z0-9]/gi,"_")}.kmz` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally { setExporting(false); }
  }, [persistTrack]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      clearInterval(timerRef.current);
    };
  }, []);

  if (!visible) return null;

  const isRecording = status === "recording";
  const isPaused    = status === "paused";
  const isStopped   = status === "stopped";
  const isIdle      = status === "idle";
  const accentColor = isRecording ? "#ef4444" : isPaused ? "#f59e0b" : isStopped ? "#22c55e" : "#3b82f6";

  const trackObs    = observations.filter(o => !trackIdRef.current || o.trackId === trackIdRef.current);
  const failedCount = trackObs.filter(o => o.submitStatus === "failed").length;
  const draftCount  = trackObs.filter(o => o.submitStatus === "draft").length;

  return (
    <>
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handlePhotoCapture} />

      {showWriteup && pendingPhoto && (
        <PhotoWriteupModal
          photoDataURL={pendingPhoto.dataURL}
          gpsInfo={pendingPhoto.gpsInfo}
          onSubmit={writeup => commitPhoto(writeup, false)}
          onSaveDraft={() => commitPhoto("", true)}
          onCancel={() => { setShowWriteup(false); setPendingPhoto(null); }}
        />
      )}

      {viewingObs && (
        <ObservationDetailModal obs={viewingObs} onClose={() => setViewingObs(null)} onRetry={retrySubmit} />
      )}

      {showWptModal && (
        <div style={{ position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px" }}>
          <div style={{ background:"#0f172a",borderRadius:16,border:"1px solid rgba(59,130,246,0.3)",padding:24,width:"100%",maxWidth:320,boxShadow:"0 24px 80px rgba(0,0,0,0.8)",fontFamily:"'DM Sans',system-ui,sans-serif" }}>
            <div style={{ color:"#f1f5f9",fontWeight:700,fontSize:16,marginBottom:4 }}>📌 Add Waypoint</div>
            <div style={{ color:"#64748b",fontSize:11,marginBottom:16 }}>GPS: {lastPtRef.current?.lat.toFixed(5)}, {lastPtRef.current?.lng.toFixed(5)}</div>
            <input autoFocus value={wptName} onChange={e => setWptName(e.target.value)} onKeyDown={e => e.key==="Enter" && confirmWaypoint(wptName)} placeholder="Waypoint name…"
              style={{ width:"100%",padding:"9px 12px",borderRadius:9,border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.06)",color:"#f1f5f9",fontSize:13,outline:"none",fontFamily:"inherit",marginBottom:12,boxSizing:"border-box" }} />
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={() => confirmWaypoint(wptName)} style={{ flex:1,padding:"10px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>Save</button>
              <button onClick={() => setShowWptModal(false)} style={{ flex:1,padding:"10px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#94a3b8",fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN PANEL ── */}
      <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2000,background:"#0a0f1e",borderTop:`2px solid ${accentColor}`,borderRadius:"16px 16px 0 0",fontFamily:"'DM Sans',system-ui,sans-serif",boxShadow:"0 -8px 40px rgba(0,0,0,0.7)",maxHeight:"70vh",display:"flex",flexDirection:"column",transition:"border-color 0.3s" }}>

        <div style={{ padding:"10px 16px 0",textAlign:"center" }}>
          <div style={{ width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.15)",margin:"0 auto 10px" }} />
        </div>

        {/* Status bar */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px 10px",borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            {isRecording && <div style={{ width:10,height:10,borderRadius:"50%",background:"#ef4444",animation:"rec-blink 1s ease infinite" }} />}
            {isPaused  && <span style={{ fontSize:14 }}>⏸</span>}
            {isStopped && <span style={{ fontSize:14 }}>✅</span>}
            {isIdle    && <span style={{ fontSize:14 }}>🗺️</span>}
            {editingName ? (
              <input autoFocus value={trackName} onChange={e => setTrackName(e.target.value)} onBlur={() => setEditingName(false)} onKeyDown={e => e.key==="Enter" && setEditingName(false)}
                style={{ background:"transparent",border:"none",borderBottom:"1px solid #3b82f6",color:"#f1f5f9",fontSize:14,fontWeight:700,outline:"none",width:180,fontFamily:"inherit" }} />
            ) : (
              <span onClick={() => !isIdle && setEditingName(true)} style={{ color:"#f1f5f9",fontWeight:700,fontSize:14,cursor:isIdle?"default":"text",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                {isIdle ? "Track Recorder" : trackName}
              </span>
            )}
            {/* GPS accuracy badge */}
            {gpsAccuracy != null && !isIdle && (
              <span style={{ padding:"1px 7px",borderRadius:10,fontSize:9,fontWeight:700,fontFamily:"'DM Mono',monospace",background:gpsAccuracy<10?"rgba(34,197,94,0.15)":gpsAccuracy<30?"rgba(251,191,36,0.12)":"rgba(239,68,68,0.12)",border:`1px solid ${gpsAccuracy<10?"rgba(34,197,94,0.3)":gpsAccuracy<30?"rgba(251,191,36,0.3)":"rgba(239,68,68,0.3)"}`,color:gpsAccuracy<10?"#4ade80":gpsAccuracy<30?"#fbbf24":"#f87171" }}>
                ±{gpsAccuracy}m
              </span>
            )}
            {(failedCount > 0 || draftCount > 0) && (
              <span style={{ padding:"1px 7px",borderRadius:10,fontSize:9,fontWeight:700,fontFamily:"'DM Mono',monospace",background:failedCount>0?"rgba(239,68,68,0.15)":"rgba(251,191,36,0.12)",border:`1px solid ${failedCount>0?"rgba(239,68,68,0.3)":"rgba(251,191,36,0.3)"}`,color:failedCount>0?"#f87171":"#fbbf24" }}>
                {failedCount > 0 ? `${failedCount} failed` : `${draftCount} draft`}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#475569",fontSize:20,cursor:"pointer",lineHeight:1,padding:"0 4px" }}>×</button>
        </div>

        {/* GPS error banner */}
        {gpsError && (
          <div style={{ margin:"8px 16px 0",padding:"8px 12px",borderRadius:8,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",color:"#fca5a5",fontSize:11,display:"flex",alignItems:"center",gap:8 }}>
            <span>⚠️</span><span>{gpsError}</span>
            <button onClick={() => setGpsError(null)} style={{ marginLeft:"auto",background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:14 }}>×</button>
          </div>
        )}

        {/* IDLE */}
        {isIdle && (
          <div style={{ padding:"24px 16px",textAlign:"center" }}>
            <div style={{ color:"#64748b",fontSize:12,marginBottom:20,lineHeight:1.6 }}>
              Records your GPS path in real-time.<br/>📷 Photo waypoints capture field observations sent to admin panel.
            </div>
            <button onClick={startRecording} style={{ width:"100%",maxWidth:260,padding:"16px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#dc2626,#ef4444)",color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer",letterSpacing:".04em",boxShadow:"0 8px 24px rgba(239,68,68,0.4)",display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:"inherit",margin:"0 auto" }}>
              <span style={{ fontSize:20 }}>⏺</span> Start Recording
            </button>
          </div>
        )}

        {/* RECORDING / PAUSED / STOPPED */}
        {!isIdle && (
          <>
            {/* Tabs */}
            <div style={{ display:"flex",borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
              {[["stats","📊 Stats"],["waypoints",`📌 Wpts (${waypoints.filter(w=>!w.photo).length})`],["obs",`📷 Obs (${trackObs.length})${failedCount>0?` ⚠${failedCount}`:""}`]].map(([id,label]) => (
                <button key={id} onClick={() => setTab(id)} style={{ flex:1,padding:"10px 4px",border:"none",background:"transparent",borderBottom:`2px solid ${tab===id?accentColor:"transparent"}`,color:tab===id?"#f1f5f9":"#475569",fontWeight:tab===id?700:400,fontSize:11,cursor:"pointer",fontFamily:"inherit",transition:"all .15s" }}>{label}</button>
              ))}
            </div>

            <div style={{ flex:1,overflowY:"auto",padding:"12px 16px" }}>

              {/* STATS TAB */}
              {tab === "stats" && (
                <>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12 }}>
                    {[["📍 Distance",fmtDist(stats.distance),"#38bdf8"],["⏱ Duration",fmtDuration(stats.duration),"#a78bfa"],["⚡ Speed",fmtSpeed(stats.speed),"#34d399"],["⬆ Ascent",`${Math.round(stats.ascent)} m`,"#4ade80"],["⬇ Descent",`${Math.round(stats.descent)} m`,"#fb923c"],["📍 Points",String(stats.points),"#94a3b8"]].map(([label,value,color]) => (
                      <div key={label} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"10px 8px",textAlign:"center" }}>
                        <div style={{ color:"#475569",fontSize:9,fontWeight:700,letterSpacing:".08em",marginBottom:4 }}>{label}</div>
                        <div style={{ color,fontSize:15,fontWeight:800,fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {/* GPS fix row */}
                  <div style={{ display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,background:gpsAccuracy!=null?"rgba(6,182,212,0.06)":"rgba(255,255,255,0.03)",border:`1px solid ${gpsAccuracy!=null?"rgba(6,182,212,0.1)":"rgba(255,255,255,0.06)"}`,marginBottom:4 }}>
                    <div style={{ width:6,height:6,borderRadius:"50%",background:gpsAccuracy!=null?"#06b6d4":"#334155" }} />
                    <span style={{ color:"#64748b",fontSize:10 }}>
                      {gpsAccuracy != null
                        ? `GPS fix · ±${gpsAccuracy} m · ${lastPtRef.current ? `${lastPtRef.current.lat.toFixed(5)}, ${lastPtRef.current.lng.toFixed(5)}` : ""}`
                        : "Acquiring GPS fix…"}
                    </span>
                  </div>
                  {trackObs.length > 0 && (
                    <div style={{ marginTop:8,padding:"7px 10px",borderRadius:8,background:"rgba(249,115,22,0.06)",border:"1px solid rgba(249,115,22,0.14)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <span style={{ color:"#fb923c",fontSize:10.5,fontWeight:600 }}>📷 {trackObs.length} observation{trackObs.length!==1?"s":""}</span>
                      <span onClick={() => setTab("obs")} style={{ color:"#60a5fa",fontSize:10,cursor:"pointer" }}>View all →</span>
                    </div>
                  )}
                  {isPaused && <div style={{ textAlign:"center",color:"#f59e0b",fontSize:11,padding:"8px 0",background:"rgba(245,158,11,0.08)",borderRadius:8,border:"1px solid rgba(245,158,11,0.18)",marginTop:8 }}>⏸ Recording paused</div>}
                </>
              )}

              {/* WAYPOINTS TAB */}
              {tab === "waypoints" && (
                waypoints.filter(w => !w.photo).length === 0
                  ? <div style={{ textAlign:"center",color:"#334155",fontSize:12,padding:"20px 0" }}>No waypoints yet — tap 📌 to add one</div>
                  : waypoints.filter(w => !w.photo).map(w => (
                    <div key={w.id} style={{ display:"flex",gap:10,padding:"8px 10px",borderRadius:8,marginBottom:6,background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.1)" }}>
                      <span style={{ fontSize:16 }}>📌</span>
                      <div style={{ flex:1 }}>
                        <div style={{ color:"#f1f5f9",fontWeight:600,fontSize:12 }}>{w.name}</div>
                        <div style={{ color:"#475569",fontSize:10 }}>{parseFloat(w.lat).toFixed(5)}, {parseFloat(w.lng).toFixed(5)}</div>
                      </div>
                      <div style={{ color:"#334155",fontSize:10 }}>{new Date(w.time).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</div>
                    </div>
                  ))
              )}

              {/* OBSERVATIONS TAB */}
              {tab === "obs" && (
                trackObs.length === 0
                  ? <div style={{ textAlign:"center",color:"#334155",fontSize:12,padding:"20px 0" }}>No observations yet — tap 📷 to capture one</div>
                  : <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                      {trackObs.map(obs => {
                        const sc = { submitted:"#4ade80", pending:"#fbbf24", failed:"#f87171", draft:"#94a3b8" }[obs.submitStatus] || "#94a3b8";
                        const sl = { submitted:"✓ Submitted", pending:"Submitting…", failed:"✗ Failed", draft:"Draft" }[obs.submitStatus] || "Draft";
                        return (
                          <div key={obs.id} onClick={() => setViewingObs(obs)} style={{ display:"flex",gap:10,padding:"9px 10px",borderRadius:10,border:`1px solid ${obs.submitStatus==="failed"?"rgba(239,68,68,0.25)":"rgba(249,115,22,0.15)"}`,background:obs.submitStatus==="failed"?"rgba(239,68,68,0.06)":"rgba(249,115,22,0.04)",cursor:"pointer" }}>
                            <div style={{ width:50,height:50,borderRadius:8,overflow:"hidden",flexShrink:0,border:"1px solid rgba(255,255,255,0.08)" }}>
                              {obs.photoBase64 ? <img src={obs.photoBase64} alt="" style={{ width:"100%",height:"100%",objectFit:"cover",display:"block" }} /> : <div style={{ width:"100%",height:"100%",background:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>📷</div>}
                            </div>
                            <div style={{ flex:1,minWidth:0 }}>
                              <div style={{ display:"flex",alignItems:"center",gap:5,marginBottom:2 }}>
                                <span style={{ color:"#f1f5f9",fontWeight:600,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{obs.name}</span>
                                <span style={{ fontSize:9.5,fontWeight:700,color:sc,fontFamily:"'DM Mono',monospace",flexShrink:0 }}>{sl}</span>
                              </div>
                              <div style={{ color:"#475569",fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2 }}>{obs.writeup || <span style={{ color:"#334155",fontStyle:"italic" }}>No writeup</span>}</div>
                              <div style={{ color:"#334155",fontSize:9.5,fontFamily:"'DM Mono',monospace" }}>{parseFloat(obs.lat).toFixed(4)}, {parseFloat(obs.lng).toFixed(4)}</div>
                            </div>
                            {obs.submitStatus === "failed" && (
                              <button onClick={e => { e.stopPropagation(); retrySubmit(obs); }} style={{ alignSelf:"center",padding:"5px 9px",borderRadius:7,border:"1px solid rgba(239,68,68,0.35)",background:"rgba(239,68,68,0.1)",color:"#f87171",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",flexShrink:0 }}>↺</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
              )}
            </div>

            {/* Action buttons */}
            {!isStopped && (
              <div style={{ display:"flex",gap:8,padding:"10px 16px 16px",borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                <button onClick={addWaypoint} disabled={!isRecording && !isPaused} style={{ flex:1,padding:"11px 6px",borderRadius:10,border:"1px solid rgba(59,130,246,0.25)",background:"rgba(59,130,246,0.1)",color:"#60a5fa",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit",opacity:(!isRecording&&!isPaused)?0.4:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}>
                  <span style={{ fontSize:18 }}>📌</span><span>Waypoint</span>
                </button>
                <button onClick={addPhotoWaypoint} disabled={!isRecording && !isPaused} style={{ flex:1,padding:"11px 6px",borderRadius:10,border:"1px solid rgba(249,115,22,0.3)",background:"rgba(249,115,22,0.1)",color:"#fb923c",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",opacity:(!isRecording&&!isPaused)?0.4:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}>
                  <span style={{ fontSize:18 }}>📷</span><span>Observe</span>
                </button>
                {isRecording
                  ? <button onClick={pauseRecording} style={{ flex:1,padding:"11px 6px",borderRadius:10,border:"1px solid rgba(245,158,11,0.25)",background:"rgba(245,158,11,0.1)",color:"#fbbf24",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}><span style={{ fontSize:18 }}>⏸</span><span>Pause</span></button>
                  : <button onClick={resumeRecording} style={{ flex:1,padding:"11px 6px",borderRadius:10,border:"1px solid rgba(34,197,94,0.25)",background:"rgba(34,197,94,0.1)",color:"#4ade80",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}><span style={{ fontSize:18 }}>▶</span><span>Resume</span></button>
                }
                <button onClick={stopRecording} style={{ flex:1,padding:"11px 6px",borderRadius:10,border:"1px solid rgba(239,68,68,0.25)",background:"rgba(239,68,68,0.1)",color:"#f87171",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}><span style={{ fontSize:18 }}>⏹</span><span>Stop</span></button>
              </div>
            )}

            {/* Export */}
            {isStopped && showExport && (
              <div style={{ padding:"12px 16px 20px",borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ color:"#94a3b8",fontSize:11,marginBottom:4,textAlign:"center" }}>
                  Track saved · {stats.points} pts · {fmtDist(stats.distance)} · {fmtDuration(stats.duration)}
                </div>
                {trackObs.length > 0 && (
                  <div style={{ color:"rgba(249,115,22,0.65)",fontSize:10,textAlign:"center",marginBottom:10 }}>
                    {trackObs.filter(o => o.submitStatus==="submitted").length}/{trackObs.length} observations submitted
                  </div>
                )}
                <div style={{ display:"flex",gap:8,marginBottom:8 }}>
                  <button onClick={exportGPX} disabled={exporting} style={{ flex:1,padding:"12px 8px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#0369a1,#0ea5e9)",color:"#fff",fontWeight:700,fontSize:13,cursor:exporting?"not-allowed":"pointer",opacity:exporting?0.6:1,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>⬇ Export GPX</button>
                  <button onClick={exportKMZ} disabled={exporting} style={{ flex:1,padding:"12px 8px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#15803d,#22c55e)",color:"#fff",fontWeight:700,fontSize:13,cursor:exporting?"not-allowed":"pointer",opacity:exporting?0.6:1,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>⬇ Export KMZ</button>
                </div>
                <button onClick={discardTrack} style={{ width:"100%",padding:"10px",borderRadius:10,border:"1px solid rgba(255,255,255,0.08)",background:"transparent",color:"#475569",fontSize:12,cursor:"pointer",fontFamily:"inherit" }}>Start New Track</button>
              </div>
            )}
          </>
        )}

        <style>{`@keyframes rec-blink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.8)}}`}</style>
      </div>
    </>
  );
}