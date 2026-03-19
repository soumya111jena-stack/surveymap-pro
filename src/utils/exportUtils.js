/**
 * exportUtils.js — SurveyMap Pro v5.3.1
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX v5.3.1 — DRAW POINTS NOT APPEARING IN EXPORTS:
 *
 *  ROOT CAUSE:
 *    DrawTool now stores points as { lat, lng } objects.
 *    All export functions now read ONLY p.lat / p.lng — no p[0]/p[1] fallback.
 *    This removes all ambiguity and works correctly for:
 *      - KML  (coordinates: lng,lat,0)
 *      - KMZ  (same KML inside zip)
 *      - CSV  (lat, lng columns)
 *      - GeoJSON (coordinates: [lng, lat])
 *
 *  ALSO:
 *    - All 3 environment paths preserved (Capacitor / Android WebView / Browser)
 *    - Binary KMZ fix (Uint8Array base64 encoding)
 *    - Timestamp filenames
 *    - Multi-directory fallback for Samsung/Xiaomi
 *    - Meaningful error alerts (no silent failure)
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
   Base64 encoding — separate paths for string vs binary (Uint8Array)
───────────────────────────────────────────────────────────────────────────── */
function toBase64(content) {
  if (content instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < content.byteLength; i++) bin += String.fromCharCode(content[i]);
    return btoa(bin);
  }
  if (content instanceof ArrayBuffer) return toBase64(new Uint8Array(content));
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
   FIX: Normalise a point to { lat, lng }
   Handles BOTH storage formats safely:
     { lat, lng }  ← new format from DrawTool v5.3.1
     [lat, lng]    ← old array format (legacy data / survey route)
───────────────────────────────────────────────────────────────────────────── */
function normPt(p) {
  if (Array.isArray(p)) return { lat: p[0], lng: p[1] };
  return { lat: p.lat, lng: p.lng };
}

/* ─────────────────────────────────────────────────────────────────────────────
   CORE: downloadFile()
───────────────────────────────────────────────────────────────────────────── */
async function downloadFile(content, filename, mime) {

  /* ── PATH 1: Capacitor native (real Android / iOS APK) ────────────────── */
  if (isCapacitor()) {
    let Filesystem, Directory, Share;
    try {
      ({ Filesystem, Directory } = await import("@capacitor/filesystem"));
      ({ Share }                 = await import("@capacitor/share"));
    } catch (_) {
      alert(
        "Export plugins not installed.\n\n" +
        "Run these commands then rebuild the APK:\n" +
        "  npm install @capacitor/filesystem @capacitor/share\n" +
        "  npx cap sync android"
      );
      return { success: false };
    }

    try {
      const perm = await Filesystem.requestPermissions();
      console.log("[Export] Storage permission:", perm?.publicStorage);
    } catch (_) {
      console.log("[Export] requestPermissions not applicable (Android 10+)");
    }

    const base64   = toBase64(content);
    const filePath = `SurveyMapPro/${filename}`;

    const writeTargets = [
      Directory.Documents,
      Directory.ExternalStorage,
      Directory.Cache,
    ].filter(Boolean);

    let fileUri   = null;
    let lastError = null;

    for (const dir of writeTargets) {
      try {
        const result = await Filesystem.writeFile({
          path: filePath, data: base64, directory: dir, recursive: true,
        });
        if (result?.uri) { fileUri = result.uri; console.log("[Export] Saved →", dir, fileUri); break; }
      } catch (e) { lastError = e; console.warn("[Export] Write failed for", dir, e?.message); }
    }

    if (!fileUri) {
      alert(
        `Could not save file.\n\nError: ${lastError?.message || lastError}\n\n` +
        `Fixes:\n• Settings → Apps → SurveyMap Pro → Permissions → Storage → Allow\n` +
        `• Run: npx cap sync android  then rebuild APK`
      );
      return { success: false, error: lastError };
    }

    try {
      const cs = await Share.canShare();
      if (cs?.value !== false) {
        await Share.share({
          title: filename, text: `SurveyMap Pro — ${filename}`,
          url: fileUri, dialogTitle: `Open or save ${filename}`,
        });
      } else {
        alert(`File saved!\nFiles app → Documents → SurveyMapPro → ${filename}`);
      }
    } catch (shareErr) {
      const dismissed = ["Share canceled","shareSheet: canceled"].some(m => shareErr?.message?.includes(m));
      if (!dismissed) alert(`File saved!\nFiles app → Documents → SurveyMapPro → ${filename}`);
    }

    return { success: true, uri: fileUri };
  }

  /* ── PATH 2: Android WebView (emulator / Cordova) ─────────────────────── */
  if (isAndroidWebView()) {
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([content], filename, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: filename, text: "SurveyMap Pro export", files: [file] });
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
        let bin = ""; for (let i=0;i<bytes.byteLength;i++) bin+=String.fromCharCode(bytes[i]);
        dataUri = `data:${mime};base64,${btoa(bin)}`;
      }
      const a = Object.assign(document.createElement("a"),
        { href: dataUri, download: filename, style: "display:none" });
      document.body.appendChild(a); a.click();
      setTimeout(() => document.body.removeChild(a), 1000);
      setTimeout(() => { try { window.open(dataUri, "_blank"); } catch(_){} }, 300);
      return { success: true };
    } catch (e) { console.warn("[Export] Data URI failed:", e); }
  }

  /* ── PATH 3: Desktop browser / iOS Safari ─────────────────────────────── */
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"),
    { href: url, download: filename, style: "display:none" });
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  return { success: true };
}

