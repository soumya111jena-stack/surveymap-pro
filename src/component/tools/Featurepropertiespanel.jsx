/**
 * FeaturePropertiesPanel.jsx — Geoxis Field Edition v6.6.0
 *
 * FIXED in v6.6.0:
 *  - Live style preview: color/opacity/width changes apply to Leaflet layer in real-time
 *  - _applyStyle hook properly called on every slider/color change via useEffect
 *  - handleOK correctly applies style before closing
 *  - KML/Shapefile/GeoJSON layers all supported via _applyStyle attached in SurveyMap
 *  - Coordinate display respects coordSystem prop (decimalDegrees / dms / decimalMinutes / utm / mgrs)
 */

import { useState, useEffect, useRef } from "react";

/* ─── Style override store ────────────────────────────────────────────────── */
const STYLE_OVERRIDES = new Map();
export function getFeatureStyle(featureId) {
  return featureId != null ? (STYLE_OVERRIDES.get(String(featureId)) ?? null) : null;
}

/* ─── UTM conversion utilities ───────────────────────────────────────────── */
function latLngToUTM(lat, lng) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const e = Math.sqrt(e2);
  const n = (a - b) / (a + b);

  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  let zoneNumber = Math.floor((lng + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zoneNumber = 32;
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) zoneNumber = 31;
    else if (lng >= 9 && lng < 21) zoneNumber = 33;
    else if (lng >= 21 && lng < 33) zoneNumber = 35;
    else if (lng >= 33 && lng < 42) zoneNumber = 37;
  }

  const BANDS = "CDEFGHJKLMNPQRSTUVWXX";
  const bandIdx = Math.min(Math.floor((lat + 80) / 8), 20);
  const band = BANDS[bandIdx] || "Z";

  const centralMeridian = ((zoneNumber - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = (e2 / (1 - e2)) * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lngRad - centralMeridian);

  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad) -
      ((35 * e6) / 3072) * Math.sin(6 * latRad));

  const k0 = 0.9996;
  let easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5) / 120) +
    500000;

  let northing =
    k0 *
    (M +
      N *
        Math.tan(latRad) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6) / 720));

  if (lat < 0) northing += 10000000;

  return {
    zone: zoneNumber,
    band,
    easting: Math.round(easting * 100) / 100,
    northing: Math.round(northing * 100) / 100,
    zoneStr: `${zoneNumber} ${band}`,
  };
}

function utmToLatLng(zone, band, easting, northing) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const k0 = 0.9996;
  const x = easting - 500000;
  let y = northing;

  const isSouth = band < "N";
  if (isSouth) y -= 10000000;

  const centralMeridian = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const M = y / k0;
  const mu =
    M /
    (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = (e2 / (1 - e2)) * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);

  const lat =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * (e2 / (1 - e2))) * D ** 4) / 24 +
        ((61 +
          90 * T1 +
          298 * C1 +
          45 * T1 ** 2 -
          252 * (e2 / (1 - e2)) -
          3 * C1 ** 2) *
          D ** 6) /
          720);

  const lng =
    centralMeridian +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * (e2 / (1 - e2)) + 24 * T1 ** 2) *
        D ** 5) /
        120) /
      Math.cos(phi1);

  return {
    lat: (lat * 180) / Math.PI,
    lng: (lng * 180) / Math.PI,
  };
}

function toDMSStr(deg, posLabel, negLabel) {
  const d = Math.abs(deg);
  const di = Math.floor(d);
  const mA = (d - di) * 60;
  const mi = Math.floor(mA);
  const s = (mA - mi) * 60;
  return `${di}° ${mi.toString().padStart(2, "0")}' ${s.toFixed(2).padStart(5, "0")}" ${deg >= 0 ? posLabel : negLabel}`;
}

function toDDMStr(deg, posLabel, negLabel) {
  const d = Math.abs(deg);
  const di = Math.floor(d);
  const dm = (d - di) * 60;
  return `${di}° ${dm.toFixed(5).padStart(8, "0")}' ${deg >= 0 ? posLabel : negLabel}`;
}

