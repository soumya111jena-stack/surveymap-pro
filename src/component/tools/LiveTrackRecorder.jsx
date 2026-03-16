/**
 * LiveTrackRecorder.jsx — SurveyMap Pro  (v2 — Full AlpineQuest parity)
 *
 * NEW in v2:
 *  ✅ Start marker (green flag) + End marker (red flag) on map
 *  ✅ Waypoint: name + description/note (2 fields)
 *  ✅ Photo: after capture → modal with preview + name + note
 *  ✅ Track color picker (6 colors like AlpineQuest)
 *  ✅ KML export (alongside GPX + KMZ)
 *  ✅ Battery level recorded per GPS point
 *  ✅ Auto-pause detection (stopped moving → pauses stats, not GPS)
 *  ✅ Moving time vs total time vs stopped time
 *  ✅ Max speed tracking
 *  ✅ Average speed (moving time only)
 *  ✅ Pace (min/km) for runners/hikers
 *  ✅ Total elapsed vs moving time split in stats
 */

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_DISTANCE_M      = 3;       // ignore GPS noise < 3m
const AUTO_PAUSE_SPEED    = 0.3;     // m/s — below this = "stopped" (1 km/h)
const AUTO_PAUSE_SECS     = 8;       // seconds of stillness before auto-pause stats
const DB_NAME             = "SurveyMapPro";
const DB_VERSION          = 2;
const STORE_TRACKS        = "tracks";
const STORE_PHOTOS        = "photos";

