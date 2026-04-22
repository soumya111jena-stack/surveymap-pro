/**
 * exportUtils.js — Geoxic (FIXED)
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES:
 *
 *  1. KML <name> tag — was broken as <n> in ALL placemarks and the Document.
 *     This caused KML files to have no names in Google Earth / QGIS / any
 *     KML parser. Fixed to correct <name>...</name> throughout.
 *
 *  2. KML polygon ring closed properly — LinearRing must repeat first point
 *     as last point per KML spec. Added explicit closure.
 *
 *  3. KML coordinates order — KML is (longitude,latitude,altitude) per spec.
 *     Was already correct but now explicitly documented.
 *
 *  4. KMZ binary encoding — JSZip generateAsync type:"uint8array" then
 *     passed to downloadFile which handles Uint8Array correctly.
 *
 *  5. GeoJSON polygon — coordinates array uses [[...pts, pts[0]]] (closed ring),
 *     already correct, but added null-guard for empty points arrays.
 *
 *  6. CSV export — all values quoted and commas/newlines in values escaped.
 *
 *  7. normPt — handles both {lat,lng} objects and [lat,lng] arrays safely;
 *     added NaN guard so corrupt points don't produce invalid coordinates.
 *
 *  8. escXml — now also escapes single quotes (') with &apos;
 *
 *  9. All export functions return the downloadFile promise so callers can
 *     await them if needed.
 */

import JSZip from "jszip";

/* ─────────────────────────────────────────────────────────────────────────────
   Environment detection
───────────────────────────────────────────────────────────────────────────── */
function isCapacitor() {
  try {
    return !!(
      window.Capacitor?.isNativePlatform?.() === true ||
      window.Capacitor?.platform === "android" ||
      window.Capacitor?.platform === "ios" ||
      window.Capacitor?.isPluginAvailable?.("Filesystem")
    );
  } catch (_) { return false; }
}

function isAndroidWebView() {
  return /Android/i.test(navigator.userAgent) && !isCapacitor();
}

/* ─────────────────────────────────────────────────────────────────────────────
   Base64 encoding — handles string, Uint8Array, ArrayBuffer
───────────────────────────────────────────────────────────────────────────── */
function toBase64(content) {
  if (content instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < content.byteLength; i++) bin += String.fromCharCode(content[i]);
    return btoa(bin);
  }
  if (content instanceof ArrayBuffer) return toBase64(new Uint8Array(content));
  // String content
  try {
    return btoa(
      encodeURIComponent(String(content))
        .replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    );
  } catch (_) {
    return btoa(unescape(encodeURIComponent(String(content))));
  }
}

