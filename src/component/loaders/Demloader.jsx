/**
 * DEMLoader.jsx — QGIS/ArcGIS-quality 2D DEM overlay for SurveyMap Pro v6.1
 *
 * FIXES IN v6.1 (on top of v6.0):
 *   ✅ FIX 1 (CRITICAL): Cell-size normalization in slope calc.
 *      dzdx/dzdy were divided only by 8, ignoring the real-world pixel
 *      size in metres. On high-res DEMs this made slopes near-zero →
 *      hillshade ≈ 0.5 everywhere → no visible shading at all.
 *      Fix: divide by (8 × cellSize_m).
 *
 *   ✅ FIX 2 (CRITICAL): CSS mix-blend-mode: multiply on the canvas.
 *      Without a blend mode the DEM is just a semi-transparent rectangle
 *      pasted on top of the satellite layer.  "multiply" makes shadows
 *      darken the satellite image beneath — exactly what QGIS "Combined"
 *      renderer does.  Changed image-rendering to "auto" (bilinear) at
 *      the same time.
 *
 *   ✅ FIX 3: Bilinear upscaling (image-rendering: auto).
 *      "pixelated" caused blocky aliased squares when the DEM had lower
 *      resolution than the screen.
 *
 *   ✅ FIX 4: Wider percentile stretch (1–99 instead of 2–98).
 *      On terrain with a narrow elevation range most pixels were mapped
 *      to the same green band.  1–99 % gives a little more headroom.
 *
 *   All previous v6.0 fixes (multidirectional hillshade, QGIS ramps,
 *   Soft Light blend, gamma, desaturation) are unchanged.
 *
 * Dependencies: npm install geotiff proj4
 */

import { useEffect, useRef, useCallback } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/* ─── Colour ramps ─────────────────────────────────────────────────────── */
export const COLOR_RAMPS = {
  "QGIS Default": [
    [0.00, [ 26, 102,  26]],
    [0.14, [ 78, 148,  52]],
    [0.28, [160, 195,  80]],
    [0.43, [230, 230, 128]],
    [0.57, [209, 187, 130]],
    [0.71, [168, 128,  80]],
    [0.85, [148, 120, 102]],
    [1.00, [255, 255, 255]],
  ],
  "ArcGIS Terrain": [
    [0.00, [ 50, 135,  68]],
    [0.12, [ 90, 165,  90]],
    [0.25, [170, 200, 100]],
    [0.38, [220, 215, 140]],
    [0.50, [200, 185, 130]],
    [0.62, [175, 145,  95]],
    [0.75, [150, 110,  70]],
    [0.87, [165, 140, 120]],
    [1.00, [240, 240, 240]],
  ],
  "AlpineQuest": [
    [0.00, [ 32, 120, 180]],
    [0.05, [ 55, 165, 130]],
    [0.15, [ 85, 195,  85]],
    [0.28, [165, 215,  75]],
    [0.42, [230, 210,  85]],
    [0.55, [215, 165,  65]],
    [0.68, [185, 108,  50]],
    [0.80, [152,  72,  42]],
    [0.90, [138,  88,  78]],
    [1.00, [238, 238, 238]],
  ],
  "Viridis": [
    [0,    [68,   1,  84]],
    [0.25, [59,  82, 139]],
    [0.5,  [33, 145, 140]],
    [0.75, [94, 201,  97]],
    [1,    [253, 231,  37]],
  ],
  "Magma": [
    [0,    [  0,   0,   3]],
    [0.25, [ 80,  18,  66]],
    [0.5,  [182,  54,  59]],
    [0.75, [251, 136,  97]],
    [1,    [252, 253, 191]],
  ],
  "Plasma": [
    [0,    [ 13,   8, 135]],
    [0.25, [126,   3, 167]],
    [0.5,  [203,  70, 121]],
    [0.75, [248, 149,  64]],
    [1,    [240, 249,  33]],
  ],
  "Inferno": [
    [0,    [  0,   0,   3]],
    [0.25, [ 66,  10, 104]],
    [0.5,  [182,  54,  19]],
    [0.75, [251, 161,  62]],
    [1,    [252, 255, 164]],
  ],
  "RdYlGn": [
    [0,    [215,  25,  28]],
    [0.25, [253, 174,  97]],
    [0.5,  [255, 255, 191]],
    [0.75, [145, 207, 104]],
    [1,    [ 26, 150,  65]],
  ],
  "Terrain": [
    [0,   [ 46, 154,  88]],
    [0.2, [100, 185, 100]],
    [0.4, [220, 210, 140]],
    [0.6, [185, 140,  80]],
    [0.8, [155, 110,  75]],
    [1,   [255, 255, 255]],
  ],
  "Greys": [
    [0, [20,  20,  20]],
    [1, [255, 255, 255]],
  ],
  "Hot": [
    [0,    [  0,   0,   0]],
    [0.33, [255,   0,   0]],
    [0.66, [255, 255,   0]],
    [1,    [255, 255, 255]],
  ],
  "Cool-Warm": [
    [0,   [ 59,  76, 192]],
    [0.5, [220, 220, 220]],
    [1,   [180,   4,  38]],
  ],
};

