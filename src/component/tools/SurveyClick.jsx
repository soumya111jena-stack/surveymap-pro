import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { greenIcon, redIcon } from "../map/icons";

function SurveyClick({
  surveyMode,
  route,
  setRoute,
  setStart,
  setEnd,
  polylineRef,
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (!surveyMode) return;
      const p = [e.latlng.lat, e.latlng.lng];
      if (route.length === 0) {
        setStart(p);
        L.marker(p, { icon: greenIcon })
          .addTo(map)
          .bindPopup(
            `🟢 Start<br/>${p[0].toFixed(5)}, ${p[1].toFixed(5)}`
          )
          .openPopup();
      } else {
        setEnd(p);
        L.marker(p, { icon: redIcon })
          .addTo(map)
          .bindPopup(
            `🔴 Point ${route.length}<br/>${p[0].toFixed(
              5
            )}, ${p[1].toFixed(5)}`
          )
          .openPopup();
        const nr = [...route, p];
        if (polylineRef.current) {
          polylineRef.current.setLatLngs(nr);
        } else {
          polylineRef.current = L.polyline(nr, {
            color: "#3b82f6",
            weight: 3,
            dashArray: "6,4",
          }).addTo(map);
        }
      }
      setRoute((prev) => [...prev, p]);
    },
  });

  return null;
}

export default SurveyClick;

