import { useState, useRef, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   UNIVERSAL KML PARSER — v35
   Handles ALL KML formats:
   ✅ Geoxis own software
   ✅ QGIS / ArcGIS export  (MultiGeometry + Folder)
   ✅ Google Earth KML/KMZ
   ✅ Global Mapper export
   ✅ ArcGIS Online export
   ✅ With/without altitude (lng,lat vs lng,lat,0)
   ✅ With/without closing repeat vertex
   ✅ Multiple Folders / nested Folders
   ✅ Multiple Placemarks — picks largest polygon
═══════════════════════════════════════════════════════════════════════ */

/**
 * Parse a KML coordinate string into [{lat, lng}] array.
 * Handles: "lng,lat" and "lng,lat,alt" formats, any whitespace separator.
 */
function parseCoordinateString(raw) {
  return raw
    .trim()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .map(token => {
      const parts = token.split(",");
      if (parts.length < 2) return null;
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      // parts[2] = altitude — intentionally ignored (we use terrain elevation)
      if (!isFinite(lat) || !isFinite(lng)) return null;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat, lng };
    })
    .filter(Boolean);
}

/**
 * Parse a KML text string and return the best polygon as [{lat, lng}].
 * Works for ALL known KML structures regardless of nesting depth.
 *
 * Strategy:
 *  1. querySelectorAll("coordinates") — finds ALL coord blocks anywhere
 *  2. Among those, prefer outerBoundaryIs > LinearRing path
 *  3. Among equal candidates, pick the one with the most points
 *  4. Remove duplicate closing vertex if present
 *  5. Validate final result (≥3 points, valid lat/lng ranges)
 */
export function parseKMLPolygon(kmlText) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, "text/xml");

    // Check for XML parse error
    const parseErr = doc.querySelector("parsererror");
    if (parseErr) {
      console.error("[KML] XML parse error:", parseErr.textContent);
      return null;
    }

    const allCoordEls = Array.from(doc.querySelectorAll("coordinates"));
    if (!allCoordEls.length) {
      console.warn("[KML] No <coordinates> elements found");
      return null;
    }

    let bestCoords = null;
    let bestCount = 0;
    let bestIsOuterBoundary = false;

    for (const el of allCoordEls) {
      const parentTag  = el.parentElement?.tagName ?? "";
      const grandTag   = el.parentElement?.parentElement?.tagName ?? "";

      // outerBoundaryIs > LinearRing > coordinates  ← standard polygon outer ring
      const isOuterBoundary =
        parentTag === "LinearRing" && grandTag === "outerBoundaryIs";

      // Skip innerBoundaryIs (holes) — we only want the outer ring
      const isInnerBoundary =
        parentTag === "LinearRing" && grandTag === "innerBoundaryIs";
      if (isInnerBoundary) continue;

      const pts = parseCoordinateString(el.textContent);
      if (pts.length < 3) continue;

      const betterBoundary = isOuterBoundary && !bestIsOuterBoundary;
      const morePoints     = pts.length > bestCount && (!bestIsOuterBoundary || isOuterBoundary);

      if (betterBoundary || morePoints) {
        bestCoords           = pts;
        bestCount            = pts.length;
        bestIsOuterBoundary  = isOuterBoundary;
      }
    }

    if (!bestCoords || bestCoords.length < 3) {
      console.warn("[KML] No valid polygon coords found");
      return null;
    }

    // Remove duplicate closing vertex (KML standard closes linear rings)
    const first = bestCoords[0];
    const last  = bestCoords[bestCoords.length - 1];
    if (
      Math.abs(first.lat - last.lat) < 1e-9 &&
      Math.abs(first.lng - last.lng) < 1e-9
    ) {
      bestCoords = bestCoords.slice(0, -1);
    }

    if (bestCoords.length < 3) {
      console.warn("[KML] Polygon has fewer than 3 unique points");
      return null;
    }

    console.log(`[KML] Parsed polygon: ${bestCoords.length} vertices, outerBoundary=${bestIsOuterBoundary}`);
    return bestCoords; // [{lat, lng}, ...]

  } catch (e) {
    console.error("[KML] parseKMLPolygon exception:", e);
    return null;
  }
}

/**
 * Parse ALL polygons from a KML (MultiGeometry, multiple Placemarks, etc.)
 * Returns array of [{lat,lng}] arrays — one per outer ring found.
 */
export function parseAllKMLPolygons(kmlText) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, "text/xml");
    if (doc.querySelector("parsererror")) return [];

    const results = [];
    doc.querySelectorAll("outerBoundaryIs LinearRing coordinates").forEach(el => {
      const pts = parseCoordinateString(el.textContent);
      if (pts.length < 3) return;
      const f = pts[0], l = pts[pts.length - 1];
      if (Math.abs(f.lat - l.lat) < 1e-9 && Math.abs(f.lng - l.lng) < 1e-9) pts.pop();
      if (pts.length >= 3) results.push(pts);
    });

    return results;
  } catch (e) {
    console.error("[KML] parseAllKMLPolygons exception:", e);
    return [];
  }
}

/**
 * Compute bbox from a polygon array [{lat, lng}]
 * Returns {minLat, maxLat, minLng, maxLng}
 */
export function bboxFromPolygon(polygon) {
  if (!polygon || polygon.length === 0) return null;
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

/**
 * Load a KML or KMZ file (File object) and return polygon + bbox.
 * Handles .kml directly and .kmz (ZIP containing doc.kml) via JSZip if available.
 *
 * Usage in your parent component:
 *   const { polygon, bbox } = await loadKMLFile(file);
 *   setKmlPolygon(polygon);
 *   setBbox(bbox);
 */
export async function loadKMLFile(file) {
  try {
    let kmlText;

    if (file.name.toLowerCase().endsWith(".kmz")) {
      // KMZ = ZIP file containing doc.kml
      try {
        const JSZip = (await import("jszip")).default;
        const zip   = await JSZip.loadAsync(file);
        const kmlEntry = zip.file(/\.kml$/i)[0];
        if (!kmlEntry) throw new Error("No .kml found inside KMZ");
        kmlText = await kmlEntry.async("string");
      } catch (zipErr) {
        console.error("[KML] KMZ unzip failed (jszip not installed?):", zipErr);
        return { polygon: null, bbox: null, error: "KMZ requires jszip: npm install jszip" };
      }
    } else {
      kmlText = await file.text();
    }

    const polygon = parseKMLPolygon(kmlText);
    const bbox    = polygon ? bboxFromPolygon(polygon) : null;
    const allPolygons = parseAllKMLPolygons(kmlText);

    return { polygon, bbox, allPolygons, kmlText };
  } catch (e) {
    console.error("[KML] loadKMLFile exception:", e);
    return { polygon: null, bbox: null, error: e.message };
  }
}

/* ══════════════════════════════════════════════════════════════════════
   COLOR RAMPS
══════════════════════════════════════════════════════════════════════ */
export const COLOR_RAMPS = {
  "SRTM Rainbow": [
    [0.00,[0,0,128]],[0.08,[0,0,255]],[0.16,[0,100,255]],[0.25,[0,200,255]],
    [0.33,[0,220,180]],[0.42,[0,200,80]],[0.50,[80,210,40]],[0.58,[180,220,0]],
    [0.65,[255,220,0]],[0.72,[255,170,0]],[0.79,[255,100,0]],[0.87,[220,30,0]],
    [0.93,[160,0,0]],[1.00,[80,0,0]],
  ],
  "Mine Survey": [
    [0.00,[5,10,80]],[0.10,[20,60,160]],[0.20,[40,130,180]],[0.30,[70,175,130]],
    [0.40,[120,195,80]],[0.50,[200,210,70]],[0.60,[230,185,60]],[0.70,[210,130,45]],
    [0.80,[175,85,30]],[0.90,[195,165,130]],[1.00,[240,235,225]],
  ],
  "QGIS Standard": [
    [0.00,[30,110,30]],[0.12,[80,165,50]],[0.24,[150,195,80]],[0.36,[215,215,110]],
    [0.48,[230,195,100]],[0.60,[200,155,70]],[0.70,[170,115,48]],[0.80,[140,85,35]],
    [0.88,[120,70,30]],[0.94,[185,162,138]],[1.00,[245,242,238]],
  ],
  "Terrain Relief": [
    [0.00,[0,100,200]],[0.08,[35,140,70]],[0.18,[80,175,65]],[0.30,[145,195,90]],
    [0.42,[210,205,115]],[0.54,[200,165,85]],[0.65,[175,125,58]],[0.76,[148,92,42]],
    [0.86,[128,75,35]],[0.93,[188,168,148]],[1.00,[242,240,235]],
  ],
  "India Plains": [
    [0.00,[30,100,30]],[0.12,[70,150,40]],[0.24,[120,185,60]],[0.38,[190,210,100]],
    [0.52,[220,195,110]],[0.64,[195,160,85]],[0.75,[165,125,62]],[0.85,[140,95,48]],
    [0.93,[175,148,120]],[1.00,[230,225,215]],
  ],
  "QGIS Hypsometric": [
    [0.00,[70,115,200]],[0.05,[110,175,80]],[0.15,[140,200,90]],[0.28,[200,210,110]],
    [0.42,[210,185,100]],[0.56,[190,155,80]],[0.68,[165,120,65]],[0.78,[140,90,50]],
    [0.87,[175,148,120]],[0.94,[210,200,185]],[1.00,[245,242,238]],
  ],
  "GeoXIS Terrain": [
    [0,[15,55,120]],[0.04,[30,110,60]],[0.12,[42,148,58]],[0.22,[80,168,72]],
    [0.34,[148,182,100]],[0.46,[192,168,110]],[0.58,[172,130,72]],[0.70,[138,90,42]],
    [0.82,[110,78,55]],[0.91,[168,152,135]],[0.97,[210,205,198]],[1,[248,248,252]],
  ],
  "Mine / Open Pit": [
    [0,[5,5,30]],[0.09,[20,48,98]],[0.18,[48,95,148]],[0.30,[85,145,178]],
    [0.42,[138,182,148]],[0.54,[188,170,112]],[0.64,[168,112,55]],[0.74,[138,72,22]],
    [0.85,[108,55,15]],[0.93,[158,128,88]],[1,[210,192,162]],
  ],
  "Viridis": [
    [0,[68,1,84]],[0.143,[72,40,120]],[0.286,[62,84,139]],[0.429,[49,124,137]],
    [0.571,[38,162,116]],[0.714,[88,196,87]],[0.857,[155,217,60]],[1,[253,231,37]],
  ],
  "Magma": [
    [0,[0,0,4]],[0.143,[28,16,68]],[0.286,[79,18,123]],[0.429,[129,37,129]],
    [0.571,[181,54,122]],[0.714,[229,80,99]],[0.857,[251,135,97]],[1,[252,253,191]],
  ],
  "Plasma": [
    [0,[13,8,135]],[0.143,[84,2,163]],[0.286,[139,10,165]],[0.429,[185,50,137]],
    [0.571,[219,92,104]],[0.714,[244,136,73]],[0.857,[254,188,43]],[1,[240,249,33]],
  ],
  "Grayscale":     [[0,[0,0,0]],[1,[255,255,255]]],
  "Grayscale Inv": [[0,[255,255,255]],[1,[0,0,0]]],
};
const DEFAULT_RAMP = "Mine / Open Pit";

const CONTOUR_PALETTES = {
  "QGIS Rainbow": [
    [0,[0,0,255]],[0.15,[0,180,255]],[0.30,[0,220,180]],[0.45,[80,220,80]],
    [0.55,[180,220,60]],[0.65,[255,200,0]],[0.75,[255,140,0]],[0.85,[255,60,60]],[1.0,[200,0,200]],
  ],
  "Classic Brown": null,
  "Blue-Cyan":   [[0,[0,80,200]],[0.5,[0,180,220]],[1,[100,230,255]]],
  "Green-Brown": [[0,[30,120,30]],[0.4,[100,160,60]],[0.7,[160,120,40]],[1,[100,60,20]]],
  "Grayscale":   [[0,[80,80,80]],[1,[200,200,200]]],
};

function autoSuggestRamp(range) {
  if (range < 50)  return "Viridis";
  if (range < 120) return "Plasma";
  if (range < 300) return "Mine / Open Pit";
  if (range < 600) return "Mine Survey";
  if (range < 900) return "QGIS Standard";
  return "SRTM Rainbow";
}

function autoSuggestStretch(range) {
  if (range < 400) return "local";
  if (range < 800) return "percentile";
  return "stddev";
}

function interpolatePalette(t, palette) {
  t = Math.max(0, Math.min(1, t)); let lo = 0;
  for (let i = 0; i < palette.length - 1; i++) { lo = i; if (t <= palette[i + 1][0]) break; }
  const a = palette[lo], b = palette[Math.min(lo + 1, palette.length - 1)];
  const span = b[0] - a[0], f = span < 1e-9 ? 0 : (t - a[0]) / span;
  return [Math.round(a[1][0] + (b[1][0] - a[1][0]) * f), Math.round(a[1][1] + (b[1][1] - a[1][1]) * f), Math.round(a[1][2] + (b[1][2] - a[1][2]) * f)];
}

/* ── Polygon helpers ─────────────────────────────────────────────────── */
function pointInPolygon(lat, lng, poly) {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function isValidPolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  return poly.every(p => p && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
}

function polygonSignature(poly) {
  if (!isValidPolygon(poly)) return "none";
  const n = poly.length, r = v => Math.round(v * 1e5) / 1e5;
  const first = poly[0], mid = poly[Math.floor(n / 2)], last = poly[n - 1];
  // v35 FIX: fold in the average of every vertex (cheap, still O(n)) so two different
  // polygons that happen to share point count + first/mid/last coords aren't mistaken for
  // "the same area" — that collision could previously suppress the DEM/contour reset when
  // switching from one KML to a different one.
  let sumLat = 0, sumLng = 0;
  for (let i = 0; i < n; i++) { sumLat += poly[i].lat; sumLng += poly[i].lng; }
  const avgLat = r(sumLat / n), avgLng = r(sumLng / n);
  return `${n}:${r(first.lat)},${r(first.lng)}:${r(mid.lat)},${r(mid.lng)}:${r(last.lat)},${r(last.lng)}:${avgLat},${avgLng}`;
}

function waitForGlobeReady(viewer, maxWaitMs = 5000) {
  return new Promise(resolve => {
    try {
      if (!viewer?.scene?.globe) { resolve(); return; }
      if (viewer.scene.globe.tilesLoaded) { resolve(); return; }
      let done = false;
      const finish = () => { if (done) return; done = true; clearInterval(poll); try { removeListener(); } catch (_) { } resolve(); };
      const poll = setInterval(() => {
        try { if (viewer.scene.globe.tilesLoaded) finish(); } catch (_) { finish(); }
      }, 200);
      let removeListener = () => { };
      try {
        const ev = viewer.scene.globe.tileLoadProgressEvent;
        removeListener = ev.addEventListener(n => { if (n === 0 && viewer.scene.globe.tilesLoaded) finish(); });
      } catch (_) { }
      setTimeout(finish, maxWaitMs);
    } catch (_) { resolve(); }
  });
}

function getClipPoly(eg, livePoly) {
  if (eg && Object.prototype.hasOwnProperty.call(eg, "clipPoly")) return eg.clipPoly;
  return isValidPolygon(livePoly) ? livePoly : null;
}

function buildAlphaMask(W, H, poly, bbox, rows, cols) {
  if (!poly || poly.length < 3) return null;
  const MW = Math.ceil(W / 4) + 2, MH = Math.ceil(H / 4) + 2;
  const mask = new Float32Array(MW * MH);
  const latSpan = bbox.maxLat - bbox.minLat, lngSpan = bbox.maxLng - bbox.minLng;
  for (let my = 0; my < MH; my++) for (let mx = 0; mx < MW; mx++) {
    const px = mx * 4, py = my * 4;
    const lat = MH > 1 ? bbox.maxLat - latSpan * (py / (H - 1 || 1)) : (bbox.minLat + bbox.maxLat) / 2;
    const lng = MW > 1 ? bbox.minLng + lngSpan * (px / (W - 1 || 1)) : (bbox.minLng + bbox.maxLng) / 2;
    mask[my * MW + mx] = pointInPolygon(lat, lng, poly) ? 1 : 0;
  }
  const blurred = new Float32Array(MW * MH);
  for (let my = 0; my < MH; my++) for (let mx = 0; mx < MW; mx++) {
    let sum = 0, cnt = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ny = my + dy, nx = mx + dx;
      if (ny >= 0 && ny < MH && nx >= 0 && nx < MW) { sum += mask[ny * MW + nx]; cnt++; }
    }
    blurred[my * MW + mx] = sum / cnt;
  }
  return { data: blurred, MW, MH };
}

function sampleAlphaMask(alphaMask, W, H, px, py) {
  if (!alphaMask) return 1;
  const { data, MW, MH } = alphaMask;
  const mx = px / 4, my = py / 4;
  const mx0 = Math.max(0, Math.min(MW - 1, Math.floor(mx))), mx1 = Math.min(MW - 1, mx0 + 1);
  const my0 = Math.max(0, Math.min(MH - 1, Math.floor(my))), my1 = Math.min(MH - 1, my0 + 1);
  const fx = mx - mx0, fy = my - my0;
  const v00 = data[my0 * MW + mx0], v10 = data[my0 * MW + mx1];
  const v01 = data[my1 * MW + mx0], v11 = data[my1 * MW + mx1];
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

function elevToRGB(t, ramp) {
  const s = COLOR_RAMPS[ramp] || COLOR_RAMPS[DEFAULT_RAMP];
  t = Math.max(0, Math.min(1, t));
  let lo = 0;
  for (let i = 0; i < s.length - 1; i++) { lo = i; if (t <= s[i + 1][0]) break; }
  const a = s[lo], b = s[Math.min(lo + 1, s.length - 1)];
  const span = b[0] - a[0], f = span < 1e-9 ? 0 : (t - a[0]) / span;
  return [Math.round(a[1][0] + (b[1][0] - a[1][0]) * f), Math.round(a[1][1] + (b[1][1] - a[1][1]) * f), Math.round(a[1][2] + (b[1][2] - a[1][2]) * f)];
}

function isOk(v) { return v != null && isFinite(v) && v > -500 && v < 9000; }

function computeStretchRange(grid, rows, cols, minE, maxE, stretchMode, clipPercent = 2) {
  if (stretchMode === "global") return { stretchMin: 0, stretchMax: 8848 };
  if (stretchMode === "local") return { stretchMin: minE, stretchMax: maxE };

  const vals = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = grid[r][c]; if (!isNaN(v) && isFinite(v) && v > -500 && v < 9000) vals.push(v);
  }
  if (vals.length < 10) return { stretchMin: minE, stretchMax: maxE };
  vals.sort((a, b) => a - b);

  let stretchMin, stretchMax;
  if (stretchMode === "stddev") {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
    const sd = Math.sqrt(variance);
    stretchMin = mean - 2 * sd; stretchMax = mean + 2 * sd;
  } else if (stretchMode === "percentile") {
    const li = Math.floor(vals.length * clipPercent / 100), hi = Math.ceil(vals.length * (1 - clipPercent / 100)) - 1;
    stretchMin = vals[Math.max(0, li)]; stretchMax = vals[Math.min(vals.length - 1, hi)];
  } else {
    stretchMin = minE; stretchMax = maxE;
  }

  const actualRange = maxE - minE;
  const MIN_RANGE = Math.min(50, actualRange * 0.15);
  if (stretchMax - stretchMin < MIN_RANGE) {
    const mid = (stretchMin + stretchMax) / 2;
    stretchMin = mid - MIN_RANGE / 2;
    stretchMax = mid + MIN_RANGE / 2;
    if (stretchMin < minE) { stretchMin = minE; stretchMax = Math.min(maxE, minE + MIN_RANGE); }
    if (stretchMax > maxE) { stretchMax = maxE; stretchMin = Math.max(minE, maxE - MIN_RANGE); }
  }

  return { stretchMin, stretchMax };
}

/* ── Bicubic + upsample + smooth ─────────────────────────────────────── */
function cubicWeight(t) { const at = Math.abs(t); if (at <= 1) return 1.5 * at * at * at - 2.5 * at * at + 1; if (at < 2) return -0.5 * at * at * at + 2.5 * at * at - 4 * at + 2; return 0; }
function bicubicSample(grid, rows, cols, rF, cF) {
  rF = Math.max(0, Math.min(rows - 1, rF)); cF = Math.max(0, Math.min(cols - 1, cF));
  const r0 = Math.floor(rF), c0 = Math.floor(cF); let val = 0, wSum = 0;
  for (let dr = -1; dr <= 2; dr++) for (let dc = -1; dc <= 2; dc++) {
    const nr = Math.max(0, Math.min(rows - 1, r0 + dr)), nc = Math.max(0, Math.min(cols - 1, c0 + dc));
    const v = grid[nr][nc]; if (isNaN(v)) continue;
    const w = cubicWeight(rF - r0 - dr) * cubicWeight(cF - c0 - dc); val += v * w; wSum += w;
  }
  return wSum > 1e-9 ? val / wSum : NaN;
}
function upsampleGrid(grid, rows, cols, factor) {
  const nR = (rows - 1) * factor + 1, nC = (cols - 1) * factor + 1;
  const out = Array.from({ length: nR }, () => new Float32Array(nC));
  for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) out[r][c] = bicubicSample(grid, rows, cols, r / factor, c / factor);
  return { grid: out, rows: nR, cols: nC };
}
function gaussianSmooth(grid, rows, cols, passes = 2) {
  const K = [[1, 2, 1], [2, 4, 2], [1, 2, 1]]; let src = grid;
  for (let pass = 0; pass < passes; pass++) {
    const dst = Array.from({ length: rows }, (_, r) => {
      const row = new Float32Array(cols);
      for (let c = 0; c < cols; c++) {
        let wS = 0, vS = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc; if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const v = src[nr][nc]; if (isNaN(v)) continue; const w = K[dr + 1][dc + 1]; vS += v * w; wS += w;
        }
        row[c] = wS > 0 ? vS / wS : (isNaN(src[r][c]) ? NaN : src[r][c]);
      }
      return row;
    });
    src = dst;
  }
  return src;
}

