// src/components/map/RouteLayer.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Renders the directions route on the Leaflet map:
//  • Dimmed dashed polylines for alternative routes
//  • Bold blue polyline for the active route (with drop-shadow outline)
//  • Google Earth-style A (green) and B (red) pin markers with tooltips
//  • Auto-fits map bounds to the active route
//  • Cleans up all layers on unmount or when routeResult changes
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/* ── Build a Google-Earth-style div-icon pin ─────────────────────────────── */
function makePinIcon(letter, bgColor) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 30px; height: 30px;
        background: ${bgColor};
        border: 3px solid #fff;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 3px 10px rgba(0,0,0,0.45);
        display: flex; align-items: center; justify-content: center;
      ">
        <span style="
          transform: rotate(45deg);
          color: #fff; font-weight: 800;
          font-size: 12px; font-family: system-ui,sans-serif;
          display: block; margin-left: 1px; margin-top: 1px;
        ">${letter}</span>
      </div>
      <div style="
        width: 6px; height: 6px;
        background: ${bgColor};
        border-radius: 50%;
        margin: 1px auto 0;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      "></div>
    `,
    iconSize:   [30, 38],
    iconAnchor: [15, 38],
    tooltipAnchor: [0, -38],
  });
}

const PIN_A = makePinIcon("A", "#34a853");
const PIN_B = makePinIcon("B", "#ea4335");

/* ── Component ───────────────────────────────────────────────────────────── */
export default function RouteLayer({ routeResult, activeRouteIdx }) {
  const map       = useMap();
  const layersRef = useRef([]);

  useEffect(() => {
    // ── Remove all previous layers ──────────────────────────────────────────
    layersRef.current.forEach(l => { try { l.remove(); } catch (_) {} });
    layersRef.current = [];

    if (!routeResult?.routes?.length) return;

    const { routes, origin, destination } = routeResult;
    const activeIdx = activeRouteIdx ?? 0;

    // ── Draw inactive (alternative) routes first ────────────────────────────
    routes.forEach((route, idx) => {
      if (idx === activeIdx) return; // draw active route last (on top)
      if (!route.coordinates?.length) return;

      const altLine = L.polyline(
        normalizeCoords(route.coordinates),
        {
          color:     "#4a9eff",
          weight:    5,
          opacity:   0.28,
          dashArray: "8 6",
          lineCap:   "round",
        }
      ).addTo(map);

      altLine.on("click", () => {
        // Clicking an alt route could trigger setActiveRouteIdx — wired via parent
      });

      layersRef.current.push(altLine);
    });

    // ── Draw active route ───────────────────────────────────────────────────
    const active = routes[activeIdx];
    if (active?.coordinates?.length) {
      const coords = normalizeCoords(active.coordinates);

      // Drop-shadow / outline pass
      const shadow = L.polyline(coords, {
        color:   "rgba(0,0,0,0.22)",
        weight:  10,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      // White casing
      const casing = L.polyline(coords, {
        color:   "#fff",
        weight:  8,
        opacity: 0.55,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      // Main coloured route line
      const routeLine = L.polyline(coords, {
        color:    "#1a73e8",
        weight:   5,
        opacity:  0.95,
        lineCap:  "round",
        lineJoin: "round",
      }).addTo(map);

      layersRef.current.push(shadow, casing, routeLine);

      // Fit map to active route
      try {
        const bounds = routeLine.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [60, 80], maxZoom: 16, animate: true });
        }
      } catch (_) {}
    }

    // ── Origin marker (A — green pin) ───────────────────────────────────────
    if (origin?.lat != null && origin?.lng != null) {
      const markerA = L.marker([origin.lat, origin.lng], { icon: PIN_A, zIndexOffset: 1000 })
        .addTo(map)
        .bindTooltip(
          `<div style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;">
            📍 ${origin.label || "Origin"}
          </div>`,
          { permanent: false, className: "survey-tooltip", direction: "top" }
        );
      layersRef.current.push(markerA);
    }

    // ── Destination marker (B — red pin) ───────────────────────────────────
    if (destination?.lat != null && destination?.lng != null) {
      const markerB = L.marker([destination.lat, destination.lng], { icon: PIN_B, zIndexOffset: 1000 })
        .addTo(map)
        .bindTooltip(
          `<div style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;">
            🏁 ${destination.label || "Destination"}
          </div>`,
          { permanent: false, className: "survey-tooltip", direction: "top" }
        );
      layersRef.current.push(markerB);
    }

    // ── Cleanup on next effect or unmount ───────────────────────────────────
    return () => {
      layersRef.current.forEach(l => { try { l.remove(); } catch (_) {} });
      layersRef.current = [];
    };
  }, [routeResult, activeRouteIdx, map]);

  return null;
}

/* ── Utility: normalise coordinate arrays ────────────────────────────────── */
// Accepts  [[lat,lng], ...]  OR  [{lat,lng}, ...]  OR  [[lng,lat], ...] (GeoJSON)
function normalizeCoords(coords) {
  if (!coords?.length) return [];
  const first = coords[0];

  // Already [lat, lng] arrays
  if (Array.isArray(first)) {
    // GeoJSON uses [lng, lat] — detect by range:
    // lng is typically -180…180, lat is -90…90
    // If first[0] looks like a longitude (abs > 90 or second element looks like lat),
    // flip to [lat, lng]
    const mightBeLngFirst =
      Math.abs(first[0]) > 90 ||
      (Math.abs(first[0]) <= 180 && Math.abs(first[1]) <= 90 && Math.abs(first[0]) > Math.abs(first[1]));
    if (mightBeLngFirst) {
      return coords.map(c => [c[1], c[0]]);
    }
    return coords; // already [lat, lng]
  }

  // Object form {lat, lng}
  if (typeof first === "object" && first.lat != null) {
    return coords.map(c => [c.lat, c.lng]);
  }

  return coords;
}