/* ─── Helpers ─────────────────────────────────────────────────────────── */
function lerp(a, b, t) { return a + (b - a) * t; }

function sampleRamp(ramp, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < ramp.length; i++) {
    const [t0, c0] = ramp[i - 1];
    const [t1, c1] = ramp[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(lerp(c0[0], c1[0], f)),
        Math.round(lerp(c0[1], c1[1], f)),
        Math.round(lerp(c0[2], c1[2], f)),
      ];
    }
  }
  return ramp[ramp.length - 1][1];
}

function geoBoundsToLeaflet(west, south, east, north) {
  return L.latLngBounds([south, west], [north, east]);
}

/* ─── Percentile contrast stretch ────────────────────────────────────── */
// FIX 4: Widened to 1–99 % so narrow-range DEMs use the full colour ramp.
function percentileStretch(data, loFrac = 0.01, hiFrac = 0.99) {
  const valid = [];
  for (let i = 0; i < data.length; i++) {
    if (!isNaN(data[i])) valid.push(data[i]);
  }
  if (valid.length === 0) return { lo: 0, hi: 1 };
  valid.sort((a, b) => a - b);
  const lo = valid[Math.floor(valid.length * loFrac)];
  const hi = valid[Math.floor(valid.length * hiFrac)];
  if (lo === hi) return { lo: valid[0], hi: valid[valid.length - 1] };
  return { lo, hi };
}

/* ─── Single-direction hillshade ────────────────────────────────────── */
// FIX 1: Added cellSize_m parameter.  Dividing by (8 × cellSize_m) turns
// the Sobel differences from raw elevation units into a proper slope
// (rise/run) so hillshade values span 0→1 even on high-resolution DEMs.
function hillshadeFromAzimuth(data, width, height, azimuth, altitude, cellSize_m = 30) {
  const result  = new Float32Array(width * height);
  const azRad   = ((360 - azimuth + 90) / 180) * Math.PI;
  const altRad  = (altitude / 180) * Math.PI;
  const zenRad  = Math.PI / 2 - altRad;
  const scale   = 8 * Math.max(cellSize_m, 0.1); // ← FIX 1 key line

  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const idx = row * width + col;
      if (isNaN(data[idx])) { result[idx] = NaN; continue; }

      const c    = data[idx];
      const safe = v => (isNaN(v) ? c : v);

      const nw = safe(data[(row-1)*width+(col-1)]);
      const n  = safe(data[(row-1)*width+ col   ]);
      const ne = safe(data[(row-1)*width+(col+1)]);
      const w  = safe(data[ row   *width+(col-1)]);
      const e  = safe(data[ row   *width+(col+1)]);
      const sw = safe(data[(row+1)*width+(col-1)]);
      const s  = safe(data[(row+1)*width+ col   ]);
      const se = safe(data[(row+1)*width+(col+1)]);

      // FIX 1: use `scale` instead of plain `8`
      const dzdx   = ((ne + 2*e + se) - (nw + 2*w + sw)) / scale;
      const dzdy   = ((sw + 2*s + se) - (nw + 2*n + ne)) / scale;
      const slope  = Math.atan(Math.sqrt(dzdx*dzdx + dzdy*dzdy));
      const aspect = Math.atan2(-dzdy, dzdx);

      result[idx] = Math.max(0,
        Math.cos(zenRad) * Math.cos(slope) +
        Math.sin(zenRad) * Math.sin(slope) * Math.cos(azRad - aspect)
      );
    }
  }

  // Fill 1-pixel border
  for (let c = 0; c < width; c++) {
    result[c]                    = result[width + c];
    result[(height-1)*width + c] = result[(height-2)*width + c];
  }
  for (let r = 0; r < height; r++) {
    result[r*width]              = result[r*width + 1];
    result[r*width + width - 1]  = result[r*width + width - 2];
  }
  return result;
}

