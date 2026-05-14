/**
 * AboutGeoxis.jsx — Geoxis Field Edition
 * ─────────────────────────────────────────────────────────────────────────────
 * Professional "About" dialog — styled like ArcGIS / QGIS / Google Earth Pro.
 *
 * USAGE in SurveyMap.jsx:
 *   1. import AboutGeoxis from "./AboutGeoxis";
 *   2. In handleMenuAction, replace the broken line:
 *        if (A === "about" || A === "options") { setOptionsOpen(true); return; }
 *      with TWO separate lines:
 *        if (A === "about")   { setShowAbout(true);   return; }
 *        if (A === "options") { setOptionsOpen(true);  return; }
 *   3. In JSX render, replace the old inline About modal block with:
 *        {showAbout && <AboutGeoxis onClose={() => setShowAbout(false)} />}
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState } from "react";

/* ── Data ──────────────────────────────────────────────────────────────────── */
const VERSION        = "1.0.0";
const BUILD_DATE     = "April 2025";
const BUILD_NUMBER   = "20250428";
const PACKAGE        = "com.geoxis.app";
const AUTHOR         = "Shanvi Resources Private Limited";
const YEAR           = "2025";

const TECH_STACK = [
  { name: "Leaflet.js",    color: "#4ade80", desc: "2D interactive mapping" },
  { name: "CesiumJS",      color: "#60a5fa", desc: "3D globe & terrain"     },
  { name: "React + Vite",  color: "#38bdf8", desc: "UI framework"           },
  { name: "Node.js",       color: "#facc15", desc: "Backend API server"     },
  { name: "PostgreSQL",    color: "#a78bfa", desc: "Relational database"    },
  { name: "PostGIS",       color: "#fb923c", desc: "Spatial extension"      },
  { name: "Capacitor",     color: "#f472b6", desc: "Android native bridge"  },
  { name: "OSRM",          color: "#34d399", desc: "Routing engine"         },
];

const FEATURES = [
  { icon: "📍", title: "KML / KMZ",         desc: "Import, export, and analyze KML/KMZ layers" },
  { icon: "🌐", title: "GeoJSON",            desc: "Full GeoJSON import/export with attribute table" },
  { icon: "🏔", title: "DEM Elevation",      desc: "GeoTIFF raster draping with color ramps" },
  { icon: "📡", title: "GPS Track Recorder", desc: "Live GPS logging with GPX/KML export" },
  { icon: "📶", title: "Offline Maps",       desc: "Tile caching and offline-first mode" },
  { icon: "🗺", title: "Shapefile (SHP)",    desc: "Shapefile import with feature properties" },
  { icon: "📏", title: "Measure & Draw",     desc: "Distance, area, markers, paths, polygons" },
  { icon: "🧭", title: "Directions",         desc: "OSRM turn-by-turn routing (car/walk/cycle)" },
  { icon: "🌍", title: "3D Globe View",      desc: "CesiumJS interactive 3D earth viewer" },
  { icon: "🖨", title: "Print / Export",     desc: "High-res PNG and print map panel" },
  { icon: "🔐", title: "Survey Sessions",    desc: "Backend sync, auth, and offline queue" },
  { icon: "📐", title: "Area Analysis",      desc: "Polygon area calculation from KML layers" },
];

const TABS = ["Overview", "Features", "Technology", "License"];

