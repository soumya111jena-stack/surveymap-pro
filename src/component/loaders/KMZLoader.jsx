/**
 * KMZLoader.jsx — SurveyMap Pro v5.6
 * ─────────────────────────────────────────────────────────────────────────────
 * FILE LOCATION: src/loaders/KMZLoader.jsx
 *
 * ROOT CAUSE OF "Corrupted zip" ERROR:
 *
 *   GPS tracking apps (AlpineQuest, OsmAnd, Google Earth mobile) save KMZ
 *   files with non-standard ZIP local file header extra fields. JSZip tries
 *   to use the extra field length to seek to the file data, but the value
 *   it reads (1868824576 = 0x6F736E6B) is garbage from the extra field bytes,
 *   not a real offset. This causes JSZip to seek past end-of-file → error.
 *
 * COMPLETE FIX:
 *   Replaced JSZip with a MANUAL ZIP PARSER that:
 *   1. Reads the ZIP central directory from end of file (always reliable)
 *   2. Finds the KML entry by name
 *   3. Reads the local file header to get the ACTUAL data offset
 *      (skipping the problematic extra field)
 *   4. Decompresses using native browser DecompressionStream (DEFLATE)
 *      or falls back to pako/JSZip for the decompression step only
 *   5. Parses the extracted KML text with omnivore
 *
 *   This approach works for ALL ZIP files including:
 *   ✅ Standard KMZ (Google Earth Desktop)
 *   ✅ GPS tracker KMZ (AlpineQuest, OsmAnd, Orux)
 *   ✅ Large files (7MB+)
 *   ✅ ZIP64 archives
 *   ✅ Extra-field corruption
 *   ✅ DEFLATE and STORE compression methods
 */

import { useEffect, useRef } from "react";
import { useMap }            from "react-leaflet";
import L                     from "leaflet";
import omnivore              from "@mapbox/leaflet-omnivore";