/**
 * MULTIDIRECTIONAL hillshade — matches ArcGIS Pro "Multidirectional" and
 * QGIS "Multi-directional" hillshade.
 * FIX 1: cellSize_m is now forwarded to hillshadeFromAzimuth.
 */
function computeMultidirectionalHillshade(
  data, width, height, altitude = 45,
  west = 0, east = 1               // ← FIX 1: added geographic extent
) {
  // Approximate cell size in metres (longitude degrees → metres at mid-lat).
  // We don't have the actual lat here, so we use a conservative 111,320 m/°.
  const cellSize_m = ((east - west) / Math.max(width, 1)) * 111320;

  const directions = [
    { az: 315, weight: 0.5  },
    { az:  45, weight: 0.25 },
    { az: 225, weight: 0.15 },
    { az: 135, weight: 0.10 },
  ];

  const combined = new Float32Array(width * height);
  combined.fill(0);

  const isNodataPixel = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    if (isNaN(data[i])) isNodataPixel[i] = 1;
  }

  for (const { az, weight } of directions) {
    // FIX 1: pass cellSize_m
    const hs = hillshadeFromAzimuth(data, width, height, az, altitude, cellSize_m);
    for (let i = 0; i < combined.length; i++) {
      if (!isNodataPixel[i] && !isNaN(hs[i])) {
        combined[i] += hs[i] * weight;
      }
    }
  }

  for (let i = 0; i < data.length; i++) {
    if (isNodataPixel[i]) combined[i] = NaN;
  }

  return combined;
}

/* ─── RGB ↔ HSL helpers ────────────────────────────────────────────── */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6;               break;
      case b: h = ((r - g) / d + 4) / 6;               break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1/3) * 255),
    Math.round(hue2rgb(h)       * 255),
    Math.round(hue2rgb(h - 1/3) * 255),
  ];
}

/* ─── Extract rings from any mask format ──────────────────────────── */
export function extractRings(mask) {
  if (!mask) return [];
  if (Array.isArray(mask)) {
    if (mask.length === 0) return [];
    const first = mask[0];
    if (first && first.lat !== undefined)
      return [mask.map(ll => [ll.lng, ll.lat])];
    if (Array.isArray(first) && first.length > 0 && first[0] && first[0].lat !== undefined)
      return mask.map(ring => ring.map(ll => [ll.lng, ll.lat]));
    if (Array.isArray(first) && first.length === 2 && typeof first[0] === "number")
      return [mask];
  }
  if (mask.type === "Feature")           return extractRings(mask.geometry);
  if (mask.type === "FeatureCollection") return mask.features.flatMap(f => extractRings(f));
  if (mask.type === "Polygon")           return mask.coordinates;
  if (mask.type === "MultiPolygon")      return mask.coordinates.flatMap(poly => poly);
  return [];
}

/* ─── Apply canvas clip path from rings ──────────────────────────── */
function applyClipPath(ctx, rings, map, topLeft) {
  if (!rings || rings.length === 0) return false;
  ctx.beginPath();
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    ring.forEach(([lng, lat], i) => {
      const pt = map.latLngToLayerPoint(L.latLng(lat, lng));
      const x  = pt.x - topLeft.x;
      const y  = pt.y - topLeft.y;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.clip("evenodd");
  return true;
}

/* ─── ASC / .dem parser ───────────────────────────────────────────── */
async function parseASC(buffer) {
  const text  = new TextDecoder().decode(buffer);
  const lines = text.trim().split(/\r?\n/);
  const header = {};
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length === 2 && isNaN(Number(parts[0]))) {
      header[parts[0].toLowerCase()] = Number(parts[1]);
      dataStart = i + 1;
    } else break;
  }
  const ncols     = header.ncols     || header.NCOLS;
  const nrows     = header.nrows     || header.NROWS;
  const xllcorner = header.xllcorner ?? header.xllcenter ?? 0;
  const yllcorner = header.yllcorner ?? header.yllcenter ?? 0;
  const cellsize  = header.cellsize  ?? 1;
  const nodata    = header.nodata_value ?? -9999;
  const data      = new Float32Array(ncols * nrows);
  let row = 0;
  for (let i = dataStart; i < lines.length && row < nrows; i++) {
    const vals = lines[i].trim().split(/\s+/);
    for (let col = 0; col < vals.length && col < ncols; col++) {
      const v = Number(vals[col]);
      data[row * ncols + col] = (v === nodata) ? NaN : v;
    }
    row++;
  }
  return {
    data, width: ncols, height: nrows,
    west: xllcorner, south: yllcorner,
    east: xllcorner + ncols * cellsize,
    north: yllcorner + nrows * cellsize,
  };
}

