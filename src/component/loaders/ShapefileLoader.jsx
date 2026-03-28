/**
 * ShapefileLoader.jsx — SurveyMap Pro v5.8 (FIXED)
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES:
 *  1. Layer cleanup when file=null — removing file in UI now removes map layer
 *  2. triggerKey=null correctly handled — no spurious re-loads
 *  3. fitBounds animate:false always, followed by reEnableHandlers + forceUnlock
 *  4. All popup content HTML-escaped
 *  5. onDone() always called on all code paths
 *  6. circleMarker bounds computed manually (circleMarker has no getBounds)
 *  7. [FIXED] shapefile.open is not a function — safe import with ESM/CJS interop
 *             and automatic fallback to shapefile.read()
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

const POINT_STYLE = {
  radius: 8, fillColor: "#a78bfa", color: "#fff",
  weight: 2, opacity: 1, fillOpacity: 0.9,
};
const LINE_STYLE = { color: "#a78bfa", weight: 3, opacity: 0.9 };
const POLYGON_STYLE = {
  color: "#a78bfa", weight: 2.5, fillColor: "#a78bfa",
  fillOpacity: 0.2, opacity: 0.9,
};

export default function ShapefileLoader({ file, triggerKey, onDone, onCount }) {
  const map = useMap();
  const mapRef = useRef(map);
  const fileRef = useRef(file);
  const layerRef = useRef(null);

  mapRef.current = map;
  fileRef.current = file;

  useEffect(() => {
    const m = mapRef.current;

    // ── No trigger or no file — clean up if needed ──────────────────────
    if (!triggerKey || !fileRef.current) {
      if (layerRef.current) {
        try { m.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
      return;
    }

    const f = fileRef.current;

    if (!m) { console.error("[ShapefileLoader] map is null"); onDone?.(); return; }

    // Remove previous layer
    if (layerRef.current) {
      try { m.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }

    console.log(`[ShapefileLoader] Loading "${f.name}" (${f.size} bytes)`);

    const load = async () => {
      try {
        const ext = f.name.split(".").pop().toLowerCase();
        let shpBuffer = null;
        let dbfBuffer = null;
        let prjText = null;

        if (ext === "zip") {
          const result = await extractShapefileFromZip(f);
          shpBuffer = result.shp;
          dbfBuffer = result.dbf;
          prjText = result.prj;

          if (!shpBuffer) {
            throw new Error(
              `No .shp file found inside "${f.name}".\n\n` +
              `ZIP must contain at least a .shp file (plus .dbf and .shx).`
            );
          }
        } else if (ext === "shp") {
          shpBuffer = await f.arrayBuffer();
        } else {
          throw new Error(
            `Unsupported file: ".${ext}"\n\nUpload a .zip (containing .shp + .dbf) or a raw .shp file.`
          );
        }

        if (prjText) checkProjection(prjText, f.name);

        const features = await parseShapefile(shpBuffer, dbfBuffer);
        console.log(`[ShapefileLoader] ${features.length} feature(s) parsed`);

        if (features.length === 0) {
          alert(`"${f.name}" loaded but contains 0 features.`);
          onDone?.();
          return;
        }

        const fc = { type: "FeatureCollection", features };
        await renderOnMap(fc, mapRef.current, layerRef, onDone, onCount, features.length);

      } catch (err) {
        console.error("[ShapefileLoader] ❌", err);
        alert(`Failed to load Shapefile.\n\n${err.message}`);
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
  }, [triggerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle file removal (triggerKey stays null but file becomes null) ──
  useEffect(() => {
    if (!file && layerRef.current) {
      try { mapRef.current?.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }
  }, [file]);

  return null;
}

/* ── ZIP extraction ──────────────────────────────────────────────────────── */
async function extractShapefileFromZip(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const len = bytes.length;

  let eocdOffset = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4B &&
        bytes[i+2] === 0x05 && bytes[i+3] === 0x06) {
      eocdOffset = i; break;
    }
  }
  if (eocdOffset === -1) throw new Error("Not a valid ZIP file");

  let cdOffset = view.getUint32(eocdOffset + 16, true);
  let totalEntries = view.getUint16(eocdOffset + 10, true);

  if (cdOffset === 0xFFFFFFFF || totalEntries === 0xFFFF) {
    const z64Loc = eocdOffset - 20;
    if (z64Loc >= 0 && bytes[z64Loc] === 0x50 && bytes[z64Loc+1] === 0x4B &&
        bytes[z64Loc+2] === 0x06 && bytes[z64Loc+3] === 0x07) {
      const z64Eocd = Number(view.getBigUint64(z64Loc + 8, true));
      if (z64Eocd < len && bytes[z64Eocd] === 0x50) {
        cdOffset = Number(view.getBigUint64(z64Eocd + 48, true));
        totalEntries = Number(view.getBigUint64(z64Eocd + 32, true));
      }
    }
  }

  const entries = {};
  let pos = cdOffset;

  for (let i = 0; i < totalEntries && pos < len - 46; i++) {
    if (view.getUint32(pos, true) !== 0x02014B50) break;

    const compression = view.getUint16(pos + 10, true);
    const compressedSz = view.getUint32(pos + 20, true);
    const uncompressedSz = view.getUint32(pos + 24, true);
    const fileNameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    let localOffset = view.getUint32(pos + 42, true);

    const name = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes.slice(pos + 46, pos + 46 + fileNameLen));

    if (localOffset === 0xFFFFFFFF) {
      let ePos = pos + 46 + fileNameLen;
      const eEnd = ePos + extraLen;
      while (ePos < eEnd - 4) {
        const eId = view.getUint16(ePos, true);
        const eSz = view.getUint16(ePos + 2, true);
        if (eId === 0x0001 && eSz >= 24) {
          localOffset = Number(view.getBigUint64(ePos + 20, true));
          break;
        }
        ePos += 4 + eSz;
      }
    }

    const ext = name.toLowerCase().split(".").pop();
    if (["shp", "dbf", "prj"].includes(ext) && !name.endsWith("/") && !entries[ext]) {
      entries[ext] = { name, compression, compressedSz, uncompressedSz, localOffset };
    }

    pos += 46 + fileNameLen + extraLen + commentLen;
  }

  const result = { shp: null, dbf: null, prj: null };

  for (const ext of ["shp", "dbf", "prj"]) {
    const entry = entries[ext];
    if (!entry) continue;

    const lhOffset = entry.localOffset;
    const lhFileLen = view.getUint16(lhOffset + 26, true);
    const lhExtraLen = view.getUint16(lhOffset + 28, true);
    const dataOffset = lhOffset + 30 + lhFileLen + lhExtraLen;
    const compData = bytes.slice(dataOffset, dataOffset + entry.compressedSz);

    let rawBytes;
    if (entry.compression === 0) {
      rawBytes = compData;
    } else if (entry.compression === 8) {
      rawBytes = await decompressDeflate(compData);
    } else {
      console.warn(`[ShapefileLoader] Unsupported compression ${entry.compression} for .${ext}`);
      continue;
    }

    if (ext === "prj") {
      result.prj = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);
    } else {
      result[ext] = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
    }
  }

  return result;
}