/* ── Catmull-Rom + Douglas-Peucker ──────────────────────────────────── */
function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
  0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)];
}
function splineSmooth(pts, stepsPerSeg = 4) {
  if (pts.length < 3) return pts;
  const n = pts.length, out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < stepsPerSeg; s++) out.push(catmullRomPoint(p0, p1, p2, p3, s / stepsPerSeg));
  }
  out.push(pts[n - 1]); return out;
}
function douglasPeucker(points, epsilon) {
  if (points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  const [x1, y1] = points[0], [x2, y2] = points[points.length - 1];
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  for (let i = 1; i < points.length - 1; i++) {
    const dist = len < 1e-10 ? Math.hypot(points[i][0] - x1, points[i][1] - y1) : Math.abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / len;
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > epsilon) { const L = douglasPeucker(points.slice(0, maxIdx + 1), epsilon); const R = douglasPeucker(points.slice(maxIdx), epsilon); return [...L.slice(0, -1), ...R]; }
  return [points[0], points[points.length - 1]];
}

/* ── fillNaN ─────────────────────────────────────────────────────────── */
function fillNaN(grid, rows, cols) {
  let changed = true, pass = 0;
  while (changed && pass < 200) {
    changed = false; pass++;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!isNaN(grid[r][c])) continue;
      let wS = 0, vS = 0;
      for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc; if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const v = grid[nr][nc]; if (isNaN(v)) continue;
        const w = 1 / Math.sqrt(dr * dr + dc * dc); vS += v * w; wS += w;
      }
      if (wS > 0) { grid[r][c] = vS / wS; changed = true; }
    }
  }
}

/* ── Elevation cache + AWS Terrarium ────────────────────────────────── */
const _elvCache = {};
const cacheKey = (bbox, rows, cols, polySig = "none") => `${bbox.minLat.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLng.toFixed(5)},${rows},${cols},${polySig}`;
const TILE_Z = 14, TILE_N = Math.pow(2, 14);
function latLngToTileExact(lat, lng) {
  const latRad = lat * Math.PI / 180;
  const mercY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
  const xE = (lng + 180) / 360 * TILE_N, yE = mercY * TILE_N;
  return { x: Math.floor(xE), y: Math.floor(yE), px: (xE - Math.floor(xE)) * 256, py: (yE - Math.floor(yE)) * 256 };
}

