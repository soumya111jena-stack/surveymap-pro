/**
 * MobileFileFolder.jsx  --  src/components/MobileFileFolder.jsx
 * -----------------------------------------------------------------------------
 * Unified file manager sheet for KML . KMZ . GeoJSON . CSV
 * Designed to fit cleanly inside MobileBottomSheet (maxHeight: 80vh).
 *
 * -- Wiring in SurveyMap.jsx (5 steps) ---------------------------------------
 *
 * 1. IMPORT
 *      import MobileFileFolder from "../components/MobileFileFolder.jsx";
 *
 * 2. STATE  (add inside SurveyMap)
 *      const [fileVisibility, setFileVisibility] = useState({});
 *
 *      // In handleKMLUpload -- add after setKmlFile(file):
 *      setFileVisibility(p => ({ ...p, __kml__: true }));
 *
 *      // In handleExtraUpload -- add after setExtraFileType(ext):
 *      setFileVisibility(p => ({ ...p, [`__${ext}__`]: true }));
 *
 *      // useEffect to auto-register GeoJSON layers:
 *      useEffect(() => {
 *        geoJSON.importedGeoJSONLayers.forEach(l => {
 *          setFileVisibility(p => p[l.id] !== undefined ? p : { ...p, [l.id]: true });
 *        });
 *      }, [geoJSON.importedGeoJSONLayers]);
 *
 * 3. SHEET CONTENT -- add inside <MobileBottomSheet>:
 *      {activeSheet === "files" && (
 *        <MobileFileFolder
 *          kmlInputRef={kmlInputRef}
 *          extraInputRef={extraInputRef}
 *          geojsonInputRef={geojsonInputRef}
 *          kmlName={kmlName}
 *          kmlLoading={kmlLoading}
 *          onKMLUpload={handleKMLUpload}
 *          onRemoveKML={() => {
 *            setKmlFile(null); setKmlName(null); setKmlLoading(false);
 *            setFileVisibility(p => { const n={...p}; delete n.__kml__; return n; });
 *          }}
 *          extraFile={extraFile}
 *          extraFileType={extraFileType}
 *          onExtraUpload={handleExtraUpload}
 *          onRemoveExtra={() => {
 *            setExtraFile(null); setExtraFileType(null);
 *            setFileVisibility(p => { const n={...p}; delete n.__kmz__; delete n.__csv__; return n; });
 *          }}
 *          importedGeoJSONLayers={geoJSON.importedGeoJSONLayers}
 *          onRemoveGeoJSON={geoJSON.removeGeoJSONLayer}
 *          onGeoJSONUpload={geoJSON.handleGeoJSONUpload}
 *          onExportGeoJSON={() => geoJSON.handleExportGeoJSON({ savedDrawings, route, measurePoints })}
 *          fileVisibility={fileVisibility}
 *          onToggleVisibility={(id) => setFileVisibility(p => ({ ...p, [id]: p[id] === false }))}
 *          onClose={() => setActiveSheet(null)}
 *        />
 *      )}
 *
 * 4. BOTTOM NAV BADGE -- pass counts to MobileBottomNav:
 *      <MobileBottomNav
 *        ...existing props...
 *        kmlName={kmlName}
 *        extraFile={extraFile}
 *        importedGeoJSONLayers={geoJSON.importedGeoJSONLayers}
 *      />
 */

import React, { useState } from "react";
import { SheetHeader, SheetDivider } from "./UIComponents.jsx";

/* --- Type config -------------------------------------------------------------- */
const T = {
  kml:     { label:"KML",     color:"#f59e0b", bg:"rgba(245,158,11,0.09)",  border:"rgba(245,158,11,0.26)"  },
  kmz:     { label:"KMZ",     color:"#f97316", bg:"rgba(249,115,22,0.09)",  border:"rgba(249,115,22,0.26)"  },
  geojson: { label:"GeoJSON", color:"#14b8a6", bg:"rgba(20,184,166,0.09)",  border:"rgba(20,184,166,0.26)"  },
  csv:     { label:"CSV",     color:"#22c55e", bg:"rgba(34,197,94,0.09)",   border:"rgba(34,197,94,0.26)"   },
};

