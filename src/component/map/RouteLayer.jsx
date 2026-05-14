// src/components/map/RouteLayer.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Renders the directions route on the Leaflet map:
//  • Dimmed dashed polylines for alternative routes
//  • Bold blue polyline for the active route (with drop-shadow outline)
//  • Google Earth-style A (green) and B (red) pin markers with tooltips
//  • Auto-fits map bounds to the active route with panel offset awareness
//  • Cleans up all layers on unmount or when routeResult changes
//  • Handles map resize when directions panel is open
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
    popupAnchor: [0, -38],
  });
}

const PIN_A = makePinIcon("A", "#34a853");
const PIN_B = makePinIcon("B", "#ea4335");

/* ── Component ───────────────────────────────────────────────────────────── */
export default function RouteLayer({ routeResult, activeRouteIdx, onRouteClick }) {
  const map       = useMap();
  const layersRef = useRef([]);
  const fitBoundsTimeoutRef = useRef(null);

  // Helper to fit bounds with panel offset
  const fitBoundsWithOffset = (bounds) => {
    if (!bounds.isValid()) return;
    
    // Check if directions panel is open (you can pass this as a prop or detect)
    const panelElement = document.querySelector('.directions-panel');
    const isPanelOpen = panelElement && panelElement.style.display !== 'none';
    const panelWidth = isPanelOpen ? 320 : 0;
    
    // Calculate padding based on panel width
    const padding = {
      top: 60,
      bottom: 60,
      left: panelWidth + 20,
      right: 20
    };
    
    try {
      map.fitBounds(bounds, { 
        padding: [padding.top, padding.right, padding.bottom, padding.left],
        maxZoom: 16, 
        animate: true,
        duration: 0.5
      });
    } catch (error) {
      console.warn("Error fitting bounds:", error);
    }
  };

  useEffect(() => {
    // Clear any pending fitBounds timeouts
    if (fitBoundsTimeoutRef.current) {
      clearTimeout(fitBoundsTimeoutRef.current);
    }

    // ── Remove all previous layers ──────────────────────────────────────────
    layersRef.current.forEach(l => { 
      try { 
        if (l.remove) l.remove(); 
      } catch (_) {}
    });
    layersRef.current = [];

    if (!routeResult?.routes?.length) {
      return;
    }

    const { routes, origin, destination } = routeResult;
    const activeIdx = activeRouteIdx ?? 0;

    // ── Draw inactive (alternative) routes first ────────────────────────────
    routes.forEach((route, idx) => {
      if (idx === activeIdx) return; // draw active route last (on top)
      if (!route.coordinates?.length) return;

      const normalizedCoords = normalizeCoords(route.coordinates);
      if (normalizedCoords.length === 0) return;

      const altLine = L.polyline(normalizedCoords, {
        color:     "#4a9eff",
        weight:    5,
        opacity:   0.28,
        dashArray: "8 6",
        lineCap:   "round",
        lineJoin:  "round",
        className: "alternative-route",
      }).addTo(map);

      // Add click handler for alternative routes
      altLine.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (onRouteClick) {
          onRouteClick(idx);
        }
      });

      // Add hover effect
      altLine.on("mouseover", () => {
        altLine.setStyle({ opacity: 0.5, weight: 6 });
      });
      altLine.on("mouseout", () => {
        altLine.setStyle({ opacity: 0.28, weight: 5 });
      });

      layersRef.current.push(altLine);
    });

    // ── Draw active route ───────────────────────────────────────────────────
    const active = routes[activeIdx];
    if (active?.coordinates?.length) {
      const coords = normalizeCoords(active.coordinates);
      
      if (coords.length > 0) {
        // Drop-shadow / outline pass
        const shadow = L.polyline(coords, {
          color:     "rgba(0,0,0,0.25)",
          weight:    12,
          opacity:   0.8,
          lineCap:   "round",
          lineJoin:  "round",
          className: "route-shadow",
        }).addTo(map);

        // White casing
        const casing = L.polyline(coords, {
          color:     "#fff",
          weight:    8,
          opacity:   0.65,
          lineCap:   "round",
          lineJoin:  "round",
          className: "route-casing",
        }).addTo(map);

        // Main coloured route line
        const routeLine = L.polyline(coords, {
          color:      "#1a73e8",
          weight:     5,
          opacity:    0.95,
          lineCap:    "round",
          lineJoin:   "round",
          className:  "active-route",
          smoothFactor: 1.5,
        }).addTo(map);

        // Add animation to active route
        const dashLine = L.polyline(coords, {
          color:      "#60a5fa",
          weight:     3,
          opacity:    0.4,
          lineCap:    "round",
          lineJoin:   "round",
          dashArray:  "10 15",
          className:  "route-dash-animation",
        }).addTo(map);

        layersRef.current.push(shadow, casing, routeLine, dashLine);

        // Animate the dashed line
        let offset = 0;
        const animateDash = () => {
          offset = (offset + 1) % 25;
          dashLine.setStyle({ dashOffset: offset });
          animationFrame = requestAnimationFrame(animateDash);
        };
        let animationFrame = requestAnimationFrame(animateDash);
        
        // Store animation frame for cleanup
        layersRef.current.push({ 
          remove: () => {
            if (animationFrame) cancelAnimationFrame(animationFrame);
            dashLine.remove();
          } 
        });

        // Fit map to active route with delay to ensure map is ready
        setTimeout(() => {
          try {
            const bounds = routeLine.getBounds();
            if (bounds.isValid()) {
              fitBoundsWithOffset(bounds);
            }
          } catch (error) {
            console.warn("Error fitting bounds:", error);
          }
        }, 100);
      }
    }

    // ── Origin marker (A — green pin) ───────────────────────────────────────
    if (origin?.lat != null && origin?.lng != null) {
      const markerA = L.marker([origin.lat, origin.lng], { 
        icon: PIN_A, 
        zIndexOffset: 1000,
        title: origin.label || "Origin"
      }).addTo(map);
      
      markerA.bindTooltip(
        `<div style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;background:rgba(0,0,0,0.8);padding:4px 8px;border-radius:6px;border-left:3px solid #34a853;">
          📍 ${origin.label || "Origin"}
        </div>`,
        { 
          permanent: false, 
          className: "survey-tooltip", 
          direction: "top",
          offset: [0, -10]
        }
      );
      
      // Add popup with more info
      markerA.bindPopup(
        `<div style="font-family:'DM Sans',sans-serif;">
          <strong>📍 Start Point</strong><br/>
          ${origin.label || "Origin"}
        </div>`
      );
      
      layersRef.current.push(markerA);
    }

    // ── Destination marker (B — red pin) ───────────────────────────────────
    if (destination?.lat != null && destination?.lng != null) {
      const markerB = L.marker([destination.lat, destination.lng], { 
        icon: PIN_B, 
        zIndexOffset: 1000,
        title: destination.label || "Destination"
      }).addTo(map);
      
      markerB.bindTooltip(
        `<div style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;background:rgba(0,0,0,0.8);padding:4px 8px;border-radius:6px;border-left:3px solid #ea4335;">
          🏁 ${destination.label || "Destination"}
        </div>`,
        { 
          permanent: false, 
          className: "survey-tooltip", 
          direction: "top",
          offset: [0, -10]
        }
      );
      
      // Add popup with more info
      markerB.bindPopup(
        `<div style="font-family:'DM Sans',sans-serif;">
          <strong>🏁 Destination</strong><br/>
          ${destination.label || "Destination"}
        </div>`
      );
      
      layersRef.current.push(markerB);
    }

    // Add distance markers along the route (optional)
    if (active?.coordinates?.length && active.distance > 500) {
      addDistanceMarkers(active.coordinates, active.distance);
    }

    // ── Cleanup on next effect or unmount ───────────────────────────────────
    return () => {
      if (fitBoundsTimeoutRef.current) {
        clearTimeout(fitBoundsTimeoutRef.current);
      }
      layersRef.current.forEach(l => { 
        try { 
          if (l && l.remove) l.remove(); 
        } catch (_) {}
      });
      layersRef.current = [];
    };
  }, [routeResult, activeRouteIdx, map, onRouteClick]);

  // Helper function to add distance markers
  const addDistanceMarkers = (coordinates, totalDistance) => {
    const intervals = [0.25, 0.5, 0.75]; // Show markers at 25%, 50%, 75%
    const normalizedCoords = normalizeCoords(coordinates);
    
    intervals.forEach(percentage => {
      const distanceAtPoint = totalDistance * percentage;
      let accumulatedDistance = 0;
      let targetPoint = null;
      
      for (let i = 0; i < normalizedCoords.length - 1; i++) {
        const p1 = L.latLng(normalizedCoords[i][0], normalizedCoords[i][1]);
        const p2 = L.latLng(normalizedCoords[i + 1][0], normalizedCoords[i + 1][1]);
        const segmentDistance = p1.distanceTo(p2);
        
        if (accumulatedDistance + segmentDistance >= distanceAtPoint) {
          const ratio = (distanceAtPoint - accumulatedDistance) / segmentDistance;
          const lat = p1.lat + (p2.lat - p1.lat) * ratio;
          const lng = p1.lng + (p2.lng - p1.lng) * ratio;
          targetPoint = [lat, lng];
          break;
        }
        accumulatedDistance += segmentDistance;
      }
      
      if (targetPoint) {
        const distanceMarker = L.circleMarker(targetPoint, {
          radius: 4,
          color: "#fff",
          weight: 2,
          opacity: 1,
          fillColor: "#1a73e8",
          fillOpacity: 0.8
        }).addTo(map);
        
        distanceMarker.bindTooltip(
          `${Math.round(percentage * 100)}% of route`,
          { permanent: false, direction: "top" }
        );
        
        layersRef.current.push(distanceMarker);
      }
    });
  };

  return null;
}

