/**
 * exportUtils.js — SurveyMap Pro
 * Export drawn data as KML, CSV, or KMZ (zipped KML)
 */

import JSZip from "jszip";

// ── Helpers ────────────────────────────────────────────────────────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

function kmlColor(hex = "#f97316") {
  // KML uses AABBGGRR (alpha, blue, green, red)
  const h = hex.replace("#", "");
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `ff${b}${g}${r}`;
}

// ── Convert drawings → KML string ─────────────────────────────────────────

export function drawingsToKML(savedDrawings, route, measurePoints) {
  const placemarks = [];

  // Saved drawings
  savedDrawings.forEach((d) => {
    const name = d.name || "Drawing";
    const pts = d.points || [];

    if (d.type === "marker" && pts.length > 0) {
      const p = pts[0];
      const lat = p.lat ?? p[0];
      const lng = p.lng ?? p[1];
      placemarks.push(`
  <Placemark>
    <name>${escapeXml(name)}</name>
    <Style><IconStyle><color>ff1497fa</color><scale>1.2</scale></IconStyle></Style>
    <Point><coordinates>${lng},${lat},0</coordinates></Point>
  </Placemark>`);

    } else if (d.type === "path" && pts.length >= 2) {
      const coords = pts.map(p => {
        const lat = p.lat ?? p[0];
        const lng = p.lng ?? p[1];
        return `${lng},${lat},0`;
      }).join("\n          ");
      placemarks.push(`
  <Placemark>
    <name>${escapeXml(name)}</name>
    <Style><LineStyle><color>${kmlColor("#f97316")}</color><width>3</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
  </Placemark>`);

    } else if (d.type === "polygon" && pts.length >= 3) {
      const allPts = [...pts, pts[0]]; // close ring
      const coords = allPts.map(p => {
        const lat = p.lat ?? p[0];
        const lng = p.lng ?? p[1];
        return `${lng},${lat},0`;
      }).join("\n          ");
      placemarks.push(`
  <Placemark>
    <name>${escapeXml(name)}</name>
    <Style>
      <LineStyle><color>${kmlColor("#f97316")}</color><width>2</width></LineStyle>
      <PolyStyle><color>4df97316</color></PolyStyle>
    </Style>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>
  </Placemark>`);
    }
  });

  // Survey route
  if (route.length >= 2) {
    const coords = route.map(p => `${p[1]},${p[0]},0`).join("\n        ");
    placemarks.push(`
  <Placemark>
    <name>Survey Route</name>
    <Style><LineStyle><color>${kmlColor("#ef4444")}</color><width>3</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
  </Placemark>`);
  }

  // Measure points
  if (measurePoints.length >= 2) {
    const coords = measurePoints.map(p => `${p.lng},${p.lat},0`).join("\n        ");
    placemarks.push(`
  <Placemark>
    <name>Measure Line</name>
    <Style><LineStyle><color>${kmlColor("#fbbf24")}</color><width>2</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
  </Placemark>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>SurveyMap Pro Export</name>
  ${placemarks.join("\n")}
</Document>
</kml>`;
}

// ── Convert drawings → CSV rows ────────────────────────────────────────────

export function drawingsToCSV(savedDrawings, route, measurePoints) {
  const rows = [["name", "type", "latitude", "longitude", "point_index"]];

  savedDrawings.forEach((d) => {
    const pts = d.points || [];
    pts.forEach((p, i) => {
      const lat = p.lat ?? p[0];
      const lng = p.lng ?? p[1];
      rows.push([d.name || "Drawing", d.type, lat.toFixed(7), lng.toFixed(7), i + 1]);
    });
  });

  route.forEach((p, i) => {
    rows.push(["Survey Route", "survey", p[0].toFixed(7), p[1].toFixed(7), i + 1]);
  });

  measurePoints.forEach((p, i) => {
    rows.push(["Measure Line", "measure", p.lat.toFixed(7), p.lng.toFixed(7), i + 1]);
  });

  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

// ── Export functions ───────────────────────────────────────────────────────

export function exportKML(savedDrawings, route, measurePoints) {
  const kml = drawingsToKML(savedDrawings, route, measurePoints);
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  downloadBlob(blob, "surveymap-export.kml");
}

export function exportCSV(savedDrawings, route, measurePoints) {
  const csv = drawingsToCSV(savedDrawings, route, measurePoints);
  const blob = new Blob([csv], { type: "text/csv" });
  downloadBlob(blob, "surveymap-export.csv");
}

export async function exportKMZ(savedDrawings, route, measurePoints) {
  const kml = drawingsToKML(savedDrawings, route, measurePoints);
  const zip = new JSZip();
  zip.file("doc.kml", kml);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "surveymap-export.kmz");
}

// ── XML escape ─────────────────────────────────────────────────────────────
function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}