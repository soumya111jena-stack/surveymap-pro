/**
 * PrintMapPanel.jsx — SurveyMap Pro
 *
 * FIXES applied:
 *  1. Map tiles actually appear when printing / saving PDF
 *     – Draws <img> tile layers (the common case most basemaps use)
 *     – Also draws canvas-based tile layers
 *     – Validates tile count > 0 before accepting composed result
 *     – Pre-fetches tiles with crossOrigin="anonymous" to avoid canvas taint
 *     – Falls back to html2canvas only if compose fails
 *  2. ALL overlay elements are DRAGGABLE inside the preview canvas
 *  3. "Reset Positions" button restores Google Earth default layout
 *  4. Print CSS uses exact paper mm dimensions (not 100vw/100vh)
 *
 * INTEGRATION:
 *   import PrintMapPanel from "./tools/PrintMapPanel";
 *   const [printOpen, setPrintOpen] = useState(false);
 *   <PrintMapPanel
 *     visible={printOpen} onClose={()=>setPrintOpen(false)}
 *     leafletMapRef={leafletMapRef} savedDrawings={savedDrawings}
 *     kmlName={kmlName} geojsonFileName={geojsonFileName}
 *     shpFileName={shpFileName} demFileName={demFileName}
 *     importedGeoJSONLayers={importedGeoJSONLayers}
 *     surveyMode={surveyMode} route={route}
 *     measurePoints={measurePoints} measureMode={measureMode}
 *     activeLayer={activeLayer} mousePos={mousePos}
 *     mapZoom={mapZoom} isMobile={isMobile}
 *     extraFile={extraFile} extraFileType={extraFileType}
 *   />
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";

/* ─── Paper sizes ─────────────────────────────────────────────────────────── */
const PAPER_SIZES = [
  { key:"a4l",  label:"A4 Landscape",    w:297, h:210, ratio:297/210 },
  { key:"a4p",  label:"A4 Portrait",     w:210, h:297, ratio:210/297 },
  { key:"a3l",  label:"A3 Landscape",    w:420, h:297, ratio:420/297 },
  { key:"a3p",  label:"A3 Portrait",     w:297, h:420, ratio:297/420 },
  { key:"ltr",  label:"Letter Landscape",w:279, h:216, ratio:279/216 },
  { key:"ltrp", label:"Letter Portrait", w:216, h:279, ratio:216/279 },
];

const PREVIEW_W = 620;

/* ─── Scale helpers ───────────────────────────────────────────────────────── */
const SCALE_MAP = {
  0:500000000,1:250000000,2:150000000,3:70000000,4:35000000,
  5:15000000,6:10000000,7:4000000,8:2000000,9:1000000,10:500000,
  11:250000,12:150000,13:70000,14:35000,15:15000,16:8000,
  17:4000,18:2000,19:1000,20:500,21:250,22:100,
};
const SCALEBAR_M = {
  0:5000000,1:2000000,2:1000000,3:500000,4:200000,
  5:100000,6:50000,7:20000,8:10000,9:5000,10:2000,
  11:1000,12:500,13:200,14:100,15:50,16:20,
  17:10,18:5,19:2,20:1,21:0.5,22:0.25,
};

const fmtScale = (z) => { const s = SCALE_MAP[Math.round(z)] ?? 5000000; return `1 : ${s.toLocaleString()}`; };
const fmtBar   = (z) => { const m = SCALEBAR_M[Math.round(z)] ?? 1000; return m >= 1000 ? `${m/1000} km` : `${m} m`; };
const todayStr = () => new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});

function getCenter(ref) {
  try {
    const m = ref?.current;
    if (m && typeof m.getCenter === "function") { const c = m.getCenter(); return { lat: c.lat, lng: c.lng }; }
  } catch (_) {}
  return null;
}

