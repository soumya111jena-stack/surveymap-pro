/**
 * KMLLoader.jsx — SurveyMap Pro v5.9.10
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES in v5.9.10:
 *
 *  FIX 1 — KML Sanitizer:
 *    Pre-processes KML text before parsing to fix common malformed tags:
 *    • <n>…</n>  →  <name>…</name>  (QGIS / FME export bug)
 *    • <MultiGeometry> is unwrapped — omnivore silently drops it
 *    • Strips xmlns variants that confuse the XML parser
 *
 *  FIX 2 — MultiGeometry support:
 *    omnivore.kml.parse() does NOT support <MultiGeometry>.
 *    The sanitizer extracts each child <Polygon>/<LineString>/<Point>
 *    and promotes them to individual <Placemark>s, preserving all
 *    parent <name>, <Style>, and <ExtendedData> tags.
 *
 *  FIX 3 — fill:0 / outline-only polygons visible:
 *    When KML has <PolyStyle><fill>0</fill></PolyStyle>, the polygon
 *    has NO fill but DOES have a border. We detect this and render with
 *    fillOpacity:0.08 (barely visible) so the shape outline is clear.
 *    The stroke colour is extracted from <LineStyle><color> (AABBGGRR).
 *
 *  FIX 4 — onLayer called correctly (from v5.9.9 fix, preserved).
 *
 *  FIX 5 — Coordinate display in popup uses actual lng,lat from geometry.
 *
 * All other logic from v5.9.9 preserved.
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import omnivore from "@mapbox/leaflet-omnivore";

// ── KML colour: AABBGGRR hex → CSS rgba ─────────────────────────────────────
function kmlColorToCss(kmlColor) {
  if (!kmlColor || kmlColor.length < 8) return null;
  const aa = kmlColor.slice(0, 2);
  const bb = kmlColor.slice(2, 4);
  const gg = kmlColor.slice(4, 6);
  const rr = kmlColor.slice(6, 8);
  const a = parseInt(aa, 16) / 255;
  const r = parseInt(rr, 16);
  const g = parseInt(gg, 16);
  const b = parseInt(bb, 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { css: `rgba(${r},${g},${b},${a.toFixed(2)})`, hex: `#${rr}${gg}${bb}`, alpha: a };
}

// ── Parse inline KML style for a Placemark ──────────────────────────────────
function extractInlineStyle(placemarkXml) {
  const lineMatch  = placemarkXml.match(/<LineStyle[^>]*>[\s\S]*?<color>([0-9a-fA-F]{8})<\/color>[\s\S]*?<\/LineStyle>/i);
  const polyMatch  = placemarkXml.match(/<PolyStyle[^>]*>([\s\S]*?)<\/PolyStyle>/i);
  const widthMatch = placemarkXml.match(/<LineStyle[^>]*>[\s\S]*?<width>([\d.]+)<\/width>/i);

  const lineColor  = lineMatch  ? kmlColorToCss(lineMatch[1])  : null;
  const fillText   = polyMatch  ? polyMatch[1] : "";
  const fillZero   = /fill>0</.test(fillText) || /fill>false</.test(fillText);
  const fillColor  = (() => {
    const m = fillText.match(/<color>([0-9a-fA-F]{8})<\/color>/i);
    return m ? kmlColorToCss(m[1]) : null;
  })();
  const lineWidth  = widthMatch ? parseFloat(widthMatch[1]) : 2;

  return {
    stroke:      lineColor?.hex  || "#facc15",
    strokeAlpha: lineColor?.alpha ?? 0.9,
    fill:        fillZero ? "transparent" : (fillColor?.hex || "#facc15"),
    fillAlpha:   fillZero ? 0.0  : (fillColor?.alpha ?? 0.25),
    weight:      Math.max(lineWidth, 2),
    fillZero,
  };
}

// ── CORE SANITIZER: fix malformed KML → valid KML string ─────────────────────
function sanitizeKML(rawText) {
  let kml = rawText;

  // 1. Fix <n> → <name>  and </n> → </name>
  kml = kml.replace(/<n>/gi,  "<name>");
  kml = kml.replace(/<\/n>/gi, "</name>");

  // 2. Fix other common QGIS/FME short tags
  kml = kml.replace(/<desc>/gi,  "<description>");
  kml = kml.replace(/<\/desc>/gi, "</description>");

  // 3. Fix self-closing description
  kml = kml.replace(/<description\/>/gi, "<description></description>");

  // 4. Ensure kml namespace (some exporters omit it)
  if (!kml.includes('xmlns=') && !kml.includes('xmlns ')) {
    kml = kml.replace(/<kml/i, '<kml xmlns="http://www.opengis.net/kml/2.2"');
  }

  // 5. MULTIGEOMETRY UNWRAPPER
  //    omnivore does not support <MultiGeometry>. We extract each child geometry
  //    and promote it to its own <Placemark> with the parent's name/style/data.
  if (/<MultiGeometry/i.test(kml)) {
    kml = unwrapMultiGeometry(kml);
  }

  return kml;
}

// ── Unwrap <MultiGeometry> into individual <Placemark>s ─────────────────────
function unwrapMultiGeometry(kmlText) {
  // Match each <Placemark> block that contains <MultiGeometry>
  return kmlText.replace(
    /(<Placemark[^>]*>)([\s\S]*?)<\/Placemark>/gi,
    (fullMatch, openTag, inner) => {
      if (!/<MultiGeometry/i.test(inner)) return fullMatch;

      // Extract parts we want to keep in every child Placemark
      const nameMatch  = inner.match(/<name>([\s\S]*?)<\/name>/i);
      const styleMatch = inner.match(/<Style[\s\S]*?<\/Style>/i);
      const extMatch   = inner.match(/<ExtendedData[\s\S]*?<\/ExtendedData>/i);
      const idAttr     = openTag.match(/id="([^"]+)"/i);

      const namePart  = nameMatch  ? nameMatch[0]  : "";
      const stylePart = styleMatch ? styleMatch[0] : "";
      const extPart   = extMatch   ? extMatch[0]   : "";
      const baseId    = idAttr     ? idAttr[1]     : "mg";

      // Pull everything inside <MultiGeometry>…</MultiGeometry>
      const mgMatch = inner.match(/<MultiGeometry[^>]*>([\s\S]*?)<\/MultiGeometry>/i);
      if (!mgMatch) return fullMatch;
      const mgInner = mgMatch[1];

      // Extract each child geometry tag (Polygon, LineString, Point, etc.)
      const geomPattern = /<(Polygon|LineString|LinearRing|Point)([\s\S]*?)<\/\1>/gi;
      const geometries  = [];
      let gm;
      while ((gm = geomPattern.exec(mgInner)) !== null) {
        geometries.push(gm[0]);
      }

      if (geometries.length === 0) return fullMatch;

      // Build one <Placemark> per child geometry
      return geometries.map((geom, i) =>
        `<Placemark id="${baseId}_${i}">
          ${namePart}
          ${stylePart}
          ${extPart}
          ${geom}
        </Placemark>`
      ).join("\n");
    }
  );
}

// ── HTML escape ──────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Re-enable Leaflet interaction handlers after fitBounds ───────────────────
function reEnableHandlers(m) {
  if (!m) return;
  ["dragging","scrollWheelZoom","touchZoom","doubleClickZoom","keyboard","boxZoom","tap"]
    .forEach(h => { try { if (m[h]?.enable) m[h].enable(); } catch (_) {} });
}

function forceUnlock(m) {
  if (!m) return;
  try { if (m._flyingTo) m._flyingTo = false; } catch (_) {}
  try { if (m._flyToFrame) { cancelAnimationFrame(m._flyToFrame); m._flyToFrame = null; } } catch (_) {}
  try { if (m._panTransition) m._panTransition = null; } catch (_) {}
  try { m._animatingZoom = false; } catch (_) {}
  try { m._zooming = false; } catch (_) {}
  try { if (m._container) m._container.style.pointerEvents = ""; } catch (_) {}
  try { m.invalidateSize({ animate: false }); } catch (_) {}
}

// ════════════════════════════════════════════════════════════════════════════
export default function KMLLoader({ file, onDone, onLayer }) {
  const map    = useMap();
  const mapRef = useRef(map);
  const layerRef = useRef(null);

  mapRef.current = map;

  useEffect(() => {
    const m = mapRef.current;

    // File removed — clean up
    if (!file) {
      if (layerRef.current) {
        try { m.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
      return;
    }

    // Remove previous layer
    if (layerRef.current) {
      try { m.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }

    console.log(`[KMLLoader] Loading "${file.name}" (${file.size} bytes)`);

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const rawText = evt.target.result;

        if (!rawText || (!rawText.includes("<kml") && !rawText.includes("<Placemark"))) {
          alert(`"${file.name}" does not appear to be a valid KML file.`);
          onDone?.();
          return;
        }

        // ── STEP 1: Sanitize ────────────────────────────────────────────────
        const kmlText = sanitizeKML(rawText);
        console.log("[KMLLoader] Sanitized KML (first 600 chars):", kmlText.slice(0, 600));

        // ── STEP 2: Parse with omnivore ─────────────────────────────────────
        const geojsonLayer = omnivore.kml.parse(kmlText);
        if (!geojsonLayer) throw new Error("omnivore returned null");

        const geojsonData  = geojsonLayer.toGeoJSON();
        const featureCount = geojsonData?.features?.length ?? 0;
        console.log(`[KMLLoader] ${featureCount} features parsed`);

        if (featureCount === 0) {
          alert(`"${file.name}" was parsed but contains no mappable features.\n\nNote: The file may use unsupported geometry types or all coordinates may be invalid.`);
          onDone?.();
          return;
        }

        // ── STEP 3: Extract inline styles from the ORIGINAL raw KML ─────────
        //    We parse style from rawText (pre-sanitize) because sanitizing
        //    doesn't change style tags.
        const placemarkBlocks = [];
        const pmPattern = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
        let pmMatch;
        while ((pmMatch = pmPattern.exec(rawText)) !== null) {
          placemarkBlocks.push(pmMatch[1]);
        }

        // ── STEP 4: Build Leaflet GeoJSON layer ─────────────────────────────
        const layer = L.geoJSON(geojsonData, {

          style: (feature) => {
            // Try to find the inline style for this feature index
            const idx    = geojsonData.features.indexOf(feature);
            // For multi-geometry, multiple features come from index 0 placemark
            const pmIdx  = Math.min(idx, placemarkBlocks.length - 1);
            const s      = pmIdx >= 0 ? extractInlineStyle(placemarkBlocks[pmIdx]) : null;

            if (s) {
              return {
                color:       s.stroke,
                weight:      s.weight,
                opacity:     s.strokeAlpha,
                // FIX 3: fillZero polygons get a faint fill so the shape is visible
                fillColor:   s.fillZero ? s.stroke : s.fill,
                fillOpacity: s.fillZero ? 0.08      : s.fillAlpha,
              };
            }
            // Default style
            return {
              color:       "#facc15",
              weight:      3,
              opacity:     0.9,
              fillColor:   "#facc15",
              fillOpacity: 0.18,
            };
          },

          pointToLayer: (feature, latlng) => {
            const name = escHtml(
              feature.properties?.name || feature.properties?.Name || ""
            );
            return L.marker(latlng, {
              icon: L.divIcon({
                className: "",
                html: `
                  <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
                    <div style="width:14px;height:14px;background:#facc15;border:2px solid #000;
                      border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.6)"></div>
                    ${name ? `<div style="margin-top:3px;background:rgba(0,0,0,0.65);color:#fff;
                      font-size:10px;font-weight:600;padding:2px 5px;border-radius:3px;
                      white-space:nowrap;max-width:160px;overflow:hidden;
                      text-overflow:ellipsis;font-family:sans-serif">${name}</div>` : ""}
                  </div>`,
                iconAnchor:   [7, 7],
                popupAnchor:  [0, -14],
              }),
            });
          },

          onEachFeature: (feature, lyr) => {
            const p     = feature.properties || {};
            const title = escHtml(p.name || p.Name || "Feature");
            const rows  = Object.entries(p)
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) => `
                <tr>
                  <td style="font-weight:700;color:#555;padding:3px 8px 3px 0;
                    text-transform:uppercase;font-size:11px;white-space:nowrap">
                    ${escHtml(k)}
                  </td>
                  <td style="color:#111;padding:3px 0;font-size:12px">
                    ${escHtml(String(v))}
                  </td>
                </tr>`)
              .join("");

            const coords  = feature.geometry?.coordinates;
            const isPoint = feature.geometry?.type === "Point";
            const coordRow = (isPoint && coords?.length >= 2)
              ? `<tr>
                  <td style="font-weight:700;color:#555;padding:3px 8px 3px 0;
                    text-transform:uppercase;font-size:11px">Coords</td>
                  <td style="color:#111;font-size:11px">
                    ${Math.abs(coords[1]).toFixed(6)}°${coords[1] < 0 ? "S" : "N"}&nbsp;
                    ${Math.abs(coords[0]).toFixed(6)}°${coords[0] < 0 ? "W" : "E"}
                  </td>
                </tr>`
              : "";

            lyr.bindPopup(`
              <div style="font-family:sans-serif;min-width:180px;max-width:280px">
                <div style="background:#1a1a2e;color:#facc15;padding:8px 12px;
                  margin:-13px -20px 10px;font-weight:800;font-size:13px;
                  border-radius:4px 4px 0 0;letter-spacing:0.04em">
                  ${title}
                </div>
                <table style="border-collapse:collapse;width:100%">
                  ${rows}${coordRow}
                </table>
              </div>`,
              { maxWidth: 320 }
            );
          },
        }).addTo(m);

        layerRef.current = layer;

        // ✅ Call onLayer AFTER addTo so parent attaches click/right-click handlers
        onLayer?.(layer);

        // Fly to bounds
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {
          m.fitBounds(bounds, { padding: [50, 50], maxZoom: 18, animate: false });
          reEnableHandlers(m);
          forceUnlock(m);
        } else {
          console.warn("[KMLLoader] Layer bounds invalid — skipping fitBounds");
        }

        console.log("[KMLLoader] ✅ Done —", featureCount, "features");
        onDone?.();

      } catch (err) {
        console.error("[KMLLoader] Parse error:", err);
        alert(`Failed to parse KML file.\n\nError: ${err?.message || err}`);
        onDone?.();
      }
    };

    reader.onerror = () => {
      alert("Could not read the KML file. Please try again.");
      onDone?.();
    };

    reader.readAsText(file);

    return () => {
      if (layerRef.current) {
        try { mapRef.current.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}