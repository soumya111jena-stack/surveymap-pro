/**
 * utm-mgrs.js — Self-contained UTM ↔ LatLng ↔ MGRS conversions
 * Based on WGS84 ellipsoid. No external dependencies.
 * Exported functions:
 *   latLngToUTM(lat, lng)  → { zone, band, easting, northing, hemisphere }
 *   utmToLatLng(zone, band, easting, northing, hemisphere) → { lat, lng }
 *   latLngToMGRS(lat, lng, precision?)  → string e.g. "16S EG 56789 34567"
 *   mgrsToLatLng(mgrs)  → { lat, lng } | null
 *   parseUTM(str)  → { zone, band, easting, northing } | null
 *   parseMGRS(str) → { lat, lng } | null
 *   formatUTM(utm) → string e.g. "16N 456789E 3456789N"
 *   formatMGRS(mgrs, precision?) → string e.g. "16S EG 56789 34567"
 */

// ── WGS84 constants ──────────────────────────────────────────────────────────
const a  = 6378137.0;         // semi-major axis
const f  = 1 / 298.257223563; // flattening
const b  = a * (1 - f);       // semi-minor axis
const e2 = 2*f - f*f;         // eccentricity squared
const e  = Math.sqrt(e2);
const e2p = e2 / (1 - e2);    // second eccentricity squared
const k0 = 0.9996;            // scale factor

// MGRS 100km square letter sets
const MGRS_SET_LETTERS = [
  ["ABCDEFGH", "ABCDEFGHJKLMNPQRSTUV"],
  ["JKLMNPQR", "FGHJKLMNPQRSTUVABCDE"],
  ["STUVWXYZ", "ABCDEFGHJKLMNPQRSTUV"],
  ["ABCDEFGH", "FGHJKLMNPQRSTUVABCDE"],
  ["JKLMNPQR", "ABCDEFGHJKLMNPQRSTUV"],
  ["STUVWXYZ", "FGHJKLMNPQRSTUVABCDE"],
];

const BAND_LETTERS = "CDEFGHJKLMNPQRSTUVWX";

// ── Helpers ───────────────────────────────────────────────────────────────────
function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }

function utmZone(lng) {
  return Math.floor((lng + 180) / 6) + 1;
}
function utmCentralMeridian(zone) {
  return toRad((zone - 1) * 6 - 180 + 3);
}
function latBand(lat) {
  if (lat >= -80 && lat <= 84) {
    const idx = Math.floor((lat + 80) / 8);
    return BAND_LETTERS[Math.min(idx, 19)];
  }
  return lat > 84 ? "Y" : "A";
}

// ── LatLng → UTM ─────────────────────────────────────────────────────────────
export function latLngToUTM(lat, lng) {
  const latR = toRad(lat);
  const lngR = toRad(lng);
  const zone  = utmZone(lng);
  const lon0  = utmCentralMeridian(zone);
  const band  = latBand(lat);
  const hemisphere = lat >= 0 ? "N" : "S";

  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = e2p * Math.cos(latR) ** 2;
  const A = Math.cos(latR) * (lngR - lon0);

  const M = a * (
    (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * latR
    - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * Math.sin(2*latR)
    + (15*e2**2/256 + 45*e2**3/1024) * Math.sin(4*latR)
    - (35*e2**3/3072) * Math.sin(6*latR)
  );

  let easting = k0 * N * (
    A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*e2p)*A**5/120
  ) + 500000;

  let northing = k0 * (
    M + N * Math.tan(latR) * (
      A**2/2 + (5-T+9*C+4*C**2)*A**4/24
      + (61-58*T+T**2+600*C-330*e2p)*A**6/720
    )
  );
  if (lat < 0) northing += 10000000;

  return {
    zone,
    band,
    hemisphere,
    easting:  Math.round(easting),
    northing: Math.round(northing),
  };
}

