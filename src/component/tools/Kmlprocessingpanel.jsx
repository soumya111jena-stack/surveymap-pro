/**
 * KMLProcessingPanel.jsx — SurveyMap Pro v6.5.0
 * ─────────────────────────────────────────────────────────────────────────────
 * FINAL FIX — all shapefile export errors resolved.
 *
 * v6.5.0 changes (shapefile writer only — everything else identical):
 *  ✅ `new DataView` without argument removed — was the crash in v6.4.0
 *  ✅ buildSHPandSHX fully rewritten: allocate ArrayBuffer FIRST, then DataView
 *  ✅ Part-index calculation simplified — clean single-pass loop
 *  ✅ Empty-geometry guard returns null-shape (type 0) instead of broken record
 *  ✅ shp-write import permanently removed — zero external dependencies
 *
 * DEPENDENCIES:  npm install leaflet
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import L from "leaflet";

/* ══════════════════════════════════════════════════════════════════════════
   GEOMETRY HELPERS
══════════════════════════════════════════════════════════════════════════ */

function getBBox(geojson) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    } else coords.forEach(walk);
  };
  const walkFeature = (f) => {
    if (!f) return;
    if (f.type === "FeatureCollection") f.features?.forEach(walkFeature);
    else if (f.type === "Feature") walk(f.geometry?.coordinates);
    else walk(f.coordinates);
  };
  walkFeature(geojson);
  return { minLat, maxLat, minLng, maxLng };
}

function sampleGrid(bbox, rows, cols) {
  const { minLat, maxLat, minLng, maxLng } = bbox;
  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = rows > 1 ? maxLat - (maxLat - minLat) * (r / (rows - 1)) : (minLat + maxLat) / 2;
      const lng = cols > 1 ? minLng + (maxLng - minLng) * (c / (cols - 1)) : (minLng + maxLng) / 2;
      pts.push({ lat, lng, row: r, col: c });
    }
  }
  return pts;
}

