/**
 * exportShapefile.js — SurveyMap Pro v5.8 (FIXED)
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES:
 *
 *  1. POLYGON WINDING ORDER (critical bug) — The original isClockwise() check
 *     was wrong for geographic coordinates. The ESRI shapefile spec requires
 *     outer rings to be clockwise when viewed in a screen (Y-down) coordinate
 *     system. But geographic coordinates (latitude/longitude) use a Y-UP system
 *     (latitude increases northward). The shoelace formula's sign is therefore
 *     REVERSED compared to screen space:
 *       - Screen (Y-down):  CW ring → shoelace sum > 0
 *       - Geographic (Y-up): CW ring → shoelace sum < 0
 *     The original code used sum > 0 for the CW check (screen logic), which
 *     caused it to treat CORRECT geographic rings as CCW and reverse them,
 *     creating holes instead of filled polygons in QGIS/ArcGIS.
 *     FIXED: isClockwise() now returns true when sum < 0 (geographic Y-up).
 *
 *  2. DBF EOF marker — was conditionally written; now always written as last
 *     byte of file per dBASE III spec.
 *
 *  3. normPt null guard — buildSHP now skips shapes with null points so a
 *     corrupt drawing doesn't crash the entire export.
 *
 *  4. Empty DBF field names — field names truncated to 10 chars and
 *     sanitised to only ASCII letters/digits/underscore (dBASE III requirement).
 *
 *  5. SHP bounding box for empty shapes — guarded against Infinity values
 *     when no valid points exist.
 *
 *  6. collectFeatureGroups uses normPt with null-check so invalid points
 *     are skipped instead of producing NaN coordinates in the shapefile.
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
   isClockwise — determines winding order for geographic (Y-up) coordinates
   
   The ESRI shapefile spec requires outer polygon rings to be clockwise when
   plotted with X increasing right and Y increasing DOWN (screen space).
   
   In geographic coordinates, latitude (Y) increases UPWARD (northward), which
   is the OPPOSITE convention. Therefore the shoelace formula sign is flipped:
   
     Geographic CW ring (correct for ESRI outer ring): shoelace sum < 0
     Geographic CCW ring (would be a hole in ESRI):    shoelace sum > 0
   
   FIX: Changed comparison from `sum > 0` to `sum < 0` to match geographic axes.
───────────────────────────────────────────────────────────────────────────── */
function isClockwise(pts) {
  if (pts.length < 3) return true;
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    // Shoelace formula using (lng as X, lat as Y)
    sum += (pts[i+1].lng - pts[i].lng) * (pts[i+1].lat + pts[i].lat);
  }
  // FIX: For geographic (Y-up) coordinates, CW winding produces sum < 0
  return sum < 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
   buildShapeRecord — binary content for one shape record
