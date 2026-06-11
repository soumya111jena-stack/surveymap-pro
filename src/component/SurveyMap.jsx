/**
 * SurveyMap.jsx — SurveyMap Pro v7.2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES IN v7.2.1 (backend integration + DIRECTIONS FEATURE added):
 *
 *  DIRECTIONS / ROUTING FEATURES ADDED:
 *  • useDirections hook — OSRM routing (car/walking/cycling)
 *  • DirectionsPanel — turn-by-turn directions UI
 *  • RouteLayer — displays route on map
 *  • Menu item + toolbar button + sidebar button for Directions
 *  • Map offset when directions panel open
 *
 *  BACKEND / LIVE-TRACKING FEATURES (preserved):
 *  • useNavigate auth redirects to /login
 *  • isLoggedIn / getLoggedInUser — user auth checks
 *  • requireAuth() — guards draw, measure, survey actions
 *  • useSurveySession — startSurveySession / endSurveySession / syncDrawing / syncTrack
 *  • restoredDrawings — drawings restored from backend on load
 *  • activeSessionClientId / sessionStatus / syncStatus / syncBadge
 *  • useOfflineQueue — enqueue / queueSize / isFlushing
 *  • LiveTrackRecorder receives syncTrack + sessionClientId props
 *
 *  PRINT MAP PANEL — preserved
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, WMSTileLayer, useMap } from "react-leaflet";

import AddSearch          from "./search/AddSearch";
import LiveGPS            from "./map/LiveGPS";
import BoundaryLayer      from "./map/BoundaryLayer";
import MapTracker         from "./map/MapTracker";
import MeasureTool        from "./tools/MeasureTool";
import DrawTool           from "./tools/DrawTool";
import SavedDrawingsLayer from "./tools/SavedDrawingsLayer";
import SurveyClick        from "./tools/SurveyClick";
import KMLLoader          from "./loaders/KMLLoader";
import KMZLoader          from "./loaders/KMZLoader";
import CSVLoader          from "./loaders/CSVLoader";
import ShapefileLoader    from "./loaders/ShapefileLoader";
import DEMLoader from "./loaders/DEMLoader";
import DEMElevationDrape  from "./loaders/Demelevationdrape";
import { exportShapefile } from "../utils/exportShapefile";
import GeoJSONLoader      from "./loaders/GeoJSONLoader";
import Globe3DView        from "./Globe3DView";
import LiveTrackRecorder  from "./tools/LiveTrackRecorder";
import SyncQueueManager from "./tools/SyncQueueManager.jsx";
import { useOfflineMap }          from "./map/useOfflineMap";
import OfflineMapManager          from "./map/OfflineMapManager";
import OfflineStatusBadge         from "./map/OfflineStatusBadge";
import OfflineTileLayer           from "./map/OfflineTileLayer";
import { useElevation }           from "./map/useElevation";
import ElevationProfile           from "./map/ElevationProfile";
import { useNightModeAutoSwitch } from "./map/useNightModeAutoSwitch";
import { haversine, formatDist }  from "./map/measureUtils";
import { exportKML, exportCSV, exportKMZ, exportGeoJSON } from "../utils/exportUtils.js";
import { exportDEM } from "../utils/exportDem";
import { useDEM }                 from "../hooks/Usedem";
import DEMPanel                   from "../components/Dempanel";

import { Ico }                    from "../constants/icons.jsx";
import { MAP_LAYERS }             from "../constants/mapLayers.js";
import { GLOBAL_STYLES }          from "../constants/globalStyles.js";
import {
  toDMS, toUTM, zoomForType, geocodeForMap, reverseGeocode, toPlusCode
} from "../utils/mapUtils.js";
import { useCompassNav }          from "../hooks/useCompassNav.js";
import { useOverlayLayers }       from "../hooks/useOverlayLayers.js";
import { useGeoJSON }             from "../hooks/useGeoJSON.js";

// ── BACKEND: survey session + offline queue + auth ───────────────────────────
import { useSurveySession }       from "../hooks/useSurveySession.js";
import { useOfflineQueue }        from "../hooks/useOfflineQueue.js";
import { isLoggedIn, getLoggedInUser } from "../services/surveyApi.js";
// ─────────────────────────────────────────────────────────────────────────────

// ── DIRECTIONS: imports ──────────────────────────────────────────────────────
import DirectionsPanel from "../components/DirectionsPanel";
import RouteLayer      from "./map/RouteLayer";           // corrected import path

import FeaturePropertiesPanel   from "./tools/Featurepropertiespanel";
import FeatureContextMenu       from "./tools/FeatureContextMenu";
import KMLAreaAnalyzer          from "./tools/Kmlareaanalyzer";
import GoogleEarthOptionsDialog from "./tools/Googleearthoptionsdialog";
import KMLProcessingPanel       from "./tools/Kmlprocessingpanel";
import PrintMapPanel            from "./tools/Printmappanel";
import {
  SectionHeader, LayerItem, PrimaryButton,
  MobileBottomSheet, SheetHeader, SheetDivider,
} from "../components/UIComponents.jsx";
import { ProfessionalCompassControl, MobileCompassWidget } from "../components/CompassControls.jsx";
import { MobileSearchBar, MobileBottomNav, CompactMobileHUD } from "../components/MobileUI.jsx";
import { MapFlyController, MapRefCapture, ElevationClickCapture } from "./map/MapHelpers.jsx";
import MobileFileFolder     from "../components/MobileFileFolder.jsx";
import MobileElevationSheet from "../components/MobileElevationSheet.jsx";
import AboutGeoxis from "./tools/AboutGeoxis.jsx";

/* ─────────────────────────────────────────────────────────────────────────────
   Layout constants
───────────────────────────────────────────────────────────────────────────── */
const MENU_H = 36;
const TB_H   = 42;
const STAT_H = 26;
const SB_W   = 264;
const TOP_H  = MENU_H + TB_H;

/* ─────────────────────────────────────────────────────────────────────────────
   UNIFIED MENU DEFINITIONS (with Directions added)
───────────────────────────────────────────────────────────────────────────── */
const UNIFIED_MENU_DEFS = {
  File: [
    { label: "New Project",          icon: "New",     action: "resetAll" },
    { divider: true },
    { label: "Import KML",           icon: "Upload",  action: "openKML" },
    { label: "Import KMZ / CSV",     icon: "CSV",     action: "openExtra" },
    { label: "Import GeoJSON",       icon: "GeoJSON", action: "openGeoJSON" },
    { label: "Import Shapefile",     icon: "GeoJSON", action: "openShapefile" },
    { divider: true },
    { label: "Export GeoJSON",       icon: "Export",  action: "exportGeoJSON" },
    { label: "Export KML",           icon: "Export",  action: "exportKML" },
    { label: "Export CSV",           icon: "Export",  action: "exportCSV" },
    { label: "Export KMZ",           icon: "Export",  action: "exportKMZ" },
    { label: "Export Shapefile",     icon: "Export",  action: "exportSHP" },
    { divider: true },
    { label: "Print / Save Image",   icon: "Export",  action: "openPrint" },
    { label: "Get Directions",       icon: "Navigation", action: "openDirections" },
  ],
  Edit: [
    { label: "Delete All Drawings",  icon: "Trash",   action: "deleteDrawings" },
    { label: "Reset All",            icon: "Reset",   action: "resetAll" },
  ],
  View: [
    { label: "Satellite",            icon: "Satellite",  action: "layerSatellite" },
    { label: "Street",               icon: "Street",     action: "layerStreet" },
    { label: "Terrain",              icon: "Terrain",    action: "layerTerrain" },
    { label: "Satellite + Labels",   icon: "SatLabels",  action: "layerSatLabels" },
    { label: "Dark",                 icon: "Dark",       action: "layerDark" },
    { label: "Light",                icon: "Light",      action: "layerLight" },
    { divider: true },
    { label: "3D Globe View",        icon: "Globe",      action: "show3D" },
    { label: "Night Mode Auto",      icon: "Night",      action: "toggleNight" },
  ],
  Add: [
    { label: "Placemark",            icon: "Pin",       action: "drawMarker",   shortcut: "Ctrl+Shift+P" },
    { label: "Path",                 icon: "Path",      action: "drawPath",     shortcut: "Ctrl+Shift+L" },
    { label: "Polygon",              icon: "Polygon",   action: "drawPoly",     shortcut: "Ctrl+Shift+G" },
    { divider: true },
    { label: "Measure Distance",     icon: "Measure",   action: "startMeasure", shortcut: "Ctrl+M" },
    { label: "Measure Area",         icon: "Measure",   action: "startMeasure" },
    { divider: true },
    { label: "Import KML / KMZ",     icon: "Upload",    action: "openKML" },
    { label: "Import GeoJSON",       icon: "GeoJSON",   action: "openGeoJSON" },
    { label: "Import Shapefile",     icon: "GeoJSON",   action: "openShapefile" },
    { label: "Import CSV",           icon: "CSV",       action: "openExtra" },
    { divider: true },
    { label: "Survey Route",         icon: "Survey",    action: "toggleSurvey" },
    { label: "Live Track Recorder",  icon: "Record",    action: "openTracker" },
  ],
  Tools: [
    { label: "Ruler / Distance",     icon: "Measure",   action: "startMeasure",      shortcut: "Ctrl+Shift+R" },
    { label: "GPS / Live Track",     icon: "Record",    action: "openTracker" },
    { label: "Get Directions",       icon: "Navigation", action: "openDirections" },
    { divider: true },
    { label: "Elevation Profile",    icon: "Mountain",  action: "openElevation" },
    { label: "Compass Navigation",   icon: "Navigation",action: "openCompassNav" },
    { divider: true },
    { label: "Offline Map Manager",  icon: "Offline",   action: "openOffline" },
    { label: "Night Mode Auto",      icon: "Night",     action: "toggleNight" },
    { label: "3D Globe View",        icon: "Globe",     action: "show3D" },
    { divider: true },
    { label: "DEM Elevation Import", icon: "Mountain",  action: "openDEM" },
    { label: "Survey Route",         icon: "Survey",    action: "toggleSurvey" },
    { divider: true },
    { label: "KML → DEM / Contour / Shapefile", icon: "Mountain", action: "openKMLProcessing" },
    { divider: true },
    { label: "Options / Settings",   icon: "Star",      action: "options" },
    { label: "Keyboard Shortcuts",   icon: "Keyboard",  action: "shortcuts" },
  ],
  Help: [
    { label: "Keyboard Shortcuts",   icon: "Keyboard", action: "shortcuts" },
    { label: "About Geoxis",  icon: "Star",     action: "about" },
    { divider: true },
    { label: "OpenStreetMap",        icon: "Maps",     action: "osmLink" },
    { label: "Leaflet Docs",         icon: "Maps",     action: "leafletLink" },
  ],
};

