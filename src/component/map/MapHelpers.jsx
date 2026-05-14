// ─── MapHelpers.jsx — Small Leaflet hook-based helper components ──────────────
import { useEffect } from "react";
import { useMap }    from "react-leaflet";
import L             from "leaflet";

/**
 * Flies / fits the map whenever flyTarget changes.
 * flyTarget: { lat, lng, zoom?, bbox?, _ts }
 */
export function MapFlyController({ flyTarget }) {
  const map = useMap();
  useEffect(() => {
    if (!flyTarget) return;
    const { lat, lng, zoom, bbox } = flyTarget;
    if (isNaN(lat) || isNaN(lng)) return;
    if (bbox) {
      try {
        const bounds = L.latLngBounds(
          [parseFloat(bbox[0]), parseFloat(bbox[2])],
          [parseFloat(bbox[1]), parseFloat(bbox[3])]
        );
        if (bounds.isValid()) {
          map.flyToBounds(bounds, { padding: [40, 40], maxZoom: zoom || 16, duration: 1.4 });
          return;
        }
      } catch (_) {}
    }
    map.flyTo([lat, lng], zoom, { animate: true, duration: 1.4 });
  }, [flyTarget]);
  return null;
}

/**
 * Captures the Leaflet map instance into a ref immediately on mount.
 * Also calls setMapRef so parent can store it in state for other components.
 */
export function MapRefCapture({ leafletMapRef, setMapRef }) {
  const map = useMap();
  useEffect(() => {
    leafletMapRef.current = map;
    setMapRef?.(map);
  }, [map]);
  return null;
}

/**
 * Listens for map clicks when elevation "custom" mode is active.
 */
export function ElevationClickCapture({ elevOpen, activeSheet, elevMode, onMapClick }) {
  const map = useMap();
  useEffect(() => {
    const active = (elevOpen || activeSheet === "elevation") && elevMode === "custom";
    if (!active) return;
    const handler = (e) => onMapClick(e.latlng);
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [map, elevOpen, activeSheet, elevMode, onMapClick]);
  return null;
}