import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

function DrawTool({
  drawMode,
  drawType,
  drawPoints,
  setDrawPoints,
  previewLayerRef,
  drawLayersRef,
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (!drawMode) return;
      const p = [e.latlng.lat, e.latlng.lng];
      const np = [...drawPoints, p];
      setDrawPoints(np);
      drawLayersRef.current.push(
        L.circleMarker(p, {
          radius: 5,
          color: "#fff",
          weight: 2,
          fillColor: "#f97316",
          fillOpacity: 1,
        }).addTo(map)
      );
      if (previewLayerRef.current) {
        previewLayerRef.current.remove();
        previewLayerRef.current = null;
      }
      if (np.length >= 2) {
        const pts = drawType === "polygon" ? [...np, np[0]] : np;
        previewLayerRef.current = L.polyline(pts, {
          color: "#f97316",
          weight: 2.5,
          dashArray: "6,4",
          fill: drawType === "polygon",
          fillColor: "#f97316",
          fillOpacity: 0.15,
        }).addTo(map);
      }
    },
  });

  return null;
}

export default DrawTool;