/* ─────────────────────────────────────────────────────────────────────────────
   useDirections Hook — OSRM routing service
───────────────────────────────────────────────────────────────────────────── */
function useDirections() {
  const [routeResult,  setRouteResult]  = React.useState(null);
  const [routeLoading, setRouteLoading] = React.useState(false);
  const [routeError,   setRouteError]   = React.useState(null);

  const OSRM_PROFILES = {
    driving: "car",
    walking: "foot",
    cycling: "bike",
  };

  const calculateRoute = React.useCallback(async ({ origin, destination, mode = "driving" }) => {
    setRouteLoading(true);
    setRouteError(null);
    setRouteResult(null);
    try {
      const profile = OSRM_PROFILES[mode] || "car";
      const url =
        `https://router.project-osrm.org/route/v1/${profile}/` +
        `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
        `?alternatives=true&steps=true&geometries=geojson&overview=full&annotations=false`;

      const res  = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`OSRM error ${res.status}`);
      const data = await res.json();

      if (!data.routes?.length) {
        setRouteError("No route found between these locations.");
        return;
      }

      const routes = data.routes.map((r) => {
        const coordinates = (r.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]);
        const steps = (r.legs || []).flatMap((leg) =>
          (leg.steps || []).map((step) => ({
            instruction: step.maneuver?.type
              ? buildInstruction(step)
              : (step.name || "Continue"),
            type:       step.maneuver?.type     || "turn",
            modifier:   step.maneuver?.modifier || "",
            distance:   step.distance,
            duration:   step.duration,
            name:       step.name,
          }))
        );

        return {
          duration:    r.duration,
          distance:    r.distance,
          summary:     r.legs?.[0]?.summary || "",
          coordinates,
          steps,
        };
      });

      setRouteResult({ routes, origin, destination, mode });
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        setRouteError("Request timed out — check your internet connection.");
      } else {
        setRouteError(err.message || "Could not calculate route.");
      }
    } finally {
      setRouteLoading(false);
    }
  }, []);

  const clearRoute = React.useCallback(() => {
    setRouteResult(null);
    setRouteError(null);
  }, []);

  return { routeResult, routeLoading, routeError, calculateRoute, clearRoute };
}

// Human-readable turn instructions from OSRM maneuver data
function buildInstruction(step) {
  const { type, modifier } = step.maneuver || {};
  const name = step.name ? `onto ${step.name}` : "";
  const modLabel = modifier ? modifier.replace(/_/g, " ") : "";

  const MAP = {
    depart:       `Depart ${name}`,
    arrive:       `Arrive at destination`,
    turn:         `Turn ${modLabel} ${name}`,
    "new name":   `Continue ${name}`,
    merge:        `Merge ${modLabel} ${name}`,
    "on ramp":    `Take ramp ${modLabel} ${name}`,
    "off ramp":   `Take exit ${name}`,
    fork:         `Keep ${modLabel} at fork ${name}`,
    "end of road":`Turn ${modLabel} at end of road ${name}`,
    roundabout:   `Enter roundabout, take exit ${step.maneuver?.exit ?? ""} ${name}`,
    rotary:       `Enter rotary, take exit ${step.maneuver?.exit ?? ""} ${name}`,
    continue:     `Continue ${modLabel} ${name}`,
  };

  return (MAP[type] || `${type || "Continue"} ${name}`).trim().replace(/\s+/g, " ");
}

/* ─────────────────────────────────────────────────────────────────────────────
   MapSizeInvalidator
───────────────────────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────────────────────
   ZoomControl
───────────────────────────────────────────────────────────────────────────── */
function ZoomControl({ isMobile, leafletMapRef }) {
  const doZoom = useCallback((direction) => {
    try {
      const m = leafletMapRef?.current;
      if (!m) return;
      if (direction > 0) m.zoomIn(1);
      else               m.zoomOut(1);
    } catch (_) {}
  }, [leafletMapRef]);

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); doZoom(1); }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); doZoom(-1); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doZoom]);

  if (isMobile) return null;

  const btnStyle = {
    width: 34, height: 32,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(5,12,24,0.92)",
    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
    border: "none", color: "rgba(200,225,255,0.75)",
    cursor: "pointer", userSelect: "none",
    fontFamily: "system-ui,sans-serif",
    transition: "background 0.12s, color 0.12s",
    outline: "none", padding: 0,
  };
  const hov  = e => { e.currentTarget.style.background = "rgba(74,158,255,0.22)"; e.currentTarget.style.color = "#90c8ff"; };
  const uhov = e => { e.currentTarget.style.background = "rgba(5,12,24,0.92)";    e.currentTarget.style.color = "rgba(200,225,255,0.75)"; };

  return (
    <div style={{ position:"fixed", top:TOP_H+100, right:10, zIndex:1050, display:"flex", flexDirection:"column", borderRadius:9, overflow:"hidden", border:"1px solid rgba(255,255,255,0.10)", boxShadow:"0 4px 20px rgba(0,0,0,0.55)", pointerEvents:"all" }}>
      <button onClick={() => doZoom(1)}  onMouseEnter={hov} onMouseLeave={uhov} title="Zoom in  ( + )" style={{ ...btnStyle, borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><line x1="6.5" y1="1.5" x2="6.5" y2="11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="1.5" y1="6.5" x2="11.5" y2="6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
      </button>
      <button onClick={() => doZoom(-1)} onMouseEnter={hov} onMouseLeave={uhov} title="Zoom out ( − )" style={btnStyle}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><line x1="1.5" y1="6.5" x2="11.5" y2="6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   GE_TOOLS definition (for the left-edge floating toolbar)
───────────────────────────────────────────────────────────────────────────── */
const GE_TOOLS = [
  { id:"select",    label:"Select",        shortcut:"S", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l7 18 3-7 7-3z"/><line x1="14" y1="14" x2="20" y2="20"/></svg> },
  { id:"hand",      label:"Pan",           shortcut:"H", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 11V6a2 2 0 00-2-2 2 2 0 00-2 2"/><path d="M14 10V4a2 2 0 00-2-2 2 2 0 00-2 2v2"/><path d="M10 10.5V6a2 2 0 00-2-2 2 2 0 00-2 2v8"/><path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 012.83-2.82L7 15"/></svg> },
  { divider:true },
  { id:"placemark", label:"Add Placemark", shortcut:"P", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> },
  { id:"path",      label:"Draw Path",     shortcut:"L", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { id:"polygon",   label:"Draw Polygon",  shortcut:"G", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg> },
  { divider:true },
  { id:"ruler",     label:"Ruler",         shortcut:"R", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21.3 8.7L8.7 21.3c-.6.6-1.6.6-2.2 0L2.7 17.5c-.6-.6-.6-1.6 0-2.2L15.3 2.7c.6-.6 1.6-.6 2.2 0l3.8 3.8c.6.6.6 1.6 0 2.2z"/><path d="M7.5 10.5l1.5 1.5M10.5 7.5l1.5 1.5M13.5 4.5l1.5 1.5"/></svg> },
  { id:"area",      label:"Measure Area",  shortcut:"A", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" strokeWidth="1.1" opacity="0.5"/></svg> },
  { divider:true },
  { id:"camera",    label:"Camera",        shortcut:"C", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg> },
  { id:"sunlight",  label:"Sunlight",      shortcut:"U", icon:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> },
];

/* ─────────────────────────────────────────────────────────────────────────────
   GoogleEarthProToolbar
───────────────────────────────────────────────────────────────────────────── */
function GoogleEarthProToolbar({ activeTool, onToolChange, drawMode, measureMode, onAction, isMobile, visible, onToggle }) {
  const [hovered, setHovered] = useState(null);
  if (isMobile) return null;

  return (
    <>
      <button
        onClick={onToggle}
        title={visible ? "Hide toolbar" : "Show Google Earth tools"}
        style={{
          position: "absolute", top: "50%", left: visible ? 58 : 10,
          transform: "translateY(-50%)", zIndex: 1065, width: 28, height: 28,
          background: "rgba(255,255,255,0.96)", border: "1px solid rgba(0,0,0,0.14)",
          borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
          transition: "left 0.2s ease", pointerEvents: "all", outline: "none",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "#f1f3f4"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.96)"; }}
      >
        {visible ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3c4043" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3c4043" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
        )}
      </button>

      {visible && (
        <div style={{
          position: "absolute", top: "50%", left: 10, transform: "translateY(-50%)",
          zIndex: 1060, display: "flex", flexDirection: "column", alignItems: "center",
          background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)", borderRadius: 12,
          boxShadow: "0 4px 24px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.1)",
          border: "1px solid rgba(0,0,0,0.10)", padding: "4px 0",
          pointerEvents: "all", animation: "geToolbarSlideIn 0.18s ease",
        }}>
          {GE_TOOLS.map((tool, idx) => {
            if (tool.divider) return (
              <div key={`d${idx}`} style={{ height:1, width:"80%", background:"rgba(0,0,0,0.08)", margin:"3px auto" }} />
            );
            const isActive = activeTool === tool.id
              || (tool.id === "placemark" && drawMode)
              || (tool.id === "ruler" && measureMode);
            return (
              <div key={tool.id} style={{ position:"relative" }}>
                <button
                  onClick={() => {
                    onToolChange(tool.id);
                    if (tool.id === "placemark") onAction("drawMarker");
                    else if (tool.id === "path")    onAction("drawPath");
                    else if (tool.id === "polygon") onAction("drawPoly");
                    else if (tool.id === "ruler")   onAction("startMeasure");
                    else if (tool.id === "area")    onAction("startMeasure");
                  }}
                  onMouseEnter={() => setHovered(tool.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center",
                    background: isActive ? "rgba(26,115,232,0.12)" : hovered === tool.id ? "rgba(0,0,0,0.06)" : "transparent",
                    border:"none", borderRadius:8, margin:"1px 4px", cursor:"pointer",
                    color: isActive ? "#1a73e8" : "#3c4043",
                    transition:"background 0.12s, color 0.12s",
                    outline: isActive ? "1.5px solid rgba(26,115,232,0.35)" : "none", position:"relative",
                  }}
                >
                  {tool.icon}
                  {isActive && <div style={{ position:"absolute", bottom:4, right:4, width:5, height:5, borderRadius:"50%", background:"#1a73e8" }} />}
                </button>
                {hovered === tool.id && (
                  <div style={{
                    position:"absolute", left:"calc(100% + 10px)", top:"50%", transform:"translateY(-50%)",
                    background:"rgba(32,33,36,0.92)", color:"#fff", fontSize:12,
                    padding:"5px 10px", borderRadius:6, whiteSpace:"nowrap",
                    pointerEvents:"none", zIndex:9999, boxShadow:"0 2px 10px rgba(0,0,0,0.3)",
                    fontFamily:"'Google Sans','Roboto',Arial,sans-serif",
                  }}>
                    <span style={{ fontWeight:500 }}>{tool.label}</span>
                    <span style={{ marginLeft:8, opacity:0.55, fontSize:10, fontFamily:"monospace" }}>{tool.shortcut}</span>
                    <div style={{ position:"absolute", left:-5, top:"50%", transform:"translateY(-50%)", width:0, height:0, borderTop:"5px solid transparent", borderBottom:"5px solid transparent", borderRight:"5px solid rgba(32,33,36,0.92)" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   InstantEditBubble
───────────────────────────────────────────────────────────────────────────── */
function InstantEditBubble({ drawing, onEdit, onDelete, onClose, onFly, cursorElevation }) {
  if (!drawing) return null;
  const pt  = drawing.points?.[0];
  const lat = pt?.lat ?? 0;
  const lng = pt?.lng ?? 0;
  const fmt = (deg, pos, neg) => {
    const d = Math.abs(deg), di = Math.floor(d), mA = (d-di)*60, mi = Math.floor(mA), s = (mA-mi)*60;
    return `${di}°${mi}'${s.toFixed(2)}"${deg >= 0 ? pos : neg}`;
  };
  const typeLabel = drawing.type === "marker" ? "Placemark" : drawing.type === "polygon" ? "Polygon" : "Path";
  const typeEmoji = drawing.type === "marker" ? "📍" : drawing.type === "polygon" ? "⬡" : "〰";

  return (
    <div style={{
      position:"fixed", top:TOP_H+14, right:16, width:340, zIndex:9500,
      background:"#fff", borderRadius:12,
      boxShadow:"0 8px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)",
      border:"1px solid rgba(0,0,0,0.10)",
      fontFamily:"'Google Sans','Roboto',Arial,sans-serif",
      overflow:"hidden", animation:"geSlideIn 0.18s cubic-bezier(0.34,1.56,0.64,1)",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px 10px", borderBottom:"1px solid #f1f3f4" }}>
        <div style={{ width:32, height:32, borderRadius:"50%", background:drawing.color||"#1a73e8", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:16 }}>
          {typeEmoji}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:16, fontWeight:500, color:"#202124", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {drawing.name || "Untitled placemark"}
          </div>
          <div style={{ fontSize:11, color:"#5f6368", marginTop:1 }}>{typeLabel}</div>
        </div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#5f6368", cursor:"pointer", fontSize:20, lineHeight:1, padding:0, display:"flex", alignItems:"center", width:28, height:28, justifyContent:"center", borderRadius:6 }}
          onMouseEnter={e => e.currentTarget.style.background="#f1f3f4"}
          onMouseLeave={e => e.currentTarget.style.background="none"}
        >×</button>
      </div>
      <div style={{ padding:"12px 16px" }}>
        <div style={{ fontSize:12, fontWeight:500, color:"#3c4043", marginBottom:6 }}>Location</div>
        <div style={{ fontSize:13, color:"#1a73e8", fontFamily:"'Roboto Mono',monospace", marginBottom:4, letterSpacing:"0.01em" }}>
          {fmt(lat,"N","S")} {fmt(lng,"E","W")}
        </div>
        <div style={{ fontSize:12, color:"#5f6368", fontFamily:"monospace" }}>
          {lat.toFixed(8)}, {lng.toFixed(8)}
        </div>
      </div>
      <div style={{ borderTop:"1px solid #f1f3f4" }}>
        <div style={{ padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:13, fontWeight:500, color:"#3c4043" }}>Advanced measurements</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#5f6368"><path d="M19 9l-7 7-7-7"/></svg>
        </div>
        <div style={{ padding:"0 16px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:12, color:"#5f6368" }}>Ground elevation</span>
            <span style={{ fontSize:12, color:"#202124", fontFamily:"monospace" }}>
              {cursorElevation != null ? `${Math.round(cursorElevation)} m` : "— m"}
            </span>
          </div>
          {drawing.type !== "marker" && (drawing.points?.length ?? 0) >= 2 && (
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:12, color:"#5f6368" }}>Points</span>
              <span style={{ fontSize:12, color:"#202124", fontFamily:"monospace" }}>{drawing.points.length}</span>
            </div>
          )}
        </div>
      </div>
      {drawing.description && (
        <div style={{ borderTop:"1px solid #f1f3f4", padding:"12px 16px" }}>
          <div style={{ fontSize:13, color:"#3c4043", lineHeight:1.5 }}>{drawing.description}</div>
        </div>
      )}
      <div style={{ borderTop:"1px solid #f1f3f4", padding:"12px 16px", display:"flex", gap:8, alignItems:"center" }}>
        <button onClick={() => onEdit?.(drawing)}
          style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 20px", borderRadius:24, cursor:"pointer", background:"#1a73e8", border:"none", color:"#fff", fontSize:14, fontWeight:500, fontFamily:"'Google Sans','Roboto',Arial,sans-serif", boxShadow:"0 2px 8px rgba(26,115,232,0.32)", transition:"background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background="#1557b0"}
          onMouseLeave={e => e.currentTarget.style.background="#1a73e8"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        <button onClick={() => onFly?.(drawing)}
          style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 16px", borderRadius:24, cursor:"pointer", background:"transparent", border:"1.5px solid #dadce0", color:"#3c4043", fontSize:13, fontWeight:500, fontFamily:"'Google Sans','Roboto',Arial,sans-serif", transition:"background 0.12s" }}
          onMouseEnter={e => e.currentTarget.style.background="#f1f3f4"}
          onMouseLeave={e => e.currentTarget.style.background="transparent"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          Fly to
        </button>
        <button onClick={() => onDelete?.(drawing)}
          style={{ marginLeft:"auto", display:"flex", alignItems:"center", padding:"9px", borderRadius:24, cursor:"pointer", background:"transparent", border:"1.5px solid #dadce0", color:"#d93025", transition:"background 0.12s" }}
          onMouseEnter={e => e.currentTarget.style.background="#fce8e6"}
          onMouseLeave={e => e.currentTarget.style.background="transparent"}
          title="Delete"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d93025" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export default function SurveyMap() {

  /* ── BACKEND: navigate for auth redirects ──────────────────────────────── */
  const navigate = useNavigate();

  /* ── Refs ──────────────────────────────────────────────────────────────── */
  const kmlInputRef      = useRef(null);
  const extraInputRef    = useRef(null);
  const geojsonInputRef  = useRef(null);
  const shpInputRef      = useRef(null);
  const demInputRef      = useRef(null);
  const polylineRef      = useRef(null);
  const previewLayerRef  = useRef(null);
  const drawLayersRef    = useRef([]);
  const measureLayersRef = useRef([]);
  const measureLineRef   = useRef(null);
  const leafletMapRef    = useRef(null);
  const kmlLayerRef      = useRef(null);
  const shpLayerRef      = useRef(null);
  const kmzLayerRef      = useRef(null);
  const stateRef = useRef({ setPropertiesGeoJSONFeature: ()=>{}, setContextMenu: ()=>{} });

  /* ── Responsive ────────────────────────────────────────────────────────── */
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  /* ── Map state ─────────────────────────────────────────────────────────── */
  const [activeLayer,     setActiveLayer]     = useState("Satellite");
  const [nightModeAuto,   setNightModeAuto]   = useState(false);
  const [nightSwitchInfo, setNightSwitchInfo] = useState(null);
  useNightModeAutoSwitch({ enabled:nightModeAuto, activeLayer, setActiveLayer, nightLayer:"Dark", dayLayer:"Satellite + Labels", onSwitch:({isNight})=>setNightSwitchInfo({isNight}) });
  const [flyTarget,  setFlyTarget]  = useState(null);
  const [mapBearing, setMapBearing] = useState(0);
  const [mapZoom,    setMapZoom]    = useState(13);
  const [kmlBounds,  setKmlBounds]  = useState(null);

  /* ── Google Earth Pro state ────────────────────────────────────────────── */
  const [activeTool,     setActiveTool]     = useState("select");
  const [clickedDrawing, setClickedDrawing] = useState(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);

  /* ── Search ────────────────────────────────────────────────────────────── */
  const [searchQuery,   setSearchQuery]   = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const searchFnRef = useRef(null);
  const [locationInfo,    setLocationInfo]    = useState(null);
  const [boundaryGeojson, setBoundaryGeojson] = useState(null);
  const [mousePos,        setMousePos]        = useState(null);
  const [coordFmt,        setCoordFmt]        = useState("dms");

  /* ── Draw ──────────────────────────────────────────────────────────────── */
  const [drawMode,      setDrawMode]      = useState(false);
  const [drawType,      setDrawType]      = useState("path");
  const [drawPoints,    setDrawPoints]    = useState([]);
  const [savedDrawings, setSavedDrawings] = useState([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingName,   setPendingName]   = useState("");
  const [pendingPoints, setPendingPoints] = useState([]);
  const [pendingType,   setPendingType]   = useState("path");

  /* ── Properties panel ───────────────────────────────────────────────────── */
  const [propertiesDrawing,        setPropertiesDrawing]        = useState(null);
  const [propertiesGeoJSONFeature, setPropertiesGeoJSONFeature] = useState(null);

  /* ── Context menu ───────────────────────────────────────────────────────── */
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, feature: null });

  stateRef.current.setPropertiesGeoJSONFeature = setPropertiesGeoJSONFeature;
  stateRef.current.setContextMenu              = setContextMenu;

  /* ── KML panels ─────────────────────────────────────────────────────────── */
  const [kmlAnalyzerOpen,   setKmlAnalyzerOpen]   = useState(false);
  const [kmlAnalyzerData,   setKmlAnalyzerData]   = useState(null);
  const [kmlProcessingOpen, setKmlProcessingOpen] = useState(false);

  /* ── Print Map Panel ─────────────────────────────────────────────────────── */
  const [printOpen, setPrintOpen] = useState(false);

  /* ── Measure ───────────────────────────────────────────────────────────── */
  const [measureMode,   setMeasureMode]   = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measureUnit,   setMeasureUnit]   = useState("auto");

  /* ── Survey ────────────────────────────────────────────────────────────── */
  const [surveyMode, setSurveyMode] = useState(false);
  const [route,      setRoute]      = useState([]);

  /* ── DIRECTIONS STATE ──────────────────────────────────────────────────── */
  const [directionsOpen,  setDirectionsOpen]  = useState(false);
  const [activeRouteIdx,  setActiveRouteIdx]  = useState(0);
  const { routeResult, routeLoading, routeError, calculateRoute, clearRoute } = useDirections();

  /* ── File imports ──────────────────────────────────────────────────────── */
  const [kmlFile,       setKmlFile]       = useState(null);
  const [kmlLoading,    setKmlLoading]    = useState(false);
  const [kmlName,       setKmlName]       = useState(null);
  const [extraFile,     setExtraFile]     = useState(null);
  const [extraFileType, setExtraFileType] = useState(null);
  const [csvValidCount, setCsvValidCount] = useState(0);
  const [csvTotalCount, setCsvTotalCount] = useState(0);
  const [geojsonFile,     setGeojsonFile]     = useState(null);
  const [geojsonLoading,  setGeojsonLoading]  = useState(false);
  const [geojsonFileName, setGeojsonFileName] = useState(null);
  const [geojsonTrigger,  setGeojsonTrigger]  = useState(null);
  const [shpFile,     setShpFile]     = useState(null);
  const [shpTrigger,  setShpTrigger]  = useState(null);
  const [shpLoading,  setShpLoading]  = useState(false);
  const [shpFileName, setShpFileName] = useState(null);
  const [shpCount,    setShpCount]    = useState(0);
  const [fileVisibility, setFileVisibility] = useState({});

  /* ── 3D / Tracker ──────────────────────────────────────────────────────── */
  const [show3D,           setShow3D]           = useState(false);
  const [trackerOpen,      setTrackerOpen]      = useState(false);
  const [isTracking,       setIsTracking]       = useState(false);
  const [mapRefForTracker, setMapRefForTracker] = useState(null);

  /* ── Offline ───────────────────────────────────────────────────────────── */
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const { swReady, swError, isOnline, cacheStats, precaching, precacheProgress, precacheRegion, precacheCurrentView, clearTileCache, fetchCacheStats, stopPrecache } = useOfflineMap();
  useEffect(() => { if (!isOnline) setOfflineMode(true); }, [isOnline]);

  /* ── Elevation ─────────────────────────────────────────────────────────── */
  const [elevOpen,        setElevOpen]        = useState(false);
  const [elevMode,        setElevMode]        = useState(null);
  const [elevProfileData, setElevProfileData] = useState([]);
  const [elevSourceLabel, setElevSourceLabel] = useState("");
  const [customElevPts,   setCustomElevPts]   = useState([]);
  const { cursorElevation, elevLoading, getCursorElevation, getElevationProfile } = useElevation({ isOnline });

  /* ── UI state ──────────────────────────────────────────────────────────── */
  const [openMenu,      setOpenMenu]      = useState(null);
  const [showAbout,     setShowAbout]     = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [optionsOpen,   setOptionsOpen]   = useState(false);
  const [appSettings,   setAppSettings]   = useState({});
  const [searchOpen,    setSearchOpen]    = useState(true);
  const [placesOpen,    setPlacesOpen]    = useState(true);
  const [layersOpen,    setLayersOpen]    = useState(true);
  const [toolsOpen,     setToolsOpen]     = useState(true);
  const [geojsonOpen,   setGeojsonOpen]   = useState(true);
  const [activeSheet,   setActiveSheet]   = useState(null);

  /* ── Hooks ─────────────────────────────────────────────────────────────── */
  const overlayControls = useOverlayLayers();
  const compass = useCompassNav(leafletMapRef, overlayControls);
  const geoJSON = useGeoJSON(leafletMapRef);

  /* ── DEM hook ──────────────────────────────────────────────────────────── */
  const {
    demFile, demFileName, demLoading, demStats, demOpacity, demColorRamp, demError,
    handleDEMUpload, handleDEMRemove, handleDEMOpacity, handleDEMColorRamp,
    handleDEMDone, handleDEMError, handleDEMStats,
  } = useDEM();

  const [demRasterData, setDemRasterData] = useState(null);
  const [kmlMask,       setKmlMask]       = useState(null);

  const handleDEMStatsAndRaster = useCallback((stats, rasterData) => {
    handleDEMStats(stats);
    setDemRasterData(rasterData || null);
  }, [handleDEMStats]);

  const handleDEMRemoveWithClear = useCallback(() => {
    handleDEMRemove();
    setDemRasterData(null);
  }, [handleDEMRemove]);

  /* ── BACKEND: Offline queue ────────────────────────────────────────────── */
  const { enqueue, queueSize, isFlushing } = useOfflineQueue();

  /* ── BACKEND: Survey session ───────────────────────────────────────────── */
  const {
    activeSessionClientId, sessionStatus, restoredDrawings,
    syncStatus, syncBadge, startSurveySession, endSurveySession, syncDrawing, syncTrack,
  } = useSurveySession({ enqueue, isOnline });

  /* ── BACKEND: Restore drawings from backend on load ───────────────────── */
  useEffect(() => {
    if (restoredDrawings && restoredDrawings.length > 0) {
      setSavedDrawings((prev) => {
        const existingNames = new Set(prev.map((d) => d.name + d.type));
        const fresh = restoredDrawings.filter((d) => !existingNames.has(d.name + d.type));
        return [...prev, ...fresh];
      });
    }
  }, [restoredDrawings]);

  /* ── BACKEND: requireAuth guard ────────────────────────────────────────── */
 const requireAuth = useCallback((action) => {
if (!isLoggedIn()) {
sessionStorage.setItem("loginIntent", action || "");
navigate("/login");
return false;
}
return true;
}, [navigate]);
// Auto-open tracker after login redirect
useEffect(() => {
const intent = sessionStorage.getItem("loginIntent");
if (intent === "openTracker" && isLoggedIn()) {
sessionStorage.removeItem("loginIntent");
setTimeout(() => setTrackerOpen(true), 300);
}
}, []);

  /* ── attachFeatureClickHandlers ──────────────────────────────────────────── */
  const attachFeatureClickHandlers = useCallback((lyr, fileType, fileName) => {
    if (!lyr) return;
    const walkLayer = (layer) => {
      if (typeof layer.eachLayer === "function") { layer.eachLayer(child => walkLayer(child)); return; }
      if (layer._handlersAttached) return;
      layer._handlersAttached = true;
      const extractFeature = () => {
        let f = null;
        try { f = layer.toGeoJSON?.(); } catch (_) { return null; }
        if (!f) return null;
        if (f.type === "FeatureCollection") f = f.features?.[0] ?? null;
        if (!f?.geometry?.type) return null;
        f._fileType = fileType; f._fileName = fileName;
        f._name = f.properties?.name || f.properties?.Name || f.properties?.NAME || f.properties?.title || fileName || "Feature";
        return f;
      };
      const isMarker = (typeof layer.getLatLng === "function" && typeof layer.getLatLngs !== "function");
      layer.on("dblclick", (e) => { e.originalEvent?.stopPropagation(); e.originalEvent?.preventDefault(); const f = extractFeature(); if (f) stateRef.current.setPropertiesGeoJSONFeature(f); });
      if (isMarker) { layer.on("click", (e) => { e.originalEvent?.stopPropagation(); e.originalEvent?.preventDefault(); const f = extractFeature(); if (f) stateRef.current.setPropertiesGeoJSONFeature(f); }); }
      layer.on("contextmenu", (e) => { e.originalEvent?.stopPropagation(); e.originalEvent?.preventDefault(); const f = extractFeature(); if (f) { stateRef.current.setContextMenu({ visible:true, x:e.originalEvent.clientX, y:e.originalEvent.clientY, feature:f }); } });
    };
    walkLayer(lyr);
  }, []);

  const handleContextZoomTo = useCallback((feature) => {
    if (!feature || !leafletMapRef?.current) return;
    try {
      const bounds = L.geoJSON(feature).getBounds();
      if (bounds && bounds.isValid()) leafletMapRef.current.fitBounds(bounds, { padding:[60,60], maxZoom:17, animate:true });
    } catch (_) {}
  }, [leafletMapRef]);

  const handleDrawingFeatureClick = useCallback((drawing) => {
    setClickedDrawing(drawing);
  }, []);

  /* ── Wire GeoJSON layers ─────────────────────────────────────────────────── */
  useEffect(() => {
    geoJSON.importedGeoJSONLayers.forEach(l => {
      setFileVisibility(p => p[l.id] !== undefined ? p : { ...p, [l.id]: true });
    });
  }, [geoJSON.importedGeoJSONLayers]);

  useEffect(() => {
    geoJSON.importedGeoJSONLayers.forEach(layer => {
      if (!layer.leafletLayer || layer._clickHandlersAttached) return;
      attachFeatureClickHandlers(layer.leafletLayer, "geojson", layer.name);
      layer._clickHandlersAttached = true;
    });
  }, [geoJSON.importedGeoJSONLayers, attachFeatureClickHandlers]);

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const totalDistance = measurePoints.length >= 2
    ? measurePoints.reduce((sum, p, i) => i === 0 ? 0 : sum + haversine(measurePoints[i - 1], p), 0)
    : 0;
  const hasExportData = savedDrawings.length > 0 || route.length >= 2 || measurePoints.length >= 2;

  const importedCount =
    (kmlName         ? 1 : 0) +
    (extraFile       ? 1 : 0) +
    (geojsonFileName ? 1 : 0) +
    (shpFileName     ? 1 : 0) +
    (demFileName     ? 1 : 0) +
    geoJSON.importedGeoJSONLayers.length;

  /* ── Callbacks ─────────────────────────────────────────────────────────── */
  const onMouseMove  = useCallback(p => { setMousePos(p); if (p) getCursorElevation(p.lat, p.lng); }, [getCursorElevation]);
  const onZoomChange = useCallback(z => setMapZoom(z), []);

  const handleElevModeRequest = useCallback(async (mode) => {
    setElevMode(mode); setElevOpen(true); setElevProfileData([]); setElevSourceLabel("");
    let pts = [], label = "";
    if      (mode === "survey"  && route.length >= 2)         { pts = route.map(p => ({ lat: p[0], lng: p[1] }));          label = `Survey Route · ${route.length} pts`; }
    else if (mode === "measure" && measurePoints.length >= 2) { pts = measurePoints.map(p => ({ lat: p.lat, lng: p.lng })); label = `Measure · ${measurePoints.length} pts`; }
    else if (mode === "draw"    && drawPoints.length >= 2)    { pts = drawPoints.map(p => ({ lat: p.lat, lng: p.lng }));    label = `Draw · ${drawPoints.length} pts`; }
    else if (mode === "custom")                               { setCustomElevPts([]); setElevProfileData([]); setElevSourceLabel("Click map points"); return; }
    if (pts.length < 2) { setElevSourceLabel("Not enough points"); return; }
    setElevSourceLabel(label);
    setElevProfileData(await getElevationProfile(pts));
  }, [route, measurePoints, drawPoints, getElevationProfile]);

  const handleMapClickForElev = useCallback(async (latlng) => {
    if (elevMode !== "custom" || !elevOpen) return;
    const np = [...customElevPts, { lat: latlng.lat, lng: latlng.lng }];
    setCustomElevPts(np); setElevSourceLabel(`Custom · ${np.length} pts`);
    if (np.length >= 2) setElevProfileData(await getElevationProfile(np));
  }, [elevMode, elevOpen, customElevPts, getElevationProfile]);

  /* ── File handlers ─────────────────────────────────────────────────────── */
  const handleKMLUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext !== "kml") { alert("Please select a .kml file."); e.target.value = ""; return; }
    setKmlLoading(true); setKmlName(f.name); setKmlFile(f);
    setFileVisibility(p => ({ ...p, __kml__: true }));
    e.target.value = "";
  };

  const handleExtraUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext !== "kmz" && ext !== "csv") { alert("Please upload a KMZ or CSV file."); e.target.value = ""; return; }
    setExtraFile(null); setCsvValidCount(0); setCsvTotalCount(0);
    setTimeout(() => {
      setExtraFile(f); setExtraFileType(ext);
      setFileVisibility(p => ({ ...p, [`__${ext}__`]: true }));
    }, 0);
    e.target.value = "";
  };

  const handleGeoJSONFileUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext !== "geojson" && ext !== "json") { alert("Please upload a .geojson or .json file."); e.target.value = ""; return; }
    setGeojsonFile(f); setGeojsonFileName(f.name); setGeojsonLoading(true);
    setFileVisibility(p => ({ ...p, __geojson__: true }));
    setGeojsonTrigger(Date.now());
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        setKmlAnalyzerData({ geojson: parsed, fileName: f.name });
        setKmlAnalyzerOpen(true);
      } catch (_) {}
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  const handleShapefileUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext !== "zip" && ext !== "shp") { alert("Please upload a .zip (recommended) or .shp file."); e.target.value = ""; return; }
    setShpFile(f); setShpFileName(f.name); setShpLoading(true); setShpCount(0);
    setFileVisibility(p => ({ ...p, __shp__: true }));
    setShpTrigger(Date.now());
    e.target.value = "";
  };

  const handleDEMFileInput = (e) => {
    const f = e.target.files[0]; if (!f) return;
    handleDEMUpload(f);
    e.target.value = "";
  };

  /* ── Removal handlers ──────────────────────────────────────────────────── */
  const removeKML = () => {
    setKmlFile(null); setKmlName(null); setKmlLoading(false);
    kmlLayerRef.current = null; setKmlMask(null);
    overlayControls.removeAllLayers();
    setFileVisibility(p => { const n = { ...p }; delete n.__kml__; return n; });
  };
  const removeExtra = () => {
    setExtraFile(null); setExtraFileType(null); setCsvValidCount(0); setCsvTotalCount(0);
    kmzLayerRef.current = null;
    overlayControls.removeAllLayers();
    setFileVisibility(p => { const n = { ...p }; delete n.__kmz__; delete n.__csv__; return n; });
  };
  const removeGeojson = () => {
    setGeojsonFile(null); setGeojsonFileName(null); setGeojsonLoading(false); setGeojsonTrigger(null);
    setFileVisibility(p => { const n = { ...p }; delete n.__geojson__; return n; });
  };
  const removeShapefile = () => {
    setShpFile(null); setShpFileName(null); setShpLoading(false); setShpTrigger(null); setShpCount(0);
    shpLayerRef.current = null;
    overlayControls.removeAllLayers();
    setFileVisibility(p => { const n = { ...p }; delete n.__shp__; return n; });
  };

  /* ── Draw handlers ─────────────────────────────────────────────────────── */
  const handleToggleSurvey = () => {
  if (surveyMode) {
    setRoute([]);
    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
    endSurveySession();
  } else {
    // No auth required — survey works for all users
    startSurveySession({ name: `Survey ${new Date().toLocaleDateString()}` });
  }
  setSurveyMode(p => !p);
};

  const finishDrawing = () => {
    if (!drawPoints.length) return;
    if (drawType === "marker") {
      const newDrawing = {
        name: "Untitled placemark", type: "marker", points: [...drawPoints],
        color: "#1a73e8", fillColor: "#1a73e8", width: 3, opacity: 100, fillOpacity: 35,
        iconKey: "pin", iconSize: "medium",
        clientId: `drawing_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        sessionClientId: activeSessionClientId,
        coordinates: drawPoints.map(p => [p.lng, p.lat]),
      };
      setSavedDrawings(p => [...p, newDrawing]);
      setDrawPoints([]);
      if (previewLayerRef.current) { previewLayerRef.current.remove(); previewLayerRef.current = null; }
      drawLayersRef.current.forEach(l => l.remove()); drawLayersRef.current = [];
      setDrawMode(false); setActiveTool("select"); setClickedDrawing(newDrawing);
      return;
    }
    setPendingPoints([...drawPoints]); setPendingType(drawType); setPendingName(""); setShowNameModal(true);
  };

  const confirmDrawing = () => {
    const name = pendingName.trim() || (pendingType === "marker" ? "Untitled placemark" : pendingType === "path" ? "Path" : "Polygon");
    const defaultColor = pendingType === "marker" ? "#1a73e8" : pendingType === "polygon" ? "#f59e0b" : "#3b82f6";
    const newDrawing = {
      name, type: pendingType, points: pendingPoints,
      color: defaultColor, fillColor: defaultColor,
      width: 3, opacity: 100, fillOpacity: 35, iconKey: "pin", iconSize: "medium",
      clientId: `drawing_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      sessionClientId: activeSessionClientId,
      coordinates: pendingPoints.map(p => [p.lng, p.lat]),
    };
    setSavedDrawings(p => [...p, newDrawing]);
    setDrawPoints([]);
    if (previewLayerRef.current) { previewLayerRef.current.remove(); previewLayerRef.current = null; }
    drawLayersRef.current.forEach(l => l.remove()); drawLayersRef.current = [];
    setShowNameModal(false); setDrawMode(false); setClickedDrawing(newDrawing);
  };

  const cancelDrawing = () => {
    setDrawPoints([]);
    if (previewLayerRef.current) { previewLayerRef.current.remove(); previewLayerRef.current = null; }
    drawLayersRef.current.forEach(l => l.remove()); drawLayersRef.current = [];
    setShowNameModal(false); setDrawMode(false);
  };

  const clearMeasure = () => {
    measureLayersRef.current.forEach(l => l.remove()); measureLayersRef.current = [];
    if (measureLineRef.current) { measureLineRef.current.remove(); measureLineRef.current = null; }
    setMeasurePoints([]); setMeasureMode(false);
  };

  const resetMeasurePoints = () => {
    setMeasurePoints([]);
    measureLayersRef.current.forEach(l => l.remove()); measureLayersRef.current = [];
    if (measureLineRef.current) { measureLineRef.current.remove(); measureLineRef.current = null; }
  };

  /* ── Search ──────────────────────────────────────────────────────────────── */
  async function handleSidebarSearch(e) {
    e?.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    try {
      const decMatch = q.match(/^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/);
      if (decMatch) {
        const lat = parseFloat(decMatch[1]), lng = parseFloat(decMatch[2]);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          setFlyTarget({ lat, lng, zoom: 16, _ts: Date.now() });
          setLocationInfo({ lat, lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, details: "Coordinates", loading: false });
          if (isMobile) setActiveSheet(null);
          return;
        }
      }
      const result = await geocodeForMap(q);
      if (!result) { alert(`"${q}" — Location not found.`); return; }
      const zoom = zoomForType(result.type);
      setFlyTarget({ lat: result.lat, lng: result.lng, zoom, bbox: result.bbox, _ts: Date.now() });
      setLocationInfo({ lat: result.lat, lng: result.lng, name: result.name, details: result.display_name, loading: true, description: null, wikiUrl: null, photo: null });
      if (result.geojson) setBoundaryGeojson(result.geojson);
      if (searchFnRef.current) { try { await searchFnRef.current(q); } catch (_) {} }
      try {
        const searchName = (result.name || q).split(",")?.[0]?.trim();
        const wr = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchName)}`, { signal: AbortSignal.timeout(6000) });
        if (wr.ok) {
          const w = await wr.json();
          if (w.type !== "disambiguation" && w.extract?.length > 30) {
            setLocationInfo(prev => prev ? { ...prev, description: w.extract, wikiUrl: w.content_urls?.desktop?.page, photo: w.thumbnail?.source || null, loading: false } : null);
            return;
          }
        }
      } catch (_) {}
      setLocationInfo(prev => prev ? { ...prev, loading: false } : null);
    } finally {
      setSearchLoading(false);
      if (isMobile) setActiveSheet(null);
    }
  }

  const handleLocationFound = useCallback(async ({ lat, lng, label, raw }) => {
    setLocationInfo({ lat, lng, label, loading: true, photo: null, description: null });
    setFlyTarget({ lat, lng, zoom: 15, _ts: Date.now() });
    if (raw && !raw.display_name) {
      setBoundaryGeojson(null);
      setLocationInfo({ lat, lng, label, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, description: null, wikiUrl: null, photo: null, details: null, plusCode: toPlusCode(lat, lng), loading: true });
      const place = await reverseGeocode(lat, lng);
      if (place) {
        const addr = place.address || {};
        const city = addr.city || addr.town || addr.village || addr.suburb || addr.county || "";
        setLocationInfo({ lat, lng, label, name: addr.neighbourhood || addr.suburb || addr.quarter || addr.road || city || addr.state || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, details: [city, addr.state, addr.country].filter(Boolean).join(", "), description: null, wikiUrl: null, photo: null, plusCode: toPlusCode(lat, lng), fullAddress: place.display_name, loading: false });
      } else {
        setLocationInfo({ lat, lng, label, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, details: null, description: null, wikiUrl: null, photo: null, plusCode: toPlusCode(lat, lng), loading: false });
      }
      return;
    }
    try {
      let gj = null, place = null;
      const sn = label.split(",")?.[0]?.trim() || label;
      const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(sn)}&format=json&limit=5&polygon_geojson=1&addressdetails=1&namedetails=1&accept-language=en`;
      const proxyUrls = [nomUrl, `https://corsproxy.io/?url=${encodeURIComponent(nomUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(nomUrl)}`];
      for (const px of proxyUrls) {
        try {
          const res = await fetch(px, { signal: AbortSignal.timeout(7000) });
          if (!res.ok) continue;
          const data = await res.json();
          if (!Array.isArray(data) || !data.length) continue;
          place = data.find(r => r.geojson?.type === "MultiPolygon") || data.find(r => r.geojson?.type === "Polygon") || data[0];
          gj = place?.geojson || null;
          if (place) break;
        } catch (_) { continue; }
      }
      setBoundaryGeojson(gj);
      let desc = null, wUrl = null, photo = null;
      const pn = place?.namedetails?.name || place?.display_name?.split(",")?.[0] || sn;
      try {
        const wr = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pn)}`, { signal: AbortSignal.timeout(5000) });
        if (wr.ok) { const w = await wr.json(); if (w.type !== "disambiguation" && w.extract?.length > 30) { desc = w.extract; wUrl = w.content_urls?.desktop?.page; photo = w.thumbnail?.source || null; } }
      } catch (_) {}
      const addr = place?.address || {};
      setLocationInfo({ lat, lng, label, name: pn, description: desc, wikiUrl: wUrl, photo, details: [addr.city || addr.town || addr.village, addr.state, addr.country].filter(Boolean).join(", "), loading: false });
    } catch {
      setLocationInfo(p => ({ ...p, loading: false, description: "Could not load info." }));
    }
  }, []);

  const handleCloseLocationInfo = useCallback(() => { setLocationInfo(null); setBoundaryGeojson(null); }, []);

  /* ── UNIFIED Menu action handler ─────────────────────────────────────────── */
  const handleMenuAction = (action) => {
    setOpenMenu(null);
    const A = action;
    // ── PRINT ──
    if (A === "openPrint")           { setPrintOpen(true); return; }
    // ── DIRECTIONS ──
    if (A === "openDirections")      { setDirectionsOpen(true); return; }
    if (A === "openKML")             { kmlInputRef.current?.click(); return; }
    if (A === "openExtra")           { extraInputRef.current?.click(); return; }
    if (A === "openGeoJSON")         { geojsonInputRef.current?.click(); return; }
    if (A === "openShapefile")       { shpInputRef.current?.click(); return; }
    if (A === "openDEM")             { demInputRef.current?.click(); return; }
    if (A === "exportGeoJSON")       { exportGeoJSON(savedDrawings, route, measurePoints); return; }
    if (A === "exportKML")           { exportKML(savedDrawings, route, measurePoints); return; }
    if (A === "exportCSV")           { exportCSV(savedDrawings, route, measurePoints); return; }
    if (A === "exportKMZ")           { exportKMZ(savedDrawings, route, measurePoints); return; }
    if (A === "exportSHP")           { exportShapefile(savedDrawings, route, measurePoints); return; }
    if (A === "resetAll")            { if (!window.confirm("Reset everything?")) return; setSavedDrawings([]); cancelDrawing(); clearMeasure(); setRoute([]); setSurveyMode(false); geoJSON.clearAllGeoJSONLayers(); handleDEMRemoveWithClear(); return; }
    if (A === "startDraw") { setDrawMode(true); setDrawPoints([]); setActiveSheet(null); return; }
    if (A === "cancelDraw")          { cancelDrawing(); return; }
    if (A === "startMeasure") { setMeasureMode(true); setActiveTool("ruler"); return; }
    if (A === "stopMeasure")         { clearMeasure(); setActiveTool("select"); return; }
    if (A === "deleteDrawings")      { if (!savedDrawings.length) { alert("No drawings."); return; } if (window.confirm(`Delete ${savedDrawings.length} drawing(s)?`)) setSavedDrawings([]); return; }
    if (A === "layerSatellite")      { setActiveLayer("Satellite"); return; }
    if (A === "layerStreet")         { setActiveLayer("Street"); return; }
    if (A === "layerTerrain")        { setActiveLayer("Terrain"); return; }
    if (A === "layerDark")           { setActiveLayer("Dark"); return; }
    if (A === "layerLight")          { setActiveLayer("Light"); return; }
    if (A === "layerSatLabels")      { setActiveLayer("Satellite + Labels"); return; }
    if (A === "show3D")              { setShow3D(true); return; }
    if (A === "toggleNight")         { setNightModeAuto(p => !p); return; }
    if (A === "drawMarker") { setDrawMode(true); setDrawType("marker"); setDrawPoints([]); setActiveTool("placemark"); setActiveSheet(null); return; }
    if (A === "drawPath")   { setDrawMode(true); setDrawType("path");    setDrawPoints([]); setActiveTool("path");      setActiveSheet(null); return; }
    if (A === "drawPoly")   { setDrawMode(true); setDrawType("polygon"); setDrawPoints([]); setActiveTool("polygon");   setActiveSheet(null); return; }
    if (A === "toggleSurvey")        { handleToggleSurvey(); return; }
    if (A === "openTracker")         { setTrackerOpen(true); return; }
    if (A === "openOffline")         { setOfflineOpen(true); return; }
    if (A === "toggleOfflineMode")   { setOfflineMode(p => !p); return; }
    if (A === "openElevation")       { if (isMobile) setActiveSheet("elevation"); else setElevOpen(true); return; }
    if (A === "openCompassNav")      { compass.compassNavActive ? compass.stopCompassNav() : compass.startCompassNav(); return; }
    if (A === "about") { setShowAbout(true); return; }
    if (A === "options"){ setOptionsOpen(true); return;}
    if (A === "openKMLProcessing")   { setKmlProcessingOpen(true); return; }
    if (A === "shortcuts")           { setShowShortcuts(true); return; }
    if (A === "osmLink")             { window.open("https://www.openstreetmap.org", "_blank"); return; }
    if (A === "leafletLink")         { window.open("https://leafletjs.com/reference.html", "_blank"); return; }
  };

  if (show3D) return <Globe3DView savedDrawings={savedDrawings} onClose={() => setShow3D(false)} />;

  const cfg = MAP_LAYERS[activeLayer] || {};

  /* ── Export buttons ────────────────────────────────────────────────────── */
  const ExportButtons = ({ compact = false }) => !hasExportData ? null : (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: compact ? 4 : 6 }}>
      {[
        ["GeoJSON",    () => exportGeoJSON(savedDrawings, route, measurePoints),   "rgba(34,197,94,0.12)",   "rgba(34,197,94,0.3)",   "#4ade80"],
        ["KML",        () => exportKML(savedDrawings, route, measurePoints),       "rgba(251,191,36,0.12)",  "rgba(251,191,36,0.3)",  "#fbbf24"],
        ["CSV",        () => exportCSV(savedDrawings, route, measurePoints),       "rgba(56,189,248,0.12)",  "rgba(56,189,248,0.3)",  "#38bdf8"],
        ["KMZ",        () => exportKMZ(savedDrawings, route, measurePoints),       "rgba(167,139,250,0.12)", "rgba(167,139,250,0.3)", "#c4b5fd"],
        ["SHP/ZIP",    () => exportShapefile(savedDrawings, route, measurePoints), "rgba(167,139,250,0.12)", "rgba(167,139,250,0.3)", "#a78bfa"],
        ["DEM (.tif)", () => exportDEM({ raster: demRasterData, kmlMask, filename: "survey_dem.tif" }),      "rgba(244,63,94,0.12)",  "rgba(244,63,94,0.3)",  "#fb7185"],
      ].map(([label, fn, bg, border, color]) => (
        <button key={label} onClick={fn}
          style={{ padding: compact ? "7px 4px" : "9px 6px", borderRadius: 8, cursor: "pointer", background: bg, border: `1px solid ${border}`, color, fontSize: compact ? 10 : 11, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <span style={{ fontSize: compact ? 11 : 13 }}>↓</span>{label}
        </button>
      ))}
    </div>
  );

  /* ── File Folder panel ─────────────────────────────────────────────────── */
  const FileFolderPanel = ({ onClose }) => (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>Import Files</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
          {[
            { label: "KML",     accept: ".kml",                      onChange: handleKMLUpload,         bg: "rgba(74,158,255,0.08)",  border: "rgba(74,158,255,0.2)",  color: "#60a5fa", icon: "📍" },
            { label: "KMZ/CSV", accept: ".kmz,.csv",                 onChange: handleExtraUpload,       bg: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.2)",  color: "#fbbf24", icon: "🗜" },
            { label: "GeoJSON", accept: ".geojson,.json",            onChange: handleGeoJSONFileUpload, bg: "rgba(20,184,166,0.08)",  border: "rgba(20,184,166,0.2)",  color: "#2dd4bf", icon: "🌐" },
            { label: "SHP",     accept: ".zip,.shp",                 onChange: handleShapefileUpload,   bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.2)", color: "#a78bfa", icon: "🗺" },
            { label: "DEM",     accept: ".tif,.tiff,.asc,.dem,.img", onChange: handleDEMFileInput,      bg: "rgba(251,113,133,0.08)", border: `1.5px ${demFileName ? "solid" : "dashed"} rgba(251,113,133,${demFileName ? "0.45" : "0.3"})`, color: "#fb7185", icon: "🏔" },
          ].map(({ label, accept, onChange, bg, border, color, icon }) => (
            <label key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "9px 4px", borderRadius: 10, cursor: "pointer", background: bg, border, color, fontSize: 10, fontWeight: 600, textAlign: "center" }}>
              <span style={{ fontSize: 16 }}>{icon}</span>{label}
              <input type="file" accept={accept} onChange={onChange} style={{ display: "none" }} />
            </label>
          ))}
        </div>
        {importedCount === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.18)", fontSize: 11, fontStyle: "italic", padding: "8px 0" }}>No files imported yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {kmlName && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(74,158,255,0.06)", border: "1px solid rgba(74,158,255,0.15)", borderRadius: 8 }}>
                <span style={{ fontSize: 14 }}>📍</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#90c8ff", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                    onClick={() => kmlAnalyzerData && setKmlAnalyzerOpen(true)}>{kmlName}</div>
                  <div style={{ color: "rgba(74,158,255,0.4)", fontSize: 9.5, fontFamily: "'DM Mono',monospace" }}>KML{kmlMask ? " · clip mask active 🎯" : ""}{demRasterData ? " · draped 🏔" : ""}{kmlAnalyzerData ? " · 📐 click for area" : ""}</div>
                </div>
                <button onClick={() => setKmlProcessingOpen(true)} title="DEM / Contour / Shapefile"
                  style={{ background: "rgba(251,113,133,0.12)", border: "1px solid rgba(251,113,133,0.35)", color: "#fb7185", cursor: "pointer", fontSize: 11, padding: "3px 7px", borderRadius: 6, flexShrink: 0, fontWeight: 700 }}>🏔</button>
                {kmlAnalyzerData && <button onClick={() => setKmlAnalyzerOpen(true)}
                  style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24", cursor: "pointer", fontSize: 12, padding: "3px 8px", borderRadius: 6, flexShrink: 0, fontWeight: 700 }}>📐</button>}
                <button onClick={removeKML} style={{ background: "none", border: "none", color: "rgba(239,68,68,0.45)", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>×</button>
              </div>
            )}
            {extraFile && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: 8 }}>
                <span style={{ fontSize: 14 }}>{extraFileType === "kmz" ? "🗜" : "📊"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#fcd34d", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{extraFile.name}</div>
                  <div style={{ color: "rgba(251,191,36,0.4)", fontSize: 9.5, fontFamily: "'DM Mono',monospace" }}>{extraFileType?.toUpperCase()}{extraFileType === "csv" && csvTotalCount > 0 ? ` · ${csvValidCount}/${csvTotalCount} valid` : ""}</div>
                </div>
                <button onClick={removeExtra} style={{ background: "none", border: "none", color: "rgba(239,68,68,0.45)", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>×</button>
              </div>
            )}
            {geojsonFileName && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 8 }}>
                <span style={{ fontSize: 14 }}>🌐</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#4ade80", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{geojsonFileName}</div>
                  <div style={{ color: "rgba(34,197,94,0.4)", fontSize: 9.5, fontFamily: "'DM Mono',monospace" }}>GeoJSON</div>
                </div>
                <button onClick={removeGeojson} style={{ background: "none", border: "none", color: "rgba(239,68,68,0.45)", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>×</button>
              </div>
            )}
            {shpFileName && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: 8 }}>
                <span style={{ fontSize: 14 }}>🗺</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#c4b5fd", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shpFileName}</div>
                  <div style={{ color: "rgba(167,139,250,0.4)", fontSize: 9.5, fontFamily: "'DM Mono',monospace" }}>Shapefile · {shpCount} features</div>
                </div>
                <button onClick={removeShapefile} style={{ background: "none", border: "none", color: "rgba(239,68,68,0.45)", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>×</button>
              </div>
            )}
            {geoJSON.importedGeoJSONLayers.map(layer => (
              <div key={layer.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(20,184,166,0.06)", border: "1px solid rgba(20,184,166,0.15)", borderRadius: 8 }}>
                <span style={{ fontSize: 14 }}>🌐</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#5eead4", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{layer.name}</div>
                  <div style={{ color: "rgba(20,184,166,0.4)", fontSize: 9.5, fontFamily: "'DM Mono',monospace" }}>{layer.featureCount} features · dbl-click for properties</div>
                </div>
                <button onClick={() => geoJSON.removeGeoJSONLayer(layer.id)} style={{ background: "none", border: "none", color: "rgba(239,68,68,0.38)", cursor: "pointer", padding: 3, display: "flex", flexShrink: 0 }}><Ico name="Trash" size={11} /></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 12, paddingTop: 12 }}>
          <DEMPanel demFileName={demFileName} demLoading={demLoading} demStats={demStats} demOpacity={demOpacity} demColorRamp={demColorRamp} demError={demError} onUpload={handleDEMUpload} onRemove={handleDEMRemoveWithClear} onOpacity={handleDEMOpacity} onColorRamp={handleDEMColorRamp} />
        </div>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>
          Export {!hasExportData && <span style={{ color: "rgba(255,255,255,0.15)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— draw or survey first</span>}
        </div>
        {hasExportData ? <ExportButtons /> : <div style={{ textAlign: "center", color: "rgba(255,255,255,0.18)", fontSize: 11, fontStyle: "italic", padding: "8px 0" }}>No data to export yet</div>}
      </div>
    </div>
  );

  /* ────────────────────────────────────────────────────────────────────────
     RENDER
  ──────────────────────────────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        html,body,#root{height:100%!important;width:100%!important;margin:0!important;padding:0!important;overflow:hidden!important;}
        :root{--menu-h:${MENU_H}px;--tb-h:${TB_H}px;--stat-h:${STAT_H}px;--sb-w:${SB_W}px;--top-h:${TOP_H}px;}
        .leaflet-tile-pane{z-index:2!important;}.leaflet-map-pane{z-index:1!important;}.leaflet-tile{visibility:visible!important;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeSlideIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes hudpulse{0%,100%{box-shadow:0 4px 24px rgba(245,158,11,0.25)}50%{box-shadow:0 4px 32px rgba(245,158,11,0.5)}}
        @keyframes geSlideIn{from{opacity:0;transform:translateX(20px) scale(0.97)}to{opacity:1;transform:translateX(0) scale(1)}}
        @keyframes geToolbarSlideIn{from{opacity:0;transform:translateY(-50%) translateX(-12px)}to{opacity:1;transform:translateY(-50%) translateX(0)}}
        .survey-tooltip{background:rgba(5,12,24,0.88)!important;border:1px solid rgba(74,158,255,0.3)!important;color:#c8e0f8!important;font-size:11px!important;font-family:'DM Sans',sans-serif!important;border-radius:6px!important;padding:4px 8px!important;box-shadow:0 2px 8px rgba(0,0,0,0.4)!important;}
        .survey-tooltip::before{display:none!important;}
        .menu-item{display:flex;align-items:center;gap:9px;padding:8px 16px;cursor:pointer;color:rgba(220,235,255,0.88);font-size:12px;font-family:system-ui,sans-serif;}
        .menu-item:hover{background:rgba(74,158,255,0.12);}
      `}</style>
      <style>{GLOBAL_STYLES}</style>

      <div style={{ position: "fixed", inset: 0, background: "#060e1a", fontFamily: "'DM Sans',sans-serif" }}>

        {/* Hidden file inputs */}
        <input ref={kmlInputRef}     type="file" accept=".kml"                      onChange={handleKMLUpload}         style={{ display: "none" }} />
        <input ref={extraInputRef}   type="file" accept=".kmz,.csv"                 onChange={handleExtraUpload}       style={{ display: "none" }} />
        <input ref={geojsonInputRef} type="file" accept=".geojson,.json"            onChange={handleGeoJSONFileUpload} style={{ display: "none" }} />
        <input ref={shpInputRef}     type="file" accept=".zip,.shp"                 onChange={handleShapefileUpload}   style={{ display: "none" }} />
        <input ref={demInputRef}     type="file" accept=".tif,.tiff,.asc,.dem,.img" onChange={handleDEMFileInput}      style={{ display: "none" }} />

        {/* ══ DESKTOP MENU BAR ═══════════════════════════════════════════ */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: MENU_H, zIndex: 1200, background: "rgba(5,12,24,0.97)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.055)", display: "flex", alignItems: "center", paddingLeft: 12, gap: 0 }}>
          
          {/* Logo */}
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            marginRight: 10,
            paddingRight: 10,
            borderRight: "1px solid rgba(255,255,255,0.07)" 
          }}>
            <img 
              src="/geoxis-logo.png.png"
              alt="Geoxis" 
              style={{ 
                height: 28,
                width: "auto", 
                maxWidth: 110,
                objectFit: "contain",
                display: "block",
              }} 
            />
          </div>

          {Object.entries(UNIFIED_MENU_DEFS).map(([menuName, menuItems]) => {
            const isOpen = openMenu === menuName;
            return (
              <div key={menuName} style={{ position: "relative", height: "100%", display: "flex", alignItems: "center" }}>
                <span
                  onClick={() => setOpenMenu(isOpen ? null : menuName)}
                  onMouseEnter={() => { if (openMenu && openMenu !== menuName) setOpenMenu(menuName); }}
                  style={{ fontSize: 12, color: isOpen ? "#80c4ff" : "rgba(241,237,235,0.9)", padding: "0 12px", cursor: "pointer", userSelect: "none", height: "100%", display: "flex", alignItems: "center", background: isOpen ? "rgba(74,158,255,0.15)" : "transparent", fontWeight: isOpen ? 500 : 400 }}
                >
                  {menuName}
                </span>
                {isOpen && (
                  <div style={{ position: "absolute", top: MENU_H, left: 0, background: "rgba(5,12,24,0.98)", backdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,0.1)", borderTop: "1.5px solid rgba(74,158,255,0.5)", borderRadius: "0 0 10px 10px", minWidth: 240, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", zIndex: 1300, overflow: "hidden" }}>
                    {menuItems.map((item, idx) =>
                      item.divider
                        ? <div key={`d${idx}`} style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "3px 0" }} />
                        : (
                          <div key={idx} className="menu-item" onClick={() => { handleMenuAction(item.action); setOpenMenu(null); }}>
                            <Ico name={item.icon} size={13} />
                            <span style={{ flex: 1 }}>{item.label}</span>
                            {item.shortcut && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "monospace", marginLeft: 8 }}>{item.shortcut}</span>}
                          </div>
                        )
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {openMenu && <div style={{ position: "fixed", inset: 0, zIndex: 1290 }} onClick={() => setOpenMenu(null)} />}
          <div style={{ flex: 1 }} />

          {/* ── BACKEND: Sync badge ─────────────────────────────────────── */}
          {syncBadge && syncBadge.label && (
            <span style={{ fontSize:10, fontWeight:700, fontFamily:"'DM Mono',monospace", color:syncBadge.color, background:syncBadge.bg, border:`1px solid ${syncBadge.border}`, borderRadius:12, padding:"2px 8px", marginRight:6, display:"inline-flex", alignItems:"center", gap:4, letterSpacing:"0.04em", userSelect:"none" }}>
              {syncStatus === "syncing" && <span style={{ animation:"spin 1s linear infinite", display:"inline-block", fontSize:9 }}>◌</span>}
              {syncStatus === "synced"  && "✓ "}
              {syncStatus === "queued"  && "⏳ "}
              {syncStatus === "error"   && "⚠ "}
              {syncBadge.label}
            </span>
          )}

          {/* ── BACKEND: Offline queue badge ────────────────────────────── */}
          {queueSize > 0 && (
            <span style={{ fontSize:10, color:"#fbbf24", background:"rgba(251,191,36,0.1)", border:"1px solid rgba(251,191,36,0.3)", borderRadius:12, padding:"2px 8px", marginRight:6, fontFamily:"'DM Mono',monospace" }}>
              {queueSize} queued
            </span>
          )}

          {/* Status pills */}
          {compass.compassNavActive && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: "rgba(14,165,233,0.14)", borderRadius: 16, border: "1px solid rgba(14,165,233,0.4)", marginRight: 8, cursor: "pointer" }} onClick={compass.stopCompassNav}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" style={{ animation: "spin 3s linear infinite" }}><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#38bdf8" stroke="none" /></svg>
              <span style={{ fontSize: 10, color: "#38bdf8", fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{compass.compassHeading != null ? `${Math.round(((compass.compassHeading % 360) + 360) % 360)}°` : "NAV"}</span>
            </div>
          )}
          {isTracking && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: "rgba(239,68,68,0.14)", borderRadius: 16, border: "1px solid rgba(239,68,68,0.35)", marginRight: 8, cursor: "pointer" }} onClick={() => setTrackerOpen(true)}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "blink 1s infinite" }} />
              <span style={{ fontSize: 10, color: "#f87171", fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>REC</span>
            </div>
          )}

          {/* ── BACKEND: User display / Sign In ─────────────────────────── */}
          {(() => {
            const user = getLoggedInUser();
            return user && user.username ? (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:10 }}>
                <span style={{ fontSize:11, color:"#80c4ff", fontWeight:600 }}>{user.username}</span>
              </div>
            ) : (
              <button
                onClick={() => navigate("/login")}
                style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:6, border:"1px solid rgba(74,158,255,0.3)", background:"rgba(74,158,255,0.12)", color:"#80c4ff", cursor:"pointer", fontSize:11, fontWeight:600, marginRight:10 }}
              >
                <Ico name="User" size={12} /> Sign In
              </button>
            );
          })()}
        </div>

        {/* ══ DESKTOP TOOLBAR ════════════════════════════════════════════ */}
        <div style={{ position: "absolute", top: MENU_H, left: 0, right: 0, height: TB_H, zIndex: 1150, background: "rgba(5,12,24,0.90)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", padding: "0 10px", gap: 5, overflowX: "auto" }}>
          {[
            { key: "Satellite",          icon: "Satellite",  short: "Sat"     },
            { key: "Street",             icon: "Street",     short: "Street"  },
            { key: "Terrain",            icon: "Terrain",    short: "Terrain" },
            { key: "Satellite + Labels", icon: "SatLabels",  short: "+Labels" },
            { key: "Dark",               icon: "Dark",       short: "Dark"    },
            { key: "Light",              icon: "Light",      short: "Light"   },
          ].map(({ key, icon, short }) => (
            <button key={key} className={`tb-btn ${activeLayer === key ? "active" : "inactive"}`} onClick={() => setActiveLayer(key)}>
              <Ico name={icon} size={14} /><span>{short}</span>
            </button>
          ))}

          <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.08)", margin: "0 3px", flexShrink: 0 }} />
          <button className={`tb-btn ${drawMode ? "active" : "inactive"}`} onClick={() => { setDrawMode(m => !m); if (!drawMode) setDrawPoints([]); }}><Ico name="Draw" size={14} /><span>Draw</span></button>
          <button className={`tb-btn ${measureMode ? "active" : "inactive"}`} onClick={() => { setMeasureMode(m => !m); }}><Ico name="Measure" size={14} /><span>Measure</span></button>
          <button className={`tb-btn ${surveyMode ? "active" : "inactive"}`} onClick={handleToggleSurvey}><Ico name="Survey" size={14} /><span>Survey</span></button>

          <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.08)", margin: "0 3px", flexShrink: 0 }} />
          <button className={`tb-btn ${isTracking ? "tracker-active" : "inactive"}`} onClick={() => { if(!requireAuth("openTracker")) return; setTrackerOpen(p => !p); }} style={{ position: "relative", minWidth: 52 }}><Ico name="Record" size={14} /><span>Track</span>
          {isTracking && <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "blink 1s infinite" }} />}
          </button>

          <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.08)", margin: "0 3px", flexShrink: 0 }} />
          <label className="tb-btn inactive" style={{ cursor: "pointer" }}><Ico name="Upload" size={14} /><span>KML</span><input type="file" accept=".kml" onChange={handleKMLUpload} style={{ display: "none" }} /></label>
          <label className="tb-btn inactive" style={{ cursor: "pointer" }}><Ico name="CSV" size={14} /><span>KMZ/CSV</span><input type="file" accept=".kmz,.csv" onChange={handleExtraUpload} style={{ display: "none" }} /></label>
          <label className={`tb-btn ${(geoJSON.importedGeoJSONLayers.length || geojsonFileName) ? "geojson-active" : "inactive"}`} style={{ cursor: "pointer" }}><Ico name="GeoJSON" size={14} /><span>GeoJSON</span><input type="file" accept=".geojson,.json" onChange={handleGeoJSONFileUpload} style={{ display: "none" }} /></label>
          <label className="tb-btn inactive" style={{ cursor: "pointer" }}><Ico name="GeoJSON" size={14} /><span>SHP/ZIP</span><input type="file" accept=".zip,.shp" onChange={handleShapefileUpload} style={{ display: "none" }} /></label>
          <label className={`tb-btn ${demFileName ? "active" : "inactive"}`} style={{ cursor: "pointer", background: demFileName ? "rgba(251,113,133,0.18)" : "", borderColor: demFileName ? "rgba(251,113,133,0.4)" : "", color: demFileName ? "#fb7185" : "" }}>
            <span style={{ fontSize: 13 }}>🏔</span><span>DEM</span>
            <input type="file" accept=".tif,.tiff,.asc,.dem,.img" onChange={handleDEMFileInput} style={{ display: "none" }} />
          </label>

          {kmlAnalyzerData && (
            <button className={`tb-btn ${kmlAnalyzerOpen ? "active" : "inactive"}`} onClick={() => setKmlAnalyzerOpen(p => !p)} style={{ background: "rgba(251,191,36,0.14)", borderColor: "rgba(251,191,36,0.4)", color: "#fbbf24" }}>
              <span style={{ fontSize: 13 }}>📐</span><span>Area</span>
            </button>
          )}

          {kmlName && (
            <button
              className={`tb-btn ${kmlProcessingOpen ? "active" : "inactive"}`}
              onClick={() => setKmlProcessingOpen(p => !p)}
              style={{ background: kmlProcessingOpen ? "rgba(251,113,133,0.22)" : "rgba(251,113,133,0.14)", borderColor: "rgba(251,113,133,0.4)", color: "#fb7185" }}
              title="KML → DEM / Contour / Shapefile"
            >
              <span style={{ fontSize: 13 }}>🏔</span><span>DEM/Contour</span>
            </button>
          )}

          <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.08)", margin: "0 3px", flexShrink: 0 }} />
          <button className="tb-btn inactive" onClick={() => exportGeoJSON(savedDrawings, route, measurePoints)} style={{ background: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.3)", color: "#4ade80" }}><Ico name="Export" size={14} /><span>GeoJSON</span></button>
          {hasExportData && <>
            <button className="tb-btn inactive" onClick={() => exportKML(savedDrawings, route, measurePoints)}       style={{ background: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.3)", color: "#fbbf24" }}><Ico name="Export" size={14} /><span>KML</span></button>
            <button className="tb-btn inactive" onClick={() => exportCSV(savedDrawings, route, measurePoints)}       style={{ background: "rgba(56,189,248,0.12)", borderColor: "rgba(56,189,248,0.3)", color: "#38bdf8" }}><Ico name="Export" size={14} /><span>CSV</span></button>
            <button className="tb-btn inactive" onClick={() => exportKMZ(savedDrawings, route, measurePoints)}       style={{ background: "rgba(167,139,250,0.12)", borderColor: "rgba(167,139,250,0.3)", color: "#c4b5fd" }}><Ico name="Export" size={14} /><span>KMZ</span></button>
            <button className="tb-btn inactive" onClick={() => exportShapefile(savedDrawings, route, measurePoints)} style={{ background: "rgba(167,139,250,0.12)", borderColor: "rgba(167,139,250,0.3)", color: "#a78bfa" }}><Ico name="Export" size={14} /><span>SHP</span></button>
          </>}

          <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.08)", margin: "0 3px", flexShrink: 0 }} />
          <button className={`tb-btn ${!isOnline ? "tracker-active" : "inactive"}`} onClick={() => setOfflineOpen(p => !p)}><Ico name="Offline" size={14} /><span>Offline</span></button>
          <button className={`tb-btn ${offlineMode ? "offline-active" : "inactive"}`} onClick={() => setOfflineMode(p => !p)}><span style={{ fontSize: 13 }}>{offlineMode ? "🗺" : "🌐"}</span><span>{offlineMode ? "Cached" : "Cache"}</span></button>

          <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.08)", margin: "0 3px", flexShrink: 0 }} />
          <button className={`tb-btn ${elevOpen ? "active" : "inactive"}`} onClick={() => { setElevOpen(p => !p); if (!elevOpen && !elevMode) setElevMode("survey"); }}><Ico name="Mountain" size={14} /><span>Elevation</span></button>
          <button className={`tb-btn ${compass.compassNavActive ? "compass-active" : "inactive"}`} onClick={() => compass.compassNavActive ? compass.stopCompassNav() : compass.startCompassNav()} style={{ position: "relative", minWidth: 78 }}>
            <Ico name="Navigation" size={14} style={{ animation: compass.compassNavActive ? "spin 4s linear infinite" : "none" }} /><span>Compass</span>
            {compass.compassNavActive && <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: "50%", background: "#0ea5e9", animation: "blink 0.8s infinite" }} />}
          </button>
          <button className="tb-btn" onClick={() => setShow3D(true)} style={{ background: "rgba(167,139,250,0.15)", borderColor: "rgba(167,139,250,0.4)", color: "#c4b5fd" }}><Ico name="Globe" size={14} /><span>3D</span></button>
          <button className={`tb-btn ${nightModeAuto ? "active" : "inactive"}`} onClick={() => setNightModeAuto(p => !p)}><Ico name={nightSwitchInfo?.isNight ? "Night" : "Day"} size={14} /><span>Night</span></button>

          {/* ── Print toolbar button ── */}
          <button className="tb-btn inactive" onClick={() => setPrintOpen(true)} style={{ background: "rgba(26,115,232,0.12)", borderColor: "rgba(26,115,232,0.3)", color: "#80c4ff" }}>
            <span style={{ fontSize: 13 }}>🖨</span><span>Print</span>
          </button>

          {/* ── Directions toolbar button ── */}
          <button
            className={`tb-btn ${directionsOpen ? "active" : "inactive"}`}
            onClick={() => setDirectionsOpen(p => !p)}
            style={{ background: directionsOpen ? "rgba(26,115,232,0.22)" : "rgba(26,115,232,0.12)", borderColor: "rgba(26,115,232,0.35)", color: "#80c4ff" }}
          >
            <span style={{ fontSize: 13 }}>🧭</span><span>Directions</span>
          </button>
          
          {/* ── APK Download toolbar button ── */}

 <a href="/Geoxis.apk"
  download="Geoxis.apk"
  style={{
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "0 10px",
    height: "100%",
    background: "rgba(34,197,94,0.14)",
    border: "1px solid rgba(34,197,94,0.4)",
    borderRadius: 7,
    color: "#4ade80",
    fontSize: 11,
    fontWeight: 700,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
  }}
  title="Download Geoxis APK"
