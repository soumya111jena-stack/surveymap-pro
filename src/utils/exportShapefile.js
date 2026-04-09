/**
 * exportShapefile.js — SurveyMap Pro v5.9
 * ─────────────────────────────────────────────────────────────────────────────
 * EXISTING FIXES (v5.8):
 *
 *  1. POLYGON WINDING ORDER — isClockwise() uses geographic Y-up convention.
 *  2. DBF EOF marker — always written as last byte (0x1A) per dBASE III spec.
 *  3. normPt null guard — shapes with null points are skipped, no crash.
 *  4. DBF field name sanitisation — ASCII only, max 10 chars, uppercase.
 *  5. SHP bounding box — guarded against Infinity for empty shapes.
 *  6. collectFeatureGroups null-check — invalid points skipped, no NaN coords.
 *
 * NEW FIXES (v5.9) — Android / Vite compatibility:
 *
 *  7. REMOVED react-native-fs / react-native-share dynamic imports entirely.
 *     Vite is a web bundler — it resolves ALL dynamic imports at build time,
 *     even those behind if-blocks or with @vite-ignore comments. Importing
 *     React Native modules inside a Vite project always throws:
 *     "Failed to resolve import react-native-fs".
 *
 *     CORRECT ARCHITECTURE:
 *       - This file is web-only. Zero React Native imports.
 *       - Android export is handled by passing androidDownload as downloadFileFn.
 *       - androidDownload lives in your RN/Capacitor layer where RNFS exists.
 *       - See usage examples at the bottom of this file.
 *
 *  8. downloadFileFn receives base64 string — RNFS.writeFile requires base64.
 *
 * Dependencies (web only): jszip
 */

import JSZip from "jszip";

/* ── WGS84 PRJ string ────────────────────────────────────────────────────── */
const WGS84_PRJ =
  `GEOGCS["GCS_WGS_1984",` +
  `DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],` +
  `PRIMEM["Greenwich",0.0],` +
  `UNIT["Degree",0.0174532925199433]]`;

/* ── Shape type constants ─────────────────────────────────────────────────── */
const SHP_NULL     = 0;
const SHP_POINT    = 1;
const SHP_POLYLINE = 3;
const SHP_POLYGON  = 5;

/* ── Timestamp ───────────────────────────────────────────────────────────── */
function stamp() {
  const d = new Date(), z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}

/* ── normPt — returns {lat,lng} or null ──────────────────────────────────── */
function normPt(p) {
  let lat, lng;
  if (Array.isArray(p)) { lat = parseFloat(p[0]); lng = parseFloat(p[1]); }
  else { lat = parseFloat(p?.lat); lng = parseFloat(p?.lng); }
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

/* ── DataView write helpers ───────────────────────────────────────────────── */
function writeInt32BE(view, offset, value) { view.setInt32(offset, value, false); }
function writeInt32LE(view, offset, value) { view.setInt32(offset, value, true); }
function writeDouble (view, offset, value) { view.setFloat64(offset, value, true); }

/* ─────────────────────────────────────────────────────────────────────────────
   isClockwise — geographic (Y-up) winding order check

   ESRI shapefile spec: outer rings must be clockwise in screen space (Y-down).
   Geographic coords use Y-up (latitude increases northward), so sign is flipped:
     Geographic CW (correct ESRI outer ring): shoelace sum < 0
     Geographic CCW (hole):                   shoelace sum > 0
───────────────────────────────────────────────────────────────────────────── */
function isClockwise(pts) {
  if (pts.length < 3) return true;
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    sum += (pts[i+1].lng - pts[i].lng) * (pts[i+1].lat + pts[i].lat);
  }
  return sum < 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
   buildShapeRecord — binary content for one shape record
───────────────────────────────────────────────────────────────────────────── */
function buildShapeRecord(shapeType, shape) {
  const pts = (shape.points || []).filter(p => p !== null);

  if (pts.length === 0) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, SHP_NULL, true);
    return buf;
  }

  if (shapeType === SHP_POINT) {
    const buf  = new ArrayBuffer(4 + 16);
    const view = new DataView(buf);
    const p    = pts[0];
    writeInt32LE(view, 0,  SHP_POINT);
    writeDouble (view, 4,  p.lng);
    writeDouble (view, 12, p.lat);
    return buf;
  }

  let ring = [...pts];

  if (shapeType === SHP_POLYGON && ring.length >= 3) {
    const first = ring[0], last = ring[ring.length - 1];
    if (first.lat !== last.lat || first.lng !== last.lng) {
      ring = [...ring, ring[0]];
    }
    if (!isClockwise(ring)) {
      ring = ring.slice().reverse();
    }
  }

  const numPoints   = ring.length;
  const numParts    = 1;
  const contentSize = 4 + 32 + 4 + 4 + (4 * numParts) + (16 * numPoints);
  const buf         = new ArrayBuffer(contentSize);
  const view        = new DataView(buf);
  let off = 0;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.lng < minX) minX = p.lng;
    if (p.lat < minY) minY = p.lat;
    if (p.lng > maxX) maxX = p.lng;
    if (p.lat > maxY) maxY = p.lat;
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  writeInt32LE(view, off, shapeType); off += 4;
  writeDouble (view, off, minX);      off += 8;
  writeDouble (view, off, minY);      off += 8;
  writeDouble (view, off, maxX);      off += 8;
  writeDouble (view, off, maxY);      off += 8;
  writeInt32LE(view, off, numParts);  off += 4;
  writeInt32LE(view, off, numPoints); off += 4;
  writeInt32LE(view, off, 0);         off += 4;

  for (const p of ring) {
    writeDouble(view, off, p.lng); off += 8;
    writeDouble(view, off, p.lat); off += 8;
  }

  return buf;
}