// ── UTM → LatLng ─────────────────────────────────────────────────────────────
export function utmToLatLng(zone, band, easting, northing, hemisphere) {
  const hem = hemisphere || (band && "CDEFGHJKLM".includes(band) ? "S" : "N");
  const x = easting - 500000;
  const y = hem === "S" ? northing - 10000000 : northing;
  const lon0 = utmCentralMeridian(zone);

  const M = y / k0;
  const mu = M / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const phi1 = mu
    + (3*e1/2 - 27*e1**3/32) * Math.sin(2*mu)
    + (21*e1**2/16 - 55*e1**4/32) * Math.sin(4*mu)
    + (151*e1**3/96) * Math.sin(6*mu)
    + (1097*e1**4/512) * Math.sin(8*mu);

  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1)**2);
  const T1 = Math.tan(phi1)**2;
  const C1 = e2p * Math.cos(phi1)**2;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1)**2, 1.5);
  const D  = x / (N1 * k0);

  const lat = toDeg(phi1 - (N1 * Math.tan(phi1) / R1) * (
    D**2/2 - (5+3*T1+10*C1-4*C1**2-9*e2p)*D**4/24
    + (61+90*T1+298*C1+45*T1**2-252*e2p-3*C1**2)*D**6/720
  ));

  const lng = toDeg(lon0) + toDeg(
    (D - (1+2*T1+C1)*D**3/6 + (5-2*C1+(28*T1)-(3*C1**2)+(8*e2p)+(24*T1**2))*D**5/120)
    / Math.cos(phi1)
  );

  return { lat, lng };
}

// ── LatLng → MGRS ─────────────────────────────────────────────────────────────
export function latLngToMGRS(lat, lng, precision = 5) {
  const utm = latLngToUTM(lat, lng);
  return utmToMGRS(utm, precision);
}

function utmToMGRS(utm, precision = 5) {
  const { zone, band, easting, northing } = utm;
  const setIdx = (zone - 1) % 6;
  const [colLetters, rowLetters] = MGRS_SET_LETTERS[setIdx];

  // Column letter (easting 100km square)
  const col = Math.floor(easting / 100000) - 1;
  const colLetter = colLetters[col] || "?";

  // Row letter (northing 100km square, cycling every 20 letters)
  const row = Math.floor(northing / 100000) % 20;
  const rowLetter = rowLetters[row] || "?";

  // Truncate to requested precision digits
  const e = String(Math.floor(easting % 100000)).padStart(5, "0").slice(0, precision);
  const n = String(Math.floor(northing % 100000)).padStart(5, "0").slice(0, precision);

  return `${zone}${band} ${colLetter}${rowLetter} ${e} ${n}`;
}

// ── MGRS → LatLng ──────────────────────────────────────────────────────────
export function mgrsToLatLng(mgrs) {
  const parsed = parseMGRS(mgrs);
  if (!parsed) return null;
  return parsed;
}

// ── Parse UTM string ────────────────────────────────────────────────────────
// Accepts: "16N 456789E 3456789N", "16N 456789 3456789", "Zone 16N …"
export function parseUTM(str) {
  if (!str) return null;
  const s = str.trim().replace(/^zone\s*/i, "");
  const m = s.match(/^(\d{1,2})([A-Z])\s+(\d+)(?:E|m)?\s+(\d+)(?:N|m)?$/i);
  if (!m) return null;
  const zone = parseInt(m[1]);
  const band = m[2].toUpperCase();
  const easting  = parseInt(m[3]);
  const northing = parseInt(m[4]);
  if (zone < 1 || zone > 60) return null;
  if (easting < 100000 || easting > 900000) return null;
  if (northing < 0 || northing > 10000000) return null;
  return { zone, band, easting, northing };
}

