/**
 * BasemapPanel.jsx — SurveyMap Pro
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-featured Base Map, Terrain & Elevation, and 3D Effects panel for
 * CesiumJS globe. Triggered from the toolbar — appears as a left-side drawer.
 *
 * SECTIONS:
 *  1. BASE MAPS     — Radio-select tiles (replaces globe base imagery layer)
 *  2. TERRAIN       — CesiumTerrain / ArcGIS / Ellipsoid elevation providers
 *  3. 3D EFFECTS    — Atmosphere, fog, shadows, sun, lighting, tilt presets
 *
 * USAGE in parent:
 *   import BasemapPanel from "./BasemapPanel";
 *   <BasemapPanel viewer={cesiumViewer} Cesium={Cesium} visible={show} onClose={()=>setShow(false)} />
 *
 * TERRAIN PROVIDERS (all free / no-auth for basic use):
 *   ✅ CesiumWorldTerrain  — Cesium ion token needed (free tier: 1 req token)
 *   ✅ ArcGISTiledElevation — ESRI ArcGIS REST, no auth, CORS open
 *   ✅ Ellipsoid           — flat / no terrain (built-in Cesium, always works)
 *   ✅ OpenTopoMap tiles   — visual topo overlay (imagery, not terrain provider)
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  BASE MAP CATALOG
//  type: "arcgis"  → ArcGIS REST MapServer (tile/{z}/{y}/{x}, CORS open)
//  type: "xyz"     → Standard XYZ tiles   ({z}/{x}/{y})
//  type: "bing"    → Bing Maps (requires Bing key — graceful fallback)
// ─────────────────────────────────────────────────────────────────────────────
export const BASE_MAP_CATALOG = [
  // ── Satellite / Imagery ──────────────────────────────────────────────────
  {
    id: "esri_satellite",
    group: "satellite",
    title: "World Satellite",
    subtitle: "ESRI / Maxar",
    description: "High-resolution global satellite and aerial imagery from ESRI World Imagery. Best for terrain analysis.",
    icon: "🛰️",
    preview: "linear-gradient(135deg,#0a1628 0%,#0d2137 25%,#1a3a28 50%,#2d5016 70%,#1a2a0a 100%)",
    accentColor: "#22c55e",
    type: "arcgis",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
  },
  {
    id: "esri_satellite_labels",
    group: "satellite",
    title: "Satellite + Labels",
    subtitle: "ESRI World Imagery + Reference",
    description: "Satellite imagery with transparent place names and roads overlay for navigation context.",
    icon: "🛰️",
    preview: "linear-gradient(135deg,#0a1628 0%,#1a3a28 40%,#2d5016 70%,#3a6622 100%)",
    accentColor: "#4ade80",
    type: "arcgis_combo",
    // Two layers: base + overlay
    baseTileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    overlayTileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
  },
  {
    id: "esri_nat_geo",
    group: "satellite",
    title: "National Geographic",
    subtitle: "ESRI / Nat Geo",
    description: "National Geographic-style reference map with terrain shading and rich cartographic detail.",
    icon: "🌎",
    preview: "linear-gradient(135deg,#1a3a0a 0%,#2d5c1e 30%,#c9a84c 60%,#8b6914 85%,#4a3008 100%)",
    accentColor: "#f59e0b",
    type: "arcgis",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
  },

  // ── Street / Road ────────────────────────────────────────────────────────
  {
    id: "esri_street",
    group: "street",
    title: "World Street Map",
    subtitle: "ESRI / HERE",
    description: "Detailed world street map with roads, highways, cities, parks and POIs from ESRI.",
    icon: "🗺️",
    preview: "linear-gradient(135deg,#f5f0e8 0%,#e8dcc8 30%,#d4c4a0 60%,#b8a878 85%)",
    accentColor: "#f97316",
    type: "arcgis",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
  },
  {
    id: "osm",
    group: "street",
    title: "OpenStreetMap",
    subtitle: "OSM Contributors",
    description: "Community-maintained OpenStreetMap standard rendering with roads, buildings and POIs.",
    icon: "🛣️",
    preview: "linear-gradient(135deg,#e8f4e8 0%,#c8e0c8 30%,#a8c8a8 55%,#88b088 80%)",
    accentColor: "#84cc16",
    type: "xyz",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
  },
  {
    id: "carto_voyager",
    group: "street",
    title: "CartoDB Voyager",
    subtitle: "CartoDB / OSM",
    description: "Clean, modern CartoDB Voyager basemap — excellent readability for urban and regional mapping.",
    icon: "🗺️",
    preview: "linear-gradient(135deg,#eef2f7 0%,#d4dde8 30%,#aabdd4 60%,#7a9dc0 85%)",
    accentColor: "#60a5fa",
    type: "xyz",
    tileUrl: "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    maxZoom: 19,
  },

  // ── Dark / Night ─────────────────────────────────────────────────────────
  {
    id: "carto_dark",
    group: "dark",
    title: "Dark Matter",
    subtitle: "CartoDB Dark",
    description: "High-contrast dark basemap. Ideal for overlaying bright data layers and night-mode operations.",
    icon: "🌃",
    preview: "linear-gradient(135deg,#060a12 0%,#0d1520 30%,#151f2e 60%,#1a2840 85%)",
    accentColor: "#818cf8",
    type: "xyz",
    tileUrl: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    maxZoom: 19,
  },
  {
    id: "esri_dark_gray",
    group: "dark",
    title: "Dark Gray Canvas",
    subtitle: "ESRI Dark Gray",
    description: "ESRI dark gray canvas — refined minimal background for professional data visualisation.",
    icon: "⬛",
    preview: "linear-gradient(135deg,#1a1a1a 0%,#242424 30%,#2e2e2e 60%,#383838 85%)",
    accentColor: "#6b7280",
    type: "arcgis",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
  },

  // ── Terrain / Physical ────────────────────────────────────────────────────
  {
    id: "esri_topo",
    group: "terrain_base",
    title: "World Topo Map",
    subtitle: "ESRI Topographic",
    description: "Topographic reference map with contour lines, hillshade, land cover and hydrographic features.",
    icon: "⛰️",
    preview: "linear-gradient(135deg,#0a2a0a 0%,#1a5c3a 22%,#52b788 42%,#c9a84c 62%,#8b4513 80%,#e8e8e8 100%)",
    accentColor: "#10b981",
    type: "arcgis",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 18,
  },
  {
    id: "esri_physical",
    group: "terrain_base",
    title: "Physical Map",
    subtitle: "ESRI World Physical",
    description: "Physical terrain basemap with natural colours, hillshade, and physiographic character.",
    icon: "🌍",
    preview: "linear-gradient(135deg,#1a3d0a 0%,#52b788 25%,#c9a84c 50%,#8b4513 75%,#d0d0d0 100%)",
    accentColor: "#d97706",
    type: "arcgis",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 8,
  },
  {
    id: "open_topo",
    group: "terrain_base",
    title: "OpenTopoMap",
    subtitle: "OpenTopoMap / SRTM",
    description: "SRTM-based topographic map with elevation contours and hypsometric tinting. High detail at zoom 12+.",
    icon: "🗻",
    preview: "linear-gradient(135deg,#1a4a1a 0%,#3a8c3a 25%,#8cd08c 50%,#d4a855 72%,#a0522d 88%,#e8e8e8 100%)",
    accentColor: "#86efac",
    type: "xyz",
    tileUrl: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17,
  },

  // ── Artistic ─────────────────────────────────────────────────────────────
  {
    id: "stamen_watercolor",
    group: "artistic",
    title: "Watercolor",
    subtitle: "Stadia / Stamen",
    description: "Artistic watercolor-style map from Stamen Design — unique aesthetic for presentations.",
    icon: "🎨",
    preview: "linear-gradient(135deg,#c8e0f0 0%,#a0c4e8 25%,#d4c0a0 50%,#c8d4a8 75%,#b0c8b0 100%)",
    accentColor: "#a78bfa",
    type: "xyz",
    tileUrl: "https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg",
    maxZoom: 16,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  TERRAIN ELEVATION CATALOG
//  type: "cesium_world"   → Cesium World Terrain (ion, free tier)
//  type: "arcgis_terrain" → ESRI ArcGIS Elevation (no auth)
//  type: "ellipsoid"      → No terrain — flat globe
// ─────────────────────────────────────────────────────────────────────────────
export const TERRAIN_CATALOG = [
  {
    id: "ellipsoid",
    title: "No Terrain",
    subtitle: "Flat Ellipsoid",
    description: "Smooth ellipsoid — no elevation data. Fastest rendering, all features flat on the globe surface.",
    icon: "🌐",
    preview: "linear-gradient(135deg,#0a1628 0%,#1a3a5c 50%,#0d2a4a 100%)",
    accentColor: "#64748b",
    type: "ellipsoid",
    tags: ["flat","fast","default"],
  },
  {
    id: "cesium_world_terrain",
    title: "Cesium World Terrain",
    subtitle: "Cesium Ion (Free Tier)",
    description: "Global 3D terrain at up to 1m resolution from Cesium ion. Real mountains, valleys, and ocean floors rendered in 3D.",
    icon: "⛰️",
    preview: "linear-gradient(135deg,#0a1e0a 0%,#1a4020 25%,#3a7a3a 50%,#8b6914 72%,#c8c8c8 90%,#ffffff 100%)",
    accentColor: "#10b981",
    type: "cesium_world",
    badge: "Best Quality",
    badgeColor: "#10b981",
    tags: ["3D","high-res","mountains","valleys"],
    note: "Add Cesium ion token in cesiumIonToken for full access",
  },
  {
    id: "arcgis_terrain",
    title: "ArcGIS World Elevation",
    subtitle: "ESRI ArcGIS — No Auth",
    description: "ESRI World Elevation terrain service. No API key required. 30m global SRTM coverage with bathymetry.",
    icon: "🏔️",
    preview: "linear-gradient(135deg,#050c1a 0%,#0d2137 25%,#1a3a52 50%,#8b6914 72%,#a08060 90%)",
    accentColor: "#f59e0b",
    type: "arcgis_terrain",
    badge: "No Key Needed",
    badgeColor: "#f59e0b",
    tags: ["3D","ESRI","SRTM","free"],
  },
  {
    id: "cesium_world_bathymetry",
    title: "Cesium World Bathymetry",
    subtitle: "Cesium Ion — Ocean Floors",
    description: "Full 3D terrain including ocean floor bathymetry. See underwater ridges, trenches and continental shelves in 3D.",
    icon: "🌊",
    preview: "linear-gradient(180deg,#020c1b 0%,#0c2461 30%,#1565c0 60%,#1e88e5 80%,#64b5f6 100%)",
    accentColor: "#0ea5e9",
    type: "cesium_world_bathymetry",
    badge: "Ocean Floors",
    badgeColor: "#0ea5e9",
    tags: ["3D","ocean","bathymetry","deep sea"],
    note: "Add Cesium ion token for access",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  3D EFFECTS CATALOG
// ─────────────────────────────────────────────────────────────────────────────
const EFFECTS_CONFIG = [
  {
    id: "atmosphere",
    title: "Atmosphere",
    description: "Blue atmospheric haze around the globe edge — realistic sky scattering",
    icon: "🌫️",
    defaultOn: true,
    apply: (viewer, Cesium, on) => {
      viewer.scene.skyAtmosphere.show = on;
      viewer.scene.globe.showGroundAtmosphere = on;
    },
  },
  {
    id: "fog",
    title: "Distance Fog",
    description: "Fog fades distant terrain for depth — reduces visual clutter",
    icon: "🌁",
    defaultOn: true,
    apply: (viewer, Cesium, on) => {
      viewer.scene.fog.enabled = on;
    },
  },
  {
    id: "sun_lighting",
    title: "Sun Lighting",
    description: "Realistic sun position lighting — terrain casts shadows based on time of day",
    icon: "☀️",
    defaultOn: false,
    apply: (viewer, Cesium, on) => {
      viewer.scene.globe.enableLighting = on;
    },
  },
  {
    id: "shadows",
    title: "Terrain Shadows",
    description: "Buildings and terrain cast real-time shadows. Requires Sun Lighting to be ON.",
    icon: "🌘",
    defaultOn: false,
    apply: (viewer, Cesium, on) => {
      viewer.shadows = on;
      viewer.terrainShadows = on
        ? Cesium.ShadowMode.ENABLED
        : Cesium.ShadowMode.DISABLED;
    },
  },
  {
    id: "sky_box",
    title: "Star Field",
    description: "Show the starfield skybox when viewing from high altitude or space",
    icon: "✨",
    defaultOn: true,
    apply: (viewer, Cesium, on) => {
      if (viewer.scene.skyBox) viewer.scene.skyBox.show = on;
    },
  },
  {
    id: "underwater",
    title: "Underwater Translucency",
    description: "See through ocean water to the seafloor when using terrain with bathymetry",
    icon: "🤿",
    defaultOn: false,
    apply: (viewer, Cesium, on) => {
      if (viewer.scene.globe.translucency) {
        viewer.scene.globe.translucency.enabled = on;
        viewer.scene.globe.translucency.frontFaceAlpha = on ? 0.6 : 1.0;
      }
    },
  },
  {
    id: "fxaa",
    title: "Anti-Aliasing (FXAA)",
    description: "Smooth jagged edges on terrain and imagery — better visual quality",
    icon: "🔲",
    defaultOn: true,
    apply: (viewer, Cesium, on) => {
      viewer.scene.postProcessStages.fxaa.enabled = on;
    },
  },
  {
    id: "hdr",
    title: "HDR Rendering",
    description: "High dynamic range — improved highlights and shadow detail in bright scenes",
    icon: "💡",
    defaultOn: false,
    apply: (viewer, Cesium, on) => {
      if (viewer.scene.highDynamicRange !== undefined) {
        viewer.scene.highDynamicRange = on;
      }
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  CAMERA PRESET VIEWS
// ─────────────────────────────────────────────────────────────────────────────
const CAMERA_PRESETS = [
  { id: "globe",     icon: "🌍", label: "Globe",     pitch: -90, range: 12000000 },
  { id: "tilt_low",  icon: "✈️", label: "Low Tilt",  pitch: -30, range: 800000  },
  { id: "tilt_mid",  icon: "🏔️", label: "Mid Tilt",  pitch: -45, range: 3000000  },
  { id: "tilt_high", icon: "🛰️", label: "High Tilt", pitch: -60, range: 6000000  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  EXAGGERATION LEVELS  (terrain vertical exaggeration multiplier)
// ─────────────────────────────────────────────────────────────────────────────
const EXAGGERATION_LEVELS = [
  { value: 1,   label: "1×",   sublabel: "Real" },
  { value: 1.5, label: "1.5×", sublabel: "Mild" },
  { value: 2,   label: "2×",   sublabel: "Enhanced" },
  { value: 3,   label: "3×",   sublabel: "Dramatic" },
  { value: 5,   label: "5×",   sublabel: "Extreme" },
];

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)}` : "255,255,255";
}

// ─────────────────────────────────────────────────────────────────────────────
//  BASEMAP CARD
// ─────────────────────────────────────────────────────────────────────────────
function BasemapCard({ bm, isActive, onClick }) {
  const [hov, setHov] = useState(false);
  const rgb = hexToRgb(bm.accentColor);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", gap: 12, alignItems: "center",
        padding: "11px 13px", borderRadius: 10, cursor: "pointer",
        border: `1px solid ${isActive ? `rgba(${rgb},0.55)` : hov ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.06)"}`,
        background: isActive ? `rgba(${rgb},0.10)` : hov ? "rgba(255,255,255,0.03)" : "transparent",
        boxShadow: isActive ? `0 0 16px rgba(${rgb},0.15)` : "none",
        transition: "all 0.17s ease",
        position: "relative",
      }}
    >
      {/* Thumbnail */}
      <div style={{
        width: 52, height: 52, borderRadius: 8, flexShrink: 0,
        background: bm.preview,
        border: `1.5px solid ${isActive ? `rgba(${rgb},0.55)` : "rgba(255,255,255,0.08)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, position: "relative", overflow: "hidden",
        boxShadow: isActive ? `0 0 12px rgba(${rgb},0.35)` : "none",
      }}>
        <span style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.9))", zIndex: 1 }}>{bm.icon}</span>
        {isActive && (
          <div style={{
            position: "absolute", inset: 0,
            background: `rgba(${rgb},0.18)`,
            display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
            padding: 3,
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: "50%",
              background: bm.accentColor,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: isActive ? bm.accentColor : "#fff",
          fontWeight: 700, fontSize: 12.5,
          fontFamily: "'DM Sans',sans-serif",
          transition: "color 0.17s",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{bm.title}</div>
        <div style={{
          color: "rgba(255,255,255,0.4)", fontSize: 10.5,
          fontFamily: "'DM Sans',sans-serif", marginTop: 1,
        }}>{bm.subtitle}</div>
        <div style={{
          color: "rgba(255,255,255,0.28)", fontSize: 9.5,
          fontFamily: "'DM Sans',sans-serif", marginTop: 3,
          display: "-webkit-box", WebkitLineClamp: 1,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{bm.description}</div>
      </div>

      {/* Active dot */}
      <div style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: isActive ? bm.accentColor : "rgba(255,255,255,0.12)",
        boxShadow: isActive ? `0 0 8px ${bm.accentColor}` : "none",
        transition: "all 0.2s",
      }}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  TERRAIN CARD
// ─────────────────────────────────────────────────────────────────────────────
function TerrainCard({ t, isActive, onClick }) {
  const [hov, setHov] = useState(false);
  const rgb = hexToRgb(t.accentColor);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: "12px 13px", borderRadius: 10, cursor: "pointer",
        border: `1px solid ${isActive ? `rgba(${rgb},0.55)` : hov ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.06)"}`,
        background: isActive ? `rgba(${rgb},0.10)` : hov ? "rgba(255,255,255,0.03)" : "transparent",
        boxShadow: isActive ? `0 0 16px rgba(${rgb},0.15)` : "none",
        transition: "all 0.17s ease",
      }}
    >
      {/* Icon */}
      <div style={{
        width: 42, height: 42, borderRadius: 8, flexShrink: 0,
        background: t.preview,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, border: `1.5px solid ${isActive ? `rgba(${rgb},0.5)` : "rgba(255,255,255,0.08)"}`,
        boxShadow: isActive ? `0 0 12px rgba(${rgb},0.3)` : "none",
      }}>
        {t.icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{
            color: isActive ? t.accentColor : "#fff",
            fontWeight: 700, fontSize: 12.5,
            fontFamily: "'DM Sans',sans-serif",
            transition: "color 0.17s",
          }}>{t.title}</div>
          {t.badge && (
            <span style={{
              padding: "1px 6px", borderRadius: 12,
              background: `rgba(${hexToRgb(t.badgeColor)},0.2)`,
              border: `1px solid rgba(${hexToRgb(t.badgeColor)},0.4)`,
              color: t.badgeColor, fontSize: 8.5, fontWeight: 700,
              fontFamily: "'DM Sans',sans-serif",
            }}>{t.badge}</span>
          )}
        </div>
        <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, fontFamily: "'DM Sans',sans-serif", marginBottom: 4 }}>
          {t.subtitle}
        </div>
        <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 9.5, fontFamily: "'DM Sans',sans-serif", lineHeight: 1.5 }}>
          {t.description}
        </div>
        {t.note && isActive && (
          <div style={{
            marginTop: 6, padding: "3px 8px",
            background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.22)",
            borderRadius: 5, color: "#fbbf24", fontSize: 9, fontFamily: "'DM Sans',sans-serif",
          }}>ℹ {t.note}</div>
        )}
      </div>

      <div style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 4,
        background: isActive ? t.accentColor : "rgba(255,255,255,0.12)",
        boxShadow: isActive ? `0 0 8px ${t.accentColor}` : "none",
        transition: "all 0.2s",
      }}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  EFFECT TOGGLE ROW