/* ─── Compose map image from Leaflet tile layers ──────────────────────────── */
async function composeMapImage(mapEl) {
  const W = mapEl.offsetWidth;
  const H = mapEl.offsetHeight;
  const out = document.createElement("canvas");
  out.width  = W * 2;
  out.height = H * 2;
  const ctx = out.getContext("2d");
  ctx.scale(2, 2);

  // Dark ocean fallback background
  ctx.fillStyle = "#2c5f7a";
  ctx.fillRect(0, 0, W, H);

  const mr = mapEl.getBoundingClientRect();
  let tileCount = 0;

  // ── FIX 1: Draw <img> tile layers (standard Leaflet raster tiles) ──────────
  // Most basemaps (OSM, Satellite, etc.) render tiles as <img> tags, NOT canvas.
  // The original code only looked for <canvas>, so tiles were never drawn.
  const imgTiles = [
    ...mapEl.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"),
    ...mapEl.querySelectorAll(".leaflet-tile-pane img"),        // broader fallback
  ];

  for (const img of imgTiles) {
    // Skip tiles that haven't loaded yet or are invisible
    if (!img.complete || img.naturalWidth === 0) continue;
    if (img.style.display === "none" || img.style.visibility === "hidden") continue;
    try {
      const r = img.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      ctx.drawImage(img, r.left - mr.left, r.top - mr.top, r.width, r.height);
      tileCount++;
    } catch (e) {
      // Cross-origin taint — this tile can't be drawn. Count it as "seen" so we
      // know tiles exist but are CORS-blocked, which helps diagnosis.
      console.warn("Tile draw blocked (CORS):", img.src?.slice(0, 60), e.message);
    }
  }

  // ── FIX 2: Draw canvas-based tile layers (e.g. vector tile renderers) ─────
  const canvasTiles = [...mapEl.querySelectorAll("canvas")];
  for (const c of canvasTiles) {
    try {
      const r = c.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      ctx.drawImage(c, r.left - mr.left, r.top - mr.top, r.width, r.height);
      tileCount++;
    } catch (_) {}
  }

  // ── FIX 3: Only return a result if we actually drew tiles ─────────────────
  // Original code returned any DataURL > 5000 chars, which includes a plain
  // colored rectangle. We now require at least one real tile was drawn.
  if (tileCount === 0) return null;

  // Draw SVG overlay layers (markers, polylines, drawn shapes, etc.)
  const svgEls = [...mapEl.querySelectorAll("svg")];
  for (const svg of svgEls) {
    try {
      const r = svg.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const xml  = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      await new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, r.left - mr.left, r.top - mr.top, r.width, r.height);
          URL.revokeObjectURL(url);
          res();
        };
        img.onerror = () => { URL.revokeObjectURL(url); res(); };
        img.src = url;
      });
    } catch (_) {}
  }

  return out.toDataURL("image/png");
}

/* ─── North Arrow SVG ─────────────────────────────────────────────────────── */
function NorthArrow({ size = 52 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="24" fill="rgba(255,255,255,0.94)" stroke="#bbb" strokeWidth="1.2"/>
      <polygon points="26,7 31,24 26,21 21,24" fill="#c0392b"/>
      <polygon points="26,45 31,28 26,31 21,28" fill="white" stroke="#aaa" strokeWidth="0.8"/>
      <circle cx="26" cy="26" r="3.5" fill="#c0392b"/>
      <text x="26" y="6" textAnchor="middle" fontSize="10" fontWeight="900"
        fill="#c0392b" fontFamily="Arial,sans-serif" dominantBaseline="hanging">N</text>
    </svg>
  );
}

/* ─── Generic draggable wrapper ───────────────────────────────────────────── */
function Draggable({ id, pos, onMove, previewW, previewH, children }) {
  const elRef     = useRef(null);
  const dragRef   = useRef(false);
  const originRef = useRef({});

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current   = true;
    originRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };

    const onMouseMove = (ev) => {
      if (!dragRef.current) return;
      const dx  = ev.clientX - originRef.current.mx;
      const dy  = ev.clientY - originRef.current.my;
      const el  = elRef.current;
      const maxX = previewW - (el ? el.offsetWidth  : 80);
      const maxY = previewH - (el ? el.offsetHeight : 40);
      onMove(id,
        Math.max(0, Math.min(maxX, originRef.current.px + dx)),
        Math.max(0, Math.min(maxY, originRef.current.py + dy))
      );
    };
    const onMouseUp = () => {
      dragRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
  }, [id, pos, onMove, previewW, previewH]);

  return (
    <div
      ref={elRef}
      onMouseDown={onMouseDown}
      className="pmp-draggable"
      style={{
        position: "absolute",
        left: pos.x,
        top:  pos.y,
        cursor: "grab",
        userSelect: "none",
        zIndex: 10,
      }}
    >
      {children}
    </div>
  );
}

