/**
 * SurveyMap.jsx — SurveyMap Pro v5.2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * NEW v5.2.1 — KML / CSV / KMZ EXPORT
 *
 *   After drawing, the toolbar now shows:
 *     Export KML | Export CSV | Export KMZ
 *   alongside the existing Export GeoJSON button.
 *
 *   Also added to sidebar "More Tools" section and draw done panel.
 *
 *   Uses exportUtils.js (place in src/utils/exportUtils.js):
 *     exportKML(savedDrawings, route, measurePoints)
 *     exportCSV(savedDrawings, route, measurePoints)
 *     exportKMZ(savedDrawings, route, measurePoints)
 *
 *   Requires JSZip (already in your project for KMZ import).
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, WMSTileLayer, useMap } from "react-leaflet";

import AddSearch          from "./search/AddSearch";
import LiveGPS            from "./map/LiveGPS";
import BoundaryLayer      from "./map/BoundaryLayer";
import MapTracker         from "./map/MapTracker";
import MeasureTool        from "./tools/MeasureTool";
import DrawTool           from "./tools/DrawTool";
import SurveyClick        from "./tools/SurveyClick";
import KMLLoader          from "./loaders/KMLLoader";
import KMZLoader          from "./loaders/KMZLoader";
import CSVLoader          from "./loaders/CSVLoader";
import Globe3DView        from "./Globe3DView";
import LiveTrackRecorder  from "./tools/LiveTrackRecorder";
import { useOfflineMap }          from "./map/useOfflineMap";
import OfflineMapManager          from "./map/OfflineMapManager";
import OfflineStatusBadge         from "./map/OfflineStatusBadge";
import OfflineTileLayer           from "./map/OfflineTileLayer";
import { useElevation }           from "./map/useElevation";
import ElevationProfile           from "./map/ElevationProfile";
import { useNightModeAutoSwitch } from "./map/useNightModeAutoSwitch";
import { haversine, formatDist }  from "./map/measureUtils";
import { exportKML, exportCSV, exportKMZ } from "../utils/exportUtils.js";

import { Ico }                    from "../constants/icons.jsx";
import { MAP_LAYERS, MENU_DEFS }  from "../constants/mapLayers.js";
import { GLOBAL_STYLES }          from "../constants/globalStyles.js";
import { toDMS, toUTM, bearingLabel, zoomToAltitude, zoomForType, geocodeForMap, reverseGeocode, toPlusCode } from "../utils/mapUtils.js";
import { useCompassNav }          from "../hooks/useCompassNav.js";
import { useGeoJSON }             from "../hooks/useGeoJSON.js";
import {
  SectionHeader, LayerItem, PrimaryButton,
  MobileBottomSheet, SheetHeader, SheetDivider, SheetBtn,
} from "../components/UIComponents.jsx";
import { ProfessionalCompassControl, MobileCompassWidget } from "../components/CompassControls.jsx";
import { MobileSearchBar, MobileBottomNav, CompactMobileHUD } from "../components/MobileUI.jsx";
import { MapFlyController, MapRefCapture, ElevationClickCapture } from "./map/MapHelpers.jsx";
import MobileFileFolder from "../components/MobileFileFolder.jsx";

const MENU_H = 36;
const TB_H   = 42;
const STAT_H = 26;
const SB_W   = 264;
const TOP_H  = MENU_H + TB_H;

function MapSizeInvalidator() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 120);
    const onResize = () => { try { map.invalidateSize(); } catch (_) {} };
    window.addEventListener("resize", onResize);
    return () => { clearTimeout(t); window.removeEventListener("resize", onResize); };
  }, [map]);
  return null;
}

export default function SurveyMap() {

  const kmlInputRef      = useRef(null);
  const extraInputRef    = useRef(null);
  const geojsonInputRef  = useRef(null);
  const polylineRef      = useRef(null);
  const previewLayerRef  = useRef(null);
  const drawLayersRef    = useRef([]);
  const measureLayersRef = useRef([]);
  const measureLineRef   = useRef(null);
  const leafletMapRef    = useRef(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const [activeLayer,     setActiveLayer]     = useState("Satellite");
  const [nightModeAuto,   setNightModeAuto]   = useState(false);
  const [nightSwitchInfo, setNightSwitchInfo] = useState(null);
  useNightModeAutoSwitch({
    enabled: nightModeAuto, activeLayer, setActiveLayer,
    nightLayer: "Dark", dayLayer: "Satellite + Labels",
    onSwitch: ({ isNight }) => setNightSwitchInfo({ isNight }),
  });

  const [flyTarget,  setFlyTarget]  = useState(null);
  const [mapBearing, setMapBearing] = useState(0);
  const [mapZoom,    setMapZoom]    = useState(13);

  const [searchQuery,   setSearchQuery]   = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const searchFnRef = useRef(null);

  const [locationInfo,    setLocationInfo]    = useState(null);
  const [boundaryGeojson, setBoundaryGeojson] = useState(null);
  const [mousePos,        setMousePos]        = useState(null);
  const [coordFmt,        setCoordFmt]        = useState("dms");

  const [drawMode,      setDrawMode]      = useState(false);
  const [drawType,      setDrawType]      = useState("path");
  const [drawPoints,    setDrawPoints]    = useState([]);
  const [savedDrawings, setSavedDrawings] = useState([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingName,   setPendingName]   = useState("");
  const [pendingPoints, setPendingPoints] = useState([]);
  const [pendingType,   setPendingType]   = useState("path");

  const [measureMode,   setMeasureMode]   = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measureUnit,   setMeasureUnit]   = useState("m");

  const [surveyMode, setSurveyMode] = useState(false);
  const [route,      setRoute]      = useState([]);

  const [kmlFile,       setKmlFile]       = useState(null);
  const [kmlLoading,    setKmlLoading]    = useState(false);
  const [kmlName,       setKmlName]       = useState(null);
  const [extraFile,     setExtraFile]     = useState(null);
  const [extraFileType, setExtraFileType] = useState(null);

  const [show3D, setShow3D] = useState(false);

  const [trackerOpen,      setTrackerOpen]      = useState(false);
  const [isTracking,       setIsTracking]       = useState(false);
  const [mapRefForTracker, setMapRefForTracker] = useState(null);

  const [offlineOpen, setOfflineOpen] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const {
    swReady, swError, isOnline, cacheStats,
    precaching, precacheProgress, precacheRegion,
    precacheCurrentView, clearTileCache, fetchCacheStats, stopPrecache,
  } = useOfflineMap();
  useEffect(() => { if (!isOnline) setOfflineMode(true); }, [isOnline]);

  const [elevOpen,        setElevOpen]        = useState(false);
  const [elevMode,        setElevMode]        = useState(null);
  const [elevProfileData, setElevProfileData] = useState([]);
  const [elevSourceLabel, setElevSourceLabel] = useState("");
  const [customElevPts,   setCustomElevPts]   = useState([]);
  const { cursorElevation, elevLoading, getCursorElevation, getElevationProfile } = useElevation({ isOnline });

  const [openMenu,      setOpenMenu]      = useState(null);
  const [showAbout,     setShowAbout]     = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchOpen,    setSearchOpen]    = useState(true);
  const [placesOpen,    setPlacesOpen]    = useState(true);
  const [layersOpen,    setLayersOpen]    = useState(true);
  const [toolsOpen,     setToolsOpen]     = useState(true);
  const [geojsonOpen,   setGeojsonOpen]   = useState(true);

  const [activeSheet, setActiveSheet] = useState(null);
  const [fileVisibility, setFileVisibility] = useState({});

  const compass = useCompassNav(leafletMapRef);
  const geoJSON = useGeoJSON(leafletMapRef);

  useEffect(() => {
    geoJSON.importedGeoJSONLayers.forEach(l => {
      setFileVisibility(p => p[l.id] !== undefined ? p : { ...p, [l.id]: true });
    });
  }, [geoJSON.importedGeoJSONLayers]);

  const totalDistance = measurePoints.length >= 2
    ? measurePoints.reduce((sum, p, i) => i === 0 ? 0 : sum + haversine(measurePoints[i-1], p), 0)
    : 0;

  const hasExportData = savedDrawings.length > 0 || route.length >= 2 || measurePoints.length >= 2;

  const onMouseMove  = useCallback(p => { setMousePos(p); if (p) getCursorElevation(p.lat, p.lng); }, [getCursorElevation]);
  const onZoomChange = useCallback(z => setMapZoom(z), []);

  const handleElevModeRequest = useCallback(async (mode) => {
    setElevMode(mode); setElevOpen(true); setElevProfileData([]); setElevSourceLabel("");
    let pts = [], label = "";
    if      (mode==="survey"  && route.length>=2)         { pts=route.map(p=>({lat:p[0],lng:p[1]})); label=`Survey Route · ${route.length} pts`; }
    else if (mode==="measure" && measurePoints.length>=2) { pts=measurePoints.map(p=>({lat:p.lat,lng:p.lng})); label=`Measure · ${measurePoints.length} pts`; }
    else if (mode==="draw"    && drawPoints.length>=2)    { pts=drawPoints.map(p=>({lat:p[0]??p.lat,lng:p[1]??p.lng})); label=`Draw · ${drawPoints.length} pts`; }
    else if (mode==="custom") { setCustomElevPts([]); setElevProfileData([]); setElevSourceLabel("Click map points"); return; }
    if (pts.length<2) { setElevSourceLabel("Not enough points"); return; }
    setElevSourceLabel(label);
    const profile = await getElevationProfile(pts);
    setElevProfileData(profile);
  }, [route, measurePoints, drawPoints, getElevationProfile]);

  const handleMapClickForElev = useCallback(async (latlng) => {
    if (elevMode!=="custom"||!elevOpen) return;
    const newPts = [...customElevPts, {lat:latlng.lat,lng:latlng.lng}];
    setCustomElevPts(newPts); setElevSourceLabel(`Custom · ${newPts.length} pts`);
    if (newPts.length>=2) { const profile=await getElevationProfile(newPts); setElevProfileData(profile); }
  }, [elevMode, elevOpen, customElevPts, getElevationProfile]);

  const handleKMLUpload = (e) => {
    const f=e.target.files[0]; if(!f) return;
    setKmlLoading(true); setKmlName(f.name); setKmlFile(f);
    setFileVisibility(p => ({ ...p, __kml__: true }));
    e.target.value="";
  };

  const handleExtraUpload = (e) => {
    const f=e.target.files[0]; if(!f) return;
    const ext=f.name.split(".").pop().toLowerCase();
    if(ext!=="kmz"&&ext!=="csv"){alert("Please upload a KMZ or CSV file.");e.target.value="";return;}
    setExtraFile(f); setExtraFileType(ext);
    setFileVisibility(p => ({ ...p, [`__${ext}__`]: true }));
    e.target.value="";
  };

  const handleToggleSurvey = () => {
    if (surveyMode) { setRoute([]); if(polylineRef.current){polylineRef.current.remove();polylineRef.current=null;} }
    setSurveyMode(p=>!p);
  };

  const finishDrawing  = () => { if(!drawPoints.length) return; setPendingPoints(drawPoints); setPendingType(drawType); setPendingName(""); setShowNameModal(true); setActiveSheet(null); };
  const confirmDrawing = () => {
    const name = pendingName.trim()||(pendingType==="marker"?"Marker":pendingType==="path"?"Path":"Polygon");
    setSavedDrawings(p=>[...p,{name,type:pendingType,points:pendingPoints}]);
    setDrawPoints([]); if(previewLayerRef.current){previewLayerRef.current.remove();previewLayerRef.current=null;}
    drawLayersRef.current.forEach(l=>l.remove()); drawLayersRef.current=[]; setShowNameModal(false); setDrawMode(false);
  };
  const cancelDrawing = () => {
    setDrawPoints([]); if(previewLayerRef.current){previewLayerRef.current.remove();previewLayerRef.current=null;}
    drawLayersRef.current.forEach(l=>l.remove()); drawLayersRef.current=[]; setShowNameModal(false); setDrawMode(false);
  };
  const clearMeasure = () => {
    measureLayersRef.current.forEach(l=>l.remove()); measureLayersRef.current=[];
    if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}
    setMeasurePoints([]); setMeasureMode(false);
  };

  async function handleSidebarSearch(e) {
    e?.preventDefault();
    const q=searchQuery.trim(); if(!q) return;
    setSearchLoading(true);
    try {
      const m=q.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if(m){const lat=parseFloat(m[1]),lng=parseFloat(m[2]); if(!isNaN(lat)&&!isNaN(lng)){setFlyTarget({lat,lng,zoom:16,_ts:Date.now()}); setLocationInfo({lat,lng,name:`${lat.toFixed(5)}, ${lng.toFixed(5)}`,details:"Coordinates",loading:false}); return;}}
      const result=await geocodeForMap(q);
      if(!result){alert(`"${q}" — location not found.`); return;}
      setFlyTarget({lat:result.lat,lng:result.lng,zoom:zoomForType(result.type),bbox:result.bbox,_ts:Date.now()});
      setLocationInfo({lat:result.lat,lng:result.lng,name:result.name,details:result.display_name,loading:false,description:null,wikiUrl:null,photo:null});
      if(result.geojson) setBoundaryGeojson(result.geojson);
      if(searchFnRef.current){try{await searchFnRef.current(q);}catch(_){}}
      try{
        const wikiName=result.name.replace(/\s+(hostel|hotel|restaurant|cafe|shop|store|market)$/i,"").trim();
        const wr=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiName)}`,{signal:AbortSignal.timeout(5000)});
        if(wr.ok){const w=await wr.json();if(w.type!=="disambiguation"&&w.extract?.length>30){setLocationInfo(prev=>prev?{...prev,description:w.extract,wikiUrl:w.content_urls?.desktop?.page,photo:w.thumbnail?.source||null}:null);}}
      }catch(_){}
    } finally { setSearchLoading(false); if(isMobile) setActiveSheet(null); }
  }

  const handleLocationFound = useCallback(async ({ lat, lng, label, raw }) => {
    setLocationInfo({lat,lng,label,loading:true,photo:null,description:null});
    setFlyTarget({lat,lng,zoom:15,_ts:Date.now()});
    const isRawCoord=raw&&!raw.display_name;
    if(isRawCoord){
      setBoundaryGeojson(null);
      setLocationInfo({lat,lng,label,name:`${lat.toFixed(5)}, ${lng.toFixed(5)}`,description:null,wikiUrl:null,photo:null,details:null,plusCode:toPlusCode(lat,lng),loading:true});
      const place=await reverseGeocode(lat,lng);
      if(place){const addr=place.address||{};const city=addr.city||addr.town||addr.village||addr.suburb||addr.county||"";const details=[city,addr.state,addr.country].filter(Boolean).join(", ");const locationName=addr.neighbourhood||addr.suburb||addr.quarter||addr.road||city||addr.state||`${lat.toFixed(4)}, ${lng.toFixed(4)}`;setLocationInfo({lat,lng,label,name:locationName,details,description:null,wikiUrl:null,photo:null,plusCode:toPlusCode(lat,lng),fullAddress:place.display_name,loading:false});}
      else{setLocationInfo({lat,lng,label,name:`${lat.toFixed(5)}, ${lng.toFixed(5)}`,details:null,description:null,wikiUrl:null,photo:null,plusCode:toPlusCode(lat,lng),loading:false});}
      return;
    }
    try{
      let boundaryGeoJson=null,place=null;
      const searchName=label.split(",")[0].trim();
      const nomUrl=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchName)}&format=json&limit=5&polygon_geojson=1&addressdetails=1&namedetails=1`;
      for(const px of[`https://corsproxy.io/?url=${encodeURIComponent(nomUrl)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(nomUrl)}`]){
        try{const res=await fetch(px,{signal:AbortSignal.timeout(6000)});if(!res.ok) continue;const data=await res.json();if(!Array.isArray(data)||!data.length) continue;place=data.find(r=>r.geojson?.type==="MultiPolygon")||data.find(r=>r.geojson?.type==="Polygon")||data[0];boundaryGeoJson=place?.geojson||null;if(boundaryGeoJson) break;}catch(_){}
      }
      setBoundaryGeojson(boundaryGeoJson);
      let description=null,wikiUrl=null,photo=null;
      const placeName=place?.namedetails?.name||place?.display_name?.split(",")?.[0]||searchName;
      const wikiName=placeName.replace(/\s+(hostel|hotel|restaurant|cafe|shop|store|market)$/i,"").trim();
      try{const wr=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiName)}`);if(wr.ok){const w=await wr.json();if(w.type!=="disambiguation"&&w.extract?.length>30){description=w.extract;wikiUrl=w.content_urls?.desktop?.page;photo=w.thumbnail?.source||null;}}}catch(_){}
      const addr=place?.address||{};
      setLocationInfo({lat,lng,label,name:placeName,description,wikiUrl,photo,details:[addr.city||addr.town||addr.village,addr.state,addr.country].filter(Boolean).join(", "),loading:false});
    }catch{setLocationInfo(p=>({...p,loading:false,description:"Could not load info."}));}
  }, []);

  const handleCloseLocationInfo = useCallback(() => { setLocationInfo(null); setBoundaryGeojson(null); }, []);

  const handleMenuAction = (action) => {
    setOpenMenu(null);
    const A=action;
    if(A==="openKML")          {kmlInputRef.current?.click();return;}
    if(A==="openExtra")        {extraInputRef.current?.click();return;}
    if(A==="openGeoJSON")      {geojsonInputRef.current?.click();return;}
    if(A==="exportGeoJSON")    {geoJSON.handleExportGeoJSON({savedDrawings,route,measurePoints});return;}
    if(A==="exportKML")        {exportKML(savedDrawings,route,measurePoints);return;}
    if(A==="exportCSV")        {exportCSV(savedDrawings,route,measurePoints);return;}
    if(A==="exportKMZ")        {exportKMZ(savedDrawings,route,measurePoints);return;}
    if(A==="export")           {document.querySelector("[data-export-btn]")?.click();return;}
    if(A==="resetAll")         {if(!window.confirm("Reset everything?")) return;setSavedDrawings([]);cancelDrawing();clearMeasure();setRoute([]);setSurveyMode(false);geoJSON.clearAllGeoJSONLayers();return;}
    if(A==="startDraw")        {setDrawMode(true);setDrawPoints([]);return;}
    if(A==="cancelDraw")       {cancelDrawing();return;}
    if(A==="startMeasure")     {setMeasureMode(true);return;}
    if(A==="stopMeasure")      {clearMeasure();return;}
    if(A==="deleteDrawings")   {if(!savedDrawings.length){alert("No drawings.");return;}if(window.confirm(`Delete ${savedDrawings.length} drawing(s)?`)) setSavedDrawings([]);return;}
    if(A==="layerSatellite")   {setActiveLayer("Satellite");return;}
    if(A==="layerStreet")      {setActiveLayer("Street");return;}
    if(A==="layerTerrain")     {setActiveLayer("Terrain");return;}
    if(A==="layerDark")        {setActiveLayer("Dark");return;}
    if(A==="layerLight")       {setActiveLayer("Light");return;}
    if(A==="layerSatLabels")   {setActiveLayer("Satellite + Labels");return;}
    if(A==="show3D")           {setShow3D(true);return;}
    if(A==="toggleNight")      {setNightModeAuto(p=>!p);return;}
    if(A==="drawMarker")       {setDrawMode(true);setDrawType("marker");setDrawPoints([]);return;}
    if(A==="drawPath")         {setDrawMode(true);setDrawType("path");setDrawPoints([]);return;}
    if(A==="drawPoly")         {setDrawMode(true);setDrawType("polygon");setDrawPoints([]);return;}
    if(A==="toggleSurvey")     {handleToggleSurvey();return;}
    if(A==="openTracker")      {setTrackerOpen(true);return;}
    if(A==="openOffline")      {setOfflineOpen(true);return;}
    if(A==="toggleOfflineMode"){setOfflineMode(p=>!p);return;}
    if(A==="openElevation")    {if(isMobile){handleElevModeRequest(elevMode||"survey");setActiveSheet("elevation");}else{setElevOpen(true);}return;}
    if(A==="openCompassNav")   {compass.compassNavActive?compass.stopCompassNav():compass.startCompassNav();return;}
    if(A==="about")            {setShowAbout(true);return;}
    if(A==="shortcuts")        {setShowShortcuts(true);return;}
    if(A==="osmLink")          {window.open("https://www.openstreetmap.org","_blank");return;}
    if(A==="leafletLink")      {window.open("https://leafletjs.com/reference.html","_blank");return;}
  };

  if (show3D) return <Globe3DView savedDrawings={savedDrawings} onClose={() => setShow3D(false)}/>;

  const cfg = MAP_LAYERS[activeLayer] || {};
  const mapTop    = isMobile ? 52  : TOP_H;
  const mapLeft   = isMobile ? 0   : SB_W;
  const mapBottom = isMobile ? 60  : STAT_H;
  const baseMaxNative    = cfg.maxNativeZoom    ?? 19;
  const overlayMaxNative = cfg.overlayMaxNativeZoom ?? cfg.maxNativeZoom ?? 17;

  const LocationInfoContent = () => !locationInfo ? null : (
    <div>
      {locationInfo.photo&&(<div style={{position:"relative",height:160,overflow:"hidden",borderRadius:isMobile?"12px 12px 0 0":0}}><img src={locationInfo.photo} alt={locationInfo.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/><div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(5,12,24,1) 0%,transparent 55%)"}}/><div style={{position:"absolute",bottom:12,left:16,color:"#fff",fontWeight:700,fontSize:16}}>{locationInfo.name||locationInfo.label?.split(",")?.[0]}</div></div>)}
      <div style={{padding:"14px 16px"}}>
        {!locationInfo.photo&&(<div style={{marginBottom:12,paddingBottom:12,borderBottom:"1px solid rgba(255,255,255,0.08)"}}><div style={{color:"#d0e8f8",fontWeight:700,fontSize:15,marginBottom:3}}>{locationInfo.loading?"Locating…":(locationInfo.name||locationInfo.label?.split(",")?.[0])}</div>{locationInfo.details&&!locationInfo.loading&&<div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>{locationInfo.details}</div>}</div>)}
        <div style={{display:"flex",alignItems:"center",gap:9,padding:"10px 12px",background:"rgba(74,158,255,0.07)",borderRadius:10,marginBottom:12,border:"1px solid rgba(74,158,255,0.18)"}}><Ico name="Pin" size={14} style={{color:"#4a9eff",flexShrink:0}}/><div style={{color:"#c0daf0",fontSize:12,fontFamily:"'DM Mono',monospace",fontWeight:500}}>{locationInfo.lat?.toFixed(6)}°, {locationInfo.lng?.toFixed(6)}°</div></div>
        {locationInfo.loading?<div style={{color:"rgba(255,255,255,0.3)",fontSize:12,fontStyle:"italic",marginBottom:12}}>⏳ Fetching details…</div>:locationInfo.description?<div style={{color:"rgba(200,225,255,0.7)",fontSize:13,lineHeight:1.7,marginBottom:12,maxHeight:120,overflowY:"auto"}}>{locationInfo.description.slice(0,350)}{locationInfo.description.length>350?"…":""}</div>:null}
        <div style={{display:"flex",gap:8}}>
          {locationInfo.wikiUrl&&<a href={locationInfo.wikiUrl} target="_blank" rel="noreferrer" style={{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,padding:"10px 12px",background:"rgba(74,158,255,0.1)",borderRadius:10,color:"#60a8e8",fontSize:13,textDecoration:"none",fontWeight:600,border:"1px solid rgba(74,158,255,0.25)"}}><Ico name="Wikipedia" size={13}/> Wikipedia ↗</a>}
          <button onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${locationInfo.lat},${locationInfo.lng}`,"_blank")} style={{flex:1,padding:"10px 12px",background:"rgba(52,211,153,0.1)",borderRadius:10,border:"1px solid rgba(52,211,153,0.25)",color:"#34d399",fontSize:13,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Ico name="Maps" size={13}/> Google Maps ↗</button>
        </div>
      </div>
    </div>
  );

  /* ── Export panel shown in sidebar when data exists ─────────────────────── */
  const ExportPanel = () => !hasExportData ? null : (
    <div style={{padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
      <div style={{color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace"}}>Export Data</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
        <button onClick={() => geoJSON.handleExportGeoJSON({savedDrawings,route,measurePoints})} style={{padding:"7px 6px",borderRadius:7,cursor:"pointer",background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",color:"#4ade80",fontSize:10.5,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <Ico name="Export" size={11}/>GeoJSON
        </button>
        <button onClick={() => exportKML(savedDrawings,route,measurePoints)} style={{padding:"7px 6px",borderRadius:7,cursor:"pointer",background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.3)",color:"#fbbf24",fontSize:10.5,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <Ico name="Export" size={11}/>KML
        </button>
        <button onClick={() => exportCSV(savedDrawings,route,measurePoints)} style={{padding:"7px 6px",borderRadius:7,cursor:"pointer",background:"rgba(56,189,248,0.12)",border:"1px solid rgba(56,189,248,0.3)",color:"#38bdf8",fontSize:10.5,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <Ico name="Export" size={11}/>CSV
        </button>
        <button onClick={() => exportKMZ(savedDrawings,route,measurePoints)} style={{padding:"7px 6px",borderRadius:7,cursor:"pointer",background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"#c4b5fd",fontSize:10.5,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <Ico name="Export" size={11}/>KMZ
        </button>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        html,body,#root{height:100%!important;width:100%!important;margin:0!important;padding:0!important;overflow:hidden!important;}
        :root{--menu-h:${MENU_H}px;--tb-h:${TB_H}px;--stat-h:${STAT_H}px;--sb-w:${SB_W}px;--top-h:${TOP_H}px;}
        .leaflet-tile-pane{z-index:2!important;}.leaflet-map-pane{z-index:1!important;}
        .leaflet-tile{visibility:visible!important;}
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes fadeSlideIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        ${GLOBAL_STYLES}
      `}</style>

      <div style={{position:"fixed",inset:0,background:"#060e1a",fontFamily:"'DM Sans',sans-serif"}}>

        <input ref={kmlInputRef}     type="file" accept=".kml"           onChange={handleKMLUpload}             style={{display:"none"}}/>
        <input ref={extraInputRef}   type="file" accept=".kmz,.csv"      onChange={handleExtraUpload}           style={{display:"none"}}/>
        <input ref={geojsonInputRef} type="file" accept=".geojson,.json" onChange={geoJSON.handleGeoJSONUpload} style={{display:"none"}}/>

        {/* ═══ DESKTOP SIDEBAR ═══════════════════════════════════════════ */}
        {!isMobile && (
          <div className="sm-sidebar" style={{position:"absolute",top:TOP_H,left:0,width:SB_W,bottom:STAT_H,zIndex:1100,background:"rgba(4,10,22,0.99)",borderRight:"1px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",overflowY:"auto",overflowX:"hidden"}}>
            <SectionHeader icon="Search" title="Search Location" collapsed={!searchOpen} onToggle={() => setSearchOpen(p=>!p)}/>
            {searchOpen&&(<div style={{padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)",flexShrink:0}}><form onSubmit={handleSidebarSearch} style={{display:"flex",gap:6,marginBottom:8}}><div style={{flex:1,position:"relative"}}><span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,0.3)",pointerEvents:"none",display:"flex"}}><Ico name="Search" size={13}/></span><input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Search location or lat, lng…" style={{width:"100%",padding:"8px 10px 8px 30px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.055)",color:"#c8dff0",fontSize:11.5,outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"}} onFocus={e=>e.target.style.borderColor="rgba(74,158,255,0.4)"} onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.1)"}/>  </div><button type="submit" disabled={searchLoading} style={{padding:"8px 12px",borderRadius:8,border:"1px solid rgba(74,158,255,0.4)",background:"rgba(74,158,255,0.18)",color:"#80c4ff",cursor:searchLoading?"not-allowed":"pointer",fontSize:13,fontWeight:700,flexShrink:0}}>{searchLoading?<span style={{animation:"blink 0.8s infinite"}}>…</span>:"↵"}</button></form>{locationInfo&&(<div style={{padding:"9px 11px",background:"rgba(74,158,255,0.09)",borderRadius:8,border:"1px solid rgba(74,158,255,0.22)",position:"relative"}}><div style={{color:"#90c8ff",fontSize:11.5,fontWeight:600,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:18}}>{locationInfo.loading?"Locating…":(locationInfo.name||"Unknown")}</div>{locationInfo.details&&<div style={{color:"rgba(255,255,255,0.32)",fontSize:10}}>{locationInfo.details}</div>}<button onClick={handleCloseLocationInfo} style={{position:"absolute",top:7,right:7,background:"none",border:"none",color:"rgba(255,255,255,0.32)",cursor:"pointer",display:"flex",padding:2}}><Ico name="Close" size={10}/></button></div>)}</div>)}
            <SectionHeader icon="Layers" title="Map Layers" collapsed={!layersOpen} onToggle={() => setLayersOpen(p=>!p)}/>
            {layersOpen&&(<div style={{flexShrink:0}}><div style={{padding:"5px 0",maxHeight:200,overflowY:"auto"}}><LayerItem iconName={nightSwitchInfo?.isNight?"Night":"Day"} label="Auto Night Mode" checked={nightModeAuto} onCheck={() => setNightModeAuto(p=>!p)} onClick={() => setNightModeAuto(p=>!p)} badge={nightModeAuto&&nightSwitchInfo?(nightSwitchInfo.isNight?"Night":"Day"):null}/><div style={{height:1,background:"rgba(255,255,255,0.05)",margin:"4px 12px"}}/>{Object.entries(MAP_LAYERS).map(([name,layer]) => (<LayerItem key={name} iconName={layer.icon} label={name} checked={activeLayer===name} onCheck={() => setActiveLayer(name)} onClick={() => setActiveLayer(name)} active={activeLayer===name} indent={1}/>))}</div></div>)}
            <SectionHeader icon="Star" title="My Places" collapsed={!placesOpen} onToggle={() => setPlacesOpen(p=>!p)}/>
            {placesOpen&&(<div style={{flexShrink:0}}><div style={{padding:"6px 0",maxHeight:130,overflowY:"auto"}}>{savedDrawings.map((d,i) => (<div key={i} style={{display:"flex",alignItems:"center"}}><div style={{flex:1,overflow:"hidden"}}><LayerItem iconName={d.type==="path"?"Path":d.type==="polygon"?"Polygon":"Pin"} label={d.name} indent={1}/></div><span onClick={() => setSavedDrawings(p=>p.filter((_,j)=>j!==i))} style={{color:"rgba(255,255,255,0.22)",cursor:"pointer",padding:"0 10px",display:"flex",flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.color="#f87171"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.22)"}><Ico name="Close" size={10}/></span></div>))}{savedDrawings.length===0&&<div style={{paddingLeft:24,color:"rgba(255,255,255,0.18)",fontSize:10.5,fontStyle:"italic",paddingTop:4}}>No saved drawings yet</div>}{surveyMode&&route.length>0&&<LayerItem iconName="Survey" label={`Survey Route · ${route.length} pts`} active badge="LIVE" indent={1}/>}{isTracking&&<LayerItem iconName="Record" label="Live Track Recording…" active badge="REC" indent={1}/>}</div></div>)}
            <SectionHeader icon="GeoJSON" title="GeoJSON Layers" collapsed={!geojsonOpen} onToggle={() => setGeojsonOpen(p=>!p)}/>
            {geojsonOpen&&(<div style={{flexShrink:0,borderBottom:"1px solid rgba(255,255,255,0.05)"}}><div style={{padding:"8px 12px 6px"}}><div style={{display:"flex",gap:5,marginBottom:8}}><label style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"7px 10px",borderRadius:8,cursor:"pointer",background:"rgba(20,184,166,0.12)",border:"1px solid rgba(20,184,166,0.3)",color:"#2dd4bf",fontSize:11.5,fontWeight:600}}><Ico name="Upload" size={12}/>Import<input type="file" accept=".geojson,.json" onChange={geoJSON.handleGeoJSONUpload} style={{display:"none"}}/></label><button onClick={() => geoJSON.handleExportGeoJSON({savedDrawings,route,measurePoints})} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"7px 10px",borderRadius:8,cursor:"pointer",background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",color:"#4ade80",fontSize:11.5,fontWeight:600}}><Ico name="Export" size={12}/>Export All</button></div><div style={{maxHeight:110,overflowY:"auto"}}>{geoJSON.importedGeoJSONLayers.length===0&&<div style={{color:"rgba(255,255,255,0.18)",fontSize:10.5,fontStyle:"italic",paddingLeft:4,paddingTop:2}}>No GeoJSON layers loaded</div>}{geoJSON.importedGeoJSONLayers.map(layer => (<div key={layer.id} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 4px 5px 6px",borderRadius:6,marginBottom:3,background:"rgba(20,184,166,0.07)",border:"1px solid rgba(20,184,166,0.15)"}}><Ico name="GeoJSON" size={12} style={{color:"#2dd4bf",flexShrink:0}}/><div style={{flex:1,minWidth:0}}><div style={{color:"#d0f0ec",fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{layer.name}</div><div style={{color:"rgba(45,212,191,0.5)",fontSize:9.5,fontFamily:"'DM Mono',monospace"}}>{layer.featureCount} feature{layer.featureCount!==1?"s":""}</div></div><button onClick={() => geoJSON.removeGeoJSONLayer(layer.id)} style={{background:"none",border:"none",color:"rgba(239,68,68,0.38)",cursor:"pointer",padding:3,display:"flex",flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.color="#f87171"} onMouseLeave={e=>e.currentTarget.style.color="rgba(239,68,68,0.38)"}><Ico name="Trash" size={11}/></button></div>))}</div></div></div>)}
            <SectionHeader icon="Eye" title="Tools" collapsed={!toolsOpen} onToggle={() => setToolsOpen(p=>!p)}/>
            {toolsOpen&&(<div style={{flex:1,overflowY:"auto"}}>
              <div style={{padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace"}}>Draw Tool</div>
                <div style={{display:"flex",gap:4,marginBottom:8}}>{[["path","Path","Path"],["polygon","Polygon","Poly"],["marker","Pin","Pin"]].map(([t,ico,lb]) => (<button key={t} onClick={() => setDrawType(t)} style={{flex:1,padding:"7px 4px",borderRadius:7,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:drawType===t?"rgba(74,158,255,0.16)":"rgba(255,255,255,0.035)",border:`1px solid ${drawType===t?"rgba(74,158,255,0.5)":"rgba(255,255,255,0.07)"}`,color:drawType===t?"#80c4ff":"rgba(255,255,255,0.45)",fontSize:10,fontWeight:600}}><Ico name={ico} size={15}/><span>{lb}</span></button>))}</div>
                {!drawMode?<PrimaryButton onClick={() => {setDrawMode(true);setDrawPoints([]);}} variant="amber"><Ico name="Play" size={13}/>Start Drawing</PrimaryButton>:<div style={{display:"flex",flexDirection:"column",gap:5}}><div style={{padding:"6px 10px",background:"rgba(251,191,36,0.09)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:7,color:"#fbbf24",fontSize:11,textAlign:"center",fontWeight:500}}>{drawType==="marker"?"Click map to place marker":`${drawPoints.length} pts — click to add`}</div><div style={{display:"flex",gap:5}}><PrimaryButton onClick={finishDrawing} variant="green" style={{flex:1}}><Ico name="Check" size={12}/>Done</PrimaryButton><PrimaryButton onClick={cancelDrawing} variant="red" style={{flex:1}}><Ico name="Close" size={12}/>Cancel</PrimaryButton></div></div>}
              </div>
              <div style={{padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace"}}>Measure Tool</div>
                {!measureMode?<PrimaryButton onClick={() => setMeasureMode(true)} variant="blue"><Ico name="Measure" size={13}/>Start Measuring</PrimaryButton>:<div style={{display:"flex",flexDirection:"column",gap:5}}><div style={{padding:"10px 12px",background:"rgba(251,191,36,0.07)",border:"1px solid rgba(251,191,36,0.22)",borderRadius:8,textAlign:"center"}}><div style={{color:"rgba(251,191,36,0.48)",fontSize:9,fontWeight:700,letterSpacing:"0.1em",marginBottom:2,fontFamily:"'DM Mono',monospace"}}>TOTAL DISTANCE</div><div style={{color:"#fbbf24",fontSize:22,fontWeight:700,fontFamily:"'DM Mono',monospace",lineHeight:1}}>{measurePoints.length<2?"—":formatDist(totalDistance,measureUnit)}</div><div style={{color:"rgba(251,191,36,0.36)",fontSize:9.5,marginTop:2}}>{measurePoints.length} points</div></div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3}}>{[["m","m"],["km","km"],["mi","mi"],["ft","ft"],["yd","yd"],["nmi","nmi"],["cm","cm"],["auto","Auto"]].map(([u,lb]) => (<button key={u} onClick={() => setMeasureUnit(u)} style={{padding:"5px 2px",borderRadius:5,cursor:"pointer",fontSize:9.5,fontWeight:600,background:measureUnit===u?"rgba(74,158,255,0.18)":"rgba(255,255,255,0.035)",border:`1px solid ${measureUnit===u?"rgba(74,158,255,0.42)":"rgba(255,255,255,0.07)"}`,color:measureUnit===u?"#80c4ff":"rgba(255,255,255,0.42)",fontFamily:"'DM Mono',monospace"}}>{lb}</button>))}</div><div style={{display:"flex",gap:4}}><button onClick={() => {setMeasurePoints([]);measureLayersRef.current.forEach(l=>l.remove());measureLayersRef.current=[];if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}}} style={{flex:1,padding:"6px",borderRadius:7,border:"1px solid rgba(255,255,255,0.07)",background:"rgba(255,255,255,0.035)",color:"rgba(255,255,255,0.38)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}><Ico name="Reset" size={11}/>Reset</button><PrimaryButton onClick={clearMeasure} variant="red" style={{flex:1,padding:"6px"}}><Ico name="Stop" size={11}/>Done</PrimaryButton></div></div>}
              </div>
              {/* ✅ Export panel appears when data exists */}
              <ExportPanel/>
              <div style={{padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}><div style={{color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace"}}>Compass Navigation</div><div style={{padding:"8px 10px",background:"rgba(14,165,233,0.06)",borderRadius:8,border:"1px solid rgba(14,165,233,0.15)",marginBottom:8,fontSize:10,color:"rgba(56,189,248,0.55)",lineHeight:1.5}}>AlpineQuest-style: map stays north-up, needle rotates with device heading</div><PrimaryButton onClick={() => compass.compassNavActive?compass.stopCompassNav():compass.startCompassNav()} variant={compass.compassNavActive?"red":"cyan"}><Ico name="Navigation" size={13} style={{animation:compass.compassNavActive?"spin 3s linear infinite":"none"}}/>{compass.compassNavActive?"Stop Compass Nav":"Start Compass Nav"}</PrimaryButton></div>
              <div style={{padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}><div style={{color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace"}}>Survey Route</div><PrimaryButton onClick={handleToggleSurvey} variant={surveyMode?"red":"blue"}><Ico name={surveyMode?"Stop":"Record"} size={13}/>{surveyMode?"Stop Survey":"Start Survey"}</PrimaryButton>{surveyMode&&<div style={{marginTop:6,padding:"6px 10px",background:"rgba(248,113,113,0.09)",border:"1px solid rgba(248,113,113,0.22)",borderRadius:7,color:"#f87171",fontSize:11,textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><span style={{animation:"blink 1s infinite"}}>●</span>RECORDING · {route.length} pts</div>}</div>
              <div style={{padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}><div style={{color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace"}}>More Tools</div><div style={{display:"flex",flexDirection:"column",gap:5}}><PrimaryButton onClick={() => setTrackerOpen(true)} variant="rose"><Ico name="Record" size={13}/>{isTracking?"Open Recorder":"Live Track Recorder"}</PrimaryButton><PrimaryButton onClick={() => {setElevOpen(true);handleElevModeRequest(elevMode||"survey");}} variant="blue"><Ico name="Mountain" size={13}/>Elevation Profile</PrimaryButton><PrimaryButton onClick={() => setOfflineOpen(true)} variant="blue"><Ico name="Offline" size={13}/>Manage Offline Maps</PrimaryButton><PrimaryButton onClick={() => setOfflineMode(p=>!p)} variant={offlineMode?"green":"blue"}><span style={{fontSize:13}}>{offlineMode?"🗺":"🌐"}</span>{offlineMode?"Go Live":"Use Cached Map"}</PrimaryButton></div></div>
              <div style={{padding:"14px 12px 16px"}}><button onClick={() => setShow3D(true)} style={{width:"100%",padding:"11px 14px",borderRadius:10,cursor:"pointer",background:"linear-gradient(135deg,rgba(167,139,250,0.18),rgba(109,40,217,0.18))",border:"1px solid rgba(167,139,250,0.32)",color:"#c4b5fd",fontWeight:600,fontSize:12.5,fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Ico name="Globe" size={18}/> Switch to 3D Globe</button></div>
            </div>)}
          </div>
        )}

        {/* ═══ DESKTOP MENU BAR ══════════════════════════════════════════ */}
        {!isMobile&&(<div style={{position:"absolute",top:0,left:0,right:0,height:MENU_H,zIndex:1200,background:"rgba(5,12,24,0.97)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,0.055)",display:"flex",alignItems:"center",paddingLeft:12,gap:0}}><div style={{display:"flex",alignItems:"center",gap:8,marginRight:16,paddingRight:16,borderRight:"1px solid rgba(255,255,255,0.07)"}}><div style={{width:20,height:20,borderRadius:5,background:"linear-gradient(135deg,#4a9eff,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center"}}><Ico name="Compass" size={12} style={{color:"#fff"}}/></div><span style={{fontSize:12,fontWeight:700,color:"#c8e0f8",letterSpacing:"0.02em"}}>SurveyMap Pro</span></div>{Object.keys(MENU_DEFS).map(menuName => {const isOpen=openMenu===menuName;return(<div key={menuName} style={{position:"relative",height:"100%",display:"flex",alignItems:"center"}}><span onClick={() => setOpenMenu(isOpen?null:menuName)} onMouseEnter={() => {if(openMenu&&openMenu!==menuName) setOpenMenu(menuName);}} style={{fontSize:12,color:isOpen?"#80c4ff":"rgba(241,237,235,0.9)",padding:"0 12px",cursor:"pointer",userSelect:"none",height:"100%",display:"flex",alignItems:"center",background:isOpen?"rgba(74,158,255,0.15)":"transparent",fontWeight:isOpen?500:400}}>{menuName}</span>{isOpen&&(<div style={{position:"absolute",top:MENU_H,left:0,background:"rgba(5,12,24,0.98)",backdropFilter:"blur(24px)",border:"1px solid rgba(255,255,255,0.1)",borderTop:"1.5px solid rgba(74,158,255,0.5)",borderRadius:"0 0 10px 10px",minWidth:210,boxShadow:"0 12px 40px rgba(0,0,0,0.6)",zIndex:1300,overflow:"hidden"}}>{MENU_DEFS[menuName].map((item,idx) => item.divider?<div key={idx} style={{height:1,background:"rgba(255,255,255,0.06)",margin:"3px 0"}}/>:<div key={idx} className="menu-item" onClick={() => handleMenuAction(item.action)}><Ico name={item.icon} size={13}/>{item.label}</div>)}</div>)}</div>);})}{openMenu&&<div style={{position:"fixed",inset:0,zIndex:1290}} onClick={() => setOpenMenu(null)}/>}<div style={{flex:1}}/>{compass.compassNavActive&&(<div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",background:"rgba(14,165,233,0.14)",borderRadius:16,border:"1px solid rgba(14,165,233,0.4)",marginRight:8,cursor:"pointer"}} onClick={compass.stopCompassNav}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" style={{animation:"spin 3s linear infinite"}}><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#38bdf8" stroke="none"/></svg><span style={{fontSize:10,color:"#38bdf8",fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{compass.compassHeading!=null?`${Math.round(((compass.compassHeading%360)+360)%360)}°`:"NAV"}</span></div>)}{isTracking&&(<div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",background:"rgba(239,68,68,0.14)",borderRadius:16,border:"1px solid rgba(239,68,68,0.35)",marginRight:8,cursor:"pointer"}} onClick={() => setTrackerOpen(true)}><div style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",animation:"blink 1s infinite"}}/><span style={{fontSize:10,color:"#f87171",fontWeight:700,fontFamily:"'DM Mono',monospace"}}>REC</span></div>)}<button style={{display:"flex",alignItems:"center",gap:6,padding:"4px 12px",borderRadius:6,border:"1px solid rgba(74,158,255,0.3)",background:"rgba(74,158,255,0.12)",color:"#80c4ff",cursor:"pointer",fontSize:11,fontWeight:600,marginRight:10}}><Ico name="User" size={12}/> Sign In</button></div>)}

        {/* ═══ DESKTOP TOOLBAR ══════════════════════════════════════════
            ✅ KML / CSV / KMZ export buttons shown when data exists
        ═══════════════════════════════════════════════════════════════ */}
        {!isMobile&&(<div style={{position:"absolute",top:MENU_H,left:0,right:0,height:TB_H,zIndex:1150,background:"rgba(5,12,24,0.90)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,0.09)",display:"flex",alignItems:"center",padding:"0 10px",gap:5,overflowX:"auto"}}>
          {[{key:"Satellite",icon:"Satellite",short:"Satellite"},{key:"Street",icon:"Street",short:"Street"},{key:"Terrain",icon:"Terrain",short:"Terrain"},{key:"Satellite + Labels",icon:"SatLabels",short:"+Labels"},{key:"Dark",icon:"Dark",short:"Dark"},{key:"Light",icon:"Light",short:"Light"}].map(({key,icon,short}) => <button key={key} className={`tb-btn ${activeLayer===key?"active":"inactive"}`} onClick={() => setActiveLayer(key)}><Ico name={icon} size={14}/><span>{short}</span></button>)}
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.08)",margin:"0 3px",flexShrink:0}}/>
          <button className={`tb-btn ${drawMode?"active":"inactive"}`} onClick={() => {setDrawMode(m=>!m);if(!drawMode) setDrawPoints([]);}}><Ico name="Draw" size={14}/><span>Draw</span></button>
          <button className={`tb-btn ${measureMode?"active":"inactive"}`} onClick={() => setMeasureMode(m=>!m)}><Ico name="Measure" size={14}/><span>Measure</span></button>
          <button className={`tb-btn ${surveyMode?"active":"inactive"}`} onClick={handleToggleSurvey}><Ico name="Survey" size={14}/><span>Survey</span></button>
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.08)",margin:"0 3px",flexShrink:0}}/>
          <button className={`tb-btn ${isTracking?"tracker-active":"inactive"}`} onClick={() => setTrackerOpen(p=>!p)} style={{position:"relative",minWidth:58}}><Ico name="Record" size={14}/><span>Track</span>{isTracking&&<span style={{position:"absolute",top:4,right:4,width:6,height:6,borderRadius:"50%",background:"#ef4444",animation:"blink 1s infinite"}}/>}</button>
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.08)",margin:"0 3px",flexShrink:0}}/>
          <label className={`tb-btn ${geoJSON.importedGeoJSONLayers.length?"geojson-active":"inactive"}`} style={{cursor:"pointer"}}><Ico name="GeoJSON" size={14}/><span>GeoJSON</span><input type="file" accept=".geojson,.json" onChange={geoJSON.handleGeoJSONUpload} style={{display:"none"}}/></label>
          {/* ── GeoJSON export (always) ── */}
          <button className="tb-btn inactive" onClick={() => geoJSON.handleExportGeoJSON({savedDrawings,route,measurePoints})} style={{background:"rgba(34,197,94,0.12)",borderColor:"rgba(34,197,94,0.3)",color:"#4ade80"}}><Ico name="Export" size={14}/><span>Export GeoJSON</span></button>
          {/* ── KML / CSV / KMZ export (shown when data exists) ── */}
          {hasExportData&&(<>
            <button className="tb-btn inactive" onClick={() => exportKML(savedDrawings,route,measurePoints)} style={{background:"rgba(251,191,36,0.12)",borderColor:"rgba(251,191,36,0.3)",color:"#fbbf24"}}><Ico name="Export" size={14}/><span>Export KML</span></button>
            <button className="tb-btn inactive" onClick={() => exportCSV(savedDrawings,route,measurePoints)} style={{background:"rgba(56,189,248,0.12)",borderColor:"rgba(56,189,248,0.3)",color:"#38bdf8"}}><Ico name="Export" size={14}/><span>Export CSV</span></button>
            <button className="tb-btn inactive" onClick={() => exportKMZ(savedDrawings,route,measurePoints)} style={{background:"rgba(167,139,250,0.12)",borderColor:"rgba(167,139,250,0.3)",color:"#c4b5fd"}}><Ico name="Export" size={14}/><span>Export KMZ</span></button>
          </>)}
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.08)",margin:"0 3px",flexShrink:0}}/>
          <button className={`tb-btn ${!isOnline?"tracker-active":"inactive"}`} onClick={() => setOfflineOpen(p=>!p)}><Ico name="Offline" size={14}/><span>Offline</span></button>
          <button className={`tb-btn ${offlineMode?"offline-active":"inactive"}`} onClick={() => setOfflineMode(p=>!p)}><span style={{fontSize:13}}>{offlineMode?"🗺":"🌐"}</span><span>{offlineMode?"Cached":"Cache"}</span></button>
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.08)",margin:"0 3px",flexShrink:0}}/>
          <button className={`tb-btn ${elevOpen?"active":"inactive"}`} onClick={() => {setElevOpen(p=>!p);if(!elevOpen&&!elevMode) setElevMode("survey");}}><Ico name="Mountain" size={14}/><span>Elevation</span></button>
          <button className={`tb-btn ${compass.compassNavActive?"compass-active":"inactive"}`} onClick={() => compass.compassNavActive?compass.stopCompassNav():compass.startCompassNav()} style={{position:"relative",minWidth:84}}><Ico name="Navigation" size={14} style={{animation:compass.compassNavActive?"spin 4s linear infinite":"none"}}/><span>Compass</span>{compass.compassNavActive&&<span style={{position:"absolute",top:4,right:4,width:6,height:6,borderRadius:"50%",background:"#0ea5e9",animation:"blink 0.8s infinite"}}/>}</button>
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.08)",margin:"0 3px",flexShrink:0}}/>
          <label className="tb-btn inactive" style={{cursor:"pointer"}}><Ico name="Upload" size={14}/><span>KML</span><input type="file" accept=".kml" onChange={handleKMLUpload} style={{display:"none"}}/></label>
          <label className="tb-btn inactive" style={{cursor:"pointer"}}><Ico name="CSV" size={14}/><span>CSV/KMZ</span><input type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{display:"none"}}/></label>
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.08)",margin:"0 3px",flexShrink:0}}/>
          <button className="tb-btn" onClick={() => setShow3D(true)} style={{background:"rgba(167,139,250,0.15)",borderColor:"rgba(167,139,250,0.4)",color:"#c4b5fd"}}><Ico name="Globe" size={14}/><span>3D</span></button>
          <button className={`tb-btn ${nightModeAuto?"active":"inactive"}`} onClick={() => setNightModeAuto(p=>!p)}><Ico name={nightSwitchInfo?.isNight?"Night":"Day"} size={14}/><span>Night</span></button>
          <div style={{flex:1}}/>
          {geoJSON.geojsonLoading&&<span style={{fontSize:11,color:"#2dd4bf",background:"rgba(20,184,166,0.12)",padding:"4px 10px",borderRadius:16,border:"1px solid rgba(20,184,166,0.25)",display:"flex",alignItems:"center",gap:5}}><span style={{animation:"blink 1s infinite"}}>●</span>Loading GeoJSON…</span>}
          {kmlLoading&&<span style={{fontSize:11,color:"#60a0e8",background:"rgba(74,158,255,0.12)",padding:"4px 10px",borderRadius:16,border:"1px solid rgba(74,158,255,0.25)",display:"flex",alignItems:"center",gap:5}}><span style={{animation:"blink 1s infinite"}}>●</span>{kmlName?.slice(0,18)}…</span>}
        </div>)}

        {/* Mobile chrome */}
        {isMobile&&<div style={{position:"absolute",top:0,left:0,right:0,zIndex:1200}}><MobileSearchBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} onSearch={handleSidebarSearch} searchLoading={searchLoading}/></div>}
        {isMobile&&<div style={{position:"absolute",top:58,left:0,right:0,zIndex:1100,pointerEvents:"none"}}><CompactMobileHUD mousePos={mousePos} mapZoom={mapZoom} compassHeading={compass.compassHeading} compassNavActive={compass.compassNavActive} cursorElevation={cursorElevation}/></div>}
        {isMobile&&cacheStats?.tileCount>0&&(<div onClick={() => setOfflineMode(p=>!p)} style={{position:"absolute",top:160,left:12,zIndex:1310,display:"flex",alignItems:"center",gap:6,padding:"5px 12px 5px 8px",background:offlineMode?"rgba(4,10,20,0.95)":"rgba(4,10,20,0.80)",backdropFilter:"blur(16px)",border:`1.5px solid ${offlineMode?"rgba(34,197,94,0.6)":"rgba(255,255,255,0.12)"}`,borderRadius:20,boxShadow:offlineMode?"0 2px 16px rgba(34,197,94,0.25)":"0 2px 12px rgba(0,0,0,0.4)",cursor:"pointer",userSelect:"none",transition:"all 0.2s"}}><div style={{width:8,height:8,borderRadius:"50%",background:offlineMode?"#22c55e":"#94a3b8",boxShadow:offlineMode?"0 0 6px #22c55e":"none",flexShrink:0}}/><span style={{fontSize:11,fontWeight:700,color:offlineMode?"#4ade80":"rgba(200,220,255,0.55)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.04em"}}>{offlineMode?`📴 CACHED · ${cacheStats.tileCount.toLocaleString()} tiles`:`🌐 LIVE · ${cacheStats.tileCount.toLocaleString()} tiles saved`}</span></div>)}
        {isMobile&&<div style={{position:"absolute",bottom:76,right:12,zIndex:1320}}><MobileCompassWidget compassNavActive={compass.compassNavActive} compassHeading={compass.compassHeading} onCompassToggle={() => compass.compassNavActive?compass.stopCompassNav():compass.startCompassNav()} leafletMapRef={leafletMapRef}/></div>}

        {/* ═══ MAP ═══════════════════════════════════════════════════════ */}
        <div style={{position:"absolute",top:mapTop,left:mapLeft,right:0,bottom:mapBottom,zIndex:1}}>
          <MapContainer center={[20.29,85.82]} zoom={13} maxZoom={22} zoomControl={false} style={{width:"100%",height:"100%"}} whenReady={() => {setTimeout(() => {try{leafletMapRef.current?.invalidateSize?.();}catch(_){}},200);}}>
            {cfg.type==="wms"?<WMSTileLayer key={activeLayer} url={cfg.url} layers={cfg.layers} format={cfg.format||"image/png"} transparent={cfg.transparent??true} attribution={cfg.attribution} crossOrigin="anonymous"/>:offlineMode?<><OfflineTileLayer key={activeLayer} layerKey={activeLayer} url={cfg.url} attribution={cfg.attribution} offlineOnly={offlineMode} maxZoom={22} maxNativeZoom={baseMaxNative}/>{cfg.overlayUrl&&<OfflineTileLayer key={activeLayer+"_overlay"} layerKey={activeLayer+"_overlay"} url={cfg.overlayUrl} offlineOnly={offlineMode} maxZoom={22} maxNativeZoom={overlayMaxNative} opacity={cfg.overlayOpacity??(activeLayer==="Contour"?0.75:0.85)}/>}</>:<><TileLayer key={activeLayer} url={cfg.url||"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"} attribution={cfg.attribution||"© OpenStreetMap contributors"} maxZoom={22} maxNativeZoom={baseMaxNative} crossOrigin="anonymous" updateWhenZooming={false} keepBuffer={4}/>{cfg.overlayUrl&&<TileLayer key={activeLayer+"_overlay"} url={cfg.overlayUrl} maxZoom={22} maxNativeZoom={overlayMaxNative} opacity={cfg.overlayOpacity??(activeLayer==="Contour"?0.75:0.85)} crossOrigin="anonymous" updateWhenZooming={false} keepBuffer={4}/>}</>}
            <MapSizeInvalidator/><MapRefCapture leafletMapRef={leafletMapRef} setMapRef={setMapRefForTracker}/><ElevationClickCapture elevOpen={elevOpen} activeSheet={activeSheet} elevMode={elevMode} onMapClick={handleMapClickForElev}/><MapFlyController flyTarget={flyTarget}/><AddSearch onLocationFound={handleLocationFound} searchRef={searchFnRef}/><LiveGPS/><KMLLoader file={kmlFile} onDone={() => setKmlLoading(false)}/>{extraFileType==="kmz"&&<KMZLoader file={extraFile} onDone={() => {}}/>}{extraFileType==="csv"&&<CSVLoader file={extraFile} onDone={() => {}}/>}<SurveyClick surveyMode={surveyMode} route={route} setRoute={setRoute} setStart={() => {}} setEnd={() => {}} polylineRef={polylineRef}/><DrawTool drawMode={drawMode} drawType={drawType} drawPoints={drawPoints} setDrawPoints={setDrawPoints} previewLayerRef={previewLayerRef} drawLayersRef={drawLayersRef}/><BoundaryLayer geojson={boundaryGeojson}/><MapTracker onMove={onMouseMove} onZoom={onZoomChange}/>
            <MeasureTool measureMode={measureMode} measurePoints={measurePoints} setMeasurePoints={setMeasurePoints} measureLayersRef={measureLayersRef} measureLineRef={measureLineRef} measureUnit={measureUnit} setMeasureUnit={setMeasureUnit} onFinish={clearMeasure}/>
            {!isMobile&&(<div style={{position:"absolute",top:10,right:10,zIndex:1000,pointerEvents:"all"}}><ProfessionalCompassControl onBearingChange={setMapBearing} compassNavActive={compass.compassNavActive} compassHeading={compass.compassHeading} onCompassToggle={() => compass.compassNavActive?compass.stopCompassNav():compass.startCompassNav()}/></div>)}
          </MapContainer>
        </div>

        {/* Mobile bottom nav */}
        {isMobile&&(<div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:1200}}><MobileBottomNav activeSheet={activeSheet} onOpen={(key) => {if(key==="draw"){if(activeSheet==="draw"){setActiveSheet(null);return;}setDrawMode(true);setDrawPoints([]);setActiveSheet("draw");return;}if(key==="measure"){if(activeSheet==="measure"){clearMeasure();setActiveSheet(null);return;}setMeasureMode(true);setActiveSheet("measure");return;}setActiveSheet(activeSheet===key?null:key);}} onCompassToggle={() => compass.compassNavActive?compass.stopCompassNav():compass.startCompassNav()} compassNavActive={compass.compassNavActive} drawMode={drawMode} measureMode={measureMode} surveyMode={surveyMode} isTracking={isTracking} kmlName={kmlName} extraFile={extraFile} importedGeoJSONLayers={geoJSON.importedGeoJSONLayers}/></div>)}

        {/* ═══ MOBILE BOTTOM SHEETS ══════════════════════════════════════ */}
        <MobileBottomSheet activeSheet={activeSheet} onClose={() => setActiveSheet(null)}>

          {activeSheet==="layers"&&(<div style={{paddingBottom:28}}><SheetHeader title="Map Layers" sub="Choose basemap" onClose={() => setActiveSheet(null)} iconColor="#3b82f6" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>}/><SheetDivider/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:"4px 16px"}}>{Object.entries(MAP_LAYERS).map(([name,layer]) => {const on=activeLayer===name;return<button key={name} onClick={() => {setActiveLayer(name);setActiveSheet(null);}} style={{padding:"13px 12px",borderRadius:14,cursor:"pointer",background:on?"rgba(59,130,246,0.16)":"rgba(255,255,255,0.035)",border:`1.5px solid ${on?"rgba(59,130,246,0.5)":"rgba(255,255,255,0.07)"}`,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:7,textAlign:"left"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%"}}><Ico name={layer.icon} size={20} style={{color:on?"#60a5fa":"rgba(180,210,250,0.35)"}}/>{on&&<div style={{width:7,height:7,borderRadius:"50%",background:"#3b82f6",boxShadow:"0 0 8px #3b82f6"}}/>}</div><div style={{fontSize:12,fontWeight:on?700:400,color:on?"#bfdbfe":"rgba(190,215,250,0.5)",lineHeight:1.3}}>{name}</div></button>;})}</div></div>)}

          {activeSheet==="draw"&&(<div style={{padding:"0 16px 28px"}}><SheetHeader title="Draw Tool" sub={drawMode?`${drawPoints.length} pts · tap map`:"Choose type and start"} onClose={() => setActiveSheet(null)} iconColor="#f59e0b" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}/><SheetDivider/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,margin:"12px 0"}}>{[["path","Path","M3 17c3-3 5-5 5-9a4 4 0 018 0c0 4 2 6 5 9"],["polygon","Polygon","M12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"],["marker","Marker","M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0zM12 10m-2 0a2 2 0 104 0 2 2 0 00-4 0"]].map(([t,label,path]) => {const on=drawType===t;return(<button key={t} onClick={() => setDrawType(t)} style={{padding:"14px 8px",borderRadius:14,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:7,background:on?"rgba(245,158,11,0.14)":"rgba(255,255,255,0.035)",border:`1.5px solid ${on?"rgba(245,158,11,0.45)":"rgba(255,255,255,0.07)"}`,color:on?"#fbbf24":"rgba(180,210,250,0.35)"}}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={path}/></svg><span style={{fontSize:12,fontWeight:on?700:400}}>{label}</span></button>);})}</div>
            {!drawMode?(<button onClick={() => {setDrawMode(true);setDrawPoints([]);}} style={{width:"100%",padding:"15px 0",borderRadius:14,cursor:"pointer",background:"linear-gradient(135deg,rgba(245,158,11,0.9),rgba(217,119,6,0.85))",border:"1px solid rgba(245,158,11,0.6)",color:"#fff",fontWeight:800,fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 4px 20px rgba(245,158,11,0.35)",fontFamily:"'DM Sans',sans-serif"}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>Start Drawing</button>):(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{padding:"12px 16px",background:"rgba(245,158,11,0.08)",borderRadius:12,border:"1px solid rgba(245,158,11,0.2)",color:"#fbbf24",fontSize:13,textAlign:"center",fontWeight:600}}>{drawType==="marker"?"Tap map to place marker":`${drawPoints.length} pts · tap map to add more`}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <button onClick={() => {finishDrawing();}} style={{padding:"14px 0",borderRadius:12,cursor:"pointer",background:"rgba(34,197,94,0.16)",border:"1px solid rgba(34,197,94,0.45)",color:"#4ade80",fontWeight:700,fontSize:14,fontFamily:"'DM Sans',sans-serif"}}>✓ Done</button>
                  <button onClick={() => {cancelDrawing();setActiveSheet(null);}} style={{padding:"14px 0",borderRadius:12,cursor:"pointer",background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.4)",color:"#f87171",fontWeight:700,fontSize:14,fontFamily:"'DM Sans',sans-serif"}}>✕ Cancel</button>
                </div>
              </div>
            )}
            {savedDrawings.length>0&&(<div style={{marginTop:20}}><div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.2)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Saved ({savedDrawings.length})</div>{savedDrawings.map((d,i) => (<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:"rgba(255,255,255,0.028)",borderRadius:12,border:"1px solid rgba(255,255,255,0.055)",marginBottom:6}}><span style={{fontSize:18}}>{d.type==="marker"?"📌":d.type==="polygon"?"⬡":"〰"}</span><span style={{color:"rgba(200,225,255,0.7)",fontSize:13,flex:1}}>{d.name}</span><button onClick={() => setSavedDrawings(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"rgba(239,68,68,0.5)",cursor:"pointer",fontSize:18,padding:0}}>×</button></div>))}</div>)}
            {/* ✅ Mobile export buttons inside draw sheet when data exists */}
            {hasExportData&&(<div style={{marginTop:16}}>
              <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.2)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Export As</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <button onClick={() => geoJSON.handleExportGeoJSON({savedDrawings,route,measurePoints})} style={{padding:"12px 0",borderRadius:12,cursor:"pointer",background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",color:"#4ade80",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>📄 GeoJSON</button>
                <button onClick={() => exportKML(savedDrawings,route,measurePoints)} style={{padding:"12px 0",borderRadius:12,cursor:"pointer",background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.3)",color:"#fbbf24",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>📍 KML</button>
                <button onClick={() => exportCSV(savedDrawings,route,measurePoints)} style={{padding:"12px 0",borderRadius:12,cursor:"pointer",background:"rgba(56,189,248,0.12)",border:"1px solid rgba(56,189,248,0.3)",color:"#38bdf8",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>📊 CSV</button>
                <button onClick={() => exportKMZ(savedDrawings,route,measurePoints)} style={{padding:"12px 0",borderRadius:12,cursor:"pointer",background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"#c4b5fd",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>🗜 KMZ</button>
              </div>
            </div>)}
          </div>)}

          {activeSheet==="measure"&&(<div style={{padding:"0 16px 28px"}}><SheetHeader title="Measure" sub={measureMode?`${measurePoints.length} pts · tap map`:"Tap points to measure distance"} onClose={() => setActiveSheet(null)} iconColor="#10b981" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 6H3a1 1 0 00-1 1v3a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zM7 10v4M12 10v6M17 10v4"/></svg>}/><SheetDivider/><div style={{padding:"24px 20px",background:"rgba(16,185,129,0.07)",borderRadius:16,border:"1px solid rgba(16,185,129,0.18)",textAlign:"center",margin:"14px 0"}}><div style={{fontSize:9,fontWeight:800,color:"rgba(52,211,153,0.4)",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6,fontFamily:"'DM Mono',monospace"}}>TOTAL DISTANCE</div><div style={{fontSize:48,fontWeight:800,color:"#34d399",fontFamily:"'DM Mono',monospace",lineHeight:1}}>{measurePoints.length<2?"—":formatDist(totalDistance,measureUnit)}</div><div style={{fontSize:11,color:"rgba(52,211,153,0.32)",marginTop:6}}>{measurePoints.length} points recorded</div></div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:14}}>{[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"],["yd","yd"],["nmi","nmi"],["cm","cm"]].map(([u,lb]) => (<button key={u} onClick={() => setMeasureUnit(u)} style={{padding:"9px 4px",borderRadius:10,cursor:"pointer",fontSize:12,fontWeight:600,background:measureUnit===u?"rgba(16,185,129,0.16)":"rgba(255,255,255,0.035)",border:`1px solid ${measureUnit===u?"rgba(16,185,129,0.38)":"rgba(255,255,255,0.07)"}`,color:measureUnit===u?"#34d399":"rgba(185,215,245,0.38)",fontFamily:"'DM Mono',monospace"}}>{lb}</button>))}</div>{!measureMode?(<button onClick={() => setMeasureMode(true)} style={{width:"100%",padding:"15px 0",borderRadius:14,cursor:"pointer",background:"linear-gradient(135deg,rgba(16,185,129,0.9),rgba(5,150,105,0.85))",border:"1px solid rgba(16,185,129,0.6)",color:"#fff",fontWeight:800,fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 4px 20px rgba(16,185,129,0.3)",fontFamily:"'DM Sans',sans-serif"}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 6H3a1 1 0 00-1 1v3a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zM7 10v4M12 10v6M17 10v4"/></svg>Start Measuring</button>):(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><button onClick={() => {setMeasurePoints([]);measureLayersRef.current.forEach(l=>l.remove());measureLayersRef.current=[];if(measureLineRef.current){measureLineRef.current.remove();measureLineRef.current=null;}}} style={{padding:"14px 0",borderRadius:12,cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(190,215,250,0.55)",fontWeight:700,fontSize:14,fontFamily:"'DM Sans',sans-serif"}}>↺ Reset</button><button onClick={() => {clearMeasure();setActiveSheet(null);}} style={{padding:"14px 0",borderRadius:12,cursor:"pointer",background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.4)",color:"#f87171",fontWeight:700,fontSize:14,fontFamily:"'DM Sans',sans-serif"}}>⏹ Stop</button></div>)}</div>)}

          {activeSheet==="files"&&(<MobileFileFolder kmlInputRef={kmlInputRef} extraInputRef={extraInputRef} geojsonInputRef={geojsonInputRef} kmlName={kmlName} kmlLoading={kmlLoading} onKMLUpload={handleKMLUpload} onRemoveKML={() => {setKmlFile(null);setKmlName(null);setKmlLoading(false);setFileVisibility(p => {const n={...p};delete n.__kml__;return n;});}} extraFile={extraFile} extraFileType={extraFileType} onExtraUpload={handleExtraUpload} onRemoveExtra={() => {setExtraFile(null);setExtraFileType(null);setFileVisibility(p => {const n={...p};delete n.__kmz__;delete n.__csv__;return n;});}} importedGeoJSONLayers={geoJSON.importedGeoJSONLayers} onRemoveGeoJSON={geoJSON.removeGeoJSONLayer} onGeoJSONUpload={geoJSON.handleGeoJSONUpload} onExportGeoJSON={() => geoJSON.handleExportGeoJSON({savedDrawings,route,measurePoints})} fileVisibility={fileVisibility} onToggleVisibility={(id) => setFileVisibility(p => ({...p,[id]:!p[id]}))} onClose={() => setActiveSheet(null)}/>)}

          {activeSheet==="elevation"&&(<div style={{paddingBottom:28}}><SheetHeader title="Elevation Profile" sub={elevSourceLabel||"Terrain elevation chart"} onClose={() => setActiveSheet(null)} iconColor="#38bdf8" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 17l4-8 4 4 4-6 4 10"/><line x1="3" y1="17" x2="21" y2="17"/></svg>}/><SheetDivider/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,padding:"12px 16px 8px"}}>{[["survey","Survey",route.length>=2],["measure","Measure",measurePoints.length>=2],["draw","Draw",drawPoints.length>=2],["custom","Custom",true]].map(([mode,label,available]) => {const on=elevMode===mode;return(<button key={mode} onClick={() => available&&handleElevModeRequest(mode)} style={{padding:"9px 4px",borderRadius:10,cursor:available?"pointer":"not-allowed",fontSize:11,fontWeight:on?700:500,background:on?"rgba(56,189,248,0.16)":"rgba(255,255,255,0.035)",border:`1.5px solid ${on?"rgba(56,189,248,0.45)":"rgba(255,255,255,0.07)"}`,color:on?"#38bdf8":available?"rgba(185,215,245,0.5)":"rgba(185,215,245,0.2)",fontFamily:"'DM Sans',sans-serif"}}>{label}</button>);})}</div>{elevMode==="custom"&&(<div style={{margin:"0 16px 8px",padding:"9px 12px",borderRadius:10,background:"rgba(56,189,248,0.07)",border:"1px solid rgba(56,189,248,0.18)",color:"#7dd3fc",fontSize:11,textAlign:"center"}}>Tap points on the map to build elevation profile</div>)}{elevLoading&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"24px 0",color:"rgba(56,189,248,0.6)",fontSize:12}}><span style={{animation:"blink 0.8s infinite"}}>●</span> Loading elevation data…</div>)}{!elevLoading&&elevProfileData.length>=2&&(<div style={{padding:"0 16px 8px"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>{(()=>{const elevs=elevProfileData.map(p=>p.elevation).filter(e=>e!=null);const min=Math.round(Math.min(...elevs)),max=Math.round(Math.max(...elevs));const gain=elevProfileData.reduce((acc,p,i)=>{if(i===0)return 0;const d=(p.elevation??0)-(elevProfileData[i-1].elevation??0);return acc+(d>0?d:0);},0);return[["Min",`${min} m`,"#34d399"],["Max",`${max} m`,"#f87171"],["Gain",`+${Math.round(gain)} m`,"#38bdf8"]].map(([label,val,color]) => (<div key={label} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"8px 10px",textAlign:"center"}}><div style={{fontSize:8.5,fontWeight:700,letterSpacing:"0.09em",color:"rgba(255,255,255,0.2)",textTransform:"uppercase",fontFamily:"'DM Mono',monospace",marginBottom:3}}>{label}</div><div style={{fontSize:16,fontWeight:800,color,fontFamily:"'DM Mono',monospace"}}>{val}</div></div>));})()}</div>{(()=>{const W=320,H=120,PAD=8;const elevs=elevProfileData.map(p=>p.elevation??0);const minE=Math.min(...elevs),maxE=Math.max(...elevs);const range=maxE-minE||1;const pts=elevs.map((e,i)=>{const x=PAD+(i/(elevs.length-1))*(W-PAD*2);const y=PAD+(1-(e-minE)/range)*(H-PAD*2);return`${x},${y}`;}).join(" ");const fillPts=`${PAD},${H-PAD} `+pts+` ${W-PAD},${H-PAD}`;return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:120,borderRadius:12,overflow:"visible"}}><defs><linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35"/><stop offset="100%" stopColor="#38bdf8" stopOpacity="0.03"/></linearGradient></defs><polygon points={fillPts} fill="url(#elevGrad)"/><polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><text x={PAD+4} y={H-PAD-4} fontSize="8" fill="rgba(255,255,255,0.28)" fontFamily="DM Mono,monospace">{Math.round(minE)}m</text><text x={PAD+4} y={PAD+10} fontSize="8" fill="rgba(255,255,255,0.28)" fontFamily="DM Mono,monospace">{Math.round(maxE)}m</text></svg>);})()}<div style={{fontSize:10,color:"rgba(255,255,255,0.2)",textAlign:"center",marginTop:6,fontFamily:"'DM Mono',monospace"}}>{elevProfileData.length} pts · {elevSourceLabel}</div></div>)}{!elevLoading&&elevProfileData.length<2&&elevMode!=="custom"&&(<div style={{textAlign:"center",padding:"28px 20px"}}><div style={{fontSize:32,marginBottom:10}}>⛰️</div><div style={{color:"rgba(255,255,255,0.25)",fontSize:13,fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>{elevMode==="survey"&&route.length<2?"Start a survey route first":elevMode==="measure"&&measurePoints.length<2?"Add measure points first":elevMode==="draw"&&drawPoints.length<2?"Draw a path first":"Select a mode above to load elevation data"}</div></div>)}</div>)}

          {activeSheet==="more"&&(<div style={{paddingBottom:28}}><SheetHeader title="More Tools" sub="Advanced features" onClose={() => setActiveSheet(null)} iconColor="#8b5cf6" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>}/><SheetDivider/>
            {[
              {label:"Elevation Profile",sub:"Terrain elevation chart",color:"#38bdf8",action:() => {handleElevModeRequest(elevMode||"survey");setActiveSheet("elevation");}},
              {label:"Compass Navigation",sub:compass.compassNavActive?`Active · ${Math.round(((compass.compassHeading??0)%360+360)%360)}°`:"Map stays north-up",color:"#0ea5e9",active:compass.compassNavActive,action:() => {setActiveSheet(null);compass.compassNavActive?compass.stopCompassNav():compass.startCompassNav();}},
              {label:"Survey Route",sub:surveyMode?`${route.length} pts · recording`:"Tap points for route",color:"#3b82f6",active:surveyMode,action:() => {handleToggleSurvey();setActiveSheet(null);}},
              {label:"3D Globe View",sub:"Interactive 3D earth",color:"#a78bfa",action:() => {setShow3D(true);setActiveSheet(null);}},
              {label:"Live Track Recorder",sub:isTracking?"Recording GPS track":"GPS track · GPX/KML",color:"#ef4444",active:isTracking,action:() => {setTrackerOpen(true);setActiveSheet(null);}},
              {label:offlineMode?"🗺 Go Live (Online)":"📴 Use Cached Map",sub:offlineMode?"Tap to switch back to online tiles":`${cacheStats?.tileCount??0} tiles cached · tap to use`,color:offlineMode?"#4ade80":"#10b981",active:offlineMode,action:() => {setOfflineMode(p=>!p);setActiveSheet(null);}},
              {label:"Offline Map Manager",sub:"Download tiles for offline use",color:"#14b8a6",action:() => {setOfflineOpen(true);setActiveSheet(null);}},
              {label:"Night Mode Auto",sub:nightModeAuto?"Active — switches at sunset":"Off",color:"#818cf8",active:nightModeAuto,action:() => {setNightModeAuto(p=>!p);setActiveSheet(null);}},
              {label:"File Folder",sub:`${(kmlName?1:0)+(extraFile?1:0)+geoJSON.importedGeoJSONLayers.length} file(s) imported`,color:"#60a5fa",action:() => setActiveSheet("files")},
            ].map(({label,sub,color,active,action}) => (
              <button key={label} onClick={action} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"13px 20px",background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.035)",cursor:"pointer",textAlign:"left"}}>
                <div style={{width:44,height:44,borderRadius:14,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:active?`${color}18`:"rgba(255,255,255,0.04)",border:`1px solid ${active?color+"35":"rgba(255,255,255,0.07)"}`}}><div style={{width:8,height:8,borderRadius:"50%",background:active?color:"rgba(255,255,255,0.2)"}}/></div>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:active?700:500,color:active?"#e2eeff":"rgba(190,215,250,0.65)"}}>{label}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.2)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</div></div>
                {active&&<div style={{width:8,height:8,borderRadius:"50%",background:color,boxShadow:`0 0 10px ${color}`,flexShrink:0}}/>}
              </button>
            ))}
            {/* ✅ Mobile export section in More sheet */}
            {hasExportData&&(<div style={{padding:"12px 20px 0"}}><div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.2)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Export Your Data</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><button onClick={() => {geoJSON.handleExportGeoJSON({savedDrawings,route,measurePoints});setActiveSheet(null);}} style={{padding:"12px 0",borderRadius:12,cursor:"pointer",background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",color:"#4ade80",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>📄 GeoJSON</button><button onClick={() => {exportKML(savedDrawings,route,measurePoints);setActiveSheet(null);}} style={{padding:"12px 0",borderRadius:12,cursor:"pointer",background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.3)",color:"#fbbf24",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>📍 KML</button><button onClick={() => {exportCSV(savedDrawings,route,measurePoints);setActiveSheet(null);}} style={{padding:"12px 0",borderRadius:12,cursor:"pointer",background:"rgba(56,189,248,0.12)",border:"1px solid rgba(56,189,248,0.3)",color:"#38bdf8",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>📊 CSV</button><button onClick={() => {exportKMZ(savedDrawings,route,measurePoints);setActiveSheet(null);}} style={{padding:"12px 0",borderRadius:12,cursor:"pointer",background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"#c4b5fd",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>🗜 KMZ</button></div></div>)}
          </div>)}

        </MobileBottomSheet>

        {/* ═══ DESKTOP STATUS BAR ════════════════════════════════════════ */}
        {!isMobile&&(<div style={{position:"absolute",bottom:0,left:0,right:0,height:STAT_H,zIndex:1100,background:"rgba(4,10,20,0.94)",backdropFilter:"blur(12px)",borderTop:"1px solid rgba(255,255,255,0.055)",display:"flex",alignItems:"center",padding:"0 14px",gap:10,userSelect:"none"}}><div style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0,overflow:"hidden"}}><Ico name="Pin" size={11} style={{color:"rgba(74,158,255,0.55)",flexShrink:0}}/>{mousePos?<span style={{color:"#c0d8f0",fontSize:10,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{coordFmt==="dms"&&`${toDMS(mousePos.lat,"N","S")}  ${toDMS(mousePos.lng,"E","W")}`}{coordFmt==="dec"&&`${mousePos.lat.toFixed(6)}°,  ${mousePos.lng.toFixed(6)}°`}{coordFmt==="utm"&&<><span style={{color:"rgba(255,255,255,0.35)",fontSize:9,marginRight:4,fontWeight:600}}>UTM</span>{toUTM(mousePos.lat,mousePos.lng)}</>}</span>:<span style={{color:"rgba(255,255,255,0.18)",fontSize:10,fontFamily:"'DM Mono',monospace"}}>—°——′——.——″</span>}<button onClick={() => setCoordFmt(f=>f==="dms"?"dec":f==="dec"?"utm":"dms")} style={{display:"flex",alignItems:"center",gap:2,padding:"2px 7px",borderRadius:6,cursor:"pointer",background:"rgba(74,158,255,0.09)",border:"1px solid rgba(74,158,255,0.25)",color:"rgba(130,185,255,0.8)",fontSize:9.5,fontWeight:600,flexShrink:0}}>{coordFmt==="dms"?"LatLng":coordFmt==="dec"?"UTM":"DMS"} <span style={{fontSize:10,marginLeft:1}}>↺</span></button></div><div style={{flex:1}}/><div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}><span style={{color:"rgba(255,255,255,0.38)",fontSize:10,fontFamily:"'DM Mono',monospace"}}>Z{mapZoom}</span>{cursorElevation!=null&&<span onClick={() => setElevOpen(true)} style={{color:"#38bdf8",fontSize:10,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(56,189,248,0.07)",padding:"2px 8px",borderRadius:10,border:"1px solid rgba(56,189,248,0.18)",display:"flex",alignItems:"center",gap:3}}><Ico name="Mountain" size={10}/>{Math.round(cursorElevation)} m</span>}{geoJSON.importedGeoJSONLayers.length>0&&<span style={{color:"#2dd4bf",fontSize:10,cursor:"pointer",background:"rgba(20,184,166,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(20,184,166,0.22)",display:"flex",alignItems:"center",gap:3}}><Ico name="GeoJSON" size={10}/>{geoJSON.importedGeoJSONLayers.length} GeoJSON</span>}{compass.compassNavActive&&<span onClick={compass.stopCompassNav} style={{color:"#38bdf8",fontSize:10,cursor:"pointer",background:"rgba(14,165,233,0.1)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(14,165,233,0.25)",display:"flex",alignItems:"center",gap:3}}><span style={{animation:"spin 2s linear infinite",display:"inline-block",width:8,height:8}}>◈</span>{Math.round(((compass.compassHeading??0)%360+360)%360)}°</span>}{isTracking&&<span onClick={() => setTrackerOpen(true)} style={{color:"#f87171",fontSize:10,cursor:"pointer",background:"rgba(239,68,68,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(239,68,68,0.22)",display:"flex",alignItems:"center",gap:3}}><span style={{animation:"blink 1s infinite"}}>●</span>REC</span>}{offlineMode&&<span onClick={() => setOfflineMode(false)} style={{color:"#4ade80",fontSize:10,cursor:"pointer",background:"rgba(34,197,94,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(34,197,94,0.22)"}} title="Cached — click to go live">🗺</span>}<div style={{display:"flex",alignItems:"center",gap:4}}><span style={{animation:"blink 1.5s infinite",color:"#4a9eff",fontSize:8}}>●</span><span style={{color:"rgba(255,255,255,0.22)",fontSize:9.5}}>Live</span></div></div></div>)}

        {offlineMode&&(<div style={{position:"absolute",top:mapTop+10,left:isMobile?"50%":mapLeft+20,transform:isMobile?"translateX(-50%)":"none",zIndex:1060,display:"flex",alignItems:"center",gap:10,padding:"9px 18px",background:"rgba(4,10,20,0.97)",backdropFilter:"blur(16px)",border:`1.5px solid ${isOnline?"rgba(34,197,94,0.5)":"rgba(239,68,68,0.5)"}`,borderRadius:28,boxShadow:"0 4px 28px rgba(0,0,0,0.65)",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}><span style={{fontSize:18}}>🗺</span><div><div style={{color:isOnline?"#4ade80":"#f87171",fontWeight:700,fontSize:12}}>{isOnline?"Cached Map Active":"📴 Offline — Cached Map Only"}</div><div style={{color:"#475569",fontSize:10,marginTop:1}}>{cacheStats?.tileCount?`${cacheStats.tileCount.toLocaleString()} tiles cached · GPS active`:"No tiles cached yet"}</div></div>{isOnline&&<button onClick={() => setOfflineMode(false)} style={{marginLeft:6,padding:"5px 14px",borderRadius:14,border:"1px solid rgba(34,197,94,0.42)",background:"rgba(34,197,94,0.12)",color:"#4ade80",fontSize:11,fontWeight:700,cursor:"pointer"}}>Go Live ↗</button>}</div>)}

        <LiveTrackRecorder map={mapRefForTracker} visible={trackerOpen} onClose={() => setTrackerOpen(false)} onRecordingChange={setIsTracking}/>
        {!isMobile&&<ElevationProfile visible={elevOpen} onClose={() => setElevOpen(false)} profileData={elevProfileData} loading={elevLoading} isOnline={isOnline} sourceLabel={elevSourceLabel} leafletMap={mapRefForTracker} activeMode={elevMode} onRequestPoints={handleElevModeRequest}/>}
        <OfflineMapManager visible={offlineOpen} onClose={() => setOfflineOpen(false)} leafletMap={mapRefForTracker} activeLayer={activeLayer} isOnline={isOnline} swReady={swReady} swError={swError} cacheStats={cacheStats} precaching={precaching} precacheProgress={precacheProgress} precacheCurrentView={precacheCurrentView} precacheRegion={precacheRegion} clearTileCache={clearTileCache} fetchCacheStats={fetchCacheStats} stopPrecache={stopPrecache}/>
        <OfflineStatusBadge isOnline={isOnline} swReady={swReady} swError={swError} precaching={precaching} precacheProgress={precacheProgress} cacheStats={cacheStats} onClick={() => {setOfflineOpen(true);if(isMobile) setActiveSheet(null);}}/>

        {!isMobile&&locationInfo&&(<div style={{position:"absolute",top:mapTop+14,right:70,width:310,zIndex:1050,borderRadius:14,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.7)",border:"1px solid rgba(255,255,255,0.09)",background:"rgba(5,12,24,0.97)",backdropFilter:"blur(24px)",fontFamily:"'DM Sans',sans-serif",animation:"fadeSlideIn 0.22s ease"}}><div style={{position:"absolute",top:10,right:10,zIndex:2}}><button onClick={handleCloseLocationInfo} style={{background:"rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.7)",borderRadius:6,width:26,height:26,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ico name="Close" size={10}/></button></div><LocationInfoContent/></div>)}
        {isMobile&&locationInfo&&(<><div onClick={handleCloseLocationInfo} style={{position:"fixed",inset:0,zIndex:1490,background:"rgba(0,0,0,0.45)"}}/><div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:1500,background:"rgba(7,14,28,0.98)",borderRadius:"20px 20px 0 0",border:"1px solid rgba(255,255,255,0.1)",borderBottom:"none",boxShadow:"0 -8px 40px rgba(0,0,0,0.7)",fontFamily:"'DM Sans',sans-serif",animation:"slideUp 0.28s cubic-bezier(0.32,0.72,0,1)",maxHeight:"75vh",overflowY:"auto",paddingBottom:24}}><div style={{display:"flex",justifyContent:"center",padding:"12px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"rgba(255,255,255,0.2)"}}/></div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 16px 8px"}}><div style={{color:"#c8e0f8",fontWeight:700,fontSize:16}}>{locationInfo.loading?"Locating…":(locationInfo.name||locationInfo.label?.split(",")?.[0])}</div><button onClick={handleCloseLocationInfo} style={{background:"rgba(255,255,255,0.07)",border:"none",color:"rgba(255,255,255,0.6)",borderRadius:8,width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ico name="Close" size={14}/></button></div>{locationInfo.details&&!locationInfo.loading&&<div style={{color:"rgba(255,255,255,0.35)",fontSize:12,padding:"0 16px 10px"}}>{locationInfo.details}</div>}<LocationInfoContent/></div></>)}

        {showNameModal&&(<div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(10px)"}}><div style={{background:"rgba(7,18,32,0.98)",borderRadius:16,padding:26,width:"100%",maxWidth:300,boxShadow:"0 20px 60px rgba(0,0,0,0.8)",border:"1px solid rgba(74,158,255,0.18)",fontFamily:"'DM Sans',sans-serif"}}><div style={{color:"#c8e0f8",fontWeight:700,fontSize:16,marginBottom:3}}>Name this {pendingType}</div><div style={{color:"rgba(255,255,255,0.28)",fontSize:11,marginBottom:14}}>{pendingPoints.length} point{pendingPoints.length!==1?"s":""} recorded</div><input autoFocus value={pendingName} onChange={e=>setPendingName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmDrawing()} placeholder={pendingType==="marker"?"e.g. Survey Point A":"e.g. Survey Path A"} style={{width:"100%",padding:"10px 13px",borderRadius:8,border:"1px solid rgba(74,158,255,0.28)",background:"rgba(74,158,255,0.06)",color:"#c8e0f8",fontSize:13,marginBottom:15,outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"}}/><div style={{display:"flex",gap:8}}><PrimaryButton onClick={confirmDrawing} variant="blue"><Ico name="Check" size={13}/>Save</PrimaryButton><PrimaryButton onClick={cancelDrawing} variant="red" style={{background:"transparent"}}><Ico name="Close" size={13}/>Cancel</PrimaryButton></div></div></div>)}
        {showAbout&&(<div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(12px)"}}><div style={{background:"rgba(5,12,24,0.98)",borderRadius:16,padding:28,width:"100%",maxWidth:360,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 72px rgba(0,0,0,0.85)",border:"1px solid rgba(74,158,255,0.18)",fontFamily:"'DM Sans',sans-serif"}}><div style={{display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14}}><div style={{width:52,height:52,borderRadius:14,background:"linear-gradient(135deg,rgba(74,158,255,0.22),rgba(37,99,235,0.22))",border:"1px solid rgba(74,158,255,0.32)",display:"flex",alignItems:"center",justifyContent:"center"}}><Ico name="Compass" size={26} style={{color:"#4a9eff"}}/></div></div><div style={{color:"#c8e0f8",fontWeight:700,fontSize:20,textAlign:"center",marginBottom:5}}>SurveyMap Pro</div><div style={{color:"rgba(255,255,255,0.32)",fontSize:12,textAlign:"center",marginBottom:18}}>Version 5.2.1 — KML/CSV/KMZ Export</div><PrimaryButton onClick={() => setShowAbout(false)} variant="blue"><Ico name="Check" size={13}/>Close</PrimaryButton></div></div>)}
        {showShortcuts&&(<div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(12px)"}}><div style={{background:"rgba(5,12,24,0.98)",borderRadius:16,padding:26,width:"100%",maxWidth:340,boxShadow:"0 24px 72px rgba(0,0,0,0.85)",border:"1px solid rgba(74,158,255,0.18)",fontFamily:"'DM Sans',sans-serif"}}><div style={{display:"flex",alignItems:"center",gap:9,marginBottom:18}}><Ico name="Keyboard" size={18} style={{color:"#4a9eff"}}/><span style={{color:"#c8e0f8",fontWeight:700,fontSize:16}}>Keyboard Shortcuts</span></div>{[["Escape","Cancel draw / measure"],["Click map","Add point"],["Enter","Save (name modal)"],["Scroll","Zoom in / out"],["Drag","Pan map"],["Right-click drag","Rotate map"]].map(([k,d]) => (<div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}><code style={{color:"#80c4ff",fontWeight:600,fontSize:11,fontFamily:"'DM Mono',monospace",background:"rgba(74,158,255,0.1)",padding:"3px 8px",borderRadius:5,border:"1px solid rgba(74,158,255,0.18)"}}>{k}</code><span style={{color:"rgba(200,225,255,0.45)",fontSize:11.5}}>{d}</span></div>))}<PrimaryButton onClick={() => setShowShortcuts(false)} variant="blue" style={{marginTop:18}}><Ico name="Check" size={13}/>Close</PrimaryButton></div></div>)}

      </div>
    </>
  );
}