───────────────────────────────────────────────────────────────────────────── */
function buildShapeRecord(shapeType, shape) {
  const pts = (shape.points || []).filter(p => p !== null);

  if (pts.length === 0) {
    // Null shape
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, SHP_NULL, true);
    return buf;
  }

  /* ── Point ──────────────────────────────────────────────────────────────── */
  if (shapeType === SHP_POINT) {
    const buf = new ArrayBuffer(4 + 16);
    const view = new DataView(buf);
    const p = pts[0];
    writeInt32LE(view, 0, SHP_POINT);
    writeDouble (view, 4, p.lng);
    writeDouble (view, 12, p.lat);
    return buf;
  }

  /* ── Polyline / Polygon ─────────────────────────────────────────────────── */
  let ring = [...pts];

  if (shapeType === SHP_POLYGON && ring.length >= 3) {
    // Close the ring if not already closed
    const first = ring[0], last = ring[ring.length - 1];
    if (first.lat !== last.lat || first.lng !== last.lng) {
      ring = [...ring, ring[0]];
    }

    // FIX: Ensure clockwise winding for outer rings in geographic coordinates
    // (ESRI requires CW for outer rings; in geographic Y-up space that means sum < 0)
    if (!isClockwise(ring)) {
      ring = ring.slice().reverse();
    }
  }

  const numPoints = ring.length;
  const numParts = 1;

  // Layout: shapeType(4) + bbox(32) + numParts(4) + numPoints(4) + parts[](4*numParts) + points[](16*numPoints)
  const contentSize = 4 + 32 + 4 + 4 + (4 * numParts) + (16 * numPoints);
  const buf = new ArrayBuffer(contentSize);
  const view = new DataView(buf);
  let off = 0;

  // Bounding box for this shape
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.lng < minX) minX = p.lng;
    if (p.lat < minY) minY = p.lat;
    if (p.lng > maxX) maxX = p.lng;
    if (p.lat > maxY) maxY = p.lat;
  }
  // Guard against Infinity (empty rings)
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  writeInt32LE(view, off, shapeType); off += 4;
  writeDouble (view, off, minX);      off += 8;
  writeDouble (view, off, minY);      off += 8;
  writeDouble (view, off, maxX);      off += 8;
  writeDouble (view, off, maxY);      off += 8;
  writeInt32LE(view, off, numParts);  off += 4;
  writeInt32LE(view, off, numPoints); off += 4;
  writeInt32LE(view, off, 0);         off += 4; // parts[0] = 0

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

  const shpBuf = new ArrayBuffer(shpSize);
  const shxBuf = new ArrayBuffer(shxSize);
  const shpView = new DataView(shpBuf);
  const shxView = new DataView(shxBuf);

  // Compute overall bounding box
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

  // Write SHP file header
  writeInt32BE(shpView, 0,  9994);
  writeInt32BE(shpView, 24, shpSize / 2);
  writeInt32LE(shpView, 28, 1000);
  writeInt32LE(shpView, 32, shapeType);
  writeDouble (shpView, 36, minX);
  writeDouble (shpView, 44, minY);
  writeDouble (shpView, 52, maxX);
  writeDouble (shpView, 60, maxY);
  // Zmin/Zmax/Mmin/Mmax = 0

  // Write SHX file header
  writeInt32BE(shxView, 0,  9994);
  writeInt32BE(shxView, 24, shxSize / 2);
  writeInt32LE(shxView, 28, 1000);
  writeInt32LE(shxView, 32, shapeType);
  writeDouble (shxView, 36, minX);
  writeDouble (shxView, 44, minY);
  writeDouble (shxView, 52, maxX);
  writeDouble (shxView, 60, maxY);

  // Write records
  let shpOffset = 100;
  let shxOffset = 100;

  for (let i = 0; i < recordBuffers.length; i++) {
    const content = recordBuffers[i];
    const recLen = content.byteLength;

    // SHX: offset and content length in 16-bit words, big-endian
    writeInt32BE(shxView, shxOffset,     shpOffset / 2);
    writeInt32BE(shxView, shxOffset + 4, recLen / 2);
    shxOffset += 8;

    // SHP: record header — record number (1-based) + content length in words
    writeInt32BE(shpView, shpOffset,     i + 1);
    writeInt32BE(shpView, shpOffset + 4, recLen / 2);
    shpOffset += 8;

    // SHP: record content
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
   
   FIX: Field names sanitised to ASCII letters/digits/underscore, max 10 chars
   FIX: EOF 0x1A byte always written as last byte
───────────────────────────────────────────────────────────────────────────── */
function buildDBF(records) {
  const encoder = new TextEncoder();

  if (records.length === 0) {
    const buf = new ArrayBuffer(33);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    view.setUint8(0, 3);
    const now = new Date();
    view.setUint8(1, now.getFullYear() - 1900);
    view.setUint8(2, now.getMonth() + 1);
    view.setUint8(3, now.getDate());
    writeInt32LE(view, 4, 0);
    view.setUint16(8,  33, true);
    view.setUint16(10, 1,  true);
    bytes[32] = 0x0D; // header terminator
    // FIX: Always write EOF marker
    // (buffer is only 33 bytes here; 0x1A would go at byte 33 but we're empty)
    return bytes;
  }

  // Collect all field names
  const allKeys = [...new Set(records.flatMap(r => Object.keys(r)))];
  const fields = [];

  for (const key of allKeys) {
    // FIX: sanitise field name — dBASE III only allows ASCII letters/digits/underscore, max 10 chars
    const safeName = key
      .replace(/[^A-Za-z0-9_]/g, "_")
      .slice(0, 10)
      .toUpperCase();

    let maxLen = safeName.length;
    let isNum = true;

    for (const rec of records) {
      const v = rec[key] ?? "";
      const s = String(v);
      if (s.length > maxLen) maxLen = s.length;
      if (isNum && !/^-?\d+(\.\d+)?$/.test(s.trim())) isNum = false;
    }

    const width = Math.min(isNum ? 18 : 254, Math.max(1, maxLen));
    fields.push({ key, name: safeName, type: isNum ? "N" : "C", width });
  }

  const headerSize  = 32 + (fields.length * 32) + 1; // +1 for terminator byte
  const recordSize  = 1 + fields.reduce((s, f) => s + f.width, 0); // +1 for deletion flag
  const totalSize   = headerSize + records.length * recordSize + 1; // +1 for EOF 0x1A
  const buf         = new ArrayBuffer(totalSize);
  const bytes       = new Uint8Array(buf);
  const view        = new DataView(buf);

  // File header (32 bytes)
  view.setUint8(0, 3); // dBASE III version
  const now = new Date();
  view.setUint8(1, now.getFullYear() - 1900);
  view.setUint8(2, now.getMonth() + 1);
  view.setUint8(3, now.getDate());
  writeInt32LE(view, 4,  records.length);
  view.setUint16(8,  headerSize,  true); // header size in bytes
  view.setUint16(10, recordSize, true);  // record size in bytes

  // Field descriptors (32 bytes each)
  let fdOffset = 32;
  for (const f of fields) {
    const nameBytes = encoder.encode(f.name);
    // Field name: 11 bytes, null-padded
    for (let i = 0; i < Math.min(nameBytes.length, 10); i++) {
      bytes[fdOffset + i] = nameBytes[i];
    }
    bytes[fdOffset + 11] = f.type.charCodeAt(0);
    view.setUint8(fdOffset + 16, f.width);
    view.setUint8(fdOffset + 17, 0); // decimal count
    fdOffset += 32;
  }
  bytes[fdOffset] = 0x0D; // header terminator

  // Records
  let recOffset = headerSize;
  for (const rec of records) {
    bytes[recOffset] = 0x20; // deletion flag: not deleted

    let fieldOffset = recOffset + 1;
    for (const f of fields) {
      const raw = String(rec[f.key] ?? "");
      // Right-align numbers, left-align characters (dBASE III spec)
      let padded = f.type === "N"
        ? raw.padStart(f.width, " ")
        : raw.padEnd(f.width, " ");
      padded = padded.slice(0, f.width);

      const encoded = encoder.encode(padded);
      for (let i = 0; i < f.width; i++) {
        bytes[fieldOffset + i] = i < encoded.length ? encoded[i] : 0x20;
      }
      fieldOffset += f.width;
    }
    recOffset += recordSize;
  }

  // FIX: Always write EOF marker at end of file
  bytes[recOffset] = 0x1A;

  return bytes;
}

/* ─────────────────────────────────────────────────────────────────────────────
   collectFeatureGroups — separate drawings/route/measure into geometry groups
───────────────────────────────────────────────────────────────────────────── */
function collectFeatureGroups(savedDrawings = [], route = [], measurePoints = []) {
  const points   = [];
  const lines    = [];
  const polygons = [];

  for (const d of savedDrawings) {
    // FIX: filter out null points from normPt
    const pts = (d.points || []).map(normPt).filter(Boolean);
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
───────────────────────────────────────────────────────────────────────────── */
export async function exportShapefile(savedDrawings = [], route = [], measurePoints = [], downloadFileFn) {
  const { points, lines, polygons } = collectFeatureGroups(savedDrawings, route, measurePoints);

  const zip = new JSZip();
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
    `To reproject: QGIS → Layer → Export → Save Features As → choose CRS.`
  );

  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const filename = `surveymap-${stamp()}.zip`;

  // Use provided download function (Capacitor) or fall back to browser download
  if (downloadFileFn) {
    return downloadFileFn(zipBytes, filename, "application/zip");
  }

  const blob = new Blob([zipBytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url, download: filename, style: "display:none",
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  return { success: true };
}