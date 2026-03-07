/**
 * Globe3DView.jsx — SurveyMap Pro · Mobile-Responsive
 * Top toolbar + slide-in left panel + Cesium 3D globe
 * FIXED: Search engine — shows correct place/city/village names, removed Wikipedia API
 * UPDATED: Google Earth–style adaptive grid (LatLng / UTM / MGRS)
 * FIXED: Grid crash — rebuild lock, stale-ref cleanup, entity cap, debounce guard
 */
import { useEffect, useRef, useState, useCallback } from "react";
import Papa from "papaparse";
import { latLngToUTM, latLngToMGRS, parseUTM, parseMGRS, utmToLatLng, formatUTM } from "./map/utm-mgrs";
import HeatmapLayer from "./HeatmapLayer";
import SatelliteTimeSlider from "./Satellitetimeslider";
import DroneFlightPath from "./DroneFlightPath";
import { buildLatLngGrid, removeLatLngGrid } from "./Gridlayer";

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
  {key:"Satellite",label:"Satellite",icon:"🛰️"},{key:"Street",label:"Street",icon:"🗺️"},
  {key:"Terrain",label:"Terrain",icon:"⛰️"},{key:"Satellite + Labels",label:"+Labels",icon:"🏷️"},
  {key:"Dark",label:"Dark",icon:"🌑"},{key:"Light",label:"Light",icon:"☀️"},
  {key:"Hillshade",label:"Hillshade",icon:"🗻"},{key:"Contour",label:"Contour",icon:"📈"},
];

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

  // ── Grid refs ──────────────────────────────────────────────────────────────
  const gridGroupRef        = useRef([]);
  const gridRebuildTimerRef = useRef(null);
  const gridAltBucketRef    = useRef(null);
  const gridRebuildLockRef  = useRef(false);   // ← NEW: prevents overlapping rebuilds

  const [buildingInfo,setBuildingInfo]=useState(null);
  const buildingPickRef=useRef(null);
  const csvPickRef=useRef(null),hoveredEntRef=useRef(null);
  const [heatmapOpen,setHeatmapOpen]=useState(false);
  const [sliderOpen,setSliderOpen]=useState(false);
  const [droneOpen,setDroneOpen]=useState(false);
  const drawPtsRef=useRef([]),measurePtsRef=useRef([]),surveyPtsRef=useRef([]);
  const measureEntsRef=useRef([]),surveyEntsRef=useRef([]),boundaryEntsRef=useRef([]);
  const gpsEntRef=useRef(null),clickRef=useRef(null),csvDSRef=useRef(null);
  const orbitRef=useRef(null);

  // ── Coordinate Converter state ────────────────────────────────────────────
  const [coordConvOpen,setCoordConvOpen]=useState(false);
  const [convInput,setConvInput]=useState("");
  const [convResult,setConvResult]=useState(null);
  const [convError,setConvError]=useState("");
  const [convPickMode,setConvPickMode]=useState(false);
  const [convCopied,setConvCopied]=useState("");
  const convPickRef=useRef(null);

  const TB=46,PANEL=260,SB=26;

  // ── CSS ─────────────────────────────────────────────────────────────────
  const CSS=`
    *{box-sizing:border-box;}
    html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes progressBar{from{width:0%}to{width:100%}}
    .g3-panel{position:fixed;top:${TB}px;left:0;bottom:${SB}px;width:${PANEL}px;z-index:1000;
      background:#141e2e;border-right:1px solid rgba(255,255,255,0.07);
      display:flex;flex-direction:column;overflow-y:auto;
      transition:transform .28s cubic-bezier(.4,0,.2,1);}
    .g3-sec-h{display:flex;align-items:center;justify-content:space-between;
      padding:8px 14px;cursor:pointer;user-select:none;
      background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.05);
      color:#94a3b8;font-size:10.5px;font-weight:700;letter-spacing:.07em;
      font-family:'Segoe UI',system-ui,sans-serif;}
    .g3-sec-h:hover{background:rgba(255,255,255,0.04);}
    .g3-sec-body{padding:10px 14px 12px;border-bottom:1px solid rgba(255,255,255,0.04);}
    .g3-layer-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;
      cursor:pointer;user-select:none;margin-bottom:2px;transition:background .12s;}
    .g3-layer-row:hover{background:rgba(255,255,255,0.04);}
    .g3-tbtn{display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:0 12px;height:${TB}px;border:none;cursor:pointer;gap:2px;
      background:transparent;border-bottom:2px solid transparent;
      color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:.04em;
      transition:all .15s;min-width:48px;flex-shrink:0;font-family:'Segoe UI',sans-serif;}
    .g3-tbtn.active{background:rgba(59,130,246,.2);border-bottom-color:#3b82f6;color:#60a5fa;}
    .g3-tbtn:hover{color:#e2e8f0;}
    .g3-primary{width:100%;padding:8px 12px;border-radius:6px;border:none;color:#fff;
      font-weight:600;font-size:12px;cursor:pointer;transition:filter .15s;
      font-family:'Segoe UI',sans-serif;}
    .g3-primary:hover{filter:brightness(1.12);}
    @media(max-width:640px){
      .g3-panel{transform:translateX(-100%);}
      .g3-panel.open{transform:translateX(0);z-index:1250;}
      .g3-map{left:0!important;}
      .g3-tb-lbl{display:none!important;}
      .g3-tbtn{min-width:40px!important;padding:0 8px!important;}
      .g3-ham{display:flex!important;}
      .g3-zoom{bottom:${SB+8}px!important;right:8px!important;}
      .g3-compass{bottom:${SB+100}px!important;right:8px!important;}
    }
    @media(min-width:641px){.g3-ham{display:none!important;}}
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
          terrainProvider: await Cesium.createWorldTerrainAsync({
            requestWaterMask: false,
            requestVertexNormals: true,
          }),
          timeline:false,animation:false,baseLayerPicker:false,geocoder:false,
          homeButton:false,sceneModePicker:false,navigationHelpButton:false,
          fullscreenButton:false,infoBox:false,selectionIndicator:false,
          creditContainer:document.createElement("div"),
        });
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.globe.enableLighting = false;
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(buildProvider(Cesium,"Satellite"));
        viewerRef.current=viewer; setReady(true);
        viewer.scene.postRender.addEventListener(()=>{
          try{
            const c=viewer.camera.positionCartographic;
            if(c)setCameraAlt(c.height);
            const h=viewer.camera.heading;
            if(h!=null&&!isNaN(h))setCompassHeading(Cesium.Math.toDegrees(h));
          }catch(_){}
        });
        const mh=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        mh.setInputAction(e=>{
          try{const ray=viewer.camera.getPickRay(e.endPosition);if(!ray)return;const pos=viewer.scene.globe.pick(ray,viewer.scene);if(!pos){setMousePos(null);return;}const c=Cesium.Cartographic.fromCartesian(pos);setMousePos({lat:Cesium.Math.toDegrees(c.latitude),lng:Cesium.Math.toDegrees(c.longitude)});}catch(_){}
        },Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        savedDrawings.forEach(d=>renderDrawing(viewer,Cesium,d));
      }catch(err){setInitErr(err.message);}
    })();
    return()=>{
      if(orbitRef.current){
        orbitRef.current.active=false;
        if(orbitRef.current.animFrame)cancelAnimationFrame(orbitRef.current.animFrame);
        orbitRef.current=null;
      }
      if(viewer&&!viewer.isDestroyed())viewer.destroy();
    };
  },[]);// eslint-disable-line

  useEffect(()=>{if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;viewer.imageryLayers.removeAll();viewer.imageryLayers.addImageryProvider(buildProvider(Cesium,activeLayer));if(activeLayer==="Satellite + Labels")viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:"https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",maximumLevel:19,credit:"© Esri"}));},[activeLayer,ready]);
  useEffect(()=>{if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;if(viewMode==="3D")viewer.scene.morphTo3D(1);if(viewMode==="2D")viewer.scene.morphTo2D(1);if(viewMode==="Columbus")viewer.scene.morphToColumbusView(1);},[viewMode,ready]);

  // ── OSM 3D Buildings ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!ready)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(!buildingsEnabled){
      if(buildingsTilesetRef.current){
        try{viewer.scene.primitives.remove(buildingsTilesetRef.current);}catch(_){}
        buildingsTilesetRef.current=null;
      }
      if(buildingPickRef.current){buildingPickRef.current.destroy();buildingPickRef.current=null;}
      setBuildingInfo(null);
      viewer.scene.globe.enableLighting=false;
      return;
    }
    if(viewMode!=="3D"){viewer.scene.morphTo3D(1);}
    setBuildingsLoading(true);
    (async()=>{
      try{
        const tileset=await Cesium.createOsmBuildingsAsync();
        tileset.style=new Cesium.Cesium3DTileStyle({
          color:{conditions:[
            ["${feature['building']} === 'hospital'",   "color('#fca5a5', 0.95)"],
            ["${feature['building']} === 'school' || ${feature['building']} === 'college'","color('#fcd34d', 0.95)"],
            ["${feature['building']} === 'church' || ${feature['building']} === 'temple' || ${feature['building']} === 'mosque'","color('#c4b5fd', 0.95)"],
            ["${feature['building']} === 'industrial' || ${feature['building']} === 'warehouse'","color('#9ca3af', 0.90)"],
            ["${feature['building']} === 'commercial' || ${feature['building']} === 'retail'","color('#93c5fd', 0.95)"],
            ["${feature['building']} === 'government' || ${feature['building']} === 'public'","color('#6ee7b7', 0.95)"],
            ["${feature['building']} === 'hotel' || ${feature['building']} === 'apartments'","color('#fdba74', 0.90)"],
            ["true","color('#e2e8f0', 0.85)"],
          ]},
        });
        viewer.scene.globe.enableLighting=true;
        viewer.scene.light=new Cesium.SunLight();
        if(!viewer.isDestroyed()){
          viewer.scene.primitives.add(tileset);
          buildingsTilesetRef.current=tileset;
          if(buildingPickRef.current){buildingPickRef.current.destroy();}
          const ph=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
          buildingPickRef.current=ph;
          ph.setInputAction(click=>{
            const picked=viewer.scene.pick(click.position);
            if(picked&&picked.getProperty){
              const rawType=picked.getProperty("building")||picked.getProperty("amenity")||"";
              const name=picked.getProperty("name")||picked.getProperty("addr:housename")||
                         picked.getProperty("addr:street")||"";
              const type=(rawType==="yes"||rawType===""||rawType==="True")?"untagged":rawType;
              const estHeight=picked.getProperty("cesium#estimatedHeight");
              const osmHeight=picked.getProperty("height")||picked.getProperty("building:height");
              const floors=picked.getProperty("building:levels");
              const displayHeight=osmHeight
                ?`${parseFloat(osmHeight).toFixed(1)} m`
                :(estHeight&&parseFloat(estHeight)>5)?`~${parseFloat(estHeight).toFixed(0)} m (est.)`:null;
              const rect=viewer.scene.canvas.getBoundingClientRect();
              setBuildingInfo({
                name:name||(type==="untagged"?"Building":type.charAt(0).toUpperCase()+type.slice(1)),
                type,height:displayHeight,floors:floors?`${floors} floors`:null,
                untagged:type==="untagged",
                x:Math.min(click.position.x+rect.left+12,window.innerWidth-260),
                y:Math.max(click.position.y+rect.top-10,60),
              });
            }else{setBuildingInfo(null);}
          },Cesium.ScreenSpaceEventType.LEFT_CLICK);
          ph.setInputAction(move=>{
            const picked=viewer.scene.pick(move.endPosition);
            viewer.scene.canvas.style.cursor=(picked&&picked.getProperty)?'pointer':'default';
          },Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
      }catch(err){
        console.error("OSM Buildings load failed:",err);
        setBuildingsEnabled(false);
        alert("3D Buildings failed to load.\n\nTo fix: get a free Cesium ion token at cesium.com/ion and replace the token in Globe3DView.jsx.");
      }finally{setBuildingsLoading(false);}
    })();
  },[buildingsEnabled,ready]); // eslint-disable-line

  useEffect(()=>{if(!nightAuto)return;let timer;(async()=>{try{const pos=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:8000}));const{latitude:lat,longitude:lng}=pos.coords;const data=await(await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=sunrise,sunset&timezone=auto&forecast_days=1`)).json();const sunrise=new Date(data.daily.sunrise[0]),sunset=new Date(data.daily.sunset[0]);const check=()=>{const now=new Date(),isNight=now<sunrise||now>sunset;setNightInfo({isNight});setActiveLayer(isNight?"Dark":"Satellite + Labels");};check();timer=setInterval(check,60000);}catch(e){console.warn(e);}})();return()=>clearInterval(timer);},[nightAuto]);

  // ── DEM / Terrain Visualization ──────────────────────────────────────────
  useEffect(()=>{
    if(!ready)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    demLayersRef.current.forEach(l=>{try{viewer.imageryLayers.remove(l,true);}catch(_){}});
    demLayersRef.current=[];
    if(!demEnabled)return;
    const addLayer=(provider,alpha)=>{
      const l=viewer.imageryLayers.addImageryProvider(provider);
      l.alpha=alpha;
      demLayersRef.current.push(l);
      return l;
    };
    if(demStyle==="hypsometric"||demStyle==="both"){
      addLayer(new Cesium.UrlTemplateImageryProvider({url:"https://tile.opentopomap.org/{z}/{x}/{y}.png",credit:"© OpenTopoMap / SRTM",maximumLevel:17}),demStyle==="both"?demOpacity*0.7:demOpacity);
    }
    if(demStyle==="slope"||demStyle==="both"){
      addLayer(new Cesium.UrlTemplateImageryProvider({url:"https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",credit:"© Esri",maximumLevel:16}),demStyle==="both"?demOpacity*0.6:demOpacity);
    }
  },[demEnabled,demStyle,demOpacity,ready]); // eslint-disable-line

  useEffect(()=>{
    if(!ready||!demEnabled)return;
    demLayersRef.current.forEach((l,i)=>{
      if(demStyle==="both"){l.alpha=i===0?demOpacity*0.7:demOpacity*0.6;}
      else{l.alpha=demOpacity;}
    });
  },[demOpacity]); // eslint-disable-line

  useEffect(()=>{
    if(!ready)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(!elevMode){
      elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});
      elevEntsRef.current=[];elevPtsRef.current=[];
      if(hoverMarkerRef.current){try{viewer.entities.remove(hoverMarkerRef.current);}catch(_){}hoverMarkerRef.current=null;}
      return;
    }
    const handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(async click=>{
      const ray=viewer.camera.getPickRay(click.position);
      if(!ray)return;
      const pos=viewer.scene.globe.pick(ray,viewer.scene);
      if(!pos)return;
      const carto=Cesium.Cartographic.fromCartesian(pos);
      const lat=Cesium.Math.toDegrees(carto.latitude);
      const lng=Cesium.Math.toDegrees(carto.longitude);
      const newPts=[...elevPtsRef.current,{lat,lng}];
      elevPtsRef.current=newPts;
      setElevPoints([...newPts]);
      const idx=newPts.length;
      const ent=viewer.entities.add({
        position:Cesium.Cartesian3.fromDegrees(lng,lat),
        point:{pixelSize:10,color:Cesium.Color.fromCssColorString("#f59e0b"),outlineColor:Cesium.Color.WHITE,outlineWidth:2,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY},
        label:{text:String(idx),font:"bold 11px sans-serif",fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,pixelOffset:new Cesium.Cartesian2(0,-14),disableDepthTestDistance:Number.POSITIVE_INFINITY},
      });
      elevEntsRef.current=[...elevEntsRef.current,ent];
      if(newPts.length>=2){
        const lineEnt=viewer.entities.add({polyline:{positions:Cesium.Cartesian3.fromDegreesArray(newPts.flatMap(p=>[p.lng,p.lat])),width:2.5,material:new Cesium.PolylineDashMaterialProperty({color:Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.85),dashLength:12}),clampToGround:true}});
        elevEntsRef.current=[...elevEntsRef.current,lineEnt];
      }
      if(newPts.length>=2){
        setElevLoading(true);
        try{
          const SAMPLES=100;
          const EGM96_PTS=[
            [20,85,-44.7],[20,90,-41.2],[20,80,-48.9],[25,85,-44.1],[15,85,-47.3],
            [20,75,-51.2],[28,77,-40.1],[19,73,-46.2],[13,80,-52.3],[13,77,-53.1],
            [22,88,-42.1],[17,78,-49.1],[26,92,-41.5],[24,68,-41.9],[32,74,-36.8],
            [8,77,-55.1],[23,86,-43.2],[21,82,-45.1],[18,84,-45.9],[27,95,-33.4],
            [30,80,-34.6],[12,79,-53.8],[25,72,-44.5],[15,75,-51.4],[20,95,-35.2],
            [10,76,-56.8],[22,70,-46.3],[28,72,-41.8],[18,74,-50.2],[24,78,-44.0],
            [51,0,46.8],[48,2,46.0],[52,13,35.7],[55,37,13.6],[59,18,24.1],
            [40,-74,-28.5],[34,-118,-31.8],[45,-75,-23.2],[51,-114,-16.3],
            [35,139,36.5],[31,121,11.2],[22,114,3.4],[35,36,24.1],[30,31,21.5],
            [-33,151,19.2],[-23,-43,-5.6],[-34,-58,-7.4],[-26,28,-19.5],
            [0,0,17.2],[60,0,22.9],[-10,30,-16.0],[64,26,18.4],[0,110,-28.3],
            [35,60,-3.4],[40,55,-7.2],[50,60,-12.8],[25,55,-18.5],[20,45,-24.0],
          ];
          function geoidN(latDeg,lngDeg){
            let sumW=0,sumNW=0;
            const top=EGM96_PTS.map(([la,lo,n])=>{const d=Math.sqrt((la-latDeg)**2+(lo-lngDeg)**2)+0.001;return{n,d};}).sort((a,b)=>a.d-b.d).slice(0,8);
            for(const p of top){const w=1/(p.d*p.d);sumW+=w;sumNW+=w*p.n;}
            return sumNW/sumW;
          }
          const samplePositions=[];
          const segLengths=[];
          let totalLen=0;
          const waypointCumDists=[0];
          for(let i=0;i<newPts.length-1;i++){
            const a=newPts[i],b=newPts[i+1];
            const R=6371000,r=x=>x*Math.PI/180;
            const dLat=r(b.lat-a.lat),dLon=r(b.lng-a.lng);
            const s=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
            const segLen=R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));
            segLengths.push(segLen);
            totalLen+=segLen;
            waypointCumDists.push(totalLen);
          }
          for(let s=0;s<=SAMPLES;s++){
            const t=(s/SAMPLES)*totalLen;
            let acc=0,segIdx=0;
            while(segIdx<segLengths.length-1&&acc+segLengths[segIdx]<t){acc+=segLengths[segIdx];segIdx++;}
            const segT=segLengths[segIdx]>0?(t-acc)/segLengths[segIdx]:0;
            const a=newPts[segIdx],b=newPts[Math.min(segIdx+1,newPts.length-1)];
            samplePositions.push(Cesium.Cartographic.fromDegrees(a.lng+(b.lng-a.lng)*segT,a.lat+(b.lat-a.lat)*segT));
          }
          const sampled=await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider,samplePositions);
          let cumDist=0;
          const profileSamples=sampled.map((c,i)=>{
            if(i>0){
              const p=sampled[i-1];
              const R=6371000;
              const dLat=c.latitude-p.latitude,dLon=c.longitude-p.longitude;
              const a2=Math.sin(dLat/2)**2+Math.cos(p.latitude)*Math.cos(c.latitude)*Math.sin(dLon/2)**2;
              cumDist+=R*2*Math.atan2(Math.sqrt(a2),Math.sqrt(1-a2));
            }
            const latDeg=Cesium.Math.toDegrees(c.latitude);
            const lngDeg=Cesium.Math.toDegrees(c.longitude);
            const ellipsoidH=c.height??0;
            const mslH=ellipsoidH-geoidN(latDeg,lngDeg);
            return{d:cumDist,h:Math.round(mslH*10)/10};
          });
          const heights=profileSamples.map(s=>s.h);
          const minH=Math.min(...heights),maxH=Math.max(...heights);
          const totalDist=profileSamples[profileSamples.length-1].d;
          let maxSlope=0;
          for(let i=1;i<profileSamples.length;i++){
            const run=profileSamples[i].d-profileSamples[i-1].d;
            const rise=Math.abs(profileSamples[i].h-profileSamples[i-1].h);
            if(run>0)maxSlope=Math.max(maxSlope,(rise/run)*100);
          }
          setElevProfile({samples:profileSamples,stats:{minH,maxH,relief:maxH-minH,totalDist,maxSlope,pts:newPts.length},positions:samplePositions.map(c=>({lat:Cesium.Math.toDegrees(c.latitude),lng:Cesium.Math.toDegrees(c.longitude)})),waypointCumDists,_unit:"m"});
          if(!hoverMarkerRef.current){
            hoverMarkerRef.current=viewer.entities.add({show:false,position:Cesium.Cartesian3.fromDegrees(0,0,0),point:{pixelSize:12,color:Cesium.Color.fromCssColorString("#ef4444"),outlineColor:Cesium.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
          }
        }catch(err){console.error("Terrain sampling failed:",err);}
        finally{setElevLoading(false);}
      }
    },Cesium.ScreenSpaceEventType.LEFT_CLICK);
    viewer.scene.canvas.style.cursor="crosshair";
    return()=>{handler.destroy();viewer.scene.canvas.style.cursor="default";};
  },[elevMode,ready]); // eslint-disable-line

  // ── Google Earth–style adaptive grid ────────────────────────────────────
  //
  // Altitude "buckets" — same thresholds as Gridlayer.js latLngStep().
  // We only rebuild when the camera crosses a bucket boundary, not on every
  // tiny altitude change. Rebuilds are debounced (350 ms) and serialised
  // with a lock ref so two rebuilds can never run simultaneously.

  function altBucket(alt) {
    const thresholds = [
      5_000, 15_000, 40_000, 100_000, 300_000,
      700_000, 1_500_000, 3_000_000, 6_000_000, 12_000_000, Infinity,
    ];
    for (let i = 0; i < thresholds.length; i++) {
      if (alt < thresholds[i]) return i;
    }
    return thresholds.length;
  }

  // Core rebuild — serialised with gridRebuildLockRef so it never overlaps
  const doGridRebuild = useCallback(() => {
    if (!ready) return;
    if (gridRebuildLockRef.current) return;          // already rebuilding

    const viewer = viewerRef.current;
    const Cesium = CesiumRef.current;
    if (!viewer || !Cesium) return;
    try { if (viewer.isDestroyed()) return; } catch (_) { return; }

    gridRebuildLockRef.current = true;

    // Safely tear down old grid
    if (gridGroupRef.current?.length > 0) {
      try {
        removeLatLngGrid(viewer, gridGroupRef.current);
      } catch (e) {
        console.warn("[Grid] cleanup error:", e);
      }
      gridGroupRef.current = [];
    }

    if (!gridEnabled) {
      gridRebuildLockRef.current = false;
      return;
    }

    // Read altitude live from the viewer (not from stale state)
    const currentAlt = viewer.camera.positionCartographic?.height ?? 1_000_000;
    gridAltBucketRef.current = altBucket(currentAlt);

    try {
      const ents = buildLatLngGrid(viewer, Cesium, {
        mode: gridMode,
        alt:  currentAlt,
      });
      gridGroupRef.current = Array.isArray(ents) ? ents : [];
    } catch (e) {
      console.error("[Grid] build error:", e);
      gridGroupRef.current = [];
    }

    gridRebuildLockRef.current = false;
  }, [ready, gridEnabled, gridMode]); // ← cameraAlt intentionally omitted; read live

  // Rebuild immediately when grid toggle / mode changes
  useEffect(() => {
    if (!ready) return;
    doGridRebuild();
    return () => {
      // Cleanup on unmount or before next effect run
      const viewer = viewerRef.current;
      const group  = gridGroupRef.current;
      if (viewer && group?.length) {
        try {
          if (!viewer.isDestroyed()) removeLatLngGrid(viewer, group);
        } catch (_) {}
        gridGroupRef.current = [];
      }
    };
  }, [gridEnabled, gridMode, ready]); // eslint-disable-line

  // Debounced rebuild when altitude bucket changes while grid is ON
  useEffect(() => {
    if (!ready || !gridEnabled) return;

    const bucket = altBucket(cameraAlt);
    // Skip if bucket hasn't changed (or we haven't built a first grid yet)
    if (gridAltBucketRef.current !== null && bucket === gridAltBucketRef.current) return;

    // Debounce — wait 350 ms of quiet before rebuilding
    if (gridRebuildTimerRef.current) clearTimeout(gridRebuildTimerRef.current);
    gridRebuildTimerRef.current = setTimeout(() => {
      gridRebuildTimerRef.current = null;
      doGridRebuild();
    }, 350);

    return () => {
      if (gridRebuildTimerRef.current) {
        clearTimeout(gridRebuildTimerRef.current);
        gridRebuildTimerRef.current = null;
      }
    };
  }, [cameraAlt, ready, gridEnabled]); // eslint-disable-line

  // ── Click handler (draw / measure / survey) ──────────────────────────────
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
      if(drawMode){
        if(drawType==="marker"){setPendingPts([pt]);setPendingType("marker");setPendingName("");setShowModal(true);setDrawMode(false);return;}
        const next=[...drawPtsRef.current,pt];drawPtsRef.current=next;setDrawPoints([...next]);
        viewer.entities.add({position:pos,point:{pixelSize:7,color:Cesium.Color.fromCssColorString("#f97316"),outlineColor:Cesium.Color.WHITE,outlineWidth:1}});
      }
      if(measureMode){
        const next=[...measurePtsRef.current,pt];measurePtsRef.current=next;setMeasurePoints([...next]);
        const dot=viewer.entities.add({position:pos,point:{pixelSize:9,color:Cesium.Color.YELLOW,outlineColor:Cesium.Color.BLACK,outlineWidth:1}});
        measureEntsRef.current.push(dot);
        if(next.length>=2){
          const line=viewer.entities.add({polyline:{positions:next.map(p=>Cesium.Cartesian3.fromDegrees(p.lng,p.lat)),width:2,material:new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW.withAlpha(0.85)),clampToGround:true,arcType:Cesium.ArcType.GEODESIC}});
          measureEntsRef.current.push(line);
        }
      }
      if(surveyMode){
        const next=[...surveyPtsRef.current,pt];surveyPtsRef.current=next;setSurveyRoute([...next]);
        const pin=viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:11,color:Cesium.Color.RED,outlineColor:Cesium.Color.WHITE,outlineWidth:2},label:{text:String(next.length),font:"bold 13px sans-serif",fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-22)}});
        surveyEntsRef.current.push(pin);
        if(next.length>=2){
          const line=viewer.entities.add({polyline:{positions:next.map(p=>Cesium.Cartesian3.fromDegrees(p.lng,p.lat)),width:3,material:new Cesium.ColorMaterialProperty(Cesium.Color.RED.withAlpha(0.8)),clampToGround:true,arcType:Cesium.ArcType.GEODESIC}});
          surveyEntsRef.current.push(line);
        }
      }
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

  function handleGPS(){if(!ready)return;const Cesium=CesiumRef.current,viewer=viewerRef.current;navigator.geolocation.getCurrentPosition(({coords:{latitude:la,longitude:lo}})=>{if(gpsEntRef.current)viewer.entities.remove(gpsEntRef.current);gpsEntRef.current=viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lo,la),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#06b6d4"),outlineColor:Cesium.Color.WHITE,outlineWidth:3},label:{text:"📍 You",font:"bold 13px sans-serif",fillColor:Cesium.Color.fromCssColorString("#06b6d4"),outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-24)}});viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lo,la,8000),duration:2});},err=>alert("GPS: "+err.message));}

  // ── COORDINATE CONVERTER ───────────────────────────────────────────────────
  function parseDMS(str){
    const clean=str.trim().replace(/[°d]/g," ").replace(/[′']/g," ").replace(/[″"]/g," ").replace(/\s+/g," ");
    const m=clean.match(/^(-?\d+\.?\d*)\s+(\d+\.?\d*)?\s*(\d+\.?\d*)?\s*([NSEW])?$/i);
    if(!m)return null;
    let deg=parseFloat(m[1]),min=parseFloat(m[2]||0),sec=parseFloat(m[3]||0);
    const dir=(m[4]||"").toUpperCase();
    let dd=deg+(min/60)+(sec/3600);
    if(dir==="S"||dir==="W")dd=-Math.abs(dd);
    return isFinite(dd)?dd:null;
  }

  function buildConvResult(lat,lng){
    if(!isFinite(lat)||!isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return null;
    const utm=latLngToUTM(lat,lng);
    const mgrs=latLngToMGRS(lat,lng,5);
    const dmsLat=toDMS(lat,"N","S"),dmsLng=toDMS(lng,"E","W");
    const dd=`${lat.toFixed(6)}°, ${lng.toFixed(6)}°`;
    const ddSimple=`${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    const ddSigned=`${lat>=0?"+":""}${lat.toFixed(6)}, ${lng>=0?"+":""}${lng.toFixed(6)}`;
    const utmStr=utm?`${utm.zone}${utm.band} ${utm.easting}E ${utm.northing}N`:"";
    const mgrsStr=mgrs||"";
    const dmsStr=`${dmsLat}, ${dmsLng}`;
    const geohash=(()=>{
      try{
        const BASE32="0123456789bcdefghjkmnpqrstuvwxyz";
        let minLat=-90,maxLat=90,minLng=-180,maxLng=180;
        let bits=0,bitsTotal=0,hashVal=0,hash="";
        let isEven=true;
        while(hash.length<9){
          if(isEven){const mid=(minLng+maxLng)/2;if(lng>mid){hashVal=(hashVal<<1)|1;minLng=mid;}else{hashVal=hashVal<<1;maxLng=mid;}}
          else{const mid=(minLat+maxLat)/2;if(lat>mid){hashVal=(hashVal<<1)|1;minLat=mid;}else{hashVal=hashVal<<1;maxLat=mid;}}
          isEven=!isEven;bits++;
          if(bits===5){hash+=BASE32[hashVal];bitsTotal+=5;bits=0;hashVal=0;}
        }
        return hash;
      }catch{return "";}
    })();
    return{lat,lng,dd,ddSimple,ddSigned,dmsStr,utmStr,mgrsStr,geohash,utm};
  }

  function parseConvInput(raw){
    const q=raw.trim();
    if(!q)return null;
    const ll=q.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
    if(ll){const la=parseFloat(ll[1]),lo=parseFloat(ll[2]);if(isFinite(la)&&isFinite(lo)&&la>=-90&&la<=90&&lo>=-180&&lo<=180)return buildConvResult(la,lo);}
    const utmP=parseUTM(q);
    if(utmP){const ll2=utmToLatLng(utmP.zone,utmP.band,utmP.easting,utmP.northing);if(ll2&&isFinite(ll2.lat))return buildConvResult(ll2.lat,ll2.lng);}
    const mgrsP=parseMGRS(q);
    if(mgrsP&&isFinite(mgrsP.lat))return buildConvResult(mgrsP.lat,mgrsP.lng);
    const parts=q.split(/,\s*|\s+(?=[NS\d])/i);
    if(parts.length>=2){
      const la=parseDMS(parts[0]),lo=parseDMS(parts[1]);
      if(la!==null&&lo!==null)return buildConvResult(la,lo);
    }
    return null;
  }

  function handleConvSubmit(e){
    e?.preventDefault();
    setConvError("");setConvResult(null);
    if(!convInput.trim()){setConvError("Enter a coordinate to convert.");return;}
    const r=parseConvInput(convInput);
    if(r)setConvResult(r);
    else setConvError("Could not parse — try: \"20.29, 85.82\", \"44N 400000E 2200000N\", \"43C MU 23450 45678\", or \"20°17'42\"N, 85°49'30\"E\"");
  }

  function convFlyTo(){
    if(!convResult||!ready)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(convResult.lng,convResult.lat,8000),duration:2});
    viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(convResult.lng,convResult.lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#a78bfa"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});
  }

  function copyConv(text,key){
    navigator.clipboard?.writeText(text).catch(()=>{});
    setConvCopied(key);setTimeout(()=>setConvCopied(""),1800);
  }

  useEffect(()=>{
    if(!ready)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(convPickRef.current){convPickRef.current.destroy();convPickRef.current=null;}
    if(!convPickMode)return;
    const handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    convPickRef.current=handler;
    viewer.scene.canvas.style.cursor="crosshair";
    handler.setInputAction(click=>{
      const ray=viewer.camera.getPickRay(click.position);if(!ray)return;
      const pos=viewer.scene.globe.pick(ray,viewer.scene);if(!pos)return;
      const carto=Cesium.Cartographic.fromCartesian(pos);
      const lat=Cesium.Math.toDegrees(carto.latitude),lng=Cesium.Math.toDegrees(carto.longitude);
      const r=buildConvResult(lat,lng);
      if(r){
        setConvInput(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        setConvResult(r);setConvError("");
        viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:12,color:Cesium.Color.fromCssColorString("#a78bfa"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});
      }
      setConvPickMode(false);
    },Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return()=>{
      if(convPickRef.current){convPickRef.current.destroy();convPickRef.current=null;}
      if(viewer&&!viewer.isDestroyed())viewer.scene.canvas.style.cursor="default";
    };
  },[convPickMode,ready]); // eslint-disable-line

  // ── SEARCH ENGINE ─────────────────────────────────────────────────────────
  async function handleSearch(e){
    e.preventDefault();if(!searchQ.trim()||!ready)return;
    setSearchLoading(true);setLocationInfo(null);
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    try{
      const q=searchQ.trim();
      const llMatch=q.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
      if(llMatch){
        const lat=parseFloat(llMatch[1]),lng=parseFloat(llMatch[2]);
        if(isFinite(lat)&&isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180){
          viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lng,lat,5000),duration:2});
          viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#60d8a0"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});
          setLocationInfo({lat,lng,name:`${lat.toFixed(6)}°, ${lng.toFixed(6)}°`,details:"Decimal coordinates"});
          setSearchLoading(false);return;
        }
      }
      const utmParsed=parseUTM(q);
      if(utmParsed){
        const ll=utmToLatLng(utmParsed.zone,utmParsed.band,utmParsed.easting,utmParsed.northing);
        if(ll&&isFinite(ll.lat)&&isFinite(ll.lng)){
          viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(ll.lng,ll.lat,8000),duration:2});
          viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(ll.lng,ll.lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#60d8a0"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});
          setLocationInfo({lat:ll.lat,lng:ll.lng,name:formatUTM(utmParsed),details:`UTM Zone ${utmParsed.zone}${utmParsed.band}`});
          setSearchLoading(false);return;
        }
      }
      const mgrsParsed=parseMGRS(q);
      if(mgrsParsed&&isFinite(mgrsParsed.lat)&&isFinite(mgrsParsed.lng)){
        viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(mgrsParsed.lng,mgrsParsed.lat,8000),duration:2});
        viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(mgrsParsed.lng,mgrsParsed.lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#f0c060"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});
        setLocationInfo({lat:mgrsParsed.lat,lng:mgrsParsed.lng,name:q.toUpperCase(),details:`MGRS → ${mgrsParsed.lat.toFixed(6)}°, ${mgrsParsed.lng.toFixed(6)}°`});
        setSearchLoading(false);return;
      }
      const camCart=viewer.camera.positionWC;
      const camCarto=Cesium.Cartographic.fromCartesian(camCart);
      const camLat=isFinite(Cesium.Math.toDegrees(camCarto.latitude))?Cesium.Math.toDegrees(camCarto.latitude):20.5937;
      const camLng=isFinite(Cesium.Math.toDegrees(camCarto.longitude))?Cesium.Math.toDegrees(camCarto.longitude):78.9629;
      function extractNomName(r){const addr=r.address||{};return addr.hamlet||addr.village||addr.town||addr.suburb||addr.city_district||addr.city||addr.county||addr.state_district||addr.state||r.display_name?.split(",")[0]?.trim()||"";}
      function buildDetails(r){const addr=r.address||{};const parts=[];const primary=extractNomName(r);const candidates=[addr.village,addr.town,addr.suburb,addr.city_district,addr.city,addr.county,addr.state_district,addr.state,addr.country];for(const c of candidates){if(c&&c!==primary&&!parts.includes(c))parts.push(c);if(parts.length>=3)break;}return parts.join(", ");}
      async function searchNominatim(query,extraParams=""){const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=15&addressdetails=1&polygon_geojson=1&accept-language=en${extraParams}`;const res=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{"Accept":"application/json","User-Agent":"SurveyMapPro/1.0"}});if(!res.ok)throw new Error(`Nominatim ${res.status}`);return res.json();}
      async function searchPhoton(query){const url=`https://photon.komoot.io/api?q=${encodeURIComponent(query)}&limit=15&lang=en&lat=${camLat}&lon=${camLng}`;const res=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!res.ok)throw new Error(`Photon ${res.status}`);const j=await res.json();return(j?.features||[]).map(feat=>{const p=feat.properties||{};const[lng,lat]=feat.geometry?.coordinates||[];if(!isFinite(lat)||!isFinite(lng))return null;const address={hamlet:p.type==="hamlet"?p.name:null,village:p.type==="village"?p.name:(p.osm_type==="N"&&p.type==="locality"?p.name:null),town:p.type==="town"?p.name:null,suburb:p.type==="suburb"||p.type==="neighbourhood"?p.name:null,city:p.type==="city"?p.name:(p.city||p.town||null),county:p.county||null,state:p.state||null,country:p.country||null};const name=p.name||p.city||p.town||p.village||`${lat.toFixed(5)},${lng.toFixed(5)}`;return{lat:String(lat),lon:String(lng),display_name:[name,p.city||p.town||p.village,p.state,p.country].filter(Boolean).join(", "),type:p.type||p.osm_type||"place",class:p.osm_key||"place",address,geojson:null,boundingbox:p.extent?[String(p.extent[3]),String(p.extent[1]),String(p.extent[0]),String(p.extent[2])]:null,_primaryName:name,_photon:true};}).filter(Boolean);}
      async function searchOverpass(name){const r=200000;const esc=name.replace(/["\\/]/g,"").trim();if(!esc)return[];const ql=`[out:json][timeout:12];(node["name"="${esc}"](around:${r},${camLat},${camLng});way["name"="${esc}"](around:${r},${camLat},${camLng});relation["name"="${esc}"](around:${r},${camLat},${camLng});node["name:en"="${esc}"](around:${r},${camLat},${camLng});node["name"~"^${esc}$","i"](around:${r},${camLat},${camLng}););out center 20;`;const res=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:`data=${encodeURIComponent(ql)}`,signal:AbortSignal.timeout(12000),headers:{"Content-Type":"application/x-www-form-urlencoded"}});if(!res.ok)throw new Error(`Overpass ${res.status}`);const j=await res.json();return(j.elements||[]).map(el=>{const elLat=el.lat??el.center?.lat;const elLng=el.lon??el.center?.lon;if(!isFinite(elLat)||!isFinite(elLng))return null;const elName=el.tags?.name||el.tags?.["name:en"]||esc;const village=el.tags?.place==="village"||el.tags?.place==="hamlet"?elName:null;const town=el.tags?.place==="town"||el.tags?.place==="city"?elName:null;const addr={village,town,city:el.tags?.["addr:city"]||null,state:el.tags?.["addr:state"]||el.tags?.["is_in:state"]||null,country:el.tags?.["addr:country"]||null};return{lat:String(elLat),lon:String(elLng),display_name:[elName,addr.city||addr.state,"India"].filter(Boolean).join(", "),type:el.tags?.place||el.tags?.amenity||el.tags?.leisure||el.type||"place",class:"overpass",address:addr,geojson:null,boundingbox:null,_primaryName:elName,_overpass:true};}).filter(Boolean);}
      function scoreResult(r,queryLower){let score=0;const name=(r._primaryName||r.display_name?.split(",")[0]||"").toLowerCase().trim();if(name===queryLower)score+=100;else if(name.startsWith(queryLower))score+=60;else if(name.includes(queryLower))score+=30;const typeScore={village:18,hamlet:17,town:16,suburb:15,neighbourhood:14,locality:13,city:12,quarter:11,road:8,residential:7,commercial:6,place:5,administrative:3,county:2,state:1,country:0};score+=(typeScore[r.type]||typeScore[r.class]||4);if(r._overpass)score+=25;const lat=parseFloat(r.lat),lng=parseFloat(r.lon);if(isFinite(lat)&&isFinite(lng)){const distDeg=Math.sqrt((lat-camLat)**2+(lng-camLng)**2);score+=Math.max(0,10-distDeg*0.5);}return score;}
      const queryLower=q.toLowerCase().trim();
      const shortQ=q.split(",")[0].trim();
      const[nomRes,photonRes,overpassRes,nomShortRes]=await Promise.allSettled([searchNominatim(q),searchPhoton(q),searchOverpass(shortQ),shortQ!==q?searchNominatim(shortQ):Promise.resolve([])]);
      let allResults=[];
      if(nomRes.status==="fulfilled")allResults.push(...(nomRes.value||[]));
      if(photonRes.status==="fulfilled")allResults.push(...(photonRes.value||[]));
      if(overpassRes.status==="fulfilled")allResults.push(...(overpassRes.value||[]));
      if(nomShortRes.status==="fulfilled")allResults.push(...(nomShortRes.value||[]));
      allResults=allResults.filter(r=>{const lat=parseFloat(r.lat),lng=parseFloat(r.lon);return isFinite(lat)&&isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;});
      if(!allResults.length){try{const fallback=await searchNominatim(shortQ,"&limit=5");allResults.push(...(fallback||[]));}catch(err){console.warn("Fallback search failed:",err);}}
      if(!allResults.length){alert(`Location "${q}" not found.\n\nTips:\n• Use shorter name\n• Add city context\n• Try coordinates: "20.2961, 85.8245"`);setSearchLoading(false);return;}
      allResults.sort((a,b)=>scoreResult(b,queryLower)-scoreResult(a,queryLower));
      const place=allResults[0];
      const lat=parseFloat(place.lat),lng=parseFloat(place.lon);
      if(!isFinite(lat)||!isFinite(lng)){setSearchLoading(false);return;}
      let altitude=3000;
      if(place.boundingbox){const[s,n,w,east]=place.boundingbox.map(Number);const spanDeg=Math.max(n-s,east-w);altitude=Math.min(Math.max(spanDeg*111320*1.4,300),8000000);}
      else{const typeAlt={country:4000000,state:800000,county:200000,city:50000,town:25000,village:8000,hamlet:5000,suburb:8000,neighbourhood:3000,locality:6000,road:600,house:200,place:4000,administrative:300000};altitude=typeAlt[place.type]||typeAlt[place.class]||6000;}
      viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lng,lat,altitude),duration:2.5,orientation:{heading:0,pitch:Cesium.Math.toRadians(-55),roll:0}});
      viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#3b82f6"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});
      boundaryEntsRef.current.forEach(e=>viewer.entities.remove(e));
      boundaryEntsRef.current=[];
      if(place.geojson){
        const rings=place.geojson.type==="Polygon"?[place.geojson.coordinates[0]]:place.geojson.type==="MultiPolygon"?place.geojson.coordinates.map(p=>p[0]):[];
        rings.forEach(ring=>{try{const positions=ring.map(([lo,la])=>Cesium.Cartesian3.fromDegrees(lo,la)).filter(p=>p&&isFinite(p.x)&&isFinite(p.y)&&isFinite(p.z));if(positions.length<3)return;const ent=viewer.entities.add({polygon:{hierarchy:new Cesium.PolygonHierarchy(positions),material:Cesium.Color.fromCssColorString("#3b82f6").withAlpha(0.08),outline:true,outlineColor:Cesium.Color.fromCssColorString("#60a5fa"),outlineWidth:2}});boundaryEntsRef.current.push(ent);}catch{}});
      }
      const primaryName=place._primaryName||extractNomName(place)||place.display_name?.split(",")[0]?.trim()||q;
      const details=buildDetails(place);
      setLocationInfo({lat,lng,name:primaryName,details,description:null,wikiUrl:null,photo:null});
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
      for(const ent of ds.entities.values){try{if(ent.polyline){ent.polyline.clampToGround=new Cesium.ConstantProperty(true);ent.polyline.arcType=new Cesium.ConstantProperty(Cesium.ArcType.GEODESIC);}if(ent.billboard){ent.billboard.heightReference=new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND);ent.billboard.disableDepthTestDistance=new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);}if(ent.point){ent.point.heightReference=new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND);ent.point.disableDepthTestDistance=new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);}if(ent.label){ent.label.heightReference=new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND);ent.label.disableDepthTestDistance=new Cesium.ConstantProperty(Number.POSITIVE_INFINITY);}}catch(_){}}
      viewer.dataSources.add(ds);
      const entities=ds.entities.values;
      let sumLat=0,sumLng=0,minLat=90,maxLat=-90,minLng=180,maxLng=-180,ptCount=0;
      const collectCoord=(lat,lng)=>{if(!isFinite(lat)||!isFinite(lng))return;if(lat<-90||lat>90||lng<-180||lng>180)return;sumLat+=lat;sumLng+=lng;minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);minLng=Math.min(minLng,lng);maxLng=Math.max(maxLng,lng);ptCount++;};
      for(const ent of entities){try{const pos=ent.position?.getValue(Cesium.JulianDate.now());if(pos){const c=Cesium.Cartographic.fromCartesian(pos);if(c)collectCoord(Cesium.Math.toDegrees(c.latitude),Cesium.Math.toDegrees(c.longitude));}if(ent.polygon){const h=ent.polygon.hierarchy?.getValue(Cesium.JulianDate.now());if(h?.positions)h.positions.forEach(p=>{try{const c=Cesium.Cartographic.fromCartesian(p);if(c)collectCoord(Cesium.Math.toDegrees(c.latitude),Cesium.Math.toDegrees(c.longitude));}catch{}});}if(ent.polyline){const pts=ent.polyline.positions?.getValue(Cesium.JulianDate.now());if(pts)pts.forEach(p=>{try{const c=Cesium.Cartographic.fromCartesian(p);if(c)collectCoord(Cesium.Math.toDegrees(c.latitude),Cesium.Math.toDegrees(c.longitude));}catch{}});}}catch{}}
      if(ptCount===0){viewer.flyTo(ds,{duration:3});return;}
      const cLat=sumLat/ptCount,cLng=sumLng/ptCount;
      if(!isFinite(cLat)||!isFinite(cLng)){viewer.flyTo(ds,{duration:3});return;}
      const spanLat=Math.max(maxLat-minLat,0.005),spanLng=Math.max(maxLng-minLng,0.005);
      const spanDeg=Math.max(spanLat,spanLng);
      const spanKm=(spanDeg*111.32).toFixed(1);
      const rangeM=Math.min(Math.max(spanDeg*111320*1.6,400),5000000);
      const centerCart=Cesium.Cartesian3.fromDegrees(cLng,cLat,0);
      if(!centerCart||!isFinite(centerCart.x)||!isFinite(centerCart.y)||!isFinite(centerCart.z)){viewer.flyTo(ds,{duration:3});return;}
      orbitRef.current={center:centerCart,range:rangeM,heading:0,pitch:-62,active:false};
      setKmlStats({featureCount:entities.length,center:{lat:cLat,lng:cLng},spanKm,bbox:{minLat,maxLat,minLng,maxLng}});
      setKmlFlyIn(true);
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
    if(csvPickRef.current){csvPickRef.current.destroy();csvPickRef.current=null;}
    if(csvDSRef.current){viewer.dataSources.remove(csvDSRef.current,true);csvDSRef.current=null;}
    setCsvInfo(null);setCsvStatus("loading");setCsvCount(0);
    Papa.parse(file,{header:true,skipEmptyLines:true,complete(results){
      const rows=results.data;if(!rows.length){alert("Empty CSV.");setCsvStatus("error");return;}
      const headers=Object.keys(rows[0]);
      const latKey=findColKey(headers,LAT_KEYS),lngKey=findColKey(headers,LNG_KEYS);
      if(!latKey||!lngKey){alert("CSV missing lat/lng columns.");setCsvStatus("error");return;}
      const capped=rows.slice(0,CSV_MAX);
      const ds=new Cesium.CustomDataSource("csv");
      ds.clustering.enabled=true;ds.clustering.pixelRange=50;ds.clustering.minimumClusterSize=3;
      ds.clustering.clusterEvent.addEventListener((ents,cluster)=>{const count=ents.length;cluster.point.show=true;cluster.label.show=false;cluster.point.color=count>200?Cesium.Color.fromCssColorString("#ef4444"):count>30?Cesium.Color.fromCssColorString("#f97316"):Cesium.Color.fromCssColorString("#3b82f6");cluster.point.pixelSize=count>200?34:count>30?26:18;cluster.point.outlineColor=Cesium.Color.WHITE;cluster.point.outlineWidth=2;cluster.point.disableDepthTestDistance=Number.POSITIVE_INFINITY;cluster.label.show=true;cluster.label.text=String(count);cluster.label.font="bold 12px sans-serif";cluster.label.fillColor=Cesium.Color.WHITE;cluster.label.outlineColor=Cesium.Color.BLACK;cluster.label.outlineWidth=2;cluster.label.style=Cesium.LabelStyle.FILL_AND_OUTLINE;cluster.label.verticalOrigin=Cesium.VerticalOrigin.CENTER;cluster.label.horizontalOrigin=Cesium.HorizontalOrigin.CENTER;cluster.label.disableDepthTestDistance=Number.POSITIVE_INFINITY;});
      const valid=capped.filter(row=>{const lat=parseFloat(row[latKey]),lng=parseFloat(row[lngKey]);return!isNaN(lat)&&!isNaN(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;});
      if(!valid.length){alert("No valid coordinates.");setCsvStatus("error");return;}
      processInChunks(valid,300,row=>{
        const lat=parseFloat(row[latKey]),lng=parseFloat(row[lngKey]);
        const nameVal=row.name||row.Name||row.title||null;
        const fields={};Object.keys(rows[0]).filter(k=>k!==latKey&&k!==lngKey&&row[k]!==""&&row[k]!=null&&!["name","Name","title"].includes(k)).slice(0,12).forEach(k=>{fields[k]=String(row[k]).slice(0,100);});
        ds.entities.add({name:nameVal||`${lat.toFixed(4)}, ${lng.toFixed(4)}`,position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:9,color:Cesium.Color.fromCssColorString("#22c55e"),outlineColor:Cesium.Color.WHITE,outlineWidth:1.5,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY},description:JSON.stringify({lat,lng,name:nameVal,fields})});
      },async()=>{
        await viewer.dataSources.add(ds);csvDSRef.current=ds;
        viewer.flyTo(ds,{duration:2,offset:new Cesium.HeadingPitchRange(0,Cesium.Math.toRadians(-45),0)});
        setCsvStatus("done");setCsvCount(valid.length);
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

  const tbBtn=(active)=>`g3-tbtn${active?" active":""}`;
  const chk=(active)=>({width:15,height:15,borderRadius:3,border:`2px solid ${active?"#3b82f6":"rgba(255,255,255,0.28)"}`,background:active?"#3b82f6":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0});

  return(
    <>
      <style>{CSS}</style>

      {/* MAP */}
      <div className="g3-map" ref={containerRef} style={{position:"fixed",top:TB,left:PANEL,right:0,bottom:SB,zIndex:900,background:"#0d1420"}}/>

      {/* LOADING */}
      {!ready&&!initErr&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(13,20,32,.97)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
          <div style={{width:40,height:40,border:"3px solid rgba(255,255,255,.08)",borderTopColor:"#3b82f6",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
          <div style={{color:"#64748b",fontSize:13,fontFamily:"'Segoe UI',sans-serif"}}>Loading SurveyMap 3D…</div>
        </div>
      )}
      {initErr&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(13,20,32,.97)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
          <div style={{color:"#ef4444",fontSize:15,fontWeight:700}}>⚠ Init failed</div>
          <div style={{color:"#475569",fontSize:12,maxWidth:300,textAlign:"center"}}>{initErr}</div>
          <button onClick={onClose} style={{marginTop:8,padding:"8px 20px",borderRadius:6,border:"none",background:"#3b82f6",color:"#fff",fontWeight:600,cursor:"pointer"}}>← Back to 2D</button>
        </div>
      )}

      {/* TOP BAR */}
      <div style={{position:"fixed",top:0,left:0,right:0,height:TB,zIndex:1100,background:"#141e2e",borderBottom:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",padding:"0 0 0 12px",fontFamily:"'Segoe UI',system-ui,sans-serif",boxShadow:"0 2px 12px rgba(0,0,0,.4)"}}>
        <div style={{display:"flex",alignItems:"center",gap:7,paddingRight:14,borderRight:"1px solid rgba(255,255,255,.08)",marginRight:4,minWidth:0}}>
          <div style={{width:22,height:22,borderRadius:5,background:"linear-gradient(135deg,#3b82f6,#06b6d4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>🌍</div>
          <span style={{color:"#f1f5f9",fontWeight:700,fontSize:13,whiteSpace:"nowrap"}}>SurveyMap Pro</span>
        </div>
        <button className="g3-ham" onClick={()=>setPanelOpen(p=>!p)}
          style={{display:"none",width:36,height:36,borderRadius:6,border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.05)",color:"#94a3b8",cursor:"pointer",fontSize:18,alignItems:"center",justifyContent:"center",marginRight:6,flexShrink:0}}>
          ☰
        </button>
        {LAYERS.slice(0,6).map(l=>(
          <button key={l.key} className={tbBtn(activeLayer===l.key)} onClick={()=>setActiveLayer(l.key)}>
            <span style={{fontSize:15}}>{l.icon}</span>
            <span className="g3-tb-lbl">{l.label}</span>
          </button>
        ))}
        <div style={{width:1,height:22,background:"rgba(255,255,255,.07)",margin:"0 4px",flexShrink:0}}/>
        {[{icon:"✏️",label:"Draw",active:drawMode,action:()=>{setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}},
          {icon:"📏",label:"Measure",active:measureMode,action:()=>setMeasureMode(true)},
          {icon:"📐",label:"Survey",active:surveyMode,action:()=>setSurveyMode(true)},
          {icon:"📈",label:"Elevation",active:elevMode,action:()=>{
            if(elevMode){
              setElevMode(false);setElevPoints([]);setElevProfile(null);
              elevPtsRef.current=[];
              const viewer=viewerRef.current;
              elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});
              elevEntsRef.current=[];
            }else{setElevMode(true);setElevPoints([]);setElevProfile(null);}
          }}].map(({icon,label,active,action})=>(
          <button key={label} className={tbBtn(active)} onClick={action}>
            <span style={{fontSize:15}}>{icon}</span><span className="g3-tb-lbl">{label}</span>
          </button>
        ))}
        <button className={tbBtn(false)}>
          <label style={{cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:15}}>📄</span><span className="g3-tb-lbl">KML/KMZ</span>
            <input type="file" accept=".kml,.kmz" onChange={handleKML} style={{display:"none"}}/>
          </label>
        </button>
        <button className={tbBtn(false)}>
          <label style={{cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:15}}>📊</span><span className="g3-tb-lbl">CSV</span>
            <input type="file" accept=".csv" onChange={handleCSV} style={{display:"none"}}/>
          </label>
        </button>
        <div style={{width:1,height:22,background:"rgba(255,255,255,.07)",margin:"0 4px",flexShrink:0}}/>
        <button className={tbBtn(heatmapOpen)} onClick={()=>setHeatmapOpen(p=>!p)}>
          <span style={{fontSize:15}}>🌡️</span><span className="g3-tb-lbl">Heatmap</span>
        </button>
        <button className={tbBtn(sliderOpen)} onClick={()=>setSliderOpen(p=>!p)}>
          <span style={{fontSize:15}}>🛰️</span><span className="g3-tb-lbl">Timeline</span>
        </button>
        <button className={tbBtn(droneOpen)} onClick={()=>setDroneOpen(p=>!p)}>
          <span style={{fontSize:15}}>🚁</span><span className="g3-tb-lbl">Drone</span>
        </button>
        <button className={tbBtn(nightAuto)} onClick={()=>setNightAuto(p=>!p)}>
          <span style={{fontSize:15}}>🌙</span><span className="g3-tb-lbl">Night</span>
        </button>
        <button className={tbBtn(coordConvOpen)} onClick={()=>setCoordConvOpen(p=>!p)}>
          <span style={{fontSize:15}}>🔄</span><span className="g3-tb-lbl">Coords</span>
        </button>
        <div style={{marginLeft:"auto",paddingRight:12}}>
          <button onClick={onClose} style={{padding:"6px 14px",borderRadius:5,border:"1px solid rgba(255,255,255,.14)",background:"transparent",color:"#94a3b8",fontSize:12,cursor:"pointer",fontWeight:500,whiteSpace:"nowrap"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color="#f1f5f9";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
            ← 2D
          </button>
        </div>
      </div>

      {/* mobile backdrop */}
      {panelOpen&&<div onClick={()=>setPanelOpen(false)} style={{position:"fixed",inset:0,zIndex:1240,background:"rgba(0,0,0,.45)"}}/>}

      {/* LEFT PANEL */}
      <div className={`g3-panel${panelOpen?" open":""}`}>
        <button className="g3-ham" onClick={()=>setPanelOpen(false)}
          style={{display:"none",position:"absolute",top:8,right:8,width:28,height:28,borderRadius:"50%",border:"1px solid rgba(255,255,255,.15)",background:"rgba(255,255,255,.06)",color:"#94a3b8",cursor:"pointer",fontSize:14,zIndex:10,alignItems:"center",justifyContent:"center"}}>
          ✕
        </button>

        {/* SEARCH */}
        <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
          <div style={{color:"#475569",fontSize:10,fontWeight:700,letterSpacing:".07em",marginBottom:6,fontFamily:"'Segoe UI',sans-serif"}}>🔍 SEARCH</div>
          <form onSubmit={handleSearch} style={{display:"flex",gap:4}}>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Place, village, city or 20.29, 85.82…"
              style={{flex:1,padding:"7px 10px",borderRadius:5,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.05)",color:"#e2e8f0",fontSize:11,outline:"none",fontFamily:"inherit"}}/>
            <button type="submit" disabled={searchLoading} style={{padding:"7px 10px",borderRadius:5,border:"none",background:"#3b82f6",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>{searchLoading?"…":"↵"}</button>
          </form>
          <button onClick={handleGPS} style={{marginTop:6,width:"100%",padding:"6px",borderRadius:5,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.04)",color:"#94a3b8",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4,fontFamily:"'Segoe UI',sans-serif"}}>
            📍 My Location
          </button>
        </div>

        {/* PLACES */}
        <div>
          <div className="g3-sec-h" onClick={()=>toggleSec("places")}><span>⭐ PLACES</span><span style={{fontSize:9}}>{openSec.places?"▾":"▸"}</span></div>
          {openSec.places&&(
            <div className="g3-sec-body">
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7}}><span style={{fontSize:12}}>⭐</span><span style={{color:"#e2e8f0",fontSize:12,fontWeight:600,fontFamily:"'Segoe UI',sans-serif"}}>My Places</span></div>
              {localDrawings.length===0&&<div style={{color:"#334155",fontSize:10,fontStyle:"italic",marginBottom:7,fontFamily:"'Segoe UI',sans-serif"}}>No drawings yet</div>}
              {localDrawings.map((d,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 4px",borderRadius:4,marginBottom:1}}>
                  <span style={{fontSize:11}}>{d.type==="path"?"〰️":d.type==="polygon"?"⬡":"📍"}</span>
                  <span style={{color:"#94a3b8",fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"'Segoe UI',sans-serif"}}>{d.name}</span>
                </div>
              ))}
              <div style={{display:"flex",gap:4,marginTop:7}}>
                <button onClick={()=>{setDrawType("marker");setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}} style={{flex:1,padding:"5px 4px",borderRadius:5,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.04)",color:"#94a3b8",fontSize:10,cursor:"pointer"}}>📍 Mark</button>
                <button onClick={()=>{setDrawType("path");setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}} style={{flex:1,padding:"5px 4px",borderRadius:5,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.04)",color:"#94a3b8",fontSize:10,cursor:"pointer"}}>〰 Path</button>
              </div>
              {localDrawings.length>0&&(
                <div style={{marginTop:8}}>
                  <div style={{color:"#334155",fontSize:10,marginBottom:4,fontWeight:600,letterSpacing:".05em",fontFamily:"'Segoe UI',sans-serif"}}>EXPORT</div>
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    {[["📌 KML",()=>dlFile(toKML(localDrawings),"survey.kml","application/vnd.google-earth.kml+xml")],["🌐 GeoJSON",()=>dlFile(JSON.stringify(toGeoJSON(localDrawings),null,2),"survey.geojson","application/geo+json")],["📊 CSV",()=>dlFile(toCSV(localDrawings),"survey.csv","text/csv")]].map(([lb,fn])=>(
                      <button key={lb} onClick={fn} style={{padding:"5px 8px",borderRadius:5,border:"1px solid rgba(255,255,255,.07)",background:"rgba(255,255,255,.03)",color:"#94a3b8",fontSize:10,cursor:"pointer",textAlign:"left"}}>{lb}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* LAYERS */}
        <div>
          <div className="g3-sec-h" onClick={()=>toggleSec("layers")}><span>🗂 LAYERS</span><span style={{fontSize:9}}>{openSec.layers?"▾":"▸"}</span></div>
          {openSec.layers&&(
            <div className="g3-sec-body">
              <div className="g3-layer-row" onClick={()=>setNightAuto(p=>!p)} style={{background:nightAuto?"rgba(59,130,246,.12)":"transparent",border:`1px solid ${nightAuto?"rgba(59,130,246,.35)":"transparent"}`,borderRadius:5,marginBottom:6}}>
                <div style={chk(nightAuto)}>{nightAuto&&<span style={{color:"#fff",fontSize:9}}>✓</span>}</div>
                <span style={{fontSize:12}}>🌙</span><span style={{color:nightAuto?"#e2e8f0":"#94a3b8",fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>Auto Night Mode</span>
              </div>
              {LAYERS.map(l=>(
                <div key={l.key} className="g3-layer-row" onClick={()=>setActiveLayer(l.key)} style={{background:activeLayer===l.key?"rgba(59,130,246,.15)":"transparent",border:`1px solid ${activeLayer===l.key?"rgba(59,130,246,.4)":"transparent"}`,borderRadius:5}}>
                  <div style={chk(activeLayer===l.key)}>{activeLayer===l.key&&<span style={{color:"#fff",fontSize:9}}>✓</span>}</div>
                  <span style={{fontSize:12}}>{l.icon}</span><span style={{color:activeLayer===l.key?"#e2e8f0":"#94a3b8",fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>{l.label}</span>
                </div>
              ))}
              {csvStatus&&(
                <div style={{marginTop:8,padding:"5px 8px",borderRadius:5,background:csvStatus==="done"?"rgba(34,197,94,.08)":csvStatus==="error"?"rgba(239,68,68,.08)":"rgba(251,191,36,.08)",border:`1px solid ${csvStatus==="done"?"#22c55e":csvStatus==="error"?"#ef4444":"#fbbf24"}`,color:csvStatus==="done"?"#22c55e":csvStatus==="error"?"#ef4444":"#fbbf24",fontSize:10,fontWeight:600,fontFamily:"'Segoe UI',sans-serif"}}>
                  {csvStatus==="loading"?"⏳ Loading…":csvStatus==="done"?`✅ ${csvCount.toLocaleString()} pts`:"❌ Error"}
                </div>
              )}

              {/* DEM Terrain Visualization */}
              <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.06)"}}>
                <div style={{color:"#334155",fontSize:10,fontWeight:700,letterSpacing:".05em",marginBottom:6,fontFamily:"'Segoe UI',sans-serif"}}>🌍 DEM VISUALIZATION</div>
                <div className="g3-layer-row" onClick={()=>setDemEnabled(p=>!p)}
                  style={{background:demEnabled?"rgba(34,197,94,.1)":"transparent",border:`1px solid ${demEnabled?"rgba(34,197,94,.35)":"transparent"}`,borderRadius:5,marginBottom:6}}>
                  <div style={chk(demEnabled)}>{demEnabled&&<span style={{color:"#fff",fontSize:9}}>✓</span>}</div>
                  <span style={{fontSize:12}}>🗺️</span>
                  <span style={{color:demEnabled?"#e2e8f0":"#94a3b8",fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>Terrain Colors + Shading</span>
                  {demEnabled&&<span style={{marginLeft:"auto",fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(34,197,94,.25)",color:"#4ade80"}}>ON</span>}
                </div>
                {demEnabled&&(
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{display:"flex",gap:3}}>
                      {[["hypsometric","🎨 Colors"],["slope","⛰️ Shading"],["both","✨ Both"]].map(([v,label])=>(
                        <button key={v} onClick={()=>setDemStyle(v)}
                          style={{flex:1,padding:"4px 2px",borderRadius:4,fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"'Segoe UI',sans-serif",border:`1px solid ${demStyle===v?"rgba(34,197,94,.5)":"rgba(255,255,255,.08)"}`,background:demStyle===v?"rgba(34,197,94,.18)":"transparent",color:demStyle===v?"#4ade80":"#475569"}}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:9,color:"#475569",fontWeight:700,width:44,fontFamily:"'Segoe UI',sans-serif"}}>OPACITY</span>
                      <input type="range" min={0.1} max={1} step={0.05} value={demOpacity} onChange={e=>setDemOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:"#22c55e",cursor:"pointer"}}/>
                      <span style={{fontSize:9,color:"#4ade80",fontFamily:"monospace",width:28,textAlign:"right"}}>{Math.round(demOpacity*100)}%</span>
                    </div>
                    <div style={{padding:"6px 8px",background:"rgba(0,0,0,.25)",borderRadius:5}}>
                      <div style={{fontSize:9,color:"#475569",fontWeight:700,marginBottom:4,fontFamily:"'Segoe UI',sans-serif"}}>ELEVATION COLOUR RAMP</div>
                      <div style={{height:10,borderRadius:3,background:"linear-gradient(to right,#1a237e,#1565c0,#0277bd,#00838f,#2e7d32,#558b2f,#f9a825,#e65100,#b71c1c,#4a148c)",marginBottom:4}}/>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#334155",fontFamily:"monospace"}}>
                        <span>−400m</span><span>0m</span><span>500m</span><span>1000m</span><span>2000m+</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3D Buildings */}
              <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.06)"}}>
                <div style={{color:"#334155",fontSize:10,fontWeight:700,letterSpacing:".05em",marginBottom:6,fontFamily:"'Segoe UI',sans-serif"}}>🏙️ 3D BUILDINGS</div>
                <div className="g3-layer-row" onClick={()=>{if(!buildingsLoading)setBuildingsEnabled(p=>!p);}}
                  style={{background:buildingsEnabled?"rgba(59,130,246,.12)":"transparent",border:`1px solid ${buildingsEnabled?"rgba(59,130,246,.35)":"transparent"}`,borderRadius:5,marginBottom:5,opacity:buildingsLoading?0.6:1}}>
                  <div style={chk(buildingsEnabled)}>{buildingsEnabled&&!buildingsLoading&&<span style={{color:"#fff",fontSize:9}}>✓</span>}{buildingsLoading&&<span style={{color:"#60a5fa",fontSize:9,display:"inline-block",animation:"spin 1s linear infinite"}}>↻</span>}</div>
                  <span style={{fontSize:12}}>🏢</span>
                  <span style={{color:buildingsEnabled?"#e2e8f0":"#94a3b8",fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>{buildingsLoading?"Loading…":"OSM Buildings (3D)"}</span>
                  {buildingsEnabled&&!buildingsLoading&&<span style={{marginLeft:"auto",fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(59,130,246,.3)",color:"#60a5fa"}}>ON</span>}
                </div>
                {buildingsEnabled&&!buildingsLoading&&(
                  <div style={{fontSize:10,color:"#475569",fontFamily:"'Segoe UI',sans-serif",padding:"4px 8px",background:"rgba(0,0,0,.2)",borderRadius:4,lineHeight:1.5}}>
                    🔍 Zoom into a city to see buildings. Colours indicate type:
                    <div style={{display:"flex",flexWrap:"wrap",gap:"4px 8px",marginTop:4}}>
                      {[["#cbd5e1","Residential"],["#60a5fa","Commercial"],["#ef4444","Hospital"],["#f59e0b","School"],["#a78bfa","Religious"],["#6b7280","Industrial"]].map(([c,l])=>(
                        <span key={l} style={{display:"flex",alignItems:"center",gap:3,fontSize:9,color:"#64748b"}}>
                          <span style={{width:8,height:8,borderRadius:2,background:c,display:"inline-block"}}></span>{l}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* UTM/MGRS Grid */}
              <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.06)"}}>
                <div style={{color:"#334155",fontSize:10,fontWeight:700,letterSpacing:".05em",marginBottom:6,fontFamily:"'Segoe UI',sans-serif"}}>🔲 COORDINATE GRID</div>
                <div className="g3-layer-row" onClick={()=>setGridEnabled(p=>!p)}
                  style={{background:gridEnabled?"rgba(59,130,246,.12)":"transparent",border:`1px solid ${gridEnabled?"rgba(59,130,246,.35)":"transparent"}`,borderRadius:5,marginBottom:5}}>
                  <div style={chk(gridEnabled)}>{gridEnabled&&<span style={{color:"#fff",fontSize:9}}>✓</span>}</div>
                  <span style={{fontSize:12}}>🗺</span>
                  <span style={{color:gridEnabled?"#e2e8f0":"#94a3b8",fontSize:11,fontFamily:"'Segoe UI',sans-serif"}}>Show Grid Overlay</span>
                  {gridEnabled&&<span style={{marginLeft:"auto",fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(59,130,246,.3)",color:"#60a5fa"}}>ON</span>}
                </div>
                {gridEnabled&&(
                  <>
                    <div style={{display:"flex",gap:3,marginBottom:6}}>
                      {[["LatLng","🌐","Graticule"],["UTM","🔵","UTM Zones"],["MGRS","🟡","MGRS Grid"]].map(([m,dot,desc])=>(
                        <button key={m} onClick={()=>setGridMode(m)}
                          style={{flex:1,padding:"5px 2px",borderRadius:4,border:`1px solid ${gridMode===m?"rgba(59,130,246,.5)":"rgba(255,255,255,.08)"}`,background:gridMode===m?"rgba(59,130,246,.2)":"transparent",color:gridMode===m?"#60a5fa":"#475569",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"'Segoe UI',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                          <span>{dot} {m}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{padding:"6px 8px",background:"rgba(0,0,0,.2)",borderRadius:5,fontSize:9,color:"#334155",lineHeight:1.6,fontFamily:"'Segoe UI',sans-serif"}}>
                      {gridMode==="LatLng"&&"📐 Lat/Lng graticule — adaptive density, DMS labels. Zooms in for finer lines."}
                      {gridMode==="UTM"&&"🔵 UTM 6°×8° zones — blue columns, band rows. Sub-grid at closer zoom."}
                      {gridMode==="MGRS"&&"🟡 MGRS NATO grid — zone+band boundaries, 100km square IDs at close zoom."}
                    </div>
                  </>
                )}
                <div style={{color:"#334155",fontSize:9,fontWeight:700,letterSpacing:".05em",margin:"8px 0 4px",fontFamily:"'Segoe UI',sans-serif"}}>COORD DISPLAY</div>
                <div style={{display:"flex",gap:3}}>
                  {["LatLng","UTM","MGRS"].map(mode=>(
                    <button key={mode} onClick={()=>setCoordDisplay(mode)}
                      style={{flex:1,padding:"3px 4px",borderRadius:4,border:`1px solid ${coordDisplay===mode?"rgba(59,130,246,.5)":"rgba(255,255,255,.08)"}`,background:coordDisplay===mode?"rgba(59,130,246,.2)":"transparent",color:coordDisplay===mode?"#60a5fa":"#475569",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"'Segoe UI',sans-serif"}}>
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TOOLS */}
        <div>
          <div className="g3-sec-h" onClick={()=>toggleSec("tools")}><span>🔧 TOOLS</span><span style={{fontSize:9}}>{openSec.tools?"▾":"▸"}</span></div>
          {openSec.tools&&(
            <div className="g3-sec-body">
              <div style={{color:"#334155",fontSize:10,fontWeight:700,marginBottom:6,letterSpacing:".05em",fontFamily:"'Segoe UI',sans-serif"}}>DRAW</div>
              <div style={{display:"flex",gap:4,marginBottom:8}}>
                {[["path","〰️","Path"],["polygon","⬡","Poly"],["marker","📍","Pin"]].map(([t,icon,lb])=>(
                  <button key={t} onClick={()=>setDrawType(t)} style={{flex:1,padding:"6px 2px",borderRadius:5,border:"none",cursor:"pointer",fontSize:10,fontWeight:600,display:"flex",flexDirection:"column",alignItems:"center",gap:1,background:drawType===t?"#f97316":"rgba(255,255,255,.05)",color:drawType===t?"#fff":"#475569",transition:"all .15s",fontFamily:"'Segoe UI',sans-serif"}}>
                    <span style={{fontSize:14}}>{icon}</span><span>{lb}</span>
                  </button>
                ))}
              </div>
              {!drawMode
                ?<button className="g3-primary" onClick={()=>{setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}} style={{background:"#f97316"}}>▶ Start Drawing</button>
                :<div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{background:"rgba(249,115,22,.1)",border:"1px solid rgba(249,115,22,.35)",borderRadius:5,padding:"5px 8px",color:"#fb923c",fontSize:10,fontWeight:600,textAlign:"center",fontFamily:"'Segoe UI',sans-serif"}}>{drawType==="marker"?"Click globe to place":`${drawPoints.length} pts`}</div>
                  <div style={{display:"flex",gap:5}}>
                    <button onClick={finishDrawing} style={{flex:1,padding:"7px",borderRadius:5,border:"none",background:"#16a34a",color:"#fff",fontWeight:600,fontSize:11,cursor:"pointer"}}>✅ Done</button>
                    <button onClick={cancelDrawing} style={{flex:1,padding:"7px",borderRadius:5,border:"none",background:"#dc2626",color:"#fff",fontWeight:600,fontSize:11,cursor:"pointer"}}>✖ Cancel</button>
                  </div>
                </div>
              }
              <div style={{color:"#334155",fontSize:10,fontWeight:700,margin:"14px 0 6px",letterSpacing:".05em",fontFamily:"'Segoe UI',sans-serif"}}>MEASURE</div>
              {!measureMode
                ?<button className="g3-primary" onClick={()=>setMeasureMode(true)} style={{background:"#0891b2"}}>📐 Start Measuring</button>
                :<div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{background:"rgba(250,204,21,.07)",border:"1px solid rgba(250,204,21,.28)",borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
                    <div style={{color:"#64748b",fontSize:9,fontWeight:700,fontFamily:"'Segoe UI',sans-serif"}}>DISTANCE</div>
                    <div style={{color:"#facc15",fontSize:17,fontWeight:800,fontFamily:"monospace"}}>{measurePoints.length<2?"—":formatDist(totalDist,measureUnit)}</div>
                    <div style={{color:"#475569",fontSize:9,fontFamily:"'Segoe UI',sans-serif"}}>{measurePoints.length} pts</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3}}>
                    {[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"],["nmi","nmi"]].map(([u,lb])=>(
                      <button key={u} onClick={()=>setMeasureUnit(u)} style={{padding:"3px 4px",borderRadius:4,border:"none",cursor:"pointer",fontSize:10,fontWeight:600,background:measureUnit===u?"#0891b2":"rgba(255,255,255,.05)",color:measureUnit===u?"#fff":"#475569"}}>{lb}</button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={resetMeasure} style={{flex:1,padding:"5px",borderRadius:5,border:"1px solid rgba(255,255,255,.07)",background:"transparent",color:"#475569",fontSize:10,cursor:"pointer"}}>🔄 Reset</button>
                    <button onClick={clearMeasure} style={{flex:1,padding:"5px",borderRadius:5,border:"none",background:"#dc2626",color:"#fff",fontWeight:600,fontSize:10,cursor:"pointer"}}>✖ Done</button>
                  </div>
                </div>
              }
              <div style={{color:"#334155",fontSize:10,fontWeight:700,margin:"14px 0 6px",letterSpacing:".05em",fontFamily:"'Segoe UI',sans-serif"}}>SURVEY</div>
              {!surveyMode
                ?<button className="g3-primary" onClick={()=>setSurveyMode(true)} style={{background:"#7c3aed"}}>▶ Start Survey</button>
                :<><div style={{background:"rgba(220,38,38,.08)",border:"1px solid rgba(220,38,38,.35)",borderRadius:5,padding:"5px 8px",color:"#fca5a5",fontSize:10,fontWeight:600,textAlign:"center",marginBottom:5,fontFamily:"'Segoe UI',sans-serif"}}>● ACTIVE · {surveyRoute.length} pt{surveyRoute.length!==1?"s":""}</div><button className="g3-primary" onClick={clearSurvey} style={{background:"#dc2626"}}>⏹ Stop Survey</button></>
              }
            </div>
          )}
        </div>

        {/* VIEW MODE */}
        <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
          <div style={{color:"#334155",fontSize:10,fontWeight:700,marginBottom:7,letterSpacing:".05em",fontFamily:"'Segoe UI',sans-serif"}}>🌐 VIEW MODE</div>
          <div style={{display:"flex",gap:4}}>
            {[["3D","🌍","Globe"],["2D","🗺","Flat"],["Columbus","🧭","Col"]].map(([mode,icon,label])=>(
              <button key={mode} onClick={()=>setViewMode(mode)} style={{flex:1,padding:"7px 4px",borderRadius:5,border:`1px solid ${viewMode===mode?"rgba(59,130,246,.5)":"rgba(255,255,255,.07)"}`,background:viewMode===mode?"rgba(59,130,246,.15)":"rgba(255,255,255,.03)",color:viewMode===mode?"#60a5fa":"#475569",fontWeight:600,fontSize:10,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:1,fontFamily:"'Segoe UI',sans-serif"}}>
                <span style={{fontSize:13}}>{icon}</span><span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ZOOM */}
      <div className="g3-zoom" style={{position:"fixed",right:14,bottom:SB+150,zIndex:1002,display:"flex",flexDirection:"column",background:"rgba(20,30,46,.97)",border:"1px solid rgba(255,255,255,.14)",borderRadius:7,boxShadow:"0 4px 20px rgba(0,0,0,.6)",overflow:"hidden"}}>
        {[["+",zoomIn],["-",zoomOut]].map(([sym,fn],i)=>(
          <button key={sym} onClick={fn} style={{width:40,height:40,border:"none",borderBottom:i===0?"1px solid rgba(255,255,255,.08)":"none",background:"transparent",color:"#e2e8f0",fontSize:24,fontWeight:300,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"background .12s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.09)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{sym}</button>
        ))}
      </div>

      {/* COMPASS */}
      <div className="g3-compass" style={{position:"fixed",bottom:SB+4,right:14,zIndex:1001,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
        <div style={{background:"rgba(20,30,46,.95)",border:"1px solid rgba(255,255,255,.09)",borderRadius:5,padding:"2px 7px",display:"flex",gap:5,alignItems:"center"}}>
          <span style={{color:"#334155",fontSize:9,fontWeight:700,fontFamily:"monospace"}}>EYE</span>
          <span style={{color:"#64748b",fontSize:10,fontFamily:"monospace",fontWeight:600}}>{formatAlt(cameraAlt)}</span>
        </div>
        <div style={{width:48,height:48,pointerEvents:"none"}}>
          <svg viewBox="0 0 100 100" style={{width:"100%",height:"100%",transform:`rotate(${compassHeading}deg)`,filter:"drop-shadow(0 2px 6px rgba(0,0,0,.5))"}}>
            <circle cx="50" cy="50" r="47" fill="rgba(20,30,46,.95)" stroke="rgba(255,255,255,.11)" strokeWidth="1.5"/>
            <polygon points="50,8 55,50 50,46 45,50" fill="#ef4444"/>
            <polygon points="50,92 55,50 50,54 45,50" fill="#334155"/>
            <polygon points="8,50 50,45 54,50 50,55" fill="#334155"/>
            <polygon points="92,50 50,45 46,50 50,55" fill="#334155"/>
            <text x="50" y="21" textAnchor="middle" fill="#ef4444" fontSize="12" fontWeight="bold" fontFamily="monospace">N</text>
            <circle cx="50" cy="50" r="4" fill="rgba(255,255,255,.25)"/>
          </svg>
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,height:SB,zIndex:1100,background:"#0d1420",borderTop:"1px solid rgba(255,255,255,.07)",display:"flex",alignItems:"center",padding:"0 10px",gap:10,fontFamily:"'Courier New',monospace",fontSize:10,color:"#475569",userSelect:"none"}}>
        {mousePos
          ?(()=>{
              const utm=(coordDisplay==="UTM"||coordDisplay==="MGRS")?latLngToUTM(mousePos.lat,mousePos.lng):null;
              return <>
                {coordDisplay==="LatLng"&&<>
                  <span style={{color:"#94a3b8"}}>{toDMS(mousePos.lat,"N","S")}</span>
                  <span style={{color:"#334155"}}>·</span>
                  <span style={{color:"#94a3b8"}}>{toDMS(mousePos.lng,"E","W")}</span>
                </>}
                {coordDisplay==="UTM"&&utm&&<>
                  <span style={{color:"#34d399",fontSize:9,fontWeight:700}}>UTM</span>
                  <span style={{color:"#94a3b8"}}>{utm.zone}{utm.band}</span>
                  <span style={{color:"#94a3b8"}}>{utm.easting}mE</span>
                  <span style={{color:"#94a3b8"}}>{utm.northing}mN</span>
                </>}
                {coordDisplay==="MGRS"&&utm&&<>
                  <span style={{color:"#fbbf24",fontSize:9,fontWeight:700}}>MGRS</span>
                  <span style={{color:"#94a3b8",letterSpacing:"0.04em"}}>{latLngToMGRS(mousePos.lat,mousePos.lng,5)}</span>
                </>}
                <button title="Cycle: LatLng → UTM → MGRS"
                  onClick={()=>setCoordDisplay(d=>d==="LatLng"?"UTM":d==="UTM"?"MGRS":"LatLng")}
                  style={{padding:"1px 5px",borderRadius:3,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.04)",color:"#475569",fontSize:8,cursor:"pointer",fontFamily:"'Segoe UI',sans-serif",flexShrink:0,letterSpacing:"0.03em"}}>
                  {coordDisplay} ↻
                </button>
              </>;
            })()
          :<span style={{color:"#1e293b"}}>Move cursor over globe…</span>
        }
        <div style={{flex:1}}/>
        {gridEnabled&&<span style={{color:gridMode==="MGRS"?"#fbbf24":gridMode==="UTM"?"#64c8ff":"#94a3b8",fontSize:9,fontWeight:700}}>⊞ {gridMode}</span>}
        {drawMode&&<span style={{color:"#f97316",fontSize:9}}>✏ {drawPoints.length}pts</span>}
        {measureMode&&<span style={{color:"#facc15",fontSize:9}}>📏 {measurePoints.length}pts</span>}
        {surveyMode&&<span style={{color:"#ef4444",fontSize:9}}>● {surveyRoute.length}pts</span>}
        {nightAuto&&<span style={{color:"#6366f1",fontSize:9}}>{nightInfo?.isNight?"🌙":"☀️"}</span>}
        <span style={{color:"#1e293b",fontSize:9}}>{viewMode} · CesiumJS/Esri</span>
      </div>

      {/* DEM LEGEND OVERLAY */}
      {demEnabled&&(
        <div style={{position:"fixed",bottom:SB+16,right:16,zIndex:1050,background:"rgba(13,20,32,.88)",border:"1px solid rgba(34,197,94,.25)",borderRadius:10,padding:"10px 12px",minWidth:140,boxShadow:"0 4px 20px rgba(0,0,0,.5)",fontFamily:"'Segoe UI',sans-serif",backdropFilter:"blur(8px)"}}>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:8}}>
            <span style={{fontSize:11}}>🌍</span>
            <span style={{color:"#4ade80",fontSize:10,fontWeight:700,letterSpacing:".05em"}}>{demStyle==="hypsometric"?"HYPSOMETRIC":demStyle==="slope"?"HILLSHADE":"DEM + SHADING"}</span>
          </div>
          {(demStyle==="hypsometric"||demStyle==="both")&&(
            <>
              <div style={{display:"flex",gap:6,alignItems:"stretch",marginBottom:6}}>
                <div style={{width:14,borderRadius:3,flexShrink:0,background:"linear-gradient(to bottom,#4a148c,#b71c1c,#e65100,#f9a825,#558b2f,#2e7d32,#00838f,#0277bd,#1565c0,#1a237e)"}}/>
                <div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",gap:0}}>
                  {[["2000+ m","#c084fc"],["1500 m","#f87171"],["1000 m","#fb923c"],["500 m","#fbbf24"],["200 m","#86efac"],["Sea","#60a5fa"],["−400 m","#818cf8"]].map(([label,color])=>(
                    <div key={label} style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontSize:9,color,fontFamily:"monospace",minWidth:44}}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {(demStyle==="slope"||demStyle==="both")&&(
            <div style={{marginTop:4,paddingTop:6,borderTop:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:3}}>
                <div style={{width:40,height:8,borderRadius:2,background:"linear-gradient(to right,#fff,#888,#222)"}}/>
                <span style={{fontSize:9,color:"#64748b"}}>Flat → Steep</span>
              </div>
              <div style={{fontSize:9,color:"#475569",lineHeight:1.4}}>Bright = flat/N-facing<br/>Dark = steep/S-facing</div>
            </div>
          )}
          <div style={{marginTop:6,display:"flex",alignItems:"center",gap:4,paddingTop:5,borderTop:"1px solid rgba(255,255,255,.05)"}}>
            <span style={{fontSize:9,color:"#334155"}}>Opacity</span>
            <div style={{flex:1,height:3,background:"rgba(255,255,255,.08)",borderRadius:2}}>
              <div style={{width:`${demOpacity*100}%`,height:"100%",background:"#22c55e",borderRadius:2}}/>
            </div>
            <span style={{fontSize:9,color:"#4ade80",fontFamily:"monospace"}}>{Math.round(demOpacity*100)}%</span>
          </div>
        </div>
      )}

      {/* ELEVATION MODE */}
      {elevMode&&(
        <>
          <div style={{position:"fixed",top:TB+10,left:"50%",transform:"translateX(-50%)",zIndex:1200,background:"rgba(15,22,35,.96)",border:"1px solid rgba(245,158,11,.35)",borderRadius:7,padding:"7px 16px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 4px 20px rgba(0,0,0,.5)",fontFamily:"'Segoe UI',sans-serif",whiteSpace:"nowrap"}}>
            <span style={{fontSize:14}}>📈</span>
            <span style={{color:"#fbbf24",fontWeight:700,fontSize:12}}>Elevation Mode</span>
            <span style={{color:"#64748b",fontSize:11}}>Click map to place points along a transect</span>
            {elevPoints.length>0&&<span style={{color:"#94a3b8",fontSize:11,borderLeft:"1px solid rgba(255,255,255,.1)",paddingLeft:10}}>{elevPoints.length} point{elevPoints.length!==1?"s":""}</span>}
            {elevLoading&&<span style={{color:"#fbbf24",fontSize:11,display:"inline-block",animation:"spin .8s linear infinite"}}>⟳</span>}
            <button onClick={()=>{setElevMode(false);setElevPoints([]);setElevProfile(null);elevPtsRef.current=[];const viewer=viewerRef.current;elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});elevEntsRef.current=[];}} style={{marginLeft:4,padding:"3px 10px",borderRadius:5,border:"1px solid rgba(239,68,68,.4)",background:"rgba(239,68,68,.1)",color:"#f87171",fontSize:11,cursor:"pointer",fontWeight:600}}>✕ Exit</button>
            {elevPoints.length>=2&&<button onClick={()=>{const viewer=viewerRef.current;elevEntsRef.current.forEach(e=>{try{viewer.entities.remove(e);}catch(_){}});elevEntsRef.current=[];elevPtsRef.current=[];setElevPoints([]);setElevProfile(null);}} style={{padding:"3px 10px",borderRadius:5,border:"1px solid rgba(100,116,139,.4)",background:"rgba(100,116,139,.1)",color:"#94a3b8",fontSize:11,cursor:"pointer"}}>🗑 Clear</button>}
          </div>

          {elevProfile&&(()=>{
            const PANEL_H=220;
            const W=window.innerWidth-PANEL;
            const PAD_L=58,PAD_R=20,PAD_T=10;
            const cH=PANEL_H-PAD_T-38-32;
            const cW=W-PAD_L-PAD_R;
            const samples=elevProfile.samples;
            const minH=elevProfile.stats.minH,maxH=elevProfile.stats.maxH;
            const hRange=(maxH-minH)||1;
            const maxD=samples[samples.length-1].d||1;
            const unit=elevProfile._unit||"m";
            const toX=d=>PAD_L+(d/maxD)*cW;
            const toY=h=>PAD_T+cH-((h-minH)/hRange)*cH;
            const toUnit=(m)=>unit==="ft"?`${(m*3.28084).toFixed(0)}ft`:`${m.toFixed(0)}m`;
            let gain=0,loss=0;
            for(let i=1;i<samples.length;i++){const dh=samples[i].h-samples[i-1].h;if(dh>0)gain+=dh;else loss+=Math.abs(dh);}
            const avgH=samples.reduce((s,p)=>s+p.h,0)/samples.length;
            const distLabel=maxD>=1000?`${(maxD/1000).toFixed(2)} km`:`${maxD.toFixed(0)} m`;
            const areaD=`M${toX(samples[0].d)},${PAD_T+cH} `+samples.map(s=>`L${toX(s.d)},${toY(s.h)}`).join(" ")+` L${toX(samples[samples.length-1].d)},${PAD_T+cH} Z`;
            const linePts=samples.map(s=>`${toX(s.d)},${toY(s.h)}`).join(" ");
            const yTicks=Array.from({length:6},(_,i)=>minH+(hRange/5)*i);
            const xTicks=Array.from({length:7},(_,i)=>(maxD/6)*i);
            const hov=elevHoverIdx!==null?samples[elevHoverIdx]:null;
            const onSvgMove=(e)=>{
              const rect=e.currentTarget.getBoundingClientRect();
              const pct=(e.clientX-rect.left-PAD_L)/cW;
              const idx=Math.max(0,Math.min(samples.length-1,Math.round(pct*(samples.length-1))));
              setElevHoverIdx(idx);
              const Cesium=CesiumRef.current,viewer=viewerRef.current;
              if(viewer&&Cesium&&hoverMarkerRef.current&&elevProfile.positions?.[idx]){
                const p=elevProfile.positions[idx];
                hoverMarkerRef.current.position=Cesium.Cartesian3.fromDegrees(p.lng,p.lat,samples[idx].h+5);
                hoverMarkerRef.current.show=true;
              }
            };
            const onSvgLeave=()=>{setElevHoverIdx(null);if(hoverMarkerRef.current)hoverMarkerRef.current.show=false;};
            return(
              <div style={{position:"fixed",bottom:SB,left:PANEL,right:0,height:PANEL_H,zIndex:1200,background:"#0d1520",borderTop:"2px solid #1e3050",fontFamily:"'Segoe UI',sans-serif",boxShadow:"0 -4px 24px rgba(0,0,0,.6)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 14px",borderBottom:"1px solid #1a2535",background:"#0a1018",height:38}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{color:"#94a3b8",fontWeight:700,fontSize:11,letterSpacing:".06em"}}>ELEVATION PROFILE</span>
                    <div style={{display:"flex",borderRadius:4,overflow:"hidden",border:"1px solid #1e3050"}}>
                      {["m","ft"].map(u=>(
                        <button key={u} onClick={()=>setElevProfile(p=>({...p,_unit:u}))} style={{padding:"2px 9px",fontSize:10,fontWeight:700,cursor:"pointer",border:"none",background:unit===u?"#1e3a5f":"transparent",color:unit===u?"#60a5fa":"#334155"}}>{u}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:0,flex:1,justifyContent:"center",overflow:"hidden"}}>
                    {[[`Graph: Min ${toUnit(minH)}  Avg ${toUnit(avgH)}  Max ${toUnit(maxH)}`,"#94a3b8"],[`Distance: ${distLabel}`,"#60a5fa"],[`Elev Gain/Loss: +${toUnit(gain)} / -${toUnit(loss)}`,"#4ade80"],[`Max Slope: ${elevProfile.stats.maxSlope.toFixed(1)}%`,"#fb923c"]].map(([val,color])=>(
                      <div key={val} style={{padding:"0 10px",borderRight:"1px solid #1a2535",whiteSpace:"nowrap"}}>
                        <span style={{fontSize:10,color,fontWeight:600,fontFamily:"monospace"}}>{val}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>setElevProfile(null)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:16,marginLeft:8}}>✕</button>
                </div>
                <svg width={W} height={PANEL_H-38} style={{display:"block",cursor:"crosshair"}} onMouseMove={onSvgMove} onMouseLeave={onSvgLeave}>
                  <defs>
                    <linearGradient id="elvFill2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#dc2626" stopOpacity="0.6"/>
                      <stop offset="70%" stopColor="#dc2626" stopOpacity="0.15"/>
                      <stop offset="100%" stopColor="#dc2626" stopOpacity="0.02"/>
                    </linearGradient>
                  </defs>
                  {yTicks.map((v,i)=>(
                    <g key={i}>
                      <line x1={PAD_L} y1={toY(v)} x2={PAD_L+cW} y2={toY(v)} stroke="#1a2535" strokeWidth="1"/>
                      <text x={PAD_L-5} y={toY(v)+4} fill="#334155" fontSize="10" textAnchor="end" fontFamily="monospace">{toUnit(v)}</text>
                    </g>
                  ))}
                  {xTicks.map((v,i)=>(
                    <g key={i}>
                      <line x1={toX(v)} y1={PAD_T} x2={toX(v)} y2={PAD_T+cH} stroke="#1a2535" strokeWidth="1"/>
                      <text x={toX(v)} y={PAD_T+cH+16} fill="#334155" fontSize="10" textAnchor="middle" fontFamily="monospace">{v===0?"0":v>=1000?`${(v/1000).toFixed(1)}km`:`${(v/1000).toFixed(2)}km`}</text>
                    </g>
                  ))}
                  <text x={13} y={PAD_T+cH/2} fill="#334155" fontSize="9" textAnchor="middle" fontFamily="monospace" transform={`rotate(-90,13,${PAD_T+cH/2})`}>Elev ({unit})</text>
                  <path d={areaD} fill="url(#elvFill2)"/>
                  <polyline points={linePts} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinejoin="round"/>
                  {elevPtsRef.current.map((_,i)=>{
                    const wDists=elevProfile.waypointCumDists;
                    const realDist=wDists&&wDists[i]!=null?wDists[i]:(i===0?0:maxD*(i/(elevPtsRef.current.length-1)));
                    const s=samples.reduce((a,b)=>Math.abs(b.d-realDist)<Math.abs(a.d-realDist)?b:a);
                    return(
                      <g key={i}>
                        <line x1={toX(s.d)} y1={PAD_T} x2={toX(s.d)} y2={PAD_T+cH} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,3" opacity="0.5"/>
                        <circle cx={toX(s.d)} cy={toY(s.h)} r={5} fill="#f59e0b" stroke="#fff" strokeWidth="1.5"/>
                        <text x={toX(s.d)} y={toY(s.h)-8} fill="#fbbf24" fontSize="10" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">{i+1}</text>
                      </g>
                    );
                  })}
                  {hov&&elevHoverIdx!==null&&(()=>{
                    const cx=toX(hov.d),cy=toY(hov.h);
                    const tipW=120,tipH=48;
                    const tipX=cx+10+tipW>W-PAD_R?cx-tipW-10:cx+10;
                    const tipY=Math.max(PAD_T+2,Math.min(cy-tipH/2,PAD_T+cH-tipH));
                    const slp=elevHoverIdx>0?(()=>{const run=hov.d-samples[elevHoverIdx-1].d;const rise=hov.h-samples[elevHoverIdx-1].h;return run>0?((rise/run)*100).toFixed(1):"0";})():"0";
                    return(
                      <>
                        <line x1={cx} y1={PAD_T} x2={cx} y2={PAD_T+cH} stroke="rgba(255,255,255,.2)" strokeWidth="1"/>
                        <circle cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fff" strokeWidth="2"/>
                        <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={4} fill="#0d1520" stroke="#1e3050" strokeWidth="1"/>
                        <text x={tipX+8} y={tipY+17} fill="#ef4444" fontSize="14" fontWeight="bold" fontFamily="monospace">{toUnit(hov.h)}</text>
                        <text x={tipX+8} y={tipY+30} fill="#475569" fontSize="9" fontFamily="monospace">{hov.d>=1000?`${(hov.d/1000).toFixed(2)}km`:`${hov.d.toFixed(0)}m`} from start</text>
                        <text x={tipX+8} y={tipY+42} fill={parseFloat(slp)>0?"#4ade80":"#f87171"} fontSize="9" fontFamily="monospace">slope: {slp}%</text>
                      </>
                    );
                  })()}
                  <rect x={PAD_L} y={PAD_T} width={cW} height={cH} fill="none" stroke="#1e3050" strokeWidth="1"/>
                </svg>
              </div>
            );
          })()}

          {elevLoading&&!elevProfile&&(
            <div style={{position:"fixed",bottom:SB+20,left:"50%",transform:"translateX(-50%)",zIndex:1200,background:"rgba(13,20,32,.9)",border:"1px solid rgba(245,158,11,.2)",borderRadius:8,padding:"10px 20px",color:"#fbbf24",fontSize:12,fontFamily:"'Segoe UI',sans-serif",display:"flex",alignItems:"center",gap:8}}>
              <span style={{animation:"spin .8s linear infinite",display:"inline-block"}}>⟳</span>
              Sampling terrain elevation…
            </div>
          )}
        </>
      )}

      {/* LOCATION INFO */}
      {locationInfo&&(
        <div style={{position:"fixed",top:TB+14,right:54,width:Math.min(290,window.innerWidth-20),zIndex:1002,background:"#141e2e",borderRadius:10,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,.55)",border:"1px solid rgba(255,255,255,.07)",fontFamily:"'Segoe UI',sans-serif",animation:"fadeIn .2s ease"}}>
          <div style={{padding:"12px 14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={{color:"#f1f5f9",fontWeight:700,fontSize:14,flex:1,paddingRight:8}}>{locationInfo.name}</div>
              <button onClick={()=>setLocationInfo(null)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:15,flexShrink:0}}>✕</button>
            </div>
            <div style={{padding:"5px 8px",background:"rgba(255,255,255,.03)",borderRadius:5,marginBottom:7,fontFamily:"monospace",color:"#64748b",fontSize:10}}>{locationInfo.lat.toFixed(6)}°, {locationInfo.lng.toFixed(6)}°</div>
            {locationInfo.details&&<div style={{color:"#64748b",fontSize:11,marginBottom:4,lineHeight:1.5}}>{locationInfo.details}</div>}
          </div>
        </div>
      )}

      {/* BUILDING INFO POPUP */}
      {buildingInfo&&(
        <div style={{position:"fixed",left:Math.min(buildingInfo.x,window.innerWidth-255),top:Math.max(buildingInfo.y,TB+8),zIndex:1100,width:248,background:"#141e2e",borderRadius:10,border:`1px solid ${buildingInfo.untagged?"rgba(100,116,139,.3)":"rgba(99,102,241,.35)"}`,boxShadow:"0 8px 28px rgba(0,0,0,.65)",fontFamily:"'Segoe UI',sans-serif",overflow:"hidden",animation:"fadeIn .15s ease"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:buildingInfo.untagged?"rgba(100,116,139,.08)":"rgba(99,102,241,.1)",borderBottom:`1px solid ${buildingInfo.untagged?"rgba(100,116,139,.15)":"rgba(99,102,241,.2)"}`}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:14}}>🏢</span>
              <span style={{color:"#e2e8f0",fontWeight:700,fontSize:12,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{buildingInfo.name}</span>
            </div>
            <button onClick={()=>setBuildingInfo(null)} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:13,lineHeight:1}}>✕</button>
          </div>
          <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:6}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:10,color:"#64748b",fontWeight:700,width:52}}>TYPE</span>
              {buildingInfo.untagged
                ?<span style={{fontSize:10,color:"#475569",fontStyle:"italic"}}>Not tagged in OSM</span>
                :<span style={{fontSize:11,color:"#94a3b8",background:"rgba(255,255,255,.05)",padding:"2px 7px",borderRadius:4,textTransform:"capitalize"}}>{buildingInfo.type}</span>
              }
            </div>
            {buildingInfo.height&&(
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:10,color:"#64748b",fontWeight:700,width:52}}>HEIGHT</span>
                <span style={{fontSize:11,color:"#60a5fa",fontWeight:600}}>{buildingInfo.height}</span>
              </div>
            )}
            {buildingInfo.floors&&(
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:10,color:"#64748b",fontWeight:700,width:52}}>FLOORS</span>
                <span style={{fontSize:11,color:"#34d399",fontWeight:600}}>{buildingInfo.floors}</span>
              </div>
            )}
            {buildingInfo.untagged&&(
              <div style={{marginTop:2,padding:"6px 8px",background:"rgba(251,191,36,.05)",border:"1px solid rgba(251,191,36,.15)",borderRadius:6,fontSize:10,color:"#78716c",lineHeight:1.5}}>
                💡 OSM data for this area is incomplete.
              </div>
            )}
            {!buildingInfo.untagged&&!buildingInfo.height&&!buildingInfo.floors&&(
              <div style={{fontSize:10,color:"#334155",fontStyle:"italic"}}>No height/floor data in OSM</div>
            )}
          </div>
        </div>
      )}

      {/* CSV INFO */}
      {csvInfo&&(
        <div style={{position:"fixed",left:Math.min(csvInfo.x,window.innerWidth-290),top:Math.max(csvInfo.y,TB+8),zIndex:1100,width:275,background:"#141e2e",borderRadius:8,border:"1px solid rgba(34,197,94,.3)",boxShadow:"0 8px 28px rgba(0,0,0,.6)",fontFamily:"'Segoe UI',sans-serif",overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",background:"rgba(34,197,94,.08)",borderBottom:"1px solid rgba(34,197,94,.18)"}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:"50%",background:"#22c55e"}}/><span style={{color:"#f1f5f9",fontWeight:600,fontSize:11,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{csvInfo.name}</span></div>
            <button onClick={()=>setCsvInfo(null)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:12}}>✕</button>
          </div>
          <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
            {[["LAT",csvInfo.rowData?.lat?.toFixed(6)],["LNG",csvInfo.rowData?.lng?.toFixed(6)]].map(([l,v])=>(
              <div key={l} style={{flex:1,padding:"5px 10px",borderRight:l==="LAT"?"1px solid rgba(255,255,255,.04)":"none"}}>
                <div style={{color:"#334155",fontSize:9,fontWeight:700,marginBottom:1}}>{l}</div>
                <div style={{color:"#22c55e",fontFamily:"monospace",fontSize:11,fontWeight:600}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{maxHeight:180,overflowY:"auto"}}>
            {Object.entries(csvInfo.rowData?.fields||{}).map(([k,v],i)=>(
              <div key={k} style={{display:"flex",padding:"4px 10px",background:i%2===0?"transparent":"rgba(255,255,255,.013)",borderBottom:"1px solid rgba(255,255,255,.03)"}}>
                <div style={{color:"#334155",fontSize:9,fontWeight:600,minWidth:80,flexShrink:0,textTransform:"capitalize"}}>{k.includes(".")?k.split(".").pop():k}</div>
                <div style={{color:"#e2e8f0",fontSize:10,wordBreak:"break-word"}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DRAW NAME MODAL */}
      {showModal&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,.65)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px"}}>
          <div style={{background:"#141e2e",borderRadius:10,padding:22,width:"100%",maxWidth:290,boxShadow:"0 8px 40px rgba(0,0,0,.7)",border:"1px solid rgba(255,255,255,.07)",fontFamily:"'Segoe UI',sans-serif"}}>
            <div style={{color:"#f1f5f9",fontWeight:700,fontSize:15,marginBottom:4}}>Name this {pendingType}</div>
            <div style={{color:"#334155",fontSize:11,marginBottom:12}}>{pendingPts.length} pt{pendingPts.length!==1?"s":""} recorded</div>
            <input autoFocus value={pendingName} onChange={e=>setPendingName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmDrawing()} placeholder="e.g. Survey Path A"
              style={{width:"100%",padding:"8px 11px",borderRadius:6,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.05)",color:"#f1f5f9",fontSize:13,marginBottom:12,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
            <div style={{display:"flex",gap:7}}>
              <button onClick={confirmDrawing} style={{flex:1,padding:"8px",borderRadius:6,border:"none",background:"#3b82f6",color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}>Save</button>
              <button onClick={cancelDrawing} style={{flex:1,padding:"8px",borderRadius:6,border:"1px solid rgba(255,255,255,.08)",background:"transparent",color:"#475569",fontWeight:500,fontSize:13,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* KML FLY-IN PROGRESS BAR */}
      {kmlFlyIn&&(
        <div style={{position:"fixed",zIndex:1500,bottom:SB+8,left:PANEL+16,right:80,pointerEvents:"none",animation:"fadeIn .3s ease forwards"}}>
          <div style={{height:2,background:"rgba(255,255,255,.06)",borderRadius:1,overflow:"hidden"}}>
            <div style={{height:"100%",background:"#3b82f6",borderRadius:1,animation:"progressBar 4.5s cubic-bezier(.4,0,.6,1) forwards"}}/>
          </div>
          <div style={{marginTop:5,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:"#3b82f6",flexShrink:0}}/>
            <span style={{color:"#475569",fontSize:10,fontFamily:"'Segoe UI',sans-serif",letterSpacing:".03em"}}>Navigating to <span style={{color:"#64748b"}}>{kmlName}</span></span>
          </div>
        </div>
      )}

      {/* CAMERA ORIENTATION HUD */}
      {kmlStats&&!kmlFlyIn&&(
        <div style={{position:"fixed",top:TB+8,right:8,zIndex:1002,width:200,background:"rgba(10,15,25,.88)",border:"1px solid rgba(255,255,255,.08)",backdropFilter:"blur(8px)",fontFamily:"'Courier New',monospace",fontSize:10,userSelect:"none",animation:"fadeIn .3s ease"}}>
          <div style={{padding:"5px 10px",borderBottom:"1px solid rgba(255,255,255,.06)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{color:"#475569",fontSize:9,letterSpacing:".1em",fontWeight:700}}>CAMERA ORIENTATION</span>
            <button onClick={()=>setKmlStats(null)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:12,lineHeight:1,padding:0}}>×</button>
          </div>
          {[["Heading",`${compassHeading.toFixed(1)}°`,["N","NE","E","SE","S","SW","W","NW"][Math.round(compassHeading/45)%8]],["Range",formatAlt(cameraAlt),"eye alt"]].map(([label,val,sub])=>(
            <div key={label} style={{display:"flex",alignItems:"baseline",gap:0,padding:"3px 10px"}}>
              <span style={{color:"#334155",fontSize:9,width:52,flexShrink:0,letterSpacing:".06em"}}>{label}</span>
              <span style={{color:"#64748b",fontSize:10,flex:1}}>{val}</span>
              {sub&&<span style={{color:"#1e293b",fontSize:9}}>{sub}</span>}
            </div>
          ))}
          <div style={{borderTop:"1px solid rgba(255,255,255,.06)",padding:"6px 10px"}}>
            <div style={{color:"#1e293b",fontSize:8,letterSpacing:".1em",marginBottom:4}}>LAYER EXTENT</div>
            {[["Features",kmlStats.featureCount],["Centre",`${Math.abs(kmlStats.center.lat).toFixed(4)}° ${kmlStats.center.lat>=0?"N":"S"}`],["",`${Math.abs(kmlStats.center.lng).toFixed(4)}° ${kmlStats.center.lng>=0?"E":"W"}`],["Span",`~${kmlStats.spanKm} km`]].map(([label,val],i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{color:"#334155"}}>{label}</span>
                <span style={{color:"#64748b"}}>{val}</span>
              </div>
            ))}
          </div>
          {orbitRef.current?.active&&(
            <div style={{borderTop:"1px solid rgba(255,255,255,.06)",padding:"4px 10px",color:"#1e293b",fontSize:9,letterSpacing:".06em"}}>↻ ORBITING — click globe to stop</div>
          )}
        </div>
      )}

      {/* ── COORDINATE CONVERTER PANEL ──────────────────────────────────── */}
      {coordConvOpen&&(
        <div style={{position:"fixed",top:TB,right:0,width:320,bottom:SB,zIndex:1080,background:"#0f1825",borderLeft:"1px solid rgba(255,255,255,.08)",display:"flex",flexDirection:"column",fontFamily:"'Segoe UI',system-ui,sans-serif",boxShadow:"-6px 0 32px rgba(0,0,0,.5)",animation:"fadeIn .2s ease"}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,.07)",background:"#141e2e",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:28,height:28,borderRadius:6,background:"linear-gradient(135deg,#7c3aed,#a78bfa)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>🔄</div>
              <div>
                <div style={{color:"#f1f5f9",fontWeight:700,fontSize:13}}>Coordinate Converter</div>
                <div style={{color:"#475569",fontSize:10}}>LatLng · UTM · MGRS · DMS · Geohash</div>
              </div>
            </div>
            <button onClick={()=>{setCoordConvOpen(false);setConvPickMode(false);}} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:18,lineHeight:1}}>✕</button>
          </div>

          <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
            <div style={{background:"rgba(167,139,250,.06)",border:"1px solid rgba(167,139,250,.18)",borderRadius:8,padding:"12px"}}>
              <div style={{color:"#a78bfa",fontSize:10,fontWeight:700,letterSpacing:".07em",marginBottom:8}}>INPUT COORDINATE</div>
              <form onSubmit={handleConvSubmit} style={{display:"flex",flexDirection:"column",gap:7}}>
                <textarea
                  value={convInput}
                  onChange={e=>{setConvInput(e.target.value);setConvError("");}}
                  onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleConvSubmit();}}}
                  placeholder={"Paste any format:\n20.296198, 85.824597\n44N 400000E 2200000N\n43C MU 23450 45678\n20°17'46\"N, 85°49'28\"E"}
                  rows={4}
                  style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.04)",color:"#e2e8f0",fontSize:11,outline:"none",resize:"vertical",fontFamily:"'Courier New',monospace",lineHeight:1.5,boxSizing:"border-box"}}
                />
                {convError&&(
                  <div style={{color:"#f87171",fontSize:10,lineHeight:1.5,padding:"5px 8px",background:"rgba(239,68,68,.07)",borderRadius:5,border:"1px solid rgba(239,68,68,.2)"}}>
                    ⚠ {convError}
                  </div>
                )}
                <div style={{display:"flex",gap:6}}>
                  <button type="submit" style={{flex:1,padding:"8px",borderRadius:6,border:"none",background:"#7c3aed",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}
                    onMouseEnter={e=>e.currentTarget.style.filter="brightness(1.15)"}
                    onMouseLeave={e=>e.currentTarget.style.filter="brightness(1)"}>
                    ⟳ Convert
                  </button>
                  <button type="button" onClick={()=>{setConvInput("");setConvResult(null);setConvError("");}}
                    style={{padding:"8px 12px",borderRadius:6,border:"1px solid rgba(255,255,255,.08)",background:"transparent",color:"#475569",fontSize:12,cursor:"pointer"}}>
                    ✕ Clear
                  </button>
                </div>
              </form>
            </div>

            <button
              onClick={()=>{setConvPickMode(p=>!p);}}
              style={{width:"100%",padding:"10px",borderRadius:7,border:`2px solid ${convPickMode?"#a78bfa":"rgba(167,139,250,.25)"}`,background:convPickMode?"rgba(167,139,250,.15)":"rgba(167,139,250,.05)",color:convPickMode?"#c4b5fd":"#7c6fa0",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .15s"}}>
              <span style={{fontSize:16}}>🖱️</span>
              {convPickMode?"Click map to pick location…":"Pick Location from Map"}
              {convPickMode&&<span style={{fontSize:10,background:"rgba(167,139,250,.3)",padding:"2px 7px",borderRadius:10,color:"#ddd6fe"}}>Active</span>}
            </button>

            {!convResult&&(
              <div style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:8,padding:"12px"}}>
                <div style={{color:"#475569",fontSize:10,fontWeight:700,letterSpacing:".07em",marginBottom:9}}>SUPPORTED INPUT FORMATS</div>
                {[
                  ["Decimal Degrees","20.2962, 85.8246","#60a5fa"],
                  ["Signed DD","+20.2962, +85.8246","#60a5fa"],
                  ["DMS","20°17'46\"N, 85°49'28\"E","#34d399"],
                  ["DMS (space)","20 17 46.2 N 85 49 28.1 E","#34d399"],
                  ["UTM","44N 452000E 2243000N","#fbbf24"],
                  ["UTM compact","44N 452000 2243000","#fbbf24"],
                  ["MGRS","44QKM 52000 43000","#f97316"],
                  ["MGRS compact","44QKM5200043000","#f97316"],
                ].map(([fmt,ex,col])=>(
                  <div key={fmt} style={{display:"flex",flexDirection:"column",gap:1,marginBottom:8}}>
                    <div style={{color:col,fontSize:9,fontWeight:700,letterSpacing:".05em"}}>{fmt}</div>
                    <div onClick={()=>setConvInput(ex)} style={{color:"#94a3b8",fontSize:10,fontFamily:"'Courier New',monospace",cursor:"pointer",padding:"3px 6px",borderRadius:4,background:"rgba(255,255,255,.03)",userSelect:"all"}} title="Click to paste this example">{ex}</div>
                  </div>
                ))}
              </div>
            )}

            {convResult&&(()=>{
              const rows=[
                {label:"Decimal Degrees",key:"dd",value:convResult.dd,color:"#60a5fa",icon:"🌐"},
                {label:"DD Simple",key:"ddSimple",value:convResult.ddSimple,color:"#60a5fa",icon:"📍"},
                {label:"Signed DD",key:"ddSigned",value:convResult.ddSigned,color:"#818cf8",icon:"±"},
                {label:"DMS",key:"dmsStr",value:convResult.dmsStr,color:"#34d399",icon:"📐"},
                {label:"UTM",key:"utmStr",value:convResult.utmStr,color:"#fbbf24",icon:"🗺"},
                {label:"MGRS",key:"mgrsStr",value:convResult.mgrsStr,color:"#f97316",icon:"🔲"},
                {label:"Geohash",key:"geohash",value:convResult.geohash,color:"#e879f9",icon:"#"},
              ];
              return(
                <>
                  <div style={{background:"rgba(167,139,250,.08)",border:"1px solid rgba(167,139,250,.25)",borderRadius:8,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div>
                      <div style={{color:"#c4b5fd",fontSize:10,fontWeight:700,letterSpacing:".06em",marginBottom:3}}>CONVERTED LOCATION</div>
                      <div style={{color:"#f1f5f9",fontFamily:"monospace",fontSize:11}}>{convResult.lat.toFixed(5)}°, {convResult.lng.toFixed(5)}°</div>
                    </div>
                    <button onClick={convFlyTo} style={{padding:"7px 13px",borderRadius:6,border:"none",background:"#7c3aed",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>✈ Fly To</button>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{color:"#334155",fontSize:10,fontWeight:700,letterSpacing:".07em"}}>ALL FORMATS</div>
                    {rows.filter(r=>r.value).map(row=>(
                      <div key={row.key} style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.06)",borderRadius:7,padding:"9px 11px",display:"flex",flexDirection:"column",gap:4}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <span style={{fontSize:11}}>{row.icon}</span>
                            <span style={{color:row.color,fontSize:9,fontWeight:700,letterSpacing:".06em"}}>{row.label.toUpperCase()}</span>
                          </div>
                          <button onClick={()=>copyConv(row.value,row.key)} style={{padding:"2px 9px",borderRadius:4,border:`1px solid ${convCopied===row.key?"rgba(74,222,128,.5)":"rgba(255,255,255,.1)"}`,background:convCopied===row.key?"rgba(74,222,128,.12)":"transparent",color:convCopied===row.key?"#4ade80":"#475569",fontSize:9,cursor:"pointer",fontWeight:600,transition:"all .15s"}}>
                            {convCopied===row.key?"✓ Copied":"Copy"}
                          </button>
                        </div>
                        <div style={{color:"#e2e8f0",fontFamily:"'Courier New',monospace",fontSize:11,wordBreak:"break-all",lineHeight:1.4,userSelect:"all"}}>{row.value}</div>
                      </div>
                    ))}
                  </div>
                  {convResult.utm&&(
                    <div style={{background:"rgba(251,191,36,.05)",border:"1px solid rgba(251,191,36,.15)",borderRadius:7,padding:"10px 12px"}}>
                      <div style={{color:"#fbbf24",fontSize:10,fontWeight:700,letterSpacing:".07em",marginBottom:7}}>UTM ZONE DETAILS</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 10px"}}>
                        {[["Zone",`${convResult.utm.zone}${convResult.utm.band}`],["Easting",`${convResult.utm.easting} m E`],["Northing",`${convResult.utm.northing} m N`],["Hemisphere",convResult.lat>=0?"Northern":"Southern"]].map(([k,v])=>(
                          <div key={k}>
                            <div style={{color:"#475569",fontSize:9,fontWeight:700}}>{k}</div>
                            <div style={{color:"#fde68a",fontFamily:"monospace",fontSize:10}}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={()=>{const all=rows.filter(r=>r.value).map(r=>`${r.label}: ${r.value}`).join("\n");copyConv(all,"all");}} style={{width:"100%",padding:"9px",borderRadius:6,border:`1px solid ${convCopied==="all"?"rgba(74,222,128,.4)":"rgba(255,255,255,.08)"}`,background:convCopied==="all"?"rgba(74,222,128,.08)":"rgba(255,255,255,.03)",color:convCopied==="all"?"#4ade80":"#64748b",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                    {convCopied==="all"?"✓ Copied All Formats!":"📋 Copy All Formats"}
                  </button>
                </>
              );
            })()}

            <div style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.05)",borderRadius:8,padding:"11px 12px",marginTop:4}}>
              <div style={{color:"#334155",fontSize:10,fontWeight:700,letterSpacing:".07em",marginBottom:8}}>QUICK REFERENCE</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {[["Lat/Lng","WGS84 decimal. Range: lat ±90, lng ±180","#60a5fa"],["DMS","Degrees°Minutes′Seconds″ + direction (N/S/E/W)","#34d399"],["UTM","Zone (1–60) + Band (C–X) + Easting/Northing in metres","#fbbf24"],["MGRS","NATO grid: Zone+Band+100km sq+5-digit E+N","#f97316"],["Geohash","Base-32 string encoding, ~1m precision at 9 chars","#e879f9"]].map(([name,desc,col])=>(
                  <div key={name} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{color:col,fontSize:9,fontWeight:700,minWidth:48,flexShrink:0,paddingTop:1}}>{name}</div>
                    <div style={{color:"#334155",fontSize:9,lineHeight:1.4}}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PHASE 1 FEATURE PANELS ──────────────────────────────────────── */}
      <HeatmapLayer viewer={viewerRef.current} Cesium={CesiumRef.current} visible={heatmapOpen} onClose={()=>setHeatmapOpen(false)}/>
      <SatelliteTimeSlider viewer={viewerRef.current} Cesium={CesiumRef.current} visible={sliderOpen} onClose={()=>setSliderOpen(false)}/>
      <DroneFlightPath viewer={viewerRef.current} Cesium={CesiumRef.current} visible={droneOpen} onClose={()=>setDroneOpen(false)}/>
    </>
  );
}