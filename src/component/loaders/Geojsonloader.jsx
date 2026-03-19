/**
 * GeoJSONLoader.jsx — SurveyMap Pro
 *
 * Loads .geojson / .json files onto the Leaflet map:
 *  - Polygons / MultiPolygons  — filled with blue border (survey boundaries)
 *  - LineStrings / MultiLines  — colored polyline
 *  - Points / MultiPoints      — dot markers with name labels
 *  - GeometryCollection        — handles mixed geometry
 *  - Rich dark popup for every feature
 *  - Smart color per feature type
 *  - Mobile-safe fitBounds
 */
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

// ── Color scheme per geometry type ───────────────────────────────────────────
const TYPE_COLORS = {
  Point:              { stroke: "#60a5fa", fill: "#60a5fa" },
  MultiPoint:         { stroke: "#60a5fa", fill: "#60a5fa" },
  LineString:         { stroke: "#fb923c", fill: "#fb923c" },
  MultiLineString:    { stroke: "#fb923c", fill: "#fb923c" },
  Polygon:            { stroke: "#34d399", fill: "#34d399" },
  MultiPolygon:       { stroke: "#34d399", fill: "#34d399" },
  GeometryCollection: { stroke: "#a78bfa", fill: "#a78bfa" },
};

function getColors(feature) {
  const type = feature.geometry?.type || "Polygon";
  return TYPE_COLORS[type] || { stroke: "#60a5fa", fill: "#60a5fa" };
}

// ── Rich dark popup ───────────────────────────────────────────────────────────
function buildPopup(feature) {
  const p     = feature.properties || {};
  const type  = feature.geometry?.type || "";
  const color = getColors(feature);

  const title = p.name || p.Name || p.NAME || p.title || p.TITLE
    || p.id || p.ID || p.label || type || "Feature";

  const skip = new Set(["name","Name","NAME","title","TITLE","id","ID","label"]);
  const fieldRows = Object.entries(p)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) =>
      `<tr>
        <td style="font-weight:700;color:${color.stroke};padding:3px 10px 3px 0;font-size:10px;
                   text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;vertical-align:top">${k}</td>
        <td style="color:#e2e8f0;padding:3px 0;font-size:11px;word-break:break-word">${v}</td>
      </tr>`
    ).join("");

  // Coordinates row for points
  const coords = feature.geometry?.coordinates;
  const isPoint = type === "Point";
  const coordRow = (coords && isPoint)
    ? `<tr>
        <td style="font-weight:700;color:${color.stroke};padding:3px 10px 3px 0;font-size:10px;
                   text-transform:uppercase;letter-spacing:.04em">Location</td>
        <td style="color:#e2e8f0;font-size:11px;font-family:monospace">
          ${Math.abs(coords[1]).toFixed(6)}°${coords[1]>=0?"N":"S"}
          ${Math.abs(coords[0]).toFixed(6)}°${coords[0]>=0?"E":"W"}
        </td>
      </tr>`
    : "";

  // Gradient by type
  const gradients = {
    Polygon:        "linear-gradient(135deg,#064e3b,#065f46)",
    MultiPolygon:   "linear-gradient(135deg,#064e3b,#065f46)",
    LineString:     "linear-gradient(135deg,#431407,#7c2d12)",
    MultiLineString:"linear-gradient(135deg,#431407,#7c2d12)",
    Point:          "linear-gradient(135deg,#1e3a5f,#1e40af)",
    MultiPoint:     "linear-gradient(135deg,#1e3a5f,#1e40af)",
  };
  const grad = gradients[type] || "linear-gradient(135deg,#1e1b4b,#312e81)";

  return `
    <div style="font-family:'Segoe UI',system-ui,sans-serif;min-width:175px;max-width:290px;
                background:#0f172a;border-radius:6px;overflow:hidden;margin:-13px -20px -13px">
      <div style="background:${grad};padding:9px 14px;display:flex;align-items:center;gap:7px">
        <div style="width:9px;height:9px;border-radius:${isPoint?"50%":"2px"};background:${color.stroke};
                    box-shadow:0 0 6px ${color.stroke}80;flex-shrink:0"></div>
        <div style="flex:1;overflow:hidden">
          <div style="color:#f1f5f9;font-weight:700;font-size:12px;
                      overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
          <div style="color:rgba(255,255,255,0.4);font-size:9px;margin-top:1px;letter-spacing:.04em">${type.toUpperCase()}</div>
        </div>
      </div>
      ${(fieldRows || coordRow)
        ? `<div style="padding:6px 14px 10px">
             <table style="border-collapse:collapse;width:100%">
               ${fieldRows}${coordRow}
             </table>
           </div>`
        : `<div style="padding:8px 14px;color:#475569;font-size:10px;font-style:italic">No attributes</div>`
      }
    </div>`;
}

