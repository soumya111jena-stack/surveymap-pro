/**
 * GoogleEarthProToolbar.jsx — SurveyMap Pro v7.0.0
 * ─────────────────────────────────────────────────────
 * FIXES in v7.0.0:
 *  - Toolbar is HIDDEN by default — controlled by toolbarVisible prop
 *  - Toggle button always visible on left edge of map
 *  - Toolbar slides in from the left when toggled open
 *  - No longer floats over the center of the map
 *  - InstantEditBubble shows immediately on pin placement
 */

import React, { useState, useRef, useEffect } from "react";

/* ─── Tool definitions ───────────────────────────────────────────────────── */
const TOOLS = [
  {
    id: "select",
    label: "Select",
    shortcut: "S",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 4l7 18 3-7 7-3z"/>
        <line x1="14" y1="14" x2="20" y2="20"/>
      </svg>
    ),
  },
  {
    id: "hand",
    label: "Pan",
    shortcut: "H",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M18 11V6a2 2 0 00-2-2 2 2 0 00-2 2"/>
        <path d="M14 10V4a2 2 0 00-2-2 2 2 0 00-2 2v2"/>
        <path d="M10 10.5V6a2 2 0 00-2-2 2 2 0 00-2 2v8"/>
        <path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 012.83-2.82L7 15"/>
      </svg>
    ),
  },
  { divider: true },
  {
    id: "placemark",
    label: "Add Placemark",
    shortcut: "P",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    ),
  },
  {
    id: "path",
    label: "Draw Path",
    shortcut: "L",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    id: "polygon",
    label: "Draw Polygon",
    shortcut: "G",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
      </svg>
    ),
  },
  { divider: true },
  {
    id: "ruler",
    label: "Ruler",
    shortcut: "R",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M21.3 8.7L8.7 21.3c-.6.6-1.6.6-2.2 0L2.7 17.5c-.6-.6-.6-1.6 0-2.2L15.3 2.7c.6-.6 1.6-.6 2.2 0l3.8 3.8c.6.6.6 1.6 0 2.2z"/>
        <path d="M7.5 10.5l1.5 1.5M10.5 7.5l1.5 1.5M13.5 4.5l1.5 1.5"/>
      </svg>
    ),
  },
  {
    id: "area",
    label: "Measure Area",
    shortcut: "A",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" strokeWidth="1.1" opacity="0.5"/>
      </svg>
    ),
  },
  { divider: true },
  {
    id: "camera",
    label: "Camera",
    shortcut: "C",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    ),
  },
  {
    id: "sunlight",
    label: "Sunlight",
    shortcut: "U",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    ),
  },
];

