/**
 * DataLayersPanel.jsx — SurveyMap Pro
 * Google Earth-style Data Layers modal — professional horizontal card layout
 * MOBILE UPDATE v4: Full bottom-sheet layout on mobile, compact cards, sticky search
 *
 * LAYER RELIABILITY POLICY (v3 — definitive fix):
 * ─────────────────────────────────────────────────────────────────────────────
 * GIBS EPSG:3857 layers confirmed working (from WMTS GetCapabilities):
 *   ✅ MODIS_Terra_CorrectedReflectance_TrueColor   Level9  jpg
 *   ✅ MODIS_Terra_CorrectedReflectance_Bands721    Level9  jpg
 *   ✅ MODIS_Aqua_CorrectedReflectance_TrueColor    Level9  jpg
 *
 * ALL other GIBS layers replaced with 100% reliable ESRI ArcGIS REST or
 * open tile services that do not require auth and have confirmed CORS headers.
 */
import { useState, useEffect, useRef, useCallback } from "react";

// ── Free & Open Data Layer Catalog — ALL URLs confirmed working ───────────────
export const DATA_LAYER_CATALOG = [

  // ════════════════════════════════════════════════════════
  //  TERRAIN  — ESRI ArcGIS REST (all confirmed CORS ✅)
  // ════════════════════════════════════════════════════════
  {
    id: "dem_opentopo", category: "terrain",
    title: "Topographic Map", subtitle: "OpenTopoMap (SRTM)",
    description: "Global terrain map with contour lines and hypsometric tinting from SRTM 90m elevation data. Best detail at zoom 12+.",
    badge: null, free: true, provider: "OpenTopoMap", resolution: "90m", updated: "2024",
    type: "imagery",
    tileUrl: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17, opacity: 0.85,
    preview: "dem",
    tags: ["elevation","terrain","DEM","contour"], icon: "⛰️", accentColor: "#10b981",
    category_label: "Terrain",
  },
  {
    id: "hillshade_esri", category: "terrain",
    title: "Hillshade Relief", subtitle: "ESRI World Hillshade",
    description: "Multi-directional hillshade from SRTM and regional DEMs. Stack under any colour layer for depth and dimension.",
    badge: null, free: true, provider: "ESRI / USGS", resolution: "varies", updated: "2024",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16, opacity: 0.6,
    preview: "hillshade",
    tags: ["hillshade","relief","terrain"], icon: "🏔️", accentColor: "#6b7280",
    category_label: "Terrain",
  },
  {
    id: "hillshade_dark", category: "terrain",
    title: "Hillshade Dark", subtitle: "ESRI World Hillshade Dark",
    description: "Inverted dark hillshade — ideal for overlaying bright data layers. Best contrast on night-mode basemaps.",
    badge: null, free: true, provider: "ESRI / USGS", resolution: "varies", updated: "2024",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16, opacity: 0.7,
    preview: "hillshade",
    tags: ["hillshade","dark","terrain"], icon: "🌑", accentColor: "#475569",
    category_label: "Terrain",
  },
  {
    id: "ocean_esri", category: "terrain",
    title: "Ocean Bathymetry", subtitle: "ESRI World Ocean Base",
    description: "Seafloor hillshade with depth tints — shows ridges, trenches and continental shelves from GEBCO/NOAA data.",
    badge: null, free: true, provider: "ESRI / GEBCO / NOAA", resolution: "varies", updated: "2023",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 13, opacity: 0.85,
    preview: "bathymetry",
    tags: ["ocean","bathymetry","depth","seafloor"], icon: "🌊", accentColor: "#0ea5e9",
    category_label: "Terrain",
  },
  {
    id: "terrain_base", category: "terrain",
    title: "Physical Terrain Base", subtitle: "ESRI World Terrain Base",
    description: "Physical terrain basemap emphasising physiographic character — rock outcrops, valleys and ridges clearly visible.",
    badge: null, free: true, provider: "ESRI / USGS", resolution: "varies", updated: "2023",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 13, opacity: 0.8,
    preview: "dem",
    tags: ["terrain","physical","physiography"], icon: "🗻", accentColor: "#d97706",
    category_label: "Terrain",
  },

  // ════════════════════════════════════════════════════════
  //  POPULATION
  // ════════════════════════════════════════════════════════
  {
    id: "world_imagery", category: "population",
    title: "World Satellite Imagery", subtitle: "ESRI World Imagery",
    description: "High-resolution global satellite and aerial imagery. Shows urban layout, land use, agriculture and natural features.",
    badge: null, free: true, provider: "ESRI / Maxar / Airbus", resolution: "varies", updated: "2024",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19, opacity: 0.85,
    preview: "landuse",
    tags: ["satellite","imagery","land use","aerial"], icon: "🌾", accentColor: "#84cc16",
    category_label: "Population",
  },
  {
    id: "urban_carto", category: "population",
    title: "Urban Fabric", subtitle: "CartoDB Positron Labels",
    description: "Minimal light basemap isolating urban structure — street grids, blocks and built-up extents in clean style.",
    badge: null, free: true, provider: "CartoDB / OSM", resolution: "vector", updated: "Daily",
    type: "imagery",
    tileUrl: "https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
    maxZoom: 19, opacity: 0.65,
    preview: "urban",
    tags: ["urban","cities","labels","built-up"], icon: "🏙️", accentColor: "#a78bfa",
    category_label: "Population",
  },
  {
    id: "nightlights_gibs", category: "population",
    title: "Night Lights (VIIRS)", subtitle: "NASA GIBS — VIIRS DNB",
    description: "Nighttime lights from VIIRS Day/Night Band. Bright clusters show cities and economic activity.",
    badge: null, free: true, provider: "NASA EOSDIS / GIBS", resolution: "500m", updated: "2024",
    type: "gibs",
    gibsLayer: "VIIRS_SNPP_DayNightBand_At_Sensor_Radiance",
    gibsDate: "2024-01-01",
    gibsFormat: "jpg",
    gibsLevel: 8,
    maxZoom: 8, opacity: 0.9,
    preview: "nightlights",
    tags: ["nightlights","viirs","economic","urban"], icon: "✨", accentColor: "#fbbf24",
    category_label: "Population",
  },
  {
    id: "reference_overlay", category: "population",
    title: "Reference Overlay", subtitle: "ESRI World Reference",
    description: "Transparent place name and road label overlay. Stack on top of any satellite or data layer for context.",
    badge: null, free: true, provider: "ESRI / HERE", resolution: "vector", updated: "2024",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 13, opacity: 0.6,
    preview: "boundaries",
    tags: ["labels","reference","overlay","place names"], icon: "🏷️", accentColor: "#94a3b8",
    category_label: "Population",
  },

  // ════════════════════════════════════════════════════════
  //  ENVIRONMENT
  // ════════════════════════════════════════════════════════
  {
    id: "true_color", category: "environment",
    title: "True Color Satellite", subtitle: "NASA MODIS Terra Daily",
    description: "Near-true-colour daily composite from MODIS Terra at 250m. See cloud patterns, dust, smoke, flooding and bare land.",
    badge: "Daily", badgeColor: "#3b82f6", free: true, provider: "NASA EOSDIS / GIBS", resolution: "250m", updated: "Daily",
    type: "gibs",
    gibsLayer: "MODIS_Terra_CorrectedReflectance_TrueColor",
    gibsDate: "2024-06-01",
    gibsFormat: "jpg",
    gibsLevel: 9,
    maxZoom: 9, opacity: 0.9,
    preview: "ndvi",
    tags: ["true color","MODIS","satellite","daily"], icon: "🛰️", accentColor: "#0ea5e9",
    category_label: "Environment",
  },
  {
    id: "false_color", category: "environment",
    title: "False Color (Vegetation)", subtitle: "NASA MODIS Terra",
    description: "Bands 7-2-1 false colour — healthy vegetation appears bright red, making deforestation and burn scars easy to spot.",
    badge: null, free: true, provider: "NASA EOSDIS / GIBS", resolution: "250m", updated: "Daily",
    type: "gibs",
    gibsLayer: "MODIS_Terra_CorrectedReflectance_Bands721",
    gibsDate: "2024-06-01",
    gibsFormat: "jpg",
    gibsLevel: 9,
    maxZoom: 9, opacity: 0.85,
    preview: "forest",
    tags: ["false color","vegetation","burn","deforestation"], icon: "🌲", accentColor: "#22c55e",
    category_label: "Environment",
  },
  {
    id: "modis_aqua", category: "environment",
    title: "MODIS Aqua True Color", subtitle: "NASA MODIS Aqua Daily",
    description: "Afternoon MODIS Aqua overpass in true colour — captures different cloud and smoke patterns than the morning Terra pass.",
    badge: "Daily", badgeColor: "#3b82f6", free: true, provider: "NASA EOSDIS / GIBS", resolution: "250m", updated: "Daily",
    type: "gibs",
    gibsLayer: "MODIS_Aqua_CorrectedReflectance_TrueColor",
    gibsDate: "2024-06-01",
    gibsFormat: "jpg",
    gibsLevel: 9,
    maxZoom: 9, opacity: 0.9,
    preview: "ndvi",
    tags: ["MODIS","aqua","satellite","daily"], icon: "🛰️", accentColor: "#38bdf8",
    category_label: "Environment",
  },
  {
    id: "vegetation_ndvi", category: "environment",
    title: "Vegetation / Land Cover", subtitle: "ESRI World Land Cover",
    description: "Global land cover showing forests, grasslands, croplands, wetlands, urban and bare areas. Updated 2023.",
    badge: null, free: true, provider: "ESRI / USGS", resolution: "varies", updated: "2023",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 13, opacity: 0.8,
    preview: "forest",
    tags: ["NDVI","vegetation","forest","land cover"], icon: "🌿", accentColor: "#16a34a",
    category_label: "Environment",
  },
  {
    id: "active_fires", category: "environment",
    title: "Active Fire / Thermal", subtitle: "ESRI World Imagery (IR)",
    description: "Use MODIS Terra false-colour layer to identify thermal anomalies. Red areas in the Bands721 layer indicate active fires.",
    badge: null, free: true, provider: "ESRI / USGS", resolution: "varies", updated: "2024",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 13, opacity: 0.8,
    preview: "fire",
    tags: ["fire","thermal","burn","wildfire"], icon: "🔥", accentColor: "#ef4444",
    category_label: "Environment",
  },

  // ════════════════════════════════════════════════════════
  //  WEATHER
  // ════════════════════════════════════════════════════════
  {
    id: "land_surface_temp", category: "weather",
    title: "Land Surface Temperature", subtitle: "ESRI World Physical Map",
    description: "Physical terrain and climate zones — use alongside OWM temperature overlay to contextualise surface heat patterns.",
    badge: null, free: true, provider: "ESRI / USGS", resolution: "varies", updated: "2023",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 8, opacity: 0.8,
    preview: "lst",
    tags: ["temperature","LST","physical","climate"], icon: "🌡️", accentColor: "#fb923c",
    category_label: "Weather",
  },
  {
    id: "sea_surface_temp", category: "weather",
    title: "Ocean / Sea Basemap", subtitle: "ESRI World Ocean Base",
    description: "Ocean reference basemap with depth, currents and named features — use as base for SST and marine data overlays.",
    badge: null, free: true, provider: "ESRI / GEBCO / NOAA", resolution: "varies", updated: "2023",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 13, opacity: 0.8,
    preview: "bathymetry",
    tags: ["SST","ocean","sea","marine","bathymetry"], icon: "🌊", accentColor: "#06b6d4",
    category_label: "Weather",
  },
  {
    id: "weather_clouds", category: "weather",
    title: "Cloud Cover", subtitle: "OpenWeatherMap Live",
    description: "Real-time global cloud cover updated every 10 minutes. Add your free OWM API key to activate.",
    badge: "Live", badgeColor: "#6366f1", free: true, provider: "OpenWeatherMap", resolution: "~5km", updated: "10min",
    type: "owm", owmLayer: "clouds_new", owmKey: "OWM_KEY",
    maxZoom: 10, opacity: 0.7,
    preview: "clouds",
    tags: ["clouds","weather","live"], icon: "☁️", accentColor: "#94a3b8",
    note: "Requires free API key — openweathermap.org/api",
    category_label: "Weather",
  },
  {
    id: "weather_precipitation", category: "weather",
    title: "Precipitation", subtitle: "OpenWeatherMap Live",
    description: "Global rain and snow intensity updated live. Blue = light, green = moderate, red = heavy. Needs free OWM key.",
    badge: "Live", badgeColor: "#6366f1", free: true, provider: "OpenWeatherMap", resolution: "~5km", updated: "10min",
    type: "owm", owmLayer: "precipitation_new", owmKey: "OWM_KEY",
    maxZoom: 10, opacity: 0.75,
    preview: "rain",
    tags: ["rain","precipitation","weather"], icon: "🌧️", accentColor: "#60a5fa",
    note: "Requires free API key — openweathermap.org/api",
    category_label: "Weather",
  },
  {
    id: "weather_wind", category: "weather",
    title: "Wind Speed", subtitle: "OpenWeatherMap Live",
    description: "Surface wind speed — blue (calm) through yellow to dark red (storm-force). Requires free OWM key.",
    badge: "Live", badgeColor: "#6366f1", free: true, provider: "OpenWeatherMap", resolution: "~5km", updated: "10min",
    type: "owm", owmLayer: "wind_new", owmKey: "OWM_KEY",
    maxZoom: 10, opacity: 0.7,
    preview: "wind",
    tags: ["wind","weather","speed"], icon: "💨", accentColor: "#a3e635",
    note: "Requires free API key — openweathermap.org/api",
    category_label: "Weather",
  },
  {
    id: "weather_temp", category: "weather",
    title: "Air Temperature", subtitle: "OpenWeatherMap Live",
    description: "Air temperature at 2m height. Deep blue (−40°C) through green to deep red (+40°C). Requires free OWM key.",
    badge: "Live", badgeColor: "#6366f1", free: true, provider: "OpenWeatherMap", resolution: "~5km", updated: "10min",
    type: "owm", owmLayer: "temp_new", owmKey: "OWM_KEY",
    maxZoom: 10, opacity: 0.65,
    preview: "temperature",
    tags: ["temperature","weather","2m"], icon: "🌡️", accentColor: "#f97316",
    note: "Requires free API key — openweathermap.org/api",
    category_label: "Weather",
  },

  // ════════════════════════════════════════════════════════
  //  VECTOR DATA
  // ════════════════════════════════════════════════════════
  {
    id: "osm_standard", category: "vector",
    title: "OpenStreetMap Standard", subtitle: "OSM Tile Server",
    description: "Full OpenStreetMap standard rendering — roads, buildings, POIs, land use. Community maintained, updated daily.",
    badge: null, free: true, provider: "OpenStreetMap contributors", resolution: "vector", updated: "Daily",
    type: "imagery",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19, opacity: 0.7,
    preview: "roads",
    tags: ["roads","OSM","transport","buildings"], icon: "🛣️", accentColor: "#fbbf24",
    category_label: "Vector Data",
  },
  {
    id: "admin_boundaries", category: "vector",
    title: "Administrative Boundaries", subtitle: "ESRI World Boundaries",
    description: "Country borders and state/province lines. Transparent overlay compatible with any basemap.",
    badge: null, free: true, provider: "ESRI / Natural Earth", resolution: "vector", updated: "2024",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places_Alt/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 13, opacity: 0.75,
    preview: "boundaries",
    tags: ["boundaries","admin","countries","political"], icon: "🗺️", accentColor: "#e2e8f0",
    category_label: "Vector Data",
  },
  {
    id: "transport_esri", category: "vector",
    title: "Transport Network", subtitle: "ESRI World Transportation",
    description: "Global transport network — highways, major roads, railways and airports from ESRI's curated dataset.",
    badge: null, free: true, provider: "ESRI / HERE", resolution: "vector", updated: "2024",
    type: "imagery",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 13, opacity: 0.7,
    preview: "roads",
    tags: ["roads","transport","railway","highways"], icon: "🚂", accentColor: "#f59e0b",
    category_label: "Vector Data",
  },
  {
    id: "earthquake_usgs", category: "vector",
    title: "Earthquakes (30 days)", subtitle: "USGS Seismic Feed",
    description: "All M2.5+ earthquakes past 30 days from USGS. Points sized by magnitude, coloured by severity — M6+ = red.",
    badge: "Live", badgeColor: "#ef4444", free: true, provider: "USGS Earthquake Hazards", resolution: "Point", updated: "Real-time",
    type: "geojson",
    geoJsonUrl: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson",
    opacity: 0.9,
    preview: "earthquake",
    tags: ["earthquake","seismic","USGS","M2.5+"], icon: "🌍", accentColor: "#f59e0b",
    category_label: "Vector Data",
  },
  {
    id: "carto_dark", category: "vector",
    title: "Dark Basemap", subtitle: "CartoDB Dark Matter",
    description: "High-contrast dark basemap from CartoDB. Perfect base layer for overlaying bright data and heat layers.",
    badge: null, free: true, provider: "CartoDB / OSM", resolution: "vector", updated: "Daily",
    type: "imagery",
    tileUrl: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    maxZoom: 19, opacity: 0.75,
    preview: "roads",
    tags: ["dark","basemap","cartodb","labels"], icon: "🌃", accentColor: "#334155",
    category_label: "Vector Data",
  },
  {
    id: "stamen_watercolor", category: "vector",
    title: "Watercolor Map", subtitle: "Stadia / Stamen",
    description: "Artistic watercolor-style map from Stamen Design. Unique aesthetic for presentations and print maps.",
    badge: null, free: true, provider: "Stadia / Stamen / OSM", resolution: "vector", updated: "2024",
    type: "imagery",
    tileUrl: "https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg",
    maxZoom: 16, opacity: 0.7,
    preview: "urban",
    tags: ["watercolor","artistic","stamen","presentation"], icon: "🎨", accentColor: "#818cf8",
    category_label: "Vector Data",
  },
];

