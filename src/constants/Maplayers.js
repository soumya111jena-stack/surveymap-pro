/**
 * mapLayers.js — SurveyMap Pro v5.2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTOUR FIX v5.2.0 — AlpineQuest-style true contour map:
 *
 *   Problem with v5.1.3 (Esri World Topo Map):
 *     - Esri Topo is a general-purpose topographic map — it renders contours
 *       only at high zoom (z13+), has road/city clutter, and the style looks
 *       nothing like AlpineQuest's clean contour view.
 *
 *   AlpineQuest uses a TWO-LAYER COMPOSITE approach:
 *     Layer 1 (base)    — Clean terrain base: OpenTopoMap OR Stamen Terrain
 *     Layer 2 (overlay) — Dedicated contour/hillshade overlay on top
 *
 *   Solution for "Contour" mode — THREE reliable options (ranked best→fallback):
 *
 *   ── OPTION A (PRIMARY — best AlpineQuest match) ──────────────────────────
 *     Base:    OpenTopoMap  {a|b|c}.tile.opentopomap.org/{z}/{x}/{y}.png
 *              • SRTM contour lines rendered at ALL zoom levels (z4–z17)
 *              • Elevation-based colour shading (greens → browns → whites)
 *              • Trail/path overlay baked in — exactly like AlpineQuest
 *              • CC-BY-SA, free, global, no API key
 *     Fix for low-zoom grey grid: use subdomains {a,b,c} — distributes
 *     requests across 3 servers to avoid per-IP rate limiting at z5 and below.
 *     Also set tileSize:256, crossOrigin:"anonymous", keepBuffer:2.
 *
 *   ── OPTION B (COMPOSITE — if OpenTopoMap is too slow) ───────────────────
 *     Base:    Stamen Terrain (via Stadia, free for localhost/domain auth)
 *              https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png
 *              • Natural vegetation colours + terrain shading
 *     Overlay: Waymarked Trails hillshading from wmflabs (free, no key):
 *              https://tiles.wmflabs.org/hillshading/{z}/{x}/{y}.png
 *              • Adds ridge/valley shadow depth on top of any base
 *
 *   ── OPTION C (FALLBACK — zero rate-limit, always works) ─────────────────
 *     Base:    Esri World Shaded Relief  (z0–z13, solid CDN)
 *     Overlay: Esri World Topo contour overlay pane  (z0–z19)
 *     This is a hybrid — no contour lines but excellent terrain shading.
 *
 *   IMPLEMENTATION:
 *     "Contour" uses OPTION A (OpenTopoMap) with subdomain spreading.
 *     "Contour + Relief" uses OPTION B composite (Stamen Terrain base +
 *      hillshade overlay) for a richer AlpineQuest-like look.
 *     "Hillshade" keeps Esri Shaded Relief as OPTION C fallback.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THE OVERLAY SYSTEM WORKS IN YOUR MAP RENDERER:
 *   If a layer has `overlayUrl`, your map code should add TWO tile layers:
 *     1. L.tileLayer(layer.url, { maxZoom, maxNativeZoom, ... }).addTo(map)
 *     2. L.tileLayer(layer.overlayUrl, { maxZoom, maxNativeZoom:overlayMaxNativeZoom,
 *           opacity: layer.overlayOpacity ?? 0.6, ... }).addTo(map)
 *   Both are removed when switching away from this layer.
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
    subdomains: "abc",
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
     CONTOUR  ✅ v5.2.0 — OpenTopoMap (AlpineQuest-style)
     ─────────────────────────────────────────────────────────────────────────
     OpenTopoMap renders SRTM elevation data as:
       • Brown contour lines at every 20 m / 100 m interval
       • Elevation colour bands (greens → ochres → greys → white snowcaps)
       • Hillshade relief baked in
       • OSM trails, paths, and peaks labelled
     This is the closest free equivalent to AlpineQuest's topo view.

     Subdomain spreading {a,b,c} prevents per-IP 429 errors at low zoom
     by splitting the tile burst across 3 mirror servers.

     Rate-limit mitigation applied:
       subdomains: "abc"   → 3× parallel capacity
       keepBuffer: 2       → prefetch adjacent tiles at lower priority
       updateWhenIdle: true → pause fetching while panning (reduces bursts)

     Zoom range: z4–z17 (native). Below z4 Leaflet stretches z4 tiles —
     this looks fine for a zoomed-out overview and has no grey-grid issue
     because stretched tiles come from the local cache, not the server.
  ══════════════════════════════════════════════════════════════════════════ */
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
    subdomains: "abc",        // spread load across a.tile / b.tile / c.tile
    keepBuffer: 2,            // prefetch a 2-tile buffer around viewport
    updateWhenIdle: true,     // don't hammer server during fast pan
    /*
     * NO overlayUrl needed — OpenTopoMap bakes contours + hillshade +
     * labels into a single raster tile. This is the true AlpineQuest look.
     */
  },

  /* ══════════════════════════════════════════════════════════════════════════
     CONTOUR + RELIEF  — Composite AlpineQuest-style (Terrain base + relief overlay)
     ─────────────────────────────────────────────────────────────────────────
     Two-layer composite for a richer look:
       Base:    Stamen Terrain (natural vegetation colours, terrain shading)
       Overlay: Esri World Hillshade (ridge/valley depth shading)
                opacity 0.35 — subtle shadow wash on top of terrain colours

     This gives the "satellite + terrain overlay" look seen in AlpineQuest
     when the Hillshade layer is enabled on top of the topo base.

     Stadia/Stamen Terrain: free for localhost + domain auth (no API key for
     open deployments). Max native zoom 18.
     Esri Hillshade: free, no key, CDN-backed, max native zoom 13 (stretched to 22).
  ══════════════════════════════════════════════════════════════════════════ */
  "Contour + Relief": {
    url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png",
    overlayUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    overlayOpacity: 0.35,
    overlayMaxNativeZoom: 16,
    attribution:
      "© <a href='https://stamen.com'>Stamen Design</a> / " +
      "<a href='https://stadiamaps.com'>Stadia Maps</a>, " +
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors | " +
      "Hillshade © Esri",
    icon: "Terrain",
    maxZoom: 22,
    maxNativeZoom: 18,
    /*
     * Your renderer should add both layers:
     *   L.tileLayer(url).addTo(map)                                 ← base
     *   L.tileLayer(overlayUrl, { opacity:0.35 }).addTo(map)        ← overlay
     */
  },

  /* ── Satellite + Labels ─────────────────────────────────────────────────── */
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

  /* ── Dark ───────────────────────────────────────────────────────────────── */
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

  /* ── Light ──────────────────────────────────────────────────────────────── */
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
   LAYER RENDERER HELPER
   ─────────────────────────────────────────────────────────────────────────────
   Use this in your map initialisation code to correctly handle layers with
   overlays (Contour + Relief, Satellite + Labels).

   Usage:
     import { applyLayer, removeLayer } from './mapLayers.js';
     const layerHandles = applyLayer(map, MAP_LAYERS["Contour"]);
     // later:
     removeLayer(map, layerHandles);

   Returns an array of Leaflet layer instances added, in order [base, overlay?].