// ── Point marker ──────────────────────────────────────────────────────────────
function makeGeoJSONMarker(latlng, name, color) {
  return L.marker(latlng, {
    icon: L.divIcon({
      className: "",
      html: `
        <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
          <div style="width:13px;height:13px;background:${color};border:2px solid #fff;
                      border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.55)"></div>
          ${name
            ? `<div style="margin-top:3px;background:rgba(15,23,42,0.9);color:#f1f5f9;
                           font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;
                           white-space:nowrap;max-width:160px;overflow:hidden;
                           text-overflow:ellipsis;font-family:'DM Sans',sans-serif;
                           box-shadow:0 1px 4px rgba(0,0,0,0.5)">${name}</div>`
            : ""}
        </div>`,
      iconAnchor: [6, 6],
      popupAnchor: [0, -10],
    }),
  });
}

// ── Parse & validate GeoJSON ──────────────────────────────────────────────────
function parseGeoJSON(text) {
  const data = JSON.parse(text);

  // Accept: FeatureCollection
  if (data.type === "FeatureCollection") {
    // geojson.io sometimes exports with empty features array — check
    if (!data.features || data.features.length === 0) {
      throw new Error("NO_FEATURES");
    }
    return data;
  }

  // Single Feature
  if (data.type === "Feature") {
    if (!data.geometry) throw new Error("Feature has no geometry.");
    return { type: "FeatureCollection", features: [data] };
  }

  // Raw geometry types — wrap in Feature + FeatureCollection
  const GEOM_TYPES = ["Point","MultiPoint","LineString","MultiLineString",
                      "Polygon","MultiPolygon","GeometryCollection"];
  if (GEOM_TYPES.includes(data.type)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: data, properties: {} }],
    };
  }

  throw new Error("Not a valid GeoJSON file. Expected FeatureCollection, Feature, or Geometry.");
}

// ════════════════════════════════════════════════════════════════════════════
export default function GeoJSONLoader({ file, onDone }) {
  const map      = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!file) return;

    // Remove previous layer
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const geojson = parseGeoJSON(evt.target.result);

        if (!geojson.features?.length) {
          alert("GeoJSON file has no features.\n\nMake sure you drew something on geojson.io before downloading.");
          onDone?.();
          return;
        }

        const layer = L.geoJSON(geojson, {
          // ── Polygon / Line styles ──────────────────────────────────────
          style: (feature) => {
            const { stroke, fill } = getColors(feature);
            const type = feature.geometry?.type || "";
            const isPoly = type.includes("Polygon");
            return {
              color:       stroke,
              weight:      isPoly ? 2.5 : 3,
              opacity:     0.9,
              fillColor:   fill,
              fillOpacity: isPoly ? 0.15 : 0,
              dashArray:   type.includes("Line") ? null : null,
            };
          },

          // ── Point markers ──────────────────────────────────────────────
          pointToLayer: (feature, latlng) => {
            const { stroke } = getColors(feature);
            const p    = feature.properties || {};
            const name = p.name || p.Name || p.NAME || p.title || p.label || "";
            return makeGeoJSONMarker(latlng, name, stroke);
          },

          // ── Popups ─────────────────────────────────────────────────────
          onEachFeature: (feature, featureLayer) => {
            featureLayer.bindPopup(buildPopup(feature), {
              maxWidth: 320,
              className: "geojson-popup",
            });

            // Highlight on hover for polygons/lines
            const type = feature.geometry?.type || "";
            if (type.includes("Polygon") || type.includes("Line")) {
              const { stroke } = getColors(feature);
              featureLayer.on("mouseover", () => {
                featureLayer.setStyle({ weight: 4, opacity: 1, fillOpacity: 0.28 });
              });
              featureLayer.on("mouseout", () => {
                layer.resetStyle(featureLayer);
              });
            }
          },
        }).addTo(map);

        layerRef.current = layer;

        // Fly to bounds
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          const isMobile = window.innerWidth <= 640;
          map.fitBounds(bounds, {
            padding:  isMobile ? [28, 28] : [50, 50],
            maxZoom:  17,
            animate:  true,
            duration: 1.0,
          });
        }

        onDone?.();
      } catch (err) {
        console.error("GeoJSON parse error:", err);
        if (err.message === "NO_FEATURES") {
          alert("GeoJSON file has no features.\n\nOn geojson.io: draw a shape or place a marker FIRST, then save.");
        } else {
          alert("Failed to load GeoJSON:\n" + err.message);
        }
        onDone?.();
      }
    };

    reader.onerror = () => { alert("Could not read file."); onDone?.(); };
    reader.readAsText(file);

    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    };
  }, [file, map, onDone]);

  return null;
}