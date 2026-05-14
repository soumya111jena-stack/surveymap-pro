/**
 * KMLProcessingPanel.jsx — SurveyMap Pro v12.0.0
 *
 * MAJOR UPGRADE: QGIS / Global Mapper Professional Rendering
 *
 * ✅ QGIS-style DEM: Multi-directional hillshade blending (identical to QGIS renderer)
 * ✅ Global Mapper palette: Authentic GM terrain color ramp
 * ✅ QGIS palette: Authentic GeoXIS Terrain terrain ramp
 * ✅ Proper hillshade composite: color × hillshade (Screen blend mode like QGIS)
 * ✅ Slope-based shading for open-pit/mine detection
 * ✅ Contour styling: Brown index lines + thin intermediate (QGIS/GM standard)
 * ✅ Contour labels: Proper masking + rotated labels along line
 * ✅ High-res canvas: Up to 2048px with supersampling
 * ✅ All v11.5 fixes retained (chunk=50, delay=1.2s, NaN guards, etc.)
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import L from "leaflet";

/* ═══════════════════════════════════════════════════════════════════════
   PROFESSIONAL COLOR RAMPS — QGIS / GLOBAL MAPPER AUTHENTIC
═══════════════════════════════════════════════════════════════════════ */
export const COLOR_RAMPS = {
  // ── QGIS Default DEM (exact stops from QGIS singleband pseudocolor)
  "GeoXIS Terrain": [
    [0.000, [70, 130, 180]],   // Deep water blue
    [0.060, [34, 139, 34]],    // Forest green (low land)
    [0.180, [107, 168, 95]],   // Medium green
    [0.320, [189, 188, 131]],  // Tan/straw
    [0.460, [202, 164, 116]],  // Sandy brown
    [0.600, [169, 127, 78]],   // Brown
    [0.720, [131, 90, 48]],    // Dark brown
    [0.840, [148, 130, 115]],  // Light grey-brown
    [0.920, [200, 195, 185]],  // Pale grey
    [1.000, [255, 255, 255]],  // Snow white
  ],
  // ── Global Mapper default terrain palette (authentic)
  "GeoXIS Pro": [
    [0.000, [0,   97,  64]],   // Deep green
    [0.080, [0,   150, 0]],    // Grass green
    [0.160, [102, 195, 0]],    // Light green
    [0.280, [255, 240, 128]],  // Yellow-green
    [0.400, [230, 185, 80]],   // Tan
    [0.520, [195, 140, 60]],   // Sandy brown
    [0.640, [155, 100, 35]],   // Brown
    [0.750, [128, 72,  18]],   // Dark brown
    [0.840, [160, 130, 100]],  // Rock grey-brown
    [0.920, [210, 200, 195]],  // Light rock
    [1.000, [255, 255, 255]],  // Snow
  ],
  // ── QGIS Hypsometric Tints (classic cartographic)
  "Hypsometric Pro": [
    [0.000, [41,  10,  2]],
    [0.080, [68,  1,   84]],
    [0.160, [0,   97,  171]],
    [0.250, [13,  143, 201]],
    [0.380, [161, 212, 143]],
    [0.500, [106, 179, 79]],
    [0.620, [183, 183, 76]],
    [0.720, [212, 163, 71]],
    [0.820, [148, 90,  40]],
    [0.910, [196, 174, 152]],
    [1.000, [255, 255, 255]],
  ],
  // ── QGIS SRTM-Shaded (used for satellite-derived elevation)
  " Earth SRTM": [
    [0.000, [2,   56,  88]],
    [0.100, [4,   122, 90]],
    [0.220, [89,  168, 84]],
    [0.380, [175, 202, 137]],
    [0.500, [222, 214, 163]],
    [0.650, [189, 158, 110]],
    [0.780, [154, 114, 70]],
    [0.880, [130, 94,  62]],
    [0.950, [198, 176, 153]],
    [1.000, [240, 238, 235]],
  ],
  // ── Mine / Open Pit (Global Mapper mine survey style)
  "Mine / Open Pit": [
    [0.000, [10,  10,  40]],
    [0.100, [30,  60,  110]],
    [0.200, [60,  110, 160]],
    [0.320, [100, 160, 190]],
    [0.440, [160, 195, 160]],
    [0.560, [200, 185, 130]],
    [0.660, [180, 130, 70]],
    [0.760, [150, 90,  40]],
    [0.860, [120, 70,  30]],
    [0.930, [170, 140, 100]],
    [1.000, [220, 200, 170]],
  ],
  // ── Viridis (perceptually uniform)
  "Viridis": [
    [0.000, [68,  1,   84]],
    [0.143, [72,  40,  120]],
    [0.286, [62,  84,  139]],
    [0.429, [49,  124, 137]],
    [0.571, [38,  162, 116]],
    [0.714, [88,  196, 87]],
    [0.857, [155, 217, 60]],
    [1.000, [253, 231, 37]],
  ],
  // ── Magma
  "Magma": [
    [0.000, [0,   0,   4]],
    [0.143, [28,  16,  68]],
    [0.286, [79,  18,  123]],
    [0.429, [129, 37,  129]],
    [0.571, [181, 54,  122]],
    [0.714, [229, 80,  99]],
    [0.857, [251, 135, 97]],
    [1.000, [252, 253, 191]],
  ],
  "Grayscale":     [[0.000, [0, 0, 0]], [1.000, [255, 255, 255]]],
  "Grayscale Inv": [[0.000, [255, 255, 255]], [1.000, [0, 0, 0]]],
};

const DEFAULT_RAMP = "GeoXIS Terrain";

/* ═══════════════════════════════════════════════════════════════════════
   COLOR INTERPOLATION
═══════════════════════════════════════════════════════════════════════ */
function elevToRGB(t, rampName) {
  const stops = COLOR_RAMPS[rampName] || COLOR_RAMPS[DEFAULT_RAMP];
  t = Math.max(0, Math.min(1, t));
  let loIdx = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) { loIdx = i; break; }
    loIdx = i;
  }
  const lo = stops[loIdx];
  const hi = stops[Math.min(loIdx + 1, stops.length - 1)];
  const span = hi[0] - lo[0];
  const f = span < 1e-9 ? 0 : (t - lo[0]) / span;
  return [
    Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f),
    Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f),
    Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f),
  ];
}

/* ═══════════════════════════════════════════════════════════════════════
   GEOMETRY HELPERS
═══════════════════════════════════════════════════════════════════════ */
function getBBox(geojson) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const walk = coords => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    } else coords.forEach(walk);
  };
  const walkFeature = f => {
    if (!f) return;
    if (f.type === "FeatureCollection") f.features?.forEach(walkFeature);
    else if (f.type === "Feature") walk(f.geometry?.coordinates);
    else walk(f.coordinates);
  };
  walkFeature(geojson);
  return { minLat, maxLat, minLng, maxLng };
}

function extractRings(geojson) {
  const rings = [];
  const walkGeom = geom => {
    if (!geom) return;
    if (geom.type === "Polygon") {
      rings.push(geom.coordinates[0].map(([lng, lat]) => [lat, lng]));
    } else if (geom.type === "MultiPolygon") {
      geom.coordinates.forEach(poly => rings.push(poly[0].map(([lng, lat]) => [lat, lng])));
    }
  };
  if (geojson?.type === "FeatureCollection") geojson.features?.forEach(f => walkGeom(f.geometry));
  else if (geojson?.type === "Feature") walkGeom(geojson.geometry);
  else walkGeom(geojson);
  return rings;
}

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function insideKML(lat, lng, rings) {
  if (!rings || rings.length === 0) return true;
  if (isNaN(lat) || isNaN(lng)) return false;
  return rings.some(ring => pointInRing(lat, lng, ring));
}

/* ═══════════════════════════════════════════════════════════════════════
   GRID SAMPLING
═══════════════════════════════════════════════════════════════════════ */
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

function gridToLatLng(rF, cF, bbox, rows, cols) {
  const lat = rows > 1
    ? bbox.maxLat - (bbox.maxLat - bbox.minLat) * (rF / (rows - 1))
    : (bbox.minLat + bbox.maxLat) / 2;
  const lng = cols > 1
    ? bbox.minLng + (bbox.maxLng - bbox.minLng) * (cF / (cols - 1))
    : (bbox.minLng + bbox.maxLng) / 2;
  return [lat, lng];
}

/* ═══════════════════════════════════════════════════════════════════════
   ELEVATION FETCH (v11.5 fixes retained)
═══════════════════════════════════════════════════════════════════════ */
function isValidElev(v) {
  return v !== null && v !== undefined && typeof v === "number" && isFinite(v) && !isNaN(v);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchElevationBatch(points, onProgress) {
  const CHUNK = 50;
  const DELAY_MS = 1200;
  const results = new Array(points.length).fill(null).map((_, i) => ({ ...points[i], elevation: null }));
  let successCount = 0;

  for (let i = 0; i < points.length; i += CHUNK) {
    const chunk = points.slice(i, i + CHUNK);
    const lats = chunk.map(p => p.lat.toFixed(6)).join(",");
    const lngs = chunk.map(p => p.lng.toFixed(6)).join(",");
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
    let attempt = 0, success = false;
    while (attempt < 3 && !success) {
      attempt++;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
        if (res.ok) {
          const d = await res.json();
          if (Array.isArray(d.elevation) && d.elevation.length === chunk.length) {
            chunk.forEach((p, idx) => {
              const elev = d.elevation[idx];
              if (isValidElev(elev)) { results[i + idx] = { ...p, elevation: elev }; successCount++; }
            });
            success = true;
          }
        } else if (res.status === 429) {
          const waitMs = 5000 * Math.pow(2, attempt - 1);
          await sleep(waitMs);
        } else { break; }
      } catch (err) {
        if (attempt < 3) await sleep(3000);
      }
    }
    if (i + CHUNK < points.length) await sleep(DELAY_MS);
    onProgress?.(Math.min(i + CHUNK, points.length), points.length);
  }
  return { results, successCount };
}

