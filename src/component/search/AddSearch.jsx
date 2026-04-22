import { useEffect, useRef, useCallback } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/* ─────────────────────────────────────────────────────────────────────────────
   Coordinate parsers — decimal, cardinal, DMS
───────────────────────────────────────────────────────────────────────────── */
function parseCoordinates(query) {
  const q = query.trim();

  // "20.29, 85.82" or "20.29 85.82"
  const decimal = q.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*°?$/);
  if (decimal) {
    const lat = parseFloat(decimal[1]), lng = parseFloat(decimal[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // "20.29N, 85.82E"
  const decCard = q.match(
    /(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])[,\s]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])/
  );
  if (decCard) {
    let lat = parseFloat(decCard[1]), lng = parseFloat(decCard[3]);
    if (/[Ss]/.test(decCard[2])) lat = -lat;
    if (/[Ww]/.test(decCard[4])) lng = -lng;
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // "20°17'24"N, 85°49'12"E"
  const dms = q.match(
    /(\d+)[°\s]\s*(\d+)['\s]\s*(\d+(?:\.\d+)?)["\s]*([NSns])[,\s]*(\d+)[°\s]\s*(\d+)['\s]\s*(\d+(?:\.\d+)?)["\s]*([EWew])/
  );
  if (dms) {
    let lat = parseInt(dms[1]) + parseInt(dms[2]) / 60 + parseFloat(dms[3]) / 3600;
    let lng = parseInt(dms[5]) + parseInt(dms[6]) / 60 + parseFloat(dms[7]) / 3600;
    if (/[Ss]/.test(dms[4])) lat = -lat;
    if (/[Ww]/.test(dms[8])) lng = -lng;
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Red Google-style drop pin
───────────────────────────────────────────────────────────────────────────── */
const redPinIcon = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:28px;height:40px;filter:drop-shadow(0 3px 8px rgba(0,0,0,0.5))">
    <svg viewBox="0 0 28 40" width="28" height="40" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 26 14 26S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#EA4335"/>
      <circle cx="14" cy="14" r="6" fill="white"/>
    </svg>
  </div>`,
  iconSize:    [28, 40],
  iconAnchor:  [14, 40],
  popupAnchor: [0, -40],
});

/* ─────────────────────────────────────────────────────────────────────────────
   Nominatim geocoder with direct fetch + two CORS proxies as fallback.
   Returns the raw Nominatim result array or null.
───────────────────────────────────────────────────────────────────────────── */
async function nominatimGeocode(query) {
  const encoded = encodeURIComponent(query);

  // Nominatim endpoint — try direct first (works in most desktop browsers
  // and Electron; may be blocked by CORS in some sandboxed environments)
  const directUrl =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encoded}&format=json&limit=5&polygon_geojson=1&addressdetails=1` +
    `&accept-language=en`;

  const proxies = [
    directUrl,
    `https://corsproxy.io/?url=${encodeURIComponent(directUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`,
    // Photon as a last-resort alternative (no polygon, but gives lat/lon)
    `https://photon.komoot.io/api/?q=${encoded}&limit=5`,
  ];

  for (const url of proxies) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) continue;

      const data = await res.json();

      // Photon returns { features: [...] } — normalise to Nominatim shape
      if (data?.features) {
        const results = (data.features || []).map((f) => ({
          lat:          String(f.geometry?.coordinates?.[1] ?? 0),
          lon:          String(f.geometry?.coordinates?.[0] ?? 0),
          display_name: [
            f.properties?.name,
            f.properties?.city,
            f.properties?.state,
            f.properties?.country,
          ].filter(Boolean).join(", "),
          geojson:      null,
          boundingbox:  null,
          address:      {
            city:    f.properties?.city    || "",
            state:   f.properties?.state   || "",
            country: f.properties?.country || "",
          },
        }));
        if (results.length) return results;
        continue;
      }

      // Standard Nominatim array
      if (Array.isArray(data) && data.length) return data;

    } catch (_) {
      // try next proxy
    }
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   AddSearch component
   Props:
     onLocationFound({ lat, lng, label, raw }) — called after every successful search
     searchRef                                 — ref to expose search() to parent
───────────────────────────────────────────────────────────────────────────── */
function AddSearch({ onLocationFound, searchRef }) {
  const map       = useMap();
  const markerRef = useRef(null);

  /* ── place a marker + pan/zoom ─────────────────────────────────────────── */
  const placeResult = useCallback(
    ({ lat, lng, label, bbox, raw }) => {
      // Remove previous marker
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }

      // Drop new pin
      const marker = L.marker([lat, lng], { icon: redPinIcon }).addTo(map);
      markerRef.current = marker;

      // Notify parent (sidebar info panel, boundary layer, etc.)
      onLocationFound({ lat, lng, label, raw });

      // Fly to bounds if available, else zoom to point
      if (bbox) {
        try {
          const bounds = L.latLngBounds(
            [bbox.min_lat, bbox.min_lon],
            [bbox.max_lat, bbox.max_lon]
          );
          if (bounds.isValid()) {
            map.fitBounds(bounds, { maxZoom: 16, padding: [40, 40], animate: true });
            return;
          }
        } catch (_) {}
      }

      // Fallback: zoom based on result type / bbox size
      map.setView([lat, lng], 14, { animate: true });
    },
    [map, onLocationFound]
  );

  /* ── main search function exposed via searchRef ────────────────────────── */
  const search = useCallback(
    async (query) => {
      const q = (query || "").trim();
      if (!q) return;

      // 1. Try coordinate parse
      const coords = parseCoordinates(q);
      if (coords) {
        placeResult({
          lat:   coords.lat,
          lng:   coords.lng,
          label: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`,
          bbox:  null,
          raw:   { lat: coords.lat, lon: coords.lng },
        });
        return;
      }

      // 2. Geocode via Nominatim (with proxy fallbacks)
      let data;
      try {
        data = await nominatimGeocode(q);
      } catch (_) {
        data = null;
      }

      if (!data || !data.length) {
        alert(`"${q}" — Location not found. Check spelling or try a nearby city.`);
        return;
      }

      // Pick best result: prefer one with a polygon geojson (state/district/city)
      const place =
        data.find((r) => r.geojson?.type === "MultiPolygon") ||
        data.find((r) => r.geojson?.type === "Polygon")      ||
        data[0];

      const lat = parseFloat(place.lat);
      const lng = parseFloat(place.lon);

      // Build bounding box from Nominatim boundingbox array [s, n, w, e]
      let bbox = null;
      if (place.boundingbox && place.boundingbox.length === 4) {
        bbox = {
          min_lat: parseFloat(place.boundingbox[0]),
          max_lat: parseFloat(place.boundingbox[1]),
          min_lon: parseFloat(place.boundingbox[2]),
          max_lon: parseFloat(place.boundingbox[3]),
        };
      }

      placeResult({
        lat,
        lng,
        label: place.display_name || q,
        bbox,
        raw:   place,
      });
    },
    [placeResult]
  );

  /* ── expose to parent via ref ──────────────────────────────────────────── */
  useEffect(() => {
    if (searchRef) searchRef.current = search;
  }, [search, searchRef]);

  // Renders nothing — all UI is in the sidebar
  return null;
}

export default AddSearch;