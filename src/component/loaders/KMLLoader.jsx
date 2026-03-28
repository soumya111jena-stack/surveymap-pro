/**
 * KMLLoader.jsx — SurveyMap Pro v5.8 (FIXED)
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES:
 *  1. Removed double useMap() call — useRef(useMap()) + separate useEffect
 *     was calling useMap() twice; now uses a single stable ref pattern
 *  2. Layer cleanup on file=null — when parent sets file to null (user removes
 *     the file), the effect now detects null and removes the layer from the map
 *  3. fitBounds always uses animate:false to prevent map lock bug
 *  4. forceUnlock called after every fitBounds
 *  5. Popup content properly HTML-escaped
 *  6. onDone() always called even on error paths
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import omnivore from "@mapbox/leaflet-omnivore";

export default function KMLLoader({ file, onDone }) {
  const map = useMap();
  const mapRef = useRef(map);
  const layerRef = useRef(null);

  // Keep mapRef current without calling useMap() twice
  mapRef.current = map;

  useEffect(() => {
    const m = mapRef.current;

    // ── File removed — clean up map layer ──────────────────────────────
    if (!file) {
      if (layerRef.current) {
        try { m.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
      return;
    }

    // Remove previous layer
    if (layerRef.current) {
      try { m.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }

    console.log(`[KMLLoader] Loading "${file.name}" (${file.size} bytes)`);

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const kmlText = evt.target.result;

        if (!kmlText || (!kmlText.includes("<kml") && !kmlText.includes("<Placemark"))) {
          alert(`"${file.name}" does not appear to be a valid KML file.`);
          onDone?.();
          return;
        }

        const geojsonLayer = omnivore.kml.parse(kmlText);
        if (!geojsonLayer) throw new Error("omnivore returned null");

        const geojsonData = geojsonLayer.toGeoJSON();
        const featureCount = geojsonData?.features?.length ?? 0;
        console.log(`[KMLLoader] ${featureCount} features parsed`);

        if (featureCount === 0) {
          alert(`"${file.name}" was parsed but contains no mappable features.`);
          onDone?.();
          return;
        }

        const layer = L.geoJSON(geojsonData, {
          style: {
            color: "#facc15",
            weight: 3,
            opacity: 0.9,
            fillColor: "#facc15",
            fillOpacity: 0.3,
          },

          pointToLayer: (feature, latlng) => {
            const name = escHtml(
              feature.properties?.name || feature.properties?.Name || ""
            );
            return L.marker(latlng, {
              icon: L.divIcon({
                className: "",
                html: `
                  <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
                    <div style="width:14px;height:14px;background:#facc15;border:2px solid #000;
                      border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.6)"></div>
                    ${name ? `<div style="margin-top:3px;background:rgba(0,0,0,0.65);color:#fff;
                      font-size:10px;font-weight:600;padding:2px 5px;border-radius:3px;
                      white-space:nowrap;max-width:160px;overflow:hidden;
                      text-overflow:ellipsis;font-family:sans-serif">${name}</div>` : ""}
                  </div>`,
                iconAnchor: [7, 7],
                popupAnchor: [0, -14],
              }),
            });
          },

          onEachFeature: (feature, lyr) => {
            const p = feature.properties || {};
            const title = escHtml(p.name || p.Name || "Feature");

            const rows = Object.entries(p)
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) => `
                <tr>
                  <td style="font-weight:700;color:#555;padding:3px 8px 3px 0;
                    text-transform:uppercase;font-size:11px;white-space:nowrap">
                    ${escHtml(k)}
                  </td>
                  <td style="color:#111;padding:3px 0;font-size:12px">
                    ${escHtml(String(v))}
                  </td>
                </tr>`
              ).join("");

            const coords = feature.geometry?.coordinates;
            const isPoint = feature.geometry?.type === "Point";
            const coordRow = (isPoint && coords?.length >= 2)
              ? `<tr>
                  <td style="font-weight:700;color:#555;padding:3px 8px 3px 0;
                    text-transform:uppercase;font-size:11px">Coords</td>
                  <td style="color:#111;font-size:11px">
                    ${Math.abs(coords[1]).toFixed(6)}°${coords[1] < 0 ? "S" : "N"}&nbsp;
                    ${Math.abs(coords[0]).toFixed(6)}°${coords[0] < 0 ? "W" : "E"}
                  </td>
                </tr>`
              : "";

            lyr.bindPopup(`
              <div style="font-family:sans-serif;min-width:180px;max-width:280px">
                <div style="background:#1a1a2e;color:#facc15;padding:8px 12px;
                  margin:-13px -20px 10px;font-weight:800;font-size:13px;
                  border-radius:4px 4px 0 0;letter-spacing:0.04em">
                  ${title}
                </div>
                <table style="border-collapse:collapse;width:100%">
                  ${rows}${coordRow}
                </table>
              </div>`,
              { maxWidth: 320 }
            );
          },
        }).addTo(m);

        layerRef.current = layer;

        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {
          m.fitBounds(bounds, { padding: [50, 50], maxZoom: 18, animate: false });
          reEnableHandlers(m);
          forceUnlock(m);
        }

        console.log("[KMLLoader] ✅ Done");
        onDone?.();

      } catch (err) {
        console.error("[KMLLoader] Parse error:", err);
        alert(`Failed to parse KML file.\n\nError: ${err?.message || err}`);
        onDone?.();
      }
    };

    reader.onerror = () => {
      alert("Could not read the KML file. Please try again.");
      onDone?.();
    };

    reader.readAsText(file);

    return () => {
      if (layerRef.current) {
        try { mapRef.current.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function reEnableHandlers(m) {
  if (!m) return;
  ["dragging", "scrollWheelZoom", "touchZoom", "doubleClickZoom", "keyboard", "boxZoom", "tap"]
    .forEach(h => { try { if (m[h]?.enable) m[h].enable(); } catch (_) {} });
}

function forceUnlock(m) {
  if (!m) return;
  try { if (m._flyingTo) m._flyingTo = false; } catch (_) {}
  try { if (m._flyToFrame) { cancelAnimationFrame(m._flyToFrame); m._flyToFrame = null; } } catch (_) {}
  try { if (m._panTransition) m._panTransition = null; } catch (_) {}
  try { m._animatingZoom = false; } catch (_) {}
  try { m._zooming = false; } catch (_) {}
  try { if (m._container) m._container.style.pointerEvents = ""; } catch (_) {}
  try { m.invalidateSize({ animate: false }); } catch (_) {}
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}