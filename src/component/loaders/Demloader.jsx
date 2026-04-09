/**
 * DEMLoader.jsx — QGIS-style 2D DEM overlay for SurveyMap Pro v5.9
 *
 * ✅ FIX 1 : DEM is clipped to KML polygon boundary (QGIS "clip raster by mask layer")
 * ✅ FIX 2 : UTM zone detection fixed — tries zones 44→45→43→46, validates result
 * ✅ FIX 3 : Canvas null-check in onRemove / _update (no crash on unmount)
 * ✅ FIX 4 : reRender guard — skips first mount when raster is null
 * ✅ FIX 5 : Component-unmount cleanup — removes layer from map
 * ✅ FIX 6 : nodata -32767 now treated as NaN (was -32768 only — caused white canvas)
 *            GeoTIFF files commonly use -32767 as the sentinel nodata value.
 * ✅ FIX 7 : AlpineQuest-style color ramp added — vivid hypsometric tinting with
 *            distinct blue → green → yellow → brown → white elevation bands.
 * ✅ FIX 8 : Percentile contrast stretch (2–98%) applied before rendering.
 *            Prevents outlier elevation values from washing out the color ramp.
 *            Matches QGIS "Cumulative count cut" / AlpineQuest default behaviour.
 *
 * Dependencies:  npm install geotiff proj4
 */

