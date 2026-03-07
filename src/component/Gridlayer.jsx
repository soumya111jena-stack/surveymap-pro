/**
 * Gridlayer.js — Google Earth–style adaptive grid overlay for CesiumJS
 *
 * Modes:
 *   "LatLng" — decimal-degree graticule with adaptive step, DMS labels
 *   "UTM"    — 6° zone columns + 8° band rows (C–X), with 100 km square sub-grid
 *   "MGRS"   — UTM zone grid + 100 km MGRS square labels + adaptive sub-grid
 *
 * Crash fixes applied:
 *  • Hard entity cap (MAX_ENTITIES = 280) prevents freeze at close zoom
 *  • removeLatLngGrid guards with viewer.isDestroyed() + contains() check
 *  • All entity additions wrapped in try/catch
 *  • utmToLatLngSimple returns null on any error, callers skip null points
 *  • getVisibleBounds always returns a valid object
 *  • Sub-grid iteration is bounded so it can't produce thousands of lines
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_ENTITIES = 280;   // hard cap — never add more than this many entities

// ─── Helpers ─────────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function utmBandLetter(lat) {
  const BANDS = "CDEFGHJKLMNPQRSTUVWX";
  const idx = clamp(Math.floor((lat + 80) / 8), 0, 19);
  return BANDS[idx];
}

function mgrs100kmId(zone, band, easting, northing) {
  const COL_ODD  = "ABCDEFGH";
  const COL_EVEN = "JKLMNPQR";
  const ROW_ALL  = "ABCDEFGHJKLMNPQRSTUV";

  const colSet    = (zone % 2 === 1) ? COL_ODD : COL_EVEN;
  const colIdx    = Math.floor(easting / 100000) - 1;
  const colLetter = colSet[clamp(colIdx, 0, 7)];

  const BAND_CHARS = "CDEFGHJKLMNPQRSTUVWX";
  const rowOffset  = (zone % 2 === 0) ? 5 : 0;
  const rowIdx     = (Math.floor(northing / 100000) + rowOffset) % 20;
  const rowLetter  = ROW_ALL[rowIdx];

  return colLetter + rowLetter;
}

function toDMS(val, posDir, negDir) {
  const a   = Math.abs(val);
  const d   = Math.floor(a);
  const m   = Math.floor((a - d) * 60);
  const s   = ((a - d - m / 60) * 3600).toFixed(1);
  const dir = val >= 0 ? posDir : negDir;
  return `${d}°${m}'${s}"${dir}`;
}

function latLngToUTMInternal(lat, lng) {
  try {
    const a  = 6378137.0;
    const f  = 1 / 298.257223563;
    const b  = a * (1 - f);
    const e2 = 1 - (b * b) / (a * a);

    const zone = Math.floor((lng + 180) / 6) + 1;
    const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
    const latR = lat * (Math.PI / 180);
    const lngR = lng * (Math.PI / 180);
    const N0   = lat >= 0 ? 0 : 10000000;
    const k0   = 0.9996;
    const E0   = 500000;

    const b2   = a * (1 - f);
    const nu   = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
    const t    = Math.tan(latR);
    const t2   = t * t;
    const l    = lngR - lon0;

    const A0 = 1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256;
    const A2 = 3 / 8 * (e2 + e2 ** 2 / 4 + 15 * e2 ** 3 / 128);
    const A4 = 15 / 256 * (e2 ** 2 + 3 * e2 ** 3 / 4);
    const A6 = 35 * e2 ** 3 / 3072;
    const M  = a * (A0 * latR - A2 * Math.sin(2 * latR) + A4 * Math.sin(4 * latR) - A6 * Math.sin(6 * latR));

    const easting  = k0 * nu * (l + l ** 3 / 6 * (1 - t2) + l ** 5 / 120 * (5 - 18 * t2 + t2 ** 2)) + E0;
    const northing = k0 * (M + nu * Math.tan(latR) * (l ** 2 / 2 + l ** 4 / 24 * (5 - t2 + 9 * e2 / (1 - e2)))) + N0;

    return { zone, band: utmBandLetter(lat), easting: Math.round(easting), northing: Math.round(northing) };
  } catch (_) {
    return null;
  }
}

// ─── Colour palette ───────────────────────────────────────────────────────────

const STYLE = {
  latLng: {
    major: { color: "rgba(34, 232, 19, 0.96)", width: 1.5 },
    minor: { color: "rgba(22, 236, 14, 0.8)", width: 0.8 },
    label: { fill: "#ffffff", outline: "#000000", bg: "rgba(0,0,0,0.55)" },
  },
  utm: {
    zone:  { color: "rgba(19, 163, 240, 0.9)", width: 2.0 },
    band:  { color: "rgba(20, 160, 235, 0.79)", width: 1.2 },
    sub:   { color: "rgba(27, 147, 212, 0.57)", width: 0.6 },
    label: { fill: "#64c8ff", outline: "#000000", bg: "rgba(0,10,30,0.65)" },
  },
  mgrs: {
    zone:  { color: "rgba(255,200,80,0.70)",  width: 2.0 },
    band:  { color: "rgba(255,200,80,0.40)",  width: 1.2 },
    sub:   { color: "rgba(255,200,80,0.20)",  width: 0.6 },
    label: { fill: "#ffc850", outline: "#000000", bg: "rgba(20,10,0,0.65)" },
  },
};

// ─── Adaptive step sizes ──────────────────────────────────────────────────────

function latLngStep(altM) {
  if (altM > 12_000_000) return 30;
  if (altM >  6_000_000) return 15;
  if (altM >  3_000_000) return 10;
  if (altM >  1_500_000) return  5;
  if (altM >    700_000) return  2;
  if (altM >    300_000) return  1;
  if (altM >    100_000) return  0.5;
  if (altM >     40_000) return  0.25;
  if (altM >     15_000) return  0.1;
  if (altM >      5_000) return  0.05;
  return 0.01;
}

function utmSubStep(altM) {
  if (altM > 2_000_000) return null;
  if (altM >   500_000) return 100_000;
  if (altM >   100_000) return  10_000;
  if (altM >    20_000) return   1_000;
  return null;
}

// ─── Entity builder helpers ───────────────────────────────────────────────────

function addPolyline(viewer, Cesium, positions, colorCss, width, clampGround, entities) {
  if (entities.length >= MAX_ENTITIES) return;   // ← hard cap
  if (!positions || positions.length < 2) return;
  try {
    const hex = colorCss.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/);
    if (!hex) return;
    const r = parseInt(hex[1]) / 255;
    const g = parseInt(hex[2]) / 255;
    const bC = parseInt(hex[3]) / 255;
    const a = hex[4] !== undefined ? parseFloat(hex[4]) : 1.0;
    const color = new Cesium.Color(r, g, bC, a);

    const ent = viewer.entities.add({
      polyline: {
        positions,
        width,
        material: new Cesium.ColorMaterialProperty(color),
        clampToGround: clampGround,
        arcType: Cesium.ArcType.RHUMB,
      },
    });
    entities.push(ent);
  } catch (_) {}
}

function addLabel(viewer, Cesium, lat, lng, text, style, altitudeOffset, entities) {
  if (entities.length >= MAX_ENTITIES) return;   // ← hard cap
  try {
    const pos = Cesium.Cartesian3.fromDegrees(lng, lat, altitudeOffset || 100);
    const ent = viewer.entities.add({
      position: pos,
      label: {
        text,
        font:             "bold 11px 'Courier New', monospace",
        fillColor:        Cesium.Color.fromCssColorString(style.fill),
        outlineColor:     Cesium.Color.fromCssColorString(style.outline),
        outlineWidth:     2,
        style:            Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin:   Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground:   true,
        backgroundColor:  Cesium.Color.fromCssColorString(style.bg),
        backgroundPadding: new Cesium.Cartesian2(4, 2),
        scaleByDistance:  new Cesium.NearFarScalar(1e3, 1.2, 1e7, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(1e3, 1.0, 2e7, 0.0),
        pixelOffset:      new Cesium.Cartesian2(0, 0),
      },
    });
    entities.push(ent);
  } catch (_) {}
}

// ─── Viewport helpers ─────────────────────────────────────────────────────────

function getVisibleBounds(viewer, Cesium) {
  try {
    const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (rect) {
      const minLat = clamp(Cesium.Math.toDegrees(rect.south), -85, 85);
      const maxLat = clamp(Cesium.Math.toDegrees(rect.north), -85, 85);
      let   minLng = Cesium.Math.toDegrees(rect.west);
      let   maxLng = Cesium.Math.toDegrees(rect.east);

      // Guard against degenerate/NaN bounds
      if (!isFinite(minLat) || !isFinite(maxLat) || !isFinite(minLng) || !isFinite(maxLng)) {
        throw new Error("non-finite bounds");
      }
      // Clamp span to reasonable maximum to avoid generating too many lines
      const spanLng = maxLng - minLng;
      if (spanLng > 360) { minLng = -180; maxLng = 180; }

      return { minLat, maxLat, minLng, maxLng, valid: true };
    }
  } catch (_) {}
  // Safe global fallback
  return { minLat: -80, maxLat: 84, minLng: -180, maxLng: 180, valid: false };
}

// ─── LatLng graticule ─────────────────────────────────────────────────────────

function buildLatLngLines(viewer, Cesium, alt, entities) {
  const step   = latLngStep(alt);
  const style  = STYLE.latLng;
  const bounds = getVisibleBounds(viewer, Cesium);

  const latMin = Math.max(-90,  Math.floor((bounds.minLat - step) / step) * step);
  const latMax = Math.min( 90,  Math.ceil( (bounds.maxLat + step) / step) * step);
  const lngMin = Math.max(-180, Math.floor((bounds.minLng - step) / step) * step);
  const lngMax = Math.min( 180, Math.ceil( (bounds.maxLng + step) / step) * step);

  // Safety: cap number of lines we attempt to draw
  const maxLines = 60;
  const latLines = Math.min(maxLines, Math.round((latMax - latMin) / step) + 1);
  const lngLines = Math.min(maxLines, Math.round((lngMax - lngMin) / step) + 1);

  const isMajor = (v, s) => {
    const bigStep = s <= 1 ? 10 : s <= 5 ? 30 : 90;
    return Math.abs(v % bigStep) < s * 0.01;
  };

  // Sample density along each line — coarser at high altitude, finer when close
  const sampleStep = step > 5 ? step * 2 : step > 1 ? step : Math.max(step * 4, 0.5);

  // Latitude lines (horizontal)
  for (let li = 0; li < latLines; li++) {
    if (entities.length >= MAX_ENTITIES) break;
    const lat = parseFloat((latMin + li * step).toFixed(8));
    if (lat < -90 || lat > 90) continue;
    const pts = [];
    for (let lng = -180; lng <= 180; lng += sampleStep) {
      pts.push(Cesium.Cartesian3.fromDegrees(Math.min(lng, 180), lat, 0));
    }
    const maj = isMajor(lat, step);
    addPolyline(viewer, Cesium, pts,
      maj ? style.major.color : style.minor.color,
      maj ? style.major.width : style.minor.width,
      true, entities);
  }

  // Longitude lines (vertical)
  for (let li = 0; li < lngLines; li++) {
    if (entities.length >= MAX_ENTITIES) break;
    const lng = parseFloat((lngMin + li * step).toFixed(8));
    if (lng < -180 || lng > 180) continue;
    const pts = [];
    for (let lat = -80; lat <= 84; lat += sampleStep) {
      pts.push(Cesium.Cartesian3.fromDegrees(lng, Math.min(lat, 84), 0));
    }
    const maj = isMajor(lng, step);
    addPolyline(viewer, Cesium, pts,
      maj ? style.major.color : style.minor.color,
      maj ? style.major.width : style.minor.width,
      true, entities);
  }

  // Labels near camera centre
  if (alt < 8_000_000 && entities.length < MAX_ENTITIES - 20) {
    try {
      const camCart  = viewer.camera.positionWC;
      const camCarto = Cesium.Cartographic.fromCartesian(camCart);
      const camLat   = Cesium.Math.toDegrees(camCarto.latitude);
      const camLng   = Cesium.Math.toDegrees(camCarto.longitude);

      if (!isFinite(camLat) || !isFinite(camLng)) throw new Error("bad cam pos");

      const snapLat = Math.round(camLat / step) * step;
      const snapLng = Math.round(camLng / step) * step;
      const spread  = Math.max(1, Math.min(3, Math.floor(3 / step)));

      for (let di = -spread; di <= spread; di++) {
        for (let dj = -spread; dj <= spread; dj++) {
          if (entities.length >= MAX_ENTITIES) break;
          const lLat = parseFloat((snapLat + di * step).toFixed(8));
          const lLng = parseFloat((snapLng + dj * step).toFixed(8));
          if (lLat < -80 || lLat > 84 || lLng < -180 || lLng > 180) continue;
          if ((Math.abs(di) + Math.abs(dj)) % 2 !== 0) continue;

          const latStr = step >= 1
            ? `${Math.abs(lLat).toFixed(0)}°${lLat >= 0 ? "N" : "S"}`
            : toDMS(lLat, "N", "S");
          const lngStr = step >= 1
            ? `${Math.abs(lLng).toFixed(0)}°${lLng >= 0 ? "E" : "W"}`
            : toDMS(lLng, "E", "W");
          addLabel(viewer, Cesium, lLat, lLng, `${latStr}\n${lngStr}`, style.label, 500, entities);
        }
      }
    } catch (_) {}
  }
}

// ─── UTM / MGRS grid ──────────────────────────────────────────────────────────

function buildUTMLines(viewer, Cesium, alt, entities, isMGRS) {
  const style   = isMGRS ? STYLE.mgrs : STYLE.utm;
  const bounds  = getVisibleBounds(viewer, Cesium);
  const subStep = utmSubStep(alt);

  // ── 1. Zone columns (every 6°) ───────────────────────────────────────────
  const zoneStartLng = Math.max(-180, Math.floor(bounds.minLng / 6) * 6);
  const zoneEndLng   = Math.min( 180, Math.ceil( bounds.maxLng / 6) * 6);

  for (let lng = zoneStartLng; lng <= zoneEndLng; lng += 6) {
    if (entities.length >= MAX_ENTITIES) break;
    const pts = [];
    for (let lat = -80; lat <= 84; lat += 4) {
      pts.push(Cesium.Cartesian3.fromDegrees(lng, lat, 0));
    }
    addPolyline(viewer, Cesium, pts, style.zone.color, style.zone.width, true, entities);

    if (alt < 5_000_000 && entities.length < MAX_ENTITIES) {
      const zone = Math.floor((lng + 180) / 6) + 1;
      if (zone >= 1 && zone <= 60) {
        const midLat = clamp((bounds.minLat + bounds.maxLat) / 2, -78, 82);
        addLabel(viewer, Cesium, midLat, lng + 3, `${zone}`, style.label, 1000, entities);
      }
    }
  }

  // ── 2. Band rows (every 8°) ───────────────────────────────────────────────
  const BAND_LATS  = [-80,-72,-64,-56,-48,-40,-32,-24,-16,-8,0,8,16,24,32,40,48,56,64,72,84];
  const BAND_NAMES = "CDEFGHJKLMNPQRSTUVWX";

  for (let bi = 0; bi < BAND_LATS.length - 1; bi++) {
    if (entities.length >= MAX_ENTITIES) break;
    const lat = BAND_LATS[bi];
    if (lat < bounds.minLat - 8 || lat > bounds.maxLat + 8) continue;
    const pts = [];
    for (let lng = -180; lng <= 180; lng += 6) {
      pts.push(Cesium.Cartesian3.fromDegrees(lng, lat, 0));
    }
    addPolyline(viewer, Cesium, pts, style.band.color, style.band.width, true, entities);

    if (alt < 5_000_000 && entities.length < MAX_ENTITIES) {
      const midLat = (BAND_LATS[bi] + BAND_LATS[bi + 1]) / 2;
      const midLng = clamp((bounds.minLng + bounds.maxLng) / 2, -177, 177);
      addLabel(viewer, Cesium, midLat, midLng, BAND_NAMES[bi], style.label, 1000, entities);
    }
  }

  // ── 3. Sub-grid ───────────────────────────────────────────────────────────
  if (!subStep || entities.length >= MAX_ENTITIES) return;

  const zoneMin = clamp(Math.floor((bounds.minLng + 180) / 6),     0, 59);
  const zoneMax = clamp(Math.floor((bounds.maxLng + 180) / 6) + 1, 0, 59);

  // Cap zones processed to avoid explosion
  const maxZones = 3;
  const z0 = zoneMin;
  const z1 = Math.min(zoneMax, zoneMin + maxZones - 1);

  for (let zoneIdx = z0; zoneIdx <= z1; zoneIdx++) {
    if (entities.length >= MAX_ENTITIES) break;
    const zone   = zoneIdx + 1;
    const lon0   = zoneIdx * 6 - 180;

    for (let bi = 0; bi < BAND_LATS.length - 1; bi++) {
      if (entities.length >= MAX_ENTITIES) break;
      const latS = BAND_LATS[bi];
      const latN = BAND_LATS[bi + 1];
      if (latN < bounds.minLat || latS > bounds.maxLat) continue;
      const band = BAND_NAMES[bi];

      const swLat = clamp(latS + 0.1, -79.9, 83.9);
      const neLat = clamp(latN - 0.1, -79.9, 83.9);
      const swLng = lon0 + 0.1;
      const neLng = lon0 + 5.9;

      const utmSW = latLngToUTMInternal(swLat, swLng);
      const utmNE = latLngToUTMInternal(neLat, neLng);
      if (!utmSW || !utmNE) continue;

      const eMin = Math.floor(utmSW.easting  / subStep) * subStep;
      const eMax = Math.ceil( utmNE.easting  / subStep) * subStep;
      const nMin = Math.floor(utmSW.northing / subStep) * subStep;
      const nMax = Math.ceil( utmNE.northing / subStep) * subStep;

      // Cap iterations to avoid thousands of lines
      const maxIter = 12;
      const eCols = Math.min(maxIter, Math.round((eMax - eMin) / subStep) + 1);
      const nRows = Math.min(maxIter, Math.round((nMax - nMin) / subStep) + 1);
      const hemi  = latS >= 0 ? "N" : "S";

      // Easting lines
      for (let ei = 0; ei < eCols; ei++) {
        if (entities.length >= MAX_ENTITIES) break;
        const e   = eMin + ei * subStep;
        const pts = [];
        for (let ni = 0; ni <= nRows; ni++) {
          const n  = nMin + ni * subStep;
          const ll = utmToLatLngSimple(zone, hemi, e, n);
          if (ll) pts.push(Cesium.Cartesian3.fromDegrees(ll.lng, ll.lat, 0));
        }
        if (pts.length >= 2) {
          addPolyline(viewer, Cesium, pts, style.sub.color, style.sub.width, true, entities);
        }
      }

      // Northing lines
      for (let ni = 0; ni < nRows; ni++) {
        if (entities.length >= MAX_ENTITIES) break;
        const n   = nMin + ni * subStep;
        const pts = [];
        for (let ei = 0; ei <= eCols; ei++) {
          const e  = eMin + ei * subStep;
          const ll = utmToLatLngSimple(zone, hemi, e, n);
          if (ll) pts.push(Cesium.Cartesian3.fromDegrees(ll.lng, ll.lat, 0));
        }
        if (pts.length >= 2) {
          addPolyline(viewer, Cesium, pts, style.sub.color, style.sub.width, true, entities);
        }
      }

      // MGRS 100 km labels
      if (isMGRS && subStep <= 100_000 && alt < 1_000_000 && entities.length < MAX_ENTITIES) {
        for (let ei = 0; ei < eCols - 1; ei++) {
          for (let ni = 0; ni < nRows - 1; ni++) {
            if (entities.length >= MAX_ENTITIES) break;
            const e  = eMin + (ei + 0.5) * subStep;
            const n  = nMin + (ni + 0.5) * subStep;
            const ll = utmToLatLngSimple(zone, hemi, e, n);
            if (!ll) continue;
            const id = mgrs100kmId(zone, band, e, n);
            addLabel(viewer, Cesium, ll.lat, ll.lng, id, style.label, 500, entities);
          }
        }
      }
    }
  }
}

/** Fast approximate UTM → lat/lng */
function utmToLatLngSimple(zone, hemi, easting, northing) {
  try {
    const a   = 6378137.0;
    const f   = 1 / 298.257223563;
    const b   = a * (1 - f);
    const e2  = 1 - (b * b) / (a * a);
    const k0  = 0.9996;
    const E0  = 500000;
    const N0  = hemi === "S" ? 10000000 : 0;
    const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);

    const M   = (northing - N0) / k0;
    const mu  = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
    const e1  = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

    const phi1 = mu
      + (3 * e1 / 2 - 27 * e1 ** 3 / 32)   * Math.sin(2 * mu)
      + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96)               * Math.sin(6 * mu)
      + (1097 * e1 ** 4 / 512)             * Math.sin(8 * mu);

    const nu  = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
    const t   = Math.tan(phi1);
    const t2  = t * t;
    const ep2 = e2 / (1 - e2);
    const C1  = ep2 * Math.cos(phi1) ** 2;
    const D   = (easting - E0) / (nu * k0);

    const lat = phi1 - (nu * t / (a ** 2 / (b ** 2))) *
      (D ** 2 / 2 - D ** 4 / 24 * (5 + 3 * t2 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2));
    const lng = lon0 + (D - D ** 3 / 6 * (1 + 2 * t2 + C1)) / Math.cos(phi1);

    const latDeg = lat * (180 / Math.PI);
    const lngDeg = lng * (180 / Math.PI);

    if (!isFinite(latDeg) || !isFinite(lngDeg)) return null;
    if (latDeg < -90 || latDeg > 90 || lngDeg < -180 || lngDeg > 180) return null;
    return { lat: latDeg, lng: lngDeg };
  } catch (_) {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build and add grid entities to the viewer.
 * Returns the entity array — pass it to removeLatLngGrid() when done.
 */
export function buildLatLngGrid(viewer, Cesium, { mode = "LatLng", alt = 5_000_000 } = {}) {
  const entities = [];

  if (!viewer || !Cesium) return entities;
  try {
    if (viewer.isDestroyed()) return entities;
  } catch (_) {
    return entities;
  }

  try {
    switch (mode) {
      case "LatLng": buildLatLngLines(viewer, Cesium, alt, entities); break;
      case "UTM":    buildUTMLines(viewer, Cesium, alt, entities, false); break;
      case "MGRS":   buildUTMLines(viewer, Cesium, alt, entities, true);  break;
      default:       buildLatLngLines(viewer, Cesium, alt, entities);
    }
  } catch (err) {
    console.warn("[Gridlayer] build error:", err);
  }

  return entities;
}

/**
 * Safely remove all grid entities previously created by buildLatLngGrid().
 */
export function removeLatLngGrid(viewer, entities) {
  if (!viewer || !entities || !entities.length) return;
  try {
    if (viewer.isDestroyed()) return;
  } catch (_) {
    return;
  }
  for (const ent of entities) {
    try {
      if (ent && viewer.entities.contains(ent)) {
        viewer.entities.remove(ent);
      }
    } catch (_) {}
  }
}