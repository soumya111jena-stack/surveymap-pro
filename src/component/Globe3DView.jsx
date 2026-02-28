/**
 * Globe3DView.jsx — SurveyMap Pro redesign
 * Matches Image 2 layout: top toolbar + left panel + clean professional UI
 */

import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";

// ── Helpers ───────────────────────────────────────────────────────────────────
function haversine(a, b) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}
function formatDist(m, unit) {
  if (unit==="auto") return m>=1000?(m/1000).toFixed(2)+" km":m.toFixed(1)+" m";
  if (unit==="km")   return (m/1000).toFixed(3)+" km";
  if (unit==="m")    return m.toFixed(1)+" m";
  if (unit==="mi")   return (m/1609.344).toFixed(3)+" mi";
  if (unit==="ft")   return (m/0.3048).toFixed(1)+" ft";
  return m.toFixed(1)+" m";
}
function toDMS(val, pos, neg) {
  const a=Math.abs(val), d=Math.floor(a), m=Math.floor((a-d)*60);
  const s=((a-d-m/60)*3600).toFixed(2);
  return `${d}°${m}'${s}"${val>=0?pos:neg}`;
}
function formatAlt(m) { return m>=1000?(m/1000).toFixed(0)+" km":m.toFixed(0)+" m"; }

const LAT_KEYS = ["latitude","lat","y","ylat","lat_deg","location.latitude","loc.latitude","loc_lat","point.latitude","geo.latitude"];
const LNG_KEYS = ["longitude","lng","lon","long","x","xlon","lng_deg","location.longitude","loc.longitude","loc_lng","loc_lon","point.longitude","geo.longitude"];

function findColKey(headers, candidates) {
  const exact = headers.find(h => candidates.includes(h.toLowerCase().trim()));
  if (exact) return exact;
  return headers.find(h => {
    const l = h.toLowerCase().trim();
    return candidates === LAT_KEYS ? /\blat\b|latitude/.test(l) : /\blo[ng]\b|longitude/.test(l);
  });
}
function processInChunks(items, chunkSize, processor, onComplete) {
  let index = 0;
  function next() {
    const end = Math.min(index + chunkSize, items.length);
    for (; index < end; index++) processor(items[index]);
    if (index < items.length) requestAnimationFrame(next);
    else onComplete();
  }
  requestAnimationFrame(next);
}
const CSV_MAX_MARKERS = 5000;

