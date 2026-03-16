// ─── useGeoJSON.js — GeoJSON import / export state hook ──────────────────────
import { useState, useCallback } from "react";
import { parseGeoJSON, addGeoJSONToMap, buildExportGeoJSON, downloadTextFile } from "../utils/geojsonUtils.js";

export function useGeoJSON(leafletMapRef) {
  const [importedGeoJSONLayers, setImportedGeoJSONLayers] = useState([]);
  const [geojsonLoading,        setGeojsonLoading]        = useState(false);

  // ── Import ──────────────────────────────────────────────────────────────────
  const handleGeoJSONUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "geojson" && ext !== "json") {
      alert("Please upload a .geojson or .json file.");
      e.target.value = "";
      return;
    }
    setGeojsonLoading(true);
    try {
      const text     = await file.text();
      const features = parseGeoJSON(text);
      if (!features.length) { alert("No valid features found in this GeoJSON file."); return; }
      const map = leafletMapRef.current;
      if (!map) { alert("Map not ready. Please try again."); return; }
      const entry = addGeoJSONToMap(features, map, file.name);
      setImportedGeoJSONLayers(prev => [...prev, entry]);
    } catch (err) {
      alert(`Failed to load GeoJSON: ${err.message}`);
    } finally {
      setGeojsonLoading(false);
      e.target.value = "";
    }
  }, [leafletMapRef]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExportGeoJSON = useCallback(({ savedDrawings, route, measurePoints }) => {
    const geojsonStr = buildExportGeoJSON({ savedDrawings, route, measurePoints, importedGeoJSONLayers });
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    downloadTextFile(geojsonStr, `surveymap-export-${ts}.geojson`, "application/geo+json");
  }, [importedGeoJSONLayers]);

  // ── Remove one layer ────────────────────────────────────────────────────────
  const removeGeoJSONLayer = useCallback((id) => {
    setImportedGeoJSONLayers(prev => {
      const entry = prev.find(l => l.id === id);
      if (entry?.layerGroup) entry.layerGroup.remove();
      return prev.filter(l => l.id !== id);
    });
  }, []);

  // ── Clear all layers ────────────────────────────────────────────────────────
  const clearAllGeoJSONLayers = useCallback(() => {
    setImportedGeoJSONLayers(prev => {
      prev.forEach(l => l.layerGroup?.remove());
      return [];
    });
  }, []);

  return {
    importedGeoJSONLayers,
    geojsonLoading,
    handleGeoJSONUpload,
    handleExportGeoJSON,
    removeGeoJSONLayer,
    clearAllGeoJSONLayers,
  };
}