>
  <span style={{ fontSize: 13 }}>📱</span>
  <span>Get App</span>
</a>

          <div style={{ flex: 1 }} />

          {geoJSON.geojsonLoading && <span style={{ fontSize: 11, color: "#2dd4bf", background: "rgba(20,184,166,0.12)", padding: "4px 10px", borderRadius: 16, border: "1px solid rgba(20,184,166,0.25)", display: "flex", alignItems: "center", gap: 5 }}><span style={{ animation: "blink 1s infinite" }}>●</span>Loading…</span>}
          {geojsonLoading && <span style={{ fontSize: 11, color: "#4ade80", background: "rgba(34,197,94,0.12)", padding: "4px 10px", borderRadius: 16, border: "1px solid rgba(34,197,94,0.25)", display: "flex", alignItems: "center", gap: 5 }}><span style={{ animation: "blink 1s infinite" }}>●</span>{geojsonFileName?.slice(0, 14)}…</span>}
          {kmlLoading && <span style={{ fontSize: 11, color: "#60a0e8", background: "rgba(74,158,255,0.12)", padding: "4px 10px", borderRadius: 16, border: "1px solid rgba(74,158,255,0.25)", display: "flex", alignItems: "center", gap: 5 }}><span style={{ animation: "blink 1s infinite" }}>●</span>{kmlName?.slice(0, 14)}…</span>}
          {shpLoading && <span style={{ fontSize: 11, color: "#a78bfa", background: "rgba(167,139,250,0.12)", padding: "4px 10px", borderRadius: 16, border: "1px solid rgba(167,139,250,0.25)", display: "flex", alignItems: "center", gap: 5 }}><span style={{ animation: "blink 1s infinite" }}>●</span>{shpFileName?.slice(0, 14)}…</span>}
          {demLoading && <span style={{ fontSize: 11, color: "#fb7185", background: "rgba(251,113,133,0.12)", padding: "4px 10px", borderRadius: 16, border: "1px solid rgba(251,113,133,0.25)", display: "flex", alignItems: "center", gap: 5 }}><span style={{ animation: "blink 1s infinite" }}>●</span>{demFileName?.slice(0, 12)}… DEM</span>}
        </div>

        {/* ══ MOBILE CHROME ══════════════════════════════════════════════ */}
        {isMobile && <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1330 }}><MobileSearchBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} onSearch={handleSidebarSearch} searchLoading={searchLoading} /></div>}
        {isMobile && <div style={{ position: "absolute", top: 58, left: 0, right: 0, zIndex: 1315, pointerEvents: "none" }}><CompactMobileHUD mousePos={mousePos} mapZoom={mapZoom} compassHeading={compass.compassHeading} compassNavActive={compass.compassNavActive} cursorElevation={cursorElevation} /></div>}
        {isMobile && cacheStats?.tileCount > 0 && (
          <div onClick={() => setOfflineMode(p => !p)} style={{ position: "absolute", top: 160, left: 12, zIndex: 1310, display: "flex", alignItems: "center", gap: 6, padding: "5px 12px 5px 8px", background: offlineMode ? "rgba(4,10,20,0.95)" : "rgba(4,10,20,0.80)", backdropFilter: "blur(16px)", border: `1.5px solid ${offlineMode ? "rgba(34,197,94,0.6)" : "rgba(255,255,255,0.12)"}`, borderRadius: 20, cursor: "pointer", userSelect: "none" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: offlineMode ? "#22c55e" : "#94a3b8", flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: offlineMode ? "#4ade80" : "rgba(200,220,255,0.55)", fontFamily: "'DM Mono',monospace" }}>{offlineMode ? `📴 ${cacheStats.tileCount.toLocaleString()} tiles` : `🌐 ${cacheStats.tileCount.toLocaleString()} saved`}</span>
          </div>
        )}
        {isMobile && <div style={{ position: "absolute", bottom: 76, right: 12, zIndex: 1320, pointerEvents: "all" }}><MobileCompassWidget compassNavActive={compass.compassNavActive} compassHeading={compass.compassHeading} onCompassToggle={() => compass.compassNavActive ? compass.stopCompassNav() : compass.startCompassNav()} leafletMapRef={leafletMapRef} /></div>}

        {/* ══ MOBILE DRAW HUD PILL ═══════════════════════════════════════ */}
        {isMobile && drawMode && (
          <div style={{ position: "absolute", bottom: 80, left: "50%", transform: "translateX(-50%)", zIndex: 1400, display: "flex", alignItems: "center", gap: 0, background: "rgba(6,10,22,0.97)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", border: "1.5px solid rgba(245,158,11,0.45)", borderRadius: 100, animation: "hudpulse 2s ease-in-out infinite", fontFamily: "'DM Sans',sans-serif", overflow: "hidden", pointerEvents: "all" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 14px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", animation: "blink 1s infinite", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24", fontFamily: "'DM Mono',monospace" }}>{drawPoints.length}</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{drawType === "marker" ? "tap to place" : drawPoints.length === 0 ? "tap map to start" : "pts · tap to add"}</span>
            </div>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); finishDrawing(); }} disabled={drawPoints.length === 0}
              style={{ padding: "10px 16px", background: drawPoints.length > 0 ? "rgba(34,197,94,0.15)" : "transparent", border: "none", color: drawPoints.length > 0 ? "#4ade80" : "rgba(255,255,255,0.2)", fontWeight: 700, fontSize: 13, cursor: drawPoints.length > 0 ? "pointer" : "default", fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 5 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>Done
            </button>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); cancelDrawing(); }}
              style={{ padding: "10px 16px", background: "transparent", border: "none", color: "rgba(248,113,113,0.8)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 5 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>Cancel
            </button>
          </div>
        )}

        {/* ══ MAP ════════════════════════════════════════════════════════ */}
        {/* Map area offset when directions panel is open */}
        <div style={{ 
          position: "absolute", 
          top: isMobile ? 58 : TOP_H, 
         left: isMobile ? 0 : (directionsOpen ? 320 : SB_W),
          right: 0, 
          bottom: isMobile ? 68 : STAT_H, 
          zIndex: 1,
          transition: "left 0.2s ease"
        }}>
          <MapContainer center={[20.29, 85.82]} zoom={13} maxZoom={22} zoomControl={false} style={{ width: "100%", height: "100%" }}
            whenReady={() => { setTimeout(() => { try { leafletMapRef.current?.invalidateSize?.(); } catch (_) {} }, 200); }}>
            {cfg.type === "wms"
              ? <WMSTileLayer key={activeLayer} url={cfg.url} layers={cfg.layers} format={cfg.format || "image/png"} transparent={cfg.transparent ?? true} attribution={cfg.attribution} crossOrigin="anonymous" />
              : offlineMode
                ? <><OfflineTileLayer key={activeLayer + "_off"} layerKey={activeLayer} url={cfg.url} attribution={cfg.attribution} offlineOnly={false} maxZoom={22} maxNativeZoom={cfg.maxNativeZoom || 19} />{cfg.overlayUrl && <OfflineTileLayer key={activeLayer + "_ov_off"} layerKey={activeLayer + "_ov"} url={cfg.overlayUrl} offlineOnly={false} maxZoom={22} maxNativeZoom={19} />}</>
                : <><TileLayer key={activeLayer} url={cfg.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"} attribution={cfg.attribution || "© OpenStreetMap"} maxZoom={22} maxNativeZoom={cfg.maxNativeZoom || 19} crossOrigin="anonymous" />{cfg.overlayUrl && <TileLayer key={activeLayer + "_ov"} url={cfg.overlayUrl} maxZoom={22} maxNativeZoom={19} opacity={0.85} crossOrigin="anonymous" />}</>
            }
            <MapSizeInvalidator />
            <MapRefCapture leafletMapRef={leafletMapRef} setMapRef={setMapRefForTracker} />
            <ElevationClickCapture elevOpen={elevOpen || activeSheet === "elevation"} activeSheet={activeSheet} elevMode={elevMode} onMapClick={handleMapClickForElev} />
            <MapFlyController flyTarget={flyTarget} />
            <AddSearch onLocationFound={handleLocationFound} searchRef={searchFnRef} />
            <LiveGPS />

            <KMLLoader file={kmlFile} onDone={() => setKmlLoading(false)}
              onLayer={(lyr) => {
                kmlLayerRef.current = lyr;
                attachFeatureClickHandlers(lyr, "kml", kmlName || "KML Layer");
                const rings = [];
                lyr.eachLayer(layer => { if (layer.getLatLngs) { const lls = layer.getLatLngs(); const flat = Array.isArray(lls[0]) ? lls : [lls]; rings.push(...flat); } });
                setKmlMask(rings.length > 0 ? rings : lyr.toGeoJSON());
                const geojson = lyr.toGeoJSON();
                overlayControls.addLayerFeatures({ fileName: kmlName || "KML Layer", fileType: "kml", filePath: kmlName, geojson, leafletLayerGroup: lyr });
                setKmlAnalyzerData({ geojson, fileName: kmlName || "KML Layer" });
                setKmlAnalyzerOpen(true);
              }}
            />

            {extraFileType === "kmz" && (
              <KMZLoader file={extraFile} onDone={() => {}}
                onLayer={(lyr) => {
                  kmzLayerRef.current = lyr;
                  attachFeatureClickHandlers(lyr, "kmz", extraFile?.name || "KMZ Layer");
                  const geojson = lyr.toGeoJSON ? lyr.toGeoJSON() : { type: "FeatureCollection", features: [] };
                  overlayControls.addLayerFeatures({ fileName: extraFile?.name || "KMZ Layer", fileType: "kmz", filePath: extraFile?.name, geojson, leafletLayerGroup: lyr });
                  setKmlAnalyzerData({ geojson, fileName: extraFile?.name || "KMZ Layer" });
                  setKmlAnalyzerOpen(true);
                }}
              />
            )}

            {extraFileType === "csv" && (
              <CSVLoader file={extraFile}
                onDone={(lyr) => { if (lyr && lyr.toGeoJSON) { const geojson = lyr.toGeoJSON(); overlayControls.addLayerFeatures({ fileName: extraFile?.name || "CSV Layer", fileType: "csv", filePath: extraFile?.name, geojson, leafletLayerGroup: lyr }); } }}
                onCount={(valid, total) => { setCsvValidCount(valid); setCsvTotalCount(total); }}
              />
            )}

            <GeoJSONLoader file={geojsonFile} triggerKey={geojsonTrigger} onDone={() => { setGeojsonLoading(false); setGeojsonFile(null); }} />

            <ShapefileLoader file={shpFile} triggerKey={shpTrigger} onDone={() => setShpLoading(false)} onCount={(n) => setShpCount(n)}
              onLayer={(lyr) => {
                shpLayerRef.current = lyr;
                attachFeatureClickHandlers(lyr, "shp", shpFileName || "Shapefile");
                const geojson = lyr.toGeoJSON ? lyr.toGeoJSON() : { type: "FeatureCollection", features: [] };
                overlayControls.addLayerFeatures({ fileName: shpFileName || "Shapefile Layer", fileType: "shp", filePath: shpFileName, geojson, leafletLayerGroup: lyr });
                setKmlAnalyzerData({ geojson, fileName: shpFileName || "Shapefile" });
                setKmlAnalyzerOpen(true);
              }}
            />

            <DEMLoader file={demFile} opacity={demOpacity} colorRamp={demColorRamp} kmlMask={kmlMask} onDone={handleDEMDone} onError={handleDEMError} onStats={(stats, rasterData) => handleDEMStatsAndRaster(stats, rasterData)} />
            <DEMElevationDrape enabled={!!(demFileName && demRasterData)} demRasterData={demRasterData} colorRamp={demColorRamp} minElev={demStats?.min} maxElev={demStats?.max} opacity={demOpacity} kmlLayerRef={kmlLayerRef} shpLayerRef={shpLayerRef} kmzLayerRef={kmzLayerRef} />
            <SurveyClick surveyMode={surveyMode} route={route} setRoute={setRoute} setStart={() => {}} setEnd={() => {}} polylineRef={polylineRef} />
            <DrawTool drawMode={drawMode} drawType={drawType} drawPoints={drawPoints} setDrawPoints={setDrawPoints} previewLayerRef={previewLayerRef} drawLayersRef={drawLayersRef} />
            <SavedDrawingsLayer savedDrawings={savedDrawings} onFeatureClick={handleDrawingFeatureClick} />
            <BoundaryLayer geojson={boundaryGeojson} />
            <MapTracker onMove={onMouseMove} onZoom={onZoomChange} />
            <MeasureTool
              measureMode={measureMode} measurePoints={measurePoints} setMeasurePoints={setMeasurePoints}
              measureLayersRef={measureLayersRef} measureLineRef={measureLineRef}
              measureUnit={measureUnit} setMeasureUnit={setMeasureUnit}
              onFinish={clearMeasure} overlayLayers={overlayControls.overlayLayers}
              onFeatureProperties={(geojsonFeature) => setPropertiesGeoJSONFeature(geojsonFeature)}
            />
            <div className="desktop-compass" style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, pointerEvents: "all" }}>
              <ProfessionalCompassControl onBearingChange={setMapBearing} compassNavActive={compass.compassNavActive} compassHeading={compass.compassHeading} onCompassToggle={() => compass.compassNavActive ? compass.stopCompassNav() : compass.startCompassNav()} />
            </div>
            {/* ── ROUTE LAYER ── */}
            <RouteLayer routeResult={routeResult} activeRouteIdx={activeRouteIdx} />
          </MapContainer>
        </div>

        {/* ══ ZOOM CONTROL ═══════════════════════════════════════════════ */}
        {!isMobile && <ZoomControl isMobile={isMobile} leafletMapRef={leafletMapRef} />}

        {/* ══ MOBILE BOTTOM NAV ══════════════════════════════════════════ */}
        {isMobile && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 1200 }}>
            <MobileBottomNav
              activeSheet={activeSheet}
              onOpen={(key) => {
                if (key === "draw") { if (drawMode) return; setActiveSheet(activeSheet === "draw" ? null : "draw"); return; }
                if (key === "measure") { if (activeSheet === "measure") { clearMeasure(); setActiveSheet(null); return; } setMeasureMode(true); setActiveSheet("measure"); return; }
                setActiveSheet(activeSheet === key ? null : key);
              }}
              onCompassToggle={() => compass.compassNavActive ? compass.stopCompassNav() : compass.startCompassNav()}
              compassNavActive={compass.compassNavActive}
              drawMode={drawMode} measureMode={measureMode} surveyMode={surveyMode} isTracking={isTracking}
              kmlName={kmlName} extraFile={extraFile} importedGeoJSONLayers={geoJSON.importedGeoJSONLayers}
            />
          </div>
        )}

        {/* ══ MOBILE BOTTOM SHEETS ═══════════════════════════════════════ */}
        <MobileBottomSheet activeSheet={activeSheet} onClose={() => setActiveSheet(null)}>

          {activeSheet === "draw" && !drawMode && (
            <div style={{ padding: "0 16px 28px" }}>
              <SheetHeader title="Draw Tool" sub="Choose type, then tap Start" onClose={() => setActiveSheet(null)} iconColor="#f59e0b"
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>} />
              <SheetDivider />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, margin: "14px 0" }}>
                {[["path","Path","M3 17c3-3 5-5 5-9a4 4 0 018 0c0 4 2 6 5 9"],["polygon","Polygon","M12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"],["marker","Marker","M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"]].map(([t,label,path]) => {
                  const on = drawType === t;
                  return (
                    <button key={t} onClick={() => setDrawType(t)} style={{ padding:"14px 8px", borderRadius:14, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:7, background:on?"rgba(245,158,11,0.14)":"rgba(255,255,255,0.035)", border:`1.5px solid ${on?"rgba(245,158,11,0.45)":"rgba(255,255,255,0.07)"}`, color:on?"#fbbf24":"rgba(180,210,250,0.35)" }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={path} /></svg>
                      <span style={{ fontSize:12, fontWeight:on?700:400 }}>{label}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => { setDrawMode(true); setDrawPoints([]); setActiveSheet(null); }}
                style={{ width:"100%", padding:"15px 0", borderRadius:14, cursor:"pointer", background:"linear-gradient(135deg,rgba(245,158,11,0.9),rgba(217,119,6,0.85))", border:"1px solid rgba(245,158,11,0.6)", color:"#fff", fontWeight:800, fontSize:15, display:"flex", alignItems:"center", justifyContent:"center", gap:10, fontFamily:"'DM Sans',sans-serif", boxShadow:"0 4px 20px rgba(245,158,11,0.3)" }}>
                Start Drawing — tap map
              </button>
              {savedDrawings.length > 0 && (
                <div style={{ marginTop:18 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.2)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Saved ({savedDrawings.length})</div>
                  {savedDrawings.map((d, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"rgba(255,255,255,0.028)", borderRadius:12, border:"1px solid rgba(255,255,255,0.055)", marginBottom:6 }}>
                      <div style={{ width:14, height:14, borderRadius:"50%", background:d.color||"#1a73e8", border:"2px solid rgba(255,255,255,0.3)", flexShrink:0 }} />
                      <span style={{ fontSize:16 }}>{d.type==="marker"?"📌":d.type==="polygon"?"⬡":"〰"}</span>
                      <span onClick={() => { setActiveSheet(null); setClickedDrawing(d); }} style={{ color:"rgba(200,225,255,0.7)", fontSize:13, flex:1, cursor:"pointer" }}>{d.name}</span>
                      <button onClick={() => setSavedDrawings(p => p.filter((_,j) => j!==i))} style={{ background:"none", border:"none", color:"rgba(239,68,68,0.5)", cursor:"pointer", fontSize:18, padding:0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {hasExportData && <div style={{ marginTop:16 }}><div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.2)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Export</div><ExportButtons /></div>}
            </div>
          )}

          {activeSheet === "measure" && (
            <div style={{ padding:"0 16px 28px" }}>
              <SheetHeader title="Measure" sub={measureMode?`${measurePoints.length} pts · tap map`:"Tap points to measure"} onClose={() => setActiveSheet(null)} iconColor="#10b981"
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 6H3a1 1 0 00-1 1v3a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zM7 10v4M12 10v6M17 10v4" /></svg>} />
              <SheetDivider />
              <div style={{ padding:"24px 20px", background:"rgba(16,185,129,0.07)", borderRadius:16, border:"1px solid rgba(16,185,129,0.18)", textAlign:"center", margin:"14px 0" }}>
                <div style={{ fontSize:9, fontWeight:800, color:"rgba(52,211,153,0.4)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:6, fontFamily:"'DM Mono',monospace" }}>TOTAL DISTANCE</div>
                <div style={{ fontSize:48, fontWeight:800, color:"#34d399", fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{measurePoints.length<2?"—":formatDist(totalDistance,measureUnit)}</div>
                <div style={{ fontSize:11, color:"rgba(52,211,153,0.32)", marginTop:6 }}>{measurePoints.length} points</div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:5, marginBottom:14 }}>
                {[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"],["yd","yd"],["nmi","nmi"],["cm","cm"]].map(([u,lb]) => (
                  <button key={u} onClick={() => setMeasureUnit(u)} style={{ padding:"9px 4px",borderRadius:10,cursor:"pointer",fontSize:12,fontWeight:600,background:measureUnit===u?"rgba(16,185,129,0.16)":"rgba(255,255,255,0.035)",border:`1px solid ${measureUnit===u?"rgba(16,185,129,0.38)":"rgba(255,255,255,0.07)"}`,color:measureUnit===u?"#34d399":"rgba(185,215,245,0.38)",fontFamily:"'DM Mono',monospace" }}>{lb}</button>
                ))}
              </div>
              {!measureMode
                ? <button onClick={() => { setMeasureMode(true); }} style={{ width:"100%",padding:"15px 0",borderRadius:14,cursor:"pointer",background:"linear-gradient(135deg,rgba(16,185,129,0.9),rgba(5,150,105,0.85))",border:"1px solid rgba(16,185,129,0.6)",color:"#fff",fontWeight:800,fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:"'DM Sans',sans-serif" }}>Start Measuring</button>
                : <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                  <button onClick={resetMeasurePoints} style={{ padding:"14px 0",borderRadius:12,cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(190,215,250,0.55)",fontWeight:700,fontSize:14,fontFamily:"'DM Sans',sans-serif" }}>↺ Reset</button>
                  <button onClick={() => { clearMeasure(); setActiveSheet(null); }} style={{ padding:"14px 0",borderRadius:12,cursor:"pointer",background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.4)",color:"#f87171",fontWeight:700,fontSize:14,fontFamily:"'DM Sans',sans-serif" }}>⏹ Stop</button>
                </div>
              }
            </div>
          )}

          {activeSheet === "layers" && (
            <div style={{ paddingBottom:28 }}>
              <SheetHeader title="Map Layers" sub="Choose basemap" onClose={() => setActiveSheet(null)} iconColor="#3b82f6"
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>} />
              <SheetDivider />
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, padding:"4px 16px" }}>
                {Object.entries(MAP_LAYERS).map(([name, layer]) => {
                  const on = activeLayer === name;
                  return (
                    <button key={name} onClick={() => { setActiveLayer(name); setActiveSheet(null); }} style={{ padding:"13px 12px",borderRadius:14,cursor:"pointer",background:on?"rgba(59,130,246,0.16)":"rgba(255,255,255,0.035)",border:`1.5px solid ${on?"rgba(59,130,246,0.5)":"rgba(255,255,255,0.07)"}`,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:7 }}>
                      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%" }}>
                        <Ico name={layer.icon} size={20} style={{ color:on?"#60a5fa":"rgba(180,210,250,0.35)" }} />
                        {on && <div style={{ width:7,height:7,borderRadius:"50%",background:"#3b82f6",boxShadow:"0 0 8px #3b82f6" }} />}
                      </div>
                      <div style={{ fontSize:12,fontWeight:on?700:400,color:on?"#bfdbfe":"rgba(190,215,250,0.5)",lineHeight:1.3 }}>{name}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeSheet === "files" && (
            <div style={{ padding:"0 16px 28px" }}>
              <SheetHeader title="File Folder" sub={`${importedCount} file${importedCount!==1?"s":""} imported`} onClose={() => setActiveSheet(null)} iconColor="#60a5fa"
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>} />
              <SheetDivider />
              <div style={{ padding:"4px 0" }}><FileFolderPanel onClose={() => setActiveSheet(null)} /></div>
            </div>
          )}

          {activeSheet === "elevation" && (
            <MobileElevationSheet
              elevMode={elevMode} elevProfileData={elevProfileData} elevLoading={elevLoading}
              elevSourceLabel={elevSourceLabel} customElevPts={customElevPts}
              route={route} measurePoints={measurePoints} drawPoints={drawPoints}
              onModeRequest={(mode) => { setElevMode(mode); handleElevModeRequest(mode); }}
              onClearCustom={() => { setCustomElevPts([]); setElevProfileData([]); setElevSourceLabel(""); }}
              onClose={() => setActiveSheet(null)}
            />
          )}

          {activeSheet === "more" && (
            <div style={{ paddingBottom:28 }}>
              <SheetHeader title="More Tools" sub="Advanced features" onClose={() => setActiveSheet(null)} iconColor="#8b5cf6"
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /></svg>} />
              <SheetDivider />
              {[
                { label: "File Folder",          sub:`${importedCount} file(s) · import & export`,           color:"#60a5fa", action:() => setActiveSheet("files") },
                ...(kmlAnalyzerData ? [{ label:"📐 Area Measurements", sub:`${kmlAnalyzerData.fileName} · polygons + merge`, color:"#fbbf24", active:true, action:() => { setActiveSheet(null); setKmlAnalyzerOpen(true); } }] : []),
                ...(kmlName ? [{ label:"🏔 DEM / Contour / Shapefile", sub:`${kmlName} · Global Mapper style`, color:"#fb7185", active:kmlProcessingOpen, action:() => { setActiveSheet(null); setKmlProcessingOpen(true); } }] : []),
                { label:"DEM Elevation Layer",  sub:demFileName ? `${demFileName} · ${demRasterData?"draping active":"loading…"}` : "Import .tif / .asc / .dem", color:"#fb7185", active:!!demFileName, action:() => setActiveSheet("files") },
                { label:"Elevation Profile",    sub:"Terrain elevation chart",   color:"#38bdf8", action:() => { handleElevModeRequest(elevMode||"survey"); setActiveSheet("elevation"); } },
                { label:"Compass Navigation",   sub:compass.compassNavActive ? `Active · ${Math.round(((compass.compassHeading??0)%360+360)%360)}°` : "Map stays north-up", color:"#0ea5e9", active:compass.compassNavActive, action:() => { setActiveSheet(null); compass.compassNavActive ? compass.stopCompassNav() : compass.startCompassNav(); } },
                { label:"Survey Route",         sub:surveyMode ? `${route.length} pts · recording` : "Tap points for route", color:"#3b82f6", active:surveyMode, action:() => { handleToggleSurvey(); setActiveSheet(null); } },
                { label:"3D Globe View",        sub:"Interactive 3D earth", color:"#a78bfa", action:() => { setShow3D(true); setActiveSheet(null); } },
                { label:"Live Track Recorder",  sub:isTracking ? "Recording GPS track" : "GPS · GPX/KML export", color:"#ef4444", active:isTracking, action:() => { if(!requireAuth("openTracker")) return; setTrackerOpen(true); setActiveSheet(null); } },
                { label:offlineMode ? "🗺 Go Live (Online)" : "📴 Use Cached Map", sub:offlineMode ? "Switch to live tiles" : `${cacheStats?.tileCount??0} tiles cached`, color:offlineMode?"#4ade80":"#10b981", active:offlineMode, action:() => { setOfflineMode(p => !p); setActiveSheet(null); } },
                { label:"Offline Map Manager",  sub:"Download tiles for offline", color:"#14b8a6", action:() => { setOfflineOpen(true); setActiveSheet(null); } },
                { label:"Night Mode Auto",      sub:nightModeAuto ? "Active — switches at sunset" : "Off", color:"#818cf8", active:nightModeAuto, action:() => { setNightModeAuto(p => !p); setActiveSheet(null); } },
                { label:"🖨 Print / Save Image", sub:"Export map as PNG or print", color:"#80c4ff", action:() => { setActiveSheet(null); setPrintOpen(true); } },
            { label:"📱 Download Android App", sub:"Download & install Geoxis APK", color:"#4ade80",
  action:() => { window.open("/Geoxis.apk", "_blank"); }
},
                { label:"🧭 Get Directions",     sub:"Point-to-point routing", color:"#80c4ff", action:() => { setActiveSheet(null); setDirectionsOpen(true); } },
             ...(isLoggedIn() ? [
  {
    label: "Logout",
    sub: `Signed in as ${getLoggedInUser().username || "user"}`,
    color: "#f87171",
    action: () => { localStorage.clear(); setActiveSheet(null); navigate("/login"); }
  },
] : [
  {
    label: "Sign In",
    sub: "Login to use Live Track",
    color: "#4a9eff",
    action: () => { navigate("/login"); setActiveSheet(null); }
  },
]),
     ].map(({ label, sub, color, active, action }) => (
                <button key={label} onClick={action} style={{ width:"100%",display:"flex",alignItems:"center",gap:14,padding:"13px 20px",background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.035)",cursor:"pointer",textAlign:"left" }}>
                  <div style={{ width:44,height:44,borderRadius:14,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:active?`${color}18`:"rgba(255,255,255,0.04)",border:`1px solid ${active?color+"35":"rgba(255,255,255,0.07)"}` }}>
                    <div style={{ width:8,height:8,borderRadius:"50%",background:active?color:"rgba(255,255,255,0.2)" }} />
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:14,fontWeight:active?700:500,color:active?"#e2eeff":"rgba(190,215,250,0.65)" }}>{label}</div>
                    <div style={{ fontSize:11,color:"rgba(255,255,255,0.2)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{sub}</div>
                  </div>
                  {active && <div style={{ width:8,height:8,borderRadius:"50%",background:color,boxShadow:`0 0 10px ${color}`,flexShrink:0 }} />}
                </button>
              ))}
            </div>
          )}
        </MobileBottomSheet>

        {/* ══ DESKTOP SIDEBAR ════════════════════════════════════════════ */}
        <div className="sm-sidebar" style={{ position:"absolute",top:TOP_H,left:0,width:SB_W,bottom:STAT_H,zIndex:1100,background:"rgba(4,10,22,0.99)",borderRight:"1px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",overflowY:"auto",overflowX:"hidden" }}>

          <SectionHeader icon="Search" title="Search Location" collapsed={!searchOpen} onToggle={() => setSearchOpen(p => !p)} />
          {searchOpen && (
            <div style={{ padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)",flexShrink:0 }}>
              <form onSubmit={handleSidebarSearch} style={{ display:"flex",gap:6,marginBottom:8 }}>
                <div style={{ flex:1,position:"relative" }}>
                  <span style={{ position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,0.3)",pointerEvents:"none",display:"flex" }}><Ico name="Search" size={13} /></span>
                  <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search anywhere in the world…"
                    style={{ width:"100%",padding:"8px 10px 8px 30px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.055)",color:"#c8dff0",fontSize:11.5,outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box" }}
                    onFocus={e => e.target.style.borderColor="rgba(74,158,255,0.4)"}
                    onBlur={e => e.target.style.borderColor="rgba(255,255,255,0.1)"} />
                </div>
                <button type="submit" disabled={searchLoading} style={{ padding:"8px 12px",borderRadius:8,border:"1px solid rgba(74,158,255,0.4)",background:"rgba(74,158,255,0.18)",color:"#80c4ff",cursor:searchLoading?"not-allowed":"pointer",fontSize:13,fontWeight:700,flexShrink:0 }}>
                  {searchLoading ? <span style={{ animation:"blink 0.8s infinite" }}>…</span> : "↵"}
                </button>
              </form>
              <div style={{ fontSize:9.5,color:"rgba(255,255,255,0.18)",marginBottom:6,fontStyle:"italic" }}>Try: "Eiffel Tower", "20.29, 85.82", "Konark Temple Odisha"</div>
              {locationInfo && (
                <div style={{ padding:"9px 11px",background:"rgba(74,158,255,0.09)",borderRadius:8,border:"1px solid rgba(74,158,255,0.22)",position:"relative" }}>
                  <div style={{ color:"#90c8ff",fontSize:11.5,fontWeight:600,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:18 }}>{locationInfo.loading ? "Searching…" : (locationInfo.name || "Unknown")}</div>
                  {locationInfo.details && <div style={{ color:"rgba(255,255,255,0.32)",fontSize:10 }}>{locationInfo.details}</div>}
                  <button onClick={handleCloseLocationInfo} style={{ position:"absolute",top:7,right:7,background:"none",border:"none",color:"rgba(255,255,255,0.32)",cursor:"pointer",display:"flex",padding:2 }}><Ico name="Close" size={10} /></button>
                </div>
              )}
            </div>
          )}

          <SectionHeader icon="Layers" title="Map Layers" collapsed={!layersOpen} onToggle={() => setLayersOpen(p => !p)} />
          {layersOpen && (
            <div style={{ flexShrink:0 }}>
              <div style={{ padding:"5px 0",maxHeight:200,overflowY:"auto" }}>
                <LayerItem iconName={nightSwitchInfo?.isNight?"Night":"Day"} label="Auto Night Mode" checked={nightModeAuto} onCheck={() => setNightModeAuto(p => !p)} onClick={() => setNightModeAuto(p => !p)} badge={nightModeAuto&&nightSwitchInfo?(nightSwitchInfo.isNight?"Night":"Day"):null} />
                <div style={{ height:1,background:"rgba(255,255,255,0.05)",margin:"4px 12px" }} />
                {Object.entries(MAP_LAYERS).map(([name,layer]) => (
                  <LayerItem key={name} iconName={layer.icon} label={name} checked={activeLayer===name} onCheck={() => setActiveLayer(name)} onClick={() => setActiveLayer(name)} active={activeLayer===name} indent={1} />
                ))}
              </div>
            </div>
          )}

          <SectionHeader icon="Star" title="My Places" collapsed={!placesOpen} onToggle={() => setPlacesOpen(p => !p)} />
          {placesOpen && (
            <div style={{ flexShrink:0 }}>
              <div style={{ padding:"6px 0",maxHeight:130,overflowY:"auto" }}>
                {savedDrawings.map((d, i) => (
                  <div key={i} style={{ display:"flex",alignItems:"center" }}>
                    <div style={{ width:8,height:8,borderRadius:"50%",background:d.color||"#1a73e8",marginLeft:12,flexShrink:0 }} />
                    <div style={{ flex:1,overflow:"hidden",cursor:"pointer" }} onClick={() => setClickedDrawing(d)}>
                      <LayerItem iconName={d.type==="path"?"Path":d.type==="polygon"?"Polygon":"Pin"} label={d.name} indent={0} />
                    </div>
                    <span onClick={() => setSavedDrawings(p => p.filter((_,j) => j!==i))} style={{ color:"rgba(255,255,255,0.22)",cursor:"pointer",padding:"0 10px",display:"flex",flexShrink:0 }} onMouseEnter={e => e.currentTarget.style.color="#f87171"} onMouseLeave={e => e.currentTarget.style.color="rgba(255,255,255,0.22)"}><Ico name="Close" size={10} /></span>
                  </div>
                ))}
                {savedDrawings.length === 0 && <div style={{ paddingLeft:24,color:"rgba(255,255,255,0.18)",fontSize:10.5,fontStyle:"italic",paddingTop:4 }}>No saved drawings yet</div>}
                {surveyMode && route.length > 0 && <LayerItem iconName="Survey" label={`Survey Route · ${route.length} pts`} active badge="LIVE" indent={1} />}
                {isTracking && <LayerItem iconName="Record" label="Live Track Recording…" active badge="REC" indent={1} />}
                {kmlAnalyzerData && (
                  <div onClick={() => setKmlAnalyzerOpen(true)} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 12px 6px 24px",cursor:"pointer",borderRadius:7,margin:"4px 8px" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(251,191,36,0.09)"}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    <span style={{ fontSize:13 }}>📐</span>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ color:"#fbbf24",fontSize:10.5,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{kmlAnalyzerData.fileName}</div>
                      <div style={{ color:"rgba(251,191,36,0.4)",fontSize:9,fontFamily:"'DM Mono',monospace" }}>Click to view area measurements</div>
                    </div>
                  </div>
                )}
                {kmlName && (
                  <div onClick={() => setKmlProcessingOpen(true)} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 12px 6px 24px",cursor:"pointer",borderRadius:7,margin:"4px 8px" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(251,113,133,0.09)"}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    <span style={{ fontSize:13 }}>🏔</span>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ color:"#fb7185",fontSize:10.5,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{kmlName}</div>
                      <div style={{ color:"rgba(251,113,133,0.4)",fontSize:9,fontFamily:"'DM Mono',monospace" }}>Click for DEM / Contour / Shapefile</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <SectionHeader icon="GeoJSON" title="GeoJSON Layers" collapsed={!geojsonOpen} onToggle={() => setGeojsonOpen(p => !p)} />
          {geojsonOpen && (
            <div style={{ flexShrink:0,borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ padding:"8px 12px 6px" }}>
                <div style={{ display:"flex",gap:5,marginBottom:8 }}>
                  <label style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"7px 10px",borderRadius:8,cursor:"pointer",background:"rgba(20,184,166,0.12)",border:"1px solid rgba(20,184,166,0.3)",color:"#2dd4bf",fontSize:11.5,fontWeight:600 }}>
                    <Ico name="Upload" size={12} />Import<input type="file" accept=".geojson,.json" onChange={handleGeoJSONFileUpload} style={{ display:"none" }} />
                  </label>
                  <button onClick={() => exportGeoJSON(savedDrawings, route, measurePoints)} style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"7px 10px",borderRadius:8,cursor:"pointer",background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",color:"#4ade80",fontSize:11.5,fontWeight:600 }}>
                    <Ico name="Export" size={12} />Export
                  </button>
                </div>
                <div style={{ maxHeight:110,overflowY:"auto" }}>
                  {geoJSON.importedGeoJSONLayers.length === 0 && <div style={{ color:"rgba(255,255,255,0.18)",fontSize:10.5,fontStyle:"italic",paddingLeft:4,paddingTop:2 }}>No GeoJSON layers loaded</div>}
                  {geoJSON.importedGeoJSONLayers.map(layer => (
                    <div key={layer.id} style={{ display:"flex",alignItems:"center",gap:7,padding:"5px 4px 5px 6px",borderRadius:6,marginBottom:3,background:"rgba(20,184,166,0.07)",border:"1px solid rgba(20,184,166,0.15)" }}>
                      <Ico name="GeoJSON" size={12} style={{ color:"#2dd4bf",flexShrink:0 }} />
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ color:"#d0f0ec",fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{layer.name}</div>
                        <div style={{ color:"rgba(45,212,191,0.5)",fontSize:9.5,fontFamily:"'DM Mono',monospace" }}>{layer.featureCount} features · dbl-click map</div>
                      </div>
                      <button onClick={() => geoJSON.removeGeoJSONLayer(layer.id)} style={{ background:"none",border:"none",color:"rgba(239,68,68,0.38)",cursor:"pointer",padding:3,display:"flex",flexShrink:0 }} onMouseEnter={e => e.currentTarget.style.color="#f87171"} onMouseLeave={e => e.currentTarget.style.color="rgba(239,68,68,0.38)"}><Ico name="Trash" size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <SectionHeader icon="Eye" title="Tools" collapsed={!toolsOpen} onToggle={() => setToolsOpen(p => !p)} />
          {toolsOpen && (
            <div style={{ flex:1,overflowY:"auto" }}>
              <div style={{ padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace" }}>Draw Tool</div>
                <div style={{ display:"flex",gap:4,marginBottom:8 }}>
                  {[["path","Path","Path"],["polygon","Polygon","Poly"],["marker","Pin","Pin"]].map(([t,ico,lb]) => (
                    <button key={t} onClick={() => setDrawType(t)} style={{ flex:1,padding:"7px 4px",borderRadius:7,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:drawType===t?"rgba(74,158,255,0.16)":"rgba(255,255,255,0.035)",border:`1px solid ${drawType===t?"rgba(74,158,255,0.5)":"rgba(255,255,255,0.07)"}`,color:drawType===t?"#80c4ff":"rgba(255,255,255,0.45)",fontSize:10,fontWeight:600 }}>
                      <Ico name={ico} size={15} /><span>{lb}</span>
                    </button>
                  ))}
                </div>
                {!drawMode
                  ? <PrimaryButton onClick={() => { setDrawMode(true); setDrawPoints([]); }} variant="amber"><Ico name="Play" size={13} />Start Drawing</PrimaryButton>
                  : <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                    <div style={{ padding:"6px 10px",background:"rgba(251,191,36,0.09)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:7,color:"#fbbf24",fontSize:11,textAlign:"center" }}>{drawType==="marker"?"Click map to place marker":`${drawPoints.length} pts — click to add`}</div>
                    <div style={{ display:"flex",gap:5 }}>
                      <PrimaryButton onClick={finishDrawing} variant="green" style={{ flex:1 }}><Ico name="Check" size={12} />Done</PrimaryButton>
                      <PrimaryButton onClick={cancelDrawing} variant="red"   style={{ flex:1 }}><Ico name="Close" size={12} />Cancel</PrimaryButton>
                    </div>
                  </div>
                }
              </div>

              <div style={{ padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace" }}>Measure Tool</div>
                {!measureMode
                  ? <PrimaryButton onClick={() => { setMeasureMode(true); }} variant="blue"><Ico name="Measure" size={13} />Start Measuring</PrimaryButton>
                  : <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                      <div style={{ padding:"10px 12px",background:"rgba(251,191,36,0.07)",border:"1px solid rgba(251,191,36,0.22)",borderRadius:8,textAlign:"center" }}>
                        <div style={{ color:"rgba(251,191,36,0.48)",fontSize:9,fontWeight:700,letterSpacing:"0.1em",marginBottom:2,fontFamily:"'DM Mono',monospace" }}>DISTANCE</div>
                        <div style={{ color:"#fbbf24",fontSize:22,fontWeight:700,fontFamily:"'DM Mono',monospace",lineHeight:1 }}>{measurePoints.length<2?"—":formatDist(totalDistance,measureUnit)}</div>
                        <div style={{ color:"rgba(251,191,36,0.36)",fontSize:9.5,marginTop:2 }}>{measurePoints.length} pts</div>
                      </div>
                      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3 }}>
                        {[["auto","Auto"],["km","km"],["m","m"],["mi","mi"],["ft","ft"],["yd","yd"],["nmi","nmi"],["cm","cm"]].map(([u,lb]) => (
                          <button key={u} onClick={() => setMeasureUnit(u)} style={{ padding:"5px 2px",borderRadius:5,cursor:"pointer",fontSize:9.5,fontWeight:600,background:measureUnit===u?"rgba(74,158,255,0.18)":"rgba(255,255,255,0.035)",border:`1px solid ${measureUnit===u?"rgba(74,158,255,0.42)":"rgba(255,255,255,0.07)"}`,color:measureUnit===u?"#80c4ff":"rgba(255,255,255,0.42)",fontFamily:"'DM Mono',monospace" }}>{lb}</button>
                        ))}
                      </div>
                      <div style={{ display:"flex",gap:4 }}>
                        <button onClick={resetMeasurePoints} style={{ flex:1,padding:"6px",borderRadius:7,border:"1px solid rgba(255,255,255,0.07)",background:"rgba(255,255,255,0.035)",color:"rgba(255,255,255,0.38)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4 }}><Ico name="Reset" size={11} />Reset</button>
                        <PrimaryButton onClick={clearMeasure} variant="red" style={{ flex:1,padding:"6px" }}><Ico name="Stop" size={11} />Done</PrimaryButton>
                      </div>
                    </div>
                }
              </div>

              <div style={{ padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:10,textTransform:"uppercase",fontFamily:"'DM Mono',monospace" }}>File Folder</div>
                <FileFolderPanel compact />
              </div>

              <div style={{ padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace" }}>Compass Navigation</div>
                <PrimaryButton onClick={() => compass.compassNavActive ? compass.stopCompassNav() : compass.startCompassNav()} variant={compass.compassNavActive?"red":"cyan"}>
                  <Ico name="Navigation" size={13} style={{ animation:compass.compassNavActive?"spin 3s linear infinite":"none" }} />{compass.compassNavActive?"Stop Compass Nav":"Start Compass Nav"}
                </PrimaryButton>
              </div>

              <div style={{ padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace" }}>Survey Route</div>
                <PrimaryButton onClick={handleToggleSurvey} variant={surveyMode?"red":"blue"}><Ico name={surveyMode?"Stop":"Record"} size={13} />{surveyMode?"Stop Survey":"Start Survey"}</PrimaryButton>
                {surveyMode && <div style={{ marginTop:6,padding:"6px 10px",background:"rgba(248,113,133,0.09)",border:"1px solid rgba(248,113,133,0.22)",borderRadius:7,color:"#f87171",fontSize:11,textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><span style={{ animation:"blink 1s infinite" }}>●</span>RECORDING · {route.length} pts</div>}
              </div>

              <div style={{ padding:"12px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color:"rgba(255,255,255,0.28)",fontSize:9.5,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase",fontFamily:"'DM Mono',monospace" }}>More Tools</div>
                <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                  <PrimaryButton onClick={() => setTrackerOpen(true)} variant="rose"><Ico name="Record" size={13} />{isTracking?"Open Recorder":"Live Track Recorder"}</PrimaryButton>
                  <PrimaryButton onClick={() => { setElevOpen(true); handleElevModeRequest(elevMode||"survey"); }} variant="blue"><Ico name="Mountain" size={13} />Elevation Profile</PrimaryButton>
                  <PrimaryButton onClick={() => setOfflineOpen(true)} variant="blue"><Ico name="Offline" size={13} />Manage Offline Maps</PrimaryButton>
                  <PrimaryButton onClick={() => setOfflineMode(p => !p)} variant={offlineMode?"green":"blue"}><span style={{ fontSize:13 }}>{offlineMode?"🗺":"🌐"}</span>{offlineMode?"Go Live":"Use Cached Map"}</PrimaryButton>
                  {kmlName && (
                    <PrimaryButton onClick={() => setKmlProcessingOpen(true)} variant="rose">
                      <span style={{ fontSize:13 }}>🏔</span>KML → DEM / Contour / SHP
                    </PrimaryButton>
                  )}
                  {/* ── Directions button in sidebar tools ── */}
                  <PrimaryButton onClick={() => setDirectionsOpen(true)} variant="blue">
                    <span style={{ fontSize: 13 }}>🧭</span>Get Directions
                  </PrimaryButton>
                  {/* ── Print button in sidebar tools ── */}
                  <PrimaryButton onClick={() => setPrintOpen(true)} variant="blue">
                    <span style={{ fontSize:13 }}>🖨</span>Print / Save Image
                  </PrimaryButton>
                </div>
              </div>

              <div style={{ padding:"14px 12px 16px" }}>
                <button onClick={() => setShow3D(true)} style={{ width:"100%",padding:"11px 14px",borderRadius:10,cursor:"pointer",background:"linear-gradient(135deg,rgba(167,139,250,0.18),rgba(109,40,217,0.18))",border:"1px solid rgba(167,139,250,0.32)",color:"#c4b5fd",fontWeight:600,fontSize:12.5,fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                  <Ico name="Globe" size={18} /> Switch to 3D Globe
                </button>
              </div>
            </div>
          )}
        </div>

  {/* ══ FLOATING OVERLAYS ══════════════════════════════════════════ */}
<LiveTrackRecorder
  map={mapRefForTracker}
  visible={trackerOpen}
  onClose={() => setTrackerOpen(false)}
  onRecordingChange={setIsTracking}
  syncTrack={syncTrack}
  sessionClientId={activeSessionClientId}
/>

{/* ── Offline Sync Queue Manager ── */}
<SyncQueueManager
  syncTrack={syncTrack}
  sessionClientId={activeSessionClientId}
/>
        {!isMobile && <ElevationProfile visible={elevOpen} onClose={() => setElevOpen(false)} profileData={elevProfileData} loading={elevLoading} isOnline={isOnline} sourceLabel={elevSourceLabel} leafletMap={mapRefForTracker} activeMode={elevMode} onRequestPoints={handleElevModeRequest} />}
        <OfflineMapManager visible={offlineOpen} onClose={() => setOfflineOpen(false)} leafletMap={mapRefForTracker} activeLayer={activeLayer} isOnline={isOnline} swReady={swReady} swError={swError} cacheStats={cacheStats} precaching={precaching} precacheProgress={precacheProgress} precacheCurrentView={precacheCurrentView} precacheRegion={precacheRegion} clearTileCache={clearTileCache} fetchCacheStats={fetchCacheStats} stopPrecache={stopPrecache} />
        <OfflineStatusBadge isOnline={isOnline} swReady={swReady} swError={swError} precaching={precaching} precacheProgress={precacheProgress} cacheStats={cacheStats} onClick={() => { setOfflineOpen(true); if (isMobile) setActiveSheet(null); }} />

        {offlineMode && (
          <div style={{ position:"absolute",top:isMobile?160:TOP_H+10,left:isMobile?"50%":SB_W+20,transform:"translateX(-50%)",zIndex:1060,display:"flex",alignItems:"center",gap:10,padding:"9px 18px",background:"rgba(4,10,20,0.97)",backdropFilter:"blur(16px)",border:`1.5px solid ${isOnline?"rgba(34,197,94,0.5)":"rgba(239,68,68,0.5)"}`,borderRadius:28,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap" }}>
            <span style={{ fontSize:18 }}>🗺</span>
            <div><div style={{ color:isOnline?"#4ade80":"#f87171",fontWeight:700,fontSize:12 }}>{isOnline?"Cached Map Active":"📴 Offline — Cached Only"}</div><div style={{ color:"#475569",fontSize:10,marginTop:1 }}>{cacheStats?.tileCount?`${cacheStats.tileCount.toLocaleString()} tiles cached`:"No tiles cached yet"}</div></div>
            {isOnline&&<button onClick={() => setOfflineMode(false)} style={{ marginLeft:6,padding:"5px 14px",borderRadius:14,border:"1px solid rgba(34,197,94,0.42)",background:"rgba(34,197,94,0.12)",color:"#4ade80",fontSize:11,fontWeight:700,cursor:"pointer" }}>Go Live ↗</button>}
          </div>
        )}

        {locationInfo && !isMobile && (
          <div style={{ position:"absolute",top:"calc(var(--top-h) + 14px)",right:60,width:310,zIndex:1050,borderRadius:14,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.7)",border:"1px solid rgba(255,255,255,0.09)",animation:"fadeSlideIn 0.22s ease",background:"rgba(5,12,24,0.97)",backdropFilter:"blur(24px)",fontFamily:"'DM Sans',sans-serif" }}>
            {locationInfo.photo&&(<div style={{ position:"relative",height:130,overflow:"hidden" }}><img src={locationInfo.photo} alt={locationInfo.name} style={{ width:"100%",height:"100%",objectFit:"cover" }}/><div style={{ position:"absolute",inset:0,background:"linear-gradient(to top,rgba(5,12,24,1) 0%,transparent 55%)" }}/><div style={{ position:"absolute",bottom:12,left:14,color:"#fff",fontWeight:700,fontSize:15 }}>{locationInfo.name}</div><button onClick={handleCloseLocationInfo} style={{ position:"absolute",top:10,right:10,background:"rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.7)",borderRadius:6,width:26,height:26,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Ico name="Close" size={10}/></button></div>)}
            <div style={{ padding:locationInfo.photo?"12px 16px 14px":"14px 16px" }}>
              {!locationInfo.photo&&(<div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,borderBottom:"1px solid rgba(255,255,255,0.06)",paddingBottom:10 }}><div><div style={{ color:"#d0e8f8",fontWeight:700,fontSize:14.5 }}>{locationInfo.loading?"Searching…":(locationInfo.name||locationInfo.label?.split(",")?.[0])}</div>{locationInfo.details&&!locationInfo.loading&&<div style={{ color:"rgba(255,255,255,0.32)",fontSize:11,marginTop:2 }}>{locationInfo.details}</div>}</div><button onClick={handleCloseLocationInfo} style={{ background:"none",border:"none",color:"rgba(255,255,255,0.28)",cursor:"pointer",padding:2,display:"flex" }}><Ico name="Close" size={14}/></button></div>)}
              <div style={{ display:"flex",alignItems:"center",gap:9,padding:"8px 11px",background:"rgba(74,158,255,0.07)",borderRadius:8,marginBottom:10,border:"1px solid rgba(74,158,255,0.14)" }}><Ico name="Pin" size={14} style={{ color:"#4a9eff" }}/><div style={{ color:"#c0daf0",fontSize:11,fontFamily:"'DM Mono',monospace" }}>{locationInfo.lat?.toFixed(6)}°, {locationInfo.lng?.toFixed(6)}°</div></div>
              {locationInfo.loading?<div style={{ color:"rgba(255,255,255,0.28)",fontSize:11,fontStyle:"italic" }}>⏳ Loading info…</div>:locationInfo.description?<div style={{ color:"rgba(200,225,255,0.65)",fontSize:11.5,lineHeight:1.65,maxHeight:100,overflowY:"auto" }}>{locationInfo.description.slice(0,350)}{locationInfo.description.length>350?"…":""}</div>:null}
              <div style={{ display:"flex",gap:6,marginTop:10 }}>
                {locationInfo.wikiUrl&&<a href={locationInfo.wikiUrl} target="_blank" rel="noreferrer" style={{ flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,padding:"7px 10px",background:"rgba(74,158,255,0.09)",borderRadius:7,color:"#60a8e8",fontSize:11,textDecoration:"none",fontWeight:600,border:"1px solid rgba(74,158,255,0.22)" }}><Ico name="Wikipedia" size={12}/> Wikipedia ↗</a>}
                <button onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${locationInfo.lat},${locationInfo.lng}`,"_blank")} style={{ flex:1,padding:"7px 10px",background:"rgba(52,211,153,0.09)",borderRadius:7,border:"1px solid rgba(52,211,153,0.22)",color:"#34d399",fontSize:11,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Ico name="Maps" size={12}/> Google Maps ↗</button>
              </div>
            </div>
          </div>
        )}

        {/* Name Modal */}
        {showNameModal && (
          <div style={{ position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(10px)" }}>
            <div style={{ background:"rgba(7,18,32,0.98)",borderRadius:16,padding:26,width:"100%",maxWidth:300,boxShadow:"0 20px 60px rgba(0,0,0,0.8)",border:"1px solid rgba(74,158,255,0.18)",fontFamily:"'DM Sans',sans-serif" }}>
              <div style={{ color:"#c8e0f8",fontWeight:700,fontSize:16,marginBottom:3 }}>Name this {pendingType}</div>
              <div style={{ color:"rgba(255,255,255,0.28)",fontSize:11,marginBottom:14 }}>{pendingPoints.length} point{pendingPoints.length!==1?"s":""} recorded</div>
              <input autoFocus value={pendingName} onChange={e => setPendingName(e.target.value)} onKeyDown={e => e.key==="Enter"&&confirmDrawing()} placeholder={pendingType==="path"?"e.g. Survey Path A":"e.g. Survey Area A"} style={{ width:"100%",padding:"10px 13px",borderRadius:8,border:"1px solid rgba(74,158,255,0.28)",background:"rgba(74,158,255,0.06)",color:"#c8e0f8",fontSize:13,marginBottom:15,outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box" }}/>
              <div style={{ display:"flex",gap:8 }}>
                <PrimaryButton onClick={confirmDrawing} variant="blue"><Ico name="Check" size={13}/>Save</PrimaryButton>
                <PrimaryButton onClick={cancelDrawing} variant="red" style={{ background:"transparent" }}><Ico name="Close" size={13}/>Cancel</PrimaryButton>
              </div>
            </div>
          </div>
        )}

        {/* About Modal */}
        {showAbout && <AboutGeoxis onClose={() => setShowAbout(false)} />}
          
        {/* Shortcuts Modal */}
        {showShortcuts && (
          <div style={{ position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",backdropFilter:"blur(12px)" }}>
            <div style={{ background:"rgba(5,12,24,0.98)",borderRadius:16,padding:26,width:"100%",maxWidth:340,boxShadow:"0 24px 72px rgba(0,0,0,0.85)",border:"1px solid rgba(74,158,255,0.18)",fontFamily:"'DM Sans',sans-serif" }}>
              <div style={{ display:"flex",alignItems:"center",gap:9,marginBottom:18 }}><Ico name="Keyboard" size={18} style={{ color:"#4a9eff" }}/><span style={{ color:"#c8e0f8",fontWeight:700,fontSize:16 }}>Keyboard Shortcuts</span></div>
              {[
                ["+ / =","Zoom in"],["−","Zoom out"],
                ["P","Add Placemark"],["L","Draw Path"],["G","Draw Polygon"],
                ["R","Ruler"],["S","Select tool"],["H","Pan tool"],
                ["Double-click feature","Open Properties"],
                ["Right-click feature","Context menu"],
                ["Enter","Save (name modal)"],["Escape","Cancel / close"],
              ].map(([k,d]) => (
                <div key={k} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                  <code style={{ color:"#80c4ff",fontWeight:600,fontSize:11,fontFamily:"'DM Mono',monospace",background:"rgba(74,158,255,0.1)",padding:"3px 8px",borderRadius:5,border:"1px solid rgba(74,158,255,0.18)" }}>{k}</code>
                  <span style={{ color:"rgba(200,225,255,0.45)",fontSize:11.5 }}>{d}</span>
                </div>
              ))}
              <PrimaryButton onClick={() => setShowShortcuts(false)} variant="blue" style={{ marginTop:18 }}><Ico name="Check" size={13}/>Close</PrimaryButton>
            </div>
          </div>
        )}

        {/* ══ STATUS BAR ═════════════════════════════════════════════════ */}
        <div style={{ position:"absolute",bottom:0,left:0,right:0,height:STAT_H,zIndex:1100,background:"rgba(4,10,20,0.94)",backdropFilter:"blur(12px)",borderTop:"1px solid rgba(255,255,255,0.055)",display:"flex",alignItems:"center",padding:"0 14px",gap:10,userSelect:"none" }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0,overflow:"hidden" }}>
            <Ico name="Pin" size={11} style={{ color:"rgba(74,158,255,0.55)",flexShrink:0 }}/>
            {mousePos
              ? <span style={{ color:"#c0d8f0",fontSize:10,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                {coordFmt==="dms"&&`${toDMS(mousePos.lat,"N","S")}  ${toDMS(mousePos.lng,"E","W")}`}
                {coordFmt==="dec"&&`${mousePos.lat.toFixed(6)}°,  ${mousePos.lng.toFixed(6)}°`}
                {coordFmt==="utm"&&<><span style={{ color:"rgba(255,255,255,0.35)",fontSize:9,marginRight:4,fontWeight:600 }}>UTM</span>{toUTM(mousePos.lat,mousePos.lng)}</>}
              </span>
              : <span style={{ color:"rgba(255,255,255,0.18)",fontSize:10,fontFamily:"'DM Mono',monospace" }}>—°——′——.——″</span>}
            <button onClick={() => setCoordFmt(f=>f==="dms"?"dec":f==="dec"?"utm":"dms")} style={{ display:"flex",alignItems:"center",gap:2,padding:"2px 7px",borderRadius:6,cursor:"pointer",background:"rgba(74,158,255,0.09)",border:"1px solid rgba(74,158,255,0.25)",color:"rgba(130,185,255,0.8)",fontSize:9.5,fontWeight:600,flexShrink:0 }}>
              {coordFmt==="dms"?"LatLng":coordFmt==="dec"?"UTM":"DMS"} <span style={{ fontSize:10,marginLeft:1 }}>↺</span>
            </button>
          </div>
          <div style={{ flex:1 }}/>
          <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
            <span style={{ color:"rgba(255,255,255,0.38)",fontSize:10,fontFamily:"'DM Mono',monospace" }}>Z{mapZoom}</span>
            {activeTool!=="select"&&<span style={{ color:"#1a73e8",fontSize:10,background:"rgba(26,115,232,0.1)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(26,115,232,0.22)",display:"flex",alignItems:"center",gap:3 }}>🛠 {activeTool}</span>}
            {cursorElevation!=null&&<span onClick={() => setElevOpen(true)} style={{ color:"#38bdf8",fontSize:10,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(56,189,248,0.07)",padding:"2px 8px",borderRadius:10,border:"1px solid rgba(56,189,248,0.18)",display:"flex",alignItems:"center",gap:3 }}><Ico name="Mountain" size={10}/>{Math.round(cursorElevation)} m</span>}
            {demFileName&&demStats&&<span style={{ color:"#fb7185",fontSize:10,background:"rgba(251,113,133,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(251,113,133,0.22)",display:"flex",alignItems:"center",gap:3 }}>🏔 {Math.round(demStats.min)}–{Math.round(demStats.max)} m{demRasterData?" · draped":""}{kmlMask?" · clipped":""}</span>}
            {kmlAnalyzerData&&<span onClick={() => setKmlAnalyzerOpen(true)} style={{ color:"#fbbf24",fontSize:10,cursor:"pointer",background:"rgba(251,191,36,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(251,191,36,0.22)",display:"flex",alignItems:"center",gap:3 }}>📐 {kmlAnalyzerData.fileName?.slice(0,14)}</span>}
            {geoJSON.importedGeoJSONLayers.length>0&&<span style={{ color:"#2dd4bf",fontSize:10,background:"rgba(20,184,166,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(20,184,16,0.22)",display:"flex",alignItems:"center",gap:3 }}><Ico name="GeoJSON" size={10}/>{geoJSON.importedGeoJSONLayers.length} GeoJSON</span>}
            {importedCount>0&&<span style={{ color:"#60a5fa",fontSize:10,background:"rgba(74,158,255,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(74,158,255,0.22)",display:"flex",alignItems:"center",gap:3 }}>📁 {importedCount} file{importedCount!==1?"s":""}</span>}
            {savedDrawings.length>0&&<span style={{ color:"#f59e0b",fontSize:10,background:"rgba(245,158,11,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(245,158,11,0.22)",display:"flex",alignItems:"center",gap:3 }}>✏ {savedDrawings.length} drawing{savedDrawings.length!==1?"s":""}</span>}
            {compass.compassNavActive&&<span onClick={compass.stopCompassNav} style={{ color:"#38bdf8",fontSize:10,cursor:"pointer",background:"rgba(14,165,233,0.1)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(14,165,233,0.25)",display:"flex",alignItems:"center",gap:3 }}><span style={{ animation:"spin 2s linear infinite",display:"inline-block",width:8,height:8 }}>◈</span>{Math.round(((compass.compassHeading??0)%360+360)%360)}°</span>}
            {isTracking&&<span onClick={() => setTrackerOpen(true)} style={{ color:"#f87171",fontSize:10,cursor:"pointer",background:"rgba(239,68,68,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(239,68,68,0.22)",display:"flex",alignItems:"center",gap:3 }}><span style={{ animation:"blink 1s infinite" }}>●</span>REC</span>}
            {offlineMode&&<span onClick={() => setOfflineMode(false)} style={{ color:"#4ade80",fontSize:10,cursor:"pointer",background:"rgba(34,197,94,0.09)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(34,197,94,0.22)" }}>🗺</span>}
            {syncStatus==="syncing"&&<span style={{ color:"#38bdf8",fontSize:10,background:"rgba(56,189,248,0.07)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(56,189,248,0.22)",display:"flex",alignItems:"center",gap:3 }}><span style={{ animation:"spin 1s linear infinite",display:"inline-block",fontSize:8 }}>◌</span>Syncing</span>}
            {queueSize>0&&<span style={{ color:"#fbbf24",fontSize:10,background:"rgba(251,191,36,0.07)",padding:"2px 8px",borderRadius:12,border:"1px solid rgba(251,191,36,0.22)" }}>⏳ {queueSize}</span>}
            <div style={{ display:"flex",alignItems:"center",gap:4 }}>
              <span style={{ animation:"blink 1.5s infinite",color:"#4a9eff",fontSize:8 }}>●</span>
              <span style={{ color:"rgba(255,255,255,0.22)",fontSize:9.5 }}>Live</span>
            </div>
          </div>
        </div>

        {/* ══ InstantEditBubble ══════════════════════════════════════════ */}
        <InstantEditBubble
          drawing={clickedDrawing}
          cursorElevation={cursorElevation}
          onEdit={(d) => { setClickedDrawing(null); setPropertiesDrawing(d); }}
          onDelete={(d) => { setSavedDrawings(p => p.filter(x => x !== d)); setClickedDrawing(null); }}
          onClose={() => setClickedDrawing(null)}
          onFly={(d) => {
            if (d.points?.[0]) setFlyTarget({ lat: d.points[0].lat, lng: d.points[0].lng, zoom: 17, _ts: Date.now() });
            setClickedDrawing(null);
          }}
        />

        {/* ══ PROPERTIES PANEL ═══════════════════════════════════════════ */}
        {propertiesDrawing && (
          <FeaturePropertiesPanel
            drawing={propertiesDrawing}
            onClose={() => setPropertiesDrawing(null)}
            onSave={(updated) => {
              const merged = {
                ...propertiesDrawing,
                name:        updated.name        ?? propertiesDrawing.name,
                description: updated.description ?? propertiesDrawing.description,
                color:       updated.color       ?? propertiesDrawing.color,
                fillColor:   updated.fillColor   ?? propertiesDrawing.fillColor,
                width:       updated.width       ?? propertiesDrawing.width,
                opacity:     updated.opacity     ?? propertiesDrawing.opacity,
                fillOpacity: updated.fillOpacity ?? propertiesDrawing.fillOpacity,
                iconKey:     updated.iconKey     ?? propertiesDrawing.iconKey  ?? "pin",
                iconSize:    updated.iconSize    ?? propertiesDrawing.iconSize ?? "medium",
              };
              setSavedDrawings(p => p.map(d => d === propertiesDrawing ? merged : d));
              setPropertiesDrawing(null);
            }}
            onDelete={() => { setSavedDrawings(p => p.filter(d => d !== propertiesDrawing)); setPropertiesDrawing(null); }}
          />
        )}
        {propertiesGeoJSONFeature && (
          <FeaturePropertiesPanel geojsonFeature={propertiesGeoJSONFeature} onClose={() => setPropertiesGeoJSONFeature(null)} />
        )}

        {/* ══ RIGHT-CLICK CONTEXT MENU ═══════════════════════════════════ */}
        {contextMenu.visible && (
          <FeatureContextMenu
            x={contextMenu.x} y={contextMenu.y} feature={contextMenu.feature}
            onClose={() => setContextMenu(m => ({ ...m, visible: false }))}
            onProperties={(f) => { setContextMenu(m => ({ ...m, visible: false })); setPropertiesGeoJSONFeature(f); }}
            onZoomTo={(f) => { setContextMenu(m => ({ ...m, visible: false })); handleContextZoomTo(f); }}
            onDelete={() => { setContextMenu(m => ({ ...m, visible: false })); }}
            onRename={() => { setContextMenu(m => ({ ...m, visible: false })); }}
          />
        )}

        {/* ══ KML AREA ANALYZER ══════════════════════════════════════════ */}
        {kmlAnalyzerOpen && kmlAnalyzerData && (
          <KMLAreaAnalyzer
            geojson={kmlAnalyzerData.geojson}
            fileName={kmlAnalyzerData.fileName}
            onClose={() => setKmlAnalyzerOpen(false)}
          />
        )}

        {/* ══ GOOGLE EARTH OPTIONS DIALOG ════════════════════════════════ */}
        {optionsOpen && (
          <GoogleEarthOptionsDialog
            onClose={() => setOptionsOpen(false)}
            onApply={(settings) => {
              setAppSettings(settings);
              if (settings.showLatLong === "utm")      setCoordFmt("utm");
              else if (settings.showLatLong === "dms") setCoordFmt("dms");
              else                                     setCoordFmt("dec");
            }}
          />
        )}

        {/* ══ KML PROCESSING PANEL (DEM / CONTOUR / SHAPEFILE) ══════════ */}
        <KMLProcessingPanel
          kmlGeojson={kmlAnalyzerData?.geojson}
          kmlFileName={kmlName}
          leafletMapRef={leafletMapRef}
          visible={kmlProcessingOpen}
          onClose={() => setKmlProcessingOpen(false)}
        />

        {/* ══ PRINT MAP PANEL ════════════════════════════════════════════ */}
        <PrintMapPanel
          visible={printOpen}
          onClose={() => setPrintOpen(false)}
          leafletMapRef={leafletMapRef}
          savedDrawings={savedDrawings}
          kmlName={kmlName}
          kmlAnalyzerData={kmlAnalyzerData}
          extraFile={extraFile}
          extraFileType={extraFileType}
          geojsonFileName={geojsonFileName}
          shpFileName={shpFileName}
          demFileName={demFileName}
          importedGeoJSONLayers={geoJSON.importedGeoJSONLayers}
          surveyMode={surveyMode}
          route={route}
          measurePoints={measurePoints}
          measureMode={measureMode}
          activeLayer={activeLayer}
          mousePos={mousePos}
          mapZoom={mapZoom}
          isMobile={isMobile}
        />

        {/* ══ DIRECTIONS PANEL ════════════════════════════════════════════ */}
        {directionsOpen && (
          <DirectionsPanel
            onClose={() => setDirectionsOpen(false)}
            onCalculate={(params) => { setActiveRouteIdx(0); calculateRoute(params); }}
            onClear={clearRoute}
            routeResult={routeResult}
            routeLoading={routeLoading}
            routeError={routeError}
            activeRouteIdx={activeRouteIdx}
            setActiveRouteIdx={setActiveRouteIdx}
            geocodeForMap={geocodeForMap}
          />
        )}

      </div>
    </>
  );
}