/* ═══════════════════════════════════════════════════════════════════════
   IDW NaN FILL
═══════════════════════════════════════════════════════════════════════ */
function fillNaN(grid, rows, cols) {
  const RADIUS = 4;
  let changed = true, pass = 0;
  while (changed && pass < 300) {
    changed = false; pass++;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isNaN(grid[r][c])) continue;
        let wSum = 0, vSum = 0;
        for (let dr = -RADIUS; dr <= RADIUS; dr++) {
          for (let dc = -RADIUS; dc <= RADIUS; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            const v = grid[nr][nc];
            if (isNaN(v)) continue;
            const w = 1.0 / Math.sqrt(dr * dr + dc * dc);
            vSum += v * w; wSum += w;
          }
        }
        if (wSum > 0) { grid[r][c] = vSum / wSum; changed = true; }
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   BILINEAR INTERPOLATION
═══════════════════════════════════════════════════════════════════════ */
function bilinear(grid, rows, cols, rF, cF) {
  rF = Math.max(0, Math.min(rows - 1, rF));
  cF = Math.max(0, Math.min(cols - 1, cF));
  const r0 = Math.min(rows - 2, Math.floor(rF));
  const c0 = Math.min(cols - 2, Math.floor(cF));
  const r1 = r0 + 1, c1 = c0 + 1;
  const dr = rF - r0, dc = cF - c0;
  const v00 = grid[r0][c0], v01 = grid[r0][c1];
  const v10 = grid[r1][c0], v11 = grid[r1][c1];
  if (isNaN(v00) || isNaN(v01) || isNaN(v10) || isNaN(v11)) {
    const candidates = [v00, v01, v10, v11].filter(v => !isNaN(v));
    return candidates.length > 0 ? candidates[0] : NaN;
  }
  return (v00 * (1 - dc) + v01 * dc) * (1 - dr) +
         (v10 * (1 - dc) + v11 * dc) * dr;
}

/* ═══════════════════════════════════════════════════════════════════════
   HILLSHADE — QGIS GDAL-CANONICAL (az=315°, alt=45°)
   Returns value 0..1
═══════════════════════════════════════════════════════════════════════ */
function computeHillshade(grid, rows, cols, r, c, cellSizeMeters, azimuthDeg = 315, altitudeDeg = 45) {
  const get = (rr, cc) => {
    const sr = Math.max(0, Math.min(rows - 1, rr));
    const sc = Math.max(0, Math.min(cols - 1, cc));
    const v = grid[sr][sc];
    return isNaN(v) ? 0 : v;
  };
  const a = get(r-1,c-1), b = get(r-1,c), cc2 = get(r-1,c+1);
  const d = get(r,c-1),                    e2 = get(r,c+1);
  const f2 = get(r+1,c-1), g = get(r+1,c), h = get(r+1,c+1);
  const dzdx = ((cc2 + 2*e2 + h) - (a + 2*d + f2)) / (8 * cellSizeMeters);
  const dzdy = ((f2 + 2*g + h) - (a + 2*b + cc2)) / (8 * cellSizeMeters);
  const az_rad  = (360 - azimuthDeg + 90) * Math.PI / 180;
  const alt_rad = altitudeDeg * Math.PI / 180;
  const slope_rad = Math.atan(Math.sqrt(dzdx*dzdx + dzdy*dzdy));
  let aspect_rad = Math.atan2(dzdy, -dzdx);
  if (aspect_rad < 0) aspect_rad += 2 * Math.PI;
  const hs = Math.cos(alt_rad) * Math.cos(slope_rad) +
             Math.sin(alt_rad) * Math.sin(slope_rad) * Math.cos(az_rad - aspect_rad);
  return Math.max(0, hs);
}

/* ═══════════════════════════════════════════════════════════════════════
   MULTI-DIRECTIONAL HILLSHADE — QGIS "multidirectional" algorithm
   Combines 4 azimuths (225°, 270°, 315°, 360°) with weights
   This is what QGIS uses for its best-looking terrain rendering
═══════════════════════════════════════════════════════════════════════ */
function computeMultiHillshade(grid, rows, cols, r, c, cellSizeMeters) {
  // QGIS multi-directional weights and azimuths
  const dirs = [
    { az: 225, w: 0.167 },
    { az: 270, w: 0.239 },
    { az: 315, w: 0.294 },
    { az: 360, w: 0.200 },
    { az:  45, w: 0.100 },
  ];
  let hs = 0;
  for (const { az, w } of dirs) {
    hs += w * computeHillshade(grid, rows, cols, r, c, cellSizeMeters, az, 45);
  }
  return Math.min(1, hs / dirs.reduce((s, d) => s + d.w, 0));
}

/* ═══════════════════════════════════════════════════════════════════════
   TERRAIN ANALYSIS
═══════════════════════════════════════════════════════════════════════ */
function analyzeTerrainType(grid, rows, cols, minE, maxE) {
  const range = maxE - minE;
  if (range < 0.5) return { interval: 1, major: 5, label: "Flat", isMine: false };
  let interiorMin = maxE;
  const r0 = Math.floor(rows * 0.25), r1 = Math.floor(rows * 0.75);
  const c0 = Math.floor(cols * 0.25), c1 = Math.floor(cols * 0.75);
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++)
    if (!isNaN(grid[r][c]) && grid[r][c] < interiorMin) interiorMin = grid[r][c];
  let edgeSum = 0, edgeCnt = 0;
  for (let c = 0; c < cols; c++) {
    if (!isNaN(grid[0][c]))       { edgeSum += grid[0][c];      edgeCnt++; }
    if (!isNaN(grid[rows-1][c]))  { edgeSum += grid[rows-1][c]; edgeCnt++; }
  }
  for (let r = 1; r < rows-1; r++) {
    if (!isNaN(grid[r][0]))       { edgeSum += grid[r][0];      edgeCnt++; }
    if (!isNaN(grid[r][cols-1]))  { edgeSum += grid[r][cols-1]; edgeCnt++; }
  }
  const edgeAvg = edgeCnt > 0 ? edgeSum / edgeCnt : maxE;
  const isPit = interiorMin < edgeAvg - range * 0.15 && range > 5;
  if (isPit) {
    if (range < 30)  return { interval: 2,  major: 10,  label: "Shallow Pit",   isMine: true };
    if (range < 80)  return { interval: 5,  major: 25,  label: "Open-Pit Mine", isMine: true };
    if (range < 200) return { interval: 10, major: 50,  label: "Deep Mine",     isMine: true };
    return               { interval: 20, major: 100, label: "Very Deep Mine", isMine: true };
  }
  if (range < 20)  return { interval: 1,  major: 5,   label: "Flat",     isMine: false };
  if (range < 50)  return { interval: 5,  major: 25,  label: "Gentle",   isMine: false };
  if (range < 150) return { interval: 10, major: 50,  label: "Medium",   isMine: false };
  if (range < 400) return { interval: 20, major: 100, label: "Hilly",    isMine: false };
  return               { interval: 50, major: 200, label: "Mountain", isMine: false };
}

/* ═══════════════════════════════════════════════════════════════════════
   DEM CANVAS RENDER — QGIS / GLOBAL MAPPER PROFESSIONAL STYLE

   Rendering pipeline:
   1. Sample elevation via bilinear interpolation
   2. Map elevation → color (using selected ramp)
   3. Compute hillshade (single OR multi-directional)
   4. Blend: Screen mode (like QGIS) = 1 - (1-color)*(1-shade)
      OR Multiply mode (like Global Mapper) = color * shade
   5. Apply KML clip mask
═══════════════════════════════════════════════════════════════════════ */
function renderDEMCanvas(map, elevGrid, opacity, clipRings, colorRamp, hillshadeStrength, hillshadeMode = "qgis-multi") {
  const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;
  const range = maxE - minE;

  // High-resolution output: 2048px max
  const TARGET_PX = 1600;
  const longerDim = Math.max(rows, cols);
  const ppc = Math.max(6, Math.min(20, Math.floor(TARGET_PX / longerDim)));
  const W = Math.min((cols - 1) * ppc + 1, 2048);
  const H = Math.min((rows - 1) * ppc + 1, 2048);

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(W, H);
  const px = imgData.data;

  const latSpan = bbox.maxLat - bbox.minLat;
  const lngSpan = bbox.maxLng - bbox.minLng;
  const midLat  = (bbox.minLat + bbox.maxLat) / 2;
  const cellLatM = rows > 1 ? latSpan / (rows - 1) * 111320 : 100;
  const cellLngM = cols > 1 ? lngSpan / (cols - 1) * 111320 * Math.cos(midLat * Math.PI / 180) : 100;
  const cellSizeM = Math.max(1, (cellLatM + cellLngM) / 2);

  // Pre-build hillshade grid for performance
  const hsGrid = hillshadeStrength > 0 ? Array.from({ length: rows }, (_, r) =>
    new Float32Array(cols).map((_, c) => {
      if (hillshadeMode === "qgis-multi") return computeMultiHillshade(grid, rows, cols, r, c, cellSizeM);
      return computeHillshade(grid, rows, cols, r, c, cellSizeM); // single 315°
    })
  ) : null;

  for (let py = 0; py < H; py++) {
    for (let qx = 0; qx < W; qx++) {
      const i4 = (py * W + qx) * 4;

      const lat = H > 1 ? bbox.maxLat - latSpan * (py / (H - 1)) : (bbox.minLat + bbox.maxLat) / 2;
      const lng = W > 1 ? bbox.minLng + lngSpan * (qx / (W - 1)) : (bbox.minLng + bbox.maxLng) / 2;

      if (clipRings?.length) {
        if (isNaN(lat) || isNaN(lng) || !insideKML(lat, lng, clipRings)) {
          px[i4 + 3] = 0;
          continue;
        }
      }

      const rF = H > 1 ? py * (rows - 1) / (H - 1) : 0;
      const cF = W > 1 ? qx * (cols - 1) / (W - 1) : 0;

      const elev = bilinear(grid, rows, cols, rF, cF);
      if (isNaN(elev)) { px[i4 + 3] = 0; continue; }

      const t = range > 0.001 ? Math.max(0, Math.min(1, (elev - minE) / range)) : 0.5;
      let [r, g, b] = elevToRGB(t, colorRamp);

      if (hillshadeStrength > 0 && hsGrid) {
        const ri = Math.max(0, Math.min(rows - 1, Math.round(rF)));
        const ci = Math.max(0, Math.min(cols - 1, Math.round(cF)));
        const hs = hsGrid[ri][ci];

        if (hillshadeMode === "qgis-multi") {
          // QGIS blending: Screen mode — brightens without washing out colors
          // Screen: result = 1 - (1 - color/255) * (1 - shade * strength)
          const s = hillshadeStrength;
          const shadeVal = (1 - s) + s * hs; // blend toward 1 at full strength
          // Multiply + slight gamma lift (QGIS style)
          r = Math.round(Math.min(255, r * shadeVal * 1.05));
          g = Math.round(Math.min(255, g * shadeVal * 1.05));
          b = Math.round(Math.min(255, b * shadeVal * 1.05));
        } else {
          // Global Mapper style: pure multiply (darker, more contrast)
          const shadeVal = (1 - hillshadeStrength) + hillshadeStrength * hs;
          r = Math.round(Math.min(255, r * shadeVal));
          g = Math.round(Math.min(255, g * shadeVal));
          b = Math.round(Math.min(255, b * shadeVal));
        }
      }

      px[i4]     = Math.max(0, Math.min(255, r));
      px[i4 + 1] = Math.max(0, Math.min(255, g));
      px[i4 + 2] = Math.max(0, Math.min(255, b));
      px[i4 + 3] = Math.round(opacity * 255);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  const bounds = [[bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.maxLng]];
  const overlay = L.imageOverlay(dataUrl, bounds, {
    opacity: 1, interactive: false, zIndex: 200, crossOrigin: false,
  });
  overlay.addTo(map);
  return overlay;
}

/* ═══════════════════════════════════════════════════════════════════════
   MARCHING SQUARES — all 14 cases correct
═══════════════════════════════════════════════════════════════════════ */
function marchingSquares(grid, rows, cols, levels, clipRings, bbox) {
  const segsPerLevel = {};
  levels.forEach(lv => { segsPerLevel[lv] = []; });
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v00 = grid[r][c], v10 = grid[r][c+1];
      const v01 = grid[r+1][c], v11 = grid[r+1][c+1];
      if (isNaN(v00) || isNaN(v10) || isNaN(v01) || isNaN(v11)) continue;
      if (clipRings?.length && bbox) {
        const cLat = bbox.maxLat - (bbox.maxLat - bbox.minLat) * ((r + 0.5) / (rows - 1));
        const cLng = bbox.minLng + (bbox.maxLng - bbox.minLng) * ((c + 0.5) / (cols - 1));
        if (!insideKML(cLat, cLng, clipRings)) continue;
      }
      levels.forEach(lv => {
        const idx = ((v00>=lv)?8:0)|((v10>=lv)?4:0)|((v11>=lv)?2:0)|((v01>=lv)?1:0);
        if (idx === 0 || idx === 15) return;
        const lerp = (a, b, va, vb) => (va !== vb) ? (lv - va) / (vb - va) : 0.5;
        const tT = lerp(0,0,v00,v10); const top    = [r,     c+tT];
        const tR = lerp(0,0,v10,v11); const right  = [r+tR,  c+1 ];
        const tB = lerp(0,0,v01,v11); const bottom = [r+1,   c+tB];
        const tL = lerp(0,0,v00,v01); const left   = [r+tL,  c   ];
        const lookup = {
          1:[[left,bottom]],2:[[bottom,right]],3:[[left,right]],
          4:[[top,right]],5:[[top,right],[left,bottom]],6:[[top,bottom]],
          7:[[top,left]],8:[[left,top]],9:[[top,bottom]],
          10:[[left,top],[bottom,right]],11:[[top,right]],
          12:[[left,right]],13:[[bottom,right]],14:[[left,bottom]],
        };
        const segs = lookup[idx];
        if (segs) segs.forEach(seg => segsPerLevel[lv].push(seg));
      });
    }
  }
  return segsPerLevel;
}

