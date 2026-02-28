import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

function BoundaryLayer({ geojson }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }
    if (!geojson) return;

    layerRef.current = L.geoJSON(geojson, {
      style: {
        color: "#ef4444",
        weight: 2.5,
        opacity: 1,
        fill: false,
      },
    }).addTo(map);

    return () => {
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
    };
  }, [geojson, map]);

  return null;
}

export default BoundaryLayer;