/* ─────────────────────────────────────────────────────────────────────────────
   buildSHP — write complete .shp and .shx binary files
───────────────────────────────────────────────────────────────────────────── */
function buildSHP(shapeType, shapes) {
  const recordBuffers = shapes.map(shape => buildShapeRecord(shapeType, shape));

  let totalContentBytes = 0;
  for (const buf of recordBuffers) totalContentBytes += 8 + buf.byteLength;

  const shpSize = 100 + totalContentBytes;
  const shxSize = 100 + shapes.length * 8;

  const shpBuf  = new ArrayBuffer(shpSize);
  const shxBuf  = new ArrayBuffer(shxSize);
  const shpView = new DataView(shpBuf);
  const shxView = new DataView(shxBuf);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    for (const p of (shape.points || [])) {
      if (!p) continue;
      if (p.lng < minX) minX = p.lng;
      if (p.lat < minY) minY = p.lat;
      if (p.lng > maxX) maxX = p.lng;
      if (p.lat > maxY) maxY = p.lat;
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  writeInt32BE(shpView, 0,  9994);
  writeInt32BE(shpView, 24, shpSize / 2);
  writeInt32LE(shpView, 28, 1000);
  writeInt32LE(shpView, 32, shapeType);
  writeDouble (shpView, 36, minX);
  writeDouble (shpView, 44, minY);
  writeDouble (shpView, 52, maxX);
  writeDouble (shpView, 60, maxY);

  writeInt32BE(shxView, 0,  9994);
  writeInt32BE(shxView, 24, shxSize / 2);
  writeInt32LE(shxView, 28, 1000);
  writeInt32LE(shxView, 32, shapeType);
  writeDouble (shxView, 36, minX);
  writeDouble (shxView, 44, minY);
  writeDouble (shxView, 52, maxX);
  writeDouble (shxView, 60, maxY);

  let shpOffset = 100;
  let shxOffset = 100;

  for (let i = 0; i < recordBuffers.length; i++) {
    const content = recordBuffers[i];
    const recLen  = content.byteLength;

    writeInt32BE(shxView, shxOffset,     shpOffset / 2);
    writeInt32BE(shxView, shxOffset + 4, recLen / 2);
    shxOffset += 8;

    writeInt32BE(shpView, shpOffset,     i + 1);
    writeInt32BE(shpView, shpOffset + 4, recLen / 2);
    shpOffset += 8;

    new Uint8Array(shpBuf).set(new Uint8Array(content), shpOffset);
    shpOffset += recLen;
  }

  return {
    shpBytes: new Uint8Array(shpBuf),
    shxBytes: new Uint8Array(shxBuf),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   buildDBF — write dBASE III .dbf binary
───────────────────────────────────────────────────────────────────────────── */
function buildDBF(records) {
  const encoder = new TextEncoder();

  if (records.length === 0) {
    const buf   = new ArrayBuffer(33);
    const view  = new DataView(buf);
    const bytes = new Uint8Array(buf);
    view.setUint8(0, 3);
    const now = new Date();
    view.setUint8(1, now.getFullYear() - 1900);
    view.setUint8(2, now.getMonth() + 1);
    view.setUint8(3, now.getDate());
    writeInt32LE(view, 4, 0);
    view.setUint16(8,  33, true);
    view.setUint16(10, 1,  true);
    bytes[32] = 0x0D;
    return bytes;
  }

  const allKeys = [...new Set(records.flatMap(r => Object.keys(r)))];
  const fields  = [];

  for (const key of allKeys) {
    const safeName = key
      .replace(/[^A-Za-z0-9_]/g, "_")
      .slice(0, 10)
      .toUpperCase();

    let maxLen = safeName.length;
    let isNum  = true;

    for (const rec of records) {
      const v = rec[key] ?? "";
      const s = String(v);
      if (s.length > maxLen) maxLen = s.length;
      if (isNum && !/^-?\d+(\.\d+)?$/.test(s.trim())) isNum = false;
    }

    const width = Math.min(isNum ? 18 : 254, Math.max(1, maxLen));
    fields.push({ key, name: safeName, type: isNum ? "N" : "C", width });
  }

  const headerSize = 32 + (fields.length * 32) + 1;
  const recordSize = 1 + fields.reduce((s, f) => s + f.width, 0);
  const totalSize  = headerSize + records.length * recordSize + 1;
  const buf        = new ArrayBuffer(totalSize);
  const bytes      = new Uint8Array(buf);
  const view       = new DataView(buf);

  view.setUint8(0, 3);
  const now = new Date();
  view.setUint8(1, now.getFullYear() - 1900);
  view.setUint8(2, now.getMonth() + 1);
  view.setUint8(3, now.getDate());
  writeInt32LE(view, 4,  records.length);
  view.setUint16(8,  headerSize, true);
  view.setUint16(10, recordSize, true);

  let fdOffset = 32;
  for (const f of fields) {
    const nameBytes = encoder.encode(f.name);
    for (let i = 0; i < Math.min(nameBytes.length, 10); i++) {
      bytes[fdOffset + i] = nameBytes[i];
    }
    bytes[fdOffset + 11] = f.type.charCodeAt(0);
    view.setUint8(fdOffset + 16, f.width);
    view.setUint8(fdOffset + 17, 0);
    fdOffset += 32;
  }
  bytes[fdOffset] = 0x0D;

  let recOffset = headerSize;
  for (const rec of records) {
    bytes[recOffset] = 0x20;
    let fieldOffset  = recOffset + 1;

    for (const f of fields) {
      const raw     = String(rec[f.key] ?? "");
      let padded    = f.type === "N"
        ? raw.padStart(f.width, " ")
        : raw.padEnd(f.width, " ");
      padded        = padded.slice(0, f.width);
      const encoded = encoder.encode(padded);
      for (let i = 0; i < f.width; i++) {
        bytes[fieldOffset + i] = i < encoded.length ? encoded[i] : 0x20;
      }
      fieldOffset += f.width;
    }
    recOffset += recordSize;
  }

  bytes[recOffset] = 0x1A; // EOF marker — always last byte
  return bytes;
}

/* ─────────────────────────────────────────────────────────────────────────────
   collectFeatureGroups
───────────────────────────────────────────────────────────────────────────── */
function collectFeatureGroups(savedDrawings = [], route = [], measurePoints = []) {
  const points   = [];
  const lines    = [];
  const polygons = [];

  for (const d of savedDrawings) {
    const pts  = (d.points || []).map(normPt).filter(Boolean);
    const name = d.name || "Drawing";

    if (d.type === "marker" && pts.length >= 1) {
      points.push({
        shape:      { points: [pts[0]] },
        attributes: { name, type: "marker" },
      });
    } else if (d.type === "path" && pts.length >= 2) {
      lines.push({
        shape:      { points: pts },
        attributes: { name, type: "path", point_count: pts.length },
      });
    } else if (d.type === "polygon" && pts.length >= 3) {
      polygons.push({
        shape:      { points: pts },
        attributes: { name, type: "polygon", point_count: pts.length },
      });
    }
  }

  if (route.length >= 2) {
    const pts = route.map(normPt).filter(Boolean);
    if (pts.length >= 2) {
      lines.push({
        shape:      { points: pts },
        attributes: { name: "Survey Route", type: "survey", point_count: pts.length },
      });
    }
  }

  if (measurePoints.length >= 2) {
    const pts = measurePoints.map(normPt).filter(Boolean);
    if (pts.length >= 2) {
      lines.push({
        shape:      { points: pts },
        attributes: { name: "Measure Line", type: "measure", point_count: pts.length },
      });
    }
  }

  return { points, lines, polygons };
}

/* ─────────────────────────────────────────────────────────────────────────────
   exportShapefile — main export entry point

   TWO-PATH STRATEGY (v5.9):

   PATH A — downloadFileFn provided → Android / Capacitor / RNFS
     Receives base64 zip string. Handler writes file + opens share sheet.
     This is the ONLY way to support Android in a Vite project.
     react-native-fs/react-native-share CANNOT be imported here.

   PATH B — no downloadFileFn → Web browser
     Generates Uint8Array zip → Blob → <a> download. Works everywhere.

   @param {Array}    savedDrawings
   @param {Array}    route
   @param {Array}    measurePoints
   @param {Function} downloadFileFn  async (base64, filename, mime) => void
───────────────────────────────────────────────────────────────────────────── */
export async function exportShapefile(
  savedDrawings  = [],
  route          = [],
  measurePoints  = [],
  downloadFileFn = null,
) {
  const { points, lines, polygons } = collectFeatureGroups(
    savedDrawings, route, measurePoints,
  );

  const zip  = new JSZip();
  let hasAny = false;

  const groups = [
    { name: "points",   shapeType: SHP_POINT,    items: points   },
    { name: "lines",    shapeType: SHP_POLYLINE,  items: lines    },
    { name: "polygons", shapeType: SHP_POLYGON,   items: polygons },
  ];

  for (const g of groups) {
    if (g.items.length === 0) continue;
    hasAny = true;

    const shapes = g.items.map(i => i.shape);
    const attrs  = g.items.map(i => i.attributes);

    const { shpBytes, shxBytes } = buildSHP(g.shapeType, shapes);
    const dbfBytes = buildDBF(attrs);

    zip.file(`${g.name}.shp`, shpBytes);
    zip.file(`${g.name}.shx`, shxBytes);
    zip.file(`${g.name}.dbf`, dbfBytes);
    zip.file(`${g.name}.prj`, WGS84_PRJ);

    console.log(`[exportShapefile] ${g.name}: ${g.items.length} feature(s)`);
  }

  if (!hasAny) {
    alert("No data to export.\n\nDraw something or record a survey route first.");
    return;
  }

  zip.file(
    "README.txt",
    `SurveyMap Pro — Shapefile Export\n` +
    `Generated: ${new Date().toISOString()}\n` +
    `Projection: WGS84 (EPSG:4326)\n\n` +
    `Files:\n` +
    groups
      .filter(g => g.items.length > 0)
      .map(g => `  ${g.name}.shp — ${g.items.length} feature(s)`)
      .join("\n") +
    `\n\nOpen in QGIS, ArcGIS, or any GIS software.\n` +
    `To reproject: QGIS → Layer → Export → Save Features As → choose CRS.`,
  );

  const filename = `surveymap-${stamp()}.zip`;

  /* ── PATH A: Android / Capacitor ─────────────────────────────────────────
     base64 output — required by RNFS.writeFile() on Android.
     Blob + URL.createObjectURL() silently fails in Android WebView / RN.    */
  if (downloadFileFn) {
    const base64 = await zip.generateAsync({
      type:        "base64",
      compression: "DEFLATE",
    });
    return downloadFileFn(base64, filename, "application/zip");
  }

  /* ── PATH B: Web browser ─────────────────────────────────────────────────
     uint8array → Blob → <a> download. Original behaviour, unchanged.        */
  const zipBytes = await zip.generateAsync({
    type:        "uint8array",
    compression: "DEFLATE",
  });

  const blob = new Blob([zipBytes], { type: "application/zip" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), {
    href:     url,
    download: filename,
    style:    "display:none",
  });

  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);

  return { success: true };
}

/* ─────────────────────────────────────────────────────────────────────────────
   USAGE EXAMPLES
─────────────────────────────────────────────────────────────────────────────

   ── Web ─────────────────────────────────────────────────────────────────────

     import { exportShapefile } from "./exportShapefile";

     await exportShapefile(savedDrawings, route, measurePoints);
     // triggers browser <a> download automatically


   ── React Native Android ─────────────────────────────────────────────────────
   ── Define androidDownload in your RN component, NOT in this file ───────────

     import { exportShapefile } from "../utils/exportShapefile";
     import RNFS from "react-native-fs";
     import Share from "react-native-share";
     import { Platform } from "react-native";

     const androidDownload = async (base64, filename, mimeType) => {
       const path = `${RNFS.CachesDirectoryPath}/${filename}`;
       await RNFS.writeFile(path, base64, "base64");
       await Share.open({
         url:          `file://${path}`,
         type:         mimeType,
         filename:     filename,
         saveToFiles:  true,
         failOnCancel: false,
       });
     };

     await exportShapefile(
       savedDrawings,
       route,
       measurePoints,
       Platform.OS === "android" ? androidDownload : null,
     );


   ── Capacitor ────────────────────────────────────────────────────────────────

     import { exportShapefile } from "../utils/exportShapefile";
     import { Filesystem, Directory } from "@capacitor/filesystem";
     import { Share } from "@capacitor/share";

     const capacitorDownload = async (base64, filename) => {
       const result = await Filesystem.writeFile({
         path:      filename,
         data:      base64,
         directory: Directory.Cache,
       });
       await Share.share({
         title:       filename,
         url:         result.uri,
         dialogTitle: "Export Shapefile",
       });
     };

     await exportShapefile(savedDrawings, route, measurePoints, capacitorDownload);

───────────────────────────────────────────────────────────────────────────── */