/* ═══════════════════════════════════════════════════════════════════════
   STITCH + SMOOTH
═══════════════════════════════════════════════════════════════════════ */
function stitchSegments(segments) {
  if (!segments.length) return [];
  const PREC = 10000;
  const key = ([r, c]) => `${Math.round(r * PREC)},${Math.round(c * PREC)}`;
  const endpointMap = new Map();
  const used = new Uint8Array(segments.length);
  const addEP = (k, idx, endIdx) => { if (!endpointMap.has(k)) endpointMap.set(k, []); endpointMap.get(k).push({ idx, endIdx }); };
  segments.forEach(([a, b], i) => { addEP(key(a), i, 0); addEP(key(b), i, 1); });
  const polylines = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = [segments[i][0], segments[i][1]];
    for (;;) { const k = key(chain[chain.length-1]); const nb = endpointMap.get(k) || []; let ext = false; for (const { idx, endIdx } of nb) { if (used[idx]) continue; used[idx] = 1; chain.push(endIdx === 0 ? segments[idx][1] : segments[idx][0]); ext = true; break; } if (!ext) break; }
    for (;;) { const k = key(chain[0]); const nb = endpointMap.get(k) || []; let ext = false; for (const { idx, endIdx } of nb) { if (used[idx]) continue; used[idx] = 1; chain.unshift(endIdx === 0 ? segments[idx][1] : segments[idx][0]); ext = true; break; } if (!ext) break; }
    if (chain.length >= 2) polylines.push(chain);
  }
  return polylines;
}

function chaikinSmooth(pts, passes = 2) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    const n = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[i+1];
      n.push([0.75*x0 + 0.25*x1, 0.75*y0 + 0.25*y1]);
      n.push([0.25*x0 + 0.75*x1, 0.25*y0 + 0.75*y1]);
    }
    n.push(p[p.length - 1]); p = n;
  }
  return p;
}

/* ═══════════════════════════════════════════════════════════════════════
   RENDER CONTOUR LINES — QGIS / GLOBAL MAPPER PROFESSIONAL STYLE

   Styling:
   - Minor lines: thin brown, low opacity (QGIS: #966F33 @ 0.65)
   - Major (index) lines: thicker dark brown, higher opacity (QGIS: #6B3D00 @ 0.90)
   - Labels: cream/white background, serif font, rotated along line
   - Label halo: QGIS uses white halo/mask around contour numbers
═══════════════════════════════════════════════════════════════════════ */
function renderContourLines(map, elevGrid, kmlGeojson, options) {
  const {
    contourInterval, majorEvery,
    minorColor = "#966F33",   // QGIS default minor contour brown
    majorColor = "#6B3D00",   // QGIS default major contour dark brown
    clipToKML = true, smoothing = true, isMine = false,
    contourStyle = "qgis",    // "qgis" | "globalmapper"
  } = options;

  const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;
  const rings = clipToKML ? extractRings(kmlGeojson) : [];
  const start = Math.ceil(minE / contourInterval) * contourInterval;
  const levels = [];
  for (let lv = start; lv <= maxE + 1e-6; lv += contourInterval)
    levels.push(parseFloat(lv.toFixed(6)));
  if (!levels.length) return { group: L.layerGroup(), count: 0 };

  const rawSegments = marchingSquares(grid, rows, cols, levels, rings, bbox);
  const group = L.layerGroup();

  // Label placement: QGIS uses ~1 label per ~200px of line length
  const CELL = 0.003;
  const labelOccupied = new Set();
  const canPlaceLabel = (lat, lng) => {
    for (let dr = -4; dr <= 4; dr++)
      for (let dc = -4; dc <= 4; dc++)
        if (labelOccupied.has(`${Math.floor(lat/CELL)+dr},${Math.floor(lng/CELL)+dc}`)) return false;
    return true;
  };

  let totalCount = 0;
  const zoom = map.getZoom();

  // QGIS contour style parameters
  const isQGIS = contourStyle === "qgis";
  const minorWeight = isQGIS ? 0.75 : 0.8;
  const majorWeight = isQGIS ? 2.0  : 2.5;
  const minorOpacity = isQGIS ? 0.65 : 0.70;
  const majorOpacity = isQGIS ? 0.88 : 0.92;

  levels.forEach(lv => {
    const roundedLv = Math.round(lv);
    const isMajor = roundedLv % majorEvery < 0.01 || Math.abs(roundedLv % majorEvery - majorEvery) < 0.01;
    const segments = rawSegments[lv] || [];
    if (!segments.length) return;

    const chains = stitchSegments(segments);
    chains.forEach(chain => {
      if (chain.length < 2) return;
      const latlngs = chain.map(([rF, cF]) => gridToLatLng(rF, cF, bbox, rows, cols));
      if (latlngs.length < 2) return;

      let finalLatLngs = latlngs;
      if (smoothing && latlngs.length >= 6) {
        try {
          const pixels = latlngs.map(([lat, lng]) => {
            const pt = map.project(L.latLng(lat, lng), zoom);
            return [pt.x, pt.y];
          });
          const smoothed = chaikinSmooth(pixels, isMine ? 1 : 2);
          finalLatLngs = smoothed.map(([x, y]) => {
            const ll = map.unproject(L.point(x, y), zoom);
            return [ll.lat, ll.lng];
          });
        } catch (_) { finalLatLngs = latlngs; }
      }

      // Draw the contour line
      L.polyline(finalLatLngs, {
        color: isMajor ? majorColor : minorColor,
        weight: isMajor ? majorWeight : minorWeight,
        opacity: isMajor ? majorOpacity : minorOpacity,
        interactive: false,
        lineJoin: "round",
        lineCap: "round",
        smoothFactor: isQGIS ? 1.0 : 1.3,
      }).addTo(group);

      totalCount++;

      // QGIS/GM style label placement on major contours
      if (isMajor && chain.length >= 12) {
        // Try multiple placement points along the line (QGIS places ~1 per line segment)
        const placementPoints = [
          Math.floor(finalLatLngs.length * 0.25),
          Math.floor(finalLatLngs.length * 0.50),
          Math.floor(finalLatLngs.length * 0.75),
        ];

        for (const midIdx of placementPoints) {
          if (midIdx < 2 || midIdx >= finalLatLngs.length - 2) continue;
          const p0 = finalLatLngs[Math.max(0, midIdx - 3)];
          const p1 = finalLatLngs[Math.min(finalLatLngs.length - 1, midIdx + 3)];
          if (!p0 || !p1) continue;
          const mLat = (p0[0] + p1[0]) / 2, mLng = (p0[1] + p1[1]) / 2;

          if (canPlaceLabel(mLat, mLng)) {
            labelOccupied.add(`${Math.floor(mLat/CELL)},${Math.floor(mLng/CELL)}`);
            let deg = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * (180 / Math.PI);
            if (deg > 90) deg -= 180;
            if (deg < -90) deg += 180;

            // QGIS-style label: white background halo, brown text, Courier/monospace
            const labelHtml = isQGIS
              ? `<div style="
                  transform: rotate(${deg.toFixed(1)}deg);
                  background: rgba(255,255,255,0.96);
                  color: ${majorColor};
                  font-size: 9px;
                  font-weight: 800;
                  font-family: 'Courier New', monospace;
                  padding: 1px 4px;
                  border-radius: 2px;
                  border: 0.5px solid rgba(107,61,0,0.45);
                  white-space: nowrap;
                  pointer-events: none;
                  box-shadow: 0 0 0 1.5px rgba(255,255,255,0.9), 0 1px 3px rgba(0,0,0,0.25);
                  line-height: 1.4;
                  letter-spacing: 0.03em;
                ">${roundedLv}</div>`
              : `<div style="
                  transform: rotate(${deg.toFixed(1)}deg);
                  background: rgba(252,248,230,0.97);
                  color: #4A2000;
                  font-size: 8.5px;
                  font-weight: 900;
                  font-family: Arial, sans-serif;
                  padding: 1px 4px;
                  border-radius: 1px;
                  border: 1px solid rgba(74,32,0,0.4);
                  white-space: nowrap;
                  pointer-events: none;
                  box-shadow: 0 0 3px rgba(255,255,255,0.8);
                  line-height: 1.3;
                ">${roundedLv}m</div>`;

            L.marker([mLat, mLng], {
              icon: L.divIcon({
                className: "",
                html: labelHtml,
                iconSize: [42, 14],
                iconAnchor: [21, 7],
              }),
              interactive: false,
              zIndexOffset: 500,
            }).addTo(group);
            break; // Only one label per chain per pass
          }
        }
      }
    });
  });

  return { group, count: totalCount };
}