/* ══════════════════════════════════════════════════════════════════════
   GoogleEarthProToolbar
   Props:
     activeTool       — currently active tool id
     onToolChange     — called with new tool id
     drawMode         — boolean
     measureMode      — boolean
     onAction         — action dispatcher
     visible          — boolean, controls visibility (default false)
     onToggle         — called when toggle button is clicked
     isMobile         — boolean, hides on mobile
══════════════════════════════════════════════════════════════════════ */
export function GoogleEarthProToolbar({
  activeTool = "select",
  onToolChange,
  drawMode,
  measureMode,
  onAction,
  visible = false,
  onToggle,
  isMobile = false,
}) {
  const [hovered, setHovered] = useState(null);

  if (isMobile) return null;

  const handleToolClick = (tool) => {
    if (tool.divider) return;
    onToolChange?.(tool.id);
    if (tool.id === "placemark") onAction?.("drawMarker");
    else if (tool.id === "path")    onAction?.("drawPath");
    else if (tool.id === "polygon") onAction?.("drawPoly");
    else if (tool.id === "ruler")   onAction?.("startMeasure");
    else if (tool.id === "area")    onAction?.("startMeasure");
  };

  return (
    <>
      {/* ── Toggle button — always visible ─────────────────────────────── */}
      <button
        onClick={onToggle}
        title={visible ? "Hide toolbar" : "Show toolbar (Google Earth tools)"}
        style={{
          position: "absolute",
          top: "50%",
          left: visible ? 58 : 10,
          transform: "translateY(-50%)",
          zIndex: 1065,
          width: 28,
          height: 28,
          background: "rgba(255,255,255,0.96)",
          border: "1px solid rgba(0,0,0,0.14)",
          borderRadius: 8,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
          transition: "left 0.2s ease",
          pointerEvents: "all",
          outline: "none",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "#f1f3f4"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.96)"; }}
      >
        {visible ? (
          /* X icon when toolbar is open */
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3c4043" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          /* Grid icon when toolbar is hidden */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3c4043" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
        )}
      </button>

      {/* ── Toolbar panel — only rendered when visible ──────────────────── */}
      {visible && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 10,
            transform: "translateY(-50%)",
            zIndex: 1060,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            background: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderRadius: 12,
            boxShadow: "0 4px 24px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.1)",
            border: "1px solid rgba(0,0,0,0.10)",
            padding: "4px 0",
            pointerEvents: "all",
            animation: "geToolbarSlideIn 0.18s ease",
          }}
        >
          <style>{`
            @keyframes geToolbarSlideIn {
              from { opacity: 0; transform: translateY(-50%) translateX(-12px); }
              to   { opacity: 1; transform: translateY(-50%) translateX(0); }
            }
          `}</style>

          {TOOLS.map((tool, idx) => {
            if (tool.divider) return (
              <div
                key={`d${idx}`}
                style={{
                  height: 1,
                  width: "80%",
                  background: "rgba(0,0,0,0.08)",
                  margin: "3px auto",
                }}
              />
            );

            const isActive =
              activeTool === tool.id ||
              (tool.id === "placemark" && drawMode) ||
              (tool.id === "ruler" && measureMode);

            return (
              <div key={tool.id} style={{ position: "relative" }}>
                <button
                  onClick={() => handleToolClick(tool)}
                  onMouseEnter={() => setHovered(tool.id)}
                  onMouseLeave={() => setHovered(null)}
                  title={`${tool.label} (${tool.shortcut})`}
                  style={{
                    width: 40,
                    height: 40,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isActive
                      ? "rgba(26,115,232,0.12)"
                      : hovered === tool.id
                        ? "rgba(0,0,0,0.06)"
                        : "transparent",
                    border: "none",
                    borderRadius: 8,
                    margin: "1px 4px",
                    cursor: "pointer",
                    color: isActive ? "#1a73e8" : "#3c4043",
                    transition: "background 0.12s, color 0.12s",
                    outline: isActive ? "1.5px solid rgba(26,115,232,0.35)" : "none",
                    position: "relative",
                  }}
                >
                  {tool.icon}
                  {isActive && (
                    <div style={{
                      position: "absolute",
                      bottom: 4,
                      right: 4,
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#1a73e8",
                    }} />
                  )}
                </button>

                {/* Tooltip — appears to the RIGHT of toolbar */}
                {hovered === tool.id && (
                  <div style={{
                    position: "absolute",
                    left: "calc(100% + 10px)",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "rgba(32,33,36,0.92)",
                    color: "#fff",
                    fontSize: 12,
                    padding: "5px 10px",
                    borderRadius: 6,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    zIndex: 9999,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
                    fontFamily: "'Google Sans','Roboto',Arial,sans-serif",
                  }}>
                    <span style={{ fontWeight: 500 }}>{tool.label}</span>
                    <span style={{ marginLeft: 8, opacity: 0.55, fontSize: 10, fontFamily: "monospace" }}>
                      {tool.shortcut}
                    </span>
                    {/* Arrow pointing left */}
                    <div style={{
                      position: "absolute",
                      left: -5,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 0,
                      height: 0,
                      borderTop: "5px solid transparent",
                      borderBottom: "5px solid transparent",
                      borderRight: "5px solid rgba(32,33,36,0.92)",
                    }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   InstantEditBubble — Google Earth Web right-panel style
   Shows immediately when a pin/path/polygon is placed or clicked.
══════════════════════════════════════════════════════════════════════ */
export function InstantEditBubble({ drawing, onEdit, onDelete, onClose, onFly, cursorElevation, topOffset = 78 }) {
  if (!drawing) return null;

  const pt  = drawing.points?.[0];
  const lat = pt?.lat ?? 0;
  const lng = pt?.lng ?? 0;

  const toDMS = (deg, pos, neg) => {
    const d = Math.abs(deg);
    const di = Math.floor(d);
    const mA = (d - di) * 60;
    const mi = Math.floor(mA);
    const s = (mA - mi) * 60;
    return `${di}°${mi}'${s.toFixed(2)}"${deg >= 0 ? pos : neg}`;
  };

  const typeLabel = drawing.type === "marker" ? "Placemark" : drawing.type === "polygon" ? "Polygon" : "Path";
  const typeEmoji = drawing.type === "marker" ? "📍" : drawing.type === "polygon" ? "⬡" : "〰";

  return (
    <div style={{
      position: "fixed",
      top: topOffset,
      right: 16,
      width: 340,
      zIndex: 9500,
      background: "#fff",
      borderRadius: 12,
      boxShadow: "0 8px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)",
      border: "1px solid rgba(0,0,0,0.10)",
      fontFamily: "'Google Sans','Roboto',Arial,sans-serif",
      overflow: "hidden",
      animation: "geSlideIn 0.18s cubic-bezier(0.34,1.56,0.64,1)",
    }}>
      <style>{`
        @keyframes geSlideIn {
          from { opacity: 0; transform: translateX(20px) scale(0.97); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 16px 10px",
        borderBottom: "1px solid #f1f3f4",
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: drawing.color || "#1a73e8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 16,
        }}>
          {typeEmoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16,
            fontWeight: 500,
            color: "#202124",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {drawing.name || "Untitled placemark"}
          </div>
          <div style={{ fontSize: 11, color: "#5f6368", marginTop: 1 }}>{typeLabel}</div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#5f6368",
            cursor: "pointer",
            fontSize: 20,
            lineHeight: 1,
            padding: 0,
            display: "flex",
            alignItems: "center",
            width: 28,
            height: 28,
            justifyContent: "center",
            borderRadius: 6,
          }}
          onMouseEnter={e => e.currentTarget.style.background = "#f1f3f4"}
          onMouseLeave={e => e.currentTarget.style.background = "none"}
        >
          ×
        </button>
      </div>

      {/* Location */}
      <div style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "#3c4043", marginBottom: 6 }}>Location</div>
        <div style={{
          fontSize: 13,
          color: "#1a73e8",
          fontFamily: "'Roboto Mono',monospace",
          marginBottom: 4,
          letterSpacing: "0.01em",
        }}>
          {toDMS(lat, "N", "S")} {toDMS(lng, "E", "W")}
        </div>
        <div style={{ fontSize: 12, color: "#5f6368", fontFamily: "monospace" }}>
          {lat.toFixed(8)}, {lng.toFixed(8)}
        </div>
      </div>

      {/* Advanced measurements */}
      <div style={{ borderTop: "1px solid #f1f3f4" }}>
        <div style={{
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#3c4043" }}>Advanced measurements</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#5f6368"><path d="M19 9l-7 7-7-7"/></svg>
        </div>
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "#5f6368" }}>Ground elevation</span>
            <span style={{ fontSize: 12, color: "#202124", fontFamily: "monospace" }}>
              {cursorElevation != null ? `${Math.round(cursorElevation)} m` : "— m"}
            </span>
          </div>
          {drawing.type !== "marker" && (drawing.points?.length ?? 0) >= 2 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#5f6368" }}>Points</span>
              <span style={{ fontSize: 12, color: "#202124", fontFamily: "monospace" }}>
                {drawing.points.length}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {drawing.description && (
        <div style={{ borderTop: "1px solid #f1f3f4", padding: "12px 16px" }}>
          <div style={{ fontSize: 13, color: "#3c4043", lineHeight: 1.5 }}>
            {drawing.description}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{
        borderTop: "1px solid #f1f3f4",
        padding: "12px 16px",
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}>
        {/* Edit — primary blue */}
        <button
          onClick={() => onEdit?.(drawing)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 20px",
            borderRadius: 24,
            cursor: "pointer",
            background: "#1a73e8",
            border: "none",
            color: "#fff",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "'Google Sans','Roboto',Arial,sans-serif",
            boxShadow: "0 2px 8px rgba(26,115,232,0.32)",
            transition: "background 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "#1557b0"}
          onMouseLeave={e => e.currentTarget.style.background = "#1a73e8"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit
        </button>

        {/* Fly to */}
        <button
          onClick={() => onFly?.(drawing)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 16px",
            borderRadius: 24,
            cursor: "pointer",
            background: "transparent",
            border: "1.5px solid #dadce0",
            color: "#3c4043",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "'Google Sans','Roboto',Arial,sans-serif",
            transition: "background 0.12s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "#f1f3f4"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
          Fly to
        </button>

        {/* Delete */}
        <button
          onClick={() => onDelete?.(drawing)}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            padding: "9px",
            borderRadius: 24,
            cursor: "pointer",
            background: "transparent",
            border: "1.5px solid #dadce0",
            color: "#d93025",
            transition: "background 0.12s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "#fce8e6"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          title="Delete"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d93025" strokeWidth="2" strokeLinecap="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   GEAddMenu — Google Earth Pro "Add" dropdown
══════════════════════════════════════════════════════════════════════ */
export function GEAddMenu({ onAction, openMenu, setOpenMenu }) {
  const isOpen = openMenu === "__GEAdd__";
  const MENU_H = 36;

  const items = [
    { label: "Placemark",           icon: "📍", action: "drawMarker",   shortcut: "Ctrl+Shift+P" },
    { label: "Path",                icon: "〰",  action: "drawPath",    shortcut: "Ctrl+Shift+L" },
    { label: "Polygon",             icon: "⬡",  action: "drawPoly",    shortcut: "Ctrl+Shift+G" },
    { divider: true },
    { label: "Measure Distance",    icon: "📏", action: "startMeasure", shortcut: "Ctrl+M" },
    { label: "Measure Area",        icon: "⬜", action: "startMeasure" },
    { divider: true },
    { label: "KML / KMZ File",      icon: "📂", action: "openKML" },
    { label: "GeoJSON File",        icon: "🌐", action: "openGeoJSON" },
    { label: "Shapefile (.zip)",    icon: "🗺", action: "openShapefile" },
    { label: "CSV File",            icon: "📊", action: "openExtra" },
    { divider: true },
    { label: "Survey Route",        icon: "📡", action: "toggleSurvey" },
    { label: "Live Track Recorder", icon: "⏺", action: "openTracker" },
    { divider: true },
    { label: "Folder",              icon: "📁", action: null, disabled: true },
  ];

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center" }}>
      <span
        onClick={() => setOpenMenu(isOpen ? null : "__GEAdd__")}
        onMouseEnter={() => { if (openMenu && openMenu !== "__GEAdd__") setOpenMenu("__GEAdd__"); }}
        style={{
          fontSize: 12,
          color: isOpen ? "#80c4ff" : "rgba(241,237,235,0.9)",
          padding: "0 12px",
          cursor: "pointer",
          userSelect: "none",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: isOpen ? "rgba(74,158,255,0.15)" : "transparent",
          fontWeight: isOpen ? 500 : 400,
        }}
      >
        Add
      </span>
      {isOpen && (
        <div style={{
          position: "absolute",
          top: MENU_H,
          left: 0,
          background: "rgba(5,12,24,0.98)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderTop: "1.5px solid rgba(74,158,255,0.5)",
          borderRadius: "0 0 10px 10px",
          minWidth: 230,
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          zIndex: 1300,
          overflow: "hidden",
        }}>
          {items.map((item, idx) =>
            item.divider ? (
              <div key={`d${idx}`} style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "3px 0" }} />
            ) : (
              <div
                key={item.label}
                onClick={() => { if (!item.disabled && item.action) { onAction(item.action); setOpenMenu(null); } }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 16px",
                  cursor: item.disabled ? "not-allowed" : "pointer",
                  color: item.disabled ? "rgba(255,255,255,0.25)" : "rgba(220,235,255,0.88)",
                  fontSize: 12,
                  fontFamily: "system-ui,sans-serif",
                }}
                onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = "rgba(74,158,255,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 14, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "monospace" }}>
                    {item.shortcut}
                  </span>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   GEToolsMenu — Google Earth Pro "Tools" dropdown
══════════════════════════════════════════════════════════════════════ */
export function GEToolsMenu({ onAction, openMenu, setOpenMenu }) {
  const isOpen = openMenu === "__GETools__";
  const MENU_H = 36;

  const items = [
    { label: "Ruler / Distance",    icon: "📏", action: "startMeasure",  shortcut: "Ctrl+Shift+R" },
    { label: "GPS / Live Track",    icon: "📡", action: "openTracker" },
    { divider: true },
    { label: "Elevation Profile",   icon: "📈", action: "openElevation" },
    { label: "Compass Navigation",  icon: "🧭", action: "openCompassNav" },
    { divider: true },
    { label: "Offline Map Manager", icon: "💾", action: "openOffline" },
    { label: "Night Mode Auto",     icon: "🌙", action: "toggleNight" },
    { label: "3D Globe View",       icon: "🌍", action: "show3D" },
    { divider: true },
    { label: "Options / About",     icon: "⚙", action: "about" },
    { label: "Keyboard Shortcuts",  icon: "⌨", action: "shortcuts" },
  ];

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center" }}>
      <span
        onClick={() => setOpenMenu(isOpen ? null : "__GETools__")}
        onMouseEnter={() => { if (openMenu && openMenu !== "__GETools__") setOpenMenu("__GETools__"); }}
        style={{
          fontSize: 12,
          color: isOpen ? "#80c4ff" : "rgba(241,237,235,0.9)",
          padding: "0 12px",
          cursor: "pointer",
          userSelect: "none",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: isOpen ? "rgba(74,158,255,0.15)" : "transparent",
          fontWeight: isOpen ? 500 : 400,
        }}
      >
        Tools
      </span>
      {isOpen && (
        <div style={{
          position: "absolute",
          top: MENU_H,
          left: 0,
          background: "rgba(5,12,24,0.98)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderTop: "1.5px solid rgba(74,158,255,0.5)",
          borderRadius: "0 0 10px 10px",
          minWidth: 230,
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          zIndex: 1300,
          overflow: "hidden",
        }}>
          {items.map((item, idx) =>
            item.divider ? (
              <div key={`d${idx}`} style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "3px 0" }} />
            ) : (
              <div
                key={item.label}
                onClick={() => { if (item.action) { onAction(item.action); setOpenMenu(null); } }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 16px",
                  cursor: "pointer",
                  color: "rgba(220,235,255,0.88)",
                  fontSize: 12,
                  fontFamily: "system-ui,sans-serif",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(74,158,255,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 14, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "monospace" }}>
                    {item.shortcut}
                  </span>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default GoogleEarthProToolbar;