// ── Parse MGRS string ───────────────────────────────────────────────────────
// Accepts: "16S EG 56789 34567", "16SEG5678934567", "16S EG 567 345" etc.
export function parseMGRS(str) {
  if (!str) return null;
  // Normalise: strip spaces, uppercase
  const s = str.trim().replace(/\s+/g, " ").toUpperCase();

  // Match: zone(1-2 digits) band(letter) 100km-sq(2 letters) easting northing
  const m = s.match(/^(\d{1,2})([C-X])\s*([A-Z]{2})\s*(\d{1,5})\s*(\d{1,5})$/);
  if (!m) return null;

  const zone = parseInt(m[1]);
  const band = m[2];
  const sq   = m[3]; // 100km square (col+row)
  let   eRaw = m[4];
  let   nRaw = m[5];

  if (eRaw.length !== nRaw.length) return null;

  // Pad to 5 digits
  const pad = 5 - eRaw.length;
  eRaw = eRaw.padEnd(5, "0");
  nRaw = nRaw.padEnd(5, "0");

  const setIdx = (zone - 1) % 6;
  const [colLetters, rowLetters] = MGRS_SET_LETTERS[setIdx];

  const colIdx = colLetters.indexOf(sq[0]);
  const rowIdx = rowLetters.indexOf(sq[1]);
  if (colIdx < 0 || rowIdx < 0) return null;

  const easting100k = (colIdx + 1) * 100000;
  const northing100k = rowIdx * 100000;

  // Find the full northing by finding closest multiple of 2000000 northing
  // that puts us in the right band
  const bandIdx = BAND_LETTERS.indexOf(band);
  if (bandIdx < 0) return null;

  // Band northing range (rough)
  const bandSouthLat = bandIdx * 8 - 80;
  const bandNorthLat = bandSouthLat + 8;
  const hemisphere   = bandSouthLat >= 0 ? "N" : "S";

  // For southern hemisphere, northing is offset by 10000000
  let northing = northing100k + parseInt(nRaw);
  if (hemisphere === "S") northing += 10000000;

  // Adjust northing by 2000000 multiples to land in band
  const candidateNorthings = [-2000000, 0, 2000000, 4000000, 6000000, 8000000].map(d => northing + d);
  let best = null, bestDiff = Infinity;
  for (const cn of candidateNorthings) {
    if (cn < 0) continue;
    const ll = utmToLatLng(zone, band, easting100k + parseInt(eRaw), cn, hemisphere);
    const diff = Math.abs(ll.lat - (bandSouthLat + 4));
    if (diff < bestDiff) { bestDiff = diff; best = { cn, ll }; }
  }
  if (!best) return null;

  return utmToLatLng(zone, band, easting100k + parseInt(eRaw), best.cn, hemisphere);
}

// ── Formatters ───────────────────────────────────────────────────────────────
export function formatUTM({ zone, band, easting, northing }) {
  return `${zone}${band} ${easting}mE ${northing}mN`;
}

export function formatMGRS(lat, lng, precision = 5) {
  return latLngToMGRS(lat, lng, precision);
}

// ── UTM zone boundary lines for grid overlay ─────────────────────────────────
// Returns array of { type:"zone"|"band", coords:[[lat,lng],...] }
export function getUTMGridLines(bounds, zoom) {
  const lines = [];
  const { north, south, west, east } = bounds;

  // Zone lines (every 6° longitude) — only draw visible ones
  const zoneStep = 6;
  const firstZoneLng = Math.floor(west / zoneStep) * zoneStep;
  for (let lng = firstZoneLng; lng <= east + zoneStep; lng += zoneStep) {
    if (lng >= -180 && lng <= 180) {
      lines.push({
        type: "zone",
        coords: [[Math.max(south, -80), lng], [Math.min(north, 84), lng]],
        label: `${utmZone(lng)}`,
        labelLat: (Math.max(south, -80) + Math.min(north, 84)) / 2,
        labelLng: lng,
      });
    }
  }

  // Band lines (every 8° latitude from -80 to 84)
  const bandStep = 8;
  const firstBandLat = Math.floor(Math.max(south, -80) / bandStep) * bandStep;
  for (let lat = firstBandLat; lat <= Math.min(north, 84) + bandStep; lat += bandStep) {
    if (lat >= -80 && lat <= 84) {
      lines.push({
        type: "band",
        coords: [[lat, Math.max(west, -180)], [lat, Math.min(east, 180)]],
        label: latBand(lat),
        labelLat: lat,
        labelLng: (Math.max(west, -180) + Math.min(east, 180)) / 2,
      });
    }
  }

  // At zoom >= 10 draw 100km MGRS squares
  if (zoom >= 10) {
    const latStep = 0.9; // ~100km in degrees
    for (let lat = Math.floor(south) - 1; lat < north + 1; lat += latStep) {
      for (let lng = Math.floor(west) - 6; lng < east + 6; ) {
        const utm = latLngToUTM(lat, lng);
        const cellE = Math.floor(utm.easting / 100000) * 100000;
        const cellN = Math.floor(utm.northing / 100000) * 100000;
        // Draw 4 corners of the 100km cell
        const corners = [];
        for (let de = 0; de <= 100000; de += 100000) {
          for (let dn = 0; dn <= 100000; dn += 100000) {
            const pt = utmToLatLng(utm.zone, utm.band, cellE + de, cellN + dn);
            corners.push([pt.lat, pt.lng]);
          }
        }
        lines.push({
          type: "mgrs100k",
          corners,
          label: utmToMGRS({ zone: utm.zone, band: utm.band, easting: cellE + 50000, northing: cellN + 50000 }, 0).split(" ").slice(0, 2).join(""),
        });
        lng += 6; // move to next zone
        break; // simplified: one per lat row
      }
    }
  }

  return lines;
}