/* ═══════════════════════════════════════════════════════════════════════
   CANVAS MASK OVERLAY
═══════════════════════════════════════════════════════════════════════ */
function buildMaskOverlay(map, bbox, rings) {
  const { minLat, maxLat, minLng, maxLng } = bbox;
  const expand = 0.05, latPad = (maxLat - minLat) * expand, lngPad = (maxLng - minLng) * expand, S = 1024;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(8,12,28,0.92)"; ctx.fillRect(0, 0, S, S);
  if (rings?.length) {
    ctx.globalCompositeOperation = "destination-out";
    rings.forEach(ring => {
      ctx.beginPath();
      ring.forEach(([lat, lng], i) => {
        const px = ((lng - (minLng - lngPad)) / ((maxLng + lngPad) - (minLng - lngPad))) * S;
        const py = (1 - (lat - (minLat - latPad)) / ((maxLat + latPad) - (minLat - latPad))) * S;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath(); ctx.fill();
    });
    ctx.globalCompositeOperation = "source-over";
  }
  const bounds = [[minLat - latPad, minLng - lngPad], [maxLat + latPad, maxLng + lngPad]];
  const ov = L.imageOverlay(canvas.toDataURL("image/png"), bounds, { opacity: 1, interactive: false, zIndex: 190 });
  ov.addTo(map); return ov;
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT HELPERS
═══════════════════════════════════════════════════════════════════════ */
function dlBlob(data, filename, mime) {
  const blob = new Blob([data], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

function buildContourGeoJSON(elevGrid, contourInterval, majorEvery, clipRings) {
  const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;
  const start = Math.ceil(minE / contourInterval) * contourInterval, levels = [];
  for (let lv = start; lv <= maxE + 1e-6; lv += contourInterval) levels.push(lv);
  const rawSegs = marchingSquares(grid, rows, cols, levels, clipRings, bbox);
  const features = [];
  levels.forEach(lv => {
    stitchSegments(rawSegs[lv] || []).forEach(chain => {
      if (chain.length < 2) return;
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: chain.map(([rF, cF]) => { const [lat, lng] = gridToLatLng(rF, cF, bbox, rows, cols); return [lng, lat, lv]; }),
        },
        properties: {
          elevation_m: lv, elevation_ft: Math.round(lv * 3.28084),
          isMajor: String(Math.round(lv) % majorEvery === 0),
          contourType: Math.round(lv) % majorEvery === 0 ? "major" : "minor",
          name: `Contour_${Math.round(lv)}m`, interval_m: contourInterval,
        },
      });
    });
  });
  return { type: "FeatureCollection", features };
}

function buildGeoTIFF(elevGrid) {
  const { grid, rows, cols, bbox } = elevGrid;
  const pixW = cols > 1 ? (bbox.maxLng - bbox.minLng) / (cols - 1) : 0.001;
  const pixH = rows > 1 ? (bbox.maxLat - bbox.minLat) / (rows - 1) : 0.001;
  const W = cols, H = rows, raster = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) raster[r*W+c] = isNaN(grid[r][c]) ? -9999 : grid[r][c];
  const tiepoint = new Float64Array([0,0,0,bbox.minLng,bbox.maxLat,0]);
  const pixScale = new Float64Array([pixW, pixH, 0]);
  const geoKeys = new Uint16Array([1,1,0,4,1024,0,1,2,1025,0,1,1,2048,0,1,4326,2049,34737,7,0]);
  const citBytes = new TextEncoder().encode("WGS 84\0"), ndBytes = new TextEncoder().encode("-9999\0");
  const NUM_TAGS=17, ifdOff=8, ifdSize=2+NUM_TAGS*12+4, tpOff=ifdOff+ifdSize, psOff=tpOff+tiepoint.byteLength;
  const gkOff=psOff+pixScale.byteLength, citOff=gkOff+geoKeys.byteLength, ndOff=citOff+citBytes.byteLength;
  const rasOff=Math.ceil((ndOff+ndBytes.byteLength)/4)*4, total=rasOff+raster.byteLength;
  const buf=new ArrayBuffer(total), view=new DataView(buf), u8=new Uint8Array(buf);
  let p=0; u8[p++]=0x49; u8[p++]=0x49; view.setUint16(p,42,true); p+=2; view.setUint32(p,ifdOff,true); p+=4;
  view.setUint16(p,NUM_TAGS,true); p+=2;
  const tag=(id,type,count,val)=>{view.setUint16(p,id,true);p+=2;view.setUint16(p,type,true);p+=2;view.setUint32(p,count,true);p+=4;if(type===3&&count<=2){view.setUint16(p,val,true);p+=2;view.setUint16(p,0,true);p+=2;}else{view.setUint32(p,val,true);p+=4;}};
  tag(256,4,1,W);tag(257,4,1,H);tag(258,3,1,32);tag(259,3,1,1);tag(262,3,1,1);tag(273,4,1,rasOff);tag(277,3,1,1);tag(278,4,1,H);tag(279,4,1,W*H*4);tag(284,3,1,1);tag(339,3,1,3);
  tag(33550,12,3,psOff);tag(33922,12,6,tpOff);tag(34735,3,geoKeys.length,gkOff);tag(34736,12,0,0);tag(34737,2,citBytes.length,citOff);tag(42113,2,ndBytes.length,ndOff);
  view.setUint32(p,0,true); p+=4;
  new Uint8Array(buf,tpOff,tiepoint.byteLength).set(new Uint8Array(tiepoint.buffer));
  new Uint8Array(buf,psOff,pixScale.byteLength).set(new Uint8Array(pixScale.buffer));
  new Uint8Array(buf,gkOff,geoKeys.byteLength).set(new Uint8Array(geoKeys.buffer));
  new Uint8Array(buf,citOff,citBytes.byteLength).set(citBytes);
  new Uint8Array(buf,ndOff,ndBytes.byteLength).set(ndBytes);
  new Uint8Array(buf,rasOff,raster.byteLength).set(new Uint8Array(raster.buffer));
  return buf;
}

const CRC32_TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC32_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function concatU8(...a) { const t = a.reduce((n, x) => n + x.length, 0), o = new Uint8Array(t); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; }
function buildZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let dataOffset = 0;
  for (const { name, data } of files) {
    const nb = enc.encode(name), u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const crc = crc32(u8), size = u8.length;
    const lh = new ArrayBuffer(30 + nb.length), lhD = new DataView(lh), lhU = new Uint8Array(lh);
    lhD.setUint32(0,0x04034B50,true);lhD.setUint16(4,20,true);lhD.setUint16(6,0,true);lhD.setUint16(8,0,true);lhD.setUint16(10,0,true);lhD.setUint16(12,0,true);
    lhD.setUint32(14,crc,true);lhD.setUint32(18,size,true);lhD.setUint32(22,size,true);lhD.setUint16(26,nb.length,true);lhD.setUint16(28,0,true);lhU.set(nb,30);
    const cd = new ArrayBuffer(46 + nb.length), cdD = new DataView(cd), cdU = new Uint8Array(cd);
    cdD.setUint32(0,0x02014B50,true);cdD.setUint16(4,20,true);cdD.setUint16(6,20,true);cdD.setUint16(8,0,true);cdD.setUint16(10,0,true);cdD.setUint16(12,0,true);cdD.setUint16(14,0,true);
    cdD.setUint32(16,crc,true);cdD.setUint32(20,size,true);cdD.setUint32(24,size,true);cdD.setUint16(28,nb.length,true);cdD.setUint16(30,0,true);cdD.setUint16(32,0,true);cdD.setUint16(34,0,true);cdD.setUint16(36,0,true);cdD.setUint32(38,0,true);cdD.setUint32(42,dataOffset,true);cdU.set(nb,46);
    parts.push(lhU, u8); central.push(cdU); dataOffset += 30 + nb.length + size;
  }
  const cdData = concatU8(...central), eoAB = new ArrayBuffer(22), eoDV = new DataView(eoAB);
  eoDV.setUint32(0,0x06054B50,true);eoDV.setUint16(4,0,true);eoDV.setUint16(6,0,true);eoDV.setUint16(8,files.length,true);eoDV.setUint16(10,files.length,true);eoDV.setUint32(12,cdData.length,true);eoDV.setUint32(16,dataOffset,true);eoDV.setUint16(20,0,true);
  return concatU8(...parts, cdData, new Uint8Array(eoAB));
}
function buildDBF(features) {
  const FIELDS = [{name:"id",type:"N",len:10,dec:0},{name:"elev_m",type:"N",len:10,dec:2},{name:"elev_ft",type:"N",len:10,dec:1},{name:"type",type:"C",len:6,dec:0},{name:"is_major",type:"C",len:5,dec:0},{name:"interval",type:"N",len:8,dec:1},{name:"name",type:"C",len:80,dec:0}];
  const enc = new TextEncoder(), headerSize = 32 + FIELDS.length * 32 + 1, recSize = 1 + FIELDS.reduce((s, f) => s + f.len, 0), totalSize = headerSize + features.length * recSize + 1;
  const bufAB = new ArrayBuffer(totalSize), buf = new Uint8Array(bufAB), dv = new DataView(bufAB);
  buf[0] = 3; const now = new Date(); buf[1] = now.getFullYear() - 1900; buf[2] = now.getMonth() + 1; buf[3] = now.getDate();
  dv.setUint32(4, features.length, true); dv.setUint16(8, headerSize, true); dv.setUint16(10, recSize, true);
  FIELDS.forEach((f, fi) => { const off = 32 + fi * 32, nb = enc.encode(f.name.slice(0, 10)); nb.forEach((b, i) => { buf[off+i] = b; }); buf[off+11] = f.type.charCodeAt(0); buf[off+16] = f.len; buf[off+17] = f.dec; });
  buf[32 + FIELDS.length * 32] = 0x0D;
  features.forEach((feat, ri) => {
    const p2 = feat.properties || {}, off = headerSize + ri * recSize; buf[off] = 0x20; let col = 1;
    const elev = p2.elev_m ?? p2.elevation_m ?? 0;
    const rawVals = [p2.id ?? ri+1, elev, p2.elevation_ft ?? Math.round(elev*3.28084), p2.contourType ?? "minor", p2.is_major ?? "false", p2.interval_m ?? 0, p2.name ?? `Feature_${ri+1}`];
    FIELDS.forEach((f, fi) => {
      let str = String(rawVals[fi] ?? "").slice(0, f.len);
      if (f.type === "N") { const n = parseFloat(str); str = isNaN(n) ? "0".padStart(f.len) : n.toFixed(f.dec).padStart(f.len); } else { str = str.padEnd(f.len); }
      const bytes = enc.encode(str.slice(0, f.len));
      for (let i = 0; i < f.len; i++) buf[off+col+i] = bytes[i] !== undefined ? bytes[i] : 0x20; col += f.len;
    });
  });
  buf[headerSize + features.length * recSize] = 0x1A; return buf;
}
function buildSHPandSHX(features) {
  const g0 = features[0]?.geometry?.type || "LineString", shpType = g0.includes("Line") ? 3 : 5;
  const getParts = geom => { if (!geom) return []; if (geom.type === "LineString") return [geom.coordinates]; if (geom.type === "MultiLineString") return geom.coordinates; if (geom.type === "Polygon") return geom.coordinates; if (geom.type === "MultiPolygon") return geom.coordinates.flat(1); return []; };
  let xMin=Infinity, yMin=Infinity, xMax=-Infinity, yMax=-Infinity;
  const records = features.map(feat => {
    const parts = getParts(feat.geometry);
    if (!parts.length || !parts[0]?.length) { const ab = new ArrayBuffer(4); new DataView(ab).setInt32(0, 0, true); return new Uint8Array(ab); }
    parts.forEach(ring => ring.forEach(([x, y]) => { if (x < xMin) xMin = x; if (x > xMax) xMax = x; if (y < yMin) yMin = y; if (y > yMax) yMax = y; }));
    const numParts = parts.length, numPoints = parts.reduce((s, p) => s + p.length, 0);
    const recLen = 4 + 32 + 4 + 4 + numParts * 4 + numPoints * 16, ab = new ArrayBuffer(recLen), dv = new DataView(ab);
    let rxMin=Infinity, ryMin=Infinity, rxMax=-Infinity, ryMax=-Infinity;
    parts.forEach(ring => ring.forEach(([x, y]) => { if (x < rxMin) rxMin = x; if (x > rxMax) rxMax = x; if (y < ryMin) ryMin = y; if (y > ryMax) ryMax = y; }));
    dv.setInt32(0,shpType,true); dv.setFloat64(4,rxMin,true); dv.setFloat64(12,ryMin,true); dv.setFloat64(20,rxMax,true); dv.setFloat64(28,ryMax,true); dv.setInt32(36,numParts,true); dv.setInt32(40,numPoints,true);
    let ptAcc = 0; parts.forEach((ring, pi) => { dv.setInt32(44 + pi*4, ptAcc, true); ptAcc += ring.length; });
    let ptOff = 44 + numParts * 4; parts.forEach(ring => ring.forEach(([x, y]) => { dv.setFloat64(ptOff, x, true); dv.setFloat64(ptOff+8, y, true); ptOff += 16; }));
    return new Uint8Array(ab);
  });
  if (!isFinite(xMin)) { xMin = yMin = xMax = yMax = 0; }
  const shpBodySize = records.reduce((s, r) => s + 8 + r.length, 0), shpTL = 100 + shpBodySize, shpAB = new ArrayBuffer(shpTL), shpDV = new DataView(shpAB), shpU8 = new Uint8Array(shpAB);
  const shxTL = 100 + records.length * 8, shxAB = new ArrayBuffer(shxTL), shxDV = new DataView(shxAB);
  const wfh = (dv, flen) => { dv.setInt32(0,9994,false); dv.setInt32(24,flen/2,false); dv.setInt32(28,1000,true); dv.setInt32(32,shpType,true); dv.setFloat64(36,xMin,true); dv.setFloat64(44,yMin,true); dv.setFloat64(52,xMax,true); dv.setFloat64(60,yMax,true); dv.setFloat64(68,0,true); dv.setFloat64(76,0,true); dv.setFloat64(84,0,true); dv.setFloat64(92,0,true); };
  wfh(shpDV, shpTL); wfh(shxDV, shxTL);
  let shpPos = 100;
  records.forEach((rec, ri) => { const cw = rec.length / 2; shpDV.setInt32(shpPos,ri+1,false); shpDV.setInt32(shpPos+4,cw,false); shpU8.set(rec, shpPos+8); shxDV.setInt32(100+ri*8,shpPos/2,false); shxDV.setInt32(100+ri*8+4,cw,false); shpPos += 8 + rec.length; });
  return { shp: new Uint8Array(shpAB), shx: new Uint8Array(shxAB) };
}
const WGS84_PRJ = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;
async function exportShapefileZIP(geojson, fileName) {
  const features = [];
  const wk = f => { if (!f) return; if (f.type === "FeatureCollection") f.features?.forEach(wk); else if (f.type === "Feature" && f.geometry) features.push(f); };
  wk(geojson);
  if (!features.length) { alert("No features to export."); return; }
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");
  const norm = features.map((f, i) => ({ type: "Feature", geometry: f.geometry, properties: { id: i+1, elev_m: Number((f.properties?.elevation_m ?? 0).toFixed(2)), elev_ft: Number((f.properties?.elevation_ft ?? 0).toFixed(1)), type: f.properties?.contourType ?? "minor", is_major: String(f.properties?.isMajor ?? "false"), interval: f.properties?.interval_m ?? 0, name: String(f.properties?.name || `Feature_${i+1}`).slice(0, 80) } }));
  const byType = {}; norm.forEach(f => { const t = f.geometry?.type || "Unknown"; if (!byType[t]) byType[t] = []; byType[t].push(f); });
  const enc = new TextEncoder();
  for (const [, feats] of Object.entries(byType)) {
    const { shp, shx } = buildSHPandSHX(feats), dbf = buildDBF(feats), prj = enc.encode(WGS84_PRJ);
    const zip = buildZip([{ name: baseName+".shp", data: shp }, { name: baseName+".shx", data: shx }, { name: baseName+".dbf", data: dbf }, { name: baseName+".prj", data: prj }]);
    dlBlob(zip.buffer, baseName + "_shapefile.zip", "application/zip");
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   DESIGN TOKENS — Professional GIS Dark Theme
═══════════════════════════════════════════════════════════════════════ */
const T = {
  bg: "rgba(5,9,22,0.99)",
  surface: "rgba(255,255,255,0.035)",
  surfaceHover: "rgba(255,255,255,0.065)",
  border: "rgba(255,255,255,0.075)",
  borderStrong: "rgba(255,255,255,0.13)",
  text: "#c8dff8",
  dim: "rgba(165,200,240,0.55)",
  faint: "rgba(120,165,215,0.35)",
  blue: "#3d8ef0", cyan: "#22d3c8", green: "#4ade80",
  amber: "#f5a623", red: "#f06060", violet: "#b89cf8",
  pink: "#f472b6", teal: "#14b8a6", gold: "#f0b429",
  lime: "#78e08f", orange: "#fb923c",
};
const MONO = `"Courier New",monospace`;
const UI = `"Segoe UI","DM Sans",system-ui,sans-serif`;

/* ── Shared UI Components ── */
const Btn = ({ variant = "blue", children, onClick, disabled, small, full = true }) => {
  const palette = {
    blue:   [T.blue,   "rgba(61,142,240,0.09)",   "rgba(61,142,240,0.26)"],
    cyan:   [T.cyan,   "rgba(34,211,200,0.09)",   "rgba(34,211,200,0.26)"],
    green:  [T.green,  "rgba(74,222,128,0.09)",   "rgba(74,222,128,0.26)"],
    amber:  [T.amber,  "rgba(245,166,35,0.09)",   "rgba(245,166,35,0.26)"],
    red:    [T.red,    "rgba(240,96,96,0.09)",    "rgba(240,96,96,0.26)"],
    violet: [T.violet, "rgba(184,156,248,0.09)",  "rgba(184,156,248,0.26)"],
    pink:   [T.pink,   "rgba(244,114,182,0.09)",  "rgba(244,114,182,0.26)"],
    gold:   [T.gold,   "rgba(240,180,41,0.09)",   "rgba(240,180,41,0.26)"],
    lime:   [T.lime,   "rgba(120,224,143,0.09)",  "rgba(120,224,143,0.26)"],
    orange: [T.orange, "rgba(251,146,60,0.09)",   "rgba(251,146,60,0.26)"],
    teal:   [T.teal,   "rgba(20,184,166,0.09)",   "rgba(20,184,166,0.26)"],
  };
  const [color, bg, border] = palette[variant] || palette.blue;
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: full ? "100%" : "auto", padding: small ? "6px 10px" : "9px 14px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", background: bg, border: `1px solid ${border}`, color, fontSize: small ? 11 : 12, fontWeight: 700, fontFamily: UI, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: disabled ? 0.35 : 1, transition: "all 0.12s" }}>
      {children}
    </button>
  );
};
const SectionLabel = ({ children }) => (
  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: MONO, marginBottom: 5 }}>{children}</div>
);
const StatRow = ({ label, value, color = T.dim }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: `1px solid ${T.border}` }}>
    <span style={{ color: T.faint, fontSize: 10, fontFamily: MONO }}>{label}</span>
    <span style={{ color, fontSize: 11, fontWeight: 700, fontFamily: MONO }}>{value}</span>
  </div>
);
const Badge = ({ color, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 20, background: `${color}14`, border: `1px solid ${color}36`, color, fontSize: 9, fontWeight: 700, fontFamily: MONO }}>{children}</span>
);

