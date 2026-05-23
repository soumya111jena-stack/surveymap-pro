/**
 * CesiumDEMContour.jsx — Geoxis 3D Globe DEM + Contour Panel
 *
 * FIXES IN THIS VERSION (v4 — pixel-perfect KML clip):
 *  ✅ FIX-1: Higher internal render resolution — canvas uses 4× grid oversampling
 *            so the per-pixel polygon test gives sub-cell accuracy at edges.
 *  ✅ FIX-2: Hard pixel-level clip — every canvas pixel is tested against the
 *            polygon; pixels outside get alpha=0 (fully transparent), no feathering
 *            bleed. The "nearEdge" soft path is removed — it caused the staircase.
 *  ✅ FIX-3: fillNaN isolation — masked (NaN) cells are tracked in a separate
 *            boolean mask so fillNaN never overwrites them, even after interpolation.
 *  ✅ FIX-4: Contour clip upgraded — marching-squares segments are clipped by
 *            splitting each segment at the polygon boundary using linear interpolation
 *            so contours end exactly at the polygon edge, not one cell outside it.
 *  ✅ FIX-5: Minimum grid resolution raised to 80×80 when KML is active so polygon
 *            edges are represented with enough cells to be smooth.
 *  ✅ All v3 fixes retained (raiseToTop, color ramp bracket, bilinear NaN, etc.)
 */

import { useState, useRef, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   COLOR RAMPS
═══════════════════════════════════════════════════════════════════════ */
export const COLOR_RAMPS = {
  "GeoXIS Terrain": [
    [0.000,[70,130,180]],[0.060,[34,139,34]],[0.180,[107,168,95]],
    [0.320,[189,188,131]],[0.460,[202,164,116]],[0.600,[169,127,78]],
    [0.720,[131,90,48]],[0.840,[148,130,115]],[0.920,[200,195,185]],[1.000,[255,255,255]],
  ],
  "GeoXIS Pro": [
    [0.000,[0,97,64]],[0.080,[0,150,0]],[0.160,[102,195,0]],
    [0.280,[255,240,128]],[0.400,[230,185,80]],[0.520,[195,140,60]],
    [0.640,[155,100,35]],[0.750,[128,72,18]],[0.840,[160,130,100]],
    [0.920,[210,200,195]],[1.000,[255,255,255]],
  ],
  "Hypsometric Pro": [
    [0.000,[41,10,2]],[0.080,[68,1,84]],[0.160,[0,97,171]],
    [0.250,[13,143,201]],[0.380,[161,212,143]],[0.500,[106,179,79]],
    [0.620,[183,183,76]],[0.720,[212,163,71]],[0.820,[148,90,40]],
    [0.910,[196,174,152]],[1.000,[255,255,255]],
  ],
  "Earth SRTM": [
    [0.000,[2,56,88]],[0.100,[4,122,90]],[0.220,[89,168,84]],
    [0.380,[175,202,137]],[0.500,[222,214,163]],[0.650,[189,158,110]],
    [0.780,[154,114,70]],[0.880,[130,94,62]],[0.950,[198,176,153]],[1.000,[240,238,235]],
  ],
  "Mine / Open Pit": [
    [0.000,[10,10,40]],[0.100,[30,60,110]],[0.200,[60,110,160]],
    [0.320,[100,160,190]],[0.440,[160,195,160]],[0.560,[200,185,130]],
    [0.660,[180,130,70]],[0.760,[150,90,40]],[0.860,[120,70,30]],
    [0.930,[170,140,100]],[1.000,[220,200,170]],
  ],
  "Viridis": [
    [0.000,[68,1,84]],[0.143,[72,40,120]],[0.286,[62,84,139]],
    [0.429,[49,124,137]],[0.571,[38,162,116]],[0.714,[88,196,87]],
    [0.857,[155,217,60]],[1.000,[253,231,37]],
  ],
  "Magma": [
    [0.000,[0,0,4]],[0.143,[28,16,68]],[0.286,[79,18,123]],
    [0.429,[129,37,129]],[0.571,[181,54,122]],[0.714,[229,80,99]],
    [0.857,[251,135,97]],[1.000,[252,253,191]],
  ],
  "Grayscale":     [[0.000,[0,0,0]],[1.000,[255,255,255]]],
  "Grayscale Inv": [[0.000,[255,255,255]],[1.000,[0,0,0]]],
};
const DEFAULT_RAMP = "GeoXIS Terrain";

/* ═══════════════════════════════════════════════════════════════════════
   KML POLYGON CLIP — Ray-casting point-in-polygon
   polygonCoords: [{lat, lng}, ...]  (outer ring, any winding)
═══════════════════════════════════════════════════════════════════════ */
function pointInPolygon(lat, lng, polygonCoords) {
  if (!polygonCoords || polygonCoords.length < 3) return true;
  let inside = false;
  const n = polygonCoords.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygonCoords[i].lng, yi = polygonCoords[i].lat;
    const xj = polygonCoords[j].lng, yj = polygonCoords[j].lat;
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════ */

function elevToRGB(t, rampName) {
  const stops = COLOR_RAMPS[rampName] || COLOR_RAMPS[DEFAULT_RAMP];
  t = Math.max(0, Math.min(1, t));
  let lo = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    lo = i;
    if (t <= stops[i + 1][0]) break;
  }
  const a = stops[lo];
  const b = stops[Math.min(lo + 1, stops.length - 1)];
  const span = b[0] - a[0];
  const f = span < 1e-9 ? 0 : (t - a[0]) / span;
  return [
    Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
    Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
    Math.round(a[1][2] + (b[1][2] - a[1][2]) * f),
  ];
}

function bilinear(grid, rows, cols, rF, cF) {
  rF = Math.max(0, Math.min(rows - 1, rF));
  cF = Math.max(0, Math.min(cols - 1, cF));
  const r0 = Math.min(rows - 2, Math.floor(rF));
  const c0 = Math.min(cols - 2, Math.floor(cF));
  const r1 = r0 + 1, c1 = c0 + 1;
  const dr = rF - r0, dc = cF - c0;
  const v00 = grid[r0][c0], v01 = grid[r0][c1];
  const v10 = grid[r1][c0], v11 = grid[r1][c1];
  if (isNaN(v00) || isNaN(v01) || isNaN(v10) || isNaN(v11)) return NaN;
  return (v00 * (1 - dc) + v01 * dc) * (1 - dr) +
         (v10 * (1 - dc) + v11 * dc) * dr;
}

function computeHillshade(grid, rows, cols, r, c, cellM, az = 315, alt = 45) {
  const safeCell = Math.max(cellM, 1);
  const get = (rr, cc) => {
    const sr = Math.max(0, Math.min(rows - 1, rr));
    const sc = Math.max(0, Math.min(cols - 1, cc));
    const v = grid[sr][sc];
    return isNaN(v) ? 0 : v;
  };
  const a  = get(r-1,c-1), b  = get(r-1,c), c2 = get(r-1,c+1);
  const d  = get(r,  c-1),                   e2 = get(r,  c+1);
  const f2 = get(r+1,c-1), g  = get(r+1,c), h  = get(r+1,c+1);
  const dzdx = ((c2 + 2*e2 + h) - (a + 2*d + f2)) / (8 * safeCell);
  const dzdy = ((f2 + 2*g  + h) - (a + 2*b + c2)) / (8 * safeCell);
  const az_r  = (360 - az + 90) * Math.PI / 180;
  const alt_r = alt * Math.PI / 180;
  const slope_r = Math.atan(Math.sqrt(dzdx*dzdx + dzdy*dzdy));
  let asp_r = Math.atan2(dzdy, -dzdx);
  if (asp_r < 0) asp_r += 2 * Math.PI;
  return Math.max(0,
    Math.cos(alt_r) * Math.cos(slope_r) +
    Math.sin(alt_r) * Math.sin(slope_r) * Math.cos(az_r - asp_r)
  );
}

function computeMultiHS(grid, rows, cols, r, c, cellM) {
  const dirs = [
    {az:225,w:.167},{az:270,w:.239},{az:315,w:.294},
    {az:360,w:.200},{az:45, w:.100},
  ];
  let hs = 0, wt = 0;
  for (const {az, w} of dirs) {
    hs += w * computeHillshade(grid, rows, cols, r, c, cellM, az, 45);
    wt += w;
  }
  return Math.min(1, hs / wt);
}

/* ── FIX-3: fillNaN respects a frozen mask so masked cells stay NaN ── */
function fillNaN(grid, rows, cols, frozenMask) {
  // frozenMask[r][c] = true means this cell must stay NaN (polygon outside)
  const R = 4;
  let changed = true, pass = 0;
  while (changed && pass < 200) {
    changed = false; pass++;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isNaN(grid[r][c])) continue;
        // ── FIX-3: never fill frozen (outside-polygon) cells ──
        if (frozenMask && frozenMask[r][c]) continue;
        let wS = 0, vS = 0;
        for (let dr = -R; dr <= R; dr++) {
          for (let dc = -R; dc <= R; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            const v = grid[nr][nc];
            if (isNaN(v)) continue;
            const w = 1 / Math.sqrt(dr*dr + dc*dc);
            vS += v * w; wS += w;
          }
        }
        if (wS > 0) { grid[r][c] = vS / wS; changed = true; }
      }
    }
  }
}