// ─────────────────────────────────────────────────────────────────────────────
function EffectRow({ effect, enabled, onChange }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 12px", borderRadius: 8,
        background: enabled ? "rgba(99,102,241,0.07)" : "rgba(255,255,255,0.015)",
        border: `1px solid ${enabled ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
        cursor: "pointer", transition: "all 0.15s",
      }}
      onClick={() => onChange(!enabled)}
    >
      <span style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>{effect.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{
          color: enabled ? "#fff" : "rgba(255,255,255,0.55)",
          fontSize: 11.5, fontWeight: 600,
          fontFamily: "'DM Sans',sans-serif", marginBottom: 1,
        }}>{effect.title}</div>
        <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9.5, fontFamily: "'DM Sans',sans-serif" }}>
          {effect.description}
        </div>
      </div>
      {/* Toggle */}
      <div style={{
        width: 34, height: 18, borderRadius: 9, flexShrink: 0,
        background: enabled ? "#6366f1" : "rgba(255,255,255,0.1)",
        border: `1px solid ${enabled ? "#6366f1" : "rgba(255,255,255,0.15)"}`,
        position: "relative", transition: "all 0.2s", cursor: "pointer",
        boxShadow: enabled ? "0 0 8px rgba(99,102,241,0.5)" : "none",
      }}>
        <div style={{
          position: "absolute", top: 2,
          left: enabled ? 17 : 2,
          width: 12, height: 12, borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s cubic-bezier(0.34,1.56,0.64,1)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
        }}/>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION HEADER
// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, count, color = "#94a3b8" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "4px 0 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      marginBottom: 10,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{
        color, fontWeight: 700, fontSize: 10.5,
        letterSpacing: "0.1em", fontFamily: "'DM Sans',sans-serif",
      }}>{title}</span>
      {count != null && (
        <span style={{
          padding: "1px 7px", borderRadius: 20,
          background: `rgba(${hexToRgb(color)},0.12)`,
          border: `1px solid rgba(${hexToRgb(color)},0.25)`,
          color, fontSize: 9, fontWeight: 700,
          fontFamily: "'DM Mono',monospace",
        }}>{count}</span>
      )}
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)", marginLeft: 4 }}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function BasemapPanel({ viewer, Cesium, visible, onClose }) {
  const [tab, setTab]                       = useState("basemap");   // "basemap" | "terrain" | "effects"
  const [activeBasemap, setActiveBasemap]   = useState("esri_satellite");
  const [activeTerrain, setActiveTerrain]   = useState("arcgis_terrain");
  const [effects, setEffects]               = useState(() =>
    Object.fromEntries(EFFECTS_CONFIG.map(e => [e.id, e.defaultOn]))
  );
  const [exaggeration, setExaggeration]     = useState(1);
  const [activeCameraPreset, setActiveCameraPreset] = useState(null);

  const basemapLayersRef = useRef([]);   // active base imagery layers in Cesium

  // ── Apply basemap ──────────────────────────────────────────────────────────
  const applyBasemap = useCallback(async (bmId) => {
    if (!viewer || !Cesium) return;
    const bm = BASE_MAP_CATALOG.find(b => b.id === bmId);
    if (!bm) return;
    try {
      // Remove all previous base layers (keep data overlay layers — those are added on top)
      // Strategy: remove layers added by this panel (tracked in basemapLayersRef)
      basemapLayersRef.current.forEach(l => {
        try { viewer.imageryLayers.remove(l, true); } catch (_) {}
      });
      basemapLayersRef.current = [];

      const makeProvider = (url, isXYZ = false) => {
        return new Cesium.UrlTemplateImageryProvider({
          url,
          maximumLevel: bm.maxZoom || 19,
          credit: `© ${bm.subtitle}`,
        });
      };

      if (bm.type === "arcgis" || bm.type === "xyz") {
        const prov = makeProvider(bm.tileUrl);
        // Insert at index 0 (bottom) so data layers stay on top
        const il = viewer.imageryLayers.addImageryProvider(prov, 0);
        il.alpha = 1.0;
        basemapLayersRef.current.push(il);

      } else if (bm.type === "arcgis_combo") {
        const base = makeProvider(bm.baseTileUrl);
        const overlay = makeProvider(bm.overlayTileUrl);
        const ilBase = viewer.imageryLayers.addImageryProvider(base, 0);
        ilBase.alpha = 1.0;
        const ilOverlay = viewer.imageryLayers.addImageryProvider(overlay, 1);
        ilOverlay.alpha = 0.7;
        basemapLayersRef.current.push(ilBase, ilOverlay);
      }
    } catch (err) {
      console.warn("[BasemapPanel] Failed to apply basemap:", err.message);
    }
  }, [viewer, Cesium]);

  // ── Apply terrain ──────────────────────────────────────────────────────────
  const applyTerrain = useCallback(async (terrainId) => {
    if (!viewer || !Cesium) return;
    try {
      let terrainProvider;
      switch (terrainId) {
        case "ellipsoid":
          terrainProvider = new Cesium.EllipsoidTerrainProvider();
          break;

        case "cesium_world_terrain":
          // Cesium World Terrain via ion — requires token
          // Set your token: Cesium.Ion.defaultAccessToken = "YOUR_TOKEN";
          try {
            terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
              requestVertexNormals: true,  // enables lighting/shadows on terrain
              requestWaterMask: true,       // enables water animation
            });
          } catch (ionErr) {
            console.warn("[BasemapPanel] CesiumWorldTerrain ion error, falling back to ArcGIS terrain:", ionErr.message);
            terrainProvider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
              "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
            );
          }
          break;

        case "cesium_world_bathymetry":
          try {
            terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(2426648, {
              requestVertexNormals: true,
            });
          } catch (ionErr) {
            console.warn("[BasemapPanel] Bathymetry ion error, falling back:", ionErr.message);
            terrainProvider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
              "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
            );
          }
          break;

        case "arcgis_terrain":
        default:
          // ✅ ESRI ArcGIS Elevation — no auth, CORS open, always works
          terrainProvider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
            "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
          );
          break;
      }

      viewer.terrainProvider = terrainProvider;

      // Apply current exaggeration
      if (viewer.scene.verticalExaggeration !== undefined) {
        viewer.scene.verticalExaggeration = exaggeration;
      }
    } catch (err) {
      console.warn("[BasemapPanel] Failed to apply terrain:", err.message);
    }
  }, [viewer, Cesium, exaggeration]);

  // ── Apply single effect ────────────────────────────────────────────────────
  const applyEffect = useCallback((effectId, on) => {
    if (!viewer || !Cesium) return;
    const eff = EFFECTS_CONFIG.find(e => e.id === effectId);
    if (!eff) return;
    try {
      eff.apply(viewer, Cesium, on);
    } catch (err) {
      console.warn(`[BasemapPanel] Effect ${effectId} error:`, err.message);
    }
  }, [viewer, Cesium]);

  // ── Re-apply exaggeration when changed ────────────────────────────────────
  useEffect(() => {
    if (!viewer) return;
    try {
      if (viewer.scene.verticalExaggeration !== undefined) {
        viewer.scene.verticalExaggeration = exaggeration;
      }
    } catch (_) {}
  }, [exaggeration, viewer]);

  // ── Apply all defaults on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!viewer || !Cesium || !visible) return;
    applyBasemap(activeBasemap);
    applyTerrain(activeTerrain);
    EFFECTS_CONFIG.forEach(e => {
      try { e.apply(viewer, Cesium, effects[e.id]); } catch (_) {}
    });
  }, [viewer, Cesium, visible]); // eslint-disable-line

  // ── Camera preset ──────────────────────────────────────────────────────────
  const applyCamera = useCallback((preset) => {
    if (!viewer || !Cesium) return;
    setActiveCameraPreset(preset.id);
    const center = viewer.camera.positionCartographic;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        center.longitude,
        center.latitude,
        preset.range
      ),
      orientation: {
        heading: viewer.camera.heading,
        pitch: Cesium.Math.toRadians(preset.pitch),
        roll: 0,
      },
      duration: 1.4,
    });
  }, [viewer, Cesium]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (!viewer || viewer.isDestroyed?.()) return;
      basemapLayersRef.current.forEach(l => {
        try { viewer.imageryLayers.remove(l, true); } catch (_) {}
      });
    };
  }, []);

  if (!visible) return null;

  const TABS = [
    { id: "basemap",  label: "Base Map",  icon: "🗺️",  color: "#60a5fa" },
    { id: "terrain",  label: "Terrain",   icon: "⛰️",  color: "#10b981" },
    { id: "effects",  label: "3D Effects",icon: "✨",  color: "#a78bfa" },
  ];

  // Group basemaps
  const bmGroups = [
    { id: "satellite",    label: "Satellite & Imagery", color: "#22c55e",  icon: "🛰️" },
    { id: "street",       label: "Street & Road",       color: "#f97316",  icon: "🗺️" },
    { id: "dark",         label: "Dark & Canvas",       color: "#818cf8",  icon: "🌃" },
    { id: "terrain_base", label: "Terrain & Physical",  color: "#10b981",  icon: "⛰️" },
    { id: "artistic",     label: "Artistic",            color: "#a78bfa",  icon: "🎨" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        .bmp-panel { animation: bmpSlideIn 0.28s cubic-bezier(0.16,1,0.3,1); }
        @keyframes bmpSlideIn { from { opacity:0; transform:translateX(24px); } to { opacity:1; transform:translateX(0); } }
        .bmp-scroll::-webkit-scrollbar { width: 4px; }
        .bmp-scroll::-webkit-scrollbar-track { background: transparent; }
        .bmp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        .bmp-tab:hover { background: rgba(255,255,255,0.05) !important; }
      `}</style>

      {/* Backdrop click-away */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 1198,
        background: "rgba(0,0,0,0.25)", backdropFilter: "blur(2px)",
      }}/>

      {/* Panel */}
      <div className="bmp-panel" style={{
        position: "fixed",
        top: 60,
        right: 14,
        zIndex: 1199,
        width: 360,
        maxHeight: "calc(100vh - 80px)",
        background: "rgba(5,9,20,0.97)",
        backdropFilter: "blur(28px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 16,
        boxShadow: "0 28px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'DM Sans',sans-serif",
      }}>

        {/* ── HEADER ── */}
        <div style={{
          padding: "15px 16px 0",
          background: "rgba(255,255,255,0.015)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "linear-gradient(135deg,rgba(99,102,241,0.5),rgba(16,185,129,0.35))",
                border: "1px solid rgba(99,102,241,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
              }}>🌍</div>
              <div>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>Base Map & Terrain</div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: "'DM Mono',monospace", marginTop: 1 }}>
                  3D Globe Configuration
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{
              width: 28, height: 28, borderRadius: 7,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.4)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={e => { e.currentTarget.style.background="rgba(255,255,255,0.1)"; e.currentTarget.style.color="#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.04)"; e.currentTarget.style.color="rgba(255,255,255,0.4)"; }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 3, paddingBottom: 13 }}>
            {TABS.map(t => {
              const isSel = tab === t.id;
              const rgb = hexToRgb(t.color);
              return (
                <button key={t.id} className="bmp-tab"
                  onClick={() => setTab(t.id)}
                  style={{
                    flex: 1, padding: "7px 4px", borderRadius: 8, cursor: "pointer",
                    border: `1px solid ${isSel ? `rgba(${rgb},0.5)` : "rgba(255,255,255,0.07)"}`,
                    background: isSel ? `rgba(${rgb},0.14)` : "rgba(255,255,255,0.025)",
                    color: isSel ? t.color : "rgba(255,255,255,0.45)",
                    fontSize: 10.5, fontWeight: isSel ? 700 : 500,
                    fontFamily: "'DM Sans',sans-serif",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                    transition: "all 0.15s",
                    boxShadow: isSel ? `0 0 10px rgba(${rgb},0.18)` : "none",
                  }}>
                  <span style={{ fontSize: 12 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="bmp-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 13px" }}>

          {/* ════════════ BASE MAP TAB ════════════ */}
          {tab === "basemap" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {bmGroups.map(grp => {
                const layers = BASE_MAP_CATALOG.filter(b => b.group === grp.id);
                if (!layers.length) return null;
                return (
                  <div key={grp.id}>
                    <SectionHeader icon={grp.icon} title={grp.label} count={layers.length} color={grp.color} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {layers.map(bm => (
                        <BasemapCard
                          key={bm.id} bm={bm}
                          isActive={activeBasemap === bm.id}
                          onClick={() => {
                            setActiveBasemap(bm.id);
                            applyBasemap(bm.id);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ════════════ TERRAIN TAB ════════════ */}
          {tab === "terrain" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Terrain Providers */}
              <div>
                <SectionHeader icon="🏔️" title="ELEVATION PROVIDERS" color="#10b981" />
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {TERRAIN_CATALOG.map(t => (
                    <TerrainCard
                      key={t.id} t={t}
                      isActive={activeTerrain === t.id}
                      onClick={() => {
                        setActiveTerrain(t.id);
                        applyTerrain(t.id);
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Vertical Exaggeration */}
              <div>
                <SectionHeader icon="📐" title="VERTICAL EXAGGERATION" color="#f59e0b" />
                <div style={{
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 10,
                }}>
                  <div style={{
                    color: "rgba(255,255,255,0.4)", fontSize: 9.5,
                    fontFamily: "'DM Sans',sans-serif", marginBottom: 10, lineHeight: 1.5,
                  }}>
                    Amplify terrain height for dramatic 3D effect. Real scale = 1×. Mountains become more visible at higher values.
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {EXAGGERATION_LEVELS.map(lvl => {
                      const isActive = exaggeration === lvl.value;
                      return (
                        <button
                          key={lvl.value}
                          onClick={() => setExaggeration(lvl.value)}
                          style={{
                            flex: 1, padding: "7px 2px", borderRadius: 7, cursor: "pointer",
                            border: `1px solid ${isActive ? "rgba(245,158,11,0.55)" : "rgba(255,255,255,0.08)"}`,
                            background: isActive ? "rgba(245,158,11,0.14)" : "rgba(255,255,255,0.025)",
                            color: isActive ? "#f59e0b" : "rgba(255,255,255,0.45)",
                            transition: "all 0.15s",
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                          }}>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{lvl.label}</span>
                          <span style={{ fontSize: 8.5, opacity: 0.65, fontFamily: "'DM Sans',sans-serif" }}>{lvl.sublabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Camera Tilt Presets */}
              <div>
                <SectionHeader icon="📷" title="CAMERA ANGLE" color="#60a5fa" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                  {CAMERA_PRESETS.map(cp => {
                    const isActive = activeCameraPreset === cp.id;
                    return (
                      <button
                        key={cp.id}
                        onClick={() => applyCamera(cp)}
                        style={{
                          padding: "10px 8px", borderRadius: 8, cursor: "pointer",
                          border: `1px solid ${isActive ? "rgba(96,165,250,0.55)" : "rgba(255,255,255,0.07)"}`,
                          background: isActive ? "rgba(96,165,250,0.12)" : "rgba(255,255,255,0.025)",
                          color: isActive ? "#60a5fa" : "rgba(255,255,255,0.55)",
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                          transition: "all 0.15s",
                        }}>
                        <span style={{ fontSize: 18 }}>{cp.icon}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>{cp.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{
                  marginTop: 8, padding: "7px 10px",
                  background: "rgba(96,165,250,0.05)", border: "1px solid rgba(96,165,250,0.12)",
                  borderRadius: 7, color: "rgba(255,255,255,0.3)", fontSize: 9.5,
                  fontFamily: "'DM Sans',sans-serif",
                }}>
                  💡 Tip: Hold right-click and drag on the 3D globe to tilt the camera view manually
                </div>
              </div>
            </div>
          )}

          {/* ════════════ EFFECTS TAB ════════════ */}
          {tab === "effects" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Scene Effects */}
              <div>
                <SectionHeader icon="✨" title="SCENE EFFECTS" color="#a78bfa" />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {EFFECTS_CONFIG.map(eff => (
                    <EffectRow
                      key={eff.id}
                      effect={eff}
                      enabled={effects[eff.id]}
                      onChange={(on) => {
                        setEffects(p => ({ ...p, [eff.id]: on }));
                        applyEffect(eff.id, on);
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Quick Presets */}
              <div>
                <SectionHeader icon="🎬" title="QUICK PRESETS" color="#f97316" />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    {
                      label: "Cinematic",
                      desc: "Atmosphere + fog + sun lighting + FXAA for stunning visuals",
                      icon: "🎬",
                      color: "#f97316",
                      settings: { atmosphere: true, fog: true, sun_lighting: true, shadows: false, sky_box: true, underwater: false, fxaa: true, hdr: true },
                    },
                    {
                      label: "Analysis Mode",
                      desc: "Clean flat look — all effects off for precise data reading",
                      icon: "🔬",
                      color: "#60a5fa",
                      settings: { atmosphere: false, fog: false, sun_lighting: false, shadows: false, sky_box: false, underwater: false, fxaa: true, hdr: false },
                    },
                    {
                      label: "Deep Ocean",
                      desc: "Underwater translucency + bathymetry — explore the ocean floor",
                      icon: "🌊",
                      color: "#0ea5e9",
                      settings: { atmosphere: true, fog: true, sun_lighting: true, shadows: false, sky_box: true, underwater: true, fxaa: true, hdr: false },
                    },
                    {
                      label: "Night Mode",
                      desc: "Night lights visible — dark atmosphere + starfield sky",
                      icon: "🌙",
                      color: "#818cf8",
                      settings: { atmosphere: true, fog: false, sun_lighting: false, shadows: false, sky_box: true, underwater: false, fxaa: true, hdr: false },
                    },
                  ].map(preset => (
                    <div
                      key={preset.label}
                      onClick={() => {
                        setEffects(preset.settings);
                        Object.entries(preset.settings).forEach(([id, on]) => applyEffect(id, on));
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                        border: `1px solid rgba(${hexToRgb(preset.color)},0.2)`,
                        background: `rgba(${hexToRgb(preset.color)},0.05)`,
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = `rgba(${hexToRgb(preset.color)},0.10)`; e.currentTarget.style.borderColor = `rgba(${hexToRgb(preset.color)},0.4)`; }}
                      onMouseLeave={e => { e.currentTarget.style.background = `rgba(${hexToRgb(preset.color)},0.05)`; e.currentTarget.style.borderColor = `rgba(${hexToRgb(preset.color)},0.2)`; }}
                    >
                      <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{preset.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: preset.color, fontWeight: 700, fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>{preset.label}</div>
                        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 9.5, fontFamily: "'DM Sans',sans-serif", marginTop: 1 }}>{preset.desc}</div>
                      </div>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={preset.color} strokeWidth="2" style={{ opacity: 0.6 }}>
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                  ))}
                </div>
              </div>

              {/* Active Effects Summary */}
              <div style={{
                padding: "10px 12px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
              }}>
                <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8, fontFamily: "'DM Sans',sans-serif" }}>
                  ACTIVE EFFECTS
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {EFFECTS_CONFIG.filter(e => effects[e.id]).map(e => (
                    <span key={e.id} style={{
                      padding: "2px 8px", borderRadius: 12,
                      background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
                      color: "#a5b4fc", fontSize: 9.5, fontFamily: "'DM Sans',sans-serif",
                    }}>
                      {e.icon} {e.title}
                    </span>
                  ))}
                  {EFFECTS_CONFIG.every(e => !effects[e.id]) && (
                    <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 9.5, fontFamily: "'DM Sans',sans-serif" }}>No effects active</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div style={{
          padding: "8px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.01)",
          flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.2)", fontSize: 9.5, fontFamily: "'DM Sans',sans-serif" }}>
              <span>🗺️</span> {BASE_MAP_CATALOG.length} basemaps
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.2)", fontSize: 9.5, fontFamily: "'DM Sans',sans-serif" }}>
              <span>⛰️</span> {TERRAIN_CATALOG.length} terrain sources
            </span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 9, fontFamily: "'DM Mono',monospace" }}>
            3D Globe
          </span>
        </div>
      </div>
    </>
  );
}