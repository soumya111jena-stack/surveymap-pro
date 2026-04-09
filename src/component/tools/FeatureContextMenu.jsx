/**
 * FeatureContextMenu.jsx — SurveyMap Pro v5.9.8
 * Google Earth Pro-style right-click context menu.
 * No "Google Earth" branding — uses "SurveyMap Pro" instead.
 *
 * USAGE in SurveyMap.jsx:
 *   import FeatureContextMenu from "./tools/FeatureContextMenu";
 *
 *   {contextMenu.visible && (
 *     <FeatureContextMenu
 *       x={contextMenu.x}
 *       y={contextMenu.y}
 *       feature={contextMenu.feature}
 *       onClose={() => setContextMenu(m => ({ ...m, visible: false }))}
 *       onProperties={(f) => setPropertiesGeoJSONFeature(f)}
 *       onZoomTo={(f) => { ... }}
 *       onDelete={(f) => { ... }}
 *       onRename={(f) => { ... }}
 *     />
 *   )}
 */

import { useEffect, useRef } from "react";

export default function FeatureContextMenu({
  x, y,
  feature,
  onClose,
  onProperties,
  onDelete,
  onRename,
  onZoomTo,
}) {
  const menuRef = useRef(null);

  /* ── Close on outside click or Escape ─────────────────────────────────── */
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  /* ── Keep menu inside viewport ─────────────────────────────────────────── */
  const MENU_W = 212;
  const MENU_H = 300;
  const left = x + MENU_W > window.innerWidth  ? x - MENU_W : x;
  const top  = y + MENU_H > window.innerHeight ? y - MENU_H : y;

  const name =
    feature?.properties?.name  ||
    feature?.properties?.Name  ||
    feature?.properties?.NAME  ||
    feature?.properties?.title ||
    feature?._name             ||
    "Unnamed Feature";

  const geomType = feature?.geometry?.type || "Feature";

  /* ── Geometry type badge color ─────────────────────────────────────────── */
  const typeColor =
    geomType.includes("Polygon")    ? "#fbbf24" :
    geomType.includes("Line")       ? "#60a5fa" :
    geomType.includes("Point")      ? "#34d399" : "#94a3b8";

  /* ── Helpers ───────────────────────────────────────────────────────────── */
  const Divider = () => (
    <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "3px 0" }} />
  );

  const Item = ({ label, icon, onClick, disabled, accent }) => {
    const base = {
      padding: "7px 14px",
      cursor: disabled ? "default" : "pointer",
      color: disabled ? "#334155" : (accent || "#cbd5e1"),
      display: "flex",
      alignItems: "center",
      gap: 9,
      fontSize: 12.5,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      transition: "background 0.1s",
      userSelect: "none",
    };

    return (
      <div
        style={base}
        onClick={disabled ? undefined : () => { onClick?.(); onClose(); }}
        onMouseEnter={e => {
          if (!disabled) {
            e.currentTarget.style.background = "rgba(74,158,255,0.15)";
            e.currentTarget.style.color = accent || "#e2e8f0";
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = disabled ? "#334155" : (accent || "#cbd5e1");
        }}
      >
        <span style={{
          width: 18, fontSize: 13, textAlign: "center",
          opacity: disabled ? 0.3 : 1,
          flexShrink: 0,
        }}>{icon}</span>
        <span style={{ fontWeight: accent ? 600 : 400 }}>{label}</span>
      </div>
    );
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9800,
        background: "#0d1b2e",
        border: "1px solid rgba(255,255,255,0.11)",
        borderTop: `2px solid ${typeColor}`,
        borderRadius: "0 0 8px 8px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)",
        minWidth: MENU_W,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        overflow: "hidden",
        animation: "ctxFadeIn .1s ease",
      }}
    >
      <style>{`
        @keyframes ctxFadeIn {
          from { opacity: 0; transform: scale(0.97) translateY(-4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        background: "linear-gradient(180deg, #132035 0%, #0f1a2e 100%)",
        padding: "9px 14px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
        {/* Feature name */}
        <div style={{
          color: "#e2e8f0",
          fontSize: 13,
          fontWeight: 700,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: MENU_W - 28,
          marginBottom: 4,
        }} title={name}>{name}</div>

        {/* Geometry type badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            padding: "1px 8px",
            borderRadius: 10,
            fontSize: 9.5,
            fontWeight: 700,
            fontFamily: "'DM Mono', monospace",
            letterSpacing: "0.05em",
            background: `${typeColor}18`,
            border: `1px solid ${typeColor}40`,
            color: typeColor,
          }}>{geomType}</span>
          {feature?._fileType && (
            <span style={{
              color: "#334155",
              fontSize: 9,
              fontFamily: "'DM Mono', monospace",
              background: "rgba(255,255,255,0.04)",
              padding: "1px 6px",
              borderRadius: 4,
            }}>{feature._fileType.toUpperCase()}</span>
          )}
        </div>
      </div>

      {/* ── Menu items ── */}
      <div style={{ paddingTop: 3, paddingBottom: 4 }}>

        <Item label="Cut"    icon="✂"  disabled />
        <Item label="Copy"   icon="⧉"  disabled />
        <Item
          label="Delete"
          icon="🗑"
          onClick={() => onDelete?.(feature)}
        />
        <Item
          label="Rename"
          icon="✏"
          onClick={() => onRename?.(feature)}
        />

        <Divider />

        <Item label="Save Place As…"         icon="💾" disabled />
        <Item label="Email…"                 icon="✉"  disabled />

        <Divider />

        <Item
          label="Zoom To"
          icon="🔍"
          onClick={() => onZoomTo?.(feature)}
        />
        <Item label="Snapshot View"          icon="📷" disabled />
        <Item label="Show Elevation Profile" icon="📈" disabled />

        <Divider />

        {/* Properties — highlighted like GEP */}
        <Item
          label="Properties"
          icon="📋"
          accent="#fbbf24"
          onClick={() => onProperties?.(feature)}
        />
      </div>
    </div>
  );
}