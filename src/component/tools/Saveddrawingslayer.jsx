/**
 * SavedDrawingsLayer.jsx — SurveyMap Pro v2.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES IN v2.0.0:
 *  - ICON EDITING SUPPORT: reads drawing.iconKey and renders the correct SVG
 *    icon shape for markers. Supported keys: pin, circle, square, star,
 *    diamond, flag, info, camera — matching FeaturePropertiesPanel's picker.
 *  - COLOR REACTIVE: marker icon fills use drawing.color so color changes
 *    from the panel are reflected immediately.
 *  - ICON SIZE SUPPORT: reads drawing.iconSize ("small" | "medium" | "large")
 *    and scales the DivIcon accordingly.
 *  - All v1.0 behavior preserved: paths, polygons, click handlers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/* ── Icon size map ─────────────────────────────────────────────────────────── */
const SIZE_PX = { small: 24, medium: 32, large: 42 };

/* ── Build SVG string for a given iconKey + color ─────────────────────────── */
function buildIconSVG(iconKey, color, sizePx) {
  const c = color || "#1a73e8";
  const s = sizePx;
  const h = s;

  switch (iconKey) {
    case "circle":
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2.5"/>
        <circle cx="12" cy="12" r="4" fill="${c}"/>
      </svg>`;

    case "square":
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="18" height="18" rx="3" fill="${c}"/>
      </svg>`;

    case "star":
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
          fill="${c}" stroke="${c}" stroke-width="0.5"/>
      </svg>`;

    case "diamond":
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <polygon points="12,2 22,12 12,22 2,12" fill="${c}"/>
      </svg>`;

    case "flag":
      return `<svg width="${s}" height="${h + 8}" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="${c}" fill-opacity="0.85"/>
        <line x1="4" y1="22" x2="4" y2="15" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="4" y1="22" x2="4" y2="30" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/>
      </svg>`;

    case "info":
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="${c}"/>
        <line x1="12" y1="16" x2="12" y2="12" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <line x1="12" y1="8" x2="12.01" y2="8" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
      </svg>`;

    case "camera":
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="7" width="22" height="15" rx="3" fill="${c}" fill-opacity="0.85"/>
        <path d="M23 7V7a2 2 0 00-2-2H3a2 2 0 00-2 2v0" fill="${c}" stroke="${c}" stroke-width="0.5"/>
        <path d="M15 4l-2-3H11L9 4" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="12" cy="14" r="4" fill="none" stroke="#fff" stroke-width="2"/>
        <circle cx="12" cy="14" r="1.5" fill="#fff"/>
      </svg>`;

    case "pin":
    default:
      return `<svg width="${s}" height="${Math.round(s * 1.4)}" viewBox="0 0 32 44" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C8.27 0 2 6.27 2 14c0 9.625 14 30 14 30S30 23.625 30 14C30 6.27 23.73 0 16 0z"
          fill="${c}" stroke="rgba(0,0,0,0.22)" stroke-width="1.5"/>
        <circle cx="16" cy="14" r="6" fill="rgba(255,255,255,0.9)"/>
        <circle cx="16" cy="14" r="3.5" fill="${c}"/>
      </svg>`;
  }
}

/* ── Anchor point for each icon ───────────────────────────────────────────── */
function iconAnchor(iconKey, sizePx) {
  switch (iconKey) {
    case "flag": return [4, sizePx + 8];
    case "pin":  return [sizePx / 2, Math.round(sizePx * 1.4)];
    default:     return [sizePx / 2, sizePx / 2];
  }
}

/* ── Build a Leaflet DivIcon for a marker drawing ─────────────────────────── */
function buildDivIcon(drawing) {
  const key    = drawing.iconKey  || "pin";
  const size   = drawing.iconSize || "medium";
  const color  = drawing.color   || "#1a73e8";
  const sizePx = SIZE_PX[size] || 32;
  const svg    = buildIconSVG(key, color, sizePx);
  const anchor = iconAnchor(key, sizePx);

  return L.divIcon({
    html: svg,
    className: "",
    iconSize:   null,
    iconAnchor: anchor,
    popupAnchor:[0, -anchor[1]],
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════ */
export default function SavedDrawingsLayer({ savedDrawings, onFeatureClick }) {
  const map       = useMap();
  const layersRef = useRef([]);
  const prevRef   = useRef([]);

  useEffect(() => {
    if (!map) return;

    layersRef.current.forEach(l => { try { l.remove(); } catch (_) {} });
    layersRef.current = [];

    if (!Array.isArray(savedDrawings)) return;

    savedDrawings.forEach((drawing, idx) => {
      if (!drawing || !drawing.points || drawing.points.length === 0) return;

      const color       = drawing.color      || "#1a73e8";
      const fillColor   = drawing.fillColor  || color;
      const widthPx     = drawing.width      ?? 3;
      const opacityFrac = (drawing.opacity   ?? 100) / 100;
      const fillOpFrac  = (drawing.fillOpacity ?? 35) / 100;

      let layer = null;

      try {
        if (drawing.type === "marker") {
          const p = drawing.points[0];
          if (!p || p.lat == null || p.lng == null) return;

          layer = L.marker([p.lat, p.lng], {
            icon: buildDivIcon(drawing),
          });

          if (drawing.name) {
            layer.bindTooltip(drawing.name, {
              permanent:  false,
              direction:  "top",
              className:  "survey-tooltip",
              offset:     [0, -4],
            });
          }

        } else if (drawing.type === "path") {
          if (drawing.points.length < 2) return;
          const latlngs = drawing.points.map(p => [p.lat, p.lng]);

          layer = L.polyline(latlngs, {
            color,
            weight:  widthPx,
            opacity: opacityFrac,
            interactive: true,
          });

        } else if (drawing.type === "polygon") {
          if (drawing.points.length < 3) return;
          const latlngs = drawing.points.map(p => [p.lat, p.lng]);

          layer = L.polygon(latlngs, {
            color,
            weight:       widthPx,
            opacity:      opacityFrac,
            fillColor,
            fillOpacity:  fillOpFrac,
            interactive:  true,
          });
        }

      } catch (err) {
        console.warn("SavedDrawingsLayer: error creating layer for drawing", idx, err);
        return;
      }

      if (!layer) return;

      layer.on("click", (e) => {
        try { e.originalEvent?.stopPropagation(); } catch (_) {}
        onFeatureClick?.(drawing);
      });

      layer.addTo(map);
      layersRef.current.push(layer);
    });

    prevRef.current = savedDrawings;

    return () => {
      layersRef.current.forEach(l => { try { l.remove(); } catch (_) {} });
      layersRef.current = [];
    };
  }, [map, savedDrawings, onFeatureClick]);

  return null;
}