import { useEffect, useRef, useCallback } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/**
 * Parse many coordinate formats into { lat, lng } or null
 */
function parseCoordinates(query) {
  const q = query.trim();
  const decimal = q.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*°?$/);
  if (decimal) {
    const lat = parseFloat(decimal[1]), lng = parseFloat(decimal[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }
  const decCard = q.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])[,\s]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])/);
  if (decCard) {
    let lat = parseFloat(decCard[1]), lng = parseFloat(decCard[3]);
    if (/[Ss]/.test(decCard[2])) lat = -lat;
    if (/[Ww]/.test(decCard[4])) lng = -lng;
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }
  const dms = q.match(/(\d+)[°\s]\s*(\d+)['\s]\s*(\d+(?:\.\d+)?)["\s]*([NSns])[,\s]*(\d+)[°\s]\s*(\d+)['\s]\s*(\d+(?:\.\d+)?)["\s]*([EWew])/);
  if (dms) {
    let lat = parseInt(dms[1]) + parseInt(dms[2]) / 60 + parseFloat(dms[3]) / 3600;
    let lng = parseInt(dms[5]) + parseInt(dms[6]) / 60 + parseFloat(dms[7]) / 3600;
    if (/[Ss]/.test(dms[4])) lat = -lat;
    if (/[Ww]/.test(dms[8])) lng = -lng;
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }
  return null;
}

// Red Google-style pin icon
const redPinIcon = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:28px;height:40px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.45))"><svg viewBox="0 0 28 40" width="28" height="40" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 26 14 26S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#EA4335"/><circle cx="14" cy="14" r="6" fill="white"/></svg></div>`,
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -40],
});

/**
 * AddSearch — NO leaflet-geosearch UI.
 * The search input lives in the sidebar; this component just exposes
 * a `search(query)` function via the `searchRef` prop and handles map
 * panning + marker placement.
 */
function AddSearch({ onLocationFound, searchRef }) {
  const map = useMap();
  const markerRef = useRef(null);

  const search = useCallback(async (query) => {
    if (!query.trim()) return;

    // 1. Try coordinate parse first
    const coords = parseCoordinates(query);
    if (coords) {
      placeResult({ x: coords.lng, y: coords.lat, label: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`, bounds: null, raw: { lat: coords.lat, lon: coords.lng } });
      return;
    }

    // 2. Nominatim geocode
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&polygon_geojson=1&addressdetails=1`;
      const proxies = [
        `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      ];
      let data = null;
      for (const px of proxies) {
        try {
          const res = await fetch(px, { signal: AbortSignal.timeout(6000) });
          if (!res.ok) continue;
          data = await res.json();
          if (Array.isArray(data) && data.length) break;
        } catch { /* try next */ }
      }
      if (!data || !data.length) { alert("Location not found."); return; }
      const place = data[0];
      placeResult({
        x: parseFloat(place.lon),
        y: parseFloat(place.lat),
        label: place.display_name,
        bounds: place.boundingbox ? {
          min_lat: parseFloat(place.boundingbox[0]),
          max_lat: parseFloat(place.boundingbox[1]),
          min_lon: parseFloat(place.boundingbox[2]),
          max_lon: parseFloat(place.boundingbox[3]),
        } : null,
        raw: place,
      });
    } catch (e) {
      console.error("Search error:", e);
      alert("Search failed. Please try again.");
    }
  }, [map]); // eslint-disable-line

  function placeResult({ x, y, label, bounds, raw }) {
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    const marker = L.marker([y, x], { icon: redPinIcon }).addTo(map);
    markerRef.current = marker;
    onLocationFound({ lat: y, lng: x, label, raw });
    if (bounds) {
      map.fitBounds([[bounds.min_lat, bounds.min_lon],[bounds.max_lat, bounds.max_lon]], { maxZoom: 17 });
    } else {
      map.setView([y, x], 17);
    }
  }

  // Expose search function to parent via ref
  useEffect(() => {
    if (searchRef) searchRef.current = search;
  }, [search, searchRef]);

  // No leaflet-geosearch control = no floating search bar on map ✓
  return null;
}

export default AddSearch;