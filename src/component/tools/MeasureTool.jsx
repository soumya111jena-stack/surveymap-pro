import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { haversine, formatDist } from "../map/measureUtils";

function MeasureTool({
  measureMode,
  measurePoints,
  setMeasurePoints,
  measureLayersRef,
  measureLineRef,
  measureUnit,
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (!measureMode) return;
      const p = [e.latlng.lat, e.latlng.lng];
      const newPoints = [...measurePoints, p];
      setMeasurePoints(newPoints);

      const dot = L.circleMarker(p, {
        radius: 6,
        color: "#fff",
        weight: 2,
        fillColor: "#facc15",
        fillOpacity: 1,
      }).addTo(map);

      if (newPoints.length > 1) {
        let total = 0;
        for (let i = 1; i < newPoints.length; i++) {
          total += haversine(newPoints[i - 1], newPoints[i]);
        }
        dot
          .bindTooltip(formatDist(total, measureUnit), {
            permanent: true,
            direction: "top",
            offset: [0, -8],
            className: "measure-tooltip",
          })
          .openTooltip();
      }

      measureLayersRef.current.push(dot);

      if (measureLineRef.current) {
        measureLineRef.current.remove();
        measureLineRef.current = null;
      }
      if (newPoints.length >= 2) {
        measureLineRef.current = L.polyline(newPoints, {
          color: "#facc15",
          weight: 2.5,
          opacity: 0.9,
        }).addTo(map);
      }
    },
    mousemove(e) {
      if (!measureMode || measurePoints.length === 0) return;
      const last = measurePoints[measurePoints.length - 1];
      if (measureLineRef._preview) {
        measureLineRef._preview.remove();
      }
      measureLineRef._preview = L.polyline(
        [last, [e.latlng.lat, e.latlng.lng]],
        {
          color: "#facc15",
          weight: 1.5,
          opacity: 0.6,
          dashArray: "6,4",
        }
      ).addTo(map);
    },
  });

  return null;
}

export default MeasureTool;

