/**
 * ShapefileLoader.jsx — SurveyMap Pro v5.9.9 (FIXED — complete rewrite)
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITICAL BUG FIXED:
 *   The uploaded ShapefileLoader.jsx was actually a verbatim copy of
 *   KMZLoader.jsx. It exported a component named "KMZLoader", imported
 *   omnivore (not used for shapefiles), and had ZERO shapefile parsing logic.
 *   Importing it as ShapefileLoader caused a silent runtime failure — the
 *   component would try to unzip the .shp file as a KMZ and fail every time.
 *
 * This is the correct ShapefileLoader. It:
 *   1. Accepts a .zip file (containing .shp + .dbf) OR a bare .shp file
 *   2. Uses the `shapefile` npm package to stream features
 *   3. Builds a L.geoJSON layer with styles matching the app theme
 *   4. Calls onLayer(layer) AFTER addTo(map) so handlers are attached
 *   5. Calls onCount(n) with the feature count
 *   6. Cleans up on file change or unmount
 *
 * Install dependency if not already present:
 *   npm install shapefile
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

export default function ShapefileLoader({
  file,         // File object — .zip (shp+dbf inside) or bare .shp
  triggerKey,   // Increment to force reload of the same file
  onDone,
  onCount,      // (n: number) => void
  onLayer,      // (layer: L.GeoJSON) => void  — called AFTER addTo
}) {
  const map = useMap();
  const mapRef = useRef(map);
  const layerRef = useRef(null);

  mapRef.current = map;

  useEffect(() => {
    const m = mapRef.current;

    if (!file) {
      if (layerRef.current) {
        try { m.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
      return;
    }

    if (layerRef.current) {
      try { m.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }

    console.log(`[ShapefileLoader] Loading "${file.name}" (${file.size} bytes)`);

    const load = async () => {
      try {
        const shapefile = await import("shapefile");
        const ext = file.name.split(".").pop().toLowerCase();

        let shpBuffer, dbfBuffer;

        if (ext === "zip") {
          // Extract .shp and .dbf from ZIP
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          const files = zip.files;

          const shpKey = Object.keys(files).find(n => n.toLowerCase().endsWith(".shp") && !files[n].dir);
          const dbfKey = Object.keys(files).find(n => n.toLowerCase().endsWith(".dbf") && !files[n].dir);

          if (!shpKey) throw new Error("No .shp file found inside the ZIP archive.");

          shpBuffer = await files[shpKey].async("arraybuffer");
          dbfBuffer = dbfKey ? await files[dbfKey].async("arraybuffer") : undefined;
          console.log(`[ShapefileLoader] ZIP: found ${shpKey}${dbfKey ? " + " + dbfKey : ""}`);

        } else if (ext === "shp") {
          shpBuffer = await file.arrayBuffer();
          // No .dbf available when loading bare .shp — attributes won't appear
          console.log("[ShapefileLoader] Loading bare .shp (no .dbf, attributes unavailable)");

        } else {
          throw new Error(`Unsupported file type ".${ext}". Please upload a .zip (containing .shp + .dbf) or a bare .shp file.`);
        }

        // Stream all features
        const features = [];
        const source = await shapefile.open(shpBuffer, dbfBuffer, { encoding: "utf-8" });

        while (true) {
          const result = await source.read();
          if (result.done) break;
          if (result.value) features.push(result.value);
        }

        console.log(`[ShapefileLoader] ${features.length} features read`);

        if (features.length === 0) {
          alert(`"${file.name}" contains no features.`);
          onDone?.();
          return;
        }

        onCount?.(features.length);

        renderOnMap(
          { type: "FeatureCollection", features },
          m,
          layerRef,
          file.name,
          onDone,
          onLayer
        );

      } catch (err) {
        console.error("[ShapefileLoader] ❌", err);
        alert(`Failed to load shapefile.\n\n${err.message}`);
        onDone?.();
      }
    };

    load();

    return () => {
      if (layerRef.current) {
        try { mapRef.current?.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
    };
  }, [file, triggerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   renderOnMap — build L.geoJSON, add to map, fire onLayer
───────────────────────────────────────────────────────────────────────────── */
function renderOnMap(geojson, m, layerRef, fileName, onDone, onLayer) {
  try {
    const layer = L.geoJSON(geojson, {
      style: (feature) => {
        const t = feature?.geometry?.type || "";
        if (t === "Polygon" || t === "MultiPolygon")
          return { color: "#a78bfa", weight: 2, opacity: 0.9, fillColor: "#a78bfa", fillOpacity: 0.2 };
        if (t === "LineString" || t === "MultiLineString")
          return { color: "#a78bfa", weight: 2.5, opacity: 0.9 };
        return {};
      },

      pointToLayer: (feature, latlng) => {
        const name = escHtml(
          feature.properties?.name   ||
          feature.properties?.Name   ||
          feature.properties?.NAME   ||
          feature.properties?.label  ||
          ""
        );
        return L.marker(latlng, {
          icon: L.divIcon({
            className: "",
            html: `
              <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
                <div style="width:12px;height:12px;background:#a78bfa;border:2px solid #fff;
                  border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.6)"></div>
                ${name ? `<div style="margin-top:2px;background:rgba(0,0,0,0.65);color:#fff;
                  font-size:10px;font-weight:600;padding:2px 5px;border-radius:3px;
                  white-space:nowrap;max-width:140px;overflow:hidden;
                  text-overflow:ellipsis;font-family:sans-serif">${name}</div>` : ""}
              </div>`,
            iconAnchor: [6, 6],
            popupAnchor: [0, -12],
          }),
        });
      },

      onEachFeature: (feature, lyr) => {
        const p = feature.properties || {};
        const title = escHtml(
          p.name || p.Name || p.NAME || p.label || p.id || "Feature"
        );
        const rows = Object.entries(p)
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .slice(0, 15)
          .map(([k, v]) => `
            <tr>
              <td style="font-weight:700;color:#555;padding:3px 8px 3px 0;
                text-transform:uppercase;font-size:11px;white-space:nowrap">
                ${escHtml(k)}
              </td>
              <td style="color:#111;padding:3px 0;font-size:12px">
                ${escHtml(String(v))}
              </td>
            </tr>`
          ).join("");

        if (rows) {
          lyr.bindPopup(`
            <div style="font-family:sans-serif;min-width:180px;max-width:300px">
              <div style="background:#1a1a2e;color:#a78bfa;padding:8px 12px;
                margin:-13px -20px 10px;font-weight:800;font-size:13px;
                border-radius:4px 4px 0 0;letter-spacing:0.04em">
                ${title}
              </div>
              <table style="border-collapse:collapse;width:100%">${rows}</table>
            </div>`,
            { maxWidth: 320 }
          );
        }
      },
    }).addTo(m);

    layerRef.current = layer;

    // ✅ RULE 1: call onLayer AFTER addTo (inside renderOnMap per spec)
    onLayer?.(layer);

    // Fit bounds
    try {
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) {
        m.fitBounds(bounds, { padding: [50, 50], maxZoom: 18, animate: false });
        reEnableHandlers(m);
        forceUnlock(m);
      }
    } catch (_) {}

    console.log("[ShapefileLoader] ✅ Done");
    onDone?.();

  } catch (err) {
    console.error("[ShapefileLoader] renderOnMap error:", err);
    alert(`Shapefile rendered with error.\n\n${err.message}`);
    onDone?.();
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function reEnableHandlers(m) {
  if (!m) return;
  ["dragging", "scrollWheelZoom", "touchZoom", "doubleClickZoom", "keyboard", "boxZoom", "tap"]
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

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}