    /**
 * UTMGrid.jsx — Leaflet UTM/MGRS grid overlay
 * Draws:
 *   • UTM zone lines (every 6°) with zone numbers
 *   • UTM band lines (every 8°) with band letters
 *   • 100km MGRS square labels at zoom ≥ 11
 * Redraws on every map move/zoom via useMap events
 */
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { latLngToUTM, latLngToMGRS, utmToLatLng } from "./utm-mgrs";

// ── Style constants ──────────────────────────────────────────────────────────
const ZONE_COLOR  = "rgba(100,180,255,0.55)";
const BAND_COLOR  = "rgba(180,255,100,0.45)";
const SQ_COLOR    = "rgba(255,200,80,0.35)";
const ZONE_WEIGHT = 1;
const BAND_WEIGHT = 1;
const SQ_WEIGHT   = 0.8;

function makeLabel(content, latlng, color, fontSize = 9) {
  return L.marker(latlng, {
    icon: L.divIcon({
      className: "",
      html: `<div style="
        background:rgba(10,18,30,0.72);
        color:${color};
        font-size:${fontSize}px;
        font-weight:700;
        font-family:'Courier New',monospace;
        padding:1px 4px;
        border-radius:2px;
        white-space:nowrap;
        pointer-events:none;
        letter-spacing:.04em;
        border:1px solid ${color}30;
      ">${content}</div>`,
      iconAnchor: [0, 0],
    }),
    interactive: false,
    zIndexOffset: -1000,
  });
}

function utmCentralMeridian(zone) {
  return (zone - 1) * 6 - 180 + 3;
}

// ════════════════════════════════════════════════════════════════════════════
export default function UTMGrid({ enabled, mode = "UTM" }) {
  const map    = useRef(null);
  const leaflet = useMap();
  const layerGroupRef = useRef(null);

  useEffect(() => { map.current = leaflet; }, [leaflet]);

  useEffect(() => {
    if (!enabled) {
      if (layerGroupRef.current) { layerGroupRef.current.clearLayers(); }
      return;
    }

    function redraw() {
      const m = map.current;
      if (!m) return;
      if (!layerGroupRef.current) {
        layerGroupRef.current = L.layerGroup().addTo(m);
      }
      layerGroupRef.current.clearLayers();

      const zoom   = m.getZoom();
      const bounds = m.getBounds();
      const north  = Math.min(bounds.getNorth(), 84);
      const south  = Math.max(bounds.getSouth(), -80);
      const west   = Math.max(bounds.getWest(), -180);
      const east   = Math.min(bounds.getEast(), 180);

      if (north <= south) return;

      // ── UTM Zone lines (every 6° longitude) ──────────────────────────
      const zoneStep = 6;
      const firstZone = Math.floor(west / zoneStep) * zoneStep;
      for (let lng = firstZone; lng <= east + zoneStep; lng += zoneStep) {
        if (lng < -180 || lng > 180) continue;
        const lineLat1 = south;
        const lineLat2 = north;
        const line = L.polyline(
          [[lineLat1, lng], [lineLat2, lng]],
          { color: ZONE_COLOR, weight: ZONE_WEIGHT, opacity: 1, interactive: false, dashArray: zoom < 6 ? null : "4 3" }
        );
        layerGroupRef.current.addLayer(line);

        // Zone number label — show at mid-latitude of visible range
        if (zoom >= 4) {
          const zone = Math.floor((lng + 180) / 6) + 1;
          const midLat = (lineLat1 + lineLat2) / 2;
          // Only show between this meridian and the next
          const labelLng = lng + 2;
          if (labelLng < east) {
            layerGroupRef.current.addLayer(
              makeLabel(`${zone}`, [midLat, labelLng], ZONE_COLOR, zoom >= 8 ? 10 : 8)
            );
          }
        }
      }

      // ── UTM Band lines (every 8° latitude from -80 to 84) ──────────────
      const BAND_LETTERS_STR = "CDEFGHJKLMNPQRSTUVWX";
      const bandStep = 8;
      const firstBand = Math.floor(Math.max(south, -80) / bandStep) * bandStep;
      for (let lat = firstBand; lat <= Math.min(north, 84) + bandStep; lat += bandStep) {
        if (lat < -80 || lat > 84) continue;
        const line = L.polyline(
          [[lat, west], [lat, east]],
          { color: BAND_COLOR, weight: BAND_WEIGHT, opacity: 1, interactive: false, dashArray: zoom < 6 ? null : "4 3" }
        );
        layerGroupRef.current.addLayer(line);

        // Band letter label
        if (zoom >= 4) {
          const bandIdx = Math.floor((lat + 80) / 8);
          const bandLetter = BAND_LETTERS_STR[Math.min(bandIdx, 19)] || "";
          const midLng = west + (east - west) * 0.08;
          if (bandLetter) {
            layerGroupRef.current.addLayer(
              makeLabel(bandLetter, [lat + 1, midLng], BAND_COLOR, zoom >= 8 ? 10 : 8)
            );
          }
        }
      }

      // ── 100km MGRS squares at zoom >= 9 ────────────────────────────────
      if (zoom >= 9 && mode === "MGRS") {
        // Sample a grid of lat/lng points and find their 100km square corners
        const drawnSquares = new Set();
        const latInc = Math.max(0.5, (north - south) / 12);
        const lngInc = Math.max(0.5, (east - west) / 12);

        for (let lat = south; lat < north; lat += latInc) {
          for (let lng = west; lng < east; lng += lngInc) {
            const clampedLat = Math.max(-79.9, Math.min(83.9, lat));
            const utm = latLngToUTM(clampedLat, lng);
            const cellE = Math.floor(utm.easting / 100000) * 100000;
            const cellN = Math.floor(utm.northing / 100000) * 100000;
            const key   = `${utm.zone}-${utm.band}-${cellE}-${cellN}`;
            if (drawnSquares.has(key)) continue;
            drawnSquares.add(key);

            try {
              // 4 corners of 100km square
              const corners = [
                [cellE, cellN],
                [cellE + 100000, cellN],
                [cellE + 100000, cellN + 100000],
                [cellE, cellN + 100000],
                [cellE, cellN],
              ].map(([e, n]) => {
                const ll = utmToLatLng(utm.zone, utm.band, e, n, utm.hemisphere);
                return [ll.lat, ll.lng];
              });

              const poly = L.polyline(corners, {
                color: SQ_COLOR, weight: SQ_WEIGHT, opacity: 1, interactive: false,
              });
              layerGroupRef.current.addLayer(poly);

              // MGRS square ID label at centre
              if (zoom >= 11) {
                const centreLat = clampedLat + latInc / 2;
                const centreLng = lng + lngInc / 2;
                const mgrs = latLngToMGRS(
                  Math.max(-79.9, Math.min(83.9, centreLat)),
                  centreLng,
                  0
                );
                // Extract just the 100km square identifier (e.g. "EG")
                const sq = mgrs.split(" ")[1] || "";
                if (sq) {
                  layerGroupRef.current.addLayer(
                    makeLabel(sq, [centreLat, centreLng], SQ_COLOR, 9)
                  );
                }
              }
            } catch (_) { /* skip malformed cells */ }
          }
        }
      }
    }

    // Draw immediately and on every map move/zoom
    redraw();
    leaflet.on("moveend zoomend", redraw);
    return () => {
      leaflet.off("moveend zoomend", redraw);
      if (layerGroupRef.current) { layerGroupRef.current.clearLayers(); }
    };
  }, [enabled, mode, leaflet]);

  return null;
}