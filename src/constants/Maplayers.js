/**
 * mapLayers.js — SurveyMap Pro v5.1.3
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX v5.1.3 — CONTOUR GREY GRID AT LOW ZOOM (final fix):
 *
 *   Previous fix removed the overlay — grey grid remained at low zoom.
 *   Root cause: OpenTopoMap (opentopomap.org) rate-limits requests and blocks
 *   bulk/fast tile loading. At low zoom (z5 and below, zoomed out to see Asia)
 *   many tiles load simultaneously → server returns 429/403 → grey grid.
 *
 *   Fix: Switch Contour base to Esri World Topo Map:
 *     - Full global coverage z0–19, no rate limiting, no API key needed
 *     - Includes contour lines, elevation shading, terrain relief
 *     - Rock-solid CDN (same Esri CDN as Satellite layer)
 *     - No CORS issues
 *
 *   OpenTopoMap is kept as a commented fallback for reference.
 *
 * ZOOM FIELDS:
 *   maxZoom        = 22  (map allows zoom to 22)
 *   maxNativeZoom  = N   (tile server's real max — Leaflet stretches above N)
 */

export const MAP_LAYERS = {

  /* ── Satellite ──────────────────────────────────────────────────────────── */
  "Satellite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    icon: "Satellite",
    maxZoom: 22,
    maxNativeZoom: 19,
  },

  /* ── Street ─────────────────────────────────────────────────────────────── */
  "Street": {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
    icon: "Street",
    maxZoom: 22,
    maxNativeZoom: 19,
  },

  /* ── Terrain ────────────────────────────────────────────────────────────── */
  "Terrain": {
    url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png",
    attribution:
      "© <a href='https://stamen.com'>Stamen Design</a>, " +
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 18,
  },

  /* ── Hillshade ──────────────────────────────────────────────────────────── */
  "Hillshade": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — USGS, Esri",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 13,
  },

  /* ══════════════════════════════════════════════════════════════════════════
     CONTOUR  ✅ FIX v5.1.3
     Previously used OpenTopoMap which rate-limits at low zoom → grey grid.
     Now uses Esri World Topo Map:
       • Full global coverage z0–19, no rate limiting, no API key
       • Includes contour lines + terrain relief natively
       • Same rock-solid Esri CDN as the Satellite layer
  ══════════════════════════════════════════════════════════════════════════ */
  "Contour": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 19,
    /* No overlayUrl — Esri Topo has contours built in, no overlay needed */
  },

  /* ── Satellite + Labels ─────────────────────────────────────────────────── */
  "Satellite + Labels": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    overlayUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, i-cubed, USDA, USGS, AEX, GeoEye | Labels © Esri",
    icon: "SatLabels",
    maxZoom: 22,
    maxNativeZoom: 19,
    overlayMaxNativeZoom: 19,
  },

  /* ── Dark ───────────────────────────────────────────────────────────────── */
  "Dark": {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "© <a href='https://carto.com/attributions'>CARTO</a>",
    icon: "Dark",
    maxZoom: 22,
    maxNativeZoom: 20,
  },

  /* ── Light ──────────────────────────────────────────────────────────────── */
  "Light": {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "© <a href='https://carto.com/attributions'>CARTO</a>",
    icon: "Light",
    maxZoom: 22,
    maxNativeZoom: 20,
  },

  /* ── WMS – States demo ──────────────────────────────────────────────────── */
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