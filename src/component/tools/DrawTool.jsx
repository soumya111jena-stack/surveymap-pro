/**
 * DrawTool.jsx — SurveyMap Pro v5.3.1
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX v5.3.1 — DRAW POINTS NOT APPEARING IN EXPORTS:
 *
 *  ROOT CAUSE:
 *    DrawTool was storing points as [lat, lng] arrays:
 *      setDrawPoints(np)  where np = [...prev, [latlng.lat, latlng.lng]]
 *
 *    But exportUtils ptCoord() and KML/CSV builders read them as objects:
 *      p.lat ?? p[0]   ← this SHOULD handle both, but...
 *
 *    The real bug: savedDrawings.points comes from pendingPoints which comes
 *    from drawPoints state. When confirmDrawing() runs in SurveyMap.jsx:
 *      setPendingPoints(drawPoints)   ← array of [lat,lng] arrays
 *      setSavedDrawings([...savedDrawings, { points: pendingPoints }])
 *
 *    Then in exportUtils:
 *      const pts = (d.points || []).map(p => [p.lng ?? p[1], p.lat ?? p[0]])
 *
 *    p[1] = lng ✓   p[0] = lat ✓  — this LOOKS correct for arrays...
 *    BUT for GeoJSON: coordinates need [lng, lat] order
 *    AND for KML: ptCoord(p) does p.lng ?? p[1]  which gives p[1] — also correct
 *
 *  ACTUAL ROOT CAUSE (found by tracing):
 *    The issue is in SurveyMap.jsx confirmDrawing():
 *      setSavedDrawings(p => [...p, { name, type: pendingType, points: pendingPoints }])
 *
 *    pendingPoints = drawPoints = array of [lat, lng] pairs
 *    This IS stored correctly.
 *
 *    The REAL problem is that DrawTool calls setDrawPoints but SurveyMap.jsx
 *    reads drawPoints state for export. However drawPoints is cleared on
 *    confirmDrawing BEFORE pendingPoints is set in some render cycles.
 *
 *  FIX:
 *    1. Store points as { lat, lng } objects (not arrays) — removes all
 *       ambiguity in every consumer (export, preview, map rendering)
 *    2. DrawTool uses { lat, lng } consistently
 *    3. All map rendering uses p.lat / p.lng directly — no more p[0]/p[1]
 *    4. Export functions updated to match (in exportUtils.js)
 *
 *  ALSO FIXED (from v5.2.6):
 *    - map.dragging.disable() when drawing (real phone pan conflict)
 *    - capture:true touch listeners (real phone Leaflet intercept)
 *    - mouseEventToLatLng for DPR-correct coordinates on real phones
 *    - 600ms click guard (prevents double points on slow devices)
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
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

  /* ── Refs — latest value always available inside DOM event handlers ───── */
  const drawPointsRef = useRef(drawPoints);
  const drawModeRef   = useRef(drawMode);
  const drawTypeRef   = useRef(drawType);

  useEffect(() => { drawPointsRef.current = drawPoints; }, [drawPoints]);
  useEffect(() => { drawModeRef.current   = drawMode;   }, [drawMode]);
  useEffect(() => { drawTypeRef.current   = drawType;   }, [drawType]);

  /* ── Disable Leaflet map drag while drawing (real phone fix) ──────────── */
  useEffect(() => {
    if (!map) return;
    if (drawMode) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
    }
    return () => {
      try {
        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
      } catch (_) {}
    };
  }, [map, drawMode]);

  /* ── Touch tracking ───────────────────────────────────────────────────── */
  const touchStartRef  = useRef(null);
  const lastTouchTime  = useRef(0);
  const TAP_MOVE_PX    = 10;
  const TAP_MAX_MS     = 300;
  const CLICK_GUARD_MS = 600;

  useEffect(() => {
    if (!map) return;

    /* ── addPoint: stores as { lat, lng } object ── */
    const addPoint = (latlng) => {
      if (!drawModeRef.current) return;
      if (!latlng || !isFinite(latlng.lat) || !isFinite(latlng.lng)) return;

      // FIX: store as object { lat, lng } — not array [lat, lng]
      const p  = { lat: latlng.lat, lng: latlng.lng };
      const np = [...drawPointsRef.current, p];
      setDrawPoints(np);

      const isMarker = drawTypeRef.current === "marker";

      // Dot on map
      const dot = L.circleMarker([p.lat, p.lng], {
        radius:      isMarker ? 9 : 5,
        color:       "#fff",
        weight:      2,
        fillColor:   isMarker ? "#ef4444" : "#f97316",
        fillOpacity: 1,
        zIndexOffset: 1000,
        interactive: false,
        bubblingMouseEvents: false,
      }).addTo(map);
      drawLayersRef.current.push(dot);

      if (isMarker) return;

      // Update preview
      if (previewLayerRef.current) {
        previewLayerRef.current.remove();
        previewLayerRef.current = null;
      }

      if (np.length >= 2) {
        // Convert { lat, lng } objects → [lat, lng] arrays for Leaflet
        const latlngs = np.map(pt => [pt.lat, pt.lng]);

        if (drawTypeRef.current === "polygon") {
          previewLayerRef.current = L.polygon(latlngs, {
            color:       "#f97316",
            weight:      2.5,
            dashArray:   "6 4",
            fillColor:   "#f97316",
            fillOpacity: 0.15,
            interactive: false,
          }).addTo(map);
        } else {
          previewLayerRef.current = L.polyline(latlngs, {
            color:       "#f97316",
            weight:      2.5,
            dashArray:   "6 4",
            interactive: false,
          }).addTo(map);
        }
      }
    };

    const container = map.getContainer();

    /* ── Touch start ─────────────────────────────────────────────────────── */
    const onTouchStart = (e) => {
      if (!drawModeRef.current) return;
      if (e.touches.length > 1) { touchStartRef.current = null; return; }
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    };

    /* ── Touch end ───────────────────────────────────────────────────────── */
    const onTouchEnd = (e) => {
      if (!drawModeRef.current) return;
      if (!touchStartRef.current) return;
      if (e.touches.length > 0) return; // still multi-touch

      const touch = e.changedTouches[0];
      if (!touch) return;

      const dx = Math.abs(touch.clientX - touchStartRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      const dt = Date.now() - touchStartRef.current.time;
      touchStartRef.current = null;

      if (dx > TAP_MOVE_PX || dy > TAP_MOVE_PX) return; // was a pan
      if (dt > TAP_MAX_MS) return;                        // was a long-press

      lastTouchTime.current = Date.now();

      // DPR-correct coordinate conversion via Leaflet
      try {
        const latlng = map.mouseEventToLatLng({ clientX: touch.clientX, clientY: touch.clientY });
        addPoint(latlng);
      } catch (_) {
        try {
          const rect = container.getBoundingClientRect();
          const pt   = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
          addPoint(map.containerPointToLatLng(pt));
        } catch (_2) {}
      }

      e.preventDefault();
      e.stopPropagation();
    };

    /* ── Mouse click (desktop) ───────────────────────────────────────────── */
    const onMouseClick = (e) => {
      if (!drawModeRef.current) return;
      if (Date.now() - lastTouchTime.current < CLICK_GUARD_MS) return;
      addPoint(e.latlng);
    };

    // capture:true so we receive touch before Leaflet (real phone fix)
    container.addEventListener("touchstart", onTouchStart, { passive: true,  capture: true });
    container.addEventListener("touchend",   onTouchEnd,   { passive: false, capture: true });
    map.on("click", onMouseClick);

    return () => {
      container.removeEventListener("touchstart", onTouchStart, { capture: true });
      container.removeEventListener("touchend",   onTouchEnd,   { capture: true });
      map.off("click", onMouseClick);
    };
  }, [map]);

  return null;
}

export default DrawTool;