/**
 * useOverlayLayers.js
 * Manages KML / KMZ / CSV / GeoJSON overlay layers with right-click context
 * menu support (Google Earth-style Properties dialog via MeasureTool).
 *
 * ── Quick start ──────────────────────────────────────────────────────────────
 *
 *   import { useOverlayLayers } from "./useOverlayLayers";
 *
 *   const {
 *     overlayLayers,      // pass to <MeasureTool overlayLayers={overlayLayers} />
 *     addLayer,           // register one layer (marker, polyline, polygon, etc.)
 *     addLayerFeatures,   // register all features from a file at once
 *     updateLayer,        // update name / feature of an existing layer
 *     removeLayer,        // remove by id
 *     removeAllLayers,    // clear everything
 *     getLayer,           // lookup by id
 *   } = useOverlayLayers();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef } from "react";

export function useOverlayLayers() {
  const [overlayLayers, setOverlayLayers] = useState([]);
  const idCounter = useRef(0);

  function nextId() {
    return `layer-${++idCounter.current}`;
  }

  // ── addLayer ──────────────────────────────────────────────────────────────
  /**
   * Register a single Leaflet layer for right-click support.
   *
   * @param {object}  opts
   * @param {string}  opts.name          Display name shown in the context menu
   * @param {object}  opts.leafletLayer  Any Leaflet layer instance
   * @param {object}  [opts.feature]     GeoJSON Feature — supplies geometry to the Measurements tab
   * @param {string}  [opts.fileType]    "kml" | "kmz" | "csv" | "geojson" | "gpx" | "compass" | etc.
   * @param {string}  [opts.filePath]    Original file path or URL (display only)
   * @returns {string} Unique layer id
   */
  const addLayer = useCallback(({ name, leafletLayer, feature, fileType, filePath }) => {
    const id = nextId();
    const entry = {
      id,
      name,
      leafletLayer,
      feature:  feature  ?? null,
      fileType: fileType ?? null,
      filePath: filePath ?? null,
    };
    setOverlayLayers(prev => [...prev, entry]);
    return id;
  }, []);

  // ── addLayerFeatures ──────────────────────────────────────────────────────
  /**
   * Register every GeoJSON feature from a file as its own context-menu entry.
   * Right-clicking any individual path opens its own Properties dialog.
   *
   * @param {object}  opts
   * @param {string}  opts.fileName          Fallback name when a feature has no "name" property
   * @param {string}  [opts.fileType]        "kml" | "kmz" | "csv" | "geojson" | "gpx" | etc.
   * @param {string}  [opts.filePath]        Original file path or URL
   * @param {object}  opts.geojson           GeoJSON FeatureCollection or single Feature
   * @param {object}  opts.leafletLayerGroup The L.geoJSON() group added to the map
   * @returns {string[]} Array of layer ids (one per feature)
   */
  const addLayerFeatures = useCallback(({
    fileName,
    fileType,
    filePath,
    geojson,
    leafletLayerGroup,
  }) => {
    const features = geojson?.features ?? [geojson];
    const ids = [];

    const sublayers = [];
    if (leafletLayerGroup?.eachLayer) {
      leafletLayerGroup.eachLayer(l => sublayers.push(l));
    }

    const newEntries = features.map((feature, i) => {
      const id = nextId();
      ids.push(id);

      const leafletLayer = sublayers[i] ?? leafletLayerGroup;
      const name =
        feature?.properties?.name  ||
        feature?.properties?.Name  ||
        feature?.properties?.title ||
        `${fileName} [${i + 1}]`;

      return {
        id,
        name,
        leafletLayer,
        feature,
        fileType: fileType ?? null,
        filePath: filePath ?? null,
      };
    });

    setOverlayLayers(prev => [...prev, ...newEntries]);
    return ids;
  }, []);

  // ── updateLayer ───────────────────────────────────────────────────────────
  /**
   * Patch an existing layer entry in-place.
   * Used by useCompassNav to push fresh GPS coordinates into the feature
   * so the Properties → Measurements tab always shows current position.
   *
   * @param {string} id     Id returned by addLayer / addLayerFeatures
   * @param {object} patch  Partial fields to merge: { name?, feature?, fileType?, filePath? }
   */
  const updateLayer = useCallback((id, patch) => {
    setOverlayLayers(prev =>
      prev.map(l => l.id === id ? { ...l, ...patch } : l)
    );
  }, []);

  // ── removeLayer ───────────────────────────────────────────────────────────
  /**
   * Remove a single registered entry by id.
   * Does NOT call .remove() on the Leaflet layer — caller is responsible.
   *
   * @param {string} id
   */
  const removeLayer = useCallback((id) => {
    setOverlayLayers(prev => prev.filter(l => l.id !== id));
  }, []);

  // ── removeAllLayers ───────────────────────────────────────────────────────
  /**
   * Clear every registered entry.
   * Does NOT remove Leaflet layers from the map.
   */
  const removeAllLayers = useCallback(() => {
    setOverlayLayers([]);
  }, []);

  // ── getLayer ──────────────────────────────────────────────────────────────
  /**
   * Synchronous lookup by id. Safe to call inside Leaflet event handlers.
   *
   * @param {string} id
   * @returns {object|undefined}
   */
  const layersRef = useRef([]);
  layersRef.current = overlayLayers; // always current, no stale closure

  const getLayer = useCallback((id) => {
    return layersRef.current.find(l => l.id === id);
  }, []);

  return {
    overlayLayers,
    addLayer,
    addLayerFeatures,
    updateLayer,
    removeLayer,
    removeAllLayers,
    getLayer,
  };
}


// ── Usage examples ────────────────────────────────────────────────────────────
//
// 1. KML / GeoJSON file loaded from disk
// ───────────────────────────────────────
//   const { overlayLayers, addLayerFeatures, removeLayer } = useOverlayLayers();
//
//   function onKmlLoad(geojson, fileName) {
//     const group = L.geoJSON(geojson, { style: { color: "#ff8800" } }).addTo(map);
//     const ids = addLayerFeatures({
//       fileName, fileType: "kml", filePath: fileName, geojson, leafletLayerGroup: group,
//     });
//     // To remove later: ids.forEach(id => removeLayer(id)); group.remove();
//   }
//
//
// 2. Single drawn polygon / polyline
// ────────────────────────────────────
//   const id = addLayer({
//     name: "My polygon",
//     leafletLayer: poly,
//     feature: {
//       type: "Feature",
//       geometry: { type: "Polygon", coordinates: [latlngs.map(p => [p.lng, p.lat])] },
//       properties: { name: "My polygon" },
//     },
//     fileType: "drawn",
//   });
//
//
// 3. GPS compass cone (useCompassNav integration)
// ────────────────────────────────────────────────
//   const overlayControls = useOverlayLayers();
//   const compass = useCompassNav(mapRef, overlayControls);
//   // useCompassNav calls addLayer when the cone appears,
//   // updateLayer on every GPS fix, removeLayer on stop.
//
//
// 4. Wire into MeasureTool
// ─────────────────────────
//   <MapContainer>
//     <MeasureTool
//       measureMode={measureMode}
//       measurePoints={measurePoints}
//       setMeasurePoints={setMeasurePoints}
//       measureUnit={measureUnit}
//       setMeasureUnit={setMeasureUnit}
//       onFinish={onFinish}
//       overlayLayers={overlayLayers}    // ← enables right-click context menu
//     />
//   </MapContainer>