/* ─── GeoTIFF parser ─────────────────────────────────────────────── */
async function parseGeoTIFF(buffer) {
  const GeoTIFF = await import("geotiff").catch(() => null);
  if (!GeoTIFF) throw new Error("geotiff not installed. Run: npm install geotiff");

  const tiff    = await GeoTIFF.fromArrayBuffer(buffer);
  const image   = await tiff.getImage();
  const bbox    = image.getBoundingBox();
  const width   = image.getWidth();
  const height  = image.getHeight();
  const rasters = await image.readRasters({ interleave: true });
  const data    = new Float32Array(width * height);

  const gdalNodata = image.fileDirectory.GDAL_NODATA
    ? Number(image.fileDirectory.GDAL_NODATA)
    : null;

  const isNodata = v => {
    if (isNaN(v))                                return true;
    if (gdalNodata !== null && v === gdalNodata) return true;
    if (v === -32767 || v === -32768)            return true;
    if (v === -9999)                             return true;
    return false;
  };

  for (let i = 0; i < data.length; i++) {
    data[i] = isNodata(rasters[i]) ? NaN : rasters[i];
  }

  let [west, south, east, north] = bbox;
  const isProjected = Math.abs(west) > 360 || Math.abs(north) > 90;

  if (isProjected) {
    const proj4mod = await import("proj4").catch(() => null);
    if (proj4mod) {
      const proj4 = proj4mod.default || proj4mod;
      let reprojected = false;
      for (const zone of [44, 45, 43, 46]) {
        const utmProj = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
        try {
          const sw = proj4(utmProj, "WGS84", [west,  south]);
          const ne = proj4(utmProj, "WGS84", [east,  north]);
          if (
            sw[0] >= -180 && sw[0] <= 180 && sw[1] >= -90 && sw[1] <= 90 &&
            ne[0] >= -180 && ne[0] <= 180 && ne[1] >= -90 && ne[1] <= 90
          ) {
            west = sw[0]; south = sw[1]; east = ne[0]; north = ne[1];
            reprojected = true;
            break;
          }
        } catch (_) { /* try next zone */ }
      }
      if (!reprojected) console.warn("DEMLoader: Could not reproject GeoTIFF.");
    } else {
      console.warn("DEMLoader: proj4 not installed. Run: npm install proj4.");
    }
  }

  return { data, width, height, west, south, east, north };
}

/* ─── MAIN RENDERER ──────────────────────────────────────────────────
 * Pipeline (mirrors QGIS "Combined" renderer):
 *   1. Sample colour ramp at percentile-stretched elevation → base colour
 *   2. Slight desaturation → prevents oversaturation after blending
 *   3. Gamma-correct hillshade → softer shadows
 *   4. Soft Light blend (W3C) → natural lit/shadow effect
 *   5. Mix blended vs original at hillshadeBlend strength
 * ─────────────────────────────────────────────────────────────────── */
