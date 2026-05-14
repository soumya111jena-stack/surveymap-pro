/**
 * src/hooks/useGeoJSON.js — SurveyMap Pro v5.4.2
 * ─────────────────────────────────────────────────────────────────────────────
 * FILE LOCATION:  src/hooks/useGeoJSON.js
 *
 * FIX — "No valid features found in this GeoJSON file" error:
 *  Old code required data.type === "FeatureCollection" && features.length > 0
 *  This hook now accepts ALL valid GeoJSON types:
 *    ✅ FeatureCollection  (standard)
 *    ✅ Feature            (single feature)
 *    ✅ Point / LineString / Polygon / Multi* (bare geometries)
 *    ✅ GeometryCollection
 *    ✅ Files with UTF-8 BOM (ArcGIS / QGIS exports)
 *    ✅ Empty features array (still valid structure)
 */

import { useState, useCallback, useRef } from "react";
import { addGeoJSONToMap } from "../utils/Geojsonutils.js";

export function useGeoJSON(leafletMapRef) {
  const [importedGeoJSONLayers, setImportedGeoJSONLayers] = useState([]);
  const [geojsonLoading,        setGeojsonLoading]        = useState(false);

  /* ── Handle file upload ─────────────────────────────────────────────────── */
  const handleGeoJSONUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    // Reset input so same file can be re-imported
    if (e.target) e.target.value = "";
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "geojson" && ext !== "json") {
      alert("Please select a .geojson or .json file.");
      return;
    }

    setGeojsonLoading(true);

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        let text = evt.target.result;

        // Strip UTF-8 BOM — common in files from ArcGIS, QGIS, Excel, Windows
        if (text.charCodeAt(0) === 0xFEFF) {
          text = text.slice(1);
        }

        // Parse JSON
        let raw;
        try {
          raw = JSON.parse(text);
        } catch (parseErr) {
          throw new Error(`Invalid JSON syntax: ${parseErr.message}`);
        }

        // Normalize any valid GeoJSON type → FeatureCollection
        const geojsonData = normalizeToFeatureCollection(raw);

        const map  = leafletMapRef?.current;
        const name = file.name.replace(/\.(geojson|json)$/i, "");

        if (!map) {
          throw new Error("Map not ready. Please try again.");
        }

        // addGeoJSONToMap is from Geojsonutils.js — adds layer and fits bounds
        const layerEntry = addGeoJSONToMap(geojsonData.features, map, name);

        setImportedGeoJSONLayers(prev => [...prev, layerEntry]);

      } catch (err) {
        console.error("[useGeoJSON] Import error:", err);
        alert(`GeoJSON import failed:\n\n${err.message}`);
      } finally {
        setGeojsonLoading(false);
      }
    };

    reader.onerror = () => {
      alert("Could not read the file. Please try again.");
      setGeojsonLoading(false);
    };

    reader.readAsText(file, "UTF-8");
  }, [leafletMapRef]);

  /* ── Remove a single layer ──────────────────────────────────────────────── */
  const removeGeoJSONLayer = useCallback((id) => {
    setImportedGeoJSONLayers(prev => {
      const layer = prev.find(l => l.id === id);
      if (layer?.layerGroup) {
        try {
          const map = leafletMapRef?.current;
          if (map) map.removeLayer(layer.layerGroup);
        } catch (_) {}
      }
      return prev.filter(l => l.id !== id);
    });
  }, [leafletMapRef]);

  /* ── Clear all layers ───────────────────────────────────────────────────── */
  const clearAllGeoJSONLayers = useCallback(() => {
    const map = leafletMapRef?.current;
    setImportedGeoJSONLayers(prev => {
      prev.forEach(layer => {
        if (layer?.layerGroup && map) {
          try { map.removeLayer(layer.layerGroup); } catch (_) {}
        }
      });
      return [];
    });
  }, [leafletMapRef]);

  /* ── Export all as GeoJSON ──────────────────────────────────────────────── */
  const handleExportGeoJSON = useCallback(({ savedDrawings = [], route = [], measurePoints = [] } = {}) => {
    const features = [];
    const ts = new Date().toISOString();

    // Helper: normalize a point to [lng, lat] for GeoJSON coords
    const toLngLat = (p) => {
      if (Array.isArray(p)) return [p[1], p[0]];
      return [p.lng, p.lat];
    };

    // Drawings
    savedDrawings.forEach(d => {
      if (!d.points?.length) return;
      const pts = d.points.map(toLngLat);

      if (d.type === "marker" && pts.length >= 1) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: pts[0] },
          properties: { name: d.name, type: "marker", exportedAt: ts },
        });
      } else if (d.type === "path" && pts.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: pts },
          properties: { name: d.name, type: "path", pointCount: pts.length, exportedAt: ts },
        });
      } else if (d.type === "polygon" && pts.length >= 3) {
        const ring = [...pts];
        if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
          ring.push(ring[0]); // close ring
        }
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ring] },
          properties: { name: d.name, type: "polygon", pointCount: pts.length, exportedAt: ts },
        });
      }
    });

    // Survey route
    if (route.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: route.map(p => [p[1], p[0]]) },
        properties: { name: "Survey Route", type: "survey", exportedAt: ts },
      });
    }

    // Measure points
    if (measurePoints.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: measurePoints.map(p => [p.lng, p.lat]) },
        properties: { name: "Measurement", type: "measure", exportedAt: ts },
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

    if (features.length === 0) {
      alert("No data to export yet.\n\nDraw paths/polygons, run a survey, or import a file first.");
      return;
    }

    const content = JSON.stringify({ type: "FeatureCollection", features }, null, 2);
    const date    = new Date().toISOString().slice(0, 10);
    const blob    = new Blob([content], { type: "application/geo+json" });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement("a");
    a.href        = url;
    a.download    = `surveymap-${date}.geojson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [importedGeoJSONLayers]);

  return {
    importedGeoJSONLayers,
    geojsonLoading,
    handleGeoJSONUpload,
    removeGeoJSONLayer,
    clearAllGeoJSONLayers,
    handleExportGeoJSON,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   normalizeToFeatureCollection
   Converts ANY valid GeoJSON type into a FeatureCollection.
   This is the core fix — the old code only accepted FeatureCollection.
───────────────────────────────────────────────────────────────────────────── */
function normalizeToFeatureCollection(data) {
  if (!data || typeof data !== "object") {
    throw new Error("File is not valid JSON.");
  }

  const t = data.type;

  if (!t) {
    // Some tools export GeoJSON without a top-level type
    // Try treating it as a FeatureCollection anyway
    if (Array.isArray(data.features)) {
      return { type: "FeatureCollection", features: data.features };
    }
    throw new Error(
      "Not a GeoJSON file — missing 'type' property.\n" +
      "Make sure the file is a valid GeoJSON FeatureCollection, Feature, or geometry."
    );
  }

  // ── Already a FeatureCollection ────────────────────────────────────────
  if (t === "FeatureCollection") {
    return {
      type: "FeatureCollection",
      features: Array.isArray(data.features) ? data.features : [],
    };
  }

  // ── Single Feature → wrap ──────────────────────────────────────────────
  if (t === "Feature") {
    return { type: "FeatureCollection", features: [data] };
  }

  // ── Bare geometry types → wrap as Feature → FeatureCollection ─────────
  const GEOM_TYPES = [
    "Point", "MultiPoint",
    "LineString", "MultiLineString",
    "Polygon", "MultiPolygon",
    "GeometryCollection",
  ];

  if (GEOM_TYPES.includes(t)) {
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: data,
        properties: {},
      }],
    };
  }

  throw new Error(
    `Unrecognized GeoJSON type: "${t}".\n` +
    `Valid types: FeatureCollection, Feature, Point, LineString, Polygon, etc.`
  );
}