import { useEffect, useRef, useCallback } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/* ─── Colour ramps (identical to QGIS built-ins + AlpineQuest) ────────── */
export const COLOR_RAMPS = {
  /**
   * ✅ FIX 7: AlpineQuest hypsometric ramp.
   *
   * AlpineQuest renders elevation with vivid, high-contrast bands that make
   * terrain immediately readable at a glance. The key differences from the
   * default "Terrain" ramp:
   *
   *  - Deep blue-green at the very bottom (water / lowest ground)
   *  - Bright, saturated greens for lowlands (not the muted green of "Terrain")
   *  - A clear yellow band marking the mid-elevation transition
   *  - Warm tan → orange-brown for highlands (absent from "Terrain")
   *  - Reddish-brown for high ridges, mauve for bare rock
   *  - White reserved only for the top few percent (actual snow / peaks)
   *
   * The ramp uses 10 stops (vs 6 for "Terrain") so transitions are smoother
   * and each elevation zone has a distinctive hue, not just a lightness shift.
   *
   * Combined with the 2–98% percentile stretch (FIX 8 below) this produces
   * the same punchy, fully-saturated look seen in AlpineQuest and QGIS when
   * "Cumulative count cut" is enabled.
   */
  "AlpineQuest": [
    [0.00, [ 32, 120, 180]], // deep blue      — water / absolute lowest
    [0.05, [ 55, 165, 130]], // teal-green     — river valleys / coast
    [0.15, [ 85, 195,  85]], // bright green   — lowland plains
    [0.28, [165, 215,  75]], // yellow-green   — gentle hills
    [0.42, [230, 210,  85]], // warm yellow    — uplands
    [0.55, [215, 165,  65]], // tan / sand     — upper slopes
    [0.68, [185, 108,  50]], // orange-brown   — highlands
    [0.80, [152,  72,  42]], // reddish-brown  — high ridges
    [0.90, [138,  88,  78]], // mauve / rock   — bare rock / scree
    [1.00, [238, 238, 238]], // near-white     — snow / highest peaks
  ],

  "Viridis": [
    [0,   [68,  1,  84]],
    [0.25,[59,  82, 139]],
    [0.5, [33, 145, 140]],
    [0.75,[94, 201,  97]],
    [1,   [253,231,  37]],
  ],
  "Magma": [
    [0,   [0,   0,   3]],
    [0.25,[80,  18,  66]],
    [0.5, [182,  54,  59]],
    [0.75,[251, 136,  97]],
    [1,   [252, 253, 191]],
  ],
  "Plasma": [
    [0,   [13,   8, 135]],
    [0.25,[126,  3, 167]],
    [0.5, [203,  70, 121]],
    [0.75,[248, 149,  64]],
    [1,   [240, 249,  33]],
  ],
  "Inferno": [
    [0,   [0,   0,   3]],
    [0.25,[66,  10, 104]],
    [0.5, [182,  54,  19]],
    [0.75,[251, 161,  62]],
    [1,   [252, 255, 164]],
  ],
  "RdYlGn": [
    [0,   [215,  25,  28]],
    [0.25,[253, 174,  97]],
    [0.5, [255, 255, 191]],
    [0.75,[145, 207, 104]],
    [1,   [ 26, 150,  65]],
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
    [0,   [20,  20,  20]],
    [1,   [255, 255, 255]],
  ],
  "Hot": [
    [0,   [0,   0,   0]],
    [0.33,[255,  0,   0]],
    [0.66,[255, 255,  0]],
    [1,   [255, 255, 255]],
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

/**
 * ✅ FIX 8: Percentile contrast stretch (2–98%).
 *
 * The "washed out" appearance occurs because the colour ramp is stretched
 * from the absolute min to the absolute max of the dataset. A single noisy
 * outlier pixel at -500 m or +8800 m compresses everything else into a tiny
 * slice of the ramp, making the whole tile look like a single flat colour.
 *
 * AlpineQuest and QGIS ("Cumulative count cut", default 2–98%) both fix this
 * by ignoring the extreme tails of the elevation distribution.
 *
 * This function collects every valid (non-NaN) elevation value, sorts them,
 * and returns the values at the 2nd and 98th percentile positions.
 * renderToImageData then clamps its normalisation to [lo, hi] instead of
 * [minVal, maxVal], ensuring the full colour ramp is used across the range
 * that contains 96% of the data — exactly matching AlpineQuest's behaviour.
 *
 * @param {Float32Array} data   — elevation raster (NaN = nodata)
 * @param {number} loFrac       — lower percentile fraction (default 0.02)
 * @param {number} hiFrac       — upper percentile fraction (default 0.98)
 * @returns {{ lo: number, hi: number }}
 */
function percentileStretch(data, loFrac = 0.02, hiFrac = 0.98) {
  // Collect only valid (non-NaN) values into a plain array for sorting
  const valid = [];
  for (let i = 0; i < data.length; i++) {
    if (!isNaN(data[i])) valid.push(data[i]);
  }
  if (valid.length === 0) return { lo: 0, hi: 1 };

  valid.sort((a, b) => a - b);

  const lo = valid[Math.floor(valid.length * loFrac)];
  const hi = valid[Math.floor(valid.length * hiFrac)];

  // Guard: if lo === hi (flat raster), fall back to full range
  if (lo === hi) return { lo: valid[0], hi: valid[valid.length - 1] };

  return { lo, hi };
}

/* ─── Extract rings from any mask format ──────────────────────────────
 *  Accepts:
 *   • GeoJSON Polygon / MultiPolygon / Feature / FeatureCollection
 *   • Array of L.LatLng  (flat ring from Leaflet KML layer)
 *   • Array of Array of L.LatLng  (multi-ring)
 *
 *  Returns: Array of rings — each ring = Array of [lng, lat] pairs
 * ─────────────────────────────────────────────────────────────────── */
export function extractRings(mask) {
  if (!mask) return [];

  // ── Leaflet LatLng arrays ──
  if (Array.isArray(mask)) {
    if (mask.length === 0) return [];
    const first = mask[0];

    // flat array of {lat,lng}
    if (first && first.lat !== undefined) {
      return [mask.map(ll => [ll.lng, ll.lat])];
    }
    // array of arrays of {lat,lng}
    if (Array.isArray(first) && first.length > 0 && first[0] && first[0].lat !== undefined) {
      return mask.map(ring => ring.map(ll => [ll.lng, ll.lat]));
    }
    // already [lng,lat] numeric pairs
    if (Array.isArray(first) && first.length === 2 && typeof first[0] === "number") {
      return [mask];
    }
  }

  // ── GeoJSON Feature ──
  if (mask.type === "Feature")            return extractRings(mask.geometry);
  // ── GeoJSON FeatureCollection ──
  if (mask.type === "FeatureCollection")  return mask.features.flatMap(f => extractRings(f));
  // ── GeoJSON Polygon ──
  if (mask.type === "Polygon")            return mask.coordinates;
  // ── GeoJSON MultiPolygon ──
  if (mask.type === "MultiPolygon")       return mask.coordinates.flatMap(poly => poly);

  return [];
}

/* ─── Apply canvas clip path from rings ──────────────────────────────── */
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
  ctx.clip("evenodd"); // respects holes — matches QGIS behaviour
  return true;
}

/* ─── ASC / .dem parser ───────────────────────────────────────────────── */
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
  const data = new Float32Array(ncols * nrows);
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

/* ─── GeoTIFF parser ─────────────────────────────────────────────────── */
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

  // Read the actual GDAL_NODATA tag from the file
  const gdalNodata = image.fileDirectory.GDAL_NODATA
    ? Number(image.fileDirectory.GDAL_NODATA)
    : null;

  // Treat all common nodata sentinels as NaN
  // -32767 = standard SRTM / Copernicus "void" value (INT16 min + 1)
  // -32768 = INT16 absolute minimum (also used by some providers)
  // -9999  = classic GIS nodata
  const isNodata = (v) => {
    if (isNaN(v)) return true;
    if (gdalNodata !== null && v === gdalNodata) return true;
    if (v === -32767) return true;
    if (v === -32768) return true;
    if (v === -9999)  return true;
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
      if (!reprojected) console.warn("DEMLoader: Could not reproject GeoTIFF. Map may be misaligned.");
    } else {
      console.warn("DEMLoader: proj4 not installed. Run: npm install proj4.");
    }
  }

  return { data, width, height, west, south, east, north };
}