/* --- Single file row ---------------------------------------------------------- */
function FileRow({ type, name, featureCount, loading, visible, onToggle, onDelete }) {
  const cfg = T[type] || T.geojson;
  const [delHover, setDelHover] = useState(false);

  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10,
      padding:"9px 12px",
      background: visible ? cfg.bg : "rgba(255,255,255,0.016)",
      borderRadius:12,
      border:`1.5px solid ${visible ? cfg.border : "rgba(255,255,255,0.05)"}`,
      marginBottom:6, transition:"all 0.18s",
    }}>
      {/* Type badge */}
      <div style={{
        width:38, height:38, borderRadius:10, flexShrink:0,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2,
        background: visible ? `${cfg.color}12` : "rgba(255,255,255,0.035)",
        border:`1px solid ${visible ? cfg.color+"24" : "rgba(255,255,255,0.055)"}`,
        transition:"all 0.18s",
      }}>
        <span style={{
          fontSize:8.5, fontWeight:800, letterSpacing:"0.06em",
          color: visible ? cfg.color : "rgba(255,255,255,0.16)",
          fontFamily:"'DM Mono',monospace",
        }}>{cfg.label}</span>
        {loading && <div style={{ width:4, height:4, borderRadius:"50%", background:cfg.color, animation:"blink 0.7s infinite" }}/>}
      </div>

      {/* Name + meta */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{
          fontSize:12.5, fontWeight:600, lineHeight:1.3,
          color: visible ? "#ddeeff" : "rgba(170,200,235,0.28)",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          transition:"color 0.18s", fontFamily:"'DM Sans',sans-serif",
        }}>{name}</div>
        <div style={{
          fontSize:10, marginTop:1.5,
          color: visible ? `${cfg.color}80` : "rgba(255,255,255,0.12)",
          fontFamily:"'DM Mono',monospace", transition:"color 0.18s",
        }}>
          {loading ? "Loading..." : featureCount != null
            ? `${featureCount} feature${featureCount !== 1 ? "s" : ""}`
            : `${cfg.label} file`}
        </div>
      </div>

      {/* Eye toggle */}
      <button onClick={onToggle} style={{
        width:32, height:32, borderRadius:9, flexShrink:0, cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center",
        background: visible ? `${cfg.color}10` : "rgba(255,255,255,0.03)",
        border:`1px solid ${visible ? cfg.color+"24" : "rgba(255,255,255,0.055)"}`,
        transition:"all 0.18s",
      }}>
        {visible
          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" strokeLinecap="round">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/>
            </svg>
        }
      </button>

      {/* Delete */}
      {onDelete && (
        <button
          onMouseEnter={() => setDelHover(true)}
          onMouseLeave={() => setDelHover(false)}
          onClick={onDelete}
          style={{
            width:32, height:32, borderRadius:9, flexShrink:0, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            background: delHover ? "rgba(239,68,68,0.14)" : "rgba(239,68,68,0.04)",
            border:`1px solid ${delHover ? "rgba(239,68,68,0.4)" : "rgba(239,68,68,0.1)"}`,
            transition:"all 0.15s",
          }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke={delHover ? "#f87171" : "rgba(248,113,113,0.38)"}
            strokeWidth="2" strokeLinecap="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
          </svg>
        </button>
      )}
    </div>
  );
}

/* --- Import card -------------------------------------------------------------- */
const TYPE_ICONS = {
  kml:     <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>,
  kmz:     <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>,
  geojson: <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16"/>,
  csv:     <><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><path d="M3 9h18M3 15h18M9 3v18"/></>,
};

