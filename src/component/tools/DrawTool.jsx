/**
 * DrawTool.jsx — SurveyMap Pro v5.4.0
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES IN v5.4.0:
 *
 *  1. PREVIEW CLEANUP ON MODE EXIT:
 *     - All preview dots + lines are removed when drawMode turns false
 *     - Prevents ghost markers staying on map after confirm/cancel
 *
 *  2. COLOR-AWARE PREVIEW:
 *     - Preview dots/lines use orange (#f97316) during drawing
 *     - Matches the "pending" visual state clearly
 *
 *  3. DRAW POINTS RESET GUARD:
 *     - When drawMode goes false, clears drawLayersRef automatically
 *     - No double-cleanup errors
 *
 *  4. DRAG RE-ENABLE SAFETY:
 *     - Guards map.dragging / touchZoom / doubleClickZoom with try/catch
 *     - Prevents crash if map is unmounted while drawing
 *
 *  5. ALL POINTS STORED AS { lat, lng } OBJECTS (preserved from v5.3.1)
 *     - Fully compatible with SavedDrawingsLayer, exportUtils, KML, CSV
 *
 *  6. TOUCH FIXES (preserved from v5.3.1):
 *     - map.dragging.disable() during draw (phone pan conflict fix)
 *     - capture:true touch listeners
 *     - mouseEventToLatLng for DPR-correct coordinates
 *     - 600ms click guard
 * ─────────────────────────────────────────────────────────────────────────────
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

  /* ── Refs — latest values always available in DOM event handlers ──────── */
  const drawPointsRef = useRef(drawPoints);
  const drawModeRef   = useRef(drawMode);
  const drawTypeRef   = useRef(drawType);

  useEffect(() => { drawPointsRef.current = drawPoints; }, [drawPoints]);
  useEffect(() => { drawModeRef.current   = drawMode;   }, [drawMode]);
  useEffect(() => { drawTypeRef.current   = drawType;   }, [drawType]);

  /* ── Disable/enable map interaction while drawing ─────────────────────── */
  useEffect(() => {
    if (!map) return;
    try {
      if (drawMode) {
        map.dragging.disable();
        map.touchZoom.disable();
        map.doubleClickZoom.disable();
      } else {
        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
      }
    } catch (_) {}

    return () => {
      // Always re-enable on cleanup
      try { map.dragging.enable(); }          catch (_) {}
      try { map.touchZoom.enable(); }         catch (_) {}
      try { map.doubleClickZoom.enable(); }   catch (_) {}
    };
  }, [map, drawMode]);

  /* ── AUTO-CLEANUP when drawMode turns off ─────────────────────────────── */
  // This fires after confirmDrawing() / cancelDrawing() sets drawMode=false.
  // SurveyMap already removes layers in those handlers, but this is a safety
  // net in case something is missed (e.g. drawMode toggled from toolbar).
  useEffect(() => {
    if (drawMode) return; // only run when turning OFF

    // Clear preview line/polygon
    if (previewLayerRef.current) {
      try { previewLayerRef.current.remove(); } catch (_) {}
      previewLayerRef.current = null;
    }

    // Clear all dot markers
    if (drawLayersRef.current?.length) {
      drawLayersRef.current.forEach(l => {
        try { l.remove(); } catch (_) {}
      });
      drawLayersRef.current = [];
    }
  }, [drawMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Touch tracking ───────────────────────────────────────────────────── */
  const touchStartRef  = useRef(null);
  const lastTouchTime  = useRef(0);
  const TAP_MOVE_PX    = 10;
  const TAP_MAX_MS     = 300;
  const CLICK_GUARD_MS = 600;

  /* ── Main event listener effect ───────────────────────────────────────── */
  useEffect(() => {
    if (!map) return;

    /* addPoint — always stores as { lat, lng } object */
    const addPoint = (latlng) => {
      if (!drawModeRef.current) return;
      if (!latlng || !isFinite(latlng.lat) || !isFinite(latlng.lng)) return;

      const p  = { lat: latlng.lat, lng: latlng.lng };
      const np = [...drawPointsRef.current, p];
      setDrawPoints(np);

      const isMarker  = drawTypeRef.current === "marker";
      const isPolygon = drawTypeRef.current === "polygon";

      /* ── Dot marker for this point ──────────────────────────────────── */
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

      // Markers are single-point — no line preview needed
      if (isMarker) return;

      /* ── Update line/polygon preview ────────────────────────────────── */
      if (previewLayerRef.current) {
        try { previewLayerRef.current.remove(); } catch (_) {}
        previewLayerRef.current = null;
      }

      if (np.length >= 2) {
        // Convert { lat, lng } objects → [lat, lng] arrays for Leaflet
        const latlngs = np.map(pt => [pt.lat, pt.lng]);

        try {
          if (isPolygon) {
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
        } catch (_) {}
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
      if (e.touches.length > 0) return; // still multi-touch in progress

      const touch = e.changedTouches[0];
      if (!touch) return;

      const dx = Math.abs(touch.clientX - touchStartRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      const dt = Date.now() - touchStartRef.current.time;
      touchStartRef.current = null;

      if (dx > TAP_MOVE_PX || dy > TAP_MOVE_PX) return; // was a pan, not a tap
      if (dt > TAP_MAX_MS) return;                        // was a long-press

      lastTouchTime.current = Date.now();

      // DPR-correct coordinate conversion via Leaflet
      try {
        const latlng = map.mouseEventToLatLng({
          clientX: touch.clientX,
          clientY: touch.clientY,
        });
        addPoint(latlng);
      } catch (_) {
        try {
          const rect = container.getBoundingClientRect();
          const pt   = L.point(
            touch.clientX - rect.left,
            touch.clientY - rect.top
          );
          addPoint(map.containerPointToLatLng(pt));
        } catch (_2) {}
      }

      e.preventDefault();
      e.stopPropagation();
    };

    /* ── Mouse click (desktop) ───────────────────────────────────────────── */
    const onMouseClick = (e) => {
      if (!drawModeRef.current) return;
      // Guard against firing immediately after a touch event (dual-event devices)
      if (Date.now() - lastTouchTime.current < CLICK_GUARD_MS) return;
      addPoint(e.latlng);
    };

    // capture:true so we receive touch before Leaflet can intercept it (phone fix)
    container.addEventListener("touchstart", onTouchStart, { passive: true,  capture: true });
    container.addEventListener("touchend",   onTouchEnd,   { passive: false, capture: true });
    map.on("click", onMouseClick);

    return () => {
      container.removeEventListener("touchstart", onTouchStart, { capture: true });
      container.removeEventListener("touchend",   onTouchEnd,   { capture: true });
      map.off("click", onMouseClick);
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ intentionally omit drawMode/drawType/drawPoints — we use refs for those
  //   so the event listener doesn't re-register on every render.

  return null;
}

export default DrawTool;