/**
 * Globe3DView.jsx — SurveyMap Pro · Professional Glassmorphism UI
 * Redesigned with refined glassmorphism, modern icons, and premium aesthetics
 * FIXED: Floating top bar for mobile/APK/scroll views
 */
import { useEffect, useRef, useState, useCallback } from "react";
import Papa from "papaparse";
import { latLngToUTM, latLngToMGRS, parseUTM, parseMGRS, utmToLatLng, formatUTM } from "./map/utm-mgrs";
import HeatmapLayer from "./HeatmapLayer";
import SatelliteTimeSlider from "./Satellitetimeslider";
import DroneFlightPath from "./DroneFlightPath";
import { buildLatLngGrid, removeLatLngGrid } from "./Gridlayer";
import DataLayersPanel from "./Datalayerspanel";

// ── Helpers ──────────────────────────────────────────────────────────────────
function haversine(a,b){const R=6371000,r=x=>x*Math.PI/180;const dLat=r(b.lat-a.lat),dLon=r(b.lng-a.lng);const s=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
function formatDist(m,unit){if(unit==="auto")return m>=1000?(m/1000).toFixed(2)+" km":m.toFixed(1)+" m";if(unit==="km")return(m/1000).toFixed(3)+" km";if(unit==="m")return m.toFixed(1)+" m";if(unit==="mi")return(m/1609.344).toFixed(3)+" mi";if(unit==="ft")return(m/0.3048).toFixed(1)+" ft";return m.toFixed(1)+" m";}
function toDMS(val,pos,neg){const a=Math.abs(val),d=Math.floor(a),m=Math.floor((a-d)*60),s=((a-d-m/60)*3600).toFixed(2);return`${d}°${m}'${s}"${val>=0?pos:neg}`;}
function formatAlt(m){return m>=1000?(m/1000).toFixed(0)+" km":m.toFixed(0)+" m";}

const LAT_KEYS=["latitude","lat","y","ylat","lat_deg","location.latitude","loc.latitude","loc_lat","point.latitude","geo.latitude"];
const LNG_KEYS=["longitude","lng","lon","long","x","xlon","lng_deg","location.longitude","loc.longitude","loc_lng","loc_lon","point.longitude","geo.longitude"];
function findColKey(headers,candidates){const exact=headers.find(h=>candidates.includes(h.toLowerCase().trim()));if(exact)return exact;return headers.find(h=>{const l=h.toLowerCase().trim();return candidates===LAT_KEYS?/\blat\b|latitude/.test(l):/\blo[ng]\b|longitude/.test(l);});}
function processInChunks(items,chunkSize,processor,onComplete){let i=0;function next(){const end=Math.min(i+chunkSize,items.length);for(;i<end;i++)processor(items[i]);if(i<items.length)requestAnimationFrame(next);else onComplete();}requestAnimationFrame(next);}
const CSV_MAX=5000;

function buildProvider(Cesium,layer){
  const T=(u,x={})=>new Cesium.UrlTemplateImageryProvider({url:u,maximumLevel:19,...x});
  switch(layer){
    case"Satellite":case"Satellite + Labels":return T("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{credit:"© Esri"});
    case"Street":return T("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{credit:"© OSM"});
    case"Terrain":return T("https://tile.opentopomap.org/{z}/{x}/{y}.png",{credit:"© OpenTopoMap",maximumLevel:17});
    case"Hillshade":return T("https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",{credit:"© Esri"});
    case"Contour":return T("https://tiles.stadiamaps.com/tiles/stamen_terrain_lines/{z}/{x}/{y}.png",{credit:"© Stadia",maximumLevel:18});
    case"Dark":return T("https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",{credit:"© CartoDB"});
    case"Light":return T("https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",{credit:"© CartoDB"});
    default:return T("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{credit:"© Esri"});
  }
}

function dlFile(data,filename,mime){const blob=new Blob([data],{type:mime});const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:filename});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}
function toGeoJSON(drawings){return{type:"FeatureCollection",features:drawings.map(d=>{if(d.type==="marker"){const[la,lo]=d.points[0];return{type:"Feature",properties:{name:d.name,type:"marker"},geometry:{type:"Point",coordinates:[lo,la]}};}if(d.type==="path")return{type:"Feature",properties:{name:d.name,type:"path"},geometry:{type:"LineString",coordinates:d.points.map(([la,lo])=>[lo,la])}};return{type:"Feature",properties:{name:d.name,type:"polygon"},geometry:{type:"Polygon",coordinates:[[...d.points.map(([la,lo])=>[lo,la]),d.points[0]?[d.points[0][1],d.points[0][0]]:null].filter(Boolean)]}};})}}
function toKML(drawings){const pm=drawings.map(d=>{if(d.type==="marker"){const[la,lo]=d.points[0];return`<Placemark><name>${d.name}</name><Point><coordinates>${lo},${la},0</coordinates></Point></Placemark>`;}if(d.type==="path")return`<Placemark><name>${d.name}</name><LineString><coordinates>${d.points.map(([la,lo])=>`${lo},${la},0`).join(" ")}</coordinates></LineString></Placemark>`;const pts=[...d.points,d.points[0]];return`<Placemark><name>${d.name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${pts.map(([la,lo])=>`${lo},${la},0`).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;});return`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>SurveyMap Pro</name>${pm.join("")}</Document></kml>`;}
function toCSV(drawings){const rows=["name,type,latitude,longitude"];drawings.forEach(d=>d.points.forEach(([lat,lng])=>rows.push(`"${d.name}","${d.type}",${lat},${lng}`)));return rows.join("\n");}

const LAYERS=[
  {key:"Satellite",label:"Satellite",icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 6.5l-2 2"/><path d="M12 12l-1.5-1.5"/><path d="M21 3l-5.5 5.5"/><path d="M3 21l5.5-5.5"/><circle cx="12" cy="12" r="2"/><path d="M6.5 17.5l2-2"/><path d="M8.5 8.5L3 3"/><path d="M15.5 15.5L21 21"/></svg>},
  {key:"Street",label:"Street",icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/><path d="M12 3v18"/></svg>},
  {key:"Terrain",label:"Terrain",icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20l4-8 3 5 3-9 4 12"/></svg>},
  {key:"Satellite + Labels",label:"+Labels",icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12l8-8"/><circle cx="19" cy="5" r="2"/></svg>},
  {key:"Dark",label:"Dark",icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>},
  {key:"Light",label:"Light",icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>},
  {key:"Hillshade",label:"Hillshade",icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6l7 7 4-4 7 7"/><path d="M22 17H2"/></svg>},
  {key:"Contour",label:"Contour",icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="6" ry="2.5"/><circle cx="12" cy="12" r="2"/></svg>},
];

// ── SVG Icon components ───────────────────────────────────────────────────────
const Icons = {
  Draw: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>,
  Measure: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4"/></svg>,
  Survey: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="8" height="8"/><rect x="14" y="2" width="8" height="8"/><rect x="2" y="14" width="8" height="8"/><path d="M14 18h8M18 14v8"/></svg>,
  Elevation: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  KML: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13l2 2 4-4"/></svg>,
  CSV: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>,
  Heatmap: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6" strokeOpacity="0.5"/><circle cx="12" cy="12" r="9" strokeOpacity="0.25"/></svg>,
  Timeline: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Drone: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>,
  Night: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  Coords: ()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  GPS: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>,
  Close: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Check: ()=><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  ChevDown: ()=><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
  ChevRight: ()=><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  Menu: ()=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  Search: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Pin: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>,
  Globe: ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Layers: ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  Tools: ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  Star: ()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  Export: ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Building: ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>,
  Grid: ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  ZoomIn: ()=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
  ZoomOut: ()=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
  Fly: ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 20 3c-1-1-3-1-4.5.5L12 7 3.8 5.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>,
  Copy: ()=><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  Refresh: ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  Stop: ()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
};

// ═══════════════════════════════════════════════════════════════════════════
export default function Globe3DView({savedDrawings=[],onClose}){
  const containerRef=useRef(null),viewerRef=useRef(null),CesiumRef=useRef(null);
  const [ready,setReady]=useState(false),[initErr,setInitErr]=useState(null);
  const [activeLayer,setActiveLayer]=useState("Satellite");
  const [mousePos,setMousePos]=useState(null),[cameraAlt,setCameraAlt]=useState(10000000);
  const [compassHeading,setCompassHeading]=useState(0),[viewMode,setViewMode]=useState("3D");
  const [panelOpen,setPanelOpen]=useState(false);
  const [openSec,setOpenSec]=useState({places:true,layers:true,tools:true});
  const toggleSec=k=>setOpenSec(p=>({...p,[k]:!p[k]}));
  const [drawMode,setDrawMode]=useState(false),[drawType,setDrawType]=useState("path");
  const [drawPoints,setDrawPoints]=useState([]);
  const [localDrawings,setLocalDrawings]=useState([...savedDrawings]);
  const [showModal,setShowModal]=useState(false),[pendingName,setPendingName]=useState("");
  const [pendingPts,setPendingPts]=useState([]),[pendingType,setPendingType]=useState("path");
  const [measureMode,setMeasureMode]=useState(false),[measurePoints,setMeasurePoints]=useState([]);
  const [measureUnit,setMeasureUnit]=useState("auto");
  const [surveyMode,setSurveyMode]=useState(false),[surveyRoute,setSurveyRoute]=useState([]);
  const [searchQ,setSearchQ]=useState(""),[searchLoading,setSearchLoading]=useState(false);
  const [locationInfo,setLocationInfo]=useState(null);
  const [nightAuto,setNightAuto]=useState(false),[nightInfo,setNightInfo]=useState(null);
  const [kmlName,setKmlName]=useState(null),[kmlFlyIn,setKmlFlyIn]=useState(false),[kmlStats,setKmlStats]=useState(null);
  const [csvStatus,setCsvStatus]=useState(null),[csvCount,setCsvCount]=useState(0);
  const [csvInfo,setCsvInfo]=useState(null);
  const [coordDisplay,setCoordDisplay]=useState("LatLng");
  const [elevMode,setElevMode]=useState(false);
  const [elevPoints,setElevPoints]=useState([]);
  const [elevProfile,setElevProfile]=useState(null);
  const [elevLoading,setElevLoading]=useState(false);
  const [elevHoverIdx,setElevHoverIdx]=useState(null);
  const elevPtsRef=useRef([]),elevEntsRef=useRef([]),hoverMarkerRef=useRef(null);
  const [gridEnabled,setGridEnabled]=useState(false);
  const [gridMode,setGridMode]=useState("UTM");
  const [demEnabled,setDemEnabled]=useState(false);
  const [demStyle,setDemStyle]=useState("hypsometric");
  const [demOpacity,setDemOpacity]=useState(0.75);
  const demLayersRef=useRef([]);
  const [buildingsEnabled,setBuildingsEnabled]=useState(false);
  const [buildingsLoading,setBuildingsLoading]=useState(false);
  const buildingsTilesetRef=useRef(null);

  const gridGroupRef=useRef([]);
  const gridRebuildTimerRef=useRef(null);
  const gridAltBucketRef=useRef(null);
  const gridRebuildLockRef=useRef(false);

  const [buildingInfo,setBuildingInfo]=useState(null);
  const buildingPickRef=useRef(null);
  const csvPickRef=useRef(null),hoveredEntRef=useRef(null);
  const [heatmapOpen,setHeatmapOpen]=useState(false);
  const [sliderOpen,setSliderOpen]=useState(false);
  const [droneOpen,setDroneOpen]=useState(false);
  const [dataLayersOpen, setDataLayersOpen] = useState(false);
  const drawPtsRef=useRef([]),measurePtsRef=useRef([]),surveyPtsRef=useRef([]);
  const measureEntsRef=useRef([]),surveyEntsRef=useRef([]),boundaryEntsRef=useRef([]);
  const gpsEntRef=useRef(null),clickRef=useRef(null),csvDSRef=useRef(null);
  const orbitRef=useRef(null);

  const [coordConvOpen,setCoordConvOpen]=useState(false);
  const [convInput,setConvInput]=useState("");
  const [convResult,setConvResult]=useState(null);
  const [convError,setConvError]=useState("");
  const [convPickMode,setConvPickMode]=useState(false);
  const [convCopied,setConvCopied]=useState("");
  const convPickRef=useRef(null);

  const TB=52,PANEL=272,SB=28,BNH=58; // BNH = bottom nav height (mobile only)

  // ── PROFESSIONAL GLASSMORPHISM CSS ────────────────────────────────────────
  const CSS=`
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    :root{
      --glass-bg: rgba(10,14,26,0.72);
      --glass-border: rgba(255,255,255,0.08);
      --glass-hover: rgba(255,255,255,0.05);
      --accent: #3b82f6;
      --accent-glow: rgba(59,130,246,0.35);
      --accent2: #06b6d4;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text-primary: #ffffff;
      --text-secondary: rgb(255, 255, 255);
      --text-muted: rgba(255, 255, 255, 0.98);
      --text-dim: rgba(255, 255, 255, 0.93);
      --panel-bg: rgba(8,13,25,0.92);
      --font-ui: 'DM Sans', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'Courier New', monospace;
      --tb-height: 52px;
    }
    html,body,#root{width:100%;height:100%;overflow:hidden;background:#060c18;}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeSlideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes slideLeft{from{transform:translateX(24px);opacity:0}to{transform:translateX(0);opacity:1}}
    @keyframes progressBar{from{width:0%}to{width:100%}}
    @keyframes glowPulse{0%,100%{box-shadow:0 0 12px var(--accent-glow)}50%{box-shadow:0 0 24px var(--accent-glow),0 0 48px rgba(59,130,246,0.15)}}
    @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}

    /* ══════════════════════════════════
       FLOATING TOP TOOLBAR — CORE FIX
       Always floats above everything,
       never scrolls away on mobile/APK
    ══════════════════════════════════ */
    .g3-toolbar{
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: ${TB}px;
      z-index: 1100 !important;
      background: rgba(6,12,24,0.92);
      border-bottom: 1px solid rgba(255,255,255,0.07);
      backdrop-filter: blur(20px) saturate(160%);
      -webkit-backdrop-filter: blur(20px) saturate(160%);
      display: flex;
      align-items: center;
      padding: 0 0 0 12px;
      font-family: var(--font-ui);
      box-shadow: 0 1px 0 rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.5);
      /* Ensure it stays fixed even in WebView/APK environments */
      -webkit-transform: translateZ(0);
      transform: translateZ(0);
      will-change: transform;
      /* Safe area for notched phones */
      padding-top: env(safe-area-inset-top, 0px);
      padding-left: max(12px, env(safe-area-inset-left, 12px));
      padding-right: max(0px, env(safe-area-inset-right, 0px));
    }

    /* Scrollable inner row for toolbar on small screens */
    .g3-toolbar-inner{
      display: flex;
      align-items: center;
      width: 100%;
      height: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      -ms-overflow-style: none;
      gap: 0;
    }
    .g3-toolbar-inner::-webkit-scrollbar{display:none;}

    /* Logo — always visible, never shrinks */
    .g3-logo{
      display: flex;
      align-items: center;
      gap: 8px;
      padding-right: 14px;
      border-right: 1px solid rgba(255,255,255,.07);
      margin-right: 4px;
      flex-shrink: 0;
    }

    /* Toolbar end actions — pushed to far right, never hidden */
    .g3-toolbar-end{
      margin-left: auto;
      padding-right: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    /* View mode pills — never shrink */
    .g3-view-pills{
      margin-left: 6px;
      display: flex;
      align-items: center;
      gap: 1px;
      padding: 3px;
      background: rgba(0,0,0,.35);
      border-radius: 9px;
      border: 1px solid rgba(255,255,255,.12);
      flex-shrink: 0;
    }

    /* Toolbar separator */
    .g3-tb-sep{
      width: 1px;
      height: 24px;
      background: rgba(255,255,255,.1);
      margin: 0 3px;
      flex-shrink: 0;
    }

    /* ── PANEL ── */
    .g3-panel{
      position:fixed;
      /* Account for safe area top on mobile */
      top: calc(${TB}px + env(safe-area-inset-top, 0px));
      left:0;
      bottom: calc(${SB}px + env(safe-area-inset-bottom, 0px));
      width:${PANEL}px;
      z-index:1000;
      background:var(--panel-bg);
      border-right:1px solid var(--glass-border);
      display:flex;flex-direction:column;overflow-y:auto;
      transition:transform .3s cubic-bezier(.4,0,.2,1);
      backdrop-filter:blur(24px) saturate(180%);
      -webkit-backdrop-filter:blur(24px) saturate(180%);
      scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.07) transparent;
    }
    .g3-panel::-webkit-scrollbar{width:4px;}
    .g3-panel::-webkit-scrollbar-track{background:transparent;}
    .g3-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07);border-radius:2px;}

    /* ── MAP VIEWPORT — always below the floating toolbar ── */
    .g3-map{
      position: fixed !important;
      top: calc(${TB}px + env(safe-area-inset-top, 0px)) !important;
      bottom: calc(${SB}px + env(safe-area-inset-bottom, 0px)) !important;
      left: ${PANEL}px;
      right: 0;
      z-index: 900;
      background: #060c18;
    }

    /* ── STATUS BAR — pinned to very bottom ── */
    .g3-statusbar{
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: calc(${SB}px + env(safe-area-inset-bottom, 0px)) !important;
      z-index: 1100 !important;
      background: rgba(6,12,24,0.95);
      border-top: 1px solid rgba(255,255,255,.06);
      backdrop-filter: blur(20px);
      display: flex;
      align-items: center;
      padding: 0 12px;
      padding-bottom: env(safe-area-inset-bottom, 0px);
      gap: 12px;
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: var(--text-muted);
      user-select: none;
      box-shadow: 0 -1px 0 rgba(255,255,255,.03);
      /* Same fixed float technique as toolbar */
      -webkit-transform: translateZ(0);
      transform: translateZ(0);
      will-change: transform;
    }

    /* ── SECTION HEADERS ── */
    .g3-sec-h{
      display:flex;align-items:center;justify-content:space-between;
      padding:11px 16px;cursor:pointer;user-select:none;
      border-bottom:1px solid var(--glass-border);
      color:var(--text-muted);font-size:10px;font-weight:600;letter-spacing:.1em;
      font-family:var(--font-ui);transition:all .15s;
      background:transparent;
    }
    .g3-sec-h:hover{background:var(--glass-hover);color:var(--text-secondary);}
    .g3-sec-h .sec-icon{display:flex;align-items:center;gap:7px;}
    .g3-sec-body{padding:12px 14px 14px;border-bottom:1px solid rgba(255,255,255,.04);}

    /* ── LAYER ROW ── */
    .g3-layer-row{
      display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;
      cursor:pointer;user-select:none;margin-bottom:2px;
      transition:all .15s;border:1px solid transparent;
    }
    .g3-layer-row:hover{background:var(--glass-hover);border-color:var(--glass-border);}
    .g3-layer-row.active{background:rgba(59,130,246,0.1);border-color:rgba(59,130,246,0.3);}

    /* ── TOOLBAR BUTTONS ── */
    .g3-tbtn{
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:0 11px;height:${TB}px;border:none;cursor:pointer;gap:3px;
      background:transparent;position:relative;
      color:rgba(255,255,255,0.65);font-size:9.5px;font-weight:600;letter-spacing:.05em;
      transition:all .18s;min-width:52px;flex-shrink:0;font-family:var(--font-ui);
      border-bottom:2px solid transparent;
      white-space: nowrap;
    }
    .g3-tbtn svg{stroke:rgba(255,255,255,0.65);transition:stroke .18s;}
    .g3-tbtn::after{
      content:'';position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);
      width:0;height:2px;background:var(--accent);border-radius:1px;
      transition:width .2s ease;
    }
    .g3-tbtn:hover{color:#fff;background:rgba(255,255,255,.06);}
    .g3-tbtn:hover svg{stroke:#fff;}
    .g3-tbtn:hover::after{width:70%;}
    .g3-tbtn.active{color:#60a5fa;background:rgba(59,130,246,.12);}
    .g3-tbtn.active svg{stroke:#60a5fa;}
    .g3-tbtn.active::after{width:100%;background:linear-gradient(90deg,#3b82f6,#06b6d4);}

    /* ── PRIMARY BUTTON ── */
    .g3-primary{
      width:100%;padding:9px 14px;border-radius:8px;border:none;
      color:#fff;font-weight:600;font-size:12px;cursor:pointer;
      font-family:var(--font-ui);transition:all .18s;
      display:flex;align-items:center;justify-content:center;gap:6px;
      letter-spacing:.02em;
    }
    .g3-primary:hover{filter:brightness(1.12);transform:translateY(-1px);}
    .g3-primary:active{transform:translateY(0);}

    /* ── GLASS CARD ── */
    .g3-card{
      background:rgba(255,255,255,.025);
      border:1px solid var(--glass-border);
      border-radius:10px;padding:12px;
    }

    /* ── BADGE ── */
    .g3-badge{
      font-size:9px;padding:2px 7px;border-radius:20px;
      font-weight:700;letter-spacing:.04em;font-family:var(--font-ui);
    }

    /* ── CHECKBOX ── */
    .g3-chk{
      width:16px;height:16px;border-radius:4px;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      transition:all .15s;border:1.5px solid;
    }

    /* ── INPUT ── */
    .g3-input{
      width:100%;padding:8px 11px;border-radius:8px;
      border:1px solid var(--glass-border);
      background:rgba(255,255,255,.04);
      color:var(--text-primary);font-size:11.5px;
      outline:none;font-family:var(--font-ui);
      transition:border-color .15s,box-shadow .15s;
    }
    .g3-input:focus{border-color:rgba(59,130,246,.5);box-shadow:0 0 0 3px rgba(59,130,246,.1);}
    .g3-input::placeholder{color:var(--text-dim);}

    /* ── TOOLBAR LABELS ── */
    .g3-tb-lbl{color:inherit;font-size:9px;font-weight:600;letter-spacing:.05em;line-height:1;}

    /* Force all SVGs inside toolbar to inherit stroke */
    .g3-tbtn svg{display:block;}

    /* ── DIVIDER ── */
    .g3-divider{height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent);margin:12px 0;}

    /* ── TOOLTIP TAG ── */
    .g3-tag{
      display:inline-flex;align-items:center;gap:4px;
      font-size:9px;font-weight:700;letter-spacing:.05em;
      padding:2px 7px;border-radius:4px;font-family:var(--font-ui);
    }

    /* ══════════════════════════════════════
       BOTTOM NAV BAR — mobile only
    ══════════════════════════════════════ */
    .g3-bottom-nav{
      display: none;
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: calc(${BNH}px + env(safe-area-inset-bottom, 0px));
      padding-bottom: env(safe-area-inset-bottom, 0px);
      z-index: 1150 !important;
      background: rgba(6,10,20,0.97);
      border-top: 1px solid rgba(255,255,255,0.08);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      -webkit-transform: translateZ(0);
      transform: translateZ(0);
      will-change: transform;
      flex-direction: row;
      align-items: stretch;
      justify-content: space-around;
    }
    .g3-bnav-item{
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 6px 4px;
      position: relative;
      color: rgba(255,255,255,0.45);
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: .04em;
      font-family: var(--font-ui);
      transition: color .18s;
      -webkit-tap-highlight-color: transparent;
    }
    .g3-bnav-item svg{ stroke: rgba(255,255,255,0.45); transition: stroke .18s; }
    .g3-bnav-item.active{ color: #60a5fa; }
    .g3-bnav-item.active svg{ stroke: #60a5fa; }
    .g3-bnav-item.active::before{
      content: '';
      position: absolute;
      top: 0; left: 20%; right: 20%;
      height: 2px;
      background: linear-gradient(90deg,#3b82f6,#06b6d4);
      border-radius: 0 0 3px 3px;
    }
    .g3-bnav-item.active-warn{ color: #f59e0b; }
    .g3-bnav-item.active-warn svg{ stroke: #f59e0b; }
    .g3-bnav-item.active-warn::before{
      content: '';
      position: absolute;
      top: 0; left: 20%; right: 20%;
      height: 2px;
      background: linear-gradient(90deg,#f59e0b,#fbbf24);
      border-radius: 0 0 3px 3px;
    }
    .g3-bnav-badge{
      position: absolute;
      top: 5px; right: calc(50% - 18px);
      min-width: 14px; height: 14px;
      background: #ef4444;
      border-radius: 7px;
      font-size: 8px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 3px;
      border: 1.5px solid rgba(6,10,20,0.97);
      font-family: var(--font-ui);
    }

    /* ── MOBILE / APK ── */
    @media(max-width:640px){
      /* Panel slides in as overlay */
      .g3-panel{transform:translateX(-100%); bottom: 0 !important;}
      .g3-panel.open{transform:translateX(0);z-index:1250;}

      /* Map fills whole screen below toolbar, above bottom nav */
      .g3-map{
        left:0!important;
        bottom: calc(${BNH}px + env(safe-area-inset-bottom, 0px)) !important;
      }

      /* Status bar hidden on mobile (bottom nav replaces it) */
      .g3-statusbar{ display: none !important; }

      /* Bottom nav visible on mobile */
      .g3-bottom-nav{ display: flex !important; }

      /* Hamburger visible */
      .g3-ham{display:flex!important;}

      /* Toolbar labels hidden to save space */
      .g3-tb-lbl{display:none!important;}

      /* Smaller toolbar buttons */
      .g3-tbtn{min-width:40px!important;padding:0 7px!important;}

      /* Floating toolbar even thinner */
      :root{--tb-height:48px;}
      .g3-toolbar{height:48px;}

      /* Zoom & compass — above bottom nav */
      .g3-zoom{
        bottom: calc(${BNH}px + env(safe-area-inset-bottom, 0px) + 12px) !important;
        right: 10px !important;
      }
      .g3-compass{
        bottom: calc(${BNH}px + env(safe-area-inset-bottom, 0px) + 8px) !important;
        right: 10px !important;
      }

      /* KML stats compact on mobile */
      .g3-kml-stats{right:10px!important;width:calc(100vw - 20px)!important;max-width:260px!important;}

      /* Elevation profile — full width, above bottom nav */
      .g3-elev-panel{
        left: 0 !important;
        right: 0 !important;
        bottom: calc(${BNH}px + env(safe-area-inset-bottom, 0px)) !important;
      }

      /* Mode banners — stay below top toolbar */
      .g3-mode-banner{
        top: calc(48px + env(safe-area-inset-top, 0px) + 8px) !important;
      }

      /* Floating panels full-width on mobile */
      .g3-float-panel{
        left: 8px !important;
        right: 8px !important;
        width: auto !important;
        max-width: none !important;
      }

      /* Survey/draw tool active bottom sheet — above nav */
      .g3-tool-sheet{
        bottom: calc(${BNH}px + env(safe-area-inset-bottom, 0px)) !important;
      }
    }
    @media(min-width:641px){
      .g3-ham{display:none!important;}
      .g3-bottom-nav{display:none!important;}
    }

    /* ── SAFE AREA FOR TABLETS / LANDSCAPE NOTCH ── */
    @supports(padding-top: env(safe-area-inset-top)){
      .g3-toolbar{
        height: calc(${TB}px + env(safe-area-inset-top, 0px));
        padding-top: env(safe-area-inset-top, 0px);
      }
      .g3-panel{
        top: calc(${TB}px + env(safe-area-inset-top, 0px));
      }
      .g3-map{
        top: calc(${TB}px + env(safe-area-inset-top, 0px)) !important;
      }
    }

    /* Mobile coordinate strip — above bottom nav */
    .g3-coord-strip{
      display: none;
      position: fixed !important;
      bottom: calc(${BNH}px + env(safe-area-inset-bottom, 0px)) !important;
      left: 0 !important;
      right: 0 !important;
      height: 26px;
      z-index: 1140 !important;
      background: rgba(4,8,18,0.94);
      border-top: 1px solid rgba(255,255,255,0.05);
      align-items: center;
      justify-content: center;
      gap: 10px;
      font-family: var(--font-mono);
      font-size: 10px;
      color: rgba(255,255,255,0.6);
      padding: 0 12px;
      -webkit-transform: translateZ(0);
      transform: translateZ(0);
    }
    @media(max-width:640px){
      .g3-coord-strip{ display: flex !important; }
      /* Elevation profile also needs to clear coord strip */
      .g3-elev-panel{
        bottom: calc(${BNH}px + 26px + env(safe-area-inset-bottom, 0px)) !important;
      }
    }
    /* Some Android WebViews ignore position:fixed during momentum scroll.
       Wrapping in a transform context forces compositing layer. */
    body{
      -webkit-overflow-scrolling: auto !important;
      overflow: hidden !important;
      overscroll-behavior: none;
      touch-action: pan-x pan-y;
    }
  `;

  // ── INIT ─────────────────────────────────────────────────────────────────
  useEffect(()=>{
    let viewer;
    (async()=>{
      try{
        const Cesium=await import("cesium");
        await import("cesium/Build/Cesium/Widgets/widgets.css");
        CesiumRef.current=Cesium;
        Cesium.Ion.defaultAccessToken="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjMjhhMGMwMi05MjY5LTQ5NzMtYjc2OC00OWZmZmVmZWQzNjIiLCJpZCI6Mzk4NDk3LCJpYXQiOjE3NzI3MDAwNzB9.tLRJbx3sOnKsgEm5Agr7QUVGWmVdYpzbYdNxP5105G0";
        viewer=new Cesium.Viewer(containerRef.current,{
          terrainProvider:await Cesium.createWorldTerrainAsync({requestWaterMask:false,requestVertexNormals:true}),
          timeline:false,animation:false,baseLayerPicker:false,geocoder:false,
          homeButton:false,sceneModePicker:false,navigationHelpButton:false,
          fullscreenButton:false,infoBox:false,selectionIndicator:false,
          creditContainer:document.createElement("div"),
        });
        viewer.scene.globe.depthTestAgainstTerrain=true;
        viewer.scene.globe.enableLighting=false;
        viewer.scene.screenSpaceCameraController.enableCollisionDetection=true;
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(buildProvider(Cesium,"Satellite"));
        viewerRef.current=viewer;setReady(true);
        viewer.scene.postRender.addEventListener(()=>{
          try{const c=viewer.camera.positionCartographic;if(c)setCameraAlt(c.height);const h=viewer.camera.heading;if(h!=null&&!isNaN(h))setCompassHeading(Cesium.Math.toDegrees(h));}catch(_){}
        });
        const mh=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        mh.setInputAction(e=>{
          try{const ray=viewer.camera.getPickRay(e.endPosition);if(!ray)return;const pos=viewer.scene.globe.pick(ray,viewer.scene);if(!pos){setMousePos(null);return;}const c=Cesium.Cartographic.fromCartesian(pos);setMousePos({lat:Cesium.Math.toDegrees(c.latitude),lng:Cesium.Math.toDegrees(c.longitude)});}catch(_){}
        },Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        savedDrawings.forEach(d=>renderDrawing(viewer,Cesium,d));
      }catch(err){setInitErr(err.message);}
    })();
    return()=>{
      if(orbitRef.current){orbitRef.current.active=false;if(orbitRef.current.animFrame)cancelAnimationFrame(orbitRef.current.animFrame);orbitRef.current=null;}
      if(viewer&&!viewer.isDestroyed())viewer.destroy();
    };
  },[]);// eslint-disable-line

  useEffect(()=>{if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;viewer.imageryLayers.removeAll();viewer.imageryLayers.addImageryProvider(buildProvider(Cesium,activeLayer));if(activeLayer==="Satellite + Labels")viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:"https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",maximumLevel:19,credit:"© Esri"}));},[activeLayer,ready]);
  useEffect(()=>{if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;if(viewMode==="3D")viewer.scene.morphTo3D(1);if(viewMode==="2D")viewer.scene.morphTo2D(1);if(viewMode==="Columbus")viewer.scene.morphToColumbusView(1);},[viewMode,ready]);

  // ── OSM 3D Buildings ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!ready)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(!buildingsEnabled){if(buildingsTilesetRef.current){try{viewer.scene.primitives.remove(buildingsTilesetRef.current);}catch(_){}buildingsTilesetRef.current=null;}if(buildingPickRef.current){buildingPickRef.current.destroy();buildingPickRef.current=null;}setBuildingInfo(null);viewer.scene.globe.enableLighting=false;return;}
    if(viewMode!=="3D"){viewer.scene.morphTo3D(1);}
    setBuildingsLoading(true);
    (async()=>{
      try{
        const tileset=await Cesium.createOsmBuildingsAsync();
        tileset.style=new Cesium.Cesium3DTileStyle({color:{conditions:[["${feature['building']} === 'hospital'","color('#fca5a5', 0.95)"],["${feature['building']} === 'school' || ${feature['building']} === 'college'","color('#fcd34d', 0.95)"],["${feature['building']} === 'church' || ${feature['building']} === 'temple' || ${feature['building']} === 'mosque'","color('#c4b5fd', 0.95)"],["${feature['building']} === 'industrial' || ${feature['building']} === 'warehouse'","color('#9ca3af', 0.90)"],["${feature['building']} === 'commercial' || ${feature['building']} === 'retail'","color('#93c5fd', 0.95)"],["${feature['building']} === 'government' || ${feature['building']} === 'public'","color('#6ee7b7', 0.95)"],["${feature['building']} === 'hotel' || ${feature['building']} === 'apartments'","color('#fdba74', 0.90)"],["true","color('#e2e8f0', 0.85)"]]}});
        viewer.scene.globe.enableLighting=true;viewer.scene.light=new Cesium.SunLight();
        if(!viewer.isDestroyed()){
          viewer.scene.primitives.add(tileset);buildingsTilesetRef.current=tileset;
          if(buildingPickRef.current){buildingPickRef.current.destroy();}
          const ph=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);buildingPickRef.current=ph;
          ph.setInputAction(click=>{
            const picked=viewer.scene.pick(click.position);
            if(picked&&picked.getProperty){const rawType=picked.getProperty("building")||picked.getProperty("amenity")||"";const name=picked.getProperty("name")||picked.getProperty("addr:housename")||picked.getProperty("addr:street")||"";const type=(rawType==="yes"||rawType===""||rawType==="True")?"untagged":rawType;const estHeight=picked.getProperty("cesium#estimatedHeight");const osmHeight=picked.getProperty("height")||picked.getProperty("building:height");const floors=picked.getProperty("building:levels");const displayHeight=osmHeight?`${parseFloat(osmHeight).toFixed(1)} m`:(estHeight&&parseFloat(estHeight)>5)?`~${parseFloat(estHeight).toFixed(0)} m (est.)`:null;const rect=viewer.scene.canvas.getBoundingClientRect();setBuildingInfo({name:name||(type==="untagged"?"Building":type.charAt(0).toUpperCase()+type.slice(1)),type,height:displayHeight,floors:floors?`${floors} floors`:null,untagged:type==="untagged",x:Math.min(click.position.x+rect.left+12,window.innerWidth-260),y:Math.max(click.position.y+rect.top-10,60)});}else{setBuildingInfo(null);}
          },Cesium.ScreenSpaceEventType.LEFT_CLICK);
          ph.setInputAction(move=>{const picked=viewer.scene.pick(move.endPosition);viewer.scene.canvas.style.cursor=(picked&&picked.getProperty)?'pointer':'default';},Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
      }catch(err){console.error("OSM Buildings load failed:",err);setBuildingsEnabled(false);alert("3D Buildings failed to load.");}
      finally{setBuildingsLoading(false);}
    })();
  },[buildingsEnabled,ready]);// eslint-disable-line

  useEffect(()=>{if(!nightAuto)return;let timer;(async()=>{try{const pos=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:8000}));const{latitude:lat,longitude:lng}=pos.coords;const data=await(await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=sunrise,sunset&timezone=auto&forecast_days=1`)).json();const sunrise=new Date(data.daily.sunrise[0]),sunset=new Date(data.daily.sunset[0]);const check=()=>{const now=new Date(),isNight=now<sunrise||now>sunset;setNightInfo({isNight});setActiveLayer(isNight?"Dark":"Satellite + Labels");};check();timer=setInterval(check,60000);}catch(e){console.warn(e);}})();return()=>clearInterval(timer);},[nightAuto]);

  // ── DEM ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;
    demLayersRef.current.forEach(l=>{try{viewer.imageryLayers.remove(l,true);}catch(_){}});demLayersRef.current=[];
    if(!demEnabled)return;
    const addLayer=(provider,alpha)=>{const l=viewer.imageryLayers.addImageryProvider(provider);l.alpha=alpha;demLayersRef.current.push(l);return l;};
    if(demStyle==="hypsometric"||demStyle==="both")addLayer(new Cesium.UrlTemplateImageryProvider({url:"https://tile.opentopomap.org/{z}/{x}/{y}.png",credit:"© OpenTopoMap / SRTM",maximumLevel:17}),demStyle==="both"?demOpacity*0.7:demOpacity);
    if(demStyle==="slope"||demStyle==="both")addLayer(new Cesium.UrlTemplateImageryProvider({url:"https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",credit:"© Esri",maximumLevel:16}),demStyle==="both"?demOpacity*0.6:demOpacity);
  },[demEnabled,demStyle,demOpacity,ready]);// eslint-disable-line

  useEffect(()=>{if(!ready||!demEnabled)return;demLayersRef.current.forEach((l,i)=>{if(demStyle==="both"){l.alpha=i===0?demOpacity*0.7:demOpacity*0.6;}else{l.alpha=demOpacity;}});},[demOpacity]);// eslint-disable-line

  // ── Elevation Mode ────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(!elevMode){elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});elevEntsRef.current=[];elevPtsRef.current=[];if(hoverMarkerRef.current){try{viewer.entities.remove(hoverMarkerRef.current);}catch(_){}hoverMarkerRef.current=null;}return;}
    const handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(async click=>{
      const ray=viewer.camera.getPickRay(click.position);if(!ray)return;
      const pos=viewer.scene.globe.pick(ray,viewer.scene);if(!pos)return;
      const carto=Cesium.Cartographic.fromCartesian(pos);
      const lat=Cesium.Math.toDegrees(carto.latitude),lng=Cesium.Math.toDegrees(carto.longitude);
      const newPts=[...elevPtsRef.current,{lat,lng}];elevPtsRef.current=newPts;setElevPoints([...newPts]);
      const idx=newPts.length;
      const ent=viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:10,color:Cesium.Color.fromCssColorString("#f59e0b"),outlineColor:Cesium.Color.WHITE,outlineWidth:2,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:String(idx),font:"bold 11px sans-serif",fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,pixelOffset:new Cesium.Cartesian2(0,-14),disableDepthTestDistance:Number.POSITIVE_INFINITY}});
      elevEntsRef.current=[...elevEntsRef.current,ent];
      if(newPts.length>=2){const lineEnt=viewer.entities.add({polyline:{positions:Cesium.Cartesian3.fromDegreesArray(newPts.flatMap(p=>[p.lng,p.lat])),width:2.5,material:new Cesium.PolylineDashMaterialProperty({color:Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.85),dashLength:12}),clampToGround:true}});elevEntsRef.current=[...elevEntsRef.current,lineEnt];}
      if(newPts.length>=2){
        setElevLoading(true);
        try{
          const SAMPLES=100;
          const EGM96_PTS=[[20,85,-44.7],[20,90,-41.2],[20,80,-48.9],[25,85,-44.1],[15,85,-47.3],[20,75,-51.2],[28,77,-40.1],[19,73,-46.2],[13,80,-52.3],[13,77,-53.1],[22,88,-42.1],[17,78,-49.1],[26,92,-41.5],[24,68,-41.9],[32,74,-36.8],[8,77,-55.1],[23,86,-43.2],[21,82,-45.1],[18,84,-45.9],[27,95,-33.4],[30,80,-34.6],[12,79,-53.8],[25,72,-44.5],[15,75,-51.4],[20,95,-35.2],[10,76,-56.8],[22,70,-46.3],[28,72,-41.8],[18,74,-50.2],[24,78,-44.0],[51,0,46.8],[48,2,46.0],[52,13,35.7],[55,37,13.6],[59,18,24.1],[40,-74,-28.5],[34,-118,-31.8],[45,-75,-23.2],[51,-114,-16.3],[35,139,36.5],[31,121,11.2],[22,114,3.4],[35,36,24.1],[30,31,21.5],[-33,151,19.2],[-23,-43,-5.6],[-34,-58,-7.4],[-26,28,-19.5],[0,0,17.2],[60,0,22.9],[-10,30,-16.0],[64,26,18.4],[0,110,-28.3],[35,60,-3.4],[40,55,-7.2],[50,60,-12.8],[25,55,-18.5],[20,45,-24.0]];
          function geoidN(latDeg,lngDeg){let sumW=0,sumNW=0;const top=EGM96_PTS.map(([la,lo,n])=>{const d=Math.sqrt((la-latDeg)**2+(lo-lngDeg)**2)+0.001;return{n,d};}).sort((a,b)=>a.d-b.d).slice(0,8);for(const p of top){const w=1/(p.d*p.d);sumW+=w;sumNW+=w*p.n;}return sumNW/sumW;}
          const samplePositions=[];const segLengths=[];let totalLen=0;const waypointCumDists=[0];
          for(let i=0;i<newPts.length-1;i++){const a=newPts[i],b=newPts[i+1];const R=6371000,r=x=>x*Math.PI/180;const dLat=r(b.lat-a.lat),dLon=r(b.lng-a.lng);const s=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;const segLen=R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));segLengths.push(segLen);totalLen+=segLen;waypointCumDists.push(totalLen);}
          for(let s=0;s<=SAMPLES;s++){const t=(s/SAMPLES)*totalLen;let acc=0,segIdx=0;while(segIdx<segLengths.length-1&&acc+segLengths[segIdx]<t){acc+=segLengths[segIdx];segIdx++;}const segT=segLengths[segIdx]>0?(t-acc)/segLengths[segIdx]:0;const a=newPts[segIdx],b=newPts[Math.min(segIdx+1,newPts.length-1)];samplePositions.push(Cesium.Cartographic.fromDegrees(a.lng+(b.lng-a.lng)*segT,a.lat+(b.lat-a.lat)*segT));}
          const sampled=await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider,samplePositions);
          let cumDist=0;
          const profileSamples=sampled.map((c,i)=>{if(i>0){const p=sampled[i-1];const R=6371000;const dLat=c.latitude-p.latitude,dLon=c.longitude-p.longitude;const a2=Math.sin(dLat/2)**2+Math.cos(p.latitude)*Math.cos(c.latitude)*Math.sin(dLon/2)**2;cumDist+=R*2*Math.atan2(Math.sqrt(a2),Math.sqrt(1-a2));}const latDeg=Cesium.Math.toDegrees(c.latitude);const lngDeg=Cesium.Math.toDegrees(c.longitude);const ellipsoidH=c.height??0;const mslH=ellipsoidH-geoidN(latDeg,lngDeg);return{d:cumDist,h:Math.round(mslH*10)/10};});
          const heights=profileSamples.map(s=>s.h);const minH=Math.min(...heights),maxH=Math.max(...heights);const totalDist=profileSamples[profileSamples.length-1].d;let maxSlope=0;for(let i=1;i<profileSamples.length;i++){const run=profileSamples[i].d-profileSamples[i-1].d;const rise=Math.abs(profileSamples[i].h-profileSamples[i-1].h);if(run>0)maxSlope=Math.max(maxSlope,(rise/run)*100);}
          setElevProfile({samples:profileSamples,stats:{minH,maxH,relief:maxH-minH,totalDist,maxSlope,pts:newPts.length},positions:samplePositions.map(c=>({lat:Cesium.Math.toDegrees(c.latitude),lng:Cesium.Math.toDegrees(c.longitude)})),waypointCumDists,_unit:"m"});
          if(!hoverMarkerRef.current)hoverMarkerRef.current=viewer.entities.add({show:false,position:Cesium.Cartesian3.fromDegrees(0,0,0),point:{pixelSize:12,color:Cesium.Color.fromCssColorString("#ef4444"),outlineColor:Cesium.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
        }catch(err){console.error("Terrain sampling failed:",err);}
        finally{setElevLoading(false);}
      }
    },Cesium.ScreenSpaceEventType.LEFT_CLICK);
    viewer.scene.canvas.style.cursor="crosshair";
    return()=>{handler.destroy();viewer.scene.canvas.style.cursor="default";};
  },[elevMode,ready]);// eslint-disable-line

  // ── Grid ──────────────────────────────────────────────────────────────────
  function altBucket(alt){const thresholds=[5000,15000,40000,100000,300000,700000,1500000,3000000,6000000,12000000,Infinity];for(let i=0;i<thresholds.length;i++){if(alt<thresholds[i])return i;}return thresholds.length;}

  const doGridRebuild=useCallback(()=>{
    if(!ready)return;if(gridRebuildLockRef.current)return;
    const viewer=viewerRef.current,Cesium=CesiumRef.current;if(!viewer||!Cesium)return;
    try{if(viewer.isDestroyed())return;}catch(_){return;}
    gridRebuildLockRef.current=true;
    if(gridGroupRef.current?.length>0){try{removeLatLngGrid(viewer,gridGroupRef.current);}catch(e){console.warn("[Grid] cleanup error:",e);}gridGroupRef.current=[];}
    if(!gridEnabled){gridRebuildLockRef.current=false;return;}
    const currentAlt=viewer.camera.positionCartographic?.height??1000000;
    gridAltBucketRef.current=altBucket(currentAlt);
    try{const ents=buildLatLngGrid(viewer,Cesium,{mode:gridMode,alt:currentAlt});gridGroupRef.current=Array.isArray(ents)?ents:[];}catch(e){console.error("[Grid] build error:",e);gridGroupRef.current=[];}
    gridRebuildLockRef.current=false;
  },[ready,gridEnabled,gridMode]);

  useEffect(()=>{
    if(!ready)return;doGridRebuild();
    return()=>{const viewer=viewerRef.current,group=gridGroupRef.current;if(viewer&&group?.length){try{if(!viewer.isDestroyed())removeLatLngGrid(viewer,group);}catch(_){}gridGroupRef.current=[];}};
  },[gridEnabled,gridMode,ready]);// eslint-disable-line

  useEffect(()=>{
    if(!ready||!gridEnabled)return;const bucket=altBucket(cameraAlt);
    if(gridAltBucketRef.current!==null&&bucket===gridAltBucketRef.current)return;
    if(gridRebuildTimerRef.current)clearTimeout(gridRebuildTimerRef.current);
    gridRebuildTimerRef.current=setTimeout(()=>{gridRebuildTimerRef.current=null;doGridRebuild();},350);
    return()=>{if(gridRebuildTimerRef.current){clearTimeout(gridRebuildTimerRef.current);gridRebuildTimerRef.current=null;}};
  },[cameraAlt,ready,gridEnabled]);// eslint-disable-line

  // ── Click handler ─────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(clickRef.current){clickRef.current.destroy();clickRef.current=null;}
    if(!drawMode&&!measureMode&&!surveyMode)return;
    const handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);clickRef.current=handler;
    handler.setInputAction(click=>{
      const ray=viewer.camera.getPickRay(click.position);if(!ray)return;
      const pos=viewer.scene.globe.pick(ray,viewer.scene);if(!pos)return;
      const carto=Cesium.Cartographic.fromCartesian(pos);
      const lat=Cesium.Math.toDegrees(carto.latitude),lng=Cesium.Math.toDegrees(carto.longitude),pt={lat,lng};
      if(drawMode){if(drawType==="marker"){setPendingPts([pt]);setPendingType("marker");setPendingName("");setShowModal(true);setDrawMode(false);return;}const next=[...drawPtsRef.current,pt];drawPtsRef.current=next;setDrawPoints([...next]);viewer.entities.add({position:pos,point:{pixelSize:7,color:Cesium.Color.fromCssColorString("#f97316"),outlineColor:Cesium.Color.WHITE,outlineWidth:1}});}
      if(measureMode){const next=[...measurePtsRef.current,pt];measurePtsRef.current=next;setMeasurePoints([...next]);const dot=viewer.entities.add({position:pos,point:{pixelSize:9,color:Cesium.Color.YELLOW,outlineColor:Cesium.Color.BLACK,outlineWidth:1}});measureEntsRef.current.push(dot);if(next.length>=2){const line=viewer.entities.add({polyline:{positions:next.map(p=>Cesium.Cartesian3.fromDegrees(p.lng,p.lat)),width:2,material:new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW.withAlpha(0.85)),clampToGround:true,arcType:Cesium.ArcType.GEODESIC}});measureEntsRef.current.push(line);}}
      if(surveyMode){const next=[...surveyPtsRef.current,pt];surveyPtsRef.current=next;setSurveyRoute([...next]);const pin=viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:11,color:Cesium.Color.RED,outlineColor:Cesium.Color.WHITE,outlineWidth:2},label:{text:String(next.length),font:"bold 13px sans-serif",fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-22)}});surveyEntsRef.current.push(pin);if(next.length>=2){const line=viewer.entities.add({polyline:{positions:next.map(p=>Cesium.Cartesian3.fromDegrees(p.lng,p.lat)),width:3,material:new Cesium.ColorMaterialProperty(Cesium.Color.RED.withAlpha(0.8)),clampToGround:true,arcType:Cesium.ArcType.GEODESIC}});surveyEntsRef.current.push(line);}}
    },Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return()=>{if(clickRef.current){clickRef.current.destroy();clickRef.current=null;}};
  },[drawMode,measureMode,surveyMode,drawType,ready]);

  function renderDrawing(viewer,Cesium,d){
    if(d.type==="marker"){const[la,lo]=d.points[0];viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lo,la),point:{pixelSize:12,color:Cesium.Color.fromCssColorString("#3b82f6"),outlineColor:Cesium.Color.WHITE,outlineWidth:2},label:{text:d.name,font:"bold 12px sans-serif",fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-22),showBackground:true,backgroundColor:new Cesium.Color(0.1,0.14,0.23,0.9),backgroundPadding:new Cesium.Cartesian2(6,4)}});}
    else if(d.type==="path")viewer.entities.add({polyline:{positions:d.points.map(([la,lo])=>Cesium.Cartesian3.fromDegrees(lo,la)),width:3,material:new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString("#f97316")),clampToGround:true,arcType:Cesium.ArcType.GEODESIC}});
    else if(d.type==="polygon")viewer.entities.add({polygon:{hierarchy:new Cesium.PolygonHierarchy(d.points.map(([la,lo])=>Cesium.Cartesian3.fromDegrees(lo,la))),material:Cesium.Color.fromCssColorString("#3b82f6").withAlpha(0.25),outline:true,outlineColor:Cesium.Color.fromCssColorString("#3b82f6")}});
  }

  function finishDrawing(){if(!drawPtsRef.current.length)return;setPendingPts([...drawPtsRef.current]);setPendingType(drawType);setPendingName("");setShowModal(true);}
  function confirmDrawing(){const name=pendingName.trim()||(pendingType==="marker"?"Marker":pendingType==="path"?"Path":"Polygon");const d={name,type:pendingType,points:pendingPts.map(p=>[p.lat,p.lng])};setLocalDrawings(p=>[...p,d]);renderDrawing(viewerRef.current,CesiumRef.current,d);drawPtsRef.current=[];setDrawPoints([]);setShowModal(false);setDrawMode(false);}
  function cancelDrawing(){drawPtsRef.current=[];setDrawPoints([]);setShowModal(false);setDrawMode(false);}
  function resetMeasure(){measureEntsRef.current.forEach(e=>viewerRef.current.entities.remove(e));measureEntsRef.current=[];measurePtsRef.current=[];setMeasurePoints([]);}
  function clearMeasure(){resetMeasure();setMeasureMode(false);}
  function clearSurvey(){surveyEntsRef.current.forEach(e=>viewerRef.current.entities.remove(e));surveyEntsRef.current=[];surveyPtsRef.current=[];setSurveyRoute([]);setSurveyMode(false);}
  const totalDist=measurePoints.length>=2?measurePoints.reduce((s,p,i)=>i===0?0:s+haversine(measurePoints[i-1],p),0):0;

  function handleGPS(){if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;navigator.geolocation.getCurrentPosition(({coords:{latitude:la,longitude:lo}})=>{if(gpsEntRef.current)viewer.entities.remove(gpsEntRef.current);gpsEntRef.current=viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lo,la),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#06b6d4"),outlineColor:Cesium.Color.WHITE,outlineWidth:3},label:{text:"You",font:"bold 12px sans-serif",fillColor:Cesium.Color.fromCssColorString("#06b6d4"),outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-24)}});viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lo,la,8000),duration:2});},err=>alert("GPS: "+err.message));}

  // ── Coord Converter ───────────────────────────────────────────────────────
  function parseDMS(str){const clean=str.trim().replace(/[°d]/g," ").replace(/[′']/g," ").replace(/[″"]/g," ").replace(/\s+/g," ");const m=clean.match(/^(-?\d+\.?\d*)\s+(\d+\.?\d*)?\s*(\d+\.?\d*)?\s*([NSEW])?$/i);if(!m)return null;let deg=parseFloat(m[1]),min=parseFloat(m[2]||0),sec=parseFloat(m[3]||0);const dir=(m[4]||"").toUpperCase();let dd=deg+(min/60)+(sec/3600);if(dir==="S"||dir==="W")dd=-Math.abs(dd);return isFinite(dd)?dd:null;}

  function buildConvResult(lat,lng){
    if(!isFinite(lat)||!isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return null;
    const utm=latLngToUTM(lat,lng);const mgrs=latLngToMGRS(lat,lng,5);
    const dmsLat=toDMS(lat,"N","S"),dmsLng=toDMS(lng,"E","W");
    const dd=`${lat.toFixed(6)}°, ${lng.toFixed(6)}°`;const ddSimple=`${lat.toFixed(6)}, ${lng.toFixed(6)}`;const ddSigned=`${lat>=0?"+":""}${lat.toFixed(6)}, ${lng>=0?"+":""}${lng.toFixed(6)}`;const utmStr=utm?`${utm.zone}${utm.band} ${utm.easting}E ${utm.northing}N`:"";const mgrsStr=mgrs||"";const dmsStr=`${dmsLat}, ${dmsLng}`;
    const geohash=(()=>{try{const BASE32="0123456789bcdefghjkmnpqrstuvwxyz";let minLat=-90,maxLat=90,minLng=-180,maxLng=180;let bits=0,hashVal=0,hash="";let isEven=true;while(hash.length<9){if(isEven){const mid=(minLng+maxLng)/2;if(lng>mid){hashVal=(hashVal<<1)|1;minLng=mid;}else{hashVal=hashVal<<1;maxLng=mid;}}else{const mid=(minLat+maxLat)/2;if(lat>mid){hashVal=(hashVal<<1)|1;minLat=mid;}else{hashVal=hashVal<<1;maxLat=mid;}}isEven=!isEven;bits++;if(bits===5){hash+=BASE32[hashVal];bits=0;hashVal=0;}}return hash;}catch{return "";}})();
    return{lat,lng,dd,ddSimple,ddSigned,dmsStr,utmStr,mgrsStr,geohash,utm};
  }

  function parseConvInput(raw){const q=raw.trim();if(!q)return null;const ll=q.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);if(ll){const la=parseFloat(ll[1]),lo=parseFloat(ll[2]);if(isFinite(la)&&isFinite(lo)&&la>=-90&&la<=90&&lo>=-180&&lo<=180)return buildConvResult(la,lo);}const utmP=parseUTM(q);if(utmP){const ll2=utmToLatLng(utmP.zone,utmP.band,utmP.easting,utmP.northing);if(ll2&&isFinite(ll2.lat))return buildConvResult(ll2.lat,ll2.lng);}const mgrsP=parseMGRS(q);if(mgrsP&&isFinite(mgrsP.lat))return buildConvResult(mgrsP.lat,mgrsP.lng);const parts=q.split(/,\s*|\s+(?=[NS\d])/i);if(parts.length>=2){const la=parseDMS(parts[0]),lo=parseDMS(parts[1]);if(la!==null&&lo!==null)return buildConvResult(la,lo);}return null;}

  function handleConvSubmit(e){e?.preventDefault();setConvError("");setConvResult(null);if(!convInput.trim()){setConvError("Enter a coordinate to convert.");return;}const r=parseConvInput(convInput);if(r)setConvResult(r);else setConvError("Could not parse — try: \"20.29, 85.82\", \"44N 400000E 2200000N\", or DMS format");}

  function convFlyTo(){if(!convResult||!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(convResult.lng,convResult.lat,8000),duration:2});viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(convResult.lng,convResult.lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#a78bfa"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});}

  function copyConv(text,key){navigator.clipboard?.writeText(text).catch(()=>{});setConvCopied(key);setTimeout(()=>setConvCopied(""),1800);}

  useEffect(()=>{
    if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(convPickRef.current){convPickRef.current.destroy();convPickRef.current=null;}
    if(!convPickMode)return;
    const handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);convPickRef.current=handler;
    viewer.scene.canvas.style.cursor="crosshair";
    handler.setInputAction(click=>{
      const ray=viewer.camera.getPickRay(click.position);if(!ray)return;const pos=viewer.scene.globe.pick(ray,viewer.scene);if(!pos)return;
      const carto=Cesium.Cartographic.fromCartesian(pos);const lat=Cesium.Math.toDegrees(carto.latitude),lng=Cesium.Math.toDegrees(carto.longitude);
      const r=buildConvResult(lat,lng);if(r){setConvInput(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);setConvResult(r);setConvError("");viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:12,color:Cesium.Color.fromCssColorString("#a78bfa"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});}setConvPickMode(false);
    },Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return()=>{if(convPickRef.current){convPickRef.current.destroy();convPickRef.current=null;}if(viewer&&!viewer.isDestroyed())viewer.scene.canvas.style.cursor="default";};
  },[convPickMode,ready]);// eslint-disable-line

  // ── Search ────────────────────────────────────────────────────────────────
  async function handleSearch(e){
    e.preventDefault();if(!searchQ.trim()||!ready)return;
    setSearchLoading(true);setLocationInfo(null);
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    try{
      const q=searchQ.trim();
      const llMatch=q.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
      if(llMatch){const lat=parseFloat(llMatch[1]),lng=parseFloat(llMatch[2]);if(isFinite(lat)&&isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180){viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lng,lat,5000),duration:2});viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#60d8a0"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});setLocationInfo({lat,lng,name:`${lat.toFixed(6)}°, ${lng.toFixed(6)}°`,details:"Decimal coordinates"});setSearchLoading(false);return;}}
      const utmParsed=parseUTM(q);if(utmParsed){const ll=utmToLatLng(utmParsed.zone,utmParsed.band,utmParsed.easting,utmParsed.northing);if(ll&&isFinite(ll.lat)&&isFinite(ll.lng)){viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(ll.lng,ll.lat,8000),duration:2});viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(ll.lng,ll.lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#60d8a0"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});setLocationInfo({lat:ll.lat,lng:ll.lng,name:formatUTM(utmParsed),details:`UTM Zone ${utmParsed.zone}${utmParsed.band}`});setSearchLoading(false);return;}}
      const mgrsParsed=parseMGRS(q);if(mgrsParsed&&isFinite(mgrsParsed.lat)&&isFinite(mgrsParsed.lng)){viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(mgrsParsed.lng,mgrsParsed.lat,8000),duration:2});viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(mgrsParsed.lng,mgrsParsed.lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#f0c060"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});setLocationInfo({lat:mgrsParsed.lat,lng:mgrsParsed.lng,name:q.toUpperCase(),details:`MGRS → ${mgrsParsed.lat.toFixed(6)}°, ${mgrsParsed.lng.toFixed(6)}°`});setSearchLoading(false);return;}
      const camCart=viewer.camera.positionWC;const camCarto=Cesium.Cartographic.fromCartesian(camCart);const camLat=isFinite(Cesium.Math.toDegrees(camCarto.latitude))?Cesium.Math.toDegrees(camCarto.latitude):20.5937;const camLng=isFinite(Cesium.Math.toDegrees(camCarto.longitude))?Cesium.Math.toDegrees(camCarto.longitude):78.9629;
      function extractNomName(r){const addr=r.address||{};return addr.hamlet||addr.village||addr.town||addr.suburb||addr.city_district||addr.city||addr.county||addr.state_district||addr.state||r.display_name?.split(",")[0]?.trim()||"";}
      function buildDetails(r){const addr=r.address||{};const parts=[];const primary=extractNomName(r);const candidates=[addr.village,addr.town,addr.suburb,addr.city_district,addr.city,addr.county,addr.state_district,addr.state,addr.country];for(const c of candidates){if(c&&c!==primary&&!parts.includes(c))parts.push(c);if(parts.length>=3)break;}return parts.join(", ");}
      async function searchNominatim(query,extraParams=""){const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=15&addressdetails=1&polygon_geojson=1&accept-language=en${extraParams}`;const res=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{"Accept":"application/json","User-Agent":"SurveyMapPro/1.0"}});if(!res.ok)throw new Error(`Nominatim ${res.status}`);return res.json();}
      async function searchPhoton(query){const url=`https://photon.komoot.io/api?q=${encodeURIComponent(query)}&limit=15&lang=en&lat=${camLat}&lon=${camLng}`;const res=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!res.ok)throw new Error(`Photon ${res.status}`);const j=await res.json();return(j?.features||[]).map(feat=>{const p=feat.properties||{};const[lng,lat]=feat.geometry?.coordinates||[];if(!isFinite(lat)||!isFinite(lng))return null;const address={hamlet:p.type==="hamlet"?p.name:null,village:p.type==="village"?p.name:(p.osm_type==="N"&&p.type==="locality"?p.name:null),town:p.type==="town"?p.name:null,suburb:p.type==="suburb"||p.type==="neighbourhood"?p.name:null,city:p.type==="city"?p.name:(p.city||p.town||null),county:p.county||null,state:p.state||null,country:p.country||null};const name=p.name||p.city||p.town||p.village||`${lat.toFixed(5)},${lng.toFixed(5)}`;return{lat:String(lat),lon:String(lng),display_name:[name,p.city||p.town||p.village,p.state,p.country].filter(Boolean).join(", "),type:p.type||p.osm_type||"place",class:p.osm_key||"place",address,geojson:null,boundingbox:p.extent?[String(p.extent[3]),String(p.extent[1]),String(p.extent[0]),String(p.extent[2])]:null,_primaryName:name,_photon:true};}).filter(Boolean);}
      async function searchOverpass(name){const r=200000;const esc=name.replace(/["\\/]/g,"").trim();if(!esc)return[];const ql=`[out:json][timeout:12];(node["name"="${esc}"](around:${r},${camLat},${camLng});way["name"="${esc}"](around:${r},${camLat},${camLng});relation["name"="${esc}"](around:${r},${camLat},${camLng});node["name:en"="${esc}"](around:${r},${camLat},${camLng});node["name"~"^${esc}$","i"](around:${r},${camLat},${camLng}););out center 20;`;const res=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:`data=${encodeURIComponent(ql)}`,signal:AbortSignal.timeout(12000),headers:{"Content-Type":"application/x-www-form-urlencoded"}});if(!res.ok)throw new Error(`Overpass ${res.status}`);const j=await res.json();return(j.elements||[]).map(el=>{const elLat=el.lat??el.center?.lat;const elLng=el.lon??el.center?.lon;if(!isFinite(elLat)||!isFinite(elLng))return null;const elName=el.tags?.name||el.tags?.["name:en"]||esc;const village=el.tags?.place==="village"||el.tags?.place==="hamlet"?elName:null;const town=el.tags?.place==="town"||el.tags?.place==="city"?elName:null;const addr={village,town,city:el.tags?.["addr:city"]||null,state:el.tags?.["addr:state"]||el.tags?.["is_in:state"]||null,country:el.tags?.["addr:country"]||null};return{lat:String(elLat),lon:String(elLng),display_name:[elName,addr.city||addr.state,"India"].filter(Boolean).join(", "),type:el.tags?.place||el.tags?.amenity||el.tags?.leisure||el.type||"place",class:"overpass",address:addr,geojson:null,boundingbox:null,_primaryName:elName,_overpass:true};}).filter(Boolean);}
      function scoreResult(r,queryLower){let score=0;const name=(r._primaryName||r.display_name?.split(",")[0]||"").toLowerCase().trim();if(name===queryLower)score+=100;else if(name.startsWith(queryLower))score+=60;else if(name.includes(queryLower))score+=30;const typeScore={village:18,hamlet:17,town:16,suburb:15,neighbourhood:14,locality:13,city:12,quarter:11,road:8,residential:7,commercial:6,place:5,administrative:3,county:2,state:1,country:0};score+=(typeScore[r.type]||typeScore[r.class]||4);if(r._overpass)score+=25;const lat=parseFloat(r.lat),lng=parseFloat(r.lon);if(isFinite(lat)&&isFinite(lng)){const distDeg=Math.sqrt((lat-camLat)**2+(lng-camLng)**2);score+=Math.max(0,10-distDeg*0.5);}return score;}
      const queryLower=q.toLowerCase().trim(),shortQ=q.split(",")[0].trim();
      const[nomRes,photonRes,overpassRes,nomShortRes]=await Promise.allSettled([searchNominatim(q),searchPhoton(q),searchOverpass(shortQ),shortQ!==q?searchNominatim(shortQ):Promise.resolve([])]);
      let allResults=[];
      if(nomRes.status==="fulfilled")allResults.push(...(nomRes.value||[]));if(photonRes.status==="fulfilled")allResults.push(...(photonRes.value||[]));if(overpassRes.status==="fulfilled")allResults.push(...(overpassRes.value||[]));if(nomShortRes.status==="fulfilled")allResults.push(...(nomShortRes.value||[]));
      allResults=allResults.filter(r=>{const lat=parseFloat(r.lat),lng=parseFloat(r.lon);return isFinite(lat)&&isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;});
      if(!allResults.length){try{const fallback=await searchNominatim(shortQ,"&limit=5");allResults.push(...(fallback||[]));}catch(err){console.warn("Fallback search failed:",err);}}
      if(!allResults.length){alert(`Location "${q}" not found.`);setSearchLoading(false);return;}
      allResults.sort((a,b)=>scoreResult(b,queryLower)-scoreResult(a,queryLower));
      const place=allResults[0];const lat=parseFloat(place.lat),lng=parseFloat(place.lon);if(!isFinite(lat)||!isFinite(lng)){setSearchLoading(false);return;}
      let altitude=3000;
      if(place.boundingbox){const[s,n,w,east]=place.boundingbox.map(Number);const spanDeg=Math.max(n-s,east-w);altitude=Math.min(Math.max(spanDeg*111320*1.4,300),8000000);}
      else{const typeAlt={country:4000000,state:800000,county:200000,city:50000,town:25000,village:8000,hamlet:5000,suburb:8000,neighbourhood:3000,locality:6000,road:600,house:200,place:4000,administrative:300000};altitude=typeAlt[place.type]||typeAlt[place.class]||6000;}
      viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lng,lat,altitude),duration:2.5,orientation:{heading:0,pitch:Cesium.Math.toRadians(-55),roll:0}});
      viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#3b82f6"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});
      boundaryEntsRef.current.forEach(e=>viewer.entities.remove(e));boundaryEntsRef.current=[];
      if(place.geojson){const rings=place.geojson.type==="Polygon"?[place.geojson.coordinates[0]]:place.geojson.type==="MultiPolygon"?place.geojson.coordinates.map(p=>p[0]):[];rings.forEach(ring=>{try{const positions=ring.map(([lo,la])=>Cesium.Cartesian3.fromDegrees(lo,la)).filter(p=>p&&isFinite(p.x)&&isFinite(p.y)&&isFinite(p.z));if(positions.length<3)return;const ent=viewer.entities.add({polygon:{hierarchy:new Cesium.PolygonHierarchy(positions),material:Cesium.Color.fromCssColorString("#3b82f6").withAlpha(0.08),outline:true,outlineColor:Cesium.Color.fromCssColorString("#60a5fa"),outlineWidth:2}});boundaryEntsRef.current.push(ent);}catch{}});}
      const primaryName=place._primaryName||extractNomName(place)||place.display_name?.split(",")[0]?.trim()||q;
      const details=buildDetails(place);
      setLocationInfo({lat,lng,name:primaryName,details});
    }catch(err){console.error("Search error:",err);}
    setSearchLoading(false);
  }

  function handleKML(e){
    const file=e.target.files[0];if(!file||!ready)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    const isKmz=file.name.toLowerCase().endsWith(".kmz");
    setKmlName(file.name);setKmlStats(null);setKmlFlyIn(false);
    if(orbitRef.current){orbitRef.current.active=false;if(orbitRef.current.animFrame){cancelAnimationFrame(orbitRef.current.animFrame);orbitRef.current.animFrame=null;}try{viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);}catch{}orbitRef.current=null;}
    Cesium.KmlDataSource.load(URL.createObjectURL(file),{camera:viewer.scene.camera,canvas:viewer.scene.canvas,clampToGround:true}).then(ds=>{
      const STROKE       = Cesium.Color.fromCssColorString("#f5f3ee");
      const STROKE_DARK  = Cesium.Color.fromCssColorString("#ed1010").withAlpha(0.55);
      const FILL         = Cesium.Color.fromCssColorString("#f6f4f0").withAlpha(0.18);
      const PT_COLOR     = Cesium.Color.fromCssColorString("#f7f2f0");
      const PT_OUTLINE   = Cesium.Color.fromCssColorString("#e52e0a").withAlpha(0.8);

      for(const ent of ds.entities.values){try{
        if(ent.polyline){
          ent.polyline.clampToGround   = new Cesium.ConstantProperty(true);
          ent.polyline.arcType         = new Cesium.ConstantProperty(Cesium.ArcType.GEODESIC);
          ent.polyline.width           = new Cesium.ConstantProperty(3);
          ent.polyline.material        = new Cesium.PolylineOutlineMaterialProperty({
            color:        STROKE,
            outlineColor: STROKE_DARK,
            outlineWidth: 2.5,
          });
        }
        if(ent.polygon){
          ent.polygon.material           = new Cesium.ColorMaterialProperty(FILL);
          ent.polygon.outline            = new Cesium.ConstantProperty(true);
          ent.polygon.outlineColor       = new Cesium.ConstantProperty(STROKE);
          ent.polygon.outlineWidth       = new Cesium.ConstantProperty(3);
          ent.polygon.classificationType = new Cesium.ConstantProperty(Cesium.ClassificationType.TERRAIN);
        }
        if(ent.billboard){
          ent.billboard.heightReference          = new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND);
          ent.billboard.disableDepthTestDistance = new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);
        }
        if(ent.point){
          ent.point.color                    = new Cesium.ConstantProperty(PT_COLOR);
          ent.point.outlineColor             = new Cesium.ConstantProperty(PT_OUTLINE);
          ent.point.outlineWidth             = new Cesium.ConstantProperty(2);
          ent.point.pixelSize                = new Cesium.ConstantProperty(11);
          ent.point.heightReference          = new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND);
          ent.point.disableDepthTestDistance = new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);
        }
        if(ent.label){
          ent.label.fillColor                = new Cesium.ConstantProperty(Cesium.Color.WHITE);
          ent.label.outlineColor             = new Cesium.ConstantProperty(Cesium.Color.BLACK);
          ent.label.outlineWidth             = new Cesium.ConstantProperty(2.5);
          ent.label.style                    = new Cesium.ConstantProperty(Cesium.LabelStyle.FILL_AND_OUTLINE);
          ent.label.heightReference          = new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND);
          ent.label.disableDepthTestDistance = new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);
        }
      }catch(_){}}
      viewer.dataSources.add(ds);
      const entities=ds.entities.values;let sumLat=0,sumLng=0,minLat=90,maxLat=-90,minLng=180,maxLng=-180,ptCount=0;
      const collectCoord=(lat,lng)=>{if(!isFinite(lat)||!isFinite(lng))return;if(lat<-90||lat>90||lng<-180||lng>180)return;sumLat+=lat;sumLng+=lng;minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);minLng=Math.min(minLng,lng);maxLng=Math.max(maxLng,lng);ptCount++;};
      for(const ent of entities){try{const pos=ent.position?.getValue(Cesium.JulianDate.now());if(pos){const c=Cesium.Cartographic.fromCartesian(pos);if(c)collectCoord(Cesium.Math.toDegrees(c.latitude),Cesium.Math.toDegrees(c.longitude));}if(ent.polygon){const h=ent.polygon.hierarchy?.getValue(Cesium.JulianDate.now());if(h?.positions)h.positions.forEach(p=>{try{const c=Cesium.Cartographic.fromCartesian(p);if(c)collectCoord(Cesium.Math.toDegrees(c.latitude),Cesium.Math.toDegrees(c.longitude));}catch{}});}if(ent.polyline){const pts=ent.polyline.positions?.getValue(Cesium.JulianDate.now());if(pts)pts.forEach(p=>{try{const c=Cesium.Cartographic.fromCartesian(p);if(c)collectCoord(Cesium.Math.toDegrees(c.latitude),Cesium.Math.toDegrees(c.longitude));}catch{}});}}catch{}}
      if(ptCount===0){viewer.flyTo(ds,{duration:3});return;}
      const cLat=sumLat/ptCount,cLng=sumLng/ptCount;if(!isFinite(cLat)||!isFinite(cLng)){viewer.flyTo(ds,{duration:3});return;}
      const spanLat=Math.max(maxLat-minLat,0.005),spanLng=Math.max(maxLng-minLng,0.005);const spanDeg=Math.max(spanLat,spanLng);const spanKm=(spanDeg*111.32).toFixed(1);const rangeM=Math.min(Math.max(spanDeg*111320*1.6,400),5000000);const centerCart=Cesium.Cartesian3.fromDegrees(cLng,cLat,0);if(!centerCart||!isFinite(centerCart.x)||!isFinite(centerCart.y)||!isFinite(centerCart.z)){viewer.flyTo(ds,{duration:3});return;}
      orbitRef.current={center:centerCart,range:rangeM,heading:0,pitch:-62,active:false};
      setKmlStats({featureCount:entities.length,center:{lat:cLat,lng:cLng},spanKm,bbox:{minLat,maxLat,minLng,maxLng}});setKmlFlyIn(true);
      viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(cLng,cLat,rangeM*3.5),orientation:{heading:Cesium.Math.toRadians(0),pitch:Cesium.Math.toRadians(-90),roll:0},duration:2.2,easingFunction:Cesium.EasingFunction.CUBIC_IN_OUT,complete:()=>{
        const orbitDown=(targetPitch,durationSec,onDone)=>{const o=orbitRef.current;if(!o)return;const startPitch=o.pitch,startHeading=o.heading,startTime=performance.now();const tick=()=>{if(!orbitRef.current){return;}const t=Math.min((performance.now()-startTime)/(durationSec*1000),1);const ease=t<0.5?4*t*t*t:(t-1)*(2*t-2)*(2*t-2)+1;o.pitch=startPitch+(targetPitch-startPitch)*ease;o.heading=startHeading+ease*8;try{viewer.camera.lookAt(o.center,new Cesium.HeadingPitchRange(Cesium.Math.toRadians(o.heading),Cesium.Math.toRadians(o.pitch),o.range));}catch{o.animFrame=null;if(onDone)onDone();return;}if(t<1){o.animFrame=requestAnimationFrame(tick);}else{o.animFrame=null;if(onDone)onDone();}};o.animFrame=requestAnimationFrame(tick);};
        orbitDown(-62,1.8,()=>{setKmlFlyIn(false);const o=orbitRef.current;if(!o)return;o.active=true;let lastTime=performance.now();const passiveOrbit=()=>{if(!o.active||!orbitRef.current)return;const now=performance.now(),dt=(now-lastTime)/1000;lastTime=now;o.heading=(o.heading+3*dt)%360;try{viewer.camera.lookAt(o.center,new Cesium.HeadingPitchRange(Cesium.Math.toRadians(o.heading),Cesium.Math.toRadians(o.pitch),o.range));}catch{o.active=false;o.animFrame=null;try{viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);}catch{}return;}o.animFrame=requestAnimationFrame(passiveOrbit);};o.animFrame=requestAnimationFrame(passiveOrbit);const stopOrbit=()=>{if(orbitRef.current){orbitRef.current.active=false;if(orbitRef.current.animFrame){cancelAnimationFrame(orbitRef.current.animFrame);orbitRef.current.animFrame=null;}try{viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);}catch{}}};const canvas=viewer.scene.canvas;const once=()=>{stopOrbit();canvas.removeEventListener("mousedown",once);canvas.removeEventListener("touchstart",once);canvas.removeEventListener("wheel",once);};canvas.addEventListener("mousedown",once,{once:true});canvas.addEventListener("touchstart",once,{once:true,passive:true});canvas.addEventListener("wheel",once,{once:true,passive:true});setTimeout(()=>{if(orbitRef.current?.active)once();},12000);});
      }});
    }).catch(err=>{console.error("KML/KMZ load error:",err);alert("Failed to load "+(isKmz?"KMZ":"KML")+": "+err.message);});
    e.target.value="";
  }

  function handleCSV(e){
    const file=e.target.files[0];if(!file||!ready)return;e.target.value="";
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(csvPickRef.current){csvPickRef.current.destroy();csvPickRef.current=null;}if(csvDSRef.current){viewer.dataSources.remove(csvDSRef.current,true);csvDSRef.current=null;}
    setCsvInfo(null);setCsvStatus("loading");setCsvCount(0);
    Papa.parse(file,{header:true,skipEmptyLines:true,complete(results){
      const rows=results.data;if(!rows.length){alert("Empty CSV.");setCsvStatus("error");return;}
      const headers=Object.keys(rows[0]);const latKey=findColKey(headers,LAT_KEYS),lngKey=findColKey(headers,LNG_KEYS);
      if(!latKey||!lngKey){alert("CSV missing lat/lng columns.");setCsvStatus("error");return;}
      const capped=rows.slice(0,CSV_MAX);const ds=new Cesium.CustomDataSource("csv");
      ds.clustering.enabled=true;ds.clustering.pixelRange=50;ds.clustering.minimumClusterSize=3;
      ds.clustering.clusterEvent.addEventListener((ents,cluster)=>{const count=ents.length;cluster.point.show=true;cluster.label.show=false;cluster.point.color=count>200?Cesium.Color.fromCssColorString("#ef4444"):count>30?Cesium.Color.fromCssColorString("#f97316"):Cesium.Color.fromCssColorString("#3b82f6");cluster.point.pixelSize=count>200?34:count>30?26:18;cluster.point.outlineColor=Cesium.Color.WHITE;cluster.point.outlineWidth=2;cluster.point.disableDepthTestDistance=Number.POSITIVE_INFINITY;cluster.label.show=true;cluster.label.text=String(count);cluster.label.font="bold 12px sans-serif";cluster.label.fillColor=Cesium.Color.WHITE;cluster.label.outlineColor=Cesium.Color.BLACK;cluster.label.outlineWidth=2;cluster.label.style=Cesium.LabelStyle.FILL_AND_OUTLINE;cluster.label.verticalOrigin=Cesium.VerticalOrigin.CENTER;cluster.label.horizontalOrigin=Cesium.HorizontalOrigin.CENTER;cluster.label.disableDepthTestDistance=Number.POSITIVE_INFINITY;});
      const valid=capped.filter(row=>{const lat=parseFloat(row[latKey]),lng=parseFloat(row[lngKey]);return!isNaN(lat)&&!isNaN(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;});
      if(!valid.length){alert("No valid coordinates.");setCsvStatus("error");return;}
      processInChunks(valid,300,row=>{const lat=parseFloat(row[latKey]),lng=parseFloat(row[lngKey]);const nameVal=row.name||row.Name||row.title||null;const fields={};Object.keys(rows[0]).filter(k=>k!==latKey&&k!==lngKey&&row[k]!==""&&row[k]!=null&&!["name","Name","title"].includes(k)).slice(0,12).forEach(k=>{fields[k]=String(row[k]).slice(0,100);});ds.entities.add({name:nameVal||`${lat.toFixed(4)}, ${lng.toFixed(4)}`,position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:9,color:Cesium.Color.fromCssColorString("#22c55e"),outlineColor:Cesium.Color.WHITE,outlineWidth:1.5,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY},description:JSON.stringify({lat,lng,name:nameVal,fields})});},async()=>{
        await viewer.dataSources.add(ds);csvDSRef.current=ds;viewer.flyTo(ds,{duration:2,offset:new Cesium.HeadingPitchRange(0,Cesium.Math.toRadians(-45),0)});setCsvStatus("done");setCsvCount(valid.length);
        if(csvPickRef.current){csvPickRef.current.destroy();csvPickRef.current=null;}
        const ph=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);csvPickRef.current=ph;
        function pickEnt(pos){const hits=viewer.scene.drillPick(pos,5);for(const hit of hits){if(hit?.id&&ds.entities.contains(hit.id))return hit.id;}return null;}
        ph.setInputAction(click=>{const ent=pickEnt(click.position);if(!ent){setCsvInfo(null);return;}const rect=viewer.scene.canvas.getBoundingClientRect();let rowData=null;try{const desc=ent.description;const raw=typeof desc?.getValue==="function"?desc.getValue(Cesium.JulianDate.now()):String(desc??"{}");rowData=JSON.parse(raw);}catch{rowData={lat:0,lng:0,name:ent.name,fields:{}};}setCsvInfo({name:ent.name||"Point",rowData,x:Math.min(click.position.x+rect.left+16,window.innerWidth-310),y:Math.max(click.position.y+rect.top-10,60)});},Cesium.ScreenSpaceEventType.LEFT_CLICK);
        ph.setInputAction(move=>{if(hoveredEntRef.current){const prev=hoveredEntRef.current;if(prev.point){prev.point.color=new Cesium.ConstantProperty(Cesium.Color.fromCssColorString("#22c55e"));prev.point.pixelSize=new Cesium.ConstantProperty(9);}hoveredEntRef.current=null;viewer.scene.canvas.style.cursor="default";}const ent=pickEnt(move.endPosition);if(!ent||!ent.point)return;ent.point.color=new Cesium.ConstantProperty(Cesium.Color.fromCssColorString("#facc15"));ent.point.pixelSize=new Cesium.ConstantProperty(16);hoveredEntRef.current=ent;viewer.scene.canvas.style.cursor="pointer";},Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      });
    },error(err){console.error(err);alert("CSV parse failed.");setCsvStatus("error");}});
  }

  function zoomIn(){if(!ready)return;viewerRef.current.camera.zoomIn(viewerRef.current.camera.positionCartographic.height*0.4);}
  function zoomOut(){if(!ready)return;viewerRef.current.camera.zoomOut(viewerRef.current.camera.positionCartographic.height*0.6);}

  // ── Reusable checkbox component ───────────────────────────────────────────
  const GlassCheckbox=({active,color="#3b82f6"})=>(
    <div className="g3-chk" style={{borderColor:active?color:"rgba(255,255,255,0.2)",background:active?color:"rgba(255,255,255,0.03)"}}>
      {active&&<Icons.Check/>}
    </div>
  );

  // ── Section header ────────────────────────────────────────────────────────
  const SectionHeader=({icon,label,sectionKey})=>(
    <div className="g3-sec-h" onClick={()=>toggleSec(sectionKey)}>
      <div className="sec-icon">
        <span style={{color:"var(--text-dim)"}}>{icon}</span>
        <span style={{color:"var(--text-muted)"}}>{label}</span>
      </div>
      <span style={{color:"var(--text-dim)",transition:"transform .2s",transform:openSec[sectionKey]?"rotate(0deg)":"rotate(-90deg)"}}>
        <Icons.ChevDown/>
      </span>
    </div>
  );

  return(
    <>
      <style>{CSS}</style>

      {/* ── MAP VIEWPORT — uses .g3-map class now ── */}
      <div className="g3-map" ref={containerRef}/>

      {/* ── LOADING SCREEN ── */}
      {!ready&&!initErr&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"#060c18",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
          <div style={{position:"relative",width:64,height:64}}>
            <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"2px solid rgba(59,130,246,0.15)"}}/>
            <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"2px solid transparent",borderTopColor:"#3b82f6",animation:"spin 1s linear infinite"}}/>
            <div style={{position:"absolute",inset:8,borderRadius:"50%",border:"2px solid transparent",borderTopColor:"rgba(6,182,212,0.6)",animation:"spin .6s linear infinite reverse"}}/>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🌍</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{color:"var(--text-primary)",fontSize:16,fontWeight:600,fontFamily:"var(--font-ui)",letterSpacing:".02em"}}>SurveyMap Pro</div>
            <div style={{color:"var(--text-dim)",fontSize:12,fontFamily:"var(--font-ui)",marginTop:4}}>Initializing 3D engine…</div>
          </div>
        </div>
      )}
      {initErr&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"#060c18",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
          <div style={{width:48,height:48,borderRadius:12,background:"rgba(239,68,68,.15)",border:"1px solid rgba(239,68,68,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>⚠</div>
          <div style={{color:"var(--text-primary)",fontWeight:700,fontSize:16,fontFamily:"var(--font-ui)"}}>Initialization Failed</div>
          <div style={{color:"var(--text-muted)",fontSize:12,maxWidth:320,textAlign:"center",fontFamily:"var(--font-ui)",lineHeight:1.6}}>{initErr}</div>
          <button onClick={onClose} style={{marginTop:8,padding:"10px 24px",borderRadius:8,border:"1px solid rgba(59,130,246,.4)",background:"rgba(59,130,246,.1)",color:"#60a5fa",fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"var(--font-ui)"}}>← Return to 2D Map</button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          FLOATING TOP TOOLBAR — fixed, never scrolls, works on APK/mobile
      ══════════════════════════════════════════════════════════════════ */}
      <div className="g3-toolbar">
        <div className="g3-toolbar-inner">

          {/* Logo — always visible, flex-shrink:0 */}
          <div className="g3-logo">
            <div style={{
              width:28,height:28,borderRadius:7,
              background:"linear-gradient(135deg,#1d4ed8,#0891b2)",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,
              boxShadow:"0 0 12px rgba(59,130,246,0.4)",
              flexShrink:0,
            }}>🌍</div>
            <div style={{flexShrink:0}}>
              <div style={{color:"var(--text-primary)",fontWeight:700,fontSize:13,letterSpacing:".01em",lineHeight:1.1,whiteSpace:"nowrap"}}>SurveyMap</div>
              <div style={{color:"rgba(96,165,250,0.9)",fontSize:9,fontWeight:700,letterSpacing:".12em",lineHeight:1}}>PRO</div>
            </div>
          </div>

          {/* Hamburger (mobile) */}
          <button className="g3-ham" onClick={()=>setPanelOpen(p=>!p)}
            style={{display:"none",width:36,height:36,borderRadius:7,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.04)",color:"rgba(255,255,255,0.7)",cursor:"pointer",alignItems:"center",justifyContent:"center",marginRight:6,flexShrink:0}}>
            <Icons.Menu/>
          </button>

          {/* Layer buttons */}
          {LAYERS.slice(0,6).map(l=>(
            <button key={l.key} className={`g3-tbtn${activeLayer===l.key?" active":""}`} onClick={()=>setActiveLayer(l.key)}>
              <span style={{display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>{l.icon}</span>
              <span className="g3-tb-lbl">{l.label}</span>
            </button>
          ))}

          {/* Separator */}
          <div className="g3-tb-sep"/>

          {/* Tool buttons */}
          {[
            {icon:<Icons.Draw/>,label:"Draw",active:drawMode,action:()=>{setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}},
            {icon:<Icons.Measure/>,label:"Measure",active:measureMode,action:()=>setMeasureMode(true)},
            {icon:<Icons.Survey/>,label:"Survey",active:surveyMode,action:()=>setSurveyMode(true)},
            {icon:<Icons.Elevation/>,label:"Profile",active:elevMode,action:()=>{
              if(elevMode){setElevMode(false);setElevPoints([]);setElevProfile(null);elevPtsRef.current=[];const viewer=viewerRef.current;elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});elevEntsRef.current=[];}
              else{setElevMode(true);setElevPoints([]);setElevProfile(null);}
            }},
          ].map(({icon,label,active,action})=>(
            <button key={label} className={`g3-tbtn${active?" active":""}`} onClick={action}>
              {icon}
              <span className="g3-tb-lbl">{label}</span>
            </button>
          ))}

          {/* File upload buttons */}
          {[
            {icon:<Icons.KML/>,label:"KML",accept:".kml,.kmz",onChange:handleKML},
            {icon:<Icons.CSV/>,label:"CSV",accept:".csv",onChange:handleCSV},
          ].map(({icon,label,accept,onChange})=>(
            <button key={label} className="g3-tbtn">
              <label style={{cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                {icon}
                <span className="g3-tb-lbl">{label}</span>
                <input type="file" accept={accept} onChange={onChange} style={{display:"none"}}/>
              </label>
            </button>
          ))}

          {/* Separator */}
          <div className="g3-tb-sep"/>

          {/* Feature toggles */}
          {[
            {icon:<Icons.Layers/>,label:"Data",active:dataLayersOpen,action:()=>setDataLayersOpen(p=>!p)},
            {icon:<Icons.Heatmap/>,label:"Heat",active:heatmapOpen,action:()=>setHeatmapOpen(p=>!p)},
            {icon:<Icons.Timeline/>,label:"Timeline",active:sliderOpen,action:()=>setSliderOpen(p=>!p)},
            {icon:<Icons.Drone/>,label:"Drone",active:droneOpen,action:()=>setDroneOpen(p=>!p)},
            {icon:<Icons.Night/>,label:"Night",active:nightAuto,action:()=>setNightAuto(p=>!p)},
            {icon:<Icons.Coords/>,label:"Convert",active:coordConvOpen,action:()=>setCoordConvOpen(p=>!p)},
          ].map(({icon,label,active,action})=>(
            <button key={label} className={`g3-tbtn${active?" active":""}`} onClick={action}>
              {icon}
              <span className="g3-tb-lbl">{label}</span>
            </button>
          ))}

          {/* View mode pills */}
          <div className="g3-view-pills">
            {[["3D","3D"],["2D","2D"],["CV","Col"]].map(([mode,label])=>{
              const isActive=viewMode===(mode==="CV"?"Columbus":mode);
              return(
                <button key={mode} onClick={()=>setViewMode(mode==="CV"?"Columbus":mode)}
                  style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:10,fontWeight:700,letterSpacing:".05em",fontFamily:"var(--font-ui)",transition:"all .18s",background:isActive?"linear-gradient(135deg,#1d4ed8,#0891b2)":"transparent",color:isActive?"#fff":"rgba(255,255,255,0.55)",boxShadow:isActive?"0 2px 8px rgba(59,130,246,.4)":"none",whiteSpace:"nowrap"}}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* End actions — always pinned right */}
          <div className="g3-toolbar-end">
            {/* Active mode pill — mobile only */}
            {(drawMode||measureMode||surveyMode||elevMode)&&(
              <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:20,background:elevMode?"rgba(245,158,11,0.12)":drawMode?"rgba(249,115,22,0.12)":measureMode?"rgba(250,204,21,0.1)":"rgba(239,68,68,0.1)",border:`1px solid ${elevMode?"rgba(245,158,11,.3)":drawMode?"rgba(249,115,22,.3)":measureMode?"rgba(250,204,21,.25)":"rgba(239,68,68,.25)"}`,flexShrink:0}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:elevMode?"#f59e0b":drawMode?"#f97316":measureMode?"#facc15":"#ef4444",animation:"glowPulse 1.5s ease infinite"}}/>
                <span style={{fontSize:9,fontWeight:700,color:elevMode?"#fbbf24":drawMode?"#fb923c":measureMode?"#fde047":"#f87171",fontFamily:"var(--font-ui)",letterSpacing:".06em",whiteSpace:"nowrap"}}>
                  {elevMode?"ELEV":drawMode?"DRAW":measureMode?"MEASURE":"SURVEY"}
                </span>
              </div>
            )}
            <button onClick={onClose}
              style={{padding:"7px 16px",borderRadius:8,border:"1px solid rgba(255,255,255,.15)",background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,0.75)",fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",gap:5,transition:"all .15s",letterSpacing:".02em",whiteSpace:"nowrap",flexShrink:0}}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.12)";e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor="rgba(255,255,255,.25)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color="rgba(255,255,255,0.75)";e.currentTarget.style.borderColor="rgba(255,255,255,.15)";}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
              2D Map
            </button>
          </div>

        </div>{/* /g3-toolbar-inner */}
      </div>{/* /g3-toolbar */}

      {/* Mobile backdrop */}
      {panelOpen&&<div onClick={()=>setPanelOpen(false)} style={{position:"fixed",inset:0,zIndex:1240,background:"rgba(0,0,0,.6)",backdropFilter:"blur(4px)"}}/>}

      {/* ══════════════════════════════════════════════════════════════════
          LEFT PANEL
      ══════════════════════════════════════════════════════════════════ */}
      <div className={`g3-panel${panelOpen?" open":""}`}>

        {/* ── SEARCH ── */}
        <div style={{padding:"14px 14px 12px",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <Icons.Search/>
            <span style={{color:"var(--text-dim)",fontSize:10,fontWeight:700,letterSpacing:".1em",fontFamily:"var(--font-ui)"}}>SEARCH LOCATION</span>
          </div>
          <form onSubmit={handleSearch} style={{display:"flex",gap:6,marginBottom:8}}>
            <div style={{flex:1,position:"relative"}}>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)}
                placeholder="Place, city, or 20.29, 85.82…"
                className="g3-input" style={{paddingRight:36}}/>
              {searchLoading&&(
                <div style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",width:14,height:14,border:"2px solid rgba(59,130,246,.2)",borderTopColor:"#3b82f6",borderRadius:"50%",animation:"spin .7s linear infinite"}}/>
              )}
            </div>
            <button type="submit" disabled={searchLoading}
              style={{padding:"0 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#1d4ed8,#0891b2)",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700,flexShrink:0,transition:"filter .15s"}}
              onMouseEnter={e=>e.currentTarget.style.filter="brightness(1.15)"}
              onMouseLeave={e=>e.currentTarget.style.filter="brightness(1)"}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </form>
          <button onClick={handleGPS}
            style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.03)",color:"var(--text-secondary)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6,fontFamily:"var(--font-ui)",fontWeight:500,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(6,182,212,.08)";e.currentTarget.style.borderColor="rgba(6,182,212,.3)";e.currentTarget.style.color="#22d3ee";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.03)";e.currentTarget.style.borderColor="rgba(255,255,255,.08)";e.currentTarget.style.color="var(--text-secondary)";}}>
            <Icons.GPS/> Use My Location
          </button>
        </div>

        {/* ── PLACES ── */}
        <div>
          <SectionHeader icon={<Icons.Star/>} label="MY PLACES" sectionKey="places"/>
          {openSec.places&&(
            <div className="g3-sec-body" style={{animation:"fadeSlideIn .2s ease"}}>
              {localDrawings.length===0?(
                <div style={{textAlign:"center",padding:"12px 0"}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 8px",opacity:0.5}}><Icons.Pin/></div>
                  <div style={{color:"var(--text-dim)",fontSize:11,fontFamily:"var(--font-ui)"}}>No drawings yet</div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:2,marginBottom:10}}>
                  {localDrawings.map((d,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:7,background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.05)"}}>
                      <div style={{width:18,height:18,borderRadius:4,background:d.type==="path"?"rgba(249,115,22,.2)":d.type==="polygon"?"rgba(59,130,246,.2)":"rgba(6,182,212,.2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontSize:9}}>{d.type==="path"?"~":d.type==="polygon"?"⬡":"•"}</span>
                      </div>
                      <span style={{color:"var(--text-secondary)",fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"var(--font-ui)"}}>{d.name}</span>
                      <span style={{fontSize:9,color:"var(--text-dim)",flexShrink:0}}>{d.type}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:"flex",gap:5,marginBottom:10}}>
                {[{t:"marker",lb:"Pin",icon:"•"},{t:"path",lb:"Path",icon:"~"}].map(({t,lb,icon})=>(
                  <button key={t} onClick={()=>{setDrawType(t);setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}}
                    style={{flex:1,padding:"7px 5px",borderRadius:8,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.03)",color:"var(--text-secondary)",fontSize:11,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:4,transition:"all .15s"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.07)";e.currentTarget.style.color="var(--text-primary)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.03)";e.currentTarget.style.color="var(--text-secondary)";}}>
                    <span style={{fontSize:13}}>{icon}</span>{lb}
                  </button>
                ))}
              </div>

              {localDrawings.length>0&&(
                <>
                  <div style={{height:1,background:"rgba(255,255,255,.05)",marginBottom:10}}/>
                  <div style={{color:"var(--text-dim)",fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6,fontFamily:"var(--font-ui)"}}>EXPORT</div>
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    {[["KML","application/vnd.google-earth.kml+xml",()=>dlFile(toKML(localDrawings),"survey.kml","application/vnd.google-earth.kml+xml")],["GeoJSON","application/geo+json",()=>dlFile(JSON.stringify(toGeoJSON(localDrawings),null,2),"survey.geojson","application/geo+json")],["CSV","text/csv",()=>dlFile(toCSV(localDrawings),"survey.csv","text/csv")]].map(([lb,,fn])=>(
                      <button key={lb} onClick={fn}
                        style={{padding:"7px 10px",borderRadius:7,border:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.02)",color:"var(--text-muted)",fontSize:11,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",gap:6,transition:"all .15s"}}
                        onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color="var(--text-primary)";}}
                        onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.02)";e.currentTarget.style.color="var(--text-muted)";}}>
                        <Icons.Export/> Export {lb}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── LAYERS ── */}
        <div>
          <SectionHeader icon={<Icons.Layers/>} label="LAYERS" sectionKey="layers"/>
          {openSec.layers&&(
            <div className="g3-sec-body" style={{animation:"fadeSlideIn .2s ease"}}>

              {/* Night auto */}
              <div className={`g3-layer-row${nightAuto?" active":""}`} onClick={()=>setNightAuto(p=>!p)} style={{marginBottom:8}}>
                <GlassCheckbox active={nightAuto} color="#6366f1"/>
                <Icons.Night/>
                <span style={{color:nightAuto?"var(--text-primary)":"var(--text-secondary)",fontSize:11,fontFamily:"var(--font-ui)"}}>Auto Night Mode</span>
                {nightAuto&&<span className="g3-badge" style={{marginLeft:"auto",background:"rgba(99,102,241,.2)",color:"#a5b4fc",border:"1px solid rgba(99,102,241,.3)"}}>ON</span>}
              </div>

              {/* Layer options */}
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                {LAYERS.map(l=>(
                  <div key={l.key} className={`g3-layer-row${activeLayer===l.key?" active":""}`} onClick={()=>setActiveLayer(l.key)}>
                    <GlassCheckbox active={activeLayer===l.key}/>
                    <span style={{fontSize:13,lineHeight:1}}>{l.icon}</span>
                    <span style={{color:activeLayer===l.key?"var(--text-primary)":"var(--text-secondary)",fontSize:11,fontFamily:"var(--font-ui)"}}>{l.label}</span>
                  </div>
                ))}
              </div>

              {/* CSV status */}
              {csvStatus&&(
                <div style={{marginTop:10,padding:"7px 10px",borderRadius:8,background:csvStatus==="done"?"rgba(16,185,129,.07)":csvStatus==="error"?"rgba(239,68,68,.07)":"rgba(245,158,11,.07)",border:`1px solid ${csvStatus==="done"?"rgba(16,185,129,.3)":csvStatus==="error"?"rgba(239,68,68,.3)":"rgba(245,158,11,.3)"}`,color:csvStatus==="done"?"#34d399":csvStatus==="error"?"#f87171":"#fbbf24",fontSize:11,fontWeight:600,fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",gap:6}}>
                  <span>{csvStatus==="loading"?"⏳":csvStatus==="done"?"✓":"✕"}</span>
                  <span>{csvStatus==="loading"?"Loading CSV…":csvStatus==="done"?`${csvCount.toLocaleString()} points loaded`:"Failed to load CSV"}</span>
                </div>
              )}

              {/* DEM */}
              <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,.05)"}}>
                <div style={{color:"var(--text-dim)",fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:8,fontFamily:"var(--font-ui)"}}>TERRAIN VISUALIZATION</div>
                <div className={`g3-layer-row${demEnabled?" active":""}`} onClick={()=>setDemEnabled(p=>!p)} style={{marginBottom:demEnabled?8:0}}>
                  <GlassCheckbox active={demEnabled} color="#10b981"/>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20l4-8 3 5 3-9 4 12"/></svg>
                  <span style={{color:demEnabled?"var(--text-primary)":"var(--text-secondary)",fontSize:11,fontFamily:"var(--font-ui)"}}>DEM Colors + Shading</span>
                  {demEnabled&&<span className="g3-badge" style={{marginLeft:"auto",background:"rgba(16,185,129,.2)",color:"#34d399",border:"1px solid rgba(16,185,129,.3)"}}>ON</span>}
                </div>
                {demEnabled&&(
                  <div style={{display:"flex",flexDirection:"column",gap:8,paddingLeft:4}}>
                    <div style={{display:"flex",background:"rgba(0,0,0,.3)",borderRadius:8,border:"1px solid rgba(255,255,255,.08)",padding:2,gap:1}}>
                      {[["hypsometric","Colors"],["slope","Shading"],["both","Both"]].map(([v,lb])=>{
                        const sel=demStyle===v;
                        return(
                          <button key={v} onClick={()=>setDemStyle(v)}
                            style={{flex:1,padding:"5px 2px",borderRadius:6,border:"none",fontSize:9,fontWeight:sel?700:500,cursor:"pointer",fontFamily:"var(--font-ui)",background:sel?"rgba(255,255,255,.12)":"transparent",color:sel?"rgba(255,255,255,.9)":"rgba(255,255,255,.3)",transition:"all .12s",boxShadow:sel?"inset 0 0 0 1px rgba(255,255,255,.14)":"none"}}>
                            {lb}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:9,color:"var(--text-dim)",fontWeight:700,width:52,fontFamily:"var(--font-ui)"}}>OPACITY</span>
                      <input type="range" min={0.1} max={1} step={0.05} value={demOpacity} onChange={e=>setDemOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:"#10b981",cursor:"pointer"}}/>
                      <span style={{fontSize:9,color:"#34d399",fontFamily:"var(--font-mono)",width:28,textAlign:"right"}}>{Math.round(demOpacity*100)}%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 3D Buildings */}
              <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,.05)"}}>
                <div style={{color:"var(--text-dim)",fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:8,fontFamily:"var(--font-ui)"}}>3D BUILDINGS</div>
                <div className={`g3-layer-row${buildingsEnabled?" active":""}`}
                  onClick={()=>{if(!buildingsLoading)setBuildingsEnabled(p=>!p);}}
                  style={{opacity:buildingsLoading?0.6:1,marginBottom:buildingsEnabled?8:0}}>
                  <GlassCheckbox active={buildingsEnabled&&!buildingsLoading}/>
                  <Icons.Building/>
                  <span style={{color:buildingsEnabled?"var(--text-primary)":"var(--text-secondary)",fontSize:11,fontFamily:"var(--font-ui)"}}>
                    {buildingsLoading?"Loading buildings…":"OSM 3D Buildings"}
                  </span>
                  {buildingsLoading&&<span style={{marginLeft:"auto",width:12,height:12,border:"2px solid rgba(59,130,246,.2)",borderTopColor:"#3b82f6",borderRadius:"50%",animation:"spin .8s linear infinite",flexShrink:0}}/>}
                  {buildingsEnabled&&!buildingsLoading&&<span className="g3-badge" style={{marginLeft:"auto",background:"rgba(59,130,246,.2)",color:"#60a5fa",border:"1px solid rgba(59,130,246,.3)"}}>ON</span>}
                </div>
                {buildingsEnabled&&!buildingsLoading&&(
                  <div style={{padding:"8px 10px",background:"rgba(0,0,0,.2)",borderRadius:8,border:"1px solid rgba(255,255,255,.05)"}}>
                    <div style={{fontSize:10,color:"var(--text-muted)",lineHeight:1.6,fontFamily:"var(--font-ui)",marginBottom:6}}>Zoom into a city to see buildings</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"4px 10px"}}>
                      {[["#cbd5e1","Residential"],["#93c5fd","Commercial"],["#fca5a5","Hospital"],["#fcd34d","School"],["#c4b5fd","Religious"],["#9ca3af","Industrial"]].map(([c,l])=>(
                        <span key={l} style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-ui)"}}>
                          <span style={{width:8,height:8,borderRadius:2,background:c,flexShrink:0}}/>
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Grid */}
              <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,.05)"}}>
                <div style={{color:"var(--text-dim)",fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:8,fontFamily:"var(--font-ui)"}}>COORDINATE GRID</div>
                <div className={`g3-layer-row${gridEnabled?" active":""}`} onClick={()=>setGridEnabled(p=>!p)} style={{marginBottom:gridEnabled?8:0}}>
                  <GlassCheckbox active={gridEnabled}/>
                  <Icons.Grid/>
                  <span style={{color:gridEnabled?"var(--text-primary)":"var(--text-secondary)",fontSize:11,fontFamily:"var(--font-ui)"}}>Grid Overlay</span>
                  {gridEnabled&&<span className="g3-badge" style={{marginLeft:"auto",background:"rgba(59,130,246,.2)",color:"#60a5fa",border:"1px solid rgba(59,130,246,.3)"}}>ON</span>}
                </div>
                {gridEnabled&&(
                  <div style={{display:"flex",background:"rgba(0,0,0,.3)",borderRadius:8,border:"1px solid rgba(255,255,255,.08)",padding:2,marginBottom:8,paddingLeft:4,gap:1}}>
                    {[["LatLng","LL"],["UTM","UTM"],["MGRS","MGRS"]].map(([m,lb])=>{
                      const sel=gridMode===m;
                      return(
                        <button key={m} onClick={()=>setGridMode(m)}
                          style={{flex:1,padding:"5px 4px",borderRadius:6,border:"none",cursor:"pointer",fontSize:9,fontWeight:sel?700:500,background:sel?"rgba(255,255,255,.12)":"transparent",color:sel?"rgba(255,255,255,.9)":"rgba(255,255,255,.3)",fontFamily:"var(--font-ui)",transition:"all .15s",boxShadow:sel?"inset 0 0 0 1px rgba(255,255,255,.14)":"none"}}>
                          {lb}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div style={{marginTop:8}}>
                  <div style={{color:"rgba(255,255,255,.25)",fontSize:9,fontWeight:700,letterSpacing:".12em",marginBottom:6,fontFamily:"var(--font-ui)"}}>COORD FORMAT</div>
                  <div style={{display:"flex",background:"rgba(0,0,0,.3)",borderRadius:8,border:"1px solid rgba(255,255,255,.08)",padding:2,gap:1}}>
                    {["LatLng","UTM","MGRS"].map(mode=>{
                      const sel=coordDisplay===mode;
                      return(
                        <button key={mode} onClick={()=>setCoordDisplay(mode)}
                          style={{flex:1,padding:"5px 4px",borderRadius:6,border:"none",cursor:"pointer",fontSize:9,fontWeight:sel?700:500,background:sel?"rgba(255,255,255,.12)":"transparent",color:sel?"rgba(255,255,255,.9)":"rgba(255,255,255,.3)",fontFamily:"var(--font-ui)",transition:"all .15s",boxShadow:sel?"inset 0 0 0 1px rgba(255,255,255,.14)":"none"}}>
                          {mode}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── TOOLS ── */}
        <div>
          <SectionHeader icon={<Icons.Tools/>} label="TOOLS" sectionKey="tools"/>
          {openSec.tools&&(
            <div className="g3-sec-body" style={{animation:"fadeSlideIn .2s ease",display:"flex",flexDirection:"column",gap:0}}>

              {/* ── DRAW ── */}
              <div style={{marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                  <div style={{flex:1,height:1,background:"rgba(255,255,255,.06)"}}/>
                  <span style={{color:"rgba(255,255,255,.25)",fontSize:9,fontWeight:700,letterSpacing:".12em",fontFamily:"var(--font-ui)",flexShrink:0}}>DRAW</span>
                  <div style={{flex:1,height:1,background:"rgba(255,255,255,.06)"}}/>
                </div>

                <div style={{display:"flex",background:"rgba(0,0,0,.3)",borderRadius:9,border:"1px solid rgba(255,255,255,.08)",padding:3,marginBottom:10,gap:2}}>
                  {[
                    {t:"path",lb:"Path",svg:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 17c3-3 6 3 9 0s6-3 9 0"/></svg>},
                    {t:"polygon",lb:"Polygon",svg:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/></svg>},
                    {t:"marker",lb:"Pin",svg:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="2.5"/></svg>},
                  ].map(({t,lb,svg})=>{
                    const sel=drawType===t;
                    return(
                      <button key={t} onClick={()=>setDrawType(t)}
                        style={{flex:1,padding:"7px 4px",borderRadius:6,border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all .15s",fontFamily:"var(--font-ui)",background:sel?"rgba(255,255,255,.1)":"transparent",color:sel?"rgba(255,255,255,.95)":"rgba(255,255,255,.35)",fontSize:10,fontWeight:sel?700:500,boxShadow:sel?"inset 0 0 0 1px rgba(255,255,255,.14)":"none"}}>
                        {svg}
                        <span>{lb}</span>
                      </button>
                    );
                  })}
                </div>

                {!drawMode?(
                  <button onClick={()=>{setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}}
                    style={{width:"100%",padding:"9px 14px",borderRadius:8,border:"1px solid rgba(255,255,255,.14)",background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.9)",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"all .18s",letterSpacing:".01em"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.1)";e.currentTarget.style.borderColor="rgba(255,255,255,.22)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.borderColor="rgba(255,255,255,.14)";}}>
                    <Icons.Draw/>
                    Start Drawing
                  </button>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"9px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:"rgba(255,255,255,.7)",animation:"glowPulse 1.8s ease infinite"}}/>
                        <span style={{color:"rgba(255,255,255,.7)",fontSize:11,fontFamily:"var(--font-ui)"}}>{drawType==="marker"?"Click to place a pin":"Click map to add points"}</span>
                      </div>
                      <span style={{color:"rgba(255,255,255,.5)",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,background:"rgba(255,255,255,.07)",padding:"1px 7px",borderRadius:20}}>{drawPoints.length} pts</span>
                    </div>
                    <div style={{display:"flex",gap:5}}>
                      <button onClick={finishDrawing}
                        style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.9)",fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"var(--font-ui)",transition:"all .15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.16)"}
                        onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.1)"}>
                        Save
                      </button>
                      <button onClick={cancelDrawing}
                        style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid rgba(255,255,255,.08)",background:"transparent",color:"rgba(255,255,255,.4)",fontWeight:500,fontSize:11,cursor:"pointer",fontFamily:"var(--font-ui)"}}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── MEASURE ── */}
              <div style={{marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                  <div style={{flex:1,height:1,background:"rgba(255,255,255,.06)"}}/>
                  <span style={{color:"rgba(255,255,255,.25)",fontSize:9,fontWeight:700,letterSpacing:".12em",fontFamily:"var(--font-ui)",flexShrink:0}}>MEASURE</span>
                  <div style={{flex:1,height:1,background:"rgba(255,255,255,.06)"}}/>
                </div>

                {!measureMode?(
                  <button onClick={()=>setMeasureMode(true)}
                    style={{width:"100%",padding:"9px 14px",borderRadius:8,border:"1px solid rgba(255,255,255,.14)",background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.9)",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"all .18s"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.1)";e.currentTarget.style.borderColor="rgba(255,255,255,.22)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.borderColor="rgba(255,255,255,.14)";}}>
                    <Icons.Measure/>
                    Measure Distance
                  </button>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.09)",borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div>
                        <div style={{color:"rgba(255,255,255,.3)",fontSize:9,fontWeight:700,letterSpacing:".1em",fontFamily:"var(--font-ui)",marginBottom:3}}>DISTANCE</div>
                        <div style={{color:"rgba(255,255,255,.88)",fontSize:18,fontWeight:700,fontFamily:"var(--font-mono)",letterSpacing:"-.01em",lineHeight:1}}>{measurePoints.length<2?"—":formatDist(totalDist,measureUnit)}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{color:"rgba(255,255,255,.3)",fontSize:9,fontFamily:"var(--font-ui)",marginBottom:2}}>points</div>
                        <div style={{color:"rgba(255,255,255,.5)",fontFamily:"var(--font-mono)",fontSize:14,fontWeight:600}}>{measurePoints.length}</div>
                      </div>
                    </div>

                    <div style={{display:"flex",background:"rgba(0,0,0,.25)",borderRadius:7,border:"1px solid rgba(255,255,255,.07)",padding:2,gap:1}}>
                      {[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"],["nmi","nmi"]].map(([u,lb])=>{
                        const sel=measureUnit===u;
                        return(
                          <button key={u} onClick={()=>setMeasureUnit(u)}
                            style={{flex:1,padding:"4px 2px",borderRadius:5,border:"none",cursor:"pointer",fontSize:9,fontWeight:sel?700:500,background:sel?"rgba(255,255,255,.12)":"transparent",color:sel?"rgba(255,255,255,.9)":"rgba(255,255,255,.3)",fontFamily:"var(--font-ui)",transition:"all .12s",boxShadow:sel?"inset 0 0 0 1px rgba(255,255,255,.12)":"none"}}>
                            {lb}
                          </button>
                        );
                      })}
                    </div>

                    <div style={{display:"flex",gap:5}}>
                      <button onClick={resetMeasure}
                        style={{flex:1,padding:"7px",borderRadius:8,border:"1px solid rgba(255,255,255,.1)",background:"transparent",color:"rgba(255,255,255,.45)",fontSize:11,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:5,transition:"all .12s"}}
                        onMouseEnter={e=>e.currentTarget.style.color="rgba(255,255,255,.75)"}
                        onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,.45)"}>
                        <Icons.Refresh/> Reset
                      </button>
                      <button onClick={clearMeasure}
                        style={{flex:1,padding:"7px",borderRadius:8,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.7)",fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:5,transition:"all .12s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.1)"}
                        onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.06)"}>
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── SURVEY ── */}
              <div>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                  <div style={{flex:1,height:1,background:"rgba(255,255,255,.06)"}}/>
                  <span style={{color:"rgba(255,255,255,.25)",fontSize:9,fontWeight:700,letterSpacing:".12em",fontFamily:"var(--font-ui)",flexShrink:0}}>SURVEY</span>
                  <div style={{flex:1,height:1,background:"rgba(255,255,255,.06)"}}/>
                </div>

                {!surveyMode?(
                  <button onClick={()=>setSurveyMode(true)}
                    style={{width:"100%",padding:"9px 14px",borderRadius:8,border:"1px solid rgba(255,255,255,.14)",background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.9)",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"all .18s"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.1)";e.currentTarget.style.borderColor="rgba(255,255,255,.22)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.borderColor="rgba(255,255,255,.14)";}}>
                    <Icons.Survey/>
                    Start Survey Route
                  </button>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.09)",borderRadius:8,padding:"10px 13px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{position:"relative",width:10,height:10,flexShrink:0}}>
                          <div style={{position:"absolute",inset:0,borderRadius:"50%",background:"rgba(255,255,255,.2)",animation:"glowPulse 1.4s ease infinite"}}/>
                          <div style={{position:"absolute",inset:2,borderRadius:"50%",background:"rgba(255,255,255,.75)"}}/>
                        </div>
                        <span style={{color:"rgba(255,255,255,.65)",fontSize:11,fontFamily:"var(--font-ui)"}}>Recording route</span>
                      </div>
                      <span style={{color:"rgba(255,255,255,.55)",fontFamily:"var(--font-mono)",fontSize:12,fontWeight:600,background:"rgba(255,255,255,.07)",padding:"2px 8px",borderRadius:20}}>{surveyRoute.length} pts</span>
                    </div>
                    <button onClick={clearSurvey}
                      style={{width:"100%",padding:"9px 14px",borderRadius:8,border:"1px solid rgba(255,255,255,.14)",background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.8)",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"all .15s"}}
                      onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.1)";}}
                      onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";}}>
                      <Icons.Stop/> Stop & Save
                    </button>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Bottom padding */}
        <div style={{height:16}}/>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ZOOM CONTROLS
      ══════════════════════════════════════════════════════════════════ */}
      <div className="g3-zoom" style={{
        position:"fixed",right:14,bottom:SB+160,zIndex:1002,
        display:"flex",flexDirection:"column",
        background:"rgba(8,13,25,0.88)",
        border:"1px solid rgba(255,255,255,.1)",
        borderRadius:10,
        boxShadow:"0 4px 24px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06)",
        backdropFilter:"blur(16px)",
        overflow:"hidden",
      }}>
        {[[<Icons.ZoomIn/>,zoomIn],[<Icons.ZoomOut/>,zoomOut]].map(([ icon,fn],i)=>(
          <button key={i} onClick={fn}
            style={{width:40,height:40,border:"none",borderBottom:i===0?"1px solid rgba(255,255,255,.07)":"none",background:"transparent",color:"var(--text-secondary)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .12s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.08)";e.currentTarget.style.color="var(--text-primary)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="var(--text-secondary)";}}>
            {icon}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          COMPASS
      ══════════════════════════════════════════════════════════════════ */}
      <div className="g3-compass" style={{position:"fixed",bottom:SB+8,right:14,zIndex:1001,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
        <div style={{
          background:"rgba(8,13,25,.88)",border:"1px solid rgba(255,255,255,.08)",
          borderRadius:6,padding:"3px 8px",
          display:"flex",gap:8,alignItems:"center",backdropFilter:"blur(12px)",
        }}>
          <span style={{color:"var(--text-dim)",fontSize:9,fontWeight:700,fontFamily:"var(--font-ui)",letterSpacing:".06em"}}>EYE</span>
          <span style={{color:"var(--text-secondary)",fontSize:10,fontFamily:"var(--font-mono)",fontWeight:500}}>{formatAlt(cameraAlt)}</span>
        </div>
        <div style={{width:50,height:50}}>
          <svg viewBox="0 0 100 100" style={{width:"100%",height:"100%",transform:`rotate(${compassHeading}deg)`,filter:"drop-shadow(0 2px 8px rgba(0,0,0,.7))"}}>
            <defs>
              <radialGradient id="compassBg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(20,30,50,.95)"/>
                <stop offset="100%" stopColor="rgba(8,13,25,.98)"/>
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="47" fill="url(#compassBg)" stroke="rgba(255,255,255,.12)" strokeWidth="1.5"/>
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="1"/>
            <polygon points="50,10 54,48 50,44 46,48" fill="#ef4444"/>
            <polygon points="50,90 54,52 50,56 46,52" fill="#1e3a5f"/>
            <polygon points="10,50 48,46 52,50 48,54" fill="#1e3a5f"/>
            <polygon points="90,50 52,46 48,50 52,54" fill="#1e3a5f"/>
            <text x="50" y="23" textAnchor="middle" fill="#ef4444" fontSize="11" fontWeight="700" fontFamily="var(--font-ui)">N</text>
            <circle cx="50" cy="50" r="5" fill="rgba(255,255,255,.15)" stroke="rgba(255,255,255,.2)" strokeWidth="1"/>
            <circle cx="50" cy="50" r="2" fill="rgba(255,255,255,.4)"/>
          </svg>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          STATUS BAR — floating, pinned to bottom
      ══════════════════════════════════════════════════════════════════ */}
      <div className="g3-statusbar">
        {mousePos?(()=>{
          const utm=(coordDisplay==="UTM"||coordDisplay==="MGRS")?latLngToUTM(mousePos.lat,mousePos.lng):null;
          return<>
            {coordDisplay==="LatLng"&&<>
              <span style={{color:"var(--text-secondary)"}}>{toDMS(mousePos.lat,"N","S")}</span>
              <span style={{color:"var(--text-dim)"}}>·</span>
              <span style={{color:"var(--text-secondary)"}}>{toDMS(mousePos.lng,"E","W")}</span>
            </>}
            {coordDisplay==="UTM"&&utm&&<>
              <span style={{color:"#34d399",fontWeight:700,fontSize:9,letterSpacing:".08em"}}>UTM</span>
              <span style={{color:"var(--text-secondary)"}}>{utm.zone}{utm.band} {utm.easting}E {utm.northing}N</span>
            </>}
            {coordDisplay==="MGRS"&&utm&&<>
              <span style={{color:"#fbbf24",fontWeight:700,fontSize:9,letterSpacing:".08em"}}>MGRS</span>
              <span style={{color:"var(--text-secondary)"}}>{latLngToMGRS(mousePos.lat,mousePos.lng,5)}</span>
            </>}
            <button title="Cycle coordinate display"
              onClick={()=>setCoordDisplay(d=>d==="LatLng"?"UTM":d==="UTM"?"MGRS":"LatLng")}
              style={{padding:"2px 7px",borderRadius:4,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.03)",color:"var(--text-dim)",fontSize:8,cursor:"pointer",fontFamily:"var(--font-ui)",fontWeight:600,letterSpacing:".04em",flexShrink:0,transition:"all .12s"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.08)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.03)"}>
              {coordDisplay} ⇌
            </button>
          </>;
        })():<span style={{color:"var(--text-dim)"}}>Move cursor over the globe</span>}

        <div style={{flex:1}}/>

        {/* Active mode indicators */}
        {gridEnabled&&<span style={{color:gridMode==="MGRS"?"#fbbf24":gridMode==="UTM"?"#60a5fa":"#94a3b8",fontSize:9,fontWeight:700,background:"rgba(255,255,255,.04)",padding:"2px 7px",borderRadius:4,border:"1px solid rgba(255,255,255,.07)"}}>{gridMode}</span>}
        {drawMode&&<span style={{color:"#f97316",fontSize:9,fontWeight:700,background:"rgba(249,115,22,.08)",padding:"2px 7px",borderRadius:4,border:"1px solid rgba(249,115,22,.25)"}}>DRAW · {drawPoints.length}pts</span>}
        {measureMode&&<span style={{color:"#facc15",fontSize:9,fontWeight:700,background:"rgba(250,204,21,.06)",padding:"2px 7px",borderRadius:4,border:"1px solid rgba(250,204,21,.2)"}}>MEASURE · {measurePoints.length}pts</span>}
        {surveyMode&&<span style={{color:"#ef4444",fontSize:9,fontWeight:700,background:"rgba(239,68,68,.07)",padding:"2px 7px",borderRadius:4,border:"1px solid rgba(239,68,68,.25)"}}>● SURVEY · {surveyRoute.length}pts</span>}
        {elevMode&&<span style={{color:"#f59e0b",fontSize:9,fontWeight:700,background:"rgba(245,158,11,.07)",padding:"2px 7px",borderRadius:4,border:"1px solid rgba(245,158,11,.25)"}}>ELEVATION · {elevPoints.length}pts</span>}
        {nightAuto&&<span style={{color:"#818cf8",fontSize:9,fontWeight:700}}>{nightInfo?.isNight?"🌙":"☀"}</span>}

        <span style={{color:"var(--text-dim)",fontSize:9}}>{viewMode} · CesiumJS</span>
      </div>

      {/* Mobile coord strip */}
      <div className="g3-coord-strip">
        {mousePos?(
          <>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>
            <span style={{color:"rgba(255,255,255,0.75)",fontWeight:600}}>{mousePos.lat.toFixed(4)}°{mousePos.lat>=0?"N":"S"}</span>
            <span style={{color:"rgba(255,255,255,0.3)"}}>·</span>
            <span style={{color:"rgba(255,255,255,0.75)",fontWeight:600}}>{mousePos.lng.toFixed(4)}°{mousePos.lng>=0?"E":"W"}</span>
            <button onClick={()=>setCoordDisplay(d=>d==="LatLng"?"UTM":d==="UTM"?"MGRS":"LatLng")}
              style={{padding:"1px 6px",borderRadius:3,border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.04)",color:"rgba(255,255,255,0.45)",fontSize:8,cursor:"pointer",fontFamily:"var(--font-ui)",fontWeight:600,letterSpacing:".04em"}}>
              {coordDisplay}
            </button>
          </>
        ):(
          <span style={{color:"rgba(255,255,255,0.3)"}}>Tap map for coordinates</span>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          MOBILE BOTTOM NAV BAR
      ══════════════════════════════════════════════════════════════════ */}
      <nav className="g3-bottom-nav">
        {/* Layers */}
        <button className={`g3-bnav-item${panelOpen?" active":""}`} onClick={()=>setPanelOpen(p=>!p)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Layers
        </button>
        {/* Draw */}
        <button className={`g3-bnav-item${drawMode?" active":""}`} onClick={()=>{if(drawMode){drawPtsRef.current=[];setDrawPoints([]);setDrawMode(false);}else{setDrawMode(true);setMeasureMode(false);setSurveyMode(false);setElevMode(false);drawPtsRef.current=[];setDrawPoints([]);}}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          Draw
          {drawPoints.length>0&&<span className="g3-bnav-badge">{drawPoints.length}</span>}
        </button>
        {/* Measure */}
        <button className={`g3-bnav-item${measureMode?" active":""}`} onClick={()=>{if(measureMode){clearMeasure();}else{setMeasureMode(true);setDrawMode(false);setSurveyMode(false);setElevMode(false);}}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4"/></svg>
          Measure
          {measurePoints.length>0&&<span className="g3-bnav-badge">{measurePoints.length}</span>}
        </button>
        {/* Elevation / Profile */}
        <button className={`g3-bnav-item${elevMode?" active-warn":""}`} onClick={()=>{if(elevMode){setElevMode(false);setElevPoints([]);setElevProfile(null);elevPtsRef.current=[];const viewer=viewerRef.current;elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});elevEntsRef.current=[];}else{setElevMode(true);setDrawMode(false);setMeasureMode(false);setSurveyMode(false);setElevPoints([]);setElevProfile(null);}}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Elevation
          {elevPoints.length>0&&<span className="g3-bnav-badge" style={{background:"#f59e0b"}}>{elevPoints.length}</span>}
        </button>
        {/* Survey */}
        <button className={`g3-bnav-item${surveyMode?" active":""}`} onClick={()=>{if(surveyMode){setSurveyMode(false);}else{setSurveyMode(true);setDrawMode(false);setMeasureMode(false);setElevMode(false);}}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="8" height="8"/><rect x="14" y="2" width="8" height="8"/><rect x="2" y="14" width="8" height="8"/><path d="M14 18h8M18 14v8"/></svg>
          Survey
          {surveyRoute&&surveyRoute.length>0&&<span className="g3-bnav-badge">{surveyRoute.length}</span>}
        </button>
      </nav>

      {/* ══════════════════════════════════════════════════════════════════
          ELEVATION MODE BANNER
      ══════════════════════════════════════════════════════════════════ */}
      {elevMode&&(
        <>
          <div className="g3-mode-banner" style={{position:"fixed",top:TB+12,left:"50%",transform:"translateX(-50%)",zIndex:1200,background:"rgba(8,13,25,0.92)",border:"1px solid rgba(245,158,11,.3)",borderRadius:10,padding:"8px 18px",display:"flex",alignItems:"center",gap:12,boxShadow:"0 4px 24px rgba(0,0,0,.6), 0 0 0 1px rgba(245,158,11,.1)",backdropFilter:"blur(16px)",fontFamily:"var(--font-ui)",whiteSpace:"nowrap",animation:"fadeSlideIn .2s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <Icons.Elevation/>
              <span style={{color:"#fbbf24",fontWeight:700,fontSize:12}}>Elevation Profile Mode</span>
            </div>
            <span style={{color:"var(--text-muted)",fontSize:11,borderLeft:"1px solid rgba(255,255,255,.08)",paddingLeft:12}}>Click to place profile points</span>
            {elevPoints.length>0&&<span style={{color:"var(--text-secondary)",fontSize:11,fontFamily:"var(--font-mono)",fontWeight:600}}>{elevPoints.length} pts</span>}
            {elevLoading&&<div style={{width:14,height:14,border:"2px solid rgba(245,158,11,.2)",borderTopColor:"#f59e0b",borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0}}/>}
            <div style={{display:"flex",gap:5}}>
              {elevPoints.length>=2&&<button onClick={()=>{const viewer=viewerRef.current;elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});elevEntsRef.current=[];elevPtsRef.current=[];setElevPoints([]);setElevProfile(null);}} style={{padding:"4px 10px",borderRadius:6,border:"1px solid rgba(255,255,255,.1)",background:"transparent",color:"var(--text-muted)",fontSize:11,cursor:"pointer",fontFamily:"var(--font-ui)"}}>Clear</button>}
              <button onClick={()=>{setElevMode(false);setElevPoints([]);setElevProfile(null);elevPtsRef.current=[];const viewer=viewerRef.current;elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});elevEntsRef.current=[];}} style={{padding:"4px 10px",borderRadius:6,border:"1px solid rgba(239,68,68,.3)",background:"rgba(239,68,68,.08)",color:"#f87171",fontSize:11,cursor:"pointer",fontFamily:"var(--font-ui)",fontWeight:600}}>Exit</button>
            </div>
          </div>

          {/* Elevation Profile Chart */}
          {elevProfile&&(()=>{
            const PANEL_H=228;const isMobile=window.innerWidth<=640;const W=isMobile?window.innerWidth:(window.innerWidth-PANEL);const PAD_L=58,PAD_R=20,PAD_T=12;const cH=PANEL_H-PAD_T-42-36;const cW=W-PAD_L-PAD_R;
            const samples=elevProfile.samples;const minH=elevProfile.stats.minH,maxH=elevProfile.stats.maxH;const hRange=(maxH-minH)||1;const maxD=samples[samples.length-1].d||1;const unit=elevProfile._unit||"m";
            const toX=d=>PAD_L+(d/maxD)*cW;const toY=h=>PAD_T+cH-((h-minH)/hRange)*cH;
            const toUnit=(m)=>unit==="ft"?`${(m*3.28084).toFixed(0)}ft`:`${m.toFixed(0)}m`;
            let gain=0,loss=0;for(let i=1;i<samples.length;i++){const dh=samples[i].h-samples[i-1].h;if(dh>0)gain+=dh;else loss+=Math.abs(dh);}
            const avgH=samples.reduce((s,p)=>s+p.h,0)/samples.length;const distLabel=maxD>=1000?`${(maxD/1000).toFixed(2)} km`:`${maxD.toFixed(0)} m`;
            const areaD=`M${toX(samples[0].d)},${PAD_T+cH} `+samples.map(s=>`L${toX(s.d)},${toY(s.h)}`).join(" ")+` L${toX(samples[samples.length-1].d)},${PAD_T+cH} Z`;
            const linePts=samples.map(s=>`${toX(s.d)},${toY(s.h)}`).join(" ");
            const yTicks=Array.from({length:6},(_,i)=>minH+(hRange/5)*i);const xTicks=Array.from({length:7},(_,i)=>(maxD/6)*i);
            const hov=elevHoverIdx!==null?samples[elevHoverIdx]:null;
            const onSvgMove=(e)=>{const rect=e.currentTarget.getBoundingClientRect();const pct=(e.clientX-rect.left-PAD_L)/cW;const idx=Math.max(0,Math.min(samples.length-1,Math.round(pct*(samples.length-1))));setElevHoverIdx(idx);const Cesium=CesiumRef.current,viewer=viewerRef.current;if(viewer&&Cesium&&hoverMarkerRef.current&&elevProfile.positions?.[idx]){const p=elevProfile.positions[idx];hoverMarkerRef.current.position=Cesium.Cartesian3.fromDegrees(p.lng,p.lat,samples[idx].h+5);hoverMarkerRef.current.show=true;}};
            const onSvgLeave=()=>{setElevHoverIdx(null);if(hoverMarkerRef.current)hoverMarkerRef.current.show=false;};
            return(
              <div className="g3-elev-panel" style={{position:"fixed",bottom:SB,left:PANEL,right:0,height:PANEL_H,zIndex:1200,background:"rgba(6,10,20,.96)",borderTop:"1px solid rgba(59,130,246,.2)",fontFamily:"var(--font-ui)",backdropFilter:"blur(24px)",boxShadow:"0 -8px 32px rgba(0,0,0,.7)",animation:"slideUp .25s ease"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 14px",borderBottom:"1px solid rgba(255,255,255,.05)",height:42}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <span style={{color:"var(--text-secondary)",fontWeight:700,fontSize:11,letterSpacing:".07em"}}>ELEVATION PROFILE</span>
                    <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid rgba(255,255,255,.08)"}}>
                      {["m","ft"].map(u=>(
                        <button key={u} onClick={()=>setElevProfile(p=>({...p,_unit:u}))} style={{padding:"3px 10px",fontSize:10,fontWeight:700,cursor:"pointer",border:"none",background:unit===u?"rgba(59,130,246,.2)":"transparent",color:unit===u?"#60a5fa":"var(--text-dim)",fontFamily:"var(--font-ui)"}}>{u}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:0,flex:1,justifyContent:"center",overflow:"hidden"}}>
                    {[[`${toUnit(minH)}–${toUnit(maxH)} · avg ${toUnit(avgH)}`,"#94a3b8"],[`${distLabel}`,"#60a5fa"],[`+${toUnit(gain)} / −${toUnit(loss)}`,"#34d399"],[`Max slope ${elevProfile.stats.maxSlope.toFixed(1)}%`,"#fbbf24"]].map(([val,color])=>(
                      <div key={val} style={{padding:"0 10px",borderRight:"1px solid rgba(255,255,255,.06)",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:10,color,fontWeight:600,fontFamily:"var(--font-mono)"}}>{val}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>setElevProfile(null)} style={{background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer",fontSize:16,lineHeight:1,flexShrink:0}}><Icons.Close/></button>
                </div>
                <svg width={W} height={PANEL_H-42} style={{display:"block",cursor:"crosshair"}} onMouseMove={onSvgMove} onMouseLeave={onSvgLeave}>
                  <defs>
                    <linearGradient id="elvFill3" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45"/>
                      <stop offset="60%" stopColor="#3b82f6" stopOpacity="0.1"/>
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02"/>
                    </linearGradient>
                  </defs>
                  {yTicks.map((v,i)=>(
                    <g key={i}><line x1={PAD_L} y1={toY(v)} x2={PAD_L+cW} y2={toY(v)} stroke="rgba(255,255,255,.04)" strokeWidth="1"/><text x={PAD_L-5} y={toY(v)+4} fill="rgba(255,255,255,0.35)" fontSize="9" textAnchor="end" fontFamily="var(--font-mono)">{toUnit(v)}</text></g>
                  ))}
                  {xTicks.map((v,i)=>(
                    <g key={i}><line x1={toX(v)} y1={PAD_T} x2={toX(v)} y2={PAD_T+cH} stroke="rgba(255,255,255,.04)" strokeWidth="1"/><text x={toX(v)} y={PAD_T+cH+16} fill="rgba(255,255,255,0.35)" fontSize="9" textAnchor="middle" fontFamily="var(--font-mono)">{v===0?"0":v>=1000?`${(v/1000).toFixed(1)}km`:`${(v/1000).toFixed(2)}km`}</text></g>
                  ))}
                  <path d={areaD} fill="url(#elvFill3)"/>
                  <polyline points={linePts} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinejoin="round"/>
                  {elevPtsRef.current.map((_,i)=>{const wDists=elevProfile.waypointCumDists;const realDist=wDists&&wDists[i]!=null?wDists[i]:(i===0?0:maxD*(i/(elevPtsRef.current.length-1)));const s=samples.reduce((a,b)=>Math.abs(b.d-realDist)<Math.abs(a.d-realDist)?b:a);return(<g key={i}><line x1={toX(s.d)} y1={PAD_T} x2={toX(s.d)} y2={PAD_T+cH} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,3" opacity="0.5"/><circle cx={toX(s.d)} cy={toY(s.h)} r={5} fill="#f59e0b" stroke="#fff" strokeWidth="1.5"/><text x={toX(s.d)} y={toY(s.h)-9} fill="#fbbf24" fontSize="10" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">{i+1}</text></g>);})}
                  {hov&&elevHoverIdx!==null&&(()=>{const cx=toX(hov.d),cy=toY(hov.h);const tipW=128,tipH=52;const tipX=cx+10+tipW>W-PAD_R?cx-tipW-10:cx+10;const tipY=Math.max(PAD_T+2,Math.min(cy-tipH/2,PAD_T+cH-tipH));const slp=elevHoverIdx>0?(()=>{const run=hov.d-samples[elevHoverIdx-1].d;const rise=hov.h-samples[elevHoverIdx-1].h;return run>0?((rise/run)*100).toFixed(1):"0";})():"0";return(<><line x1={cx} y1={PAD_T} x2={cx} y2={PAD_T+cH} stroke="rgba(255,255,255,.15)" strokeWidth="1"/><circle cx={cx} cy={cy} r={5} fill="#60a5fa" stroke="#fff" strokeWidth="2"/><rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6} fill="rgba(6,10,20,.95)" stroke="rgba(59,130,246,.3)" strokeWidth="1"/><text x={tipX+9} y={tipY+18} fill="#60a5fa" fontSize="15" fontWeight="bold" fontFamily="var(--font-mono)">{toUnit(hov.h)}</text><text x={tipX+9} y={tipY+31} fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)">{hov.d>=1000?`${(hov.d/1000).toFixed(2)}km`:`${hov.d.toFixed(0)}m`} from start</text><text x={tipX+9} y={tipY+43} fill={parseFloat(slp)>0?"#34d399":"#f87171"} fontSize="9" fontFamily="var(--font-mono)">slope {slp}%</text></>);})()} 
                  <rect x={PAD_L} y={PAD_T} width={cW} height={cH} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="1"/>
                </svg>
              </div>
            );
          })()}

          {elevLoading&&!elevProfile&&(
            <div style={{position:"fixed",bottom:SB+20,left:"50%",transform:"translateX(-50%)",zIndex:1200,background:"rgba(8,13,25,.94)",border:"1px solid rgba(245,158,11,.25)",borderRadius:10,padding:"11px 22px",color:"#fbbf24",fontSize:12,fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",gap:10,backdropFilter:"blur(16px)"}}>
              <div style={{width:14,height:14,border:"2px solid rgba(245,158,11,.2)",borderTopColor:"#f59e0b",borderRadius:"50%",animation:"spin .7s linear infinite"}}/>
              Sampling terrain elevation…
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          DEM LEGEND
      ══════════════════════════════════════════════════════════════════ */}
      {demEnabled&&(
        <div style={{position:"fixed",bottom:SB+16,right:64,zIndex:1050,background:"rgba(6,10,20,.9)",border:"1px solid rgba(16,185,129,.2)",borderRadius:12,padding:"12px 14px",minWidth:145,boxShadow:"0 4px 24px rgba(0,0,0,.6)",fontFamily:"var(--font-ui)",backdropFilter:"blur(16px)",animation:"fadeSlideIn .2s ease"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round"><path d="M3 20l4-8 3 5 3-9 4 12"/></svg>
            <span style={{color:"#34d399",fontSize:10,fontWeight:700,letterSpacing:".07em"}}>{demStyle==="hypsometric"?"HYPSOMETRIC":demStyle==="slope"?"HILLSHADE":"DEM COMBO"}</span>
          </div>
          {(demStyle==="hypsometric"||demStyle==="both")&&(
            <div style={{display:"flex",gap:8,marginBottom:6}}>
              <div style={{width:12,borderRadius:3,flexShrink:0,background:"linear-gradient(to bottom,#4a148c,#b71c1c,#e65100,#f9a825,#558b2f,#2e7d32,#00838f,#0277bd,#1a237e)"}}/>
              <div style={{display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
                {[["2000+m","#c084fc"],["1000m","#fb923c"],["500m","#fbbf24"],["Sea","#60a5fa"],["−400m","#818cf8"]].map(([label,color])=>(
                  <span key={label} style={{fontSize:9,color,fontFamily:"var(--font-mono)"}}>{label}</span>
                ))}
              </div>
            </div>
          )}
          <div style={{marginTop:4,paddingTop:6,borderTop:"1px solid rgba(255,255,255,.06)",display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:9,color:"var(--text-dim)"}}>Opacity</span>
            <div style={{flex:1,height:3,background:"rgba(255,255,255,.08)",borderRadius:2}}><div style={{width:`${demOpacity*100}%`,height:"100%",background:"#10b981",borderRadius:2}}/></div>
            <span style={{fontSize:9,color:"#34d399",fontFamily:"var(--font-mono)"}}>{Math.round(demOpacity*100)}%</span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          LOCATION INFO
      ══════════════════════════════════════════════════════════════════ */}
      {locationInfo&&(
        <div style={{position:"fixed",top:TB+14,right:60,width:Math.min(288,window.innerWidth-24),zIndex:1050,background:"rgba(8,13,25,.92)",borderRadius:12,overflow:"hidden",boxShadow:"0 8px 36px rgba(0,0,0,.6)",border:"1px solid rgba(255,255,255,.08)",backdropFilter:"blur(20px)",animation:"fadeSlideIn .2s ease",fontFamily:"var(--font-ui)"}}>
          <div style={{padding:"12px 14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div style={{color:"var(--text-primary)",fontWeight:700,fontSize:14,flex:1,paddingRight:8,lineHeight:1.3}}>{locationInfo.name}</div>
              <button onClick={()=>setLocationInfo(null)} style={{background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer",flexShrink:0,padding:2}}><Icons.Close/></button>
            </div>
            <div style={{padding:"5px 9px",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:7,marginBottom:7,fontFamily:"var(--font-mono)",color:"var(--text-muted)",fontSize:10}}>{locationInfo.lat.toFixed(6)}°, {locationInfo.lng.toFixed(6)}°</div>
            {locationInfo.details&&<div style={{color:"var(--text-muted)",fontSize:11,lineHeight:1.5}}>{locationInfo.details}</div>}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BUILDING INFO
      ══════════════════════════════════════════════════════════════════ */}
      {buildingInfo&&(
        <div style={{position:"fixed",left:Math.min(buildingInfo.x,window.innerWidth-255),top:Math.max(buildingInfo.y,TB+8),zIndex:1100,width:248,background:"rgba(8,13,25,.95)",borderRadius:12,border:"1px solid rgba(99,102,241,.25)",boxShadow:"0 8px 32px rgba(0,0,0,.7)",fontFamily:"var(--font-ui)",overflow:"hidden",backdropFilter:"blur(20px)",animation:"fadeSlideIn .15s ease"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",background:"rgba(99,102,241,.08)",borderBottom:"1px solid rgba(99,102,241,.15)"}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <div style={{width:22,height:22,borderRadius:5,background:"rgba(99,102,241,.2)",display:"flex",alignItems:"center",justifyContent:"center"}}><Icons.Building/></div>
              <span style={{color:"var(--text-primary)",fontWeight:700,fontSize:12,maxWidth:155,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{buildingInfo.name}</span>
            </div>
            <button onClick={()=>setBuildingInfo(null)} style={{background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer"}}><Icons.Close/></button>
          </div>
          <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:6}}>
            {[["TYPE",buildingInfo.untagged?"Not tagged in OSM":buildingInfo.type,"#a5b4fc"],["HEIGHT",buildingInfo.height,"#60a5fa"],["FLOORS",buildingInfo.floors,"#34d399"]].filter(([,v])=>v).map(([k,v,c])=>(
              <div key={k} style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:9,color:"var(--text-dim)",fontWeight:700,width:46}}>{k}</span>
                <span style={{fontSize:11,color:c,background:"rgba(255,255,255,.04)",padding:"2px 8px",borderRadius:5,textTransform:"capitalize"}}>{v}</span>
              </div>
            ))}
            {buildingInfo.untagged&&(
              <div style={{marginTop:2,padding:"7px 9px",background:"rgba(251,191,36,.05)",border:"1px solid rgba(251,191,36,.15)",borderRadius:7,fontSize:10,color:"#78716c",lineHeight:1.5}}>
                OSM data for this area may be incomplete
              </div>
            )}
          </div>
        </div>
      )}

      {/* CSV Point Info */}
      {csvInfo&&(
        <div style={{position:"fixed",left:Math.min(csvInfo.x,window.innerWidth-290),top:Math.max(csvInfo.y,TB+8),zIndex:1100,width:275,background:"rgba(8,13,25,.95)",borderRadius:12,border:"1px solid rgba(34,197,94,.25)",boxShadow:"0 8px 32px rgba(0,0,0,.65)",fontFamily:"var(--font-ui)",overflow:"hidden",backdropFilter:"blur(20px)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"rgba(34,197,94,.07)",borderBottom:"1px solid rgba(34,197,94,.15)"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:"50%",background:"#22c55e"}}/><span style={{color:"var(--text-primary)",fontWeight:600,fontSize:11,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{csvInfo.name}</span></div>
            <button onClick={()=>setCsvInfo(null)} style={{background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer"}}><Icons.Close/></button>
          </div>
          <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
            {[["LAT",csvInfo.rowData?.lat?.toFixed(6)],["LNG",csvInfo.rowData?.lng?.toFixed(6)]].map(([l,v])=>(
              <div key={l} style={{flex:1,padding:"6px 10px",borderRight:l==="LAT"?"1px solid rgba(255,255,255,.04)":"none"}}>
                <div style={{color:"var(--text-dim)",fontSize:9,fontWeight:700,marginBottom:2}}>{l}</div>
                <div style={{color:"#22c55e",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{maxHeight:180,overflowY:"auto"}}>
            {Object.entries(csvInfo.rowData?.fields||{}).map(([k,v],i)=>(
              <div key={k} style={{display:"flex",padding:"5px 10px",background:i%2===0?"transparent":"rgba(255,255,255,.01)",borderBottom:"1px solid rgba(255,255,255,.03)"}}>
                <div style={{color:"var(--text-dim)",fontSize:9,fontWeight:600,minWidth:80,flexShrink:0}}>{k.includes(".")?k.split(".").pop():k}</div>
                <div style={{color:"var(--text-secondary)",fontSize:10,wordBreak:"break-word"}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          DRAW NAME MODAL
      ══════════════════════════════════════════════════════════════════ */}
      {showModal&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(8px)"}}>
          <div style={{background:"rgba(8,13,25,.96)",borderRadius:14,padding:24,width:"100%",maxWidth:295,boxShadow:"0 12px 48px rgba(0,0,0,.8)",border:"1px solid rgba(255,255,255,.08)",fontFamily:"var(--font-ui)",animation:"fadeSlideIn .2s ease"}}>
            <div style={{marginBottom:16}}>
              <div style={{color:"var(--text-primary)",fontWeight:700,fontSize:16,marginBottom:4}}>Name this {pendingType}</div>
              <div style={{color:"var(--text-muted)",fontSize:11}}>{pendingPts.length} point{pendingPts.length!==1?"s":""} recorded</div>
            </div>
            <input autoFocus value={pendingName} onChange={e=>setPendingName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmDrawing()} placeholder={`e.g. ${pendingType==="marker"?"Survey Point A":"Route Alpha"}`}
              className="g3-input" style={{marginBottom:14,fontSize:13}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={confirmDrawing} style={{flex:1,padding:"10px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#1d4ed8,#0891b2)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"var(--font-ui)"}}>Save Drawing</button>
              <button onClick={cancelDrawing} style={{padding:"10px 16px",borderRadius:9,border:"1px solid rgba(255,255,255,.1)",background:"transparent",color:"var(--text-muted)",fontWeight:500,fontSize:13,cursor:"pointer",fontFamily:"var(--font-ui)"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          KML FLY-IN
      ══════════════════════════════════════════════════════════════════ */}
      {kmlFlyIn&&(
        <div style={{position:"fixed",zIndex:1500,bottom:SB+10,left:PANEL+16,right:80,pointerEvents:"none",animation:"fadeSlideIn .3s ease"}}>
          <div style={{height:2,background:"rgba(255,255,255,.06)",borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",background:"linear-gradient(90deg,#3b82f6,#06b6d4)",borderRadius:2,animation:"progressBar 4.5s cubic-bezier(.4,0,.6,1) forwards"}}/>
          </div>
          <div style={{marginTop:6,display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#3b82f6",boxShadow:"0 0 6px #3b82f6"}}/>
            <span style={{color:"var(--text-dim)",fontSize:10,fontFamily:"var(--font-ui)"}}>Navigating to <span style={{color:"var(--text-secondary)"}}>{kmlName}</span></span>
          </div>
        </div>
      )}

      {/* KML Camera Stats */}
      {kmlStats&&!kmlFlyIn&&(
        <div className="g3-kml-stats" style={{position:"fixed",top:TB+8,right:10,zIndex:1002,width:200,background:"rgba(6,10,20,.9)",border:"1px solid rgba(255,255,255,.08)",backdropFilter:"blur(16px)",fontFamily:"var(--font-mono)",fontSize:10,userSelect:"none",borderRadius:10,overflow:"hidden",animation:"slideLeft .3s ease"}}>
          <div style={{padding:"7px 12px",borderBottom:"1px solid rgba(255,255,255,.06)",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(255,255,255,.02)"}}>
            <span style={{color:"var(--text-dim)",fontSize:9,letterSpacing:".1em",fontWeight:700}}>CAMERA ORIENTATION</span>
            <button onClick={()=>setKmlStats(null)} style={{background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer",lineHeight:1}}><Icons.Close/></button>
          </div>
          {[["Heading",`${compassHeading.toFixed(1)}°`],["Eye Alt",formatAlt(cameraAlt)]].map(([label,val])=>(
            <div key={label} style={{display:"flex",alignItems:"baseline",padding:"4px 12px"}}>
              <span style={{color:"var(--text-dim)",fontSize:9,width:56,flexShrink:0,letterSpacing:".06em"}}>{label}</span>
              <span style={{color:"var(--text-secondary)",fontSize:11}}>{val}</span>
            </div>
          ))}
          <div style={{borderTop:"1px solid rgba(255,255,255,.06)",padding:"7px 12px"}}>
            <div style={{color:"var(--text-dim)",fontSize:8,letterSpacing:".1em",marginBottom:5}}>KML EXTENT</div>
            {[["Features",kmlStats.featureCount],["Centre",`${Math.abs(kmlStats.center.lat).toFixed(4)}° ${kmlStats.center.lat>=0?"N":"S"}`],["Span",`~${kmlStats.spanKm} km`]].map(([label,val],i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{color:"var(--text-dim)"}}>{label}</span>
                <span style={{color:"var(--text-secondary)"}}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          COORDINATE CONVERTER PANEL
      ══════════════════════════════════════════════════════════════════ */}
      {coordConvOpen&&(
        <div style={{position:"fixed",top:TB,right:0,width:320,bottom:SB,zIndex:1080,background:"rgba(6,10,20,.94)",borderLeft:"1px solid rgba(255,255,255,.07)",display:"flex",flexDirection:"column",fontFamily:"var(--font-ui)",backdropFilter:"blur(24px)",boxShadow:"-8px 0 40px rgba(0,0,0,.5)",animation:"slideLeft .2s ease"}}>
          <div style={{padding:"14px 16px",borderBottom:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.02)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:30,height:30,borderRadius:8,background:"linear-gradient(135deg,rgba(124,58,237,.4),rgba(167,139,250,.2))",border:"1px solid rgba(167,139,250,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🔄</div>
              <div>
                <div style={{color:"var(--text-primary)",fontWeight:700,fontSize:13}}>Coordinate Converter</div>
                <div style={{color:"var(--text-dim)",fontSize:10}}>LatLng · UTM · MGRS · DMS · Geohash</div>
              </div>
            </div>
            <button onClick={()=>{setCoordConvOpen(false);setConvPickMode(false);}} style={{background:"none",border:"none",color:"var(--text-dim)",cursor:"pointer"}}><Icons.Close/></button>
          </div>

          <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>

            {/* Input */}
            <div style={{background:"rgba(124,58,237,.06)",border:"1px solid rgba(124,58,237,.2)",borderRadius:10,padding:"12px"}}>
              <div style={{color:"#a78bfa",fontSize:10,fontWeight:700,letterSpacing:".08em",marginBottom:8}}>INPUT COORDINATE</div>
              <textarea value={convInput} onChange={e=>{setConvInput(e.target.value);setConvError("");}} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleConvSubmit();}}} placeholder={"Any format:\n20.296198, 85.824597\n44N 400000E 2200000N\n43C MU 23450 45678\n20°17'46\"N, 85°49'28\"E"} rows={4}
                style={{width:"100%",padding:"9px 11px",borderRadius:8,border:"1px solid rgba(255,255,255,.09)",background:"rgba(255,255,255,.03)",color:"var(--text-primary)",fontSize:11,outline:"none",resize:"vertical",fontFamily:"var(--font-mono)",lineHeight:1.5,boxSizing:"border-box",transition:"border-color .15s"}}
                onFocus={e=>e.target.style.borderColor="rgba(124,58,237,.4)"}
                onBlur={e=>e.target.style.borderColor="rgba(255,255,255,.09)"}/>
              {convError&&(
                <div style={{color:"#f87171",fontSize:10,lineHeight:1.5,padding:"6px 9px",background:"rgba(239,68,68,.07)",borderRadius:7,border:"1px solid rgba(239,68,68,.2)",marginTop:7}}>⚠ {convError}</div>
              )}
              <div style={{display:"flex",gap:6,marginTop:8}}>
                <button onClick={handleConvSubmit} style={{flex:1,padding:"9px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#6d28d9,#7c3aed)",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}
                  onMouseEnter={e=>e.currentTarget.style.filter="brightness(1.15)"}
                  onMouseLeave={e=>e.currentTarget.style.filter="brightness(1)"}>
                  <Icons.Coords/> Convert
                </button>
                <button onClick={()=>{setConvInput("");setConvResult(null);setConvError("");}} style={{padding:"9px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,.08)",background:"transparent",color:"var(--text-muted)",fontSize:12,cursor:"pointer",fontFamily:"var(--font-ui)"}}>Clear</button>
              </div>
            </div>

            {/* Pick from map */}
            <button onClick={()=>setConvPickMode(p=>!p)}
              style={{width:"100%",padding:"11px",borderRadius:9,border:`2px solid ${convPickMode?"rgba(167,139,250,.6)":"rgba(124,58,237,.2)"}`,background:convPickMode?"rgba(124,58,237,.15)":"rgba(124,58,237,.04)",color:convPickMode?"#c4b5fd":"#7c6fa0",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .15s",fontFamily:"var(--font-ui)"}}>
              <span style={{fontSize:16}}>🖱️</span>
              {convPickMode?"Click map to pick location…":"Pick from Map"}
              {convPickMode&&<span style={{fontSize:10,background:"rgba(167,139,250,.25)",padding:"2px 8px",borderRadius:20,color:"#ddd6fe"}}>Active</span>}
            </button>

            {/* Format reference */}
            {!convResult&&(
              <div style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:10,padding:"12px"}}>
                <div style={{color:"var(--text-dim)",fontSize:10,fontWeight:700,letterSpacing:".08em",marginBottom:10}}>SUPPORTED FORMATS</div>
                {[["Decimal Degrees","20.2962, 85.8246","#60a5fa"],["Signed DD","+20.2962, +85.8246","#60a5fa"],["DMS","20°17'46\"N, 85°49'28\"E","#34d399"],["UTM","44N 452000E 2243000N","#fbbf24"],["MGRS","44QKM 52000 43000","#f97316"]].map(([fmt,ex,col])=>(
                  <div key={fmt} style={{marginBottom:8}}>
                    <div style={{color:col,fontSize:9,fontWeight:700,letterSpacing:".06em",marginBottom:2}}>{fmt}</div>
                    <div onClick={()=>setConvInput(ex)} style={{color:"var(--text-secondary)",fontSize:10,fontFamily:"var(--font-mono)",cursor:"pointer",padding:"4px 8px",borderRadius:6,background:"rgba(255,255,255,.03)",userSelect:"all",transition:"background .12s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.07)"}
                      onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.03)"}
                      title="Click to use this example">{ex}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Results */}
            {convResult&&(()=>{
              const rows=[{label:"Decimal Degrees",key:"dd",value:convResult.dd,color:"#60a5fa",icon:"🌐"},{label:"DD Simple",key:"ddSimple",value:convResult.ddSimple,color:"#60a5fa",icon:"📍"},{label:"DMS",key:"dmsStr",value:convResult.dmsStr,color:"#34d399",icon:"📐"},{label:"UTM",key:"utmStr",value:convResult.utmStr,color:"#fbbf24",icon:"🗺"},{label:"MGRS",key:"mgrsStr",value:convResult.mgrsStr,color:"#f97316",icon:"⊞"},{label:"Geohash",key:"geohash",value:convResult.geohash,color:"#e879f9",icon:"#"}];
              return(
                <>
                  <div style={{background:"rgba(124,58,237,.1)",border:"1px solid rgba(124,58,237,.25)",borderRadius:10,padding:"11px 13px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div>
                      <div style={{color:"#c4b5fd",fontSize:10,fontWeight:700,letterSpacing:".06em",marginBottom:4}}>RESULT</div>
                      <div style={{color:"var(--text-primary)",fontFamily:"var(--font-mono)",fontSize:11}}>{convResult.lat.toFixed(5)}°, {convResult.lng.toFixed(5)}°</div>
                    </div>
                    <button onClick={convFlyTo}
                      style={{padding:"8px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#6d28d9,#7c3aed)",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontFamily:"var(--font-ui)"}}>
                      <Icons.Fly/> Fly To
                    </button>
                  </div>

                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {rows.filter(r=>r.value).map(row=>(
                      <div key={row.key} style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.06)",borderRadius:9,padding:"9px 11px"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <span style={{fontSize:11}}>{row.icon}</span>
                            <span style={{color:row.color,fontSize:9,fontWeight:700,letterSpacing:".07em"}}>{row.label.toUpperCase()}</span>
                          </div>
                          <button onClick={()=>copyConv(row.value,row.key)}
                            style={{padding:"2px 9px",borderRadius:5,border:`1px solid ${convCopied===row.key?"rgba(74,222,128,.5)":"rgba(255,255,255,.09)"}`,background:convCopied===row.key?"rgba(74,222,128,.1)":"transparent",color:convCopied===row.key?"#4ade80":"var(--text-dim)",fontSize:9,cursor:"pointer",fontWeight:600,transition:"all .15s",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",gap:3}}>
                            <Icons.Copy/> {convCopied===row.key?"Copied!":"Copy"}
                          </button>
                        </div>
                        <div style={{color:"var(--text-secondary)",fontFamily:"var(--font-mono)",fontSize:11,wordBreak:"break-all",lineHeight:1.4,userSelect:"all"}}>{row.value}</div>
                      </div>
                    ))}
                  </div>

                  {convResult.utm&&(
                    <div style={{background:"rgba(251,191,36,.04)",border:"1px solid rgba(251,191,36,.15)",borderRadius:9,padding:"11px 13px"}}>
                      <div style={{color:"#fbbf24",fontSize:10,fontWeight:700,letterSpacing:".08em",marginBottom:8}}>UTM ZONE DETAILS</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 10px"}}>
                        {[["Zone",`${convResult.utm.zone}${convResult.utm.band}`],["Easting",`${convResult.utm.easting} m`],["Northing",`${convResult.utm.northing} m`],["Hemisphere",convResult.lat>=0?"Northern":"Southern"]].map(([k,v])=>(
                          <div key={k}>
                            <div style={{color:"var(--text-dim)",fontSize:9,fontWeight:700}}>{k}</div>
                            <div style={{color:"#fde68a",fontFamily:"var(--font-mono)",fontSize:10}}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button onClick={()=>{const all=rows.filter(r=>r.value).map(r=>`${r.label}: ${r.value}`).join("\n");copyConv(all,"all");}}
                    style={{width:"100%",padding:"10px",borderRadius:8,border:`1px solid ${convCopied==="all"?"rgba(74,222,128,.4)":"rgba(255,255,255,.08)"}`,background:convCopied==="all"?"rgba(74,222,128,.08)":"rgba(255,255,255,.03)",color:convCopied==="all"?"#4ade80":"var(--text-muted)",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"var(--font-ui)",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                    <Icons.Copy/> {convCopied==="all"?"✓ Copied All!":"Copy All Formats"}
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          FEATURE PANELS
      ══════════════════════════════════════════════════════════════════ */}
      <HeatmapLayer viewer={viewerRef.current} Cesium={CesiumRef.current} visible={heatmapOpen} onClose={()=>setHeatmapOpen(false)}/>
      <SatelliteTimeSlider viewer={viewerRef.current} Cesium={CesiumRef.current} visible={sliderOpen} onClose={()=>setSliderOpen(false)}/>
      <DroneFlightPath viewer={viewerRef.current} Cesium={CesiumRef.current} visible={droneOpen} onClose={()=>setDroneOpen(false)}/>
      <DataLayersPanel viewer={viewerRef.current} Cesium={CesiumRef.current} visible={dataLayersOpen} onClose={()=>setDataLayersOpen(false)}/>
    </>
  );
}