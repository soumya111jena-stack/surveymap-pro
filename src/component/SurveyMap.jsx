import React, { useState, useRef, useCallback, useEffect } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, ZoomControl, WMSTileLayer, useMap } from "react-leaflet";
import AddSearch from "./search/AddSearch";
import LiveGPS from "./map/LiveGPS";
import BoundaryLayer from "./map/BoundaryLayer";
import MapTracker from "./map/MapTracker";
import NavControls from "./map/NavControls";
import MeasureTool from "./tools/MeasureTool";
import DrawTool from "./tools/DrawTool";
import SurveyClick from "./tools/SurveyClick";
import KMLLoader from "./loaders/KMLLoader";
import KMZLoader from "./loaders/KMZLoader";
import CSVLoader from "./loaders/CSVLoader";
import CompassRose from "./map/CompassRose";
import { haversine, formatDist } from "./map/measureUtils";
import { useNightModeAutoSwitch } from "./map/useNightModeAutoSwitch";
import Globe3DView from "./Globe3DView";
import L from "leaflet";
import "./map/plugins/Leaflet.Graticule";


const MAP_LAYERS = {
  Satellite:            { url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",        attribution:"© Esri",                  icon:"🛰️" },
  Street:               { url:"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",                                                   attribution:"© OpenStreetMap",         icon:"🗺️" },
  Terrain:              { url:"https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",                                                     attribution:"© OpenTopoMap",           icon:"⛰️" },
  Hillshade:            { url:"https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", attribution:"© ESRI",             icon:"🗻" },
  Contour:              { url:"https://tiles.stadiamaps.com/tiles/stamen_terrain_lines/{z}/{x}/{y}.png",                              attribution:"© Stadia Maps",           icon:"📈" },
  "Satellite + Labels": { url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",        overlayUrl:"https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", attribution:"© Esri", icon:"🏷️" },
  Dark:                 { url:"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",                                        attribution:"© CartoDB",               icon:"🌑" },
  Light:                { url:"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",                                       attribution:"© CartoDB",               icon:"☀️" },
  "WMS – States demo":  { type:"wms", url:"https://ahocevar.com/geoserver/wms", layers:"topp:states", format:"image/png", transparent:true, attribution:"GeoServer demo WMS", icon:"🛰️" },
};

function zoomToAltitude(zoom){const a={1:147e6,2:73e6,3:36e6,4:18e6,5:9e6,6:4500000,7:2250000,8:1100000,9:550000,10:275000,11:137000,12:68000,13:34000,14:17000,15:8500,16:4200,17:2100,18:1050,19:525,20:262};return a[Math.round(zoom)]||34000;}
function formatAlt(m){return m>=1000?(m/1000).toFixed(0)+" km":m.toFixed(0)+" m";}
function toDMS(val,pos,neg){const a=Math.abs(val),d=Math.floor(a),m=Math.floor((a-d)*60),s=((a-d-m/60)*3600).toFixed(2);return `${d}°${m}'${s}"${val>=0?pos:neg}`;}
function toPlusCode(lat,lng){const ld=Math.floor(Math.abs(lat)),lo=Math.floor(Math.abs(lng));const lm=Math.floor((Math.abs(lat)-ld)*60),nm=Math.floor((Math.abs(lng)-lo)*60);return `${ld}°${lm}'${lat>=0?"N":"S"} ${lo}°${nm}'${lng>=0?"E":"W"}`;}

// ── Zoom level by place type ──────────────────────────────────────────────
function zoomForType(type) {
  const t = (type || "").toLowerCase().replace(/_/g, " ");
  if (["country"].some(k => t.includes(k)))                           return 6;
  if (["state","administrative area level 1"].some(k => t.includes(k))) return 8;
  if (["administrative area level 2","district","county"].some(k => t.includes(k))) return 10;
  if (["city","municipality"].some(k => t === k))                     return 12;
  if (["town"].includes(t))                                           return 13;
  if (["village","hamlet","suburb","neighbourhood","quarter",
       "residential","locality"].some(k => t.includes(k)))           return 14;
  if (["street","road","pedestrian","footway","route"].some(k => t.includes(k))) return 16;
  if (["amenity","shop","office","restaurant","cafe","hotel",
       "hospital","bank","pharmacy","school","college","university",
       "place of worship","temple","church","mosque",
       "point of interest","establishment"].some(k => t.includes(k))) return 17;
  if (["postcode"].includes(t))                                       return 13;
  return 14;
}

// ── MapFlyController — lives inside MapContainer so it can call useMap() ─
// Watches flyTarget prop; when it changes, flies the Leaflet map there.
function MapFlyController({ flyTarget }) {
  const map = useMap();
  useEffect(() => {
    if (!flyTarget) return;
    const { lat, lng, zoom, bbox } = flyTarget;
    if (isNaN(lat) || isNaN(lng)) return;

    if (bbox) {
      // Use bounding box to fit the whole place (city, district, state)
      try {
        const L = window.L;
        if (L) {
          const bounds = L.latLngBounds(
            [parseFloat(bbox[0]), parseFloat(bbox[2])],
            [parseFloat(bbox[1]), parseFloat(bbox[3])]
          );
          if (bounds.isValid()) {
            map.flyToBounds(bounds, { padding: [40, 40], maxZoom: zoom || 16, duration: 1.4 });
            return;
          }
        }
      } catch (_) {}
    }
    map.flyTo([lat, lng], zoom, { animate: true, duration: 1.4 });
  }, [flyTarget]); // eslint-disable-line

  return null;
}
function MapGrid() {
  const map = useMap();

  useEffect(() => {
    const gridLayer = L.graticule({
      interval: 1,
      style: {
        color: "#ffffff",
        weight: 1,
        opacity: 0.6
      }
    });

    gridLayer.addTo(map);

    return () => {
      map.removeLayer(gridLayer);
    };
  }, [map]);

  return null;
}
// ── Multi-source geocoder (Google → Nominatim → city fallback) ───────────
const INDIA_CITIES = {
  bhubaneswar:{lat:20.2961,lng:85.8245}, cuttack:{lat:20.4625,lng:85.8828},
  puri:{lat:19.8135,lng:85.8312},        kolkata:{lat:22.5726,lng:88.3639},
  delhi:{lat:28.6139,lng:77.2090},       mumbai:{lat:19.0760,lng:72.8777},
  bangalore:{lat:12.9716,lng:77.5946},   hyderabad:{lat:17.3850,lng:78.4867},
  chennai:{lat:13.0827,lng:80.2707},     pune:{lat:18.5204,lng:73.8567},
  ahmedabad:{lat:23.0225,lng:72.5714},   surat:{lat:21.1702,lng:72.8311},
  jaipur:{lat:26.9124,lng:75.7873},      lucknow:{lat:26.8467,lng:80.9462},
  patna:{lat:25.5941,lng:85.1376},       ranchi:{lat:23.3441,lng:85.3096},
  visakhapatnam:{lat:17.6868,lng:83.2185}, nagpur:{lat:21.1458,lng:79.0882},
  indore:{lat:22.7196,lng:75.8577},      chandigarh:{lat:30.7333,lng:76.7794},
  coimbatore:{lat:11.0168,lng:76.9558},  kochi:{lat:9.9312,lng:76.2673},
  guwahati:{lat:26.1445,lng:91.7362},    bhopal:{lat:23.2599,lng:77.4126},
  raipur:{lat:21.2514,lng:81.6296},      agra:{lat:27.1767,lng:78.0081},
  varanasi:{lat:25.3176,lng:82.9739},    dehradun:{lat:30.3165,lng:78.0322},
};

function extractCity(q) {
  const lower = q.toLowerCase();
  for (const [city, coords] of Object.entries(INDIA_CITIES)) {
    if (lower.includes(city)) return { city, coords };
  }
  return null;
}

async function geocodeForMap(q) {
  const parts = q.split(",").map(s => s.trim()).filter(Boolean);
  const isSingle = parts.length <= 2;
  const cityMatch = extractCity(q);

  // ── 1. Google Geocoding (most accurate, handles POIs & villages) ─────
  for (const proxy of [
    `https://corsproxy.io/?url=`,
    `https://api.allorigins.win/raw?url=`,
  ]) {
    try {
      const params = new URLSearchParams({ address: q, region: "in", language: "en" });
      if (cityMatch && !isSingle) {
        const c = cityMatch.coords;
        params.set("bounds", `${c.lat - 0.4},${c.lng - 0.4}|${c.lat + 0.4},${c.lng + 0.4}`);
      }
      const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;
      const res = await fetch(`${proxy}${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const d = await res.json();
      if (d.status === "OK" && d.results?.length) {
        const r = d.results[0];
        return {
          lat:  r.geometry.location.lat,
          lng:  r.geometry.location.lng,
          name: r.address_components?.[0]?.long_name || q.split(",")[0],
          type: r.types?.[0] || "place",
          display_name: r.formatted_address,
          bbox: r.geometry.viewport ? [
            String(r.geometry.viewport.southwest.lat),
            String(r.geometry.viewport.northeast.lat),
            String(r.geometry.viewport.southwest.lng),
            String(r.geometry.viewport.northeast.lng),
          ] : null,
          source: "google",
        };
      }
    } catch (_) { continue; }
  }

  // ── 2. Nominatim OSM ─────────────────────────────────────────────────
  const nominatim = async (query, extra = {}) => {
    const params = new URLSearchParams({
      q: query, format: "json", limit: "5",
      polygon_geojson: "1", addressdetails: "1",
      "accept-language": "en", countrycodes: "in", ...extra,
    });
    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    for (const px of [
      `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ]) {
      try {
        const res = await fetch(px, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data) && data.length) return data[0];
      } catch (_) { continue; }
    }
    return null;
  };

  // Try with city viewbox for complex queries
  let r = null;
  if (cityMatch && !isSingle) {
    const c = cityMatch.coords;
    r = await nominatim(q, {
      viewbox: `${c.lng - 0.4},${c.lat + 0.4},${c.lng + 0.4},${c.lat - 0.4}`,
      bounded: "1",
    });
  }
  if (!r) r = await nominatim(q);
  // Progressive simplification fallback
  if (!r && parts.length > 1) {
    for (let skip = 1; skip < Math.min(parts.length, 4); skip++) {
      r = await nominatim(parts.slice(skip).join(", "));
      if (r) break;
    }
  }

  if (r) {
    return {
      lat:  parseFloat(r.lat),
      lng:  parseFloat(r.lon),
      name: r.display_name?.split(",")?.[0] || q.split(",")[0],
      type: r.type || r.class || "place",
      display_name: r.display_name,
      bbox: r.boundingbox || null,
      geojson: r.geojson || null,
      source: "osm",
    };
  }

  // ── 3. City center fallback ───────────────────────────────────────────
  if (cityMatch) {
    return {
      lat:  cityMatch.coords.lat,
      lng:  cityMatch.coords.lng,
      name: cityMatch.city.charAt(0).toUpperCase() + cityMatch.city.slice(1),
      type: "city",
      display_name: `${cityMatch.city}, India`,
      source: "fallback",
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────

const MENU_DEFS = {
  File:[
    {label:"📂 Open KML…",action:"openKML"},
    {label:"📊 Open KMZ / CSV…",action:"openExtra"},
    {divider:true},
    {label:"💾 Export Drawings…",action:"export"},
    {divider:true},
    {label:"🔄 Reset / Clear All",action:"resetAll"}
  ],
  Edit:[
    {label:"✏️ Start Drawing",action:"startDraw"},
    {label:"🗑️ Cancel Drawing",action:"cancelDraw"},
    {divider:true},
    {label:"📏 Start Measuring",action:"startMeasure"},
    {label:"✖ Stop Measuring",action:"stopMeasure"},
    {divider:true},
    {label:"🗑️ Delete All Drawings",action:"deleteDrawings"}
  ],
  View:[
    {label:"🛰️ Satellite",action:"layerSatellite"},
    {label:"🗺️ Street",action:"layerStreet"},
    {label:"⛰️ Terrain",action:"layerTerrain"},
    {label:"🌑 Dark",action:"layerDark"},
    {label:"☀️ Light",action:"layerLight"},
    {label:"🏷️ Satellite + Labels",action:"layerSatLabels"},
    {divider:true},
    {label:"🌍 Switch to 3D Globe",action:"show3D"},
    {divider:true},
    {label:"🌙 Toggle Auto Night Mode",action:"toggleNight"}
  ],
  Tools:[
    {label:"✏️ Draw Tool",action:"startDraw"},
    {label:"📏 Measure Tool",action:"startMeasure"},
    {label:"📐 Survey Tool",action:"toggleSurvey"},
    {divider:true},
    {label:"🌍 3D Globe View",action:"show3D"}
  ],
  Add:[
    {label:"📍 Add Marker",action:"drawMarker"},
    {label:"〰️ Add Path",action:"drawPath"},
    {label:"⬡ Add Polygon",action:"drawPoly"},
    {divider:true},
    {label:"📂 Load KML File",action:"openKML"},
    {label:"📊 Load KMZ / CSV",action:"openExtra"}
  ],
  Help:[
    {label:"📖 About SurveyMap Pro",action:"about"},
    {label:"⌨️ Keyboard Shortcuts",action:"shortcuts"},
    {divider:true},
    {label:"🌐 OpenStreetMap ↗",action:"osmLink"},
    {label:"🌐 Leaflet Docs ↗",action:"leafletLink"}
  ],
};

function PaneHeader({icon,title,collapsed,onToggle}){
  return(
    <div onClick={onToggle} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",background:"linear-gradient(135deg, #233a4e 0%, #1a2c3c 100%)",borderBottom:"1px solid #0e1a24",borderTop:"1px solid #2d4458",cursor:"pointer",userSelect:"none",flexShrink:0,minHeight:34,transition:"background 0.2s"}}
      onMouseEnter={e=>e.currentTarget.style.background="linear-gradient(135deg, #2a4358 0%, #1f3444 100%)"}
      onMouseLeave={e=>e.currentTarget.style.background="linear-gradient(135deg, #233a4e 0%, #1a2c3c 100%)"}>
      <span style={{color:"#80b0d0",fontSize:10,width:12}}>{collapsed?"▶":"▼"}</span>
      <span style={{fontSize:14}}>{icon}</span>
      <span style={{color:"#d0e8f8",fontSize:11,fontWeight:600,letterSpacing:"0.03em",flex:1,fontFamily:"'Segoe UI',sans-serif",textTransform:"uppercase"}}>{title}</span>
    </div>
  );
}

function TreeItem({icon,label,active,check,onCheck,onClick,indent=0,badge=null}){
  return(
    <div onClick={onClick} style={{display:"flex",alignItems:"center",gap:5,padding:`4px 8px 4px ${10+indent*16}px`,borderRadius:4,cursor:"pointer",margin:"1px 4px",background:active?"linear-gradient(90deg, rgba(58,120,200,0.35) 0%, rgba(40,90,160,0.2) 100%)":"transparent",borderLeft:active?"2px solid #3a78c8":"2px solid transparent",minHeight:30,transition:"all 0.15s"}}
      onMouseEnter={e=>{if(!active)e.currentTarget.style.background="rgba(255,255,255,0.06)";}}
      onMouseLeave={e=>{e.currentTarget.style.background=active?"linear-gradient(90deg, rgba(58,120,200,0.35) 0%, rgba(40,90,160,0.2) 100%)":"transparent";}}>
      {check!==undefined&&<input type="checkbox" checked={check} onChange={e=>{e.stopPropagation();if(onCheck)onCheck();}} style={{width:14,height:14,accentColor:"#3a78c8",cursor:"pointer",flexShrink:0}}/>}
      <span style={{fontSize:14,flexShrink:0}}>{icon}</span>
      <span style={{color:active?"#fff":"#b0c8da",fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"'Segoe UI',sans-serif"}}>{label}</span>
      {badge&&<span style={{fontSize:8,padding:"1px 6px",borderRadius:10,background:"rgba(58,120,200,0.25)",color:"#80b8ff",flexShrink:0,fontWeight:600}}>{badge}</span>}
    </div>
  );
}

export default function SurveyMap(){
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
 

  // ── NEW: flyTarget drives MapFlyController inside <MapContainer> ─────────
  // Using _ts so updating to the same lat/lng still triggers useEffect
  const [flyTarget,setFlyTarget]=useState(null);

  useNightModeAutoSwitch({enabled:nightModeAuto,activeLayer,setActiveLayer,nightLayer:"Dark",dayLayer:"Satellite + Labels",onSwitch:({isNight})=>setNightSwitchInfo({isNight})});

  const onKmlDone=useCallback(()=>setKmlLoading(false),[]);
  const onMouseMove=useCallback(p=>setMousePos(p),[]);
  const onZoomChange=useCallback(z=>setMapZoom(z),[]);

  // ── FIXED: sidebar search now geocodes and flies the 2D map ─────────────
  async function handleSidebarSearch(e) {
    e?.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);

    try {
      // Handle raw coordinates e.g. "20.2961, 85.8245"
      const coordRx = /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/;
      const coordMatch = q.match(coordRx);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]), lng = parseFloat(coordMatch[2]);
        if (!isNaN(lat) && !isNaN(lng)) {
          setFlyTarget({ lat, lng, zoom: 16, _ts: Date.now() });
          setLocationInfo({ lat, lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, details: "Coordinates", loading: false });
          return;
        }
      }

      const result = await geocodeForMap(q);
      if (!result) {
        alert(`"${q}" — location not found. Try adding city name or checking spelling.`);
        return;
      }

      const zoom = zoomForType(result.type);

      // ── Fly the 2D Leaflet map via flyTarget state ──────────────────
      setFlyTarget({ lat: result.lat, lng: result.lng, zoom, bbox: result.bbox, _ts: Date.now() });

      // ── Show location info card ─────────────────────────────────────
      setLocationInfo({
        lat: result.lat, lng: result.lng,
        name: result.name,
        details: result.display_name,
        loading: false,
        description: null, wikiUrl: null, photo: null,
      });

      // Set boundary overlay if OSM returned geojson
      if (result.geojson) setBoundaryGeojson(result.geojson);

      // Also trigger AddSearch marker placement if available
      if (searchFnRef.current) {
        try { await searchFnRef.current(q); } catch (_) {}
      }

      // Fetch Wikipedia info in background — card already visible
      try {
        const wr = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(result.name)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (wr.ok) {
          const w = await wr.json();
          if (w.type !== "disambiguation" && w.extract?.length > 30) {
            setLocationInfo(prev => prev ? {
              ...prev,
              description: w.extract,
              wikiUrl: w.content_urls?.desktop?.page,
              photo: w.thumbnail?.source || null,
            } : null);
          }
        }
      } catch (_) {}

    } finally {
      setSearchLoading(false);
    }
  }

  function clearMeasure(){
    measureLayersRef.current.forEach(l=>l.remove());measureLayersRef.current=[];
    if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}
    if(measureLineRef._preview){measureLineRef._preview.remove();measureLineRef._preview=null;}
    setMeasurePoints([]);setMeasureMode(false);
  }
  function handleExtraUpload(e){const file=e.target.files[0];if(!file)return;const ext=file.name.split(".").pop().toLowerCase();if(ext!=="kmz"&&ext!=="csv"){alert("Please upload a KMZ or CSV file.");e.target.value="";return;}setExtraFile(file);setExtraFileType(ext);e.target.value="";}
  const totalDistance=measurePoints.length>=2?measurePoints.reduce((sum,p,i)=>i===0?0:sum+haversine(measurePoints[i-1],p),0):0;
  function handleKMLUpload(e){const file=e.target.files[0];if(!file)return;setKmlLoading(true);setKmlName(file.name);setKmlFile(file);e.target.value="";}
  function handleToggleSurvey(){if(surveyMode){setRoute([]);setStart(null);setEnd(null);if(polylineRef.current){polylineRef.current.remove();polylineRef.current=null;}}setSurveyMode(p=>!p);}

  async function reverseGeocode(lat,lng){try{const res=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,{headers:{"Accept-Language":"en"},signal:AbortSignal.timeout(6000)});if(!res.ok)return null;return await res.json();}catch{return null;}}

  const handleLocationFound=useCallback(async({lat,lng,label,raw})=>{
    setLocationInfo({lat,lng,label,loading:true,photo:null,description:null});
    // Also fly the map when AddSearch triggers a result
    setFlyTarget({ lat, lng, zoom: 15, _ts: Date.now() });

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
      case "openKML": kmlInputRef.current?.click(); break;
      case "openExtra": extraInputRef.current?.click(); break;
      case "export": document.querySelector("[data-export-btn]")?.click(); break;
      case "resetAll": if(window.confirm("Reset everything?")){setSavedDrawings([]);cancelDrawing();clearMeasure();setRoute([]);setSurveyMode(false);} break;
      case "startDraw": setDrawMode(true);setDrawPoints([]); break;
      case "cancelDraw": cancelDrawing(); break;
      case "startMeasure": setMeasureMode(true); break;
      case "stopMeasure": clearMeasure(); break;
      case "deleteDrawings": if(savedDrawings.length===0){alert("No drawings.");return;}if(window.confirm(`Delete ${savedDrawings.length} drawing(s)?`))setSavedDrawings([]); break;
      case "layerSatellite": setActiveLayer("Satellite"); break;
      case "layerStreet": setActiveLayer("Street"); break;
      case "layerTerrain": setActiveLayer("Terrain"); break;
      case "layerDark": setActiveLayer("Dark"); break;
      case "layerLight": setActiveLayer("Light"); break;
      case "layerSatLabels": setActiveLayer("Satellite + Labels"); break;
      case "show3D": setShow3D(true); break;
      case "toggleNight": setNightModeAuto(p=>!p); break;
      case "drawMarker": setDrawMode(true);setDrawType("marker");setDrawPoints([]); break;
      case "drawPath": setDrawMode(true);setDrawType("path");setDrawPoints([]); break;
      case "drawPoly": setDrawMode(true);setDrawType("polygon");setDrawPoints([]); break;
      case "toggleSurvey": handleToggleSurvey(); break;
      case "about": setShowAbout(true); break;
      case "shortcuts": setShowShortcuts(true); break;
      case "osmLink": window.open("https://www.openstreetmap.org","_blank"); break;
      case "leafletLink": window.open("https://leafletjs.com/reference.html","_blank"); break;
    }
  }

  const cfg=MAP_LAYERS[activeLayer];
  if(show3D) return <Globe3DView savedDrawings={savedDrawings} onClose={()=>setShow3D(false)}/>;

  const gb=(bg="linear-gradient(135deg, #2a4055 0%, #1a2e40 100%)",color="#c0d8e8",border="1px solid #2a4a60")=>({
    padding:"4px 8px",borderRadius:4,border,background:bg,color,fontSize:11,cursor:"pointer",
    fontFamily:"'Segoe UI',sans-serif",fontWeight:500,whiteSpace:"nowrap",transition:"all 0.2s",
  });

  const MobileTabContent = () => {
    if(mobileTab==="layers") return (
      <div style={{padding:"10px 12px",maxHeight:240,overflowY:"auto"}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {Object.entries(MAP_LAYERS).map(([name,layer])=>(
            <button key={name} onClick={()=>setActiveLayer(name)}
              style={{display:"flex",alignItems:"center",gap:5,padding:"6px 10px",borderRadius:6,cursor:"pointer",fontSize:11,
                fontWeight:activeLayer===name?600:400,color:activeLayer===name?"#fff":"#b0c8da",
                background:activeLayer===name?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"linear-gradient(135deg, #2a4055 0%, #1a2e40 100%)",
                border:activeLayer===name?"1px solid #3a78c8":"1px solid #2a4a60",
                boxShadow:activeLayer===name?"0 2px 8px rgba(58,120,200,0.3)":"none"}}>
              {layer.icon} {name}
            </button>
          ))}
        </div>
        <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
          <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",color:"#b0c8da",fontSize:11,padding:"4px 8px",background:"rgba(255,255,255,0.05)",borderRadius:4}}>
            <input type="checkbox" checked={nightModeAuto} onChange={()=>setNightModeAuto(p=>!p)} style={{accentColor:"#3a78c8",width:14,height:14}}/>
            🌙 Auto Night Mode
          </label>
        </div>
      </div>
    );
    if(mobileTab==="draw") return (
      <div style={{padding:"10px 12px"}}>
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          {[["path","〰️","Path"],["polygon","⬡","Poly"],["marker","📍","Pin"]].map(([t,icon,lb])=>(
            <button key={t} onClick={()=>setDrawType(t)}
              style={{flex:1,padding:"6px 2px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                background:drawType===t?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"linear-gradient(135deg, #2a4055 0%, #1a2e40 100%)",
                border:drawType===t?"1px solid #3a78c8":"1px solid #2a4a60",color:drawType===t?"#fff":"#b0c8da",
                boxShadow:drawType===t?"0 2px 8px rgba(58,120,200,0.3)":"none"}}>
              <span style={{fontSize:18}}>{icon}</span><span>{lb}</span>
            </button>
          ))}
        </div>
        {!drawMode
          ? <button onClick={()=>{setDrawMode(true);setDrawPoints([]);}} style={{width:"100%",padding:"10px",borderRadius:6,background:"linear-gradient(135deg, #f09030 0%, #c06810 100%)",border:"1px solid #b05810",color:"#fff",fontWeight:600,fontSize:12,cursor:"pointer",boxShadow:"0 2px 8px rgba(240,144,48,0.3)"}}>▶ Start Drawing</button>
          : <div style={{display:"flex",gap:6}}>
              <div style={{flex:1,padding:"6px 8px",background:"rgba(240,144,48,0.15)",border:"1px solid #b05810",borderRadius:6,color:"#f0a050",fontSize:11,textAlign:"center",fontWeight:600}}>{drawPoints.length} pts</div>
              <button onClick={finishDrawing} style={{flex:1,padding:"6px 10px",borderRadius:6,border:"none",background:"linear-gradient(135deg, #16a34a 0%, #0e8030 100%)",color:"#fff",fontWeight:600,fontSize:11,cursor:"pointer"}}>✅ Done</button>
              <button onClick={cancelDrawing} style={{flex:1,padding:"6px 10px",borderRadius:6,border:"none",background:"linear-gradient(135deg, #dc2626 0%, #a01818 100%)",color:"#fff",fontWeight:600,fontSize:11,cursor:"pointer"}}>✖ Cancel</button>
            </div>
        }
      </div>
    );
    if(mobileTab==="measure") return (
      <div style={{padding:"10px 12px"}}>
        {!measureMode
          ? <button onClick={()=>setMeasureMode(true)} style={{width:"100%",padding:"10px",borderRadius:6,background:"linear-gradient(135deg, #2890b8 0%, #1a6888 100%)",border:"1px solid #1a5878",color:"#fff",fontWeight:600,fontSize:12,cursor:"pointer",boxShadow:"0 2px 8px rgba(40,144,184,0.3)"}}>📐 Start Measuring</button>
          : <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{padding:"8px 10px",background:"rgba(250,204,21,0.1)",border:"1px solid #b89800",borderRadius:6,textAlign:"center"}}>
                <div style={{color:"#a08840",fontSize:9,fontWeight:700}}>TOTAL DISTANCE</div>
                <div style={{color:"#f0c020",fontSize:20,fontWeight:800,fontFamily:"monospace"}}>{measurePoints.length<2?"—":formatDist(totalDistance,measureUnit)}</div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"]].map(([u,lb])=>(
                  <button key={u} onClick={()=>setMeasureUnit(u)} style={{padding:"5px 10px",borderRadius:4,cursor:"pointer",fontSize:10,fontWeight:600,background:measureUnit===u?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"linear-gradient(135deg, #2a4055 0%, #1a2e40 100%)",border:measureUnit===u?"1px solid #3a78c8":"1px solid #2a4a60",color:measureUnit===u?"#fff":"#b0c8da"}}>{lb}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>{setMeasurePoints([]);measureLayersRef.current.forEach(l=>l.remove());measureLayersRef.current=[];if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}}} style={{flex:1,padding:"6px",borderRadius:4,border:"1px solid #2a4a60",background:"transparent",color:"#8098a8",fontSize:11,cursor:"pointer"}}>🔄 Reset</button>
                <button onClick={clearMeasure} style={{flex:1,padding:"6px",borderRadius:4,border:"none",background:"linear-gradient(135deg, #dc2626 0%, #a01818 100%)",color:"#fff",fontWeight:600,fontSize:11,cursor:"pointer",boxShadow:"0 2px 8px rgba(220,38,38,0.3)"}}>✖ Done</button>
              </div>
            </div>
        }
      </div>
    );
    return null;
  };

  return (
    <>
      <style>{`
        html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}
        *,*::before,*::after{box-sizing:border-box;}
        body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:rgba(0,0,0,0.3);}
        ::-webkit-scrollbar-thumb{background:rgba(80,130,170,0.4);border-radius:3px;}
        ::-webkit-scrollbar-thumb:hover{background:rgba(100,160,200,0.6);}
        .gep-tbtn{transition:all 0.2s cubic-bezier(0.4,0,0.2,1);}
        .gep-tbtn:hover{filter:brightness(1.12);transform:translateY(-1px);}
        .gep-tbtn:active{filter:brightness(0.88);transform:translateY(0px);}
        .measure-tooltip{background:rgba(15,23,42,0.95)!important;border:1px solid #facc15!important;color:#facc15!important;font-size:11px!important;font-weight:700!important;font-family:'Courier New',monospace!important;padding:3px 8px!important;border-radius:4px!important;white-space:nowrap!important;box-shadow:0 2px 10px rgba(0,0,0,0.5)!important;}
        .measure-tooltip::before{border-top-color:#facc15!important;}
        @keyframes slideIn{from{opacity:0;transform:translateX(18px);}to{opacity:1;transform:translateX(0);}}
        @keyframes pulse{0%{opacity:0.6;}50%{opacity:1;}100%{opacity:0.6;}}
        @keyframes slideUp{from{transform:translateY(100%);opacity:0;}to{transform:translateY(0);opacity:1;}}
        @keyframes gepStream{from{background-position:0 0;}to{background-position:200% 0;}}
        .menu-drop-item{padding:8px 16px;font-size:12px;color:#1a3040;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:'Segoe UI',sans-serif;transition:background 0.15s;}
        .menu-drop-item:hover{background:rgba(58,120,200,0.2);}
        .sm-layout{--menu-h:22px;--tb-h:42px;--top-h:64px;--sb-w:272px;--stat-h:26px;}
        @media(max-width:640px){
          .sm-layout{--menu-h:0px;--tb-h:48px;--top-h:48px;--sb-w:0px;--stat-h:22px;}
          .sm-menubar{display:none !important;}
          .sm-toolbar{height:48px !important;padding:0 6px !important;}
          .sm-toolbar .tb-label{display:none !important;}
          .sm-toolbar .tb-icon{font-size:20px !important;}
          .sm-sidebar{transform:translateX(-100%);transition:transform 0.3s cubic-bezier(.4,0,.2,1);}
          .sm-sidebar.open{transform:translateX(0) !important;z-index:1300 !important;}
          .sm-map-wrap{left:0 !important;}
          .sm-status{font-size:9px !important;gap:6px !important;padding:0 6px !important;}
          .sm-mobile-fab{display:flex !important;}
          .sm-mobile-sheet{display:flex !important;}
          .sm-desktop-tools{display:none !important;}
          .sm-loc-card{width:calc(100vw - 16px) !important;right:8px !important;left:8px !important;max-height:55vh;overflow-y:auto;}
        }
        @media(min-width:641px){
          .sm-mobile-fab{display:none !important;}
          .sm-mobile-sheet{display:none !important;}
        }
      `}</style>

      <div className="sm-layout">

        {/* ─── MENU BAR ─────────────────────────────────────────────────── */}
        <div className="sm-menubar" ref={menuBarRef}
          style={{position:"absolute",top:0,left:0,right:0,height:"var(--menu-h)",zIndex:1200,background:"linear-gradient(135deg, #e8f0f8 0%, #d0e0ec 100%)",borderBottom:"1px solid #8aabb8",display:"flex",alignItems:"center",paddingLeft:8,gap:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginRight:12,paddingRight:12,borderRight:"1px solid #b0c8d8"}}>
            <span style={{fontSize:15}}>🗺️</span>
            <span style={{fontSize:11,fontWeight:700,color:"#1a3040",letterSpacing:"0.02em"}}>SurveyMap Pro</span>
          </div>
          {Object.keys(MENU_DEFS).map(menuName=>{
            const isOpen=openMenu===menuName;
            return(
              <div key={menuName} style={{position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
                <span onClick={()=>setOpenMenu(isOpen?null:menuName)} onMouseEnter={()=>{if(openMenu&&openMenu!==menuName)setOpenMenu(menuName);}}
                  style={{fontSize:11,color:isOpen?"#fff":"#1a3040",padding:"2px 12px",cursor:"pointer",userSelect:"none",height:"100%",display:"flex",alignItems:"center",background:isOpen?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"transparent",fontWeight:isOpen?600:400,fontFamily:"'Segoe UI',sans-serif",borderRadius:isOpen?"2px 2px 0 0":0,transition:"all 0.15s"}}>
                  {menuName}
                </span>
                {isOpen&&(
                  <div style={{position:"absolute",top:"var(--menu-h)",left:0,background:"linear-gradient(135deg, #f0f8ff 0%, #e0ecf8 100%)",border:"1px solid #8aabb8",borderTop:"2px solid #3a78c8",borderRadius:"0 0 6px 6px",minWidth:200,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",zIndex:1300,overflow:"hidden",backdropFilter:"blur(4px)"}}>
                    {MENU_DEFS[menuName].map((item,idx)=>item.divider?<div key={idx} style={{height:1,background:"#b0c8d8",margin:"4px 0"}}/>:<div key={idx} className="menu-drop-item" onClick={()=>handleMenuAction(item.action)}>{item.label}</div>)}
                  </div>
                )}
              </div>
            );
          })}
          {openMenu&&<div style={{position:"fixed",inset:0,zIndex:1290}} onClick={()=>setOpenMenu(null)}/>}
          <div style={{flex:1}}/>
          <button style={{...gb(),marginRight:8,fontSize:10,background:"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)",border:"1px solid #1e50a0",color:"#fff"}}>Sign In</button>
        </div>

        <input ref={kmlInputRef} type="file" accept=".kml" onChange={handleKMLUpload} style={{display:"none"}}/>
        <input ref={extraInputRef} type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{display:"none"}}/>

        {/* ─── TOOLBAR ──────────────────────────────────────────────────── */}
        <div className="sm-toolbar" style={{position:"absolute",top:"var(--menu-h)",left:0,right:0,height:"var(--tb-h)",zIndex:1200,background:"linear-gradient(135deg, #e0ecf8 0%, #c8dcec 100%)",borderBottom:"2px solid #8aabb8",display:"flex",alignItems:"center",paddingLeft:8,gap:4,overflowX:"auto"}}>
          <button className="gep-tbtn sm-mobile-fab" onClick={()=>setSidebarOpen(p=>!p)} style={{display:"none",alignItems:"center",justifyContent:"center",width:38,height:38,borderRadius:6,border:"1px solid #8aabb8",background:"linear-gradient(135deg, #e8f2f8 0%, #d0e0ec 100%)",color:"#1a3040",fontSize:18,cursor:"pointer",flexShrink:0}}>☰</button>
          {[{key:"Satellite",icon:"🛰️",short:"Satellite"},{key:"Street",icon:"🗺️",short:"Street"},{key:"Terrain",icon:"⛰️",short:"Terrain"},{key:"Satellite + Labels",icon:"🏷️",short:"+Labels"},{key:"Dark",icon:"🌑",short:"Dark"},{key:"Light",icon:"☀️",short:"Light"}].map(({key,icon,short})=>(
            <button key={key} className="gep-tbtn" onClick={()=>setActiveLayer(key)} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 8px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:activeLayer===key?600:400,color:activeLayer===key?"#fff":"#1a3040",background:activeLayer===key?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"linear-gradient(135deg, #e8f2f8 0%, #d0e0ec 100%)",border:activeLayer===key?"1px solid #1e50a0":"1px solid #8aabb8",fontFamily:"'Segoe UI',sans-serif",whiteSpace:"nowrap",flexShrink:0,boxShadow:activeLayer===key?"0 2px 8px rgba(58,120,200,0.3)":"none"}}>
              <span className="tb-icon" style={{fontSize:15}}>{icon}</span>
              <span className="tb-label">{short}</span>
            </button>
          ))}
          <div style={{width:1,height:24,background:"#8aabb8",margin:"0 4px",flexShrink:0}}/>
          {[{icon:"✏️",label:"Draw",active:drawMode,action:()=>{setDrawMode(m=>!m);if(!drawMode)setDrawPoints([]);}},{icon:"📏",label:"Measure",active:measureMode,action:()=>setMeasureMode(m=>!m)},{icon:"📐",label:"Survey",active:surveyMode,action:handleToggleSurvey}].map(({icon,label,active,action})=>(
            <button key={label} className="gep-tbtn" onClick={action} title={label} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"3px 8px",borderRadius:4,cursor:"pointer",minWidth:42,flexShrink:0,background:active?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"linear-gradient(135deg, #e8f2f8 0%, #d0e0ec 100%)",border:active?"1px solid #1e50a0":"1px solid #8aabb8",color:active?"#fff":"#1a3040",boxShadow:active?"0 2px 8px rgba(58,120,200,0.3)":"none"}}>
              <span className="tb-icon" style={{fontSize:16}}>{icon}</span>
              <span className="tb-label" style={{fontSize:8,fontFamily:"'Segoe UI',sans-serif",fontWeight:600}}>{label}</span>
            </button>
          ))}
          <div style={{width:1,height:24,background:"#8aabb8",margin:"0 4px",flexShrink:0}}/>
          <label className="gep-tbtn" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"3px 8px",borderRadius:4,cursor:"pointer",background:"linear-gradient(135deg, #e8f2f8 0%, #d0e0ec 100%)",border:"1px solid #8aabb8",minWidth:42,color:"#1a3040",flexShrink:0}}>
            <span className="tb-icon" style={{fontSize:16}}>📂</span>
            <span className="tb-label" style={{fontSize:8,fontWeight:600}}>KML</span>
            <input type="file" accept=".kml" onChange={handleKMLUpload} style={{display:"none"}}/>
          </label>
          <label className="gep-tbtn" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"3px 8px",borderRadius:4,cursor:"pointer",background:"linear-gradient(135deg, #e8f2f8 0%, #d0e0ec 100%)",border:"1px solid #8aabb8",minWidth:42,color:"#1a3040",flexShrink:0}}>
            <span className="tb-icon" style={{fontSize:16}}>📊</span>
            <span className="tb-label" style={{fontSize:8,fontWeight:600}}>CSV/KMZ</span>
            <input type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{display:"none"}}/>
          </label>
          <div style={{width:1,height:24,background:"#8aabb8",margin:"0 4px",flexShrink:0}}/>
          <button className="gep-tbtn" onClick={()=>setShow3D(true)} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:4,cursor:"pointer",background:"linear-gradient(135deg, #b0d8f0 0%, #80b8e0 100%)",border:"1px solid #5090c0",color:"#0a2840",fontWeight:600,fontSize:11,fontFamily:"'Segoe UI',sans-serif",flexShrink:0,boxShadow:"0 2px 8px rgba(58,120,200,0.3)"}}>
            <span className="tb-icon">🌍</span>
            <span className="tb-label">3D Globe</span>
          </button>
          <button className="gep-tbtn" onClick={()=>setNightModeAuto(p=>!p)} title="Auto Night Mode" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"3px 8px",borderRadius:4,cursor:"pointer",minWidth:42,flexShrink:0,background:nightModeAuto?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"linear-gradient(135deg, #e8f2f8 0%, #d0e0ec 100%)",border:nightModeAuto?"1px solid #1e50a0":"1px solid #8aabb8",color:nightModeAuto?"#fff":"#1a3040",boxShadow:nightModeAuto?"0 2px 8px rgba(58,120,200,0.3)":"none"}}>
            <span className="tb-icon" style={{fontSize:16}}>{nightSwitchInfo?.isNight?"🌙":"☀️"}</span>
            <span className="tb-label" style={{fontSize:8,fontWeight:600}}>Night</span>
          </button>
          <div style={{flex:1}}/>
          {kmlLoading&&<span style={{fontSize:10,color:"#3a78c8",marginRight:8,whiteSpace:"nowrap",background:"rgba(58,120,200,0.1)",padding:"3px 8px",borderRadius:12}}>⏳ {kmlName.slice(0,18)}…</span>}
          {kmlName&&!kmlLoading&&<span style={{fontSize:10,color:"#3a78c8",marginRight:8,whiteSpace:"nowrap",background:"rgba(58,120,200,0.1)",padding:"3px 8px",borderRadius:12}}>📄 {kmlName.slice(0,18)}</span>}
        </div>

        {/* ─── MAP WRAPPER ──────────────────────────────────────────────── */}
        <div className="sm-map-wrap" style={{position:"absolute",top:"var(--top-h)",left:"var(--sb-w)",right:0,bottom:"var(--stat-h)",zIndex:1}}>
          <MapContainer center={[20.29,85.82]} zoom={13} zoomControl={false} style={{width:"100%",height:"100%"}}>
            {cfg.type==="wms"
              ? <WMSTileLayer key={activeLayer} url={cfg.url} layers={cfg.layers} format={cfg.format||"image/png"} transparent={cfg.transparent??true} attribution={cfg.attribution} crossOrigin/>
              : <>
                  <TileLayer key={activeLayer} url={cfg.url} attribution={cfg.attribution} maxZoom={19} crossOrigin/>
                  {cfg.overlayUrl&&<TileLayer url={cfg.overlayUrl} maxZoom={19} crossOrigin/>}
                </>
            }
            <ZoomControl position="bottomright"/>

            {/* ── KEY FIX: MapFlyController responds to flyTarget state ── */}
            <MapFlyController flyTarget={flyTarget}/>

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
            <NavControls/>
          </MapContainer>
        </div>

        {/* ─── SIDEBAR ──────────────────────────────────────────────────── */}
        {sidebarOpen&&<div onClick={()=>setSidebarOpen(false)} style={{position:"fixed",inset:0,zIndex:1250,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)"}}/>}
        <div className={`sm-sidebar${sidebarOpen?" open":""}`}
          style={{position:"absolute",top:"var(--top-h)",left:0,bottom:"var(--stat-h)",width:272,zIndex:1100,background:"linear-gradient(135deg, #1f3242 0%, #152430 100%)",borderRight:"2px solid #0a1a28",display:"flex",flexDirection:"column",overflowY:"hidden",boxShadow:"4px 0 24px rgba(0,0,0,0.6)"}}>
          <button className="sm-mobile-fab" onClick={()=>setSidebarOpen(false)} style={{display:"none",position:"absolute",top:8,right:8,width:30,height:30,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.1)",color:"#a0c0d8",cursor:"pointer",fontSize:14,zIndex:10,alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>✕</button>

          {/* SEARCH */}
          <PaneHeader icon="🔍" title="Search" collapsed={!searchOpen} onToggle={()=>setSearchOpen(p=>!p)}/>
          {searchOpen&&(
            <div style={{padding:"10px 12px",borderBottom:"1px solid #0a1a28",flexShrink:0}}>
              <form onSubmit={handleSidebarSearch} style={{display:"flex",gap:4,marginBottom:8}}>
                <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                  placeholder="Search location or lat, lng…"
                  style={{flex:1,padding:"7px 10px",borderRadius:5,border:"1px solid #2a4a60",background:"rgba(255,255,255,0.08)",color:"#d0e8f8",fontSize:11,outline:"none",fontFamily:"'Segoe UI',sans-serif"}}/>
                <button type="submit" disabled={searchLoading}
                  style={{padding:"7px 12px",borderRadius:5,border:"1px solid #1e50a0",background:searchLoading?"#1a3060":"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)",color:"#fff",cursor:searchLoading?"not-allowed":"pointer",fontSize:13,fontWeight:700,flexShrink:0,boxShadow:"0 2px 8px rgba(58,120,200,0.3)"}}>
                  {searchLoading?"…":"↵"}
                </button>
              </form>
              <div style={{display:"flex",gap:4}}>
                <button style={{...gb(),flex:1,fontSize:10}}>📍 Directions</button>
               <button
  onClick={()=>setShowHistory(true)}
  style={{...gb(),flex:1,fontSize:10}}
>
  🕐 History
</button>
              </div>
              {locationInfo&&(
                <div style={{marginTop:8,padding:"8px 10px",background:"rgba(58,120,200,0.15)",borderRadius:5,border:"1px solid rgba(58,120,200,0.35)"}}>
                  <div style={{color:"#90c0f0",fontSize:11,fontWeight:700,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    📍 {locationInfo.loading?"Loading…":(locationInfo.name||"Unknown")}
                  </div>
                  {locationInfo.details&&<div style={{color:"#607888",fontSize:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{locationInfo.details}</div>}
                  <div style={{color:"#507080",fontSize:10,fontFamily:"monospace",marginTop:2}}>{locationInfo.lat?.toFixed(5)}°, {locationInfo.lng?.toFixed(5)}°</div>
                  <button onClick={handleCloseLocationInfo} style={{marginTop:4,fontSize:9,color:"#6080a0",cursor:"pointer",background:"none",border:"none",padding:0}}>✕ Clear</button>
                </div>
              )}
            </div>
          )}

          {/* PLACES */}
          <PaneHeader icon="📌" title="Places" collapsed={!placesOpen} onToggle={()=>setPlacesOpen(p=>!p)}/>
          {placesOpen&&(
            <div style={{flexShrink:0}}>
              <div style={{padding:"6px 6px",maxHeight:160,overflowY:"auto"}}>
                <TreeItem icon="⭐" label="My Places"/>
                <TreeItem icon="📁" label="Temporary Places" indent={1}/>
                {savedDrawings.map((d,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center"}}>
                    <div style={{flex:1,overflow:"hidden"}}><TreeItem icon={d.type==="path"?"〰️":d.type==="polygon"?"⬡":"📍"} label={d.name} indent={2}/></div>
                    <span onClick={()=>setSavedDrawings(p=>p.filter((_,j)=>j!==i))} style={{color:"#507080",cursor:"pointer",fontSize:10,padding:"0 8px",flexShrink:0,opacity:0.6}}>✕</span>
                  </div>
                ))}
                {savedDrawings.length===0&&<div style={{paddingLeft:34,color:"#406070",fontSize:10,fontStyle:"italic",paddingTop:2}}>No saved drawings</div>}
                {surveyMode&&route.length>0&&<TreeItem icon="📐" label={`Survey Route · ${route.length} pts`} active badge="LIVE" indent={1}/>}
              </div>
              <div style={{display:"flex",gap:3,padding:"5px 8px",background:"rgba(0,0,0,0.25)",borderTop:"1px solid #0a1825",borderBottom:"1px solid #0a1825"}}>
                <button style={{...gb(),flex:1,fontSize:9,padding:"4px 4px"}}>📁 Folder</button>
                <button style={{...gb(),flex:1,fontSize:9,padding:"4px 4px"}}>📍 Mark</button>
                <button style={{...gb(),flex:1,fontSize:9,padding:"4px 4px"}}>〰️ Path</button>
              </div>
            </div>
          )}

          {/* LAYERS */}
          <PaneHeader icon="🗂️" title="Layers" collapsed={!layersOpen} onToggle={()=>setLayersOpen(p=>!p)}/>
          {layersOpen&&(
            <div style={{flexShrink:0}}>
              <div style={{padding:"6px 6px",maxHeight:220,overflowY:"auto"}}>
                <TreeItem icon={nightSwitchInfo?.isNight?"🌙":"☀️"} label="Auto Night Mode" check={nightModeAuto} onCheck={()=>setNightModeAuto(p=>!p)} onClick={()=>setNightModeAuto(p=>!p)} badge={nightModeAuto&&nightSwitchInfo?(nightSwitchInfo.isNight?"Night":"Day"):null}/>
                <div style={{height:1,background:"rgba(255,255,255,0.07)",margin:"4px 10px"}}/>
                {Object.entries(MAP_LAYERS).map(([name,layer])=>(
                  <TreeItem key={name} icon={layer.icon} label={name} check={activeLayer===name} onCheck={()=>setActiveLayer(name)} onClick={()=>setActiveLayer(name)} active={activeLayer===name} indent={1}/>
                ))}
              </div>
            </div>
          )}

          {/* TOOLS */}
          <PaneHeader icon="🛠️" title="Tools" collapsed={!toolsOpen} onToggle={()=>setToolsOpen(p=>!p)}/>
          {toolsOpen&&(
            <div className="sm-desktop-tools" style={{flex:1,overflowY:"auto"}}>
              <div style={{padding:"10px 10px 8px",borderBottom:"1px solid #0a1825"}}>
                <div style={{color:"#6090b0",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:6,textTransform:"uppercase"}}>✏️ DRAW TOOL</div>
                <div style={{display:"flex",gap:4,marginBottom:8}}>
                  {[["path","〰️","Path"],["polygon","⬡","Poly"],["marker","📍","Pin"]].map(([t,icon,lb])=>(
                    <button key={t} onClick={()=>setDrawType(t)} style={{flex:1,padding:"5px 2px",borderRadius:4,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,background:drawType===t?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"linear-gradient(135deg, #2a4055 0%, #1a2e40 100%)",border:drawType===t?"1px solid #3a78c8":"1px solid #2a4a60",color:drawType===t?"#fff":"#b0c8da",fontSize:10,fontWeight:600,fontFamily:"'Segoe UI',sans-serif",boxShadow:drawType===t?"0 2px 8px rgba(58,120,200,0.2)":"none"}}>
                      <span style={{fontSize:16}}>{icon}</span><span>{lb}</span>
                    </button>
                  ))}
                </div>
                {!drawMode
                  ? <button onClick={()=>{setDrawMode(true);setDrawPoints([]);}} style={{width:"100%",padding:"7px",borderRadius:4,cursor:"pointer",background:"linear-gradient(135deg, #f09030 0%, #c06810 100%)",border:"1px solid #b05810",color:"#fff",fontWeight:600,fontSize:11,fontFamily:"'Segoe UI',sans-serif",boxShadow:"0 2px 8px rgba(240,144,48,0.3)"}}>▶ Start Drawing</button>
                  : <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      <div style={{padding:"5px 8px",background:"rgba(240,144,48,0.15)",border:"1px solid #b05810",borderRadius:4,color:"#f0a050",fontSize:10,textAlign:"center",fontWeight:600}}>{drawType==="marker"?"Click map to place":`${drawPoints.length} pts — click map`}</div>
                      <div style={{display:"flex",gap:5}}>
                        <button onClick={finishDrawing} style={{flex:1,padding:"6px",borderRadius:4,border:"none",background:"linear-gradient(135deg, #16a34a 0%, #0e8030 100%)",color:"#fff",fontWeight:600,fontSize:10,cursor:"pointer",boxShadow:"0 2px 8px rgba(22,163,74,0.3)"}}>✅ Done</button>
                        <button onClick={cancelDrawing} style={{flex:1,padding:"6px",borderRadius:4,border:"none",background:"linear-gradient(135deg, #dc2626 0%, #a01818 100%)",color:"#fff",fontWeight:600,fontSize:10,cursor:"pointer",boxShadow:"0 2px 8px rgba(220,38,38,0.3)"}}>✖ Cancel</button>
                      </div>
                    </div>
                }
              </div>
              <div style={{padding:"10px 10px 8px",borderBottom:"1px solid #0a1825"}}>
                <div style={{color:"#6090b0",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:6,textTransform:"uppercase"}}>📏 MEASURE</div>
                {!measureMode
                  ? <button onClick={()=>setMeasureMode(true)} style={{width:"100%",padding:"7px",borderRadius:4,cursor:"pointer",background:"linear-gradient(135deg, #2890b8 0%, #1a6888 100%)",border:"1px solid #1a5878",color:"#fff",fontWeight:600,fontSize:11,fontFamily:"'Segoe UI',sans-serif",boxShadow:"0 2px 8px rgba(40,144,184,0.3)"}}>📐 Start Measuring</button>
                  : <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      <div style={{padding:"8px 10px",background:"rgba(250,204,21,0.1)",border:"1px solid #b89800",borderRadius:4,textAlign:"center"}}>
                        <div style={{color:"#a08840",fontSize:9,fontWeight:700,marginBottom:1}}>TOTAL DISTANCE</div>
                        <div style={{color:"#f0c020",fontSize:18,fontWeight:800,fontFamily:"monospace"}}>{measurePoints.length<2?"—":formatDist(totalDistance,measureUnit)}</div>
                        <div style={{color:"#806840",fontSize:9}}>{measurePoints.length} pts</div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:2}}>
                        {[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"],["yd","yd"],["nmi","nmi"],["cm","cm"]].map(([u,lb])=>(
                          <button key={u} onClick={()=>setMeasureUnit(u)} style={{padding:"4px 2px",borderRadius:3,cursor:"pointer",fontSize:9,fontWeight:600,background:measureUnit===u?"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)":"linear-gradient(135deg, #2a4055 0%, #1a2e40 100%)",border:measureUnit===u?"1px solid #3a78c8":"1px solid #2a4a60",color:measureUnit===u?"#fff":"#b0c8da"}}>{measureUnit===u?"✓ ":""}{lb}</button>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={()=>{setMeasurePoints([]);measureLayersRef.current.forEach(l=>l.remove());measureLayersRef.current=[];if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}}} style={{flex:1,padding:"5px",borderRadius:4,border:"1px solid #2a4a60",background:"transparent",color:"#8098a8",fontSize:10,cursor:"pointer"}}>🔄 Reset</button>
                        <button onClick={clearMeasure} style={{flex:1,padding:"5px",borderRadius:4,border:"none",background:"linear-gradient(135deg, #dc2626 0%, #a01818 100%)",color:"#fff",fontWeight:600,fontSize:10,cursor:"pointer",boxShadow:"0 2px 8px rgba(220,38,38,0.3)"}}>✖ Done</button>
                      </div>
                    </div>
                }
              </div>
              <div style={{padding:"10px 10px 8px",borderBottom:"1px solid #0a1825"}}>
                <div style={{color:"#6090b0",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:6,textTransform:"uppercase"}}>📐 SURVEY</div>
                <button onClick={handleToggleSurvey} style={{width:"100%",padding:"7px",borderRadius:4,cursor:"pointer",fontWeight:600,fontSize:11,fontFamily:"'Segoe UI',sans-serif",color:"#fff",background:surveyMode?"linear-gradient(135deg, #dc2626 0%, #a01818 100%)":"linear-gradient(135deg, #2060a8 0%, #1a3888 100%)",border:surveyMode?"1px solid #a01818":"1px solid #1a3888",boxShadow:"0 2px 8px rgba(58,120,200,0.3)"}}>
                  {surveyMode?"⏹ Stop Survey":"▶ Start Survey"}
                </button>
                {surveyMode&&<div style={{marginTop:5,padding:"5px 8px",background:"rgba(220,38,38,0.15)",border:"1px solid #a01818",borderRadius:4,color:"#f0a0a0",fontSize:10,textAlign:"center"}}>● RECORDING · {route.length} pt{route.length!==1?"s":""}</div>}
              </div>
              <div style={{padding:"10px 10px 8px",borderBottom:"1px solid #0a1825"}}>
                <div style={{color:"#6090b0",fontSize:9,fontWeight:700,letterSpacing:"0.07em",marginBottom:6,textTransform:"uppercase"}}>📂 FILES</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <label style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"linear-gradient(135deg, #2a4055 0%, #1a2e40 100%)",borderRadius:4,border:"1px solid #2a4a60",cursor:"pointer",color:"#b0c8da",fontSize:11}}>
                    📂 {kmlLoading?"Loading…":kmlName?kmlName.slice(0,20):"Open KML File"}
                    <input type="file" accept=".kml" onChange={handleKMLUpload} style={{display:"none"}}/>
                  </label>
                  <label style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"linear-gradient(135deg, #2a4055 0%, #1a2e40 100%)",borderRadius:4,border:"1px solid #2a4a60",cursor:"pointer",color:"#b0c8da",fontSize:11}}>
                    📊 Upload KMZ / CSV
                    <input type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{display:"none"}}/>
                  </label>
                </div>
              </div>
              <div style={{padding:"12px 10px 14px"}}>
                <button onClick={()=>setShow3D(true)} style={{width:"100%",padding:"10px 12px",borderRadius:6,cursor:"pointer",background:"linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",border:"1px solid #5b21b6",color:"#fff",fontWeight:700,fontSize:12,fontFamily:"'Segoe UI',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7,boxShadow:"0 4px 12px rgba(124,58,237,0.4)"}}>
                  <span style={{fontSize:18}}>🌍</span><span>Switch to 3D Globe</span>
                </button>
                {savedDrawings.length>0&&<div style={{marginTop:6,color:"#6080a0",fontSize:9,textAlign:"center"}}>✓ {savedDrawings.length} drawing{savedDrawings.length!==1?"s":""} will carry over</div>}
              </div>
            </div>
          )}
        </div>

        {/* ─── MOBILE BOTTOM SHEET ──────────────────────────────────────── */}
        <div className="sm-mobile-sheet" style={{display:"none",position:"fixed",bottom:"var(--stat-h)",left:0,right:0,zIndex:1200,background:"linear-gradient(135deg, #1f3242 0%, #152430 100%)",borderTop:"2px solid #2a4a60",flexDirection:"column",animation:"slideUp 0.25s ease"}}>
          <div style={{display:"flex",borderBottom:"1px solid #0a1825"}}>
            {[["layers","🗂️","Layers"],["draw","✏️","Draw"],["measure","📏","Measure"]].map(([tab,icon,lb])=>(
              <button key={tab} onClick={()=>setMobileTab(tab)} style={{flex:1,padding:"10px 4px",border:"none",borderBottom:`2px solid ${mobileTab===tab?"#3a78c8":"transparent"}`,background:mobileTab===tab?"rgba(58,120,200,0.2)":"transparent",color:mobileTab===tab?"#60a5fa":"#90a8c0",cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",flexDirection:"column",alignItems:"center",gap:2,transition:"all 0.2s"}}>
                <span style={{fontSize:18}}>{icon}</span>{lb}
              </button>
            ))}
          </div>
          <MobileTabContent/>
        </div>

        {/* ─── STATUS BAR ───────────────────────────────────────────────── */}
        <div className="sm-status" style={{position:"absolute",bottom:0,left:0,right:0,height:"var(--stat-h)",zIndex:1100,background:"linear-gradient(135deg, #1f3242 0%, #142434 100%)",borderTop:"1px solid #2a4a60",display:"flex",alignItems:"center",padding:"0 12px",gap:16,fontFamily:"'Courier New',monospace",fontSize:11,color:"#90b0c8",userSelect:"none",boxShadow:"0 -2px 10px rgba(0,0,0,0.3)"}}>
          {mousePos
            ?<><span style={{color:"#c0d8e8"}}>{toDMS(mousePos.lat,"N","S")}</span><span style={{color:"#c0d8e8"}}>{toDMS(mousePos.lng,"E","W")}</span><span style={{color:"#6080a0",fontSize:10}}>({mousePos.lat.toFixed(4)}, {mousePos.lng.toFixed(4)})</span></>
            :<span style={{color:"#406080"}}>Move mouse over map…</span>
          }
          <div style={{flex:1}}/>
          <span style={{color:"#70a0c0"}}>Z{mapZoom}</span>
          <span style={{color:"#90c0e0"}}>👁 {formatAlt(zoomToAltitude(mapZoom))}</span>
          {nightModeAuto&&<span style={{color:"#a0a0e0",fontFamily:"'Segoe UI',sans-serif",fontSize:10}}>{nightSwitchInfo?.isNight?"🌙":"☀️"}</span>}
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:50,height:6,background:"rgba(0,0,0,0.4)",borderRadius:3,overflow:"hidden",border:"1px solid #2a4a60"}}>
              <div style={{width:"100%",height:"100%",background:"linear-gradient(90deg, #1e50a0, #40a0e0, #1e50a0)",backgroundSize:"200% 100%",animation:"gepStream 2s linear infinite",borderRadius:3}}/>
            </div>
            <span style={{color:"#406080",fontSize:9,fontFamily:"'Segoe UI',sans-serif"}}>Live</span>
          </div>
          <span style={{color:"#406080",fontFamily:"'Segoe UI',sans-serif",fontSize:9}}>© Esri / OSM</span>
        </div>

        {/* ─── LOCATION INFO CARD ───────────────────────────────────────── */}
        {locationInfo&&(
          <div className="sm-loc-card" style={{position:"absolute",top:"var(--top-h)",marginTop:12,right:100,width:320,zIndex:1050,background:"rgba(20,35,50,0.98)",backdropFilter:"blur(14px)",borderRadius:10,overflow:"hidden",boxShadow:"0 12px 40px rgba(0,0,0,0.7)",border:"1px solid rgba(255,255,255,0.12)",fontFamily:"'Segoe UI',sans-serif",animation:"slideIn 0.2s ease"}}>
            {locationInfo.photo&&(
              <div style={{position:"relative",height:140,overflow:"hidden"}}>
                <img src={locationInfo.photo} alt={locationInfo.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(20,35,50,1) 0%,transparent 60%)"}}/>
                <div style={{position:"absolute",bottom:12,left:14,color:"#fff",fontWeight:700,fontSize:16,textShadow:"0 2px 10px rgba(0,0,0,0.8)"}}>{locationInfo.name||locationInfo.label?.split(",")?.[0]}</div>
                <button onClick={handleCloseLocationInfo} style={{position:"absolute",top:10,right:10,background:"rgba(0,0,0,0.6)",border:"none",color:"#fff",borderRadius:"50%",width:28,height:28,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>✕</button>
              </div>
            )}
            <div style={{padding:locationInfo.photo?"12px 16px 14px":"14px 16px 14px"}}>
              {!locationInfo.photo&&(
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,borderBottom:"1px solid rgba(255,255,255,0.08)",paddingBottom:8}}>
                  <div>
                    <div style={{color:"#d0e8f8",fontWeight:700,fontSize:15}}>{locationInfo.loading?"Loading…":(locationInfo.name||locationInfo.label?.split(",")?.[0])}</div>
                    {locationInfo.details&&!locationInfo.loading&&<div style={{color:"#7090b0",fontSize:11,marginTop:2,maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{locationInfo.details}</div>}
                  </div>
                  <button onClick={handleCloseLocationInfo} style={{background:"none",border:"none",color:"#6080a0",cursor:"pointer",fontSize:18,padding:0,marginLeft:8}}>✕</button>
                </div>
              )}
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"rgba(255,255,255,0.05)",borderRadius:5,marginBottom:10,border:"1px solid rgba(255,255,255,0.08)"}}>
                <span style={{fontSize:14}}>📍</span>
                <div>
                  <div style={{color:"#c0d8e8",fontSize:11,fontFamily:"monospace",fontWeight:600}}>{locationInfo.lat?.toFixed(6)}°, {locationInfo.lng?.toFixed(6)}°</div>
                  {locationInfo.plusCode&&<div style={{color:"#507090",fontSize:9,marginTop:1}}>{locationInfo.plusCode}</div>}
                </div>
              </div>
              {locationInfo.loading
                ?<div style={{color:"#6080a0",fontSize:11,fontStyle:"italic",padding:"5px 0"}}>⏳ Fetching details…</div>
                :locationInfo.description
                  ?<div style={{color:"#a0c0d8",fontSize:11,lineHeight:1.6,maxHeight:120,overflowY:"auto",paddingRight:5}}>{locationInfo.description.slice(0,400)}{locationInfo.description.length>400?"…":""}</div>
                  :null
              }
              <div style={{display:"flex",gap:6,marginTop:10}}>
                {locationInfo.wikiUrl&&(
                  <a href={locationInfo.wikiUrl} target="_blank" rel="noreferrer" style={{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 12px",background:"rgba(58,120,200,0.2)",borderRadius:5,color:"#60a0e0",fontSize:11,textDecoration:"none",fontWeight:600,border:"1px solid rgba(58,120,200,0.35)"}}>
                    🌐 Wikipedia ↗
                  </a>
                )}
                <button onClick={()=>window.open(`https://www.google.com/maps/search/?api=1&query=${locationInfo.lat},${locationInfo.lng}`,"_blank")}
                  style={{flex:1,padding:"6px 12px",background:"rgba(74,222,128,0.1)",borderRadius:5,border:"1px solid rgba(74,222,128,0.25)",color:"#4ade80",fontSize:11,cursor:"pointer",fontWeight:600}}>
                  🗺 Google Maps ↗
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── NAME MODAL ───────────────────────────────────────────────── */}
        {showNameModal&&(
          <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(6px)"}}>
            <div style={{background:"linear-gradient(135deg, #1f3242 0%, #152430 100%)",borderRadius:10,padding:24,width:"100%",maxWidth:300,boxShadow:"0 12px 48px rgba(0,0,0,0.8)",border:"1px solid rgba(255,255,255,0.12)"}}>
              <div style={{color:"#c0d8e8",fontWeight:700,fontSize:15,marginBottom:4,fontFamily:"'Segoe UI',sans-serif"}}>Name this {pendingType}</div>
              <div style={{color:"#6080a0",fontSize:11,marginBottom:14,fontFamily:"'Segoe UI',sans-serif"}}>{pendingPoints.length} pt{pendingPoints.length!==1?"s":""} recorded</div>
              <input autoFocus value={pendingName} onChange={e=>setPendingName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmDrawing()} placeholder={pendingType==="marker"?"e.g. Granite Gneiss":"e.g. Survey Path A"} style={{width:"100%",padding:"9px 12px",borderRadius:5,border:"1px solid #2a4a60",background:"rgba(255,255,255,0.08)",color:"#d0e8f8",fontSize:13,marginBottom:15,outline:"none",boxSizing:"border-box",fontFamily:"'Segoe UI',sans-serif"}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={confirmDrawing} style={{flex:1,padding:"10px",borderRadius:5,border:"1px solid #1e50a0",background:"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",boxShadow:"0 2px 8px rgba(58,120,200,0.3)"}}>Save</button>
                <button onClick={cancelDrawing} style={{flex:1,padding:"10px",borderRadius:5,border:"1px solid #2a4a60",background:"transparent",color:"#a0c0d8",fontWeight:600,fontSize:13,cursor:"pointer"}}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ─── ABOUT MODAL ──────────────────────────────────────────────── */}
        {showAbout&&(
          <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(6px)"}}>
            <div style={{background:"linear-gradient(135deg, #1f3242 0%, #152430 100%)",borderRadius:12,padding:28,width:"100%",maxWidth:360,boxShadow:"0 16px 56px rgba(0,0,0,0.8)",border:"1px solid rgba(255,255,255,0.12)",fontFamily:"'Segoe UI',sans-serif"}}>
              <div style={{fontSize:40,textAlign:"center",marginBottom:10}}>🗺️</div>
              <div style={{color:"#c0d8e8",fontWeight:700,fontSize:20,textAlign:"center",marginBottom:6}}>SurveyMap Pro</div>
              <div style={{color:"#7090b0",fontSize:12,textAlign:"center",marginBottom:20}}>Professional GIS-style web mapping — React + Leaflet</div>
              <div style={{color:"#a0c0d8",fontSize:12,lineHeight:2.2,background:"rgba(255,255,255,0.05)",padding:"12px 16px",borderRadius:8}}>
                {["🛰️ Multiple tile layers","✏️ Draw paths, polygons & markers","📏 Distance measurement","📐 Survey route recording","📂 KML / KMZ / CSV import","🌍 3D Globe view","🌙 Auto day / night mode","📱 Mobile responsive"].map(f=><div key={f}>{f}</div>)}
              </div>
              <button onClick={()=>setShowAbout(false)} style={{marginTop:20,width:"100%",padding:"10px",borderRadius:5,border:"1px solid #1e50a0",background:"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",boxShadow:"0 2px 8px rgba(58,120,200,0.3)"}}>Close</button>
            </div>
          </div>
        )}

        {/* ─── SHORTCUTS MODAL ──────────────────────────────────────────── */}
      {showShortcuts&&(
  <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(6px)"}}>
    <div style={{background:"linear-gradient(135deg, #1f3242 0%, #152430 100%)",borderRadius:12,padding:26,width:"100%",maxWidth:340,boxShadow:"0 16px 56px rgba(0,0,0,0.8)",border:"1px solid rgba(255,255,255,0.12)",fontFamily:"'Segoe UI',sans-serif"}}>
      <div style={{color:"#c0d8e8",fontWeight:700,fontSize:16,marginBottom:18}}>⌨️ Keyboard Shortcuts</div>
      {[["Escape","Cancel draw / measure"],["Click map","Add point"],["Enter","Save (name modal)"],["Scroll","Zoom in/out"],["Drag","Pan map"],["Shift + Drag","Rotate map (with compass)"]].map(([k,d])=>(
        <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #1a3040"}}>
          <span style={{color:"#3a78c8",fontWeight:700,fontSize:12,fontFamily:"monospace",background:"rgba(58,120,200,0.1)",padding:"2px 6px",borderRadius:3}}>{k}</span>
          <span style={{color:"#90b0c8",fontSize:11}}>{d}</span>
        </div>
      ))}
      <button onClick={()=>setShowShortcuts(false)} style={{marginTop:20,width:"100%",padding:"10px",borderRadius:5,border:"1px solid #1e50a0",background:"linear-gradient(135deg, #3a78c8 0%, #1e50a0 100%)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",boxShadow:"0 2px 8px rgba(58,120,200,0.3)"}}>
        Close
      </button>
    </div>
  </div>
)}

</div>
</>
);
}