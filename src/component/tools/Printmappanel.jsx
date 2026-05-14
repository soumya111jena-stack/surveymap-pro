/**
 * PrintMapPanel.jsx — SurveyMap Pro (GeoXis Edition)
 *
 * ══════════════════════════════════════════════════════════════════════
 * DEFINITIVE POLYGON-SHIFT FIX
 * ══════════════════════════════════════════════════════════════════════
 *
 * ROOT CAUSE (finally confirmed):
 *   Leaflet's SVG overlay layer (.leaflet-overlay-pane svg) is a
 *   FULL-VIEWPORT SVG — it starts at left:0, top:0 of the window,
 *   NOT at the map container's left edge.  The map container itself
 *   starts at x = SB_W (264 px) because of the sidebar.
 *
 *   So when we compute:
 *     x = svg.getBoundingClientRect().left - mapEl.getBoundingClientRect().left
 *       = 0 - 264 = -264  ← WRONG
 *
 *   This draws the polygon 264 px to the left of where it should be.
 *   That is EXACTLY the visible shift.
 *
 * THE FIX — two-part:
 *
 *   Part A — SVG capture:
 *     Instead of drawing the whole SVG at its getBoundingClientRect()
 *     position, we use the SVG's own viewBox / width / height and
 *     draw it at (0,0) at full map-element size.  Leaflet always
 *     sizes its overlay SVG to exactly match the map pane, so this
 *     is always correct regardless of where the map sits on screen.
 *
 *   Part B — Tile capture:
 *     Tiles use getBoundingClientRect() which IS relative to the
 *     viewport.  We subtract the MAP container rect (not the SVG
 *     rect) to get tile position relative to the map.  This was
 *     already correct for tiles; only SVG was broken.
 *
 * DISPLAY:
 *   The native-size capture (imgW × imgH = mapEl.offsetWidth × offsetHeight)
 *   is displayed centred in the smaller preview frame with no CSS
 *   scaling — so the polygon pixel positions are preserved exactly.
 *   Panning shifts left/top; clamped so the frame is always covered.
 *
 * EXPORT (savePNG / doPrint):
 *   cropToPreview() slices the visible rectangle out of the full
 *   capture and swaps it into the DOM before html2canvas runs, so
 *   html2canvas never sees a negatively-offset image.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";

/* ─── Paper sizes ─────────────────────────────────────────────────── */
const PAPER_SIZES = [
  { key:"a4l",  label:"A4 Landscape",     w:297, h:210, ratio:297/210 },
  { key:"a4p",  label:"A4 Portrait",      w:210, h:297, ratio:210/297 },
  { key:"a3l",  label:"A3 Landscape",     w:420, h:297, ratio:420/297 },
  { key:"a3p",  label:"A3 Portrait",      w:297, h:420, ratio:297/420 },
  { key:"ltr",  label:"Letter Landscape", w:279, h:216, ratio:279/216 },
  { key:"ltrp", label:"Letter Portrait",  w:216, h:279, ratio:216/279 },
];
const PREVIEW_W = 620;

/* ─── Scale helpers ───────────────────────────────────────────────── */
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
const fmtScale = z => { const s = SCALE_MAP[Math.round(z)] ?? 5000000; return `1 : ${s.toLocaleString()}`; };
const fmtBar   = z => { const m = SCALEBAR_M[Math.round(z)] ?? 1000; return m >= 1000 ? `${m/1000} km` : `${m} m`; };
const todayStr = () => new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});