// Track color options (AlpineQuest style)
const TRACK_COLORS = [
  { name:"Red",    hex:"#ef4444" },
  { name:"Blue",   hex:"#3b82f6" },
  { name:"Green",  hex:"#22c55e" },
  { name:"Orange", hex:"#f97316" },
  { name:"Purple", hex:"#a855f7" },
  { name:"Yellow", hex:"#eab308" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function haversine(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function fmtDist(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

function fmtSpeed(ms) { return `${(ms * 3.6).toFixed(1)} km/h`; }

function fmtPace(ms) {
  if (ms < 0.1) return "—";
  const secPerKm = 1000 / ms;
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2,"0")} /km`;
}

function nowISO() { return new Date().toISOString(); }
function buildTrackId() { return `track_${Date.now()}`; }

// Battery level (where supported)
async function getBattery() {
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      return Math.round(b.level * 100);
    }
  } catch (_) {}
  return null;
}

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

// ── XML escape ────────────────────────────────────────────────────────────────
function escXML(s) {
  return String(s || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── GPX Export ────────────────────────────────────────────────────────────────
function buildGPX(track) {
  const wpts = track.waypoints.map(w => `
  <wpt lat="${w.lat}" lon="${w.lng}">
    <ele>${w.alt ?? 0}</ele><time>${w.time}</time>
    <name>${escXML(w.name)}</name>
    <desc>${escXML(w.note || "")}</desc>
    <sym>${w.photo ? "Camera" : "Flag, Blue"}</sym>
  </wpt>`).join("");

  const trkpts = track.points.map(p =>
    `      <trkpt lat="${p.lat}" lon="${p.lng}">
        <ele>${p.alt ?? 0}</ele><time>${p.time}</time>
        <extensions>
          <speed>${p.speed ?? 0}</speed>
          <accuracy>${p.accuracy ?? 0}</accuracy>
          ${p.battery != null ? `<battery>${p.battery}</battery>` : ""}
        </extensions>
      </trkpt>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SurveyMap Pro"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escXML(track.name)}</name><time>${track.startTime}</time>
    <desc>Recorded with SurveyMap Pro — ${track.points.length} points, ${fmtDist(track.stats?.distance||0)}</desc>
  </metadata>
${wpts}
  <trk>
    <name>${escXML(track.name)}</name>
    <extensions><color>${track.color||"#ef4444"}</color></extensions>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

// ── KML Export ────────────────────────────────────────────────────────────────
function buildKML(track) {
  const color = track.color || "#ef4444";
  // KML uses AABBGGRR hex
  const hex = color.replace("#","");
  const r = hex.slice(0,2), g = hex.slice(2,4), b = hex.slice(4,6);
  const kmlColor = `ff${b}${g}${r}`;

  const placemarks = track.waypoints.map(w => `
  <Placemark>
    <name>${escXML(w.name)}</name>
    <description>${escXML(w.note || "")}</description>
    <TimeStamp><when>${w.time}</when></TimeStamp>
    <Point><coordinates>${w.lng},${w.lat},${w.alt??0}</coordinates></Point>
  </Placemark>`).join("");

  const coords = track.points.map(p => `${p.lng},${p.lat},${p.alt??0}`).join(" ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escXML(track.name)}</name>
    <Style id="trackStyle">
      <LineStyle><color>${kmlColor}</color><width>3</width></LineStyle>
    </Style>
    <Placemark>
      <name>${escXML(track.name)}</name>
      <styleUrl>#trackStyle</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
    </Placemark>
    ${placemarks}
  </Document>
</kml>`;
}

// ── KMZ Export (ZIP with KML + photos) ───────────────────────────────────────
async function buildKMZ(track, photoMap) {
  const placemarks = track.waypoints.map((w, i) => {
    const photoTag = w.photo
      ? `<description><![CDATA[<img src="files/photo_${i}.jpg" width="300"/><br/>${escXML(w.note||"")}]]></description>`
      : `<description>${escXML(w.note || "")}</description>`;
    return `
    <Placemark>
      <name>${escXML(w.name)}</name>
      ${photoTag}
      <TimeStamp><when>${w.time}</when></TimeStamp>
      <Point><coordinates>${w.lng},${w.lat},${w.alt??0}</coordinates></Point>
    </Placemark>`;
  }).join("");

  const coords = track.points.map(p => `${p.lng},${p.lat},${p.alt??0}`).join(" ");
  const color  = track.color || "#ef4444";
  const hex = color.replace("#","");
  const r = hex.slice(0,2), g = hex.slice(2,4), b = hex.slice(4,6);
  const kmlColor = `ff${b}${g}${r}`;

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escXML(track.name)}</name>
    <Style id="trackStyle">
      <LineStyle><color>${kmlColor}</color><width>3</width></LineStyle>
    </Style>
    <Placemark>
      <name>${escXML(track.name)}</name>
      <styleUrl>#trackStyle</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
    </Placemark>
    ${placemarks}
  </Document>
</kml>`;

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

// ── Minimal ZIP builder ───────────────────────────────────────────────────────
function buildZip(files) {
  const crc32Table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (const b of data) crc = crc32Table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(n) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n, true); return a; }
  function u32(n) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, true); return a; }

  const parts = [], centralDir = [];
  let offset = 0;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const data = file.data;
    const crc  = crc32(data);
    const lh   = new Uint8Array([
      0x50,0x4b,0x03,0x04, 0x14,0x00, 0x00,0x00, 0x00,0x00,
      0x00,0x00,0x00,0x00, ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), 0x00,0x00, ...name,
    ]);
    parts.push(lh, data);
    centralDir.push({ name, data, crc, offset, size: data.length });
    offset += lh.length + data.length;
  }

  const cdStart = offset;
  for (const f of centralDir) {
    const cd = new Uint8Array([
      0x50,0x4b,0x01,0x02, 0x14,0x00,0x14,0x00, 0x00,0x00,0x00,0x00,
      0x00,0x00,0x00,0x00, ...u32(f.crc), ...u32(f.size), ...u32(f.size),
      ...u16(f.name.length), 0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,
      0x00,0x00, ...u32(f.offset), ...f.name,
    ]);
    parts.push(cd);
    offset += cd.length;
  }

  const eocd = new Uint8Array([
    0x50,0x4b,0x05,0x06, 0x00,0x00,0x00,0x00,
    ...u16(centralDir.length), ...u16(centralDir.length),
    ...u32(offset - cdStart), ...u32(cdStart), 0x00,0x00,
  ]);
  parts.push(eocd);

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out   = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// ── Download helper ───────────────────────────────────────────────────────────
function download(content, filename, mime) {
  const blob = content instanceof Uint8Array
    ? new Blob([content], { type: mime })
    : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Leaflet markers ───────────────────────────────────────────────────────────
function flagIcon(color, label) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:flex-start;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.6))">
      <div style="display:flex;align-items:center;gap:0">
        <div style="width:3px;height:32px;background:${color};border-radius:2px;"></div>
        <div style="background:${color};color:#fff;font-size:9px;font-weight:800;
          padding:3px 6px;border-radius:0 4px 4px 0;letter-spacing:.04em;
          font-family:'DM Sans',sans-serif;white-space:nowrap;">${label}</div>
      </div>
    </div>`,
    iconSize:    [60, 32],
    iconAnchor:  [3, 32],
    popupAnchor: [30, -34],
  });
}

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

const WPT_ICON   = makeWptIcon("#3b82f6", "📌");
const PHOTO_ICON = makeWptIcon("#f97316", "📷");

const POS_ICON = L.divIcon({
  className: "",
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#06b6d4;
    border:3px solid #fff;box-shadow:0 0 12px rgba(6,182,212,0.8);
    animation:pulse-gps 1.5s ease-in-out infinite;"></div>
    <style>@keyframes pulse-gps{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:0.6}}</style>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
});

// ── Reusable Modal shell ──────────────────────────────────────────────────────
function Modal({ children, onClose }) {
  return (
    <div style={{
      position:"fixed",inset:0,zIndex:9999,
      background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px",
    }} onClick={e => e.target===e.currentTarget && onClose?.()}>
      <div style={{
        background:"#0f172a",borderRadius:16,
        border:"1px solid rgba(255,255,255,0.1)",
        padding:22,width:"100%",maxWidth:340,
        boxShadow:"0 24px 80px rgba(0,0,0,0.8)",
        fontFamily:"'DM Sans',system-ui,sans-serif",
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalTitle({ icon, title, sub }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ color:"#f1f5f9",fontWeight:700,fontSize:15,marginBottom:sub?4:0 }}>{icon} {title}</div>
      {sub && <div style={{ color:"#475569",fontSize:11 }}>{sub}</div>}
    </div>
  );
}

function ModalInput({ label, value, onChange, placeholder, multiline, autoFocus }) {
  const style = {
    width:"100%",padding:"9px 12px",borderRadius:9,
    border:"1px solid rgba(255,255,255,0.12)",
    background:"rgba(255,255,255,0.06)",
    color:"#f1f5f9",fontSize:13,outline:"none",
    fontFamily:"inherit",marginBottom:10,
    boxSizing:"border-box",resize:"vertical",
  };
  return (
    <div>
      {label && <div style={{ color:"#475569",fontSize:10,fontWeight:700,letterSpacing:".08em",marginBottom:4 }}>{label}</div>}
      {multiline
        ? <textarea autoFocus={autoFocus} rows={3} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={style}/>
        : <input autoFocus={autoFocus} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={style}/>
      }
    </div>
  );
}

function ModalActions({ onConfirm, onCancel, confirmLabel="Save", cancelLabel="Cancel" }) {
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
        background:"transparent",color:"#94a3b8",
        fontSize:13,cursor:"pointer",fontFamily:"inherit",
      }}>{cancelLabel}</button>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, mono }) {
  return (
    <div style={{
      background:"rgba(255,255,255,0.04)",
      border:"1px solid rgba(255,255,255,0.07)",
      borderRadius:10,padding:"10px 8px",textAlign:"center",
    }}>
      <div style={{ color:"#334155",fontSize:9,fontWeight:700,letterSpacing:".08em",marginBottom:4 }}>{label}</div>
      <div style={{
        color,fontSize:15,fontWeight:800,
        fontFamily: mono ? "'JetBrains Mono','Courier New',monospace" : "'DM Sans',sans-serif",
      }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function LiveTrackRecorder({ map, visible, onClose, onRecordingChange }) {

  // ── Core state ──────────────────────────────────────────────────────────────
  const [status, setStatus]           = useState("idle"); // idle|recording|paused|stopped
  const [trackName, setTrackName]     = useState("");
  const [editingName, setEditingName] = useState(false);
  const [trackColor, setTrackColor]   = useState(TRACK_COLORS[0].hex);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({
    distance:0, totalDuration:0, movingDuration:0, stoppedDuration:0,
    speed:0, maxSpeed:0, avgSpeed:0, ascent:0, descent:0, points:0,
    battery:null,
  });

  // ── Auto-pause ──────────────────────────────────────────────────────────────
  const [autoPaused, setAutoPaused]   = useState(false); // auto-paused (not moving)
  const stillSinceRef                 = useRef(null);    // timestamp when stopped moving
  const movingDurationRef             = useRef(0);       // accumulated moving ms
  const lastMovingTickRef             = useRef(null);

  // ── Waypoints ──────────────────────────────────────────────────────────────
  const [waypoints, setWaypoints]     = useState([]);
  const [showWptModal, setShowWptModal] = useState(false);
  const [wptName, setWptName]         = useState("");
  const [wptNote, setWptNote]         = useState("");

  // ── Photo annotation modal ──────────────────────────────────────────────────
  const [pendingPhoto, setPendingPhoto] = useState(null); // {dataURL, lat, lng, alt}
  const [photoName, setPhotoName]     = useState("");
  const [photoNote, setPhotoNote]     = useState("");
  const photoInputRef                 = useRef(null);

  // ── Export ──────────────────────────────────────────────────────────────────
  const [showExport, setShowExport]   = useState(false);
  const [exporting, setExporting]     = useState(false);

  // ── UI ───────────────────────────────────────────────────────────────────────
  const [tab, setTab]                 = useState("stats");

  // ── Mutable refs (no re-render needed) ─────────────────────────────────────
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
  const statusRef     = useRef("idle"); // mirror of status for use inside callbacks

  // ── Leaflet layer refs ──────────────────────────────────────────────────────
  const polylineRef   = useRef(null);
  const markersRef    = useRef([]);
  const posMarkerRef  = useRef(null);
  const layerGroupRef = useRef(null);

  // keep statusRef in sync
  useEffect(() => { statusRef.current = status; }, [status]);

  // ── Init layer group ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    layerGroupRef.current = L.layerGroup().addTo(map);
    return () => layerGroupRef.current?.remove();
  }, [map]);

  // ── Timer — updates every second ────────────────────────────────────────────
  useEffect(() => {
    if (status === "recording") {
      timerRef.current = setInterval(async () => {
        const now     = Date.now();
        const total   = now - startTimeRef.current - pausedMsRef.current;
        const pts     = pointsRef.current;

        // Current speed from last 2 GPS points
        let curSpeed = 0;
        if (pts.length >= 2) {
          const dt = (new Date(pts.at(-1).time) - new Date(pts.at(-2).time)) / 1000;
          if (dt > 0) curSpeed = haversine(pts.at(-2), pts.at(-1)) / dt;
        }

        // Auto-pause detection
        if (curSpeed < AUTO_PAUSE_SPEED) {
          if (!stillSinceRef.current) stillSinceRef.current = now;
          if (now - stillSinceRef.current > AUTO_PAUSE_SECS * 1000) {
            // stopped long enough — pause moving timer
            setAutoPaused(true);
            lastMovingTickRef.current = null;
          } else {
            setAutoPaused(false);
          }
        } else {
          stillSinceRef.current  = null;
          setAutoPaused(false);
          // accumulate moving time
          if (lastMovingTickRef.current) {
            movingDurationRef.current += now - lastMovingTickRef.current;
          }
          lastMovingTickRef.current = now;
        }

        // Max speed
        if (curSpeed > maxSpeedRef.current) maxSpeedRef.current = curSpeed;

        // Avg speed (moving time only)
        const movingMs  = movingDurationRef.current;
        const avgSpeed  = movingMs > 0
          ? (pointsRef.current.reduce((s,_,i,a) => i===0?0:s+haversine(a[i-1],a[i]),0)) / (movingMs / 1000)
          : 0;

        // Battery
        const battery = await getBattery();

        setStats(s => ({
          ...s,
          totalDuration:   total,
          movingDuration:  movingMs,
          stoppedDuration: Math.max(0, total - movingMs),
          speed:           curSpeed,
          maxSpeed:        maxSpeedRef.current,
          avgSpeed,
          battery,
        }));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  // ── Start recording ──────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    if (!map) return;
    const id   = buildTrackId();
    const name = `Track ${new Date().toLocaleDateString("en-IN",
      { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}`;

    trackIdRef.current   = id;
    pointsRef.current    = [];
    waypointsRef.current = [];
    photosRef.current    = {};
    startTimeRef.current = Date.now();
    pausedMsRef.current  = 0;
    maxSpeedRef.current  = 0;
    movingDurationRef.current   = 0;
    lastMovingTickRef.current   = null;
    stillSinceRef.current       = null;
    lastPtRef.current    = null;

    setTrackName(name);
    setWaypoints([]);
    setAutoPaused(false);
    setStats({ distance:0, totalDuration:0, movingDuration:0, stoppedDuration:0,
               speed:0, maxSpeed:0, avgSpeed:0, ascent:0, descent:0, points:0, battery:null });
    setStatus("recording");
    onRecordingChange?.(true);

    // Polyline with chosen color
    polylineRef.current = L.polyline([], {
      color: trackColor, weight: 4, opacity: 0.9,
      lineCap: "round", lineJoin: "round",
    }).addTo(layerGroupRef.current);

    if (!navigator.geolocation) {
      alert("GPS not available on this device.");
      setStatus("idle");
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleGPSPoint,
      err => console.warn("GPS:", err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }, [map, trackColor]);

  // ── GPS point handler ─────────────────────────────────────────────────────
  const handleGPSPoint = useCallback(async (pos) => {
    if (statusRef.current === "paused") return;
    const { latitude:lat, longitude:lng, altitude:alt, speed, accuracy } = pos.coords;
    if (!isFinite(lat) || !isFinite(lng)) return;

    const battery = await getBattery();
    const pt = { lat, lng, alt:alt??0, speed:speed??0, accuracy:accuracy??0,
                 time:nowISO(), battery };

    // Filter GPS noise
    if (lastPtRef.current && haversine(lastPtRef.current, pt) < MIN_DISTANCE_M) return;

    pointsRef.current.push(pt);
    lastPtRef.current = pt;

    // Update polyline
    polylineRef.current?.addLatLng([lat, lng]);

    // First point — place START flag
    if (pointsRef.current.length === 1) {
      map?.flyTo([lat, lng], 16, { animate:true, duration:1.2 });
      L.marker([lat, lng], { icon: flagIcon("#22c55e","START"), zIndexOffset:900 })
        .bindTooltip("Start", { permanent:false, direction:"top" })
        .addTo(layerGroupRef.current);
    }

    // Update moving position dot
    if (posMarkerRef.current) {
      posMarkerRef.current.setLatLng([lat, lng]);
    } else {
      posMarkerRef.current = L.marker([lat, lng], { icon:POS_ICON, zIndexOffset:1000 })
        .addTo(layerGroupRef.current);
    }

    // Auto-pan
    if (map && !map.getBounds().contains([lat, lng])) {
      map.panTo([lat, lng], { animate:true, duration:0.8 });
    }

    // Recalculate distance + elevation
    const pts = pointsRef.current;
    let dist=0, asc=0, desc=0;
    for (let i=1; i<pts.length; i++) {
      dist += haversine(pts[i-1], pts[i]);
      const dh = (pts[i].alt??0) - (pts[i-1].alt??0);
      if (dh > 0) asc += dh; else desc += Math.abs(dh);
    }

    setStats(s => ({ ...s, distance:dist, ascent:asc, descent:desc, points:pts.length, battery }));

    // Persist every 10 points
    if (pts.length % 10 === 0) persistTrack();
  }, [map]);

  // ── Persist ──────────────────────────────────────────────────────────────
  const persistTrack = useCallback(async () => {
    if (!trackIdRef.current) return;
    await dbPut(STORE_TRACKS, {
      id: trackIdRef.current,
      name: trackName,
      color: trackColor,
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
  }, [trackName, trackColor]);

  // ── Pause / Resume ────────────────────────────────────────────────────────
  const pauseRecording = useCallback(() => {
    pauseStartRef.current = Date.now();
    lastMovingTickRef.current = null;
    setStatus("paused");
  }, []);

  const resumeRecording = useCallback(() => {
    if (pauseStartRef.current) pausedMsRef.current += Date.now() - pauseStartRef.current;
    setStatus("recording");
  }, []);

  // ── Stop recording — place END flag ──────────────────────────────────────
  const stopRecording = useCallback(async () => {
    navigator.geolocation.clearWatch(watchIdRef.current);

    // Place END flag at last known position
    if (lastPtRef.current) {
      const { lat, lng } = lastPtRef.current;
      L.marker([lat, lng], { icon: flagIcon("#ef4444","END"), zIndexOffset:900 })
        .bindTooltip("End", { permanent:false, direction:"top" })
        .addTo(layerGroupRef.current);
    }

    // Remove position dot
    if (posMarkerRef.current) { posMarkerRef.current.remove(); posMarkerRef.current = null; }

    await persistTrack();
    setStatus("stopped");
    onRecordingChange?.(false);
    setShowExport(true);
  }, [persistTrack]);

  // ── Discard ───────────────────────────────────────────────────────────────
  const discardTrack = useCallback(() => {
    navigator.geolocation.clearWatch(watchIdRef.current);
    layerGroupRef.current?.clearLayers();
    posMarkerRef.current = polylineRef.current = null;
    markersRef.current = pointsRef.current = [];
    waypointsRef.current = [];
    photosRef.current = {};
    movingDurationRef.current = 0;
    maxSpeedRef.current = 0;
    setStatus("idle");
    onRecordingChange?.(false);
    setWaypoints([]);
    setAutoPaused(false);
    setStats({ distance:0, totalDuration:0, movingDuration:0, stoppedDuration:0,
               speed:0, maxSpeed:0, avgSpeed:0, ascent:0, descent:0, points:0, battery:null });
    setShowExport(false);
  }, []);

  // ── Add waypoint (name + note) ────────────────────────────────────────────
  const addWaypoint = useCallback(() => {
    if (!lastPtRef.current) { alert("Waiting for GPS fix…"); return; }
    setWptName(""); setWptNote(""); setShowWptModal(true);
  }, []);

  const confirmWaypoint = useCallback(() => {
    if (!lastPtRef.current) return;
    const { lat, lng, alt } = lastPtRef.current;
    const wpt = {
      id:`wpt_${Date.now()}`, lat, lng, alt,
      name: wptName.trim() || `WPT ${waypointsRef.current.length+1}`,
      note: wptNote.trim(),
      time: nowISO(), photo:false, photoId:null,
    };
    waypointsRef.current.push(wpt);
    setWaypoints([...waypointsRef.current]);

    L.marker([lat, lng], { icon:WPT_ICON })
      .bindPopup(`<b>${wpt.name}</b>${wpt.note?`<br/><span style="font-size:11px">${wpt.note}</span>`:""}`)
      .addTo(layerGroupRef.current);
    setShowWptModal(false);
  }, [wptName, wptNote]);

  // ── Photo capture → annotation modal ────────────────────────────────────
  const addPhotoWaypoint = useCallback(() => {
    if (!lastPtRef.current) { alert("Waiting for GPS fix…"); return; }
    photoInputRef.current?.click();
  }, []);

  const handlePhotoCapture = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file || !lastPtRef.current) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = ev => {
      const { lat, lng, alt } = lastPtRef.current;
      setPendingPhoto({ dataURL: ev.target.result, lat, lng, alt });
      setPhotoName(`Photo ${Object.keys(photosRef.current).length + 1}`);
      setPhotoNote("");
    };
    reader.readAsDataURL(file);
  }, []);

  const confirmPhoto = useCallback(() => {
    if (!pendingPhoto) return;
    const { dataURL, lat, lng, alt } = pendingPhoto;
    const photoId = `photo_${Date.now()}`;
    photosRef.current[photoId] = dataURL;

    const wpt = {
      id:`wpt_${Date.now()}`, lat, lng, alt,
      name: photoName.trim() || `Photo ${Object.keys(photosRef.current).length}`,
      note: photoNote.trim(),
      time: nowISO(), photo:true, photoId,
    };
    waypointsRef.current.push(wpt);
    setWaypoints([...waypointsRef.current]);

    const thumb = `<img src="${dataURL}" style="width:200px;height:150px;object-fit:cover;border-radius:6px;display:block;"/>`;
    const noteHtml = wpt.note ? `<div style="font-size:11px;margin-top:4px">${wpt.note}</div>` : "";
    L.marker([lat, lng], { icon:PHOTO_ICON })
      .bindPopup(`<div style="padding:4px"><b>${wpt.name}</b><br/>${thumb}${noteHtml}</div>`, { maxWidth:240 })
      .addTo(layerGroupRef.current);

    setPendingPhoto(null);
  }, [pendingPhoto, photoName, photoNote]);

  // ── Exports ───────────────────────────────────────────────────────────────
  const buildTrackObj = () => ({
    id: trackIdRef.current,
    name: trackName, color: trackColor,
    startTime: new Date(startTimeRef.current).toISOString(),
    points: pointsRef.current,
    waypoints: waypointsRef.current,
    stats: { distance: stats.distance },
  });

  const safeName = () => trackName.replace(/[^a-z0-9]/gi,"_");

  const doExportGPX = useCallback(async () => {
    setExporting(true);
    try {
      await persistTrack();
      download(buildGPX(buildTrackObj()), `${safeName()}.gpx`, "application/gpx+xml");
    } finally { setExporting(false); }
  }, [trackName, trackColor, stats, persistTrack]);

  const doExportKML = useCallback(async () => {
    setExporting(true);
    try {
      await persistTrack();
      download(buildKML(buildTrackObj()), `${safeName()}.kml`, "application/vnd.google-earth.kml+xml");
    } finally { setExporting(false); }
  }, [trackName, trackColor, persistTrack]);

  const doExportKMZ = useCallback(async () => {
    setExporting(true);
    try {
      await persistTrack();
      const data = await buildKMZ(buildTrackObj(), photosRef.current);
      download(data, `${safeName()}.kmz`, "application/vnd.google-earth.kmz");
    } finally { setExporting(false); }
  }, [trackName, trackColor, persistTrack]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    navigator.geolocation.clearWatch(watchIdRef.current);
    clearInterval(timerRef.current);
  }, []);

  if (!visible) return null;

  // ── Derived UI values ─────────────────────────────────────────────────────
  const isRecording = status === "recording";
  const isPaused    = status === "paused";
  const isStopped   = status === "stopped";
  const isIdle      = status === "idle";
  const accentColor = isRecording ? (autoPaused ? "#f59e0b" : "#ef4444")
                    : isPaused    ? "#f59e0b"
                    : isStopped   ? "#22c55e"
                    : "#3b82f6";

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Hidden camera input */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
        style={{ display:"none" }} onChange={handlePhotoCapture} />

      {/* ── Waypoint modal (name + note) ─────────────────────────────────── */}
      {showWptModal && (
        <Modal onClose={() => setShowWptModal(false)}>
          <ModalTitle icon="📌" title="Add Waypoint"
            sub={`GPS: ${lastPtRef.current?.lat.toFixed(5)}, ${lastPtRef.current?.lng.toFixed(5)}`}/>
          <ModalInput label="NAME" autoFocus value={wptName} onChange={setWptName}
            placeholder={`WPT ${waypointsRef.current.length+1}`}/>
          <ModalInput label="NOTE / DESCRIPTION" value={wptNote} onChange={setWptNote}
            placeholder="Optional description…" multiline/>
          <ModalActions onConfirm={confirmWaypoint} onCancel={() => setShowWptModal(false)}/>
        </Modal>
      )}

      {/* ── Photo annotation modal (preview + name + note) ───────────────── */}
      {pendingPhoto && (
        <Modal onClose={() => setPendingPhoto(null)}>
          <ModalTitle icon="📷" title="Add Photo Waypoint"
            sub={`GPS: ${pendingPhoto.lat.toFixed(5)}, ${pendingPhoto.lng.toFixed(5)}`}/>
          {/* Photo preview */}
          <img src={pendingPhoto.dataURL} alt="preview" style={{
            width:"100%",height:160,objectFit:"cover",
            borderRadius:10,marginBottom:12,display:"block",
            border:"1px solid rgba(255,255,255,0.08)",
          }}/>
          <ModalInput label="PHOTO NAME" autoFocus value={photoName} onChange={setPhotoName}
            placeholder={`Photo ${Object.keys(photosRef.current).length+1}`}/>
          <ModalInput label="NOTE / DESCRIPTION" value={photoNote} onChange={setPhotoNote}
            placeholder="What are you seeing here?" multiline/>
          <ModalActions onConfirm={confirmPhoto} onCancel={() => setPendingPhoto(null)}/>
        </Modal>
      )}

      {/* ── Main panel ──────────────────────────────────────────────────── */}
      <div style={{
        position:"fixed",bottom:0,left:0,right:0,zIndex:2000,
        background:"#0a0f1e",
        borderTop:`2px solid ${accentColor}`,
        borderRadius:"16px 16px 0 0",
        fontFamily:"'DM Sans',system-ui,sans-serif",
        boxShadow:"0 -8px 40px rgba(0,0,0,0.7)",
        maxHeight:"70vh",display:"flex",flexDirection:"column",
        transition:"border-color 0.3s",
      }}>

        {/* ── Drag handle ── */}
        <div style={{ padding:"10px 16px 0",textAlign:"center" }}>
          <div style={{ width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.15)",margin:"0 auto 10px" }}/>
        </div>

        {/* ── Header bar ── */}
        <div style={{
          display:"flex",alignItems:"center",justifyContent:"space-between",
          padding:"0 16px 10px",
          borderBottom:"1px solid rgba(255,255,255,0.07)",
          gap:8,
        }}>
          {/* Status dot */}
          <div style={{ display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0 }}>
            {isRecording && !autoPaused && (
              <div style={{ width:10,height:10,borderRadius:"50%",background:"#ef4444",
                animation:"rec-blink 1s ease infinite",flexShrink:0 }}/>
            )}
            {(isPaused || autoPaused) && <span style={{ fontSize:14 }}>⏸</span>}
            {isStopped && <span style={{ fontSize:14 }}>✅</span>}
            {isIdle    && <span style={{ fontSize:14 }}>🗺️</span>}

            {/* Track name (tap to rename) */}
            {editingName ? (
              <input autoFocus value={trackName}
                onChange={e=>setTrackName(e.target.value)}
                onBlur={()=>setEditingName(false)}
                onKeyDown={e=>e.key==="Enter"&&setEditingName(false)}
                style={{ background:"transparent",border:"none",
                  borderBottom:"1px solid #3b82f6",color:"#f1f5f9",
                  fontSize:14,fontWeight:700,outline:"none",
                  width:180,fontFamily:"inherit" }}/>
            ) : (
              <span onClick={()=>!isIdle&&setEditingName(true)} style={{
                color:"#f1f5f9",fontWeight:700,fontSize:14,
                cursor:isIdle?"default":"text",
                maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
              }}>
                {isIdle ? "Track Recorder" : trackName}
              </span>
            )}

            {/* Auto-paused badge */}
            {autoPaused && isRecording && (
              <span style={{
                padding:"2px 7px",borderRadius:10,
                background:"rgba(245,158,11,0.15)",
                border:"1px solid rgba(245,158,11,0.3)",
                color:"#fbbf24",fontSize:9,fontWeight:700,letterSpacing:".06em",
                flexShrink:0,
              }}>AUTO-PAUSED</span>
            )}
          </div>

          {/* Color swatch (only when idle/stopped) */}
          {(isIdle || isStopped) && (
            <div style={{ position:"relative" }}>
              <button onClick={()=>setShowColorPicker(p=>!p)} style={{
                width:22,height:22,borderRadius:"50%",background:trackColor,
                border:"2px solid rgba(255,255,255,0.3)",cursor:"pointer",flexShrink:0,
                boxShadow:`0 0 8px ${trackColor}60`,
              }} title="Track color"/>
              {showColorPicker && (
                <div style={{
                  position:"absolute",bottom:30,right:0,
                  background:"#0f172a",border:"1px solid rgba(255,255,255,0.1)",
                  borderRadius:10,padding:10,display:"flex",gap:6,
                  boxShadow:"0 8px 24px rgba(0,0,0,0.6)",zIndex:10,
                }}>
                  {TRACK_COLORS.map(c=>(
                    <button key={c.hex} onClick={()=>{setTrackColor(c.hex);setShowColorPicker(false);}} style={{
                      width:24,height:24,borderRadius:"50%",background:c.hex,border:"none",cursor:"pointer",
                      outline: trackColor===c.hex ? "2px solid #fff" : "2px solid transparent",
                      outlineOffset:2,
                    }} title={c.name}/>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Close */}
          <button onClick={onClose} style={{
            background:"none",border:"none",color:"#475569",
            fontSize:20,cursor:"pointer",lineHeight:1,padding:"0 4px",flexShrink:0,
          }}>×</button>
        </div>

        {/* ── IDLE — start button ── */}
        {isIdle && (
          <div style={{ padding:"20px 16px 24px",textAlign:"center" }}>
            <div style={{ color:"#334155",fontSize:12,marginBottom:16 }}>
              Records GPS path with photo waypoints · exports GPX / KML / KMZ
            </div>
            {/* Color hint */}
            <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:16 }}>
              <span style={{ color:"#334155",fontSize:11 }}>Track color:</span>
              <div style={{ width:16,height:16,borderRadius:"50%",background:trackColor,
                border:"2px solid rgba(255,255,255,0.3)" }}/>
              <span style={{ color:"#64748b",fontSize:11 }}>{TRACK_COLORS.find(c=>c.hex===trackColor)?.name}</span>
              <span style={{ color:"#334155",fontSize:10 }}>(tap swatch to change)</span>
            </div>
            <button onClick={startRecording} style={{
              width:"100%",maxWidth:260,padding:16,borderRadius:14,border:"none",
              background:"linear-gradient(135deg,#dc2626,#ef4444)",
              color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer",
              letterSpacing:".04em",
              boxShadow:"0 8px 24px rgba(239,68,68,0.4)",
              display:"flex",alignItems:"center",justifyContent:"center",gap:10,
              fontFamily:"inherit",
            }}>
              <span style={{ fontSize:20 }}>⏺</span> Start Recording
            </button>
          </div>
        )}

        {/* ── RECORDING / PAUSED / STOPPED ── */}
        {!isIdle && (
          <>
            {/* Tabs */}
            <div style={{ display:"flex",borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
              {[
                ["stats",    `📊 Stats`],
                ["waypoints",`📌 Wpts (${waypoints.filter(w=>!w.photo).length})`],
                ["photos",   `📷 Photos (${waypoints.filter(w=>w.photo).length})`],
              ].map(([id,label])=>(
                <button key={id} onClick={()=>setTab(id)} style={{
                  flex:1,padding:"10px 4px",border:"none",background:"transparent",
                  borderBottom:`2px solid ${tab===id?accentColor:"transparent"}`,
                  color:tab===id?"#f1f5f9":"#475569",
                  fontWeight:tab===id?700:400,fontSize:11,cursor:"pointer",
                  fontFamily:"inherit",transition:"all .15s",
                }}>{label}</button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex:1,overflowY:"auto",padding:"12px 16px" }}>

              {/* ── STATS TAB ── */}
              {tab==="stats" && (
                <>
                  {/* Row 1 — distance, total time, speed */}
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6 }}>
                    <StatCard label="📍 DISTANCE"  value={fmtDist(stats.distance)}         color="#38bdf8" mono/>
                    <StatCard label="⏱ TOTAL TIME" value={fmtDuration(stats.totalDuration)} color="#a78bfa" mono/>
                    <StatCard label="⚡ SPEED"      value={fmtSpeed(stats.speed)}            color="#34d399" mono/>
                  </div>
                  {/* Row 2 — ascent, descent, points */}
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6 }}>
                    <StatCard label="⬆ ASCENT"    value={`${Math.round(stats.ascent)} m`}  color="#4ade80" mono/>
                    <StatCard label="⬇ DESCENT"   value={`${Math.round(stats.descent)} m`} color="#fb923c" mono/>
                    <StatCard label="📍 POINTS"   value={String(stats.points)}              color="#94a3b8" mono/>
                  </div>
                  {/* Row 3 — moving time, stopped time, max speed */}
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6 }}>
                    <StatCard label="🏃 MOVING"   value={fmtDuration(stats.movingDuration)}  color="#34d399" mono/>
                    <StatCard label="🛑 STOPPED"  value={fmtDuration(stats.stoppedDuration)} color="#f87171" mono/>
                    <StatCard label="🚀 MAX SPD"  value={fmtSpeed(stats.maxSpeed)}            color="#c084fc" mono/>
                  </div>
                  {/* Row 4 — avg speed, pace, battery */}
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8 }}>
                    <StatCard label="📈 AVG SPD"  value={fmtSpeed(stats.avgSpeed)}           color="#60a5fa" mono/>
                    <StatCard label="👟 PACE"     value={fmtPace(stats.avgSpeed)}             color="#f9a8d4" mono/>
                    <StatCard label="🔋 BATTERY"  value={stats.battery!=null?`${stats.battery}%`:"—"} color={stats.battery!=null&&stats.battery<20?"#f87171":"#86efac"} mono/>
                  </div>

                  {/* GPS accuracy */}
                  {lastPtRef.current && (
                    <div style={{
                      display:"flex",alignItems:"center",gap:6,
                      padding:"6px 10px",borderRadius:8,
                      background:"rgba(6,182,212,0.06)",
                      border:"1px solid rgba(6,182,212,0.1)",
                    }}>
                      <div style={{ width:6,height:6,borderRadius:"50%",background:"#06b6d4" }}/>
                      <span style={{ color:"#334155",fontSize:10 }}>
                        GPS fix · ±{Math.round(lastPtRef.current.accuracy??0)} m accuracy
                      </span>
                      {autoPaused && (
                        <span style={{ marginLeft:"auto",color:"#fbbf24",fontSize:10,fontWeight:700 }}>
                          ⏸ Not moving
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ── WAYPOINTS TAB ── */}
              {tab==="waypoints" && (
                <>
                  {waypoints.filter(w=>!w.photo).length===0 ? (
                    <div style={{ textAlign:"center",color:"#1e293b",fontSize:12,padding:"20px 0" }}>
                      No waypoints yet — tap 📌 to add one
                    </div>
                  ) : (
                    waypoints.filter(w=>!w.photo).map(w=>(
                      <div key={w.id} style={{
                        padding:"9px 11px",borderRadius:8,marginBottom:6,
                        background:"rgba(59,130,246,0.06)",
                        border:"1px solid rgba(59,130,246,0.12)",
                      }}>
                        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:w.note?4:0 }}>
                          <span style={{ fontSize:14 }}>📌</span>
                          <span style={{ color:"#f1f5f9",fontWeight:600,fontSize:12,flex:1 }}>{w.name}</span>
                          <span style={{ color:"#334155",fontSize:9,fontFamily:"'JetBrains Mono',monospace" }}>
                            {new Date(w.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                          </span>
                        </div>
                        {w.note && (
                          <div style={{ color:"#475569",fontSize:11,marginLeft:22,fontStyle:"italic" }}>{w.note}</div>
                        )}
                        <div style={{ color:"#1e293b",fontSize:9,marginLeft:22,fontFamily:"'JetBrains Mono',monospace",marginTop:2 }}>
                          {w.lat.toFixed(5)}, {w.lng.toFixed(5)}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {/* ── PHOTOS TAB ── */}
              {tab==="photos" && (
                <>
                  {waypoints.filter(w=>w.photo).length===0 ? (
                    <div style={{ textAlign:"center",color:"#1e293b",fontSize:12,padding:"20px 0" }}>
                      No photos yet — tap 📷 to take one
                    </div>
                  ) : (
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                      {waypoints.filter(w=>w.photo).map(w=>(
                        <div key={w.id} style={{
                          borderRadius:10,overflow:"hidden",
                          border:"1px solid rgba(249,115,22,0.2)",
                          background:"rgba(249,115,22,0.04)",
                        }}>
                          {photosRef.current[w.photoId] && (
                            <img src={photosRef.current[w.photoId]} alt={w.name}
                              style={{ width:"100%",height:100,objectFit:"cover",display:"block" }}/>
                          )}
                          <div style={{ padding:"6px 8px" }}>
                            <div style={{ color:"#f1f5f9",fontSize:11,fontWeight:600 }}>{w.name}</div>
                            {w.note && <div style={{ color:"#64748b",fontSize:10,fontStyle:"italic",marginTop:2 }}>{w.note}</div>}
                            <div style={{ color:"#334155",fontSize:9 }}>
                              {new Date(w.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Action buttons (recording/paused) ── */}
            {!isStopped && (
              <div style={{
                display:"flex",gap:6,padding:"10px 12px 16px",
                borderTop:"1px solid rgba(255,255,255,0.07)",
              }}>
                {/* Waypoint */}
                <button onClick={addWaypoint} disabled={!isRecording&&!isPaused} style={{
                  flex:1,padding:"11px 4px",borderRadius:10,
                  border:"1px solid rgba(59,130,246,0.25)",
                  background:"rgba(59,130,246,0.1)",color:"#60a5fa",
                  fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"inherit",
                  opacity:(!isRecording&&!isPaused)?0.4:1,
                  display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                }}>
                  <span style={{ fontSize:20 }}>📌</span><span>Waypoint</span>
                </button>

                {/* Photo */}
                <button onClick={addPhotoWaypoint} disabled={!isRecording&&!isPaused} style={{
                  flex:1,padding:"11px 4px",borderRadius:10,
                  border:"1px solid rgba(249,115,22,0.25)",
                  background:"rgba(249,115,22,0.1)",color:"#fb923c",
                  fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"inherit",
                  opacity:(!isRecording&&!isPaused)?0.4:1,
                  display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                }}>
                  <span style={{ fontSize:20 }}>📷</span><span>Photo</span>
                </button>

                {/* Pause / Resume */}
                {isRecording ? (
                  <button onClick={pauseRecording} style={{
                    flex:1,padding:"11px 4px",borderRadius:10,
                    border:"1px solid rgba(245,158,11,0.25)",
                    background:"rgba(245,158,11,0.1)",color:"#fbbf24",
                    fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"inherit",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                  }}>
                    <span style={{ fontSize:20 }}>⏸</span><span>Pause</span>
                  </button>
                ) : (
                  <button onClick={resumeRecording} style={{
                    flex:1,padding:"11px 4px",borderRadius:10,
                    border:"1px solid rgba(34,197,94,0.25)",
                    background:"rgba(34,197,94,0.1)",color:"#4ade80",
                    fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"inherit",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                  }}>
                    <span style={{ fontSize:20 }}>▶</span><span>Resume</span>
                  </button>
                )}

                {/* Stop */}
                <button onClick={stopRecording} style={{
                  flex:1,padding:"11px 4px",borderRadius:10,
                  border:"1px solid rgba(239,68,68,0.3)",
                  background:"rgba(239,68,68,0.12)",color:"#f87171",
                  fontWeight:700,fontSize:11,cursor:"pointer",fontFamily:"inherit",
                  display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                }}>
                  <span style={{ fontSize:20 }}>⏹</span><span>Stop</span>
                </button>
              </div>
            )}

            {/* ── Export panel (after stop) ── */}
            {isStopped && showExport && (
              <div style={{ padding:"12px 16px 20px",borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                {/* Summary */}
                <div style={{
                  padding:"10px 12px",borderRadius:10,marginBottom:12,
                  background:"rgba(34,197,94,0.06)",
                  border:"1px solid rgba(34,197,94,0.12)",
                }}>
                  <div style={{ color:"#94a3b8",fontSize:10,textAlign:"center",marginBottom:6 }}>Track saved</div>
                  <div style={{ display:"flex",justifyContent:"space-around" }}>
                    {[
                      [fmtDist(stats.distance), "Distance"],
                      [fmtDuration(stats.totalDuration), "Total time"],
                      [fmtDuration(stats.movingDuration), "Moving"],
                      [`${stats.points}`, "Points"],
                    ].map(([v,l])=>(
                      <div key={l} style={{ textAlign:"center" }}>
                        <div style={{ color:"#f1f5f9",fontWeight:700,fontSize:12,fontFamily:"'JetBrains Mono',monospace" }}>{v}</div>
                        <div style={{ color:"#334155",fontSize:9 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Export buttons */}
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8 }}>
                  <button onClick={doExportGPX} disabled={exporting} style={{
                    padding:"11px 4px",borderRadius:9,border:"none",
                    background:"linear-gradient(135deg,#0369a1,#0ea5e9)",
                    color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",
                    fontFamily:"inherit",opacity:exporting?0.6:1,
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                  }}>
                    <span style={{ fontSize:16 }}>⬇</span><span>GPX</span>
                  </button>
                  <button onClick={doExportKML} disabled={exporting} style={{
                    padding:"11px 4px",borderRadius:9,border:"none",
                    background:"linear-gradient(135deg,#854d0e,#ca8a04)",
                    color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",
                    fontFamily:"inherit",opacity:exporting?0.6:1,
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                  }}>
                    <span style={{ fontSize:16 }}>⬇</span><span>KML</span>
                  </button>
                  <button onClick={doExportKMZ} disabled={exporting} style={{
                    padding:"11px 4px",borderRadius:9,border:"none",
                    background:"linear-gradient(135deg,#15803d,#22c55e)",
                    color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",
                    fontFamily:"inherit",opacity:exporting?0.6:1,
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                  }}>
                    <span style={{ fontSize:16 }}>⬇</span><span>KMZ</span>
                  </button>
                </div>

                <button onClick={discardTrack} style={{
                  width:"100%",padding:10,borderRadius:9,
                  border:"1px solid rgba(255,255,255,0.08)",
                  background:"transparent",color:"#475569",
                  fontSize:12,cursor:"pointer",fontFamily:"inherit",
                }}>Start New Track</button>
              </div>
            )}
          </>
        )}

        <style>{`
          @keyframes rec-blink {
            0%,100%{opacity:1;transform:scale(1)}
            50%{opacity:0.25;transform:scale(0.7)}
          }
        `}</style>
      </div>
    </>
  );
}