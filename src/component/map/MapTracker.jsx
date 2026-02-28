import { useEffect } from "react";
import { useMap } from "react-leaflet";

function MapTracker({ onMove, onZoom }) {
  const map = useMap();

  useEffect(() => {
    const mv = (e) => onMove({ lat: e.latlng.lat, lng: e.latlng.lng });
    const zv = () => onZoom(map.getZoom());
    map.on("mousemove", mv);
    map.on("zoomend", zv);
    onZoom(map.getZoom());
    return () => {
      map.off("mousemove", mv);
      map.off("zoomend", zv);
    };
  }, [map, onMove, onZoom]);

  return null;
}

export default MapTracker;

