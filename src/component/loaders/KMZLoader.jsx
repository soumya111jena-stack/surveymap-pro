/**
 * KMZLoader.jsx — SurveyMap Pro v5.8 (FIXED)
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES:
 *  1. Layer cleanup on file=null — when parent removes the file, layer is
 *     removed from map immediately
 *  2. mapRef always kept current without double useMap() calls
 *  3. fitBounds always animate:false, always followed by reEnableHandlers
 *  4. Robust KML extraction — 3-method fallback chain preserved
 *  5. All popup content HTML-escaped
 *  6. onDone() always called on all code paths
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import omnivore from "@mapbox/leaflet-omnivore";

export default function KMZLoader({ file, onDone }) {
  const map = useMap();
  const mapRef = useRef(map);
  const layerRef = useRef(null);

  mapRef.current = map;

  useEffect(() => {
    const m = mapRef.current;

    // ── File removed — clean up map layer ──────────────────────────────
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

    console.log(`[KMZLoader] Loading "${file.name}" (${file.size} bytes)`);

    const load = async () => {
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        let kmlText = null;

        // Method 1: Manual ZIP parser (handles non-standard GPS tracker KMZ)
        try {
          kmlText = await extractKMLFromZip(bytes);
          if (kmlText) console.log("[KMZLoader] ✅ Method 1: Manual ZIP parser");
        } catch (e) {
          console.warn("[KMZLoader] Method 1 failed:", e.message);
        }

        // Method 2: JSZip fallback
        if (!kmlText) {
          try {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(buffer);
            const kmlKey = Object.keys(zip.files).find(n =>
              n.toLowerCase().endsWith(".kml") && !zip.files[n].dir
            );
            if (kmlKey) {
              kmlText = await zip.files[kmlKey].async("text");
              console.log("[KMZLoader] ✅ Method 2: JSZip");
            }
          } catch (e) {
            console.warn("[KMZLoader] Method 2 failed:", e.message);
          }
        }

        // Method 3: File might actually be a plain KML renamed to .kmz
        if (!kmlText) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          if (text.trimStart().startsWith("<?xml") || text.includes("<kml") || text.includes("<Placemark")) {
            kmlText = text;
            console.log("[KMZLoader] ✅ Method 3: Plain KML inside .kmz");
          }
        }

        if (!kmlText) {
          throw new Error(
            `Could not extract KML from "${file.name}".\n\n` +
            `Try:\n` +
            `• Rename file: change .kmz → .zip\n` +
            `• Open the zip and find the .kml file inside\n` +
            `• Import that .kml file directly`
          );
        }

        await renderKML(kmlText, mapRef.current, layerRef, onDone);

      } catch (err) {
        console.error("[KMZLoader] ❌", err);
        alert(`Failed to load KMZ file.\n\n${err.message}`);
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
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   extractKMLFromZip — reads ZIP central directory to find .kml entry
───────────────────────────────────────────────────────────────────────────── */
async function extractKMLFromZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.length;

  // Find EOCD (End of Central Directory)
  let eocdOffset = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4B &&
        bytes[i+2] === 0x05 && bytes[i+3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Not a valid ZIP file (no EOCD)");

  let cdOffset = view.getUint32(eocdOffset + 16, true);
  let totalEntries = view.getUint16(eocdOffset + 10, true);

  // ZIP64 support
  if (cdOffset === 0xFFFFFFFF || totalEntries === 0xFFFF) {
    const z64Loc = eocdOffset - 20;
    if (z64Loc >= 0 &&
        bytes[z64Loc] === 0x50 && bytes[z64Loc+1] === 0x4B &&
        bytes[z64Loc+2] === 0x06 && bytes[z64Loc+3] === 0x07) {
      const z64Eocd = Number(view.getBigUint64(z64Loc + 8, true));
      if (z64Eocd < len &&
          bytes[z64Eocd] === 0x50 && bytes[z64Eocd+1] === 0x4B &&
          bytes[z64Eocd+2] === 0x06 && bytes[z64Eocd+3] === 0x06) {
        cdOffset = Number(view.getBigUint64(z64Eocd + 48, true));
        totalEntries = Number(view.getBigUint64(z64Eocd + 32, true));
      }
    }
  }

  let pos = cdOffset;
  let kmlEntry = null;

  for (let i = 0; i < totalEntries && pos < len - 46; i++) {
    if (view.getUint32(pos, true) !== 0x02014B50) break;

    const compression = view.getUint16(pos + 10, true);
    const compressedSz = view.getUint32(pos + 20, true);
    const uncompressedSz = view.getUint32(pos + 24, true);
    const fileNameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    let localOffset = view.getUint32(pos + 42, true);

    const nameBytes = bytes.slice(pos + 46, pos + 46 + fileNameLen);
    const name = new TextDecoder("utf-8", { fatal: false }).decode(nameBytes);

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

    if (name.toLowerCase().endsWith(".kml") && !name.endsWith("/")) {
      kmlEntry = { name, compression, compressedSz, uncompressedSz, localOffset };
      break;
    }

    pos += 46 + fileNameLen + extraLen + commentLen;
  }

  if (!kmlEntry) throw new Error("No .kml file found in ZIP");

  const lhOffset = kmlEntry.localOffset;
  if (lhOffset + 30 > len) throw new Error("Local file header offset out of range");

  const lhSig = view.getUint32(lhOffset, true);
  if (lhSig !== 0x04034B50) throw new Error(`Bad local file header signature`);

  const lhFileNameLen = view.getUint16(lhOffset + 26, true);
  const lhExtraLen = view.getUint16(lhOffset + 28, true);
  const dataOffset = lhOffset + 30 + lhFileNameLen + lhExtraLen;

  if (dataOffset + kmlEntry.compressedSz > len) {
    throw new Error("Compressed data extends beyond file end");
  }

  const compressedData = bytes.slice(dataOffset, dataOffset + kmlEntry.compressedSz);

  let kmlBytes;
  if (kmlEntry.compression === 0) {
    kmlBytes = compressedData;
  } else if (kmlEntry.compression === 8) {
    kmlBytes = await decompressDeflate(compressedData);
  } else {
    throw new Error(`Unsupported compression method: ${kmlEntry.compression}`);
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(kmlBytes);
}

/* ─────────────────────────────────────────────────────────────────────────────
   decompressDeflate
───────────────────────────────────────────────────────────────────────────── */
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
    } catch (e) {
      console.warn("[KMZLoader] DecompressionStream failed:", e.message);
    }
  }
  try {
    const pako = await import("pako");
    return pako.inflateRaw(compressedBytes);
  } catch (_) {}
  throw new Error("No decompression method available");
}

