/**
 * DEMElevationDrape.jsx — QGIS-style 2D elevation draping for SurveyMap Pro v5.9
 *
 * When a DEM raster is loaded alongside KML / KMZ / GeoJSON vector layers,
 * this component:
 *
 *  1. Iterates every point/vertex in the active vector features
 *  2. Samples the DEM elevation at each coordinate
 *  3. Renders colour-coded markers / polylines / polygons whose colour comes
 *     from the DEM colour ramp at that elevation — exactly like QGIS
 *     "Drape (set Z value from raster)" + pseudocolor renderer in 2D.
 *
 * Usage (inside MapContainer, after DEMLoader):
 *
 *   <DEMElevationDrape
 *     enabled={demFileName != null}
 *     demRasterRef={demRasterRef}
 *     colorRamp={demColorRamp}
 *     kmlLayer={kmlLayerRef}         // optional Leaflet layer ref
 *     geoJSONFeatures={features}     // array of GeoJSON Feature objects
 *     minElev={demStats?.min}
 *     maxElev={demStats?.max}
 *   />
 */

import { useEffect, useRef, useCallback } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { COLOR_RAMPS, sampleElevationAt } from "./DEMLoader";

/* ─── Colour helpers ──────────────────────────────────────────────── */
function lerp(a, b, t) { return a + (b - a) * t; }

function sampleRamp(ramp, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < ramp.length; i++) {
    const [t0, c0] = ramp[i - 1];
    const [t1, c1] = ramp[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return `rgb(${Math.round(lerp(c0[0],c1[0],f))},${Math.round(lerp(c0[1],c1[1],f))},${Math.round(lerp(c0[2],c1[2],f))})`;
    }
  }
  const last = ramp[ramp.length - 1][1];
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

function elevToColor(elev, minElev, maxElev, ramp) {
  const t = (elev - minElev) / Math.max(1, maxElev - minElev);
  return sampleRamp(ramp, t);
}

/* ─── Extract all latlngs from a Leaflet layer recursively ────────── */
function extractLeafletFeatures(layer) {
  const features = [];
  if (!layer) return features;

  layer.eachLayer?.(sub => {
    // Markers
    if (sub.getLatLng) {
      features.push({ type: "marker", latlng: sub.getLatLng(), layer: sub });
    }
    // Polylines / Polygons
    if (sub.getLatLngs) {
      features.push({ type: "line", latlngs: sub.getLatLngs(), layer: sub });
    }
    // Nested groups
    if (sub.eachLayer) {
      features.push(...extractLeafletFeatures(sub));
    }
  });

  return features;
}

/* ═══════════════════════════════════════════════════════════════════ */
export default function DEMElevationDrape({
  enabled,
  demRasterData,   // { data, width, height, west, south, east, north, minVal, maxVal }
  colorRamp = "Terrain",
  minElev,
  maxElev,
  kmlLayerRef,     // React ref to the Leaflet KML layer group
  shpLayerRef,     // React ref to the shapefile layer group
  geoJSONLayerRef, // React ref to the GeoJSON layer group
  opacity = 0.85,
}) {
  const map          = useRef(useMap());
  const drapeGroupRef = useRef(null);

  const clearDrape = useCallback(() => {
    if (drapeGroupRef.current) {
      map.current.removeLayer(drapeGroupRef.current);
      drapeGroupRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearDrape();
    if (!enabled || !demRasterData) return;

    const ramp     = COLOR_RAMPS[colorRamp] || COLOR_RAMPS["Terrain"];
    const minE     = minElev ?? demRasterData.minVal;
    const maxE     = maxElev ?? demRasterData.maxVal;
    const group    = L.layerGroup();
    let   added    = 0;

    // ── Helper: colour-drape a Leaflet layer ──────────────────────
    const drapeLayer = (lyr) => {
      if (!lyr) return;

      lyr.eachLayer?.(sub => {
        // Marker
        if (sub.getLatLng) {
          const ll  = sub.getLatLng();
          const elev = sampleElevationAt(demRasterData, ll.lat, ll.lng);
          if (elev == null) return;
          const color = elevToColor(elev, minE, maxE, ramp);

          // Draw a coloured circle at the same position
          L.circleMarker([ll.lat, ll.lng], {
            radius: 7,
            fillColor: color,
            fillOpacity: opacity,
            color: "rgba(0,0,0,0.4)",
            weight: 1,
            interactive: false,
          })
            .bindTooltip(`${Math.round(elev)} m`, { sticky: true, direction: "top" })
            .addTo(group);
          added++;
        }

        // Polyline / Polygon
        if (sub.getLatLngs) {
          const rawLLs = sub.getLatLngs();
          // Flatten nested arrays (polygons have [[ring], [ring]])
          const rings = Array.isArray(rawLLs[0]) ? rawLLs : [rawLLs];

          rings.forEach(ring => {
            // Sample elevation at each vertex, skip NaN
            const valid = ring.filter(ll => {
              const e = sampleElevationAt(demRasterData, ll.lat, ll.lng);
              return e != null;
            });
            if (!valid.length) return;

            // Mean elevation for the whole feature
            const elevs = valid.map(ll => sampleElevationAt(demRasterData, ll.lat, ll.lng));
            const meanE = elevs.reduce((s, e) => s + e, 0) / elevs.length;
            const color = elevToColor(meanE, minE, maxE, ramp);

            // Re-draw the feature with DEM colour
            const isPolygon = sub instanceof L.Polygon;
            const Klass = isPolygon ? L.polygon : L.polyline;
            const styled = new Klass(ring, {
              color,
              weight: isPolygon ? 1.5 : 3,
              fillColor: isPolygon ? color : undefined,
              fillOpacity: isPolygon ? opacity * 0.55 : 0,
              opacity,
              interactive: false,
            }).bindTooltip(`${Math.round(meanE)} m (mean)`, { sticky: true });
            styled.addTo(group);
            added++;
          });
        }

        // Recurse into sub-groups
        if (sub.eachLayer) drapeLayer(sub);
      });
    };

    if (kmlLayerRef?.current)     drapeLayer(kmlLayerRef.current);
    if (shpLayerRef?.current)     drapeLayer(shpLayerRef.current);
    if (geoJSONLayerRef?.current) drapeLayer(geoJSONLayerRef.current);

    if (added > 0) {
      group.addTo(map.current);
      drapeGroupRef.current = group;
    }

    return clearDrape;
  }, [enabled, demRasterData, colorRamp, minElev, maxElev, opacity, kmlLayerRef, shpLayerRef, geoJSONLayerRef, clearDrape]);

  return null;
}