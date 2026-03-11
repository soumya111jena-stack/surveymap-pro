/**
 * SurveyMap.jsx — SurveyMap Pro
 *
 * Full-featured GIS-style web map with:
 *  - Multiple basemap layers (Satellite, Street, Terrain, Dark, Light, WMS, etc.)
 *  - Draw Tool: paths, polygons, markers
 *  - Measure Tool: distance with multiple units
 *  - Survey Route recording
 *  - KML / KMZ / CSV import
 *  - 3D Globe view
 *  - Auto Night Mode
 *  - Live GPS tracking
 *  - ✅ INTEGRATED: LiveTrackRecorder — AlpineQuest-style GPS track recorder
 *      • Real-time polyline on map, live stats (distance, duration, speed, ascent, descent)
 *      • Add named waypoints & photo waypoints pinned to GPS position
 *      • Pause / Resume / Stop recording
 *      • Export as GPX or KMZ (with embedded photos)
 *      • IndexedDB persistence (survives page refresh)
 *  - Professional compass rose (drag to rotate map, click to reset North)
 *  - Mobile-responsive with bottom sheet
 *  - Keyboard shortcuts modal, About modal
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, WMSTileLayer, useMap } from "react-leaflet";
import AddSearch from "./search/AddSearch";
import LiveGPS from "./map/LiveGPS";
import BoundaryLayer from "./map/BoundaryLayer";
import MapTracker from "./map/MapTracker";
import MeasureTool from "./tools/MeasureTool";
import DrawTool from "./tools/DrawTool";
import SurveyClick from "./tools/SurveyClick";
import KMLLoader from "./loaders/KMLLoader";
import KMZLoader from "./loaders/KMZLoader";
import CSVLoader from "./loaders/CSVLoader";
import { haversine, formatDist } from "./map/measureUtils";
import { useNightModeAutoSwitch } from "./map/useNightModeAutoSwitch";
import Globe3DView from "./Globe3DView";
import L from "leaflet";
import "./map/plugins/Leaflet.Graticule";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE TRACK RECORDER — constants & helpers
// ─────────────────────────────────────────────────────────────────────────────
const GPS_INTERVAL_MS = 3000;
const MIN_DISTANCE_M  = 3;
const DB_NAME         = "SurveyMapPro";
const DB_VERSION      = 1;
const STORE_TRACKS    = "tracks";
const STORE_PHOTOS    = "photos";

function haversineTrack(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function fmtDist(m)     { return m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${Math.round(m)} m`; }
function fmtDuration(ms){ const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return h>0?`${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`; }
function fmtSpeed(ms)   { return `${(ms*3.6).toFixed(1)} km/h`; }
function nowISO()       { return new Date().toISOString(); }
function buildTrackId() { return `track_${Date.now()}`; }

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) db.createObjectStore(STORE_TRACKS, { keyPath:"id" });
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS, { keyPath:"id" });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// GPX Export
function buildGPX(track) {
  const wpts = track.waypoints.map(w => `
  <wpt lat="${w.lat}" lon="${w.lng}">
    <ele>${w.alt ?? 0}</ele><time>${w.time}</time>
    <name>${escXML(w.name)}</name><desc>${escXML(w.note||"")}</desc>
    <sym>${w.photo?"Camera":"Flag, Blue"}</sym>
  </wpt>`).join("");
  const trkpts = track.points.map(p =>
    `      <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.alt??0}</ele><time>${p.time}</time><extensions><speed>${p.speed??0}</speed></extensions></trkpt>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SurveyMap Pro" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escXML(track.name)}</name><time>${track.startTime}</time></metadata>
${wpts}
  <trk><name>${escXML(track.name)}</name><trkseg>${trkpts}</trkseg></trk>
</gpx>`;
}
function escXML(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// KMZ Export
async function buildKMZ(track, photoMap) {
  const placemarks = track.waypoints.map((w,i) => {
    const photoTag = w.photo ? `<description><![CDATA[<img src="files/photo_${i}.jpg" width="300"/>]]></description>` : `<description>${escXML(w.note||"")}</description>`;
    return `<Placemark><name>${escXML(w.name)}</name>${photoTag}<TimeStamp><when>${w.time}</when></TimeStamp><Point><coordinates>${w.lng},${w.lat},${w.alt??0}</coordinates></Point></Placemark>`;
  }).join("");
  const coords = track.points.map(p=>`${p.lng},${p.lat},${p.alt??0}`).join(" ");
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escXML(track.name)}</name><Placemark><name>Track</name><Style><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>${placemarks}</Document></kml>`;
  const files = [{ name:"doc.kml", data: new TextEncoder().encode(kml) }];
  track.waypoints.forEach((w,i) => {
    if (w.photo && photoMap[w.photoId]) {
      const b64 = photoMap[w.photoId];
      const bin = atob(b64.split(",")[1]||b64);
      const arr = new Uint8Array(bin.length);
      for (let j=0;j<bin.length;j++) arr[j]=bin.charCodeAt(j);
      files.push({ name:`files/photo_${i}.jpg`, data: arr });
    }
  });
  return buildZip(files);
}
function buildZip(files) {
  const parts=[], centralDir=[];
  let offset=0;
  function crc32(data){const t=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[i]=c;}return t;})();let crc=0xffffffff;for(const b of data)crc=t[(crc^b)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0;}
  function u16(n){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,n,true);return a;}
  function u32(n){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n,true);return a;}
  for(const file of files){
    const name=new TextEncoder().encode(file.name),data=file.data,crc=crc32(data);
    const lh=new Uint8Array([0x50,0x4b,0x03,0x04,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0x00,0x00,...name]);
    parts.push(lh,data);centralDir.push({name,data,crc,offset,size:data.length});offset+=lh.length+data.length;
  }
  const cdStart=offset;
  for(const f of centralDir){
    const cd=new Uint8Array([0x50,0x4b,0x01,0x02,0x14,0x00,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(f.crc),...u32(f.size),...u32(f.size),...u16(f.name.length),0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(f.offset),...f.name]);
    parts.push(cd);offset+=cd.length;
  }
  const eocd=new Uint8Array([0x50,0x4b,0x05,0x06,0x00,0x00,0x00,0x00,...u16(centralDir.length),...u16(centralDir.length),...u32(offset-cdStart),...u32(cdStart),0x00,0x00]);
  parts.push(eocd);
  const total=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(total);
  let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}
  return out;
}

// Leaflet icons for track recorder
function makeWptIcon(color, emoji) {
  return L.divIcon({
    className:"",
    html:`<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))"><div style="width:32px;height:32px;border-radius:50%;background:${color};border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:16px;">${emoji}</div><div style="width:3px;height:10px;background:${color};margin-top:-1px;border-radius:0 0 2px 2px;"></div></div>`,
    iconSize:[32,44],iconAnchor:[16,44],popupAnchor:[0,-46],
  });
}
const WPT_ICON   = makeWptIcon("#3b82f6","📌");
const PHOTO_ICON = makeWptIcon("#f97316","📷");
const START_ICON = makeWptIcon("#22c55e","▶");
const POS_ICON   = L.divIcon({
  className:"",
  html:`<div style="width:20px;height:20px;border-radius:50%;background:#06b6d4;border:3px solid #fff;box-shadow:0 0 12px rgba(6,182,212,0.8);animation:pulse-gps 1.5s ease-in-out infinite;"></div><style>@keyframes pulse-gps{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:0.6}}</style>`,
  iconSize:[20,20],iconAnchor:[10,10],
});

// ─────────────────────────────────────────────────────────────────────────────
// LIVE TRACK RECORDER COMPONENT (embedded — no separate file needed)
// ─────────────────────────────────────────────────────────────────────────────
function LiveTrackRecorder({ map, visible, onClose, onRecordingChange }) {
  const [status, setStatus]           = useState("idle");
  const [trackName, setTrackName]     = useState("");
  const [editingName, setEditingName] = useState(false);
  const [stats, setStats]             = useState({ distance:0, duration:0, speed:0, ascent:0, descent:0, points:0 });
  const [waypoints, setWaypoints]     = useState([]);
  const [showWptModal, setShowWptModal] = useState(false);
  const [wptName, setWptName]         = useState("");
  const [showExport, setShowExport]   = useState(false);
  const [exporting, setExporting]     = useState(false);
  const [tab, setTab]                 = useState("stats");
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
  const polylineRef   = useRef(null);
  const markersRef    = useRef([]);
  const posMarkerRef  = useRef(null);
  const layerGroupRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    layerGroupRef.current = L.layerGroup().addTo(map);
    return () => { if (layerGroupRef.current) layerGroupRef.current.remove(); };
  }, [map]);

  useEffect(() => {
    if (status === "recording") {
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current - pausedMsRef.current;
        const pts = pointsRef.current;
        const spd = pts.length >= 2
          ? haversineTrack(pts[pts.length-2], pts[pts.length-1]) /
            ((new Date(pts[pts.length-1].time) - new Date(pts[pts.length-2].time)) / 1000)
          : 0;
        setStats(s => ({ ...s, duration: elapsed, speed: spd }));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  const persistTrack = useCallback(async () => {
    if (!trackIdRef.current) return;
    const track = { id: trackIdRef.current, name: trackName, startTime: new Date(startTimeRef.current).toISOString(), points: pointsRef.current, waypoints: waypointsRef.current, savedAt: nowISO() };
    await dbPut(STORE_TRACKS, track);
    for (const [photoId, data] of Object.entries(photosRef.current)) {
      await dbPut(STORE_PHOTOS, { id: photoId, data });
    }
  }, [trackName]);

  const handleGPSPoint = useCallback((pos) => {
    if (status === "paused") return;
    const { latitude:lat, longitude:lng, altitude:alt, speed, accuracy } = pos.coords;
    if (!isFinite(lat) || !isFinite(lng)) return;
    const pt = { lat, lng, alt: alt??0, speed: speed??0, accuracy: accuracy??0, time: nowISO() };
    if (lastPtRef.current && haversineTrack(lastPtRef.current, pt) < MIN_DISTANCE_M) return;
    pointsRef.current.push(pt);
    lastPtRef.current = pt;
    polylineRef.current?.addLatLng([lat, lng]);
    if (pointsRef.current.length === 1) {
      map?.flyTo([lat, lng], 16, { animate:true, duration:1.2 });
      const sm = L.marker([lat, lng], { icon: START_ICON }).bindTooltip("Start", { permanent:false, direction:"top" }).addTo(layerGroupRef.current);
      markersRef.current.push(sm);
    }
    if (posMarkerRef.current) { posMarkerRef.current.setLatLng([lat, lng]); }
    else { posMarkerRef.current = L.marker([lat, lng], { icon:POS_ICON, zIndexOffset:1000 }).addTo(layerGroupRef.current); }
    if (map && !map.getBounds().contains([lat, lng])) map.panTo([lat, lng], { animate:true, duration:0.8 });
    const pts = pointsRef.current;
    let dist=0,asc=0,desc=0;
    for (let i=1;i<pts.length;i++) {
      dist += haversineTrack(pts[i-1], pts[i]);
      const dh = (pts[i].alt??0)-(pts[i-1].alt??0);
      if (dh>0) asc+=dh; else desc+=Math.abs(dh);
    }
    setStats(s => ({ ...s, distance:dist, ascent:asc, descent:desc, points:pts.length }));
    if (pts.length % 10 === 0) persistTrack();
  }, [status, map, persistTrack]);

  const startRecording = useCallback(() => {
    if (!map) return;
    const id = buildTrackId();
    const name = `Track ${new Date().toLocaleDateString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}`;
    trackIdRef.current = id; pointsRef.current = []; waypointsRef.current = []; photosRef.current = {};
    startTimeRef.current = Date.now(); pausedMsRef.current = 0; lastPtRef.current = null;
    setTrackName(name); setWaypoints([]); setStats({ distance:0, duration:0, speed:0, ascent:0, descent:0, points:0 });
    setStatus("recording"); onRecordingChange?.(true);
    polylineRef.current = L.polyline([], { color:"#ef4444", weight:4, opacity:0.9, lineCap:"round", lineJoin:"round" }).addTo(layerGroupRef.current);
    if (!navigator.geolocation) { alert("GPS not available."); setStatus("idle"); return; }
    watchIdRef.current = navigator.geolocation.watchPosition(handleGPSPoint, err => console.warn("GPS:", err.message), { enableHighAccuracy:true, maximumAge:2000, timeout:10000 });
  }, [map, handleGPSPoint]);

  const pauseRecording  = useCallback(() => { pauseStartRef.current = Date.now(); setStatus("paused"); }, []);
  const resumeRecording = useCallback(() => { if (pauseStartRef.current) pausedMsRef.current += Date.now() - pauseStartRef.current; setStatus("recording"); }, []);

  const stopRecording = useCallback(async () => {
    navigator.geolocation.clearWatch(watchIdRef.current);
    if (posMarkerRef.current) { posMarkerRef.current.remove(); posMarkerRef.current = null; }
    await persistTrack();
    setStatus("stopped"); onRecordingChange?.(false); setShowExport(true);
  }, [persistTrack]);

  const discardTrack = useCallback(() => {
    navigator.geolocation.clearWatch(watchIdRef.current);
    layerGroupRef.current?.clearLayers();
    posMarkerRef.current = null; polylineRef.current = null; markersRef.current = [];
    pointsRef.current = []; waypointsRef.current = []; photosRef.current = {};
    setStatus("idle"); onRecordingChange?.(false); setWaypoints([]);
    setStats({ distance:0, duration:0, speed:0, ascent:0, descent:0, points:0 }); setShowExport(false);
  }, []);

  const addWaypoint = useCallback(() => {
    if (!lastPtRef.current) { alert("Waiting for GPS fix…"); return; }
    setWptName(""); setShowWptModal(true);
  }, []);

  const confirmWaypoint = useCallback((name, note="") => {
    if (!lastPtRef.current) return;
    const { lat, lng, alt } = lastPtRef.current;
    const wpt = { id:`wpt_${Date.now()}`, lat, lng, alt, name: name.trim()||`WPT ${waypointsRef.current.length+1}`, note, time: nowISO(), photo:false, photoId:null };
    waypointsRef.current.push(wpt); setWaypoints([...waypointsRef.current]);
    const m = L.marker([lat,lng], { icon:WPT_ICON }).bindPopup(`<b>${wpt.name}</b>${note?`<br/>${note}`:""}`).addTo(layerGroupRef.current);
    markersRef.current.push(m); setShowWptModal(false);
  }, []);

  const addPhotoWaypoint = useCallback(() => {
    if (!lastPtRef.current) { alert("Waiting for GPS fix…"); return; }
    photoInputRef.current?.click();
  }, []);

  const handlePhotoCapture = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !lastPtRef.current) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataURL = ev.target.result, photoId = `photo_${Date.now()}`;
      const { lat, lng, alt } = lastPtRef.current;
      photosRef.current[photoId] = dataURL;
      const wpt = { id:`wpt_${Date.now()}`, lat, lng, alt, name:`Photo ${Object.keys(photosRef.current).length}`, note:"", time:nowISO(), photo:true, photoId };
      waypointsRef.current.push(wpt); setWaypoints([...waypointsRef.current]);
      const thumb = `<img src="${dataURL}" style="width:200px;height:150px;object-fit:cover;border-radius:6px;display:block;"/>`;
      const m = L.marker([lat,lng], { icon:PHOTO_ICON }).bindPopup(`<div style="padding:4px"><b>${wpt.name}</b><br/>${thumb}</div>`, { maxWidth:240 }).addTo(layerGroupRef.current);
      markersRef.current.push(m);
    };
    reader.readAsDataURL(file);
  }, []);

  const exportGPX = useCallback(async () => {
    setExporting(true);
    try {
      await persistTrack();
      const track = { id:trackIdRef.current, name:trackName, startTime:new Date(startTimeRef.current).toISOString(), points:pointsRef.current, waypoints:waypointsRef.current };
      const gpx = buildGPX(track);
      const blob = new Blob([gpx], { type:"application/gpx+xml" });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href:url, download:`${trackName.replace(/[^a-z0-9]/gi,"_")}.gpx` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally { setExporting(false); }
  }, [trackName, persistTrack]);

  const exportKMZ = useCallback(async () => {
    setExporting(true);
    try {
      await persistTrack();
      const track = { name:trackName, startTime:new Date(startTimeRef.current).toISOString(), points:pointsRef.current, waypoints:waypointsRef.current };
      const kmzData = await buildKMZ(track, photosRef.current);
      const blob = new Blob([kmzData], { type:"application/vnd.google-earth.kmz" });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href:url, download:`${trackName.replace(/[^a-z0-9]/gi,"_")}.kmz` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally { setExporting(false); }
  }, [trackName, persistTrack]);

  useEffect(() => { return () => { navigator.geolocation.clearWatch(watchIdRef.current); clearInterval(timerRef.current); }; }, []);

  if (!visible) return null;

  const isRecording = status === "recording";
  const isPaused    = status === "paused";
  const isStopped   = status === "stopped";
  const isIdle      = status === "idle";
  const accentColor = isRecording ? "#ef4444" : isPaused ? "#f59e0b" : isStopped ? "#22c55e" : "#3b82f6";

  return (
    <>
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handlePhotoCapture}/>

      {/* Waypoint modal */}
      {showWptModal && (
        <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.65)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 20px" }}>
          <div style={{ background:"#0f172a", borderRadius:16, border:"1px solid rgba(59,130,246,0.3)", padding:24, width:"100%", maxWidth:320, boxShadow:"0 24px 80px rgba(0,0,0,0.8)", fontFamily:"'DM Sans',system-ui,sans-serif" }}>
            <div style={{ color:"#f1f5f9", fontWeight:700, fontSize:16, marginBottom:4 }}>📌 Add Waypoint</div>
            <div style={{ color:"#64748b", fontSize:11, marginBottom:16 }}>GPS: {lastPtRef.current?.lat.toFixed(5)}, {lastPtRef.current?.lng.toFixed(5)}</div>
            <input autoFocus value={wptName} onChange={e=>setWptName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmWaypoint(wptName)} placeholder="Waypoint name…"
              style={{ width:"100%", padding:"9px 12px", borderRadius:9, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.06)", color:"#f1f5f9", fontSize:13, outline:"none", fontFamily:"inherit", marginBottom:12, boxSizing:"border-box" }}/>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>confirmWaypoint(wptName)} style={{ flex:1, padding:"10px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#1d4ed8,#3b82f6)", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Save</button>
              <button onClick={()=>setShowWptModal(false)} style={{ flex:1, padding:"10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"#94a3b8", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Main panel */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:2000, background:"#0a0f1e", borderTop:`2px solid ${accentColor}`, borderRadius:"16px 16px 0 0", fontFamily:"'DM Sans',system-ui,sans-serif", boxShadow:"0 -8px 40px rgba(0,0,0,0.7)", maxHeight:"70vh", display:"flex", flexDirection:"column", transition:"border-color 0.3s" }}>

        {/* Handle */}
        <div style={{ padding:"10px 16px 0", textAlign:"center" }}>
          <div style={{ width:40, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 10px" }}/>
        </div>

        {/* Status bar */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 10px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {isRecording && <div style={{ width:10, height:10, borderRadius:"50%", background:"#ef4444", animation:"rec-blink 1s ease infinite" }}/>}
            {isPaused && <div style={{ fontSize:14 }}>⏸</div>}
            {isStopped && <div style={{ fontSize:14 }}>✅</div>}
            {isIdle    && <div style={{ fontSize:14 }}>🗺️</div>}
            {editingName ? (
              <input autoFocus value={trackName} onChange={e=>setTrackName(e.target.value)} onBlur={()=>setEditingName(false)} onKeyDown={e=>e.key==="Enter"&&setEditingName(false)}
                style={{ background:"transparent", border:"none", borderBottom:"1px solid #3b82f6", color:"#f1f5f9", fontSize:14, fontWeight:700, outline:"none", width:180, fontFamily:"inherit" }}/>
            ) : (
              <span onClick={()=>!isIdle&&setEditingName(true)} style={{ color:"#f1f5f9", fontWeight:700, fontSize:14, cursor:isIdle?"default":"text", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {isIdle ? "Live Track Recorder" : trackName}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#475569", fontSize:20, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>×</button>
        </div>

        {/* IDLE state */}
        {isIdle && (
          <div style={{ padding:"24px 16px", textAlign:"center" }}>
            <div style={{ color:"#64748b", fontSize:12, marginBottom:20 }}>Records your GPS path in real-time with photo waypoints.<br/>Export as GPX or KMZ when done.</div>
            <button onClick={startRecording} style={{ width:"100%", maxWidth:260, padding:"16px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#dc2626,#ef4444)", color:"#fff", fontWeight:700, fontSize:16, cursor:"pointer", letterSpacing:".04em", boxShadow:"0 8px 24px rgba(239,68,68,0.4)", display:"flex", alignItems:"center", justifyContent:"center", gap:10, fontFamily:"inherit", margin:"0 auto" }}>
              <span style={{ fontSize:20 }}>⏺</span> Start Recording
            </button>
          </div>
        )}

        {/* RECORDING / PAUSED / STOPPED */}
        {!isIdle && (
          <>
            {/* Tabs */}
            <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
              {[["stats","📊 Stats"],["waypoints",`📌 Wpts (${waypoints.filter(w=>!w.photo).length})`],["photos",`📷 Photos (${waypoints.filter(w=>w.photo).length})`]].map(([id,label]) => (
                <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:"10px 4px", border:"none", background:"transparent", borderBottom:`2px solid ${tab===id?accentColor:"transparent"}`, color:tab===id?"#f1f5f9":"#475569", fontWeight:tab===id?700:400, fontSize:11, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>{label}</button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>
              {/* Stats */}
              {tab === "stats" && (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
                    {[["📍 Distance",fmtDist(stats.distance),"#38bdf8"],["⏱ Duration",fmtDuration(stats.duration),"#a78bfa"],["⚡ Speed",fmtSpeed(stats.speed),"#34d399"],["⬆ Ascent",`${Math.round(stats.ascent)} m`,"#4ade80"],["⬇ Descent",`${Math.round(stats.descent)} m`,"#fb923c"],["📍 Points",String(stats.points),"#94a3b8"]].map(([label,value,color]) => (
                      <div key={label} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"10px 8px", textAlign:"center" }}>
                        <div style={{ color:"#475569", fontSize:9, fontWeight:700, letterSpacing:".08em", marginBottom:4 }}>{label}</div>
                        <div style={{ color, fontSize:15, fontWeight:800, fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {lastPtRef.current && (
                    <div style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 10px", borderRadius:8, background:"rgba(6,182,212,0.06)", border:"1px solid rgba(6,182,212,0.1)", marginBottom:4 }}>
                      <div style={{ width:6, height:6, borderRadius:"50%", background:"#06b6d4" }}/>
                      <span style={{ color:"#64748b", fontSize:10 }}>GPS fix · ±{Math.round(lastPtRef.current.accuracy??0)} m accuracy · {lastPtRef.current.lat.toFixed(5)}, {lastPtRef.current.lng.toFixed(5)}</span>
                    </div>
                  )}
                  {isPaused && <div style={{ textAlign:"center", color:"#f59e0b", fontSize:11, padding:"8px 0", background:"rgba(245,158,11,0.08)", borderRadius:8, border:"1px solid rgba(245,158,11,0.2)", marginTop:4 }}>⏸ Recording paused — GPS points not saved while paused</div>}
                </>
              )}
              {/* Waypoints */}
              {tab === "waypoints" && (
                <>
                  {waypoints.filter(w=>!w.photo).length === 0
                    ? <div style={{ textAlign:"center", color:"#334155", fontSize:12, padding:"20px 0" }}>No waypoints yet — tap 📌 to add one</div>
                    : waypoints.filter(w=>!w.photo).map(w => (
                        <div key={w.id} style={{ display:"flex", gap:10, padding:"8px 10px", borderRadius:8, marginBottom:6, background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.1)" }}>
                          <span style={{ fontSize:16 }}>📌</span>
                          <div style={{ flex:1 }}>
                            <div style={{ color:"#f1f5f9", fontWeight:600, fontSize:12 }}>{w.name}</div>
                            <div style={{ color:"#475569", fontSize:10 }}>{parseFloat(w.lat).toFixed(5)}, {parseFloat(w.lng).toFixed(5)}</div>
                            {w.note && <div style={{ color:"#64748b", fontSize:10, marginTop:2 }}>{w.note}</div>}
                          </div>
                          <div style={{ color:"#334155", fontSize:10 }}>{new Date(w.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
                        </div>
                      ))
                  }
                </>
              )}
              {/* Photos */}
              {tab === "photos" && (
                <>
                  {waypoints.filter(w=>w.photo).length === 0
                    ? <div style={{ textAlign:"center", color:"#334155", fontSize:12, padding:"20px 0" }}>No photos yet — tap 📷 to take one</div>
                    : <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                        {waypoints.filter(w=>w.photo).map(w => (
                          <div key={w.id} style={{ borderRadius:10, overflow:"hidden", border:"1px solid rgba(249,115,22,0.2)", background:"rgba(249,115,22,0.04)" }}>
                            {photosRef.current[w.photoId] && <img src={photosRef.current[w.photoId]} alt={w.name} style={{ width:"100%", height:100, objectFit:"cover", display:"block" }}/>}
                            <div style={{ padding:"6px 8px" }}>
                              <div style={{ color:"#f1f5f9", fontSize:11, fontWeight:600 }}>{w.name}</div>
                              <div style={{ color:"#475569", fontSize:9 }}>{new Date(w.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                  }
                </>
              )}
            </div>

            {/* Action buttons */}
            {!isStopped && (
              <div style={{ display:"flex", gap:8, padding:"10px 16px 16px", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                {[
                  { label:"Waypoint", icon:"📌", onClick:addWaypoint, color:"59,130,246", textColor:"#60a5fa", disabled:false },
                  { label:"Photo", icon:"📷", onClick:addPhotoWaypoint, color:"249,115,22", textColor:"#fb923c", disabled:false },
                ].map(btn => (
                  <button key={btn.label} onClick={btn.onClick} style={{ flex:1, padding:"11px 6px", borderRadius:10, border:`1px solid rgba(${btn.color},0.25)`, background:`rgba(${btn.color},0.1)`, color:btn.textColor, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <span style={{ fontSize:18 }}>{btn.icon}</span><span>{btn.label}</span>
                  </button>
                ))}
                {isRecording ? (
                  <button onClick={pauseRecording} style={{ flex:1, padding:"11px 6px", borderRadius:10, border:"1px solid rgba(245,158,11,0.25)", background:"rgba(245,158,11,0.1)", color:"#fbbf24", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <span style={{ fontSize:18 }}>⏸</span><span>Pause</span>
                  </button>
                ) : (
                  <button onClick={resumeRecording} style={{ flex:1, padding:"11px 6px", borderRadius:10, border:"1px solid rgba(34,197,94,0.25)", background:"rgba(34,197,94,0.1)", color:"#4ade80", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <span style={{ fontSize:18 }}>▶</span><span>Resume</span>
                  </button>
                )}
                <button onClick={stopRecording} style={{ flex:1, padding:"11px 6px", borderRadius:10, border:"1px solid rgba(239,68,68,0.25)", background:"rgba(239,68,68,0.1)", color:"#f87171", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                  <span style={{ fontSize:18 }}>⏹</span><span>Stop</span>
                </button>
              </div>
            )}

            {/* Export panel */}
            {isStopped && showExport && (
              <div style={{ padding:"12px 16px 20px", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ color:"#94a3b8", fontSize:11, marginBottom:12, textAlign:"center" }}>
                  Track saved · {stats.points} points · {fmtDist(stats.distance)} · {fmtDuration(stats.duration)}
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                  <button onClick={exportGPX} disabled={exporting} style={{ flex:1, padding:"12px 8px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#0369a1,#0ea5e9)", color:"#fff", fontWeight:700, fontSize:13, cursor:exporting?"not-allowed":"pointer", opacity:exporting?0.6:1, fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                    ⬇ Export GPX
                  </button>
                  <button onClick={exportKMZ} disabled={exporting} style={{ flex:1, padding:"12px 8px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#15803d,#22c55e)", color:"#fff", fontWeight:700, fontSize:13, cursor:exporting?"not-allowed":"pointer", opacity:exporting?0.6:1, fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                    ⬇ Export KMZ
                  </button>
                </div>
                <button onClick={discardTrack} style={{ width:"100%", padding:"10px", borderRadius:10, border:"1px solid rgba(255,255,255,0.08)", background:"transparent", color:"#475569", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                  Start New Track
                </button>
              </div>
            )}
          </>
        )}

        <style>{`@keyframes rec-blink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.8)}}`}</style>
      </div>
    </>
  );
}

/* ─── SVG Icon Library ─────────────────────────────────────────── */
const Icons = {
  Satellite:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
  Street:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h18M3 6h18M3 18h18"/><circle cx="12" cy="12" r="3"/></svg>,
  Terrain:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 20l4.5-9 4.5 4.5L16 9l5 11H3z"/></svg>,
  Hillshade:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v6l4 2"/></svg>,
  Contour:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="6" ry="2.5"/><ellipse cx="12" cy="12" rx="2" ry="1"/></svg>,
  SatLabels:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>,
  Dark:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
  Light:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  WMS:         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M2 12h20M12 2c-4 4-4 12 0 20M12 2c4 4 4 12 0 20"/></svg>,
  Draw:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Measure:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 6H3a1 1 0 00-1 1v3a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zM7 10v4M12 10v6M17 10v4"/></svg>,
  Survey:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="14"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>,
  Globe:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  Layers:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  Search:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Pin:         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  Path:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 17c3-3 5-5 5-9a4 4 0 018 0c0 4 2 6 5 9"/></svg>,
  Polygon:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>,
  Upload:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Night:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
  Day:         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  Folder:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>,
  File:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  CSV:         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  Check:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
  Close:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  ChevronDown: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>,
  Menu:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  Wikipedia:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-4 4-4 12 0 20M12 2c4 4 4 12 0 20"/></svg>,
  Maps:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  Star:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  Trash:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  User:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Reset:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>,
  Info:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  Keyboard:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>,
  Eye:         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  Compass:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  Altitude:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 3l5 5-5 5M2 12h20M7 21l-5-5 5-5"/></svg>,
  Link:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
  Live:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M8 12a4 4 0 018 0M5 12a7 7 0 0114 0M2 12a10 10 0 0120 0"/></svg>,
  Zoom:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
  History:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>,
  Directions:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>,
  Export:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Play:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Stop:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
  Record:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>,
  // New icons for LiveTrack
  Track:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12c0-5 3-9 9-9s9 4 9 9-3 9-9 9"/><path d="M12 7v5l3 3"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>,
  GPX:         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h4"/></svg>,
};

function Ico({ name, size = 16, style = {} }) {
  return (
    <span style={{ display:"inline-flex", width:size, height:size, flexShrink:0, ...style }}>
      {Icons[name]}
    </span>
  );
}

/* ─── Map Layers ─────────────────────────────────────────────────── */
const MAP_LAYERS = {
  Satellite:            { url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution:"© Esri", icon:"Satellite" },
  Street:               { url:"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution:"© OpenStreetMap", icon:"Street" },
  Terrain:              { url:"https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution:"© OpenTopoMap", icon:"Terrain" },
  Hillshade:            { url:"https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", attribution:"© ESRI", icon:"Hillshade" },
  Contour:              { url:"https://tiles.stadiamaps.com/tiles/stamen_terrain_lines/{z}/{x}/{y}.png", attribution:"© Stadia Maps", icon:"Contour" },
  "Satellite + Labels": { url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", overlayUrl:"https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", attribution:"© Esri", icon:"SatLabels" },
  Dark:                 { url:"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution:"© CartoDB", icon:"Dark" },
  Light:                { url:"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution:"© CartoDB", icon:"Light" },
  "WMS – States demo":  { type:"wms", url:"https://ahocevar.com/geoserver/wms", layers:"topp:states", format:"image/png", transparent:true, attribution:"GeoServer", icon:"WMS" },
};

/* ─── Utilities ───────────────────────────────────────────────────── */
function zoomToAltitude(zoom){const a={1:147e6,2:73e6,3:36e6,4:18e6,5:9e6,6:4500000,7:2250000,8:1100000,9:550000,10:275000,11:137000,12:68000,13:34000,14:17000,15:8500,16:4200,17:2100,18:1050,19:525,20:262};return a[Math.round(zoom)]||34000;}
function formatAlt(m){return m>=1000?(m/1000).toFixed(0)+" km":m.toFixed(0)+" m";}
function toDMS(val,pos,neg){const a=Math.abs(val),d=Math.floor(a),m=Math.floor((a-d)*60),s=((a-d-m/60)*3600).toFixed(1);return `${d}°${m}'${s}"${val>=0?pos:neg}`;}
function toPlusCode(lat,lng){const ld=Math.floor(Math.abs(lat)),lo=Math.floor(Math.abs(lng));const lm=Math.floor((Math.abs(lat)-ld)*60),nm=Math.floor((Math.abs(lng)-lo)*60);return `${ld}°${lm}'${lat>=0?"N":"S"} ${lo}°${nm}'${lng>=0?"E":"W"}`;}
function zoomForType(type){const t=(type||"").toLowerCase().replace(/_/g," ");if(["country"].some(k=>t.includes(k)))return 6;if(["state","administrative area level 1"].some(k=>t.includes(k)))return 8;if(["administrative area level 2","district","county"].some(k=>t.includes(k)))return 10;if(["city","municipality"].some(k=>t===k))return 12;if(["town"].includes(t))return 13;if(["village","hamlet","suburb","neighbourhood","quarter","residential","locality"].some(k=>t.includes(k)))return 14;if(["street","road","pedestrian","footway","route"].some(k=>t.includes(k)))return 16;if(["amenity","shop","office","restaurant","cafe","hotel","hospital","bank","pharmacy","school","college","university","place of worship","temple","church","mosque","point of interest","establishment"].some(k=>t.includes(k)))return 17;if(["postcode"].includes(t))return 13;return 14;}

/* ─── MapFlyController ────────────────────────────────────────────── */
function MapFlyController({ flyTarget }) {
  const map = useMap();
  useEffect(() => {
    if (!flyTarget) return;
    const { lat, lng, zoom, bbox } = flyTarget;
    if (isNaN(lat) || isNaN(lng)) return;
    if (bbox) {
      try {
        const bounds = L.latLngBounds([parseFloat(bbox[0]),parseFloat(bbox[2])],[parseFloat(bbox[1]),parseFloat(bbox[3])]);
        if (bounds.isValid()) { map.flyToBounds(bounds, { padding:[40,40], maxZoom:zoom||16, duration:1.4 }); return; }
      } catch (_) {}
    }
    map.flyTo([lat, lng], zoom, { animate:true, duration:1.4 });
  }, [flyTarget]);
  return null;
}

/* ─── PROFESSIONAL COMPASS CONTROL ───────────────────────────────── */
function ProfessionalCompassControl() {
  const map = useMap();
  const [bearing, setBearing] = useState(0);
  const [hov, setHov]         = useState({});
  const [rotating, setRotating] = useState(false);
  const rotRef  = useRef(null);
  const roseRef = useRef(null);
  const PAN = 180;

  useEffect(() => {
    const sync = () => { const b = map.getBearing?.() ?? 0; setBearing(b); };
    sync();
    map.on("rotate moveend zoomend", sync);
    return () => map.off("rotate moveend zoomend", sync);
  }, [map]);

  useEffect(() => {
    const container = map.getContainer();
    let active = false, startX = 0, startBearing = 0;
    const onContextDown = (e) => { if (e.button !== 2) return; e.preventDefault(); active = true; startX = e.clientX; startBearing = map.getBearing?.() ?? 0; map.dragging.disable(); };
    const onContextMove = (e) => { if (!active) return; const delta = (e.clientX - startX) * 0.5; const nb = (startBearing + delta + 360) % 360; if (map.setBearing) { map.setBearing(nb); } else { const pane = map.getPanes().mapPane; const cx = map.getSize().x/2, cy = map.getSize().y/2; pane.style.transformOrigin = `${cx}px ${cy}px`; pane.style.transform = `rotate(${nb}deg)`; } setBearing(nb); };
    const onContextUp = () => { if (!active) return; active = false; map.dragging.enable(); };
    const onContextMenu = (e) => e.preventDefault();
    container.addEventListener("mousedown", onContextDown);
    window.addEventListener("mousemove", onContextMove);
    window.addEventListener("mouseup", onContextUp);
    container.addEventListener("contextmenu", onContextMenu);
    return () => { container.removeEventListener("mousedown", onContextDown); window.removeEventListener("mousemove", onContextMove); window.removeEventListener("mouseup", onContextUp); container.removeEventListener("contextmenu", onContextMenu); };
  }, [map]);

  const getAngle = (e, cx, cy) => { const clientX = e.touches?e.touches[0].clientX:e.clientX, clientY = e.touches?e.touches[0].clientY:e.clientY; const dx = clientX-cx, dy = clientY-cy; return (Math.atan2(dx,-dy)*180)/Math.PI; };

  const onRingPointerDown = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = roseRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    rotRef.current = { cx, cy, startAngle: getAngle(e,cx,cy), startBearing: map.getBearing?.()??0 };
    setRotating(true); map.dragging.disable(); map.scrollWheelZoom.disable();
  }, [map]);

  useEffect(() => {
    if (!rotating) return;
    const onMove = (e) => {
      if (!rotRef.current) return;
      const { cx, cy, startAngle, startBearing } = rotRef.current;
      const nb = ((startBearing + getAngle(e,cx,cy) - startAngle) % 360 + 360) % 360;
      setBearing(nb);
      if (map.setBearing) { map.setBearing(nb); } else { const pane = map.getPanes().mapPane; const sz = map.getSize(); pane.style.transformOrigin = `${sz.x/2}px ${sz.y/2}px`; pane.style.transform = `rotate(${nb}deg)`; }
    };
    const onUp = () => { setRotating(false); map.dragging.enable(); map.scrollWheelZoom.enable(); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive:false }); window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, [rotating, map]);

  const resetNorth = () => {
    if (map.setBearing) { map.setBearing(0, { animate:true, duration:0.5 }); } else { const pane = map.getPanes().mapPane; pane.style.transition = "transform 0.4s ease"; pane.style.transform = "rotate(0deg)"; setTimeout(() => { pane.style.transition = ""; }, 450); }
    setBearing(0);
  };

  const pan = (dx, dy) => map.panBy([dx,dy], { animate:true, duration:0.25 });
  const h = (k,v) => setHov(p=>({...p,[k]:v}));

  const btnStyle = (key) => ({ width:30, height:30, borderRadius:8, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:hov[key]?"rgba(74,158,255,0.28)":"rgba(6,14,26,0.90)", border:`1px solid ${hov[key]?"rgba(74,158,255,0.7)":"rgba(255,255,255,0.13)"}`, color:hov[key]?"#fff":"rgba(155,195,255,0.75)", backdropFilter:"blur(14px)", boxShadow:hov[key]?"0 0 10px rgba(74,158,255,0.28)":"0 2px 8px rgba(0,0,0,0.55)", transition:"all 0.15s", flexShrink:0 });
  const zBtnStyle = (key, isTop) => ({ width:30, height:30, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:hov[key]?"rgba(74,158,255,0.28)":"rgba(6,14,26,0.90)", border:`1px solid ${hov[key]?"rgba(74,158,255,0.6)":"rgba(255,255,255,0.13)"}`, borderBottom:isTop?"1px solid rgba(255,255,255,0.07)":undefined, color:hov[key]?"#fff":"rgba(155,195,255,0.82)", backdropFilter:"blur(14px)", transition:"all 0.15s", fontSize:20, fontWeight:300, lineHeight:1, borderRadius:isTop?"8px 8px 0 0":"0 0 8px 8px" });

  return (
    <div style={{ position:"absolute", top:10, right:10, zIndex:1000, display:"flex", flexDirection:"column", alignItems:"center", gap:6, userSelect:"none", pointerEvents:"all" }}>
      <div style={{ fontSize:9, color:bearing!==0?"#4a9eff":"rgba(255,255,255,0.3)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.08em", background:"rgba(6,14,26,0.75)", padding:"2px 8px", borderRadius:5, border:"1px solid rgba(255,255,255,0.07)", transition:"color 0.2s" }}>
        {bearing !== 0 ? `${Math.round((bearing+360)%360)}°` : "N 0°"}
      </div>
      <div ref={roseRef} onMouseDown={onRingPointerDown} onTouchStart={onRingPointerDown} onMouseEnter={()=>h("rose",true)} onMouseLeave={()=>h("rose",false)} title="Drag ring to rotate map • Click centre to reset North"
        style={{ width:90, height:90, position:"relative", touchAction:"none", cursor:rotating?"grabbing":"grab", filter:rotating?"drop-shadow(0 0 16px rgba(74,158,255,0.7))":hov.rose?"drop-shadow(0 0 10px rgba(74,158,255,0.45))":"drop-shadow(0 4px 18px rgba(0,0,0,0.8))", transition:rotating?"none":"filter 0.2s" }}>
        <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
          <defs>
            <radialGradient id="cBg" cx="42%" cy="36%" r="64%"><stop offset="0%" stopColor="#0e2040"/><stop offset="100%" stopColor="#050c1a"/></radialGradient>
            <radialGradient id="cFace" cx="50%" cy="44%" r="60%"><stop offset="0%" stopColor="#142e52" stopOpacity="0.95"/><stop offset="100%" stopColor="#060e1e"/></radialGradient>
            <linearGradient id="cNRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5a5a"/><stop offset="50%" stopColor="#cc1111"/><stop offset="100%" stopColor="#7a0808"/></linearGradient>
            <linearGradient id="cNSilver" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e0eeff"/><stop offset="50%" stopColor="#8aabcc"/><stop offset="100%" stopColor="#3a5a7a"/></linearGradient>
            <radialGradient id="cCap" cx="38%" cy="32%" r="68%"><stop offset="0%" stopColor="#2a70c0"/><stop offset="100%" stopColor="#0a1a2e"/></radialGradient>
            <filter id="cShadow"><feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#000" floodOpacity="0.8"/></filter>
          </defs>
          <g style={{ transform:`rotate(${-bearing}deg)`, transformOrigin:"45px 45px", transition:rotating?"none":"transform 0.12s linear" }}>
            <circle cx="45" cy="45" r="43" fill="url(#cBg)" stroke={rotating?"rgba(74,158,255,0.85)":hov.rose?"rgba(74,158,255,0.55)":"rgba(255,255,255,0.1)"} strokeWidth="1.5"/>
            {hov.rose && Array.from({length:12}).map((_,i)=>{ const a=(i*30*Math.PI)/180; return <circle key={i} cx={45+40.5*Math.sin(a)} cy={45-40.5*Math.cos(a)} r="1.2" fill="rgba(74,158,255,0.4)"/>; })}
            <circle cx="45" cy="45" r="35" fill="url(#cFace)"/>
            <circle cx="45" cy="45" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
            {Array.from({length:36}).map((_,i)=>{ const a=(i*10*Math.PI)/180,maj=i%3===0; const r1=maj?39:41,r2=maj?32:37; return <line key={i} x1={45+r1*Math.sin(a)} y1={45-r1*Math.cos(a)} x2={45+r2*Math.sin(a)} y2={45-r2*Math.cos(a)} stroke={maj?"rgba(255,255,255,0.4)":"rgba(255,255,255,0.1)"} strokeWidth={maj?1.3:0.6}/>; })}
            <text x="45" y="17" textAnchor="middle" fontSize="10" fontWeight="800" fill="#ef4444" fontFamily="'DM Mono',monospace" letterSpacing="0.04em">N</text>
            <text x="45" y="78" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="rgba(165,200,255,0.55)" fontFamily="'DM Mono',monospace">S</text>
            <text x="78" y="48.5" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="rgba(165,200,255,0.55)" fontFamily="'DM Mono',monospace">E</text>
            <text x="12" y="48.5" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="rgba(165,200,255,0.55)" fontFamily="'DM Mono',monospace">W</text>
          </g>
          <g filter="url(#cShadow)">
            <polygon points="45,13 48.5,45 45,38 41.5,45" fill="url(#cNRed)"/>
            <polygon points="45,77 48.5,45 45,52 41.5,45" fill="url(#cNSilver)"/>
          </g>
          <circle cx="45" cy="45" r="7" fill="url(#cCap)" stroke="rgba(100,160,255,0.4)" strokeWidth="1.2" style={{ cursor:"pointer" }}
            onClick={(e)=>{ e.stopPropagation(); resetNorth(); }}
            onMouseEnter={(e)=>{ e.currentTarget.setAttribute("stroke","rgba(74,158,255,0.9)"); }}
            onMouseLeave={(e)=>{ e.currentTarget.setAttribute("stroke","rgba(100,160,255,0.4)"); }}/>
          <circle cx="45" cy="45" r="3"   fill="rgba(255,255,255,0.92)" style={{ pointerEvents:"none" }}/>
          <circle cx="45" cy="45" r="1.2" fill="rgba(74,158,255,0.9)"   style={{ pointerEvents:"none" }}/>
        </svg>
        {bearing !== 0 && hov.rose && !rotating && (
          <div style={{ position:"absolute", bottom:-20, left:"50%", transform:"translateX(-50%)", fontSize:8, color:"rgba(74,158,255,0.7)", fontFamily:"'DM Mono',monospace", whiteSpace:"nowrap", pointerEvents:"none" }}>click centre → reset N</div>
        )}
      </div>
      <div style={{ display:"flex", flexDirection:"column", borderRadius:8, overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,0.5)" }}>
        <button style={zBtnStyle("zi",true)} onClick={()=>map.zoomIn()} onMouseEnter={()=>h("zi",true)} onMouseLeave={()=>h("zi",false)} title="Zoom In">+</button>
        <button style={zBtnStyle("zo",false)} onClick={()=>map.zoomOut()} onMouseEnter={()=>h("zo",true)} onMouseLeave={()=>h("zo",false)} title="Zoom Out">−</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"30px 30px 30px", gap:3 }}>
        <div/>
        <button style={btnStyle("u")} onClick={()=>pan(0,-PAN)} onMouseEnter={()=>h("u",true)} onMouseLeave={()=>h("u",false)} title="Pan North">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <div/>
        <button style={btnStyle("l")} onClick={()=>pan(-PAN,0)} onMouseEnter={()=>h("l",true)} onMouseLeave={()=>h("l",false)} title="Pan West">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ width:30, height:30, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(14,28,52,0.7)", border:"1px solid rgba(74,158,255,0.1)" }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(74,158,255,0.35)" strokeWidth="2.5"><circle cx="12" cy="12" r="4"/></svg>
        </div>
        <button style={btnStyle("r")} onClick={()=>pan(PAN,0)} onMouseEnter={()=>h("r",true)} onMouseLeave={()=>h("r",false)} title="Pan East">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div/>
        <button style={btnStyle("d")} onClick={()=>pan(0,PAN)} onMouseEnter={()=>h("d",true)} onMouseLeave={()=>h("d",false)} title="Pan South">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div/>
      </div>
    </div>
  );
}

/* ─── Geocoder ────────────────────────────────────────────────────── */
const INDIA_CITIES = {
  bhubaneswar:{lat:20.2961,lng:85.8245},cuttack:{lat:20.4625,lng:85.8828},puri:{lat:19.8135,lng:85.8312},
  kolkata:{lat:22.5726,lng:88.3639},delhi:{lat:28.6139,lng:77.2090},mumbai:{lat:19.0760,lng:72.8777},
  bangalore:{lat:12.9716,lng:77.5946},hyderabad:{lat:17.3850,lng:78.4867},chennai:{lat:13.0827,lng:80.2707},
  pune:{lat:18.5204,lng:73.8567},ahmedabad:{lat:23.0225,lng:72.5714},surat:{lat:21.1702,lng:72.8311},
  jaipur:{lat:26.9124,lng:75.7873},lucknow:{lat:26.8467,lng:80.9462},patna:{lat:25.5941,lng:85.1376},
  ranchi:{lat:23.3441,lng:85.3096},visakhapatnam:{lat:17.6868,lng:83.2185},nagpur:{lat:21.1458,lng:79.0882},
  indore:{lat:22.7196,lng:75.8577},chandigarh:{lat:30.7333,lng:76.7794},coimbatore:{lat:11.0168,lng:76.9558},
  kochi:{lat:9.9312,lng:76.2673},guwahati:{lat:26.1445,lng:91.7362},bhopal:{lat:23.2599,lng:77.4126},
  raipur:{lat:21.2514,lng:81.6296},agra:{lat:27.1767,lng:78.0081},varanasi:{lat:25.3176,lng:82.9739},
  dehradun:{lat:30.3165,lng:78.0322},
};
function extractCity(q){const lower=q.toLowerCase();for(const[city,coords]of Object.entries(INDIA_CITIES)){if(lower.includes(city))return{city,coords};}return null;}
async function geocodeForMap(q){
  const parts=q.split(",").map(s=>s.trim()).filter(Boolean);const isSingle=parts.length<=2;const cityMatch=extractCity(q);
  for(const proxy of["https://corsproxy.io/?url=","https://api.allorigins.win/raw?url="]){
    try{const params=new URLSearchParams({address:q,region:"in",language:"en"});if(cityMatch&&!isSingle){const c=cityMatch.coords;params.set("bounds",`${c.lat-0.4},${c.lng-0.4}|${c.lat+0.4},${c.lng+0.4}`);}const url=`https://maps.googleapis.com/maps/api/geocode/json?${params}`;const res=await fetch(`${proxy}${encodeURIComponent(url)}`,{signal:AbortSignal.timeout(6000)});if(!res.ok)continue;const d=await res.json();if(d.status==="OK"&&d.results?.length){const r=d.results[0];return{lat:r.geometry.location.lat,lng:r.geometry.location.lng,name:r.address_components?.[0]?.long_name||q.split(",")[0],type:r.types?.[0]||"place",display_name:r.formatted_address,bbox:r.geometry.viewport?[String(r.geometry.viewport.southwest.lat),String(r.geometry.viewport.northeast.lat),String(r.geometry.viewport.southwest.lng),String(r.geometry.viewport.northeast.lng)]:null,source:"google"};}}catch(_){continue;}
  }
  const nominatim=async(query,extra={})=>{const params=new URLSearchParams({q:query,format:"json",limit:"5",polygon_geojson:"1",addressdetails:"1","accept-language":"en",countrycodes:"in",...extra});const url=`https://nominatim.openstreetmap.org/search?${params}`;for(const px of[`https://corsproxy.io/?url=${encodeURIComponent(url)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`]){try{const res=await fetch(px,{signal:AbortSignal.timeout(5000)});if(!res.ok)continue;const data=await res.json();if(Array.isArray(data)&&data.length)return data[0];}catch(_){continue;}}return null;};
  let r=null;
  if(cityMatch&&!isSingle){const c=cityMatch.coords;r=await nominatim(q,{viewbox:`${c.lng-0.4},${c.lat+0.4},${c.lng+0.4},${c.lat-0.4}`,bounded:"1"});}
  if(!r)r=await nominatim(q);
  if(!r&&parts.length>1){for(let skip=1;skip<Math.min(parts.length,4);skip++){r=await nominatim(parts.slice(skip).join(", "));if(r)break;}}
  if(r)return{lat:parseFloat(r.lat),lng:parseFloat(r.lon),name:r.display_name?.split(",")?.[0]||q.split(",")[0],type:r.type||r.class||"place",display_name:r.display_name,bbox:r.boundingbox||null,geojson:r.geojson||null,source:"osm"};
  if(cityMatch)return{lat:cityMatch.coords.lat,lng:cityMatch.coords.lng,name:cityMatch.city.charAt(0).toUpperCase()+cityMatch.city.slice(1),type:"city",display_name:`${cityMatch.city}, India`,source:"fallback"};
  return null;
}

/* ─── Menu Definitions ────────────────────────────────────────────── */
const MENU_DEFS = {
  File:[
    {label:"Open KML…",icon:"Upload",action:"openKML"},
    {label:"Open KMZ / CSV…",icon:"CSV",action:"openExtra"},
    {divider:true},
    {label:"Export Drawings…",icon:"Export",action:"export"},
    {divider:true},
    {label:"Reset / Clear All",icon:"Reset",action:"resetAll"}
  ],
  Edit:[
    {label:"Start Drawing",icon:"Draw",action:"startDraw"},
    {label:"Cancel Drawing",icon:"Close",action:"cancelDraw"},
    {divider:true},
    {label:"Start Measuring",icon:"Measure",action:"startMeasure"},
    {label:"Stop Measuring",icon:"Stop",action:"stopMeasure"},
    {divider:true},
    {label:"Delete All Drawings",icon:"Trash",action:"deleteDrawings"}
  ],
  View:[
    {label:"Satellite",icon:"Satellite",action:"layerSatellite"},
    {label:"Street",icon:"Street",action:"layerStreet"},
    {label:"Terrain",icon:"Terrain",action:"layerTerrain"},
    {label:"Dark Mode",icon:"Dark",action:"layerDark"},
    {label:"Light Mode",icon:"Light",action:"layerLight"},
    {label:"Satellite + Labels",icon:"SatLabels",action:"layerSatLabels"},
    {divider:true},
    {label:"Switch to 3D Globe",icon:"Globe",action:"show3D"},
    {divider:true},
    {label:"Toggle Auto Night Mode",icon:"Night",action:"toggleNight"}
  ],
  Tools:[
    {label:"Draw Tool",icon:"Draw",action:"startDraw"},
    {label:"Measure Tool",icon:"Measure",action:"startMeasure"},
    {label:"Survey Tool",icon:"Survey",action:"toggleSurvey"},
    {divider:true},
    {label:"▶ Live Track Recorder",icon:"Record",action:"openTracker"},  // ← NEW
    {divider:true},
    {label:"3D Globe View",icon:"Globe",action:"show3D"}
  ],
  Add:[
    {label:"Add Marker",icon:"Pin",action:"drawMarker"},
    {label:"Add Path",icon:"Path",action:"drawPath"},
    {label:"Add Polygon",icon:"Polygon",action:"drawPoly"},
    {divider:true},
    {label:"Load KML File",icon:"Upload",action:"openKML"},
    {label:"Load KMZ / CSV",icon:"CSV",action:"openExtra"}
  ],
  Help:[
    {label:"About SurveyMap Pro",icon:"Info",action:"about"},
    {label:"Keyboard Shortcuts",icon:"Keyboard",action:"shortcuts"},
    {divider:true},
    {label:"OpenStreetMap ↗",icon:"Link",action:"osmLink"},
    {label:"Leaflet Docs ↗",icon:"Link",action:"leafletLink"}
  ],
};

/* ─── UI Components ───────────────────────────────────────────────── */
function GlassPanel({ children, style={}, className="" }) {
  return (
    <div className={`glass-panel ${className}`} style={{ background:"rgba(8,20,35,0.72)", backdropFilter:"blur(20px) saturate(180%)", WebkitBackdropFilter:"blur(20px) saturate(180%)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, ...style }}>
      {children}
    </div>
  );
}

function SectionHeader({ icon, title, collapsed, onToggle }) {
  return (
    <button onClick={onToggle} style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"10px 14px", background:"transparent", border:"none", borderBottom:`1px solid ${collapsed?"transparent":"rgba(255,255,255,0.06)"}`, cursor:"pointer", userSelect:"none" }}>
      <span style={{ color:"#4a9eff", display:"flex", opacity:0.9 }}><Ico name={icon} size={14}/></span>
      <span style={{ color:"#f5f5f5", fontSize:10.5, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", flex:1, textAlign:"left", fontFamily:"'DM Sans',sans-serif" }}>{title}</span>
      <span style={{ color:"rgba(255,255,255,0.35)", display:"flex", transition:"transform 0.2s", transform:collapsed?"rotate(-90deg)":"rotate(0deg)" }}><Ico name="ChevronDown" size={12}/></span>
    </button>
  );
}

function LayerItem({ iconName, label, active, checked, onCheck, onClick, indent=0, badge=null }) {
  return (
    <div onClick={onClick} style={{ display:"flex", alignItems:"center", gap:8, padding:`6px 12px 6px ${12+indent*14}px`, cursor:"pointer", borderRadius:6, margin:"1px 6px", background:active?"rgba(74,158,255,0.15)":"transparent", borderLeft:active?"2px solid #4a9eff":"2px solid transparent", transition:"all 0.15s" }}
      onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
      onMouseLeave={e=>{ e.currentTarget.style.background=active?"rgba(74,158,255,0.15)":"transparent"; }}>
      {checked !== undefined && (
        <span onClick={e=>{e.stopPropagation();onCheck?.();}} style={{ width:16, height:16, borderRadius:4, flexShrink:0, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:checked?"#4a9eff":"rgba(255,255,255,0.08)", border:`1px solid ${checked?"#4a9eff":"rgba(255,255,255,0.2)"}` }}>
          {checked && <Ico name="Check" size={10} style={{ color:"#fff" }}/>}
        </span>
      )}
      <span style={{ color:active?"#80bfff":"rgba(255,255,255,0.5)", display:"flex" }}><Ico name={iconName} size={13}/></span>
      <span style={{ color:active?"#d0e8ff":"rgba(255,255,255,0.7)", fontSize:11.5, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontFamily:"'DM Sans',sans-serif", fontWeight:active?500:400 }}>{label}</span>
      {badge && <span style={{ fontSize:8.5, padding:"2px 7px", borderRadius:20, background:"rgba(74,158,255,0.2)", color:"#80bfff", fontWeight:700, letterSpacing:"0.05em" }}>{badge}</span>}
    </div>
  );
}

function ToolButton({ iconName, label, active, onClick, color="#4a9eff", style={} }) {
  return (
    <button onClick={onClick} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"10px 6px", borderRadius:8, cursor:"pointer", minWidth:52, background:active?`rgba(${color==="amber"?"250,174,48":"74,158,255"},0.18)`:"rgba(255,255,255,0.04)", border:`1px solid ${active?(color==="amber"?"rgba(250,174,48,0.5)":"rgba(74,158,255,0.45)"):"rgba(255,255,255,0.08)"}`, color:active?(color==="amber"?"#faae30":"#4a9eff"):"rgba(255,255,255,0.6)", transition:"all 0.2s", boxShadow:active?"0 0 16px rgba(74,158,255,0.2)":"none", ...style }}
      onMouseEnter={e=>{ if(!active){e.currentTarget.style.background="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(255,255,255,0.9)";} }}
      onMouseLeave={e=>{ if(!active){e.currentTarget.style.background="rgba(255,255,255,0.04)";e.currentTarget.style.color="rgba(255,255,255,0.6)";} }}>
      <Ico name={iconName} size={18}/>
      <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.04em", fontFamily:"'DM Sans',sans-serif", textTransform:"uppercase" }}>{label}</span>
    </button>
  );
}

function PrimaryButton({ children, onClick, style={}, disabled=false, variant="blue" }) {
  const colors = {
    blue:   { bg:"rgba(74,158,255,0.2)",   border:"rgba(74,158,255,0.45)",   color:"#80c0ff",  hoverBg:"rgba(74,158,255,0.3)" },
    green:  { bg:"rgba(52,211,153,0.15)",  border:"rgba(52,211,153,0.4)",   color:"#34d399",  hoverBg:"rgba(52,211,153,0.25)" },
    red:    { bg:"rgba(248,113,113,0.15)", border:"rgba(248,113,113,0.35)", color:"#f87171",  hoverBg:"rgba(248,113,113,0.25)" },
    amber:  { bg:"rgba(251,191,36,0.15)",  border:"rgba(251,191,36,0.35)",  color:"#fbbf24",  hoverBg:"rgba(251,191,36,0.25)" },
    purple: { bg:"rgba(167,139,250,0.15)", border:"rgba(167,139,250,0.35)", color:"#a78bfa",  hoverBg:"rgba(167,139,250,0.25)" },
    rose:   { bg:"rgba(239,68,68,0.15)",   border:"rgba(239,68,68,0.45)",   color:"#f87171",  hoverBg:"rgba(239,68,68,0.3)" },
  };
  const c = colors[variant] || colors.blue;
  return (
    <button onClick={onClick} disabled={disabled} style={{ width:"100%", padding:"9px 14px", borderRadius:8, cursor:disabled?"not-allowed":"pointer", background:c.bg, border:`1px solid ${c.border}`, color:c.color, fontWeight:600, fontSize:12, fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:7, transition:"all 0.2s", opacity:disabled?0.5:1, ...style }}
      onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.background=c.hoverBg; }}
      onMouseLeave={e=>{ if(!disabled) e.currentTarget.style.background=c.bg; }}>
      {children}
    </button>
  );
}

/* ─── Main Component ─────────────────────────────────────────────── */
export default function SurveyMap() {
  const polylineRef=useRef(null),previewLayerRef=useRef(null),drawLayersRef=useRef([]);
  const [extraFile,setExtraFile]=useState(null),[extraFileType,setExtraFileType]=useState(null);
  const [boundaryGeojson,setBoundaryGeojson]=useState(null);
  const [surveyMode,setSurveyMode]=useState(false),[route,setRoute]=useState([]);
  const [_start,setStart]=useState(null),[_end,setEnd]=useState(null);
  const [kmlFile,setKmlFile]=useState(null),[kmlLoading,setKmlLoading]=useState(false),[kmlName,setKmlName]=useState(null);
  const [activeLayer,setActiveLayer]=useState("Satellite");
  const [locationInfo,setLocationInfo]=useState(null);
  const [drawMode,setDrawMode]=useState(false),[drawType,setDrawType]=useState("path"),[drawPoints,setDrawPoints]=useState([]);
  const [savedDrawings,setSavedDrawings]=useState([]);
  const [showNameModal,setShowNameModal]=useState(false),[pendingName,setPendingName]=useState("");
  const [pendingPoints,setPendingPoints]=useState([]),[pendingType,setPendingType]=useState("path");
  const [measureMode,setMeasureMode]=useState(false),[measurePoints,setMeasurePoints]=useState([]),[measureUnit,setMeasureUnit]=useState("auto");
  const measureLayersRef=useRef([]),measureLineRef=useRef(null);
  const [mousePos,setMousePos]=useState(null),[mapZoom,setMapZoom]=useState(13);
  const [nightModeAuto,setNightModeAuto]=useState(false),[nightSwitchInfo,setNightSwitchInfo]=useState(null);
  const [show3D,setShow3D]=useState(false);
  const [searchOpen,setSearchOpen]=useState(true),[placesOpen,setPlacesOpen]=useState(true);
  const [layersOpen,setLayersOpen]=useState(true),[toolsOpen,setToolsOpen]=useState(true);
  const kmlInputRef=useRef(null),extraInputRef=useRef(null);
  const [openMenu,setOpenMenu]=useState(null);
  const [showAbout,setShowAbout]=useState(false),[showShortcuts,setShowShortcuts]=useState(false);
  const menuBarRef=useRef(null);
  const [searchQuery,setSearchQuery]=useState(""),[searchLoading,setSearchLoading]=useState(false);
  const searchFnRef=useRef(null);
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [mobileTab,setMobileTab]=useState("layers");
  const [flyTarget,setFlyTarget]=useState(null);

  // ── NEW: Live Track Recorder state ──────────────────────────────────
  const [trackerOpen, setTrackerOpen]         = useState(false);
  const [isTracking, setIsTracking]           = useState(false);
  const [mapRefForTracker, setMapRefForTracker] = useState(null);
  // We need to pass the Leaflet map instance to the recorder.
  // This is achieved via a MapRef bridge component inside MapContainer.
  const leafletMapRef = useRef(null);

  useNightModeAutoSwitch({enabled:nightModeAuto,activeLayer,setActiveLayer,nightLayer:"Dark",dayLayer:"Satellite + Labels",onSwitch:({isNight})=>setNightSwitchInfo({isNight})});
  const onKmlDone=useCallback(()=>setKmlLoading(false),[]);
  const onMouseMove=useCallback(p=>setMousePos(p),[]);
  const onZoomChange=useCallback(z=>setMapZoom(z),[]);

  async function handleSidebarSearch(e) {
    e?.preventDefault();
    const q=searchQuery.trim();if(!q)return;
    setSearchLoading(true);
    try {
      const coordRx=/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/;
      const coordMatch=q.match(coordRx);
      if(coordMatch){const lat=parseFloat(coordMatch[1]),lng=parseFloat(coordMatch[2]);if(!isNaN(lat)&&!isNaN(lng)){setFlyTarget({lat,lng,zoom:16,_ts:Date.now()});setLocationInfo({lat,lng,name:`${lat.toFixed(5)}, ${lng.toFixed(5)}`,details:"Coordinates",loading:false});return;}}
      const result=await geocodeForMap(q);
      if(!result){alert(`"${q}" — location not found.`);return;}
      const zoom=zoomForType(result.type);
      setFlyTarget({lat:result.lat,lng:result.lng,zoom,bbox:result.bbox,_ts:Date.now()});
      setLocationInfo({lat:result.lat,lng:result.lng,name:result.name,details:result.display_name,loading:false,description:null,wikiUrl:null,photo:null});
      if(result.geojson)setBoundaryGeojson(result.geojson);
      if(searchFnRef.current){try{await searchFnRef.current(q);}catch(_){}}
      try{const wr=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(result.name)}`,{signal:AbortSignal.timeout(5000)});if(wr.ok){const w=await wr.json();if(w.type!=="disambiguation"&&w.extract?.length>30){setLocationInfo(prev=>prev?{...prev,description:w.extract,wikiUrl:w.content_urls?.desktop?.page,photo:w.thumbnail?.source||null}:null);}}}catch(_){}
    } finally { setSearchLoading(false); }
  }

  function clearMeasure(){measureLayersRef.current.forEach(l=>l.remove());measureLayersRef.current=[];if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}if(measureLineRef._preview){measureLineRef._preview.remove();measureLineRef._preview=null;}setMeasurePoints([]);setMeasureMode(false);}
  function handleExtraUpload(e){const file=e.target.files[0];if(!file)return;const ext=file.name.split(".").pop().toLowerCase();if(ext!=="kmz"&&ext!=="csv"){alert("Please upload a KMZ or CSV file.");e.target.value="";return;}setExtraFile(file);setExtraFileType(ext);e.target.value="";}
  const totalDistance=measurePoints.length>=2?measurePoints.reduce((sum,p,i)=>i===0?0:sum+haversine(measurePoints[i-1],p),0):0;
  function handleKMLUpload(e){const file=e.target.files[0];if(!file)return;setKmlLoading(true);setKmlName(file.name);setKmlFile(file);e.target.value="";}
  function handleToggleSurvey(){if(surveyMode){setRoute([]);setStart(null);setEnd(null);if(polylineRef.current){polylineRef.current.remove();polylineRef.current=null;}}setSurveyMode(p=>!p);}
  async function reverseGeocode(lat,lng){try{const res=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,{headers:{"Accept-Language":"en"},signal:AbortSignal.timeout(6000)});if(!res.ok)return null;return await res.json();}catch{return null;}}

  const handleLocationFound=useCallback(async({lat,lng,label,raw})=>{
    setLocationInfo({lat,lng,label,loading:true,photo:null,description:null});
    setFlyTarget({lat,lng,zoom:15,_ts:Date.now()});
    const isRawCoord=raw&&!raw.display_name;
    if(isRawCoord){
      setBoundaryGeojson(null);
      setLocationInfo({lat,lng,label,name:`${lat.toFixed(5)}, ${lng.toFixed(5)}`,description:null,wikiUrl:null,photo:null,details:null,plusCode:toPlusCode(lat,lng),loading:true});
      const place=await reverseGeocode(lat,lng);
      if(place){const addr=place.address||{};const city=addr.city||addr.town||addr.village||addr.suburb||addr.county||"";const details=[city,addr.state,addr.country].filter(Boolean).join(", ");const locationName=addr.neighbourhood||addr.suburb||addr.quarter||addr.road||city||addr.state||`${lat.toFixed(4)}, ${lng.toFixed(4)}`;setLocationInfo({lat,lng,label,name:locationName,details,description:null,wikiUrl:null,photo:null,plusCode:toPlusCode(lat,lng),fullAddress:place.display_name,loading:false});}
      else setLocationInfo({lat,lng,label,name:`${lat.toFixed(5)}, ${lng.toFixed(5)}`,details:null,description:null,wikiUrl:null,photo:null,plusCode:toPlusCode(lat,lng),loading:false});
      return;
    }
    try{
      let boundaryGeoJson=null,place=null;
      const searchName=label.split(",")[0].trim();
      const nomUrl=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchName)}&format=json&limit=5&polygon_geojson=1&addressdetails=1&namedetails=1&extratags=1`;
      const proxies=[`https://corsproxy.io/?url=${encodeURIComponent(nomUrl)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(nomUrl)}`];
      for(const px of proxies){try{const res=await fetch(px,{signal:AbortSignal.timeout(6000)});if(!res.ok)continue;const data=await res.json();if(!Array.isArray(data)||!data.length)continue;place=data.find(r=>r.geojson?.type==="MultiPolygon")||data.find(r=>r.geojson?.type==="Polygon")||data[0];boundaryGeoJson=place?.geojson||null;if(boundaryGeoJson)break;}catch(e){console.warn("Proxy:",e.message);}}
      setBoundaryGeojson(boundaryGeoJson);
      let description=null,wikiUrl=null,photo=null;
      const placeName=place?.namedetails?.name||place?.display_name?.split(",")?.[0]||searchName;
      try{const wr=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(placeName)}`);if(wr.ok){const w=await wr.json();description=w.extract;wikiUrl=w.content_urls?.desktop?.page;photo=w.thumbnail?.source||null;}}catch(e){console.warn("Wiki:",e.message);}
      const addr=place?.address||{};const details=[addr.city||addr.town||addr.village,addr.state,addr.country].filter(Boolean).join(", ");
      setLocationInfo({lat,lng,label,name:placeName,description,wikiUrl,photo,details,loading:false});
    }catch{setLocationInfo(p=>({...p,loading:false,description:"Could not load info."}));}
  },[]);

  const handleCloseLocationInfo=useCallback(()=>{setLocationInfo(null);setBoundaryGeojson(null);},[]);

  function finishDrawing(){if(!drawPoints.length)return;setPendingPoints(drawPoints);setPendingType(drawType);setPendingName("");setShowNameModal(true);}
  function confirmDrawing(){
    const name=pendingName.trim()||(pendingType==="marker"?"Marker":pendingType==="path"?"Path":"Polygon");
    setSavedDrawings(p=>[...p,{name,type:pendingType,points:pendingPoints}]);
    setDrawPoints([]);
    if(previewLayerRef.current){previewLayerRef.current.remove();previewLayerRef.current=null;}
    drawLayersRef.current.forEach(l=>l.remove());drawLayersRef.current=[];
    setShowNameModal(false);setDrawMode(false);
  }
  function cancelDrawing(){setDrawPoints([]);if(previewLayerRef.current){previewLayerRef.current.remove();previewLayerRef.current=null;}drawLayersRef.current.forEach(l=>l.remove());drawLayersRef.current=[];setShowNameModal(false);setDrawMode(false);}

  function handleMenuAction(action){
    setOpenMenu(null);
    switch(action){
      case "openKML":    kmlInputRef.current?.click(); break;
      case "openExtra":  extraInputRef.current?.click(); break;
      case "export":     document.querySelector("[data-export-btn]")?.click(); break;
      case "resetAll":   if(window.confirm("Reset everything?")){setSavedDrawings([]);cancelDrawing();clearMeasure();setRoute([]);setSurveyMode(false);} break;
      case "startDraw":  setDrawMode(true);setDrawPoints([]); break;
      case "cancelDraw": cancelDrawing(); break;
      case "startMeasure": setMeasureMode(true); break;
      case "stopMeasure":  clearMeasure(); break;
      case "deleteDrawings": if(savedDrawings.length===0){alert("No drawings.");return;}if(window.confirm(`Delete ${savedDrawings.length} drawing(s)?`))setSavedDrawings([]); break;
      case "layerSatellite": setActiveLayer("Satellite"); break;
      case "layerStreet":    setActiveLayer("Street"); break;
      case "layerTerrain":   setActiveLayer("Terrain"); break;
      case "layerDark":      setActiveLayer("Dark"); break;
      case "layerLight":     setActiveLayer("Light"); break;
      case "layerSatLabels": setActiveLayer("Satellite + Labels"); break;
      case "show3D":         setShow3D(true); break;
      case "toggleNight":    setNightModeAuto(p=>!p); break;
      case "drawMarker":     setDrawMode(true);setDrawType("marker");setDrawPoints([]); break;
      case "drawPath":       setDrawMode(true);setDrawType("path");setDrawPoints([]); break;
      case "drawPoly":       setDrawMode(true);setDrawType("polygon");setDrawPoints([]); break;
      case "toggleSurvey":   handleToggleSurvey(); break;
      case "openTracker":    setTrackerOpen(true); break;  // ← NEW
      case "about":          setShowAbout(true); break;
      case "shortcuts":      setShowShortcuts(true); break;
      case "osmLink":        window.open("https://www.openstreetmap.org","_blank"); break;
      case "leafletLink":    window.open("https://leafletjs.com/reference.html","_blank"); break;
    }
  }

  // Bridge component: captures Leaflet map instance so LiveTrackRecorder can use it
  function MapRefCapture() {
    const map = useMap();
    useEffect(() => {
      leafletMapRef.current = map;
      setMapRefForTracker(map);
    }, [map]);
    return null;
  }

  const cfg = MAP_LAYERS[activeLayer];
  if (show3D) return <Globe3DView savedDrawings={savedDrawings} onClose={()=>setShow3D(false)}/>;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}
        *,*::before,*::after{box-sizing:border-box;}
        body{font-family:'DM Sans',sans-serif;background:#060e1a;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:rgba(74,158,255,0.25);border-radius:4px;}
        ::-webkit-scrollbar-thumb:hover{background:rgba(74,158,255,0.45);}

        .sm-layout{--menu-h:32px;--tb-h:52px;--top-h:84px;--sb-w:268px;--stat-h:28px;}
        @media(max-width:640px){
          .sm-layout{--menu-h:0px;--tb-h:56px;--top-h:56px;--sb-w:0px;--stat-h:24px;}
          .sm-menubar{display:none !important;}
          .sm-sidebar{transform:translateX(-100%);transition:transform 0.3s cubic-bezier(.4,0,.2,1);}
          .sm-sidebar.open{transform:translateX(0) !important;z-index:1300 !important;}
          .sm-map-wrap{left:0 !important;}
          .sm-mobile-fab{display:flex !important;}
          .sm-mobile-sheet{display:flex !important;}
          .sm-desktop-tools{display:none !important;}
          .sm-loc-card{width:calc(100vw - 16px) !important;right:8px !important;left:8px !important;}
        }
        @media(min-width:641px){
          .sm-mobile-fab{display:none !important;}
          .sm-mobile-sheet{display:none !important;}
        }

        .menu-item{display:flex;align-items:center;gap:9px;padding:8px 16px;font-size:12.5px;color:rgba(200,225,255,0.85);cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:400;transition:all 0.15s;white-space:nowrap;}
        .menu-item:hover{background:rgba(74,158,255,0.15);color:#fff;}
        .menu-item svg{width:13px;height:13px;flex-shrink:0;opacity:0.7;}

        .tb-btn{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;font-family:'DM Sans',sans-serif;border:1px solid rgba(255,255,255,0.08);transition:all 0.2s;white-space:nowrap;flex-shrink:0;}
        .tb-btn:hover{filter:brightness(1.15);}
        .tb-btn.active{background:rgba(74,158,255,0.2);border-color:rgba(74,158,255,0.5);color:#80c4ff;box-shadow:0 0 18px rgb(240,240,240);}
        .tb-btn.inactive{background:rgba(255,255,255,0.06);color:rgb(255,255,255);}
        .tb-btn.inactive:hover{background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.9);}
        .tb-btn.tracker-active{background:rgba(239,68,68,0.2);border-color:rgba(239,68,68,0.6);color:#f87171;box-shadow:0 0 18px rgba(239,68,68,0.3);}

        .glass-panel{background:rgba(8,20,35,0.72);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid rgba(255,255,255,0.08);}

        @keyframes fadeSlideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes pulse{0%,100%{opacity:0.6}50%{opacity:1}}
        @keyframes glow{0%,100%{box-shadow:0 0 8px rgba(74,158,255,0.3)}50%{box-shadow:0 0 20px rgba(74,158,255,0.6)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes rec-pulse{0%,100%{transform:scale(1);box-shadow:0 0 0 rgba(239,68,68,0.4)}50%{transform:scale(1.05);box-shadow:0 0 12px rgba(239,68,68,0.7)}}

        .leaflet-control-zoom a{background:rgba(8,20,35,0.85)!important;backdrop-filter:blur(12px)!important;color:#80c0ff!important;border:1px solid rgba(74,158,255,0.25)!important;font-size:16px!important;width:32px!important;height:32px!important;line-height:30px!important;}
        .leaflet-control-zoom a:hover{background:rgba(74,158,255,0.25)!important;color:#fff!important;}
        .leaflet-control-attribution{background:rgba(8,20,35,0.7)!important;backdrop-filter:blur(8px)!important;color:rgba(255,255,255,0.4)!important;font-size:9px!important;padding:2px 8px!important;border-radius:4px 0 0 0!important;border:1px solid rgba(255,255,255,0.06)!important;}
        .leaflet-control-attribution a{color:rgba(74,158,255,0.7)!important;}
      `}</style>

      <div className="sm-layout" style={{ position:"relative", width:"100%", height:"100%", background:"#060e1a" }}>

        {/* ─── MENU BAR ─────────────────────────────────────────────────── */}
        <div className="sm-menubar" ref={menuBarRef} style={{ position:"absolute", top:0, left:0, right:0, height:"var(--menu-h)", zIndex:1200, background:"rgba(6,14,26,0.95)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", paddingLeft:12, gap:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:16, paddingRight:16, borderRight:"1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ width:20, height:20, borderRadius:5, background:"linear-gradient(135deg,#4a9eff,#2563eb)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Ico name="Compass" size={12} style={{ color:"#fff" }}/>
            </div>
            <span style={{ fontSize:12, fontWeight:700, color:"#c8e0f8", letterSpacing:"0.02em", fontFamily:"'DM Sans',sans-serif" }}>SurveyMap Pro</span>
          </div>

          {Object.keys(MENU_DEFS).map(menuName => {
            const isOpen = openMenu === menuName;
            return (
              <div key={menuName} style={{ position:"relative", height:"100%", display:"flex", alignItems:"center" }}>
                <span onClick={()=>setOpenMenu(isOpen?null:menuName)} onMouseEnter={()=>{ if(openMenu&&openMenu!==menuName) setOpenMenu(menuName); }}
                  style={{ fontSize:12, color:isOpen?"#80c4ff":"rgb(241,237,235)", padding:"0 12px", cursor:"pointer", userSelect:"none", height:"100%", display:"flex", alignItems:"center", background:isOpen?"rgba(74,158,255,0.15)":"transparent", fontWeight:isOpen?500:400, fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s" }}>
                  {menuName}
                </span>
                {isOpen && (
                  <div style={{ position:"absolute", top:"var(--menu-h)", left:0, background:"rgba(6,14,26,0.97)", backdropFilter:"blur(24px)", border:"1px solid rgba(255,255,255,0.1)", borderTop:"1.5px solid rgba(74,158,255,0.5)", borderRadius:"0 0 10px 10px", minWidth:210, boxShadow:"0 12px 40px rgba(0,0,0,0.6)", zIndex:1300, overflow:"hidden" }}>
                    {MENU_DEFS[menuName].map((item,idx) =>
                      item.divider
                        ? <div key={idx} style={{ height:1, background:"rgba(255,255,255,0.06)", margin:"3px 0" }}/>
                        : <div key={idx} className="menu-item" onClick={()=>handleMenuAction(item.action)}>
                            <Ico name={item.icon} size={13}/>{item.label}
                          </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {openMenu && <div style={{ position:"fixed", inset:0, zIndex:1290 }} onClick={()=>setOpenMenu(null)}/>}

          <div style={{ flex:1 }}/>

          {/* Live tracker status indicator in menu bar */}
          {isTracking && (
            <div style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 10px", background:"rgba(239,68,68,0.15)", borderRadius:16, border:"1px solid rgba(239,68,68,0.35)", marginRight:8, cursor:"pointer" }} onClick={()=>setTrackerOpen(true)}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:"#ef4444", animation:"blink 1s infinite" }}/>
              <span style={{ fontSize:10, color:"#f87171", fontWeight:700, fontFamily:"'DM Mono',monospace", letterSpacing:"0.05em" }}>REC</span>
            </div>
          )}

          <button style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:6, border:"1px solid rgba(74,158,255,0.3)", background:"rgba(74,158,255,0.12)", color:"#80c4ff", cursor:"pointer", fontSize:11, fontWeight:600, marginRight:10, fontFamily:"'DM Sans',sans-serif" }}>
            <Ico name="User" size={12}/> Sign In
          </button>
        </div>

        <input ref={kmlInputRef} type="file" accept=".kml" onChange={handleKMLUpload} style={{ display:"none" }}/>
        <input ref={extraInputRef} type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{ display:"none" }}/>

        {/* ─── TOOLBAR ──────────────────────────────────────────────────── */}
        <div style={{ position:"absolute", top:"var(--menu-h)", left:0, right:0, height:"var(--tb-h)", zIndex:1150, background:"rgba(6,14,26,0.88)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgb(255,255,255)", display:"flex", alignItems:"center", padding:"0 10px", gap:5, overflowX:"auto" }}>
          {/* Mobile menu button */}
          <button className="tb-btn inactive sm-mobile-fab" onClick={()=>setSidebarOpen(p=>!p)} style={{ display:"none", width:40, height:40, borderRadius:8, padding:0, alignItems:"center", justifyContent:"center" }}>
            <Ico name="Menu" size={18}/>
          </button>

          {/* Layer quick-select */}
          {[{key:"Satellite",icon:"Satellite",short:"Satellite"},{key:"Street",icon:"Street",short:"Street"},{key:"Terrain",icon:"Terrain",short:"Terrain"},{key:"Satellite + Labels",icon:"SatLabels",short:"+Labels"},{key:"Dark",icon:"Dark",short:"Dark"},{key:"Light",icon:"Light",short:"Light"}].map(({key,icon,short}) => (
            <button key={key} className={`tb-btn ${activeLayer===key?"active":"inactive"}`} onClick={()=>setActiveLayer(key)}>
              <Ico name={icon} size={14}/><span>{short}</span>
            </button>
          ))}

          <div style={{ width:1, height:22, background:"rgba(255,255,255,0.08)", margin:"0 3px", flexShrink:0 }}/>

          <ToolButton iconName="Draw" label="Draw" active={drawMode} onClick={()=>{setDrawMode(m=>!m);if(!drawMode)setDrawPoints([]);}} style={{ minWidth:44, padding:"6px 8px" }}/>
          <ToolButton iconName="Measure" label="Measure" active={measureMode} onClick={()=>setMeasureMode(m=>!m)} style={{ minWidth:56, padding:"6px 8px" }}/>
          <ToolButton iconName="Survey" label="Survey" active={surveyMode} onClick={handleToggleSurvey} style={{ minWidth:50, padding:"6px 8px" }}/>

          <div style={{ width:1, height:22, background:"rgba(255,255,255,0.08)", margin:"0 3px", flexShrink:0 }}/>

          {/* ── LIVE TRACK RECORDER BUTTON ── */}
          <button
            className={`tb-btn ${isTracking?"tracker-active":"inactive"}`}
            onClick={()=>setTrackerOpen(p=>!p)}
            title="Live Track Recorder"
            style={{ position:"relative", minWidth:58 }}
          >
            <Ico name="Record" size={14}/>
            <span>Track</span>
            {isTracking && <span style={{ position:"absolute", top:4, right:4, width:6, height:6, borderRadius:"50%", background:"#ef4444", animation:"blink 1s infinite" }}/>}
          </button>

          <div style={{ width:1, height:22, background:"rgba(255,255,255,0.08)", margin:"0 3px", flexShrink:0 }}/>

          <label className="tb-btn inactive" style={{ cursor:"pointer" }}>
            <Ico name="Upload" size={14}/><span>KML</span>
            <input type="file" accept=".kml" onChange={handleKMLUpload} style={{ display:"none" }}/>
          </label>
          <label className="tb-btn inactive" style={{ cursor:"pointer" }}>
            <Ico name="CSV" size={14}/><span>CSV/KMZ</span>
            <input type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{ display:"none" }}/>
          </label>

          <div style={{ width:1, height:22, background:"rgba(255,255,255,0.08)", margin:"0 3px", flexShrink:0 }}/>

          <button className="tb-btn" onClick={()=>setShow3D(true)} style={{ background:"rgba(167,139,250,0.15)", borderColor:"rgba(167,139,250,0.4)", color:"#c4b5fd" }}>
            <Ico name="Globe" size={14}/><span>3D Globe</span>
          </button>

          <button className={`tb-btn ${nightModeAuto?"active":"inactive"}`} onClick={()=>setNightModeAuto(p=>!p)} title="Auto Night Mode">
            <Ico name={nightSwitchInfo?.isNight?"Night":"Day"} size={14}/><span>Night</span>
          </button>

          <div style={{ flex:1 }}/>

          {kmlLoading && (
            <span style={{ fontSize:11, color:"#60a0e8", background:"rgba(74,158,255,0.12)", padding:"4px 10px", borderRadius:16, border:"1px solid rgba(74,158,255,0.25)", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ animation:"blink 1s infinite" }}>●</span> {kmlName?.slice(0,18)}…
            </span>
          )}
          {kmlName && !kmlLoading && (
            <span style={{ fontSize:11, color:"#4a9eff", background:"rgba(74,158,255,0.1)", padding:"4px 10px", borderRadius:16, border:"1px solid rgba(74,158,255,0.2)", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
              <Ico name="File" size={11}/> {kmlName?.slice(0,18)}
            </span>
          )}
        </div>

        {/* ─── MAP AREA ─────────────────────────────────────────────────── */}
        <div className="sm-map-wrap" style={{ position:"absolute", top:"var(--top-h)", left:"var(--sb-w)", right:0, bottom:"var(--stat-h)", zIndex:1 }}>
          <MapContainer center={[20.29,85.82]} zoom={13} zoomControl={false} style={{ width:"100%", height:"100%" }}>
            {cfg.type==="wms"
              ? <WMSTileLayer key={activeLayer} url={cfg.url} layers={cfg.layers} format={cfg.format||"image/png"} transparent={cfg.transparent??true} attribution={cfg.attribution} crossOrigin/>
              : <>
                  <TileLayer key={activeLayer} url={cfg.url} attribution={cfg.attribution} maxZoom={19} crossOrigin/>
                  {cfg.overlayUrl && <TileLayer url={cfg.overlayUrl} maxZoom={19} crossOrigin/>}
                </>
            }
            <MapRefCapture/>
            <MapFlyController flyTarget={flyTarget}/>
            <AddSearch onLocationFound={handleLocationFound} searchRef={searchFnRef}/>
            <LiveGPS/>
            <KMLLoader file={kmlFile} onDone={onKmlDone}/>
            {extraFileType==="kmz" && <KMZLoader file={extraFile} onDone={()=>{}}/>}
            {extraFileType==="csv" && <CSVLoader file={extraFile} onDone={()=>{}}/>}
            <SurveyClick surveyMode={surveyMode} route={route} setRoute={setRoute} setStart={setStart} setEnd={setEnd} polylineRef={polylineRef}/>
            <DrawTool drawMode={drawMode} drawType={drawType} drawPoints={drawPoints} setDrawPoints={setDrawPoints} previewLayerRef={previewLayerRef} drawLayersRef={drawLayersRef}/>
            <BoundaryLayer geojson={boundaryGeojson}/>
            <MapTracker onMove={onMouseMove} onZoom={onZoomChange}/>
            <MeasureTool measureMode={measureMode} measurePoints={measurePoints} setMeasurePoints={setMeasurePoints} measureLayersRef={measureLayersRef} measureLineRef={measureLineRef} measureUnit={measureUnit}/>
            <ProfessionalCompassControl/>
          </MapContainer>
        </div>

        {/* ─── LIVE TRACK RECORDER PANEL ────────────────────────────────── */}
        {/* Rendered outside MapContainer so it overlays the whole screen */}
        <LiveTrackRecorder
          map={mapRefForTracker}
          visible={trackerOpen}
          onClose={()=>setTrackerOpen(false)}
          onRecordingChange={(recording)=>setIsTracking(recording)}
        />

        {/* ─── SIDEBAR ──────────────────────────────────────────────────── */}
        {sidebarOpen && <div onClick={()=>setSidebarOpen(false)} style={{ position:"fixed", inset:0, zIndex:1250, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)" }}/>}
        <div className={`sm-sidebar glass-panel${sidebarOpen?" open":""}`}
          style={{ position:"absolute", top:"var(--top-h)", left:0, bottom:"var(--stat-h)", width:268, zIndex:1100, display:"flex", flexDirection:"column", overflowY:"hidden", borderRadius:0, borderTop:"none", borderBottom:"none", borderLeft:"none", boxShadow:"4px 0 30px rgba(0,0,0,0.5)" }}>

          {/* Mobile close */}
          <button className="sm-mobile-fab" onClick={()=>setSidebarOpen(false)} style={{ display:"none", position:"absolute", top:10, right:10, width:28, height:28, borderRadius:"50%", border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.6)", cursor:"pointer", fontSize:14, zIndex:10, alignItems:"center", justifyContent:"center" }}>
            <Ico name="Close" size={12}/>
          </button>

          {/* ── SEARCH ── */}
          <SectionHeader icon="Search" title="Search Location" collapsed={!searchOpen} onToggle={()=>setSearchOpen(p=>!p)}/>
          {searchOpen && (
            <div style={{ padding:"12px 12px 10px", borderBottom:"1px solid rgba(255,255,255,0.05)", flexShrink:0 }}>
              <form onSubmit={handleSidebarSearch} style={{ display:"flex", gap:6, marginBottom:8 }}>
                <div style={{ flex:1, position:"relative" }}>
                  <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:"rgba(255,255,255,0.3)", pointerEvents:"none", display:"flex" }}><Ico name="Search" size={13}/></span>
                  <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Search location or lat, lng…"
                    style={{ width:"100%", padding:"8px 10px 8px 30px", borderRadius:8, border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.06)", color:"#c8dff0", fontSize:11.5, outline:"none", fontFamily:"'DM Sans',sans-serif", transition:"border 0.2s" }}
                    onFocus={e=>{e.target.style.borderColor="rgba(74,158,255,0.4)";}}
                    onBlur={e=>{e.target.style.borderColor="rgba(255,255,255,0.1)";}}/>
                </div>
                <button type="submit" disabled={searchLoading} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid rgba(74,158,255,0.4)", background:"rgba(74,158,255,0.18)", color:"#80c4ff", cursor:searchLoading?"not-allowed":"pointer", fontSize:13, fontWeight:700, flexShrink:0 }}>
                  {searchLoading ? <span style={{ animation:"blink 0.8s infinite" }}>…</span> : "↵"}
                </button>
              </form>
              <div style={{ display:"flex", gap:5 }}>
                {[["Directions","Directions"],["History","History"]].map(([icon,label]) => (
                  <button key={label} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:5, padding:"6px 8px", borderRadius:6, border:"1px solid rgba(255,255,255,0.08)", background:"rgba(255,255,255,0.04)", color:"rgba(200,225,255,0.6)", cursor:"pointer", fontSize:10.5, fontFamily:"'DM Sans',sans-serif", transition:"all 0.2s" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(200,225,255,0.9)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.04)";e.currentTarget.style.color="rgba(200,225,255,0.6)";}}>
                    <Ico name={icon} size={11}/>{label}
                  </button>
                ))}
              </div>
              {locationInfo && (
                <div style={{ marginTop:8, padding:"9px 11px", background:"rgba(74,158,255,0.1)", borderRadius:8, border:"1px solid rgba(74,158,255,0.25)", position:"relative" }}>
                  <div style={{ color:"#90c8ff", fontSize:11.5, fontWeight:600, marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingRight:18 }}>{locationInfo.loading?"Locating…":(locationInfo.name||"Unknown")}</div>
                  {locationInfo.details && <div style={{ color:"rgba(255,255,255,0.35)", fontSize:10, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{locationInfo.details}</div>}
                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontFamily:"'DM Mono',monospace", marginTop:2 }}>{locationInfo.lat?.toFixed(5)}°, {locationInfo.lng?.toFixed(5)}°</div>
                  <button onClick={handleCloseLocationInfo} style={{ position:"absolute", top:7, right:7, background:"none", border:"none", color:"rgba(255,255,255,0.35)", cursor:"pointer", display:"flex", padding:2 }}><Ico name="Close" size={10}/></button>
                </div>
              )}
            </div>
          )}

          {/* ── PLACES ── */}
          <SectionHeader icon="Star" title="My Places" collapsed={!placesOpen} onToggle={()=>setPlacesOpen(p=>!p)}/>
          {placesOpen && (
            <div style={{ flexShrink:0 }}>
              <div style={{ padding:"6px 0", maxHeight:140, overflowY:"auto" }}>
                <LayerItem iconName="Star" label="Saved Places"/>
                <LayerItem iconName="Folder" label="Temporary Places" indent={1}/>
                {savedDrawings.map((d,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center" }}>
                    <div style={{ flex:1, overflow:"hidden" }}>
                      <LayerItem iconName={d.type==="path"?"Path":d.type==="polygon"?"Polygon":"Pin"} label={d.name} indent={2}/>
                    </div>
                    <span onClick={()=>setSavedDrawings(p=>p.filter((_,j)=>j!==i))} style={{ color:"rgba(255,255,255,0.25)", cursor:"pointer", padding:"0 10px", display:"flex", flexShrink:0 }}
                      onMouseEnter={e=>{e.currentTarget.style.color="#f87171";}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,255,255,0.25)";}}>
                      <Ico name="Close" size={10}/>
                    </span>
                  </div>
                ))}
                {savedDrawings.length===0 && <div style={{ paddingLeft:38, color:"rgba(255,255,255,0.2)", fontSize:10.5, fontStyle:"italic", paddingTop:2 }}>No saved drawings yet</div>}
                {surveyMode && route.length>0 && <LayerItem iconName="Survey" label={`Survey Route · ${route.length} pts`} active badge="LIVE" indent={1}/>}
                {/* Live Track indicator in sidebar */}
                {isTracking && <LayerItem iconName="Record" label="Live Track Recording…" active badge="REC" indent={1}/>}
              </div>
              <div style={{ display:"flex", gap:4, padding:"6px 10px", borderTop:"1px solid rgba(255,255,255,0.05)", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                {[["Folder","Folder"],["Pin","Mark"],["Path","Path"]].map(([ico,lbl]) => (
                  <button key={lbl} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:4, padding:"5px 4px", borderRadius:6, border:"1px solid rgba(255,255,255,0.08)", background:"rgba(255,255,255,0.04)", color:"rgba(200,225,255,0.55)", cursor:"pointer", fontSize:10, fontFamily:"'DM Sans',sans-serif", transition:"all 0.2s" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(200,225,255,0.9)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.04)";e.currentTarget.style.color="rgba(200,225,255,0.55)";}}>
                    <Ico name={ico} size={10}/>{lbl}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── LAYERS ── */}
          <SectionHeader icon="Layers" title="Map Layers" collapsed={!layersOpen} onToggle={()=>setLayersOpen(p=>!p)}/>
          {layersOpen && (
            <div style={{ flexShrink:0 }}>
              <div style={{ padding:"5px 0", maxHeight:210, overflowY:"auto" }}>
                <LayerItem iconName={nightSwitchInfo?.isNight?"Night":"Day"} label="Auto Night Mode" checked={nightModeAuto} onCheck={()=>setNightModeAuto(p=>!p)} onClick={()=>setNightModeAuto(p=>!p)} badge={nightModeAuto&&nightSwitchInfo?(nightSwitchInfo.isNight?"Night":"Day"):null}/>
                <div style={{ height:1, background:"rgba(255,255,255,0.05)", margin:"4px 12px" }}/>
                {Object.entries(MAP_LAYERS).map(([name,layer]) => (
                  <LayerItem key={name} iconName={layer.icon} label={name} checked={activeLayer===name} onCheck={()=>setActiveLayer(name)} onClick={()=>setActiveLayer(name)} active={activeLayer===name} indent={1}/>
                ))}
              </div>
            </div>
          )}

          {/* ── TOOLS ── */}
          <SectionHeader icon="Eye" title="Tools" collapsed={!toolsOpen} onToggle={()=>setToolsOpen(p=>!p)}/>
          {toolsOpen && (
            <div className="sm-desktop-tools" style={{ flex:1, overflowY:"auto" }}>

              {/* ── LIVE TRACK RECORDER (sidebar entry) ── */}
              <div style={{ padding:"12px 12px 10px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:9.5, fontWeight:700, letterSpacing:"0.1em", marginBottom:8, textTransform:"uppercase", fontFamily:"'DM Mono',monospace" }}>Live Track Recorder</div>
                {isTracking ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    <div style={{ padding:"6px 10px", background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:7, color:"#f87171", fontSize:11, textAlign:"center", fontWeight:500, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                      <span style={{ animation:"blink 1s infinite" }}>●</span> RECORDING TRACK
                    </div>
                    <PrimaryButton onClick={()=>setTrackerOpen(true)} variant="rose"><Ico name="Record" size={13}/>Open Recorder</PrimaryButton>
                  </div>
                ) : (
                  <PrimaryButton onClick={()=>setTrackerOpen(true)} variant="rose">
                    <Ico name="Record" size={13}/>Open Track Recorder
                  </PrimaryButton>
                )}
                <div style={{ color:"rgba(255,255,255,0.2)", fontSize:9.5, marginTop:6, fontFamily:"'DM Mono',monospace", lineHeight:1.5 }}>
                  GPS track · Waypoints · Photos<br/>Export GPX / KMZ
                </div>
              </div>

              {/* Draw Tool */}
              <div style={{ padding:"12px 12px 10px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:9.5, fontWeight:700, letterSpacing:"0.1em", marginBottom:8, textTransform:"uppercase", fontFamily:"'DM Mono',monospace" }}>Draw Tool</div>
                <div style={{ display:"flex", gap:4, marginBottom:8 }}>
                  {[["path","Path","Path"],["polygon","Polygon","Poly"],["marker","Pin","Pin"]].map(([t,ico,lb]) => (
                    <button key={t} onClick={()=>setDrawType(t)} style={{ flex:1, padding:"7px 4px", borderRadius:7, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:drawType===t?"rgba(74,158,255,0.18)":"rgba(255,255,255,0.04)", border:`1px solid ${drawType===t?"rgba(74,158,255,0.5)":"rgba(255,255,255,0.08)"}`, color:drawType===t?"#80c4ff":"rgba(255,255,255,0.5)", fontSize:10, fontWeight:600, transition:"all 0.2s" }}>
                      <Ico name={ico} size={15}/><span style={{ fontFamily:"'DM Sans',sans-serif" }}>{lb}</span>
                    </button>
                  ))}
                </div>
                {!drawMode
                  ? <PrimaryButton onClick={()=>{setDrawMode(true);setDrawPoints([]);}} variant="amber"><Ico name="Play" size={13}/>Start Drawing</PrimaryButton>
                  : <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                      <div style={{ padding:"6px 10px", background:"rgba(251,191,36,0.1)", border:"1px solid rgba(251,191,36,0.3)", borderRadius:7, color:"#fbbf24", fontSize:11, textAlign:"center", fontWeight:500 }}>
                        {drawType==="marker"?"Click map to place marker":`${drawPoints.length} points — click to add`}
                      </div>
                      <div style={{ display:"flex", gap:5 }}>
                        <PrimaryButton onClick={finishDrawing} variant="green" style={{ flex:1 }}><Ico name="Check" size={12}/>Done</PrimaryButton>
                        <PrimaryButton onClick={cancelDrawing} variant="red" style={{ flex:1 }}><Ico name="Close" size={12}/>Cancel</PrimaryButton>
                      </div>
                    </div>
                }
              </div>

              {/* Measure Tool */}
              <div style={{ padding:"12px 12px 10px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:9.5, fontWeight:700, letterSpacing:"0.1em", marginBottom:8, textTransform:"uppercase", fontFamily:"'DM Mono',monospace" }}>Measure Tool</div>
                {!measureMode
                  ? <PrimaryButton onClick={()=>setMeasureMode(true)} variant="blue"><Ico name="Measure" size={13}/>Start Measuring</PrimaryButton>
                  : <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                      <div style={{ padding:"10px 12px", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:8, textAlign:"center" }}>
                        <div style={{ color:"rgba(251,191,36,0.55)", fontSize:9, fontWeight:700, letterSpacing:"0.1em", marginBottom:2, fontFamily:"'DM Mono',monospace" }}>TOTAL DISTANCE</div>
                        <div style={{ color:"#fbbf24", fontSize:22, fontWeight:700, fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{measurePoints.length<2?"—":formatDist(totalDistance,measureUnit)}</div>
                        <div style={{ color:"rgba(251,191,36,0.4)", fontSize:9.5, marginTop:2 }}>{measurePoints.length} points</div>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:3 }}>
                        {[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"],["yd","yd"],["nmi","nmi"],["cm","cm"]].map(([u,lb]) => (
                          <button key={u} onClick={()=>setMeasureUnit(u)} style={{ padding:"5px 2px", borderRadius:5, cursor:"pointer", fontSize:9.5, fontWeight:600, background:measureUnit===u?"rgba(74,158,255,0.2)":"rgba(255,255,255,0.04)", border:`1px solid ${measureUnit===u?"rgba(74,158,255,0.45)":"rgba(255,255,255,0.08)"}`, color:measureUnit===u?"#80c4ff":"rgba(255,255,255,0.45)", fontFamily:"'DM Mono',monospace" }}>{lb}</button>
                        ))}
                      </div>
                      <div style={{ display:"flex", gap:4 }}>
                        <button onClick={()=>{setMeasurePoints([]);measureLayersRef.current.forEach(l=>l.remove());measureLayersRef.current=[];if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}}}
                          style={{ flex:1, padding:"6px", borderRadius:7, border:"1px solid rgba(255,255,255,0.08)", background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.4)", fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
                          <Ico name="Reset" size={11}/>Reset
                        </button>
                        <PrimaryButton onClick={clearMeasure} variant="red" style={{ flex:1, padding:"6px" }}><Ico name="Stop" size={11}/>Done</PrimaryButton>
                      </div>
                    </div>
                }
              </div>

              {/* Survey Tool */}
              <div style={{ padding:"12px 12px 10px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:9.5, fontWeight:700, letterSpacing:"0.1em", marginBottom:8, textTransform:"uppercase", fontFamily:"'DM Mono',monospace" }}>Survey Route</div>
                <PrimaryButton onClick={handleToggleSurvey} variant={surveyMode?"red":"blue"}>
                  <Ico name={surveyMode?"Stop":"Record"} size={13}/>
                  {surveyMode?"Stop Survey":"Start Survey"}
                </PrimaryButton>
                {surveyMode && (
                  <div style={{ marginTop:6, padding:"6px 10px", background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.25)", borderRadius:7, color:"#f87171", fontSize:11, textAlign:"center", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                    <span style={{ animation:"blink 1s infinite" }}>●</span> RECORDING · {route.length} point{route.length!==1?"s":""}
                  </div>
                )}
              </div>

              {/* Files */}
              <div style={{ padding:"12px 12px 10px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:9.5, fontWeight:700, letterSpacing:"0.1em", marginBottom:8, textTransform:"uppercase", fontFamily:"'DM Mono',monospace" }}>Import Files</div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  <label style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 11px", background:"rgba(255,255,255,0.04)", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)", cursor:"pointer", color:"rgba(200,225,255,0.65)", fontSize:11.5, fontFamily:"'DM Sans',sans-serif", transition:"all 0.2s" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(200,225,255,0.9)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.04)";e.currentTarget.style.color="rgba(200,225,255,0.65)";}}>
                    <Ico name="Upload" size={14}/> {kmlLoading?"Loading…":kmlName?kmlName.slice(0,22):"Open KML File"}
                    <input type="file" accept=".kml" onChange={handleKMLUpload} style={{ display:"none" }}/>
                  </label>
                  <label style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 11px", background:"rgba(255,255,255,0.04)", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)", cursor:"pointer", color:"rgba(200,225,255,0.65)", fontSize:11.5, fontFamily:"'DM Sans',sans-serif", transition:"all 0.2s" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(200,225,255,0.9)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.04)";e.currentTarget.style.color="rgba(200,225,255,0.65)";}}>
                    <Ico name="CSV" size={14}/> Upload KMZ / CSV
                    <input type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{ display:"none" }}/>
                  </label>
                </div>
              </div>

              {/* 3D Globe CTA */}
              <div style={{ padding:"14px 12px 16px" }}>
                <button onClick={()=>setShow3D(true)} style={{ width:"100%", padding:"11px 14px", borderRadius:10, cursor:"pointer", background:"linear-gradient(135deg,rgba(167,139,250,0.2),rgba(109,40,217,0.2))", border:"1px solid rgba(167,139,250,0.35)", color:"#c4b5fd", fontWeight:600, fontSize:12.5, fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"all 0.2s", boxShadow:"0 4px 20px rgba(124,58,237,0.15)" }}
                  onMouseEnter={e=>{e.currentTarget.style.background="linear-gradient(135deg,rgba(167,139,250,0.3),rgba(109,40,217,0.3))";e.currentTarget.style.boxShadow="0 4px 28px rgba(124,58,237,0.3)";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="linear-gradient(135deg,rgba(167,139,250,0.2),rgba(109,40,217,0.2))";e.currentTarget.style.boxShadow="0 4px 20px rgba(124,58,237,0.15)";}}>
                  <Ico name="Globe" size={18}/> Switch to 3D Globe
                </button>
                {savedDrawings.length>0 && <div style={{ marginTop:5, color:"rgba(167,139,250,0.5)", fontSize:9.5, textAlign:"center", fontFamily:"'DM Sans',sans-serif" }}>✓ {savedDrawings.length} drawing{savedDrawings.length!==1?"s":""} will carry over</div>}
              </div>
            </div>
          )}
        </div>

        {/* ─── MOBILE BOTTOM SHEET ──────────────────────────────────────── */}
        <div className="sm-mobile-sheet" style={{ display:"none", position:"fixed", bottom:"var(--stat-h)", left:0, right:0, zIndex:1200, background:"rgba(6,14,26,0.95)", backdropFilter:"blur(20px)", borderTop:"1px solid rgba(74,158,255,0.2)", flexDirection:"column", animation:"slideUp 0.25s ease" }}>
          <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
            {[["layers","Layers","Layers"],["draw","Draw","Draw"],["measure","Measure","Measure"],["track","Record","Track"]].map(([tab,ico,lb]) => (
              <button key={tab} onClick={()=>setMobileTab(tab)} style={{ flex:1, padding:"10px 4px", border:"none", borderBottom:`2px solid ${mobileTab===tab?"#4a9eff":"transparent"}`, background:mobileTab===tab?"rgba(74,158,255,0.1)":"transparent", color:mobileTab===tab?"#60a5fa":"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:11, fontWeight:600, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                <Ico name={ico} size={17}/>{lb}
              </button>
            ))}
          </div>
          <div style={{ padding:"10px 12px", maxHeight:220, overflowY:"auto" }}>
            {mobileTab==="layers" && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {Object.entries(MAP_LAYERS).map(([name,layer]) => (
                  <button key={name} onClick={()=>setActiveLayer(name)} style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:activeLayer===name?600:400, color:activeLayer===name?"#fff":"rgba(200,225,255,0.6)", background:activeLayer===name?"rgba(74,158,255,0.2)":"rgba(255,255,255,0.05)", border:`1px solid ${activeLayer===name?"rgba(74,158,255,0.5)":"rgba(255,255,255,0.08)"}` }}>
                    <Ico name={layer.icon} size={12}/>{name}
                  </button>
                ))}
              </div>
            )}
            {mobileTab==="track" && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <button onClick={()=>{setTrackerOpen(true);}} style={{ padding:"12px", borderRadius:10, border:"none", background:`linear-gradient(135deg,${isTracking?"#7f1d1d,#ef4444":"#1e3a5f,#3b82f6"})`, color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <Ico name="Record" size={18}/> {isTracking?"Open Recorder":"Start Track Recording"}
                </button>
                {isTracking && <div style={{ textAlign:"center", color:"#f87171", fontSize:11 }}>● Track recording in progress</div>}
              </div>
            )}
          </div>
        </div>

        {/* ─── STATUS BAR ───────────────────────────────────────────────── */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:"var(--stat-h)", zIndex:1100, background:"rgba(4,10,20,0.92)", backdropFilter:"blur(12px)", borderTop:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", padding:"0 14px", gap:14, userSelect:"none" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
            <Ico name="Pin" size={11} style={{ color:"rgba(74,158,255,0.6)" }}/>
            {mousePos
              ? <span style={{ color:"#90b8d8", fontSize:10, fontFamily:"'DM Mono',monospace" }}>
                  <span style={{ color:"#c0d8f0" }}>{toDMS(mousePos.lat,"N","S")}</span>
                  <span style={{ color:"rgba(255,255,255,0.2)", margin:"0 4px" }}>|</span>
                  <span style={{ color:"#c0d8f0" }}>{toDMS(mousePos.lng,"E","W")}</span>
                  <span style={{ color:"rgba(255,255,255,0.3)", marginLeft:6 }}>({mousePos.lat.toFixed(4)}, {mousePos.lng.toFixed(4)})</span>
                </span>
              : <span style={{ color:"rgba(255,255,255,0.2)", fontSize:10, fontFamily:"'DM Mono',monospace" }}>Move cursor over map</span>
            }
          </div>
          <div style={{ flex:1 }}/>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <span style={{ display:"flex", alignItems:"center", gap:4, color:"rgba(255,255,255,0.4)", fontSize:10, fontFamily:"'DM Mono',monospace" }}><Ico name="Zoom" size={10}/> Z{mapZoom}</span>
            <span style={{ display:"flex", alignItems:"center", gap:4, color:"rgba(255,255,255,0.4)", fontSize:10, fontFamily:"'DM Mono',monospace" }}><Ico name="Altitude" size={10}/> {formatAlt(zoomToAltitude(mapZoom))}</span>
            {nightModeAuto && <span style={{ color:"rgba(167,139,250,0.7)", fontSize:10 }}>{nightSwitchInfo?.isNight?"Night":"Day"}</span>}
            {/* Track recorder status in status bar */}
            {isTracking && (
              <span onClick={()=>setTrackerOpen(true)} style={{ display:"flex", alignItems:"center", gap:4, color:"#f87171", fontSize:10, cursor:"pointer", background:"rgba(239,68,68,0.1)", padding:"2px 8px", borderRadius:12, border:"1px solid rgba(239,68,68,0.25)" }}>
                <span style={{ animation:"blink 1s infinite" }}>●</span> REC
              </span>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ animation:"blink 1.5s infinite", color:"#4a9eff", fontSize:8 }}>●</span>
              <span style={{ color:"rgba(255,255,255,0.25)", fontSize:9.5, fontFamily:"'DM Sans',sans-serif" }}>Live</span>
            </div>
            <span style={{ color:"rgba(255,255,255,0.18)", fontSize:9, fontFamily:"'DM Sans',sans-serif" }}>© Esri / OSM</span>
          </div>
        </div>

        {/* ─── LOCATION INFO CARD ───────────────────────────────────────── */}
        {locationInfo && (
          <div className="sm-loc-card" style={{ position:"absolute", top:"var(--top-h)", marginTop:14, right:60, width:310, zIndex:1050, borderRadius:14, overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.7)", border:"1px solid rgba(255,255,255,0.1)", animation:"fadeSlideIn 0.22s ease", background:"rgba(6,14,26,0.95)", backdropFilter:"blur(24px)", fontFamily:"'DM Sans',sans-serif" }}>
            {locationInfo.photo && (
              <div style={{ position:"relative", height:130, overflow:"hidden" }}>
                <img src={locationInfo.photo} alt={locationInfo.name} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top,rgba(6,14,26,1) 0%,transparent 55%)" }}/>
                <div style={{ position:"absolute", bottom:12, left:14, color:"#fff", fontWeight:700, fontSize:15, textShadow:"0 2px 12px rgba(0,0,0,0.8)" }}>{locationInfo.name||locationInfo.label?.split(",")?.[0]}</div>
                <button onClick={handleCloseLocationInfo} style={{ position:"absolute", top:10, right:10, background:"rgba(0,0,0,0.5)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.7)", borderRadius:6, width:26, height:26, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(8px)" }}>
                  <Ico name="Close" size={10}/>
                </button>
              </div>
            )}
            <div style={{ padding:locationInfo.photo?"12px 16px 14px":"14px 16px" }}>
              {!locationInfo.photo && (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10, borderBottom:"1px solid rgba(255,255,255,0.07)", paddingBottom:10 }}>
                  <div>
                    <div style={{ color:"#d0e8f8", fontWeight:700, fontSize:14.5 }}>{locationInfo.loading?"Locating…":(locationInfo.name||locationInfo.label?.split(",")?.[0])}</div>
                    {locationInfo.details && !locationInfo.loading && <div style={{ color:"rgba(255,255,255,0.35)", fontSize:11, marginTop:2, maxWidth:230, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{locationInfo.details}</div>}
                  </div>
                  <button onClick={handleCloseLocationInfo} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.3)", cursor:"pointer", padding:2, display:"flex" }}><Ico name="Close" size={14}/></button>
                </div>
              )}
              <div style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 11px", background:"rgba(74,158,255,0.08)", borderRadius:8, marginBottom:10, border:"1px solid rgba(74,158,255,0.15)" }}>
                <Ico name="Pin" size={14} style={{ color:"#4a9eff" }}/>
                <div>
                  <div style={{ color:"#c0daf0", fontSize:11, fontFamily:"'DM Mono',monospace", fontWeight:500 }}>{locationInfo.lat?.toFixed(6)}°, {locationInfo.lng?.toFixed(6)}°</div>
                  {locationInfo.plusCode && <div style={{ color:"rgba(255,255,255,0.25)", fontSize:9.5, marginTop:1 }}>{locationInfo.plusCode}</div>}
                </div>
              </div>
              {locationInfo.loading
                ? <div style={{ color:"rgba(255,255,255,0.3)", fontSize:11, fontStyle:"italic" }}>⏳ Fetching details…</div>
                : locationInfo.description
                  ? <div style={{ color:"rgba(200,225,255,0.7)", fontSize:11.5, lineHeight:1.65, maxHeight:110, overflowY:"auto" }}>{locationInfo.description.slice(0,380)}{locationInfo.description.length>380?"…":""}</div>
                  : null
              }
              <div style={{ display:"flex", gap:6, marginTop:10 }}>
                {locationInfo.wikiUrl && (
                  <a href={locationInfo.wikiUrl} target="_blank" rel="noreferrer" style={{ flex:1, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6, padding:"7px 10px", background:"rgba(74,158,255,0.1)", borderRadius:7, color:"#60a8e8", fontSize:11, textDecoration:"none", fontWeight:600, border:"1px solid rgba(74,158,255,0.25)", transition:"all 0.2s" }}>
                    <Ico name="Wikipedia" size={12}/> Wikipedia ↗
                  </a>
                )}
                <button onClick={()=>window.open(`https://www.google.com/maps/search/?api=1&query=${locationInfo.lat},${locationInfo.lng}`,"_blank")} style={{ flex:1, padding:"7px 10px", background:"rgba(52,211,153,0.1)", borderRadius:7, border:"1px solid rgba(52,211,153,0.25)", color:"#34d399", fontSize:11, cursor:"pointer", fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", gap:6, transition:"all 0.2s" }}>
                  <Ico name="Maps" size={12}/> Google Maps ↗
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── NAME MODAL ───────────────────────────────────────────────── */}
        {showNameModal && (
          <div style={{ position:"fixed", inset:0, zIndex:2000, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 16px", backdropFilter:"blur(8px)" }}>
            <div style={{ background:"rgba(8,20,35,0.97)", borderRadius:14, padding:26, width:"100%", maxWidth:300, boxShadow:"0 20px 60px rgba(0,0,0,0.8)", border:"1px solid rgba(74,158,255,0.2)", fontFamily:"'DM Sans',sans-serif" }}>
              <div style={{ color:"#c8e0f8", fontWeight:700, fontSize:16, marginBottom:3 }}>Name this {pendingType}</div>
              <div style={{ color:"rgba(255,255,255,0.3)", fontSize:11, marginBottom:14 }}>{pendingPoints.length} point{pendingPoints.length!==1?"s":""} recorded</div>
              <input autoFocus value={pendingName} onChange={e=>setPendingName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmDrawing()}
                placeholder={pendingType==="marker"?"e.g. Survey Point A":"e.g. Survey Path A"}
                style={{ width:"100%", padding:"10px 13px", borderRadius:8, border:"1px solid rgba(74,158,255,0.3)", background:"rgba(74,158,255,0.07)", color:"#c8e0f8", fontSize:13, marginBottom:15, outline:"none", fontFamily:"'DM Sans',sans-serif" }}/>
              <div style={{ display:"flex", gap:8 }}>
                <PrimaryButton onClick={confirmDrawing} variant="blue"><Ico name="Check" size={13}/>Save</PrimaryButton>
                <PrimaryButton onClick={cancelDrawing} variant="red" style={{ background:"transparent" }}><Ico name="Close" size={13}/>Cancel</PrimaryButton>
              </div>
            </div>
          </div>
        )}

        {/* ─── ABOUT MODAL ──────────────────────────────────────────────── */}
        {showAbout && (
          <div style={{ position:"fixed", inset:0, zIndex:3000, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 16px", backdropFilter:"blur(10px)" }}>
            <div style={{ background:"rgba(6,14,26,0.97)", borderRadius:16, padding:28, width:"100%", maxWidth:360, boxShadow:"0 24px 72px rgba(0,0,0,0.85)", border:"1px solid rgba(74,158,255,0.2)", fontFamily:"'DM Sans',sans-serif" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", marginBottom:14 }}>
                <div style={{ width:52, height:52, borderRadius:14, background:"linear-gradient(135deg,rgba(74,158,255,0.25),rgba(37,99,235,0.25))", border:"1px solid rgba(74,158,255,0.35)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Ico name="Compass" size={26} style={{ color:"#4a9eff" }}/>
                </div>
              </div>
              <div style={{ color:"#c8e0f8", fontWeight:700, fontSize:20, textAlign:"center", marginBottom:5 }}>SurveyMap Pro</div>
              <div style={{ color:"rgba(255,255,255,0.35)", fontSize:12, textAlign:"center", marginBottom:20 }}>Professional GIS-style web mapping — React + Leaflet</div>
              <div style={{ display:"flex", flexDirection:"column", gap:3, background:"rgba(255,255,255,0.03)", padding:"12px 14px", borderRadius:10, border:"1px solid rgba(255,255,255,0.06)" }}>
                {[["Satellite","Multiple tile layers & basemaps"],["Draw","Draw paths, polygons & markers"],["Measure","Distance measurement with units"],["Survey","Survey route recording"],["Record","Live GPS track recorder (GPX/KMZ export)"],["Upload","KML / KMZ / CSV import"],["Globe","3D Globe view"],["Night","Auto day / night mode"],["Eye","Mobile responsive"]].map(([ico,feat]) => (
                  <div key={feat} style={{ display:"flex", alignItems:"center", gap:9, padding:"4px 0", color:"rgba(200,225,255,0.65)", fontSize:12 }}>
                    <Ico name={ico} size={13} style={{ color:"rgba(74,158,255,0.7)", flexShrink:0 }}/>{feat}
                  </div>
                ))}
              </div>
              <PrimaryButton onClick={()=>setShowAbout(false)} variant="blue" style={{ marginTop:18 }}><Ico name="Check" size={13}/>Close</PrimaryButton>
            </div>
          </div>
        )}

        {/* ─── SHORTCUTS MODAL ──────────────────────────────────────────── */}
        {showShortcuts && (
          <div style={{ position:"fixed", inset:0, zIndex:3000, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 16px", backdropFilter:"blur(10px)" }}>
            <div style={{ background:"rgba(6,14,26,0.97)", borderRadius:16, padding:26, width:"100%", maxWidth:340, boxShadow:"0 24px 72px rgba(0,0,0,0.85)", border:"1px solid rgba(74,158,255,0.2)", fontFamily:"'DM Sans',sans-serif" }}>
              <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:18 }}>
                <Ico name="Keyboard" size={18} style={{ color:"#4a9eff" }}/>
                <span style={{ color:"#c8e0f8", fontWeight:700, fontSize:16 }}>Keyboard Shortcuts</span>
              </div>
              {[["Escape","Cancel draw / measure"],["Click map","Add point"],["Enter","Save (name modal)"],["Scroll","Zoom in / out"],["Drag","Pan map"],["Right-click drag","Rotate map"],["T","Open Track Recorder"]].map(([k,d]) => (
                <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                  <code style={{ color:"#80c4ff", fontWeight:600, fontSize:11, fontFamily:"'DM Mono',monospace", background:"rgba(74,158,255,0.12)", padding:"3px 8px", borderRadius:5, border:"1px solid rgba(74,158,255,0.2)" }}>{k}</code>
                  <span style={{ color:"rgba(200,225,255,0.5)", fontSize:11.5 }}>{d}</span>
                </div>
              ))}
              <PrimaryButton onClick={()=>setShowShortcuts(false)} variant="blue" style={{ marginTop:18 }}><Ico name="Check" size={13}/>Close</PrimaryButton>
            </div>
          </div>
        )}

      </div>
    </>
  );
}