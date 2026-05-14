/**
 * GeoJSONLoader.jsx — SurveyMap Pro v5.5
 * ─────────────────────────────────────────────────────────────────────────────
 * FILE LOCATION: src/loaders/GeoJSONLoader.jsx
 *
 * FIXES APPLIED:
 *
 *  FIX 1 — Removed animate:false from fitBounds / setView
 *    animate:false leaves Leaflet's internal _animatingZoom / _flyingTo flags
 *    as true on some versions, permanently blocking user zoom/pan after load.
 *    Solution: let the animation run naturally, then unlock in moveend.
 *
 *  FIX 2 — forceUnlock / reEnableHandlers moved into map.once('moveend')
 *    These were previously called before fitBounds settled, so the map
 *    re-locked itself after the unlock. Now they fire only after the map
 *    finishes moving, and onDone() is called from inside moveend too.
 *
 *  FIX 3 — Added _animatingZoom and _zooming to forceUnlock()
 *    These are the exact flags Leaflet checks before accepting zoom input.
 *    Without resetting them, scroll/button zoom stays silently blocked even
 *    after dragging and other handlers are re-enabled.
 *
 *  ORIGINAL FIX (kept) — refs updated synchronously during render
 *    mapRef.current = map and fileRef.current = file are set during render
 *    (not inside useEffect) so they are always ready before any effect fires.
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/* ── Styles ──────────────────────────────────────────────────────────────── */
const POINT_STYLE = {
  radius: 8, fillColor: "#f59e0b", color: "#fff",
  weight: 2, opacity: 1, fillOpacity: 0.9,
};
const LINE_STYLE = {
  color: "#4a9eff", weight: 3, opacity: 0.9,
};
const POLYGON_STYLE = {
  color: "#34d399", weight: 2.5, fillColor: "#34d399",
  fillOpacity: 0.2, opacity: 0.9,
};