function buildImageryProvider(Cesium, layerName) {
  const T = (u, extra={}) => new Cesium.UrlTemplateImageryProvider({url:u,maximumLevel:19,...extra});
  switch (layerName) {
    case "Satellite":
    case "Satellite + Labels":
      return T("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{credit:"© Esri"});
    case "Street":   return T("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{credit:"© OpenStreetMap"});
    case "Terrain":  return T("https://tile.opentopomap.org/{z}/{x}/{y}.png",{credit:"© OpenTopoMap",maximumLevel:17});
    case "Hillshade":return T("https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",{credit:"© Esri"});
    case "Contour":  return T("https://tiles.stadiamaps.com/tiles/stamen_terrain_lines/{z}/{x}/{y}.png",{credit:"© Stadia",maximumLevel:18});
    case "Dark":     return T("https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",{credit:"© CartoDB"});
    case "Light":    return T("https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",{credit:"© CartoDB"});
    default:         return T("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{credit:"© Esri"});
  }
}

// Export helpers
function drawingsToGeoJSON(drawings) {
  const features = drawings.map((d) => {
    if (d.type==="marker") { const [lat,lng]=d.points[0]; return {type:"Feature",properties:{name:d.name,type:"marker"},geometry:{type:"Point",coordinates:[lng,lat]}}; }
    if (d.type==="path") return {type:"Feature",properties:{name:d.name,type:"path"},geometry:{type:"LineString",coordinates:d.points.map(([la,lo])=>[lo,la])}};
    return {type:"Feature",properties:{name:d.name,type:"polygon"},geometry:{type:"Polygon",coordinates:[[...d.points.map(([la,lo])=>[lo,la]),d.points[0]?[d.points[0][1],d.points[0][0]]:null].filter(Boolean)]}};
  });
  return {type:"FeatureCollection",features};
}
function drawingsToKML(drawings) {
  const pm=drawings.map((d)=>{
    if(d.type==="marker"){const[la,lo]=d.points[0];return`<Placemark><name>${d.name}</name><Point><coordinates>${lo},${la},0</coordinates></Point></Placemark>`;}
    if(d.type==="path")return`<Placemark><name>${d.name}</name><LineString><coordinates>${d.points.map(([la,lo])=>`${lo},${la},0`).join(" ")}</coordinates></LineString></Placemark>`;
    const pts=[...d.points,d.points[0]];
    return`<Placemark><name>${d.name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${pts.map(([la,lo])=>`${lo},${la},0`).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  });
  return`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>SurveyMap Pro</name>${pm.join("")}</Document></kml>`;
}
function drawingsToCSV(drawings) {
  const rows=["name,type,latitude,longitude"];
  drawings.forEach((d)=>d.points.forEach(([lat,lng])=>rows.push(`"${d.name}","${d.type}",${lat},${lng}`)));
  return rows.join("\n");
}
function download(data,filename,mime){
  const blob=new Blob([data],{type:mime});
  const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:filename});
  a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

// ── Layer definitions with toolbar order ─────────────────────────────────────
const TOOLBAR_LAYERS = [
  { key:"Satellite",        label:"Satellite",  icon:"🛰️",  activeColor:"#2563eb" },
  { key:"Street",           label:"Street",     icon:"🗺️",  activeColor:"#16a34a" },
  { key:"Terrain",          label:"Terrain",    icon:"⛰️",  activeColor:"#b45309" },
  { key:"Satellite + Labels",label:"+Labels",   icon:"🏷️",  activeColor:"#7c3aed" },
  { key:"Dark",             label:"Dark",       icon:"🌑",  activeColor:"#1e293b" },
  { key:"Light",            label:"Light",      icon:"☀️",  activeColor:"#f59e0b" },
];
const PANEL_ONLY_LAYERS = [
  { key:"Hillshade",  label:"Hillshade", icon:"🗻" },
  { key:"Contour",    label:"Contour",   icon:"📈" },
];

// ═════════════════════════════════════════════════════════════════════════════
export default function Globe3DView({ savedDrawings = [], onClose }) {
  const containerRef = useRef(null);
  const viewerRef    = useRef(null);
  const CesiumRef    = useRef(null);

  const [cesiumReady,    setCesiumReady]    = useState(false);
  const [initError,      setInitError]      = useState(null);
  const [activeLayer,    setActiveLayer]    = useState("Satellite");
  const [mousePos,       setMousePos]       = useState(null);
  const [cameraAlt,      setCameraAlt]      = useState(10000000);
  const [compassHeading, setCompassHeading] = useState(0);
  const [viewMode,       setViewMode]       = useState("3D");

  // Panel sections collapse state
  const [openSections, setOpenSections] = useState({ places:true, layers:true, tools:true, measure:false, survey:false });
  const toggleSection = (k) => setOpenSections(p=>({...p,[k]:!p[k]}));

  // Draw state
  const [drawMode,      setDrawMode]      = useState(false);
  const [drawType,      setDrawType]      = useState("path");
  const [drawPoints,    setDrawPoints]    = useState([]);
  const [localDrawings, setLocalDrawings] = useState([...savedDrawings]);
  const [showModal,     setShowModal]     = useState(false);
  const [pendingName,   setPendingName]   = useState("");
  const [pendingPts,    setPendingPts]    = useState([]);
  const [pendingType,   setPendingType]   = useState("path");

  // Measure state
  const [measureMode,   setMeasureMode]   = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measureUnit,   setMeasureUnit]   = useState("auto");

  // Survey state
  const [surveyMode,  setSurveyMode]  = useState(false);
  const [surveyRoute, setSurveyRoute] = useState([]);

  // Search
  const [searchQ,       setSearchQ]       = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [locationInfo,  setLocationInfo]  = useState(null);
  const [showSearch,    setShowSearch]    = useState(false);

  // Night mode
  const [nightAuto,       setNightAuto]       = useState(false);
  const [nightSwitchInfo, setNightSwitchInfo] = useState(null);

  // Files
  const [kmlName,   setKmlName]   = useState(null);
  const [csvStatus, setCsvStatus] = useState(null);
  const [csvCount,  setCsvCount]  = useState(0);
  const [csvInfo,   setCsvInfo]   = useState(null);

  // Export panel
  const [showExport, setShowExport] = useState(false);

  const csvPickHandlerRef = useRef(null);
  const hoveredEntityRef  = useRef(null);
  const drawPtsRef        = useRef([]);
  const measurePtsRef     = useRef([]);
  const surveyPtsRef      = useRef([]);
  const measureEntsRef    = useRef([]);
  const surveyEntsRef     = useRef([]);
  const boundaryEntsRef   = useRef([]);
  const gpsEntRef         = useRef(null);
  const clickHandlerRef   = useRef(null);
  const csvDataSourceRef  = useRef(null);

  // ── INIT ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let viewer;
    (async () => {
      try {
        const Cesium = await import("cesium");
        await import("cesium/Build/Cesium/Widgets/widgets.css");
        CesiumRef.current = Cesium;
        Cesium.Ion.defaultAccessToken = "";
        const creditDiv = document.createElement("div");
        viewer = new Cesium.Viewer(containerRef.current, {
          terrainProvider: new Cesium.EllipsoidTerrainProvider({}),
          timeline:false, animation:false, baseLayerPicker:false, geocoder:false,
          homeButton:false, sceneModePicker:false, navigationHelpButton:false,
          fullscreenButton:false, infoBox:false, selectionIndicator:false,
          creditContainer:creditDiv,
        });
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(buildImageryProvider(Cesium, "Satellite"));
        viewerRef.current = viewer;
        setCesiumReady(true);

        viewer.scene.postRender.addEventListener(() => {
          try {
            const c = viewer.camera.positionCartographic;
            if (c) setCameraAlt(c.height);
            const heading = viewer.camera.heading;
            if (heading != null && !isNaN(heading)) setCompassHeading(Cesium.Math.toDegrees(heading));
          } catch (_) {}
        });

        const mh = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        mh.setInputAction((e) => {
          try {
            const ray = viewer.camera.getPickRay(e.endPosition);
            if (!ray) return;
            const pos = viewer.scene.globe.pick(ray, viewer.scene);
            if (!pos) { setMousePos(null); return; }
            const c = Cesium.Cartographic.fromCartesian(pos);
            setMousePos({ lat:Cesium.Math.toDegrees(c.latitude), lng:Cesium.Math.toDegrees(c.longitude) });
          } catch (_) {}
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        savedDrawings.forEach((d) => renderDrawing(viewer, Cesium, d));
      } catch (err) {
        console.error("Cesium init:", err);
        setInitError(err.message);
      }
    })();
    return () => { if (viewer && !viewer.isDestroyed()) viewer.destroy(); };
  }, []); // eslint-disable-line

  // ── LAYER SWITCH ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cesiumReady) return;
    const Cesium=CesiumRef.current, viewer=viewerRef.current;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(buildImageryProvider(Cesium, activeLayer));
    if (activeLayer==="Satellite + Labels") {
      viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url:"https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        maximumLevel:19, credit:"© Esri Labels",
      }));
    }
  }, [activeLayer, cesiumReady]);

  // ── VIEW MODE ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cesiumReady) return;
    const Cesium=CesiumRef.current, viewer=viewerRef.current;
    if (viewMode==="3D")       viewer.scene.morphTo3D(1.0);
    if (viewMode==="2D")       viewer.scene.morphTo2D(1.0);
    if (viewMode==="Columbus") viewer.scene.morphToColumbusView(1.0);
  }, [viewMode, cesiumReady]);

  // ── NIGHT MODE ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nightAuto) return;
    let timer;
    (async () => {
      try {
        const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:8000}));
        const {latitude:lat,longitude:lng} = pos.coords;
        const data = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=sunrise,sunset&timezone=auto&forecast_days=1`)).json();
        const sunrise=new Date(data.daily.sunrise[0]),sunset=new Date(data.daily.sunset[0]);
        const check=()=>{ const now=new Date(),isNight=now<sunrise||now>sunset; setNightSwitchInfo({isNight,sunrise,sunset}); setActiveLayer(isNight?"Dark":"Satellite + Labels"); };
        check(); timer=setInterval(check,60000);
      } catch(e) { console.warn("Night mode:",e); }
    })();
    return ()=>clearInterval(timer);
  }, [nightAuto]);

  // ── CLICK HANDLER ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cesiumReady) return;
    const Cesium=CesiumRef.current, viewer=viewerRef.current;
    if (clickHandlerRef.current) { clickHandlerRef.current.destroy(); clickHandlerRef.current=null; }
    if (!drawMode && !measureMode && !surveyMode) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandlerRef.current = handler;
    handler.setInputAction((click) => {
      const ray=viewer.camera.getPickRay(click.position); if(!ray) return;
      const pos=viewer.scene.globe.pick(ray,viewer.scene); if(!pos) return;
      const carto=Cesium.Cartographic.fromCartesian(pos);
      const lat=Cesium.Math.toDegrees(carto.latitude), lng=Cesium.Math.toDegrees(carto.longitude), pt={lat,lng};
      if (drawMode) {
        if (drawType==="marker") { setPendingPts([pt]);setPendingType("marker");setPendingName("");setShowModal(true);setDrawMode(false);return; }
        const next=[...drawPtsRef.current,pt]; drawPtsRef.current=next; setDrawPoints([...next]);
        viewer.entities.add({position:pos,point:{pixelSize:7,color:Cesium.Color.fromCssColorString("#f97316"),outlineColor:Cesium.Color.WHITE,outlineWidth:1}});
      }
      if (measureMode) {
        const next=[...measurePtsRef.current,pt]; measurePtsRef.current=next; setMeasurePoints([...next]);
        const dot=viewer.entities.add({position:pos,point:{pixelSize:9,color:Cesium.Color.YELLOW,outlineColor:Cesium.Color.BLACK,outlineWidth:1}});
        measureEntsRef.current.push(dot);
        if (next.length>=2) {
          const line=viewer.entities.add({polyline:{positions:next.map(p=>Cesium.Cartesian3.fromDegrees(p.lng,p.lat)),width:2,material:new Cesium.PolylineDashMaterialProperty({color:Cesium.Color.YELLOW}),clampToGround:true}});
          measureEntsRef.current.push(line);
        }
      }
      if (surveyMode) {
        const next=[...surveyPtsRef.current,pt]; surveyPtsRef.current=next; setSurveyRoute([...next]);
        const pin=viewer.entities.add({
          position:Cesium.Cartesian3.fromDegrees(lng,lat),
          point:{pixelSize:11,color:Cesium.Color.RED,outlineColor:Cesium.Color.WHITE,outlineWidth:2},
          label:{text:String(next.length),font:"bold 13px sans-serif",fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-22)},
        });
        surveyEntsRef.current.push(pin);
        if (next.length>=2) {
          const line=viewer.entities.add({polyline:{positions:next.map(p=>Cesium.Cartesian3.fromDegrees(p.lng,p.lat)),width:3,material:Cesium.Color.RED.withAlpha(0.8),clampToGround:true}});
          surveyEntsRef.current.push(line);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return ()=>{ if(clickHandlerRef.current){clickHandlerRef.current.destroy();clickHandlerRef.current=null;} };
  }, [drawMode,measureMode,surveyMode,drawType,cesiumReady]);

  // ── RENDER DRAWING ────────────────────────────────────────────────────────
  function renderDrawing(viewer, Cesium, d) {
    if (d.type==="marker") {
      const [lat,lng]=d.points[0];
      viewer.entities.add({
        position:Cesium.Cartesian3.fromDegrees(lng,lat),
        point:{pixelSize:12,color:Cesium.Color.fromCssColorString("#3b82f6"),outlineColor:Cesium.Color.WHITE,outlineWidth:2},
        label:{text:d.name,font:"bold 12px sans-serif",fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-22),showBackground:true,backgroundColor:new Cesium.Color(0.1,0.14,0.23,0.9),backgroundPadding:new Cesium.Cartesian2(6,4)},
      });
    } else if (d.type==="path") {
      viewer.entities.add({polyline:{positions:d.points.map(([la,lo])=>Cesium.Cartesian3.fromDegrees(lo,la)),width:3,material:Cesium.Color.fromCssColorString("#f97316"),clampToGround:true}});
    } else if (d.type==="polygon") {
      viewer.entities.add({polygon:{hierarchy:new Cesium.PolygonHierarchy(d.points.map(([la,lo])=>Cesium.Cartesian3.fromDegrees(lo,la))),material:Cesium.Color.fromCssColorString("#3b82f6").withAlpha(0.25),outline:true,outlineColor:Cesium.Color.fromCssColorString("#3b82f6")}});
    }
  }

  // ── DRAW ACTIONS ──────────────────────────────────────────────────────────
  function finishDrawing() { if(!drawPtsRef.current.length)return; setPendingPts([...drawPtsRef.current]);setPendingType(drawType);setPendingName("");setShowModal(true); }
  function confirmDrawing() {
    const name=pendingName.trim()||(pendingType==="marker"?"Marker":pendingType==="path"?"Path":"Polygon");
    const drawing={name,type:pendingType,points:pendingPts.map(p=>[p.lat,p.lng])};
    setLocalDrawings(prev=>[...prev,drawing]);
    renderDrawing(viewerRef.current,CesiumRef.current,drawing);
    drawPtsRef.current=[];setDrawPoints([]);setShowModal(false);setDrawMode(false);
  }
  function cancelDrawing(){drawPtsRef.current=[];setDrawPoints([]);setShowModal(false);setDrawMode(false);}

  // ── MEASURE ───────────────────────────────────────────────────────────────
  function resetMeasure(){measureEntsRef.current.forEach(e=>viewerRef.current.entities.remove(e));measureEntsRef.current=[];measurePtsRef.current=[];setMeasurePoints([]);}
  function clearMeasure(){resetMeasure();setMeasureMode(false);}
  const totalDist=measurePoints.length>=2?measurePoints.reduce((s,p,i)=>i===0?0:s+haversine(measurePoints[i-1],p),0):0;

  // ── SURVEY ────────────────────────────────────────────────────────────────
  function clearSurvey(){surveyEntsRef.current.forEach(e=>viewerRef.current.entities.remove(e));surveyEntsRef.current=[];surveyPtsRef.current=[];setSurveyRoute([]);setSurveyMode(false);}

  // ── GPS ───────────────────────────────────────────────────────────────────
  function handleGPS() {
    if(!cesiumReady)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    navigator.geolocation.getCurrentPosition(({coords:{latitude:lat,longitude:lng}})=>{
      if(gpsEntRef.current)viewer.entities.remove(gpsEntRef.current);
      gpsEntRef.current=viewer.entities.add({
        position:Cesium.Cartesian3.fromDegrees(lng,lat),
        point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#06b6d4"),outlineColor:Cesium.Color.WHITE,outlineWidth:3},
        label:{text:"📍 You",font:"bold 13px sans-serif",fillColor:Cesium.Color.fromCssColorString("#06b6d4"),outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-24)},
      });
      viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lng,lat,8000),duration:2});
    },(err)=>alert("GPS error: "+err.message));
  }

  // ── SEARCH ────────────────────────────────────────────────────────────────
  async function handleSearch(e) {
    e.preventDefault(); if(!searchQ.trim()||!cesiumReady)return;
    setSearchLoading(true);setLocationInfo(null);
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    try {
      const nomUrl=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQ)}&format=json&limit=5&polygon_geojson=1&addressdetails=1`;
      const proxies=[`https://corsproxy.io/?url=${encodeURIComponent(nomUrl)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(nomUrl)}`];
      let place=null;
      for(const px of proxies){try{const res=await fetch(px,{signal:AbortSignal.timeout(6000)});if(!res.ok)continue;const data=await res.json();if(!Array.isArray(data)||!data.length)continue;place=data.find(r=>r.geojson?.type==="MultiPolygon")||data.find(r=>r.geojson?.type==="Polygon")||data[0];break;}catch{}}
      if(!place){alert("Location not found.");setSearchLoading(false);return;}
      const lat=parseFloat(place.lat),lng=parseFloat(place.lon);
      viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lng,lat,120000),duration:2});
      viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),point:{pixelSize:14,color:Cesium.Color.fromCssColorString("#3b82f6"),outlineColor:Cesium.Color.WHITE,outlineWidth:2}});
      boundaryEntsRef.current.forEach(e=>viewer.entities.remove(e));boundaryEntsRef.current=[];
      if(place.geojson){
        const rings=place.geojson.type==="Polygon"?[place.geojson.coordinates[0]]:place.geojson.coordinates.map(p=>p[0]);
        rings.forEach(ring=>{const ent=viewer.entities.add({polygon:{hierarchy:new Cesium.PolygonHierarchy(ring.map(([lo,la])=>Cesium.Cartesian3.fromDegrees(lo,la))),material:Cesium.Color.fromCssColorString("#3b82f6").withAlpha(0.1),outline:true,outlineColor:Cesium.Color.fromCssColorString("#3b82f6"),outlineWidth:2}});boundaryEntsRef.current.push(ent);});
      }
      const placeName=place.display_name?.split(",")?.[0]||searchQ;
      let description=null,wikiUrl=null,photo=null;
      try{const wr=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(placeName)}`);if(wr.ok){const w=await wr.json();description=w.extract;wikiUrl=w.content_urls?.desktop?.page;photo=w.thumbnail?.source||null;}}catch{}
      const addr=place.address||{};
      const details=[addr.city||addr.town||addr.village,addr.state,addr.country].filter(Boolean).join(", ");
      setLocationInfo({lat,lng,name:placeName,details,description,wikiUrl,photo});
    } catch(err){console.error(err);}
    setSearchLoading(false);
  }

  // ── KML ───────────────────────────────────────────────────────────────────
  function handleKML(e){
    const file=e.target.files[0];if(!file||!cesiumReady)return;
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    setKmlName(file.name);
    Cesium.KmlDataSource.load(URL.createObjectURL(file),{camera:viewer.scene.camera,canvas:viewer.scene.canvas}).then(ds=>{viewer.dataSources.add(ds);viewer.zoomTo(ds);});
    e.target.value="";
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  function handleCSV(e) {
    const file=e.target.files[0];if(!file||!cesiumReady)return;
    e.target.value="";
    const Cesium=CesiumRef.current,viewer=viewerRef.current;
    if(csvPickHandlerRef.current){csvPickHandlerRef.current.destroy();csvPickHandlerRef.current=null;}
    if(csvDataSourceRef.current){viewer.dataSources.remove(csvDataSourceRef.current,true);csvDataSourceRef.current=null;}
    setCsvInfo(null);setCsvStatus("loading");setCsvCount(0);
    Papa.parse(file,{header:true,skipEmptyLines:true,complete(results){
      const rows=results.data;
      if(!rows.length){alert("CSV file is empty.");setCsvStatus("error");return;}
      const headers=Object.keys(rows[0]);
      const latKey=findColKey(headers,LAT_KEYS),lngKey=findColKey(headers,LNG_KEYS);
      if(!latKey||!lngKey){alert(`CSV missing lat/lng columns.\nFound: ${headers.join(", ")}`);setCsvStatus("error");return;}
      const capped=rows.slice(0,CSV_MAX_MARKERS),wasCapped=rows.length>CSV_MAX_MARKERS;
      const dataSource=new Cesium.CustomDataSource("csv-layer");
      dataSource.clustering.enabled=true;dataSource.clustering.pixelRange=50;dataSource.clustering.minimumClusterSize=3;
      dataSource.clustering.clusterEvent.addEventListener((clusteredEntities,cluster)=>{
        const count=clusteredEntities.length;
        cluster.point.show=true;cluster.label.show=false;
        cluster.point.color=count>200?Cesium.Color.fromCssColorString("#ef4444"):count>30?Cesium.Color.fromCssColorString("#f97316"):Cesium.Color.fromCssColorString("#3b82f6");
        cluster.point.pixelSize=count>200?34:count>30?26:18;cluster.point.outlineColor=Cesium.Color.WHITE;cluster.point.outlineWidth=2;
        cluster.point.disableDepthTestDistance=Number.POSITIVE_INFINITY;
        cluster.label.show=true;cluster.label.text=String(count);cluster.label.font="bold 12px sans-serif";
        cluster.label.fillColor=Cesium.Color.WHITE;cluster.label.outlineColor=Cesium.Color.BLACK;cluster.label.outlineWidth=2;
        cluster.label.style=Cesium.LabelStyle.FILL_AND_OUTLINE;cluster.label.verticalOrigin=Cesium.VerticalOrigin.CENTER;
        cluster.label.horizontalOrigin=Cesium.HorizontalOrigin.CENTER;cluster.label.disableDepthTestDistance=Number.POSITIVE_INFINITY;
      });
      let skipped=0;
      const validRows=capped.filter(row=>{const lat=parseFloat(row[latKey]),lng=parseFloat(row[lngKey]);if(isNaN(lat)||isNaN(lng)||lat<-90||lat>90||lng<-180||lng>180){skipped++;return false;}return true;});
      if(!validRows.length){alert(`No valid coords found. ${skipped} rows skipped.`);setCsvStatus("error");return;}
      processInChunks(validRows,300,(row)=>{
        const lat=parseFloat(row[latKey]),lng=parseFloat(row[lngKey]);
        const nameVal=row["name"]||row["Name"]||row["NAME"]||row["title"]||row["Title"]||row["location.name"]||row["place"]||null;
        const extraKeys=Object.keys(rows[0]).filter(h=>h!==latKey&&h!==lngKey&&row[h]!==""&&row[h]!=null).slice(0,12);
        const rowData={lat,lng,name:nameVal,fields:{}};
        extraKeys.filter(k=>!["name","Name","NAME","title","Title","location.name","place"].includes(k)).forEach(k=>{rowData.fields[k]=String(row[k]).slice(0,100);});
        dataSource.entities.add({name:nameVal||`${lat.toFixed(4)}, ${lng.toFixed(4)}`,position:Cesium.Cartesian3.fromDegrees(lng,lat),
          point:{pixelSize:9,color:Cesium.Color.fromCssColorString("#22c55e"),outlineColor:Cesium.Color.WHITE,outlineWidth:1.5,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY},
          description:JSON.stringify(rowData)});
      },async()=>{
        await viewer.dataSources.add(dataSource);csvDataSourceRef.current=dataSource;
        viewer.flyTo(dataSource,{duration:2,offset:new Cesium.HeadingPitchRange(0,Cesium.Math.toRadians(-45),0)});
        setCsvStatus("done");setCsvCount(validRows.length);
        if(csvPickHandlerRef.current){csvPickHandlerRef.current.destroy();csvPickHandlerRef.current=null;}
        const pickHandler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);csvPickHandlerRef.current=pickHandler;
        function pickCsvEntity(pos){const hits=viewer.scene.drillPick(pos,5);for(const hit of hits){const eid=hit?.id;if(eid&&dataSource.entities.contains(eid))return eid;}return null;}
        pickHandler.setInputAction((click)=>{
          const entity=pickCsvEntity(click.position);if(!entity){setCsvInfo(null);return;}
          const rect=viewer.scene.canvas.getBoundingClientRect();let rowData=null;
          try{const desc=entity.description;const raw=typeof desc?.getValue==="function"?desc.getValue(Cesium.JulianDate.now()):String(desc??"{}");rowData=JSON.parse(raw);}catch{rowData={lat:0,lng:0,name:entity.name,fields:{}};}
          setCsvInfo({name:entity.name||"Point",rowData,x:Math.min(click.position.x+rect.left+16,window.innerWidth-310),y:Math.max(click.position.y+rect.top-10,60)});
        },Cesium.ScreenSpaceEventType.LEFT_CLICK);
        pickHandler.setInputAction((move)=>{
          if(hoveredEntityRef.current){const prev=hoveredEntityRef.current;if(prev.point){prev.point.color=new Cesium.ConstantProperty(Cesium.Color.fromCssColorString("#22c55e"));prev.point.pixelSize=new Cesium.ConstantProperty(9);}hoveredEntityRef.current=null;viewer.scene.canvas.style.cursor="default";}
          const entity=pickCsvEntity(move.endPosition);if(!entity||!entity.point)return;
          entity.point.color=new Cesium.ConstantProperty(Cesium.Color.fromCssColorString("#facc15"));entity.point.pixelSize=new Cesium.ConstantProperty(16);hoveredEntityRef.current=entity;viewer.scene.canvas.style.cursor="pointer";
        },Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      });
    },error(err){console.error("CSV:",err);alert("Failed to parse CSV.");setCsvStatus("error");}});
  }

  // ── ZOOM / TILT ───────────────────────────────────────────────────────────
  function zoomIn()  { if(!cesiumReady)return; viewerRef.current.camera.zoomIn(viewerRef.current.camera.positionCartographic.height*0.4); }
  function zoomOut() { if(!cesiumReady)return; viewerRef.current.camera.zoomOut(viewerRef.current.camera.positionCartographic.height*0.6); }
  function resetView(){ if(!cesiumReady)return; const Cesium=CesiumRef.current,viewer=viewerRef.current; viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(0,20,20000000),orientation:{heading:0,pitch:Cesium.Math.toRadians(-90),roll:0},duration:1.5}); }

  // ── STYLES ────────────────────────────────────────────────────────────────
  const SIDEBAR_W = 260;
  const TOPBAR_H  = 46;
  const STATUSBAR_H = 28;

  const s = {
    // Top bar
    topbar: { position:"fixed",top:0,left:0,right:0,height:TOPBAR_H,zIndex:1100,
      background:"linear-gradient(180deg,#1a2235 0%,#151d2e 100%)",
      borderBottom:"1px solid rgba(255,255,255,0.1)",
      display:"flex",alignItems:"center",padding:"0 0 0 16px",
      fontFamily:"'Segoe UI',system-ui,sans-serif", gap:0,
      boxShadow:"0 2px 12px rgba(0,0,0,0.4)"
    },
    // Left panel
    panel: { position:"fixed",top:TOPBAR_H,left:0,bottom:STATUSBAR_H,width:SIDEBAR_W,zIndex:1000,
      background:"#1a2235",borderRight:"1px solid rgba(255,255,255,0.08)",
      display:"flex",flexDirection:"column",fontFamily:"'Segoe UI',system-ui,sans-serif",
      overflowY:"auto",
    },
    sectionHeader: (open) => ({
      display:"flex",alignItems:"center",justifyContent:"space-between",
      padding:"8px 14px",cursor:"pointer",userSelect:"none",
      background:"rgba(255,255,255,0.02)",
      borderBottom:`1px solid rgba(255,255,255,${open?0.07:0.04})`,
      color:"#94a3b8",fontSize:11,fontWeight:700,letterSpacing:"0.07em",
      transition:"background 0.15s",
    }),
    sectionBody: { padding:"10px 14px 12px", borderBottom:"1px solid rgba(255,255,255,0.04)" },
    // Tool button in top bar
    toolBtn: (active) => ({
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      padding:"0 14px",height:TOPBAR_H,border:"none",cursor:"pointer",gap:2,
      background:active?"rgba(59,130,246,0.2)":"transparent",
      borderBottom:active?"2px solid #3b82f6":"2px solid transparent",
      color:active?"#60a5fa":"#94a3b8",
      fontSize:10,fontWeight:600,letterSpacing:"0.04em",
      transition:"all 0.15s",
      minWidth:54,
    }),
    // Layer btn in panel
    layerRow: (active) => ({
      display:"flex",alignItems:"center",gap:10,padding:"7px 10px",borderRadius:6,
      cursor:"pointer",userSelect:"none",marginBottom:2,
      background:active?"rgba(59,130,246,0.18)":"transparent",
      border:`1px solid ${active?"rgba(59,130,246,0.45)":"transparent"}`,
      transition:"all 0.15s",
    }),
    checkbox: (active) => ({
      width:16,height:16,borderRadius:3,border:`2px solid ${active?"#3b82f6":"rgba(255,255,255,0.3)"}`,
      background:active?"#3b82f6":"transparent",flexShrink:0,
      display:"flex",alignItems:"center",justifyContent:"center",
    }),
    // Primary action btn
    primaryBtn: (color="#3b82f6") => ({
      width:"100%",padding:"8px 12px",borderRadius:6,border:"none",
      background:color,color:"#fff",fontWeight:600,fontSize:12,
      cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6,
      transition:"filter 0.15s",
    }),
    // Draw type tabs
    typeTab: (active) => ({
      flex:1,padding:"6px 4px",borderRadius:5,border:"none",cursor:"pointer",
      fontSize:10,fontWeight:600,
      background:active?"#f97316":"rgba(255,255,255,0.06)",
      color:active?"#fff":"#64748b",
      display:"flex",flexDirection:"column",alignItems:"center",gap:1,
      transition:"all 0.15s",
    }),
    // Status bar
    statusBar: { position:"fixed",bottom:0,left:0,right:0,height:STATUSBAR_H,zIndex:1100,
      background:"#131b2b",borderTop:"1px solid rgba(255,255,255,0.08)",
      display:"flex",alignItems:"center",padding:"0 16px",gap:16,
      fontFamily:"'Courier New',monospace",fontSize:11,color:"#64748b",userSelect:"none",
    },
    iconBtn: (active=false) => ({
      width:32,height:32,borderRadius:6,border:`1px solid ${active?"rgba(96,165,250,0.4)":"rgba(255,255,255,0.1)"}`,
      background:active?"rgba(59,130,246,0.2)":"rgba(255,255,255,0.04)",
      color:active?"#60a5fa":"#94a3b8",cursor:"pointer",display:"flex",alignItems:"center",
      justifyContent:"center",fontSize:14,transition:"all 0.15s",
    }),
  };

  const allLayers = [...TOOLBAR_LAYERS, ...PANEL_ONLY_LAYERS];

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* MAP CANVAS */}
      <div ref={containerRef} style={{
        position:"fixed",
        top:TOPBAR_H, left:SIDEBAR_W, right:0, bottom:STATUSBAR_H,
        zIndex:900, background:"#0d1420"
      }}/>

      {/* LOADING */}
      {!cesiumReady&&!initError&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(13,20,32,0.97)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <div style={{width:40,height:40,border:"3px solid rgba(255,255,255,0.08)",borderTopColor:"#3b82f6",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
          <div style={{color:"#64748b",fontSize:13,fontFamily:"'Segoe UI',sans-serif"}}>Loading SurveyMap 3D…</div>
        </div>
      )}
      {initError&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(13,20,32,0.97)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
          <div style={{color:"#ef4444",fontSize:15,fontWeight:700}}>⚠ Failed to initialize</div>
          <div style={{color:"#475569",fontSize:12,maxWidth:340,textAlign:"center"}}>{initError}</div>
          <button onClick={onClose} style={{marginTop:8,padding:"8px 20px",borderRadius:6,border:"none",background:"#3b82f6",color:"#fff",fontWeight:600,cursor:"pointer"}}>← Back to 2D</button>
        </div>
      )}

      {/* ── TOP BAR ── */}
      <div style={s.topbar}>
        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:8,paddingRight:20,borderRight:"1px solid rgba(255,255,255,0.08)",marginRight:4,minWidth:160}}>
          <div style={{width:22,height:22,borderRadius:5,background:"linear-gradient(135deg,#3b82f6,#06b6d4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🌍</div>
          <div>
            <div style={{color:"#f1f5f9",fontWeight:700,fontSize:13,letterSpacing:"-0.01em"}}>SurveyMap Pro</div>
          </div>
        </div>

        {/* Menu items — File, Edit, View, Tools, Add, Help */}
        {["File","Edit","View","Tools","Add","Help"].map(m=>(
          <div key={m} style={{padding:"0 12px",height:TOPBAR_H,display:"flex",alignItems:"center",color:"#94a3b8",fontSize:12,cursor:"pointer",borderBottom:"2px solid transparent",transition:"color 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.color="#f1f5f9";}}
            onMouseLeave={e=>{e.currentTarget.style.color="#94a3b8";}}>
            {m}
          </div>
        ))}

        <div style={{width:1,height:24,background:"rgba(255,255,255,0.08)",margin:"0 4px"}}/>

        {/* Layer shortcuts */}
        {TOOLBAR_LAYERS.map(l=>(
          <button key={l.key} onClick={()=>setActiveLayer(l.key)} style={s.toolBtn(activeLayer===l.key)}>
            <span style={{fontSize:16}}>{l.icon}</span>
            <span>{l.label}</span>
          </button>
        ))}

        <div style={{width:1,height:24,background:"rgba(255,255,255,0.08)",margin:"0 4px"}}/>

        {/* Tool shortcuts */}
        <button onClick={()=>{setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}} style={s.toolBtn(drawMode)}>
          <span style={{fontSize:15}}>✏️</span><span>Draw</span>
        </button>
        <button onClick={()=>setMeasureMode(true)} style={s.toolBtn(measureMode)}>
          <span style={{fontSize:15}}>📏</span><span>Measure</span>
        </button>
        <button onClick={()=>setSurveyMode(true)} style={s.toolBtn(surveyMode)}>
          <span style={{fontSize:15}}>📐</span><span>Survey</span>
        </button>
        <button style={s.toolBtn(false)} onClick={()=>{}}>
          <label style={{cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:15}}>📄</span><span>KML</span>
            <input type="file" accept=".kml,.kmz" onChange={handleKML} style={{display:"none"}}/>
          </label>
        </button>
        <button style={s.toolBtn(false)}>
          <label style={{cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:15}}>📊</span><span>CSV/KMZ</span>
            <input type="file" accept=".csv" onChange={handleCSV} style={{display:"none"}}/>
          </label>
        </button>

        <div style={{width:1,height:24,background:"rgba(255,255,255,0.08)",margin:"0 4px"}}/>

        {/* 3D Globe active indicator */}
        <button style={{...s.toolBtn(true),background:"rgba(59,130,246,0.15)",borderBottom:"2px solid #3b82f6"}}>
          <span style={{fontSize:15}}>🌐</span><span>3D Globe</span>
        </button>

        {/* Night toggle */}
        <button onClick={()=>setNightAuto(p=>!p)} style={s.toolBtn(nightAuto)}>
          <span style={{fontSize:15}}>{nightAuto?"🌙":"🌙"}</span><span>Night</span>
        </button>

        {/* Sign In */}
        <div style={{marginLeft:"auto",paddingRight:16}}>
          <button onClick={onClose} style={{padding:"6px 14px",borderRadius:5,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#94a3b8",fontSize:12,cursor:"pointer",fontWeight:500,transition:"all 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.06)";e.currentTarget.style.color="#f1f5f9";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
            ← Back to 2D
          </button>
        </div>
      </div>

      {/* ── LEFT PANEL ── */}
      <div style={s.panel}>

        {/* SEARCH */}
        <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:"0.07em",marginBottom:6}}>🔍 SEARCH</div>
          <form onSubmit={handleSearch} style={{display:"flex",gap:4}}>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search location or lat, lng…"
              style={{flex:1,padding:"7px 10px",borderRadius:5,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.05)",color:"#e2e8f0",fontSize:11,outline:"none",fontFamily:"inherit"}}/>
            <button type="submit" disabled={searchLoading} style={{padding:"7px 10px",borderRadius:5,border:"none",background:"#3b82f6",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>
              {searchLoading?"…":"↵"}
            </button>
          </form>
          <div style={{display:"flex",gap:6,marginTop:7}}>
            <button onClick={handleGPS} style={{flex:1,padding:"6px",borderRadius:5,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.04)",color:"#94a3b8",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
              <span>📍</span> Get Directions
            </button>
            <button style={{flex:1,padding:"6px",borderRadius:5,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.04)",color:"#94a3b8",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
              <span>🕐</span> History
            </button>
          </div>
        </div>

        {/* PLACES */}
        <div>
          <div style={s.sectionHeader(openSections.places)} onClick={()=>toggleSection("places")}>
            <span>⭐ PLACES</span>
            <span style={{fontSize:9}}>{openSections.places?"▾":"▸"}</span>
          </div>
          {openSections.places&&(
            <div style={s.sectionBody}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                <span style={{fontSize:13}}>⭐</span>
                <span style={{color:"#e2e8f0",fontSize:12,fontWeight:600}}>My Places</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,paddingLeft:4}}>
                <span style={{fontSize:12}}>📁</span>
                <span style={{color:"#94a3b8",fontSize:11}}>Temporary Places</span>
              </div>
              {localDrawings.length===0&&(
                <div style={{color:"#334155",fontSize:10,paddingLeft:4,fontStyle:"italic"}}>No saved drawings</div>
              )}
              {localDrawings.map((d,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 4px",borderRadius:4,marginBottom:1}}>
                  <span style={{fontSize:11}}>{d.type==="path"?"〰️":d.type==="polygon"?"⬡":"📍"}</span>
                  <span style={{color:"#94a3b8",fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</span>
                </div>
              ))}
              <div style={{display:"flex",gap:5,marginTop:8}}>
                <button style={{flex:1,padding:"5px 6px",borderRadius:5,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.04)",color:"#94a3b8",fontSize:10,cursor:"pointer"}}>📁 Folder</button>
                <button onClick={()=>{setDrawType("marker");setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}} style={{flex:1,padding:"5px 6px",borderRadius:5,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.04)",color:"#94a3b8",fontSize:10,cursor:"pointer"}}>📍 Mark</button>
                <button onClick={()=>{setDrawType("path");setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}} style={{flex:1,padding:"5px 6px",borderRadius:5,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.04)",color:"#94a3b8",fontSize:10,cursor:"pointer"}}>〰 Path</button>
              </div>

              {/* Export */}
              {localDrawings.length>0&&(
                <div style={{marginTop:8}}>
                  <div style={{color:"#475569",fontSize:10,marginBottom:5,fontWeight:600}}>EXPORT</div>
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    <button onClick={()=>download(drawingsToKML(localDrawings),"survey.kml","application/vnd.google-earth.kml+xml")} style={{padding:"5px 8px",borderRadius:5,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)",color:"#94a3b8",fontSize:10,cursor:"pointer",textAlign:"left"}}>📌 Export KML</button>
                    <button onClick={()=>download(JSON.stringify(drawingsToGeoJSON(localDrawings),null,2),"survey.geojson","application/geo+json")} style={{padding:"5px 8px",borderRadius:5,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)",color:"#94a3b8",fontSize:10,cursor:"pointer",textAlign:"left"}}>🌐 Export GeoJSON</button>
                    <button onClick={()=>download(drawingsToCSV(localDrawings),"survey.csv","text/csv")} style={{padding:"5px 8px",borderRadius:5,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)",color:"#94a3b8",fontSize:10,cursor:"pointer",textAlign:"left"}}>📊 Export CSV</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* LAYERS */}
        <div>
          <div style={s.sectionHeader(openSections.layers)} onClick={()=>toggleSection("layers")}>
            <span>🗂 LAYERS</span>
            <span style={{fontSize:9}}>{openSections.layers?"▾":"▸"}</span>
          </div>
          {openSections.layers&&(
            <div style={s.sectionBody}>
              {/* Auto Night */}
              <div style={{...s.layerRow(nightAuto),marginBottom:6}} onClick={()=>setNightAuto(p=>!p)}>
                <div style={{...s.checkbox(nightAuto)}}>
                  {nightAuto&&<span style={{color:"#fff",fontSize:9,lineHeight:1}}>✓</span>}
                </div>
                <span style={{fontSize:13}}>🌙</span>
                <span style={{color:nightAuto?"#e2e8f0":"#94a3b8",fontSize:12}}>Auto Night Mode</span>
              </div>
              {allLayers.map(l=>(
                <div key={l.key} style={s.layerRow(activeLayer===l.key)} onClick={()=>setActiveLayer(l.key)}>
                  <div style={s.checkbox(activeLayer===l.key)}>
                    {activeLayer===l.key&&<span style={{color:"#fff",fontSize:9,lineHeight:1}}>✓</span>}
                  </div>
                  <span style={{fontSize:13}}>{l.icon}</span>
                  <span style={{color:activeLayer===l.key?"#e2e8f0":"#94a3b8",fontSize:12}}>{l.label}</span>
                </div>
              ))}

              {/* CSV status */}
              {csvStatus&&(
                <div style={{marginTop:8,padding:"5px 8px",borderRadius:5,
                  background:csvStatus==="done"?"rgba(34,197,94,0.1)":csvStatus==="error"?"rgba(239,68,68,0.1)":"rgba(251,191,36,0.1)",
                  border:`1px solid ${csvStatus==="done"?"#22c55e":csvStatus==="error"?"#ef4444":"#fbbf24"}`,
                  color:csvStatus==="done"?"#22c55e":csvStatus==="error"?"#ef4444":"#fbbf24",fontSize:10,fontWeight:600}}>
                  {csvStatus==="loading"?"⏳ Loading CSV…":csvStatus==="done"?`✅ ${csvCount.toLocaleString()} CSV points`:"❌ CSV error"}
                </div>
              )}
            </div>
          )}
        </div>

        {/* TOOLS */}
        <div>
          <div style={s.sectionHeader(openSections.tools)} onClick={()=>toggleSection("tools")}>
            <span>🔧 TOOLS</span>
            <span style={{fontSize:9}}>{openSections.tools?"▾":"▸"}</span>
          </div>
          {openSections.tools&&(
            <div style={s.sectionBody}>
              {/* Draw Tool */}
              <div style={{color:"#475569",fontSize:10,fontWeight:700,marginBottom:7,letterSpacing:"0.05em"}}>DRAW TOOL</div>
              <div style={{display:"flex",gap:4,marginBottom:8}}>
                {[["path","〰️","Path"],["polygon","⬡","Poly"],["marker","📍","Pin"]].map(([t,icon,lb])=>(
                  <button key={t} onClick={()=>setDrawType(t)} style={s.typeTab(drawType===t)}>
                    <span style={{fontSize:15}}>{icon}</span><span>{lb}</span>
                  </button>
                ))}
              </div>
              {!drawMode?(
                <button onClick={()=>{setDrawMode(true);drawPtsRef.current=[];setDrawPoints([]);}} style={s.primaryBtn("#f97316")}>
                  ▶ Start Drawing
                </button>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{background:"rgba(249,115,22,0.1)",border:"1px solid rgba(249,115,22,0.4)",borderRadius:5,padding:"5px 8px",color:"#fb923c",fontSize:10,fontWeight:600,textAlign:"center"}}>
                    {drawType==="marker"?"Click globe to place":` ${drawPoints.length} pts — click globe`}
                  </div>
                  <div style={{display:"flex",gap:5}}>
                    <button onClick={finishDrawing} style={{flex:1,padding:"7px",borderRadius:5,border:"none",background:"#16a34a",color:"#fff",fontWeight:600,fontSize:11,cursor:"pointer"}}>✅ Done</button>
                    <button onClick={cancelDrawing} style={{flex:1,padding:"7px",borderRadius:5,border:"none",background:"#dc2626",color:"#fff",fontWeight:600,fontSize:11,cursor:"pointer"}}>✖ Cancel</button>
                  </div>
                </div>
              )}

              {/* Measure */}
              <div style={{color:"#475569",fontSize:10,fontWeight:700,margin:"14px 0 7px",letterSpacing:"0.05em"}}>MEASURE</div>
              {!measureMode?(
                <button onClick={()=>setMeasureMode(true)} style={s.primaryBtn("#0891b2")}>
                  📐 Start Measuring
                </button>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{background:"rgba(250,204,21,0.08)",border:"1px solid rgba(250,204,21,0.3)",borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
                    <div style={{color:"#64748b",fontSize:9,fontWeight:700,marginBottom:2}}>DISTANCE</div>
                    <div style={{color:"#facc15",fontSize:17,fontWeight:800,fontFamily:"monospace"}}>{measurePoints.length<2?"—":formatDist(totalDist,measureUnit)}</div>
                    <div style={{color:"#475569",fontSize:9}}>{measurePoints.length} pts</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3}}>
                    {[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"],["nmi","nmi"]].map(([u,lb])=>(
                      <button key={u} onClick={()=>setMeasureUnit(u)} style={{padding:"3px 4px",borderRadius:4,border:"none",cursor:"pointer",fontSize:10,fontWeight:600,background:measureUnit===u?"#0891b2":"rgba(255,255,255,0.04)",color:measureUnit===u?"#fff":"#64748b"}}>{lb}</button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={resetMeasure} style={{flex:1,padding:"5px",borderRadius:5,border:"1px solid rgba(255,255,255,0.08)",background:"transparent",color:"#64748b",fontSize:10,cursor:"pointer"}}>🔄 Reset</button>
                    <button onClick={clearMeasure} style={{flex:1,padding:"5px",borderRadius:5,border:"none",background:"#dc2626",color:"#fff",fontWeight:600,fontSize:10,cursor:"pointer"}}>✖ Done</button>
                  </div>
                </div>
              )}

              {/* Survey */}
              <div style={{color:"#475569",fontSize:10,fontWeight:700,margin:"14px 0 7px",letterSpacing:"0.05em"}}>SURVEY ROUTE</div>
              {!surveyMode?(
                <button onClick={()=>setSurveyMode(true)} style={s.primaryBtn("#7c3aed")}>
                  ▶ Start Survey
                </button>
              ):(
                <>
                  <div style={{background:"rgba(220,38,38,0.1)",border:"1px solid rgba(220,38,38,0.4)",borderRadius:5,padding:"5px 8px",color:"#fca5a5",fontSize:10,fontWeight:600,textAlign:"center",marginBottom:5}}>
                    ● ACTIVE · {surveyRoute.length} point{surveyRoute.length!==1?"s":""}
                  </div>
                  <button onClick={clearSurvey} style={s.primaryBtn("#dc2626")}>⏹ Stop Survey</button>
                </>
              )}
            </div>
          )}
        </div>

        {/* View Mode */}
        <div>
          <div style={s.sectionHeader(true)}>
            <span>🌐 VIEW MODE</span>
          </div>
          <div style={{padding:"10px 14px"}}>
            <div style={{display:"flex",gap:4}}>
              {[["3D","🌍","Globe"],["2D","🗺","Flat"],["Columbus","🧭","Columbus"]].map(([mode,icon,label])=>(
                <button key={mode} onClick={()=>setViewMode(mode)} style={{flex:1,padding:"7px 4px",borderRadius:5,border:`1px solid ${viewMode===mode?"rgba(59,130,246,0.5)":"rgba(255,255,255,0.08)"}`,background:viewMode===mode?"rgba(59,130,246,0.15)":"rgba(255,255,255,0.03)",color:viewMode===mode?"#60a5fa":"#64748b",fontWeight:600,fontSize:10,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <span style={{fontSize:14}}>{icon}</span><span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── ZOOM CONTROLS — right side, clearly visible ── */}
      <div style={{
        position:"fixed", right:16, bottom: STATUSBAR_H + 160,
        zIndex:1002,
        display:"flex", flexDirection:"column",
        background:"rgba(26,34,53,0.97)",
        border:"1px solid rgba(255,255,255,0.15)",
        borderRadius:8,
        boxShadow:"0 4px 20px rgba(0,0,0,0.6)",
        overflow:"hidden",
      }}>
        <button
          onClick={zoomIn}
          title="Zoom In"
          style={{
            width:40, height:40, border:"none", background:"transparent",
            color:"#e2e8f0", fontSize:24, fontWeight:300, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            borderBottom:"1px solid rgba(255,255,255,0.1)",
          }}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}
        >+</button>
        <button
          onClick={zoomOut}
          title="Zoom Out"
          style={{
            width:40, height:40, border:"none", background:"transparent",
            color:"#e2e8f0", fontSize:24, fontWeight:300, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}
        >−</button>
      </div>

      {/* ── Eye alt + Compass (bottom right, stacked) ── */}
      <div style={{position:"fixed",bottom:STATUSBAR_H+8,right:16,zIndex:1001,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
        {/* Eye Alt badge */}
        <div style={{background:"rgba(26,34,53,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,padding:"3px 8px",display:"flex",gap:6,alignItems:"center",pointerEvents:"none"}}>
          <span style={{color:"#475569",fontSize:9,fontWeight:700,letterSpacing:"0.06em"}}>EYE ALT</span>
          <span style={{color:"#94a3b8",fontSize:11,fontFamily:"monospace",fontWeight:600}}>{formatAlt(cameraAlt)}</span>
        </div>
        {/* Compass */}
        <div style={{width:52,height:52,pointerEvents:"none"}}>
          <svg viewBox="0 0 100 100" style={{width:"100%",height:"100%",transform:`rotate(${compassHeading}deg)`,filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.5))"}}>
            <circle cx="50" cy="50" r="48" fill="rgba(26,34,53,0.95)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5"/>
            <polygon points="50,8 55,50 50,46 45,50"  fill="#ef4444"/>
            <polygon points="50,92 55,50 50,54 45,50" fill="#475569"/>
            <polygon points="8,50 50,45 54,50 50,55"  fill="#475569"/>
            <polygon points="92,50 50,45 46,50 50,55" fill="#475569"/>
            <text x="50" y="21" textAnchor="middle" fill="#ef4444" fontSize="12" fontWeight="bold" fontFamily="monospace">N</text>
            <circle cx="50" cy="50" r="4" fill="rgba(255,255,255,0.3)"/>
          </svg>
        </div>
      </div>

      {/* ── STATUS BAR ── */}
      <div style={s.statusBar}>
        {mousePos?(
          <>
            <span style={{color:"#94a3b8"}}>{toDMS(mousePos.lat,"N","S")}</span>
            <span style={{color:"#64748b"}}>·</span>
            <span style={{color:"#94a3b8"}}>{toDMS(mousePos.lng,"E","W")}</span>
            <span style={{color:"#334155"}}>({mousePos.lat.toFixed(5)}, {mousePos.lng.toFixed(5)})</span>
          </>
        ):(
          <span style={{color:"#2d3748"}}>Move cursor over globe…</span>
        )}
        <div style={{flex:1}}/>
        <span style={{color:"#475569",fontSize:10}}>
          {viewMode==="3D"?"🌍 Globe":viewMode==="2D"?"🗺 Flat":"🧭 Columbus"}
        </span>
        {nightAuto&&<span style={{color:"#6366f1",fontSize:10}}>{nightSwitchInfo?.isNight?"🌙 Night":"☀️ Day"}</span>}
        {drawMode&&<span style={{color:"#f97316",fontSize:10}}>✏ Drawing ({drawPoints.length} pts)</span>}
        {measureMode&&<span style={{color:"#facc15",fontSize:10}}>📏 Measuring</span>}
        {surveyMode&&<span style={{color:"#ef4444",fontSize:10}}>● Survey ({surveyRoute.length} pts)</span>}
        <span style={{color:"#1e293b",fontSize:10}}>Zoom {cameraAlt>500000?Math.round(Math.log(20000000/cameraAlt)*2+1):13} © CesiumJS / Esri</span>
      </div>

      {/* ── LOCATION INFO PANEL ── */}
      {locationInfo&&(
        <div style={{position:"fixed",top:TOPBAR_H+16,right:56,width:300,zIndex:1002,background:"#1a2235",borderRadius:10,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.08)",fontFamily:"'Segoe UI',sans-serif"}}>
          {locationInfo.photo&&(
            <div style={{position:"relative",height:140,overflow:"hidden"}}>
              <img src={locationInfo.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#1a2235 0%,transparent 60%)"}}/>
              <div style={{position:"absolute",bottom:10,left:12,color:"#fff",fontWeight:700,fontSize:15}}>{locationInfo.name}</div>
              <button onClick={()=>setLocationInfo(null)} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,0.5)",border:"none",color:"#fff",borderRadius:"50%",width:24,height:24,cursor:"pointer",fontSize:12}}>✕</button>
            </div>
          )}
          <div style={{padding:"12px 14px"}}>
            {!locationInfo.photo&&(
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <div style={{color:"#f1f5f9",fontWeight:700,fontSize:14}}>{locationInfo.name}</div>
                <button onClick={()=>setLocationInfo(null)} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:16}}>✕</button>
              </div>
            )}
            <div style={{display:"flex",gap:6,padding:"6px 8px",background:"rgba(255,255,255,0.03)",borderRadius:6,marginBottom:8}}>
              <span style={{color:"#475569"}}>📍</span>
              <span style={{color:"#94a3b8",fontSize:11,fontFamily:"monospace"}}>{locationInfo.lat.toFixed(6)}°, {locationInfo.lng.toFixed(6)}°</span>
            </div>
            {locationInfo.details&&<div style={{color:"#64748b",fontSize:11,marginBottom:6}}>{locationInfo.details}</div>}
            {locationInfo.description&&<div style={{color:"#94a3b8",fontSize:11,lineHeight:1.6,maxHeight:110,overflowY:"auto",marginBottom:8}}>{locationInfo.description.slice(0,300)}…</div>}
            {locationInfo.wikiUrl&&<a href={locationInfo.wikiUrl} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 10px",background:"rgba(59,130,246,0.1)",borderRadius:5,color:"#60a5fa",fontSize:11,textDecoration:"none",border:"1px solid rgba(59,130,246,0.2)"}}>🌐 Wikipedia ↗</a>}
          </div>
        </div>
      )}

      {/* ── CSV INFO PANEL ── */}
      {csvInfo&&(
        <div style={{position:"fixed",left:csvInfo.x,top:csvInfo.y,zIndex:1100,width:280,background:"#1a2235",borderRadius:8,border:"1px solid rgba(34,197,94,0.35)",boxShadow:"0 8px 30px rgba(0,0,0,0.6)",fontFamily:"'Segoe UI',sans-serif",overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"rgba(34,197,94,0.1)",borderBottom:"1px solid rgba(34,197,94,0.2)"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"#22c55e"}}/>
              <span style={{color:"#f1f5f9",fontWeight:600,fontSize:12,maxWidth:190,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{csvInfo.name}</span>
            </div>
            <button onClick={()=>setCsvInfo(null)} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:12}}>✕</button>
          </div>
          <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
            {[["LAT",csvInfo.rowData?.lat?.toFixed(6)],["LNG",csvInfo.rowData?.lng?.toFixed(6)]].map(([l,v])=>(
              <div key={l} style={{flex:1,padding:"6px 12px",borderRight:l==="LAT"?"1px solid rgba(255,255,255,0.05)":"none"}}>
                <div style={{color:"#475569",fontSize:9,fontWeight:700,marginBottom:1}}>{l}</div>
                <div style={{color:"#22c55e",fontFamily:"monospace",fontSize:11,fontWeight:600}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {Object.entries(csvInfo.rowData?.fields||{}).map(([k,v],i)=>(
              <div key={k} style={{display:"flex",padding:"5px 12px",background:i%2===0?"transparent":"rgba(255,255,255,0.015)",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                <div style={{color:"#475569",fontSize:10,fontWeight:600,minWidth:90,flexShrink:0,textTransform:"capitalize"}}>{k.includes(".")?k.split(".").pop():k}</div>
                <div style={{color:"#e2e8f0",fontSize:11,wordBreak:"break-word"}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DRAW NAME MODAL ── */}
      {showModal&&(
        <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#1a2235",borderRadius:10,padding:22,width:290,boxShadow:"0 8px 40px rgba(0,0,0,0.7)",border:"1px solid rgba(255,255,255,0.08)",fontFamily:"'Segoe UI',sans-serif"}}>
            <div style={{color:"#f1f5f9",fontWeight:700,fontSize:15,marginBottom:4}}>Name this {pendingType}</div>
            <div style={{color:"#475569",fontSize:11,marginBottom:12}}>{pendingPts.length} point{pendingPts.length!==1?"s":""} recorded</div>
            <input autoFocus value={pendingName} onChange={e=>setPendingName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmDrawing()} placeholder="e.g. Survey Path A"
              style={{width:"100%",padding:"8px 11px",borderRadius:6,border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.05)",color:"#f1f5f9",fontSize:13,marginBottom:12,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
            <div style={{display:"flex",gap:7}}>
              <button onClick={confirmDrawing} style={{flex:1,padding:"8px",borderRadius:6,border:"none",background:"#3b82f6",color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}>Save</button>
              <button onClick={cancelDrawing}  style={{flex:1,padding:"8px",borderRadius:6,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#64748b",fontWeight:500,fontSize:13,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}