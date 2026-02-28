import React, { useState, useRef, useCallback } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, ZoomControl, WMSTileLayer } from "react-leaflet";
import AddSearch from "./search/AddSearch";
import LiveGPS from "./map/LiveGPS";
import BoundaryLayer from "./map/BoundaryLayer";
import MapTracker from "./map/MapTracker";
import CompassRose from "./map/CompassRose";
import MeasureTool from "./tools/MeasureTool";
import DrawTool from "./tools/DrawTool";
import SurveyClick from "./tools/SurveyClick";
import KMLLoader from "./loaders/KMLLoader";
import KMZLoader from "./loaders/KMZLoader";
import CSVLoader from "./loaders/CSVLoader";
import { haversine, formatDist } from "./map/measureUtils";
import { useNightModeAutoSwitch } from "./map/useNightModeAutoSwitch";
import Globe3DView from "./Globe3DView";

const MAP_LAYERS = {
  Satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri", icon: "🛰️" },
  Street: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors", icon: "🗺️" },
  Terrain: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "© OpenTopoMap", icon: "⛰️" },
  Hillshade: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", attribution: "© ESRI World Hillshade", icon: "🗻" },
  Contour: { url: "https://tiles.stadiamaps.com/tiles/stamen_terrain_lines/{z}/{x}/{y}.png", attribution: "© Stadia Maps", icon: "📈" },
  "Satellite + Labels": { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", overlayUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri", icon: "🏷️" },
  Dark: { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: "© CartoDB", icon: "🌑" },
  Light: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: "© CartoDB", icon: "☀️" },
  "WMS – States demo": { type: "wms", url: "https://ahocevar.com/geoserver/wms", layers: "topp:states", format: "image/png", transparent: true, attribution: "GeoServer demo WMS", icon: "🛰️" },
};

function zoomToAltitude(zoom) {
  const alts = {1:147000000,2:73000000,3:36000000,4:18000000,5:9000000,6:4500000,7:2250000,8:1100000,9:550000,10:275000,11:137000,12:68000,13:34000,14:17000,15:8500,16:4200,17:2100,18:1050,19:525,20:262};
  return alts[Math.round(zoom)] || 34000;
}
function formatAlt(m) { return m >= 1000 ? (m/1000).toFixed(0)+" km" : m.toFixed(0)+" m"; }
function toDMS(val, pos, neg) {
  const a=Math.abs(val),d=Math.floor(a),m=Math.floor((a-d)*60),s=((a-d-m/60)*3600).toFixed(2);
  return `${d}°${m}'${s}"${val>=0?pos:neg}`;
}
function toPlusCode(lat, lng) {
  const latDeg=Math.floor(Math.abs(lat)),lngDeg=Math.floor(Math.abs(lng));
  const latMin=Math.floor((Math.abs(lat)-latDeg)*60),lngMin=Math.floor((Math.abs(lng)-lngDeg)*60);
  return `${latDeg}°${latMin}'${lat>=0?"N":"S"} ${lngDeg}°${lngMin}'${lng>=0?"E":"W"}`;
}

const MENU_H=22, TOOLBAR_H=36, TOP_H=58, SIDEBAR_W=262, STATUS_H=24;

// ─── MENU BAR DEFINITIONS ──────────────────────────────────────────────────
const MENU_DEFS = {
  File: [
    { label: "📂 Open KML…",      action: "openKML" },
    { label: "📊 Open KMZ / CSV…", action: "openExtra" },
    { divider: true },
    { label: "💾 Export Drawings…", action: "export" },
    { divider: true },
    { label: "🔄 Reset / Clear All", action: "resetAll" },
  ],
  Edit: [
    { label: "✏️ Start Drawing",     action: "startDraw" },
    { label: "🗑️ Cancel Drawing",    action: "cancelDraw" },
    { divider: true },
    { label: "📏 Start Measuring",   action: "startMeasure" },
    { label: "✖ Stop Measuring",    action: "stopMeasure" },
    { divider: true },
    { label: "🗑️ Delete All Drawings", action: "deleteDrawings" },
  ],
  View: [
    { label: "🛰️ Satellite",           action: "layerSatellite" },
    { label: "🗺️ Street",              action: "layerStreet" },
    { label: "⛰️ Terrain",             action: "layerTerrain" },
    { label: "🌑 Dark",                action: "layerDark" },
    { label: "☀️ Light",               action: "layerLight" },
    { label: "🏷️ Satellite + Labels",  action: "layerSatLabels" },
    { divider: true },
    { label: "🌍 Switch to 3D Globe",  action: "show3D" },
    { divider: true },
    { label: "🌙 Toggle Auto Night Mode", action: "toggleNight" },
  ],
  Tools: [
    { label: "✏️ Draw Tool",     action: "startDraw" },
    { label: "📏 Measure Tool",  action: "startMeasure" },
    { label: "📐 Survey Tool",   action: "toggleSurvey" },
    { divider: true },
    { label: "🌍 3D Globe View", action: "show3D" },
  ],
  Add: [
    { label: "📍 Add Marker",  action: "drawMarker" },
    { label: "〰️ Add Path",    action: "drawPath" },
    { label: "⬡ Add Polygon", action: "drawPoly" },
    { divider: true },
    { label: "📂 Load KML File",   action: "openKML" },
    { label: "📊 Load KMZ / CSV",  action: "openExtra" },
  ],
  Help: [
    { label: "📖 About SurveyMap Pro",  action: "about" },
    { label: "⌨️ Keyboard Shortcuts",   action: "shortcuts" },
    { divider: true },
    { label: "🌐 OpenStreetMap ↗",      action: "osmLink" },
    { label: "🌐 Leaflet Docs ↗",       action: "leafletLink" },
  ],
};