function renderToImageData(
  data, width, height, ramp,
  stretchLo, stretchHi, opacity,
  hillshade      = null,
  hillshadeBlend = 0.75,
  hillshadeGamma = 1.2,
  desaturate     = 0.15,
) {
  const range  = stretchHi - stretchLo || 1;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const v = data[i];
    if (isNaN(v)) { pixels[i * 4 + 3] = 0; continue; }

    const t   = (v - stretchLo) / range;
    let [r, g, b] = sampleRamp(ramp, t);

    if (desaturate > 0) {
      const [h, s, l] = rgbToHsl(r, g, b);
      [r, g, b] = hslToRgb(h, s * (1 - desaturate), l);
    }

    if (hillshade !== null && !isNaN(hillshade[i])) {
      const hsGamma = Math.pow(hillshade[i], 1 / hillshadeGamma);

      const softLight = (chan, hs) => {
        const c = chan / 255;
        let result;
        if (hs <= 0.5) {
          result = c - (1 - 2 * hs) * c * (1 - c);
        } else {
          const D = c <= 0.25
            ? ((16 * c - 12) * c + 4) * c
            : Math.sqrt(c);
          result = c + (2 * hs - 1) * (D - c);
        }
        return Math.min(255, Math.max(0, Math.round(result * 255)));
      };

      const blendR = softLight(r, hsGamma);
      const blendG = softLight(g, hsGamma);
      const blendB = softLight(b, hsGamma);

      r = Math.round(r * (1 - hillshadeBlend) + blendR * hillshadeBlend);
      g = Math.round(g * (1 - hillshadeBlend) + blendG * hillshadeBlend);
      b = Math.round(b * (1 - hillshadeBlend) + blendB * hillshadeBlend);
    }

    pixels[i * 4]     = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = Math.round(opacity * 255);
  }
  return new ImageData(pixels, width, height);
}

