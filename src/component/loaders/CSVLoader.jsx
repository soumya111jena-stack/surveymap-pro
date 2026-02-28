import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import Papa from "papaparse";

/* ─────────────────────────────────────────────
   PROFESSIONAL CSV LOADER (Google Earth Style)
   Loads 100% CSV rows + Full Details Popup
───────────────────────────────────────────── */

// Inject popup & marker styles (one time)
if (!document.getElementById("csv-pro-styles")) {
  const style = document.createElement("style");
  style.id = "csv-pro-styles";
  style.textContent = `
    .csv-popup .leaflet-popup-content-wrapper{
      background:rgba(15,23,42,0.97);
      border:1px solid rgba(96,165,250,0.35);
      border-radius:12px;
      box-shadow:0 15px 50px rgba(0,0,0,0.6);
      backdrop-filter:blur(12px);
      padding:0;
      overflow:hidden;
      min-width:280px;
      max-width:420px;
    }
    .csv-popup .leaflet-popup-content{margin:0;width:100%;}
    .csv-popup .leaflet-popup-tip-container{display:none;}
    .csv-scroll{
      max-height:320px;
      overflow-y:auto;
      scrollbar-width:thin;
    }
    .csv-scroll::-webkit-scrollbar{width:6px;}
    .csv-scroll::-webkit-scrollbar-thumb{
      background:rgba(96,165,250,0.4);
      border-radius:4px;
    }
    .csv-marker{
      border-radius:50%;
      border:2px solid #fff;
      box-shadow:0 2px 10px rgba(0,0,0,0.6);
      transition:transform .15s ease;
    }
    .csv-marker:hover{
      transform:scale(1.6);
      box-shadow:0 0 0 6px rgba(251,146,60,0.25);
    }
  `;
  document.head.appendChild(style);
}

/* ─────────────────────────────────────────────
   AUTO DETECT LAT/LNG (VERY IMPORTANT)
   Supports ANY CSV format:
   latitude, lat, LAT, y, etc.
───────────────────────────────────────────── */
function detectCoordinates(row) {
  const keys = Object.keys(row);

  let latKey = keys.find(k =>
    k.toLowerCase().includes("lat")
  );

  let lngKey = keys.find(k =>
    k.toLowerCase().includes("lon") ||
    k.toLowerCase().includes("lng") ||
    k.toLowerCase().includes("long")
  );

  if (!latKey || !lngKey) return null;

  const lat = parseFloat(row[latKey]);
  const lng = parseFloat(row[lngKey]);

  if (isNaN(lat) || isNaN(lng)) return null;

  if (lat > 90 || lat < -90 || lng > 180 || lng < -180) return null;

  return { lat, lng };
}

/* ─────────────────────────────────────────────
   GOOGLE EARTH STYLE FULL DATA POPUP
───────────────────────────────────────────── */
function buildFullPopup(row, index) {
  const entries = Object.entries(row);

  const tableRows = entries.map(([key, value], i) => {
    return `
      <tr style="background:${i % 2 === 0 ? "rgba(255,255,255,0.03)" : "transparent"}">
        <td style="
          padding:6px 10px;
          color:#94a3b8;
          font-weight:600;
          font-size:11px;
          border-right:1px solid rgba(255,255,255,0.05);
          white-space:nowrap;">
          ${key}
        </td>
        <td style="
          padding:6px 10px;
          color:#e2e8f0;
          font-size:11.5px;
          word-break:break-word;">
          ${value ?? "-"}
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div style="font-family:Segoe UI, sans-serif;">
      <div style="
        background:linear-gradient(135deg,#1e3a8a,#2563eb);
        color:#fff;
        font-weight:700;
        padding:10px 12px;
        font-size:13px;">
        📍 CSV Point ${index + 1}
      </div>

      <div class="csv-scroll">
        <table style="width:100%;border-collapse:collapse;">
          ${tableRows}
        </table>
      </div>
    </div>
  `;
}

/* ─────────────────────────────────────────────
   CUSTOM MARKER (FAST FOR 5000+ POINTS)
───────────────────────────────────────────── */
function createMarkerIcon(color = "#f97316", size = 10) {
  return L.divIcon({
    html: `<div class="csv-marker" style="width:${size}px;height:${size}px;background:${color};"></div>`,
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
    if (!file) return;

    // Remove previous layer
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      worker: true, // VERY IMPORTANT for 5000+ rows
      dynamicTyping: false,

      complete: ({ data }) => {
        if (!data || data.length === 0) {
          alert("CSV is empty or invalid.");
          onDone?.();
          return;
        }

        console.log("Total CSV Rows:", data.length);

        const markers = [];
        let validRows = 0;
        let skippedRows = 0;
        const icon = createMarkerIcon(markerColor, markerSize);

        data.forEach((row, index) => {
          const coords = detectCoordinates(row);

          if (!coords) {
            skippedRows++;
            return;
          }

          validRows++;

          const marker = L.marker([coords.lat, coords.lng], {
            icon,
          });

          // FULL DATA POPUP (ALL CSV columns)
          marker.bindPopup(
            buildFullPopup(row, index),
            {
              maxWidth: 420,
              className: "csv-popup",
              autoPan: true,
            }
          );

          markers.push(marker);
        });

        if (markers.length === 0) {
          alert("No valid latitude/longitude found in CSV.");
          onDone?.();
          return;
        }

        // Use FeatureGroup (supports fitBounds)
        layerRef.current = L.featureGroup(markers).addTo(map);

        const bounds = layerRef.current.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, {
            padding: [40, 40],
            maxZoom: 10,
          });
        }

        console.log(
          `CSV Loaded: ${validRows} / ${data.length} rows | Skipped: ${skippedRows}`
        );

        // Send count back to UI (your "87 features" panel)
        onCount?.(validRows, data.length);
        onDone?.();
      },

      error: (err) => {
        console.error("CSV Parse Error:", err);
        alert("Failed to parse CSV file.");
        onDone?.();
      },
    });

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [file, map, onDone, onCount, markerColor, markerSize]);

  return null;
}