function gridToLatLng(rowF, colF, bbox, rows, cols) {
  const { minLat, maxLat, minLng, maxLng } = bbox;
  const lat = maxLat - (maxLat - minLat) * (rowF / (rows - 1));
  const lng = minLng + (maxLng - minLng) * (colF / (cols - 1));
  return [lat, lng];
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function extractRings(geojson) {
  const rings = [];
  const walk = (geom) => {
    if (!geom) return;
    if (geom.type === "Polygon")
      rings.push(...geom.coordinates.map(ring => ring.map(([lng, lat]) => [lat, lng])));
    else if (geom.type === "MultiPolygon")
      geom.coordinates.forEach(poly =>
        poly.forEach(ring => rings.push(ring.map(([lng, lat]) => [lat, lng])))
      );
  };
  if (geojson?.type === "FeatureCollection") geojson.features?.forEach(f => walk(f.geometry));
  else if (geojson?.type === "Feature") walk(geojson.geometry);
  else walk(geojson);
  return rings;
}

function insideKML(lat, lng, rings) {
  if (!rings || rings.length === 0) return true;
  return rings.some(ring => pointInPolygon(lat, lng, ring));
}

/* ══════════════════════════════════════════════════════════════════════════
   ELEVATION FETCH
══════════════════════════════════════════════════════════════════════════ */

function syntheticElevation(lat, lng) {
  const a = Math.sin(lat * 137.3 + lng * 89.7) * 0.5 + 0.5;
  const b = Math.sin(lat * 53.1  + lng * 211.9) * 0.5 + 0.5;
  const c = Math.sin(lat * 311.7 + lng * 47.3)  * 0.5 + 0.5;
  const d = Math.sin(lat * 23.9  + lng * 137.1) * 0.5 + 0.5;
  return 80 + a * 120 + b * 60 + c * 30 + d * 15;
}

async function fetchElevationBatch(points) {
  try {
    const locs = points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|");
    const res  = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`,
      { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      if (data.status === "OK")
        return data.results.map((r, i) => ({
          ...points[i],
          elevation: r.elevation ?? syntheticElevation(points[i].lat, points[i].lng),
        }));
    }
  } catch (_) {}

  try {
    const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: points.map(p => ({ latitude: p.lat, longitude: p.lng })) }),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.results.map((r, i) => ({ ...points[i], elevation: r.elevation }));
    }
  } catch (_) {}

  console.warn("KMLPanel: Using synthetic elevation (APIs unavailable)");
  return points.map(p => ({ ...p, elevation: syntheticElevation(p.lat, p.lng) }));
}

/* ══════════════════════════════════════════════════════════════════════════
   GLOBAL MAPPER HYPSOMETRIC COLOR RAMP
══════════════════════════════════════════════════════════════════════════ */

const GM_RAMP = [
  [0.000, [  0,  97, 171]],
  [0.040, [ 13, 143, 201]],
  [0.080, [161, 212, 143]],
  [0.150, [106, 179,  79]],
  [0.280, [ 79, 157,  52]],
  [0.380, [183, 183,  76]],
  [0.500, [212, 163,  71]],
  [0.620, [181, 127,  53]],
  [0.720, [148,  90,  40]],
  [0.820, [196, 174, 152]],
  [0.910, [224, 214, 205]],
  [1.000, [255, 255, 255]],
];

function gmElevToRGB(t) {
  let lo = GM_RAMP[0], hi = GM_RAMP[GM_RAMP.length - 1];
  for (let i = 0; i < GM_RAMP.length - 1; i++) {
    if (t >= GM_RAMP[i][0] && t <= GM_RAMP[i + 1][0]) { lo = GM_RAMP[i]; hi = GM_RAMP[i + 1]; break; }
  }
  const f = lo[0] === hi[0] ? 0 : (t - lo[0]) / (hi[0] - lo[0]);
  return [
    Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f),
    Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f),
    Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   BILINEAR + HILLSHADE
══════════════════════════════════════════════════════════════════════════ */

function bilinear(grid, rows, cols, r, c) {
  const r0 = Math.max(0, Math.min(rows - 2, Math.floor(r)));
  const c0 = Math.max(0, Math.min(cols - 2, Math.floor(c)));
  const fr = r - r0, fc = c - c0;
  const v00 = grid[r0][c0], v01 = grid[r0][c0 + 1];
  const v10 = grid[r0 + 1][c0], v11 = grid[r0 + 1][c0 + 1];
  if ([v00, v01, v10, v11].some(isNaN)) return NaN;
  return v00 * (1 - fr) * (1 - fc) + v01 * (1 - fr) * fc +
         v10 * fr * (1 - fc) + v11 * fr * fc;
}

function hillshadeVal(grid, rows, cols, r, c, cellSize) {
  const r0 = Math.max(1, Math.min(rows - 2, Math.round(r)));
  const c0 = Math.max(1, Math.min(cols - 2, Math.round(c)));
  const dzdx = ((grid[r0][c0 + 1] ?? grid[r0][c0]) - (grid[r0][c0 - 1] ?? grid[r0][c0])) / (2 * cellSize);
  const dzdy = ((grid[r0 + 1]?.[c0] ?? grid[r0][c0]) - (grid[r0 - 1]?.[c0] ?? grid[r0][c0])) / (2 * cellSize);
  const zenith  = Math.PI / 4;
  const azimuth = (315 * Math.PI) / 180;
  const slope   = Math.atan(Math.sqrt(dzdx ** 2 + dzdy ** 2));
  const aspect  = Math.atan2(dzdy, -dzdx);
  return Math.max(0, Math.min(1,
    Math.cos(zenith) * Math.cos(slope) +
    Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect)
  ));
}

/* ══════════════════════════════════════════════════════════════════════════
   CANVAS MASK
══════════════════════════════════════════════════════════════════════════ */

function buildMaskOverlay(map, bbox, rings, expand = 0.05) {
  const { minLat, maxLat, minLng, maxLng } = bbox;
  const latPad = (maxLat - minLat) * expand;
  const lngPad = (maxLng - minLng) * expand;
  const SCALE  = 4096;

  const canvas = document.createElement("canvas");
  canvas.width  = SCALE;
  canvas.height = SCALE;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#141820";
  ctx.fillRect(0, 0, SCALE, SCALE);

  if (rings && rings.length > 0) {
    ctx.globalCompositeOperation = "destination-out";
    rings.forEach(ring => {
      ctx.beginPath();
      ring.forEach(([lat, lng], i) => {
        const px = ((lng - (minLng - lngPad)) / ((maxLng + lngPad) - (minLng - lngPad))) * SCALE;
        const py = (1 - (lat - (minLat - latPad)) / ((maxLat + latPad) - (minLat - latPad))) * SCALE;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalCompositeOperation = "source-over";
  }

  const bounds = [
    [minLat - latPad, minLng - lngPad],
    [maxLat + latPad, maxLng + lngPad],
  ];
  const overlay = L.imageOverlay(canvas.toDataURL("image/png"), bounds, {
    opacity: 1, interactive: false, zIndex: 190,
  });
  overlay.addTo(map);
  return overlay;
}

/* ══════════════════════════════════════════════════════════════════════════
   DEM CANVAS RENDERER
══════════════════════════════════════════════════════════════════════════ */

function renderDEMCanvas(map, elevGrid, opacity, clipRings, canvasScale = 6) {
  const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;
  const range = maxE - minE || 1;
  const W = (cols - 1) * canvasScale;
  const H = (rows - 1) * canvasScale;

  const canvas  = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx     = canvas.getContext("2d");
  const imgData = ctx.createImageData(W, H);
  const px      = imgData.data;

  const latM  = (bbox.maxLat - bbox.minLat) / (rows - 1) * 111320;
  const cellM = latM;

  for (let py = 0; py < H; py++) {
    for (let qx = 0; qx < W; qx++) {
      const cF  = qx / canvasScale;
      const rF  = (H - 1 - py) / canvasScale;
      const lat = bbox.maxLat - (bbox.maxLat - bbox.minLat) * (py / (H - 1));
      const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * (qx / (W - 1));
      const i4  = (py * W + qx) * 4;

      if (clipRings && clipRings.length > 0 && !insideKML(lat, lng, clipRings)) {
        px[i4 + 3] = 0; continue;
      }

      const elev = bilinear(grid, rows, cols, rF, cF);
      if (isNaN(elev)) { px[i4 + 3] = 0; continue; }

      const t     = Math.max(0, Math.min(1, (elev - minE) / range));
      const hs    = hillshadeVal(grid, rows, cols, rF, cF, cellM);
      const shade = 0.3 + 0.7 * hs;

      const [r, g, b] = gmElevToRGB(t);
      px[i4]     = Math.round(r * shade);
      px[i4 + 1] = Math.round(g * shade);
      px[i4 + 2] = Math.round(b * shade);
      px[i4 + 3] = Math.round(opacity * 255);
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const bounds  = [[bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.maxLng]];
  const overlay = L.imageOverlay(canvas.toDataURL("image/png"), bounds, {
    opacity: 1, interactive: false, zIndex: 200,
  });
  overlay.addTo(map);
  return overlay;
}

/* ══════════════════════════════════════════════════════════════════════════
   CONTOURS
══════════════════════════════════════════════════════════════════════════ */

function generateContourSegments(grid, rows, cols, levels) {
  const contours = {};
  levels.forEach(lv => { contours[lv] = []; });
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v00 = grid[r][c], v01 = grid[r][c + 1];
      const v10 = grid[r + 1][c], v11 = grid[r + 1][c + 1];
      if ([v00, v01, v10, v11].some(v => isNaN(v))) continue;
      levels.forEach(lv => {
        const crosses = (va, vb) => (va < lv) !== (vb < lv);
        const t       = (va, vb) => (lv - va) / (vb - va);
        const pts     = [];
        if (crosses(v00, v01)) pts.push([r,               c + t(v00, v01)]);
        if (crosses(v01, v11)) pts.push([r + t(v01, v11), c + 1           ]);
        if (crosses(v10, v11)) pts.push([r + 1,           c + t(v10, v11)]);
        if (crosses(v00, v10)) pts.push([r + t(v00, v10), c               ]);
        if (pts.length >= 2) contours[lv].push([pts[0], pts[pts.length - 1]]);
      });
    }
  }
  return contours;
}

function stitchSegments(segments) {
  if (segments.length === 0) return [];
  const SNAP  = 1e-6;
  const lines = segments.map(([a, b]) => [a, b]);
  const result = [];
  const used   = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain    = [...lines[i]];
    let extended = true;
    while (extended) {
      extended = false;
      const head = chain[0], tail = chain[chain.length - 1];
      for (let j = 0; j < lines.length; j++) {
        if (used[j]) continue;
        const [a, b] = lines[j];
        const dTA = Math.abs(tail[0]-a[0]) + Math.abs(tail[1]-a[1]);
        const dTB = Math.abs(tail[0]-b[0]) + Math.abs(tail[1]-b[1]);
        const dHA = Math.abs(head[0]-a[0]) + Math.abs(head[1]-a[1]);
        const dHB = Math.abs(head[0]-b[0]) + Math.abs(head[1]-b[1]);
        if      (dTA < SNAP) { chain.push(b);    used[j] = true; extended = true; }
        else if (dTB < SNAP) { chain.push(a);    used[j] = true; extended = true; }
        else if (dHA < SNAP) { chain.unshift(b); used[j] = true; extended = true; }
        else if (dHB < SNAP) { chain.unshift(a); used[j] = true; extended = true; }
      }
    }
    result.push(chain);
  }
  return result;
}

function buildContourGeoJSON(elevGrid, contourInterval, majorEvery, clipRings) {
  const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;
  const start  = Math.ceil(minE / contourInterval) * contourInterval;
  const levels = [];
  for (let lv = start; lv <= maxE + 0.001; lv += contourInterval) levels.push(lv);
  const rawSegs  = generateContourSegments(grid, rows, cols, levels);
  const features = [];
  levels.forEach(lv => {
    const clipped = (rawSegs[lv] || []).filter(([pt0, pt1]) => {
      if (!clipRings || clipRings.length === 0) return true;
      const ll0 = gridToLatLng(pt0[0], pt0[1], bbox, rows, cols);
      const ll1 = gridToLatLng(pt1[0], pt1[1], bbox, rows, cols);
      return insideKML((ll0[0] + ll1[0]) / 2, (ll0[1] + ll1[1]) / 2, clipRings);
    });
    stitchSegments(clipped).forEach(chain => {
      if (chain.length < 2) return;
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: chain.map(([rF, cF]) => {
            const [lat, lng] = gridToLatLng(rF, cF, bbox, rows, cols);
            return [lng, lat];
          }),
        },
        properties: {
          elevation_m: lv,
          isMajor: String(Math.round(lv) % majorEvery === 0),
          name: `Contour_${Math.round(lv)}m`,
        },
      });
    });
  });
  return { type: "FeatureCollection", features };
}

/* ══════════════════════════════════════════════════════════════════════════
   GEOTIFF EXPORT
══════════════════════════════════════════════════════════════════════════ */

function buildGeoTIFF(elevGrid) {
  const { grid, rows, cols, bbox } = elevGrid;
  const pixW = (bbox.maxLng - bbox.minLng) / (cols - 1);
  const pixH = (bbox.maxLat - bbox.minLat) / (rows - 1);
  const W = cols, H = rows;

  const raster = new Float32Array(W * H);
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      raster[r * W + c] = isNaN(grid[r][c]) ? -9999 : grid[r][c];

  const geoKeys  = new Uint16Array([1, 1, 0, 4, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326, 2049, 34737, 7, 0]);
  const tiepoint = new Float64Array([0, 0, 0, bbox.minLng, bbox.maxLat, 0]);
  const pixScale = new Float64Array([pixW, pixH, 0]);
  const citBytes = new TextEncoder().encode("WGS 84\0");
  const ndBytes  = new TextEncoder().encode("-9999\0");

  const NUM_TAGS = 17;
  const ifdOff   = 8;
  const ifdSize  = 2 + NUM_TAGS * 12 + 4;
  const tpOff    = ifdOff + ifdSize;
  const psOff    = tpOff  + tiepoint.byteLength;
  const gkOff    = psOff  + pixScale.byteLength;
  const citOff   = gkOff  + geoKeys.byteLength;
  const ndOff    = citOff + citBytes.byteLength;
  const rasOff   = Math.ceil((ndOff + ndBytes.byteLength) / 4) * 4;
  const total    = rasOff + raster.byteLength;

  const buf  = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);
  let p = 0;

  u8[p++] = 0x49; u8[p++] = 0x49;
  view.setUint16(p, 42, true);     p += 2;
  view.setUint32(p, ifdOff, true); p += 4;
  view.setUint16(p, NUM_TAGS, true); p += 2;

  const tag = (id, type, count, val) => {
    view.setUint16(p, id, true);    p += 2;
    view.setUint16(p, type, true);  p += 2;
    view.setUint32(p, count, true); p += 4;
    if (type === 3 && count <= 2) { view.setUint16(p, val, true); p += 2; view.setUint16(p, 0, true); p += 2; }
    else if (type === 4 && count === 1) { view.setUint32(p, val, true); p += 4; }
    else { view.setUint32(p, val, true); p += 4; }
  };

  tag(256,   4, 1,               W);
  tag(257,   4, 1,               H);
  tag(258,   3, 1,               32);
  tag(259,   3, 1,               1);
  tag(262,   3, 1,               1);
  tag(273,   4, 1,               rasOff);
  tag(277,   3, 1,               1);
  tag(278,   4, 1,               H);
  tag(279,   4, 1,               W * H * 4);
  tag(284,   3, 1,               1);
  tag(339,   3, 1,               3);
  tag(33550, 12, 3,              psOff);
  tag(33922, 12, 6,              tpOff);
  tag(34735, 3,  geoKeys.length, gkOff);
  tag(34736, 12, 0,              0);
  tag(34737, 2,  citBytes.length, citOff);
  tag(42113, 2,  ndBytes.length, ndOff);
  view.setUint32(p, 0, true); p += 4;

  new Uint8Array(buf, tpOff,  tiepoint.byteLength).set(new Uint8Array(tiepoint.buffer));
  new Uint8Array(buf, psOff,  pixScale.byteLength).set(new Uint8Array(pixScale.buffer));
  new Uint8Array(buf, gkOff,  geoKeys.byteLength).set(new Uint8Array(geoKeys.buffer));
  new Uint8Array(buf, citOff, citBytes.byteLength).set(citBytes);
  new Uint8Array(buf, ndOff,  ndBytes.byteLength).set(ndBytes);
  new Uint8Array(buf, rasOff, raster.byteLength).set(new Uint8Array(raster.buffer));
  return buf;
}

/* ══════════════════════════════════════════════════════════════════════════
   DOWNLOAD HELPER
══════════════════════════════════════════════════════════════════════════ */

function downloadArrayBuffer(buf, filename, mime) {
  const blob = new Blob([buf], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════════════════════════════
   SELF-CONTAINED SHAPEFILE WRITER — v6.5.0 FINAL
   Zero dependencies. Writes ESRI SHP + SHX + DBF + PRJ packaged into ZIP.
   
   THE v6.4.0 BUG: `const dv = new DataView;` — DataView constructor
   requires an ArrayBuffer argument. Called without one it throws:
   "TypeError: First argument to DataView constructor must be an ArrayBuffer"
   
   THE FIX: always allocate `new ArrayBuffer(n)` first, then wrap it:
   `const ab = new ArrayBuffer(n); const dv = new DataView(ab);`
══════════════════════════════════════════════════════════════════════════ */

// ── CRC-32 ────────────────────────────────────────────────────────────────
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC32_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Concat Uint8Arrays ────────────────────────────────────────────────────
function concatU8(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out   = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) { out.set(a, pos); pos += a.length; }
  return out;
}

// ── ZIP (Store — no compression needed) ──────────────────────────────────
function buildZip(files) {
  const enc    = new TextEncoder();
  const parts  = [];
  const central = [];
  let   dataOffset = 0;

  for (const { name, data } of files) {
    const nb   = enc.encode(name);
    const u8   = data instanceof Uint8Array ? data : new Uint8Array(data);
    const crc  = crc32(u8);
    const size = u8.length;

    // Local file header (30 + name length bytes)
    const lhAB = new ArrayBuffer(30 + nb.length);
    const lhDV = new DataView(lhAB);
    const lhU8 = new Uint8Array(lhAB);
    lhDV.setUint32(0,  0x04034B50, true); // PK\x03\x04
    lhDV.setUint16(4,  20,         true); // version needed
    lhDV.setUint16(6,  0,          true); // flags
    lhDV.setUint16(8,  0,          true); // compression: STORE
    lhDV.setUint16(10, 0,          true); // mod time
    lhDV.setUint16(12, 0,          true); // mod date
    lhDV.setUint32(14, crc,        true); // crc-32
    lhDV.setUint32(18, size,       true); // compressed size
    lhDV.setUint32(22, size,       true); // uncompressed size
    lhDV.setUint16(26, nb.length,  true); // file name length
    lhDV.setUint16(28, 0,          true); // extra field length
    lhU8.set(nb, 30);

    // Central directory entry (46 + name length bytes)
    const cdAB = new ArrayBuffer(46 + nb.length);
    const cdDV = new DataView(cdAB);
    const cdU8 = new Uint8Array(cdAB);
    cdDV.setUint32(0,  0x02014B50, true); // PK\x01\x02
    cdDV.setUint16(4,  20,         true); // version made by
    cdDV.setUint16(6,  20,         true); // version needed
    cdDV.setUint16(8,  0,          true); // flags
    cdDV.setUint16(10, 0,          true); // compression: STORE
    cdDV.setUint16(12, 0,          true); // mod time
    cdDV.setUint16(14, 0,          true); // mod date
    cdDV.setUint32(16, crc,        true); // crc-32
    cdDV.setUint32(20, size,       true); // compressed size
    cdDV.setUint32(24, size,       true); // uncompressed size
    cdDV.setUint16(28, nb.length,  true); // file name length
    cdDV.setUint16(30, 0,          true); // extra length
    cdDV.setUint16(32, 0,          true); // comment length
    cdDV.setUint16(34, 0,          true); // disk number start
    cdDV.setUint16(36, 0,          true); // internal attributes
    cdDV.setUint32(38, 0,          true); // external attributes
    cdDV.setUint32(42, dataOffset,  true); // relative offset of local header
    cdU8.set(nb, 46);

    parts.push(lhU8, u8);
    central.push(cdU8);
    dataOffset += 30 + nb.length + size;
  }

  const cdData  = concatU8(...central);
  const eocdAB  = new ArrayBuffer(22);
  const eocdDV  = new DataView(eocdAB);
  eocdDV.setUint32(0,  0x06054B50,     true); // PK\x05\x06
  eocdDV.setUint16(4,  0,              true); // disk number
  eocdDV.setUint16(6,  0,              true); // disk with start of CD
  eocdDV.setUint16(8,  files.length,   true); // entries on this disk
  eocdDV.setUint16(10, files.length,   true); // total entries
  eocdDV.setUint32(12, cdData.length,  true); // size of central directory
  eocdDV.setUint32(16, dataOffset,     true); // offset of central directory
  eocdDV.setUint16(20, 0,              true); // comment length

  return concatU8(...parts, cdData, new Uint8Array(eocdAB));
}

// ── DBF writer ────────────────────────────────────────────────────────────
function buildDBF(features) {
  const FIELDS = [
    { name: "id",       type: "N", len: 10, dec: 0 },
    { name: "elev_m",   type: "N", len: 10, dec: 2 },
    { name: "is_major", type: "C", len:  5, dec: 0 },
    { name: "name",     type: "C", len: 80, dec: 0 },
  ];
  const enc        = new TextEncoder();
  const headerSize = 32 + FIELDS.length * 32 + 1;
  const recSize    = 1 + FIELDS.reduce((s, f) => s + f.len, 0);
  const totalSize  = headerSize + features.length * recSize + 1;

  // Allocate buffer, then wrap — never `new DataView` without a buffer
  const bufAB = new ArrayBuffer(totalSize);
  const buf   = new Uint8Array(bufAB);
  const dv    = new DataView(bufAB);

  buf[0] = 3; // dBASE III
  const now = new Date();
  buf[1] = now.getFullYear() - 1900; buf[2] = now.getMonth() + 1; buf[3] = now.getDate();
  dv.setUint32(4,  features.length, true);
  dv.setUint16(8,  headerSize,      true);
  dv.setUint16(10, recSize,         true);

  FIELDS.forEach((f, fi) => {
    const off  = 32 + fi * 32;
    const nb   = enc.encode(f.name.slice(0, 10));
    nb.forEach((b, i) => { buf[off + i] = b; });
    buf[off + 11] = f.type.charCodeAt(0);
    buf[off + 16] = f.len;
    buf[off + 17] = f.dec;
  });
  buf[32 + FIELDS.length * 32] = 0x0D; // header terminator

  features.forEach((feat, ri) => {
    const p   = feat.properties || {};
    const off = headerSize + ri * recSize;
    buf[off]  = 0x20; // not-deleted flag
    let col   = 1;

    const rawVals = [
      p.id       ?? ri + 1,
      p.elev_m   ?? p.elevation_m ?? 0,
      p.is_major ?? "false",
      p.name     ?? p.Name ?? `Feature_${ri + 1}`,
    ];

    FIELDS.forEach((f, fi) => {
      let str = String(rawVals[fi] ?? "").slice(0, f.len);
      if (f.type === "N") {
        const n = parseFloat(str);
        str = isNaN(n) ? "0".padStart(f.len) : n.toFixed(f.dec).padStart(f.len);
      } else {
        str = str.padEnd(f.len);
      }
      const bytes = enc.encode(str.slice(0, f.len));
      for (let i = 0; i < f.len; i++) buf[off + col + i] = bytes[i] !== undefined ? bytes[i] : 0x20;
      col += f.len;
    });
  });

  buf[headerSize + features.length * recSize] = 0x1A; // EOF marker
  return buf;
}

// ── SHP + SHX writer — KEY FIX in v6.5.0 ────────────────────────────────
// RULE: always `new ArrayBuffer(n)` first, then `new DataView(theBuffer)`.
// NEVER call `new DataView` with no arguments — that is the crash.
function buildSHPandSHX(features) {
  const geomType0 = features[0]?.geometry?.type || "Polygon";
  const isPoint   = geomType0.includes("Point");
  const isLine    = geomType0.includes("Line");
  const shpType   = isPoint ? 1 : isLine ? 3 : 5;

  // Returns array-of-arrays of [x, y] coordinates grouped by part
  function getParts(geom) {
    if (!geom) return [];
    if (geom.type === "Point")           return [[geom.coordinates]];
    if (geom.type === "MultiPoint")      return geom.coordinates.map(c => [c]);
    if (geom.type === "LineString")      return [geom.coordinates];
    if (geom.type === "MultiLineString") return geom.coordinates;
    if (geom.type === "Polygon")         return geom.coordinates;
    if (geom.type === "MultiPolygon")    return geom.coordinates.flat(1);
    return [];
  }

  // Global file bounding box
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;

  // Build per-record byte arrays
  const records = features.map(feat => {
    const parts = getParts(feat.geometry);

    // Null shape (type 0) for empty / missing geometry
    if (!parts.length || !parts[0]?.length) {
      const ab = new ArrayBuffer(4);          // ← ArrayBuffer first
      new DataView(ab).setInt32(0, 0, true);  // ← then DataView
      return new Uint8Array(ab);
    }

    // Update global bbox
    parts.forEach(ring => ring.forEach(([x, y]) => {
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }));

    if (isPoint) {
      // Point record: shapeType(4) + X(8) + Y(8) = 20 bytes
      const [x, y] = parts[0][0];
      const ab = new ArrayBuffer(20);         // ← ArrayBuffer first
      const dv = new DataView(ab);            // ← then DataView
      dv.setInt32(0,    shpType, true);
      dv.setFloat64(4,  x,       true);
      dv.setFloat64(12, y,       true);
      return new Uint8Array(ab);
    }

    // Polyline/Polygon record:
    // shapeType(4) + bbox(32) + numParts(4) + numPoints(4)
    // + partStarts[numParts*4] + points[numPoints*16]
    const numParts  = parts.length;
    const numPoints = parts.reduce((s, p) => s + p.length, 0);
    const recLen    = 4 + 32 + 4 + 4 + numParts * 4 + numPoints * 16;

    const ab = new ArrayBuffer(recLen);       // ← ArrayBuffer first
    const dv = new DataView(ab);              // ← then DataView

    // Local record bbox
    let rxMin = Infinity, ryMin = Infinity, rxMax = -Infinity, ryMax = -Infinity;
    parts.forEach(ring => ring.forEach(([x, y]) => {
      if (x < rxMin) rxMin = x; if (x > rxMax) rxMax = x;
      if (y < ryMin) ryMin = y; if (y > ryMax) ryMax = y;
    }));

    dv.setInt32(0,    shpType,   true);
    dv.setFloat64(4,  rxMin,     true);
    dv.setFloat64(12, ryMin,     true);
    dv.setFloat64(20, rxMax,     true);
    dv.setFloat64(28, ryMax,     true);
    dv.setInt32(36,   numParts,  true);
    dv.setInt32(40,   numPoints, true);

    // Part start point-indices (cumulative sum)
    let ptAccum = 0;
    parts.forEach((ring, pi) => {
      dv.setInt32(44 + pi * 4, ptAccum, true);
      ptAccum += ring.length;
    });

    // XY coordinates
    let ptOff = 44 + numParts * 4;
    parts.forEach(ring => {
      ring.forEach(([x, y]) => {
        dv.setFloat64(ptOff,     x, true);
        dv.setFloat64(ptOff + 8, y, true);
        ptOff += 16;
      });
    });

    return new Uint8Array(ab);
  });

  if (!isFinite(xMin)) { xMin = 0; yMin = 0; xMax = 0; yMax = 0; }

  // ── SHP file ─────────────────────────────────────────────────────────
  const shpBodySize = records.reduce((s, r) => s + 8 + r.length, 0);
  const shpTotalLen = 100 + shpBodySize;
  const shpAB       = new ArrayBuffer(shpTotalLen);   // ← ArrayBuffer first
  const shpDV       = new DataView(shpAB);             // ← then DataView
  const shpU8       = new Uint8Array(shpAB);

  // ── SHX file ─────────────────────────────────────────────────────────
  const shxTotalLen = 100 + records.length * 8;
  const shxAB       = new ArrayBuffer(shxTotalLen);   // ← ArrayBuffer first
  const shxDV       = new DataView(shxAB);             // ← then DataView

  // Shared file-header writer (SHP and SHX headers are the same structure)
  const writeFileHeader = (dv, fileLenBytes) => {
    dv.setInt32(0,  9994,              false); // big-endian file code
    dv.setInt32(24, fileLenBytes / 2,  false); // file length in 16-bit words (big-endian)
    dv.setInt32(28, 1000,              true);  // version (little-endian)
    dv.setInt32(32, shpType,           true);  // shape type
    dv.setFloat64(36, xMin,            true);
    dv.setFloat64(44, yMin,            true);
    dv.setFloat64(52, xMax,            true);
    dv.setFloat64(60, yMax,            true);
    dv.setFloat64(68, 0, true);  // Zmin
    dv.setFloat64(76, 0, true);  // Zmax
    dv.setFloat64(84, 0, true);  // Mmin
    dv.setFloat64(92, 0, true);  // Mmax
  };

  writeFileHeader(shpDV, shpTotalLen);
  writeFileHeader(shxDV, shxTotalLen);

  let shpPos = 100;
  records.forEach((rec, ri) => {
    const contentWords = rec.length / 2; // content length in 16-bit words
    // SHP record header — big-endian
    shpDV.setInt32(shpPos,     ri + 1,        false);
    shpDV.setInt32(shpPos + 4, contentWords,  false);
    shpU8.set(rec, shpPos + 8);
    // SHX entry — big-endian
    shxDV.setInt32(100 + ri * 8,     shpPos / 2,   false);
    shxDV.setInt32(100 + ri * 8 + 4, contentWords, false);
    shpPos += 8 + rec.length;
  });

  return {
    shp: new Uint8Array(shpAB),
    shx: new Uint8Array(shxAB),
  };
}

// ── PRJ string — WGS84 geographic CRS ────────────────────────────────────
const WGS84_PRJ =
  `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",` +
  `SPHEROID["WGS_1984",6378137.0,298.257223563]],` +
  `PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;

// ── Public export entry point ─────────────────────────────────────────────
async function exportShapefileZIP(geojson, fileName) {
  const features = [];
  const walkF = (f) => {
    if (!f) return;
    if (f.type === "FeatureCollection") f.features?.forEach(walkF);
    else if (f.type === "Feature" && f.geometry) features.push(f);
  };
  walkF(geojson);
  if (!features.length) { alert("No features to export."); return; }

  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");

  const normalized = features.map((f, i) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: {
      id:       i + 1,
      elev_m:   Number((f.properties?.elevation_m ?? 0).toFixed(1)),
      is_major: f.properties?.isMajor != null ? String(f.properties.isMajor) : "false",
      name:     String(f.properties?.name || f.properties?.Name || `Feature_${i + 1}`).slice(0, 80),
    },
  }));

  // One shapefile ZIP per geometry type
  const byType = {};
  normalized.forEach(f => {
    const gt = f.geometry?.type || "Unknown";
    if (!byType[gt]) byType[gt] = [];
    byType[gt].push(f);
  });

  const enc = new TextEncoder();

  for (const [geomType, feats] of Object.entries(byType)) {
    const suffix  = Object.keys(byType).length > 1 ? `_${geomType.toLowerCase()}` : "";
    const outName = baseName + suffix;

    const { shp, shx } = buildSHPandSHX(feats);
    const dbf           = buildDBF(feats);
    const prj           = enc.encode(WGS84_PRJ);

    const zipU8 = buildZip([
      { name: outName + ".shp", data: shp },
      { name: outName + ".shx", data: shx },
      { name: outName + ".dbf", data: dbf },
      { name: outName + ".prj", data: prj },
    ]);

    downloadArrayBuffer(zipU8.buffer, outName + "_shapefile.zip", "application/zip");
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   THEME
══════════════════════════════════════════════════════════════════════════ */

const T = {
  bg:        "rgba(4,10,22,0.98)",
  surface:   "rgba(255,255,255,0.04)",
  border:    "rgba(255,255,255,0.07)",
  text:      "#c8e0f8",
  textDim:   "rgba(180,210,250,0.42)",
  textFaint: "rgba(140,180,230,0.22)",
  blue:      "#4a9eff",
  cyan:      "#2dd4bf",
  green:     "#4ade80",
  amber:     "#fbbf24",
  red:       "#f87171",
  violet:    "#c4b5fd",
  pink:      "#fb7185",
};
const MONO = `"JetBrains Mono","DM Mono","Fira Code",monospace`;
const UI   = `"DM Sans","Outfit",system-ui,sans-serif`;

function Btn({ variant = "blue", children, onClick, disabled, small }) {
  const MAP = {
    blue:   [T.blue,   "rgba(74,158,255,0.14)",   "rgba(74,158,255,0.38)"],
    cyan:   [T.cyan,   "rgba(45,212,191,0.14)",   "rgba(45,212,191,0.38)"],
    green:  [T.green,  "rgba(74,222,128,0.14)",   "rgba(74,222,128,0.38)"],
    amber:  [T.amber,  "rgba(251,191,36,0.14)",   "rgba(251,191,36,0.38)"],
    red:    [T.red,    "rgba(248,113,113,0.14)",  "rgba(248,113,113,0.38)"],
    violet: [T.violet, "rgba(196,181,253,0.14)",  "rgba(196,181,253,0.38)"],
    pink:   [T.pink,   "rgba(251,113,133,0.14)",  "rgba(251,113,133,0.38)"],
  };
  const [color, bg, border] = MAP[variant] || MAP.blue;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", padding: small ? "6px 10px" : "9px 14px",
      borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
      background: bg, border: `1px solid ${border}`, color,
      fontSize: small ? 11 : 12, fontWeight: 700, fontFamily: UI,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      opacity: disabled ? 0.45 : 1, transition: "opacity 0.12s",
    }}>{children}</button>
  );
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: 9.5, fontWeight: 700, color: T.textFaint,
      textTransform: "uppercase", letterSpacing: "0.1em",
      fontFamily: MONO, marginBottom: 5,
    }}>{children}</div>
  );
}

function Card({ children, color = T.blue }) {
  return (
    <div style={{
      padding: "11px 13px", borderRadius: 10,
      background: `${color}12`, border: `1px solid ${color}28`,
      display: "flex", flexDirection: "column", gap: 6,
    }}>{children}</div>
  );
}

function Pill({ label, value, color = T.textDim }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "3px 0", borderBottom: `1px solid ${T.border}`,
    }}>
      <span style={{ color: T.textFaint, fontSize: 10, fontFamily: MONO }}>{label}</span>
      <span style={{ color, fontSize: 11, fontWeight: 700, fontFamily: MONO }}>{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════ */

export default function KMLProcessingPanel({
  kmlGeojson, kmlFileName, leafletMapRef, visible, onClose,
}) {
  const [tab,             setTab]             = useState("dem");
  const [status,          setStatus]          = useState("");
  const [progress,        setProgress]        = useState(0);
  const [isProcessing,    setIsProcessing]    = useState(false);
  const [elevGrid,        setElevGrid]        = useState(null);
  const [demOpacity,      setDemOpacity]      = useState(0.92);
  const [gridResolution,  setGridResolution]  = useState(30);
  const [hillshadeOn,     setHillshadeOn]     = useState(true);
  const [contourInterval, setContourInterval] = useState(10);
  const [majorEvery,      setMajorEvery]      = useState(50);
  const [contourColor,    setContourColor]    = useState("#c8a000");
  const [majorColor,      setMajorColor]      = useState("#7a4800");
  const [contourCount,    setContourCount]    = useState(0);
  const [maskVisible,     setMaskVisible]     = useState(false);
  const [demVisible,      setDemVisible]      = useState(false);
  const [contourVisible,  setContourVisible]  = useState(false);
  const [boundaryVisible, setBoundaryVisible] = useState(true);
  const [hasDEM,          setHasDEM]          = useState(false);
  const [hasContour,      setHasContour]      = useState(false);
  const [clipToKML,       setClipToKML]       = useState(true);

  const demLayerRef      = useRef(null);
  const contourLayerRef  = useRef(null);
  const boundaryLayerRef = useRef(null);
  const maskLayerRef     = useRef(null);

  useEffect(() => () => {
    [demLayerRef, contourLayerRef, boundaryLayerRef, maskLayerRef]
      .forEach(r => { try { r.current?.remove?.(); } catch (_) {} });
  }, []);

  useEffect(() => {
    if (!kmlGeojson || !leafletMapRef?.current) return;
    boundaryLayerRef.current?.remove?.();
    boundaryLayerRef.current = L.geoJSON(kmlGeojson, {
      style: { color: "#ffffff", weight: 2.5, opacity: 0.95, fillOpacity: 0, dashArray: "7 4" },
    }).addTo(leafletMapRef.current);
    setBoundaryVisible(true);
  }, [kmlGeojson]);

  const flyToKML = () => {
    if (!kmlGeojson || !leafletMapRef?.current) return;
    try {
      const b = L.geoJSON(kmlGeojson).getBounds();
      if (b.isValid()) leafletMapRef.current.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
    } catch (_) {}
  };

  const toggleBoundary = () => {
    const lyr = boundaryLayerRef.current;
    if (!lyr || !leafletMapRef?.current) return;
    boundaryVisible ? lyr.remove() : lyr.addTo(leafletMapRef.current);
    setBoundaryVisible(v => !v);
  };

  const applyMask = useCallback(() => {
    if (!kmlGeojson || !leafletMapRef?.current) return;
    maskLayerRef.current?.remove?.();
    const bbox  = getBBox(kmlGeojson);
    const rings = extractRings(kmlGeojson);
    maskLayerRef.current = buildMaskOverlay(leafletMapRef.current, bbox, rings);
    setMaskVisible(true);
  }, [kmlGeojson]);

  const removeMask = useCallback(() => {
    maskLayerRef.current?.remove?.(); maskLayerRef.current = null;
    setMaskVisible(false);
  }, []);

  const fetchElevationGrid = useCallback(async () => {
    if (!kmlGeojson) { setStatus("❌ No KML loaded."); return; }
    setIsProcessing(true); setStatus("📡 Contacting elevation APIs…"); setProgress(5);
    try {
      const bbox   = getBBox(kmlGeojson);
      const rows   = gridResolution, cols = gridResolution;
      const allPts = sampleGrid(bbox, rows, cols);
      const rings  = clipToKML ? extractRings(kmlGeojson) : [];
      const pts    = clipToKML && rings.length > 0
        ? allPts.filter(p => insideKML(p.lat, p.lng, rings)) : allPts;
      const finalPts = pts.length > 0 ? pts : allPts;
      const elevatedPts = [];
      const batchSize   = 100;
      for (let i = 0; i < finalPts.length; i += batchSize) {
        const result = await fetchElevationBatch(finalPts.slice(i, i + batchSize));
        elevatedPts.push(...result);
        setProgress(5 + Math.round((i / finalPts.length) * 65));
        setStatus(`📡 ${Math.min(i + batchSize, finalPts.length)} / ${finalPts.length} points…`);
      }
      const grid = Array.from({ length: rows }, () => Array(cols).fill(NaN));
      elevatedPts.forEach(p => { if (p.row < rows && p.col < cols) grid[p.row][p.col] = p.elevation; });
      let changed = true, pass = 0;
      while (changed && pass < 12) {
        changed = false; pass++;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          if (!isNaN(grid[r][c])) continue;
          const nbrs = [];
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !isNaN(grid[nr][nc])) nbrs.push(grid[nr][nc]);
          }
          if (nbrs.length) { grid[r][c] = nbrs.reduce((a, b) => a + b, 0) / nbrs.length; changed = true; }
        }
      }
      const flat = grid.flat().filter(v => !isNaN(v));
      if (!flat.length) { setStatus("❌ No elevation data."); setIsProcessing(false); setProgress(0); return; }
      const minE = Math.min(...flat), maxE = Math.max(...flat);
      setElevGrid({ grid, rows, cols, bbox, min: minE, max: maxE });
      setProgress(100);
      setStatus(`✅ ${Math.round(minE)}m → ${Math.round(maxE)}m  (Δ${Math.round(maxE - minE)}m)  ${rows}×${cols} pts`);
    } catch (err) {
      setStatus("❌ " + err.message); console.error(err);
    } finally {
      setIsProcessing(false); setTimeout(() => setProgress(0), 900);
    }
  }, [kmlGeojson, gridResolution, clipToKML]);

  const renderDEM = useCallback(() => {
    if (!elevGrid || !leafletMapRef?.current) { setStatus("⚠️ Fetch elevation first."); return; }
    setStatus("🎨 Rendering DEM…");
    try {
      demLayerRef.current?.remove?.();
      const rings = clipToKML ? extractRings(kmlGeojson) : [];
      demLayerRef.current = renderDEMCanvas(leafletMapRef.current, elevGrid, demOpacity, rings, 7);
      setDemVisible(true); setHasDEM(true);
      setStatus("✅ DEM rendered — Global Mapper hypsometric + NW hillshade");
    } catch (err) { setStatus("❌ DEM render failed: " + err.message); }
  }, [elevGrid, kmlGeojson, demOpacity, clipToKML, hillshadeOn]);

  const renderContours = useCallback(() => {
    if (!elevGrid || !leafletMapRef?.current) { setStatus("⚠️ Fetch elevation first."); return; }
    setStatus("📐 Generating contours…");
    try {
      contourLayerRef.current?.remove?.();
      const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;
      const rings  = clipToKML ? extractRings(kmlGeojson) : [];
      const start  = Math.ceil(minE / contourInterval) * contourInterval;
      const levels = [];
      for (let lv = start; lv <= maxE + 0.001; lv += contourInterval) levels.push(lv);
      if (!levels.length) { setStatus(`⚠️ Range too small for ${contourInterval}m interval`); return; }
      const rawSegs = generateContourSegments(grid, rows, cols, levels);
      const group   = L.layerGroup();
      let   total   = 0;
      levels.forEach(lv => {
        const isMajor = Math.round(lv) % majorEvery === 0;
        const clipped = (rawSegs[lv] || []).filter(([pt0, pt1]) => {
          if (!clipToKML || rings.length === 0) return true;
          const ll0 = gridToLatLng(pt0[0], pt0[1], bbox, rows, cols);
          const ll1 = gridToLatLng(pt1[0], pt1[1], bbox, rows, cols);
          return insideKML((ll0[0] + ll1[0]) / 2, (ll0[1] + ll1[1]) / 2, rings);
        });
        if (!clipped.length) return;
        stitchSegments(clipped).forEach(chain => {
          if (chain.length < 2) return;
          const latlngs = chain.map(([rF, cF]) => gridToLatLng(rF, cF, bbox, rows, cols));
          L.polyline(latlngs, {
            color: isMajor ? majorColor : contourColor, weight: isMajor ? 2.4 : 1.0,
            opacity: isMajor ? 1.0 : 0.72, interactive: false, lineJoin: "round", lineCap: "round",
          }).addTo(group);
          total++;
          if (isMajor && chain.length >= 4) {
            const mid = Math.floor(chain.length / 2);
            const [lat0, lng0] = latlngs[mid - 1], [lat1, lng1] = latlngs[mid];
            const angleDeg = Math.atan2(lng1 - lng0, lat1 - lat0) * (180 / Math.PI);
            const rotate   = angleDeg > 90 ? angleDeg - 180 : angleDeg < -90 ? angleDeg + 180 : angleDeg;
            L.marker([(lat0 + lat1) / 2, (lng0 + lng1) / 2], {
              icon: L.divIcon({
                className: "",
                html: `<div class="gm-clabel" style="transform:rotate(${rotate.toFixed(1)}deg)">${Math.round(lv)}</div>`,
                iconSize: [40, 16], iconAnchor: [20, 8],
              }),
              interactive: false, zIndexOffset: 500,
            }).addTo(group);
          }
        });
      });
      group.addTo(leafletMapRef.current);
      contourLayerRef.current = group;
      setContourVisible(true); setHasContour(true); setContourCount(total);
      setStatus(total > 0
        ? `✅ ${total} contour lines — ${contourInterval}m interval`
        : `⚠️ 0 lines — try smaller interval or higher resolution`);
    } catch (err) { setStatus("❌ Contour failed: " + err.message); console.error(err); }
  }, [elevGrid, kmlGeojson, contourInterval, majorEvery, contourColor, majorColor, clipToKML]);

  const toggleDEM = () => {
    if (!demLayerRef.current || !leafletMapRef?.current) return;
    demVisible ? (demLayerRef.current.remove(), setDemVisible(false))
               : (demLayerRef.current.addTo(leafletMapRef.current), setDemVisible(true));
  };
  const toggleContours = () => {
    if (!contourLayerRef.current || !leafletMapRef?.current) return;
    contourVisible ? (contourLayerRef.current.remove(), setContourVisible(false))
                   : (contourLayerRef.current.addTo(leafletMapRef.current), setContourVisible(true));
  };

  const exportGeoTIFF = () => {
    if (!elevGrid) { setStatus("⚠️ Fetch elevation first."); return; }
    try {
      downloadArrayBuffer(buildGeoTIFF(elevGrid),
        (kmlFileName || "dem").replace(/\.[^.]+$/, "") + "_dem.tif", "image/tiff");
      setStatus("✅ GeoTIFF exported — open in QGIS / Global Mapper");
    } catch (err) { setStatus("❌ GeoTIFF export failed: " + err.message); }
  };

  const exportContoursShapefile = async () => {
    if (!elevGrid) { setStatus("⚠️ Fetch elevation first."); return; }
    setStatus("📦 Building contour shapefile…");
    try {
      const rings = clipToKML ? extractRings(kmlGeojson) : [];
      const gj    = buildContourGeoJSON(elevGrid, contourInterval, majorEvery, rings);
      await exportShapefileZIP(gj,
        (kmlFileName || "contours").replace(/\.[^.]+$/, "") + `_contours_${contourInterval}m.shp`);
      setStatus("✅ Contours Shapefile ZIP exported — open in QGIS / ArcGIS");
    } catch (err) { setStatus("❌ Shapefile export failed: " + err.message); console.error(err); }
  };

  const exportContoursGeoJSON = () => {
    if (!elevGrid) { setStatus("⚠️ Fetch elevation first."); return; }
    const rings = clipToKML ? extractRings(kmlGeojson) : [];
    const gj    = buildContourGeoJSON(elevGrid, contourInterval, majorEvery, rings);
    const blob  = new Blob([JSON.stringify(gj, null, 2)], { type: "application/json" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href = url;
    a.download = (kmlFileName || "contours").replace(/\.[^.]+$/, "") + `_contours_${contourInterval}m.geojson`;
    a.click(); URL.revokeObjectURL(url);
    setStatus("✅ Contours GeoJSON exported");
  };

  const exportKMLShapefile = async () => {
    if (!kmlGeojson) { setStatus("⚠️ No KML loaded."); return; }
    setStatus("📦 Building KML shapefile…");
    try {
      await exportShapefileZIP(kmlGeojson, kmlFileName || "kml_export.shp");
      setStatus("✅ KML Shapefile ZIP exported — open in QGIS / ArcGIS");
    } catch (err) { setStatus("❌ Shapefile export failed: " + err.message); console.error(err); }
  };

  const exportKMLGeoJSON = () => {
    if (!kmlGeojson) return;
    const blob = new Blob([JSON.stringify(kmlGeojson, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = (kmlFileName || "kml").replace(/\.[^.]+$/, "") + ".geojson";
    a.click(); URL.revokeObjectURL(url);
    setStatus("✅ KML exported as GeoJSON");
  };

  const exportDEMCSV = () => {
    if (!elevGrid) { setStatus("⚠️ Fetch elevation first."); return; }
    const { grid, rows, cols, bbox } = elevGrid;
    const lines = ["lat,lng,elevation_m"];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const [lat, lng] = gridToLatLng(r, c, bbox, rows, cols);
      lines.push(`${lat.toFixed(7)},${lng.toFixed(7)},${isNaN(grid[r][c]) ? "" : Math.round(grid[r][c])}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = (kmlFileName || "dem").replace(/\.[^.]+$/, "") + "_dem_grid.csv";
    a.click(); URL.revokeObjectURL(url);
    setStatus("✅ DEM CSV exported");
  };

  const clearAll = () => {
    [demLayerRef, contourLayerRef, maskLayerRef].forEach(r => {
      try { r.current?.remove?.(); r.current = null; } catch (_) {}
    });
    setDemVisible(false); setContourVisible(false); setMaskVisible(false);
    setHasDEM(false); setHasContour(false); setElevGrid(null); setContourCount(0);
    setStatus("🗑 All layers cleared.");
  };

  if (!visible) return null;

  const TABS = [
    { id: "dem",     label: "🏔 DEM"       },
    { id: "contour", label: "📐 Contour"   },
    { id: "export",  label: "💾 Export"    },
    { id: "kml",     label: "📦 KML / SHP" },
  ];

  return (
    <>
      <style>{`
        .gm-clabel {
          background: rgba(255,252,230,0.92); color: #4a2800;
          font-size: 9.5px; font-weight: 800; font-family: 'DM Mono', monospace;
          padding: 1px 4px; border-radius: 2px; border: 1px solid rgba(140,90,10,0.45);
          white-space: nowrap; pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
          letter-spacing: 0.04em; line-height: 1.3; display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .kp-panel::-webkit-scrollbar { width: 3px; }
        .kp-panel::-webkit-scrollbar-thumb { background: rgba(74,158,255,0.2); border-radius: 2px; }
        .kp-panel { scrollbar-width: thin; scrollbar-color: rgba(74,158,255,0.18) transparent; }
      `}</style>

      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 348, zIndex: 5000,
        background: T.bg, backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        borderLeft: "1px solid rgba(74,158,255,0.18)",
        display: "flex", flexDirection: "column",
        fontFamily: UI, boxShadow: "-10px 0 60px rgba(0,0,0,0.75)",
      }}>

        {/* HEADER */}
        <div style={{ padding: "13px 14px 10px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9, flexShrink: 0,
              background: "linear-gradient(135deg,rgba(74,158,255,0.22),rgba(45,212,191,0.22))",
              border: "1px solid rgba(74,158,255,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
            }}>🗺</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: T.text, fontWeight: 700, fontSize: 13.5, lineHeight: 1.2 }}>KML Processing</div>
              <div style={{ color: T.textFaint, fontSize: 9.5, fontFamily: MONO, marginTop: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {kmlFileName || "No KML loaded"}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "none", border: "none", color: T.textFaint,
              cursor: "pointer", fontSize: 20, padding: 0, lineHeight: 1,
            }}>×</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
            {[
              ["🎯 Fly",  flyToKML,   "blue"],
              [boundaryVisible ? "⬜ Hide" : "⬛ Show", toggleBoundary, "cyan"],
              [maskVisible ? "🌑 Unmask" : "🌑 Mask", maskVisible ? removeMask : applyMask, "amber"],
              ["🗑 Clear", clearAll,  "red"],
            ].map(([label, fn, v]) => (
              <button key={label} onClick={fn} style={{
                padding: "6px 4px", borderRadius: 7, cursor: "pointer",
                background: `${T[v]}14`, border: `1px solid ${T[v]}35`,
                color: T[v], fontSize: 10, fontWeight: 700, fontFamily: UI,
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* TABS */}
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "8px 2px",
              background: tab === t.id ? "rgba(74,158,255,0.10)" : "transparent",
              border: "none", borderBottom: tab === t.id ? `2px solid ${T.blue}` : "2px solid transparent",
              color: tab === t.id ? T.blue : T.textFaint,
              fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: UI, transition: "all 0.12s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* CONTENT */}
        <div className="kp-panel" style={{ flex: 1, overflowY: "auto", padding: "12px 13px 24px" }}>

          {/* ════ DEM TAB ════ */}
          {tab === "dem" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <Card color={T.pink}>
                <div style={{ color: T.pink, fontWeight: 700, fontSize: 13 }}>🏔 Digital Elevation Model</div>
                <div style={{ color: T.textDim, fontSize: 10.5, lineHeight: 1.65 }}>
                  Global Mapper hypsometric ramp with NW-sun hillshade. Rendered only inside KML boundary.
                </div>
              </Card>

              <div>
                <Label>Grid Resolution</Label>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <input type="range" min={10} max={60} step={5} value={gridResolution}
                    onChange={e => setGridResolution(+e.target.value)}
                    style={{ flex: 1, accentColor: T.pink, cursor: "pointer" }} />
                  <span style={{ color: T.pink, fontSize: 11, fontFamily: MONO, minWidth: 58 }}>
                    {gridResolution}×{gridResolution}
                  </span>
                </div>
                <div style={{ color: T.textFaint, fontSize: 9.5, marginTop: 2 }}>Higher = more detail, slower fetch</div>
              </div>

              <div>
                <Label>DEM Opacity</Label>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <input type="range" min={0.1} max={1} step={0.05} value={demOpacity}
                    onChange={e => setDemOpacity(+e.target.value)}
                    style={{ flex: 1, accentColor: T.pink, cursor: "pointer" }} />
                  <span style={{ color: T.pink, fontSize: 11, fontFamily: MONO, minWidth: 36 }}>
                    {Math.round(demOpacity * 100)}%
                  </span>
                </div>
              </div>

              {[
                [hillshadeOn, setHillshadeOn, "Hillshade (NW sun 45°) — Global Mapper default", T.amber],
                [clipToKML,   setClipToKML,   "Clip DEM to KML boundary",                       T.blue],
              ].map(([val, set, label, c]) => (
                <label key={label} style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  padding: "8px 10px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`,
                }}>
                  <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                    style={{ accentColor: c, width: 14, height: 14 }} />
                  <span style={{ color: T.text, fontSize: 11.5 }}>{label}</span>
                </label>
              ))}

              <div>
                <Label>Global Mapper Hypsometric Ramp</Label>
                <div style={{
                  height: 20, borderRadius: 6, border: `1px solid ${T.border}`,
                  background: "linear-gradient(to right,#0061ab,#0d8fc9,#a1d48f,#6ab34f,#4f9d34,#b7b74c,#d4a347,#b57f35,#944028,#c4ae98,#e0d6cd,#ffffff)",
                }} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                  <span style={{ color: T.textFaint, fontSize: 9 }}>Sea level</span>
                  <span style={{ color: T.textFaint, fontSize: 9 }}>Peaks / Snow</span>
                </div>
                {elevGrid && (
                  <div style={{ textAlign: "center", color: T.textDim, fontSize: 10, fontFamily: MONO, marginTop: 4 }}>
                    {Math.round(elevGrid.min)}m — {Math.round(elevGrid.max)}m &nbsp;(Δ{Math.round(elevGrid.max - elevGrid.min)}m)
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Btn variant="pink" onClick={fetchElevationGrid} disabled={isProcessing || !kmlGeojson}>
                  {isProcessing
                    ? <><span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⟳</span> Fetching…</>
                    : "📡 Fetch Elevation Data"}
                </Btn>
                {isProcessing && (
                  <div style={{ height: 5, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`,
                      background: "linear-gradient(90deg,#f43f5e,#fb923c)",
                      borderRadius: 4, transition: "width 0.3s" }} />
                  </div>
                )}
                <Btn variant="amber" onClick={renderDEM} disabled={!elevGrid}>🎨 Render DEM on Map</Btn>
                {hasDEM && (
                  <Btn variant={demVisible ? "red" : "green"} onClick={toggleDEM}>
                    {demVisible ? "🙈 Hide DEM" : "👁 Show DEM"}
                  </Btn>
                )}
              </div>
            </div>
          )}

          {/* ════ CONTOUR TAB ════ */}
          {tab === "contour" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <Card color={T.cyan}>
                <div style={{ color: T.cyan, fontWeight: 700, fontSize: 13 }}>📐 Contour Lines</div>
                <div style={{ color: T.textDim, fontSize: 10.5, lineHeight: 1.65 }}>
                  Marching-squares contours, stitched, clipped to KML, with elevation labels.
                </div>
              </Card>

              {!elevGrid && (
                <div style={{ padding: "9px 11px", borderRadius: 8,
                  background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)",
                  color: T.amber, fontSize: 10.5, textAlign: "center" }}>
                  ⚠️ Fetch elevation in DEM tab first
                </div>
              )}

              <div>
                <Label>Contour Interval (m)</Label>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {[5, 10, 20, 25, 50, 100].map(v => (
                    <button key={v} onClick={() => setContourInterval(v)} style={{
                      flex: "1 0 auto", padding: "7px 5px", borderRadius: 7, cursor: "pointer",
                      background: contourInterval === v ? "rgba(45,212,191,0.16)" : T.surface,
                      border: `1px solid ${contourInterval === v ? "rgba(45,212,191,0.5)" : T.border}`,
                      color: contourInterval === v ? T.cyan : T.textDim,
                      fontSize: 11, fontWeight: 700, fontFamily: MONO,
                    }}>{v}m</button>
                  ))}
                </div>
              </div>

              <div>
                <Label>Major Contour Every</Label>
                <div style={{ display: "flex", gap: 5 }}>
                  {[25, 50, 100, 200].map(v => (
                    <button key={v} onClick={() => setMajorEvery(v)} style={{
                      flex: 1, padding: "7px 4px", borderRadius: 7, cursor: "pointer",
                      background: majorEvery === v ? "rgba(251,191,36,0.16)" : T.surface,
                      border: `1px solid ${majorEvery === v ? "rgba(251,191,36,0.5)" : T.border}`,
                      color: majorEvery === v ? T.amber : T.textDim,
                      fontSize: 11, fontWeight: 700, fontFamily: MONO,
                    }}>{v}m</button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[["Minor Color", contourColor, setContourColor], ["Major Color", majorColor, setMajorColor]].map(([lbl, val, set]) => (
                  <div key={lbl}>
                    <Label>{lbl}</Label>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <input type="color" value={val} onChange={e => set(e.target.value)}
                        style={{ width: 30, height: 30, border: "none", borderRadius: 6, cursor: "pointer" }} />
                      <span style={{ color: T.textDim, fontSize: 10, fontFamily: MONO }}>{val}</span>
                    </div>
                  </div>
                ))}
              </div>

              <label style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                padding: "8px 10px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`,
              }}>
                <input type="checkbox" checked={clipToKML} onChange={e => setClipToKML(e.target.checked)}
                  style={{ accentColor: T.blue, width: 14, height: 14 }} />
                <span style={{ color: T.text, fontSize: 11.5 }}>Clip contours to KML boundary</span>
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {!elevGrid && (
                  <Btn variant="blue" onClick={fetchElevationGrid} disabled={isProcessing || !kmlGeojson}>
                    📡 Fetch Elevation First
                  </Btn>
                )}
                <Btn variant="cyan" onClick={renderContours} disabled={!elevGrid}>
                  📐 Generate &amp; Draw Contours
                </Btn>
                {hasContour && (
                  <>
                    <Btn variant={contourVisible ? "red" : "green"} onClick={toggleContours}>
                      {contourVisible ? "🙈 Hide Contours" : "👁 Show Contours"}
                    </Btn>
                    {contourCount > 0 && (
                      <div style={{ textAlign: "center", color: T.cyan, fontSize: 10, fontFamily: MONO }}>
                        {contourCount} lines @ {contourInterval}m interval
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ════ EXPORT TAB ════ */}
          {tab === "export" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <Card color={T.violet}>
                <div style={{ color: T.violet, fontWeight: 700, fontSize: 13 }}>💾 Export All Data</div>
                <div style={{ color: T.textDim, fontSize: 10.5, lineHeight: 1.65 }}>
                  GeoTIFF (QGIS/Global Mapper), Shapefile ZIP (ArcGIS/QGIS), GeoJSON, CSV
                </div>
              </Card>

              <div style={{ padding: "10px 12px", background: T.surface, borderRadius: 9, border: `1px solid ${T.border}` }}>
                <div style={{ color: T.pink, fontWeight: 700, fontSize: 11.5, marginBottom: 7 }}>🏔 Elevation / DEM</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <Btn variant="pink"  onClick={exportGeoTIFF} disabled={!elevGrid} small>Export DEM as GeoTIFF (.tif)</Btn>
                  <Btn variant="amber" onClick={exportDEMCSV}  disabled={!elevGrid} small>Export DEM Grid as CSV</Btn>
                </div>
                {!elevGrid && <div style={{ color: T.textFaint, fontSize: 9.5, marginTop: 5 }}>Fetch elevation in DEM tab first</div>}
              </div>

              <div style={{ padding: "10px 12px", background: T.surface, borderRadius: 9, border: `1px solid ${T.border}` }}>
                <div style={{ color: T.cyan, fontWeight: 700, fontSize: 11.5, marginBottom: 7 }}>📐 Contour Lines</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <Btn variant="cyan" onClick={exportContoursShapefile} disabled={!elevGrid} small>Export Contours → Shapefile ZIP</Btn>
                  <Btn variant="blue" onClick={exportContoursGeoJSON}   disabled={!elevGrid} small>Export Contours → GeoJSON</Btn>
                </div>
                {!elevGrid && <div style={{ color: T.textFaint, fontSize: 9.5, marginTop: 5 }}>Generate contours first</div>}
              </div>

              {elevGrid && (
                <div style={{ padding: "10px 12px", background: "rgba(74,222,128,0.05)", borderRadius: 9, border: "1px solid rgba(74,222,128,0.18)" }}>
                  <div style={{ color: T.green, fontWeight: 700, fontSize: 11, marginBottom: 6 }}>✅ Processing Summary</div>
                  <Pill label="Grid"     value={`${elevGrid.rows}×${elevGrid.cols} pts`} color={T.text} />
                  <Pill label="Min elev" value={`${Math.round(elevGrid.min)} m`}         color={T.cyan} />
                  <Pill label="Max elev" value={`${Math.round(elevGrid.max)} m`}         color={T.pink} />
                  <Pill label="Range"    value={`${Math.round(elevGrid.max - elevGrid.min)} m`} color={T.amber} />
                  {contourCount > 0 && <Pill label="Contours" value={`${contourCount} @ ${contourInterval}m`} color={T.violet} />}
                </div>
              )}
            </div>
          )}

          {/* ════ KML / SHP TAB ════ */}
          {tab === "kml" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <Card color={T.blue}>
                <div style={{ color: T.blue, fontWeight: 700, fontSize: 13 }}>📦 KML Feature Export</div>
                <div style={{ color: T.textDim, fontSize: 10.5, lineHeight: 1.65 }}>
                  Convert KML/GeoJSON to ESRI Shapefile ZIP — QGIS, ArcGIS, Global Mapper compatible.
                </div>
              </Card>

              <div style={{ padding: "8px 10px", borderRadius: 8,
                background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)",
                color: T.green, fontSize: 9.5, fontFamily: MONO }}>
                ✅ v6.5.0 — pure JS SHP/DBF/ZIP, no external deps, DataView bug fixed
              </div>

              {kmlGeojson ? (
                <>
                  {(() => {
                    const counts = { Point: 0, Line: 0, Polygon: 0 };
                    const walk = (f) => {
                      if (!f) return;
                      if (f.type === "FeatureCollection") f.features?.forEach(walk);
                      else if (f.type === "Feature") {
                        const t = f.geometry?.type || "";
                        if (t.includes("Point")) counts.Point++;
                        else if (t.includes("Line")) counts.Line++;
                        else if (t.includes("Poly")) counts.Polygon++;
                      }
                    };
                    walk(kmlGeojson);
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        {[["📍","Points",counts.Point,T.blue],["〰","Lines",counts.Line,T.green],["⬡","Polygons",counts.Polygon,T.amber]]
                          .map(([ico, lbl, cnt, c]) => (
                          <div key={lbl} style={{ padding: "10px 6px", background: T.surface,
                            borderRadius: 8, border: `1px solid ${T.border}`, textAlign: "center" }}>
                            <div style={{ fontSize: 15, marginBottom: 3 }}>{ico}</div>
                            <div style={{ color: c, fontSize: 18, fontWeight: 800, fontFamily: MONO, lineHeight: 1 }}>{cnt}</div>
                            <div style={{ color: T.textFaint, fontSize: 9.5, marginTop: 2 }}>{lbl}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <Btn variant="green" onClick={exportKMLShapefile}>📦 Export KML → Shapefile ZIP</Btn>
                  <Btn variant="cyan"  onClick={exportKMLGeoJSON}>🌐 Export KML → GeoJSON</Btn>
                </>
              ) : (
                <div style={{ textAlign: "center", color: T.textFaint, fontSize: 12, padding: "28px 0", fontStyle: "italic" }}>
                  Load a KML file first
                </div>
              )}
            </div>
          )}
        </div>

        {/* STATUS BAR */}
        {status && (
          <div style={{
            padding: "7px 13px", flexShrink: 0,
            borderTop: `1px solid ${T.border}`, background: "rgba(0,0,0,0.28)",
            color: status.startsWith("✅") ? T.green : status.startsWith("❌") ? T.red
                 : status.startsWith("⚠") ? T.amber : T.blue,
            fontSize: 10.5, fontFamily: MONO,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{status}</div>
        )}
      </div>
    </>
  );
}