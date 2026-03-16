// ─── useTrackRecorder.js ──────────────────────────────────────────────────────
// AlpineQuest-style live GPS track recorder hook.
// Records GPS points with timestamp, elevation, accuracy, speed.
// Computes live stats: distance, duration, ascent, descent, avg/max speed.
// Exports to GPX, KML, KMZ, GeoJSON, CSV.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect } from "react";
import L from "leaflet";

/* ── Haversine distance (metres) between two {lat,lng} points ─────────────── */
function haversineDist(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ── Format seconds → HH:MM:SS ───────────────────────────────────────────── */
export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}

/* ── Format metres ───────────────────────────────────────────────────────── */
export function formatDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPORT BUILDERS
══════════════════════════════════════════════════════════════════════════ */

/* ── GPX ─────────────────────────────────────────────────────────────────── */
export function buildGPX(points, trackName = "SurveyMap Track") {
  const pts = points.map(p => {
    const ele = p.elevation != null ? `\n        <ele>${p.elevation.toFixed(1)}</ele>` : "";
    const spd = p.speed != null ? `\n        <extensions><speed>${p.speed.toFixed(2)}</speed><accuracy>${(p.accuracy || 0).toFixed(1)}</accuracy></extensions>` : "";
    return `    <trkpt lat="${p.lat.toFixed(8)}" lon="${p.lng.toFixed(8)}">${ele}
        <time>${new Date(p.time).toISOString()}</time>${spd}
    </trkpt>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SurveyMap Pro"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${trackName}</name>
    <time>${new Date(points[0]?.time || Date.now()).toISOString()}</time>
  </metadata>
  <trk>
    <name>${trackName}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

/* ── KML ─────────────────────────────────────────────────────────────────── */
export function buildKML(points, stats, trackName = "SurveyMap Track") {
  const coords = points.map(p =>
    `${p.lng.toFixed(8)},${p.lat.toFixed(8)},${(p.elevation || 0).toFixed(1)}`
  ).join("\n          ");

  const wpts = points.filter((_, i) => i === 0 || i === points.length - 1).map((p, i) => `
    <Placemark>
      <name>${i === 0 ? "▶ Start" : "⬛ End"}</name>
      <description>Time: ${new Date(p.time).toLocaleString()}
Elevation: ${p.elevation != null ? p.elevation.toFixed(1) + " m" : "N/A"}
Speed: ${p.speed != null ? (p.speed * 3.6).toFixed(1) + " km/h" : "N/A"}</description>
      <Point><coordinates>${p.lng.toFixed(8)},${p.lat.toFixed(8)},${(p.elevation || 0).toFixed(1)}</coordinates></Point>
    </Placemark>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${trackName}</name>
    <description>
Distance: ${formatDist(stats.distance)}
Duration: ${formatDuration(stats.duration)}
Ascent: +${Math.round(stats.ascent)} m
Descent: -${Math.round(stats.descent)} m
Max Speed: ${(stats.maxSpeed * 3.6).toFixed(1)} km/h
Avg Speed: ${(stats.avgSpeed * 3.6).toFixed(1)} km/h
Points: ${points.length}
    </description>
    <Style id="trackStyle">
      <LineStyle><color>ff0080ff</color><width>4</width></LineStyle>
      <PolyStyle><color>330080ff</color></PolyStyle>
    </Style>
    <Placemark>
      <name>${trackName}</name>
      <styleUrl>#trackStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>
          ${coords}
        </coordinates>
      </LineString>
    </Placemark>
    ${wpts}
  </Document>
</kml>`;
}

/* ── GeoJSON ─────────────────────────────────────────────────────────────── */
export function buildTrackGeoJSON(points, stats, trackName = "SurveyMap Track") {
  const coordinates = points.map(p => [
    parseFloat(p.lng.toFixed(8)),
    parseFloat(p.lat.toFixed(8)),
    parseFloat((p.elevation || 0).toFixed(1)),
  ]);

  const pointFeatures = points.map((p, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lng, p.lat, p.elevation || 0] },
    properties: {
      index: i,
      time: new Date(p.time).toISOString(),
      elevation: p.elevation != null ? parseFloat(p.elevation.toFixed(1)) : null,
      speed_ms: p.speed != null ? parseFloat(p.speed.toFixed(3)) : null,
      speed_kmh: p.speed != null ? parseFloat((p.speed * 3.6).toFixed(2)) : null,
      accuracy: p.accuracy != null ? parseFloat(p.accuracy.toFixed(1)) : null,
      heading: p.heading != null ? parseFloat(p.heading.toFixed(1)) : null,
    },
  }));

  return JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          name: trackName,
          distance_m: parseFloat(stats.distance.toFixed(1)),
          duration_s: stats.duration,
          ascent_m: parseFloat(stats.ascent.toFixed(1)),
          descent_m: parseFloat(stats.descent.toFixed(1)),
          max_speed_ms: parseFloat(stats.maxSpeed.toFixed(3)),
          avg_speed_ms: parseFloat(stats.avgSpeed.toFixed(3)),
          point_count: points.length,
          start_time: new Date(points[0]?.time || Date.now()).toISOString(),
          end_time: new Date(points[points.length - 1]?.time || Date.now()).toISOString(),
          source: "SurveyMap Pro",
        },
      },
      ...pointFeatures,
    ],
  }, null, 2);
}

/* ── CSV ─────────────────────────────────────────────────────────────────── */
export function buildCSV(points) {
  const header = "index,time,latitude,longitude,elevation_m,speed_ms,speed_kmh,accuracy_m,heading_deg";
  const rows = points.map((p, i) =>
    [
      i,
      new Date(p.time).toISOString(),
      p.lat.toFixed(8),
      p.lng.toFixed(8),
      p.elevation != null ? p.elevation.toFixed(1) : "",
      p.speed != null ? p.speed.toFixed(3) : "",
      p.speed != null ? (p.speed * 3.6).toFixed(2) : "",
      p.accuracy != null ? p.accuracy.toFixed(1) : "",
      p.heading != null ? p.heading.toFixed(1) : "",
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

/* ── Minimal ZIP builder (no dependencies) ──────────────────────────────── */
function buildZIP(files) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  function crc32(d) { let c = 0xffffffff; for (const b of d) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function u16(n) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n, true); return a; }
  function u32(n) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, true); return a; }
  const enc = new TextEncoder();
  const parts = [], cd = [];
  let off = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : enc.encode(file.data);
    const crc  = crc32(data);
    const lh   = new Uint8Array([0x50,0x4b,0x03,0x04,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0x00,0x00,...name]);
    parts.push(lh, data);
    cd.push({ name, data, crc, offset: off, size: data.length });
    off += lh.length + data.length;
  }
  const cdStart = off;
  for (const f of cd) {
    const entry = new Uint8Array([0x50,0x4b,0x01,0x02,0x14,0x00,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(f.crc),...u32(f.size),...u32(f.size),...u16(f.name.length),0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(f.offset),...f.name]);
    parts.push(entry); off += entry.length;
  }
  const eocd = new Uint8Array([0x50,0x4b,0x05,0x06,0x00,0x00,0x00,0x00,...u16(cd.length),...u16(cd.length),...u32(off-cdStart),...u32(cdStart),0x00,0x00]);
  parts.push(eocd);
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total); let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

/* ── KMZ (self-contained ZIP, no JSZip dependency) ───────────────────────── */
export async function buildKMZ(points, stats, trackName = "SurveyMap Track") {
  const kmlContent = buildKML(points, stats, trackName);
  const zipData = buildZIP([{ name: "doc.kml", data: kmlContent }]);
  return { blob: new Blob([zipData], { type: "application/vnd.google-earth.kmz" }), isZip: true };
}

/* ── Download helper ─────────────────────────────────────────────────────── */
export function downloadBlob(content, fileName, mimeType) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN HOOK
══════════════════════════════════════════════════════════════════════════ */
export function useTrackRecorder(leafletMapRef) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [isRecording,  setIsRecording]  = useState(false);
  const [isPaused,     setIsPaused]     = useState(false);
  const [points,       setPoints]       = useState([]);       // all recorded points
  const [stats,        setStats]        = useState({
    distance: 0, duration: 0, ascent: 0, descent: 0,
    maxSpeed: 0, avgSpeed: 0, currentSpeed: 0,
    currentElevation: null, currentAccuracy: null,
    startTime: null, pointCount: 0,
  });
  const [savedTracks,  setSavedTracks]  = useState([]);       // completed tracks
  const [trackName,    setTrackName]    = useState("Track");

  // ── Refs ───────────────────────────────────────────────────────────────────
  const watchIdRef     = useRef(null);
  const polylineRef    = useRef(null);
  const markerRef      = useRef(null);        // start marker
  const endMarkerRef   = useRef(null);        // live position dot
  const timerRef       = useRef(null);
  const startTimeRef   = useRef(null);
  const pauseOffsetRef = useRef(0);           // cumulative paused ms
  const pauseStartRef  = useRef(null);
  const lastPointRef   = useRef(null);
  const pointsRef      = useRef([]);          // mirror of points — safe in GPS callback
  const statsRef       = useRef({});
  // Status refs — avoid stale closures in watchPosition callback
  const isRecordingRef = useRef(false);
  const isPausedRef    = useRef(false);

  // Keep refs in sync with state
  useEffect(() => { pointsRef.current    = points;      }, [points]);
  useEffect(() => { statsRef.current     = stats;       }, [stats]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isPausedRef.current    = isPaused;    }, [isPaused]);

  // ── Compute stats from a new point ────────────────────────────────────────
  const updateStats = useCallback((newPoint, prevPoint, prevStats) => {
    const segDist = prevPoint ? haversineDist(prevPoint, newPoint) : 0;
    const distance = prevStats.distance + segDist;

    const eleDiff = (prevPoint && newPoint.elevation != null && prevPoint.elevation != null)
      ? newPoint.elevation - prevPoint.elevation : 0;
    const ascent  = prevStats.ascent  + (eleDiff > 0 ? eleDiff : 0);
    const descent = prevStats.descent + (eleDiff < 0 ? -eleDiff : 0);

    const currentSpeed = newPoint.speed ?? 0;
    const maxSpeed = Math.max(prevStats.maxSpeed, currentSpeed);

    const elapsed = startTimeRef.current
      ? (Date.now() - startTimeRef.current - pauseOffsetRef.current) / 1000 : 0;

    const avgSpeed = elapsed > 0 ? distance / elapsed : 0;

    return {
      distance, ascent, descent, maxSpeed, avgSpeed,
      currentSpeed,
      currentElevation: newPoint.elevation,
      currentAccuracy: newPoint.accuracy,
      duration: elapsed,
      startTime: prevStats.startTime,
      pointCount: pointsRef.current.length + 1,
    };
  }, []);

  // ── Draw / update polyline on map ─────────────────────────────────────────
  const updateMapPolyline = useCallback((allPoints) => {
    // leafletMapRef may hold either a React ref (.current) or a direct instance
    const map = leafletMapRef?.current ?? leafletMapRef;
    if (!map || allPoints.length < 2) return;

    const latlngs = allPoints.map(p => [p.lat, p.lng]);

    if (!polylineRef.current) {
      polylineRef.current = L.polyline(latlngs, {
        color: "#3b82f6", weight: 4, opacity: 0.85,
        lineCap: "round", lineJoin: "round",
        dashArray: null,
      }).addTo(map);
    } else {
      polylineRef.current.setLatLngs(latlngs);
    }
  }, [leafletMapRef]);

  // ── Place start / live markers ─────────────────────────────────────────────
  const placeStartMarker = useCallback((lat, lng) => {
    const map = leafletMapRef?.current ?? leafletMapRef;
    if (!map) return;
    const html = `<div style="width:18px;height:18px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 0 0 3px rgba(34,197,94,0.4),0 2px 8px rgba(0,0,0,0.4)"></div>`;
    const icon = L.divIcon({ html, className: "", iconSize: [18, 18], iconAnchor: [9, 9] });
    markerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup("<b>▶ Track Start</b>");
  }, [leafletMapRef]);

  const updateLiveMarker = useCallback((lat, lng, heading) => {
    const map = leafletMapRef?.current ?? leafletMapRef;
    if (!map) return;
    const rot = heading != null ? heading : 0;
    const html = `<div style="width:20px;height:20px;position:relative;transform:rotate(${rot}deg)">
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 1 L15 17 L10 13 L5 17 Z" fill="#3b82f6" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="10" cy="13" r="2.5" fill="white"/>
      </svg></div>`;
    const icon = L.divIcon({ html, className: "", iconSize: [20, 20], iconAnchor: [10, 13] });
    if (!endMarkerRef.current) {
      endMarkerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1100 }).addTo(map);
    } else {
      endMarkerRef.current.setLatLng([lat, lng]);
      const el = endMarkerRef.current.getElement();
      if (el) { const inner = el.querySelector("div"); if (inner) inner.style.transform = `rotate(${rot}deg)`; }
    }
  }, [leafletMapRef]);

  // ── GPS success callback ───────────────────────────────────────────────────
  // Uses refs (not state) to avoid stale-closure bug with watchPosition.
  const onGPSSuccess = useCallback((pos) => {
    if (!isRecordingRef.current || isPausedRef.current) return;

    const { latitude: lat, longitude: lng, altitude, speed, accuracy, heading } = pos.coords;
    const newPoint = {
      lat, lng,
      elevation: altitude,
      speed: speed ?? null,
      accuracy: accuracy ?? null,
      heading: heading ?? null,
      time: pos.timestamp,
    };

    // Filter out bad points (accuracy > 50m or duplicate)
    if (accuracy > 50) return;
    const prev = lastPointRef.current;
    if (prev) {
      const d = haversineDist(prev, newPoint);
      if (d < 2 && Math.abs((newPoint.time - prev.time) / 1000) < 3) return; // too close, too fast
    }

    lastPointRef.current = newPoint;
    const prevStats = statsRef.current;
    const newStats = updateStats(newPoint, prev, prevStats);

    setPoints(p => {
      const updated = [...p, newPoint];
      // Place start marker on very first GPS point
      if (updated.length === 1) placeStartMarker(lat, lng);
      updateMapPolyline(updated);
      return updated;
    });
    setStats(newStats);
    updateLiveMarker(lat, lng, heading);

    // Auto-pan if map follow is enabled
    const map = leafletMapRef?.current ?? leafletMapRef;
    if (map) map.panTo([lat, lng], { animate: true, duration: 0.5 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateStats, updateMapPolyline, updateLiveMarker, leafletMapRef]);

  // ── Duration timer ─────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      if (pauseStartRef.current) return; // paused
      const elapsed = (Date.now() - startTimeRef.current - pauseOffsetRef.current) / 1000;
      setStats(s => ({ ...s, duration: elapsed }));
    }, 1000);
  }, []);

  // ── START ──────────────────────────────────────────────────────────────────
  const startRecording = useCallback((name = "Track") => {
    if (isRecording) return;
    setTrackName(name);
    setPoints([]);
    setStats({ distance: 0, duration: 0, ascent: 0, descent: 0, maxSpeed: 0, avgSpeed: 0, currentSpeed: 0, currentElevation: null, currentAccuracy: null, startTime: Date.now(), pointCount: 0 });
    lastPointRef.current = null;
    startTimeRef.current = Date.now();
    pauseOffsetRef.current = 0;
    pauseStartRef.current = null;

    if (!navigator.geolocation) { alert("Geolocation not supported by your device."); return; }

    watchIdRef.current = navigator.geolocation.watchPosition(
      onGPSSuccess,
      (err) => console.warn("Track GPS error:", err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    startTimer();
    isRecordingRef.current = true;
    isPausedRef.current    = false;
    setIsRecording(true);
    setIsPaused(false);
  }, [isRecording, onGPSSuccess, startTimer]);

  // ── PAUSE ──────────────────────────────────────────────────────────────────
  const pauseRecording = useCallback(() => {
    if (!isRecording || isPaused) return;
    pauseStartRef.current = Date.now();
    if (polylineRef.current) {
      polylineRef.current.setStyle({ dashArray: "8 6", opacity: 0.5 });
    }
    isPausedRef.current = true;
    setIsPaused(true);
  }, [isRecording, isPaused]);

  // ── RESUME ─────────────────────────────────────────────────────────────────
  const resumeRecording = useCallback(() => {
    if (!isRecording || !isPaused) return;
    if (pauseStartRef.current) {
      pauseOffsetRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    if (polylineRef.current) {
      polylineRef.current.setStyle({ dashArray: null, opacity: 0.85 });
    }
    isPausedRef.current = false;
    setIsPaused(false);
  }, [isRecording, isPaused]);

  // ── STOP ───────────────────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    // Clear GPS watcher
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    // Clear timer
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const finalPoints = pointsRef.current;
    const finalStats = { ...statsRef.current, duration: (Date.now() - startTimeRef.current - pauseOffsetRef.current) / 1000 };
    const finalName = trackName || "Track";

    // Save completed track
    const saved = {
      id: Date.now(),
      name: finalName,
      points: finalPoints,
      stats: finalStats,
      savedAt: new Date().toISOString(),
      polyline: polylineRef.current, // keep reference to remove/show on map
    };
    setSavedTracks(prev => [...prev, saved]);

    // Style polyline as completed
    if (polylineRef.current) {
      polylineRef.current.setStyle({ color: "#8b5cf6", weight: 3, opacity: 0.65, dashArray: null });
    }
    // Remove live marker, keep start marker
    if (endMarkerRef.current) { endMarkerRef.current.remove(); endMarkerRef.current = null; }

    // Add end marker
    const map = leafletMapRef?.current ?? leafletMapRef;
    if (map && finalPoints.length > 0) {
      const last = finalPoints[finalPoints.length - 1];
      const html = `<div style="width:16px;height:16px;border-radius:3px;background:#ef4444;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`;
      const icon = L.divIcon({ html, className: "", iconSize: [16, 16], iconAnchor: [8, 8] });
      L.marker([last.lat, last.lng], { icon }).addTo(map).bindPopup(`<b>⬛ Track End</b><br>${finalName}`);
    }

    // Reset refs
    polylineRef.current = null;
    markerRef.current = null;
    lastPointRef.current = null;
    startTimeRef.current = null;
    pauseOffsetRef.current = 0;

    isRecordingRef.current = false;
    isPausedRef.current    = false;
    setIsRecording(false);
    setIsPaused(false);
    setPoints([]);
    setStats({ distance: 0, duration: 0, ascent: 0, descent: 0, maxSpeed: 0, avgSpeed: 0, currentSpeed: 0, currentElevation: null, currentAccuracy: null, startTime: null, pointCount: 0 });

    return saved;
  }, [isRecording, trackName, leafletMapRef]);

  // ── Export a track (saved or current) ─────────────────────────────────────
  const exportTrack = useCallback(async (track, format) => {
    const pts = track.points;
    const st  = track.stats;
    const nm  = track.name;
    const ts  = new Date(track.savedAt || Date.now()).toISOString().slice(0, 16).replace(/[T:]/g, "-");

    if (!pts || pts.length === 0) { alert("No track points to export."); return; }

    switch (format) {
      case "gpx":
        downloadBlob(buildGPX(pts, nm), `${nm}-${ts}.gpx`, "application/gpx+xml");
        break;
      case "kml":
        downloadBlob(buildKML(pts, st, nm), `${nm}-${ts}.kml`, "application/vnd.google-earth.kml+xml");
        break;
      case "kmz": {
        const { blob } = await buildKMZ(pts, st, nm);
        downloadBlob(blob, `${nm}-${ts}.kmz`, "application/vnd.google-earth.kmz");
        break;
      }
      case "geojson":
        downloadBlob(buildTrackGeoJSON(pts, st, nm), `${nm}-${ts}.geojson`, "application/geo+json");
        break;
      case "csv":
        downloadBlob(buildCSV(pts), `${nm}-${ts}.csv`, "text/csv");
        break;
      default:
        break;
    }
  }, []);

  // ── Remove a saved track from map + list ──────────────────────────────────
  const removeTrack = useCallback((id) => {
    setSavedTracks(prev => {
      const track = prev.find(t => t.id === id);
      if (track?.polyline) track.polyline.remove();
      return prev.filter(t => t.id !== id);
    });
  }, []);

  // ── Toggle track visibility on map ────────────────────────────────────────
  const toggleTrackVisibility = useCallback((id) => {
    setSavedTracks(prev => prev.map(t => {
      if (t.id !== id) return t;
      const hidden = !t.hidden;
      if (t.polyline) {
        if (hidden) t.polyline.setStyle({ opacity: 0 });
        else        t.polyline.setStyle({ opacity: 0.65 });
      }
      return { ...t, hidden };
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return {
    isRecording, isPaused, points, stats, savedTracks, trackName, setTrackName,
    startRecording, pauseRecording, resumeRecording, stopRecording,
    exportTrack, removeTrack, toggleTrackVisibility,
  };
}