/* ─── Pin icon options ────────────────────────────────────────────────────── */
const ICON_OPTIONS = [
  { key: "pin",     label: "Pin",     svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="#d93025"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/></svg> },
  { key: "circle",  label: "Circle",  svg: <svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#1a73e8" strokeWidth="2.5"/><circle cx="12" cy="12" r="4" fill="#1a73e8"/></svg> },
  { key: "square",  label: "Square",  svg: <svg width="18" height="18" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" fill="#1a73e8"/></svg> },
  { key: "star",    label: "Star",    svg: <svg width="18" height="18" viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="#f59e0b"/></svg> },
  { key: "diamond", label: "Diamond", svg: <svg width="18" height="18" viewBox="0 0 24 24"><polygon points="12,2 22,12 12,22 2,12" fill="#8b5cf6"/></svg> },
  { key: "flag",    label: "Flag",    svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d93025" strokeWidth="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> },
  { key: "info",    label: "Info",    svg: <svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1a73e8"/><line x1="12" y1="16" x2="12" y2="12" stroke="#fff" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="8" x2="12.01" y2="8" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg> },
  { key: "camera",  label: "Camera",  svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5f6368" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg> },
];

/* ─── Color presets ───────────────────────────────────────────────────────── */
const COLOR_PRESETS = [
  "#1a73e8","#d93025","#f9ab00","#1e8e3e","#8ab4f8","#f28b82",
  "#fdd663","#81c995","#c58af9","#ff8bcb","#078d55","#e37400",
  "#ffffff","#000000","#5f6368","#bdc1c6",
];

/* ─── KML helpers ─────────────────────────────────────────────────────────── */
function hexToKmlColor(hex, pct = 100) {
  const h = (hex || "#ff8800").replace("#", "").padEnd(6, "0").slice(0, 6);
  const rr = h.slice(0, 2);
  const gg = h.slice(2, 4);
  const bb = h.slice(4, 6);
  const a = Math.round(Math.max(0, Math.min(100, pct)) / 100 * 255)
              .toString(16).padStart(2, "0");
  // KML color order is AABBGGRR
  return `${a}${bb}${gg}${rr}`;
}
function escXml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function coordsKml(c) { return c.map(p => `${p[0]},${p[1]},${p[2] ?? 0}`).join("\n"); }
function geomKml(g) {
  if (!g) return "";
  if (g.type === "Point") { const [ln, lt, al = 0] = g.coordinates; return `<Point><coordinates>${ln},${lt},${al}</coordinates></Point>`; }
  if (g.type === "LineString") return `<LineString><tessellate>1</tessellate><coordinates>${coordsKml(g.coordinates)}</coordinates></LineString>`;
  if (g.type === "Polygon") {
    const [o, ...holes] = g.coordinates;
    return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsKml(o)}</coordinates></LinearRing></outerBoundaryIs>${holes.map(h => `<innerBoundaryIs><LinearRing><coordinates>${coordsKml(h)}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
  }
  return "";
}
function featureToKml(f, style, name, desc) {
  if (!f) return null;
  const n = escXml(name || f.properties?.name || "Feature");
  const d = escXml(desc || "");
  const g = geomKml(f.geometry);
  if (!g) return null;

  const lc = hexToKmlColor(style?.color ?? "#ff8800", style?.opacity ?? 100);
  const fc = hexToKmlColor(style?.fillColor ?? "#ff8800", style?.fillOpacity ?? 40);
  const w  = style?.width ?? 2;
  const hexColor   = style?.color     ?? "#ff8800";
  const hexFill    = style?.fillColor ?? "#ff8800";
  const opacityFrac  = ((style?.opacity     ?? 100) / 100).toFixed(2);
  const fillOpFrac   = ((style?.fillOpacity ?? 40)  / 100).toFixed(2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${n}</name>
    <Placemark>
      <name>${n}</name>
      <description>${d}</description>
      <Style>
        <LineStyle>
          <color>${lc}</color>
          <width>${w}</width>
        </LineStyle>
        <PolyStyle>
          <color>${fc}</color>
          <fill>1</fill>
          <outline>1</outline>
        </PolyStyle>
        <IconStyle>
          <color>${lc}</color>
          <scale>1.1</scale>
        </IconStyle>
      </Style>
      <ExtendedData>
        <Data name="stroke"><value>${hexColor}</value></Data>
        <Data name="stroke-width"><value>${w}</value></Data>
        <Data name="stroke-opacity"><value>${opacityFrac}</value></Data>
        <Data name="fill"><value>${hexFill}</value></Data>
        <Data name="fill-opacity"><value>${fillOpFrac}</value></Data>
      </ExtendedData>
      ${g}
    </Placemark>
  </Document>
</kml>`;
}
function dlKml(kmlStr, fn) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([kmlStr], { type: "application/vnd.google-earth.kml+xml" })), download: fn });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ─── Geodesy ─────────────────────────────────────────────────────────────── */
function hav(a, b) { const R = 6371000, dLa = (b[1] - a[1]) * Math.PI / 180, dLo = (b[0] - a[0]) * Math.PI / 180, s = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(Math.max(0, s))); }
function rArea(c) { if (!c || c.length < 3) return 0; const R = 6371000; let a = 0; for (let i = 0; i < c.length; i++) { const j = (i + 1) % c.length; a += (c[j][0] - c[i][0]) * Math.PI / 180 * (2 + Math.sin(c[i][1] * Math.PI / 180) + Math.sin(c[j][1] * Math.PI / 180)); } return Math.abs(a * R * R / 2); }
function polyM2(rings) { if (!rings || !rings.length) return 0; let a = rArea(rings[0]); for (let i = 1; i < rings.length; i++) a -= rArea(rings[i]); return Math.max(0, a); }
function perim(c) { if (!c || c.length < 2) return 0; let d = 0; for (let i = 1; i < c.length; i++) d += hav(c[i - 1], c[i]); const l = c[c.length - 1], f = c[0]; if (l[0] !== f[0] || l[1] !== f[1]) d += hav(l, f); return d; }
function lineL(c) { if (!c || c.length < 2) return 0; let d = 0; for (let i = 1; i < c.length; i++) d += hav(c[i - 1], c[i]); return d; }
function strip(c) { if (!c || c.length < 2) return null; const a = parseFloat(c[0]), b = parseFloat(c[1]); return isNaN(a) || isNaN(b) ? null : [a, b]; }
function stripR(r) { return (r || []).map(strip).filter(Boolean); }
function computeStats(geom) {
  if (!geom) return null;
  if (geom.type === "Polygon") { const rings = (geom.coordinates || []).map(stripR); if (!rings[0] || rings[0].length < 3) return null; return { kind: "polygon", areaSqM: polyM2(rings), perimM: perim(rings[0]), coords: rings[0] }; }
  if (geom.type === "MultiPolygon") { let areaSqM = 0, perimM = 0, fc = []; (geom.coordinates || []).forEach(poly => { const rings = poly.map(stripR); if (rings[0]?.length >= 3) { areaSqM += polyM2(rings); perimM += perim(rings[0]); if (!fc.length) fc = rings[0]; } }); if (!fc.length) return null; return { kind: "polygon", areaSqM, perimM, coords: fc }; }
  if (geom.type === "LineString") { const c = (geom.coordinates || []).map(strip).filter(Boolean); if (c.length < 2) return null; return { kind: "line", lengthM: lineL(c), coords: c }; }
  if (geom.type === "Point") { const [ln, lt, al = 0] = geom.coordinates || []; if (isNaN(parseFloat(ln)) || isNaN(parseFloat(lt))) return null; return { kind: "point", lat: parseFloat(lt), lng: parseFloat(ln), alt: parseFloat(al) || 0 }; }
  if (geom.type === "GeometryCollection") { for (const g of (geom.geometries || [])) { const s = computeStats(g); if (s) return s; } }
  return null;
}
function drawingStats(d) {
  if (!d?.points?.length) return null;
  if (d.type === "marker") return { kind: "point", lat: d.points[0]?.lat ?? 0, lng: d.points[0]?.lng ?? 0, alt: 0 };
  const c = d.points.map(p => [p.lng ?? 0, p.lat ?? 0]);
  if (d.type === "polygon" && c.length >= 3) { const r = [...c, c[0]]; return { kind: "polygon", areaSqM: polyM2([r]), perimM: perim(r), coords: r }; }
  return { kind: "line", lengthM: lineL(c), coords: c };
}

/* ─── Units ───────────────────────────────────────────────────────────────── */
const DIST = [{ key: "m", label: "Meters", factor: 1, dp: 3 }, { key: "km", label: "Kilometers", factor: 1e-3, dp: 6 }, { key: "mi", label: "Miles", factor: 1 / 1609.344, dp: 6 }, { key: "ft", label: "Feet", factor: 3.28084, dp: 2 }, { key: "nmi", label: "Nautical Miles", factor: 1 / 1852, dp: 6 }];
const AREA = [{ key: "m2", label: "Square Meters", sym: "m²", factor: 1, dp: 2 }, { key: "km2", label: "Square Kilometers", sym: "km²", factor: 1e-6, dp: 6 }, { key: "ha", label: "Hectares", sym: "ha", factor: 1e-4, dp: 4 }, { key: "ac", label: "Acres", sym: "ac", factor: 1 / 4046.856, dp: 4 }, { key: "ft2", label: "Square Feet", sym: "ft²", factor: 10.7639, dp: 1 }];

function resolveId(f) { if (!f) return null; return String(f._featureId ?? f.id ?? f._id ?? f?.properties?._featureId ?? f?.properties?.id ?? JSON.stringify(f?.geometry?.coordinates?.[0]?.[0] ?? "")); }
function resColor(p, fb = "#ff8800") { if (!p) return fb; for (const raw of [p.stroke, p.color, p["line-color"], p.lineColor, p.fill, p["fill-color"], p.fillColor]) { if (!raw || typeof raw !== "string") continue; const t = raw.trim(); if (/^#[0-9a-f]{3,6}$/i.test(t)) return t; if (/^[0-9a-f]{8}$/i.test(t)) return `#${t.slice(6, 8)}${t.slice(4, 6)}${t.slice(2, 4)}`; } return fb; }
function fmt(v, dp = 3) { if (v == null || isNaN(v)) return "—"; return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
function toDMS(deg, pos, neg) { const d = Math.abs(deg), di = Math.floor(d), mA = (d - di) * 60, mi = Math.floor(mA), s = (mA - mi) * 60; return `${di}°${mi}'${s.toFixed(2)}" ${deg >= 0 ? pos : neg}`; }

/* ─── Floating-label input ────────────────────────────────────────────────── */
function FloatInput({ label, value, onChange, unit, readOnly = false }) {
  const [focused, setFocused] = useState(false);
  const hasVal = value !== "" && value != null;
  const lifted = focused || hasVal;
  return (
    <div style={{ position: "relative", border: `1.5px solid ${focused ? "#1a73e8" : "#dadce0"}`, borderRadius: 4, background: readOnly ? "#f8f9fa" : "#fff", paddingTop: 18, paddingBottom: 8, paddingLeft: 12, paddingRight: unit ? 36 : 12, transition: "border-color 0.15s", boxSizing: "border-box" }}>
      <span style={{ position: "absolute", left: 12, top: lifted ? 5 : "50%", transform: lifted ? "none" : "translateY(-50%)", fontSize: lifted ? 10 : 13, color: focused ? "#1a73e8" : "#5f6368", transition: "top 0.15s, font-size 0.15s, color 0.15s", pointerEvents: "none", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", lineHeight: 1, userSelect: "none" }}>{label}</span>
      <input value={value ?? ""} readOnly={readOnly} onChange={onChange ? e => onChange(e.target.value) : undefined} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ display: "block", width: "100%", border: "none", outline: "none", background: "transparent", fontSize: 13, color: readOnly ? "#5f6368" : "#202124", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", padding: 0, margin: 0, boxSizing: "border-box", lineHeight: 1.4 }} />
      {unit && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-20%)", fontSize: 13, color: "#5f6368", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", pointerEvents: "none" }}>{unit}</span>}
    </div>
  );
}

/* ─── Floating-label select ───────────────────────────────────────────────── */
function FloatSelect({ label, value, onChange, options }) {
  return (
    <div style={{ position: "relative", border: "1.5px solid #dadce0", borderRadius: 4, background: "#fff", paddingTop: 18, paddingBottom: 8, paddingLeft: 12, paddingRight: 36, boxSizing: "border-box" }}>
      <span style={{ position: "absolute", left: 12, top: 5, fontSize: 10, color: "#5f6368", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", pointerEvents: "none", lineHeight: 1 }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ display: "block", width: "100%", border: "none", outline: "none", background: "transparent", fontSize: 13, color: "#202124", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", padding: 0, margin: 0, appearance: "none", cursor: "pointer", lineHeight: 1.4 }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-20%)", fontSize: 16, color: "#5f6368", pointerEvents: "none" }}>▾</span>
    </div>
  );
}

/* ─── Google Earth style outlined dropdown ────────────────────────────────── */
function GEDropdown({ label, value, onChange, options, renderValue }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = options.find(o => o.key === value);
  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <button onClick={() => setOpen(p => !p)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "6px 10px", border: "1.5px solid #dadce0", borderRadius: 4, background: "#fff", cursor: "pointer", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", fontSize: 13, color: "#202124", minHeight: 36 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {renderValue ? renderValue(selected) : selected?.label}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#5f6368"><path d="M7 10l5 5 5-5z" /></svg>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, background: "#fff", border: "1px solid #dadce0", borderRadius: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", zIndex: 9999, maxHeight: 220, overflowY: "auto" }}>
          {options.map(o => (
            <div key={o.key} onClick={() => { onChange(o.key); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", background: value === o.key ? "#e8f0fe" : "transparent", color: value === o.key ? "#1a73e8" : "#202124", fontSize: 13, fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}
              onMouseEnter={e => { if (value !== o.key) e.currentTarget.style.background = "#f1f3f4"; }}
              onMouseLeave={e => { if (value !== o.key) e.currentTarget.style.background = "transparent"; }}>
              {renderValue ? renderValue(o) : o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Color swatch dropdown ───────────────────────────────────────────────── */
function ColorSwatchDropdown({ value, onChange, label = "Color" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ fontSize: 10, color: "#5f6368", marginBottom: 3, fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>{label}</div>
      <button onClick={() => setOpen(p => !p)} style={{ width: 56, height: 36, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px", border: "1.5px solid #dadce0", borderRadius: 4, background: "#fff", cursor: "pointer", gap: 4 }}>
        <div style={{ width: 24, height: 24, borderRadius: 3, background: value, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#5f6368"><path d="M7 10l5 5 5-5z" /></svg>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: "#fff", border: "1px solid #dadce0", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.18)", zIndex: 9999, padding: 12, width: 200 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 4, marginBottom: 10 }}>
            {COLOR_PRESETS.map(c => (
              <button key={c} onClick={() => { onChange(c); setOpen(false); }}
                style={{ width: 20, height: 20, borderRadius: 3, background: c, border: value === c ? "2px solid #1a73e8" : "1px solid rgba(0,0,0,0.15)", cursor: "pointer", padding: 0 }} />
            ))}
          </div>
          <div style={{ borderTop: "1px solid #e8eaed", paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: "#5f6368", marginBottom: 6, fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>Custom</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 32, height: 28, padding: 0, border: "1.5px solid #dadce0", borderRadius: 4, cursor: "pointer" }} />
              <span style={{ fontSize: 11, color: "#5f6368", fontFamily: "monospace" }}>{value?.toUpperCase()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Tab button ──────────────────────────────────────────────────────────── */
function Tab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "10px 14px", fontSize: 12.5, cursor: "pointer", border: "none", borderBottom: `2.5px solid ${active ? "#1a73e8" : "transparent"}`, background: "transparent", color: active ? "#1a73e8" : "#5f6368", fontWeight: active ? 600 : 400, fontFamily: "'Google Sans','Roboto',Arial,sans-serif", transition: "color 0.12s", flexShrink: 0, whiteSpace: "nowrap" }}>{label}</button>
  );
}

/* ─── Copy button ─────────────────────────────────────────────────────────── */
function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1500); }}
      style={{ padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10, border: `1px solid ${ok ? "#34a853" : "#dadce0"}`, background: ok ? "#e6f4ea" : "#f8f9fa", color: ok ? "#137333" : "#5f6368", flexShrink: 0 }}>
      {ok ? "✓" : "⎘"}
    </button>
  );
}

/* ─── Measure rows ────────────────────────────────────────────────────────── */
function MRows({ valueM, units, activeKey }) {
  return units.map(u => {
    const v = valueM * u.factor, d = fmt(v, u.dp ?? 3), isA = u.key === activeKey;
    return (
      <tr key={u.key} style={{ background: isA ? "#e8f0fe" : "transparent" }}>
        <td style={{ padding: "6px 16px", fontSize: isA ? 13 : 11, color: isA ? "#1557b0" : "#5f6368", fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>{u.label}{u.sym ? ` (${u.sym})` : ""}</td>
        <td style={{ padding: "6px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: isA ? "#1a73e8" : "#202124", fontFamily: "'Roboto Mono',monospace", fontSize: isA ? 13 : 11, fontWeight: isA ? 600 : 400, minWidth: 110, textAlign: "right" }}>{d}</span>
            <CopyBtn text={`${d} ${u.label}`} />
          </div>
        </td>
      </tr>
    );
  });
}

/* ─── CoordinateFields ────────────────────────────────────────────────────── */
function CoordinateFields({ coordSystem, lat, lng, setLat, setLng, altitude, setAltitude, grounding }) {
  const [utmZone,     setUtmZone]     = useState(() => latLngToUTM(parseFloat(lat) || 0, parseFloat(lng) || 0).zoneStr);
  const [utmEasting,  setUtmEasting]  = useState(() => latLngToUTM(parseFloat(lat) || 0, parseFloat(lng) || 0).easting.toFixed(2));
  const [utmNorthing, setUtmNorthing] = useState(() => latLngToUTM(parseFloat(lat) || 0, parseFloat(lng) || 0).northing.toFixed(2));

  useEffect(() => {
    const latN = parseFloat(lat), lngN = parseFloat(lng);
    if (!isNaN(latN) && !isNaN(lngN)) {
      const u = latLngToUTM(latN, lngN);
      setUtmZone(u.zoneStr); setUtmEasting(u.easting.toFixed(2)); setUtmNorthing(u.northing.toFixed(2));
    }
  }, [lat, lng]);

  const tryUpdateLatLngFromUTM = (zoneStr, eastStr, northStr) => {
    try {
      const parts = String(zoneStr).trim().split(/\s+/);
      const zone = parseInt(parts[0]), band = parts[1] || "N";
      const e = parseFloat(eastStr), n = parseFloat(northStr);
      if (!isNaN(zone) && !isNaN(e) && !isNaN(n) && zone >= 1 && zone <= 60) {
        const result = utmToLatLng(zone, band, e, n);
        if (!isNaN(result.lat) && !isNaN(result.lng)) { setLat(result.lat.toFixed(7)); setLng(result.lng.toFixed(7)); }
      }
    } catch (_) {}
  };

  const latN = parseFloat(lat) || 0, lngN = parseFloat(lng) || 0;

  if (coordSystem === "utm") {
    return (
      <>
        <FloatInput label="Zone"     value={utmZone}     onChange={v => { setUtmZone(v);     tryUpdateLatLngFromUTM(v, utmEasting, utmNorthing); }} />
        <FloatInput label="Easting"  value={utmEasting}  onChange={v => { setUtmEasting(v);  tryUpdateLatLngFromUTM(utmZone, v, utmNorthing); }} unit="m E" />
        <FloatInput label="Northing" value={utmNorthing} onChange={v => { setUtmNorthing(v); tryUpdateLatLngFromUTM(utmZone, utmEasting, v); }} unit="m N" />
        <FloatInput label="Altitude" value={altitude}    onChange={setAltitude} unit="m" readOnly={grounding === "clamped"} />
      </>
    );
  }
  if (coordSystem === "dms") {
    return (
      <>
        <FloatInput label="Latitude (DMS)"     value={toDMSStr(latN, "N", "S")} readOnly />
        <FloatInput label="Latitude (decimal)" value={lat} onChange={setLat} unit="°" />
        <FloatInput label="Longitude (DMS)"    value={toDMSStr(lngN, "E", "W")} readOnly />
        <FloatInput label="Longitude (decimal)"value={lng} onChange={setLng} unit="°" />
        <FloatInput label="Altitude"           value={altitude} onChange={setAltitude} unit="m" readOnly={grounding === "clamped"} />
      </>
    );
  }
  if (coordSystem === "decimalMinutes") {
    return (
      <>
        <FloatInput label="Latitude (DDM)"     value={toDDMStr(latN, "N", "S")} readOnly />
        <FloatInput label="Latitude (decimal)" value={lat} onChange={setLat} unit="°" />
        <FloatInput label="Longitude (DDM)"    value={toDDMStr(lngN, "E", "W")} readOnly />
        <FloatInput label="Longitude (decimal)"value={lng} onChange={setLng} unit="°" />
        <FloatInput label="Altitude"           value={altitude} onChange={setAltitude} unit="m" readOnly={grounding === "clamped"} />
      </>
    );
  }
  return (
    <>
      <FloatInput label="Latitude"  value={lat}      onChange={setLat}      unit="°" />
      <FloatInput label="Longitude" value={lng}      onChange={setLng}      unit="°" />
      <FloatInput label="Altitude"  value={altitude} onChange={setAltitude} unit="m" readOnly={grounding === "clamped"} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════ */
export default function FeaturePropertiesPanel({
  drawing,
  geojsonFeature,
  isNewPoint = false,
  onClose,
  onSave,
  onDelete,
  coordSystem = "decimalDegrees",
}) {
  const isDrawing = !!drawing;
  const nameRef = useRef(null);

  const rawName = isDrawing
    ? (drawing.name || "Untitled placemark")
    : (geojsonFeature?.properties?.name || geojsonFeature?.properties?.Name || geojsonFeature?.properties?.NAME || geojsonFeature?._name || "Untitled placemark");
  const rawDesc = isDrawing
    ? (drawing.description || "")
    : (geojsonFeature?.properties?.description || geojsonFeature?.properties?.Description || "");

  const stats    = isDrawing ? drawingStats(drawing) : computeStats(geojsonFeature?.geometry);
  const props    = geojsonFeature?.properties || {};
  const fileType = geojsonFeature?._fileType || "";
  const fileName = geojsonFeature?._fileName || "";
  const fid      = isDrawing ? null : resolveId(geojsonFeature);
  const savedOv  = fid ? STYLE_OVERRIDES.get(fid) : null;

  const rawColor   = isDrawing ? (drawing.color     || "#1a73e8") : resColor(props,              "#1a73e8");
  const rawFill    = isDrawing ? (drawing.fillColor  || "#1a73e8") : resColor({ ...props, stroke: undefined }, "#1a73e8");
  const rawWidth   = isDrawing ? (drawing.width   ?? 2)  : (props["stroke-width"] ?? props.strokeWidth ?? 2);
  const rawOp      = isDrawing ? (drawing.opacity ?? 100) : (props["stroke-opacity"] != null ? Math.round(props["stroke-opacity"] * 100) : 100);
  const rawFillOp  = isDrawing ? (drawing.fillOpacity ?? 40) : (props["fill-opacity"] != null ? Math.round(props["fill-opacity"] * 100) : 40);

  const initC = (() => {
    if (stats?.kind === "point") return { lat: stats.lat, lng: stats.lng, alt: stats.alt || 0 };
    if (stats?.coords?.[0]) return { lat: stats.coords[0][1], lng: stats.coords[0][0], alt: 0 };
    if (drawing?.points?.[0]) { const p = drawing.points[0]; return { lat: p.lat ?? 0, lng: p.lng ?? 0, alt: 0 }; }
    return { lat: 0, lng: 0, alt: 0 };
  })();

  /* ── State ─────────────────────────────────────────────────────────────── */
  const [name,        setName]      = useState(rawName);
  const [desc,        setDesc]      = useState(rawDesc);
  const [lat,         setLat]       = useState(initC.lat.toFixed(7));
  const [lng,         setLng]       = useState(initC.lng.toFixed(7));
  const [altitude,    setAltitude]  = useState(initC.alt.toFixed(7));
  const [grounding,   setGnd]       = useState("clamped");
  const [heading,     setHeading]   = useState("0.0000000");
  const [tilt,        setTilt]      = useState("0.0000000");
  const [range,       setRange]     = useState("1031.2695758");

  // ── Style state — initialised from savedOv (persisted) or raw feature values ──
  const [color,     setColor]    = useState(savedOv?.color       ?? rawColor);
  const [fillColor, setFillColor]= useState(savedOv?.fillColor   ?? rawFill);
  const [width,     setWidth]    = useState(savedOv?.width       ?? rawWidth);
  const [opacity,   setOpacity]  = useState(savedOv?.opacity     ?? rawOp);
  const [fillOp,    setFillOp]   = useState(savedOv?.fillOpacity ?? rawFillOp);

  const [tab,       setTab]      = useState("Placemark");
  const [areaUnit,  setAreaUnit] = useState("m2");
  const [perimUnit, setPerimUnit]= useState("m");
  const [lenUnit,   setLenUnit]  = useState("m");
  const [saved,     setSaved]    = useState(false);

  const [iconKey,          setIconKey]          = useState(savedOv?.iconKey  ?? drawing?.iconKey  ?? "pin");
  const [iconSize,         setIconSize]         = useState(savedOv?.iconSize ?? drawing?.iconSize ?? "medium");
  const [iconColor,        setIconColor]        = useState(savedOv?.iconColor ?? rawColor);
  const [labelsEnabled,    setLabelsEnabled]    = useState(true);
  const [labelSize,        setLabelSize]        = useState("medium");
  const [labelColor,       setLabelColor]       = useState("#ffffff");
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(true);

  const featureKind = stats?.kind || (drawing?.type === "marker" ? "point" : drawing?.type === "polygon" ? "polygon" : "line");

  /* ── Focus name on new point ────────────────────────────────────────────── */
  useEffect(() => { if (isNewPoint && nameRef.current) { nameRef.current.focus(); nameRef.current.select(); } }, [isNewPoint]);

  /* ── Escape key closes ──────────────────────────────────────────────────── */
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  /* ══════════════════════════════════════════════════════════════════════════
     LIVE PREVIEW — apply style to the Leaflet layer in real-time as the user
     moves sliders or picks colors. Works for KML, Shapefile, GeoJSON features.
     The layer must have _applyStyle attached (done in SurveyMap's
     attachFeatureClickHandlers). For drawings, savedDrawings state drives
     re-render so no extra step is needed here.
  ══════════════════════════════════════════════════════════════════════════ */
useEffect(() => {
  if (isDrawing) return;

  const stylePayload = { color, width, opacity, fillColor, fillOpacity: fillOp, iconColor: color };

  // Apply to the feature's own layer (markers, single polygons)
  if (typeof geojsonFeature?._applyStyle === "function") {
    geojsonFeature._applyStyle(stylePayload);
  }

  // Also walk any _leafletLayer or _parentLayer group that was stored
  const parentLayer = geojsonFeature?._leafletLayer ?? geojsonFeature?._parentLayer;
  if (parentLayer && typeof parentLayer.eachLayer === "function") {
    parentLayer.eachLayer((child) => {
      if (typeof child._applyStyle === "function") child._applyStyle(stylePayload);
    });
  }
}, [color, width, opacity, fillColor, fillOp, isDrawing, geojsonFeature]);

  /* ── buildStyleOv helper ────────────────────────────────────────────────── */
  const buildStyleOv = () => ({
    color, width, opacity,
    fillColor, fillOpacity: fillOp,
    iconKey, iconSize, iconColor,
    labelColor, labelSize,
  });

  /* ── handleOK ───────────────────────────────────────────────────────────── */
  const handleOK = () => {
    const styleOv = buildStyleOv();

    if (isDrawing) {
      // Drawings: pass full updated drawing to parent; SavedDrawingsLayer re-renders
      onSave?.({
        ...drawing,
        name,
        description: desc,
        color,
        width,
        opacity,
        fillColor,
        fillOpacity: fillOp,
        iconKey,
        iconSize,
      });
    } else {
      // GeoJSON / KML / Shapefile features
      // 1. Persist override so re-opens show the edited style
      if (fid) STYLE_OVERRIDES.set(fid, styleOv);

      // 2. Mutate GeoJSON properties for downstream consumers
      if (geojsonFeature?.properties) {
        Object.assign(geojsonFeature.properties, {
          name,
          description:      desc,
          stroke:           color,
          color:            color,
          "stroke-width":   width,
          "stroke-opacity": opacity / 100,
          fill:             fillColor,
          "fill-opacity":   fillOp / 100,
        });
      }

      // 3. Apply to Leaflet layer one final time (covers edge case where
      //    the live-preview effect fired before the final values settled)
      if (typeof geojsonFeature?._applyStyle === "function") {
        geojsonFeature._applyStyle(styleOv);
      }

      // 4. Export KML for KML/KMZ source files
      if (fileType === "kml" || fileType === "kmz") {
        const k = featureToKml(geojsonFeature, styleOv, name, desc);
        if (k) dlKml(k, `${(fileName || "feature").replace(/\.(kml|kmz)$/i, "")}_edited.kml`);
      }

      onSave?.({
        _featureId: fid,
        _fileType:  fileType,
        _fileName:  fileName,
        name,
        description: desc,
        style: styleOv,
      });
    }

    setSaved(true);
    setTimeout(() => onClose?.(), 350);
  };

  /* ── Constants ──────────────────────────────────────────────────────────── */
  const TABS = [
    { id: "Placemark",    label: "Placemark"    },
    { id: "Style",        label: "Style, Color" },
    { id: "View",         label: "View"         },
    { id: "Altitude",     label: "Altitude"     },
    { id: "Measurements", label: "Measurements" },
    { id: "Description",  label: "Description"  },
  ];
  const GND = [
    { value: "clamped",  label: "Clamp to ground"    },
    { value: "relative", label: "Relative to ground" },
    { value: "absolute", label: "Absolute"            },
  ];
  const SIZE_OPTIONS = [
    { key: "small",  label: "Small"            },
    { key: "medium", label: "Medium (default)" },
    { key: "large",  label: "Large"            },
  ];

  /* ── TopIconRow ─────────────────────────────────────────────────────────── */
  const TopIconRow = () => (
    <div style={{ padding: "12px 16px 0", borderBottom: "1px solid #e8eaed" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 12 }}>
        <button onClick={() => setTab("Description")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: 0, background: "none", border: "none", color: "#1a73e8", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Description
        </button>
        <button style={{ display: "flex", alignItems: "center", gap: 6, padding: 0, background: "none", border: "none", color: "#1a73e8", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Media
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: "0 0 80px" }}>
          <div style={{ fontSize: 10, color: "#5f6368", marginBottom: 3, fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>Icon</div>
          <GEDropdown value={iconKey} onChange={setIconKey} options={ICON_OPTIONS} renderValue={opt => opt ? <span style={{ display: "flex", alignItems: "center" }}>{opt.svg}</span> : null} />
        </div>
        <div style={{ flex: "0 0 140px" }}>
          <div style={{ fontSize: 10, color: "#5f6368", marginBottom: 3, fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>Icon size</div>
          <GEDropdown value={iconSize} onChange={setIconSize} options={SIZE_OPTIONS} renderValue={opt => opt ? <span style={{ fontSize: 13, color: "#202124", fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>{opt.label}</span> : null} />
        </div>
        <ColorSwatchDropdown value={iconColor} onChange={v => { setIconColor(v); setColor(v); }} label="Color" />
      </div>

      <button onClick={() => setMoreSettingsOpen(p => !p)}
        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", fontSize: 13, fontWeight: 500, color: "#202124", textAlign: "left" }}>
        More settings
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#5f6368" style={{ marginLeft: "auto", transform: moreSettingsOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {moreSettingsOpen && (
        <div style={{ paddingBottom: 12, borderTop: "1px solid #f1f3f4", paddingTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: "#202124", fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>Labels</span>
            <button onClick={() => setLabelsEnabled(p => !p)}
              style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", background: labelsEnabled ? "#1a73e8" : "#bdc1c6", position: "relative", transition: "background 0.15s", padding: 0, flexShrink: 0 }}>
              <span style={{ position: "absolute", top: 2, left: labelsEnabled ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
            </button>
          </div>
          {labelsEnabled && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#5f6368", marginBottom: 3, fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>Label size</div>
                <GEDropdown value={labelSize} onChange={setLabelSize} options={SIZE_OPTIONS} renderValue={opt => opt ? <span style={{ fontSize: 13, color: "#202124", fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>{opt.label}</span> : null} />
              </div>
              <ColorSwatchDropdown value={labelColor} onChange={setLabelColor} label="Color" />
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9700, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingTop: 72, paddingRight: 10, fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.25)", width: 440, maxHeight: "calc(100vh - 88px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px 10px", borderBottom: "1px solid #e8eaed", flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#e8f0fe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" strokeWidth="2" strokeLinecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
          <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleOK(); if (e.key === "Escape") onClose?.(); }}
            placeholder="Untitled placemark"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 15, fontWeight: 500, color: "#202124", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", background: "transparent", padding: 0, minWidth: 0 }} />
          <button style={{ background: "none", border: "none", color: "#5f6368", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px" }}>⋮</button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5f6368", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 0, display: "flex", alignItems: "center" }}>×</button>
        </div>

        {/* ── Icon/label controls ── */}
        <TopIconRow />

        {/* ── Tabs ── */}
        <div style={{ display: "flex", borderBottom: "1px solid #e8eaed", overflowX: "auto", flexShrink: 0 }}>
          {TABS.map(t => <Tab key={t.id} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} />)}
        </div>

        {/* ── Content ── */}
        <div style={{ flex: 1, overflowY: "auto", background: "#fff" }}>

          {/* ══ PLACEMARK TAB ══ */}
          {tab === "Placemark" && (
            <div style={{ padding: "20px 16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#202124", marginBottom: 4 }}>Placemark placement</div>
              <CoordinateFields
                coordSystem={coordSystem} lat={lat} lng={lng}
                setLat={setLat} setLng={setLng}
                altitude={altitude} setAltitude={setAltitude}
                grounding={grounding}
              />
              <FloatSelect label="Grounding" value={grounding} onChange={setGnd} options={GND} />
              <div style={{ fontSize: 13, fontWeight: 500, color: "#202124", marginTop: 14, marginBottom: 4 }}>Camera view</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FloatInput label="Heading" value={heading} onChange={setHeading} unit="°" />
                <FloatInput label="Tilt"    value={tilt}    onChange={setTilt}    unit="°" />
              </div>
              <FloatInput label="Range" value={range} onChange={setRange} unit="m" />
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: "#5f6368" }}>Coordinate system:</span>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: coordSystem === "utm" ? "#fce8e6" : "#e8f0fe", color: coordSystem === "utm" ? "#d93025" : "#1a73e8", fontFamily: "'Roboto Mono',monospace" }}>
                  {coordSystem === "decimalDegrees" ? "Decimal Degrees" : coordSystem === "dms" ? "Deg Min Sec" : coordSystem === "decimalMinutes" ? "Deg Decimal Min" : coordSystem === "utm" ? "UTM" : coordSystem === "mgrs" ? "MGRS" : coordSystem}
                </span>
              </div>
            </div>
          )}

          {/* ══ STYLE TAB ══ */}
          {tab === "Style" && (
            <div style={{ padding: "20px 16px" }}>

              {/* Live preview strip */}
              <div style={{ marginBottom: 16, borderRadius: 6, overflow: "hidden", border: "1px solid #e8eaed" }}>
                <div style={{ height: Math.max(4, width * 2.5), background: color, opacity: opacity / 100, transition: "height 0.1s, background 0.1s, opacity 0.1s" }} />
                {featureKind === "polygon" && (
                  <div style={{ height: 32, background: fillColor, opacity: fillOp / 100, transition: "background 0.1s, opacity 0.1s" }} />
                )}
                <div style={{ padding: "4px 10px", background: "#f8f9fa", color: "#5f6368", fontSize: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>Line: <b style={{ color: "#1a73e8" }}>{color.toUpperCase()}</b> · {width}px · {opacity}%</span>
                  {featureKind === "polygon" && (
                    <span>Fill: <b style={{ color: "#1a73e8" }}>{fillColor.toUpperCase()}</b> · {fillOp}%</span>
                  )}
                </div>
              </div>

              {/* ── Line style ── */}
              <p style={{ fontSize: 11, fontWeight: 600, color: "#5f6368", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>Line style</p>
              <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 14, alignItems: "center", marginBottom: 20 }}>
                <label style={{ fontSize: 13, color: "#202124" }}>Color</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="color" value={color} onChange={e => { setColor(e.target.value); setIconColor(e.target.value); }}
                    style={{ width: 36, height: 28, padding: 0, border: "1.5px solid #dadce0", borderRadius: 4, cursor: "pointer" }} />
                  <span style={{ fontSize: 12, color: "#5f6368", fontFamily: "monospace" }}>{color.toUpperCase()}</span>
                  {/* Preset swatches inline for quick pick */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
                    {COLOR_PRESETS.slice(0, 8).map(c => (
                      <button key={c} onClick={() => { setColor(c); setIconColor(c); }}
                        title={c}
                        style={{ width: 18, height: 18, borderRadius: 3, background: c, border: color === c ? "2px solid #1a73e8" : "1px solid rgba(0,0,0,0.15)", cursor: "pointer", padding: 0, flexShrink: 0 }} />
                    ))}
                  </div>
                </div>

                <label style={{ fontSize: 13, color: "#202124" }}>Width</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="range" min={1} max={12} value={width} onChange={e => setWidth(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "#1a73e8" }} />
                  <span style={{ fontSize: 13, color: "#202124", minWidth: 20 }}>{width}</span>
                </div>

                <label style={{ fontSize: 13, color: "#202124" }}>Opacity</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="range" min={0} max={100} value={opacity} onChange={e => setOpacity(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "#1a73e8" }} />
                  <span style={{ fontSize: 13, color: "#202124", minWidth: 36 }}>{opacity}%</span>
                </div>
              </div>

              {/* ── Area fill (polygon only) ── */}
              {featureKind === "polygon" && (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: "#5f6368", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>Area fill</p>
                  <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 14, alignItems: "center" }}>
                    <label style={{ fontSize: 13, color: "#202124" }}>Fill color</label>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <input type="color" value={fillColor} onChange={e => setFillColor(e.target.value)}
                        style={{ width: 36, height: 28, padding: 0, border: "1.5px solid #dadce0", borderRadius: 4, cursor: "pointer" }} />
                      <span style={{ fontSize: 12, color: "#5f6368", fontFamily: "monospace" }}>{fillColor.toUpperCase()}</span>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
                        {COLOR_PRESETS.slice(0, 8).map(c => (
                          <button key={c} onClick={() => setFillColor(c)}
                            title={c}
                            style={{ width: 18, height: 18, borderRadius: 3, background: c, border: fillColor === c ? "2px solid #1a73e8" : "1px solid rgba(0,0,0,0.15)", cursor: "pointer", padding: 0, flexShrink: 0 }} />
                        ))}
                      </div>
                    </div>

                    <label style={{ fontSize: 13, color: "#202124" }}>Fill opacity</label>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <input type="range" min={0} max={100} value={fillOp} onChange={e => setFillOp(Number(e.target.value))}
                        style={{ flex: 1, accentColor: "#1a73e8" }} />
                      <span style={{ fontSize: 13, color: "#202124", minWidth: 36 }}>{fillOp}%</span>
                    </div>
                  </div>
                </>
              )}

              {/* Live-preview notice */}
              {!isDrawing && (
                <div style={{ marginTop: 16, padding: "8px 12px", background: "#e8f5e9", borderRadius: 6, border: "1px solid #c8e6c9", display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#34a853"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
                  <span style={{ fontSize: 11, color: "#2e7d32", fontFamily: "'Google Sans','Roboto',Arial,sans-serif" }}>
                    Changes preview live on the map — click <b>Done</b> to save.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ══ VIEW TAB ══ */}
          {tab === "View" && (
            <div style={{ padding: "20px 16px" }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: "#202124", margin: "0 0 14px" }}>View position</p>
              {[
                ["Center latitude",   initC.lat.toFixed(8) + "°"],
                ["Center longitude",  initC.lng.toFixed(8) + "°"],
                ["Coordinate system", "WGS-84 (EPSG:4326)"],
                ["Heading",           heading + "°"],
                ["Tilt",              tilt + "°"],
                ["Range",             range + " m"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #f1f3f4" }}>
                  <span style={{ fontSize: 13, color: "#5f6368" }}>{k}</span>
                  <span style={{ fontSize: 13, color: "#202124", fontFamily: "'Roboto Mono',monospace" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* ══ ALTITUDE TAB ══ */}
          {tab === "Altitude" && (
            <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: "#202124", margin: 0 }}>Altitude mode</p>
              {GND.map(o => (
                <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                  <input type="radio" name="altmode" value={o.value} checked={grounding === o.value} onChange={() => setGnd(o.value)} style={{ accentColor: "#1a73e8", width: 16, height: 16 }} />
                  <span style={{ fontSize: 13, color: "#202124" }}>{o.label}</span>
                </label>
              ))}
              <FloatInput label="Altitude" value={altitude} onChange={setAltitude} unit="m" readOnly={grounding === "clamped"} />
              {grounding === "clamped" && <p style={{ fontSize: 11, color: "#5f6368", margin: "-4px 0 0", fontStyle: "italic" }}>Altitude is ignored when clamped to ground.</p>}
            </div>
          )}

          {/* ══ MEASUREMENTS TAB ══ */}
          {tab === "Measurements" && (
            <div>
              {!stats && <div style={{ padding: "40px 20px", textAlign: "center", color: "#5f6368", fontSize: 13 }}>No geometry available.</div>}

              {stats?.kind === "point" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr><td colSpan={2} style={{ padding: "10px 16px 6px", fontSize: 11, fontWeight: 600, color: "#5f6368", letterSpacing: "0.08em", background: "#f8f9fa", borderBottom: "1px solid #e8eaed", textTransform: "uppercase" }}>Position</td></tr>
                  </thead>
                  <tbody>
                    {[
                      ["Latitude",  `${stats.lat.toFixed(8)}°`, stats.lat.toFixed(8)],
                      ["Longitude", `${stats.lng.toFixed(8)}°`, stats.lng.toFixed(8)],
                      ["Altitude",  `${(stats.alt || 0).toFixed(2)} m`, `${(stats.alt || 0).toFixed(2)} m`],
                    ].map(([lbl, val, cp]) => (
                      <tr key={lbl} style={{ borderBottom: "1px solid #f1f3f4" }}>
                        <td style={{ padding: "10px 16px", fontSize: 13, color: "#5f6368", width: 130 }}>{lbl}</td>
                        <td style={{ padding: "10px 8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, color: "#1a73e8", fontFamily: "'Roboto Mono',monospace", fontWeight: 500, minWidth: 120, textAlign: "right" }}>{val}</span>
                            <CopyBtn text={cp} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {coordSystem === "utm" && (() => {
                      const u = latLngToUTM(stats.lat, stats.lng);
                      return [
                        ["UTM Zone",  u.zoneStr,                     u.zoneStr],
                        ["Easting",   `${u.easting.toFixed(2)} m E`, `${u.easting.toFixed(2)} m E`],
                        ["Northing",  `${u.northing.toFixed(2)} m N`,`${u.northing.toFixed(2)} m N`],
                      ].map(([lbl, val, cp]) => (
                        <tr key={lbl} style={{ borderBottom: "1px solid #f1f3f4", background: "#fffde7" }}>
                          <td style={{ padding: "10px 16px", fontSize: 13, color: "#5f6368", width: 130 }}>{lbl}</td>
                          <td style={{ padding: "10px 8px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 13, color: "#e37400", fontFamily: "'Roboto Mono',monospace", fontWeight: 500, minWidth: 120, textAlign: "right" }}>{val}</span>
                              <CopyBtn text={cp} />
                            </div>
                          </td>
                        </tr>
                      ));
                    })()}
                    <tr>
                      <td colSpan={2} style={{ padding: "8px 16px", fontSize: 11, color: "#5f6368", fontFamily: "monospace", background: "#f8f9fa", borderTop: "1px solid #e8eaed" }}>
                        {toDMS(stats.lat, "N", "S")} &nbsp; {toDMS(stats.lng, "E", "W")}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}

              {stats?.kind === "polygon" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <td colSpan={2} style={{ padding: "10px 16px 6px", fontSize: 11, fontWeight: 600, color: "#5f6368", letterSpacing: "0.08em", background: "#f8f9fa", borderBottom: "1px solid #e8eaed", textTransform: "uppercase" }}>
                        Area&nbsp;
                        <select value={areaUnit} onChange={e => setAreaUnit(e.target.value)} style={{ fontSize: 10, border: "1px solid #dadce0", borderRadius: 4, padding: "1px 4px", color: "#202124" }}>
                          {AREA.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  </thead>
                  <tbody><MRows valueM={stats.areaSqM} units={AREA} activeKey={areaUnit} /></tbody>
                  <thead>
                    <tr>
                      <td colSpan={2} style={{ padding: "10px 16px 6px", fontSize: 11, fontWeight: 600, color: "#5f6368", letterSpacing: "0.08em", background: "#f8f9fa", borderBottom: "1px solid #e8eaed", borderTop: "1px solid #e8eaed", textTransform: "uppercase" }}>
                        Perimeter&nbsp;
                        <select value={perimUnit} onChange={e => setPerimUnit(e.target.value)} style={{ fontSize: 10, border: "1px solid #dadce0", borderRadius: 4, padding: "1px 4px", color: "#202124" }}>
                          {DIST.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    <MRows valueM={stats.perimM} units={DIST} activeKey={perimUnit} />
                    <tr><td colSpan={2} style={{ padding: "8px 16px", fontSize: 11, color: "#5f6368", fontFamily: "monospace", background: "#f8f9fa", borderTop: "1px solid #e8eaed" }}>WGS-84 · Spherical Haversine</td></tr>
                  </tbody>
                </table>
              )}

              {stats?.kind === "line" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <td colSpan={2} style={{ padding: "10px 16px 6px", fontSize: 11, fontWeight: 600, color: "#5f6368", letterSpacing: "0.08em", background: "#f8f9fa", borderBottom: "1px solid #e8eaed", textTransform: "uppercase" }}>
                        Length&nbsp;
                        <select value={lenUnit} onChange={e => setLenUnit(e.target.value)} style={{ fontSize: 10, border: "1px solid #dadce0", borderRadius: 4, padding: "1px 4px", color: "#202124" }}>
                          {DIST.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    <MRows valueM={stats.lengthM} units={DIST} activeKey={lenUnit} />
                    <tr><td colSpan={2} style={{ padding: "8px 16px", fontSize: 11, color: "#5f6368", fontFamily: "monospace", background: "#f8f9fa", borderTop: "1px solid #e8eaed" }}>WGS-84 · Spherical Haversine</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ══ DESCRIPTION TAB ══ */}
          {tab === "Description" && (
            <div style={{ padding: "20px 16px" }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: "#5f6368", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>Description</p>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Add a description…" rows={4}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1.5px solid #dadce0", borderRadius: 4, fontSize: 13, color: "#202124", resize: "vertical", fontFamily: "'Google Sans','Roboto',Arial,sans-serif", outline: "none" }}
                onFocus={e => e.target.style.borderColor = "#1a73e8"} onBlur={e => e.target.style.borderColor = "#dadce0"} />
              {Object.keys(props).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: "#5f6368", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 8px" }}>Attributes ({Object.keys(props).length})</p>
                  <div style={{ border: "1px solid #e8eaed", borderRadius: 6, overflow: "hidden" }}>
                    {Object.entries(props)
                      .filter(([k]) => !["styleUrl", "styleHash", "Style"].includes(k))
                      .slice(0, 20)
                      .map(([k, v], i, arr) => (
                        <div key={k} style={{ display: "flex", alignItems: "center", padding: "7px 12px", borderBottom: i < arr.length - 1 ? "1px solid #f1f3f4" : "none", gap: 10, background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                          <span style={{ color: "#5f6368", fontSize: 11, width: 110, flexShrink: 0, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
                          <span style={{ color: "#202124", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(v ?? "—")}</span>
                          <CopyBtn text={String(v ?? "")} />
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #e8eaed", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: "#fff" }}>
          <button onClick={handleOK}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 26px", borderRadius: 24, cursor: "pointer", background: saved ? "#34a853" : "#1a73e8", border: "none", color: "#fff", fontSize: 14, fontWeight: 500, fontFamily: "'Google Sans','Roboto',Arial,sans-serif", boxShadow: "0 2px 8px rgba(26,115,232,0.32)", transition: "background 0.2s" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            {saved ? "Saved!" : "Done"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#5f6368", fontSize: 12 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="#34a853" strokeWidth="1.5" />
              <path d="M8 11.5l3 3 5-5" stroke="#34a853" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Saved to Google Drive
          </div>

          {isDrawing && onDelete && (
            <button onClick={onDelete}
              style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 20, cursor: "pointer", background: "transparent", border: "1px solid #dadce0", color: "#d93025", fontSize: 12, fontFamily: "'Google Sans','Roboto',Arial,sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d93025" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
              Delete
            </button>
          )}
        </div>

      </div>
    </div>
  );
}