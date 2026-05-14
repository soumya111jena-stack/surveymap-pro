/**
 * mapLayers.js — SurveyMap Pro v5.5.0
 * FIX v5.5.0:
 *   "Terrain" was Esri World Terrain Base (maxNativeZoom:13) — showed
 *   "Map data not yet available" at zoom 14+. Replaced with Esri World
 *   Topo Map which works up to zoom 19 and has proper terrain styling.
 */

export const MAP_LAYERS = {

  "Satellite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    icon: "Satellite",
    maxZoom: 22,
    maxNativeZoom: 19,
  },

  "Street": {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
    icon: "Street",
    maxZoom: 22,
    maxNativeZoom: 19,
    subdomains: "abc",
  },

  /*
   * Terrain — Esri World Topo Map
   * Works at ALL zoom levels (native up to z19).
   * Shows terrain shading + contours + roads + labels.
   * Visually distinct from Contour (Esri style vs OpenTopoMap style).
   * Free, no API key, global CDN.
   */
  "Terrain": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 19,
  },

  /*
   * Hillshade — Esri World Shaded Relief
   * Pure greyscale hillshade. maxNativeZoom 13 is fine here because
   * hillshade is only useful at overview zoom levels anyway.
   */
  "Hillshade": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — USGS, Esri",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 13,
  },

  /*
   * Contour — OpenTopoMap
   * SRTM contour lines + elevation colour bands + OSM trails.
   * AlpineQuest-style topo. Free, no API key, native up to z17.
   */
  "Contour": {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      "Map data: © <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "<a href='http://viewfinderpanoramas.org'>SRTM</a> | " +
      "Map style: © <a href='https://opentopomap.org'>OpenTopoMap</a> " +
      "(<a href='https://creativecommons.org/licenses/by-sa/3.0/'>CC-BY-SA</a>)",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 17,
    subdomains: "abc",
    keepBuffer: 2,
    updateWhenIdle: true,
  },

  /*
   * Contour + Relief — OpenTopoMap + Esri Hillshade overlay
   * Contour lines with added depth shading on top.
   */
  "Contour + Relief": {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    overlayUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    overlayOpacity: 0.35,
    overlayMaxNativeZoom: 16,
    attribution:
      "Map data: © <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "<a href='http://viewfinderpanoramas.org'>SRTM</a> | " +
      "Map style: © <a href='https://opentopomap.org'>OpenTopoMap</a> | " +
      "Hillshade © Esri",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 17,
    subdomains: "abc",
    keepBuffer: 2,
    updateWhenIdle: true,
  },

  "Satellite + Labels": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    overlayUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    overlayOpacity: 1.0,
    attribution: "Tiles © Esri — Esri, i-cubed, USDA, USGS, AEX, GeoEye | Labels © Esri",
    icon: "SatLabels",
    maxZoom: 22,
    maxNativeZoom: 19,
    overlayMaxNativeZoom: 19,
  },

  "Dark": {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "© <a href='https://carto.com/attributions'>CARTO</a>",
    icon: "Dark",
    maxZoom: 22,
    maxNativeZoom: 20,
    subdomains: "abcd",
  },

  "Light": {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, " +
      "© <a href='https://carto.com/attributions'>CARTO</a>",
    icon: "Light",
    maxZoom: 22,
    maxNativeZoom: 20,
    subdomains: "abcd",
  },

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

export function applyLayer(map, layerDef) {
  if (!map || !layerDef) return [];
  const handles = [];
  if (layerDef.type === "wms") {
    const l = L.tileLayer.wms(layerDef.url, {
      layers:      layerDef.layers,
      format:      layerDef.format      ?? "image/png",
      transparent: layerDef.transparent ?? true,
      attribution: layerDef.attribution ?? "",
      maxZoom:     layerDef.maxZoom     ?? 22,
    });
    l.addTo(map); handles.push(l); return handles;
  }
  const base = L.tileLayer(layerDef.url, {
    attribution:    layerDef.attribution    ?? "",
    maxZoom:        layerDef.maxZoom        ?? 22,
    maxNativeZoom:  layerDef.maxNativeZoom  ?? 19,
    subdomains:     layerDef.subdomains     ?? "abc",
    keepBuffer:     layerDef.keepBuffer     ?? 2,
    updateWhenIdle: layerDef.updateWhenIdle ?? false,
    crossOrigin:    "anonymous",
  });
  base.addTo(map); handles.push(base);
  if (layerDef.overlayUrl) {
    const overlay = L.tileLayer(layerDef.overlayUrl, {
      attribution:   "",
      maxZoom:       layerDef.maxZoom              ?? 22,
      maxNativeZoom: layerDef.overlayMaxNativeZoom ?? 19,
      opacity:       layerDef.overlayOpacity        ?? 1.0,
      crossOrigin:   "anonymous",
    });
    overlay.addTo(map); handles.push(overlay);
  }
  return handles;
}

