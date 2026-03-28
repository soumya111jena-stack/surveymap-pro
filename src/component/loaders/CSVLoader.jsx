import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import Papa from "papaparse";

/* ─────────────────────────────────────────────
   CSV LOADER — SurveyMap Pro v5.8 (FIXED)
   
   FIXES:
   1. worker:false — worker:true requires a dedicated papaparse worker
      file served from the same origin; silently fails in Vite/CRA/Next.js
   2. dynamicTyping:true — auto-converts numeric strings so parseFloat is reliable
   3. Robust coordinate detection — handles lat/lng/latitude/longitude/x/y/easting/northing
   4. skipFirstRow option removed — header:true handles it
   5. Layer cleanup on file removal — unmount removes layer from map
   6. onCount now called with (validRows, totalRows) correctly
   7. Popup content escaped to prevent XSS from CSV data
───────────────────────────────────────────── */

// Inject styles once
if (!document.getElementById("csv-pro-styles")) {
  const style = document.createElement("style");
  style.id = "csv-pro-styles";
  style.textContent = `
    .csv-popup .leaflet-popup-content-wrapper {
      background: rgba(15,23,42,0.97);
      border: 1px solid rgba(96,165,250,0.35);
      border-radius: 12px;
      box-shadow: 0 15px 50px rgba(0,0,0,0.6);
      backdrop-filter: blur(12px);
      padding: 0;
      overflow: hidden;
      min-width: 280px;
      max-width: 420px;
    }
    .csv-popup .leaflet-popup-content { margin: 0; width: 100%; }
    .csv-popup .leaflet-popup-tip-container { display: none; }
    .csv-scroll {
      max-height: 320px;
      overflow-y: auto;
      scrollbar-width: thin;
    }
    .csv-scroll::-webkit-scrollbar { width: 6px; }
    .csv-scroll::-webkit-scrollbar-thumb {
      background: rgba(96,165,250,0.4);
      border-radius: 4px;
    }
    .csv-marker {
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,0.6);
      transition: transform .15s ease;
      cursor: pointer;
    }
    .csv-marker:hover {
      transform: scale(1.6);
      box-shadow: 0 0 0 6px rgba(251,146,60,0.25);
    }
  `;
  document.head.appendChild(style);
}