/* Timestamp suffix e.g. "20250318-1406" */
function stamp() {
  const d = new Date(), z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   normPt — normalise a point to { lat, lng }
   Handles: { lat, lng }  (new format)
            [lat, lng]    (legacy array format)
   Returns null if coordinates are invalid.
───────────────────────────────────────────────────────────────────────────── */
function normPt(p) {
  let lat, lng;
  if (Array.isArray(p)) {
    lat = parseFloat(p[0]);
    lng = parseFloat(p[1]);
  } else {
    lat = parseFloat(p?.lat);
    lng = parseFloat(p?.lng);
  }
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

/* ─────────────────────────────────────────────────────────────────────────────
   XML/KML helpers
───────────────────────────────────────────────────────────────────────────── */
function escXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");  // FIX: also escape single quotes
}

// Convert #RRGGBB hex color to KML aabbggrr format (alpha=ff = fully opaque)
function kmlColor(hex = "#f97316") {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `ff${b}${g}${r}`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   downloadFile — handles Capacitor, Android WebView, and desktop browser
───────────────────────────────────────────────────────────────────────────── */
export async function downloadFile(content, filename, mime) {

  /* ── PATH 1: Capacitor native (real Android / iOS APK) ────────────────── */
  if (isCapacitor()) {
    let Filesystem, Directory, Share;
    try {
      ({ Filesystem, Directory } = await import("@capacitor/filesystem"));
      ({ Share } = await import("@capacitor/share"));
    } catch (_) {
      alert(
        "Export plugins not installed.\n\n" +
        "Run:\n  npm install @capacitor/filesystem @capacitor/share\n" +
        "  npx cap sync android"
      );
      return { success: false };
    }

    try {
      await Filesystem.requestPermissions();
    } catch (_) {} // not needed on Android 10+

    const base64 = toBase64(content);
    const filePath = `SurveyMapPro/${filename}`;
    const writeTargets = [Directory.Documents, Directory.ExternalStorage, Directory.Cache].filter(Boolean);
    let fileUri = null;
    let lastError = null;

    for (const dir of writeTargets) {
      try {
        const result = await Filesystem.writeFile({ path: filePath, data: base64, directory: dir, recursive: true });
        if (result?.uri) { fileUri = result.uri; break; }
      } catch (e) { lastError = e; }
    }

    if (!fileUri) {
      alert(`Could not save file.\n\nError: ${lastError?.message || lastError}`);
      return { success: false, error: lastError };
    }

    try {
      const cs = await Share.canShare();
      if (cs?.value !== false) {
        await Share.share({ title: filename, text: `Geoxis — ${filename}`, url: fileUri });
      } else {
        alert(`File saved!\nFiles app → Documents → Geoxis  → ${filename}`);
      }
    } catch (shareErr) {
      const dismissed = ["Share canceled", "shareSheet: canceled"].some(m => shareErr?.message?.includes(m));
      if (!dismissed) alert(`File saved!\nFiles app → Documents → SurveyMapPro → ${filename}`);
    }
    return { success: true, uri: fileUri };
  }

  /* ── PATH 2: Android WebView ───────────────────────────────────────────── */
  if (isAndroidWebView()) {
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([content], filename, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: filename, files: [file] });
          return { success: true };
        }
      } catch (e) { if (e.name !== "AbortError") console.warn("[Export] Web Share failed:", e); }
    }
    try {
      let dataUri;
      if (typeof content === "string") {
        dataUri = `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
      } else {
        const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
        let bin = "";
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        dataUri = `data:${mime};base64,${btoa(bin)}`;
      }
      const a = Object.assign(document.createElement("a"), { href: dataUri, download: filename, style: "display:none" });
      document.body.appendChild(a); a.click();
      setTimeout(() => document.body.removeChild(a), 1000);
      return { success: true };
    } catch (e) { console.warn("[Export] Data URI failed:", e); }
  }

  /* ── PATH 3: Desktop browser / iOS Safari ──────────────────────────────── */
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename, style: "display:none" });
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  return { success: true };
}

/* ─────────────────────────────────────────────────────────────────────────────
   drawingsToKML
   
   FIX #1: Was using <n> (wrong) — now uses <name> (correct KML spec)
   FIX #2: Polygon LinearRing now explicitly closed (first point repeated last)
   FIX #3: Coordinate format is correct: longitude,latitude,altitude
───────────────────────────────────────────────────────────────────────────── */
export function drawingsToKML(savedDrawings = [], route = [], measurePoints = []) {
  const placemarks = [];

  savedDrawings.forEach(d => {
    const name = d.name || "Drawing";
    const pts = (d.points || []).map(normPt).filter(Boolean);

    if (d.type === "marker" && pts.length > 0) {
      const { lat, lng } = pts[0];
      placemarks.push(`
  <Placemark>
    <name>${escXml(name)}</name>
    <Style>
      <IconStyle>
        <color>ff1497fa</color>
        <scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
      </IconStyle>
    </Style>
    <Point>
      <coordinates>${lng.toFixed(8)},${lat.toFixed(8)},0</coordinates>
    </Point>
  </Placemark>`);

    } else if (d.type === "path" && pts.length >= 2) {
      placemarks.push(`
  <Placemark>
    <name>${escXml(name)}</name>
    <Style>
      <LineStyle>
        <color>${kmlColor("#f97316")}</color>
        <width>3</width>
      </LineStyle>
    </Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>${pts.map(p => `${p.lng.toFixed(8)},${p.lat.toFixed(8)},0`).join(" ")}</coordinates>
    </LineString>
  </Placemark>`);

    } else if (d.type === "polygon" && pts.length >= 3) {
      // FIX: Close the ring — repeat first point at end (KML spec requirement)
      const ring = [...pts, pts[0]];
      placemarks.push(`
  <Placemark>
    <name>${escXml(name)}</name>
    <Style>
      <LineStyle>
        <color>${kmlColor("#f97316")}</color>
        <width>2</width>
      </LineStyle>
      <PolyStyle>
        <color>4df97316</color>
      </PolyStyle>
    </Style>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <tessellate>1</tessellate>
          <coordinates>${ring.map(p => `${p.lng.toFixed(8)},${p.lat.toFixed(8)},0`).join(" ")}</coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>`);
    }
  });

  // Survey route
  if (route.length >= 2) {
    const pts = route.map(normPt).filter(Boolean);
    if (pts.length >= 2) {
      placemarks.push(`
  <Placemark>
    <name>Survey Route</name>
    <Style>
      <LineStyle>
        <color>${kmlColor("#ef4444")}</color>
        <width>3</width>
      </LineStyle>
    </Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>${pts.map(p => `${p.lng.toFixed(8)},${p.lat.toFixed(8)},0`).join(" ")}</coordinates>
    </LineString>
  </Placemark>`);
    }
  }

  // Measure line
  if (measurePoints.length >= 2) {
    const pts = measurePoints.map(normPt).filter(Boolean);
    if (pts.length >= 2) {
      placemarks.push(`
  <Placemark>
    <name>Measure Line</name>
    <Style>
      <LineStyle>
        <color>${kmlColor("#fbbf24")}</color>
        <width>2</width>
      </LineStyle>
    </Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>${pts.map(p => `${p.lng.toFixed(8)},${p.lat.toFixed(8)},0`).join(" ")}</coordinates>
    </LineString>
  </Placemark>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>Geoxis Pro Map </name>
    <description>Exported from Geoxison ${new Date().toISOString()}</description>
${placemarks.join("\n")}
  </Document>
</kml>`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   drawingsToCSV
   FIX: Values with commas/quotes/newlines are now properly escaped
───────────────────────────────────────────────────────────────────────────── */
export function drawingsToCSV(savedDrawings = [], route = [], measurePoints = []) {
  const rows = [["name", "type", "latitude", "longitude", "point_index"]];

  const csvVal = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  savedDrawings.forEach(d => {
    (d.points || []).forEach((raw, i) => {
      const p = normPt(raw);
      if (!p) return;
      rows.push([d.name || "Drawing", d.type, p.lat.toFixed(8), p.lng.toFixed(8), i + 1]);
    });
  });

  route.forEach((raw, i) => {
    const p = normPt(raw);
    if (!p) return;
    rows.push(["Survey Route", "survey", p.lat.toFixed(8), p.lng.toFixed(8), i + 1]);
  });

  measurePoints.forEach((raw, i) => {
    const p = normPt(raw);
    if (!p) return;
    rows.push(["Measure Line", "measure", p.lat.toFixed(8), p.lng.toFixed(8), i + 1]);
  });

  return rows.map(r => r.map(csvVal).join(",")).join("\r\n");
}

/* ─────────────────────────────────────────────────────────────────────────────
   drawingsToGeoJSON
   FIX: null-guard on empty points arrays; polygon ring explicitly closed
───────────────────────────────────────────────────────────────────────────── */
export function drawingsToGeoJSON(savedDrawings = [], route = [], measurePoints = []) {
  const features = [];

  savedDrawings.forEach(d => {
    const pts = (d.points || []).map(normPt).filter(Boolean);
    // GeoJSON coordinates are [longitude, latitude]
    const coords = pts.map(p => [p.lng, p.lat]);

    if (d.type === "marker" && coords.length >= 1) {
      features.push({
        type: "Feature",
        properties: { name: d.name, type: "marker" },
        geometry: { type: "Point", coordinates: coords[0] },
      });
    } else if (d.type === "path" && coords.length >= 2) {
      features.push({
        type: "Feature",
        properties: { name: d.name, type: "path", point_count: coords.length },
        geometry: { type: "LineString", coordinates: coords },
      });
    } else if (d.type === "polygon" && coords.length >= 3) {
      // GeoJSON polygon ring must be closed
      const ring = [...coords, coords[0]];
      features.push({
        type: "Feature",
        properties: { name: d.name, type: "polygon", point_count: coords.length },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
  });

  if (route.length >= 2) {
    const pts = route.map(normPt).filter(Boolean);
    if (pts.length >= 2) {
      features.push({
        type: "Feature",
        properties: { name: "Survey Route", type: "survey", point_count: pts.length },
        geometry: { type: "LineString", coordinates: pts.map(p => [p.lng, p.lat]) },
      });
    }
  }

  if (measurePoints.length >= 2) {
    const pts = measurePoints.map(normPt).filter(Boolean);
    if (pts.length >= 2) {
      features.push({
        type: "Feature",
        properties: { name: "Measure Line", type: "measure", point_count: pts.length },
        geometry: { type: "LineString", coordinates: pts.map(p => [p.lng, p.lat]) },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Public export functions
───────────────────────────────────────────────────────────────────────────── */
export function exportKML(savedDrawings, route, measurePoints) {
  const kml = drawingsToKML(savedDrawings, route, measurePoints);
  if (!kml) { alert("No data to export."); return; }
  return downloadFile(
    kml,
    `Geoxis-${stamp()}.kml`,
    "application/vnd.google-earth.kml+xml"
  );
}

export function exportCSV(savedDrawings, route, measurePoints) {
  const csv = drawingsToCSV(savedDrawings, route, measurePoints);
  const lineCount = csv.split("\n").length - 1; // exclude header
  if (lineCount === 0) { alert("No data to export."); return; }
  return downloadFile(
    csv,
    `Geoxis-${stamp()}.csv`,
    "text/csv;charset=utf-8"
  );
}

export async function exportKMZ(savedDrawings, route, measurePoints) {
  const kml = drawingsToKML(savedDrawings, route, measurePoints);
  if (!kml) { alert("No data to export."); return; }
  const zip = new JSZip();
  zip.file("doc.kml", kml);
  // FIX: use uint8array type so downloadFile handles binary correctly
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return downloadFile(
    bytes,
    `Geoxis-${stamp()}.kmz`,
    "application/vnd.google-earth.kmz"
  );
}

export function exportGeoJSON(savedDrawings, route, measurePoints) {
  const fc = drawingsToGeoJSON(savedDrawings, route, measurePoints);
  if (fc.features.length === 0) { alert("No data to export."); return; }
  return downloadFile(
    JSON.stringify(fc, null, 2),
    `Geoxis-${stamp()}.geojson`,
    "application/geo+json"
  );
}