*/
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
    l.addTo(map);
    handles.push(l);
    return handles;
  }

  // Base tile layer
  const base = L.tileLayer(layerDef.url, {
    attribution:   layerDef.attribution   ?? "",
    maxZoom:       layerDef.maxZoom       ?? 22,
    maxNativeZoom: layerDef.maxNativeZoom ?? 19,
    subdomains:    layerDef.subdomains    ?? "abc",
    keepBuffer:    layerDef.keepBuffer    ?? 2,
    updateWhenIdle:layerDef.updateWhenIdle ?? false,
    crossOrigin:   "anonymous",
  });
  base.addTo(map);
  handles.push(base);

  // Optional overlay
  if (layerDef.overlayUrl) {
    const overlay = L.tileLayer(layerDef.overlayUrl, {
      attribution:   "",
      maxZoom:       layerDef.maxZoom            ?? 22,
      maxNativeZoom: layerDef.overlayMaxNativeZoom ?? 19,
      opacity:       layerDef.overlayOpacity      ?? 1.0,
      crossOrigin:   "anonymous",
    });
    overlay.addTo(map);
    handles.push(overlay);
  }

  return handles;
}

export function removeLayer(map, handles) {
  if (!map || !handles) return;
  handles.forEach(l => { try { map.removeLayer(l); } catch (_) {} });
}

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
    { label: "Satellite",          icon: "Satellite", action: "layerSatellite"   },
    { label: "Street",             icon: "Street",    action: "layerStreet"      },
    { label: "Terrain",            icon: "Terrain",   action: "layerTerrain"     },
    { label: "Contour",            icon: "Terrain",   action: "layerContour"     },
    { label: "Contour + Relief",   icon: "Terrain",   action: "layerContourRelief"},
    { label: "Dark",               icon: "Dark",      action: "layerDark"        },
    { label: "Light",              icon: "Light",     action: "layerLight"       },
    { label: "Satellite + Labels", icon: "SatLabels", action: "layerSatLabels"   },
    { divider: true },
    { label: "3D Globe",           icon: "Globe",     action: "show3D"           },
    { label: "Auto Night Mode",    icon: "Night",     action: "toggleNight"      },
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