/* ── Utility: normalise coordinate arrays ────────────────────────────────── */
// Accepts  [[lat,lng], ...]  OR  [{lat,lng}, ...]  OR  [[lng,lat], ...] (GeoJSON)
function normalizeCoords(coords) {
  if (!coords?.length) return [];
  
  try {
    const first = coords[0];

    // Already [lat, lng] arrays
    if (Array.isArray(first)) {
      // Check if it's a valid coordinate
      if (coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        // Single coordinate pair
        return [coords];
      }
      
      // Check for GeoJSON format [lng, lat]
      const mightBeLngFirst = Math.abs(first[0]) > 90 || 
        (Math.abs(first[0]) <= 180 && Math.abs(first[1]) <= 90 && Math.abs(first[0]) > Math.abs(first[1]));
      
      if (mightBeLngFirst && first.length === 2) {
        return coords.map(c => {
          if (Array.isArray(c) && c.length === 2) {
            return [parseFloat(c[1]), parseFloat(c[0])];
          }
          return c;
        });
      }
      
      // Already [lat, lng] format
      return coords.map(c => {
        if (Array.isArray(c) && c.length === 2) {
          return [parseFloat(c[0]), parseFloat(c[1])];
        }
        return c;
      });
    }

    // Object form {lat, lng}
    if (typeof first === "object" && first.lat != null && first.lng != null) {
      return coords.map(c => [parseFloat(c.lat), parseFloat(c.lng)]);
    }

    return coords;
  } catch (error) {
    console.error("Error normalizing coordinates:", error);
    return [];
  }
}