async function decompressDeflate(compressedBytes) {
  if (typeof DecompressionStream !== "undefined") {
    try {
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(compressedBytes);
      writer.close();
      const chunks = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); total += value.length;
      }
      const out = new Uint8Array(total); let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return out;
    } catch (e) { console.warn("[ShapefileLoader] DecompressionStream failed:", e.message); }
  }
  try {
    const pako = await import("pako");
    return pako.inflateRaw(compressedBytes);
  } catch (_) {}
  throw new Error("No decompression method available");
}

/* ── FIXED: parseShapefile with safe ESM/CJS interop ────────────────────── */
async function parseShapefile(shpBuffer, dbfBuffer) {
  let openFn;

  try {
    const mod = await import("shapefile");

    // Resolve the actual module regardless of ESM/CJS bundling
    const resolved = mod?.default ?? mod;

    // Try to get shapefile.open
    openFn =
      typeof resolved.open === "function"
        ? resolved.open.bind(resolved)
        : null;

    // Fallback: try shapefile.read() which returns a full FeatureCollection
    if (!openFn) {
      const readFn =
        typeof resolved.read === "function"
          ? resolved.read.bind(resolved)
          : null;

      if (readFn) {
        console.warn(
          "[ShapefileLoader] shapefile.open not found — falling back to shapefile.read()"
        );
        const collection = await (dbfBuffer
          ? readFn(shpBuffer, dbfBuffer)
          : readFn(shpBuffer));
        return (collection?.features || []).filter((f) => f?.geometry);
      }

      // Nothing worked
      throw new Error(
        `The 'shapefile' package API is incompatible with this build.\n\n` +
        `Fix: npm install shapefile@0.6.6`
      );
    }
  } catch (importErr) {
    // Re-throw our own errors; wrap import failures
    if (
      importErr.message.includes("shapefile") ||
      importErr.message.includes("incompatible")
    ) {
      throw importErr;
    }
    throw new Error(
      `The 'shapefile' package is not installed.\n\nRun: npm install shapefile`
    );
  }

  // Normal path: shapefile.open() stream API
  const features = [];
  const source = await (dbfBuffer
    ? openFn(shpBuffer, dbfBuffer)
    : openFn(shpBuffer));

  let result = await source.read();
  while (!result.done) {
    if (result.value?.geometry) features.push(result.value);
    result = await source.read();
  }
  return features;
}