function getCenter(ref) {
  try {
    const m = ref?.current;
    if (m && typeof m.getCenter === "function") { const c = m.getCenter(); return { lat:c.lat, lng:c.lng }; }
  } catch(_) {}
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   captureMapNative  — THE FIXED CAPTURE FUNCTION
   ───────────────────────────────────────────────────────────────────
   Returns { url, w, h } where w = mapEl.offsetWidth,
   h = mapEl.offsetHeight.

   KEY FIX: SVG overlays (KML polygon, GeoJSON, drawings) are drawn
   at (0,0) at exactly mapEl.offsetWidth × mapEl.offsetHeight.
   Leaflet guarantees its overlay SVG matches the map pane exactly,
   so this is always correct — and avoids the getBoundingClientRect()
   viewport-offset problem entirely.
═══════════════════════════════════════════════════════════════════ */
async function captureMapNative(mapEl) {
  const W = mapEl.offsetWidth;
  const H = mapEl.offsetHeight;

  const canvas = document.createElement("canvas");
  canvas.width  = W * 2;   // retina ×2
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, W, H);

  const mr = mapEl.getBoundingClientRect();  // used ONLY for tiles
  let tileCount = 0;

  /* ── 1. Raster tile images ──────────────────────────────────────
     Tiles use getBoundingClientRect() correctly — they sit inside
     the map container so their positions are relative to the
     viewport, and subtracting mr.left/top gives the correct
     offset within the map pane.
  ─────────────────────────────────────────────────────────────── */
  const tileEls = [
    ...mapEl.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"),
    ...mapEl.querySelectorAll(".leaflet-tile-pane img"),
  ];
  const seenSrc = new Set();
  for (const img of tileEls) {
    if (seenSrc.has(img.src)) continue;
    seenSrc.add(img.src);
    if (!img.complete || img.naturalWidth === 0) continue;
    if (img.style.display === "none" || img.style.visibility === "hidden") continue;
    try {
      const r = img.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // Position relative to the map container — correct for tiles
      ctx.drawImage(img,
        r.left - mr.left, r.top - mr.top, r.width, r.height);
      tileCount++;
    } catch(e) { console.warn("tile CORS", img.src?.slice(0,60)); }
  }

  /* ── 2. WebGL / Canvas overlays ───────────────────────────────── */
  for (const c of mapEl.querySelectorAll("canvas")) {
    try {
      const r = c.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      ctx.drawImage(c, r.left - mr.left, r.top - mr.top, r.width, r.height);
      tileCount++;
    } catch(_) {}
  }

  if (tileCount === 0) return null;

  /* ── 3. SVG overlays (KML, GeoJSON, drawn polygons) ───────────────
     THE FIX: Leaflet's overlay SVG is full-viewport, so its
     getBoundingClientRect().left ≠ mr.left (the map container left).
     That difference equals the sidebar width and is the exact shift
     seen in all previous attempts.

     Solution: draw the SVG at (0, 0) using the map element's
     own dimensions.  Leaflet sizes .leaflet-overlay-pane svg to
     match the map pane exactly, so this is always 1:1 correct.

     We also check for transform="translate(X,Y)" that Leaflet uses
     to pan the overlay pane and account for it via CSS transform
     inspection so fast-pan doesn't cause a 1-tile-width offset.
  ─────────────────────────────────────────────────────────────── */
  const svgEls = [...mapEl.querySelectorAll("svg")];
  for (const svg of svgEls) {
    try {
      const svgW = svg.clientWidth  || svg.getBoundingClientRect().width;
      const svgH = svg.clientHeight || svg.getBoundingClientRect().height;
      if (svgW < 1 || svgH < 1) continue;

      // Check if the parent pane has a CSS transform (Leaflet pan offset)
      // e.g. .leaflet-map-pane has transform:translate3d(Xpx,Ypx,0)
      let paneOffX = 0, paneOffY = 0;
      const pane = svg.closest(".leaflet-pane");
      if (pane) {
        const style = window.getComputedStyle(pane);
        const matrix = new DOMMatrix(style.transform);
        paneOffX = matrix.m41;
        paneOffY = matrix.m42;
      }

      // Serialize and draw at map-relative position
      const xml  = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([xml], { type:"image/svg+xml;charset=utf-8" });
      const url  = URL.createObjectURL(blob);

      await new Promise(res => {
        const img = new Image();
        img.onload = () => {
          // Draw at pane offset (usually 0,0 unless mid-pan)
          ctx.drawImage(img, paneOffX, paneOffY, svgW, svgH);
          URL.revokeObjectURL(url);
          res();
        };
        img.onerror = () => { URL.revokeObjectURL(url); res(); };
        img.src = url;
      });
    } catch(_) {}
  }

  return { url: canvas.toDataURL("image/png"), w: W, h: H };
}

/* ═══════════════════════════════════════════════════════════════════
   cropToPreview
   ───────────────────────────────────────────────────────────────────
   Cuts the currently-visible rectangle out of the full native capture
   (accounting for mapOffset pan) and returns a data-URL at
   previewW × previewH.  Pure pixel copy — trivially correct.
═══════════════════════════════════════════════════════════════════ */
function cropToPreview(imgUrl, imgW, imgH, previewW, previewH, mapOffset) {
  if (!imgUrl) return Promise.resolve(null);
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      const dpr = image.naturalWidth / imgW;   // retina factor (usually 2)

      const centreLeft = (imgW - previewW) / 2;
      const centreTop  = (imgH - previewH) / 2;

      const srcX = Math.max(0, Math.min(imgW - previewW, centreLeft - mapOffset.x));
      const srcY = Math.max(0, Math.min(imgH - previewH, centreTop  - mapOffset.y));

      const out = document.createElement("canvas");
      out.width  = previewW * 2;
      out.height = previewH * 2;
      const ctx  = out.getContext("2d");

      ctx.drawImage(image,
        srcX * dpr, srcY * dpr, previewW * dpr, previewH * dpr,
        0, 0, out.width, out.height);

      resolve(out.toDataURL("image/png"));
    };
    image.onerror = () => resolve(null);
    image.src = imgUrl;
  });
}

/* ─── North Arrow ─────────────────────────────────────────────────── */
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

/* ─── Draggable overlay wrapper ───────────────────────────────────── */
function Draggable({ id, pos, onMove, previewW, previewH, children }) {
  const elRef     = useRef(null);
  const dragRef   = useRef(false);
  const originRef = useRef({});

  const onMouseDown = useCallback(e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    dragRef.current   = true;
    originRef.current = { mx:e.clientX, my:e.clientY, px:pos.x, py:pos.y };
    const onMove_ = ev => {
      if (!dragRef.current) return;
      const el   = elRef.current;
      const maxX = previewW - (el ? el.offsetWidth  : 80);
      const maxY = previewH - (el ? el.offsetHeight : 40);
      onMove(id,
        Math.max(0, Math.min(maxX, originRef.current.px + ev.clientX - originRef.current.mx)),
        Math.max(0, Math.min(maxY, originRef.current.py + ev.clientY - originRef.current.my)));
    };
    const onUp = () => {
      dragRef.current = false;
      window.removeEventListener("mousemove", onMove_);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove_);
    window.addEventListener("mouseup", onUp);
  }, [id, pos, onMove, previewW, previewH]);

  return (
    <div ref={elRef} onMouseDown={onMouseDown} className="pmp-draggable"
      style={{ position:"absolute", left:pos.x, top:pos.y, cursor:"grab", userSelect:"none", zIndex:10 }}>
      {children}
    </div>
  );
}

