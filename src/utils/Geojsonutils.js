/**
 * src/utils/Geojsonutils.js — SurveyMap Pro v5.4.2
 * ─────────────────────────────────────────────────────────────────────────────
 * FILE LOCATION:  src/utils/Geojsonutils.js
 *
 * FIXES:
 *  1. addGeoJSONToMap: replaced flyToBounds(animate:true) with
 *     fitBounds(animate:false) + reEnableMapHandlers() so zoom/pan never
 *     gets locked after import.
 *  2. parseGeoJSON: now handles ALL valid GeoJSON types (not just
 *     FeatureCollection). Strips UTF-8 BOM. Shows helpful error messages.
 *  3. Layer is now returned from addGeoJSONToMap with correct featureCount.
 */

import L from "leaflet";

// ── Styles for imported GeoJSON features ─────────────────────────────────────
const POINT_STYLE   = { radius: 7, fillColor: "#f59e0b", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9 };
const LINE_STYLE    = { color: "#4a9eff", weight: 3, opacity: 0.85 };
const POLYGON_STYLE = { color: "#34d399", weight: 2, fillColor: "#34d399", fillOpacity: 0.18, opacity: 0.9 };

/**
 * Parses raw GeoJSON (string or object) → flat array of Feature objects.
 * Handles: FeatureCollection, Feature, bare geometry, UTF-8 BOM.
 */
export function parseGeoJSON(raw) {
  let data = raw;

  // String input: strip BOM, parse JSON
  if (typeof data === "string") {
    if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
    data = JSON.parse(data);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Not valid GeoJSON.");
  }

  const GEOM_TYPES = [
    "Point","MultiPoint","LineString","MultiLineString",
    "Polygon","MultiPolygon","GeometryCollection",
  ];

  // Bare geometry → wrap as Feature
  if (GEOM_TYPES.includes(data.type)) {
    data = { type: "Feature", geometry: data, properties: {} };
  }

  // Single Feature → wrap in FeatureCollection
  if (data.type === "Feature") {
    return [{ ...data, properties: { name: "Imported Feature", ...data.properties } }];
  }

  // FeatureCollection (including empty ones)
  if (data.type === "FeatureCollection") {
    return (data.features || []).map((f, i) => ({
      ...f,
      properties: { name: `Feature ${i + 1}`, ...f.properties },
    }));
  }

  // No type but has features array
  if (Array.isArray(data.features)) {
    return data.features.map((f, i) => ({
      ...f,
      properties: { name: `Feature ${i + 1}`, ...f.properties },
    }));
  }

  throw new Error(
    `Unrecognized GeoJSON type: "${data.type}".\n` +
    "Expected FeatureCollection, Feature, or a geometry object."
  );
}

/**
 * Renders a single geometry onto a Leaflet layer group with popup.
 */
function renderGeometry(geom, props, layerGroup) {
  const label = props?.name || props?.NAME || props?.title || props?.id || "Feature";
  const popupHTML = `
    <div style="font-family:'DM Sans',sans-serif;font-size:12px;color:#1e293b;min-width:120px">
      <strong>${label}</strong>
      ${Object.entries(props || {}).slice(0, 6)
        .filter(([k]) => k !== "name")
        .map(([k, v]) =>
          `<div style="color:#475569;font-size:10px"><b>${k}:</b> ${v}</div>`
        ).join("")}
    </div>`;

  switch (geom.type) {
    case "Point": {
      const [lng, lat] = geom.coordinates;
      L.circleMarker([lat, lng], POINT_STYLE).addTo(layerGroup).bindPopup(popupHTML);
      return 1;
    }
    case "MultiPoint":
      geom.coordinates.forEach(([lng, lat]) =>
        L.circleMarker([lat, lng], POINT_STYLE).addTo(layerGroup).bindPopup(popupHTML)
      );
      return geom.coordinates.length;

    case "LineString": {
      const latlngs = geom.coordinates.map(([lng, lat]) => [lat, lng]);
      L.polyline(latlngs, LINE_STYLE).addTo(layerGroup).bindPopup(popupHTML);
      return 1;
    }
    case "MultiLineString":
      geom.coordinates.forEach(coords => {
        L.polyline(coords.map(([lng, lat]) => [lat, lng]), LINE_STYLE)
          .addTo(layerGroup).bindPopup(popupHTML);
      });
      return geom.coordinates.length;

    case "Polygon": {
      const rings = geom.coordinates.map(ring => ring.map(([lng, lat]) => [lat, lng]));
      L.polygon(rings, POLYGON_STYLE).addTo(layerGroup).bindPopup(popupHTML);
      return 1;
    }
    case "MultiPolygon":
      geom.coordinates.forEach(polygonCoords => {
        const rings = polygonCoords.map(ring => ring.map(([lng, lat]) => [lat, lng]));
        L.polygon(rings, POLYGON_STYLE).addTo(layerGroup).bindPopup(popupHTML);
      });
      return geom.coordinates.length;

    case "GeometryCollection":
      return (geom.geometries || [])
        .reduce((acc, g) => acc + renderGeometry(g, props, layerGroup), 0);

    default:
      return 0;
  }
}