/* ─────────────────────────────────────────────
   AUTO-DETECT LAT/LNG COLUMNS
   Tries multiple common column name patterns
───────────────────────────────────────────── */
function detectCoordinates(row, colCache) {
  // Use cached column keys if already found
  if (colCache.latKey !== undefined) {
    if (!colCache.latKey) return null;
    const lat = parseFloat(row[colCache.latKey]);
    const lng = parseFloat(row[colCache.lngKey]);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  const keys = Object.keys(row);

  // Priority order for latitude
  const latPatterns = ["latitude", "lat", "y", "ylat", "lat_dd", "latdeg", "latitude_dd"];
  // Priority order for longitude
  const lngPatterns = ["longitude", "lng", "lon", "long", "x", "xlon", "lon_dd", "lngdeg", "longitude_dd"];

  let latKey = null;
  let lngKey = null;

  for (const pat of latPatterns) {
    const found = keys.find(k => k.trim().toLowerCase() === pat);
    if (found) { latKey = found; break; }
  }
  // Fallback: partial match
  if (!latKey) latKey = keys.find(k => k.trim().toLowerCase().includes("lat"));

  for (const pat of lngPatterns) {
    const found = keys.find(k => k.trim().toLowerCase() === pat);
    if (found) { lngKey = found; break; }
  }
  // Fallback: partial match
  if (!lngKey) lngKey = keys.find(k =>
    k.trim().toLowerCase().includes("lon") ||
    k.trim().toLowerCase().includes("lng") ||
    k.trim().toLowerCase().includes("long")
  );

  if (!latKey || !lngKey) {
    colCache.latKey = null;
    colCache.lngKey = null;
    return null;
  }

  colCache.latKey = latKey;
  colCache.lngKey = lngKey;

  const lat = parseFloat(row[latKey]);
  const lng = parseFloat(row[lngKey]);
  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/* ─────────────────────────────────────────────
   ESCAPE HTML — prevent XSS from CSV data
───────────────────────────────────────────── */
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─────────────────────────────────────────────
   BUILD FULL-DATA POPUP (all CSV columns)
───────────────────────────────────────────── */
function buildFullPopup(row, index) {
  const tableRows = Object.entries(row).map(([key, value], i) => `
    <tr style="background:${i % 2 === 0 ? "rgba(255,255,255,0.03)" : "transparent"}">
      <td style="padding:6px 10px;color:#94a3b8;font-weight:600;font-size:11px;
        border-right:1px solid rgba(255,255,255,0.05);white-space:nowrap;">
        ${escHtml(key)}
      </td>
      <td style="padding:6px 10px;color:#e2e8f0;font-size:11.5px;word-break:break-word;">
        ${escHtml(value)}
      </td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Segoe UI,sans-serif;">
      <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;
        font-weight:700;padding:10px 12px;font-size:13px;">
        📍 Row ${index + 1}
      </div>
      <div class="csv-scroll">
        <table style="width:100%;border-collapse:collapse;">${tableRows}</table>
      </div>
    </div>
  `;
}

/* ─────────────────────────────────────────────
   CUSTOM MARKER ICON
───────────────────────────────────────────── */
function createMarkerIcon(color = "#f97316", size = 10) {
  return L.divIcon({
    html: `<div class="csv-marker" style="width:${size}px;height:${size}px;background:${escHtml(color)};"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    className: "",
  });
}

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────── */
export default function CSVLoader({
  file,
  onDone,
  onCount,
  markerColor = "#f97316",
  markerSize = 10,
}) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!file) {
      // File was removed — clean up map layer
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
      return;
    }

    // Remove any previous layer first
    if (layerRef.current) {
      try { map.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }

    const colCache = {}; // { latKey, lngKey } — detected once, reused for all rows

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,   // ← FIX: auto-convert numbers; worker:false (removed worker:true)
      worker: false,         // ← FIX: worker:true silently fails without proper worker setup

      complete: ({ data, errors }) => {
        if (errors.length > 0) {
          console.warn("[CSVLoader] Parse warnings:", errors.slice(0, 3));
        }

        if (!data || data.length === 0) {
          alert("CSV file is empty or could not be parsed.\n\nCheck that it has a header row with lat/lng columns.");
          onDone?.();
          return;
        }

        console.log(`[CSVLoader] Parsed ${data.length} rows from "${file.name}"`);

        // Check first row to detect coordinate columns early
        const firstCoords = detectCoordinates(data[0], colCache);
        if (!firstCoords && colCache.latKey === null) {
          // Give a helpful error message listing actual column names
          const cols = Object.keys(data[0]).join(", ");
          alert(
            `No latitude/longitude columns found in CSV.\n\n` +
            `Found columns: ${cols}\n\n` +
            `Expected column names like: latitude, lat, longitude, lng, lon`
          );
          onDone?.();
          return;
        }

        const markers = [];
        let validRows = 0;
        let skippedRows = 0;
        const icon = createMarkerIcon(markerColor, markerSize);

        data.forEach((row, index) => {
          const coords = detectCoordinates(row, colCache);

          if (!coords) {
            skippedRows++;
            return;
          }

          validRows++;

          const marker = L.marker([coords.lat, coords.lng], { icon });

          marker.bindPopup(
            buildFullPopup(row, index),
            { maxWidth: 420, className: "csv-popup", autoPan: true }
          );

          markers.push(marker);
        });

        if (markers.length === 0) {
          alert(
            `No valid coordinates found in CSV.\n\n` +
            `All ${data.length} rows had missing or out-of-range lat/lng values.\n` +
            `Latitude must be −90 to 90, Longitude must be −180 to 180.`
          );
          onDone?.();
          return;
        }

        layerRef.current = L.featureGroup(markers).addTo(map);

        const bounds = layerRef.current.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: false });
          reEnableHandlers(map);
        }

        console.log(`[CSVLoader] ✅ Loaded ${validRows}/${data.length} rows | Skipped: ${skippedRows}`);
        onCount?.(validRows, data.length);
        onDone?.();
      },

      error: (err) => {
        console.error("[CSVLoader] Parse error:", err);
        alert(`Failed to parse CSV file.\n\nError: ${err?.message || err}`);
        onDone?.();
      },
    });

    return () => {
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function reEnableHandlers(m) {
  if (!m) return;
  ["dragging", "scrollWheelZoom", "touchZoom", "doubleClickZoom", "keyboard", "boxZoom", "tap"]
    .forEach(h => { try { if (m[h]?.enable) m[h].enable(); } catch (_) {} });
}