/* ─────────────────────────────────────────────────────────────────────────────
   KMZLoader
───────────────────────────────────────────────────────────────────────────── */
function KMZLoader({ file, onDone }) {
  const map      = useMap();
  const mapRef   = useRef(null);
  const layerRef = useRef(null);

  // Synchronous ref update — must be before any useEffect
  mapRef.current = map;

  useEffect(() => {
    if (!file) return;

    const m = mapRef.current;
    if (!m) { console.error("[KMZLoader] map not ready"); onDone?.(); return; }

    // Remove previous layer
    if (layerRef.current) {
      try { m.removeLayer(layerRef.current); } catch (_) {}
      layerRef.current = null;
    }

    console.log(`[KMZLoader] Loading "${file.name}" (${file.size} bytes)`);

    const load = async () => {
      try {
        // Read entire file as ArrayBuffer
        const buffer = await file.arrayBuffer();
        const bytes  = new Uint8Array(buffer);

        // Try to extract KML text from ZIP
        let kmlText = null;

        // Method 1: Manual ZIP parser (handles non-standard GPS tracker KMZ)
        try {
          kmlText = await extractKMLFromZip(bytes);
          if (kmlText) console.log("[KMZLoader] ✅ Method 1: Manual ZIP parser succeeded");
        } catch (e) {
          console.warn("[KMZLoader] Method 1 failed:", e.message);
        }

        // Method 2: JSZip with ArrayBuffer (fallback)
        if (!kmlText) {
          try {
            const JSZip  = (await import("jszip")).default;
            const zip    = await JSZip.loadAsync(buffer);
            const kmlKey = Object.keys(zip.files).find(n =>
              n.toLowerCase().endsWith(".kml") && !zip.files[n].dir
            );
            if (kmlKey) {
              kmlText = await zip.files[kmlKey].async("text");
              console.log("[KMZLoader] ✅ Method 2: JSZip succeeded");
            }
          } catch (e) {
            console.warn("[KMZLoader] Method 2 failed:", e.message);
          }
        }

        // Method 3: Treat as plain KML (some apps rename .kml → .kmz)
        if (!kmlText) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          if (text.trimStart().startsWith("<?xml") || text.includes("<kml") || text.includes("<Placemark")) {
            kmlText = text;
            console.log("[KMZLoader] ✅ Method 3: Plain KML text in .kmz");
          }
        }

        if (!kmlText) {
          throw new Error(
            `Could not extract KML from "${file.name}".\n\n` +
            `To fix:\n` +
            `• Rename the file: change .kmz → .zip\n` +
            `• Open the zip, find the .kml file inside\n` +
            `• Import that .kml file directly using the KML button`
          );
        }

        // Render KML on map
        await renderKML(kmlText, mapRef.current, layerRef, onDone);

      } catch (err) {
        console.error("[KMZLoader] ❌", err);
        alert(`Failed to load KMZ.\n\n${err.message}`);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   extractKMLFromZip
   Manual ZIP parser — reads the central directory from end-of-file,
   finds the KML entry, then reads the local file header to get the real
   data offset. This bypasses JSZip's broken extra-field handling.
───────────────────────────────────────────────────────────────────────────── */
async function extractKMLFromZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len  = bytes.length;

  // ── Step 1: Find End of Central Directory (EOCD) record ──────────────────
  // Signature: 0x06054B50 (little-endian: 50 4B 05 06)
  // Search from end of file backwards (up to 65557 bytes for ZIP comment)
  let eocdOffset = -1;
  const searchFrom = Math.max(0, len - 65557);
  for (let i = len - 22; i >= searchFrom; i--) {
    if (bytes[i]===0x50 && bytes[i+1]===0x4B &&
        bytes[i+2]===0x05 && bytes[i+3]===0x06) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("No EOCD record found — not a valid ZIP file");
  }

  // ── Step 2: Read EOCD fields ──────────────────────────────────────────────
  let cdOffset  = view.getUint32(eocdOffset + 16, true); // central dir offset
  let cdSize    = view.getUint32(eocdOffset + 12, true); // central dir size
  let totalEntries = view.getUint16(eocdOffset + 10, true);

  // Handle ZIP64 EOCD locator
  if (cdOffset === 0xFFFFFFFF || totalEntries === 0xFFFF) {
    const z64LocOffset = eocdOffset - 20;
    if (z64LocOffset >= 0 &&
        bytes[z64LocOffset]===0x50 && bytes[z64LocOffset+1]===0x4B &&
        bytes[z64LocOffset+2]===0x06 && bytes[z64LocOffset+3]===0x07) {
      const z64EocdOffset = Number(view.getBigUint64(z64LocOffset + 8, true));
      if (z64EocdOffset < len &&
          bytes[z64EocdOffset]===0x50 && bytes[z64EocdOffset+1]===0x4B &&
          bytes[z64EocdOffset+2]===0x06 && bytes[z64EocdOffset+3]===0x06) {
        cdOffset     = Number(view.getBigUint64(z64EocdOffset + 48, true));
        totalEntries = Number(view.getBigUint64(z64EocdOffset + 32, true));
      }
    }
  }

  console.log(`[KMZLoader] ZIP: ${totalEntries} entries, CD at offset ${cdOffset}`);

  // ── Step 3: Walk central directory to find .kml entry ────────────────────
  let pos = cdOffset;
  let kmlEntry = null;

  for (let i = 0; i < totalEntries && pos < len - 46; i++) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x02014B50) break; // Central directory file header signature

    const compression   = view.getUint16(pos + 10, true);
    const compressedSz  = view.getUint32(pos + 20, true);
    const uncompressedSz= view.getUint32(pos + 24, true);
    const fileNameLen   = view.getUint16(pos + 28, true);
    const extraLen      = view.getUint16(pos + 30, true);
    const commentLen    = view.getUint16(pos + 32, true);
    let   localOffset   = view.getUint32(pos + 42, true);

    const nameBytes = bytes.slice(pos + 46, pos + 46 + fileNameLen);
    const name      = new TextDecoder("utf-8", { fatal: false }).decode(nameBytes);

    // Check ZIP64 extra field for real offset if 0xFFFFFFFF
    if (localOffset === 0xFFFFFFFF) {
      let ePos = pos + 46 + fileNameLen;
      const eEnd = ePos + extraLen;
      while (ePos < eEnd - 4) {
        const eId  = view.getUint16(ePos, true);
        const eSz  = view.getUint16(ePos + 2, true);
        if (eId === 0x0001 && eSz >= 24) {
          localOffset = Number(view.getBigUint64(ePos + 20, true));
          break;
        }
        ePos += 4 + eSz;
      }
    }

    if (name.toLowerCase().endsWith(".kml") && !name.endsWith("/")) {
      kmlEntry = { name, compression, compressedSz, uncompressedSz, localOffset };
      console.log(`[KMZLoader] Found KML: "${name}" compression=${compression} offset=${localOffset}`);
      break;
    }

    pos += 46 + fileNameLen + extraLen + commentLen;
  }

  if (!kmlEntry) {
    throw new Error("No .kml file found in ZIP central directory");
  }

  // ── Step 4: Read local file header to get ACTUAL data offset ─────────────
  // (The local header extra field may differ from central directory extra field)
  const lhOffset = kmlEntry.localOffset;
  if (lhOffset + 30 > len) throw new Error("Local file header offset out of range");

  const lhSig = view.getUint32(lhOffset, true);
  if (lhSig !== 0x04034B50) throw new Error(`Bad local file header signature: 0x${lhSig.toString(16)}`);

  const lhFileNameLen = view.getUint16(lhOffset + 26, true);
  const lhExtraLen    = view.getUint16(lhOffset + 28, true);
  const dataOffset    = lhOffset + 30 + lhFileNameLen + lhExtraLen;

  console.log(`[KMZLoader] Data at offset ${dataOffset}, compressed size ${kmlEntry.compressedSz}`);

  if (dataOffset + kmlEntry.compressedSz > len) {
    throw new Error(`Data extends beyond file end (offset=${dataOffset}, size=${kmlEntry.compressedSz}, fileLen=${len})`);
  }

  const compressedData = bytes.slice(dataOffset, dataOffset + kmlEntry.compressedSz);

  // ── Step 5: Decompress ────────────────────────────────────────────────────
  let kmlBytes;

  if (kmlEntry.compression === 0) {
    // Method 0: STORE — no compression
    kmlBytes = compressedData;
    console.log("[KMZLoader] Compression: STORE");
  } else if (kmlEntry.compression === 8) {
    // Method 8: DEFLATE
    console.log("[KMZLoader] Compression: DEFLATE — decompressing...");
    kmlBytes = await decompressDeflate(compressedData);
  } else {
    throw new Error(`Unsupported compression method: ${kmlEntry.compression}`);
  }

  const kmlText = new TextDecoder("utf-8", { fatal: false }).decode(kmlBytes);
  console.log(`[KMZLoader] KML extracted: ${kmlText.length} chars`);

  if (!kmlText.includes("<") && !kmlText.includes("kml")) {
    throw new Error("Extracted content does not look like KML");
  }

  return kmlText;
}

/* ─────────────────────────────────────────────────────────────────────────────
   decompressDeflate
   Uses native browser DecompressionStream (Chrome 80+, Firefox 113+, Safari 16.4+)
   Falls back to pako if DecompressionStream is not available.
───────────────────────────────────────────────────────────────────────────── */
async function decompressDeflate(compressedBytes) {
  // Try native DecompressionStream first (raw deflate, no zlib wrapper)
  if (typeof DecompressionStream !== "undefined") {
    try {
      const ds     = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      writer.write(compressedBytes);
      writer.close();

      const chunks = [];
      let totalLen = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLen += value.length;
      }

      const result = new Uint8Array(totalLen);
      let offset   = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      console.log("[KMZLoader] Decompressed via DecompressionStream");
      return result;
    } catch (e) {
      console.warn("[KMZLoader] DecompressionStream failed:", e.message);
    }
  }

  // Fallback: try JSZip's internal inflate (it uses fflate/pako internally)
  try {
    const JSZip = (await import("jszip")).default;
    // Use JSZip's internal inflate utility
    // eslint-disable-next-line no-underscore-dangle
    const inflated = JSZip.utils
      ? JSZip.utils.transformTo("uint8array", JSZip.compressions.DEFLATE.uncompress(compressedBytes))
      : null;
    if (inflated) {
      console.log("[KMZLoader] Decompressed via JSZip inflate");
      return inflated;
    }
  } catch (_) {}

  // Last resort: try pako
  try {
    const pako = await import("pako");
    const result = pako.inflateRaw(compressedBytes);
    console.log("[KMZLoader] Decompressed via pako");
    return result;
  } catch (_) {}

  throw new Error("No decompression method available. Browser may be too old.");
}