function checkProjection(prjText, fileName) {
  const wgs84 = ["WGS_1984", "WGS84", "GCS_WGS_1984", "EPSG:4326", "4326"];
  if (!wgs84.some(h => prjText.includes(h))) {
    const nameMatch = prjText.match(/^([A-Z_a-z][^"[,\]]+)/);
    alert(
      `⚠️ Projection Warning — "${fileName}"\n\n` +
      `Detected: ${nameMatch ? nameMatch[1].trim() : "Unknown"}\n` +
      `Expected: WGS84 (EPSG:4326)\n\n` +
      `Features may appear in the wrong location.\n` +
      `To fix in QGIS: Layer → Export → Save Features As → CRS: EPSG:4326`
    );
  }
}

async function renderOnMap(fc, m, layerRef, onDone, onCount, featureCount) {
  if (!m) { onDone?.(); return; }

  const layer = L.geoJSON(fc, {
    style: (feature) => {
      const t = feature?.geometry?.type || "";
      if (t === "Polygon" || t === "MultiPolygon") return POLYGON_STYLE;
      if (t === "LineString" || t === "MultiLineString") return LINE_STYLE;
      return {};
    },
    pointToLayer: (feature, latlng) => {
      const p = feature.properties || {};
      const label = escHtml(p.name || p.Name || p.NAME || p.label || p.LABEL || "");
      const marker = L.circleMarker(latlng, POINT_STYLE);
      if (label) marker.bindTooltip(label, { permanent: false, direction: "top" });
      return marker;
    },
    onEachFeature: (feature, lyr) => {
      const p = feature.properties || {};
      const title = escHtml(p.name || p.Name || p.NAME || p.id || p.ID || "Feature");
      const rows = Object.entries(p)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .slice(0, 12)
        .map(([k, v]) => `
          <tr>
            <td style="font-weight:700;color:#7c3aed;padding:3px 10px 3px 0;
              font-size:11px;text-transform:uppercase;white-space:nowrap;
              border-right:1px solid rgba(167,139,250,0.15)">
              ${escHtml(k)}
            </td>
            <td style="color:#1e1b4b;padding:3px 0 3px 10px;font-size:12px;
              word-break:break-word">
              ${escHtml(String(v))}
            </td>
          </tr>`
        ).join("");

      const isPoint = feature.geometry?.type === "Point";
      const coords = feature.geometry?.coordinates;
      const coordRow = (isPoint && coords?.length >= 2) ? `
        <tr>
          <td style="font-weight:700;color:#7c3aed;padding:3px 10px 3px 0;
            font-size:11px;text-transform:uppercase;
            border-right:1px solid rgba(167,139,250,0.15)">Location</td>
          <td style="color:#1e1b4b;font-size:12px;padding:3px 0 3px 10px">
            ${Math.abs(coords[1]).toFixed(6)}°${coords[1] < 0 ? "S" : "N"}&nbsp;
            ${Math.abs(coords[0]).toFixed(6)}°${coords[0] < 0 ? "W" : "E"}
          </td>
        </tr>` : "";

      lyr.bindPopup(`
        <div style="font-family:sans-serif;min-width:180px;max-width:300px">
          <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed);color:#ede9fe;
            padding:8px 14px;margin:-13px -20px 10px;font-weight:800;font-size:13px;
            border-radius:4px 4px 0 0">🗺 ${title}</div>
          ${(rows || coordRow)
            ? `<table style="border-collapse:collapse;width:100%">${rows}${coordRow}</table>`
            : `<div style="color:#888;font-size:12px;font-style:italic">No attributes</div>`
          }
        </div>`,
        { maxWidth: 320 }
      );
    },
  });

  layer.addTo(m);
  layerRef.current = layer;

  const bounds = computeBounds(fc);
  if (bounds && bounds.isValid()) {
    const isSinglePoint =
      fc.features.length === 1 && fc.features[0]?.geometry?.type === "Point";
    if (isSinglePoint) {
      const c = fc.features[0].geometry.coordinates;
      m.setView([c[1], c[0]], 16, { animate: false });
    } else {
      m.fitBounds(bounds, { padding: [50, 50], maxZoom: 18, animate: false });
    }
  }

  reEnableHandlers(m);
  forceUnlock(m);
  onCount?.(featureCount);
  console.log(`[ShapefileLoader] ✅ Done — ${featureCount} features`);
  onDone?.();
}

function computeBounds(fc) {
  const pts = [];
  const walk = (geom) => {
    if (!geom) return;
    switch (geom.type) {
      case "Point": if (geom.coordinates?.length >= 2) pts.push([geom.coordinates[1], geom.coordinates[0]]); break;
      case "MultiPoint": case "LineString": (geom.coordinates || []).forEach(c => { if (c?.length >= 2) pts.push([c[1], c[0]]); }); break;
      case "MultiLineString": case "Polygon": (geom.coordinates || []).forEach(r => (r || []).forEach(c => { if (c?.length >= 2) pts.push([c[1], c[0]]); })); break;
      case "MultiPolygon": (geom.coordinates || []).forEach(p => (p || []).forEach(r => (r || []).forEach(c => { if (c?.length >= 2) pts.push([c[1], c[0]]); }))); break;
      case "GeometryCollection": (geom.geometries || []).forEach(walk); break;
      default: break;
    }
  };
  (fc.features || []).forEach(f => { if (f?.geometry) walk(f.geometry); });
  if (pts.length === 0) return null;
  try { const b = L.latLngBounds(pts); return b.isValid() ? b : null; } catch (_) { return null; }
}

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