/**
 * Takes parsed Feature array, adds them to the Leaflet map,
 * fits the map to the new data (WITHOUT animation so zoom stays working),
 * and returns a layer-entry descriptor.
 *
 * @returns {{ id, name, layerGroup, featureCount, features }}
 */
export function addGeoJSONToMap(features, map, fileName) {
  const layerGroup = L.layerGroup().addTo(map);
  let featureCount = 0;

  features.forEach(f => {
    if (f.geometry) {
      featureCount += renderGeometry(f.geometry, f.properties, layerGroup);
    }
  });

  // ── FIX: fitBounds(animate:false) instead of flyToBounds ─────────────
  // flyToBounds sets map._flyingTo=true which locks all interaction.
  // fitBounds(animate:false) is instant and never locks handlers.
  try {
    const bounds = layerGroup.getBounds();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 18,
        animate: false,   // ← KEY: instant, no handler lock
      });
      // Re-enable all handlers immediately (synchronous after animate:false)
      reEnableMapHandlers(map);
    }
  } catch (_) {}

  return {
    id:           Date.now(),
    name:         fileName || "GeoJSON Import",
    layerGroup,
    featureCount,
    features,
  };
}

/**
 * Serialises all current map state to a GeoJSON FeatureCollection string.
 */
export function buildExportGeoJSON({ savedDrawings, route, measurePoints, importedGeoJSONLayers }) {
  const features = [];
  const ts = new Date().toISOString();

  // Helper: normalize point to [lng, lat]
  const toLngLat = (p) => Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat];

  // Saved drawings
  savedDrawings.forEach(d => {
    const pts = (d.points || []).map(toLngLat);
    if (d.type === "marker" && pts.length >= 1) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: pts[0] },
        properties: { name: d.name, type: "marker", source: "drawing", exportedAt: ts },
      });
    } else if (d.type === "path" && pts.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: pts },
        properties: { name: d.name, type: "path", pointCount: pts.length, source: "drawing", exportedAt: ts },
      });
    } else if (d.type === "polygon" && pts.length >= 3) {
      const ring = [...pts];
      if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
        ring.push(ring[0]);
      }
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { name: d.name, type: "polygon", pointCount: pts.length, source: "drawing", exportedAt: ts },
      });
    }
  });

  // Survey route
  if (route.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: route.map(p => [p[1], p[0]]) },
      properties: { name: "Survey Route", type: "survey", pointCount: route.length, source: "survey", exportedAt: ts },
    });
  }

  // Measure points
  if (measurePoints.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: measurePoints.map(p => [p.lng, p.lat]) },
      properties: { name: "Measure Line", type: "measure", pointCount: measurePoints.length, source: "measure", exportedAt: ts },
    });
  }

  // Re-export imported GeoJSON layers
  (importedGeoJSONLayers || []).forEach(layer => {
    (layer.features || []).forEach(f => {
      features.push({
        ...f,
        properties: { ...f.properties, source: "geojson-import", originalFile: layer.name, exportedAt: ts },
      });
    });
  });

  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

/** Triggers a browser download of a text file */
export function downloadTextFile(content, fileName, mimeType = "application/json") {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Re-enable all Leaflet interaction handlers.
   Safe to call even if already enabled (Leaflet no-ops in that case).
───────────────────────────────────────────────────────────────────────────── */
function reEnableMapHandlers(map) {
  if (!map) return;
  [
    "dragging",
    "scrollWheelZoom",
    "touchZoom",
    "doubleClickZoom",
    "keyboard",
    "boxZoom",
    "tap",
  ].forEach(name => {
    try { if (map[name]) map[name].enable(); } catch (_) {}
  });
  // Clear any stale fly-animation lock flag
  try { if (map._flyingTo) map._flyingTo = false; } catch (_) {}
  // Force layout recalc
  try { map.invalidateSize({ animate: false }); } catch (_) {}
}