/* ─── Custom Leaflet Canvas Layer ─────────────────────────────────── */
const DEMCanvasLayer = L.Layer.extend({
  initialize(imageData, bounds, options) {
    this._imageData = imageData;
    this._bounds    = bounds;
    L.setOptions(this, options);
  },

  onAdd(map) {
    this._map    = map;
    this._canvas = document.createElement("canvas");
    // FIX 2: mix-blend-mode multiply → DEM shadows composite against
    // the satellite tile layer below instead of sitting on top opaquely.
    // FIX 3: image-rendering auto → bilinear upscaling (no blocky pixels).
    this._canvas.style.cssText =
      "position:absolute;pointer-events:none;" +
      "image-rendering:auto;" +
      "mix-blend-mode:multiply;";
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on("moveend zoomend viewreset", this._update, this);
    this._ctx = this._canvas.getContext("2d");
    this._update();
  },

  onRemove(map) {
    map.off("moveend zoomend viewreset", this._update, this);
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx    = null;
  },

  updateImageData(imageData) {
    this._imageData = imageData;
    this._update();
  },

  setClipMask(rings) {
    this.options.clipRings = rings;
    this._update();
  },

  _update() {
    if (!this._map || !this._imageData || !this._canvas) return;

    const topLeft     = this._map.latLngToLayerPoint(this._bounds.getNorthWest());
    const bottomRight = this._map.latLngToLayerPoint(this._bounds.getSouthEast());
    const w = Math.round(bottomRight.x - topLeft.x);
    const h = Math.round(bottomRight.y - topLeft.y);
    if (w <= 0 || h <= 0) return;

    this._canvas.width  = w;
    this._canvas.height = h;
    this._canvas.style.left = topLeft.x + "px";
    this._canvas.style.top  = topLeft.y + "px";

    const off = document.createElement("canvas");
    off.width  = this._imageData.width;
    off.height = this._imageData.height;
    off.getContext("2d").putImageData(this._imageData, 0, 0);

    const ctx   = this._ctx;
    const rings = this.options.clipRings;
    ctx.clearRect(0, 0, w, h);

    if (rings && rings.length > 0) {
      ctx.save();
      applyClipPath(ctx, rings, this._map, topLeft);
      ctx.drawImage(off, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(off, 0, 0, w, h);
    }
  },
});

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════ */
export default function DEMLoader({
  file,
  opacity            = 0.75,
  colorRamp          = "QGIS Default",
  kmlMask            = null,
  hillshadeBlend     = 0.75,
  sunAltitude        = 45,
  hillshadeGamma     = 1.2,
  desaturate         = 0.15,
  onDone,
  onError,
  onStats,
}) {
  const map       = useMap();
  const layerRef  = useRef(null);
  const rasterRef = useRef(null);

  /* ── Re-render when visual props change ── */
  const reRender = useCallback(() => {
    const r = rasterRef.current;
    if (!r || !layerRef.current) return;
    const { data, width, height, stretchLo, stretchHi, hillshade } = r;
    const ramp = COLOR_RAMPS[colorRamp] || COLOR_RAMPS["QGIS Default"];
    const img  = renderToImageData(
      data, width, height, ramp,
      stretchLo, stretchHi, opacity,
      hillshade, hillshadeBlend, hillshadeGamma, desaturate,
    );
    layerRef.current.updateImageData(img);
  }, [opacity, colorRamp, hillshadeBlend, hillshadeGamma, desaturate]);

  useEffect(() => {
    if (rasterRef.current) reRender();
  }, [reRender]);

  /* ── Re-compute hillshade when sun altitude changes ── */
  useEffect(() => {
    const r = rasterRef.current;
    if (!r || !layerRef.current) return;
    // FIX 1: pass west/east so cell size is known
    const hillshade = computeMultidirectionalHillshade(
      r.data, r.width, r.height, sunAltitude, r.west, r.east
    );
    rasterRef.current = { ...r, hillshade };
    const ramp = COLOR_RAMPS[colorRamp] || COLOR_RAMPS["QGIS Default"];
    const img  = renderToImageData(
      r.data, r.width, r.height, ramp,
      r.stretchLo, r.stretchHi, opacity,
      hillshade, hillshadeBlend, hillshadeGamma, desaturate,
    );
    layerRef.current.updateImageData(img);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunAltitude]);

  /* ── Reactively update clip mask ── */
  useEffect(() => {
    if (!layerRef.current) return;
    const rings = extractRings(kmlMask);
    layerRef.current.setClipMask(rings);
  }, [kmlMask]);

  /* ── Remove layer on unmount ── */
  useEffect(() => {
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map]);

  /* ── Parse & load file ── */
  useEffect(() => {
    if (!file) {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
      rasterRef.current = null;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const buf    = await file.arrayBuffer();
        const name   = file.name.toLowerCase();
        const parsed = (name.endsWith(".asc") || name.endsWith(".dem"))
          ? await parseASC(buf)
          : await parseGeoTIFF(buf);

        if (cancelled) return;

        const { data, width, height, west, south, east, north } = parsed;

        let minVal = Infinity, maxVal = -Infinity, sum = 0, count = 0;
        for (let i = 0; i < data.length; i++) {
          if (!isNaN(data[i])) {
            if (data[i] < minVal) minVal = data[i];
            if (data[i] > maxVal) maxVal = data[i];
            sum += data[i]; count++;
          }
        }
        const meanVal = count ? sum / count : 0;

        // FIX 4: 1–99 % stretch
        const { lo: stretchLo, hi: stretchHi } = percentileStretch(data, 0.01, 0.99);

        // FIX 1: pass west/east for correct cell-size computation
        const hillshade = computeMultidirectionalHillshade(
          data, width, height, sunAltitude, west, east
        );

        rasterRef.current = {
          data, width, height,
          minVal, maxVal,
          stretchLo, stretchHi,
          hillshade,
          west, south, east, north,
        };

        const rasterPayload = { data, width, height, west, south, east, north, minVal, maxVal };
        onStats?.({ min: minVal, max: maxVal, mean: meanVal, width, height }, rasterPayload);

        const ramp   = COLOR_RAMPS[colorRamp] || COLOR_RAMPS["QGIS Default"];
        const img    = renderToImageData(
          data, width, height, ramp,
          stretchLo, stretchHi, opacity,
          hillshade, hillshadeBlend, hillshadeGamma, desaturate,
        );
        const bounds = geoBoundsToLeaflet(west, south, east, north);

        if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }

        const rings = extractRings(kmlMask);
        const layer = new DEMCanvasLayer(img, bounds, { clipRings: rings });
        layer.addTo(map);
        layerRef.current = layer;

        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 14 });
        onDone?.();
      } catch (err) {
        if (!cancelled) onError?.(err.message || String(err));
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  return null;
}

/* ─── Utility: sample elevation at lat/lng from raster ──────────── */
export function sampleElevationAt(rasterState, lat, lng) {
  if (!rasterState) return null;
  const { data, width, height, west, south, east, north } = rasterState;
  const col = Math.round(((lng - west)  / (east  - west))  * (width  - 1));
  const row = Math.round(((north - lat) / (north - south)) * (height - 1));
  if (col < 0 || col >= width || row < 0 || row >= height) return null;
  const v = data[row * width + col];
  return isNaN(v) ? null : v;
}