/* ─── Default overlay positions ───────────────────────────────────── */
function defaultPos(pH) {
  return {
    title:       { x:12,              y:12       },
    legend:      { x:PREVIEW_W - 195, y:12       },
    northarrow:  { x:PREVIEW_W - 64,  y:pH - 118 },
    coordinates: { x:PREVIEW_W - 195, y:pH - 96  },
    scalebar:    { x:12,              y:pH - 70   },
    dateattr:    { x:12,              y:pH - 22   },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   PannableMapBg
   ───────────────────────────────────────────────────────────────────
   Displays the native-size capture (imgW × imgH) centred inside the
   preview frame (previewW × previewH) with NO CSS scaling.

   Because imgW > previewW (map wider than preview), the image
   overflows equally on left and right → the centre of the capture
   = centre of the live map = centre of the preview.  Correct.

   Panning: left = (previewW−imgW)/2 + mapOffset.x  (usually < 0)
   Clamp: |mapOffset| ≤ maxD so image always covers the frame.

   className="pmp-map-native-img" lets exportCanvas swap it out
   for the pre-cropped flat version before html2canvas.
═══════════════════════════════════════════════════════════════════ */
function PannableMapBg({ mapImgUrl, imgW, imgH, previewW, previewH, mapOffset, onOffsetChange }) {
  const panRef    = useRef(false);
  const originRef = useRef({});

  const maxDx = Math.max(0, (imgW - previewW) / 2);
  const maxDy = Math.max(0, (imgH - previewH) / 2);

  const onMouseDown = useCallback(e => {
    if (e.button !== 0) return;
    if (e.target.closest(".pmp-draggable")) return;
    e.preventDefault();
    panRef.current    = true;
    originRef.current = { mx:e.clientX, my:e.clientY, ox:mapOffset.x, oy:mapOffset.y };
    const onMove = ev => {
      if (!panRef.current) return;
      onOffsetChange(
        Math.max(-maxDx, Math.min(maxDx, originRef.current.ox + ev.clientX - originRef.current.mx)),
        Math.max(-maxDy, Math.min(maxDy, originRef.current.oy + ev.clientY - originRef.current.my)));
    };
    const onUp = () => {
      panRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [mapOffset, onOffsetChange, maxDx, maxDy]);

  const left = (previewW - imgW) / 2 + mapOffset.x;
  const top  = (previewH - imgH) / 2 + mapOffset.y;

  return (
    <div onMouseDown={onMouseDown}
      style={{ position:"absolute", inset:0, overflow:"hidden", cursor:mapImgUrl?"move":"default" }}>
      {mapImgUrl ? (
        <img src={mapImgUrl} draggable={false}
          className="pmp-map-native-img"
          style={{ position:"absolute", width:imgW, height:imgH, left, top,
            userSelect:"none", pointerEvents:"none" }}
          alt="map" />
      ) : (
        <div style={{ background:"linear-gradient(160deg,#c5d8e8,#90b8ce 40%,#5a94b0 80%,#3a7490)",
          position:"absolute", inset:0, display:"flex", alignItems:"center",
          justifyContent:"center", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:38 }}>🗺</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.85)", fontStyle:"italic",
            textAlign:"center", padding:"0 24px" }}>Capturing map…</div>
        </div>
      )}
      <div style={{ position:"absolute", inset:0, pointerEvents:"none",
        boxShadow:"inset 0 0 40px rgba(0,0,0,0.18)" }}/>
      {mapImgUrl && (
        <div style={{ position:"absolute", bottom:6, right:8,
          background:"rgba(0,0,0,0.45)", color:"rgba(255,255,255,0.75)",
          borderRadius:4, padding:"2px 7px", fontSize:9,
          fontFamily:"Arial,sans-serif", pointerEvents:"none", letterSpacing:"0.04em" }}>
          ✥ drag to pan map
        </div>
      )}
    </div>
  );
}

/* ─── PreviewCanvas ───────────────────────────────────────────────── */
function PreviewCanvas({
  paperKey, mapImgUrl, imgW, imgH,
  elements, positions, onMove,
  title, description, mapZoom, activeLayer,
  savedDrawings, kmlName, extraFile, extraFileType,
  geojsonFileName, shpFileName, demFileName, importedGeoJSONLayers,
  surveyMode, route, measurePoints, measureMode,
  mapCenter, textColor, bgColor,
  mapOffset, onOffsetChange,
}) {
  const paper = PAPER_SIZES.find(p => p.key === paperKey) || PAPER_SIZES[0];
  const pH    = Math.round(PREVIEW_W / paper.ratio);
  const show  = k => elements[k] !== false;
  const drag  = { onMove, previewW:PREVIEW_W, previewH:pH };

  const legendItems = useMemo(() => {
    const items = [];
    items.push({ icon:"🛰", label:`${activeLayer} (basemap)`, color:null, type:"layer" });
    if (kmlName)         items.push({ icon:"📍", label:kmlName,          color:"#e74c3c", type:"kml"  });
    if (extraFile)       items.push({ icon:"📊", label:extraFile.name,   color:null,      type:"file" });
    if (geojsonFileName) items.push({ icon:"🌐", label:geojsonFileName,  color:"#2dd4bf", type:"geo"  });
    if (shpFileName)     items.push({ icon:"🗺", label:shpFileName,      color:"#a78bfa", type:"shp"  });
    if (demFileName)     items.push({ icon:"🏔", label:demFileName,      color:"#fb7185", type:"dem"  });
    importedGeoJSONLayers?.forEach(l => items.push({ icon:"🌐", label:l.name, color:"#5eead4", type:"geo" }));
    savedDrawings?.forEach(d => items.push({ icon:null, label:d.name, color:d.color||"#1a73e8", type:d.type||"polygon" }));
    if (surveyMode && route?.length > 0)          items.push({ icon:"📡", label:`Survey Route (${route.length} pts)`, color:"#ef4444", type:"path" });
    if (measureMode && measurePoints?.length > 0) items.push({ icon:"📏", label:"Measurement", color:"#fbbf24", type:"path" });
    return items;
  }, [activeLayer, kmlName, extraFile, geojsonFileName, shpFileName, demFileName,
      importedGeoJSONLayers, savedDrawings, surveyMode, route, measureMode, measurePoints]);

  return (
    <div id="pmp-canvas" style={{
      width:PREVIEW_W, height:pH, position:"relative", overflow:"hidden",
      background:bgColor||"#fff", borderRadius:4,
      boxShadow:"0 4px 28px rgba(0,0,0,0.22)", flexShrink:0, fontFamily:"Arial,sans-serif",
    }}>
      <PannableMapBg
        mapImgUrl={mapImgUrl} imgW={imgW} imgH={imgH}
        previewW={PREVIEW_W} previewH={pH}
        mapOffset={mapOffset} onOffsetChange={onOffsetChange}
      />

      {(show("title") || show("description")) && (
        <Draggable id="title" pos={positions.title} {...drag}>
          <div style={{ background:"rgba(255,255,255,0.93)", borderRadius:3, padding:"10px 14px",
            boxShadow:"0 2px 10px rgba(0,0,0,0.22)", minWidth:130, maxWidth:220, backdropFilter:"blur(2px)" }}>
            {show("title") && (
              <div style={{ fontSize:16, fontWeight:700, color:textColor||"#202124",
                lineHeight:1.25, fontFamily:"Arial,sans-serif" }}>{title||"Untitled Map"}</div>
            )}
            {show("description") && description && (
              <div style={{ fontSize:10.5, color:"#5f6368", marginTop:3, lineHeight:1.5,
                fontFamily:"Arial,sans-serif" }}>{description}</div>
            )}
          </div>
        </Draggable>
      )}

      {show("legend") && legendItems.length > 0 && (
        <Draggable id="legend" pos={positions.legend} {...drag}>
          <div style={{ background:"rgba(255,255,255,0.93)", borderRadius:3, padding:"9px 13px",
            boxShadow:"0 2px 10px rgba(0,0,0,0.22)", minWidth:130, maxWidth:185, backdropFilter:"blur(2px)" }}>
            <div style={{ fontSize:12, fontWeight:700, color:"#202124",
              borderBottom:"1px solid #e0e0e0", paddingBottom:5, marginBottom:5,
              fontFamily:"Arial,sans-serif" }}>Legend</div>
            {legendItems.slice(0,10).map((item,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:7, padding:"2px 0" }}>
                {item.icon
                  ? <span style={{ fontSize:12, width:18, textAlign:"center", flexShrink:0 }}>{item.icon}</span>
                  : <div style={{ width:item.type==="path"?22:13, height:item.type==="path"?3:13,
                      borderRadius:2, background:item.color||"#1a73e8", flexShrink:0,
                      border:"1px solid rgba(0,0,0,0.15)" }}/>
                }
                <span style={{ fontSize:10.5, color:"#202124", overflow:"hidden",
                  textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:130,
                  fontFamily:"Arial,sans-serif" }}>{item.label}</span>
              </div>
            ))}
            {legendItems.length > 10 && (
              <div style={{ fontSize:9, color:"#9aa0a6", fontStyle:"italic", paddingTop:3 }}>
                +{legendItems.length-10} more…
              </div>
            )}
          </div>
        </Draggable>
      )}

      {show("northarrow") && (
        <Draggable id="northarrow" pos={positions.northarrow} {...drag}>
          <div style={{ filter:"drop-shadow(0 2px 5px rgba(0,0,0,0.3))" }}>
            <NorthArrow size={52}/>
          </div>
        </Draggable>
      )}

      {show("coordinates") && mapCenter && (
        <Draggable id="coordinates" pos={positions.coordinates} {...drag}>
          <div style={{ background:"rgba(0,0,0,0.62)", color:"#fff", borderRadius:4, padding:"4px 9px",
            fontSize:10.5, fontFamily:"monospace", whiteSpace:"nowrap", letterSpacing:"0.02em",
            boxShadow:"0 1px 4px rgba(0,0,0,0.35)" }}>
            {mapCenter.lat.toFixed(5)}°, {mapCenter.lng.toFixed(5)}°
          </div>
        </Draggable>
      )}

      {show("scalebar") && (
        <Draggable id="scalebar" pos={positions.scalebar} {...drag}>
          <div style={{ display:"flex", flexDirection:"column", gap:2, alignItems:"flex-start" }}>
            <div style={{ display:"flex", alignItems:"center" }}>
              <div style={{ width:1, height:10, background:"#fff", boxShadow:"0 0 2px #000" }}/>
              {[0,1,2,3].map(i => (
                <div key={i} style={{ width:24, height:6,
                  background:i%2===0?"#fff":"rgba(0,0,0,0.75)",
                  border:"1px solid rgba(0,0,0,0.5)", boxSizing:"border-box" }}/>
              ))}
              <div style={{ width:1, height:10, background:"#fff", boxShadow:"0 0 2px #000" }}/>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", width:"100%" }}>
              <span style={{ fontSize:9, color:"#fff", textShadow:"0 1px 2px rgba(0,0,0,0.9)",
                fontFamily:"Arial,sans-serif" }}>0</span>
              <span style={{ fontSize:9, color:"#fff", textShadow:"0 1px 2px rgba(0,0,0,0.9)",
                fontFamily:"Arial,sans-serif" }}>{fmtBar(mapZoom)}</span>
            </div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.8)",
              textShadow:"0 1px 2px rgba(0,0,0,0.8)", fontFamily:"Arial,sans-serif" }}>
              {fmtScale(mapZoom)}
            </div>
          </div>
        </Draggable>
      )}

      {(show("date") || show("attribution")) && (
        <Draggable id="dateattr" pos={positions.dateattr} {...drag}>
          <div style={{ background:"rgba(0,0,0,0.58)", color:"rgba(255,255,255,0.92)", borderRadius:3,
            padding:"3px 8px", fontSize:9.5, fontFamily:"Arial,sans-serif", whiteSpace:"nowrap",
            boxShadow:"0 1px 4px rgba(0,0,0,0.3)" }}>
            {show("date") && <span>{todayStr()}</span>}
            {show("date") && show("attribution") && <span style={{ margin:"0 6px", opacity:0.5 }}>|</span>}
            {show("attribution") && <span style={{ opacity:0.75 }}>© OpenStreetMap | Geoxis</span>}
          </div>
        </Draggable>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   exportCanvas — shared by savePNG and doPrint
   Swaps the panned native image with a flat pre-cropped version
   before html2canvas so html2canvas never sees negative left/top.
═══════════════════════════════════════════════════════════════════ */
async function exportCanvas({ mapImgUrl, imgW, imgH, previewW, pH, mapOffset, bgColor }) {
  const el = document.getElementById("pmp-canvas");
  if (!el || !window.html2canvas) throw new Error("Renderer not ready");

  const croppedUrl = await cropToPreview(mapImgUrl, imgW, imgH, previewW, pH, mapOffset);

  const bgImg = el.querySelector(".pmp-map-native-img");
  let saved = null;
  if (bgImg && croppedUrl) {
    saved = { src:bgImg.src, left:bgImg.style.left, top:bgImg.style.top,
              width:bgImg.style.width, height:bgImg.style.height };
    bgImg.src          = croppedUrl;
    bgImg.style.left   = "0px";
    bgImg.style.top    = "0px";
    bgImg.style.width  = previewW + "px";
    bgImg.style.height = pH + "px";
    await new Promise(r => { bgImg.onload = r; setTimeout(r, 200); });
  }

  const canvas = await window.html2canvas(el, {
    useCORS:true, allowTaint:true, scale:2,
    backgroundColor:bgColor||"#fff", logging:false,
  });

  if (bgImg && saved) {
    bgImg.src          = saved.src;
    bgImg.style.left   = saved.left;
    bgImg.style.top    = saved.top;
    bgImg.style.width  = saved.width;
    bgImg.style.height = saved.height;
  }

  return canvas;
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN PANEL
═══════════════════════════════════════════════════════════════════ */
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
  const [imgW, setImgW]               = useState(PREVIEW_W);
  const [imgH, setImgH]               = useState(Math.round(PREVIEW_W / (297/210)));
  const [capturing, setCapturing]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [mapCenter, setMapCenter]     = useState(null);
  const [activeTab, setActiveTab]     = useState("layout");
  const [positions, setPositions]     = useState(null);
  const [mapOffset, setMapOffset]     = useState({ x:0, y:0 });

  const paper = PAPER_SIZES.find(p => p.key === paperKey) || PAPER_SIZES[0];
  const pH    = Math.round(PREVIEW_W / paper.ratio);

  useEffect(() => { setPositions(defaultPos(pH)); }, [paperKey]);
  useEffect(() => { setMapOffset({ x:0, y:0 }); }, [paperKey, mapImgUrl]);

  const handleOffsetChange = useCallback((x, y) => setMapOffset({ x, y }), []);
  const moveEl   = useCallback((id, x, y) => setPositions(p => ({ ...p, [id]:{ x, y } })), []);
  const toggleEl = k => setElements(p => ({ ...p, [k]: p[k] === false ? true : false }));

  /* ── CAPTURE ──────────────────────────────────────────────────── */
  const runCapture = useCallback(async () => {
    setCapturing(true);
    const c = getCenter(leafletMapRef);
    if (c) setMapCenter(c);
    else if (mousePos) setMapCenter(mousePos);

    try {
      const mapEl =
        leafletMapRef?.current?.getContainer?.() ||
        leafletMapRef?.current?.leafletElement?.getContainer?.() ||
        document.querySelector(".leaflet-container");

      if (!mapEl) { setCapturing(false); return; }

      // Pre-fetch tiles with CORS
      const tileImgs = [
        ...mapEl.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"),
        ...mapEl.querySelectorAll(".leaflet-tile-pane img"),
      ];
      await Promise.all(tileImgs.map(img => new Promise(res => {
        if (img.complete && img.naturalWidth > 0) { res(); return; }
        const fresh = new Image();
        fresh.crossOrigin = "anonymous";
        fresh.onload  = () => { try { img.src = fresh.src; } catch(_) {} res(); };
        fresh.onerror = res;
        const sep = img.src.includes("?") ? "&" : "?";
        fresh.src = img.src + sep + "_cb=" + Date.now();
      })));

      // Primary: custom canvas at NATIVE size with SVG fix
      const result = await captureMapNative(mapEl);
      if (result) {
        setImgW(result.w);
        setImgH(result.h);
        setMapImgUrl(result.url);
        setCapturing(false);
        return;
      }

      // Fallback: html2canvas at scale:1 (canvas.width === offsetWidth)
      if (window.html2canvas) {
        const canvas = await window.html2canvas(mapEl, {
          useCORS:true, allowTaint:false, scale:1, logging:false,
          width:mapEl.offsetWidth, height:mapEl.offsetHeight,
          ignoreElements: el => el.classList?.contains("leaflet-control-container"),
        });
        if (canvas.toDataURL("image/png").length > 10000) {
          setImgW(canvas.width);
          setImgH(canvas.height);
          setMapImgUrl(canvas.toDataURL("image/png"));
        }
      } else {
        // html2canvas not loaded yet
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
        s.onload = () => runCapture();
        document.head.appendChild(s);
        return;
      }
    } catch(e) { console.error("captureMap error:", e); }
    setCapturing(false);
  }, [leafletMapRef, mousePos]);

  /* ── AUTO-CAPTURE on open ───────────────────────────────────── */
  useEffect(() => {
    if (!visible) return;
    if (!positions) setPositions(defaultPos(pH));
    if (!window.html2canvas) {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      document.head.appendChild(s);
    }
    runCapture();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const captureMap = useCallback(() => { setMapImgUrl(null); runCapture(); }, [runCapture]);

  /* ── SAVE PNG ─────────────────────────────────────────────────── */
  const savePNG = useCallback(async () => {
    setSaving(true);
    try {
      const canvas = await exportCanvas({ mapImgUrl, imgW, imgH, previewW:PREVIEW_W, pH, mapOffset, bgColor });
      const a = document.createElement("a");
      a.download = `${(title||"map").replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,10)}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch(e) { alert("Export failed: " + e.message); }
    setSaving(false);
  }, [title, bgColor, mapImgUrl, imgW, imgH, pH, mapOffset]);

  /* ── PRINT / SAVE PDF ─────────────────────────────────────────── */
  const doPrint = useCallback(async () => {
    setSaving(true);
    try {
      const canvas  = await exportCanvas({ mapImgUrl, imgW, imgH, previewW:PREVIEW_W, pH, mapOffset, bgColor });
      const dataUrl = canvas.toDataURL("image/png");
      const pw = window.open("", "_blank", "width=900,height=700");
      if (!pw) { alert("Allow popups to print."); setSaving(false); return; }
      pw.document.write(`<!DOCTYPE html><html><head>
        <title>${title||"Map"}</title>
        <style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#fff;}
        @page{size:${paper.w}mm ${paper.h}mm;margin:0;}
        img{display:block;width:${paper.w}mm;height:${paper.h}mm;}</style></head><body>
        <img src="${dataUrl}" onload="setTimeout(function(){window.print();},400);"/></body></html>`);
      pw.document.close();
    } catch(e) { alert("Print failed: " + e.message); }
    setSaving(false);
  }, [title, bgColor, paper, mapImgUrl, imgW, imgH, pH, mapOffset]);

  if (!visible || !positions) return null;

  /* ── UI helpers ───────────────────────────────────────────────── */
  const tabSt = t => ({
    padding:"9px 16px", border:"none", cursor:"pointer", background:"transparent", fontSize:12.5,
    fontWeight:activeTab===t?700:400, color:activeTab===t?"#1a73e8":"#5f6368",
    borderBottom:`2.5px solid ${activeTab===t?"#1a73e8":"transparent"}`,
    fontFamily:"Arial,sans-serif", transition:"all 0.15s", flexShrink:0,
  });
  const selSt = {
    fontSize:12, color:"#202124", padding:"6px 10px", border:"1.5px solid #dadce0",
    borderRadius:7, background:"#fff", cursor:"pointer", outline:"none",
    fontFamily:"Arial,sans-serif", width:"100%", marginBottom:10,
  };
  const secLabel = {
    fontSize:10, fontWeight:700, color:"#5f6368", letterSpacing:"0.1em",
    textTransform:"uppercase", margin:"14px 0 7px", fontFamily:"Arial,sans-serif", display:"block",
  };

  return (
    <>
    <style>{`
      .pmpX-overlay{position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;padding:12px;backdrop-filter:blur(5px);}
      .pmpX-dialog{background:#fff;border-radius:14px;box-shadow:0 28px 90px rgba(0,0,0,0.4);display:flex;flex-direction:column;width:100%;max-width:1090px;max-height:94vh;overflow:hidden;font-family:Arial,sans-serif;}
      .pmpX-header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #e8eaed;flex-shrink:0;}
      .pmpX-body{display:flex;flex:1;overflow:hidden;}
      .pmpX-side{width:282px;flex-shrink:0;border-right:1px solid #e8eaed;display:flex;flex-direction:column;overflow:hidden;}
      .pmpX-tabs{display:flex;border-bottom:1px solid #e8eaed;flex-shrink:0;}
      .pmpX-sc{flex:1;overflow-y:auto;padding:12px 16px;}
      .pmpX-sc::-webkit-scrollbar{width:4px;}.pmpX-sc::-webkit-scrollbar-thumb{background:#ddd;border-radius:2px;}
      .pmpX-preview{flex:1;background:#dde2e8;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:18px;overflow:auto;gap:12px;}
      .pmpX-footer{display:flex;align-items:center;gap:8px;padding:11px 20px;border-top:1px solid #e8eaed;flex-shrink:0;background:#fafafa;}
      .pmpX-btn{display:flex;align-items:center;gap:6px;padding:9px 18px;border-radius:22px;border:none;cursor:pointer;font-family:Arial,sans-serif;font-size:12.5px;font-weight:700;transition:all 0.15s;}
      .pmpX-primary{background:#1a73e8;color:#fff;box-shadow:0 2px 8px rgba(26,115,232,0.3);}.pmpX-primary:hover{background:#1557b0;}
      .pmpX-secondary{background:#fff;color:#3c4043;border:1.5px solid #dadce0;}.pmpX-secondary:hover{background:#f1f3f4;}
      .pmpX-el-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background 0.12s;}.pmpX-el-row:hover{background:#f1f3f4;}
      .pmpX-tog{width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;position:relative;transition:background 0.2s;padding:0;flex-shrink:0;}
      .pmpX-knob{position:absolute;top:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left 0.2s;box-shadow:0 1px 4px rgba(0,0,0,0.3);}
      .pmpX-ti{width:100%;border:none;outline:none;font-size:16px;font-weight:700;color:#202124;background:transparent;font-family:Arial,sans-serif;padding:2px 0;}
      .pmpX-ti:focus{border-bottom:2px solid #1a73e8;}
      .pmpX-di{width:100%;border:none;outline:none;font-size:11.5px;color:#5f6368;background:transparent;font-family:Arial,sans-serif;resize:none;padding:2px 0;margin-top:4px;line-height:1.55;}
      .pmp-draggable:hover::before{content:"⠿ drag";position:absolute;top:-18px;left:0;background:rgba(26,115,232,0.88);color:#fff;font-size:9px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none;font-family:Arial,sans-serif;z-index:99;}
      @keyframes spinX{to{transform:rotate(360deg);}}
      @keyframes pulseCapture{0%,100%{opacity:1}50%{opacity:0.5}}
      .capturing-pulse{animation:pulseCapture 1.2s ease-in-out infinite;}
      @media(max-width:720px){.pmpX-dialog{max-width:100%;max-height:100vh;border-radius:0;}.pmpX-body{flex-direction:column;}.pmpX-side{width:100%;border-right:none;border-bottom:1px solid #e8eaed;max-height:220px;}.pmpX-preview{padding:10px;}}
    `}</style>

    <div className="pmpX-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div className="pmpX-dialog" onClick={e=>e.stopPropagation()}>

      {/* HEADER */}
      <div className="pmpX-header">
        <div style={{ width:38,height:38,borderRadius:10,flexShrink:0,
          background:"linear-gradient(135deg,#1a73e8,#0f9d58)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>🖨</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:15.5,fontWeight:700,color:"#202124",fontFamily:"Arial,sans-serif" }}>
            Print / Save Map Image</div>
          <div style={{ fontSize:10.5,color:"#5f6368",marginTop:1,fontFamily:"Arial,sans-serif" }}>
            {capturing?"⟳ Capturing map…":"Polygon-accurate · drag map to pan · drag overlays to reposition"}
          </div>
        </div>
        <button onClick={onClose} style={{ width:32,height:32,borderRadius:7,border:"1px solid #dadce0",
          background:"#fff",cursor:"pointer",fontSize:18,color:"#5f6368",
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>×</button>
      </div>

      {/* BODY */}
      <div className="pmpX-body">

        {/* SIDEBAR */}
        <div className="pmpX-side">
          <div className="pmpX-tabs">
            {[["layout","Layout"],["elements","Elements"],["style","Style"]].map(([t,l])=>(
              <button key={t} style={tabSt(t)} onClick={()=>setActiveTab(t)}>{l}</button>
            ))}
          </div>
          <div className="pmpX-sc">

            {activeTab==="layout" && <>
              <div style={{ border:"1px solid #e8eaed",borderRadius:9,padding:"10px 13px",marginBottom:12,background:"#fafafa" }}>
                <input className="pmpX-ti" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Untitled Map" maxLength={80}/>
                <textarea className="pmpX-di" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Write a description for your map." rows={2} maxLength={200}/>
              </div>
              <span style={secLabel}>Paper Size</span>
              <select value={paperKey} onChange={e=>setPaperKey(e.target.value)} style={selSt}>
                {PAPER_SIZES.map(p=><option key={p.key} value={p.key}>{p.label} ({p.w}×{p.h}mm)</option>)}
              </select>
              <span style={secLabel}>Map Info</span>
              <div style={{ background:"#f8f9fa",border:"1px solid #e8eaed",borderRadius:8,padding:"10px 12px",fontSize:11.5,color:"#5f6368",lineHeight:2,fontFamily:"Arial,sans-serif" }}>
                <div>🗺 {activeLayer}</div>
                <div>🔍 Zoom {mapZoom} · {fmtScale(mapZoom)}</div>
                {mapCenter&&<div>📍 {mapCenter.lat.toFixed(4)}°, {mapCenter.lng.toFixed(4)}°</div>}
                {savedDrawings.length>0&&<div>✏ {savedDrawings.length} drawing{savedDrawings.length!==1?"s":""}</div>}
                {kmlName&&<div>📁 {kmlName}</div>}
                {geojsonFileName&&<div>🌐 {geojsonFileName}</div>}
              </div>
              <button onClick={()=>setPositions(defaultPos(pH))} className="pmpX-btn pmpX-secondary"
                style={{ marginTop:14,width:"100%",justifyContent:"center",fontSize:11.5 }}>
                ↺ Reset Element Positions
              </button>
            </>}

            {activeTab==="elements" && <>
              <div style={{ fontSize:10.5,color:"#5f6368",marginBottom:10,lineHeight:1.7,fontFamily:"Arial,sans-serif" }}>
                Toggle overlays. <strong>Drag them in the preview</strong> to move.
              </div>
              {[
                {k:"title",label:"Map Title",icon:"T"},
                {k:"description",label:"Description",icon:"¶"},
                {k:"legend",label:"Legend",icon:"☰"},
                {k:"scalebar",label:"Scale Bar",icon:"⟷"},
                {k:"northarrow",label:"North Arrow",icon:"↑N"},
                {k:"coordinates",label:"Coordinates",icon:"⊕"},
                {k:"date",label:"Date",icon:"📅"},
                {k:"attribution",label:"Attribution",icon:"©"},
              ].map(({k,label,icon})=>{
                const on=elements[k]!==false;
                return (
                  <div key={k} className="pmpX-el-row" onClick={()=>toggleEl(k)}>
                    <span style={{ fontSize:14,width:22,textAlign:"center" }}>{icon}</span>
                    <span style={{ flex:1,fontSize:12.5,color:"#202124",fontFamily:"Arial,sans-serif",fontWeight:500 }}>{label}</span>
                    <button className="pmpX-tog" style={{ background:on?"#1a73e8":"#bdc1c6" }}
                      onClick={e=>{e.stopPropagation();toggleEl(k);}}>
                      <div className="pmpX-knob" style={{ left:on?21:3 }}/>
                    </button>
                  </div>
                );
              })}
            </>}

            {activeTab==="style" && <>
              {[{label:"Title Color",val:textColor,set:setTextColor},{label:"Background",val:bgColor,set:setBgColor}].map(({label,val,set})=>(
                <div key={label} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid #f1f3f4",gap:8 }}>
                  <span style={{ fontSize:12.5,color:"#3c4043",fontFamily:"Arial,sans-serif",fontWeight:500 }}>{label}</span>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <input type="color" value={val} onChange={e=>set(e.target.value)}
                      style={{ width:32,height:28,padding:0,border:"1.5px solid #dadce0",borderRadius:4,cursor:"pointer" }}/>
                    <span style={{ fontSize:10,color:"#5f6368",fontFamily:"monospace" }}>{val.toUpperCase()}</span>
                  </div>
                </div>
              ))}
              <span style={secLabel}>Preset Themes</span>
              {[{label:"Classic",tc:"#202124",bg:"#ffffff"},{label:"Dark",tc:"#e8eaed",bg:"#1c1f26"},{label:"Blueprint",tc:"#e8f4f8",bg:"#0d2137"},{label:"Sepia",tc:"#3b2f1e",bg:"#f5f0e8"}].map(({label,tc,bg})=>(
                <button key={label} onClick={()=>{setTextColor(tc);setBgColor(bg);}}
                  style={{ display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 11px",marginBottom:6,borderRadius:9,border:"1.5px solid #e8eaed",background:bg,cursor:"pointer",fontFamily:"Arial,sans-serif" }}>
                  <div style={{ width:14,height:14,borderRadius:3,background:tc,flexShrink:0,border:"1px solid rgba(0,0,0,0.15)" }}/>
                  <span style={{ fontSize:12,color:tc,fontWeight:500 }}>{label}</span>
                </button>
              ))}
            </>}
          </div>
        </div>

        {/* PREVIEW AREA */}
        <div className="pmpX-preview">
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",maxWidth:PREVIEW_W }}>
            <div style={{ fontSize:10,color:"#5f6368",fontWeight:700,letterSpacing:"0.08em",fontFamily:"Arial,sans-serif" }}>
              {capturing
                ?<span className="capturing-pulse">⟳ CAPTURING MAP…</span>
                :<>PREVIEW — {paper.label}&nbsp;<span style={{ fontWeight:400,opacity:0.7 }}>· drag map to pan · drag overlay to move</span></>
              }
            </div>
            <button onClick={captureMap} disabled={capturing} className="pmpX-btn pmpX-secondary"
              style={{ fontSize:11,padding:"6px 14px",gap:5 }}>
              {capturing?<span style={{ animation:"spinX 0.8s linear infinite",display:"inline-block" }}>⟳</span>:"📷"}
              {capturing?" Capturing…":" Re-capture"}
            </button>
          </div>

          <PreviewCanvas
            paperKey={paperKey} mapImgUrl={mapImgUrl} imgW={imgW} imgH={imgH}
            elements={elements} positions={positions} onMove={moveEl}
            title={title} description={description} mapZoom={mapZoom} activeLayer={activeLayer}
            savedDrawings={savedDrawings} kmlName={kmlName} extraFile={extraFile} extraFileType={extraFileType}
            geojsonFileName={geojsonFileName} shpFileName={shpFileName} demFileName={demFileName}
            importedGeoJSONLayers={importedGeoJSONLayers} surveyMode={surveyMode} route={route}
            measurePoints={measurePoints} measureMode={measureMode}
            mapCenter={mapCenter} textColor={textColor} bgColor={bgColor}
            mapOffset={mapOffset} onOffsetChange={handleOffsetChange}
          />

          <div style={{ fontSize:10,color:"#80868b",maxWidth:PREVIEW_W,textAlign:"center",lineHeight:1.8,fontFamily:"Arial,sans-serif" }}>
            💡 KML polygons are pixel-accurate — SVG offset fixed.
            <strong> Drag the map</strong> to pan. Hover overlays to reposition.
            Then <strong>Save PNG</strong> or <strong>Print / Save PDF</strong>.
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="pmpX-footer">
        <button className="pmpX-btn pmpX-primary" onClick={savePNG} disabled={saving}>
          {saving?<span style={{ animation:"spinX 0.8s linear infinite",display:"inline-block" }}>⟳</span>:"💾"}
          {saving?" Exporting…":" Save as PNG"}
        </button>
        <button className="pmpX-btn pmpX-secondary" onClick={doPrint} disabled={saving}>
          🖨 Print / Save PDF
        </button>
        <div style={{ flex:1 }}/>
        <div style={{ fontSize:10,color:"#9aa0a6",fontFamily:"Arial,sans-serif" }}>
          {paper.label} · Zoom {mapZoom} · {fmtScale(mapZoom)}
        </div>
        <button className="pmpX-btn pmpX-secondary" onClick={onClose}>Close</button>
      </div>

    </div>
    </div>
    </>
  );
}