function ImportCard({ type, accept, onChange }) {
  const cfg = T[type];
  const [hover, setHover] = useState(false);
  return (
    <label
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        gap:7, padding:"16px 8px", borderRadius:14, cursor:"pointer",
        background: hover ? `${cfg.color}14` : cfg.bg,
        border:`1.5px dashed ${hover ? cfg.color+"65" : cfg.border}`,
        transition:"all 0.18s", flex:1,
      }}>
      <div style={{
        width:40, height:40, borderRadius:11,
        display:"flex", alignItems:"center", justifyContent:"center",
        background:`${cfg.color}12`, border:`1px solid ${cfg.color}22`,
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="1.8" strokeLinecap="round">
          {TYPE_ICONS[type]}
        </svg>
      </div>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:12, fontWeight:700, color:cfg.color, fontFamily:"'DM Mono',monospace" }}>{cfg.label}</div>
        <div style={{ fontSize:9.5, color:`${cfg.color}55`, marginTop:1, fontFamily:"'DM Mono',monospace" }}>
          {type === "geojson" ? ".geojson / .json" : `.${type}`}
        </div>
      </div>
      <input type="file" accept={accept} onChange={onChange} style={{ display:"none" }}/>
    </label>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN EXPORT
══════════════════════════════════════════════════════════════════════════════ */
export default function MobileFileFolder({
  kmlInputRef, extraInputRef, geojsonInputRef,
  kmlName, kmlLoading, onKMLUpload, onRemoveKML,
  extraFile, extraFileType, onExtraUpload, onRemoveExtra,
  importedGeoJSONLayers = [], onRemoveGeoJSON, onGeoJSONUpload,
  onExportGeoJSON,
  fileVisibility = {}, onToggleVisibility,
  onClose,
}) {
  const [tab, setTab] = useState("files");

  /* Build unified file list */
  const files = [
    ...(kmlName
      ? [{ id:"__kml__", type:"kml", name:kmlName, loading:kmlLoading, onDelete:onRemoveKML }]
      : []),
    ...(extraFile && extraFileType === "kmz"
      ? [{ id:"__kmz__", type:"kmz", name:extraFile.name, onDelete:onRemoveExtra }]
      : []),
    ...(extraFile && extraFileType === "csv"
      ? [{ id:"__csv__", type:"csv", name:extraFile.name, onDelete:onRemoveExtra }]
      : []),
    ...importedGeoJSONLayers.map(l => ({
      id:l.id, type:"geojson", name:l.name, featureCount:l.featureCount,
      onDelete:() => onRemoveGeoJSON?.(l.id),
    })),
  ];

  const total    = files.length;
  const visCount = files.filter(f => fileVisibility[f.id] !== false).length;
  const byType   = files.reduce((a, f) => ({ ...a, [f.type]: (a[f.type]||0)+1 }), {});

  return (
    <>
      {/* Uses SheetHeader -- same padding/sizing as Draw, Measure, Layers sheets */}
      <SheetHeader
        title="File Folder"
        sub={total === 0 ? "No files imported" : `${visCount} of ${total} visible on map`}
        onClose={onClose}
        iconColor="#60a5fa"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          </svg>
        }
      />
      <SheetDivider/>

      {/* -- Tab switcher -- */}
      <div style={{ display:"flex", gap:6, padding:"10px 16px 0" }}>
        {[["files","My Files"], ["import","Import"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex:1, padding:"9px 0", borderRadius:11, cursor:"pointer",
            fontWeight:700, fontSize:13, fontFamily:"'DM Sans',sans-serif",
            background: tab===k ? "rgba(96,165,250,0.14)" : "rgba(255,255,255,0.04)",
            border:`1.5px solid ${tab===k ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.07)"}`,
            color: tab===k ? "#80c4ff" : "rgba(180,210,255,0.3)",
            transition:"all 0.18s",
          }}>
            {lbl}
            {k === "files" && total > 0 && (
              <span style={{
                marginLeft:5, padding:"1px 6px", borderRadius:6,
                background:"rgba(96,165,250,0.18)", color:"#60a5fa",
                fontSize:10, fontFamily:"'DM Mono',monospace",
              }}>{total}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ MY FILES TAB ══════════════════════════════════════════════════════ */}
      {tab === "files" && (
        <div style={{ padding:"10px 16px 24px" }}>

          {/* Summary pills + export */}
          {total > 0 && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {Object.entries(byType).map(([type, count]) => {
                  const cfg = T[type] || T.geojson;
                  return (
                    <div key={type} style={{
                      padding:"2px 8px", borderRadius:7,
                      background:cfg.bg, border:`1px solid ${cfg.border}`,
                    }}>
                      <span style={{ fontSize:9.5, fontWeight:700, color:cfg.color, fontFamily:"'DM Mono',monospace" }}>
                        {count} {cfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <button onClick={onExportGeoJSON} style={{
                display:"flex", alignItems:"center", gap:4,
                padding:"5px 10px", borderRadius:9, cursor:"pointer",
                background:"rgba(34,197,94,0.09)", border:"1px solid rgba(34,197,94,0.24)",
                color:"#4ade80", fontSize:11, fontWeight:700, fontFamily:"'DM Sans',sans-serif",
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Export all
              </button>
            </div>
          )}

          {/* Empty state */}
          {total === 0 ? (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"28px 16px" }}>
              <div style={{
                width:60, height:60, borderRadius:18,
                background:"rgba(96,165,250,0.05)", border:"1.5px dashed rgba(96,165,250,0.14)",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.26)" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                  <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
                </svg>
              </div>
              <div style={{
                color:"rgba(180,210,255,0.3)", fontSize:12.5,
                fontFamily:"'DM Sans',sans-serif", textAlign:"center", lineHeight:1.6,
              }}>
                No files yet.<br/>Tap <strong style={{ color:"rgba(96,165,250,0.5)" }}>Import</strong> to add KML, KMZ, GeoJSON or CSV.
              </div>
              <button onClick={() => setTab("import")} style={{
                padding:"11px 28px", borderRadius:12, cursor:"pointer",
                background:"rgba(96,165,250,0.12)",
                border:"1.5px dashed rgba(96,165,250,0.3)",
                color:"#60a5fa", fontWeight:700, fontSize:13,
                display:"flex", alignItems:"center", gap:8,
                fontFamily:"'DM Sans',sans-serif",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
                Import a file
              </button>
            </div>
          ) : (
            /* File list -- no inner scroll cap; MobileBottomSheet scroll handles overflow */
            <div>
              {files.map(f => (
                <FileRow
                  key={f.id}
                  type={f.type}
                  name={f.name}
                  featureCount={f.featureCount}
                  loading={f.loading}
                  visible={fileVisibility[f.id] !== false}
                  onToggle={() => onToggleVisibility?.(f.id)}
                  onDelete={f.onDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ IMPORT TAB ════════════════════════════════════════════════════════ */}
      {tab === "import" && (
        <div style={{ padding:"10px 16px 24px" }}>
          <div style={{
            fontSize:9.5, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
            color:"rgba(255,255,255,0.18)", fontFamily:"'DM Mono',monospace", marginBottom:10,
          }}>
            Tap a format to import
          </div>

          {/* 2 x 2 grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
            <ImportCard type="kml"     accept=".kml"           onChange={(e) => { onKMLUpload(e);    setTab("files"); }}/>
            <ImportCard type="kmz"     accept=".kmz"           onChange={(e) => { onExtraUpload(e);  setTab("files"); }}/>
            <ImportCard type="geojson" accept=".geojson,.json" onChange={(e) => { onGeoJSONUpload(e);setTab("files"); }}/>
            <ImportCard type="csv"     accept=".csv"           onChange={(e) => { onExtraUpload(e);  setTab("files"); }}/>
          </div>

          {/* Hint */}
          <div style={{
            padding:"10px 13px", borderRadius:11,
            background:"rgba(96,165,250,0.04)", border:"1px solid rgba(96,165,250,0.1)",
            color:"rgba(148,190,240,0.38)", fontSize:11, lineHeight:1.6,
            fontFamily:"'DM Sans',sans-serif",
          }}>
            [Pin] After importing, files appear in <strong style={{ color:"rgba(148,190,240,0.6)" }}>My Files</strong>. Tap [?] to toggle map visibility.
          </div>
        </div>
      )}
    </>
  );
}