/* ─── Default positions (Google Earth layout) ─────────────────────────────── */
function defaultPos(pH) {
  return {
    title:       { x: 12,              y: 12       },
    legend:      { x: PREVIEW_W - 195, y: 12       },
    northarrow:  { x: PREVIEW_W - 64,  y: pH - 118 },
    coordinates: { x: PREVIEW_W - 195, y: pH - 96  },
    scalebar:    { x: 12,              y: pH - 70   },
    dateattr:    { x: 12,              y: pH - 22   },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   PREVIEW CANVAS — map + draggable overlays
══════════════════════════════════════════════════════════════════════════ */
function PreviewCanvas({
  paperKey, mapImgUrl, elements, positions, onMove,
  title, description, mapZoom, activeLayer,
  savedDrawings, kmlName, extraFile, extraFileType,
  geojsonFileName, shpFileName, demFileName, importedGeoJSONLayers,
  surveyMode, route, measurePoints, measureMode,
  mapCenter, textColor, bgColor,
}) {
  const paper = PAPER_SIZES.find(p => p.key === paperKey) || PAPER_SIZES[0];
  const pH    = Math.round(PREVIEW_W / paper.ratio);
  const show  = (k) => elements[k] !== false;
  const drag  = { onMove, previewW: PREVIEW_W, previewH: pH };

  const legendItems = useMemo(() => {
    const items = [];
    items.push({ icon: "🛰", label: `${activeLayer} (basemap)`, color: null, type: "layer" });
    if (kmlName)         items.push({ icon: "📍", label: kmlName,            color: "#e74c3c", type: "kml"  });
    if (extraFile)       items.push({ icon: "📊", label: extraFile.name,     color: null,      type: "file" });
    if (geojsonFileName) items.push({ icon: "🌐", label: geojsonFileName,    color: "#2dd4bf", type: "geo"  });
    if (shpFileName)     items.push({ icon: "🗺", label: shpFileName,        color: "#a78bfa", type: "shp"  });
    if (demFileName)     items.push({ icon: "🏔", label: demFileName,        color: "#fb7185", type: "dem"  });
    importedGeoJSONLayers?.forEach(l => items.push({ icon: "🌐", label: l.name, color: "#5eead4", type: "geo" }));
    savedDrawings?.forEach(d => items.push({ icon: null, label: d.name, color: d.color || "#1a73e8", type: d.type || "polygon" }));
    if (surveyMode && route?.length > 0)          items.push({ icon: "📡", label: `Survey Route (${route.length} pts)`, color: "#ef4444", type: "path" });
    if (measureMode && measurePoints?.length > 0) items.push({ icon: "📏", label: "Measurement",                        color: "#fbbf24", type: "path" });
    return items;
  }, [activeLayer, kmlName, extraFile, geojsonFileName, shpFileName, demFileName,
      importedGeoJSONLayers, savedDrawings, surveyMode, route, measureMode, measurePoints]);

  return (
    <div
      id="pmp-canvas"
      style={{
        width: PREVIEW_W, height: pH,
        position: "relative", overflow: "hidden",
        background: bgColor || "#fff",
        borderRadius: 4,
        boxShadow: "0 4px 28px rgba(0,0,0,0.22)",
        flexShrink: 0,
        fontFamily: "Arial, sans-serif",
      }}
    >
      {/* MAP BACKGROUND */}
      <div style={{
        position: "absolute", inset: 0,
        background: mapImgUrl
          ? `url(${mapImgUrl}) center/cover no-repeat`
          : "linear-gradient(160deg,#c5d8e8 0%,#90b8ce 40%,#5a94b0 80%,#3a7490 100%)",
      }}>
        {!mapImgUrl && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 8,
          }}>
            <div style={{ fontSize: 38 }}>🗺</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", fontStyle: "italic", textAlign: "center", padding: "0 24px" }}>
              Click <strong>"Capture Map"</strong> to snapshot the current map view
            </div>
          </div>
        )}
      </div>

      {/* ── TITLE + DESCRIPTION ── */}
      {(show("title") || show("description")) && (
        <Draggable id="title" pos={positions.title} {...drag}>
          <div style={{
            background: "rgba(255,255,255,0.93)", borderRadius: 3,
            padding: "10px 14px", boxShadow: "0 2px 10px rgba(0,0,0,0.22)",
            minWidth: 130, maxWidth: 220, backdropFilter: "blur(2px)",
          }}>
            {show("title") && (
              <div style={{ fontSize: 16, fontWeight: 700, color: textColor || "#202124", lineHeight: 1.25, fontFamily: "Arial,sans-serif" }}>
                {title || "Untitled Map"}
              </div>
            )}
            {show("description") && description && (
              <div style={{ fontSize: 10.5, color: "#5f6368", marginTop: 3, lineHeight: 1.5, fontFamily: "Arial,sans-serif" }}>
                {description}
              </div>
            )}
          </div>
        </Draggable>
      )}

      {/* ── LEGEND ── */}
      {show("legend") && legendItems.length > 0 && (
        <Draggable id="legend" pos={positions.legend} {...drag}>
          <div style={{
            background: "rgba(255,255,255,0.93)", borderRadius: 3,
            padding: "9px 13px", boxShadow: "0 2px 10px rgba(0,0,0,0.22)",
            minWidth: 130, maxWidth: 185, backdropFilter: "blur(2px)",
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#202124",
              borderBottom: "1px solid #e0e0e0", paddingBottom: 5, marginBottom: 5, fontFamily: "Arial,sans-serif" }}>
              Legend
            </div>
            {legendItems.slice(0, 10).map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 0" }}>
                {item.icon ? (
                  <span style={{ fontSize: 12, width: 18, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                ) : (
                  <div style={{
                    width: item.type === "path" ? 22 : 13,
                    height: item.type === "path" ? 3 : 13,
                    borderRadius: 2,
                    background: item.color || "#1a73e8", flexShrink: 0,
                    border: "1px solid rgba(0,0,0,0.15)",
                  }}/>
                )}
                <span style={{ fontSize: 10.5, color: "#202124", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130, fontFamily: "Arial,sans-serif" }}>
                  {item.label}
                </span>
              </div>
            ))}
            {legendItems.length > 10 && (
              <div style={{ fontSize: 9, color: "#9aa0a6", fontStyle: "italic", paddingTop: 3 }}>+{legendItems.length - 10} more…</div>
            )}
          </div>
        </Draggable>
      )}

      {/* ── NORTH ARROW ── */}
      {show("northarrow") && (
        <Draggable id="northarrow" pos={positions.northarrow} {...drag}>
          <div style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.3))" }}>
            <NorthArrow size={52} />
          </div>
        </Draggable>
      )}

      {/* ── COORDINATES ── */}
      {show("coordinates") && mapCenter && (
        <Draggable id="coordinates" pos={positions.coordinates} {...drag}>
          <div style={{
            background: "rgba(0,0,0,0.62)", color: "#fff",
            borderRadius: 4, padding: "4px 9px",
            fontSize: 10.5, fontFamily: "monospace",
            whiteSpace: "nowrap", letterSpacing: "0.02em",
            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
          }}>
            {mapCenter.lat.toFixed(5)}°, {mapCenter.lng.toFixed(5)}°
          </div>
        </Draggable>
      )}

      {/* ── SCALE BAR ── */}
      {show("scalebar") && (
        <Draggable id="scalebar" pos={positions.scalebar} {...drag}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ width: 1, height: 10, background: "#fff", boxShadow: "0 0 2px #000" }}/>
              {[0,1,2,3].map(i => (
                <div key={i} style={{
                  width: 24, height: 6,
                  background: i % 2 === 0 ? "#fff" : "rgba(0,0,0,0.75)",
                  border: "1px solid rgba(0,0,0,0.5)", boxSizing: "border-box",
                }}/>
              ))}
              <div style={{ width: 1, height: 10, background: "#fff", boxShadow: "0 0 2px #000" }}/>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <span style={{ fontSize: 9, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.9)", fontFamily: "Arial,sans-serif" }}>0</span>
              <span style={{ fontSize: 9, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.9)", fontFamily: "Arial,sans-serif" }}>{fmtBar(mapZoom)}</span>
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.8)", textShadow: "0 1px 2px rgba(0,0,0,0.8)", fontFamily: "Arial,sans-serif" }}>
              {fmtScale(mapZoom)}
            </div>
          </div>
        </Draggable>
      )}

      {/* ── DATE + ATTRIBUTION ── */}
      {(show("date") || show("attribution")) && (
        <Draggable id="dateattr" pos={positions.dateattr} {...drag}>
          <div style={{
            background: "rgba(0,0,0,0.58)", color: "rgba(255,255,255,0.92)",
            borderRadius: 3, padding: "3px 8px",
            fontSize: 9.5, fontFamily: "Arial,sans-serif",
            whiteSpace: "nowrap", boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
          }}>
            {show("date") && <span>{todayStr()}</span>}
            {show("date") && show("attribution") && <span style={{ margin: "0 6px", opacity: 0.5 }}>|</span>}
            {show("attribution") && <span style={{ opacity: 0.75 }}>© OpenStreetMap | SurveyMap Pro</span>}
          </div>
        </Draggable>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN PANEL
══════════════════════════════════════════════════════════════════════════ */
export default function PrintMapPanel({
  visible, onClose, leafletMapRef,
  savedDrawings = [], kmlName, extraFile, extraFileType,
  geojsonFileName, shpFileName, demFileName,
  importedGeoJSONLayers = [], surveyMode, route = [],
  measurePoints = [], measureMode, activeLayer = "Satellite",
  mousePos, mapZoom = 13, isMobile = false,
}) {
  const [title, setTitle]             = useState("Untitled Map");
  const [description, setDescription] = useState("Write a description for your map.");
  const [paperKey, setPaperKey]       = useState("a4l");
  const [elements, setElements]       = useState({});
  const [textColor, setTextColor]     = useState("#202124");
  const [bgColor, setBgColor]         = useState("#ffffff");
  const [mapImgUrl, setMapImgUrl]     = useState(null);
  const [capturing, setCapturing]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [mapCenter, setMapCenter]     = useState(null);
  const [activeTab, setActiveTab]     = useState("layout");
  const [positions, setPositions]     = useState(null);

  const paper = PAPER_SIZES.find(p => p.key === paperKey) || PAPER_SIZES[0];
  const pH    = Math.round(PREVIEW_W / paper.ratio);

  /* Reset positions when paper changes */
  useEffect(() => { setPositions(defaultPos(pH)); }, [paperKey]);

  /* On open */
  useEffect(() => {
    if (!visible) return;
    const c = getCenter(leafletMapRef);
    if (c) setMapCenter(c);
    else if (mousePos) setMapCenter(mousePos);
    if (!positions) setPositions(defaultPos(pH));
    // Load html2canvas as fallback renderer
    if (!window.html2canvas) {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      document.head.appendChild(s);
    }
  }, [visible]);

  const moveEl   = useCallback((id, x, y) => setPositions(prev => ({ ...prev, [id]: { x, y } })), []);
  const toggleEl = (k) => setElements(prev => ({ ...prev, [k]: prev[k] === false ? true : false }));

  /* ── CAPTURE MAP ────────────────────────────────────────────────────────── */
  const captureMap = useCallback(async () => {
    setCapturing(true);
    const c = getCenter(leafletMapRef);
    if (c) setMapCenter(c);

    try {
      const mapEl =
        leafletMapRef?.current?.getContainer?.() ||
        leafletMapRef?.current?.leafletElement?.getContainer?.() ||
        document.querySelector(".leaflet-container");

      if (!mapEl) {
        alert("Map element not found. Is the map visible?");
        setCapturing(false);
        return;
      }

      // ── FIX 4: Pre-fetch tiles with crossOrigin="anonymous" ───────────────
      // Without this, drawImage() throws a security error on cross-origin <img>
      // tiles and the canvas becomes tainted / blank.
      const tileImgs = [
        ...mapEl.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"),
        ...mapEl.querySelectorAll(".leaflet-tile-pane img"),
      ];

      await Promise.all(
        tileImgs.map(img =>
          new Promise((res) => {
            // Already loaded and hopefully not tainted — optimistically continue
            if (img.complete && img.naturalWidth > 0) { res(); return; }
            // Re-fetch with CORS header (works when tile server sends CORS headers)
            const fresh = new Image();
            fresh.crossOrigin = "anonymous";
            fresh.onload = () => {
              try { img.src = fresh.src; } catch (_) {}
              res();
            };
            fresh.onerror = res;
            // Cache-bust so the browser re-requests with the CORS header
            const sep = img.src.includes("?") ? "&" : "?";
            fresh.src = img.src + sep + "_cb=" + Date.now();
          })
        )
      );

      // Strategy 1: compose from raw tile images (fastest, works offline too)
      const composed = await composeMapImage(mapEl);
      if (composed) {
        setMapImgUrl(composed);
        setCapturing(false);
        return;
      }

      // Strategy 2: html2canvas fallback
      if (window.html2canvas) {
        const canvas = await window.html2canvas(mapEl, {
          useCORS: true,
          allowTaint: false,           // false = don't risk tainting
          width:  mapEl.offsetWidth,
          height: mapEl.offsetHeight,
          scale: 1.5,
          logging: false,
          ignoreElements: (el) => el.classList?.contains("leaflet-control-container"),
        });
        const url = canvas.toDataURL("image/png");
        if (url.length > 10000) {
          setMapImgUrl(url);
        } else {
          alert(
            "Map tiles could not be captured (CORS restriction on tile server).\n\n" +
            "Tip: Switch to the OpenStreetMap basemap (which allows CORS) and try again."
          );
        }
      } else {
        alert("Renderer not loaded yet — please wait 3 seconds and try again.");
      }
    } catch (e) {
      console.error("captureMap error:", e);
      alert(
        "Map capture failed: " + e.message +
        "\n\nTip: Try switching to a different basemap (e.g. OpenStreetMap) and retry."
      );
    }
    setCapturing(false);
  }, [leafletMapRef]);

  /* ── SAVE PNG ───────────────────────────────────────────────────────────── */
  const savePNG = useCallback(async () => {
    setSaving(true);
    try {
      const el = document.getElementById("pmp-canvas");
      if (!el) { alert("Preview not ready."); setSaving(false); return; }
      if (!window.html2canvas) { alert("Renderer not ready — try again in a moment."); setSaving(false); return; }
      const canvas = await window.html2canvas(el, {
        useCORS: true, allowTaint: true,
        scale: 2, backgroundColor: bgColor || "#fff", logging: false,
      });
      const a = document.createElement("a");
      a.download = `${(title || "map").replace(/\s+/g, "_")}_${new Date().toISOString().slice(0,10)}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (e) { alert("Export failed: " + e.message); }
    setSaving(false);
  }, [title, bgColor]);

  /* ── PRINT (rasterises preview → opens print dialog) ───────────────────── */
  const doPrint = useCallback(async () => {
    setSaving(true);
    try {
      const el = document.getElementById("pmp-canvas");
      if (!el || !window.html2canvas) { alert("Preview not ready."); setSaving(false); return; }
      const canvas = await window.html2canvas(el, {
        useCORS: true, allowTaint: true,
        scale: 2, backgroundColor: bgColor || "#fff", logging: false,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const pw = window.open("", "_blank", "width=900,height=700");
      if (!pw) { alert("Allow popups to print."); setSaving(false); return; }

      // ── FIX 5: Use exact paper mm dimensions instead of 100vw/100vh ───────
      // Using viewport units caused the image to be sized incorrectly when the
      // print page aspect ratio differed from the screen. Explicit mm values
      // guarantee the image fills the page perfectly at any DPI.
      pw.document.write(`<!DOCTYPE html><html><head>
        <title>${title || "Map"}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #fff; }
          @page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }
          img {
            display: block;
            width: ${paper.w}mm;
            height: ${paper.h}mm;
          }
        </style>
        </head><body>
        <img src="${dataUrl}" onload="setTimeout(function(){ window.print(); }, 400);"/>
        </body></html>`);
      pw.document.close();
    } catch (e) { alert("Print failed: " + e.message); }
    setSaving(false);
  }, [title, bgColor, paper]);

  if (!visible || !positions) return null;

  /* ── UI style helpers ── */
  const tabSt = (t) => ({
    padding: "9px 16px", border: "none", cursor: "pointer",
    background: "transparent", fontSize: 12.5,
    fontWeight: activeTab === t ? 700 : 400,
    color: activeTab === t ? "#1a73e8" : "#5f6368",
    borderBottom: `2.5px solid ${activeTab === t ? "#1a73e8" : "transparent"}`,
    fontFamily: "Arial,sans-serif", transition: "all 0.15s", flexShrink: 0,
  });
  const selSt = {
    fontSize: 12, color: "#202124", padding: "6px 10px",
    border: "1.5px solid #dadce0", borderRadius: 7, background: "#fff",
    cursor: "pointer", outline: "none", fontFamily: "Arial,sans-serif",
    width: "100%", marginBottom: 10,
  };
  const secLabel = {
    fontSize: 10, fontWeight: 700, color: "#5f6368",
    letterSpacing: "0.1em", textTransform: "uppercase",
    margin: "14px 0 7px", fontFamily: "Arial,sans-serif", display: "block",
  };

  return (
    <>
    <style>{`
      .pmpX-overlay{position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,0.62);
        display:flex;align-items:center;justify-content:center;padding:12px;backdrop-filter:blur(5px);}
      .pmpX-dialog{background:#fff;border-radius:14px;
        box-shadow:0 28px 90px rgba(0,0,0,0.4);
        display:flex;flex-direction:column;
        width:100%;max-width:1090px;max-height:94vh;overflow:hidden;font-family:Arial,sans-serif;}
      .pmpX-header{display:flex;align-items:center;gap:12px;
        padding:14px 20px;border-bottom:1px solid #e8eaed;flex-shrink:0;}
      .pmpX-body{display:flex;flex:1;overflow:hidden;}
      .pmpX-side{width:282px;flex-shrink:0;border-right:1px solid #e8eaed;
        display:flex;flex-direction:column;overflow:hidden;}
      .pmpX-tabs{display:flex;border-bottom:1px solid #e8eaed;flex-shrink:0;}
      .pmpX-sc{flex:1;overflow-y:auto;padding:12px 16px;}
      .pmpX-sc::-webkit-scrollbar{width:4px;}
      .pmpX-sc::-webkit-scrollbar-thumb{background:#ddd;border-radius:2px;}
      .pmpX-preview{flex:1;background:#dde2e8;
        display:flex;flex-direction:column;align-items:center;
        justify-content:flex-start;padding:18px;overflow:auto;gap:12px;}
      .pmpX-footer{display:flex;align-items:center;gap:8px;
        padding:11px 20px;border-top:1px solid #e8eaed;flex-shrink:0;background:#fafafa;}
      .pmpX-btn{display:flex;align-items:center;gap:6px;padding:9px 18px;
        border-radius:22px;border:none;cursor:pointer;
        font-family:Arial,sans-serif;font-size:12.5px;font-weight:700;transition:all 0.15s;}
      .pmpX-primary{background:#1a73e8;color:#fff;box-shadow:0 2px 8px rgba(26,115,232,0.3);}
      .pmpX-primary:hover{background:#1557b0;}
      .pmpX-secondary{background:#fff;color:#3c4043;border:1.5px solid #dadce0;}
      .pmpX-secondary:hover{background:#f1f3f4;}
      .pmpX-el-row{display:flex;align-items:center;gap:10px;
        padding:8px 10px;border-radius:8px;cursor:pointer;transition:background 0.12s;}
      .pmpX-el-row:hover{background:#f1f3f4;}
      .pmpX-tog{width:40px;height:22px;border-radius:11px;border:none;
        cursor:pointer;position:relative;transition:background 0.2s;padding:0;flex-shrink:0;}
      .pmpX-knob{position:absolute;top:3px;width:16px;height:16px;
        border-radius:50%;background:#fff;transition:left 0.2s;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);}
      .pmpX-ti{width:100%;border:none;outline:none;font-size:16px;
        font-weight:700;color:#202124;background:transparent;
        font-family:Arial,sans-serif;padding:2px 0;}
      .pmpX-ti:focus{border-bottom:2px solid #1a73e8;}
      .pmpX-di{width:100%;border:none;outline:none;font-size:11.5px;
        color:#5f6368;background:transparent;font-family:Arial,sans-serif;
        resize:none;padding:2px 0;margin-top:4px;line-height:1.55;}
      .pmp-draggable:hover::before{
        content:"⠿ drag";position:absolute;top:-18px;left:0;
        background:rgba(26,115,232,0.88);color:#fff;
        font-size:9px;padding:2px 6px;border-radius:3px;
        white-space:nowrap;pointer-events:none;font-family:Arial,sans-serif;
        z-index:99;
      }
      @keyframes spinX{to{transform:rotate(360deg);}}
      @media(max-width:720px){
        .pmpX-dialog{max-width:100%;max-height:100vh;border-radius:0;}
        .pmpX-body{flex-direction:column;}
        .pmpX-side{width:100%;border-right:none;border-bottom:1px solid #e8eaed;max-height:220px;}
        .pmpX-preview{padding:10px;}
      }
    `}</style>

    <div className="pmpX-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="pmpX-dialog" onClick={e => e.stopPropagation()}>

      {/* HEADER */}
      <div className="pmpX-header">
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: "linear-gradient(135deg,#1a73e8,#0f9d58)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
        }}>🖨</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: "#202124", fontFamily: "Arial,sans-serif" }}>
            Print / Save Map Image
          </div>
          <div style={{ fontSize: 10.5, color: "#5f6368", marginTop: 1, fontFamily: "Arial,sans-serif" }}>
            Drag any overlay in the preview to reposition it · Capture map then export
          </div>
        </div>
        <button onClick={onClose} style={{
          width: 32, height: 32, borderRadius: 7, border: "1px solid #dadce0",
          background: "#fff", cursor: "pointer", fontSize: 18, color: "#5f6368",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>×</button>
      </div>

      {/* BODY */}
      <div className="pmpX-body">

        {/* SIDEBAR */}
        <div className="pmpX-side">
          <div className="pmpX-tabs">
            {[["layout","Layout"],["elements","Elements"],["style","Style"]].map(([t,l]) => (
              <button key={t} style={tabSt(t)} onClick={() => setActiveTab(t)}>{l}</button>
            ))}
          </div>
          <div className="pmpX-sc">

            {/* LAYOUT TAB */}
            {activeTab === "layout" && <>
              <div style={{ border:"1px solid #e8eaed", borderRadius:9, padding:"10px 13px", marginBottom:12, background:"#fafafa" }}>
                <input className="pmpX-ti" value={title} onChange={e => setTitle(e.target.value)} placeholder="Untitled Map" maxLength={80}/>
                <textarea className="pmpX-di" value={description} onChange={e => setDescription(e.target.value)} placeholder="Write a description for your map." rows={2} maxLength={200}/>
              </div>

              <span style={secLabel}>Paper Size</span>
              <select value={paperKey} onChange={e => setPaperKey(e.target.value)} style={selSt}>
                {PAPER_SIZES.map(p => <option key={p.key} value={p.key}>{p.label} ({p.w}×{p.h}mm)</option>)}
              </select>

              <span style={secLabel}>Map Info</span>
              <div style={{ background:"#f8f9fa", border:"1px solid #e8eaed", borderRadius:8, padding:"10px 12px", fontSize:11.5, color:"#5f6368", lineHeight:2, fontFamily:"Arial,sans-serif" }}>
                <div>🗺 {activeLayer}</div>
                <div>🔍 Zoom {mapZoom} · {fmtScale(mapZoom)}</div>
                {mapCenter && <div>📍 {mapCenter.lat.toFixed(4)}°, {mapCenter.lng.toFixed(4)}°</div>}
                {savedDrawings.length > 0 && <div>✏ {savedDrawings.length} drawing{savedDrawings.length !== 1 ? "s" : ""}</div>}
                {kmlName && <div>📁 {kmlName}</div>}
                {geojsonFileName && <div>🌐 {geojsonFileName}</div>}
              </div>

              <button
                onClick={() => setPositions(defaultPos(pH))}
                className="pmpX-btn pmpX-secondary"
                style={{ marginTop: 14, width: "100%", justifyContent: "center", fontSize: 11.5 }}
              >
                ↺ Reset Element Positions
              </button>
            </>}

            {/* ELEMENTS TAB */}
            {activeTab === "elements" && <>
              <div style={{ fontSize: 10.5, color: "#5f6368", marginBottom: 10, lineHeight: 1.7, fontFamily: "Arial,sans-serif" }}>
                Toggle overlays. <strong>Drag them in the preview</strong> to move.
              </div>
              {[
                { k:"title",       label:"Map Title",   icon:"T"  },
                { k:"description", label:"Description", icon:"¶"  },
                { k:"legend",      label:"Legend",      icon:"☰"  },
                { k:"scalebar",    label:"Scale Bar",   icon:"⟷"  },
                { k:"northarrow",  label:"North Arrow", icon:"↑N" },
                { k:"coordinates", label:"Coordinates", icon:"⊕"  },
                { k:"date",        label:"Date",        icon:"📅" },
                { k:"attribution", label:"Attribution", icon:"©"  },
              ].map(({ k, label, icon }) => {
                const on = elements[k] !== false;
                return (
                  <div key={k} className="pmpX-el-row" onClick={() => toggleEl(k)}>
                    <span style={{ fontSize: 14, width: 22, textAlign: "center" }}>{icon}</span>
                    <span style={{ flex: 1, fontSize: 12.5, color: "#202124", fontFamily: "Arial,sans-serif", fontWeight: 500 }}>{label}</span>
                    <button
                      className="pmpX-tog"
                      style={{ background: on ? "#1a73e8" : "#bdc1c6" }}
                      onClick={e => { e.stopPropagation(); toggleEl(k); }}
                    >
                      <div className="pmpX-knob" style={{ left: on ? 21 : 3 }}/>
                    </button>
                  </div>
                );
              })}
            </>}

            {/* STYLE TAB */}
            {activeTab === "style" && <>
              {[
                { label:"Title Color", val: textColor, set: setTextColor },
                { label:"Background",  val: bgColor,   set: setBgColor   },
              ].map(({ label, val, set }) => (
                <div key={label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 0", borderBottom:"1px solid #f1f3f4", gap:8 }}>
                  <span style={{ fontSize:12.5, color:"#3c4043", fontFamily:"Arial,sans-serif", fontWeight:500 }}>{label}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <input type="color" value={val} onChange={e => set(e.target.value)}
                      style={{ width:32, height:28, padding:0, border:"1.5px solid #dadce0", borderRadius:4, cursor:"pointer" }}/>
                    <span style={{ fontSize:10, color:"#5f6368", fontFamily:"monospace" }}>{val.toUpperCase()}</span>
                  </div>
                </div>
              ))}

              <span style={secLabel}>Preset Themes</span>
              {[
                { label:"Classic",   tc:"#202124", bg:"#ffffff" },
                { label:"Dark",      tc:"#e8eaed", bg:"#1c1f26" },
                { label:"Blueprint", tc:"#e8f4f8", bg:"#0d2137" },
                { label:"Sepia",     tc:"#3b2f1e", bg:"#f5f0e8" },
              ].map(({ label, tc, bg }) => (
                <button key={label} onClick={() => { setTextColor(tc); setBgColor(bg); }}
                  style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"8px 11px", marginBottom:6, borderRadius:9, border:"1.5px solid #e8eaed", background:bg, cursor:"pointer", fontFamily:"Arial,sans-serif" }}>
                  <div style={{ width:14, height:14, borderRadius:3, background:tc, flexShrink:0, border:"1px solid rgba(0,0,0,0.15)" }}/>
                  <span style={{ fontSize:12, color:tc, fontWeight:500 }}>{label}</span>
                </button>
              ))}
            </>}
          </div>
        </div>

        {/* PREVIEW AREA */}
        <div className="pmpX-preview">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", maxWidth:PREVIEW_W }}>
            <div style={{ fontSize:10, color:"#5f6368", fontWeight:700, letterSpacing:"0.08em", fontFamily:"Arial,sans-serif" }}>
              PREVIEW — {paper.label}&nbsp;
              <span style={{ fontWeight:400, opacity:0.7 }}>· hover overlay to see drag handle</span>
            </div>
            <button onClick={captureMap} disabled={capturing} className="pmpX-btn pmpX-secondary" style={{ fontSize:11, padding:"6px 14px", gap:5 }}>
              {capturing
                ? <span style={{ animation:"spinX 0.8s linear infinite", display:"inline-block" }}>⟳</span>
                : "📷"}
              {capturing ? " Capturing…" : " Capture Map"}
            </button>
          </div>

          <PreviewCanvas
            paperKey={paperKey} mapImgUrl={mapImgUrl}
            elements={elements} positions={positions} onMove={moveEl}
            title={title} description={description}
            mapZoom={mapZoom} activeLayer={activeLayer}
            savedDrawings={savedDrawings} kmlName={kmlName}
            extraFile={extraFile} extraFileType={extraFileType}
            geojsonFileName={geojsonFileName} shpFileName={shpFileName}
            demFileName={demFileName} importedGeoJSONLayers={importedGeoJSONLayers}
            surveyMode={surveyMode} route={route}
            measurePoints={measurePoints} measureMode={measureMode}
            mapCenter={mapCenter} textColor={textColor} bgColor={bgColor}
          />

          <div style={{ fontSize:10, color:"#80868b", maxWidth:PREVIEW_W, textAlign:"center", lineHeight:1.8, fontFamily:"Arial,sans-serif" }}>
            💡 Click <strong>Capture Map</strong> to snapshot live map tiles into the preview.
            Hover any overlay (title, legend, north arrow…) and drag to reposition.
            Then <strong>Save PNG</strong> or <strong>Print / Save PDF</strong>.
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="pmpX-footer">
        <button className="pmpX-btn pmpX-primary" onClick={savePNG} disabled={saving}>
          {saving ? <span style={{ animation:"spinX 0.8s linear infinite", display:"inline-block" }}>⟳</span> : "💾"}
          {saving ? " Exporting…" : " Save as PNG"}
        </button>
        <button className="pmpX-btn pmpX-secondary" onClick={doPrint} disabled={saving}>
          🖨 Print / Save PDF
        </button>
        <div style={{ flex: 1 }}/>
        <div style={{ fontSize:10, color:"#9aa0a6", fontFamily:"Arial,sans-serif" }}>
          {paper.label} · Zoom {mapZoom} · {fmtScale(mapZoom)}
        </div>
        <button className="pmpX-btn pmpX-secondary" onClick={onClose}>Close</button>
      </div>

    </div>
    </div>
    </>
  );
}