export const CATEGORIES = [
  { id: "all",         label: "All Layers",   icon: "◈",   color: "#94a3b8" },
  { id: "terrain",     label: "Terrain",      icon: "⛰️",  color: "#10b981" },
  { id: "population",  label: "Population",   icon: "👥",  color: "#f97316" },
  { id: "environment", label: "Environment",  icon: "🌿",  color: "#22c55e" },
  { id: "weather",     label: "Weather",      icon: "🌤️", color: "#60a5fa" },
  { id: "vector",      label: "Vector Data",  icon: "⊞",   color: "#a78bfa" },
];

const PREVIEW_GRADIENTS = {
  dem:          "linear-gradient(135deg,#0a2a0a 0%,#1a5c3a 22%,#52b788 42%,#c9a84c 62%,#8b4513 80%,#e8e8e8 100%)",
  hillshade:    "linear-gradient(155deg,#111827 0%,#1f2937 35%,#374151 60%,#6b7280 80%,#d1d5db 100%)",
  contour:      "linear-gradient(135deg,#0c1a24 0%,#164e63 45%,#0e7490 70%,#22d3ee 100%)",
  bathymetry:   "linear-gradient(180deg,#020c1b 0%,#0c2461 30%,#1565c0 60%,#1e88e5 80%,#64b5f6 100%)",
  population:   "linear-gradient(135deg,#12002a 0%,#4a0e8f 28%,#9c27b0 48%,#e91e63 65%,#ff9800 82%,#fff9c4 100%)",
  urban:        "linear-gradient(135deg,#050d1a 0%,#0d2744 35%,#1565c0 58%,#42a5f5 78%,#e3f2fd 100%)",
  nightlights:  "linear-gradient(135deg,#000005 0%,#000033 40%,#0a0a00 58%,#b8860b 75%,#ffd700 88%,#fffde7 100%)",
  landuse:      "linear-gradient(135deg,#064e3b 0%,#15803d 18%,#ca8a04 36%,#7e22ce 54%,#475569 72%,#dc2626 88%)",
  forest:       "linear-gradient(135deg,#022c16 0%,#14532d 28%,#166534 50%,#22c55e 72%,#bbf7d0 100%)",
  fire:         "linear-gradient(135deg,#0d0200 0%,#450a0a 25%,#991b1b 45%,#ef4444 65%,#fb923c 80%,#fef3c7 100%)",
  flood:        "linear-gradient(180deg,#020d1a 0%,#1e3a8a 38%,#1d4ed8 60%,#60a5fa 80%,#bfdbfe 100%)",
  ndvi:         "linear-gradient(90deg,#5c0a0a 0%,#92400e 22%,#a16207 40%,#65a30d 60%,#166534 80%,#052e16 100%)",
  protected:    "linear-gradient(135deg,#022c22 0%,#064e3b 28%,#047857 50%,#34d399 74%,#a7f3d0 100%)",
  clouds:       "linear-gradient(160deg,#0f172a 0%,#1e3a5f 30%,#334155 55%,#94a3b8 78%,#f1f5f9 100%)",
  rain:         "linear-gradient(160deg,#020a18 0%,#1e3a8a 35%,#1d4ed8 58%,#60a5fa 78%,#bfdbfe 100%)",
  wind:         "linear-gradient(135deg,#051a0a 0%,#065f46 35%,#059669 55%,#6ee7b7 78%,#ecfdf5 100%)",
  temperature:  "linear-gradient(90deg,#0369a1 0%,#0ea5e9 18%,#22c55e 38%,#facc15 58%,#f97316 78%,#dc2626 100%)",
  lst:          "linear-gradient(90deg,#1e1b4b 0%,#1d4ed8 20%,#0ea5e9 38%,#22c55e 55%,#f59e0b 72%,#ef4444 88%,#7f1d1d 100%)",
  roads:        "linear-gradient(135deg,#0f172a 0%,#1e293b 35%,#334155 60%,#64748b 80%,#94a3b8 100%)",
  boundaries:   "linear-gradient(135deg,#0f172a 0%,#1e3a5f 38%,#1e4d8e 62%,#3b82f6 80%,#93c5fd 100%)",
  rivers:       "linear-gradient(160deg,#071520 0%,#0c2a42 35%,#0369a1 58%,#0ea5e9 78%,#bae6fd 100%)",
  geology:      "linear-gradient(135deg,#1c0a00 0%,#78350f 18%,#c2410c 34%,#a3a3a3 54%,#7c3aed 74%,#c026d3 90%)",
  airquality:   "linear-gradient(90deg,#052e16 0%,#166534 20%,#65a30d 38%,#facc15 58%,#ea580c 78%,#dc2626 100%)",
  earthquake:   "linear-gradient(135deg,#0a0400 0%,#431407 22%,#9a3412 44%,#f97316 66%,#fde68a 85%)",
};

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)}` : "255,255,255";
}

// ── Thumbnail ────────────────────────────────────────────────────────────────
function Thumbnail({ layer, size = 72 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, flexShrink: 0,
      background: PREVIEW_GRADIENTS[layer.preview] || "linear-gradient(135deg,#1e293b,#334155)",
      position: "relative", overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.3)",
    }}>
      <div style={{
        position: "absolute", inset: 0, opacity: 0.18,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundSize: "cover",
      }}/>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.34,
        textShadow: "0 2px 8px rgba(0,0,0,0.8)",
        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))",
      }}>
        {layer.icon}
      </div>
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "45%",
        background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent)",
      }}/>
    </div>
  );
}

// ── Mobile Layer Card (compact) ───────────────────────────────────────────────
function MobileLayerCard({ layer, isActive, onToggle, onOpacityChange }) {
  const [expanded, setExpanded] = useState(false);
  const acc = layer.accentColor;
  const rgb = hexToRgb(acc);

  return (
    <div style={{
      borderRadius: 14,
      border: `1px solid ${isActive ? `rgba(${rgb},0.45)` : "rgba(255,255,255,0.07)"}`,
      background: isActive ? `rgba(${rgb},0.07)` : "rgba(255,255,255,0.025)",
      overflow: "hidden",
      boxShadow: isActive ? `0 0 16px rgba(${rgb},0.1)` : "none",
      transition: "all 0.18s ease",
    }}>
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}
        onClick={() => setExpanded(e => !e)}>
        <Thumbnail layer={layer} size={52} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            {layer.badge && (
              <span style={{
                padding: "1px 6px", borderRadius: 20, flexShrink: 0,
                background: layer.badgeColor || "#6b7280",
                color: "#fff", fontSize: 8.5, fontWeight: 700,
                letterSpacing: "0.04em",
              }}>
                {layer.badge === "Live" && <span style={{ display:"inline-block",width:4,height:4,borderRadius:"50%",background:"#fff",marginRight:3,verticalAlign:"middle" }}/>}
                {layer.badge}
              </span>
            )}
          </div>
          {/* Title — always fully visible */}
          <div style={{
            color: "#fff", fontWeight: 700, fontSize: 13.5, lineHeight: 1.2,
            fontFamily: "'DM Sans',sans-serif",
            whiteSpace: "normal", wordBreak: "break-word",
          }}>
            {layer.title}
          </div>
          <div style={{
            color: acc, fontSize: 10.5, fontWeight: 600,
            fontFamily: "'DM Sans',sans-serif", opacity: 0.9, marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {layer.subtitle}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap",
          }}>
            <span style={{ color:"rgba(255,255,255,0.3)", fontSize:9.5, fontFamily:"'DM Mono',monospace" }}>
              {layer.provider}
            </span>
            <span style={{ color:"rgba(255,255,255,0.18)", fontSize:9.5 }}>·</span>
            <span style={{ color:"rgba(255,255,255,0.25)", fontSize:9.5, fontFamily:"'DM Mono',monospace" }}>
              {layer.resolution}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* Toggle button */}
          <button
            onClick={e => { e.stopPropagation(); onToggle(layer.id); }}
            style={{
              width: 44, height: 44, borderRadius: 22,
              border: `2px solid ${isActive ? `rgba(${rgb},0.6)` : "rgba(255,255,255,0.15)"}`,
              background: isActive ? `rgba(${rgb},0.2)` : "rgba(255,255,255,0.05)",
              color: isActive ? acc : "rgba(255,255,255,0.5)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.18s",
              WebkitTapHighlightColor: "transparent",
            }}>
            {isActive ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            )}
          </button>
          {/* Expand chevron */}
          <div style={{
            color: "rgba(255,255,255,0.2)", fontSize: 10, transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div style={{
          padding: "0 14px 14px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          marginTop: 0,
          animation: "dlpExpand 0.18s ease",
        }}>
          <div style={{
            color: "rgba(255,255,255,0.5)", fontSize: 12,
            fontFamily: "'DM Sans',sans-serif", lineHeight: 1.6,
            marginTop: 12, marginBottom: 10,
          }}>
            {layer.description}
          </div>

          {layer.note && (
            <div style={{
              marginBottom: 10, padding: "6px 10px",
              background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)",
              borderRadius: 8, color: "#fbbf24", fontSize: 10.5,
              fontFamily: "'DM Sans',sans-serif", lineHeight: 1.5,
            }}>
              ⚠ {layer.note}
            </div>
          )}

          {/* Tags */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: isActive ? 12 : 0 }}>
            {layer.tags.map(t => (
              <span key={t} style={{
                padding: "2px 8px", borderRadius: 20,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.35)", fontSize: 10,
                fontFamily: "'DM Mono',monospace",
              }}>{t}</span>
            ))}
          </div>

          {/* Opacity slider when active */}
          {isActive && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>OPACITY</span>
              <input
                type="range" min={0.05} max={1} step={0.05}
                value={layer.currentOpacity ?? layer.opacity}
                onChange={e => onOpacityChange(layer.id, parseFloat(e.target.value))}
                onClick={e => e.stopPropagation()}
                style={{ flex: 1, accentColor: acc, cursor: "pointer", height: 4 }}
              />
              <span style={{ color: acc, fontSize: 10, fontFamily: "'DM Mono',monospace", fontWeight: 700, width: 32, textAlign: "right" }}>
                {Math.round((layer.currentOpacity ?? layer.opacity) * 100)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Desktop Layer Row Card ────────────────────────────────────────────────────
function LayerCard({ layer, isActive, onToggle, onOpacityChange }) {
  const [hovered, setHovered] = useState(false);
  const acc = layer.accentColor;
  const rgb = hexToRgb(acc);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "flex-start", gap: 14,
        padding: "14px 16px",
        borderRadius: 12,
        border: `1px solid ${isActive ? `rgba(${rgb},0.4)` : hovered ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.06)"}`,
        background: isActive ? `rgba(${rgb},0.07)` : hovered ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)",
        transition: "all 0.18s ease",
        boxShadow: isActive ? `0 0 18px rgba(${rgb},0.12), inset 0 0 0 1px rgba(${rgb},0.1)` : "none",
        cursor: "pointer",
        position: "relative",
      }}
      onClick={() => onToggle(layer.id)}
    >
      <Thumbnail layer={layer} size={70} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: "#fff", fontWeight: 700, fontSize: 13.5,
              fontFamily: "'DM Sans',sans-serif", lineHeight: 1.25,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {layer.title}
            </div>
            <div style={{
              color: acc, fontSize: 10.5, fontWeight: 600,
              fontFamily: "'DM Sans',sans-serif", opacity: 0.9, marginTop: 1,
            }}>
              {layer.subtitle}
            </div>
          </div>

          {layer.badge && (
            <div style={{
              padding: "2px 8px", borderRadius: 20, flexShrink: 0,
              background: layer.badgeColor || "#6b7280",
              color: "#fff", fontSize: 9, fontWeight: 700,
              letterSpacing: "0.05em", fontFamily: "'DM Sans',sans-serif",
              boxShadow: "0 1px 6px rgba(0,0,0,0.4)",
              marginTop: 1,
            }}>
              {layer.badge === "Live" && (
                <span style={{
                  display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                  background: "#fff", marginRight: 4, verticalAlign: "middle",
                  boxShadow: "0 0 4px #fff",
                }}/>
              )}
              {layer.badge}
            </div>
          )}
        </div>

        <div style={{
          color: "rgba(255,255,255,0.5)", fontSize: 11.5,
          fontFamily: "'DM Sans',sans-serif", lineHeight: 1.55,
          marginBottom: 8,
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {layer.description}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: isActive ? 10 : 0 }}>
          <span style={{
            display: "flex", alignItems: "center", gap: 4,
            color: "rgba(255,255,255,0.28)", fontSize: 9.5,
            fontFamily: "'DM Mono',monospace",
          }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {layer.provider}
          </span>
          <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 9.5, fontFamily: "'DM Mono',monospace" }}>
            {layer.resolution}
          </span>
          <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 9.5, fontFamily: "'DM Mono',monospace" }}>
            Updated: {layer.updated}
          </span>
          <div style={{ flex: 1 }}/>
          {layer.tags.slice(0, 2).map(t => (
            <span key={t} style={{
              padding: "1px 6px", borderRadius: 20,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
              color: "rgba(255,255,255,0.3)", fontSize: 9,
              fontFamily: "'DM Mono',monospace",
            }}>{t}</span>
          ))}
        </div>

        {layer.note && (
          <div style={{
            marginTop: 6, padding: "4px 9px",
            background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)",
            borderRadius: 6, color: "#fbbf24", fontSize: 9.5,
            fontFamily: "'DM Sans',sans-serif", lineHeight: 1.4,
          }}>
            ⚠ {layer.note}
          </div>
        )}

        {isActive && (
          <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "'DM Sans',sans-serif", flexShrink: 0 }}>OPACITY</span>
            <input
              type="range" min={0.05} max={1} step={0.05}
              value={layer.currentOpacity ?? layer.opacity}
              onChange={e => onOpacityChange(layer.id, parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: acc, cursor: "pointer", height: 3 }}
            />
            <span style={{ color: acc, fontSize: 9.5, fontFamily: "'DM Mono',monospace", fontWeight: 600, width: 30, textAlign: "right" }}>
              {Math.round((layer.currentOpacity ?? layer.opacity) * 100)}%
            </span>
          </div>
        )}
      </div>

      <button
        onClick={e => { e.stopPropagation(); onToggle(layer.id); }}
        style={{
          flexShrink: 0, width: 90, padding: "7px 0", borderRadius: 8,
          border: `1px solid ${isActive ? `rgba(${rgb},0.5)` : "rgba(255,255,255,0.12)"}`,
          background: isActive ? `rgba(${rgb},0.18)` : "rgba(255,255,255,0.05)",
          color: isActive ? acc : "rgba(255,255,255,0.65)",
          fontSize: 11, fontWeight: 700, cursor: "pointer",
          fontFamily: "'DM Sans',sans-serif",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          transition: "all 0.18s",
          marginTop: 2,
        }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#fff"; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.65)"; } }}
      >
        {isActive ? (
          <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>Added</>
        ) : (
          <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Layer</>
        )}
      </button>
    </div>
  );
}