export function removeLayer(map, handles) {
  if (!map || !handles) return;
  handles.forEach(l => { try { map.removeLayer(l); } catch (_) {} });
}

export const MENU_DEFS = {
  File: [
    { label: "Import KML",          icon: "Upload",  action: "openKML"        },
    { label: "Import KMZ / CSV",    icon: "CSV",     action: "openExtra"      },
    { label: "Import GeoJSON",      icon: "GeoJSON", action: "openGeoJSON"    },
    { divider: true },
    { label: "Export GeoJSON",      icon: "Export",  action: "exportGeoJSON"  },
    { divider: true },
    { label: "Reset Everything",    icon: "Trash",   action: "resetAll"       },
  ],
  Edit: [
    { label: "Start Drawing",       icon: "Draw",    action: "startDraw"      },
    { label: "Cancel Drawing",      icon: "Close",   action: "cancelDraw"     },
    { divider: true },
    { label: "Start Measuring",     icon: "Measure", action: "startMeasure"   },
    { label: "Stop Measuring",      icon: "Stop",    action: "stopMeasure"    },
    { divider: true },
    { label: "Delete All Drawings", icon: "Trash",   action: "deleteDrawings" },
  ],
  View: [
    { label: "Satellite",           icon: "Satellite", action: "layerSatellite"     },
    { label: "Street",              icon: "Street",    action: "layerStreet"        },
    { label: "Terrain",             icon: "Terrain",   action: "layerTerrain"       },
    { label: "Contour",             icon: "Terrain",   action: "layerContour"       },
    { label: "Contour + Relief",    icon: "Terrain",   action: "layerContourRelief" },
    { label: "Dark",                icon: "Dark",      action: "layerDark"          },
    { label: "Light",               icon: "Light",     action: "layerLight"         },
    { label: "Satellite + Labels",  icon: "SatLabels", action: "layerSatLabels"     },
    { divider: true },
    { label: "3D Globe",            icon: "Globe",     action: "show3D"             },
    { label: "Auto Night Mode",     icon: "Night",     action: "toggleNight"        },
  ],
  Tools: [
    { label: "Draw Marker",         icon: "Pin",        action: "drawMarker"        },
    { label: "Draw Path",           icon: "Path",       action: "drawPath"          },
    { label: "Draw Polygon",        icon: "Polygon",    action: "drawPoly"          },
    { divider: true },
    { label: "Toggle Survey",       icon: "Survey",     action: "toggleSurvey"      },
    { label: "Live Track Recorder", icon: "Record",     action: "openTracker"       },
    { divider: true },
    { label: "Elevation Profile",   icon: "Mountain",   action: "openElevation"     },
    { label: "Compass Navigation",  icon: "Navigation", action: "openCompassNav"    },
    { divider: true },
    { label: "Offline Maps",        icon: "Offline",    action: "openOffline"       },
    { label: "Toggle Offline Mode", icon: "Offline",    action: "toggleOfflineMode" },
  ],
  Add: [
    { label: "Import KML",          icon: "Upload",    action: "openKML"            },
    { label: "Import GeoJSON",      icon: "GeoJSON",   action: "openGeoJSON"        },
  ],
  Help: [
    { label: "About SurveyMap",     icon: "Compass",   action: "about"              },
    { label: "Keyboard Shortcuts",  icon: "Keyboard",  action: "shortcuts"          },
    { divider: true },
    { label: "OpenStreetMap.org",   icon: "Wikipedia", action: "osmLink"            },
    { label: "Leaflet Docs",        icon: "Wikipedia", action: "leafletLink"        },
  ],
};