/* ── Component ─────────────────────────────────────────────────────────────── */
export default function AboutGeoxis({ onClose }) {
  const overlayRef     = useRef(null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [copied, setCopied]       = useState(false);

  /* Close on Escape */
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  /* Backdrop click */
  const handleBackdrop = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const copyPackage = () => {
    navigator.clipboard?.writeText(PACKAGE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <>
      {/* ── STYLES ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Space+Mono:wght@400;700&display=swap');

        /* Overlay */
        .gx-ab-overlay {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
          background: rgba(2, 8, 18, 0.86);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: gxAbFadeIn 0.18s ease;
          font-family: 'DM Sans', sans-serif;
        }
        @keyframes gxAbFadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes gxAbSlideUp { from { opacity: 0; transform: translateY(28px) scale(0.96) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes gxAbPulse   { 0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(56,189,248,0.5) } 50% { opacity:.7; box-shadow:0 0 0 5px rgba(56,189,248,0) } }
        @keyframes gxAbSpin    { to { transform: rotate(360deg) } }
        @keyframes gxAbBlink   { 0%,100%{opacity:1} 50%{opacity:0.3} }

        /* Dialog */
        .gx-ab-dialog {
          position: relative;
          width: min(600px, 96vw);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          background: linear-gradient(170deg, #0b1628 0%, #070e1c 55%, #040b16 100%);
          border: 1px solid rgba(56,189,248,0.14);
          border-radius: 18px;
          box-shadow:
            0 0 0 1px rgba(56,189,248,0.05),
            0 40px 100px rgba(0,0,0,0.8),
            0 0 80px rgba(14,165,233,0.06) inset;
          animation: gxAbSlideUp 0.26s cubic-bezier(0.22,1,0.36,1);
          overflow: hidden;
        }

        /* Top accent line */
        .gx-ab-dialog::before {
          content: '';
          position: absolute; top: 0; left: 8%; right: 8%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(56,189,248,0.7), rgba(129,140,248,0.5), transparent);
        }

        /* ── Header ── */
        .gx-ab-header {
          padding: 28px 28px 0;
          display: flex;
          align-items: center;
          gap: 18px;
          flex-shrink: 0;
        }

        .gx-ab-logo {
          width: 64px; height: 64px;
          border-radius: 16px;
          background: linear-gradient(135deg, #0f2847, #091c34);
          border: 1px solid rgba(56,189,248,0.28);
          box-shadow: 0 0 30px rgba(14,165,233,0.2), 0 8px 20px rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }
        .gx-ab-logo img {
          width: 52px; height: 52px;
          object-fit: contain;
        }
        .gx-ab-logo-fallback {
          width: 38px; height: 38px;
          animation: gxAbSpin 12s linear infinite;
        }

        .gx-ab-title-block { flex: 1; min-width: 0; }
        .gx-ab-app-name {
          margin: 0 0 4px;
          font-size: 22px; font-weight: 700; letter-spacing: -0.4px;
          color: #deeeff; line-height: 1.1;
        }
        .gx-ab-app-name em {
          font-style: normal;
          background: linear-gradient(90deg, #38bdf8, #818cf8);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .gx-ab-badges {
          display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
        }
        .gx-ab-badge {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 9px;
          border-radius: 20px;
          font-size: 10.5px; font-weight: 600;
          letter-spacing: 0.3px;
        }
        .gx-ab-badge-version {
          background: rgba(56,189,248,0.1);
          border: 1px solid rgba(56,189,248,0.25);
          color: #7dd3fc;
        }
        .gx-ab-badge-version::before {
          content: '';
          width: 6px; height: 6px; border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 6px #34d399;
          animation: gxAbBlink 2s ease-in-out infinite;
        }
        .gx-ab-badge-build {
          background: rgba(129,140,248,0.1);
          border: 1px solid rgba(129,140,248,0.2);
          color: rgba(165,180,252,0.8);
          font-family: 'Space Mono', monospace;
          font-size: 9.5px;
        }
        .gx-ab-badge-platform {
          background: rgba(52,211,153,0.08);
          border: 1px solid rgba(52,211,153,0.2);
          color: rgba(110,231,183,0.8);
          font-size: 9.5px;
        }

        .gx-ab-close {
          position: absolute; top: 14px; right: 14px;
          width: 32px; height: 32px;
          border-radius: 9px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
          color: rgba(148,163,184,0.6);
          font-size: 16px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .gx-ab-close:hover {
          background: rgba(239,68,68,0.15);
          border-color: rgba(239,68,68,0.35);
          color: #f87171;
        }

        /* ── Divider ── */
        .gx-ab-divider {
          height: 1px;
          margin: 20px 28px 0;
          background: linear-gradient(90deg, transparent, rgba(56,189,248,0.12), transparent);
          flex-shrink: 0;
        }

        /* ── Tabs ── */
        .gx-ab-tabs {
          display: flex;
          gap: 2px;
          padding: 12px 28px 0;
          flex-shrink: 0;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .gx-ab-tabs::-webkit-scrollbar { display: none; }
        .gx-ab-tab {
          padding: 7px 16px;
          border-radius: 8px 8px 0 0;
          border: 1px solid transparent;
          border-bottom: none;
          background: transparent;
          color: rgba(148,163,184,0.55);
          font-family: 'DM Sans', sans-serif;
          font-size: 12px; font-weight: 500;
          cursor: pointer; white-space: nowrap;
          transition: color 0.15s, background 0.15s;
        }
        .gx-ab-tab:hover { color: rgba(200,220,255,0.75); background: rgba(255,255,255,0.03); }
        .gx-ab-tab.active {
          color: #7dd3fc;
          background: rgba(56,189,248,0.08);
          border-color: rgba(56,189,248,0.18);
          font-weight: 600;
        }
        .gx-ab-tab-line {
          height: 1px;
          margin: 0 28px;
          background: rgba(56,189,248,0.12);
          flex-shrink: 0;
        }

        /* ── Body (scrollable) ── */
        .gx-ab-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 28px;
          scrollbar-width: thin;
          scrollbar-color: rgba(56,189,248,0.2) transparent;
        }
        .gx-ab-body::-webkit-scrollbar { width: 4px; }
        .gx-ab-body::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.2); border-radius: 4px; }

        /* ── Section label ── */
        .gx-ab-section-lbl {
          font-size: 9.5px; font-weight: 700; letter-spacing: 1.6px;
          text-transform: uppercase; color: rgba(148,163,184,0.45);
          margin-bottom: 10px;
          font-family: 'Space Mono', monospace;
        }

        /* ── Overview tab ── */
        .gx-ab-meta-grid {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 8px; margin-bottom: 20px;
        }
        .gx-ab-meta-card {
          padding: 12px 14px;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px;
          transition: border-color 0.15s, background 0.15s;
        }
        .gx-ab-meta-card:hover {
          background: rgba(56,189,248,0.04);
          border-color: rgba(56,189,248,0.14);
        }
        .gx-ab-meta-label { font-size: 10px; color: rgba(148,163,184,0.45); margin-bottom: 4px; }
        .gx-ab-meta-value { font-size: 13px; font-weight: 600; color: #c8ddf0; font-family: 'Space Mono', monospace; }

        .gx-ab-desc {
          font-size: 13px; line-height: 1.75;
          color: rgba(180,205,235,0.7);
          margin-bottom: 20px;
          padding: 14px 16px;
          background: rgba(56,189,248,0.04);
          border-left: 2px solid rgba(56,189,248,0.3);
          border-radius: 0 8px 8px 0;
        }

        .gx-ab-pkg-row {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px;
          margin-bottom: 8px;
        }
        .gx-ab-pkg-name {
          font-family: 'Space Mono', monospace;
          font-size: 11px; color: #7dd3fc; flex: 1;
        }
        .gx-ab-copy-btn {
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid rgba(56,189,248,0.25);
          background: rgba(56,189,248,0.08);
          color: #7dd3fc; font-size: 10.5px; font-weight: 600;
          cursor: pointer; font-family: 'DM Sans', sans-serif;
          transition: background 0.12s;
        }
        .gx-ab-copy-btn:hover { background: rgba(56,189,248,0.16); }

        /* ── Features tab ── */
        .gx-ab-feat-grid {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 7px;
        }
        .gx-ab-feat-card {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 11px 13px;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px;
          transition: background 0.15s, border-color 0.15s;
          cursor: default;
        }
        .gx-ab-feat-card:hover {
          background: rgba(56,189,248,0.06);
          border-color: rgba(56,189,248,0.2);
        }
        .gx-ab-feat-icon { font-size: 18px; line-height: 1; flex-shrink: 0; margin-top: 1px; }
        .gx-ab-feat-title { font-size: 12px; font-weight: 600; color: #c8ddf0; margin-bottom: 2px; }
        .gx-ab-feat-desc  { font-size: 10.5px; color: rgba(148,163,184,0.55); line-height: 1.45; }

        /* ── Technology tab ── */
        .gx-ab-tech-list { display: flex; flex-direction: column; gap: 7px; }
        .gx-ab-tech-row {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px;
          transition: background 0.14s;
        }
        .gx-ab-tech-row:hover { background: rgba(255,255,255,0.04); }
        .gx-ab-tech-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }
        .gx-ab-tech-name { font-size: 13px; font-weight: 600; color: #c8ddf0; flex: 1; }
        .gx-ab-tech-desc { font-size: 11px; color: rgba(148,163,184,0.5); }

        /* ── License tab ── */
        .gx-ab-license-block {
          background: rgba(255,255,255,0.018);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          padding: 18px;
          margin-bottom: 16px;
        }
        .gx-ab-license-title {
          font-size: 14px; font-weight: 700; color: #c8ddf0;
          margin-bottom: 10px;
          display: flex; align-items: center; gap: 8px;
        }
        .gx-ab-license-body {
          font-size: 11.5px; line-height: 1.8;
          color: rgba(180,205,235,0.55);
          font-family: 'Space Mono', monospace;
        }
        .gx-ab-oss-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          font-size: 11.5px;
        }
        .gx-ab-oss-row:last-child { border-bottom: none; }
        .gx-ab-oss-name { color: #c8ddf0; font-weight: 600; }
        .gx-ab-oss-lic  { color: rgba(148,163,184,0.45); font-family: 'Space Mono', monospace; font-size: 10.5px; }

        /* ── Footer ── */
        .gx-ab-footer {
          padding: 14px 28px 20px;
          border-top: 1px solid rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-shrink: 0;
          flex-wrap: wrap;
        }
        .gx-ab-footer-left  { display: flex; flex-direction: column; gap: 3px; }
        .gx-ab-copyright    { font-size: 11.5px; color: rgba(148,163,184,0.55); }
        .gx-ab-made-in      { font-size: 10.5px; color: rgba(100,116,139,0.5); display: flex; align-items: center; gap: 5px; }
        .gx-ab-close-btn {
          padding: 9px 24px;
          border-radius: 9px;
          border: 1px solid rgba(56,189,248,0.28);
          background: rgba(14,165,233,0.1);
          color: #7dd3fc;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px; font-weight: 600;
          cursor: pointer;
          transition: background 0.14s, border-color 0.14s;
        }
        .gx-ab-close-btn:hover {
          background: rgba(14,165,233,0.22);
          border-color: rgba(56,189,248,0.5);
        }

        /* Mobile */
        @media (max-width: 480px) {
          .gx-ab-header  { padding: 22px 18px 0; gap: 13px; }
          .gx-ab-divider,
          .gx-ab-tab-line { margin-left: 18px; margin-right: 18px; }
          .gx-ab-tabs    { padding: 10px 18px 0; }
          .gx-ab-body    { padding: 16px 18px; }
          .gx-ab-footer  { padding: 12px 18px 18px; }
          .gx-ab-feat-grid { grid-template-columns: 1fr; }
          .gx-ab-meta-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* ── OVERLAY ── */}
      <div
        ref={overlayRef}
        className="gx-ab-overlay"
        onClick={handleBackdrop}
        role="dialog"
        aria-modal="true"
        aria-label="About Geoxis Field Edition"
      >
        <div className="gx-ab-dialog">

          {/* ── Close button ── */}
          <button className="gx-ab-close" onClick={onClose} aria-label="Close">✕</button>

          {/* ── Header ── */}
          <div className="gx-ab-header">
            <div className="gx-ab-logo">
              <img
                src="/geoxis-logo.png.png"
                alt="Geoxis"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  e.currentTarget.nextSibling.style.display = "block";
                }}
              />
              {/* Compass SVG fallback */}
              <svg
                className="gx-ab-logo-fallback"
                style={{ display: "none" }}
                viewBox="0 0 48 48"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="24" cy="24" r="20" stroke="rgba(56,189,248,0.35)" strokeWidth="1.5"/>
                <circle cx="24" cy="24" r="13" stroke="rgba(56,189,248,0.2)" strokeWidth="1"/>
                <circle cx="24" cy="24" r="6"  stroke="rgba(56,189,248,0.15)" strokeWidth="1"/>
                <polygon points="24,5 27,21 24,24 21,21" fill="#38bdf8"/>
                <polygon points="24,43 27,27 24,24 21,27" fill="#334155"/>
                <polygon points="43,24 27,27 24,24 27,21" fill="#334155"/>
                <polygon points="5,24 21,21 24,24 21,27"  fill="#1e40af" opacity="0.6"/>
                <circle cx="24" cy="24" r="3" fill="#7dd3fc"/>
                <text x="24" y="16" textAnchor="middle" fill="rgba(56,189,248,0.6)" fontSize="5" fontFamily="monospace" fontWeight="bold">N</text>
                <text x="24" y="35" textAnchor="middle" fill="rgba(148,163,184,0.4)" fontSize="5" fontFamily="monospace">S</text>
                <text x="35" y="25" textAnchor="middle" fill="rgba(148,163,184,0.4)" fontSize="5" fontFamily="monospace">E</text>
                <text x="13" y="25" textAnchor="middle" fill="rgba(148,163,184,0.4)" fontSize="5" fontFamily="monospace">W</text>
              </svg>
            </div>

            <div className="gx-ab-title-block">
              <h1 className="gx-ab-app-name">
                Geoxis <em>Field Edition</em>
              </h1>
              <div className="gx-ab-badges">
                <span className="gx-ab-badge gx-ab-badge-version">v{VERSION} · Stable</span>
                <span className="gx-ab-badge gx-ab-badge-build">Build {BUILD_NUMBER}</span>
                <span className="gx-ab-badge gx-ab-platform">🤖 Android · Web</span>
              </div>
            </div>
          </div>

          <div className="gx-ab-divider" />

          {/* ── Tabs ── */}
          <div className="gx-ab-tabs">
            {TABS.map((t) => (
              <button
                key={t}
                className={`gx-ab-tab ${activeTab === t ? "active" : ""}`}
                onClick={() => setActiveTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="gx-ab-tab-line" />

          {/* ── Body ── */}
          <div className="gx-ab-body">

            {/* ─────────── OVERVIEW ─────────── */}
            {activeTab === "Overview" && (
              <>
                <p className="gx-ab-desc">
                  Geoxis Field Edition is a professional GIS mapping platform built for field
                  surveyors, geospatial engineers, and researchers. It combines powerful 2D
                  Leaflet mapping with CesiumJS 3D globe visualization, real-time GPS track
                  recording, offline-first tile caching, and a comprehensive spatial data
                  workflow — all from your browser or Android device.
                </p>

                <p className="gx-ab-section-lbl">Application Info</p>
                <div className="gx-ab-meta-grid">
                  {[
                    ["Version",       VERSION],
                    ["Build Date",    BUILD_DATE],
                    ["Build Number",  BUILD_NUMBER],
                    ["Platform",      "Web · Android (Capacitor)"],
                    ["Architecture",  "React + Node.js + PostGIS"],
                    ["License",       "Proprietary · All Rights Reserved"],
                  ].map(([label, value]) => (
                    <div className="gx-ab-meta-card" key={label}>
                      <div className="gx-ab-meta-label">{label}</div>
                      <div className="gx-ab-meta-value" style={{ fontSize: label === "Architecture" || label === "Platform" ? 11 : 13 }}>{value}</div>
                    </div>
                  ))}
                </div>

                <p className="gx-ab-section-lbl">Package Identifier</p>
                <div className="gx-ab-pkg-row">
                  <span style={{ fontSize: 13 }}>📦</span>
                  <span className="gx-ab-pkg-name">{PACKAGE}</span>
                  <button className="gx-ab-copy-btn" onClick={copyPackage}>
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>

                <p className="gx-ab-section-lbl" style={{ marginTop: 16 }}>Developer</p>
                <div className="gx-ab-meta-card" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,rgba(56,189,248,0.25),rgba(129,140,248,0.25))", border: "1.5px solid rgba(56,189,248,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                    👤
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#c8ddf0" }}>{AUTHOR}</div>
                    <div style={{ fontSize: 11, color: "rgba(148,163,184,0.5)", marginTop: 2 }}>Developer & Designer · Geoxis App</div>
                  </div>
                </div>
              </>
            )}

            {/* ─────────── FEATURES ─────────── */}
            {activeTab === "Features" && (
              <>
                <p className="gx-ab-section-lbl">Core Capabilities ({FEATURES.length} features)</p>
                <div className="gx-ab-feat-grid">
                  {FEATURES.map(({ icon, title, desc }) => (
                    <div className="gx-ab-feat-card" key={title}>
                      <span className="gx-ab-feat-icon">{icon}</span>
                      <div>
                        <div className="gx-ab-feat-title">{title}</div>
                        <div className="gx-ab-feat-desc">{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ─────────── TECHNOLOGY ─────────── */}
            {activeTab === "Technology" && (
              <>
                <p className="gx-ab-section-lbl">Technology Stack</p>
                <div className="gx-ab-tech-list">
                  {TECH_STACK.map(({ name, color, desc }) => (
                    <div className="gx-ab-tech-row" key={name}>
                      <div className="gx-ab-tech-dot" style={{ background: color, boxShadow: `0 0 8px ${color}60` }} />
                      <span className="gx-ab-tech-name" style={{ color }}>{name}</span>
                      <span className="gx-ab-tech-desc">{desc}</span>
                    </div>
                  ))}
                </div>

                <p className="gx-ab-section-lbl" style={{ marginTop: 20 }}>Data & Services</p>
                <div className="gx-ab-tech-list">
                  {[
                    { name: "OpenStreetMap",        color: "#4ade80",  desc: "Base tile data provider" },
                    { name: "OSRM Project",          color: "#34d399",  desc: "Open Source Routing Machine" },
                    { name: "Nominatim / OSM",       color: "#60a5fa",  desc: "Geocoding & reverse geocoding" },
                    { name: "Esri / Satellite",      color: "#fbbf24",  desc: "Satellite imagery tiles" },
                    { name: "Wikipedia REST API",    color: "#a78bfa",  desc: "Location info enrichment" },
                  ].map(({ name, color, desc }) => (
                    <div className="gx-ab-tech-row" key={name}>
                      <div className="gx-ab-tech-dot" style={{ background: color, boxShadow: `0 0 8px ${color}60` }} />
                      <span className="gx-ab-tech-name" style={{ color }}>{name}</span>
                      <span className="gx-ab-tech-desc">{desc}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ─────────── LICENSE ─────────── */}
            {activeTab === "License" && (
              <>
                <div className="gx-ab-license-block">
                  <div className="gx-ab-license-title">
                    <span>🔐</span> Proprietary Software License
                  </div>
                  <div className="gx-ab-license-body">
                    Copyright © {YEAR} {AUTHOR}. All Rights Reserved.<br /><br />
                    This software and associated documentation files ("Geoxis Field Edition")
                    are proprietary and confidential. Unauthorized copying, distribution,
                    modification, or use of this software — in whole or in part — is strictly
                    prohibited without prior written permission from the copyright holder.<br /><br />
                    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
                    OR IMPLIED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY CLAIM, DAMAGES,
                    OR OTHER LIABILITY ARISING FROM THE USE OF THIS SOFTWARE.
                  </div>
                </div>

                <p className="gx-ab-section-lbl">Open Source Acknowledgements</p>
                <div className="gx-ab-license-block">
                  {[
                    ["Leaflet.js",    "BSD-2-Clause"],
                    ["CesiumJS",      "Apache 2.0"],
                    ["React",         "MIT"],
                    ["Vite",          "MIT"],
                    ["Capacitor",     "MIT"],
                    ["proj4js",       "MIT"],
                    ["togeojson",     "BSD-2-Clause"],
                    ["shpjs",         "MIT"],
                  ].map(([name, lic]) => (
                    <div className="gx-ab-oss-row" key={name}>
                      <span className="gx-ab-oss-name">{name}</span>
                      <span className="gx-ab-oss-lic">{lic}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

          </div>

          {/* ── Footer ── */}
          <div className="gx-ab-footer">
            <div className="gx-ab-footer-left">
              <span className="gx-ab-copyright">
                © {YEAR} {AUTHOR}. All Rights Reserved.
              </span>
              <span className="gx-ab-made-in">
                <span>Built with ❤️ in India</span>
                <span style={{ fontSize: 14 }}>🇮🇳</span>
                <span style={{ marginLeft: 6, fontFamily: "'Space Mono',monospace", fontSize: 9.5, color: "rgba(100,116,139,0.4)" }}>
                  {PACKAGE}
                </span>
              </span>
            </div>
            <button className="gx-ab-close-btn" onClick={onClose}>
              Close
            </button>
          </div>

        </div>
      </div>
    </>
  );
}