/* ─────────────────────────────────────────────────────────────────────────────
   GeoJSONLoader
───────────────────────────────────────────────────────────────────────────── */
function GeoJSONLoader({ file, triggerKey, onDone }) {
  const map     = useMap();
  const mapRef  = useRef(null);
  const fileRef = useRef(null);
  const layerRef = useRef(null);

  // ── Update refs SYNCHRONOUSLY during render (not in useEffect) ───────────
  // Guaranteed to be current before any effect fires.
  mapRef.current  = map;
  fileRef.current = file;

  useEffect(() => {
    if (!triggerKey) return;

    const m = mapRef.current;
    const f = fileRef.current;

    if (!m) {
      console.error("[GeoJSONLoader] ❌ map is null");
      onDone?.(); return;
    }
    if (!f) {
      console.error("[GeoJSONLoader] ❌ file is null");
      onDone?.(); return;
    }

    console.log(`[GeoJSONLoader] Loading "${f.name}" (${f.size} bytes)`);

    // Remove previous layer
    if (layerRef.current) {
      try { m.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        let text = evt.target.result;

        // Strip UTF-8 BOM
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

        // Detect JS comments — not valid JSON
        if (text.trimStart().startsWith("//") || /\n\s*\/\//.test(text)) {
          throw new Error(
            "File contains JavaScript comments (// ...) which are not valid JSON.\n\n" +
            "GeoJSON must be pure JSON — remove all // comment lines."
          );
        }

        // Parse JSON
        let raw;
        try {
          raw = JSON.parse(text);
        } catch (e) {
          throw new Error(`Invalid JSON: ${e.message}`);
        }

        // Normalize to FeatureCollection
        const fc = normalizeToFeatureCollection(raw);
        console.log(`[GeoJSONLoader] ${fc.features.length} feature(s)`);

        if (fc.features.length === 0) {
          alert(
            `"${f.name}" has 0 features — nothing to display.\n\n` +
            `The file is valid GeoJSON but the features array is empty.\n` +
            `Add Points, Lines or Polygons to the file first.`
          );
          onDone?.(); return;
        }

        // Compute bounds from raw coordinates
        // (circleMarker/marker don't contribute to layer.getBounds())
        const bounds = computeBoundsFromGeoJSON(fc);

        // Build Leaflet layer
        const currentMap = mapRef.current;
        if (!currentMap) throw new Error("Map became unavailable during parsing");

        const layer = L.geoJSON(fc, {
          style: (feature) => {
            const t = feature?.geometry?.type || "";
            if (t === "Polygon"    || t === "MultiPolygon")    return POLYGON_STYLE;
            if (t === "LineString" || t === "MultiLineString") return LINE_STYLE;
            return {};
          },

          pointToLayer: (feature, latlng) => {
            const p     = feature.properties || {};
            const label = p.name || p.Name || p.title || p.label || "";
            const marker = L.circleMarker(latlng, POINT_STYLE);
            if (label) {
              marker.bindTooltip(String(label), {
                permanent: false, direction: "top",
              });
            }
            return marker;
          },

          onEachFeature: (feature, lyr) => {
            const p     = feature.properties || {};
            const title = p.name || p.Name || p.title || p.id || "Feature";
            const rows  = Object.entries(p)
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .slice(0, 10)
              .map(([k, v]) =>
                `<tr>
                  <td style="font-weight:700;color:#555;padding:2px 8px 2px 0;
                    font-size:11px;text-transform:uppercase;white-space:nowrap">
                    ${escHtml(k)}</td>
                  <td style="color:#111;padding:2px 0;font-size:12px">
                    ${escHtml(String(v))}</td>
                </tr>`
              ).join("");

            const isPoint  = feature.geometry?.type === "Point";
            const coords   = feature.geometry?.coordinates;
            const coordRow = (isPoint && coords?.length >= 2)
              ? `<tr>
                  <td style="font-weight:700;color:#555;padding:2px 8px 2px 0;
                    font-size:11px;text-transform:uppercase">Location</td>
                  <td style="color:#111;font-size:12px">
                    ${Math.abs(coords[1]).toFixed(6)}°${coords[1]<0?"S":"N"}&nbsp;
                    ${Math.abs(coords[0]).toFixed(6)}°${coords[0]<0?"W":"E"}
                  </td></tr>`
              : "";

            lyr.bindPopup(
              `<div style="font-family:sans-serif;min-width:160px;max-width:280px">
                <div style="background:#0f172a;color:#4ade80;padding:7px 12px;
                  margin:-13px -20px 10px;font-weight:800;font-size:13px;
                  border-radius:4px 4px 0 0">
                  ${escHtml(String(title))}
                </div>
                ${(rows || coordRow)
                  ? `<table style="border-collapse:collapse;width:100%">
                      ${rows}${coordRow}</table>`
                  : `<div style="color:#888;font-size:12px;font-style:italic">
                      No properties</div>`
                }
              </div>`,
              { maxWidth: 300 }
            );
          },
        });

        // Add layer to map
        layer.addTo(currentMap);
        layerRef.current = layer;
        console.log("[GeoJSONLoader] ✅ Layer added to map");

        // ── FIX 1 + FIX 2: Fit bounds WITHOUT animate:false, unlock AFTER moveend ──
        if (bounds && bounds.isValid()) {
          const isOnePoint =
            fc.features.length === 1 &&
            fc.features[0]?.geometry?.type === "Point";

          // moveend fires once the camera settles — safe to unlock here
          currentMap.once("moveend", () => {
            reEnableHandlers(currentMap);
            forceUnlock(currentMap);
            console.log("[GeoJSONLoader] ✅ Done");
            onDone?.();
          });

          if (isOnePoint) {
            const c = fc.features[0].geometry.coordinates;
            // FIX 1: no animate:false — let Leaflet finish cleanly
            currentMap.setView([c[1], c[0]], 16);
          } else {
            // FIX 1: no animate:false — let Leaflet finish cleanly
            currentMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
          }
        } else {
          // No valid bounds — unlock immediately
          reEnableHandlers(currentMap);
          forceUnlock(currentMap);
          console.log("[GeoJSONLoader] ✅ Done (no bounds)");
          onDone?.();
        }

      } catch (err) {
        console.error("[GeoJSONLoader] ❌", err);
        alert(`Failed to load GeoJSON.\n\n${err.message}`);
        onDone?.();
      }
    };

    reader.onerror = () => {
      alert("Could not read the file. Please try again.");
      onDone?.();
    };

    reader.readAsText(f, "UTF-8");

    return () => {
      if (layerRef.current) {
        try { mapRef.current?.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   normalizeToFeatureCollection
───────────────────────────────────────────────────────────────────────────── */
function normalizeToFeatureCollection(data) {
  if (!data || typeof data !== "object") throw new Error("Not a JSON object.");

  const GEOM = new Set([
    "Point","MultiPoint","LineString","MultiLineString",
    "Polygon","MultiPolygon","GeometryCollection",
  ]);
  const t = data.type;

  if (t === "FeatureCollection")
    return { type: "FeatureCollection", features: Array.isArray(data.features) ? data.features : [] };
  if (t === "Feature")
    return { type: "FeatureCollection", features: [data] };
  if (t && GEOM.has(t))
    return { type: "FeatureCollection", features: [{ type: "Feature", geometry: data, properties: {} }] };
  if (Array.isArray(data.features))
    return { type: "FeatureCollection", features: data.features };

  throw new Error(
    `Not a valid GeoJSON file.\nType: "${t || "(missing)"}"\n` +
    `Expected: FeatureCollection, Feature, Point, Polygon, LineString, etc.`
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   computeBoundsFromGeoJSON
   Manual coordinate extraction — works for Points (circleMarker has no bounds)
───────────────────────────────────────────────────────────────────────────── */
function computeBoundsFromGeoJSON(fc) {
  const pts = [];
  const walk = (geom) => {
    if (!geom) return;
    switch (geom.type) {
      case "Point":
        if (geom.coordinates?.length >= 2)
          pts.push([geom.coordinates[1], geom.coordinates[0]]);
        break;
      case "MultiPoint": case "LineString":
        (geom.coordinates || []).forEach(c => { if (c?.length >= 2) pts.push([c[1], c[0]]); });
        break;
      case "MultiLineString": case "Polygon":
        (geom.coordinates || []).forEach(r => (r || []).forEach(c => { if (c?.length >= 2) pts.push([c[1], c[0]]); }));
        break;
      case "MultiPolygon":
        (geom.coordinates || []).forEach(p => (p || []).forEach(r => (r || []).forEach(c => { if (c?.length >= 2) pts.push([c[1], c[0]]); })));
        break;
      case "GeometryCollection":
        (geom.geometries || []).forEach(walk);
        break;
      default: break;
    }
  };
  (fc.features || []).forEach(f => { if (f?.geometry) walk(f.geometry); });
  if (pts.length === 0) return null;
  try { const b = L.latLngBounds(pts); return b.isValid() ? b : null; } catch (_) { return null; }
}

/* ─────────────────────────────────────────────────────────────────────────────
   reEnableHandlers
───────────────────────────────────────────────────────────────────────────── */
function reEnableHandlers(m) {
  if (!m) return;
  ["dragging","scrollWheelZoom","touchZoom","doubleClickZoom","keyboard","boxZoom","tap"]
    .forEach(h => { try { if (m[h]?.enable) m[h].enable(); } catch (_) {} });
}

/* ─────────────────────────────────────────────────────────────────────────────
   forceUnlock
   FIX 3: Added _animatingZoom and _zooming — the exact internal flags Leaflet
   checks before accepting scroll-wheel or button zoom input.
───────────────────────────────────────────────────────────────────────────── */
function forceUnlock(m) {
  if (!m) return;
  try { if (m._flyingTo)    m._flyingTo    = false; } catch (_) {}
  try { if (m._flyToFrame)  { cancelAnimationFrame(m._flyToFrame); m._flyToFrame = null; } } catch (_) {}
  try { if (m._panTransition) m._panTransition = null; } catch (_) {}
  // FIX 3: reset zoom-lock flags
  try { m._animatingZoom = false; } catch (_) {}
  try { m._zooming       = false; } catch (_) {}
  try { if (m._container) m._container.style.pointerEvents = ""; } catch (_) {}
  try { m.invalidateSize({ animate: false }); } catch (_) {}
}

/* ─────────────────────────────────────────────────────────────────────────────
   escHtml
───────────────────────────────────────────────────────────────────────────── */
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default GeoJSONLoader;