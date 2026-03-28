/**
 * exportDEM.js — SurveyMap Pro v5.9.1-p3
 *
 * FIXES IN THIS VERSION:
 *
 *  FIX 1 — GDAL_NODATA tag (42113) added
 *    QGIS and AlpineQuest require tag 42113 to know which value means "no data".
 *    Without it, -32767 sentinel pixels render as black/invalid instead of transparent.
 *
 *  FIX 2 — ModelPixelScaleTag Y must be POSITIVE
 *    GeoTIFF spec §2.6.1: ModelPixelScaleTag = [ScaleX, ScaleY, ScaleZ]
 *    ScaleY is always stored as a positive number. The north-to-south
 *    scan direction is implied by the tiepoint (top-left corner).
 *    Many writers incorrectly negate it — QGIS silently accepts either,
 *    but AlpineQuest and some mobile GIS apps flip the raster upside-down
 *    when ScaleY is negative.
 *
 *  FIX 3 — GeoKeyDirectoryTag SHORT count corrected
 *    Tag 34736 count field = total number of uint16 values in the block
 *    = 4 (header) + numKeys × 4 = 4 + 2×4 = 12, not 8.
 *    This caused some parsers to truncate the key block.
 *
 *  FIX 4 — Tags written in strictly ascending order (TIFF spec requirement)
 *    Added tag 42113 (GDAL_NODATA) in correct position between 34736 and end.
 *    Some strict TIFF readers reject IFDs with out-of-order tags.
 */

/* ────────────────────────────────────────────────────────────────
   🔹 Ray-casting point-in-polygon test
──────────────────────────────────────────────────────────────── */
function isInsidePolygon(lat, lng, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect =
        ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

/* ────────────────────────────────────────────────────────────────
   🔹 Clip DEM raster to KML polygon mask
──────────────────────────────────────────────────────────────── */
function clipRasterWithMask(raster, kmlMask) {
  if (!kmlMask || kmlMask.length === 0) return raster;

  const { data, width, height, west, south, east, north } = raster;
  const clipped = new Float32Array(width * height);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const lat = north - (row / height) * (north - south);
      const lng = west  + (col / width)  * (east  - west);
      clipped[row * width + col] = isInsidePolygon(lat, lng, kmlMask)
        ? data[row * width + col]
        : NaN;
    }
  }

  return { ...raster, data: clipped };
}

