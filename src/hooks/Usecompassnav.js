// ─── useCompassNav.js — Compass navigation hook (AlpineQuest style) ──────────
// Map stays NORTH-UP at all times. Only the cone marker + widget needle rotate.
import { useState, useRef, useCallback, useEffect } from "react";
import L from "leaflet";

export function useCompassNav(leafletMapRef) {
  const [compassNavActive, setCompassNavActive] = useState(false);
  const [compassHeading,   setCompassHeading]   = useState(null);
  const [compassSpeed,     setCompassSpeed]      = useState(null);
  const [compassAccuracy,  setCompassAccuracy]   = useState(null);
  const [compassGPSPos,    setCompassGPSPos]     = useState(null);
  const [compassFollowGPS, setCompassFollowGPS]  = useState(true);
  const [compassPermErr,   setCompassPermErr]    = useState(null);

  const orientRef = useRef(null);
  const gpsRef    = useRef(null);
  const coneRef   = useRef(null);

  const startCompassNav = useCallback(async () => {
    setCompassPermErr(null);

    // iOS 13+ permission
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== "granted") {
          setCompassPermErr("Motion permission denied — allow in Settings → Safari → Motion & Orientation Access.");
          return;
        }
      } catch (e) {
        setCompassPermErr("Cannot request compass permission: " + e.message);
        return;
      }
    }

    // Exponential moving average (smooth, no jitter)
    let smoothedHeading = null;
    const ALPHA = 0.15;

    const onOrientation = (e) => {
      let raw = null;
      if      (e.webkitCompassHeading != null) raw = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null)  raw = (360 - e.alpha) % 360;
      else if (e.alpha != null)                raw = (360 - e.alpha) % 360;
      if (raw == null) return;

      if (smoothedHeading == null) { smoothedHeading = raw; }
      else {
        let diff = raw - smoothedHeading;
        if (diff >  180) diff -= 360;
        if (diff < -180) diff += 360;
        smoothedHeading = (smoothedHeading + ALPHA * diff + 360) % 360;
      }

      const norm = Math.round(smoothedHeading * 10) / 10;
      setCompassHeading(norm);

      // Rotate cone marker via direct DOM (no re-render)
      if (coneRef.current) {
        const el = coneRef.current.getElement?.();
        if (el) {
          const inner = el.querySelector("[data-cone-inner]");
          if (inner) inner.style.transform = `rotate(${norm}deg)`;
        }
      }
    };

    window.addEventListener("deviceorientation", onOrientation, true);
    orientRef.current = onOrientation;

    // GPS watcher — pans map but NEVER rotates it
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lng, speed, accuracy } = pos.coords;
          setCompassGPSPos({ lat, lng });
          setCompassAccuracy(accuracy ? Math.round(accuracy) : null);
          setCompassSpeed(speed != null ? Math.round(speed * 3.6 * 10) / 10 : null);

          const map = leafletMapRef.current;
          if (!map) return;
          const latlng = [lat, lng];

          if (!coneRef.current) {
            const coneHTML = `
              <div style="width:52px;height:52px;position:relative;">
                <div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(59,130,246,0.22) 0%,rgba(59,130,246,0.05) 60%,transparent 100%);animation:compassHalo 2.5s ease-in-out infinite;"></div>
                <div data-cone-inner style="position:absolute;inset:0;transform-origin:26px 26px;">
                  <svg width="52" height="52" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="coneGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#60a5fa"/>
                        <stop offset="100%" stop-color="#1d4ed8"/>
                      </linearGradient>
                      <filter id="coneShadow">
                        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.5"/>
                      </filter>
                    </defs>
                    <path d="M26 6 L34 36 L26 30 L18 36 Z"
                      fill="url(#coneGrad)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"
                      stroke-linejoin="round" filter="url(#coneShadow)"/>
                    <circle cx="26" cy="30" r="5.5" fill="#1e40af" stroke="rgba(255,255,255,0.95)" stroke-width="2"/>
                    <circle cx="26" cy="30" r="2.5" fill="white"/>
                  </svg>
                </div>
              </div>`;
            const icon = L.divIcon({ html: coneHTML, className: "", iconSize: [52, 52], iconAnchor: [26, 30] });
            coneRef.current = L.marker(latlng, { icon, zIndexOffset: 900 }).addTo(map);
          } else {
            coneRef.current.setLatLng(latlng);
          }

          // compassFollowGPS is read via closure — pan but do NOT rotate map
          if (compassFollowGPS) map.panTo(latlng, { animate: true, duration: 0.4 });
        },
        (err) => console.warn("GPS compass:", err.message),
        { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
      );
      gpsRef.current = watchId;
    }

    setCompassNavActive(true);
  }, [compassFollowGPS, leafletMapRef]);

  const stopCompassNav = useCallback(() => {
    if (orientRef.current) {
      window.removeEventListener("deviceorientation", orientRef.current, true);
      orientRef.current = null;
    }
    if (gpsRef.current != null) {
      navigator.geolocation.clearWatch(gpsRef.current);
      gpsRef.current = null;
    }
    if (coneRef.current) {
      coneRef.current.remove();
      coneRef.current = null;
    }
    setCompassNavActive(false);
    setCompassHeading(null);
    setCompassSpeed(null);
    setCompassAccuracy(null);
    setCompassGPSPos(null);
    setCompassPermErr(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { stopCompassNav(); }, []);

  return {
    compassNavActive, compassHeading, compassSpeed, compassAccuracy,
    compassGPSPos, compassFollowGPS, setCompassFollowGPS,
    compassPermErr, setCompassPermErr,
    startCompassNav, stopCompassNav,
  };
}