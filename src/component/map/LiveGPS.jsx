import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { blueIcon } from "./icons";

function LiveGPS() {
  const map = useMap();
  const markerRef = useRef(null);
  const watchRef = useRef(null);

  useEffect(() => {
    if (watchRef.current !== null) return;

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng], {
            icon: blueIcon,
          })
            .addTo(map)
            .bindPopup("📍 Live Engineer GPS");
        }
      },
      (err) => console.error("GPS:", err.message),
      { enableHighAccuracy: true, maximumAge: 0 }
    );

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, [map]);

  return null;
}

export default LiveGPS;