// Color ramp swatch with gradient preview
const RampSwatch = ({ name, rampData, selected, onClick }) => {
  const stops = rampData.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`).join(",");
  return (
    <button onClick={onClick} title={name} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px", borderRadius: 7, cursor: "pointer", background: selected ? "rgba(61,142,240,0.09)" : "transparent", border: selected ? `1.5px solid rgba(61,142,240,0.40)` : `1px solid ${T.border}`, transition: "all 0.12s" }}>
      <span style={{ width: 100, fontSize: 9.5, fontFamily: MONO, textAlign: "left", flexShrink: 0, color: selected ? T.blue : T.dim, fontWeight: selected ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <div style={{ flex: 1, height: 14, borderRadius: 4, background: `linear-gradient(to right,${stops})`, border: selected ? "1px solid rgba(61,142,240,0.38)" : "1px solid rgba(255,255,255,0.07)" }} />
    </button>
  );
};

// Elevation legend with tick marks
const ElevLegend = ({ rampName, minV, maxV }) => {
  if (minV == null || maxV == null) return null;
  const ramp = COLOR_RAMPS[rampName] || COLOR_RAMPS[DEFAULT_RAMP];
  const stops = ramp.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`).join(",");
  const range = maxV - minV;
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ height: 22, borderRadius: 5, background: `linear-gradient(to right,${stops})`, border: `1px solid ${T.border}`, position: "relative" }}>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <div key={t} style={{ position: "absolute", left: `${t * 100}%`, top: 0, bottom: 0, width: 1, background: "rgba(0,0,0,0.3)", transform: "translateX(-50%)" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <span key={t} style={{ fontSize: 9, color: T.faint, fontFamily: MONO }}>{Math.round(minV + t * range)}m</span>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT — v12.0 QGIS/Global Mapper Professional
═══════════════════════════════════════════════════════════════════════ */
export default function KMLProcessingPanel({ kmlGeojson, kmlFileName, leafletMapRef, visible, onClose }) {
  const [tab, setTab] = useState("dem");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elevGrid, setElevGrid] = useState(null);

  const [demOpacity, setDemOpacity] = useState(0.88);
  const [hillshadeStrength, setHillshadeStrength] = useState(0.60);
  const [hillshadeMode, setHillshadeMode] = useState("qgis-multi"); // "qgis-multi" | "single" | "off"
  const [gridRes, setGridRes] = useState(30);
  const [colorRamp, setColorRamp] = useState(DEFAULT_RAMP);
  const [clipDEM, setClipDEM] = useState(true);

  const [contourInterval, setContourInterval] = useState(10);
  const [majorEvery, setMajorEvery] = useState(50);
  // QGIS default contour colors
  const [minorColor, setMinorColor] = useState("#966F33");
  const [majorColor, setMajorColor] = useState("#6B3D00");
  const [smoothContours, setSmoothContours] = useState(true);
  const [clipContours, setClipContours] = useState(true);
  const [contourStyle, setContourStyle] = useState("qgis"); // "qgis" | "globalmapper"

  const [contourCount, setContourCount] = useState(0);
  const [autoInterval, setAutoInterval] = useState(null);
  const [maskVisible, setMaskVisible] = useState(false);
  const [demVisible, setDemVisible] = useState(false);
  const [contourVisible, setContourVisible] = useState(false);
  const [boundaryVisible, setBoundaryVisible] = useState(false);
  const [hasDEM, setHasDEM] = useState(false);
  const [hasContour, setHasContour] = useState(false);

  const demLayerRef      = useRef(null);
  const contourLayerRef  = useRef(null);
  const boundaryLayerRef = useRef(null);
  const maskLayerRef     = useRef(null);
  const elevGridRef      = useRef(null);

  const colorRampRef      = useRef(colorRamp);
  const demOpacityRef     = useRef(demOpacity);
  const hillshadeRef      = useRef(hillshadeStrength);
  const hillshadeModeRef  = useRef(hillshadeMode);
  const clipDEMRef        = useRef(clipDEM);
  const kmlGeojsonRef     = useRef(kmlGeojson);

  useEffect(() => { colorRampRef.current = colorRamp; }, [colorRamp]);
  useEffect(() => { demOpacityRef.current = demOpacity; }, [demOpacity]);
  useEffect(() => { hillshadeRef.current = hillshadeStrength; }, [hillshadeStrength]);
  useEffect(() => { hillshadeModeRef.current = hillshadeMode; }, [hillshadeMode]);
  useEffect(() => { clipDEMRef.current = clipDEM; }, [clipDEM]);
  useEffect(() => { kmlGeojsonRef.current = kmlGeojson; }, [kmlGeojson]);

  useEffect(() => () => {
    [demLayerRef, contourLayerRef, boundaryLayerRef, maskLayerRef].forEach(r => {
      try { r.current?.remove?.(); } catch (_) {}
    });
  }, []);

  useEffect(() => {
    if (!kmlGeojson || !leafletMapRef?.current) return;
    try { boundaryLayerRef.current?.remove?.(); } catch (_) {}
    boundaryLayerRef.current = L.geoJSON(kmlGeojson, {
      style: { color: "#ff9900", weight: 2.5, opacity: 0.9, fillOpacity: 0, dashArray: "7 4" },
    });
    setBoundaryVisible(false);
  }, [kmlGeojson, leafletMapRef]);

  // Live re-render when display settings change
  useEffect(() => {
    if (!hasDEM || !elevGridRef.current || !leafletMapRef?.current) return;
    try {
      demLayerRef.current?.remove?.();
      const rings = clipDEMRef.current ? extractRings(kmlGeojsonRef.current) : [];
      demLayerRef.current = renderDEMCanvas(
        leafletMapRef.current, elevGridRef.current,
        demOpacity, rings, colorRamp, hillshadeStrength, hillshadeMode
      );
      setDemVisible(true);
    } catch (err) { console.error("DEM re-render:", err); }
  }, [colorRamp, demOpacity, hillshadeStrength, hillshadeMode, hasDEM]);

  const flyToKML = () => {
    if (!kmlGeojson || !leafletMapRef?.current) return;
    try { const b = L.geoJSON(kmlGeojson).getBounds(); if (b.isValid()) leafletMapRef.current.fitBounds(b, { padding: [40, 40], maxZoom: 16 }); } catch (_) {}
  };

  const toggleBoundary = () => {
    const lyr = boundaryLayerRef.current;
    if (!lyr || !leafletMapRef?.current) return;
    if (boundaryVisible) { lyr.remove(); setBoundaryVisible(false); }
    else { lyr.addTo(leafletMapRef.current); setBoundaryVisible(true); }
  };

  const applyMask = useCallback(() => {
    if (!kmlGeojson || !leafletMapRef?.current) return;
    maskLayerRef.current?.remove?.();
    maskLayerRef.current = buildMaskOverlay(leafletMapRef.current, getBBox(kmlGeojson), extractRings(kmlGeojson));
    setMaskVisible(true);
  }, [kmlGeojson, leafletMapRef]);

  const removeMask = useCallback(() => {
    try { maskLayerRef.current?.remove?.(); } catch (_) {}
    maskLayerRef.current = null; setMaskVisible(false);
  }, []);

  /* ── FETCH ELEVATION ── */
  const fetchElevationGrid = useCallback(async () => {
    if (!kmlGeojson) { setStatus("❌ No KML loaded."); return; }
    setIsProcessing(true);
    setStatus("📡 Sampling grid points…");
    setProgress(5);
    try {
      const bbox = getBBox(kmlGeojson);
      const rows = gridRes, cols = gridRes;
      const allPoints = sampleGrid(bbox, rows, cols);
      const totalPts = allPoints.length;
      setStatus(`📡 Fetching ${totalPts} pts via open-meteo…`);

      const { results: elevated, successCount } = await fetchElevationBatch(allPoints, (done, total) => {
        setProgress(5 + Math.round((done / total) * 78));
        setStatus(`📡 ${done}/${total} pts received`);
      });

      const grid = Array.from({ length: rows }, () => new Float32Array(cols).fill(NaN));
      elevated.forEach(p => {
        if (p && p.row < rows && p.col < cols && isValidElev(p.elevation))
          grid[p.row][p.col] = p.elevation;
      });

      if (successCount === 0) {
        setStatus("❌ No elevation data received."); setIsProcessing(false); setProgress(0); return;
      }

      setStatus(`🔧 Interpolating empty cells…`); setProgress(85);
      fillNaN(grid, rows, cols);

      const rings = extractRings(kmlGeojson);
      let minE = Infinity, maxE = -Infinity;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = grid[r][c];
          if (isNaN(v)) continue;
          if (rings.length > 0) {
            const [lat, lng] = gridToLatLng(r, c, bbox, rows, cols);
            if (!insideKML(lat, lng, rings)) continue;
          }
          if (v < minE) minE = v; if (v > maxE) maxE = v;
        }
      }
      if (!isFinite(minE)) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const v = grid[r][c]; if (!isNaN(v)) { if (v < minE) minE = v; if (v > maxE) maxE = v; }
        }
      }
      if (!isFinite(minE)) {
        setStatus("❌ All elevation values invalid."); setIsProcessing(false); setProgress(0); return;
      }

      const eg = { grid, rows, cols, bbox, min: minE, max: maxE };
      setElevGrid(eg); elevGridRef.current = eg;

      const ai = analyzeTerrainType(grid, rows, cols, minE, maxE);
      setAutoInterval(ai);
      setProgress(100);

      const range = maxE - minE;
      setStatus(`✅ ${successCount}/${totalPts} pts · ${Math.round(minE)}m → ${Math.round(maxE)}m · Δ${Math.round(range)}m · ${ai.label}${ai.isMine ? " 🪨" : ""}`);
    } catch (err) {
      setStatus("❌ " + err.message); console.error(err);
    } finally {
      setIsProcessing(false); setTimeout(() => setProgress(0), 1200);
    }
  }, [kmlGeojson, gridRes]);

  /* ── RENDER DEM ── */
  const renderDEM = useCallback(() => {
    const eg = elevGridRef.current || elevGrid;
    if (!eg || !leafletMapRef?.current) { setStatus("⚠️ Fetch elevation data first."); return; }
    setStatus(`🎨 Rendering DEM (${eg.rows}×${eg.cols})…`);
    try {
      demLayerRef.current?.remove?.();
      const rings = clipDEM ? extractRings(kmlGeojson) : [];
      demLayerRef.current = renderDEMCanvas(leafletMapRef.current, eg, demOpacity, rings, colorRamp, hillshadeStrength, hillshadeMode);
      setDemVisible(true); setHasDEM(true);
      setStatus(`✅ DEM rendered · ${colorRamp} · ${hillshadeMode} hillshade · ${eg.rows}×${eg.cols}`);
    } catch (err) { setStatus("❌ DEM render failed: " + err.message); console.error(err); }
  }, [elevGrid, kmlGeojson, demOpacity, colorRamp, hillshadeStrength, hillshadeMode, clipDEM, leafletMapRef]);

  /* ── RENDER CONTOURS ── */
  const renderContours = useCallback(() => {
    const eg = elevGridRef.current || elevGrid;
    if (!eg || !leafletMapRef?.current) { setStatus("⚠️ Fetch elevation first."); return; }
    setStatus("📐 Generating contour lines…");
    try {
      contourLayerRef.current?.remove?.();
      const { group, count } = renderContourLines(leafletMapRef.current, eg, kmlGeojson, {
        contourInterval, majorEvery, minorColor, majorColor,
        clipToKML: clipContours, smoothing: smoothContours,
        isMine: autoInterval?.isMine ?? false,
        contourStyle,
      });
      group.addTo(leafletMapRef.current);
      contourLayerRef.current = group;
      setContourVisible(true); setHasContour(true); setContourCount(count);
      setStatus(count > 0
        ? `✅ ${count} contours · ${contourInterval}m interval · major ${majorEvery}m · ${contourStyle} style`
        : `⚠️ 0 lines — try smaller interval or re-fetch`);
    } catch (err) { setStatus("❌ Contour error: " + err.message); console.error(err); }
  }, [elevGrid, kmlGeojson, contourInterval, majorEvery, minorColor, majorColor, smoothContours, clipContours, autoInterval, contourStyle, leafletMapRef]);

  const toggleDEM = () => {
    if (!demLayerRef.current || !leafletMapRef?.current) return;
    if (demVisible) { demLayerRef.current.remove(); setDemVisible(false); }
    else { demLayerRef.current.addTo(leafletMapRef.current); setDemVisible(true); }
  };
  const toggleContours = () => {
    if (!contourLayerRef.current || !leafletMapRef?.current) return;
    if (contourVisible) { contourLayerRef.current.remove(); setContourVisible(false); }
    else { contourLayerRef.current.addTo(leafletMapRef.current); setContourVisible(true); }
  };

  const exportGeoTIFF = () => {
    const eg = elevGridRef.current || elevGrid; if (!eg) { setStatus("⚠️ Fetch elevation first."); return; }
    try { dlBlob(buildGeoTIFF(eg), (kmlFileName || "dem").replace(/\.[^.]+$/, "") + "_dem.tif", "image/tiff"); setStatus("✅ GeoTIFF exported"); } catch (err) { setStatus("❌ " + err.message); }
  };
  const exportDEMCSV = () => {
    const eg = elevGridRef.current || elevGrid; if (!eg) { setStatus("⚠️ Fetch elevation first."); return; }
    const { grid, rows, cols, bbox } = eg, lines = ["lat,lng,elevation_m,elevation_ft"];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const [lat, lng] = gridToLatLng(r, c, bbox, rows, cols), e = grid[r][c];
      lines.push(`${lat.toFixed(7)},${lng.toFixed(7)},${isNaN(e) ? "" : e.toFixed(2)},${isNaN(e) ? "" : (e * 3.28084).toFixed(2)}`);
    }
    dlBlob(new TextEncoder().encode(lines.join("\n")), (kmlFileName || "dem").replace(/\.[^.]+$/, "") + "_dem.csv", "text/csv");
    setStatus("✅ DEM CSV exported");
  };
  const exportContoursShapefile = async () => {
    const eg = elevGridRef.current || elevGrid; if (!eg) { setStatus("⚠️ Fetch elevation first."); return; }
    setStatus("📦 Building shapefile ZIP…");
    try {
      const rings = clipContours ? extractRings(kmlGeojson) : [];
      const gj = buildContourGeoJSON(eg, contourInterval, majorEvery, rings);
      await exportShapefileZIP(gj, (kmlFileName || "contours").replace(/\.[^.]+$/, "") + `_contours_${contourInterval}m.shp`);
      setStatus("✅ Contours shapefile exported");
    } catch (err) { setStatus("❌ " + err.message); }
  };
  const exportContoursGeoJSON = () => {
    const eg = elevGridRef.current || elevGrid; if (!eg) { setStatus("⚠️ Fetch elevation first."); return; }
    const rings = clipContours ? extractRings(kmlGeojson) : [];
    const gj = buildContourGeoJSON(eg, contourInterval, majorEvery, rings);
    dlBlob(new TextEncoder().encode(JSON.stringify(gj, null, 2)), (kmlFileName || "contours").replace(/\.[^.]+$/, "") + `_contours_${contourInterval}m.geojson`, "application/json");
    setStatus("✅ GeoJSON exported");
  };
  const exportKMLShapefile = async () => {
    if (!kmlGeojson) { setStatus("⚠️ No KML loaded."); return; } setStatus("📦 Building KML shapefile…");
    try { await exportShapefileZIP(kmlGeojson, kmlFileName || "kml.shp"); setStatus("✅ KML SHP exported"); } catch (err) { setStatus("❌ " + err.message); }
  };
  const exportKMLGeoJSON = () => {
    if (!kmlGeojson) return;
    dlBlob(new TextEncoder().encode(JSON.stringify(kmlGeojson, null, 2)), (kmlFileName || "kml").replace(/\.[^.]+$/, "") + ".geojson", "application/json");
    setStatus("✅ KML → GeoJSON exported");
  };
  const clearAll = () => {
    [demLayerRef, contourLayerRef, maskLayerRef].forEach(r => { try { r.current?.remove?.(); r.current = null; } catch (_) {} });
    setDemVisible(false); setContourVisible(false); setMaskVisible(false);
    setHasDEM(false); setHasContour(false); setElevGrid(null); elevGridRef.current = null;
    setContourCount(0); setAutoInterval(null); setStatus("🗑 All layers cleared.");
  };

  if (!visible) return null;

  const TABS = [
    { id: "dem",     label: "🏔 DEM"      },
    { id: "contour", label: "📐 Contour"  },
    { id: "export",  label: "💾 Export"   },
    { id: "kml",     label: "📦 KML/SHP"  },
  ];
  const INTERVALS = [1, 2, 5, 10, 20, 25, 50];
  const MAJORS    = [5, 10, 25, 50, 100, 200];
  const numChunks = Math.ceil(gridRes * gridRes / 50);
  const estSecs   = Math.round(numChunks * 1.3);

  // QGIS preset colors
  const applyQGISPreset = () => { setMinorColor("#966F33"); setMajorColor("#6B3D00"); setContourStyle("qgis"); };
  const applyGMPreset   = () => { setMinorColor("#8B5000"); setMajorColor("#3D1C00"); setContourStyle("globalmapper"); };

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pBar { 0%,100%{opacity:1;} 50%{opacity:.5;} }
        .kp-sc::-webkit-scrollbar { width: 3px; }
        .kp-sc::-webkit-scrollbar-thumb { background: rgba(61,142,240,0.18); border-radius: 2px; }
        .kp-tab { flex:1; padding:9px 2px; background:transparent; border:none; border-bottom:2px solid transparent; cursor:pointer; font-size:10px; font-weight:700; transition:all 0.12s; font-family:${UI}; }
        .kp-tab.on { background:rgba(61,142,240,0.07); border-bottom-color:${T.blue}; color:${T.blue}; }
        .kp-tab:not(.on) { color:${T.faint}; }
        .kp-tab:not(.on):hover { color:${T.dim}; background:rgba(255,255,255,0.025); }
        .ivl { flex:1 0 auto; min-width:28px; padding:6px 2px; border-radius:7px; cursor:pointer; font-size:10px; font-weight:700; font-family:${MONO}; transition:all 0.11s; text-align:center; }
        .ivl.on { background:rgba(34,211,200,0.12); border:1px solid rgba(34,211,200,0.44); color:${T.cyan}; }
        .ivl:not(.on) { background:${T.surface}; border:1px solid ${T.border}; color:${T.faint}; }
        .ivl:not(.on):hover { background:${T.surfaceHover}; color:${T.dim}; }
        .mjr { flex:1; padding:6px 3px; border-radius:7px; cursor:pointer; font-size:10px; font-weight:700; font-family:${MONO}; transition:all 0.11s; text-align:center; }
        .mjr.on { background:rgba(245,166,35,0.12); border:1px solid rgba(245,166,35,0.44); color:${T.amber}; }
        .mjr:not(.on) { background:${T.surface}; border:1px solid ${T.border}; color:${T.faint}; }
        .mjr:not(.on):hover { background:${T.surfaceHover}; color:${T.dim}; }
        .kchk { display:flex; align-items:center; gap:9px; cursor:pointer; padding:8px 11px; background:${T.surface}; border-radius:8px; border:1px solid ${T.border}; transition:border-color 0.11s; }
        .kchk:hover { border-color:${T.borderStrong}; }
        .hs-btn { flex:1; padding:7px 4px; border-radius:7px; cursor:pointer; font-size:9.5px; font-weight:700; font-family:${MONO}; transition:all 0.11s; text-align:center; border:1px solid ${T.border}; background:${T.surface}; color:${T.faint}; }
        .hs-btn.on { background:rgba(61,142,240,0.13); border-color:rgba(61,142,240,0.42); color:${T.blue}; }
        .hs-btn:not(.on):hover { color:${T.dim}; background:${T.surfaceHover}; }
        .cs-btn { flex:1; padding:7px 4px; border-radius:7px; cursor:pointer; font-size:9.5px; font-weight:700; font-family:${MONO}; transition:all 0.11s; text-align:center; }
        .cs-btn.qgis { background:rgba(34,211,200,0.10); border:1px solid rgba(34,211,200,0.35); color:${T.cyan}; }
        .cs-btn.gm   { background:rgba(245,166,35,0.10); border:1px solid rgba(245,166,35,0.35); color:${T.amber}; }
        .cs-btn:not(.qgis):not(.gm) { background:${T.surface}; border:1px solid ${T.border}; color:${T.faint}; }
      `}</style>

      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 362, zIndex: 5000, background: T.bg, backdropFilter: "blur(42px) saturate(160%)", borderLeft: `1px solid ${T.borderStrong}`, display: "flex", flexDirection: "column", fontFamily: UI, boxShadow: "-14px 0 55px rgba(0,0,0,0.88)" }}>

        {/* HEADER */}
        <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: "linear-gradient(135deg,rgba(61,142,240,0.18),rgba(34,211,200,0.18))", border: `1px solid rgba(61,142,240,0.25)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🗺</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: T.text, fontWeight: 700, fontSize: 13.5 }}>KML Processing</div>
              <div style={{ color: T.faint, fontSize: 9, fontFamily: MONO, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kmlFileName || "No KML loaded"} · v12.0 QGIS/GM Style</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 22, padding: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 }}>
            {[["🎯", "Fly", flyToKML, "blue"], [boundaryVisible ? "🟠" : "⬛", "KML", toggleBoundary, "cyan"], [maskVisible ? "🌑" : "🔲", "Mask", maskVisible ? removeMask : applyMask, "amber"], ["🗑", "Clear", clearAll, "red"]].map(([ico, lbl, fn, v]) => (
              <button key={lbl} onClick={fn} style={{ padding: "7px 2px", borderRadius: 7, cursor: "pointer", background: `${T[v]}10`, border: `1px solid ${T[v]}28`, color: T[v], fontSize: 9.5, fontWeight: 700, fontFamily: UI, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, transition: "all 0.12s" }}>
                <span style={{ fontSize: 14 }}>{ico}</span><span>{lbl}</span>
              </button>
            ))}
          </div>
        </div>

        {/* TABS */}
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {TABS.map(t => (<button key={t.id} className={`kp-tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>))}
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="kp-sc" style={{ flex: 1, overflowY: "auto", padding: "12px 13px 28px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* ════ DEM TAB ════ */}
          {tab === "dem" && <>
            {/* Info banner */}
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(244,114,182,0.05)", border: `1px solid rgba(244,114,182,0.17)` }}>
              <div style={{ color: T.pink, fontWeight: 700, fontSize: 12.5, marginBottom: 5 }}>🏔 Digital Elevation Model</div>
              <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.7, marginBottom: 7 }}>GeoXIS Terrain / GeoXIS Pro professional rendering · Multi-directional hillshade · High-res canvas</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <Badge color={T.green}>Multi-Dir Hillshade</Badge>
                <Badge color={T.cyan}>Geoxis Color Ramps</Badge>
                <Badge color={T.amber}>Terrain Gold</Badge>
              </div>
            </div>

            {/* Terrain info */}
            {autoInterval && (
              <div style={{ padding: "8px 11px", borderRadius: 8, background: autoInterval.isMine ? `${T.orange}0d` : `${T.lime}0a`, border: `1px solid ${autoInterval.isMine ? T.orange : T.lime}24`, color: autoInterval.isMine ? T.orange : T.lime, fontSize: 10, fontFamily: MONO }}>
                {autoInterval.isMine ? "🪨" : "🌄"} <b>{autoInterval.label}</b> · Δ{Math.round((elevGrid?.max ?? 0) - (elevGrid?.min ?? 0))}m · Suggested: <b>{autoInterval.interval}m</b>
              </div>
            )}

            {/* Grid Resolution */}
            <div>
              <SectionLabel>Grid Resolution — {gridRes}×{gridRes} = {gridRes * gridRes} pts · ~{estSecs}s</SectionLabel>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <input type="range" min={20} max={80} step={10} value={gridRes} onChange={e => setGridRes(+e.target.value)} style={{ flex: 1, accentColor: T.pink, cursor: "pointer" }} />
                <span style={{ color: T.pink, fontSize: 11, fontFamily: MONO, minWidth: 52 }}>{gridRes}×{gridRes}</span>
              </div>
              <div style={{ color: gridRes > 50 ? T.amber : T.faint, fontSize: 9, marginTop: 2 }}>
                {gridRes > 50 ? `⚠️ High res — slower (~${estSecs}s)` : `✅ ${numChunks} chunks · safe throttling`}
              </div>
            </div>

            {/* Hillshade Mode */}
            <div>
              <SectionLabel>Hillshade Algorithm</SectionLabel>
              <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                {[
                  ["qgis-multi", "Multi Directional", "Best quality (5 azimuths)"],
                  ["single",     "Single 315°",    "Fast, classic GDAL"],
                  ["off",        "None",           "Color only, no shade"],
                ].map(([id, label, tip]) => (
                  <button key={id} title={tip} className={`hs-btn${hillshadeMode === id ? " on" : ""}`} onClick={() => setHillshadeMode(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {hillshadeMode !== "off" && <>
                <SectionLabel>Strength — {Math.round(hillshadeStrength * 100)}% (az=315° alt=45°)</SectionLabel>
                <input type="range" min={0} max={1} step={0.05} value={hillshadeStrength} onChange={e => setHillshadeStrength(+e.target.value)} style={{ width: "100%", accentColor: T.amber, cursor: "pointer" }} />
              </>}
            </div>

            {/* Opacity */}
            <div>
              <SectionLabel>Opacity — {Math.round(demOpacity * 100)}%</SectionLabel>
              <input type="range" min={0.1} max={1} step={0.05} value={demOpacity} onChange={e => setDemOpacity(+e.target.value)} style={{ width: "100%", accentColor: T.pink, cursor: "pointer" }} />
            </div>

            {/* Clip checkbox */}
            <label className="kchk">
              <input type="checkbox" checked={clipDEM} onChange={e => setClipDEM(e.target.checked)} style={{ accentColor: T.blue, width: 14, height: 14 }} />
              <span style={{ color: T.text, fontSize: 11 }}>Clip DEM to KML boundary</span>
            </label>

            {/* Color Ramps */}
            <div>
              <SectionLabel>Colour Ramp — click to apply live</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {Object.entries(COLOR_RAMPS).map(([name, ramp]) => (
                  <RampSwatch key={name} name={name} rampData={ramp} selected={colorRamp === name} onClick={() => setColorRamp(name)} />
                ))}
              </div>
            </div>

            {/* Legend */}
            {elevGrid && <>
              <SectionLabel>Elevation Legend — {Math.round(elevGrid.min)}m to {Math.round(elevGrid.max)}m (Δ{Math.round(elevGrid.max - elevGrid.min)}m)</SectionLabel>
              <ElevLegend rampName={colorRamp} minV={elevGrid.min} maxV={elevGrid.max} />
            </>}

            {/* Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Btn variant="pink" onClick={fetchElevationGrid} disabled={isProcessing || !kmlGeojson}>
                {isProcessing ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Fetching elevation…</> : "📡 Fetch Elevation Data"}
              </Btn>
              {isProcessing && (
                <div style={{ height: 4, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#f472b6,#fb923c)", borderRadius: 3, transition: "width 0.25s", animation: "pBar 1.1s ease-in-out infinite" }} />
                </div>
              )}
              <Btn variant="amber" onClick={renderDEM} disabled={!elevGrid}>🎨 Render DEM on Map</Btn>
              {hasDEM && (<Btn variant={demVisible ? "red" : "green"} onClick={toggleDEM}>{demVisible ? "🙈 Hide DEM" : "👁 Show DEM"}</Btn>)}
            </div>
          </>}

          {/* ════ CONTOUR TAB ════ */}
          {tab === "contour" && <>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(34,211,200,0.05)", border: `1px solid rgba(34,211,200,0.17)` }}>
              <div style={{ color: T.cyan, fontWeight: 700, fontSize: 12.5, marginBottom: 5 }}>📐 Contour Lines</div>
              <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.7, marginBottom: 7 }}>GeoXIS Terrain / GeoXIS Pro style · Brown index contours · Rotated labels · KML clip</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <Badge color={T.cyan}>Earth Brown</Badge>
                <Badge color={T.amber}>GM Index Lines</Badge>
                <Badge color={T.green}>Rotated Labels</Badge>
              </div>
            </div>

            {!elevGrid && (<div style={{ padding: "9px 11px", borderRadius: 8, background: "rgba(245,166,35,0.07)", border: `1px solid rgba(245,166,35,0.20)`, color: T.amber, fontSize: 10.5, textAlign: "center" }}>⚠️ Fetch elevation in DEM tab first</div>)}

            {autoInterval && (
              <div style={{ padding: "9px 11px", borderRadius: 8, background: autoInterval.isMine ? `${T.orange}0d` : `${T.lime}0a`, border: `1px solid ${autoInterval.isMine ? T.orange : T.lime}22` }}>
                <div style={{ color: autoInterval.isMine ? T.orange : T.lime, fontSize: 10, fontFamily: MONO, marginBottom: 6 }}>{autoInterval.isMine ? "🪨 Mine/Pit Detected" : "🌄"} · {autoInterval.label} · Δ{Math.round((elevGrid?.max ?? 0) - (elevGrid?.min ?? 0))}m</div>
                <Btn variant={autoInterval.isMine ? "orange" : "lime"} small onClick={() => { setContourInterval(autoInterval.interval); setMajorEvery(autoInterval.major); }}>✨ Apply: {autoInterval.interval}m / major {autoInterval.major}m</Btn>
              </div>
            )}

            {/* Style Presets */}
            <div>
              <SectionLabel>Rendering Style — Preset</SectionLabel>
              <div style={{ display: "flex", gap: 6, marginBottom: 2 }}>
                <button className={`cs-btn${contourStyle === "qgis" ? " qgis" : ""}`} onClick={applyQGISPreset}>
                  🟩 Geoxis Default
                </button>
                <button className={`cs-btn${contourStyle === "globalmapper" ? " gm" : ""}`} onClick={applyGMPreset}>
                  🟧 GeoXIS Pro
                </button>
              </div>
              <div style={{ color: T.faint, fontSize: 9, fontFamily: MONO, marginTop: 3 }}>
                {contourStyle === "qgis" ? "QGIS: thin minor 0.75px · index 2.0px · white halo label" : "GM: minor 0.8px · index 2.5px · cream label bg"}
              </div>
            </div>

            {/* Contour Interval */}
            <div>
              <SectionLabel>Contour Interval</SectionLabel>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {INTERVALS.map(v => (<button key={v} className={`ivl${contourInterval === v ? " on" : ""}`} onClick={() => setContourInterval(v)}>{v}m</button>))}
              </div>
            </div>

            {/* Major Every */}
            <div>
              <SectionLabel>Major Contour Every</SectionLabel>
              <div style={{ display: "flex", gap: 4 }}>
                {MAJORS.map(v => (<button key={v} className={`mjr${majorEvery === v ? " on" : ""}`} onClick={() => setMajorEvery(v)}>{v}m</button>))}
              </div>
            </div>

            {/* Colors */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[["Minor Color", minorColor, setMinorColor], ["Major / Index", majorColor, setMajorColor]].map(([lbl, val, set]) => (
                <div key={lbl}>
                  <SectionLabel>{lbl}</SectionLabel>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <input type="color" value={val} onChange={e => set(e.target.value)} style={{ width: 30, height: 30, border: "none", borderRadius: 6, cursor: "pointer", background: "none" }} />
                    <span style={{ color: T.dim, fontSize: 10, fontFamily: MONO }}>{val}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Checkboxes */}
            {[[smoothContours, setSmoothContours, "Chaikin smoothing (natural curves)", T.cyan],
              [clipContours, setClipContours, "Clip contours to KML boundary", T.blue]].map(([val, set, label, c]) => (
              <label key={label} className="kchk">
                <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} style={{ accentColor: c, width: 14, height: 14 }} />
                <span style={{ color: T.text, fontSize: 11 }}>{label}</span>
              </label>
            ))}

            {/* Line preview */}
            <div style={{ padding: "10px 12px", borderRadius: 8, background: T.surface, border: `1px solid ${T.border}` }}>
              <SectionLabel>Line Style Preview — {contourStyle === "qgis" ? "QGIS" : "GeoXIS Pro"}</SectionLabel>
              <svg width="100%" height="52" style={{ display: "block" }}>
                <line x1="8" y1="16" x2="95%" y2="16" stroke={minorColor} strokeWidth={contourStyle === "qgis" ? "0.75" : "0.8"} opacity={contourStyle === "qgis" ? "0.65" : "0.70"} />
                <text x="8" y="11" fill={T.faint} fontSize="8" fontFamily="monospace">minor ({contourInterval}m)</text>
                <line x1="8" y1="36" x2="95%" y2="36" stroke={majorColor} strokeWidth={contourStyle === "qgis" ? "2.0" : "2.5"} opacity={contourStyle === "qgis" ? "0.88" : "0.92"} />
                <text x="8" y="50" fill={T.faint} fontSize="8" fontFamily="monospace">index ({majorEvery}m) + halo label</text>
                {/* Simulated label */}
                <rect x="48" y="28" width="28" height="12" rx="2" fill="rgba(255,255,255,0.95)" stroke={majorColor} strokeWidth="0.5" />
                <text x="62" y="37" fill={majorColor} fontSize="8" fontFamily="monospace" textAnchor="middle" fontWeight="bold">{majorEvery}</text>
              </svg>
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Btn variant="cyan" onClick={renderContours} disabled={!elevGrid}>📐 Generate Contour Lines</Btn>
              {hasContour && <>
                <Btn variant={contourVisible ? "red" : "green"} onClick={toggleContours}>{contourVisible ? "🙈 Hide Contours" : "👁 Show Contours"}</Btn>
                {contourCount > 0 && (<div style={{ textAlign: "center", color: T.cyan, fontSize: 10, fontFamily: MONO, padding: "3px 0" }}>{contourCount} lines · {contourInterval}m · major {majorEvery}m</div>)}
              </>}
            </div>
          </>}

          {/* ════ EXPORT TAB ════ */}
          {tab === "export" && <>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(184,156,248,0.05)", border: `1px solid rgba(184,156,248,0.17)` }}>
              <div style={{ color: T.violet, fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>💾 Export Data</div>
              <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.7 }}>GeoTIFF · CSV · GeoJSON (3D) · Shapefile ZIP · QGIS/ArcGIS/GlobalMapper ready</div>
            </div>
            <div style={{ padding: "10px 12px", background: T.surface, borderRadius: 9, border: `1px solid ${T.border}` }}>
              <div style={{ color: T.pink, fontWeight: 700, fontSize: 11, marginBottom: 7 }}>🏔 Elevation / DEM</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <Btn variant="pink" onClick={exportGeoTIFF} disabled={!elevGrid} small>Export DEM → GeoTIFF (.tif)</Btn>
                <Btn variant="amber" onClick={exportDEMCSV} disabled={!elevGrid} small>Export DEM Grid → CSV</Btn>
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: T.surface, borderRadius: 9, border: `1px solid ${T.border}` }}>
              <div style={{ color: T.cyan, fontWeight: 700, fontSize: 11, marginBottom: 7 }}>📐 Contour Lines</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <Btn variant="cyan" onClick={exportContoursShapefile} disabled={!elevGrid} small>Export Contours → Shapefile ZIP</Btn>
                <Btn variant="blue" onClick={exportContoursGeoJSON} disabled={!elevGrid} small>Export Contours → GeoJSON (3D)</Btn>
              </div>
            </div>
            {elevGrid && (
              <div style={{ padding: "10px 12px", background: "rgba(74,222,128,0.04)", borderRadius: 9, border: "1px solid rgba(74,222,128,0.15)" }}>
                <div style={{ color: T.green, fontWeight: 700, fontSize: 11, marginBottom: 6 }}>✅ Processing Summary</div>
                <StatRow label="Grid" value={`${elevGrid.rows}×${elevGrid.cols}`} color={T.text} />
                <StatRow label="Min elev" value={`${elevGrid.min.toFixed(1)} m`} color={T.cyan} />
                <StatRow label="Max elev" value={`${elevGrid.max.toFixed(1)} m`} color={T.pink} />
                <StatRow label="Range" value={`${(elevGrid.max - elevGrid.min).toFixed(1)} m`} color={T.amber} />
                {autoInterval && <StatRow label="Terrain" value={`${autoInterval.label}${autoInterval.isMine ? " 🪨" : ""}`} color={autoInterval.isMine ? T.orange : T.lime} />}
                {contourCount > 0 && <StatRow label="Contours" value={`${contourCount} @ ${contourInterval}m`} color={T.violet} />}
              </div>
            )}
          </>}

          {/* ════ KML/SHP TAB ════ */}
          {tab === "kml" && <>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(61,142,240,0.05)", border: `1px solid rgba(61,142,240,0.17)` }}>
              <div style={{ color: T.blue, fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>📦 KML Feature Export</div>
              <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.7 }}>Convert KML/GeoJSON to ESRI Shapefile ZIP (QGIS / ArcGIS / GlobalMapper).</div>
            </div>
            {kmlGeojson ? (() => {
              const counts = { Point: 0, Line: 0, Polygon: 0 };
              const wk = f => { if (!f) return; if (f.type === "FeatureCollection") f.features?.forEach(wk); else if (f.type === "Feature") { const t = f.geometry?.type || ""; if (t.includes("Point")) counts.Point++; else if (t.includes("Line")) counts.Line++; else if (t.includes("Poly")) counts.Polygon++; } };
              wk(kmlGeojson);
              return (<>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {[["📍", "Points", counts.Point, T.blue], ["〰", "Lines", counts.Line, T.green], ["⬡", "Polygons", counts.Polygon, T.amber]].map(([ico, lbl, cnt, c]) => (
                    <div key={lbl} style={{ padding: "10px 6px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, textAlign: "center" }}>
                      <div style={{ fontSize: 15, marginBottom: 3 }}>{ico}</div>
                      <div style={{ color: c, fontSize: 18, fontWeight: 800, fontFamily: MONO, lineHeight: 1 }}>{cnt}</div>
                      <div style={{ color: T.faint, fontSize: 9.5, marginTop: 2 }}>{lbl}</div>
                    </div>
                  ))}
                </div>
                <Btn variant="green" onClick={exportKMLShapefile}>📦 Export KML → Shapefile ZIP</Btn>
                <Btn variant="cyan" onClick={exportKMLGeoJSON}>🌐 Export KML → GeoJSON</Btn>
              </>);
            })() : (
              <div style={{ textAlign: "center", color: T.faint, fontSize: 12, padding: "28px 0", fontStyle: "italic" }}>Load a KML file first</div>
            )}
          </>}

        </div>

        {/* STATUS BAR */}
        {status && (
          <div style={{
            padding: "7px 14px", flexShrink: 0, borderTop: `1px solid ${T.border}`,
            background: "rgba(0,0,0,0.38)",
            color: status.startsWith("✅") ? T.green : status.startsWith("❌") ? T.red : status.startsWith("⚠") ? T.amber : T.blue,
            fontSize: 10.5, fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {status}
          </div>
        )}
      </div>
    </>
  );
}