const _tileCache = {};
function loadTileOnce(x, y) {
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = "anonymous";
    let done = false; const finish = v => { if (done) return; done = true; resolve(v); };
    img.onload = () => { try { const cv = document.createElement("canvas"); cv.width = cv.height = 256; cv.getContext("2d").drawImage(img, 0, 0); finish(cv.getContext("2d").getImageData(0, 0, 256, 256).data); } catch { finish(null); } };
    img.onerror = () => finish(null);
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TILE_Z}/${x}/${y}.png`;
    setTimeout(() => finish(null), 9000);
  });
}
function loadTilePixels(x, y) {
  const k = `${TILE_Z}/${x}/${y}`;
  if (_tileCache[k]) return _tileCache[k];
  const p = (async () => {
    for (let i = 0; i < 3; i++) { const r = await loadTileOnce(x, y); if (r) return r; }
    delete _tileCache[k]; return null;
  })();
  _tileCache[k] = p; return p;
}
function tilePixelElev(data, px, py) {
  const x = Math.max(0, Math.min(255, Math.round(px))), y = Math.max(0, Math.min(255, Math.round(py)));
  const i = (y * 256 + x) * 4, e = (data[i] * 256 + data[i + 1] + data[i + 2] / 256) - 32768;
  return isOk(e) ? e : null;
}
async function fetchElevTile(lat, lng) {
  const { x, y, px, py } = latLngToTileExact(lat, lng);
  const data = await loadTilePixels(x, y); if (!data) return null;
  const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
  const dx = px - x0, dy = py - y0;
  const v00 = tilePixelElev(data, x0, y0), v10 = tilePixelElev(data, x1, y0);
  const v01 = tilePixelElev(data, x0, y1), v11 = tilePixelElev(data, x1, y1);
  if (v00 == null && v10 == null && v01 == null && v11 == null) return null;
  const safe = (v, fb) => v != null ? v : fb, fb = v00 ?? v10 ?? v01 ?? v11;
  return safe(v00, fb) * (1 - dx) * (1 - dy) + safe(v10, fb) * dx * (1 - dy) + safe(v01, fb) * (1 - dx) * dy + safe(v11, fb) * dx * dy;
}

function computeAspectGrid(bbox, gridRes) {
  const latM = (bbox.maxLat - bbox.minLat) * 111320;
  const lngM = (bbox.maxLng - bbox.minLng) * 111320 * Math.cos((bbox.minLat + bbox.maxLat) * 0.5 * Math.PI / 180);
  const aspect = lngM / Math.max(latM, 1);
  const targetTotal = gridRes * gridRes;
  let cols = Math.round(Math.sqrt(targetTotal * aspect));
  let rows = Math.round(Math.sqrt(targetTotal / aspect));
  cols = Math.max(20, Math.min(240, cols));
  rows = Math.max(20, Math.min(240, rows));
  return { rows, cols };
}

async function fetchElevationGrid(bbox, rows, cols, onProgress, signal) {
  const pts = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lat = rows > 1 ? bbox.maxLat - (bbox.maxLat - bbox.minLat) * (r / (rows - 1)) : (bbox.minLat + bbox.maxLat) / 2;
    const lng = cols > 1 ? bbox.minLng + (bbox.maxLng - bbox.minLng) * (c / (cols - 1)) : (bbox.minLng + bbox.maxLng) / 2;
    pts.push({ lat, lng, r, c });
  }
  const grid = Array.from({ length: rows }, () => new Float32Array(cols).fill(NaN));
  let done = 0;
  for (let i = 0; i < pts.length; i += 8) {
    if (signal?.aborted) break;
    const chunk = pts.slice(i, i + 8);
    const results = await Promise.all(chunk.map(p => fetchElevTile(p.lat, p.lng)));
    results.forEach((e, idx) => { if (isOk(e)) grid[chunk[idx].r][chunk[idx].c] = e; });
    done += chunk.length; onProgress?.(done, pts.length);
  }
  return grid;
}

/* ── Marching squares ────────────────────────────────────────────────── */
function marchingSquares(grid, rows, cols, levels) {
  const segs = {}; levels.forEach(lv => { segs[lv] = []; });
  const lerp = (va, vb, lv) => va !== vb ? (lv - va) / (vb - va) : 0.5;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const v = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]];
    if (v.some(isNaN)) continue;
    levels.forEach(lv => {
      const idx = ((v[0] >= lv) ? 8 : 0) | ((v[1] >= lv) ? 4 : 0) | ((v[2] >= lv) ? 2 : 0) | ((v[3] >= lv) ? 1 : 0);
      if (!idx || idx === 15) return;
      const tT = lerp(v[0], v[1], lv), tR = lerp(v[1], v[2], lv), tB = lerp(v[3], v[2], lv), tL = lerp(v[0], v[3], lv);
      const top = [r, c + tT], right = [r + tR, c + 1], bot = [r + 1, c + tB], left = [r + tL, c];
      const lkp = { 1: [[left, bot]], 2: [[bot, right]], 3: [[left, right]], 4: [[top, right]], 5: [[top, right], [left, bot]], 6: [[top, bot]], 7: [[top, left]], 8: [[left, top]], 9: [[top, bot]], 10: [[left, top], [bot, right]], 11: [[top, right]], 12: [[left, right]], 13: [[bot, right]], 14: [[left, bot]] };
      (lkp[idx] || []).forEach(s => segs[lv].push(s));
    });
  }
  return segs;
}
function stitchSegments(segs) {
  if (!segs.length) return [];
  const PREC = 8000, key = ([r, c]) => `${Math.round(r * PREC)},${Math.round(c * PREC)}`;
  const epMap = new Map(), used = new Uint8Array(segs.length);
  segs.forEach(([a, b], i) => {
    const ka = key(a), kb = key(b);
    for (const k of [ka, kb]) { if (!epMap.has(k)) epMap.set(k, []); }
    epMap.get(ka).push([i, 0]); epMap.get(kb).push([i, 1]);
  });
  function extendTail(chain) {
    let moved = true;
    while (moved) {
      moved = false; const tailKey = key(chain[chain.length - 1]);
      for (const [idx, ei] of (epMap.get(tailKey) || [])) { if (used[idx]) continue; used[idx] = 1; chain.push(ei === 0 ? segs[idx][1] : segs[idx][0]); moved = true; break; }
    }
  }
  const chains = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1; const chain = [segs[i][0], segs[i][1]];
    extendTail(chain); chain.reverse(); extendTail(chain);
    if (chain.length >= 2) chains.push(chain);
  }
  return chains;
}
function gridToLatLng(rF, cF, bbox, rows, cols) {
  const lat = rows > 1 ? bbox.maxLat - (bbox.maxLat - bbox.minLat) * (rF / (rows - 1)) : (bbox.minLat + bbox.maxLat) / 2;
  const lng = cols > 1 ? bbox.minLng + (bbox.maxLng - bbox.minLng) * (cF / (cols - 1)) : (bbox.minLng + bbox.maxLng) / 2;
  return [lat, lng];
}
function interpBoundary(lat0, lng0, lat1, lng1, poly) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (pointInPolygon(lat0 + (lat1 - lat0) * m, lng0 + (lng1 - lng0) * m, poly)) lo = m; else hi = m; }
  const t = (lo + hi) / 2; return [lat0 + (lat1 - lat0) * t, lng0 + (lng1 - lng0) * t];
}
function clipChain(latlngs, poly) {
  if (!poly || poly.length < 3) return [latlngs];
  const subs = []; let cur = [], prevIn = false;
  for (let i = 0; i < latlngs.length; i++) {
    const [lat, lng] = latlngs[i], inside = pointInPolygon(lat, lng, poly);
    if (inside && !prevIn) { if (i > 0) { const entry = interpBoundary(...latlngs[i - 1], lat, lng, poly); cur.push(entry); } cur.push([lat, lng]); }
    else if (inside && prevIn) { cur.push([lat, lng]); }
    else if (!inside && prevIn) { const exit = interpBoundary(...latlngs[i - 1], lat, lng, poly); cur.push(exit); if (cur.length >= 2) subs.push(cur); cur = []; }
    prevIn = inside;
  }
  if (cur.length >= 2) subs.push(cur);
  return subs.length ? subs : [];
}

/* ── Hillshade ───────────────────────────────────────────────────────── */
function computeHS(grid, rows, cols, r, c, cellM, az = 315, alt = 35) {
  const get = (rr, cc) => { const v = grid[Math.max(0, Math.min(rows - 1, rr))][Math.max(0, Math.min(cols - 1, cc))]; return isNaN(v) ? 0 : v; };
  const a = get(r - 1, c - 1), b = get(r - 1, c), c2 = get(r - 1, c + 1), d = get(r, c - 1), e2 = get(r, c + 1), f2 = get(r + 1, c - 1), g = get(r + 1, c), h = get(r + 1, c + 1);
  const cm = Math.max(cellM, 1);
  const dzdx = ((c2 + 2 * e2 + h) - (a + 2 * d + f2)) / (8 * cm), dzdy = ((f2 + 2 * g + h) - (a + 2 * b + c2)) / (8 * cm);
  const az_r = (360 - az + 90) * Math.PI / 180, alt_r = alt * Math.PI / 180;
  const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
  let asp = Math.atan2(dzdy, -dzdx); if (asp < 0) asp += 2 * Math.PI;
  return Math.max(0, Math.cos(alt_r) * Math.cos(slope) + Math.sin(alt_r) * Math.sin(slope) * Math.cos(az_r - asp));
}
function computeMultiHS(grid, rows, cols, r, c, cellM) {
  const dirs = [{ az: 225, w: 0.12, alt: 35 }, { az: 270, w: 0.18, alt: 35 }, { az: 315, w: 0.42, alt: 35 }, { az: 360, w: 0.20, alt: 45 }, { az: 45, w: 0.08, alt: 55 }];
  let hs = 0, wt = 0;
  for (const { az, w, alt } of dirs) { hs += w * computeHS(grid, rows, cols, r, c, cellM, az, alt); wt += w; }
  return Math.min(1, hs / wt);
}

/* ── Export helpers ──────────────────────────────────────────────────── */
function dlBlob(data, name, mime) { const url = URL.createObjectURL(new Blob([data], { type: mime })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function buildGeoTIFF({ grid, rows, cols, bbox }) {
  const W = cols, H = rows, pixW = cols > 1 ? (bbox.maxLng - bbox.minLng) / (cols - 1) : 0.001, pixH = rows > 1 ? (bbox.maxLat - bbox.minLat) / (rows - 1) : 0.001;
  const raster = new Float32Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) raster[r * W + c] = isNaN(grid[r][c]) ? -9999 : grid[r][c];
  const tp = new Float64Array([0, 0, 0, bbox.minLng, bbox.maxLat, 0]), ps = new Float64Array([pixW, pixH, 0]);
  const gk = new Uint16Array([1, 1, 0, 4, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326, 2049, 34737, 7, 0]);
  const cit = new TextEncoder().encode("WGS 84\0"), nd = new TextEncoder().encode("-9999\0");
  const NT = 17, ifdOff = 8, ifdSz = 2 + NT * 12 + 4, tpOff = ifdOff + ifdSz, psOff = tpOff + tp.byteLength, gkOff = psOff + ps.byteLength;
  const citOff = gkOff + gk.byteLength, ndOff = citOff + cit.byteLength, rasOff = Math.ceil((ndOff + nd.byteLength) / 4) * 4, total = rasOff + raster.byteLength;
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  let p = 0; u8[p++] = 0x49; u8[p++] = 0x49; dv.setUint16(p, 42, true); p += 2; dv.setUint32(p, ifdOff, true); p += 4; dv.setUint16(p, NT, true); p += 2;
  const tag = (id, type, count, val) => { dv.setUint16(p, id, true); p += 2; dv.setUint16(p, type, true); p += 2; dv.setUint32(p, count, true); p += 4; if (type === 3 && count <= 2) { dv.setUint16(p, val, true); p += 2; dv.setUint16(p, 0, true); p += 2; } else { dv.setUint32(p, val, true); p += 4; } };
  tag(256, 4, 1, W); tag(257, 4, 1, H); tag(258, 3, 1, 32); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(273, 4, 1, rasOff); tag(277, 3, 1, 1); tag(278, 4, 1, H); tag(279, 4, 1, W * H * 4); tag(284, 3, 1, 1); tag(339, 3, 1, 3); tag(33550, 12, 3, psOff); tag(33922, 12, 6, tpOff); tag(34735, 3, gk.length, gkOff); tag(34736, 12, 0, 0); tag(34737, 2, cit.length, citOff); tag(42113, 2, nd.length, ndOff);
  dv.setUint32(p, 0, true); p += 4;
  new Uint8Array(buf, tpOff).set(new Uint8Array(tp.buffer)); new Uint8Array(buf, psOff).set(new Uint8Array(ps.buffer));
  new Uint8Array(buf, gkOff).set(new Uint8Array(gk.buffer)); new Uint8Array(buf, citOff).set(cit);
  new Uint8Array(buf, ndOff).set(nd); new Uint8Array(buf, rasOff).set(new Uint8Array(raster.buffer));
  return buf;
}
function buildContourGeoJSON({ grid, rows, cols, bbox, min: minE, max: maxE }, interval, majorEvery, poly = null) {
  const levels = []; for (let lv = Math.ceil(minE / interval) * interval; lv <= maxE + 1e-6; lv += interval) levels.push(parseFloat(lv.toFixed(6)));
  const rawSegs = marchingSquares(grid, rows, cols, levels), features = [], hasClip = poly && poly.length >= 3;
  levels.forEach(lv => {
    stitchSegments(rawSegs[lv] || []).forEach(chain => {
      if (chain.length < 2) return;
      const latlngs = chain.map(([rF, cF]) => gridToLatLng(rF, cF, bbox, rows, cols));
      (hasClip ? clipChain(latlngs, poly) : [latlngs]).forEach(sub => {
        if (sub.length < 2) return;
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: sub.map(([lat, lng]) => [lng, lat, lv]) }, properties: { elevation_m: lv, elevation_ft: Math.round(lv * 3.28084), contourType: Math.round(lv) % majorEvery === 0 ? "major" : "minor", interval_m: interval } });
      });
    });
  });
  return { type: "FeatureCollection", features };
}

/* ═══════════════════════════════════════════════════════════════════════
   SHAPEFILE EXPORT — v2.0 (FIXED)
   ESRI Shapefile specification compliant
═══════════════════════════════════════════════════════════════════════ */

/**
 * Create a valid ESRI Shapefile (.shp) from contour features
 */
function createShp(features) {
  if (!features || features.length === 0) {
    // Return empty shapefile with proper header
    const buf = new ArrayBuffer(100);
    const dv = new DataView(buf);
    dv.setInt32(0, 9994, false);
    dv.setInt32(24, 50, false);
    dv.setInt32(28, 1000, true);
    dv.setInt32(32, 3, true);
    for (let i = 0; i < 8; i++) dv.setFloat64(36 + i * 8, 0, true);
    return buf;
  }

  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  const featureData = [];

  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;

    let fXMin = Infinity, fYMin = Infinity, fXMax = -Infinity, fYMax = -Infinity;
    const validCoords = [];

    for (const point of coords) {
      const lng = point[0];
      const lat = point[1];
      if (!isFinite(lng) || !isFinite(lat)) continue;
      validCoords.push([lng, lat]);
      if (lng < xMin) xMin = lng;
      if (lng > xMax) xMax = lng;
      if (lat < yMin) yMin = lat;
      if (lat > yMax) yMax = lat;
      if (lng < fXMin) fXMin = lng;
      if (lng > fXMax) fXMax = lng;
      if (lat < fYMin) fYMin = lat;
      if (lat > fYMax) fYMax = lat;
    }

    if (validCoords.length < 2) continue;
    featureData.push({ coords: validCoords, bbox: { xMin: fXMin, yMin: fYMin, xMax: fXMax, yMax: fYMax }, count: validCoords.length });
  }

  if (featureData.length === 0) return createShp([]);

  let totalBytes = 100;
  for (const fd of featureData) {
    const contentBytes = 4 + 32 + 4 + 4 + (4 * 1) + (fd.count * 16);
    const recordLength = Math.ceil((8 + contentBytes) / 2);
    totalBytes += recordLength * 2;
  }

  const shpBuffer = new ArrayBuffer(totalBytes);
  const dv = new DataView(shpBuffer);
  let offset = 0;

  // File header (big-endian)
  dv.setInt32(0, 9994, false);
  dv.setInt32(24, totalBytes / 2, false);
  dv.setInt32(28, 1000, true);
  dv.setInt32(32, 3, true);
  if (isFinite(xMin) && isFinite(yMin) && isFinite(xMax) && isFinite(yMax)) {
    dv.setFloat64(36, xMin, true);
    dv.setFloat64(44, yMin, true);
    dv.setFloat64(52, xMax, true);
    dv.setFloat64(60, yMax, true);
  }
  offset = 100;

  // Records
  for (let i = 0; i < featureData.length; i++) {
    const fd = featureData[i];
    const contentBytes = 4 + 32 + 4 + 4 + (4 * 1) + (fd.count * 16);
    const contentWords = contentBytes / 2;

    dv.setInt32(offset, i + 1, false);
    offset += 4;
    dv.setInt32(offset, contentWords, false);
    offset += 4;
    dv.setInt32(offset, 3, true);
    offset += 4;
    dv.setFloat64(offset, fd.bbox.xMin, true);
    offset += 8;
    dv.setFloat64(offset, fd.bbox.yMin, true);
    offset += 8;
    dv.setFloat64(offset, fd.bbox.xMax, true);
    offset += 8;
    dv.setFloat64(offset, fd.bbox.yMax, true);
    offset += 8;
    dv.setInt32(offset, 1, true);
    offset += 4;
    dv.setInt32(offset, fd.count, true);
    offset += 4;
    dv.setInt32(offset, 0, true);
    offset += 4;
    for (const [lng, lat] of fd.coords) {
      dv.setFloat64(offset, lng, true);
      offset += 8;
      dv.setFloat64(offset, lat, true);
      offset += 8;
    }
  }

  return shpBuffer;
}

/**
 * Create a valid ESRI Shapefile Index (.shx)
 */
function createShx(features, shpBuffer) {
  const numFeatures = features.length;
  const totalBytes = 100 + (numFeatures * 8);
  const buffer = new ArrayBuffer(totalBytes);
  const dv = new DataView(buffer);
  const shpView = new DataView(shpBuffer);

  // Header (copy from SHP)
  for (let i = 0; i < 100; i++) dv.setUint8(i, shpView.getUint8(i));
  dv.setInt32(24, totalBytes / 2, false);

  // Records
  let shpOffset = 100 / 2;
  for (let i = 0; i < numFeatures; i++) {
    const pos = 100 + i * 8;
    dv.setInt32(pos, shpOffset, false);
    const shpPos = shpOffset * 2 + 4;
    const contentWords = shpView.getInt32(shpPos, false);
    dv.setInt32(pos + 4, contentWords, false);
    shpOffset += 4 + contentWords;
  }

  return buffer;
}

/**
 * Create a valid DBF file (.dbf)
 */
function createDbf(features) {
  const numRecords = features.length;
  const fields = [
    { name: "ELEV_M", type: "N", length: 12, decimals: 2 },
    { name: "ELEV_FT", type: "N", length: 12, decimals: 2 },
    { name: "TYPE", type: "C", length: 10, decimals: 0 },
    { name: "INT_M", type: "N", length: 8, decimals: 1 },
  ];

  const numFields = fields.length;
  const headerSize = 32 + (numFields * 32) + 1;
  let recordSize = 1;
  for (const field of fields) recordSize += field.length;

  const totalBytes = headerSize + (numRecords * recordSize) + 1;
  const buffer = new Uint8Array(totalBytes);
  const dv = new DataView(buffer.buffer);

  // Header
  buffer[0] = 0x03;
  dv.setUint32(4, numRecords, true);
  dv.setUint16(8, headerSize, true);
  dv.setUint16(10, recordSize, true);
  for (let i = 12; i < 32; i++) buffer[i] = 0;

  // Field descriptors
  let fieldOffset = 32;
  for (const field of fields) {
    const nameBytes = new TextEncoder().encode(field.name.substring(0, 10));
    for (let i = 0; i < 11; i++) buffer[fieldOffset + i] = i < nameBytes.length ? nameBytes[i] : 0;
    buffer[fieldOffset + 11] = field.type.charCodeAt(0);
    dv.setUint32(fieldOffset + 12, 0, true);
    buffer[fieldOffset + 16] = field.length;
    buffer[fieldOffset + 17] = field.decimals;
    for (let i = 18; i < 32; i++) buffer[fieldOffset + i] = 0;
    fieldOffset += 32;
  }
  buffer[fieldOffset] = 0x0D;

  // Records
  let recordPos = headerSize;
  for (let i = 0; i < numRecords; i++) {
    const props = features[i].properties || {};
    buffer[recordPos] = 0x20;
    let pos = recordPos + 1;

    const elevM = props.elevation_m ?? props.ELEV ?? 0;
    const elevFt = props.elevation_ft ?? elevM * 3.28084;
    const type = props.contourType || "minor";
    const intM = props.interval_m ?? 0;

    const values = [
      Number(elevM).toFixed(2),
      Number(elevFt).toFixed(2),
      String(type).substring(0, 10),
      Number(intM).toFixed(1),
    ];

    for (let f = 0; f < fields.length; f++) {
      const padded = values[f].padStart(fields[f].length, " ");
      const bytes = new TextEncoder().encode(padded);
      for (let j = 0; j < fields[f].length; j++) {
        buffer[pos + j] = j < bytes.length ? bytes[j] : 0x20;
      }
      pos += fields[f].length;
    }
    recordPos += recordSize;
  }

  buffer[totalBytes - 1] = 0x1A;
  return buffer;
}

/**
 * Create PRJ file
 */
function createPrj() {
  const prjString = `GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]`;
  return new TextEncoder().encode(prjString);
}

/**
 * Create CPG file
 */
function createCpg() {
  return new TextEncoder().encode("UTF-8");
}

/**
 * Export contour features as a complete Shapefile ZIP
 */
async function exportContourShapefile(features, baseName, onProgress) {
  if (!features || features.length === 0) {
    throw new Error("No contour features to export");
  }

  const safeName = baseName.replace(/[^a-zA-Z0-9_]/g, "_");

  if (onProgress) onProgress(10);
  const shpBuffer = createShp(features);
  if (onProgress) onProgress(30);

  const shxBuffer = createShx(features, shpBuffer);
  if (onProgress) onProgress(50);

  const dbfBuffer = createDbf(features);
  if (onProgress) onProgress(70);

  const prjBuffer = createPrj();
  const cpgBuffer = createCpg();
  if (onProgress) onProgress(80);

  let JSZip;
  try {
    const module = await import("jszip");
    JSZip = module.default || module.JSZip;
  } catch (e) {
    if (typeof window.JSZip !== "undefined") {
      JSZip = window.JSZip;
    } else {
      throw new Error("JSZip not available. Please install: npm install jszip");
    }
  }

  if (onProgress) onProgress(85);
  const zip = new JSZip();

  zip.file(`${safeName}.shp`, new Uint8Array(shpBuffer));
  zip.file(`${safeName}.shx`, new Uint8Array(shxBuffer));
  zip.file(`${safeName}.dbf`, dbfBuffer);
  zip.file(`${safeName}.prj`, prjBuffer);
  zip.file(`${safeName}.cpg`, cpgBuffer);

  if (onProgress) onProgress(90);

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });

  if (onProgress) onProgress(100);
  return zipBlob;
}

/* ── Arc-length + render helpers ─────────────────────────────────────── */
function buildArcLens(coords) {
  const lens = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) { const [lat1, lng1] = coords[i - 1], [lat2, lng2] = coords[i]; const dlat = (lat2 - lat1) * 111320, dlng = (lng2 - lng1) * 111320 * Math.cos((lat1 + lat2) * 0.5 * Math.PI / 180); lens[i] = lens[i - 1] + Math.hypot(dlat, dlng); }
  return lens;
}
function ptAtArcLen(coords, arcLens, targetM) {
  const n = coords.length; if (targetM <= 0) return coords[0].slice(); if (targetM >= arcLens[n - 1]) return coords[n - 1].slice();
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arcLens[mid] <= targetM) lo = mid; else hi = mid; }
  const segLen = arcLens[hi] - arcLens[lo], t = segLen > 1e-9 ? (targetM - arcLens[lo]) / segLen : 0;
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
}
function tangentAtArcLen(coords, arcLens, targetM, windowM) {
  const totalM = arcLens[arcLens.length - 1], adaptW = Math.max(30, Math.min(windowM, totalM * 0.15));
  const t1 = Math.max(0, targetM - adaptW), t2 = Math.min(totalM, targetM + adaptW);
  if (t2 - t1 < 1) return 0;
  const [lat1, lng1] = ptAtArcLen(coords, arcLens, t1), [lat2, lng2] = ptAtArcLen(coords, arcLens, t2);
  return Math.atan2(lng2 - lng1, lat2 - lat1);
}
function extractSubchain(coords, arcLens, startM, endM) {
  const n = coords.length, totalM = arcLens[n - 1]; startM = Math.max(0, startM); endM = Math.min(totalM, endM);
  if (endM - startM < 0.1) return [];
  const result = [ptAtArcLen(coords, arcLens, startM)];
  for (let i = 0; i < n; i++) { if (arcLens[i] > startM + 1e-6 && arcLens[i] < endM - 1e-6) result.push(coords[i].slice()); }
  const endPt = ptAtArcLen(coords, arcLens, endM), last = result[result.length - 1];
  if (Math.abs(last[0] - endPt[0]) > 1e-9 || Math.abs(last[1] - endPt[1]) > 1e-9) result.push(endPt);
  return result;
}
function drawPolylineOnGlobe(Cesium, viewer, latlngs, color, width, prims, allEnts, minorEnts, isMajor) {
  if (!latlngs || latlngs.length < 2) return;
  const positions = latlngs.map(([lat, lng]) => Cesium.Cartographic.toCartesian(Cesium.Cartographic.fromDegrees(lng, lat)));
  try { const prim = new Cesium.GroundPolylinePrimitive({ geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.GroundPolylineGeometry({ positions, width }), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) } }), appearance: new Cesium.PolylineColorAppearance(), classificationType: Cesium.ClassificationType.TERRAIN, asynchronous: false }); viewer.scene.primitives.add(prim); prims.push(prim); }
  catch (_) { const ent = viewer.entities.add({ polyline: { positions: latlngs.map(([lat, lng]) => Cesium.Cartesian3.fromDegrees(lng, lat)), width, material: color, clampToGround: true } }); allEnts.push(ent); if (!isMajor) minorEnts.push(ent); }
}
function placeLabelOnGlobe(Cesium, viewer, lat, lng, angle, lv, isMajor, cesColor, allEnts, minorEnts) {
  let rot = -angle; if (rot > Math.PI / 2) rot -= Math.PI; if (rot < -Math.PI / 2) rot += Math.PI;
  const position = Cesium.Cartesian3.fromDegrees(lng, lat, lv + 0.5);
  const le = viewer.entities.add({
    position,
    label: { text: `${Math.round(lv)}`, font: isMajor ? "bold 12px Arial,sans-serif" : "10px Arial,sans-serif", fillColor: cesColor, outlineColor: Cesium.Color.WHITE, outlineWidth: isMajor ? 4 : 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, showBackground: false, rotation: rot, alignedAxis: Cesium.Cartesian3.ZERO, heightReference: Cesium.HeightReference.NONE, eyeOffset: new Cesium.Cartesian3(0, 0, -50), pixelOffset: new Cesium.Cartesian2(0, 0), scaleByDistance: isMajor ? new Cesium.NearFarScalar(200, 1.6, 40000, 0.5) : new Cesium.NearFarScalar(150, 1.3, 20000, 0.4), translucencyByDistance: isMajor ? new Cesium.NearFarScalar(300, 1.0, 60000, 0.0) : new Cesium.NearFarScalar(200, 1.0, 18000, 0.0) },
  });
  allEnts.push(le); if (!isMajor) minorEnts.push(le);
}
function renderChainQGIS(Cesium, viewer, rawCoords, lv, isMajor, labelGapMeters, labelSpacingMeters, minChainMeters, cesLineColor, cesLabelColor, lineWidth, prims, allEnts, minorEnts, splineSteps = 4, dpEps = 0.00003) {
  const splined = splineSmooth(rawCoords, splineSteps);
  const coords = dpEps > 0 ? douglasPeucker(splined, dpEps) : splined;
  if (coords.length < 2) return;
  const arcLens = buildArcLens(coords), totalM = arcLens[arcLens.length - 1];
  if (totalM < minChainMeters) return;
  const gapHalf = labelGapMeters / 2, minLabelChain = labelGapMeters * 3, labelPositions = [];
  if (totalM >= minLabelChain) {
    labelPositions.push(totalM / 2);
    if (labelSpacingMeters > 0 && totalM > labelSpacingMeters * 1.5) {
      const count = Math.floor(totalM / labelSpacingMeters), step = totalM / (count + 1);
      for (let i = 1; i <= count; i++) { const pos = i * step; const crowded = labelPositions.some(p => Math.abs(p - pos) < labelSpacingMeters * 0.4); if (!crowded && pos > gapHalf && pos < totalM - gapHalf) labelPositions.push(pos); }
    }
  }
  labelPositions.sort((a, b) => a - b);
  if (labelPositions.length === 0) { drawPolylineOnGlobe(Cesium, viewer, coords, cesLineColor, lineWidth, prims, allEnts, minorEnts, isMajor); return; }
  let cursor = 0;
  for (const labelPos of labelPositions) {
    const gapStart = Math.max(cursor, labelPos - gapHalf), gapEnd = Math.min(totalM, labelPos + gapHalf);
    if (gapStart - cursor > 0.5) { const seg = extractSubchain(coords, arcLens, cursor, gapStart); drawPolylineOnGlobe(Cesium, viewer, seg, cesLineColor, lineWidth, prims, allEnts, minorEnts, isMajor); }
    const [lat, lng] = ptAtArcLen(coords, arcLens, labelPos), angle = tangentAtArcLen(coords, arcLens, labelPos, 150);
    placeLabelOnGlobe(Cesium, viewer, lat, lng, angle, lv, isMajor, cesLabelColor, allEnts, minorEnts);
    cursor = gapEnd;
  }
  if (totalM - cursor > 0.5) { const seg = extractSubchain(coords, arcLens, cursor, totalM); drawPolylineOnGlobe(Cesium, viewer, seg, cesLineColor, lineWidth, prims, allEnts, minorEnts, isMajor); }
}
function renderContours(Cesium, viewer, elevGrid, opts, poly = null) {
  const { interval = 10, majorEvery = 50, minorColor = "#966F33", majorColor = "#6B3D00", opacity = 0.88, labelSpacingMeters = 800, labelGapMeters = 60, minChainMeters = 60, smoothPasses = 1, upsampleFactor = 6, splineSteps = 4, dpEps = 0.00003, contourPalette = "Classic Brown" } = opts;
  const { rows, cols, bbox, min: minE, max: maxE } = elevGrid;
  const smoothed = smoothPasses > 0 ? gaussianSmooth(elevGrid.grid, rows, cols, smoothPasses) : elevGrid.grid;
  const factor = Math.max(1, Math.min(8, upsampleFactor));
  const { grid: hiGrid, rows: hiRows, cols: hiCols } = factor > 1 ? upsampleGrid(smoothed, rows, cols, factor) : { grid: smoothed, rows, cols };
  const levels = []; for (let lv = Math.ceil(minE / interval) * interval; lv <= maxE + 1e-6; lv += interval) levels.push(parseFloat(lv.toFixed(6)));
  if (!levels.length) return { primitives: [], entities: [], count: 0, dispose: () => { } };
  const palette = CONTOUR_PALETTES[contourPalette], levelRange = maxE - minE;
  function getLevelCesiumColor(lv, isMajor) {
    if (!palette) { const hex = isMajor ? majorColor : minorColor; const c = Cesium.Color.fromCssColorString(hex); return { line: c.withAlpha(isMajor ? opacity : opacity * 0.72), label: c }; }
    const t = levelRange > 0 ? (lv - minE) / levelRange : 0.5; const [r, g, b] = interpolatePalette(t, palette);
    return { line: new Cesium.Color(r / 255, g / 255, b / 255, isMajor ? opacity : opacity * 0.72), label: new Cesium.Color(r / 255, g / 255, b / 255, 1.0) };
  }
  const rawSegs = marchingSquares(hiGrid, hiRows, hiCols, levels), prims = [], allEnts = [], minorEnts = [], hasClip = poly && poly.length >= 3;
  levels.forEach(lv => {
    const roundedLv = Math.round(lv), isMajor = majorEvery > 0 && (roundedLv % majorEvery === 0 || Math.abs(roundedLv % majorEvery - majorEvery) < 0.5);
    const lineWidth = isMajor ? 2.5 : 1.2; const { line: cesLineColor, label: cesLabelColor } = getLevelCesiumColor(lv, isMajor);
    stitchSegments(rawSegs[lv] || []).forEach(chain => {
      if (chain.length < 2) return; const latlngs = chain.map(([rF, cF]) => gridToLatLng(rF, cF, bbox, hiRows, hiCols));
      const subs = hasClip ? clipChain(latlngs, poly) : [latlngs];
      subs.forEach(sub => { if (!sub || sub.length < 2) return; renderChainQGIS(Cesium, viewer, sub, lv, isMajor, labelGapMeters, labelSpacingMeters, minChainMeters, cesLineColor, cesLabelColor, lineWidth, prims, allEnts, minorEnts, splineSteps, dpEps); });
    });
  });
  const labelEnts = allEnts.filter(e => e.label);
  function updateDepthTest() { try { const dist = viewer.scene.mode === Cesium.SceneMode.SCENE3D ? Number.POSITIVE_INFINITY : 0; labelEnts.forEach(e => { try { if (!e.isDestroyed?.() && e.label) e.label.disableDepthTestDistance = dist; } catch (_) { } }); } catch (_) { } }
  let camListener = null, morphListener = null;
  try { camListener = viewer.camera.changed.addEventListener(() => { try { const alt = viewer.camera.positionCartographic?.height ?? 99999; const show = alt < 18000; minorEnts.forEach(e => { try { if (!e.isDestroyed?.()) e.show = show; } catch (_) { } }); } catch (_) { } }); } catch (_) { }
  try { morphListener = viewer.scene.morphComplete.addEventListener(updateDepthTest); } catch (_) { }
  updateDepthTest();
  function dispose() { try { if (camListener) viewer.camera.changed.removeEventListener(camListener); } catch (_) { } try { if (morphListener) viewer.scene.morphComplete.removeEventListener(morphListener); } catch (_) { } }
  return { primitives: prims, entities: allEnts, count: prims.length + allEnts.filter(e => e.polyline).length, dispose };
}
function renderShapefileContours(Cesium, viewer, geoJson, opts) {
  const { majorEvery = 100, minorColor = "#966F33", majorColor = "#6B3D00", opacity = 0.88, labelSpacing = 800, labelGapMeters = 60, minChainMeters = 60, splineSteps = 4, dpEps = 0.00003, poly = null, contourPalette = "Classic Brown" } = opts;
  const prims = [], allEnts = [], minorEnts = [], hasClip = poly && poly.length >= 3;
  const elevs = geoJson.features.map(f => f.properties.ELEV ?? 0), minE = Math.min(...elevs), maxE = Math.max(...elevs), levelRange = maxE - minE;
  const palette = CONTOUR_PALETTES[contourPalette];
  function getLevelCesiumColor(lv, isMajor) {
    if (!palette) { const hex = isMajor ? majorColor : minorColor; const c = Cesium.Color.fromCssColorString(hex); return { line: c.withAlpha(isMajor ? opacity : opacity * 0.72), label: c }; }
    const t = levelRange > 0 ? (lv - minE) / levelRange : 0.5; const [r, g, b] = interpolatePalette(t, palette);
    return { line: new Cesium.Color(r / 255, g / 255, b / 255, isMajor ? opacity : opacity * 0.72), label: new Cesium.Color(r / 255, g / 255, b / 255, 1.0) };
  }
  for (const feat of geoJson.features) {
    const elev = feat.properties.ELEV ?? feat.properties.elevation_m ?? 0, isMajor = majorEvery > 0 && Math.round(elev) % majorEvery === 0;
    const latlngs = feat.geometry.coordinates.map(([lng, lat]) => [lat, lng]), lineWidth = isMajor ? 2.5 : 1.2;
    const { line: cesLineColor, label: cesLabelColor } = getLevelCesiumColor(elev, isMajor);
    const subs = hasClip ? clipChain(latlngs, poly) : [latlngs];
    subs.forEach(sub => { if (sub.length >= 2) renderChainQGIS(Cesium, viewer, sub, elev, isMajor, labelGapMeters, labelSpacing, minChainMeters, cesLineColor, cesLabelColor, lineWidth, prims, allEnts, minorEnts, splineSteps, dpEps); });
  }
  const labelEnts = allEnts.filter(e => e.label);
  function updateDepthTest() { try { const dist = viewer.scene.mode === Cesium.SceneMode.SCENE3D ? Number.POSITIVE_INFINITY : 0; labelEnts.forEach(e => { try { if (!e.isDestroyed?.() && e.label) e.label.disableDepthTestDistance = dist; } catch (_) { } }); } catch (_) { } }
  let camListener = null, morphListener = null;
  try { camListener = viewer.camera.changed.addEventListener(() => { try { const alt = viewer.camera.positionCartographic?.height ?? 99999; const show = alt < 18000; minorEnts.forEach(e => { try { if (!e.isDestroyed?.()) e.show = show; } catch (_) { } }); } catch (_) { } }); } catch (_) { }
  try { morphListener = viewer.scene.morphComplete.addEventListener(updateDepthTest); } catch (_) { }
  updateDepthTest();
  function dispose() { try { if (camListener) viewer.camera.changed.removeEventListener(camListener); } catch (_) { } try { if (morphListener) viewer.scene.morphComplete.removeEventListener(morphListener); } catch (_) { } }
  return { primitives: prims, entities: allEnts, count: prims.length + allEnts.filter(e => e.polyline).length, dispose };
}

async function renderDEM(Cesium, viewer, elevGrid, opts, poly = null, layerRef = null) {
  const { colorRamp = DEFAULT_RAMP, opacity = 0.85, hillshadeStrength = 0.65, hillshadeMode = "multi", stretchMode = "local" } = opts;
  if (layerRef?.current) { try { viewer.imageryLayers.remove(layerRef.current, true); } catch (_) { } layerRef.current = null; }
  const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;
  const { stretchMin, stretchMax } = computeStretchRange(grid, rows, cols, minE, maxE, stretchMode, 2);
  const stretchRange = stretchMax - stretchMin;
  const OS = 12, W = Math.min((cols - 1) * OS + 1, 4096) | 0, H = Math.min((rows - 1) * OS + 1, 4096) | 0;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"), imgData = ctx.createImageData(W, H), px = imgData.data;
  const latSpan = bbox.maxLat - bbox.minLat, lngSpan = bbox.maxLng - bbox.minLng, midLat = (bbox.minLat + bbox.maxLat) / 2;
  const cellM = Math.max(1, ((rows > 1 ? latSpan / (rows - 1) * 111320 : 100) + (cols > 1 ? lngSpan / (cols - 1) * 111320 * Math.cos(midLat * Math.PI / 180) : 100)) / 2);
  const hsGrid = (hillshadeStrength > 0 && hillshadeMode !== "off") ? Array.from({ length: rows }, (_, r) => Float32Array.from({ length: cols }, (_, c) => hillshadeMode === "multi" ? computeMultiHS(grid, rows, cols, r, c, cellM) : computeHS(grid, rows, cols, r, c, cellM))) : null;
  const hasClip = poly && poly.length >= 3;
  const alphaMask = hasClip ? buildAlphaMask(W, H, poly, bbox, rows, cols) : null;
  const CHUNK = 40000, totalPx = W * H;
  for (let start = 0; start < totalPx; start += CHUNK) {
    if (start > 0) await new Promise(r => setTimeout(r, 0));
    const end = Math.min(start + CHUNK, totalPx);
    for (let idx = start; idx < end; idx++) {
      const qx = idx % W, py = Math.floor(idx / W), i4 = idx * 4;
      const rF = H > 1 ? py * (rows - 1) / (H - 1) : 0, cF = W > 1 ? qx * (cols - 1) / (W - 1) : 0;
      const ea = hasClip ? sampleAlphaMask(alphaMask, W, H, qx, py) : 1;
      if (ea <= 0.01) { px[i4 + 3] = 0; continue; }
      const elev = bicubicSample(grid, rows, cols, rF, cF); if (isNaN(elev)) { px[i4 + 3] = 0; continue; }
      const t = stretchRange > 0.5 ? Math.max(0, Math.min(1, (elev - stretchMin) / stretchRange)) : 0.5;
      let [r, g, b] = elevToRGB(t, colorRamp);
      if (hsGrid) {
        const ri = Math.max(0, Math.min(rows - 1, Math.round(rF))), ci = Math.max(0, Math.min(cols - 1, Math.round(cF)));
        const hs = hsGrid[ri][ci], str = Math.min(hillshadeStrength, 0.85);
        const f = (1.0 - str * 0.5) + hs * str * 0.5;
        r = Math.max(0, Math.min(255, Math.round(r * f)));
        g = Math.max(0, Math.min(255, Math.round(g * f)));
        b = Math.max(0, Math.min(255, Math.round(b * f)));
      }
      px[i4] = r; px[i4 + 1] = g; px[i4 + 2] = b; px[i4 + 3] = Math.round(opacity * ea * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const imageUrl = await new Promise(res => { try { cv.toBlob(blob => blob ? res(URL.createObjectURL(blob)) : res(cv.toDataURL()), "image/png"); } catch { res(cv.toDataURL()); } });
  const rect = new Cesium.Rectangle(Cesium.Math.toRadians(bbox.minLng), Cesium.Math.toRadians(bbox.minLat), Cesium.Math.toRadians(bbox.maxLng), Cesium.Math.toRadians(bbox.maxLat));
  let provider;
  try { provider = new Cesium.SingleTileImageryProvider({ url: imageUrl, rectangle: rect, tileWidth: W, tileHeight: H }); }
  catch (_) { try { provider = new Cesium.SingleTileImageryProvider(imageUrl, rect); } catch (e) { console.error(e); return null; } }
  const layer = viewer.imageryLayers.addImageryProvider(provider); layer.alpha = opacity;
  try { let idx = viewer.imageryLayers.indexOf?.(layer) ?? viewer.imageryLayers.length - 1; for (let i = idx; i > 1; i--) viewer.imageryLayers.lower(layer); } catch (_) { }
  if (layerRef) layerRef.current = layer; return layer;
}

function bboxKey(b) { return b ? `${b.minLat.toFixed(6)},${b.maxLat.toFixed(6)},${b.minLng.toFixed(6)},${b.maxLng.toFixed(6)}` : "null"; }

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT — v35 + Universal KML Parser + Fixed Shapefile Export
═══════════════════════════════════════════════════════════════════════ */
export default function CesiumDEMContourPanel({ viewer, Cesium, bbox, kmlPolygon = null, visible, onClose, kmlName = "area" }) {
  const [tab, setTab] = useState("dem");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("info");
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elevGrid, setElevGrid] = useState(null);
  const [colorRamp, setColorRamp] = useState(DEFAULT_RAMP);
  const [demOpacity, setDemOpacity] = useState(0.92);
  const [hillshadeStrength, setHillshadeStrength] = useState(0.65);
  const [hillshadeMode, setHillshadeMode] = useState("multi");
  const [stretchMode, setStretchMode] = useState("local");
  const [gridRes, setGridRes] = useState(140);
  const [hasDEM, setHasDEM] = useState(false);
  const [demVisible, setDemVisible] = useState(true);
  const [stretchDisplay, setStretchDisplay] = useState(null);
  const [aspectInfo, setAspectInfo] = useState(null);
  const [rampAutoSelected, setRampAutoSelected] = useState(false);
  const [stretchAutoSelected, setStretchAutoSelected] = useState(false);

  const [contourInterval, setContourInterval] = useState(5);
  const [majorEvery, setMajorEvery] = useState(25);
  const [minorColor, setMinorColor] = useState("#966F33");
  const [majorColor, setMajorColor] = useState("#6B3D00");
  const [hasContour, setHasContour] = useState(false);
  const [contourVisible, setContourVisible] = useState(true);
  const [contourCount, setContourCount] = useState(0);
  const [labelSpacing, setLabelSpacing] = useState(500);
  const [labelGap, setLabelGap] = useState(50);
  const [smoothPasses, setSmoothPasses] = useState(1);
  const [upsampleFactor, setUpsampleFactor] = useState(6);
  const [splineSteps, setSplineSteps] = useState(4);
  const [minChainM, setMinChainM] = useState(40);
  const [contourPalette, setContourPalette] = useState("QGIS Rainbow");
  const [shpFile, setShpFile] = useState(null);
  const [dbfFile, setDbfFile] = useState(null);
  const [shpGeoJson, setShpGeoJson] = useState(null);
  const [hasShpContour, setHasShpContour] = useState(false);
  const [shpContourVisible, setShpContourVisible] = useState(true);
  const [shpContourCount, setShpContourCount] = useState(0);
  const [shpMajorEvery, setShpMajorEvery] = useState(100);
  const [shpMinorColor, setShpMinorColor] = useState("#966F33");
  const [shpMajorColor, setShpMajorColor] = useState("#6B3D00");
  const [shpLabelSpacing, setShpLabelSpacing] = useState(800);
  const [shpLabelGap, setShpLabelGap] = useState(60);
  const [shpPalette, setShpPalette] = useState("QGIS Rainbow");

  // ── NEW: inline KML loader state ─────────────────────────────────────
  const [kmlLoadStatus, setKmlLoadStatus] = useState("");
  const [kmlLoadedName, setKmlLoadedName] = useState("");

  const shpContourRef = useRef({ primitives: [], entities: [], dispose: () => { } });
  const abortRef = useRef(null);
  const demLayerRef = useRef(null);
  const contourRef = useRef({ primitives: [], entities: [], dispose: () => { } });
  const elevGridRef = useRef(null);
  const optsRef = useRef({ colorRamp, demOpacity, hillshadeStrength, hillshadeMode, stretchMode });
  const debounceRef = useRef(null);
  const polyRef = useRef(kmlPolygon);
  const prevBboxKeyRef = useRef(null);
  const prevPolySigRef = useRef(null);

  // ── NEW: internal KML polygon state (overrides prop if user loads inline)
  const [internalKmlPolygon, setInternalKmlPolygon] = useState(null);
  const [internalBbox, setInternalBbox] = useState(null);

  // Effective values: prefer internally loaded KML over prop
  const effectiveKmlPolygon = internalKmlPolygon ?? kmlPolygon;
  const effectiveBbox = internalBbox ?? bbox;
  const effectiveKmlName = kmlLoadedName || kmlName;

  useEffect(() => { polyRef.current = effectiveKmlPolygon; }, [effectiveKmlPolygon]);
  useEffect(() => { optsRef.current = { colorRamp, demOpacity, hillshadeStrength, hillshadeMode, stretchMode }; }, [colorRamp, demOpacity, hillshadeStrength, hillshadeMode, stretchMode]);

  useEffect(() => {
    if (!effectiveBbox) return;
    const key = bboxKey(effectiveBbox);
    const polySig = polygonSignature(effectiveKmlPolygon);
    const bboxChanged = !!prevBboxKeyRef.current && prevBboxKeyRef.current !== key;
    const polyChanged = prevPolySigRef.current !== null && prevPolySigRef.current !== polySig;
    if (bboxChanged || polyChanged) {
      clearDEMLayer(); clearContourLayers();
      setElevGrid(null); elevGridRef.current = null;
      setHasDEM(false); setHasContour(false);
      setStretchDisplay(null); setAspectInfo(null);
      setRampAutoSelected(false); setStretchAutoSelected(false);
      setStatus("📍 New area detected — please fetch elevation for this KML.");
      setStatusType("info");
    }
    prevBboxKeyRef.current = key;
    prevPolySigRef.current = polySig;
  }, [effectiveBbox, effectiveKmlPolygon]); // eslint-disable-line

  useEffect(() => () => { clearTimeout(debounceRef.current); abortRef.current?.abort(); clearDEMLayer(); clearContourLayers(); clearShpContourLayers(); }, []);

  useEffect(() => {
    if (!hasDEM || !elevGridRef.current || !viewer || !Cesium) return;
    const capturedRamp = colorRamp, capturedOpacity = demOpacity, capturedHS = hillshadeStrength, capturedHSMode = hillshadeMode, capturedStretch = stretchMode;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await waitForGlobeReady(viewer);
      clearDEMLayer();
      const eg = elevGridRef.current; if (!eg) return;
      const sd = computeStretchRange(eg.grid, eg.rows, eg.cols, eg.min, eg.max, capturedStretch, 2);
      setStretchDisplay({ min: sd.stretchMin, max: sd.stretchMax, mode: capturedStretch });
      const clip = getClipPoly(eg, polyRef.current);
      const layer = await renderDEM(Cesium, viewer, eg, { colorRamp: capturedRamp, opacity: capturedOpacity, hillshadeStrength: capturedHS, hillshadeMode: capturedHSMode, stretchMode: capturedStretch }, clip, demLayerRef);
      if (layer) { demLayerRef.current = layer; setDemVisible(true); }
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [colorRamp, demOpacity, hillshadeStrength, hillshadeMode, stretchMode]); // eslint-disable-line

  function clearDEMLayer() { if (demLayerRef.current) { try { viewer?.imageryLayers?.remove(demLayerRef.current, true); } catch (_) { } demLayerRef.current = null; } }
  function clearContourLayers() { try { contourRef.current.dispose?.(); } catch (_) { } contourRef.current.primitives.forEach(p => { try { viewer?.scene?.primitives?.remove(p); } catch (_) { } }); contourRef.current.entities.forEach(e => { try { viewer?.entities?.remove(e); } catch (_) { } }); contourRef.current = { primitives: [], entities: [], dispose: () => { } }; }
  function clearShpContourLayers() { try { shpContourRef.current.dispose?.(); } catch (_) { } shpContourRef.current.primitives.forEach(p => { try { viewer?.scene?.primitives?.remove(p); } catch (_) { } }); shpContourRef.current.entities.forEach(e => { try { viewer?.entities?.remove(e); } catch (_) { } }); shpContourRef.current = { primitives: [], entities: [], dispose: () => { } }; }

  function resetForNewArea() {
    clearDEMLayer(); clearContourLayers(); clearShpContourLayers();
    setElevGrid(null); elevGridRef.current = null;
    setHasDEM(false); setHasContour(false); setHasShpContour(false);
    setStretchDisplay(null); setAspectInfo(null);
    setRampAutoSelected(false); setStretchAutoSelected(false);
    setInternalKmlPolygon(null); setInternalBbox(null);
    setKmlLoadStatus(""); setKmlLoadedName("");
    msg("Reset. Fetch elevation for current area.", "info");
  }

  const msg = (m, t = "info") => { setStatus(m); setStatusType(t); };

  /* ── NEW: inline KML file loader ──────────────────────────────────── */
  const handleKMLFileLoad = useCallback(async (file) => {
    if (!file) return;
    setKmlLoadStatus("Parsing KML…");
    try {
      const result = await loadKMLFile(file);
      if (!result.polygon) {
        setKmlLoadStatus(`❌ No polygon found in ${file.name}`);
        return;
      }
      setInternalKmlPolygon(result.polygon);
      setInternalBbox(result.bbox);
      setKmlLoadedName(file.name);
      setKmlLoadStatus(`✅ ${file.name} · ${result.polygon.length} vertices`);

      if (viewer && Cesium && result.bbox) {
        try {
          const b = result.bbox;
          viewer.camera.flyTo({
            destination: Cesium.Rectangle.fromDegrees(b.minLng - 0.005, b.minLat - 0.005, b.maxLng + 0.005, b.maxLat + 0.005),
            duration: 1.5,
          });
        } catch (_) { }
      }

      msg(`KML loaded: ${file.name} · ${result.polygon.length} pts · bbox set`, "ok");
    } catch (e) {
      setKmlLoadStatus(`❌ Error: ${e.message}`);
      msg("KML load error: " + e.message, "err");
    }
  }, [viewer, Cesium]); // eslint-disable-line

  const fetchElev = useCallback(async () => {
    if (!effectiveBbox) { msg("No bounding area defined. Load a KML or set bbox from parent.", "warn"); return; }
    const { rows, cols } = computeAspectGrid(effectiveBbox, gridRes);
    setAspectInfo({ rows, cols });
    const rawPoly = polyRef.current;
    const polyProvided = Array.isArray(rawPoly) && rawPoly.length > 0;
    const validPoly = isValidPolygon(rawPoly) ? rawPoly : null;
    if (polyProvided && !validPoly) {
      msg("⚠ KML polygon invalid — fetching without boundary clip.", "warn");
    }
    const polySig = polygonSignature(validPoly);
    const key = cacheKey(effectiveBbox, rows, cols, polySig);
    if (_elvCache[key]) {
      const eg = _elvCache[key];
      setElevGrid(eg); elevGridRef.current = eg;
      const range = eg.max - eg.min;
      applyAutoSettings(range);
      msg(`Cache hit · ${Math.round(eg.min)}m → ${Math.round(eg.max)}m · grid ${eg.cols}×${eg.rows}`, "ok");
      return;
    }
    abortRef.current = new AbortController(); setIsProcessing(true); setProgress(5);
    msg(`Fetching ${cols}×${rows} grid (aspect-aware)…`, "info");
    try {
      const rawGrid = await fetchElevationGrid(effectiveBbox, rows, cols, (done, total) => { setProgress(5 + Math.round(done / total * 82)); msg(`Fetching… ${done}/${total} (${Math.round(done / total * 100)}%)`, "info"); }, abortRef.current.signal);
      if (abortRef.current.signal.aborted) { msg("Cancelled.", "warn"); setIsProcessing(false); setProgress(0); return; }
      msg("Interpolating DEM grid…", "info"); setProgress(90);
      let nanCount = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isNaN(rawGrid[r][c])) nanCount++;
      const fillPct = Math.round((nanCount / (rows * cols)) * 100);
      fillNaN(rawGrid, rows, cols);
      let minE = Infinity, maxE = -Infinity;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const v = rawGrid[r][c]; if (!isNaN(v) && isFinite(v)) { if (v < minE) minE = v; if (v > maxE) maxE = v; } }
      if (!isFinite(minE)) { msg("No valid elevation data.", "err"); setIsProcessing(false); setProgress(0); return; }
      const eg = { grid: rawGrid, rows, cols, bbox: effectiveBbox, min: minE, max: maxE, clipPoly: validPoly, fillPct };
      _elvCache[key] = eg; setElevGrid(eg); elevGridRef.current = eg;
      const range = maxE - minE;
      applyAutoSettings(range);
      setProgress(100);
      const fillWarn = fillPct > 15 ? ` · ⚠ ${fillPct}% interpolated` : fillPct > 0 ? ` · ${fillPct}% interpolated` : "";
      msg(`Done · ${cols}×${rows} pts · ${Math.round(minE)}m→${Math.round(maxE)}m · range ${Math.round(range)}m` + (validPoly ? " · KML clip" : polyProvided ? " · clip skipped" : "") + fillWarn, fillPct > 15 ? "warn" : "ok");
    } catch (e) { if (e.name !== "AbortError") { msg("Error: " + e.message, "err"); console.error(e); } }
    finally { setIsProcessing(false); setTimeout(() => setProgress(0), 1200); }
  }, [effectiveBbox, gridRes]);

  function applyAutoSettings(range) {
    const suggestedRamp = autoSuggestRamp(range);
    const suggestedStretch = autoSuggestStretch(range);
    const suggestedHS = range < 200 ? 0.75 : range < 400 ? 0.65 : range < 700 ? 0.50 : 0.35;
    const suggestedInterval = range < 30 ? 1 : range < 80 ? 2 : range < 150 ? 5 : range < 300 ? 5 : range < 600 ? 10 : 20;
    const suggestedMajorEvery = suggestedInterval * 5;
    const suggestedSmooth = range < 300 ? 1 : 2;
    const suggestedUpsample = range < 300 ? 6 : 4;
    setColorRamp(suggestedRamp);
    setStretchMode(suggestedStretch);
    setHillshadeStrength(suggestedHS);
    setHillshadeMode("multi");
    setContourInterval(suggestedInterval);
    setMajorEvery(suggestedMajorEvery);
    setSmoothPasses(suggestedSmooth);
    setUpsampleFactor(suggestedUpsample);
    setRampAutoSelected(true);
    setStretchAutoSelected(true);
  }

  const forceRefetchElev = useCallback(() => {
    if (!effectiveBbox) { msg("No bounding area defined.", "warn"); return; }
    const { rows, cols } = computeAspectGrid(effectiveBbox, gridRes);
    const validPoly = isValidPolygon(polyRef.current) ? polyRef.current : null;
    delete _elvCache[cacheKey(effectiveBbox, rows, cols, polygonSignature(validPoly))];
    fetchElev();
  }, [effectiveBbox, gridRes, fetchElev]);

  const doRenderDEM = useCallback(async () => {
    const eg = elevGridRef.current || elevGrid; if (!eg || !viewer || !Cesium) { msg("Fetch elevation first.", "warn"); return; }
    msg("Waiting for terrain to load…", "info");
    await waitForGlobeReady(viewer);
    msg("Rendering DEM…", "info"); clearDEMLayer();
    const sd = computeStretchRange(eg.grid, eg.rows, eg.cols, eg.min, eg.max, stretchMode, 2);
    setStretchDisplay({ min: sd.stretchMin, max: sd.stretchMax, mode: stretchMode });
    const clip = getClipPoly(eg, polyRef.current);
    const layer = await renderDEM(Cesium, viewer, eg, { colorRamp, opacity: demOpacity, hillshadeStrength, hillshadeMode, stretchMode }, clip, demLayerRef);
    if (!layer) { msg("DEM render failed.", "err"); return; }
    demLayerRef.current = layer; setHasDEM(true); setDemVisible(true);
    msg(`DEM rendered · ${colorRamp} · ${stretchMode} · ${Math.round(sd.stretchMin)}–${Math.round(sd.stretchMax)}m`, "ok");
  }, [elevGrid, viewer, Cesium, colorRamp, demOpacity, hillshadeStrength, hillshadeMode, stretchMode]);

  const doRenderContours = useCallback(async () => {
    const eg = elevGridRef.current || elevGrid; if (!eg || !viewer || !Cesium) { msg("Fetch elevation first.", "warn"); return; }
    msg("Waiting for terrain to load…", "info");
    await waitForGlobeReady(viewer);
    msg("Generating contours…", "info"); clearContourLayers();
    const clip = getClipPoly(eg, polyRef.current);
    const result = renderContours(Cesium, viewer, eg, { interval: contourInterval, majorEvery, minorColor, majorColor, opacity: 0.88, labelSpacingMeters: labelSpacing, labelGapMeters: labelGap, minChainMeters: minChainM, smoothPasses, upsampleFactor, splineSteps, dpEps: 0.00003, contourPalette }, clip);
    contourRef.current = result; setHasContour(true); setContourVisible(true); setContourCount(result.count);
    msg(result.count > 0 ? `✓ ${result.count} contour lines · ${contourInterval}m interval` : "0 contours — try smaller interval or Force Refetch.", result.count > 0 ? "ok" : "warn");
  }, [elevGrid, viewer, Cesium, contourInterval, majorEvery, minorColor, majorColor, labelSpacing, labelGap, smoothPasses, upsampleFactor, splineSteps, minChainM, contourPalette]);

  const doParseShapefile = useCallback(async () => {
    if (!shpFile || !dbfFile) { msg("Select both .shp and .dbf files.", "warn"); return; }
    try {
      msg("Parsing shapefile…", "info");
      const [shpBuf, dbfBuf] = await Promise.all([shpFile.arrayBuffer(), dbfFile.arrayBuffer()]);
      const gj = parseShapefile(shpBuf, dbfBuf);
      setShpGeoJson(gj);
      const elevs = [...new Set(gj.features.map(f => f.properties.ELEV))].sort((a, b) => a - b);
      msg(`✓ ${gj.features.length} lines · ${elevs[0]}m→${elevs[elevs.length - 1]}m`, "ok");
    } catch (e) { msg("Parse error: " + e.message, "err"); console.error(e); }
  }, [shpFile, dbfFile]);

  const doRenderShapefileContours = useCallback(async () => {
    if (!shpGeoJson || !viewer || !Cesium) { msg("Parse shapefile first.", "warn"); return; }
    msg("Waiting for terrain to load…", "info");
    await waitForGlobeReady(viewer);
    msg("Rendering shapefile contours…", "info"); clearShpContourLayers();
    const clip = isValidPolygon(polyRef.current) ? polyRef.current : null;
    const result = renderShapefileContours(Cesium, viewer, shpGeoJson, { majorEvery: shpMajorEvery, minorColor: shpMinorColor, majorColor: shpMajorColor, opacity: 0.88, labelSpacing: shpLabelSpacing, labelGapMeters: shpLabelGap, minChainMeters: 60, splineSteps: 4, dpEps: 0.00003, poly: clip, contourPalette: shpPalette });
    shpContourRef.current = result; setHasShpContour(true); setShpContourVisible(true); setShpContourCount(result.count);
    msg(`✓ ${result.count} shapefile contour lines`, "ok");
    try { const coords = shpGeoJson.features.flatMap(f => f.geometry.coordinates); const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]); viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(Math.min(...lngs) - .005, Math.min(...lats) - .005, Math.max(...lngs) + .005, Math.max(...lats) + .005), duration: 1.5 }); } catch (_) { }
  }, [shpGeoJson, viewer, Cesium, shpMajorEvery, shpMinorColor, shpMajorColor, shpLabelSpacing, shpLabelGap, shpPalette]);

  function toggleDEM() { if (!demLayerRef.current) return; demLayerRef.current.show = !demLayerRef.current.show; setDemVisible(demLayerRef.current.show); }
  function toggleContours() { const show = !contourVisible; contourRef.current.primitives.forEach(p => { try { p.show = show; } catch (_) { } }); contourRef.current.entities.forEach(e => { if (e.polyline) e.polyline.show = show; if (e.label) e.show = show; }); setContourVisible(show); }
  function toggleShpContours() { const show = !shpContourVisible; shpContourRef.current.primitives.forEach(p => { try { p.show = show; } catch (_) { } }); shpContourRef.current.entities.forEach(e => { if (e.polyline) e.polyline.show = show; if (e.label) e.show = show; }); setShpContourVisible(show); }

  function exportTIFF() { const eg = elevGridRef.current || elevGrid; if (!eg) { msg("No data.", "warn"); return; } try { dlBlob(buildGeoTIFF(eg), effectiveKmlName.replace(/\.[^.]+$/, "") + "_dem.tif", "image/tiff"); msg("GeoTIFF exported.", "ok"); } catch (e) { msg("Export error: " + e.message, "err"); } }
  function exportCSV() { const eg = elevGridRef.current || elevGrid; if (!eg) { msg("No data.", "warn"); return; } const { grid, rows, cols, bbox } = eg; const lines = ["lat,lng,elevation_m,elevation_ft"]; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const [lat, lng] = gridToLatLng(r, c, bbox, rows, cols); const e = grid[r][c]; lines.push(`${lat.toFixed(7)},${lng.toFixed(7)},${isNaN(e) ? "" : e.toFixed(2)},${isNaN(e) ? "" : (e * 3.28084).toFixed(2)}`); } dlBlob(new TextEncoder().encode(lines.join("\n")), effectiveKmlName.replace(/\.[^.]+$/, "") + "_dem.csv", "text/csv"); msg("CSV exported.", "ok"); }
  function exportGeoJSON() { const eg = elevGridRef.current || elevGrid; if (!eg) { msg("No data.", "warn"); return; } const clip = getClipPoly(eg, polyRef.current); const gj = buildContourGeoJSON(eg, contourInterval, majorEvery, clip); dlBlob(new TextEncoder().encode(JSON.stringify(gj, null, 2)), effectiveKmlName.replace(/\.[^.]+$/, "") + "_contours.geojson", "application/json"); msg("GeoJSON exported.", "ok"); }
  function exportShpGeoJSON() { if (!shpGeoJson) { msg("No shapefile data.", "warn"); return; } dlBlob(new TextEncoder().encode(JSON.stringify(shpGeoJson, null, 2)), effectiveKmlName.replace(/\.[^.]+$/, "") + "_shp_contours.geojson", "application/json"); msg("Shapefile GeoJSON exported.", "ok"); }
  
  // ── FIXED: Shapefile Export using new functions ──
  function exportSHP() {
    const eg = elevGridRef.current || elevGrid; 
    if (!eg) { msg("No elevation data.", "warn"); return; }
    
    // Show progress
    msg("Building contour Shapefile…", "info");
    
    try {
      // Build contour GeoJSON
      const clip = getClipPoly(eg, polyRef.current);
      const gj = buildContourGeoJSON(eg, contourInterval, majorEvery, clip);
      
      if (!gj.features.length) {
        msg("No contours found to export.", "warn");
        return;
      }
      
      // Use the fixed export function
      const baseName = effectiveKmlName.replace(/\.[^.]+$/, "") + "_contours_" + contourInterval + "m";
      
      // Show progress
      msg(`Exporting ${gj.features.length} contours as Shapefile…`, "info");
      
      // Call the fixed export function
      exportContourShapefile(gj.features, baseName, (progress) => {
        // Update status with progress
        if (progress < 100) {
          msg(`Building Shapefile… ${progress}%`, "info");
        }
      }).then((zipBlob) => {
        // Download the ZIP
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = baseName.replace(/[^a-zA-Z0-9_]/g, "_") + "_shapefile.zip";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        msg(`✓ Shapefile ZIP exported (${gj.features.length} contours).`, "ok");
      }).catch((err) => {
        console.error("Shapefile export failed:", err);
        msg("Export failed: " + err.message, "err");
      });
      
    } catch (e) {
      console.error("Shapefile export failed:", e);
      msg("Export failed: " + e.message, "err");
    }
  }

  /* ── parseShapefile ──────────────────────────────────────────────────── */
  function parseShapefile(shpBuf, dbfBuf) {
    const shp = new DataView(shpBuf), dbfU8 = new Uint8Array(dbfBuf), dbf = new DataView(dbfBuf);
    const numRecords = dbf.getInt32(4, true), headerSize = dbf.getUint16(8, true), recordSize = dbf.getUint16(10, true);
    const fields = []; let fpos = 32;
    while (fpos + 32 <= headerSize) { if (dbfU8[fpos] === 0x0D) break; const name = new TextDecoder('latin1').decode(dbfU8.slice(fpos, fpos + 11)).replace(/\x00/g, '').trim(); fields.push({ name, type: String.fromCharCode(dbfU8[fpos + 11]), len: dbfU8[fpos + 16], dec: dbfU8[fpos + 17] }); fpos += 32; }
    const td = new TextDecoder('latin1'), dbfRecords = [];
    for (let i = 0; i < numRecords; i++) { const off = headerSize + i * recordSize; let col = 1; const rec = {}; for (const f of fields) { rec[f.name] = td.decode(dbfU8.slice(off + col, off + col + f.len)).trim(); col += f.len; } dbfRecords.push(rec); }
    const features = []; let pos = 100, recIdx = 0;
    while (pos < shpBuf.byteLength - 8) { const contentLen = shp.getInt32(pos + 4, false) * 2; pos += 8; if (pos + contentLen > shpBuf.byteLength) break; const stype = shp.getInt32(pos, true); if (stype === 3) { const numParts = shp.getInt32(pos + 36, true), numPoints = shp.getInt32(pos + 40, true); const parts = []; for (let i = 0; i < numParts; i++) parts.push(shp.getInt32(pos + 44 + i * 4, true)); const ptsOff = pos + 44 + numParts * 4, points = []; for (let i = 0; i < numPoints; i++) { points.push([shp.getFloat64(ptsOff + i * 16, true), shp.getFloat64(ptsOff + i * 16 + 8, true)]); } const rec = dbfRecords[recIdx] || {}; const elev = parseFloat(rec.ELEV || rec.elev || rec.ELEVATION || rec.elevation || rec.Z || 0); for (let i = 0; i < parts.length; i++) { const start = parts[i], end = i + 1 < parts.length ? parts[i + 1] : points.length, segment = points.slice(start, end); if (segment.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: segment }, properties: { ELEV: elev } }); } } recIdx++; pos += contentLen; }
    return { type: "FeatureCollection", features };
  }

  if (!visible) return null;

  const F = { ui: "'DM Sans',system-ui,sans-serif", mono: "'JetBrains Mono','Courier New',monospace" };
  const C = { bg: "rgba(6,10,22,0.97)", sur: "rgba(255,255,255,0.04)", bor: "rgba(255,255,255,0.08)", tx: "#c8dff8", dim: "rgba(165,200,240,0.55)", blue: "#3b82f6", cyan: "#22d3c8", green: "#4ade80", amber: "#f5a623", red: "#f06060", violet: "#b89cf8", pink: "#f472b6" };
  const INTERVALS = [1, 2, 5, 10, 20, 25, 50, 100], MAJORS = [5, 10, 25, 50, 100, 200], SHP_MAJORS = [20, 40, 50, 100, 200];
  const sm = ({ ok: { color: C.green, icon: "✓" }, err: { color: C.red, icon: "✕" }, warn: { color: C.amber, icon: "⚠" }, info: { color: C.blue, icon: "›" } })[statusType] || { color: C.blue, icon: "›" };
  const rampCSS = n => (COLOR_RAMPS[n] || COLOR_RAMPS[DEFAULT_RAMP]).map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`).join(",");
  const paletteCSS = n => { const p = CONTOUR_PALETTES[n]; if (!p) return "linear-gradient(to right,#966F33,#6B3D00)"; return `linear-gradient(to right,${p.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`).join(",")})`; };
  const Btn = ({ color = C.blue, children, onClick, disabled, fullWidth = true }) => (
    <button onClick={onClick} disabled={disabled} style={{ width: fullWidth ? "100%" : "auto", padding: "9px 14px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", background: `${color}18`, border: `1px solid ${color}38`, color, fontSize: 11.5, fontWeight: 700, fontFamily: F.ui, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: disabled ? 0.35 : 1, transition: "all .12s" }}>{children}</button>
  );
  const RAMP_GROUPS = {
    "★ Best for Mining/Low-Relief": ["Mine / Open Pit", "Viridis", "Plasma", "Mine Survey"],
    "🌍 General Terrain": ["QGIS Standard", "Terrain Relief", "GeoXIS Terrain", "QGIS Hypsometric", "India Plains"],
    "🏔 Mountains/Large Range": ["SRTM Rainbow"],
    "🎨 Scientific": ["Magma", "Grayscale", "Grayscale Inv"],
  };

  const kmlPolyValid = isValidPolygon(effectiveKmlPolygon);
  const kmlPolyPresentButInvalid = Array.isArray(effectiveKmlPolygon) && effectiveKmlPolygon.length > 0 && !kmlPolyValid;
  const elevRange = elevGrid ? (elevGrid.max - elevGrid.min) : null;
  const isLowRelief = elevRange !== null && elevRange < 400;

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 310, zIndex: 5000, background: C.bg, backdropFilter: "blur(36px)", borderLeft: `1px solid ${C.bor}`, display: "flex", flexDirection: "column", fontFamily: F.ui, boxShadow: "-12px 0 48px rgba(0,0,0,.9)" }}>
      {/* ── Header ── */}
      <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${C.bor}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,rgba(59,130,246,.25),rgba(34,211,200,.25))", border: "1px solid rgba(59,130,246,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🏔</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.tx, fontWeight: 700, fontSize: 13 }}>3D DEM & Contours</div>
            <div style={{ color: C.dim, fontSize: 9, fontFamily: F.mono, marginTop: 1 }}>v35 · universal KML · local-stretch · fixed label-height</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 20, padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {/* ── UNIVERSAL KML LOADER ── */}
        <div style={{ background: "rgba(74,222,128,.05)", border: "1px solid rgba(74,222,128,.2)", borderRadius: 9, padding: "8px 10px", marginBottom: 6 }}>
          <div style={{ color: C.green, fontSize: 9, fontWeight: 700, marginBottom: 5 }}>📂 LOAD KML / KMZ (any software)</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 7, border: `1px dashed ${kmlLoadedName ? C.green : C.bor}`, cursor: "pointer", background: kmlLoadedName ? "rgba(74,222,128,.06)" : "transparent" }}>
            <span style={{ fontSize: 13 }}>{kmlLoadedName ? "✅" : "📁"}</span>
            <span style={{ color: kmlLoadedName ? C.green : C.dim, fontSize: 9, fontFamily: F.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {kmlLoadedName || "Click to load .kml or .kmz"}
            </span>
            <input
              type="file"
              accept=".kml,.kmz"
              onChange={e => handleKMLFileLoad(e.target.files?.[0])}
              style={{ display: "none" }}
            />
          </label>
          {kmlLoadStatus && (
            <div style={{ marginTop: 5, fontSize: 8, fontFamily: F.mono, color: kmlLoadStatus.startsWith("✅") ? C.green : kmlLoadStatus.startsWith("❌") ? C.red : C.amber, lineHeight: 1.4 }}>
              {kmlLoadStatus}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 8, color: C.dim, fontFamily: F.mono, opacity: 0.7 }}>
            Works with: Geoxis · QGIS · ArcGIS · Google Earth · Global Mapper
          </div>
        </div>

        {kmlPolyValid && <div style={{ background: "rgba(74,222,128,.07)", border: "1px solid rgba(74,222,128,.25)", borderRadius: 7, padding: "4px 9px", fontSize: 9, fontFamily: F.mono, color: C.green, marginBottom: 4 }}>✂ KML clip · {effectiveKmlPolygon.length} vertices {internalKmlPolygon ? "· loaded inline" : "· from parent"}</div>}
        {kmlPolyPresentButInvalid && <div style={{ background: "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.3)", borderRadius: 7, padding: "4px 9px", fontSize: 9, fontFamily: F.mono, color: C.amber, marginBottom: 4 }}>⚠ KML polygon invalid — clipping disabled</div>}
        {effectiveBbox && <div style={{ background: "rgba(255,255,255,.02)", border: `1px solid ${C.bor}`, borderRadius: 8, padding: "6px 9px", fontSize: 9, fontFamily: F.mono, color: C.dim, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px", marginBottom: 6 }}>
          <span>N {effectiveBbox.maxLat.toFixed(4)}°</span><span>S {effectiveBbox.minLat.toFixed(4)}°</span>
          <span>E {effectiveBbox.maxLng.toFixed(4)}°</span><span>W {effectiveBbox.minLng.toFixed(4)}°</span>
        </div>}
        {effectiveBbox && <button onClick={resetForNewArea} style={{ width: "100%", padding: "5px", borderRadius: 7, background: "rgba(240,96,96,.08)", border: "1px solid rgba(240,96,96,.25)", color: C.red, fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: F.ui }}>🔄 Reset for New Area / KML</button>}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.bor}`, flexShrink: 0 }}>
        {[["dem", "🏔 DEM"], ["contour", "📐 Calc"], ["shp", "📂 SHP"], ["export", "💾 Export"]].map(([id, lb]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "9px 2px", background: tab === id ? "rgba(59,130,246,.08)" : "transparent", border: "none", borderBottom: `2px solid ${tab === id ? C.blue : "transparent"}`, cursor: "pointer", fontSize: 9.5, fontWeight: 700, color: tab === id ? C.blue : C.dim, transition: "all .15s", fontFamily: F.ui }}>{lb}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 13px 24px", display: "flex", flexDirection: "column", gap: 10, scrollbarWidth: "thin", scrollbarColor: "rgba(59,130,246,.2) transparent" }}>

        {/* ════════════════════ DEM TAB ════════════════════ */}
        {tab === "dem" && <>
          <div style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(74,222,128,.05)", border: "1px solid rgba(74,222,128,.2)", color: C.green, fontSize: 9, lineHeight: 1.7 }}>
            <strong>✅ v35:</strong> Fixed contour labels misplacing on a newly-loaded KML (labels now use the contour's own elevation, not Cesium terrain) · Universal KML parser · Local stretch for flat terrain · Mine/Open Pit auto-ramp · 65% hillshade
          </div>

          {isLowRelief && (
            <div style={{ padding: "9px 11px", borderRadius: 9, background: "rgba(34,211,200,.06)", border: "1px solid rgba(34,211,200,.28)", color: C.cyan, fontSize: 9, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>ℹ Low-relief terrain · {Math.round(elevRange)}m range</div>
              <div style={{ opacity: .85, marginBottom: 6 }}>Auto: <strong>Local stretch</strong> + <strong>Mine/Open Pit</strong> + <strong>65% hillshade</strong>. Overrides:</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {["Viridis", "Plasma", "Magma"].map(n => <button key={n} onClick={() => { setColorRamp(n); setRampAutoSelected(false); }} style={{ padding: "3px 7px", borderRadius: 5, background: "rgba(34,211,200,.12)", border: "1px solid rgba(34,211,200,.35)", color: C.cyan, fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>{n}</button>)}
              </div>
            </div>
          )}

          {/* Stretch mode */}
          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em" }}>COLOR STRETCH</div>
              {stretchAutoSelected && <span style={{ fontSize: 8, fontFamily: F.mono, color: C.cyan, background: "rgba(34,211,200,.12)", border: "1px solid rgba(34,211,200,.3)", borderRadius: 4, padding: "1px 5px" }}>AUTO</span>}
            </div>
            <div style={{ fontSize: 8, color: C.amber, marginBottom: 5, fontFamily: F.mono, lineHeight: 1.4, padding: "3px 6px", background: "rgba(245,166,35,.07)", borderRadius: 5 }}>
              ★ Use <strong>Local</strong> for flat/mining terrain. StdDev = one-color-blob on low relief.
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
              {[["local", "Local ★", C.green], ["percentile", "Pctile", C.pink], ["stddev", "StdDev", C.amber], ["global", "Global", C.blue]].map(([id, lb, col]) => (
                <button key={id} onClick={() => { setStretchMode(id); setStretchAutoSelected(false); }} style={{ flex: "1 0 auto", padding: "7px 4px", borderRadius: 7, border: stretchMode === id ? `1px solid ${col}55` : `1px solid ${C.bor}`, background: stretchMode === id ? `${col}14` : C.sur, color: stretchMode === id ? col : C.dim, fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>{lb}</button>
              ))}
            </div>
            {stretchDisplay && <div style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,.03)", border: `1px solid ${C.bor}`, fontSize: 8, fontFamily: F.mono, color: C.dim }}>
              Active: <span style={{ color: C.cyan }}>{Math.round(stretchDisplay.min)}m → {Math.round(stretchDisplay.max)}m</span> <span style={{ opacity: .6 }}>({stretchDisplay.mode})</span>
            </div>}
          </div>

          {/* Grid resolution */}
          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>GRID DENSITY · {gridRes}² target</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: aspectInfo ? 6 : 0 }}>
              <input type="range" min={60} max={200} step={10} value={gridRes} onChange={e => setGridRes(+e.target.value)} disabled={isProcessing} style={{ flex: 1, accentColor: C.pink }} />
              <span style={{ color: C.pink, fontSize: 10, fontFamily: F.mono, minWidth: 30 }}>{gridRes}²</span>
            </div>
            {aspectInfo && <div style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,.03)", border: `1px solid ${C.bor}`, fontSize: 8, fontFamily: F.mono, color: C.dim }}>
              Auto grid: <span style={{ color: C.violet }}>{aspectInfo.cols}×{aspectInfo.rows}</span> <span style={{ opacity: .6 }}>(matches KML aspect ratio)</span>
            </div>}
          </div>

          {/* Hillshade */}
          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 7 }}>HILLSHADE</div>
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              {[["multi", "Multi-Dir ★"], ["single", "Single"], ["off", "Off"]].map(([id, lb]) => (
                <button key={id} onClick={() => setHillshadeMode(id)} style={{ flex: 1, padding: "6px 3px", borderRadius: 7, border: hillshadeMode === id ? `1px solid ${C.blue}44` : `1px solid ${C.bor}`, background: hillshadeMode === id ? "rgba(59,130,246,.12)" : C.sur, color: hillshadeMode === id ? C.blue : C.dim, fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>{lb}</button>
              ))}
            </div>
            {hillshadeMode !== "off" && <>
              <div style={{ color: C.dim, fontSize: 9, marginBottom: 4 }}>Strength · {Math.round(hillshadeStrength * 100)}%</div>
              <input type="range" min={0} max={0.85} step={0.05} value={hillshadeStrength} onChange={e => setHillshadeStrength(+e.target.value)} style={{ width: "100%", accentColor: C.amber }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: C.dim, opacity: .6, marginTop: 2 }}>
                <span>subtle</span><span>{isLowRelief ? "← 65%+ for flat" : "← 50-65%"}</span><span>dramatic</span>
              </div>
            </>}
          </div>

          {/* Opacity */}
          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 6 }}>OPACITY · {Math.round(demOpacity * 100)}%</div>
            <input type="range" min={0.1} max={1} step={0.05} value={demOpacity} onChange={e => setDemOpacity(+e.target.value)} style={{ width: "100%", accentColor: C.pink }} />
          </div>

          {/* Color ramp */}
          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em" }}>COLOR RAMP</div>
              {rampAutoSelected && <span style={{ fontSize: 8, fontFamily: F.mono, color: C.cyan, background: "rgba(34,211,200,.12)", border: "1px solid rgba(34,211,200,.3)", borderRadius: 4, padding: "1px 5px" }}>AUTO</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.entries(RAMP_GROUPS).map(([grp, names]) => (
                <div key={grp}>
                  <div style={{ color: C.dim, fontSize: 8, fontWeight: 700, marginBottom: 4, opacity: .7, paddingLeft: 2 }}>{grp}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {names.map(name => { const sel = colorRamp === name; const isTop = ["Mine / Open Pit", "Viridis", "Plasma"].includes(name); return (
                      <button key={name} onClick={() => { setColorRamp(name); setRampAutoSelected(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 7px", borderRadius: 7, cursor: "pointer", background: sel ? "rgba(59,130,246,.08)" : "transparent", border: sel ? "1.5px solid rgba(59,130,246,.4)" : `1px solid ${C.bor}` }}>
                        <span style={{ width: 96, fontSize: 9, fontFamily: F.mono, textAlign: "left", flexShrink: 0, color: sel ? C.blue : isTop ? C.green : C.dim, fontWeight: sel || isTop ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}{isTop ? " ★" : ""}</span>
                        <div style={{ flex: 1, height: 14, borderRadius: 4, background: `linear-gradient(to right,${rampCSS(name)})`, border: sel ? "1px solid rgba(59,130,246,.35)" : `1px solid ${C.bor}` }} />
                      </button>);
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Elevation summary */}
          {elevGrid && <div style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.15)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.green, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 6 }}>ELEVATION SUMMARY</div>
            {[["Data Min", `${elevGrid.min.toFixed(1)}m`], ["Data Max", `${elevGrid.max.toFixed(1)}m`], ["Range", `${(elevGrid.max - elevGrid.min).toFixed(1)}m`], ["Terrain", isLowRelief ? "⚠ Low Relief" : "✓ Normal"], ["Grid", `${elevGrid.cols}×${elevGrid.rows}`], ...(elevGrid.fillPct > 0 ? [["Interpolated", `${elevGrid.fillPct}%${elevGrid.fillPct > 15 ? " ⚠" : ""}`]] : []), ...(stretchDisplay ? [["Render Min", `${stretchDisplay.min.toFixed(1)}m`], ["Render Max", `${stretchDisplay.max.toFixed(1)}m`], ["Stretch", stretchDisplay.mode]] : [])].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(74,222,128,.08)" }}>
                <span style={{ color: C.dim, fontSize: 9, fontFamily: F.mono }}>{k}</span>
                <span style={{ color: k === "Terrain" && isLowRelief ? C.amber : k === "Interpolated" && elevGrid.fillPct > 15 ? C.amber : C.green, fontSize: 11, fontWeight: 700, fontFamily: F.mono }}>{v}</span>
              </div>
            ))}
          </div>}

          {isProcessing && <div style={{ background: "rgba(59,130,246,.06)", border: "1px solid rgba(59,130,246,.18)", borderRadius: 9, padding: "9px 11px" }}>
            <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,.06)", overflow: "hidden", marginBottom: 6 }}><div style={{ height: "100%", width: `${progress}%`, borderRadius: 2, transition: "width .25s", background: "linear-gradient(90deg,#3b82f6,#22d3c8)" }} /></div>
          </div>}

          <div style={{ display: "flex", gap: 6 }}>
            <Btn color={C.pink} onClick={fetchElev} disabled={isProcessing || !effectiveBbox} fullWidth>
              {isProcessing ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>Fetching…</> : "📡 Fetch Elevation Data"}
            </Btn>
            {isProcessing && <button onClick={() => abortRef.current?.abort()} style={{ flexShrink: 0, padding: "9px 12px", borderRadius: 8, background: "rgba(240,96,96,.1)", border: "1px solid rgba(240,96,96,.3)", color: C.red, cursor: "pointer", fontSize: 12, fontFamily: F.ui, fontWeight: 700 }}>✕</button>}
          </div>
          {!isProcessing && effectiveBbox && <button onClick={forceRefetchElev} style={{ width: "100%", padding: "7px", borderRadius: 7, background: "rgba(245,166,35,.06)", border: `1px dashed ${C.amber}55`, color: C.amber, fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: F.ui }}>↻ Force Refetch (clears cache)</button>}
          <Btn color={C.amber} onClick={doRenderDEM} disabled={!elevGrid}>🎨 Render DEM on Globe</Btn>
          {hasDEM && <Btn color={demVisible ? C.red : C.green} onClick={toggleDEM}>{demVisible ? "🙈 Hide DEM" : "👁 Show DEM"}</Btn>}
        </>}

        {/* ════════════════════ CONTOUR TAB ════════════════════ */}
        {tab === "contour" && <>
          <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(34,211,200,.05)", border: "1px solid rgba(34,211,200,.18)", color: C.cyan, fontSize: 9.5, lineHeight: 1.6 }}>
            ⚡ v35 · Smooth=1, Upsample=6 default · Better contours on flat mining terrain
          </div>
          {!elevGrid && <div style={{ padding: "10px", borderRadius: 8, background: "rgba(245,166,35,.07)", border: "1px solid rgba(245,166,35,.2)", color: C.amber, fontSize: 10.5, textAlign: "center" }}>⚠️ Fetch elevation in DEM tab first</div>}

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 8 }}>CONTOUR STYLE</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.keys(CONTOUR_PALETTES).map(name => { const sel = contourPalette === name; return (
                <button key={name} onClick={() => setContourPalette(name)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 7px", borderRadius: 7, cursor: "pointer", background: sel ? "rgba(34,211,200,.08)" : "transparent", border: sel ? "1.5px solid rgba(34,211,200,.4)" : `1px solid ${C.bor}` }}>
                  <span style={{ width: 88, fontSize: 9, fontFamily: F.mono, textAlign: "left", flexShrink: 0, color: sel ? C.cyan : C.dim, fontWeight: sel ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                  <div style={{ flex: 1, height: 14, borderRadius: 4, background: paletteCSS(name), border: sel ? "1px solid rgba(34,211,200,.35)" : `1px solid ${C.bor}` }} />
                </button>
              ); })}
            </div>
          </div>

          {contourPalette === "Classic Brown" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["Minor", minorColor, setMinorColor], ["Major", majorColor, setMajorColor]].map(([lb, val, set]) => (
              <div key={lb} style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 5 }}>{lb.toUpperCase()}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}><input type="color" value={val} onChange={e => set(e.target.value)} style={{ width: 28, height: 28, border: "none", borderRadius: 5, cursor: "pointer" }} /><span style={{ color: C.dim, fontSize: 9, fontFamily: F.mono }}>{val}</span></div>
              </div>
            ))}
          </div>}

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>GRID UPSAMPLE · ×{upsampleFactor}</div>
            <div style={{ fontSize: 8, color: C.cyan, marginBottom: 5, fontFamily: F.mono, opacity: .8 }}>★ Higher = finer contours on flat terrain (×6 recommended)</div>
            <div style={{ display: "flex", gap: 4 }}>{[1, 2, 3, 4, 6, 8].map(v => <button key={v} onClick={() => setUpsampleFactor(v)} style={{ flex: 1, padding: "6px 3px", borderRadius: 7, border: upsampleFactor === v ? `1px solid ${C.cyan}44` : `1px solid ${C.bor}`, background: upsampleFactor === v ? "rgba(34,211,200,.12)" : C.sur, color: upsampleFactor === v ? C.cyan : C.dim, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>×{v}</button>)}</div>
          </div>

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>SPLINE STEPS · {splineSteps}</div>
            <div style={{ display: "flex", gap: 4 }}>{[1, 2, 4, 6, 8].map(v => <button key={v} onClick={() => setSplineSteps(v)} style={{ flex: 1, padding: "6px 3px", borderRadius: 7, border: splineSteps === v ? `1px solid ${C.violet}44` : `1px solid ${C.bor}`, background: splineSteps === v ? "rgba(184,156,248,.12)" : C.sur, color: splineSteps === v ? C.violet : C.dim, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>{v}</button>)}</div>
          </div>

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>SMOOTH PASSES · {smoothPasses}</div>
            <div style={{ fontSize: 8, color: C.amber, marginBottom: 5, fontFamily: F.mono, opacity: .8 }}>★ Use 0-1 for flat terrain — over-smoothing erases detail</div>
            <div style={{ display: "flex", gap: 4 }}>{[0, 1, 2, 3, 4].map(v => <button key={v} onClick={() => setSmoothPasses(v)} style={{ flex: 1, padding: "6px 3px", borderRadius: 7, border: smoothPasses === v ? `1px solid ${C.amber}44` : `1px solid ${C.bor}`, background: smoothPasses === v ? "rgba(245,166,35,.12)" : C.sur, color: smoothPasses === v ? C.amber : C.dim, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>{v === 0 ? "Off" : v}</button>)}</div>
          </div>

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 7 }}>CONTOUR INTERVAL</div>
            <div style={{ fontSize: 8, color: C.cyan, marginBottom: 5, fontFamily: F.mono, opacity: .8 }}>★ Auto-set: {contourInterval}m</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{INTERVALS.map(v => <button key={v} onClick={() => setContourInterval(v)} style={{ flex: "1 0 auto", minWidth: 32, padding: "6px 3px", borderRadius: 7, border: contourInterval === v ? `1px solid ${C.cyan}44` : `1px solid ${C.bor}`, background: contourInterval === v ? "rgba(34,211,200,.12)" : C.sur, color: contourInterval === v ? C.cyan : C.dim, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono, textAlign: "center" }}>{v}m</button>)}</div>
          </div>

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 7 }}>MAJOR INDEX EVERY</div>
            <div style={{ display: "flex", gap: 4 }}>{MAJORS.map(v => <button key={v} onClick={() => setMajorEvery(v)} style={{ flex: 1, padding: "6px 3px", borderRadius: 7, border: majorEvery === v ? `1px solid ${C.amber}44` : `1px solid ${C.bor}`, background: majorEvery === v ? "rgba(245,166,35,.12)" : C.sur, color: majorEvery === v ? C.amber : C.dim, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>{v}m</button>)}</div>
          </div>

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>MIN CHAIN · {minChainM}m</div>
            <input type="range" min={10} max={300} step={10} value={minChainM} onChange={e => setMinChainM(+e.target.value)} style={{ width: "100%", accentColor: C.pink }} />
          </div>

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>LABEL SPACING · {labelSpacing}m</div>
            <input type="range" min={200} max={3000} step={100} value={labelSpacing} onChange={e => setLabelSpacing(+e.target.value)} style={{ width: "100%", accentColor: C.blue }} />
          </div>

          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>LABEL GAP · {labelGap}m</div>
            <input type="range" min={20} max={200} step={10} value={labelGap} onChange={e => setLabelGap(+e.target.value)} style={{ width: "100%", accentColor: C.violet }} />
          </div>

          <Btn color={C.cyan} onClick={doRenderContours} disabled={!elevGrid}>📐 Generate Contours on Globe</Btn>
          {hasContour && <>
            <Btn color={contourVisible ? C.red : C.green} onClick={toggleContours}>{contourVisible ? "🙈 Hide Contours" : "👁 Show Contours"}</Btn>
            {contourCount > 0 && <div style={{ textAlign: "center", color: C.cyan, fontSize: 10, fontFamily: F.mono }}>{contourCount} lines · {contourInterval}m · {contourPalette}</div>}
          </>}
        </>}

        {/* ════════════════════ SHP TAB ════════════════════ */}
        {tab === "shp" && <>
          <div style={{ padding: "9px 11px", borderRadius: 9, background: "rgba(74,222,128,.06)", border: "1px solid rgba(74,222,128,.22)", color: C.green, fontSize: 10, lineHeight: 1.7 }}>
            <strong>📂 Upload QGIS/ArcGIS shapefile</strong> (.shp + .dbf)
          </div>
          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 8 }}>UPLOAD FILES</div>
            {[["SHP", ".shp", shpFile, setShpFile, C.cyan], ["DBF", ".dbf", dbfFile, setDbfFile, C.amber]].map(([label, ext, file, setFile, color]) => (
              <div key={label} style={{ marginBottom: 7 }}>
                <div style={{ color: C.dim, fontSize: 9, marginBottom: 4 }}>{label} file <span style={{ opacity: .6 }}>{ext}</span></div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, border: `1px dashed ${file ? color : C.bor}`, cursor: "pointer", background: file ? `${color}08` : "transparent" }}>
                  <span style={{ fontSize: 13 }}>{file ? "✓" : "📁"}</span>
                  <span style={{ color: file ? color : C.dim, fontSize: 10, fontFamily: F.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{file ? file.name : `Click to select ${ext}`}</span>
                  <input type="file" accept={ext} onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
                </label>
              </div>
            ))}
            <Btn color={C.green} onClick={doParseShapefile} disabled={!shpFile || !dbfFile}>🔍 Parse Shapefile</Btn>
          </div>

          {shpGeoJson && <div style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.18)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.green, fontSize: 9, fontWeight: 700, marginBottom: 6 }}>✅ PARSED DATA</div>
            {(() => { const elevs = [...new Set(shpGeoJson.features.map(f => f.properties.ELEV))].sort((a, b) => a - b); return [["Features", shpGeoJson.features.length], ["Levels", elevs.length], ["Range", `${elevs[0]}m→${elevs[elevs.length - 1]}m`], ["Interval", elevs.length > 1 ? `${elevs[1] - elevs[0]}m` : "—"]].map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(74,222,128,.08)" }}><span style={{ color: C.dim, fontSize: 9, fontFamily: F.mono }}>{k}</span><span style={{ color: C.green, fontSize: 10, fontWeight: 700, fontFamily: F.mono }}>{v}</span></div>); })()}
          </div>}

          {shpGeoJson && <>
            <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 8 }}>CONTOUR STYLE</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {Object.keys(CONTOUR_PALETTES).map(name => { const sel = shpPalette === name; return (
                  <button key={name} onClick={() => setShpPalette(name)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 7px", borderRadius: 7, cursor: "pointer", background: sel ? "rgba(74,222,128,.08)" : "transparent", border: sel ? "1.5px solid rgba(74,222,128,.4)" : `1px solid ${C.bor}` }}>
                    <span style={{ width: 88, fontSize: 9, fontFamily: F.mono, textAlign: "left", flexShrink: 0, color: sel ? C.green : C.dim, fontWeight: sel ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                    <div style={{ flex: 1, height: 14, borderRadius: 4, background: paletteCSS(name), border: sel ? "1px solid rgba(74,222,128,.35)" : `1px solid ${C.bor}` }} />
                  </button>
                ); })}
              </div>
            </div>

            {shpPalette === "Classic Brown" && <>
              <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 7 }}>MAJOR EVERY</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{SHP_MAJORS.map(v => <button key={v} onClick={() => setShpMajorEvery(v)} style={{ flex: 1, minWidth: 36, padding: "6px 3px", borderRadius: 7, border: shpMajorEvery === v ? `1px solid ${C.amber}44` : `1px solid ${C.bor}`, background: shpMajorEvery === v ? "rgba(245,166,35,.12)" : C.sur, color: shpMajorEvery === v ? C.amber : C.dim, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>{v}m</button>)}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[["Minor", shpMinorColor, setShpMinorColor], ["Major", shpMajorColor, setShpMajorColor]].map(([lb, val, set]) => (
                  <div key={lb} style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, marginBottom: 5 }}>{lb.toUpperCase()}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}><input type="color" value={val} onChange={e => set(e.target.value)} style={{ width: 28, height: 28, border: "none", borderRadius: 5, cursor: "pointer" }} /><span style={{ color: C.dim, fontSize: 9, fontFamily: F.mono }}>{val}</span></div>
                  </div>
                ))}
              </div>
            </>}

            <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>LABEL SPACING · {shpLabelSpacing}m</div>
              <input type="range" min={200} max={3000} step={100} value={shpLabelSpacing} onChange={e => setShpLabelSpacing(+e.target.value)} style={{ width: "100%", accentColor: C.blue }} />
            </div>
            <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ color: C.dim, fontSize: 9, fontWeight: 700, letterSpacing: ".1em", marginBottom: 4 }}>LABEL GAP · {shpLabelGap}m</div>
              <input type="range" min={20} max={200} step={10} value={shpLabelGap} onChange={e => setShpLabelGap(+e.target.value)} style={{ width: "100%", accentColor: C.violet }} />
            </div>
            <Btn color={C.green} onClick={doRenderShapefileContours}>🗺 Render Shapefile Contours</Btn>
            {hasShpContour && <>
              <Btn color={shpContourVisible ? C.red : C.green} onClick={toggleShpContours}>{shpContourVisible ? "🙈 Hide SHP Contours" : "👁 Show SHP Contours"}</Btn>
              {shpContourCount > 0 && <div style={{ textAlign: "center", color: C.green, fontSize: 10, fontFamily: F.mono }}>{shpContourCount} lines from shapefile</div>}
              <Btn color={C.violet} onClick={exportShpGeoJSON}>📥 Export as GeoJSON</Btn>
            </>}
          </>}
        </>}

        {/* ════════════════════ EXPORT TAB ════════════════════ */}
        {tab === "export" && <>
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(184,156,248,.05)", border: "1px solid rgba(184,156,248,.17)" }}>
            <div style={{ color: C.violet, fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>💾 Export GIS Data</div>
            <div style={{ color: C.dim, fontSize: 10.5, lineHeight: 1.7 }}>GeoTIFF · CSV · GeoJSON · Shapefile ZIP</div>
          </div>
          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.pink, fontWeight: 700, fontSize: 11, marginBottom: 7 }}>🏔 DEM / Elevation</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <Btn color={C.pink} onClick={exportTIFF} disabled={!elevGrid}>📥 Export → GeoTIFF (.tif)</Btn>
              <Btn color={C.amber} onClick={exportCSV} disabled={!elevGrid}>📥 Export → CSV</Btn>
            </div>
          </div>
          <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.cyan, fontWeight: 700, fontSize: 11, marginBottom: 7 }}>📐 Calculated Contours</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <Btn color={C.cyan} onClick={exportGeoJSON} disabled={!elevGrid}>📥 Contours → GeoJSON 3D</Btn>
              <Btn color={C.blue} onClick={exportSHP} disabled={!elevGrid}>📥 Contours → Shapefile ZIP</Btn>
            </div>
          </div>
          {shpGeoJson && <div style={{ background: C.sur, border: `1px solid ${C.bor}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.green, fontWeight: 700, fontSize: 11, marginBottom: 7 }}>📂 Uploaded Shapefile</div>
            <Btn color={C.green} onClick={exportShpGeoJSON}>📥 SHP Contours → GeoJSON</Btn>
          </div>}
          {elevGrid && <div style={{ background: "rgba(74,222,128,.04)", border: "1px solid rgba(74,222,128,.15)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: C.green, fontWeight: 700, fontSize: 11, marginBottom: 6 }}>✅ Summary</div>
            {[["Grid", `${elevGrid.cols}×${elevGrid.rows}`], ["Range", `${(elevGrid.max - elevGrid.min).toFixed(1)}m`], ["Terrain", isLowRelief ? "⚠ Low Relief" : "✓ Normal"], ...(elevGrid.fillPct > 0 ? [["Interpolated", `${elevGrid.fillPct}%`]] : []), ...(stretchDisplay ? [["Render", `${Math.round(stretchDisplay.min)}–${Math.round(stretchDisplay.max)}m`], ["Stretch", stretchDisplay.mode]] : []), ["Ramp", colorRamp], ["HS", `${hillshadeMode} ${Math.round(hillshadeStrength * 100)}%`], ["Interval", `${contourInterval}m / maj ${majorEvery}m`], ["Upsample", `×${upsampleFactor}`], ["Smooth", `${smoothPasses} pass`], ["Palette", contourPalette], ...(shpGeoJson ? [["SHP", `${shpGeoJson.features.length} lines`]] : []), ...(effectiveKmlPolygon ? [["KML", `${effectiveKmlPolygon.length} pts${internalKmlPolygon ? " (inline)" : ""}`]] : [])].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(74,222,128,.08)" }}>
                <span style={{ color: C.dim, fontSize: 10, fontFamily: F.mono }}>{k}</span>
                <span style={{ color: k === "Terrain" && isLowRelief ? C.amber : C.green, fontSize: 11, fontWeight: 700, fontFamily: F.mono }}>{v}</span>
              </div>
            ))}
          </div>}
        </>}
      </div>

      {/* ── Status bar ── */}
      {status && <div style={{ padding: "6px 12px", flexShrink: 0, borderTop: `1px solid ${C.bor}`, background: `${sm.color}0a`, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: sm.color, fontSize: 11, fontWeight: 700, flexShrink: 0, width: 16, textAlign: "center", fontFamily: F.mono }}>{sm.icon}</span>
        <span style={{ color: sm.color, fontSize: 9.5, fontFamily: F.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{status}</span>
      </div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}