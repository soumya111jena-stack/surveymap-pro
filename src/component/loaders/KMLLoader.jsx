import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import omnivore from "@mapbox/leaflet-omnivore";

function KMLLoader({ file, onDone }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!file) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const geojsonData = omnivore.kml.parse(evt.target.result).toGeoJSON();
        const layer = L.geoJSON(geojsonData, {
          style: {
            color: "#facc15",
            weight: 3,
            opacity: 0.9,
            fillColor: "#facc15",
            fillOpacity: 0.3,
          },
          pointToLayer: (feature, latlng) => {
            const name =
              feature.properties?.name || feature.properties?.Name || "";
            return L.marker(latlng, {
              icon: L.divIcon({
                className: "",
                html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none"><div style="width:14px;height:14px;background:#facc15;border:2px solid #000;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.6)"></div>${
                  name
                    ? `<div style="margin-top:3px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;font-weight:600;padding:2px 5px;border-radius:3px;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;font-family:sans-serif">${name}</div>`
                    : ""
                }</div>`,
                iconAnchor: [7, 7],
                popupAnchor: [0, -10],
              }),
            });
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties || {};
            const rows = Object.entries(p)
              .filter(
                ([, v]) => v !== null && v !== undefined && v !== ""
              )
              .map(
                ([k, v]) =>
                  `<tr><td style="font-weight:700;color:#555;padding:3px 8px 3px 0;text-transform:uppercase;font-size:11px;white-space:nowrap">${k}</td><td style="color:#111;padding:3px 0;font-size:12px">${v}</td></tr>`
              )
              .join("");
            const coords = feature.geometry?.coordinates;
            const coordRow = coords
              ? `<tr><td style="font-weight:700;color:#555;padding:3px 8px 3px 0;text-transform:uppercase;font-size:11px">Location</td><td style="color:#111;font-size:12px">${Math.abs(
                  coords[1]
                ).toFixed(6)}°${coords[1] < 0 ? "S" : "N"} ${Math.abs(
                  coords[0]
                ).toFixed(6)}°${coords[0] < 0 ? "W" : "E"}</td></tr>`
              : "";
            layer.bindPopup(
              `<div style="font-family:sans-serif;min-width:180px;max-width:260px"><div style="background:#1a1a2e;color:#facc15;padding:8px 12px;margin:-13px -20px 10px;font-weight:800;font-size:13px;border-radius:4px 4px 0 0;letter-spacing:0.04em">${
                p.name || p.Name || "Feature"
              }</div><table style="border-collapse:collapse;width:100%">${rows}${coordRow}</table></div>`,
              { maxWidth: 300 }
            );
          },
        }).addTo(map);

        layerRef.current = layer;
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40] });
        }
        onDone();
      } catch (err) {
        console.error("KML:", err);
        alert("Failed to parse KML.");
        onDone();
      }
    };

    reader.onerror = () => {
      alert("Could not read file.");
      onDone();
    };

    reader.readAsText(file);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [file, map, onDone]);

  return null;
}

export default KMLLoader;