/* ─────────────────────────────────────────────────────────────────────────────
   XML helpers
───────────────────────────────────────────────────────────────────────────── */
function escXml(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function kmlColor(hex = "#f97316") {
  const h = hex.replace("#",""), r=h.slice(0,2), g=h.slice(2,4), b=h.slice(4,6);
  return `ff${b}${g}${r}`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   KML builder
   Uses normPt() so it handles both { lat,lng } objects and [lat,lng] arrays
───────────────────────────────────────────────────────────────────────────── */
export function drawingsToKML(savedDrawings = [], route = [], measurePoints = []) {
  const pm = [];

  savedDrawings.forEach(d => {
    const name = d.name || "Drawing";
    const pts  = (d.points || []).map(normPt);

    if (d.type === "marker" && pts.length > 0) {
      const { lat, lng } = pts[0];
      pm.push(`
  <Placemark>
    <n>${escXml(name)}</n>
    <Style><IconStyle><color>ff1497fa</color><scale>1.2</scale></IconStyle></Style>
    <Point><coordinates>${lng},${lat},0</coordinates></Point>
  </Placemark>`);

    } else if (d.type === "path" && pts.length >= 2) {
      pm.push(`
  <Placemark>
    <n>${escXml(name)}</n>
    <Style><LineStyle><color>${kmlColor("#f97316")}</color><width>3</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate>
      <coordinates>${pts.map(p => `${p.lng},${p.lat},0`).join(" ")}</coordinates>
    </LineString>
  </Placemark>`);

    } else if (d.type === "polygon" && pts.length >= 3) {
      const ring = [...pts, pts[0]];
      pm.push(`
  <Placemark>
    <n>${escXml(name)}</n>
    <Style>
      <LineStyle><color>${kmlColor("#f97316")}</color><width>2</width></LineStyle>
      <PolyStyle><color>4df97316</color></PolyStyle>
    </Style>
    <Polygon><outerBoundaryIs><LinearRing>
      <coordinates>${ring.map(p => `${p.lng},${p.lat},0`).join(" ")}</coordinates>
    </LinearRing></outerBoundaryIs></Polygon>
  </Placemark>`);
    }
  });

  if (route.length >= 2) {
    pm.push(`
  <Placemark>
    <n>Survey Route</n>
    <Style><LineStyle><color>${kmlColor("#ef4444")}</color><width>3</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate>
      <coordinates>${route.map(p => { const { lat,lng }=normPt(p); return `${lng},${lat},0`; }).join(" ")}</coordinates>
    </LineString>
  </Placemark>`);
  }

  if (measurePoints.length >= 2) {
    pm.push(`
  <Placemark>
    <n>Measure Line</n>
    <Style><LineStyle><color>${kmlColor("#fbbf24")}</color><width>2</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate>
      <coordinates>${measurePoints.map(p => { const { lat,lng }=normPt(p); return `${lng},${lat},0`; }).join(" ")}</coordinates>
    </LineString>
  </Placemark>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <n>SurveyMap Pro Export</n>
  ${pm.join("\n")}
</Document>
</kml>`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   CSV builder
───────────────────────────────────────────────────────────────────────────── */
export function drawingsToCSV(savedDrawings = [], route = [], measurePoints = []) {
  const rows = [["name","type","latitude","longitude","point_index"]];

  savedDrawings.forEach(d => {
    (d.points || []).forEach((raw, i) => {
      const { lat, lng } = normPt(raw);
      rows.push([d.name||"Drawing", d.type, lat.toFixed(7), lng.toFixed(7), i+1]);
    });
  });

  route.forEach((raw, i) => {
    const { lat, lng } = normPt(raw);
    rows.push(["Survey Route","survey", lat.toFixed(7), lng.toFixed(7), i+1]);
  });

  measurePoints.forEach((raw, i) => {
    const { lat, lng } = normPt(raw);
    rows.push(["Measure Line","measure", lat.toFixed(7), lng.toFixed(7), i+1]);
  });

  return rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
}

/* ─────────────────────────────────────────────────────────────────────────────
   Public export functions
───────────────────────────────────────────────────────────────────────────── */
export function exportKML(savedDrawings, route, measurePoints) {
  return downloadFile(
    drawingsToKML(savedDrawings, route, measurePoints),
    `surveymap-${stamp()}.kml`,
    "application/vnd.google-earth.kml+xml"
  );
}

export function exportCSV(savedDrawings, route, measurePoints) {
  return downloadFile(
    drawingsToCSV(savedDrawings, route, measurePoints),
    `surveymap-${stamp()}.csv`,
    "text/csv"
  );
}

export async function exportKMZ(savedDrawings, route, measurePoints) {
  const zip = new JSZip();
  zip.file("doc.kml", drawingsToKML(savedDrawings, route, measurePoints));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return downloadFile(bytes, `surveymap-${stamp()}.kmz`, "application/vnd.google-earth.kmz");
}

export function exportGeoJSON(savedDrawings, route, measurePoints) {
  const features = [];

  savedDrawings.forEach(d => {
    const pts = (d.points || []).map(raw => {
      const { lat, lng } = normPt(raw);
      return [lng, lat]; // GeoJSON is [lng, lat]
    });
    if      (d.type==="marker"  && pts.length>=1)
      features.push({ type:"Feature", properties:{ name:d.name, type:"marker" },
        geometry:{ type:"Point", coordinates:pts[0] }});
    else if (d.type==="path"    && pts.length>=2)
      features.push({ type:"Feature", properties:{ name:d.name, type:"path" },
        geometry:{ type:"LineString", coordinates:pts }});
    else if (d.type==="polygon" && pts.length>=3)
      features.push({ type:"Feature", properties:{ name:d.name, type:"polygon" },
        geometry:{ type:"Polygon", coordinates:[[...pts, pts[0]]] }});
  });

  if (route.length >= 2)
    features.push({ type:"Feature", properties:{ name:"Survey Route", type:"survey" },
      geometry:{ type:"LineString",
        coordinates: route.map(raw => { const {lat,lng}=normPt(raw); return [lng,lat]; }) }});

  if (measurePoints.length >= 2)
    features.push({ type:"Feature", properties:{ name:"Measure Line", type:"measure" },
      geometry:{ type:"LineString",
        coordinates: measurePoints.map(raw => { const {lat,lng}=normPt(raw); return [lng,lat]; }) }});

  return downloadFile(
    JSON.stringify({ type:"FeatureCollection", features }, null, 2),
    `surveymap-${stamp()}.geojson`,
    "application/geo+json"
  );
}