/* ────────────────────────────────────────────────────────────────
   🔹 Write a spec-compliant GeoTIFF (Int16, single band, EPSG:4326)
   
   Tags written in ascending order (TIFF spec requirement):
     256   ImageWidth
     257   ImageLength
     258   BitsPerSample      = 16
     259   Compression        = 1 (none)
     262   PhotometricInterp. = 1 (BlackIsZero)
     273   StripOffsets
     278   RowsPerStrip
     279   StripByteCounts
     284   PlanarConfiguration = 1
     339   SampleFormat       = 2 (signed int)
     33550 ModelPixelScaleTag  [scaleX, +scaleY, 0]  ← Y must be POSITIVE
     33922 ModelTiepointTag    [0,0,0, west, north, 0]
     34736 GeoKeyDirectoryTag  (EPSG:4326)
     42113 GDAL_NODATA         "-32767\0"             ← required by QGIS/AlpineQuest
──────────────────────────────────────────────────────────────── */
function writeTIFF(data, width, height, west, north, pixelWidth, pixelHeight) {
  const NODATA_VALUE   = -32767;
  const NODATA_STR     = "-32767\0"; // ASCII string including null terminator
  const NODATA_BYTES   = NODATA_STR.length; // 7 bytes

  /* Convert Float32 → Int16, replacing NaN with nodata sentinel */
  const int16Data = new Int16Array(width * height);
  for (let i = 0; i < data.length; i++) {
    int16Data[i] = isNaN(data[i]) ? NODATA_VALUE : Math.round(data[i]);
  }

  /* ── Layout ──────────────────────────────────────────────────── */
  const NUM_TAGS             = 14;  // one more than before (GDAL_NODATA)
  const TIFF_HEADER          = 8;
  const IFD_SIZE             = 2 + NUM_TAGS * 12 + 4;

  // Extra-value areas (values > 4 bytes go after IFD)
  const PIXEL_SCALE_OFFSET   = TIFF_HEADER + IFD_SIZE;          // 3×f64 = 24 B
  const TIEPOINT_OFFSET      = PIXEL_SCALE_OFFSET + 24;         // 6×f64 = 48 B
  const GEOKEY_OFFSET        = TIEPOINT_OFFSET + 48;            // 12×u16 = 24 B ← FIX 3
  const NODATA_STR_OFFSET    = GEOKEY_OFFSET + 24;              // 7 bytes
  const PIXEL_DATA_OFFSET    = NODATA_STR_OFFSET + NODATA_BYTES + 
                               ((NODATA_BYTES % 2) ? 1 : 0);   // word-align
  const PIXEL_BYTES          = width * height * 2;
  const TOTAL_BYTES          = PIXEL_DATA_OFFSET + PIXEL_BYTES;

  const buf  = new ArrayBuffer(TOTAL_BYTES);
  const view = new DataView(buf);
  const LE   = true;

  /* ── TIFF header ─────────────────────────────────────────────── */
  view.setUint16(0, 0x4949, LE);   // "II" = little-endian
  view.setUint16(2, 42,     LE);   // TIFF magic
  view.setUint32(4, TIFF_HEADER, LE);

  /* ── IFD ─────────────────────────────────────────────────────── */
  let p = TIFF_HEADER;
  view.setUint16(p, NUM_TAGS, LE);
  p += 2;

  /**
   * Write one 12-byte IFD entry.
   * @param {number} tag    - TIFF tag number
   * @param {number} type   - 1=BYTE, 2=ASCII, 3=SHORT, 4=LONG, 12=DOUBLE
   * @param {number} count  - number of values
   * @param {number} value  - the value itself (if ≤4 bytes) OR offset into file
   */
  function writeTag(tag, type, count, value) {
    view.setUint16(p,     tag,   LE);
    view.setUint16(p + 2, type,  LE);
    view.setUint32(p + 4, count, LE);
    view.setUint32(p + 8, value, LE);
    p += 12;
  }

  // Tags in strictly ascending order
  writeTag(256,   4, 1,            width);
  writeTag(257,   4, 1,            height);
  writeTag(258,   3, 1,            16);                    // BitsPerSample
  writeTag(259,   3, 1,            1);                     // Compression = none
  writeTag(262,   3, 1,            1);                     // PhotometricInterp
  writeTag(273,   4, 1,            PIXEL_DATA_OFFSET);     // StripOffsets
  writeTag(278,   4, 1,            height);                // RowsPerStrip
  writeTag(279,   4, 1,            PIXEL_BYTES);           // StripByteCounts
  writeTag(284,   3, 1,            1);                     // PlanarConfiguration
  writeTag(339,   3, 1,            2);                     // SampleFormat = signed int
  writeTag(33550, 12, 3,           PIXEL_SCALE_OFFSET);    // ModelPixelScaleTag
  writeTag(33922, 12, 6,           TIEPOINT_OFFSET);       // ModelTiepointTag
  writeTag(34736, 3,  12,          GEOKEY_OFFSET);         // GeoKeyDirectoryTag ← FIX 3: count=12
  writeTag(42113, 2,  NODATA_BYTES, NODATA_STR_OFFSET);    // GDAL_NODATA ← FIX 1

  view.setUint32(p, 0, LE); // next-IFD = 0

  /* ── ModelPixelScaleTag ──────────────────────────────────────── */
  // FIX 2: ScaleY MUST be positive per GeoTIFF spec §2.6.1
  let q = PIXEL_SCALE_OFFSET;
  view.setFloat64(q,      pixelWidth,  LE);   // ScaleX (positive = east)
  view.setFloat64(q +  8, pixelHeight, LE);   // ScaleY (positive — NOT negated!)
  view.setFloat64(q + 16, 0,           LE);   // ScaleZ

  /* ── ModelTiepointTag ────────────────────────────────────────── */
  // Tiepoint: raster (col=0, row=0) ↔ geo (west, north)
  q = TIEPOINT_OFFSET;
  view.setFloat64(q,      0,     LE); // I (column index)
  view.setFloat64(q +  8, 0,     LE); // J (row index)
  view.setFloat64(q + 16, 0,     LE); // K (z)
  view.setFloat64(q + 24, west,  LE); // X = longitude of top-left
  view.setFloat64(q + 32, north, LE); // Y = latitude of top-left
  view.setFloat64(q + 40, 0,     LE); // Z

  /* ── GeoKeyDirectoryTag ──────────────────────────────────────── */
  // FIX 3: Header + 2 keys = 4+8 = 12 uint16 values (count was wrongly 8 before)
  // Layout: [version, keyRevision, minorRevision, numKeys, key1×4, key2×4]
  q = GEOKEY_OFFSET;
  view.setUint16(q,      1,    LE); // KeyDirectoryVersion = 1
  view.setUint16(q +  2, 1,    LE); // KeyRevision = 1
  view.setUint16(q +  4, 0,    LE); // MinorRevision = 0
  view.setUint16(q +  6, 2,    LE); // NumberOfKeys = 2
  // Key 1: GTModelTypeGeoKey (1024) = 2 (ModelTypeGeographic)
  view.setUint16(q +  8, 1024, LE); // KeyID
  view.setUint16(q + 10, 0,    LE); // TIFFTagLocation = 0 (value inline)
  view.setUint16(q + 12, 1,    LE); // Count
  view.setUint16(q + 14, 2,    LE); // Value = 2 (Geographic)
  // Key 2: GeographicTypeGeoKey (2048) = 4326 (WGS84)
  view.setUint16(q + 16, 2048, LE); // KeyID
  view.setUint16(q + 18, 0,    LE); // TIFFTagLocation
  view.setUint16(q + 20, 1,    LE); // Count
  view.setUint16(q + 22, 4326, LE); // Value = 4326

  /* ── GDAL_NODATA string ──────────────────────────────────────── */
  // FIX 1: ASCII tag telling QGIS/GDAL/AlpineQuest which value = nodata
  q = NODATA_STR_OFFSET;
  for (let i = 0; i < NODATA_STR.length; i++) {
    view.setUint8(q + i, NODATA_STR.charCodeAt(i));
  }

  /* ── Pixel data (Int16, row-major, top-to-bottom) ────────────── */
  q = PIXEL_DATA_OFFSET;
  for (let i = 0; i < int16Data.length; i++) {
    view.setInt16(q + i * 2, int16Data[i], LE);
  }

  return buf;
}

