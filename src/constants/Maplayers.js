/**
 * mapLayers.js — SurveyMap Pro v5.1
 * ─────────────────────────────────────────────────────────────────────────────
 * ZOOM FIX (v5.1.1):
 *   Added maxNativeZoom to every layer.
 *
 *   maxZoom        = how far the MAP can zoom (always 22 — user can always zoom)
 *   maxNativeZoom  = the highest zoom level the tile SERVER actually has tiles for
 *
 *   Leaflet will automatically SCALE/STRETCH tiles from maxNativeZoom up to
 *   maxZoom so the map never goes blank at high zoom. Without maxNativeZoom,
 *   tiles return 404 at high zoom → broken image icons.
 *
 * TILE URL RULES:
 *   {s} → subdomain   {z} → zoom   {x} → column   {y} → row
 */

/* ─────────────────────────────────────────────────────────────────────────────
   MAP LAYER DEFINITIONS

   IMPORTANT ZOOM FIELDS:
     maxZoom        — always set to 22 so the map container allows deep zoom
     maxNativeZoom  — the real max zoom the tile source supports
                      Leaflet stretches tiles above this level automatically
─────────────────────────────────────────────────────────────────────────────*/
export const MAP_LAYERS = {

  /* ── Satellite (Esri World Imagery — tiles go to z19) ───────────────────── */
  "Satellite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    icon: "Satellite",
    maxZoom: 22,
    maxNativeZoom: 19,
  },

  /* ── Street (OpenStreetMap — tiles go to z19) ───────────────────────────── */
  "Street": {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
    icon: "Street",
    maxZoom: 22,
    maxNativeZoom: 19,
  },

  /* ── Terrain (Stadia/Stamen — tiles go to z18) ──────────────────────────── */
  "Terrain": {
    url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png",
    attribution:
      "© <a href='https://stamen.com'>Stamen Design</a>, " +
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 18,
  },

  /* ── Hillshade (Esri World Shaded Relief — tiles only go to z13!) ────────
     maxNativeZoom:13 means at z14+ Leaflet zooms the z13 tile in.
     This is intentional — Hillshade is a coarse overlay layer.           */
  "Hillshade": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — USGS, Esri",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 13,
  },

  /* ══════════════════════════════════════════════════════════════════════════
     CONTOUR
     Base:    OpenTopoMap   — tiles go to z17  (CC-BY-SA, no key)
     Overlay: OpenSnowMap   — tiles go to z15  (CC-BY-SA, no key)
     Both maxNativeZoom values set correctly so tiles stretch gracefully.
  ══════════════════════════════════════════════════════════════════════════ */
  "Contour": {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    overlayUrl: "https://tiles.opensnowmap.org/contours/{z}/{x}/{y}.png",
    // Base can go natively to z17; overlay only to z15
    maxNativeZoom: 17,
    overlayMaxNativeZoom: 15,
    attribution:
      "Map data © <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "SRTM | Map style © <a href='https://opentopomap.org'>OpenTopoMap</a> (CC-BY-SA) | " +
      "Contours © <a href='https://www.opensnowmap.org'>OpenSnowMap</a>",
    icon: "Terrain",
    maxZoom: 22,
  },

  /* ── Satellite + Labels ──────────────────────────────────────────────────
     Base Esri imagery z19, label overlay also z19                         */
  "Satellite + Labels": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    overlayUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, i-cubed, USDA, USGS, AEX, GeoEye | Labels © Esri",
    icon: "SatLabels",
    maxZoom: 22,
    maxNativeZoom: 19,
    overlayMaxNativeZoom: 19,
  },

  /* ── Dark (CartoDB DarkMatter — tiles go to z20) ────────────────────────── */
  "Dark": {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "© <a href='https://carto.com/attributions'>CARTO</a>",
    icon: "Dark",
    maxZoom: 22,
    maxNativeZoom: 20,
  },

  /* ── Light (CartoDB Positron — tiles go to z20) ─────────────────────────── */
  "Light": {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "© <a href='https://carto.com/attributions'>CARTO</a>",
    icon: "Light",
    maxZoom: 22,
    maxNativeZoom: 20,
  },

  /* ── WMS — States demo (zoom irrelevant for WMS) ────────────────────────── */
  "WMS – States demo": {
    type: "wms",
    url: "https://ahocevar.com/geoserver/wms",
    layers: "topp:states",
    format: "image/png",
    transparent: true,
    attribution: "© GeoServer Demo",
    icon: "Layers",
    maxZoom: 22,
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   MENU DEFINITIONS
   Used to build the top menu bar dropdowns in SurveyMap.jsx.
─────────────────────────────────────────────────────────────────────────────*/
export const MENU_DEFS = {
  File: [
    { label: "Import KML",         icon: "Upload",  action: "openKML"       },
    { label: "Import KMZ / CSV",   icon: "CSV",     action: "openExtra"     },
    { label: "Import GeoJSON",     icon: "GeoJSON", action: "openGeoJSON"   },
    { divider: true },
    { label: "Export GeoJSON",     icon: "Export",  action: "exportGeoJSON" },
    { divider: true },
    { label: "Reset Everything",   icon: "Trash",   action: "resetAll"      },
  ],
  Edit: [
    { label: "Start Drawing",      icon: "Draw",    action: "startDraw"     },
    { label: "Cancel Drawing",     icon: "Close",   action: "cancelDraw"    },
    { divider: true },
    { label: "Start Measuring",    icon: "Measure", action: "startMeasure"  },
    { label: "Stop Measuring",     icon: "Stop",    action: "stopMeasure"   },
    { divider: true },
    { label: "Delete All Drawings",icon: "Trash",   action: "deleteDrawings"},
  ],
  View: [
    { label: "Satellite",          icon: "Satellite", action: "layerSatellite" },
    { label: "Street",             icon: "Street",    action: "layerStreet"    },
    { label: "Terrain",            icon: "Terrain",   action: "layerTerrain"   },
    { label: "Dark",               icon: "Dark",      action: "layerDark"      },
    { label: "Light",              icon: "Light",     action: "layerLight"     },
    { label: "Satellite + Labels", icon: "SatLabels", action: "layerSatLabels" },
    { divider: true },
    { label: "3D Globe",           icon: "Globe",     action: "show3D"         },
    { label: "Auto Night Mode",    icon: "Night",     action: "toggleNight"    },
  ],
  Tools: [
    { label: "Draw Marker",        icon: "Pin",       action: "drawMarker"     },
    { label: "Draw Path",          icon: "Path",      action: "drawPath"       },
    { label: "Draw Polygon",       icon: "Polygon",   action: "drawPoly"       },
    { divider: true },
    { label: "Toggle Survey",      icon: "Survey",    action: "toggleSurvey"   },
    { label: "Live Track Recorder",icon: "Record",    action: "openTracker"    },
    { divider: true },
    { label: "Elevation Profile",  icon: "Mountain",  action: "openElevation"  },
    { label: "Compass Navigation", icon: "Navigation",action: "openCompassNav" },
    { divider: true },
    { label: "Offline Maps",       icon: "Offline",   action: "openOffline"    },
    { label: "Toggle Offline Mode",icon: "Offline",   action: "toggleOfflineMode" },
  ],
  Add: [
    { label: "Import KML",         icon: "Upload",    action: "openKML"        },
    { label: "Import GeoJSON",     icon: "GeoJSON",   action: "openGeoJSON"    },
  ],
  Help: [
    { label: "About SurveyMap",    icon: "Compass",   action: "about"          },
    { label: "Keyboard Shortcuts", icon: "Keyboard",  action: "shortcuts"      },
    { divider: true },
    { label: "OpenStreetMap.org",  icon: "Wikipedia", action: "osmLink"        },
    { label: "Leaflet Docs",       icon: "Wikipedia", action: "leafletLink"    },
  ],
};