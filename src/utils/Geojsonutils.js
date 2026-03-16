// ─── geojsonUtils.js — GeoJSON import / export helpers ───────────────────────
import L from "leaflet";

// ── Styles for imported GeoJSON features ─────────────────────────────────────
const POINT_STYLE   = { radius: 7, fillColor: "#f59e0b", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9 };
const LINE_STYLE    = { color: "#4a9eff", weight: 3, opacity: 0.85 };
const POLYGON_STYLE = { color: "#34d399", weight: 2, fillColor: "#34d399", fillOpacity: 0.18, opacity: 0.9 };

/**
 * Parses raw GeoJSON (string or object) → flat array of Feature objects.
 * Handles: FeatureCollection, Feature, bare geometry.
 */
export function parseGeoJSON(raw) {
  let data = typeof raw === "string" ? JSON.parse(raw) : raw;

  // Wrap bare geometry
  if (data.type && data.type !== "Feature" && data.type !== "FeatureCollection") {
    data = { type: "Feature", geometry: data, properties: {} };
  }

  if (data.type === "FeatureCollection") {
    return (data.features || []).map((f, i) => ({
      ...f,
      properties: { name: `Feature ${i + 1}`, ...f.properties },
    }));
  }

  if (data.type === "Feature") {
    return [{ ...data, properties: { name: "Imported Feature", ...data.properties } }];
  }

  throw new Error("Unrecognised GeoJSON structure");
}

/**
 * Renders a single geometry onto a Leaflet layer group with popup.
 */
function renderGeometry(geom, props, layerGroup) {
  const label = props?.name || props?.NAME || props?.title || props?.id || "Feature";
  const popupHTML = `
    <div style="font-family:'DM Sans',sans-serif;font-size:12px;color:#1e293b;min-width:120px">
      <strong>${label}</strong>
      ${Object.entries(props || {}).slice(0, 6).filter(([k]) => k !== "name")
        .map(([k, v]) => `<div style="color:#475569;font-size:10px"><b>${k}:</b> ${v}</div>`).join("")}
    </div>`;

  switch (geom.type) {
    case "Point": {
      const [lng, lat] = geom.coordinates;
      L.circleMarker([lat, lng], POINT_STYLE).addTo(layerGroup).bindPopup(popupHTML);
      return 1;
    }
    case "MultiPoint":
      geom.coordinates.forEach(([lng, lat]) =>
        L.circleMarker([lat, lng], POINT_STYLE).addTo(layerGroup).bindPopup(popupHTML));
      return geom.coordinates.length;

    case "LineString": {
      const latlngs = geom.coordinates.map(([lng, lat]) => [lat, lng]);
      L.polyline(latlngs, LINE_STYLE).addTo(layerGroup).bindPopup(popupHTML);
      return 1;
    }
    case "MultiLineString":
      geom.coordinates.forEach(coords => {
        const latlngs = coords.map(([lng, lat]) => [lat, lng]);
        L.polyline(latlngs, LINE_STYLE).addTo(layerGroup).bindPopup(popupHTML);
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
      return (geom.geometries || []).reduce((acc, g) => acc + renderGeometry(g, props, layerGroup), 0);

    default:
      return 0;
  }
}

/**
 * Takes parsed Feature array, adds them to the given Leaflet map,
 * fits the map to the new data, and returns a layer-entry descriptor.
 * @returns {{ id, name, layerGroup, featureCount, features }}
 */
export function addGeoJSONToMap(features, map, fileName) {
  const layerGroup = L.layerGroup().addTo(map);
  let featureCount = 0;

  features.forEach(f => {
    if (f.geometry) featureCount += renderGeometry(f.geometry, f.properties, layerGroup);
  });

  // Auto-fit map to imported data
  try {
    const bounds = layerGroup.getBounds();
    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 16, duration: 1.2 });
  } catch (_) {}

  return { id: Date.now(), name: fileName || "GeoJSON Import", layerGroup, featureCount, features };
}

/**
 * Serialises all current map state to a GeoJSON FeatureCollection string.
 */
export function buildExportGeoJSON({ savedDrawings, route, measurePoints, importedGeoJSONLayers }) {
  const features = [];
  const ts = new Date().toISOString();

  // Saved drawings
  savedDrawings.forEach(d => {
    if (d.type === "marker" && d.points.length >= 1) {
      const [lat, lng] = d.points[0];
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { name: d.name, type: "marker", source: "drawing", exportedAt: ts },
      });
    } else if (d.type === "path" && d.points.length >= 2) {
      const coords = d.points.map(p => Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]);
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { name: d.name, type: "path", pointCount: d.points.length, source: "drawing", exportedAt: ts },
      });
    } else if (d.type === "polygon" && d.points.length >= 3) {
      const ring = d.points.map(p => Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]);
      if (ring.length && (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]))
        ring.push(ring[0]); // close ring
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { name: d.name, type: "polygon", pointCount: d.points.length, source: "drawing", exportedAt: ts },
      });
    }
  });

  // Survey route
  if (route.length >= 2) {
    const coords = route.map(p => Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { name: "Survey Route", type: "survey", pointCount: route.length, source: "survey", exportedAt: ts },
    });
  }

  // Measure points
  if (measurePoints.length >= 2) {
    const coords = measurePoints.map(p => [p.lng, p.lat]);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { name: "Measure Line", type: "measure", pointCount: measurePoints.length, source: "measure", exportedAt: ts },
    });
  }

  // Re-export imported GeoJSON layers
  importedGeoJSONLayers.forEach(layer => {
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
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}