/* ────────────────────────────────────────────────────────────────
   🔹 Public export function
   
   @param {object} raster   - DEMLoader rasterData:
                               { data: Float32Array, width, height,
                                 west, south, east, north, minVal, maxVal }
   @param {Array|null} kmlMask - polygon rings for clipping (or null)
   @param {string} filename  - output filename
──────────────────────────────────────────────────────────────── */
export async function exportDEM({
  raster,
  kmlMask  = null,
  filename = "export_dem.tif",
}) {
  try {
    if (!raster) {
      alert("❌ No DEM loaded — load a .tif / .asc / .dem file first");
      return;
    }

    console.log("📦 Exporting DEM raster…", {
      width: raster.width, height: raster.height,
      bbox: [raster.west, raster.south, raster.east, raster.north],
      clipping: !!kmlMask,
    });

    // Step 1: Clip to KML mask if present
    const finalRaster = clipRasterWithMask(raster, kmlMask);
    const { data, width, height, west, south, east, north } = finalRaster;

    const pixelWidth  = (east  - west)  / width;
    const pixelHeight = (north - south) / height;

    console.log(`  → ${width}×${height} pixels, pixel size: ${pixelWidth.toFixed(7)}° × ${pixelHeight.toFixed(7)}°`);

    // Step 2: Write GeoTIFF
    const arrayBuffer = writeTIFF(data, width, height, west, north, pixelWidth, pixelHeight);

    // Step 3: Download
    const blob = new Blob([arrayBuffer], { type: "image/tiff" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    console.log("✅ DEM exported:", filename, `(${(arrayBuffer.byteLength / 1024).toFixed(1)} KB)`);

  } catch (err) {
    console.error("❌ DEM export failed:", err);
    alert("DEM export failed: " + err.message);
  }
}