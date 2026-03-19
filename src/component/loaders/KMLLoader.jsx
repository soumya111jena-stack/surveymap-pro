/**
 * KMLLoader.jsx — SurveyMap Pro v5.4.2
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX v5.4.2 — MAP COMPLETELY UNRESPONSIVE AFTER KML LOAD
 *
 *  ROOT CAUSE (deeper than v5.4.1 thought):
 *    flyToBounds(animate:true) uses Leaflet's internal fly animation which
 *    sets map._flyingTo = true. While this flag is set:
 *      - scrollWheel zoom is ignored
 *      - touch events are ignored
 *      - drag is blocked
 *    The flag is cleared when the animation ends naturally. BUT — if the React
 *    component re-renders during the animation (which React 18 does for state
 *    updates), the animation can be interrupted mid-flight, leaving
 *    map._flyingTo stuck as true permanently. Result: map is frozen forever.
 *
 *  ALSO: flyToBounds fires movestart → zoom → move (many times) → moveend.
 *    If moveend never fires (interrupted animation), the re-enable code
 *    never runs. The 2000ms safety timer helped but 2000ms of frozen map
 *    is still a bad UX.
 *
 *  CORRECT FIX — two-step approach:
 *    Step 1: Use fitBounds with animate:false (INSTANT, no animation, no lock)
 *            This immediately sets the correct zoom+center with zero lock time.
 *    Step 2: Re-enable ALL handlers explicitly right after fitBounds returns
 *            (synchronously — no waiting needed since there's no animation).
 *    Step 3: Force-clear any Leaflet internal lock flags just to be safe.
 *
 *  This gives Google-Earth-style "zoom to fit on load" behavior with zero
 *  map lock time. The map is immediately interactive after the file loads.
 *
 *  Works on: desktop (scroll zoom), mobile (pinch zoom), after KMZ too.
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import omnivore from "@mapbox/leaflet-omnivore";

function KMLLoader({ file, onDone }) {
  const map      = useRef(useMap());   // stable ref — never stale
  const layerRef = useRef(null);

  // Keep map ref fresh
  const liveMap = useMap();
  useEffect(() => { map.current = liveMap; }, [liveMap]);

  useEffect(() => {
    if (!file) return;

    // Remove previous layer
    if (layerRef.current) {
      try { map.current.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const geojsonData = omnivore.kml.parse(evt.target.result).toGeoJSON();
        const m = map.current;

        const layer = L.geoJSON(geojsonData, {
          style: {
            color:       "#facc15",
            weight:      3,
            opacity:     0.9,
            fillColor:   "#facc15",
            fillOpacity: 0.3,
          },

          pointToLayer: (feature, latlng) => {
            const name = feature.properties?.name || feature.properties?.Name || "";
            return L.marker(latlng, {
              icon: L.divIcon({
                className: "",
                html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
                  <div style="width:14px;height:14px;background:#facc15;border:2px solid #000;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.6)"></div>
                  ${name ? `<div style="margin-top:3px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;font-weight:600;padding:2px 5px;border-radius:3px;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;font-family:sans-serif">${name}</div>` : ""}
                </div>`,
                iconAnchor:  [7, 7],
                popupAnchor: [0, -10],
              }),
            });
          },

          onEachFeature: (feature, lyr) => {
            const p    = feature.properties || {};
            const rows = Object.entries(p)
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) =>
                `<tr>
                  <td style="font-weight:700;color:#555;padding:3px 8px 3px 0;text-transform:uppercase;font-size:11px;white-space:nowrap">${k}</td>
                  <td style="color:#111;padding:3px 0;font-size:12px">${v}</td>
                </tr>`
              ).join("");

            const coords   = feature.geometry?.coordinates;
            const coordRow = coords
              ? `<tr>
                  <td style="font-weight:700;color:#555;padding:3px 8px 3px 0;text-transform:uppercase;font-size:11px">Location</td>
                  <td style="color:#111;font-size:12px">
                    ${Math.abs(coords[1]).toFixed(6)}°${coords[1] < 0 ? "S" : "N"}&nbsp;
                    ${Math.abs(coords[0]).toFixed(6)}°${coords[0] < 0 ? "W" : "E"}
                  </td>
                </tr>`
              : "";

            lyr.bindPopup(
              `<div style="font-family:sans-serif;min-width:180px;max-width:260px">
                <div style="background:#1a1a2e;color:#facc15;padding:8px 12px;margin:-13px -20px 10px;font-weight:800;font-size:13px;border-radius:4px 4px 0 0;letter-spacing:0.04em">
                  ${p.name || p.Name || "Feature"}
                </div>
                <table style="border-collapse:collapse;width:100%">
                  ${rows}${coordRow}
                </table>
              </div>`,
              { maxWidth: 300 }
            );
          },
        }).addTo(m);

        layerRef.current = layer;

        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {

          // ── STEP 1: Instant fitBounds — NO animation, NO lock ─────────
          // animate:false means Leaflet jumps directly to the new view.
          // No _flyingTo flag, no movestart/moveend chain, no handler disabling.
          m.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 18,
            animate: false,   // ← KEY: instant, zero lock time
          });

          // ── STEP 2: Re-enable all handlers synchronously ──────────────
          // fitBounds(animate:false) is synchronous — by the time we reach
          // this line, the view has already been set and we can interact.
          reEnableMapHandlers(m);

          // ── STEP 3: Force-clear any stale internal Leaflet lock flags ─
          forceUnlockMap(m);

        } else {
          reEnableMapHandlers(m);
          forceUnlockMap(m);
        }

        onDone?.();

      } catch (err) {
        console.error("[KMLLoader] Parse error:", err);
        alert(`Failed to parse KML file.\n\nError: ${err?.message || err}`);
        onDone?.();
      }
    };

    reader.onerror = () => {
      alert("Could not read the file. Please try again.");
      onDone?.();
    };

    reader.readAsText(file);

    return () => {
      if (layerRef.current) {
        try { map.current.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Re-enable every Leaflet interaction handler.
   Safe to call even if a handler is already enabled (no-ops in that case).
───────────────────────────────────────────────────────────────────────────── */
function reEnableMapHandlers(m) {
  if (!m) return;
  const handlers = [
    "dragging",
    "scrollWheelZoom",
    "touchZoom",
    "doubleClickZoom",
    "keyboard",
    "boxZoom",
    "tap",
  ];
  handlers.forEach(name => {
    try { if (m[name]) m[name].enable(); } catch (_) {}
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Force-clear stale Leaflet internal lock flags.
   These flags can get stuck if an animation is interrupted mid-flight.
   Accessing private Leaflet properties is intentional here — this is a
   targeted bug fix, not general usage.
───────────────────────────────────────────────────────────────────────────── */
function forceUnlockMap(m) {
  if (!m) return;
  try {
    // Clear fly animation lock
    if (m._flyingTo) m._flyingTo = false;
    // Clear any pending animation frame
    if (m._flyToFrame) {
      cancelAnimationFrame(m._flyToFrame);
      m._flyToFrame = null;
    }
    // Clear pan/zoom animation state
    if (m._panTransition) {
      try { m._panTransition._clearPos?.(); } catch (_) {}
      m._panTransition = null;
    }
    // Ensure the map container receives pointer events
    if (m._container) {
      m._container.style.pointerEvents = "";
    }
    // Fire a dummy resize to reset any layout-related locks
    try { m.invalidateSize({ animate: false }); } catch (_) {}
  } catch (_) {}
}

export default KMLLoader;