/* ─── Render raster → ImageData ──────────────────────────────────────── */
/**
 * ✅ FIX 8 (continued): renderToImageData now accepts stretchLo / stretchHi
 * instead of minVal / maxVal.  The caller passes the 2–98 percentile bounds
 * so the colour ramp is mapped to the meaningful elevation range, not the
 * full range including outliers.  Values outside [stretchLo, stretchHi] are
 * clamped to the ramp ends (t=0 or t=1) — they get a colour, just the same
 * extreme colour as the nearest in-range value.
 */
function renderToImageData(data, width, height, ramp, stretchLo, stretchHi, opacity) {
  const range  = stretchHi - stretchLo || 1;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = data[i];
    if (isNaN(v)) { pixels[i * 4 + 3] = 0; continue; }
    // t is clamped to [0,1] inside sampleRamp — values outside the stretch
    // range map to the ramp endpoints instead of being clipped to transparent.
    const t   = (v - stretchLo) / range;
    const col = sampleRamp(ramp, t);
    pixels[i * 4]     = col[0];
    pixels[i * 4 + 1] = col[1];
    pixels[i * 4 + 2] = col[2];
    pixels[i * 4 + 3] = Math.round(opacity * 255);
  }
  return new ImageData(pixels, width, height);
}

/* ─── Custom Leaflet Canvas Layer ────────────────────────────────────── */
const DEMCanvasLayer = L.Layer.extend({
  initialize(imageData, bounds, options) {
    this._imageData = imageData;
    this._bounds    = bounds;
    L.setOptions(this, options);
  },

  onAdd(map) {
    this._map    = map;
    this._canvas = document.createElement("canvas");
    this._canvas.style.cssText =
      "position:absolute;pointer-events:none;image-rendering:pixelated;";
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

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════ */
export default function DEMLoader({
  file,
  opacity   = 0.75,
  colorRamp = "AlpineQuest",   // ✅ FIX 7: AlpineQuest is now the default ramp
  kmlMask   = null,
  onDone,
  onError,
  onStats,
}) {
  const map       = useMap();
  const layerRef  = useRef(null);
  const rasterRef = useRef(null);

  /* ── Re-render when opacity / colorRamp changes ── */
  const reRender = useCallback(() => {
    const r = rasterRef.current;
    if (!r || !layerRef.current) return;
    const { data, width, height, stretchLo, stretchHi } = r;
    const ramp = COLOR_RAMPS[colorRamp] || COLOR_RAMPS["AlpineQuest"];
    // ✅ FIX 8: use pre-computed percentile bounds, not raw min/max
    const img  = renderToImageData(data, width, height, ramp, stretchLo, stretchHi, opacity);
    layerRef.current.updateImageData(img);
  }, [opacity, colorRamp]);

  useEffect(() => {
    if (rasterRef.current) reRender();
  }, [reRender]);

  /* ── Reactively update clip mask when kmlMask prop changes ── */
  useEffect(() => {
    if (!layerRef.current) return;
    const rings = extractRings(kmlMask);
    layerRef.current.setClipMask(rings);
  }, [kmlMask]);

  /* ── Remove layer on component unmount ── */
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

        // ✅ Compute true stats only over valid (non-NaN) pixels
        let minVal = Infinity, maxVal = -Infinity, sum = 0, count = 0;
        for (let i = 0; i < data.length; i++) {
          if (!isNaN(data[i])) {
            if (data[i] < minVal) minVal = data[i];
            if (data[i] > maxVal) maxVal = data[i];
            sum += data[i]; count++;
          }
        }
        const meanVal = count ? sum / count : 0;

        // ✅ FIX 8: Compute 2–98 percentile bounds for contrast stretch.
        //
        // Using the absolute min/max causes the ramp to be mapped across the
        // entire distribution including extreme outliers, which pushes all the
        // "normal" terrain into a narrow band of nearly-identical colours.
        //
        // percentileStretch() sorts valid pixels and picks the 2nd percentile
        // as stretchLo and the 98th percentile as stretchHi.  renderToImageData
        // normalises elevation to [0,1] using these tighter bounds, so 96% of
        // pixels use the full ramp and only the extreme tails are clamped to
        // the ramp endpoints.  This is the same algorithm AlpineQuest and QGIS
        // "Cumulative count cut" use to produce vivid, high-contrast DEM tiles.
        const { lo: stretchLo, hi: stretchHi } = percentileStretch(data);

        rasterRef.current = {
          data, width, height,
          minVal, maxVal,       // true data range (for onStats / elevation probe)
          stretchLo, stretchHi, // percentile-clipped range (for rendering)
          west, south, east, north,
        };

        const rasterPayload = { data, width, height, west, south, east, north, minVal, maxVal };
        onStats?.({ min: minVal, max: maxVal, mean: meanVal, width, height }, rasterPayload);

        const ramp   = COLOR_RAMPS[colorRamp] || COLOR_RAMPS["AlpineQuest"];
        // ✅ FIX 8: pass percentile bounds to renderer
        const img    = renderToImageData(data, width, height, ramp, stretchLo, stretchHi, opacity);
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

/* ─── Utility: sample elevation at lat/lng from raster ───────────────── */
export function sampleElevationAt(rasterState, lat, lng) {
  if (!rasterState) return null;
  const { data, width, height, west, south, east, north } = rasterState;
  const col = Math.round(((lng - west)  / (east  - west))  * (width  - 1));
  const row = Math.round(((north - lat) / (north - south)) * (height - 1));
  if (col < 0 || col >= width || row < 0 || row >= height) return null;
  const v = data[row * width + col];
  return isNaN(v) ? null : v;
}