/* ─────────────────────────────────────────────────────────────────────────────
   renderKML — parse KML text and add layer to map
───────────────────────────────────────────────────────────────────────────── */
async function renderKML(kmlText, m, layerRef, onDone) {
  if (!m) { onDone?.(); return; }

  try {
    const geojson = omnivore.kml.parse(kmlText).toGeoJSON();
    console.log(`[KMZLoader] ${geojson.features.length} features`);

    if (geojson.features.length === 0) {
      alert("KMZ loaded but contains no mappable features.");
      onDone?.();
      return;
    }

    const bounds = computeBounds(geojson);

    const layer = L.geoJSON(geojson, {
      style: (feature) => {
        const t = feature?.geometry?.type || "";
        if (t === "Polygon" || t === "MultiPolygon") return POLYGON_STYLE;
        if (t === "LineString" || t === "MultiLineString") return LINE_STYLE;
        return {};
      },
      pointToLayer: (feature, latlng) => {
        const label = escHtml(feature.properties?.name || feature.properties?.Name || "");
        return L.marker(latlng, {
          icon: L.divIcon({
            className: "",
            html: `
              <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
                <div style="width:14px;height:14px;background:#facc15;border:2px solid #000;
                  border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.6)"></div>
                ${label ? `<div style="margin-top:3px;background:rgba(0,0,0,0.65);color:#fff;
                  font-size:10px;font-weight:600;padding:2px 5px;border-radius:3px;
                  white-space:nowrap;max-width:160px;overflow:hidden;
                  text-overflow:ellipsis;font-family:sans-serif">${label}</div>` : ""}
              </div>`,
            iconAnchor: [7, 7], popupAnchor: [0, -14],
          }),
        });
      },
      onEachFeature: (feature, lyr) => {
        const p = feature.properties || {};
        const title = escHtml(p.name || p.Name || "Feature");
        const rows = Object.entries(p)
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .slice(0, 10)
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
        lyr.bindPopup(`
          <div style="font-family:sans-serif;min-width:180px;max-width:280px">
            <div style="background:#1a1a2e;color:#facc15;padding:8px 12px;
              margin:-13px -20px 10px;font-weight:800;font-size:13px;
              border-radius:4px 4px 0 0">
              ${title}
            </div>
            <table style="border-collapse:collapse;width:100%">${rows}</table>
          </div>`,
          { maxWidth: 300 }
        );
      },
    }).addTo(m);

    layerRef.current = layer;

    if (bounds && bounds.isValid()) {
      const isSinglePoint =
        geojson.features.length === 1 &&
        geojson.features[0]?.geometry?.type === "Point";
      if (isSinglePoint) {
        const c = geojson.features[0].geometry.coordinates;
        m.setView([c[1], c[0]], 16, { animate: false });
      } else {
        m.fitBounds(bounds, { padding: [50, 50], maxZoom: 18, animate: false });
      }
    }

    reEnableHandlers(m);
    forceUnlock(m);
    console.log("[KMZLoader] ✅ Done");
    onDone?.();

  } catch (err) {
    console.error("[KMZLoader] renderKML error:", err);
    alert(`KML parsed but failed to render.\n\n${err.message}`);
    onDone?.();
  }
}

/* ── Styles ──────────────────────────────────────────────────────────────── */
const LINE_STYLE = { color: "#facc15", weight: 3, opacity: 0.9 };
const POLYGON_STYLE = { color: "#facc15", weight: 2, fillColor: "#facc15", fillOpacity: 0.3, opacity: 0.9 };

/* ── Helpers ─────────────────────────────────────────────────────────────── */
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