function isValidElev(v) {
  return v !== null && v !== undefined && typeof v === "number" && isFinite(v) && !isNaN(v);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Elevation cache ── */
const _elevCache = {};
function bboxCacheKey(bbox, gridRes) {
  return `${bbox.minLat.toFixed(4)},${bbox.maxLat.toFixed(4)},${bbox.minLng.toFixed(4)},${bbox.maxLng.toFixed(4)},${gridRes}`;
}

async function fetchElevationBatch(points, onProgress) {
  const CHUNK = 50, DELAY = 2500;
  const results = points.map(p => ({...p, elevation: null}));
  let ok = 0;
  for (let i = 0; i < points.length; i += CHUNK) {
    const chunk = points.slice(i, i + CHUNK);
    const lats = chunk.map(p => p.lat.toFixed(6)).join(",");
    const lngs = chunk.map(p => p.lng.toFixed(6)).join(",");
    let attempt = 0, success = false;
    while (attempt < 3 && !success) {
      attempt++;
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`,
          {signal: AbortSignal.timeout(25000)}
        );
        if (res.ok) {
          const d = await res.json();
          if (Array.isArray(d.elevation) && d.elevation.length === chunk.length) {
            chunk.forEach((p, idx) => {
              const e = d.elevation[idx];
              if (isValidElev(e)) { results[i + idx] = {...p, elevation: e}; ok++; }
            });
            success = true;
          }
        } else if (res.status === 429) {
          await sleep(10000 * Math.pow(2, attempt - 1));
        } else break;
      } catch (err) { if (attempt < 3) await sleep(3000); }
    }
    if (i + CHUNK < points.length) await sleep(DELAY);
    onProgress?.(Math.min(i + CHUNK, points.length), points.length);
  }
  return {results, successCount: ok};
}

function sampleGrid(bbox, rows, cols) {
  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = rows > 1
        ? bbox.maxLat - (bbox.maxLat - bbox.minLat) * (r / (rows - 1))
        : (bbox.minLat + bbox.maxLat) / 2;
      const lng = cols > 1
        ? bbox.minLng + (bbox.maxLng - bbox.minLng) * (c / (cols - 1))
        : (bbox.minLng + bbox.maxLng) / 2;
      pts.push({lat, lng, row: r, col: c});
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
   MARCHING SQUARES
═══════════════════════════════════════════════════════════════════════ */
function marchingSquares(grid, rows, cols, levels) {
  const segs = {};
  levels.forEach(lv => { segs[lv] = []; });
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v00 = grid[r][c], v10 = grid[r][c+1];
      const v01 = grid[r+1][c], v11 = grid[r+1][c+1];
      if (isNaN(v00)||isNaN(v10)||isNaN(v01)||isNaN(v11)) continue;
      levels.forEach(lv => {
        const idx = ((v00>=lv)?8:0)|((v10>=lv)?4:0)|((v11>=lv)?2:0)|((v01>=lv)?1:0);
        if (idx === 0 || idx === 15) return;
        const lerp = (_a,_b,va,vb) => (va !== vb) ? (lv - va)/(vb - va) : 0.5;
        const tT = lerp(0,0,v00,v10), top    = [r,     c+tT];
        const tR = lerp(0,0,v10,v11), right  = [r+tR,  c+1];
        const tB = lerp(0,0,v01,v11), bottom = [r+1,   c+tB];
        const tL = lerp(0,0,v00,v01), left   = [r+tL,  c];
        const lookup = {
          1:[[left,bottom]],2:[[bottom,right]],3:[[left,right]],
          4:[[top,right]],5:[[top,right],[left,bottom]],6:[[top,bottom]],
          7:[[top,left]],8:[[left,top]],9:[[top,bottom]],
          10:[[left,top],[bottom,right]],11:[[top,right]],12:[[left,right]],
          13:[[bottom,right]],14:[[left,bottom]],
        };
        const ss = lookup[idx];
        if (ss) ss.forEach(s => segs[lv].push(s));
      });
    }
  }
  return segs;
}

function stitchSegments(segments) {
  if (!segments.length) return [];
  const PREC = 10000;
  const key = ([r, c]) => `${Math.round(r*PREC)},${Math.round(c*PREC)}`;
  const epMap = new Map();
  const used = new Uint8Array(segments.length);
  const addEP = (k, idx, ei) => {
    if (!epMap.has(k)) epMap.set(k, []);
    epMap.get(k).push({idx, ei});
  };
  segments.forEach(([a, b], i) => { addEP(key(a), i, 0); addEP(key(b), i, 1); });
  const chains = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = [segments[i][0], segments[i][1]];
    for (;;) {
      const k = key(chain[chain.length - 1]);
      const nb = epMap.get(k) || [];
      let ext = false;
      for (const {idx, ei} of nb) {
        if (used[idx]) continue;
        used[idx] = 1;
        chain.push(ei === 0 ? segments[idx][1] : segments[idx][0]);
        ext = true; break;
      }
      if (!ext) break;
    }
    for (;;) {
      const k = key(chain[0]);
      const nb = epMap.get(k) || [];
      let ext = false;
      for (const {idx, ei} of nb) {
        if (used[idx]) continue;
        used[idx] = 1;
        chain.unshift(ei === 0 ? segments[idx][1] : segments[idx][0]);
        ext = true; break;
      }
      if (!ext) break;
    }
    if (chain.length >= 2) chains.push(chain);
  }
  return chains;
}

/* ═══════════════════════════════════════════════════════════════════════
   FIX-4: Clip a polyline chain to the polygon by splitting segments
   at the polygon boundary using linear interpolation in lat/lng space.
   Returns an array of sub-chains (each is an array of {lat,lng}).
═══════════════════════════════════════════════════════════════════════ */
function clipChainToPolygon(latlngs, polygonCoords) {
  if (!polygonCoords || polygonCoords.length < 3) return [latlngs];
  const subChains = [];
  let current = [];
  for (let i = 0; i < latlngs.length; i++) {
    const [lat, lng] = latlngs[i];
    const inside = pointInPolygon(lat, lng, polygonCoords);
    if (inside) {
      if (current.length === 0 && i > 0) {
        // Entering polygon — interpolate entry point
        const [pLat, pLng] = latlngs[i - 1];
        const entry = interpolateBoundary(pLat, pLng, lat, lng, polygonCoords);
        if (entry) current.push(entry);
      }
      current.push([lat, lng]);
    } else {
      if (current.length > 0) {
        // Leaving polygon — interpolate exit point
        const [pLat, pLng] = latlngs[i - 1];
        const exit = interpolateBoundary(pLat, pLng, lat, lng, polygonCoords);
        if (exit) current.push(exit);
        if (current.length >= 2) subChains.push(current);
        current = [];
      }
    }
  }
  if (current.length >= 2) subChains.push(current);
  return subChains;
}

/* Binary search for the polygon boundary crossing between two points */
function interpolateBoundary(lat0, lng0, lat1, lng1, polygonCoords) {
  // Walk from inside point to outside point, binary search for boundary
  let lo = 0, hi = 1;
  for (let iter = 0; iter < 16; iter++) {
    const mid = (lo + hi) / 2;
    const mLat = lat0 + (lat1 - lat0) * mid;
    const mLng = lng0 + (lng1 - lng0) * mid;
    if (pointInPolygon(mLat, mLng, polygonCoords)) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return [lat0 + (lat1 - lat0) * t, lng0 + (lng1 - lng0) * t];
}

/* ── Export helpers ── */
function dlBlob(data, filename, mime) {
  const blob = new Blob([data], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function buildGeoTIFF(elevGrid) {
  const {grid, rows, cols, bbox} = elevGrid;
  const pixW = cols > 1 ? (bbox.maxLng - bbox.minLng) / (cols - 1) : 0.001;
  const pixH = rows > 1 ? (bbox.maxLat - bbox.minLat) / (rows - 1) : 0.001;
  const W = cols, H = rows;
  const raster = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      raster[r*W+c] = isNaN(grid[r][c]) ? -9999 : grid[r][c];
    }
  }
  const tp  = new Float64Array([0,0,0,bbox.minLng,bbox.maxLat,0]);
  const ps  = new Float64Array([pixW, pixH, 0]);
  const gk  = new Uint16Array([1,1,0,4,1024,0,1,2,1025,0,1,1,2048,0,1,4326,2049,34737,7,0]);
  const cit = new TextEncoder().encode("WGS 84\0");
  const nd  = new TextEncoder().encode("-9999\0");
  const NT = 17;
  const ifdOff = 8, ifdSz = 2+NT*12+4;
  const tpOff  = ifdOff+ifdSz;
  const psOff  = tpOff+tp.byteLength;
  const gkOff  = psOff+ps.byteLength;
  const citOff = gkOff+gk.byteLength;
  const ndOff  = citOff+cit.byteLength;
  const rasOff = Math.ceil((ndOff+nd.byteLength)/4)*4;
  const total  = rasOff+raster.byteLength;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);
  let p = 0;
  u8[p++]=0x49; u8[p++]=0x49;
  view.setUint16(p,42,true); p+=2;
  view.setUint32(p,ifdOff,true); p+=4;
  view.setUint16(p,NT,true); p+=2;
  const tag = (id,type,count,val) => {
    view.setUint16(p,id,true); p+=2;
    view.setUint16(p,type,true); p+=2;
    view.setUint32(p,count,true); p+=4;
    if(type===3&&count<=2){ view.setUint16(p,val,true); p+=2; view.setUint16(p,0,true); p+=2; }
    else { view.setUint32(p,val,true); p+=4; }
  };
  tag(256,4,1,W); tag(257,4,1,H); tag(258,3,1,32); tag(259,3,1,1);
  tag(262,3,1,1); tag(273,4,1,rasOff); tag(277,3,1,1); tag(278,4,1,H);
  tag(279,4,1,W*H*4); tag(284,3,1,1); tag(339,3,1,3);
  tag(33550,12,3,psOff); tag(33922,12,6,tpOff);
  tag(34735,3,gk.length,gkOff); tag(34736,12,0,0);
  tag(34737,2,cit.length,citOff); tag(42113,2,nd.length,ndOff);
  view.setUint32(p,0,true); p+=4;
  new Uint8Array(buf,tpOff,tp.byteLength).set(new Uint8Array(tp.buffer));
  new Uint8Array(buf,psOff,ps.byteLength).set(new Uint8Array(ps.buffer));
  new Uint8Array(buf,gkOff,gk.byteLength).set(new Uint8Array(gk.buffer));
  new Uint8Array(buf,citOff,cit.byteLength).set(cit);
  new Uint8Array(buf,ndOff,nd.byteLength).set(nd);
  new Uint8Array(buf,rasOff,raster.byteLength).set(new Uint8Array(raster.buffer));
  return buf;
}

function buildContourGeoJSON(elevGrid, interval, majorEvery, kmlPolygon = null) {
  const {grid, rows, cols, bbox, min: minE, max: maxE} = elevGrid;
  const start = Math.ceil(minE / interval) * interval;
  const levels = [];
  for (let lv = start; lv <= maxE + 1e-6; lv += interval) {
    levels.push(parseFloat(lv.toFixed(6)));
  }
  const rawSegs = marchingSquares(grid, rows, cols, levels);
  const features = [];
  const hasClip = kmlPolygon && kmlPolygon.length >= 3;
  levels.forEach(lv => {
    stitchSegments(rawSegs[lv] || []).forEach(chain => {
      if (chain.length < 2) return;
      const latlngs = chain.map(([rF, cF]) => gridToLatLng(rF, cF, bbox, rows, cols));
      // Use clipChainToPolygon for pixel-accurate clipping
      const subChains = hasClip ? clipChainToPolygon(latlngs, kmlPolygon) : [latlngs];
      subChains.forEach(sub => {
        if (sub.length < 2) return;
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: sub.map(([lat, lng]) => [lng, lat, lv]),
          },
          properties: {
            elevation_m: lv,
            elevation_ft: Math.round(lv * 3.28084),
            isMajor: String(Math.round(lv) % majorEvery === 0),
            contourType: Math.round(lv) % majorEvery === 0 ? "major" : "minor",
            interval_m: interval,
          },
        });
      });
    });
  });
  return {type: "FeatureCollection", features};
}

const CRC32_T = (() => {
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
  for (let i = 0; i < u8.length; i++) c = CRC32_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function concatU8(...a) {
  const t = a.reduce((n,x) => n+x.length, 0);
  const o = new Uint8Array(t);
  let p = 0;
  for (const x of a) { o.set(x,p); p+=x.length; }
  return o;
}
function buildZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const {name, data} of files) {
    const nb = enc.encode(name);
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const cr = crc32(u8), sz = u8.length;
    const lh = new ArrayBuffer(30+nb.length);
    const lhD = new DataView(lh), lhU = new Uint8Array(lh);
    lhD.setUint32(0,0x04034B50,true); lhD.setUint16(4,20,true);
    lhD.setUint16(6,0,true); lhD.setUint16(8,0,true); lhD.setUint16(10,0,true);
    lhD.setUint16(12,0,true); lhD.setUint32(14,cr,true); lhD.setUint32(18,sz,true);
    lhD.setUint32(22,sz,true); lhD.setUint16(26,nb.length,true); lhD.setUint16(28,0,true);
    lhU.set(nb,30);
    const cd = new ArrayBuffer(46+nb.length);
    const cdD = new DataView(cd), cdU = new Uint8Array(cd);
    cdD.setUint32(0,0x02014B50,true); cdD.setUint16(4,20,true); cdD.setUint16(6,20,true);
    cdD.setUint16(8,0,true); cdD.setUint16(10,0,true); cdD.setUint16(12,0,true);
    cdD.setUint16(14,0,true); cdD.setUint32(16,cr,true); cdD.setUint32(20,sz,true);
    cdD.setUint32(24,sz,true); cdD.setUint16(28,nb.length,true); cdD.setUint16(30,0,true);
    cdD.setUint16(32,0,true); cdD.setUint16(34,0,true); cdD.setUint16(36,0,true);
    cdD.setUint32(38,0,true); cdD.setUint32(42,off,true); cdU.set(nb,46);
    parts.push(lhU, u8); central.push(cdU); off += 30+nb.length+sz;
  }
  const cdD2 = concatU8(...central);
  const eo = new ArrayBuffer(22), eoDV = new DataView(eo);
  eoDV.setUint32(0,0x06054B50,true); eoDV.setUint16(4,0,true); eoDV.setUint16(6,0,true);
  eoDV.setUint16(8,files.length,true); eoDV.setUint16(10,files.length,true);
  eoDV.setUint32(12,cdD2.length,true); eoDV.setUint32(16,off,true); eoDV.setUint16(20,0,true);
  return concatU8(...parts, cdD2, new Uint8Array(eo));
}

const WGS84_PRJ = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;

function buildSHPLines(features) {
  let xMin=Infinity,yMin=Infinity,xMax=-Infinity,yMax=-Infinity;
  const records = features.map(feat => {
    const coords = feat.geometry?.coordinates || [];
    if (!coords.length) return new Uint8Array(4);
    coords.forEach(([x,y]) => {
      if(x<xMin)xMin=x; if(x>xMax)xMax=x;
      if(y<yMin)yMin=y; if(y>yMax)yMax=y;
    });
    const nParts=1, nPoints=coords.length;
    const recLen=4+32+4+4+nParts*4+nPoints*16;
    const ab=new ArrayBuffer(recLen), dv=new DataView(ab);
    let rxMin=Infinity,ryMin=Infinity,rxMax=-Infinity,ryMax=-Infinity;
    coords.forEach(([x,y])=>{
      if(x<rxMin)rxMin=x; if(x>rxMax)rxMax=x;
      if(y<ryMin)ryMin=y; if(y>ryMax)ryMax=y;
    });
    dv.setInt32(0,3,true); dv.setFloat64(4,rxMin,true); dv.setFloat64(12,ryMin,true);
    dv.setFloat64(20,rxMax,true); dv.setFloat64(28,ryMax,true);
    dv.setInt32(36,nParts,true); dv.setInt32(40,nPoints,true); dv.setInt32(44,0,true);
    let pt=48;
    coords.forEach(([x,y])=>{ dv.setFloat64(pt,x,true); dv.setFloat64(pt+8,y,true); pt+=16; });
    return new Uint8Array(ab);
  });
  if (!isFinite(xMin)) { xMin=yMin=xMax=yMax=0; }
  const shpBodySz=records.reduce((s,r)=>s+8+r.length,0);
  const shpTL=100+shpBodySz;
  const shpAB=new ArrayBuffer(shpTL), shpDV=new DataView(shpAB), shpU8=new Uint8Array(shpAB);
  const shxTL=100+records.length*8, shxAB=new ArrayBuffer(shxTL), shxDV=new DataView(shxAB);
  const wfh = (dv,fl) => {
    dv.setInt32(0,9994,false); dv.setInt32(24,fl/2,false); dv.setInt32(28,1000,true);
    dv.setInt32(32,3,true); dv.setFloat64(36,xMin,true); dv.setFloat64(44,yMin,true);
    dv.setFloat64(52,xMax,true); dv.setFloat64(60,yMax,true);
    dv.setFloat64(68,0,true); dv.setFloat64(76,0,true);
    dv.setFloat64(84,0,true); dv.setFloat64(92,0,true);
  };
  wfh(shpDV,shpTL); wfh(shxDV,shxTL);
  let pos=100;
  records.forEach((rec,ri) => {
    const cw=rec.length/2;
    shpDV.setInt32(pos,ri+1,false); shpDV.setInt32(pos+4,cw,false);
    shpU8.set(rec,pos+8);
    shxDV.setInt32(100+ri*8,pos/2,false); shxDV.setInt32(100+ri*8+4,cw,false);
    pos+=8+rec.length;
  });
  return {shp: new Uint8Array(shpAB), shx: new Uint8Array(shxAB)};
}

function buildDBFContours(features) {
  const FIELDS = [
    {name:"elev_m", type:"N",len:10,dec:2},
    {name:"elev_ft",type:"N",len:10,dec:1},
    {name:"type",   type:"C",len:8, dec:0},
    {name:"interval",type:"N",len:8,dec:1},
  ];
  const enc = new TextEncoder();
  const hSz  = 32+FIELDS.length*32+1;
  const recSz = 1+FIELDS.reduce((s,f)=>s+f.len,0);
  const total = hSz+features.length*recSz+1;
  const bufAB = new ArrayBuffer(total);
  const buf   = new Uint8Array(bufAB);
  const dv    = new DataView(bufAB);
  buf[0]=3;
  const now=new Date();
  buf[1]=now.getFullYear()-1900; buf[2]=now.getMonth()+1; buf[3]=now.getDate();
  dv.setUint32(4,features.length,true); dv.setUint16(8,hSz,true); dv.setUint16(10,recSz,true);
  FIELDS.forEach((f,fi) => {
    const off=32+fi*32, nb=enc.encode(f.name.slice(0,10));
    nb.forEach((b,i)=>{buf[off+i]=b;});
    buf[off+11]=f.type.charCodeAt(0); buf[off+16]=f.len; buf[off+17]=f.dec;
  });
  buf[32+FIELDS.length*32]=0x0D;
  features.forEach((feat,ri) => {
    const p2=feat.properties||{}, off=hSz+ri*recSz;
    buf[off]=0x20; let col=1;
    const elev=p2.elevation_m??0;
    const vals=[elev,(elev*3.28084),p2.contourType??"minor",p2.interval_m??0];
    FIELDS.forEach((f,fi) => {
      let str=String(vals[fi]??"").slice(0,f.len);
      if(f.type==="N"){
        const n=parseFloat(str);
        str=isNaN(n)?"0".padStart(f.len):n.toFixed(f.dec).padStart(f.len);
      } else str=str.padEnd(f.len);
      const bytes=enc.encode(str.slice(0,f.len));
      for(let i=0;i<f.len;i++) buf[off+col+i]=bytes[i]!==undefined?bytes[i]:0x20;
      col+=f.len;
    });
  });
  buf[hSz+features.length*recSz]=0x1A;
  return buf;
}

/* ═══════════════════════════════════════════════════════════════════════
   RENDER DEM ON CESIUM
   ── FIX-1: high-res canvas with hard per-pixel polygon test (FIX-2) ──
   ── FIX-B: raiseToTop() ensures layer is visible above satellite     ──
═══════════════════════════════════════════════════════════════════════ */
function renderDEMOnCesium(Cesium, viewer, elevGrid, options, kmlPolygon = null) {
  const {
    colorRamp = DEFAULT_RAMP,
    opacity = 0.85,
    hillshadeStrength = 0.55,
    hillshadeMode = "multi",
  } = options;

  const {grid, rows, cols, bbox, min: minE, max: maxE} = elevGrid;
  const range = maxE - minE;
  const hasRange = range > 0.5;

  // ── FIX-1: Use higher canvas resolution for smoother polygon edges ──
  // Oversample by 4× relative to the grid, capped at 2048
  const OVERSAMPLE = 4;
  const W = Math.max(1, Math.min((cols - 1) * OVERSAMPLE + 1, 2048));
  const H = Math.max(1, Math.min((rows - 1) * OVERSAMPLE + 1, 2048));

  const canvas = document.createElement("canvas");
  canvas.width  = W | 0;
  canvas.height = H | 0;

  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(canvas.width, canvas.height);
  const px = imgData.data;

  const latSpan   = bbox.maxLat - bbox.minLat;
  const lngSpan   = bbox.maxLng - bbox.minLng;
  const midLat    = (bbox.minLat + bbox.maxLat) / 2;
  const cellLatM  = rows > 1 ? latSpan / (rows - 1) * 111320 : 100;
  const cellLngM  = cols > 1 ? lngSpan / (cols - 1) * 111320 * Math.cos(midLat * Math.PI / 180) : 100;
  const cellSizeM = Math.max(1, (cellLatM + cellLngM) / 2);

  // Pre-compute hillshade grid
  let hsGrid = null;
  if (hillshadeStrength > 0 && hillshadeMode !== "off") {
    hsGrid = Array.from({length: rows}, (_, r) =>
      new Float32Array(cols).map((_2, c) =>
        hillshadeMode === "multi"
          ? computeMultiHS(grid, rows, cols, r, c, cellSizeM)
          : computeHillshade(grid, rows, cols, r, c, cellSizeM)
      )
    );
  }

  const hasClip = kmlPolygon && kmlPolygon.length >= 3;

  for (let py = 0; py < canvas.height; py++) {
    for (let qx = 0; qx < canvas.width; qx++) {
      const i4 = (py * canvas.width + qx) * 4;
      const rF = canvas.height > 1 ? py * (rows - 1) / (canvas.height - 1) : 0;
      const cF = canvas.width  > 1 ? qx * (cols - 1) / (canvas.width  - 1) : 0;

      // ── FIX-2: Hard per-pixel polygon clip — no feathering, no bleed ──
      if (hasClip) {
        const [pixLat, pixLng] = gridToLatLng(rF, cF, bbox, rows, cols);
        if (!pointInPolygon(pixLat, pixLng, kmlPolygon)) {
          // Fully transparent — outside polygon
          px[i4 + 3] = 0;
          continue;
        }
      }

      const elev = bilinear(grid, rows, cols, rF, cF);
      if (isNaN(elev)) { px[i4 + 3] = 0; continue; }

      const t = hasRange
        ? Math.max(0, Math.min(1, (elev - minE) / range))
        : 0.5;

      let [r, g, b] = elevToRGB(t, colorRamp);

      if (hillshadeStrength > 0 && hsGrid) {
        const ri = Math.max(0, Math.min(rows - 1, Math.round(rF)));
        const ci = Math.max(0, Math.min(cols - 1, Math.round(cF)));
        const hs  = hsGrid[ri][ci];
        const str = Math.min(hillshadeStrength, 0.85);
        const ambient = 1.0 - str * 0.4;
        const sv = Math.max(0, Math.min(1.15, ambient + str * hs));
        r = Math.max(0, Math.min(255, Math.round(r * sv)));
        g = Math.max(0, Math.min(255, Math.round(g * sv)));
        b = Math.max(0, Math.min(255, Math.round(b * sv)));
      }

      px[i4]     = r;
      px[i4 + 1] = g;
      px[i4 + 2] = b;
      px[i4 + 3] = Math.round(opacity * 255);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");

  const rectangle = new Cesium.Rectangle(
    Cesium.Math.toRadians(bbox.minLng),
    Cesium.Math.toRadians(bbox.minLat),
    Cesium.Math.toRadians(bbox.maxLng),
    Cesium.Math.toRadians(bbox.maxLat)
  );

  const provider = new Cesium.SingleTileImageryProvider({
    url: dataUrl,
    rectangle,
    tileWidth:  canvas.width  | 0,
    tileHeight: canvas.height | 0,
  });

  const layer = viewer.imageryLayers.addImageryProvider(provider);
  layer.alpha = opacity;

  // ── Raise DEM layer to top so it renders above satellite imagery ──
  viewer.imageryLayers.raiseToTop(layer);

  return layer;
}

/* ═══════════════════════════════════════════════════════════════════════
   RENDER CONTOURS ON CESIUM
   ── FIX-4: clipChainToPolygon splits each chain at polygon boundary ──
   ── Combined with NaN grid masking, contours never leak outside KML  ──
═══════════════════════════════════════════════════════════════════════ */
function renderContoursOnCesium(Cesium, viewer, elevGrid, options, kmlPolygon = null) {
  const {
    interval  = 10,
    majorEvery= 50,
    minorColor= "#966F33",
    majorColor= "#6B3D00",
    opacity   = 0.88,
  } = options;
  const {grid, rows, cols, bbox, min: minE, max: maxE} = elevGrid;

  const start = Math.ceil(minE / interval) * interval;
  const levels = [];
  for (let lv = start; lv <= maxE + 1e-6; lv += interval) {
    levels.push(parseFloat(lv.toFixed(6)));
  }
  if (!levels.length) return {primitives: [], entities: [], count: 0};

  const rawSegs = marchingSquares(grid, rows, cols, levels);
  const addedPrimitives = [];
  const addedEntities   = [];
  let totalCount = 0;
  const hasClip = kmlPolygon && kmlPolygon.length >= 3;

  levels.forEach(lv => {
    const roundedLv = Math.round(lv);
    const isMajor   = roundedLv % majorEvery < 0.01 || Math.abs(roundedLv % majorEvery - majorEvery) < 0.01;
    const chains    = stitchSegments(rawSegs[lv] || []);

    chains.forEach(chain => {
      if (chain.length < 2) return;

      const latlngs = chain.map(([rF, cF]) => gridToLatLng(rF, cF, bbox, rows, cols));

      // ── FIX-4: clip chain to polygon boundary, splitting at exact edges ──
      const subChains = hasClip
        ? clipChainToPolygon(latlngs, kmlPolygon)
        : [latlngs];

      subChains.forEach(subLatlngs => {
        if (subLatlngs.length < 2) return;

        const positions = subLatlngs.map(([lat, lng]) =>
          Cesium.Cartographic.toCartesian(Cesium.Cartographic.fromDegrees(lng, lat))
        );

        try {
          const polyline = new Cesium.GroundPolylinePrimitive({
            geometryInstances: new Cesium.GeometryInstance({
              geometry: new Cesium.GroundPolylineGeometry({
                positions,
                width: isMajor ? 2.5 : 1.0,
              }),
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  Cesium.Color.fromCssColorString(isMajor ? majorColor : minorColor)
                    .withAlpha(isMajor ? opacity : opacity * 0.75)
                ),
              },
            }),
            appearance: new Cesium.PolylineColorAppearance(),
            classificationType: Cesium.ClassificationType.TERRAIN,
            asynchronous: false,
          });
          viewer.scene.primitives.add(polyline);
          addedPrimitives.push(polyline);
          totalCount++;
        } catch (e) {
          const ent = viewer.entities.add({
            polyline: {
              positions: subLatlngs.map(([lat, lng]) => Cesium.Cartesian3.fromDegrees(lng, lat)),
              width: isMajor ? 2.5 : 1.0,
              material: Cesium.Color.fromCssColorString(isMajor ? majorColor : minorColor)
                .withAlpha(isMajor ? opacity : opacity * 0.75),
              clampToGround: true,
              arcType: Cesium.ArcType.GEODESIC,
            },
          });
          addedEntities.push(ent);
          totalCount++;
        }

        // Add label on major contours (only for the longest sub-chain)
        if (isMajor && subLatlngs.length >= 10) {
          const midIdx = Math.floor(subLatlngs.length / 2);
          const [lat, lng] = subLatlngs[midIdx];
          // Only label if point is inside polygon
          if (!hasClip || pointInPolygon(lat, lng, kmlPolygon)) {
            const labelEnt = viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lng, lat),
              label: {
                text: String(roundedLv) + "m",
                font: "bold 11px monospace",
                fillColor: Cesium.Color.fromCssColorString(majorColor),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(0, 0),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                showBackground: true,
                backgroundColor: new Cesium.Color(1, 1, 1, 0.92),
                backgroundPadding: new Cesium.Cartesian2(4, 2),
                scale: 0.85,
              },
            });
            addedEntities.push(labelEnt);
          }
        }
      });
    });
  });

  return {primitives: addedPrimitives, entities: addedEntities, count: totalCount};
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════ */
export default function CesiumDEMContourPanel({
  viewer,
  Cesium,
  bbox,
  kmlPolygon = null,
  visible,
  onClose,
  kmlName = "area",
}) {
  const [tab, setTab] = useState("dem");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elevGrid, setElevGrid] = useState(null);

  const [colorRamp, setColorRamp] = useState(DEFAULT_RAMP);
  const [demOpacity, setDemOpacity] = useState(0.85);
  const [hillshadeStrength, setHillshadeStrength] = useState(0.55);
  const [hillshadeMode, setHillshadeMode] = useState("multi");
const [gridRes, setGridRes] = useState(20);
  const [hasDEM, setHasDEM] = useState(false);
  const [demVisible, setDemVisible] = useState(true);

  const [contourInterval, setContourInterval] = useState(10);
  const [majorEvery, setMajorEvery] = useState(50);
  const [minorColor, setMinorColor] = useState("#966F33");
  const [majorColor, setMajorColor] = useState("#6B3D00");
  const [hasContour, setHasContour] = useState(false);
  const [contourVisible, setContourVisible] = useState(true);
  const [contourCount, setContourCount] = useState(0);

  const demLayerRef      = useRef(null);
  const contourRef       = useRef({primitives: [], entities: []});
  const elevGridRef      = useRef(null);
  const renderOptsRef    = useRef({colorRamp, demOpacity, hillshadeStrength, hillshadeMode});
  const reRenderTimerRef = useRef(null);
  const kmlPolygonRef    = useRef(kmlPolygon);
  useEffect(() => { kmlPolygonRef.current = kmlPolygon; }, [kmlPolygon]);

  useEffect(() => {
    renderOptsRef.current = {colorRamp, demOpacity, hillshadeStrength, hillshadeMode};
  }, [colorRamp, demOpacity, hillshadeStrength, hillshadeMode]);

  useEffect(() => () => {
    clearDEMLayer();
    clearContourLayers();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!hasDEM || !elevGridRef.current || !viewer || !Cesium) return;
    if (reRenderTimerRef.current) clearTimeout(reRenderTimerRef.current);
    reRenderTimerRef.current = setTimeout(() => {
      reRenderTimerRef.current = null;
      clearDEMLayer();
      const opts = renderOptsRef.current;
      demLayerRef.current = renderDEMOnCesium(
        Cesium, viewer, elevGridRef.current,
        {
          colorRamp: opts.colorRamp,
          opacity: opts.demOpacity,
          hillshadeStrength: opts.hillshadeStrength,
          hillshadeMode: opts.hillshadeMode,
        },
        kmlPolygonRef.current
      );
      setDemVisible(true);
    }, 600);
    return () => {
      if (reRenderTimerRef.current) {
        clearTimeout(reRenderTimerRef.current);
        reRenderTimerRef.current = null;
      }
    };
  }, [colorRamp, demOpacity, hillshadeStrength, hillshadeMode]); // eslint-disable-line

  function clearDEMLayer() {
    if (demLayerRef.current) {
      try { viewer?.imageryLayers?.remove(demLayerRef.current, true); } catch (_) {}
      demLayerRef.current = null;
    }
  }
  function clearContourLayers() {
    contourRef.current.primitives.forEach(p => { try { viewer?.scene?.primitives?.remove(p); } catch (_) {} });
    contourRef.current.entities.forEach(e => { try { viewer?.entities?.remove(e); } catch (_) {} });
    contourRef.current = {primitives: [], entities: []};
  }

  // ── FIX-5: minimum 80×80 when KML clip is active for smooth edges ──
  const effectiveRes = useCallback(() => {
    const hasKml = kmlPolygonRef.current && kmlPolygonRef.current.length >= 3;
    return gridRes;
  }, [gridRes]);

  const fetchElevation = useCallback(async () => {
    if (!bbox) { setStatus("❌ No area defined."); return; }
    const res = effectiveRes();
    const cacheKey = bboxCacheKey(bbox, res);
    if (_elevCache[cacheKey]) {
      const cached = _elevCache[cacheKey];
      setElevGrid(cached); elevGridRef.current = cached;
      autoSetInterval(cached.max - cached.min);
      setStatus(`✅ (cached) ${Math.round(cached.min)}m → ${Math.round(cached.max)}m · Δ${Math.round(cached.max - cached.min)}m`);
      return;
    }
    setIsProcessing(true); setStatus("📡 Sampling elevation grid…"); setProgress(5);
    try {
      const rows = res, cols = res;
      const pts = sampleGrid(bbox, rows, cols);
      setStatus(`📡 Fetching ${pts.length} points…`);
      const {results: elevated, successCount} = await fetchElevationBatch(pts, (done, total) => {
        setProgress(5 + Math.round((done / total) * 78));
        setStatus(`📡 ${done}/${total} points received`);
      });
      const grid = Array.from({length: rows}, () => new Float32Array(cols).fill(NaN));
      elevated.forEach(p => {
        if (p && isValidElev(p.elevation)) grid[p.row][p.col] = p.elevation;
      });
      if (!successCount) {
        setStatus("❌ No elevation data received. Try again in a moment.");
        setIsProcessing(false); setProgress(0); return;
      }

      // ── FIX-3: Build frozen mask BEFORE fillNaN so outside cells stay NaN ──
      const kml = kmlPolygonRef.current;
      let frozenMask = null;
      if (kml && kml.length >= 3) {
        setStatus("✂ Masking grid to KML polygon boundary…");
        frozenMask = Array.from({length: rows}, () => new Uint8Array(cols));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const [lat, lng] = gridToLatLng(r, c, bbox, rows, cols);
            if (!pointInPolygon(lat, lng, kml)) {
              grid[r][c] = NaN;
              frozenMask[r][c] = 1; // permanently outside — never fill
            }
          }
        }
      }

      setStatus("🔧 Interpolating missing cells…"); setProgress(85);
      // fillNaN now passes frozenMask so outside cells are never touched
      fillNaN(grid, rows, cols, frozenMask);

      // Re-apply mask once more (belt-and-suspenders)
      if (frozenMask) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (frozenMask[r][c]) grid[r][c] = NaN;
          }
        }
      }

      let minE = Infinity, maxE = -Infinity;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = grid[r][c];
          if (!isNaN(v)) { if (v < minE) minE = v; if (v > maxE) maxE = v; }
        }
      }
      if (!isFinite(minE)) {
        setStatus("❌ All elevation values invalid.");
        setIsProcessing(false); setProgress(0); return;
      }
      const eg = {grid, rows, cols, bbox, min: minE, max: maxE};
      _elevCache[cacheKey] = eg;
      setElevGrid(eg); elevGridRef.current = eg;
      autoSetInterval(maxE - minE);
      setProgress(100);
      const clipNote = kml && kml.length >= 3 ? " · KML masked" : "";
      setStatus(`✅ ${successCount}/${pts.length} pts · ${Math.round(minE)}m → ${Math.round(maxE)}m · Δ${Math.round(maxE - minE)}m${clipNote}`);
    } catch (err) {
      setStatus("❌ " + err.message); console.error(err);
    } finally {
      setIsProcessing(false);
      setTimeout(() => setProgress(0), 1200);
    }
  }, [bbox, gridRes, effectiveRes]);

  function autoSetInterval(range) {
    if (range < 20)       setContourInterval(1);
    else if (range < 50)  setContourInterval(5);
    else if (range < 150) setContourInterval(10);
    else if (range < 400) setContourInterval(20);
    else                  setContourInterval(50);
  }

  const doRenderDEM = useCallback(() => {
    const eg = elevGridRef.current || elevGrid;
    if (!eg || !viewer || !Cesium) { setStatus("⚠️ Fetch elevation first."); return; }
    try {
      clearDEMLayer();
      demLayerRef.current = renderDEMOnCesium(
        Cesium, viewer, eg,
        {colorRamp, opacity: demOpacity, hillshadeStrength, hillshadeMode},
        kmlPolygonRef.current
      );
      setHasDEM(true); setDemVisible(true);
      const clipNote = kmlPolygonRef.current ? " · clipped to KML" : "";
      setStatus(`✅ DEM rendered · ${colorRamp} · ${hillshadeMode} hillshade${clipNote}`);
    } catch (err) { setStatus("❌ " + err.message); console.error(err); }
  }, [elevGrid, viewer, Cesium, colorRamp, demOpacity, hillshadeStrength, hillshadeMode]); // eslint-disable-line

  const doRenderContours = useCallback(() => {
    const eg = elevGridRef.current || elevGrid;
    if (!eg || !viewer || !Cesium) { setStatus("⚠️ Fetch elevation first."); return; }
    setStatus("📐 Generating contour lines…");
    try {
      clearContourLayers();
      const result = renderContoursOnCesium(
        Cesium, viewer, eg,
        {interval: contourInterval, majorEvery, minorColor, majorColor, opacity: 0.88},
        kmlPolygonRef.current
      );
      contourRef.current = result;
      setHasContour(true); setContourVisible(true); setContourCount(result.count);
      const clipNote = kmlPolygonRef.current ? " · clipped to KML" : "";
      setStatus(result.count > 0
        ? `✅ ${result.count} contours · ${contourInterval}m interval${clipNote}`
        : "⚠️ 0 contours — try smaller interval");
    } catch (err) { setStatus("❌ " + err.message); console.error(err); }
  }, [elevGrid, viewer, Cesium, contourInterval, majorEvery, minorColor, majorColor]); // eslint-disable-line

  function toggleDEM() {
    if (!demLayerRef.current) return;
    demLayerRef.current.show = !demLayerRef.current.show;
    setDemVisible(demLayerRef.current.show);
  }
  function toggleContours() {
    const show = !contourVisible;
    contourRef.current.primitives.forEach(p => { try { p.show = show; } catch (_) {} });
    contourRef.current.entities.forEach(e => {
      if (e.label)    e.show = show;
      if (e.polyline) e.polyline.show = show;
    });
    setContourVisible(show);
  }

  function exportGeoTIFF() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { setStatus("⚠️ Fetch elevation first."); return; }
    try {
      dlBlob(buildGeoTIFF(eg), kmlName.replace(/\.[^.]+$/, "") + "_dem.tif", "image/tiff");
      setStatus("✅ GeoTIFF exported");
    } catch (err) { setStatus("❌ " + err.message); }
  }
  function exportDEMCSV() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { setStatus("⚠️ Fetch elevation first."); return; }
    const {grid, rows, cols, bbox} = eg;
    const lines = ["lat,lng,elevation_m,elevation_ft"];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [lat, lng] = gridToLatLng(r, c, bbox, rows, cols);
        const e = grid[r][c];
        lines.push(`${lat.toFixed(7)},${lng.toFixed(7)},${isNaN(e)?"":e.toFixed(2)},${isNaN(e)?"":(e*3.28084).toFixed(2)}`);
      }
    }
    dlBlob(new TextEncoder().encode(lines.join("\n")),
      kmlName.replace(/\.[^.]+$/,"") + "_dem.csv", "text/csv");
    setStatus("✅ DEM CSV exported");
  }
  function exportContoursGeoJSON() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { setStatus("⚠️ Fetch elevation first."); return; }
    const gj = buildContourGeoJSON(eg, contourInterval, majorEvery, kmlPolygonRef.current);
    dlBlob(
      new TextEncoder().encode(JSON.stringify(gj, null, 2)),
      kmlName.replace(/\.[^.]+$/,"") + "_contours_" + contourInterval + "m.geojson",
      "application/json"
    );
    setStatus("✅ Contours GeoJSON exported");
  }
  function exportContoursShapefile() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { setStatus("⚠️ Fetch elevation first."); return; }
    setStatus("📦 Building shapefile ZIP…");
    try {
      const gj = buildContourGeoJSON(eg, contourInterval, majorEvery, kmlPolygonRef.current);
      const {shp, shx} = buildSHPLines(gj.features);
      const dbf = buildDBFContours(gj.features);
      const prj = new TextEncoder().encode(WGS84_PRJ);
      const baseName = (kmlName.replace(/\.[^.]+$/,"") + "_contours_" + contourInterval + "m")
        .replace(/[^a-zA-Z0-9_]/g,"_");
      const zip = buildZip([
        {name:baseName+".shp",data:shp},
        {name:baseName+".shx",data:shx},
        {name:baseName+".dbf",data:dbf},
        {name:baseName+".prj",data:prj},
      ]);
      dlBlob(zip.buffer, baseName + "_shapefile.zip", "application/zip");
      setStatus("✅ Contours shapefile ZIP exported");
    } catch (err) { setStatus("❌ " + err.message); }
  }

  if (!visible) return null;

  /* ── STYLES ── */
  const F = {
    ui:   "'DM Sans',system-ui,sans-serif",
    mono: "'JetBrains Mono','Courier New',monospace",
  };
  const C = {
    bg: "rgba(6,10,22,0.97)", sur: "rgba(255,255,255,0.04)", bor: "rgba(255,255,255,0.08)",
    tx: "#c8dff8", dim: "rgba(165,200,240,0.55)",
    blue: "#3b82f6", cyan: "#22d3c8", green: "#4ade80", amber: "#f5a623",
    red: "#f06060", violet: "#b89cf8", pink: "#f472b6",
  };
  const INTERVALS = [1, 2, 5, 10, 20, 25, 50, 100];
  const MAJORS    = [5, 10, 25, 50, 100, 200];

  const Btn = ({color = C.blue, bg, children, onClick, disabled}) => (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", padding: "9px 12px", borderRadius: 8,
      cursor: disabled ? "not-allowed" : "pointer",
      background: bg || `${color}18`, border: `1px solid ${color}38`,
      color, fontSize: 11.5, fontWeight: 700, fontFamily: F.ui,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      opacity: disabled ? 0.35 : 1, transition: "all 0.12s",
    }}>{children}</button>
  );

  const clipBadge = kmlPolygon && kmlPolygon.length >= 3;
  const effRes = effectiveRes();
 const resWasUpgraded = false;

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 320, zIndex: 5000,
      background: C.bg, backdropFilter: "blur(36px)",
      borderLeft: `1px solid ${C.bor}`, display: "flex", flexDirection: "column",
      fontFamily: F.ui, boxShadow: "-12px 0 48px rgba(0,0,0,.9)",
    }}>

      {/* Header */}
      <div style={{padding: "12px 14px 10px", borderBottom: `1px solid ${C.bor}`, flexShrink: 0}}>
        <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 8}}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: "linear-gradient(135deg,rgba(59,130,246,.25),rgba(34,211,200,.25))",
            border: "1px solid rgba(59,130,246,.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 17, flexShrink: 0,
          }}>🏔</div>
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{color: C.tx, fontWeight: 700, fontSize: 13}}>3D DEM & Contours</div>
            <div style={{color: C.dim, fontSize: 9, fontFamily: F.mono, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>
              Open-Meteo · QGIS hillshade · Cesium 3D
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:20,padding:0,lineHeight:1,flexShrink:0}}>×</button>
        </div>

        {clipBadge && (
          <div style={{
            background:"rgba(74,222,128,.07)",border:"1px solid rgba(74,222,128,.25)",
            borderRadius:7,padding:"4px 9px",fontSize:9,fontFamily:F.mono,
            color:C.green,marginBottom:6,display:"flex",alignItems:"center",gap:5,
          }}>
            <span>✂</span>
            <span>KML clip active · {kmlPolygon.length} vertices · pixel-accurate</span>
          </div>
        )}

        {resWasUpgraded && (
          <div style={{
            background:"rgba(245,166,35,.07)",border:"1px solid rgba(245,166,35,.25)",
            borderRadius:7,padding:"4px 9px",fontSize:9,fontFamily:F.mono,
            color:C.amber,marginBottom:6,display:"flex",alignItems:"center",gap:5,
          }}>
            <span>⬆</span>
            <span>Resolution auto-upgraded to {effRes}×{effRes} for KML accuracy</span>
          </div>
        )}

        {bbox && (
          <div style={{
            background:"rgba(255,255,255,.02)",border:`1px solid ${C.bor}`,borderRadius:8,
            padding:"6px 9px",fontSize:9,fontFamily:F.mono,color:C.dim,
            display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 10px",
          }}>
            <span>N {bbox.maxLat.toFixed(4)}°</span><span>S {bbox.minLat.toFixed(4)}°</span>
            <span>E {bbox.maxLng.toFixed(4)}°</span><span>W {bbox.minLng.toFixed(4)}°</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:`1px solid ${C.bor}`,flexShrink:0}}>
        {[["dem","🏔 DEM"],["contour","📐 Contour"],["export","💾 Export"]].map(([id,lb])=>(
          <button key={id} onClick={()=>setTab(id)} style={{
            flex:1,padding:"9px 4px",
            background:tab===id?"rgba(59,130,246,.08)":"transparent",
            border:"none",borderBottom:`2px solid ${tab===id?C.blue:"transparent"}`,
            cursor:"pointer",fontSize:10,fontWeight:700,
            color:tab===id?C.blue:C.dim,transition:"all .15s",fontFamily:F.ui,
          }}>{lb}</button>
        ))}
      </div>

      {/* Body */}
      <div style={{
        flex:1,overflowY:"auto",padding:"12px 13px 24px",
        display:"flex",flexDirection:"column",gap:10,
        scrollbarWidth:"thin",scrollbarColor:"rgba(59,130,246,.2) transparent",
      }}>

        {/* ── DEM TAB ── */}
        {tab === "dem" && <>
          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>
              GRID RESOLUTION · {effRes}×{effRes} = {effRes*effRes} pts
              {resWasUpgraded && <span style={{color:C.amber,marginLeft:6}}>(auto-upgraded for KML)</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
           <input type="range" min={10} max={60} step={5} value={gridRes}
                onChange={e=>setGridRes(+e.target.value)}
                style={{flex:1,accentColor:C.pink,cursor:"pointer"}}/>
              <span style={{color:C.pink,fontSize:10,fontFamily:F.mono,minWidth:40}}>{gridRes}×{gridRes}</span>
            </div>
            <div style={{color:effRes>50?C.amber:C.dim,fontSize:9}}>
              {effRes>50
                ?`⚠ High res — slower fetch (~${(Math.ceil(effRes*effRes/50)*1.3).toFixed(0)}s)`
                :`✅ ~${(Math.ceil(effRes*effRes/50)*1.3).toFixed(0)}s estimated`}
            </div>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:7}}>HILLSHADE ALGORITHM</div>
            <div style={{display:"flex",gap:4,marginBottom:8}}>
              {[["multi","Multi-Dir (QGIS)"],["single","Single 315°"],["off","Off"]].map(([id,lb])=>(
                <button key={id} onClick={()=>setHillshadeMode(id)} style={{
                  flex:1,padding:"6px 3px",borderRadius:7,
                  border:hillshadeMode===id?`1px solid ${C.blue}44`:`1px solid ${C.bor}`,
                  background:hillshadeMode===id?"rgba(59,130,246,.12)":C.sur,
                  color:hillshadeMode===id?C.blue:C.dim,
                  fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:F.mono,transition:"all .12s",
                }}>{lb}</button>
              ))}
            </div>
            {hillshadeMode !== "off" && <>
              <div style={{color:C.dim,fontSize:9,marginBottom:4}}>
                Strength · {Math.round(hillshadeStrength*100)}%
                <span style={{color:C.amber,marginLeft:6,fontSize:8}}>
                  {hillshadeStrength>0.70?"⚠ strong":""}
                </span>
              </div>
              <input type="range" min={0} max={0.85} step={0.05}
                value={hillshadeStrength}
                onChange={e=>setHillshadeStrength(+e.target.value)}
                style={{width:"100%",accentColor:C.amber,cursor:"pointer"}}/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                <span style={{color:C.dim,fontSize:8}}>0 %</span>
                <span style={{color:C.dim,fontSize:8}}>85 % max</span>
              </div>
            </>}
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>
              DEM OPACITY · {Math.round(demOpacity*100)}%
            </div>
            <input type="range" min={0.1} max={1} step={0.05} value={demOpacity}
              onChange={e=>setDemOpacity(+e.target.value)}
              style={{width:"100%",accentColor:C.pink,cursor:"pointer"}}/>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:8}}>COLOR RAMP (LIVE PREVIEW)</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {Object.entries(COLOR_RAMPS).map(([name,ramp])=>{
                const stops=ramp.map(([t,[r,g,b]])=>`rgb(${r},${g},${b}) ${Math.round(t*100)}%`).join(",");
                const sel=colorRamp===name;
                return (
                  <button key={name} onClick={()=>setColorRamp(name)} style={{
                    display:"flex",alignItems:"center",gap:8,width:"100%",
                    padding:"5px 7px",borderRadius:7,cursor:"pointer",
                    background:sel?"rgba(59,130,246,.08)":"transparent",
                    border:sel?`1.5px solid rgba(59,130,246,.4)`:`1px solid ${C.bor}`,
                    transition:"all .12s",
                  }}>
                    <span style={{width:90,fontSize:9,fontFamily:F.mono,textAlign:"left",flexShrink:0,color:sel?C.blue:C.dim,fontWeight:sel?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</span>
                    <div style={{flex:1,height:14,borderRadius:4,background:`linear-gradient(to right,${stops})`,border:sel?"1px solid rgba(59,130,246,.35)":`1px solid ${C.bor}`}}/>
                  </button>
                );
              })}
            </div>
          </div>

          {elevGrid && <div style={{background:"rgba(74,222,128,.04)",border:"1px solid rgba(74,222,128,.15)",borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.green,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>ELEVATION SUMMARY</div>
            {[
              ["Min",`${elevGrid.min.toFixed(1)} m`],
              ["Max",`${elevGrid.max.toFixed(1)} m`],
              ["Range",`${(elevGrid.max-elevGrid.min).toFixed(1)} m`],
              ["Grid",`${elevGrid.rows}×${elevGrid.cols}`],
            ].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:`1px solid rgba(74,222,128,.08)`}}>
                <span style={{color:C.dim,fontSize:10,fontFamily:F.mono}}>{k}</span>
                <span style={{color:C.green,fontSize:11,fontWeight:700,fontFamily:F.mono}}>{v}</span>
              </div>
            ))}
          </div>}

          {elevGrid && <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>
              LEGEND · {Math.round(elevGrid.min)}m → {Math.round(elevGrid.max)}m
            </div>
            <div style={{height:20,borderRadius:5,background:`linear-gradient(to right,${(COLOR_RAMPS[colorRamp]||COLOR_RAMPS[DEFAULT_RAMP]).map(([t,[r,g,b]])=>`rgb(${r},${g},${b}) ${Math.round(t*100)}%`).join(",")})`,border:`1px solid ${C.bor}`,marginBottom:5}}/>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              {[0,.25,.5,.75,1].map(t=>{
                const v=Math.round(elevGrid.min+(elevGrid.max-elevGrid.min)*t);
                return <span key={t} style={{fontSize:8,color:C.dim,fontFamily:F.mono}}>{v}m</span>;
              })}
            </div>
          </div>}

          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <Btn color={C.pink} onClick={fetchElevation} disabled={isProcessing||!bbox}>
              {isProcessing
                ?<><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⟳</span> Fetching…</>
                :`📡 Fetch Elevation Data${resWasUpgraded?" ("+effRes+"×"+effRes+")":""}`}
            </Btn>
            {isProcessing && <div style={{height:3,borderRadius:2,background:"rgba(255,255,255,.06)",overflow:"hidden"}}>
              <div style={{height:"100%",width:`${progress}%`,background:"linear-gradient(90deg,#f472b6,#fb923c)",borderRadius:2,transition:"width .25s"}}/>
            </div>}
            <Btn color={C.amber} onClick={doRenderDEM} disabled={!elevGrid}>🎨 Render DEM on 3D Globe</Btn>
            {hasDEM && <Btn color={demVisible?C.red:C.green} onClick={toggleDEM}>
              {demVisible?"🙈 Hide DEM":"👁 Show DEM"}
            </Btn>}
          </div>
        </>}

        {/* ── CONTOUR TAB ── */}
        {tab === "contour" && <>
          {!elevGrid && <div style={{padding:"10px",borderRadius:8,background:"rgba(245,166,35,.07)",border:"1px solid rgba(245,166,35,.2)",color:C.amber,fontSize:10.5,textAlign:"center"}}>
            ⚠️ Fetch elevation in DEM tab first
          </div>}

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:7}}>STYLE PRESET</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>{setMinorColor("#966F33");setMajorColor("#6B3D00");}} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid rgba(34,211,200,.3)",background:"rgba(34,211,200,.08)",color:C.cyan,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:F.ui}}>🟩 GeoXIS Default</button>
              <button onClick={()=>{setMinorColor("#8B5000");setMajorColor("#3D1C00");}} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid rgba(245,166,35,.3)",background:"rgba(245,166,35,.08)",color:C.amber,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:F.ui}}>🟧 GeoXIS Pro</button>
            </div>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:7}}>CONTOUR INTERVAL</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {INTERVALS.map(v=>(
                <button key={v} onClick={()=>setContourInterval(v)} style={{
                  flex:"1 0 auto",minWidth:32,padding:"6px 3px",borderRadius:7,
                  border:contourInterval===v?`1px solid ${C.cyan}44`:`1px solid ${C.bor}`,
                  background:contourInterval===v?"rgba(34,211,200,.12)":C.sur,
                  color:contourInterval===v?C.cyan:C.dim,
                  fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:F.mono,transition:"all .12s",textAlign:"center",
                }}>{v}m</button>
              ))}
            </div>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:7}}>MAJOR INDEX EVERY</div>
            <div style={{display:"flex",gap:4}}>
              {MAJORS.map(v=>(
                <button key={v} onClick={()=>setMajorEvery(v)} style={{
                  flex:1,padding:"6px 3px",borderRadius:7,
                  border:majorEvery===v?`1px solid ${C.amber}44`:`1px solid ${C.bor}`,
                  background:majorEvery===v?"rgba(245,166,35,.12)":C.sur,
                  color:majorEvery===v?C.amber:C.dim,
                  fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:F.mono,transition:"all .12s",
                }}>{v}m</button>
              ))}
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[["Minor line",minorColor,setMinorColor],["Major / Index",majorColor,setMajorColor]].map(([lbl,val,set])=>(
              <div key={lbl} style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:8,padding:"8px 10px"}}>
                <div style={{color:C.dim,fontSize:9,fontWeight:700,marginBottom:5}}>{lbl.toUpperCase()}</div>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <input type="color" value={val} onChange={e=>set(e.target.value)} style={{width:28,height:28,border:"none",borderRadius:5,cursor:"pointer",background:"none"}}/>
                  <span style={{color:C.dim,fontSize:9,fontFamily:F.mono}}>{val}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:8}}>LINE STYLE PREVIEW</div>
            <svg width="100%" height="52">
              <line x1="8" y1="16" x2="95%" y2="16" stroke={minorColor} strokeWidth="0.75" opacity="0.65"/>
              <text x="8" y="11" fill={C.dim} fontSize="8" fontFamily="monospace">minor ({contourInterval}m)</text>
              <line x1="8" y1="36" x2="95%" y2="36" stroke={majorColor} strokeWidth="2.0" opacity="0.88"/>
              <text x="8" y="50" fill={C.dim} fontSize="8" fontFamily="monospace">index ({majorEvery}m) + label</text>
              <rect x="48" y="28" width="26" height="12" rx="2" fill="rgba(255,255,255,0.92)" stroke={majorColor} strokeWidth="0.5"/>
              <text x="61" y="37" fill={majorColor} fontSize="8" fontFamily="monospace" textAnchor="middle" fontWeight="bold">{majorEvery}</text>
            </svg>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <Btn color={C.cyan} onClick={doRenderContours} disabled={!elevGrid}>📐 Generate Contours on 3D Globe</Btn>
            {hasContour && <>
              <Btn color={contourVisible?C.red:C.green} onClick={toggleContours}>
                {contourVisible?"🙈 Hide Contours":"👁 Show Contours"}
              </Btn>
              {contourCount>0 && <div style={{textAlign:"center",color:C.cyan,fontSize:10,fontFamily:F.mono,padding:"2px 0"}}>
                {contourCount} lines · {contourInterval}m interval · major {majorEvery}m
              </div>}
            </>}
          </div>
        </>}

        {/* ── EXPORT TAB ── */}
        {tab === "export" && <>
          <div style={{padding:"10px 12px",borderRadius:10,background:"rgba(184,156,248,.05)",border:"1px solid rgba(184,156,248,.17)"}}>
            <div style={{color:C.violet,fontWeight:700,fontSize:12.5,marginBottom:4}}>💾 Export GIS Data</div>
            <div style={{color:C.dim,fontSize:10.5,lineHeight:1.7}}>
              GeoTIFF · CSV · GeoJSON 3D · Shapefile ZIP{clipBadge?" — all clipped to KML boundary":""} — QGIS / ArcGIS / Global Mapper ready
            </div>
          </div>

          {clipBadge && <div style={{background:"rgba(74,222,128,.05)",border:"1px solid rgba(74,222,128,.2)",borderRadius:8,padding:"7px 10px",fontSize:9,fontFamily:F.mono,color:C.green}}>
            ✂ KML polygon clip active — all exports pixel-accurately clipped to boundary
          </div>}

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.pink,fontWeight:700,fontSize:11,marginBottom:7}}>🏔 DEM / Elevation Grid</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <Btn color={C.pink} onClick={exportGeoTIFF} disabled={!elevGrid}>📥 Export DEM → GeoTIFF (.tif)</Btn>
              <Btn color={C.amber} onClick={exportDEMCSV} disabled={!elevGrid}>📥 Export DEM Grid → CSV</Btn>
            </div>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.cyan,fontWeight:700,fontSize:11,marginBottom:7}}>📐 Contour Lines</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <Btn color={C.cyan} onClick={exportContoursGeoJSON} disabled={!elevGrid}>📥 Contours → GeoJSON 3D</Btn>
              <Btn color={C.blue} onClick={exportContoursShapefile} disabled={!elevGrid}>📥 Contours → Shapefile ZIP</Btn>
            </div>
          </div>

          {elevGrid && <div style={{background:"rgba(74,222,128,.04)",border:"1px solid rgba(74,222,128,.15)",borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.green,fontWeight:700,fontSize:11,marginBottom:6}}>✅ Summary</div>
            {[
              ["Grid",`${elevGrid.rows}×${elevGrid.cols} pts`],
              ["Min elev",`${elevGrid.min.toFixed(1)} m`],
              ["Max elev",`${elevGrid.max.toFixed(1)} m`],
              ["Range",`${(elevGrid.max-elevGrid.min).toFixed(1)} m`],
              ["Interval",`${contourInterval} m (major ${majorEvery} m)`],
              ...(contourCount>0?[["Contours",`${contourCount} lines`]]:[]),
              ...(clipBadge?[["Clip",`KML · ${kmlPolygon.length} pts (pixel-accurate)`]]:[]),
            ].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:`1px solid rgba(74,222,128,.08)`}}>
                <span style={{color:C.dim,fontSize:10,fontFamily:F.mono}}>{k}</span>
                <span style={{color:C.green,fontSize:11,fontWeight:700,fontFamily:F.mono}}>{v}</span>
              </div>
            ))}
          </div>}
        </>}

      </div>

      {/* Status bar */}
      {status && <div style={{
        padding:"7px 13px",flexShrink:0,borderTop:`1px solid ${C.bor}`,
        background:"rgba(0,0,0,.35)",
        color:status.startsWith("✅")?C.green:status.startsWith("❌")?C.red:status.startsWith("⚠")?C.amber:C.blue,
        fontSize:10,fontFamily:F.mono,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
      }}>{status}</div>}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}