function PaneHeader({ icon, title, collapsed, onToggle }) {
  return (
    <div onClick={onToggle} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 8px",background:"linear-gradient(180deg,#2c3e50 0%,#1a2a38 100%)",borderBottom:"1px solid #0d1b26",borderTop:"1px solid #3a5268",cursor:"pointer",userSelect:"none",flexShrink:0}}>
      <span style={{color:"#6a8ea8",fontSize:9,width:10}}>{collapsed?"▶":"▼"}</span>
      <span style={{fontSize:12}}>{icon}</span>
      <span style={{color:"#c4d8e8",fontSize:11,fontWeight:700,letterSpacing:"0.03em",flex:1,fontFamily:"'Segoe UI',sans-serif"}}>{title}</span>
    </div>
  );
}

function TreeItem({ icon, label, active, check, onCheck, onClick, indent=0, badge=null }) {
  return (
    <div onClick={onClick} style={{display:"flex",alignItems:"center",gap:5,padding:`2px 6px 2px ${8+indent*14}px`,borderRadius:2,cursor:"pointer",background:active?"rgba(40,100,200,0.35)":"transparent"}}
      onMouseEnter={e=>{if(!active)e.currentTarget.style.background="rgba(255,255,255,0.06)";}}
      onMouseLeave={e=>{e.currentTarget.style.background=active?"rgba(40,100,200,0.35)":"transparent";}}>
      {check!==undefined&&<input type="checkbox" checked={check} onChange={e=>{e.stopPropagation();if(onCheck)onCheck();}} style={{width:11,height:11,accentColor:"#3a78c8",cursor:"pointer",flexShrink:0}}/>}
      <span style={{fontSize:13,flexShrink:0}}>{icon}</span>
      <span style={{color:active?"#fff":"#b0c8da",fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"'Segoe UI',sans-serif"}}>{label}</span>
      {badge&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:8,background:"rgba(40,100,200,0.45)",color:"#80b8ff",flexShrink:0}}>{badge}</span>}
    </div>
  );
}

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

  // ── Hidden file input refs (used by menu bar File actions) ───────────────
  const kmlInputRef  = useRef(null);
  const extraInputRef = useRef(null);

  // ── Menu bar state ───────────────────────────────────────────────────────
  const [openMenu, setOpenMenu] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const menuBarRef = useRef(null);

  // ── SIDEBAR SEARCH state ─────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const searchFnRef = useRef(null);

  useNightModeAutoSwitch({enabled:nightModeAuto,activeLayer,setActiveLayer,nightLayer:"Dark",dayLayer:"Satellite + Labels",onSwitch:({isNight,sunrise,sunset})=>setNightSwitchInfo({isNight,sunrise,sunset})});

  const onKmlDone=useCallback(()=>setKmlLoading(false),[]);
  const onMouseMove=useCallback(p=>setMousePos(p),[]);
  const onZoomChange=useCallback(z=>setMapZoom(z),[]);

  async function handleSidebarSearch(e) {
    e?.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    try {
      if (searchFnRef.current) await searchFnRef.current(q);
    } finally {
      setSearchLoading(false);
    }
  }

  function clearMeasure() {
    measureLayersRef.current.forEach(l=>l.remove()); measureLayersRef.current=[];
    if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}
    if(measureLineRef._preview){measureLineRef._preview.remove();measureLineRef._preview=null;}
    setMeasurePoints([]); setMeasureMode(false);
  }
  function handleExtraUpload(e) {
    const file=e.target.files[0]; if(!file) return;
    const ext=file.name.split(".").pop().toLowerCase();
    if(ext!=="kmz"&&ext!=="csv"){alert("Please upload a KMZ or CSV file.");e.target.value="";return;}
    setExtraFile(file);setExtraFileType(ext);e.target.value="";
  }
  const totalDistance=measurePoints.length>=2?measurePoints.reduce((sum,p,i)=>i===0?0:sum+haversine(measurePoints[i-1],p),0):0;
  function handleKMLUpload(e){const file=e.target.files[0];if(!file)return;setKmlLoading(true);setKmlName(file.name);setKmlFile(file);e.target.value="";}
  function handleToggleSurvey(){if(surveyMode){setRoute([]);setStart(null);setEnd(null);if(polylineRef.current){polylineRef.current.remove();polylineRef.current=null;}}setSurveyMode(p=>!p);}

  async function reverseGeocode(lat,lng) {
    try{const res=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,{headers:{"Accept-Language":"en"},signal:AbortSignal.timeout(6000)});if(!res.ok)return null;return await res.json();}catch{return null;}
  }

  const handleLocationFound=useCallback(async({lat,lng,label,raw})=>{
    setLocationInfo({lat,lng,label,loading:true,photo:null,description:null});
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
      const proxies=[`https://corsproxy.io/?url=${encodeURIComponent(nomUrl)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(nomUrl)}`,`https://thingproxy.freeboard.io/fetch/${nomUrl}`];
      for(const proxied of proxies){try{const res=await fetch(proxied,{signal:AbortSignal.timeout(6000)});if(!res.ok)continue;const data=await res.json();if(!Array.isArray(data)||!data.length)continue;place=data.find(r=>r.geojson?.type==="MultiPolygon")||data.find(r=>r.geojson?.type==="Polygon")||data[0];boundaryGeoJson=place?.geojson||null;if(boundaryGeoJson)break;}catch(e){console.warn("Proxy failed:",e.message);}}
      setBoundaryGeojson(boundaryGeoJson);
      let description=null,wikiUrl=null,photo=null;
      const placeName=place?.namedetails?.name||place?.display_name?.split(",")?.[0]||searchName;
      try{const wr=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(placeName)}`);if(wr.ok){const w=await wr.json();description=w.extract;wikiUrl=w.content_urls?.desktop?.page;photo=w.thumbnail?.source||null;}}catch(e){console.warn("Wikipedia fetch failed:",e.message);}
      const addr=place?.address||{};
      const details=[addr.city||addr.town||addr.village,addr.state,addr.country].filter(Boolean).join(", ");
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
  function cancelDrawing(){
    setDrawPoints([]);
    if(previewLayerRef.current){previewLayerRef.current.remove();previewLayerRef.current=null;}
    drawLayersRef.current.forEach(l=>l.remove());drawLayersRef.current=[];
    setShowNameModal(false);setDrawMode(false);
  }

  // ── Menu bar action dispatcher ────────────────────────────────────────────
  function handleMenuAction(action) {
    setOpenMenu(null);
    switch (action) {
      case "openKML":    kmlInputRef.current?.click();   break;
      case "openExtra":  extraInputRef.current?.click(); break;
      case "export":
        // ExportTool is rendered in the sidebar; trigger a click on its button
        document.querySelector("[data-export-btn]")?.click();
        break;
      case "resetAll":
        if (window.confirm("Reset everything? This will clear all drawings and survey data.")) {
          setSavedDrawings([]);
          cancelDrawing();
          clearMeasure();
          setRoute([]);
          setSurveyMode(false);
        }
        break;
      case "startDraw":    setDrawMode(true); setDrawPoints([]); break;
      case "cancelDraw":   cancelDrawing(); break;
      case "startMeasure": setMeasureMode(true); break;
      case "stopMeasure":  clearMeasure(); break;
      case "deleteDrawings":
        if (savedDrawings.length === 0) { alert("No drawings to delete."); return; }
        if (window.confirm(`Delete all ${savedDrawings.length} drawing(s)?`)) setSavedDrawings([]);
        break;
      case "layerSatellite":  setActiveLayer("Satellite"); break;
      case "layerStreet":     setActiveLayer("Street"); break;
      case "layerTerrain":    setActiveLayer("Terrain"); break;
      case "layerDark":       setActiveLayer("Dark"); break;
      case "layerLight":      setActiveLayer("Light"); break;
      case "layerSatLabels":  setActiveLayer("Satellite + Labels"); break;
      case "show3D":          setShow3D(true); break;
      case "toggleNight":     setNightModeAuto(p => !p); break;
      case "drawMarker":      setDrawMode(true); setDrawType("marker"); setDrawPoints([]); break;
      case "drawPath":        setDrawMode(true); setDrawType("path"); setDrawPoints([]); break;
      case "drawPoly":        setDrawMode(true); setDrawType("polygon"); setDrawPoints([]); break;
      case "toggleSurvey":    handleToggleSurvey(); break;
      case "about":           setShowAbout(true); break;
      case "shortcuts":       setShowShortcuts(true); break;
      case "osmLink":    window.open("https://www.openstreetmap.org", "_blank"); break;
      case "leafletLink": window.open("https://leafletjs.com/reference.html", "_blank"); break;
    }
  }

  const activeLayerConfig=MAP_LAYERS[activeLayer];
  if(show3D) return <Globe3DView savedDrawings={savedDrawings} onClose={()=>setShow3D(false)}/>;

  const gepBtn=(bg="linear-gradient(180deg,#e0ecf4 0%,#c8dce8 100%)",color="#1a3040",border="1px solid #8aabb8")=>({padding:"3px 8px",borderRadius:3,border,background:bg,color,fontSize:11,cursor:"pointer",fontFamily:"'Segoe UI',Tahoma,sans-serif",fontWeight:600});

  return (
    <>
      <style>{`
        html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}
        *,*::before,*::after{box-sizing:border-box;}
        body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;}
        ::-webkit-scrollbar{width:6px;height:6px;}
        ::-webkit-scrollbar-track{background:rgba(0,0,0,0.25);}
        ::-webkit-scrollbar-thumb{background:rgba(120,160,190,0.35);border-radius:3px;}
        .gep-tbtn:hover{filter:brightness(1.1);}
        .gep-tbtn:active{filter:brightness(0.9);}
        .gep-menu-item:hover{background:rgba(58,100,136,0.2)!important;}
        .measure-tooltip{background:rgba(15,23,42,0.92)!important;border:1px solid #facc15!important;color:#facc15!important;font-size:11px!important;font-weight:700!important;font-family:'Courier New',monospace!important;padding:2px 7px!important;border-radius:4px!important;white-space:nowrap!important;box-shadow:0 2px 8px rgba(0,0,0,0.4)!important;}
        .measure-tooltip::before{border-top-color:#facc15!important;}
        @keyframes gepSlideIn{from{opacity:0;transform:translateX(18px);}to{opacity:1;transform:translateX(0);}}
        @keyframes gepStream{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .menu-drop-item{padding:7px 16px;font-size:12px;color:#1a3040;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:'Segoe UI',sans-serif;transition:background 0.1s;}
        .menu-drop-item:hover{background:rgba(58,120,200,0.15);}
      `}</style>

      {/* ═══════════════════════════════════════════════════════════════════
          1. MENU BAR — fully working dropdowns
      ════════════════════════════════════════════════════════════════════ */}
      <div
        ref={menuBarRef}
        style={{position:"absolute",top:0,left:0,right:0,height:MENU_H,zIndex:1200,background:"linear-gradient(180deg,#e8f2f8 0%,#d4e4ee 100%)",borderBottom:"1px solid #a0bccc",display:"flex",alignItems:"center",paddingLeft:6,gap:0}}
      >
        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:5,marginRight:10,paddingRight:10,borderRight:"1px solid #b0ccdc"}}>
          <span style={{fontSize:14}}>🗺️</span>
          <span style={{fontSize:11,fontWeight:700,color:"#1a3040"}}>SurveyMap Pro</span>
        </div>

        {/* Dropdown menus */}
        {Object.keys(MENU_DEFS).map(menuName => {
          const isOpen = openMenu === menuName;
          return (
            <div key={menuName} style={{position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
              <span
                onClick={() => setOpenMenu(isOpen ? null : menuName)}
                onMouseEnter={() => { if (openMenu && openMenu !== menuName) setOpenMenu(menuName); }}
                style={{
                  fontSize:11,
                  color: isOpen ? "#fff" : "#1a3040",
                  padding:"2px 10px",
                  cursor:"pointer",
                  userSelect:"none",
                  height:"100%",
                  display:"flex",
                  alignItems:"center",
                  background: isOpen ? "linear-gradient(180deg,#3a78c8 0%,#1a50a0 100%)" : "transparent",
                  fontWeight: isOpen ? 700 : 400,
                  fontFamily:"'Segoe UI',sans-serif",
                  borderRadius:2,
                }}
              >
                {menuName}
              </span>

              {isOpen && (
                <div style={{
                  position:"absolute",top:MENU_H,left:0,
                  background:"linear-gradient(180deg,#f0f8ff 0%,#e4f0f8 100%)",
                  border:"1px solid #8aabb8",
                  borderTop:"2px solid #3a78c8",
                  borderRadius:"0 0 4px 4px",
                  minWidth:200,
                  boxShadow:"0 6px 24px rgba(0,0,0,0.2)",
                  zIndex:1300,
                  overflow:"hidden",
                }}>
                  {MENU_DEFS[menuName].map((item, idx) =>
                    item.divider ? (
                      <div key={idx} style={{height:1,background:"#c0d4e0",margin:"2px 0"}}/>
                    ) : (
                      <div
                        key={idx}
                        className="menu-drop-item"
                        onClick={() => handleMenuAction(item.action)}
                      >
                        {item.label}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Click-outside overlay to close menus */}
        {openMenu && (
          <div
            style={{position:"fixed",inset:0,zIndex:1290}}
            onClick={() => setOpenMenu(null)}
          />
        )}

        <div style={{flex:1}}/>
        <button style={{...gepBtn(),marginRight:8,fontSize:10}}>Sign In</button>
      </div>

      {/* Hidden file inputs (triggered by menu bar) */}
      <input ref={kmlInputRef}   type="file" accept=".kml"      onChange={handleKMLUpload}   style={{display:"none"}}/>
      <input ref={extraInputRef} type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{display:"none"}}/>

      {/* ═══════════════════════════════════════════════════════════════════
          2. TOOLBAR
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{position:"absolute",top:MENU_H,left:0,right:0,height:TOOLBAR_H,zIndex:1200,background:"linear-gradient(180deg,#ddeaf4 0%,#c4d8e8 100%)",borderBottom:"2px solid #8aabb8",display:"flex",alignItems:"center",paddingLeft:6,gap:3,overflowX:"auto"}}>
        {[{key:"Satellite",icon:"🛰️",short:"Satellite"},{key:"Street",icon:"🗺️",short:"Street"},{key:"Terrain",icon:"⛰️",short:"Terrain"},{key:"Satellite + Labels",icon:"🏷️",short:"+Labels"},{key:"Dark",icon:"🌑",short:"Dark"},{key:"Light",icon:"☀️",short:"Light"}].map(({key,icon,short})=>(
          <button key={key} className="gep-tbtn" onClick={()=>setActiveLayer(key)} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 7px",borderRadius:3,cursor:"pointer",fontSize:11,fontWeight:activeLayer===key?700:500,color:activeLayer===key?"#fff":"#1a3040",background:activeLayer===key?"linear-gradient(180deg,#3a78c8 0%,#1a50a0 100%)":"linear-gradient(180deg,#e8f2f8 0%,#ccdde8 100%)",border:activeLayer===key?"1px solid #1a50a0":"1px solid #8aabb8",fontFamily:"'Segoe UI',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
            <span>{icon}</span><span>{short}</span>
          </button>
        ))}
        <div style={{width:1,height:22,background:"#8aabb8",margin:"0 2px",flexShrink:0}}/>
        {[{icon:"✏️",label:"Draw",active:drawMode,action:()=>{setDrawMode(m=>!m);if(!drawMode)setDrawPoints([]);}},{icon:"📏",label:"Measure",active:measureMode,action:()=>setMeasureMode(m=>!m)},{icon:"📐",label:"Survey",active:surveyMode,action:handleToggleSurvey}].map(({icon,label,active,action})=>(
          <button key={label} className="gep-tbtn" onClick={action} title={label} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"2px 6px",borderRadius:3,cursor:"pointer",minWidth:36,flexShrink:0,background:active?"linear-gradient(180deg,#3a78c8 0%,#1a50a0 100%)":"linear-gradient(180deg,#e8f2f8 0%,#ccdde8 100%)",border:active?"1px solid #1a50a0":"1px solid #8aabb8",color:active?"#fff":"#1a3040"}}>
            <span style={{fontSize:14}}>{icon}</span>
            <span style={{fontSize:8,fontFamily:"'Segoe UI',sans-serif",fontWeight:600}}>{label}</span>
          </button>
        ))}
        <div style={{width:1,height:22,background:"#8aabb8",margin:"0 2px",flexShrink:0}}/>
        <label className="gep-tbtn" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"2px 6px",borderRadius:3,cursor:"pointer",background:"linear-gradient(180deg,#e8f2f8 0%,#ccdde8 100%)",border:"1px solid #8aabb8",minWidth:36,color:"#1a3040",flexShrink:0}}>
          <span style={{fontSize:14}}>📂</span><span style={{fontSize:8,fontFamily:"'Segoe UI',sans-serif",fontWeight:600}}>KML</span>
          <input type="file" accept=".kml" onChange={handleKMLUpload} style={{display:"none"}}/>
        </label>
        <label className="gep-tbtn" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"2px 6px",borderRadius:3,cursor:"pointer",background:"linear-gradient(180deg,#e8f2f8 0%,#ccdde8 100%)",border:"1px solid #8aabb8",minWidth:36,color:"#1a3040",flexShrink:0}}>
          <span style={{fontSize:14}}>📊</span><span style={{fontSize:8,fontFamily:"'Segoe UI',sans-serif",fontWeight:600}}>CSV/KMZ</span>
          <input type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{display:"none"}}/>
        </label>
        <div style={{width:1,height:22,background:"#8aabb8",margin:"0 2px",flexShrink:0}}/>
        <button className="gep-tbtn" onClick={()=>setShow3D(true)} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:3,cursor:"pointer",background:"linear-gradient(180deg,#c0dcf0 0%,#90b8d8 100%)",border:"1px solid #5a98c0",color:"#0a2840",fontWeight:700,fontSize:11,fontFamily:"'Segoe UI',sans-serif",flexShrink:0}}>
          <span>🌍</span><span>3D Globe</span>
        </button>
        <button className="gep-tbtn" onClick={()=>setNightModeAuto(p=>!p)} title="Auto Night Mode" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"2px 6px",borderRadius:3,cursor:"pointer",minWidth:36,flexShrink:0,background:nightModeAuto?"linear-gradient(180deg,#3a78c8 0%,#1a50a0 100%)":"linear-gradient(180deg,#e8f2f8 0%,#ccdde8 100%)",border:nightModeAuto?"1px solid #1a50a0":"1px solid #8aabb8",color:nightModeAuto?"#fff":"#1a3040"}}>
          <span style={{fontSize:14}}>{nightSwitchInfo?.isNight?"🌙":"☀️"}</span>
          <span style={{fontSize:8,fontFamily:"'Segoe UI',sans-serif",fontWeight:600}}>Night</span>
        </button>
        <div style={{flex:1}}/>
        {kmlLoading&&<span style={{fontSize:10,color:"#336688",marginRight:8,whiteSpace:"nowrap"}}>⏳ {kmlName}…</span>}
        {kmlName&&!kmlLoading&&<span style={{fontSize:10,color:"#336688",marginRight:8,whiteSpace:"nowrap"}}>📄 {kmlName.slice(0,16)}</span>}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          3. MAP WRAPPER
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{position:"absolute",top:TOP_H,left:SIDEBAR_W,right:0,bottom:STATUS_H,zIndex:1}}>
        <MapContainer center={[20.29,85.82]} zoom={13} zoomControl={false} style={{width:"100%",height:"100%"}}>
          {activeLayerConfig.type==="wms"?(
            <WMSTileLayer key={activeLayer} url={activeLayerConfig.url} layers={activeLayerConfig.layers} format={activeLayerConfig.format||"image/png"} transparent={activeLayerConfig.transparent??true} attribution={activeLayerConfig.attribution} crossOrigin={true}/>
          ):(
            <>
              <TileLayer key={activeLayer} url={activeLayerConfig.url} attribution={activeLayerConfig.attribution} maxZoom={19} crossOrigin={true}/>
              {activeLayerConfig.overlayUrl&&<TileLayer url={activeLayerConfig.overlayUrl} maxZoom={19} crossOrigin={true}/>}
            </>
          )}
          <ZoomControl position="bottomright"/>
          <AddSearch onLocationFound={handleLocationFound} searchRef={searchFnRef}/>
          <LiveGPS/>
          <KMLLoader file={kmlFile} onDone={onKmlDone}/>
          {extraFileType==="kmz"&&<KMZLoader file={extraFile} onDone={()=>{}}/>}
          {extraFileType==="csv"&&<CSVLoader file={extraFile} onDone={()=>{}}/>}
          <SurveyClick surveyMode={surveyMode} route={route} setRoute={setRoute} setStart={setStart} setEnd={setEnd} polylineRef={polylineRef}/>
          <DrawTool drawMode={drawMode} drawType={drawType} drawPoints={drawPoints} setDrawPoints={setDrawPoints} previewLayerRef={previewLayerRef} drawLayersRef={drawLayersRef}/>
          <BoundaryLayer geojson={boundaryGeojson}/>
          <MapTracker onMove={onMouseMove} onZoom={onZoomChange}/>
          <MeasureTool measureMode={measureMode} measurePoints={measurePoints} setMeasurePoints={setMeasurePoints} measureLayersRef={measureLayersRef} measureLineRef={measureLineRef} measureUnit={measureUnit}/>
          <CompassRose/>
        </MapContainer>
      </div>

      {/* 4. NAV CONTROLS (unchanged) */}
      <div style={{position:"absolute",top:TOP_H+12,right:14,zIndex:900,display:"flex",flexDirection:"column",alignItems:"center",gap:6,userSelect:"none"}}>
        <div style={{position:"relative",width:72,height:72}}>
          <svg viewBox="0 0 72 72" style={{width:"100%",height:"100%",filter:"drop-shadow(0 3px 10px rgba(0,0,0,0.7))"}}>
            <defs><radialGradient id="rg1" cx="50%" cy="50%"><stop offset="0%" stopColor="#4a6f90"/><stop offset="100%" stopColor="#162840"/></radialGradient></defs>
            <circle cx="36" cy="36" r="35" fill="url(#rg1)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2"/>
            <circle cx="36" cy="36" r="20" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
            <polygon points="36,4 39,22 36,18 33,22" fill="#ef4444"/>
            <polygon points="36,68 39,50 36,54 33,50" fill="#607080"/>
            <polygon points="4,36 22,33 18,36 22,39" fill="#607080"/>
            <polygon points="68,36 50,33 54,36 50,39" fill="#607080"/>
            <text x="36" y="16" textAnchor="middle" fill="#ef4444" fontSize="8" fontWeight="bold" fontFamily="Arial">N</text>
            <text x="36" y="65" textAnchor="middle" fill="#90a8b8" fontSize="7" fontFamily="Arial">S</text>
            <text x="63" y="39" textAnchor="middle" fill="#90a8b8" fontSize="7" fontFamily="Arial">E</text>
            <text x="9" y="39" textAnchor="middle" fill="#90a8b8" fontSize="7" fontFamily="Arial">W</text>
            <circle cx="36" cy="36" r="4" fill="rgba(255,255,255,0.3)"/>
          </svg>
          {[{top:0,left:28,sym:"▲"},{top:28,left:56,sym:"▶"},{top:56,left:28,sym:"▼"},{top:28,left:0,sym:"◀"}].map(({top,left,sym})=>(
            <button key={sym} style={{position:"absolute",top,left,width:16,height:16,background:"transparent",border:"none",color:"rgba(255,255,255,0.6)",fontSize:9,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>{sym}</button>
          ))}
        </div>
        <div style={{width:40,height:40,borderRadius:"50%",background:"linear-gradient(180deg,#4a6f90,#162840)",border:"1px solid rgba(255,255,255,0.22)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:"0 2px 10px rgba(0,0,0,0.6)"}}>
          <svg width="26" height="26" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="11" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
            <ellipse cx="13" cy="13" rx="11" ry="4.5" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5"/>
            <line x1="13" y1="2" x2="13" y2="24" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
          </svg>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",background:"linear-gradient(180deg,#3a6080,#162840)",borderRadius:5,border:"1px solid rgba(255,255,255,0.2)",overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.6)",width:30}}>
          <div style={{padding:"5px 0",color:"rgba(255,255,255,0.75)",fontSize:16,cursor:"pointer",width:"100%",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>＋</div>
          <div style={{width:10,height:44,background:"rgba(0,0,0,0.35)",margin:"4px auto",borderRadius:5,position:"relative"}}>
            <div style={{position:"absolute",top:"35%",left:-3,right:-3,height:7,background:"linear-gradient(90deg,#5090c0,#80c0e8)",borderRadius:4,cursor:"grab"}}/>
          </div>
          <div style={{padding:"5px 0",color:"rgba(255,255,255,0.75)",fontSize:16,cursor:"pointer",width:"100%",textAlign:"center",borderTop:"1px solid rgba(255,255,255,0.1)"}}>－</div>
        </div>
        <div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(180deg,#4a6f90,#162840)",border:"1px solid rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,0.5)",fontSize:17}}>🧍</div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          5. LEFT SIDEBAR
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{position:"absolute",top:TOP_H,left:0,bottom:STATUS_H,width:SIDEBAR_W,zIndex:1100,background:"linear-gradient(180deg,#1c2e3e 0%,#121e2c 100%)",borderRight:"2px solid #0a1825",display:"flex",flexDirection:"column",overflowY:"hidden",boxShadow:"3px 0 16px rgba(0,0,0,0.5)"}}>

        {/* SEARCH pane */}
        <PaneHeader icon="🔍" title="Search" collapsed={!searchOpen} onToggle={()=>setSearchOpen(p=>!p)}/>
        {searchOpen&&(
          <div style={{padding:"8px",borderBottom:"1px solid #0a1825",flexShrink:0}}>
            <form onSubmit={handleSidebarSearch} style={{display:"flex",gap:4,marginBottom:6}}>
              <input
                value={searchQuery}
                onChange={e=>setSearchQuery(e.target.value)}
                placeholder="Search location or lat, lng..."
                style={{flex:1,padding:"5px 8px",borderRadius:3,border:"1px solid #2a4a60",background:"rgba(255,255,255,0.07)",color:"#d0e8f8",fontSize:11,outline:"none",fontFamily:"'Segoe UI',sans-serif"}}
              />
              <button type="submit" disabled={searchLoading} style={{padding:"5px 9px",borderRadius:3,border:"1px solid #1a50a0",background:searchLoading?"#1a3060":"linear-gradient(180deg,#3a78c8,#1a50a0)",color:"#fff",cursor:searchLoading?"not-allowed":"pointer",fontSize:13,fontWeight:700,flexShrink:0}}>
                {searchLoading?"…":"↵"}
              </button>
            </form>
            <div style={{display:"flex",gap:4}}>
              <button style={{...gepBtn(),flex:1,fontSize:10}}>📍 Get Directions</button>
              <button style={{...gepBtn(),flex:1,fontSize:10}}>🕐 History</button>
            </div>
            {locationInfo&&(
              <div style={{marginTop:7,padding:"7px 8px",background:"rgba(40,100,200,0.14)",borderRadius:4,border:"1px solid rgba(40,100,200,0.35)"}}>
                <div style={{color:"#90c0f0",fontSize:11,fontWeight:700,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  📍 {locationInfo.loading?"Loading…":(locationInfo.name||"Unknown")}
                </div>
                {locationInfo.details&&<div style={{color:"#607888",fontSize:10}}>{locationInfo.details}</div>}
                <div style={{color:"#4a6878",fontSize:10,fontFamily:"Courier New,monospace",marginTop:2}}>{locationInfo.lat?.toFixed(5)}°, {locationInfo.lng?.toFixed(5)}°</div>
                <button onClick={handleCloseLocationInfo} style={{marginTop:4,fontSize:9,color:"#506070",cursor:"pointer",background:"none",border:"none",padding:0}}>✕ Clear</button>
              </div>
            )}
          </div>
        )}

        {/* PLACES pane */}
        <PaneHeader icon="📌" title="Places" collapsed={!placesOpen} onToggle={()=>setPlacesOpen(p=>!p)}/>
        {placesOpen&&(
          <div style={{flexShrink:0}}>
            <div style={{padding:"4px 6px",maxHeight:160,overflowY:"auto"}}>
              <TreeItem icon="⭐" label="My Places"/>
              <TreeItem icon="📁" label="Temporary Places" indent={1}/>
              {savedDrawings.map((d,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center"}}>
                  <div style={{flex:1,overflow:"hidden"}}>
                    <TreeItem icon={d.type==="path"?"〰️":d.type==="polygon"?"⬡":"📍"} label={d.name} indent={2}/>
                  </div>
                  <span onClick={()=>setSavedDrawings(p=>p.filter((_,j)=>j!==i))} style={{color:"#406070",cursor:"pointer",fontSize:10,padding:"0 6px",flexShrink:0}}>✕</span>
                </div>
              ))}
              {savedDrawings.length===0&&<div style={{paddingLeft:28,color:"#3a5060",fontSize:10,fontStyle:"italic",paddingTop:2,paddingBottom:2}}>No saved drawings</div>}
              {surveyMode&&route.length>0&&<TreeItem icon="📐" label={`Survey Route · ${route.length} pts`} active badge="LIVE" indent={1}/>}
            </div>
            <div style={{display:"flex",gap:3,padding:"4px 6px",background:"rgba(0,0,0,0.25)",borderTop:"1px solid #0a1825",borderBottom:"1px solid #0a1825"}}>
              <button style={{...gepBtn(),flex:1,fontSize:9,padding:"2px 4px"}}>📁 Folder</button>
              <button style={{...gepBtn(),flex:1,fontSize:9,padding:"2px 4px"}}>📍 Mark</button>
              <button style={{...gepBtn(),flex:1,fontSize:9,padding:"2px 4px"}}>〰️ Path</button>
              {savedDrawings.length>0&&<ExportTool savedDrawings={savedDrawings}/>}
            </div>
          </div>
        )}

        {/* LAYERS pane */}
        <PaneHeader icon="🗂️" title="Layers" collapsed={!layersOpen} onToggle={()=>setLayersOpen(p=>!p)}/>
        {layersOpen&&(
          <div style={{flexShrink:0}}>
            <div style={{padding:"4px 6px",maxHeight:210,overflowY:"auto"}}>
              <TreeItem icon={nightSwitchInfo?.isNight?"🌙":"☀️"} label="Auto Night Mode" check={nightModeAuto} onCheck={()=>setNightModeAuto(p=>!p)} onClick={()=>setNightModeAuto(p=>!p)} badge={nightModeAuto&&nightSwitchInfo?(nightSwitchInfo.isNight?"Night":"Day"):null}/>
              <div style={{height:1,background:"rgba(255,255,255,0.07)",margin:"3px 6px"}}/>
              {Object.entries(MAP_LAYERS).map(([name,layer])=>(
                <TreeItem key={name} icon={layer.icon} label={name} check={activeLayer===name} onCheck={()=>setActiveLayer(name)} onClick={()=>setActiveLayer(name)} active={activeLayer===name} indent={1}/>
              ))}
            </div>
          </div>
        )}

        {/* TOOLS pane */}
        <PaneHeader icon="🛠️" title="Tools" collapsed={!toolsOpen} onToggle={()=>setToolsOpen(p=>!p)}/>
        {toolsOpen&&(
          <div style={{flex:1,overflowY:"auto"}}>

            {/* Draw */}
            <div style={{padding:"8px 8px 6px",borderBottom:"1px solid #0a1825"}}>
              <div style={{color:"#607888",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:5}}>✏️ DRAW TOOL</div>
              <div style={{display:"flex",gap:3,marginBottom:6}}>
                {[["path","〰️","Path"],["polygon","⬡","Poly"],["marker","📍","Pin"]].map(([t,icon,lbl])=>(
                  <button key={t} onClick={()=>setDrawType(t)} style={{flex:1,padding:"4px 2px",borderRadius:3,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:1,background:drawType===t?"linear-gradient(180deg,#3a78c8 0%,#1a50a0 100%)":"linear-gradient(180deg,#2a3e52 0%,#1a2e3e 100%)",border:drawType===t?"1px solid #1a50a0":"1px solid #2a3e52",color:drawType===t?"#fff":"#7090a8",fontSize:10,fontWeight:600,fontFamily:"'Segoe UI',sans-serif"}}>
                    <span style={{fontSize:14}}>{icon}</span><span>{lbl}</span>
                  </button>
                ))}
              </div>
              {!drawMode?(
                <button onClick={()=>{setDrawMode(true);setDrawPoints([]);}} style={{width:"100%",padding:"5px",borderRadius:3,cursor:"pointer",background:"linear-gradient(180deg,#e08020,#a85010)",border:"1px solid #a85010",color:"#fff",fontWeight:700,fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>▶ Start Drawing</button>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <div style={{padding:"4px 6px",background:"rgba(230,130,40,0.15)",border:"1px solid #c87020",borderRadius:3,color:"#e09040",fontSize:10,textAlign:"center",fontWeight:600}}>
                    {drawType==="marker"?"Click map to place":`${drawPoints.length} pts — click map`}
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={finishDrawing} style={{flex:1,padding:"5px",borderRadius:3,border:"1px solid #186828",background:"linear-gradient(180deg,#38a050,#186828)",color:"#fff",fontWeight:700,fontSize:10,cursor:"pointer"}}>✅ Done</button>
                    <button onClick={cancelDrawing} style={{flex:1,padding:"5px",borderRadius:3,border:"1px solid #8a1010",background:"linear-gradient(180deg,#c03030,#8a1010)",color:"#fff",fontWeight:700,fontSize:10,cursor:"pointer"}}>✖ Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* Measure */}
            <div style={{padding:"8px 8px 6px",borderBottom:"1px solid #0a1825"}}>
              <div style={{color:"#607888",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:5}}>📏 MEASURE</div>
              {!measureMode?(
                <button onClick={()=>setMeasureMode(true)} style={{width:"100%",padding:"5px",borderRadius:3,cursor:"pointer",background:"linear-gradient(180deg,#2880a8,#1a5878)",border:"1px solid #1a5878",color:"#fff",fontWeight:700,fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>📐 Start Measuring</button>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <div style={{padding:"7px 8px",background:"rgba(230,190,20,0.1)",border:"1px solid #b89800",borderRadius:3,textAlign:"center"}}>
                    <div style={{color:"#706040",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:2}}>TOTAL DISTANCE</div>
                    <div style={{color:"#d4a800",fontSize:17,fontWeight:800,fontFamily:"Courier New,monospace"}}>{measurePoints.length<2?"—":formatDist(totalDistance,measureUnit)}</div>
                    <div style={{color:"#605840",fontSize:9,marginTop:1}}>{measurePoints.length} point{measurePoints.length!==1?"s":""}</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:2}}>
                    {[["auto","Auto"],["km","km"],["m","m"],["cm","cm"],["mi","mi"],["yd","yd"],["ft","ft"],["nmi","nmi"]].map(([u,lbl])=>(
                      <button key={u} onClick={()=>setMeasureUnit(u)} style={{padding:"3px 5px",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:600,background:measureUnit===u?"linear-gradient(180deg,#3a78c8 0%,#1a50a0 100%)":"linear-gradient(180deg,#2a3e52 0%,#1a2e3e 100%)",border:measureUnit===u?"1px solid #1a50a0":"1px solid #2a3e52",color:measureUnit===u?"#fff":"#7090a8",fontFamily:"'Segoe UI',sans-serif"}}>{measureUnit===u?"✓ ":""}{lbl}</button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>{setMeasurePoints([]);measureLayersRef.current.forEach(l=>l.remove());measureLayersRef.current=[];if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}}} style={{flex:1,padding:"4px",borderRadius:3,border:"1px solid #2a3e52",background:"linear-gradient(180deg,#2a3e52,#1a2e3e)",color:"#8098a8",fontSize:10,cursor:"pointer"}}>🔄 Reset</button>
                    <button onClick={clearMeasure} style={{flex:1,padding:"4px",borderRadius:3,border:"1px solid #8a1010",background:"linear-gradient(180deg,#c03030,#8a1010)",color:"#fff",fontWeight:700,fontSize:10,cursor:"pointer"}}>✖ Done</button>
                  </div>
                </div>
              )}
            </div>

            {/* Survey */}
            <div style={{padding:"8px 8px 6px",borderBottom:"1px solid #0a1825"}}>
              <div style={{color:"#607888",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:5}}>📐 SURVEY</div>
              <button onClick={handleToggleSurvey} style={{width:"100%",padding:"5px",borderRadius:3,cursor:"pointer",background:surveyMode?"linear-gradient(180deg,#c03030,#8a1010)":"linear-gradient(180deg,#2060a8,#1a3888)",border:surveyMode?"1px solid #8a1010":"1px solid #1a3888",color:"#fff",fontWeight:700,fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>{surveyMode?"⏹ Stop Survey":"▶ Start Survey"}</button>
              {surveyMode&&<div style={{marginTop:5,padding:"4px 6px",background:"rgba(200,30,30,0.14)",border:"1px solid #7a1010",borderRadius:3,color:"#f08080",fontSize:10,textAlign:"center"}}>● RECORDING · {route.length} point{route.length!==1?"s":""}</div>}
            </div>

            {/* Files */}
            <div style={{padding:"8px 8px 6px",borderBottom:"1px solid #0a1825"}}>
              <div style={{color:"#607888",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:5}}>📂 FILES</div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <label style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:"linear-gradient(180deg,#2a3e52,#1a2e3e)",borderRadius:3,border:"1px solid #2a4a60",cursor:"pointer",color:"#90b0c8",fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>
                  📂 {kmlLoading?"Loading…":kmlName?kmlName.slice(0,18):"Open KML File"}
                  <input type="file" accept=".kml" onChange={handleKMLUpload} style={{display:"none"}}/>
                </label>
                <label style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:"linear-gradient(180deg,#2a3e52,#1a2e3e)",borderRadius:3,border:"1px solid #2a4a60",cursor:"pointer",color:"#90b0c8",fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>
                  📊 Upload KMZ / CSV
                  <input type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{display:"none"}}/>
                </label>
              </div>
            </div>

            {/* 3D Globe */}
            <div style={{padding:"8px 8px 10px"}}>
              <button onClick={()=>setShow3D(true)} style={{width:"100%",padding:"7px 10px",borderRadius:3,cursor:"pointer",background:"linear-gradient(135deg,#7c3aed 0%,#0b5ed7 100%)",border:"1px solid #5020b0",color:"#fff",fontWeight:700,fontSize:12,fontFamily:"'Segoe UI',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7,boxShadow:"0 2px 10px rgba(124,58,237,0.3)"}}>
                <span style={{fontSize:16}}>🌍</span><span>Switch to 3D Globe</span>
              </button>
              {savedDrawings.length>0&&<div style={{marginTop:5,color:"#6060c0",fontSize:9,textAlign:"center"}}>✓ {savedDrawings.length} drawing{savedDrawings.length!==1?"s":""} will carry over</div>}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          6. STATUS BAR
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:STATUS_H,zIndex:1100,background:"linear-gradient(180deg,#1e3040 0%,#0e1e2c 100%)",borderTop:"1px solid #2a4558",display:"flex",alignItems:"center",padding:"0 10px",gap:16,fontFamily:"Courier New,monospace",fontSize:11,color:"#8aabb8",userSelect:"none"}}>
        {mousePos?(
          <>
            <span style={{color:"#c0d8e8"}}>{toDMS(mousePos.lat,"N","S")}</span>
            <span style={{color:"#c0d8e8"}}>{toDMS(mousePos.lng,"E","W")}</span>
            <span style={{color:"#405868"}}>({mousePos.lat.toFixed(5)}, {mousePos.lng.toFixed(5)})</span>
          </>
        ):<span style={{color:"#2a4050"}}>Move mouse over map…</span>}
        <div style={{flex:1}}/>
        <span style={{color:"#607888"}}>Zoom {mapZoom}</span>
        <span style={{color:"#4488c0"}}>📷</span>
        <span style={{color:"#70a8d0"}}>Eye alt {formatAlt(zoomToAltitude(mapZoom))}</span>
        {nightModeAuto&&<span style={{color:"#8080c0",fontFamily:"'Segoe UI',sans-serif",fontSize:10}}>{nightSwitchInfo?.isNight?"🌙 Night Mode":"☀️ Day Mode"}</span>}
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <div style={{width:56,height:7,background:"rgba(0,0,0,0.4)",borderRadius:3,overflow:"hidden",border:"1px solid #2a4558"}}>
            <div style={{width:"100%",height:"100%",background:"linear-gradient(90deg,#1a5080,#40a0d0,#1a5080)",backgroundSize:"200% 100%",animation:"gepStream 2s linear infinite",borderRadius:3}}/>
          </div>
          <span style={{color:"#305060",fontSize:9,fontFamily:"'Segoe UI',sans-serif"}}>Streaming</span>
        </div>
        <span style={{color:"#2a4050",fontFamily:"'Segoe UI',sans-serif",fontSize:10}}>© OpenStreetMap / Esri</span>
      </div>

      {/* 7. LOCATION INFO CARD */}
      {locationInfo&&(
        <div style={{position:"absolute",top:TOP_H+12,right:90,width:310,zIndex:1050,background:"rgba(12,22,34,0.97)",backdropFilter:"blur(14px)",borderRadius:6,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.65)",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'Segoe UI',Tahoma,sans-serif",animation:"gepSlideIn 0.2s ease"}}>
          {locationInfo.photo?(
            <div style={{position:"relative",height:150,overflow:"hidden"}}>
              <img src={locationInfo.photo} alt={locationInfo.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(12,22,34,1) 0%,transparent 55%)"}}/>
              <div style={{position:"absolute",bottom:10,left:12,color:"#fff",fontWeight:700,fontSize:16,textShadow:"0 2px 8px rgba(0,0,0,0.8)"}}>{locationInfo.name||locationInfo.label?.split(",")?.[0]}</div>
              <button onClick={handleCloseLocationInfo} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,0.6)",border:"none",color:"#fff",borderRadius:"50%",width:26,height:26,cursor:"pointer",fontSize:13}}>✕</button>
            </div>
          ):(
            <div style={{padding:"11px 13px 8px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
              <div>
                <div style={{color:"#d0e8f8",fontWeight:700,fontSize:14,marginBottom:2}}>{locationInfo.loading?"Loading…":(locationInfo.name||locationInfo.label?.split(",")?.[0])}</div>
                {locationInfo.details&&!locationInfo.loading&&<div style={{color:"#607888",fontSize:11}}>{locationInfo.details}</div>}
              </div>
              <button onClick={handleCloseLocationInfo} style={{background:"none",border:"none",color:"#506070",cursor:"pointer",fontSize:17,padding:0,marginLeft:8}}>✕</button>
            </div>
          )}
          <div style={{padding:locationInfo.photo?"10px 13px 13px":"8px 13px 13px"}}>
            <div style={{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",background:"rgba(255,255,255,0.04)",borderRadius:4,marginBottom:8,border:"1px solid rgba(255,255,255,0.06)"}}>
              <span>📍</span>
              <div>
                <div style={{color:"#c0d8e8",fontSize:11,fontFamily:"Courier New,monospace",fontWeight:600}}>{locationInfo.lat?.toFixed(6)}°, {locationInfo.lng?.toFixed(6)}°</div>
                {locationInfo.plusCode&&<div style={{color:"#405060",fontSize:9,marginTop:1}}>{locationInfo.plusCode}</div>}
              </div>
            </div>
            {locationInfo.fullAddress&&(
              <div style={{display:"flex",gap:7,padding:"6px 8px",background:"rgba(255,255,255,0.04)",borderRadius:4,marginBottom:8,border:"1px solid rgba(255,255,255,0.06)"}}>
                <span>🌏</span>
                <div style={{color:"#7090a0",fontSize:11,lineHeight:1.5}}>{locationInfo.fullAddress}</div>
              </div>
            )}
            {locationInfo.loading?<div style={{color:"#405060",fontSize:11,fontStyle:"italic"}}>⏳ Fetching location info…</div>
              :locationInfo.description?<div style={{color:"#90b0c0",fontSize:11,lineHeight:1.6,maxHeight:120,overflowY:"auto"}}>{locationInfo.description.slice(0,400)}{locationInfo.description.length>400?"…":""}</div>
              :null}
            {locationInfo.wikiUrl&&(
              <a href={locationInfo.wikiUrl} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:10,padding:"5px 10px",background:"rgba(50,90,130,0.2)",borderRadius:4,color:"#5090c0",fontSize:11,textDecoration:"none",fontWeight:600,border:"1px solid rgba(50,90,130,0.35)"}}>
                🌐 Read more on Wikipedia ↗
              </a>
            )}
          </div>
        </div>
      )}

      {/* 8. NAME MODAL */}
      {showNameModal&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#1a2e3e",borderRadius:6,padding:22,width:290,boxShadow:"0 8px 40px rgba(0,0,0,0.65)",border:"1px solid #2a4558"}}>
            <div style={{color:"#c0d8e8",fontWeight:700,fontSize:14,marginBottom:3,fontFamily:"'Segoe UI',sans-serif"}}>Name this {pendingType}</div>
            <div style={{color:"#507080",fontSize:11,marginBottom:12,fontFamily:"'Segoe UI',sans-serif"}}>{pendingPoints.length} point{pendingPoints.length!==1?"s":""} recorded</div>
            <input autoFocus value={pendingName} onChange={e=>setPendingName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmDrawing()}
              placeholder={pendingType==="marker"?"e.g. Granite Gneiss":"e.g. Survey Path A"}
              style={{width:"100%",padding:"7px 10px",borderRadius:3,border:"1px solid #2a4a60",background:"rgba(255,255,255,0.07)",color:"#d0e8f8",fontSize:13,marginBottom:13,outline:"none",boxSizing:"border-box",fontFamily:"'Segoe UI',sans-serif"}}/>
            <div style={{display:"flex",gap:7}}>
              <button onClick={confirmDrawing} style={{flex:1,padding:"8px",borderRadius:3,border:"1px solid #1a3888",background:"linear-gradient(180deg,#2060a8,#1a3888)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'Segoe UI',sans-serif"}}>Save</button>
              <button onClick={cancelDrawing} style={{flex:1,padding:"8px",borderRadius:3,border:"1px solid #2a3e52",background:"linear-gradient(180deg,#2a3e52,#1a2e3e)",color:"#8098a8",fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"'Segoe UI',sans-serif"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* 9. ABOUT MODAL */}
      {showAbout&&(
        <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#1a2e3e",borderRadius:8,padding:28,width:340,boxShadow:"0 8px 40px rgba(0,0,0,0.65)",border:"1px solid #2a4558",fontFamily:"'Segoe UI',sans-serif"}}>
            <div style={{fontSize:32,textAlign:"center",marginBottom:8}}>🗺️</div>
            <div style={{color:"#c0d8e8",fontWeight:700,fontSize:18,textAlign:"center",marginBottom:6}}>SurveyMap Pro</div>
            <div style={{color:"#607888",fontSize:12,textAlign:"center",marginBottom:16}}>A professional GIS-style web mapping tool built with React + Leaflet</div>
            <div style={{color:"#405060",fontSize:11,lineHeight:1.8}}>
              <div>🛰️ Multiple tile layers (Esri, OSM, CartoDB)</div>
              <div>✏️ Draw paths, polygons and markers</div>
              <div>📏 Distance measurement tool</div>
              <div>📐 Survey route recording</div>
              <div>📂 KML / KMZ / CSV import</div>
              <div>🌍 3D Globe view</div>
              <div>🌙 Auto day / night mode</div>
            </div>
            <button onClick={()=>setShowAbout(false)} style={{marginTop:18,width:"100%",padding:8,borderRadius:3,border:"1px solid #2a4a60",background:"linear-gradient(180deg,#2060a8,#1a3888)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Close</button>
          </div>
        </div>
      )}

      {/* 10. SHORTCUTS MODAL */}
      {showShortcuts&&(
        <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#1a2e3e",borderRadius:8,padding:24,width:340,boxShadow:"0 8px 40px rgba(0,0,0,0.65)",border:"1px solid #2a4558",fontFamily:"'Segoe UI',sans-serif"}}>
            <div style={{color:"#c0d8e8",fontWeight:700,fontSize:15,marginBottom:14}}>⌨️ Keyboard Shortcuts</div>
            {[
              ["Escape","Cancel current draw / measure"],
              ["Click map","Add point (draw / measure / survey)"],
              ["Enter (name modal)","Save drawing"],
              ["Scroll wheel","Zoom in / out"],
              ["Click + Drag","Pan map"],
            ].map(([key,desc])=>(
              <div key={key} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1a3040"}}>
                <span style={{color:"#3a78c8",fontWeight:700,fontSize:11,fontFamily:"Courier New,monospace"}}>{key}</span>
                <span style={{color:"#7090a0",fontSize:11}}>{desc}</span>
              </div>
            ))}
            <button onClick={()=>setShowShortcuts(false)} style={{marginTop:16,width:"100%",padding:8,borderRadius:3,border:"1px solid #2a4a60",background:"linear-gradient(180deg,#2060a8,#1a3888)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}