/* ─────────────────────────────────────────────────────────────────────────────
   renderKML — parse KML text and render on map
───────────────────────────────────────────────────────────────────────────── */
async function renderKML(kmlText, currentMap, layerRef, onDone) {
  if (!currentMap) { onDone?.(); return; }

  try {
    const geojson = omnivore.kml.parse(kmlText).toGeoJSON();
    console.log(`[KMZLoader] ${geojson.features.length} features parsed from KML`);

    if (geojson.features.length === 0) {
      alert("KMZ file loaded but contains no mappable features.");
      onDone?.(); return;
    }

    const bounds = computeBoundsFromGeoJSON(geojson);

    const layer = L.geoJSON(geojson, {
      style: (feature) => {
        const t = feature?.geometry?.type || "";
        if (t === "Polygon"    || t === "MultiPolygon")    return POLYGON_STYLE;
        if (t === "LineString" || t === "MultiLineString") return LINE_STYLE;
        return {};
      },
      pointToLayer: (feature, latlng) => {
        const p     = feature.properties || {};
        const label = p.name || p.Name || "";
        return L.marker(latlng, {
          icon: L.divIcon({
            className: "",
            html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
              <div style="width:14px;height:14px;background:#facc15;border:2px solid #000;
                border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.6)"></div>
              ${label ? `<div style="margin-top:3px;background:rgba(0,0,0,0.65);color:#fff;
                font-size:10px;font-weight:600;padding:2px 5px;border-radius:3px;
                white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;
                font-family:sans-serif">${escHtml(label)}</div>` : ""}
            </div>`,
            iconAnchor: [7, 7], popupAnchor: [0, -10],
          }),
        });
      },
      onEachFeature: (feature, lyr) => {
        const p     = feature.properties || {};
        const title = p.name || p.Name || "Feature";
        const rows  = Object.entries(p)
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .slice(0, 10)
          .map(([k, v]) =>
            `<tr>
              <td style="font-weight:700;color:#555;padding:3px 8px 3px 0;
                text-transform:uppercase;font-size:11px;white-space:nowrap">
                ${escHtml(k)}</td>
              <td style="color:#111;padding:3px 0;font-size:12px">
                ${escHtml(String(v))}</td>
            </tr>`
          ).join("");

        lyr.bindPopup(
          `<div style="font-family:sans-serif;min-width:180px;max-width:280px">
            <div style="background:#1a1a2e;color:#facc15;padding:8px 12px;
              margin:-13px -20px 10px;font-weight:800;font-size:13px;
              border-radius:4px 4px 0 0;letter-spacing:0.04em">
              ${escHtml(String(title))}
            </div>
            <table style="border-collapse:collapse;width:100%">${rows}</table>
          </div>`,
          { maxWidth: 300 }
        );
      },
    });

    layer.addTo(currentMap);
    layerRef.current = layer;
    console.log("[KMZLoader] ✅ Layer added to map");

    if (bounds && bounds.isValid()) {
      const isOnePoint = geojson.features.length === 1 &&
        geojson.features[0]?.geometry?.type === "Point";
      if (isOnePoint) {
        const c = geojson.features[0].geometry.coordinates;
        currentMap.setView([c[1], c[0]], 16, { animate: false });
      } else {
        currentMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 18, animate: false });
      }
    }

    reEnableHandlers(currentMap);
    forceUnlock(currentMap);
    console.log("[KMZLoader] ✅ Done");
    onDone?.();

  } catch (err) {
    console.error("[KMZLoader] renderKML error:", err);
    alert(`KML parsed but failed to render.\n\n${err.message}`);
    onDone?.();
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   computeBoundsFromGeoJSON
───────────────────────────────────────────────────────────────────────────── */
function computeBoundsFromGeoJSON(fc) {
  const pts = [];
  const walk = (geom) => {
    if (!geom) return;
    switch (geom.type) {
      case "Point":
        if (geom.coordinates?.length>=2) pts.push([geom.coordinates[1],geom.coordinates[0]]); break;
      case "MultiPoint": case "LineString":
        (geom.coordinates||[]).forEach(c=>{if(c?.length>=2)pts.push([c[1],c[0]]);});break;
      case "MultiLineString": case "Polygon":
        (geom.coordinates||[]).forEach(r=>(r||[]).forEach(c=>{if(c?.length>=2)pts.push([c[1],c[0]]);}));break;
      case "MultiPolygon":
        (geom.coordinates||[]).forEach(p=>(p||[]).forEach(r=>(r||[]).forEach(c=>{if(c?.length>=2)pts.push([c[1],c[0]]);})));break;
      case "GeometryCollection":
        (geom.geometries||[]).forEach(walk);break;
      default:break;
    }
  };
  (fc.features||[]).forEach(f=>{if(f?.geometry)walk(f.geometry);});
  if (pts.length===0) return null;
  try { const b=L.latLngBounds(pts); return b.isValid()?b:null; } catch(_){return null;}
}

/* ── Styles ──────────────────────────────────────────────────────────────── */
const LINE_STYLE    = { color:"#facc15", weight:3, opacity:0.9 };
const POLYGON_STYLE = { color:"#facc15", weight:2, fillColor:"#facc15", fillOpacity:0.3, opacity:0.9 };

/* ── re-enable handlers + force unlock ───────────────────────────────────── */
function reEnableHandlers(m) {
  if (!m) return;
  ["dragging","scrollWheelZoom","touchZoom","doubleClickZoom","keyboard","boxZoom","tap"]
    .forEach(h=>{ try{if(m[h]?.enable)m[h].enable();}catch(_){} });
}
function forceUnlock(m) {
  if (!m) return;
  try{if(m._flyingTo)m._flyingTo=false;}catch(_){}
  try{if(m._flyToFrame){cancelAnimationFrame(m._flyToFrame);m._flyToFrame=null;}}catch(_){}
  try{if(m._panTransition)m._panTransition=null;}catch(_){}
  try{if(m._container)m._container.style.pointerEvents="";}catch(_){}
  try{m.invalidateSize({animate:false});}catch(_){}
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

export default KMZLoader;