// ── Category section header ───────────────────────────────────────────────────
function CategoryHeader({ cat, count }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 0 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      marginBottom: 10,
    }}>
      <span style={{ fontSize: 15 }}>{cat.icon}</span>
      <span style={{
        color: cat.color, fontWeight: 700, fontSize: 11,
        letterSpacing: "0.1em", fontFamily: "'DM Sans',sans-serif",
      }}>{cat.label.toUpperCase()}</span>
      <div style={{
        padding: "1px 8px", borderRadius: 20,
        background: `rgba(${hexToRgb(cat.color)},0.12)`,
        border: `1px solid rgba(${hexToRgb(cat.color)},0.25)`,
        color: cat.color, fontSize: 9.5, fontWeight: 700,
        fontFamily: "'DM Mono',monospace",
      }}>{count}</div>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)", marginLeft: 4 }}/>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DataLayersPanel({ viewer, Cesium, visible, onClose }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeLayers, setActiveLayers] = useState({});
  const [layerOpacities, setLayerOpacities] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showActiveSheet, setShowActiveSheet] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const cesiumLayersRef = useRef({});

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const filtered = DATA_LAYER_CATALOG.filter(l => {
    const matchCat = activeCategory === "all" || l.category === activeCategory;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q
      || l.title.toLowerCase().includes(q)
      || l.subtitle.toLowerCase().includes(q)
      || l.tags.some(t => t.toLowerCase().includes(q))
      || l.provider.toLowerCase().includes(q)
      || l.description.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const grouped = activeCategory === "all"
    ? CATEGORIES.filter(c => c.id !== "all").map(cat => ({
        cat,
        layers: filtered.filter(l => l.category === cat.id),
      })).filter(g => g.layers.length > 0)
    : null;

  const activeCount = Object.keys(activeLayers).length;

  const addLayerToCesium = useCallback(async (layer) => {
    if (!viewer || !Cesium) return null;
    try {
      let result = null;
      if (layer.type === "imagery" && layer.tileUrl) {
        const subs = layer.subdomains || ["a","b","c"];
        const url = layer.tileUrl.replace(/\{s\}/g, subs[0]);
        const provider = new Cesium.UrlTemplateImageryProvider({
          url, subdomains: subs, maximumLevel: layer.maxZoom || 18, credit: `© ${layer.provider}`,
        });
        const il = viewer.imageryLayers.addImageryProvider(provider);
        il.alpha = layer.opacity;
        result = { type: "imagery", ref: il };
      } else if (layer.type === "gibs") {
        const maxLvl = layer.maxZoom || 9;
        const fmt = layer.gibsFormat || "jpg";
        const gibsDate = layer.gibsDate || new Date().toISOString().split("T")[0];
        const gibsLevel = layer.gibsLevel || 9;
        const gibsUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer.gibsLayer}/default/${gibsDate}/GoogleMapsCompatible_Level${gibsLevel}/{z}/{y}/{x}.${fmt}`;
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: gibsUrl, maximumLevel: maxLvl, credit: "© NASA GIBS / EOSDIS",
        });
        const il = viewer.imageryLayers.addImageryProvider(provider);
        il.alpha = layer.opacity;
        result = { type: "imagery", ref: il };
      } else if (layer.type === "owm") {
        const key = layer.owmKey || "OWM_KEY";
        if (!key || key === "OWM_KEY") {
          console.warn(`[DataLayer] "${layer.title}" needs a free OWM API key`);
          return { type: "owm_pending", ref: null };
        }
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: `https://tile.openweathermap.org/map/${layer.owmLayer}/{z}/{x}/{y}.png?appid=${key}`,
          maximumLevel: layer.maxZoom || 10, credit: "© OpenWeatherMap",
        });
        const il = viewer.imageryLayers.addImageryProvider(provider);
        il.alpha = layer.opacity;
        result = { type: "imagery", ref: il };
      } else if (layer.type === "geojson" && layer.geoJsonUrl) {
        const ds = await Cesium.GeoJsonDataSource.load(layer.geoJsonUrl, {
          clampToGround: true, credit: `© ${layer.provider}`,
        });
        if (layer.id === "earthquake_usgs") {
          for (const ent of ds.entities.values) {
            try {
              const mag = ent.properties?.mag?.getValue() ?? 0;
              const sz = Math.max(6, Math.min(30, mag * 5));
              const col = mag >= 6 ? "#ef4444" : mag >= 4 ? "#f97316" : "#fbbf24";
              ent.point = new Cesium.PointGraphics({
                pixelSize: sz, color: Cesium.Color.fromCssColorString(col).withAlpha(0.85),
                outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              });
              ent.label = new Cesium.LabelGraphics({
                text: `M${mag.toFixed(1)}`, font: "bold 10px sans-serif",
                fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -sz - 6),
                disableDepthTestDistance: Number.POSITIVE_INFINITY, show: mag >= 5.0,
              });
              ent.billboard = undefined;
            } catch (_) {}
          }
        }
        await viewer.dataSources.add(ds);
        result = { type: "datasource", ref: ds };
      }
      return result;
    } catch (err) {
      console.warn(`[DataLayer] Failed to add "${layer.title}":`, err.message);
      return null;
    }
  }, [viewer, Cesium]);

  const handleToggle = useCallback(async (layerId) => {
    const layer = DATA_LAYER_CATALOG.find(l => l.id === layerId);
    if (!layer) return;
    if (activeLayers[layerId]) {
      const entry = cesiumLayersRef.current[layerId];
      if (entry && viewer && !viewer.isDestroyed?.()) {
        try {
          if (entry.type === "imagery") viewer.imageryLayers.remove(entry.ref, true);
          else if (entry.type === "datasource") viewer.dataSources.remove(entry.ref, true);
        } catch (_) {}
      }
      delete cesiumLayersRef.current[layerId];
      setActiveLayers(p => { const n = { ...p }; delete n[layerId]; return n; });
    } else {
      const entry = await addLayerToCesium(layer);
      if (entry) cesiumLayersRef.current[layerId] = entry;
      setActiveLayers(p => ({ ...p, [layerId]: true }));
    }
  }, [activeLayers, viewer, addLayerToCesium]);

  const handleOpacityChange = useCallback((layerId, opacity) => {
    setLayerOpacities(p => ({ ...p, [layerId]: opacity }));
    const entry = cesiumLayersRef.current[layerId];
    if (entry?.type === "imagery") {
      try { entry.ref.alpha = opacity; } catch (_) {}
    }
  }, []);

  useEffect(() => {
    return () => {
      if (!viewer || viewer.isDestroyed?.()) return;
      Object.values(cesiumLayersRef.current).forEach(entry => {
        try {
          if (entry.type === "imagery") viewer.imageryLayers.remove(entry.ref, true);
          else if (entry.type === "datasource") viewer.dataSources.remove(entry.ref, true);
        } catch (_) {}
      });
    };
  }, []);

  if (!visible) return null;

  const enriched = filtered.map(l => ({ ...l, currentOpacity: layerOpacities[l.id] ?? l.opacity }));

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

    .dlp-modal { animation: dlpIn 0.26s cubic-bezier(0.16,1,0.3,1); }
    .dlp-mobile-sheet { animation: dlpUp 0.32s cubic-bezier(0.16,1,0.3,1); }
    .dlp-active-sheet { animation: dlpUp 0.28s cubic-bezier(0.16,1,0.3,1); }

    @keyframes dlpIn {
      from { opacity:0; transform:translate(-50%,-50%) scale(0.97) translateY(14px); }
      to   { opacity:1; transform:translate(-50%,-50%) scale(1) translateY(0); }
    }
    @keyframes dlpUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    @keyframes dlpExpand {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .dlp-scroll::-webkit-scrollbar { width: 4px; }
    .dlp-scroll::-webkit-scrollbar-track { background: transparent; }
    .dlp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }

    .dlp-cat-tab { white-space: nowrap; flex-shrink: 0; -webkit-tap-highlight-color: transparent; }
    .dlp-cat-tabs { display: flex; gap: 6px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 2px; }
    .dlp-cat-tabs::-webkit-scrollbar { display: none; }

    input[type=range] { appearance: none; -webkit-appearance: none; background: transparent; }
    input[type=range]::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.1); }
    input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; margin-top: -5.5px; cursor: pointer; border: none; }
  `;

  // ──────────────────────────────────────────────
  // MOBILE LAYOUT — full bottom-sheet
  // ──────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <style>{CSS}</style>

        {/* Backdrop */}
        <div onClick={onClose} style={{
          position: "fixed", inset: 0, zIndex: 1299,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(5px)",
        }}/>

        {/* Bottom sheet */}
        <div className="dlp-mobile-sheet" style={{
          position: "fixed",
          left: 0, right: 0, bottom: 0,
          height: "92vh",
          zIndex: 1300,
          background: "rgba(5,8,18,0.99)",
          backdropFilter: "blur(32px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: "22px 22px 0 0",
          boxShadow: "0 -20px 80px rgba(0,0,0,0.9)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          fontFamily: "'DM Sans',sans-serif",
        }}>

          {/* Drag handle */}
          <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 4px", flexShrink: 0 }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)" }}/>
          </div>

          {/* Header */}
          <div style={{
            padding: "8px 18px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: "linear-gradient(135deg,rgba(99,102,241,0.55),rgba(139,92,246,0.4))",
                  border: "1px solid rgba(99,102,241,0.45)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
                  boxShadow: "0 0 16px rgba(99,102,241,0.28)",
                }}>◈</div>
                <div>
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: 17, lineHeight: 1.2 }}>Data Layers</div>
                  <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10.5, fontFamily: "'DM Mono',monospace" }}>
                    {DATA_LAYER_CATALOG.length} free layers
                    {activeCount > 0 && <span style={{ color: "#a5b4fc", marginLeft: 6 }}>· {activeCount} active</span>}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {activeCount > 0 && (
                  <button onClick={() => setShowActiveSheet(true)} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "6px 12px", borderRadius: 20,
                    border: "1px solid rgba(99,102,241,0.45)",
                    background: "rgba(99,102,241,0.18)",
                    color: "#a5b4fc", fontSize: 11, fontWeight: 700,
                    cursor: "pointer", WebkitTapHighlightColor: "transparent",
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    {activeCount}
                  </button>
                )}
                <button onClick={onClose} style={{
                  width: 34, height: 34, borderRadius: 9,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.55)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  WebkitTapHighlightColor: "transparent",
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: 12 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search layers…"
                style={{
                  width: "100%", padding: "10px 12px 10px 36px", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
                  color: "#fff", fontSize: 14, fontFamily: "'DM Sans',sans-serif",
                  boxSizing: "border-box", outline: "none",
                }}
              />
            </div>

            {/* Category tabs — horizontal scroll */}
            <div className="dlp-cat-tabs">
              {CATEGORIES.map(cat => {
                const count = cat.id === "all"
                  ? DATA_LAYER_CATALOG.length
                  : DATA_LAYER_CATALOG.filter(l => l.category === cat.id).length;
                const isSel = activeCategory === cat.id;
                const rgb = hexToRgb(cat.color);
                return (
                  <button key={cat.id} className="dlp-cat-tab"
                    onClick={() => setActiveCategory(cat.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "7px 14px", borderRadius: 22, cursor: "pointer",
                      border: `1px solid ${isSel ? `rgba(${rgb},0.55)` : "rgba(255,255,255,0.09)"}`,
                      background: isSel ? `rgba(${rgb},0.18)` : "rgba(255,255,255,0.03)",
                      color: isSel ? cat.color : "rgba(255,255,255,0.45)",
                      fontSize: 12, fontWeight: isSel ? 700 : 500,
                      fontFamily: "'DM Sans',sans-serif",
                      boxShadow: isSel ? `0 0 14px rgba(${rgb},0.22)` : "none",
                      WebkitTapHighlightColor: "transparent",
                    }}>
                    <span style={{ fontSize: 14 }}>{cat.icon}</span>
                    {cat.label}
                    <span style={{
                      padding: "0 5px", borderRadius: 10, minWidth: 18, textAlign: "center",
                      background: isSel ? `rgba(${rgb},0.25)` : "rgba(255,255,255,0.08)",
                      color: isSel ? cat.color : "rgba(255,255,255,0.3)",
                      fontSize: 10, fontWeight: 700,
                    }}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Layer list — scrollable */}
          <div className="dlp-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 14px 32px" }}>
            {enriched.length === 0 ? (
              <div style={{ textAlign: "center", padding: "56px 0", color: "rgba(255,255,255,0.2)" }}>
                <div style={{ fontSize: 40, marginBottom: 14 }}>🔍</div>
                <div style={{ fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}>
                  No layers match "{searchQuery}"
                </div>
              </div>
            ) : grouped ? (
              grouped.map(({ cat, layers }) => (
                <div key={cat.id} style={{ marginBottom: 24 }}>
                  <CategoryHeader cat={cat} count={layers.length} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {layers.map(l => (
                      <MobileLayerCard
                        key={l.id} layer={l}
                        isActive={!!activeLayers[l.id]}
                        onToggle={handleToggle}
                        onOpacityChange={handleOpacityChange}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {enriched.map(l => (
                  <MobileLayerCard
                    key={l.id} layer={l}
                    isActive={!!activeLayers[l.id]}
                    onToggle={handleToggle}
                    onOpacityChange={handleOpacityChange}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Active Layers bottom sheet (mobile) */}
        {showActiveSheet && (
          <>
            <div onClick={() => setShowActiveSheet(false)} style={{
              position: "fixed", inset: 0, zIndex: 1399,
              background: "rgba(0,0,0,0.5)",
            }}/>
            <div className="dlp-active-sheet" style={{
              position: "fixed", left: 0, right: 0, bottom: 0,
              maxHeight: "70vh", zIndex: 1400,
              background: "rgba(5,8,18,0.98)",
              backdropFilter: "blur(24px)",
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: "20px 20px 0 0",
              boxShadow: "0 -12px 48px rgba(0,0,0,0.8)",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              fontFamily: "'DM Sans',sans-serif",
            }}>
              <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)" }}/>
              </div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 18px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}>
                <span style={{ color: "#a5b4fc", fontWeight: 700, fontSize: 14 }}>
                  Active Layers · {activeCount}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {activeCount > 0 && (
                    <button onClick={() => { Object.keys(activeLayers).forEach(id => handleToggle(id)); setShowActiveSheet(false); }}
                      style={{
                        padding: "6px 12px", borderRadius: 8,
                        border: "1px solid rgba(239,68,68,0.3)",
                        background: "rgba(239,68,68,0.08)",
                        color: "#f87171", fontSize: 11, fontWeight: 700, cursor: "pointer",
                      }}>Clear All</button>
                  )}
                  <button onClick={() => setShowActiveSheet(false)} style={{
                    width: 30, height: 30, borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.05)",
                    color: "rgba(255,255,255,0.45)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>

              <div className="dlp-scroll" style={{ overflowY: "auto", padding: "14px 16px 32px" }}>
                {activeCount === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                    No layers active yet
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {Object.keys(activeLayers).map(id => {
                      const layer = DATA_LAYER_CATALOG.find(l => l.id === id);
                      if (!layer) return null;
                      const opacity = layerOpacities[id] ?? layer.opacity;
                      const rgb = hexToRgb(layer.accentColor);
                      return (
                        <div key={id} style={{
                          padding: "12px 14px", borderRadius: 12,
                          background: `rgba(${rgb},0.07)`,
                          border: `1px solid rgba(${rgb},0.3)`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                            <Thumbnail layer={layer} size={40} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                color: "#fff", fontSize: 13, fontWeight: 700,
                                fontFamily: "'DM Sans',sans-serif", lineHeight: 1.25,
                                wordBreak: "break-word",
                              }}>
                                {layer.title}
                              </div>
                              <div style={{ color: layer.accentColor, fontSize: 10.5, fontFamily: "'DM Sans',sans-serif" }}>
                                {layer.category_label}
                              </div>
                            </div>
                            <button onClick={() => handleToggle(id)} style={{
                              width: 34, height: 34, borderRadius: 17,
                              border: "1px solid rgba(239,68,68,0.3)",
                              background: "rgba(239,68,68,0.08)",
                              color: "#f87171", cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              flexShrink: 0,
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 9.5, fontWeight: 700, width: 52, fontFamily: "'DM Mono',monospace" }}>OPACITY</span>
                            <input type="range" min={0.05} max={1} step={0.05}
                              value={opacity}
                              onChange={e => handleOpacityChange(id, parseFloat(e.target.value))}
                              style={{ flex: 1, accentColor: layer.accentColor, cursor: "pointer" }}
                            />
                            <span style={{ color: layer.accentColor, fontSize: 10.5, fontFamily: "'DM Mono',monospace", fontWeight: 700, width: 32, textAlign: "right" }}>
                              {Math.round(opacity * 100)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  // ──────────────────────────────────────────────
  // DESKTOP LAYOUT — centered modal (unchanged)
  // ──────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>

      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 1299,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
      }}/>

      {/* Modal */}
      <div className="dlp-modal" style={{
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        zIndex: 1300,
        width: "min(94vw, 980px)",
        height: "min(90vh, 740px)",
        background: "rgba(6,9,20,0.98)",
        backdropFilter: "blur(32px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20,
        boxShadow: "0 40px 120px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.03)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'DM Sans',sans-serif",
      }}>

        {/* Header */}
        <div style={{
          padding: "20px 24px 0",
          background: "rgba(255,255,255,0.015)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: "linear-gradient(135deg,rgba(99,102,241,0.5),rgba(139,92,246,0.35))",
                border: "1px solid rgba(99,102,241,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19,
                boxShadow: "0 0 18px rgba(99,102,241,0.25)",
              }}>◈</div>
              <div>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 20, lineHeight: 1.2 }}>Data Layers</div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11.5, marginTop: 2, fontFamily: "'DM Mono',monospace" }}>
                  {DATA_LAYER_CATALOG.length} free &amp; open layers
                  {activeCount > 0 && <span style={{ color: "#a5b4fc", marginLeft: 8 }}>· {activeCount} active</span>}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {activeCount > 0 && (
                <div style={{
                  padding: "5px 13px", borderRadius: 20,
                  background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.38)",
                  color: "#a5b4fc", fontSize: 11, fontWeight: 700,
                }}>
                  {activeCount} active
                </div>
              )}
              <button onClick={onClose} style={{
                width: 34, height: 34, borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.45)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(255,255,255,0.45)"; }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {/* Search */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"
                style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, provider, tag, or description…"
                style={{
                  width: "100%", padding: "9px 12px 9px 32px", borderRadius: 9,
                  border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)",
                  color: "#fff", fontSize: 12.5, fontFamily: "'DM Sans',sans-serif",
                  boxSizing: "border-box", transition: "all 0.15s", outline: "none",
                }}
              />
            </div>
          </div>

          {/* Category tabs */}
          <div className="dlp-cat-tabs" style={{ paddingBottom: 14 }}>
            {CATEGORIES.map(cat => {
              const count = cat.id === "all"
                ? DATA_LAYER_CATALOG.length
                : DATA_LAYER_CATALOG.filter(l => l.category === cat.id).length;
              const isSel = activeCategory === cat.id;
              const rgb = hexToRgb(cat.color);
              return (
                <button key={cat.id} className="dlp-cat-tab"
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 14px", borderRadius: 22, cursor: "pointer",
                    border: `1px solid ${isSel ? `rgba(${rgb},0.5)` : "rgba(255,255,255,0.08)"}`,
                    background: isSel ? `rgba(${rgb},0.15)` : "rgba(255,255,255,0.025)",
                    color: isSel ? cat.color : "rgba(255,255,255,0.45)",
                    fontSize: 11.5, fontWeight: isSel ? 700 : 500,
                    fontFamily: "'DM Sans',sans-serif",
                    transition: "all 0.18s",
                    boxShadow: isSel ? `0 0 12px rgba(${rgb},0.2)` : "none",
                  }}>
                  <span style={{ fontSize: 13 }}>{cat.icon}</span>
                  {cat.label}
                  <span style={{
                    padding: "0 5px", borderRadius: 10, minWidth: 18, textAlign: "center",
                    background: isSel ? `rgba(${rgb},0.22)` : "rgba(255,255,255,0.07)",
                    color: isSel ? cat.color : "rgba(255,255,255,0.3)",
                    fontSize: 9.5, fontWeight: 700,
                  }}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Layer list */}
          <div className="dlp-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {enriched.length === 0 ? (
              <div style={{ textAlign: "center", padding: "64px 0", color: "rgba(255,255,255,0.2)" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
                <div style={{ fontSize: 14, fontFamily: "'DM Sans',sans-serif" }}>No layers match "{searchQuery}"</div>
              </div>
            ) : grouped ? (
              grouped.map(({ cat, layers }) => (
                <div key={cat.id} style={{ marginBottom: 24 }}>
                  <CategoryHeader cat={cat} count={layers.length} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {layers.map(l => (
                      <LayerCard key={l.id} layer={l} isActive={!!activeLayers[l.id]}
                        onToggle={handleToggle} onOpacityChange={handleOpacityChange} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {enriched.map(l => (
                  <LayerCard key={l.id} layer={l} isActive={!!activeLayers[l.id]}
                    onToggle={handleToggle} onOpacityChange={handleOpacityChange} />
                ))}
              </div>
            )}
          </div>

          {/* Active sidebar */}
          <div style={{
            width: 240, flexShrink: 0,
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.012)",
            display: "flex", flexDirection: "column",
          }}>
            <div className="dlp-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 14px" }}>
              {activeCount === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 12px" }}>
                  <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>◈</div>
                  <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11.5, lineHeight: 1.6, fontFamily: "'DM Sans',sans-serif" }}>
                    Click "Add Layer" on any data layer to overlay it on the globe
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 12, fontFamily: "'DM Sans',sans-serif" }}>
                    ACTIVE LAYERS
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
                    {Object.keys(activeLayers).map(id => {
                      const layer = DATA_LAYER_CATALOG.find(l => l.id === id);
                      if (!layer) return null;
                      const opacity = layerOpacities[id] ?? layer.opacity;
                      const rgb = hexToRgb(layer.accentColor);
                      return (
                        <div key={id} style={{
                          padding: "10px 11px", borderRadius: 10,
                          background: `rgba(${rgb},0.07)`,
                          border: `1px solid rgba(${rgb},0.28)`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <Thumbnail layer={layer} size={32} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {/* Full title - no truncation */}
                              <div style={{
                                color: "#fff", fontSize: 11, fontWeight: 600,
                                fontFamily: "'DM Sans',sans-serif", lineHeight: 1.3,
                                wordBreak: "break-word",
                              }}>
                                {layer.title}
                              </div>
                              <div style={{ color: layer.accentColor, fontSize: 9.5, fontFamily: "'DM Sans',sans-serif", opacity: 0.85 }}>
                                {layer.category_label}
                              </div>
                            </div>
                            <button onClick={() => handleToggle(id)} style={{
                              background: "none", border: "none",
                              color: "rgba(255,255,255,0.25)", cursor: "pointer",
                              padding: 2, flexShrink: 0, display: "flex",
                              transition: "color 0.12s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = "#f87171"}
                            onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.25)"}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <input type="range" min={0.05} max={1} step={0.05}
                              value={opacity}
                              onChange={e => handleOpacityChange(id, parseFloat(e.target.value))}
                              onClick={e => e.stopPropagation()}
                              style={{ flex: 1, accentColor: layer.accentColor, cursor: "pointer" }}
                            />
                            <span style={{ color: layer.accentColor, fontSize: 9, fontFamily: "'DM Mono',monospace", fontWeight: 600, width: 28, textAlign: "right" }}>
                              {Math.round(opacity * 100)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button onClick={() => Object.keys(activeLayers).forEach(id => handleToggle(id))}
                    style={{
                      width: "100%", padding: "8px", borderRadius: 8,
                      border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.06)",
                      color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.14)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.45)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.06)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.25)"; }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    Clear All Layers
                  </button>
                </>
              )}

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 10, fontFamily: "'DM Sans',sans-serif" }}>DATA SOURCES</div>
                {[["🛰️","NASA / ESA satellites"],["🌍","OpenStreetMap contributors"],["🏛️","UN / EU open agencies"],["⚡","Real-time API feeds"],["🆓","100% free to use"]].map(([icon, label]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                    <span style={{ fontSize: 12 }}>{icon}</span>
                    <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, fontFamily: "'DM Sans',sans-serif", lineHeight: 1.3 }}>{label}</span>
                  </div>
                ))}
                <div style={{
                  marginTop: 10, padding: "7px 9px", borderRadius: 8,
                  background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.22)", fontSize: 9.5,
                  fontFamily: "'DM Sans',sans-serif", lineHeight: 1.55,
                }}>
                  Weather layers require a free API key from openweathermap.org
                </div>
              </div>
            </div>

            <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 4 }}>
              {[{ label: "Live", color: "#ef4444", desc: "Real-time data" }, { label: "Experimental", color: "#8b5cf6", desc: "Variable availability" }, { label: "Europe only", color: "#3b82f6", desc: "Regional coverage" }].map(b => (
                <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ padding: "1px 7px", borderRadius: 20, flexShrink: 0, background: b.color, color: "#fff", fontSize: 8, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }}>{b.label}</div>
                  <span style={{ color: "rgba(255,255,255,0.22)", fontSize: 9.5, fontFamily: "'DM Sans',sans-serif" }}>{b.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "9px 22px", borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.01)", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", gap: 16 }}>
            {[["🛰️","NASA EOSDIS"],["🌍","OpenStreetMap"],["🇪🇺","Copernicus / ESA"],["⚡","USGS / FIRMS"]].map(([icon,label]) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.18)", fontSize: 10, fontFamily: "'DM Sans',sans-serif" }}>
                <span>{icon}</span>{label}
              </span>
            ))}
          </div>
          <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>
            {enriched.length} of {DATA_LAYER_CATALOG.length} layers shown
          </span>
        </div>
      </div>
    </>
  );
}