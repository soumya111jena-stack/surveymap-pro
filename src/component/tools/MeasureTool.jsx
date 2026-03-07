/**
 * MeasureTool.jsx — SurveyMap Pro
 * Enhanced measurement tool with live multi-unit conversion panel.
 *
 * Features:
 *  • Click to place measurement points on the map
 *  • Live dashed preview line while moving mouse
 *  • Per-segment distance labels on the polyline
 *  • Double-click or "Finish" to complete measurement
 *  • Right-click to cancel & clear
 *  • Floating multi-unit conversion panel showing total in ALL units:
 *      m, km, mi, ft, yd, nmi, chains, furlongs
 *  • Manual entry tab: type any distance + unit → auto-converts to all others
 *  • Copy-to-clipboard button per unit row
 *  • Selected display unit is highlighted and used in the map tooltip
 */

import { useEffect, useRef, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { haversine, formatDist, UNIT_DEFS } from "../map/measureUtils";

// ─── Unit definitions — sourced from measureUtils so there's one source of truth
const UNITS = UNIT_DEFS;

// Convert metres → target unit
function toUnit(metres, key) {
  const u = UNITS.find(u => u.key === key);
  if (!u) return metres;
  return metres * u.factor;
}

// Convert from a given unit back to metres
function fromUnit(value, key) {
  const u = UNITS.find(u => u.key === key);
  if (!u) return value;
  return value / u.factor;
}

function fmtVal(metres, key) {
  const u = UNITS.find(u => u.key === key);
  if (!u) return metres.toFixed(2);
  return toUnit(metres, key).toFixed(u.dp);
}

// ─── Segment label CSS injected once ────────────────────────────────────────
const LABEL_CSS = `
  .mt-seg-label {
    background: rgba(14,20,35,0.88);
    color: #fbbf24;
    border: 1px solid rgba(251,191,36,0.4);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    font-weight: 700;
    font-family: 'Courier New', monospace;
    white-space: nowrap;
    pointer-events: none;
  }
  .mt-total-label {
    background: rgba(14,20,35,0.94);
    color: #22c55e;
    border: 1px solid rgba(34,197,94,0.45);
    border-radius: 5px;
    padding: 2px 9px;
    font-size: 11px;
    font-weight: 800;
    font-family: 'Courier New', monospace;
    white-space: nowrap;
    pointer-events: none;
  }
  .mt-node-label {
    background: rgba(14,20,35,0.82);
    color: #94a3b8;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 9px;
    font-family: 'Segoe UI', sans-serif;
    pointer-events: none;
  }
`;

// ─── Component ───────────────────────────────────────────────────────────────
export default function MeasureTool({
  measureMode,
  measurePoints,
  setMeasurePoints,
  measureUnit,
  setMeasureUnit,   // NEW: parent should pass this so panel can change display unit
  onFinish,
}) {
  const map = useMap();

  // Map layer refs
  const lineRef       = useRef(null);
  const previewRef    = useRef(null);
  const markersRef    = useRef([]);
  const segLabelsRef  = useRef([]);
  const totalLabelRef = useRef(null);
  const nodeLabelRef  = useRef(null);

  // Panel state
  const [panelOpen,    setPanelOpen]    = useState(false);
  const [activeTab,    setActiveTab]    = useState("live");   // "live" | "manual"
  const [manualVal,    setManualVal]    = useState("");
  const [manualUnit,   setManualUnit]   = useState("m");
  const [copiedKey,    setCopiedKey]    = useState("");
  const [totalMetres,  setTotalMetres]  = useState(0);

  // Inject CSS once
  useEffect(() => {
    if (!document.getElementById("mt-style")) {
      const s = document.createElement("style");
      s.id = "mt-style";
      s.textContent = LABEL_CSS;
      document.head.appendChild(s);
    }
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function calcTotal(points) {
    let t = 0;
    for (let i = 1; i < points.length; i++) t += haversine(points[i - 1], points[i]);
    return t;
  }

  function clearAll() {
    if (lineRef.current)      { lineRef.current.remove();      lineRef.current = null; }
    if (previewRef.current)   { previewRef.current.remove();   previewRef.current = null; }
    if (totalLabelRef.current){ totalLabelRef.current.remove();totalLabelRef.current = null; }
    if (nodeLabelRef.current) { nodeLabelRef.current.remove(); nodeLabelRef.current = null; }
    markersRef.current.forEach(m => m.remove());
    segLabelsRef.current.forEach(l => l.remove());
    markersRef.current  = [];
    segLabelsRef.current = [];
    setMeasurePoints([]);
    setTotalMetres(0);
  }

  function addSegmentLabel(midpoint, dist) {
    const lbl = L.tooltip({
      permanent: true,
      direction: "center",
      className: "mt-seg-label",
      offset: [0, 0],
    })
      .setLatLng(midpoint)
      .setContent(fmtVal(dist, measureUnit || "m") + " " + (UNITS.find(u => u.key === (measureUnit || "m"))?.abbr || "m"))
      .addTo(map);
    segLabelsRef.current.push(lbl);
    return lbl;
  }

  function refreshSegLabels(points) {
    segLabelsRef.current.forEach(l => l.remove());
    segLabelsRef.current = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d   = haversine(a, b);
      addSegmentLabel(mid, d);
    }
  }

  // Re-render segment labels when display unit changes
  useEffect(() => {
    if (measurePoints.length >= 2) refreshSegLabels(measurePoints);
    // Also update total label
    if (totalLabelRef.current && totalMetres > 0) {
      const uAbbr = UNITS.find(u => u.key === (measureUnit || "m"))?.abbr || "m";
      totalLabelRef.current.setContent(
        "▲ Total: " + fmtVal(totalMetres, measureUnit || "m") + " " + uAbbr
      );
    }
  }, [measureUnit]); // eslint-disable-line

  // Clear preview when measureMode turns off
  useEffect(() => {
    if (!measureMode) {
      if (previewRef.current) { previewRef.current.remove(); previewRef.current = null; }
      if (nodeLabelRef.current){ nodeLabelRef.current.remove(); nodeLabelRef.current = null; }
    }
  }, [measureMode]);

  // ── Copy helper ────────────────────────────────────────────────────────────
  function copyVal(key, metres) {
    const u = UNITS.find(u => u.key === key);
    const txt = `${toUnit(metres, key).toFixed(u.dp)} ${u.abbr}`;
    navigator.clipboard?.writeText(txt).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 1800);
  }

  // ── Manual conversion ──────────────────────────────────────────────────────
  const manualMetres = (() => {
    const v = parseFloat(manualVal);
    if (!isFinite(v) || v < 0) return null;
    return fromUnit(v, manualUnit);
  })();

  // ── Map event handlers ─────────────────────────────────────────────────────
  useMapEvents({
    click(e) {
      if (!measureMode) return;

      const point  = [e.latlng.lat, e.latlng.lng];
      const updated = [...measurePoints, point];
      setMeasurePoints(updated);

      const total = calcTotal(updated);
      setTotalMetres(total);

      // Main polyline
      if (!lineRef.current) {
        lineRef.current = L.polyline(updated, {
          color: "#ff8800",
          weight: 2.5,
          opacity: 0.95,
        }).addTo(map);
      } else {
        lineRef.current.setLatLngs(updated);
      }

      // Node dot
      const dot = L.circleMarker(point, {
        radius: 5,
        color: "#fff",
        weight: 2,
        fillColor: "#ff8800",
        fillOpacity: 1,
      }).addTo(map);
      markersRef.current.push(dot);

      // Segment labels
      refreshSegLabels(updated);

      // Node index label
      if (nodeLabelRef.current) nodeLabelRef.current.remove();
      nodeLabelRef.current = L.tooltip({
        permanent: false,
        direction: "top",
        className: "mt-node-label",
        offset: [0, -10],
      })
        .setLatLng(point)
        .setContent(`Pt ${updated.length}`)
        .addTo(map);
      setTimeout(() => {
        if (nodeLabelRef.current) { nodeLabelRef.current.remove(); nodeLabelRef.current = null; }
      }, 1200);

      // Total label at last point
      if (totalLabelRef.current) totalLabelRef.current.remove();
      if (updated.length >= 2) {
        const uAbbr = UNITS.find(u => u.key === (measureUnit || "m"))?.abbr || "m";
        totalLabelRef.current = L.tooltip({
          permanent: true,
          direction: "top",
          offset: [0, -18],
          className: "mt-total-label",
        })
          .setLatLng(point)
          .setContent("▲ Total: " + fmtVal(total, measureUnit || "m") + " " + uAbbr)
          .addTo(map);
      }

      // Auto-open panel on second point
      if (updated.length === 2) setPanelOpen(true);
    },

    mousemove(e) {
      if (!measureMode || measurePoints.length === 0) return;
      const last = measurePoints[measurePoints.length - 1];
      if (!previewRef.current) {
        previewRef.current = L.polyline([last, e.latlng], {
          color: "#ff8800",
          weight: 2,
          opacity: 0.55,
          dashArray: "7,5",
        }).addTo(map);
      } else {
        previewRef.current.setLatLngs([last, e.latlng]);
      }
    },

    dblclick() {
      if (!measureMode) return;
      if (previewRef.current) { previewRef.current.remove(); previewRef.current = null; }
      if (onFinish) onFinish();
    },

    contextmenu() {
      if (!measureMode) return;
      clearAll();
      setPanelOpen(false);
    },
  });

  // ── Panel ──────────────────────────────────────────────────────────────────
  if (!measureMode && !panelOpen) return null;
  if (!measureMode && panelOpen) {
    // Keep panel open after finish if there are points
    if (measurePoints.length < 2) return null;
  }

  const displayMetres = activeTab === "live" ? totalMetres : (manualMetres ?? 0);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 40,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1200,
        width: 440,
        maxWidth: "calc(100vw - 24px)",
        background: "#0f1825",
        borderRadius: 12,
        border: "1px solid rgba(255,140,0,0.28)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        overflow: "hidden",
        animation: "mtFadeIn .22s ease",
      }}
    >
      <style>{`
        @keyframes mtFadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .mt-unit-row:hover{background:rgba(255,255,255,.05)!important;}
        .mt-tab{cursor:pointer;padding:6px 16px;font-size:11px;font-weight:700;border:none;background:transparent;letter-spacing:.05em;transition:all .15s;}
      `}</style>

      {/* ── Header ── */}
      <div style={{
        background: "#141e2e",
        borderBottom: "1px solid rgba(255,255,255,.07)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6,
            background: "linear-gradient(135deg,#ff8800,#fbbf24)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
          }}>📏</div>
          <div>
            <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 13 }}>Measurement Converter</div>
            <div style={{ color: "#475569", fontSize: 10 }}>
              {measureMode
                ? `${measurePoints.length} point${measurePoints.length !== 1 ? "s" : ""} — double-click to finish`
                : `${measurePoints.length} points measured`}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {measureMode && measurePoints.length >= 2 && (
            <button
              onClick={() => { if (onFinish) onFinish(); }}
              style={{
                padding: "4px 11px", borderRadius: 5, border: "none",
                background: "#16a34a", color: "#fff", fontSize: 11,
                fontWeight: 700, cursor: "pointer",
              }}>
              ✓ Finish
            </button>
          )}
          {measurePoints.length > 0 && (
            <button
              onClick={() => { clearAll(); setPanelOpen(false); }}
              style={{
                padding: "4px 10px", borderRadius: 5,
                border: "1px solid rgba(239,68,68,.35)",
                background: "rgba(239,68,68,.08)", color: "#f87171",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>
              ✕ Clear
            </button>
          )}
          <button
            onClick={() => setPanelOpen(p => !p)}
            style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 17 }}>
            {panelOpen ? "▼" : "▲"}
          </button>
        </div>
      </div>

      {panelOpen && (
        <>
          {/* ── Tabs ── */}
          <div style={{
            display: "flex",
            borderBottom: "1px solid rgba(255,255,255,.06)",
            background: "#0d1520",
          }}>
            {[
              { id: "live",   label: "📍 Live Measurement" },
              { id: "manual", label: "✏️ Manual Entry"      },
            ].map(tab => (
              <button
                key={tab.id}
                className="mt-tab"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  color: activeTab === tab.id ? "#fbbf24" : "#475569",
                  borderBottom: `2px solid ${activeTab === tab.id ? "#fbbf24" : "transparent"}`,
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Live tab ── */}
          {activeTab === "live" && (
            <div style={{ padding: "12px 14px" }}>
              {totalMetres === 0 ? (
                <div style={{
                  textAlign: "center", padding: "18px 0",
                  color: "#334155", fontSize: 12, fontStyle: "italic",
                }}>
                  Click on the map to place measurement points…
                </div>
              ) : (
                <>
                  {/* Big total display */}
                  <div style={{
                    background: "rgba(255,140,0,.07)",
                    border: "1px solid rgba(255,140,0,.2)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    marginBottom: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 9, fontWeight: 700, letterSpacing: ".07em", marginBottom: 3 }}>
                        TOTAL DISTANCE · {measurePoints.length} POINTS
                      </div>
                      <div style={{ color: "#fbbf24", fontSize: 22, fontWeight: 800, fontFamily: "monospace", lineHeight: 1 }}>
                        {fmtVal(totalMetres, measureUnit || "m")}
                        <span style={{ fontSize: 13, color: "#92400e", marginLeft: 5 }}>
                          {UNITS.find(u => u.key === (measureUnit || "m"))?.abbr}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => copyVal(measureUnit || "m", totalMetres)}
                      style={{
                        padding: "5px 12px", borderRadius: 5,
                        border: `1px solid ${copiedKey === (measureUnit || "m") ? "rgba(74,222,128,.4)" : "rgba(255,255,255,.1)"}`,
                        background: copiedKey === (measureUnit || "m") ? "rgba(74,222,128,.1)" : "rgba(255,255,255,.04)",
                        color: copiedKey === (measureUnit || "m") ? "#4ade80" : "#64748b",
                        fontSize: 11, fontWeight: 600, cursor: "pointer",
                      }}>
                      {copiedKey === (measureUnit || "m") ? "✓ Copied" : "Copy"}
                    </button>
                  </div>

                  {/* Per-segment breakdown */}
                  {measurePoints.length >= 3 && (
                    <div style={{
                      marginBottom: 10,
                      background: "rgba(255,255,255,.02)",
                      border: "1px solid rgba(255,255,255,.05)",
                      borderRadius: 7,
                      padding: "8px 10px",
                    }}>
                      <div style={{ color: "#334155", fontSize: 9, fontWeight: 700, letterSpacing: ".07em", marginBottom: 6 }}>
                        SEGMENT BREAKDOWN
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 90, overflowY: "auto" }}>
                        {measurePoints.slice(1).map((pt, i) => {
                          const d = haversine(measurePoints[i], pt);
                          return (
                            <div key={i} style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "2px 6px", borderRadius: 4,
                              background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.02)",
                            }}>
                              <span style={{ color: "#475569", fontSize: 10, fontFamily: "monospace" }}>
                                Pt {i + 1} → {i + 2}
                              </span>
                              <span style={{ color: "#fbbf24", fontSize: 10, fontFamily: "monospace", fontWeight: 700 }}>
                                {fmtVal(d, measureUnit || "m")} {UNITS.find(u => u.key === (measureUnit || "m"))?.abbr}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Manual entry tab ── */}
          {activeTab === "manual" && (
            <div style={{ padding: "12px 14px" }}>
              <div style={{
                background: "rgba(167,139,250,.06)",
                border: "1px solid rgba(167,139,250,.18)",
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 10,
              }}>
                <div style={{ color: "#a78bfa", fontSize: 10, fontWeight: 700, letterSpacing: ".07em", marginBottom: 8 }}>
                  ENTER A DISTANCE TO CONVERT
                </div>
                <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={manualVal}
                    onChange={e => setManualVal(e.target.value)}
                    placeholder="e.g. 1500"
                    style={{
                      flex: 1, padding: "8px 10px", borderRadius: 6,
                      border: "1px solid rgba(255,255,255,.1)",
                      background: "rgba(255,255,255,.04)",
                      color: "#e2e8f0", fontSize: 13, outline: "none",
                      fontFamily: "monospace",
                    }}
                  />
                  <select
                    value={manualUnit}
                    onChange={e => setManualUnit(e.target.value)}
                    style={{
                      padding: "8px 10px", borderRadius: 6,
                      border: "1px solid rgba(255,255,255,.1)",
                      background: "#1e2d45", color: "#e2e8f0",
                      fontSize: 12, outline: "none", cursor: "pointer",
                    }}>
                    {UNITS.map(u => (
                      <option key={u.key} value={u.key}>{u.abbr} — {u.label}</option>
                    ))}
                  </select>
                </div>
                {manualVal && !isFinite(parseFloat(manualVal)) && (
                  <div style={{ color: "#f87171", fontSize: 10, marginTop: 5 }}>
                    ⚠ Please enter a valid number
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Unit conversion grid (shared by both tabs) ── */}
          {(activeTab === "live" ? totalMetres > 0 : manualMetres !== null && manualMetres > 0) && (
            <div style={{ padding: "0 14px 14px" }}>
              <div style={{
                color: "#334155", fontSize: 9, fontWeight: 700,
                letterSpacing: ".07em", marginBottom: 7,
              }}>
                ALL UNITS
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 5,
              }}>
                {UNITS.map(u => {
                  const val = toUnit(displayMetres, u.key).toFixed(u.dp);
                  const isActive = u.key === (measureUnit || "m");
                  return (
                    <div
                      key={u.key}
                      className="mt-unit-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "7px 9px",
                        borderRadius: 7,
                        background: isActive
                          ? "rgba(255,140,0,.12)"
                          : "rgba(255,255,255,.025)",
                        border: `1px solid ${isActive ? "rgba(255,140,0,.4)" : "rgba(255,255,255,.05)"}`,
                        cursor: "pointer",
                        transition: "all .12s",
                      }}
                      onClick={() => {
                        if (setMeasureUnit) setMeasureUnit(u.key);
                      }}
                      title={`Set display unit to ${u.label}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 12 }}>{u.icon}</span>
                        <div>
                          <div style={{
                            color: isActive ? "#fbbf24" : "#94a3b8",
                            fontSize: 9, fontWeight: 700, letterSpacing: ".04em",
                          }}>
                            {u.label.toUpperCase()}
                          </div>
                          <div style={{
                            color: isActive ? "#fde68a" : "#e2e8f0",
                            fontSize: 12, fontWeight: 700,
                            fontFamily: "'Courier New', monospace",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {val}
                            <span style={{
                              fontSize: 9,
                              color: isActive ? "#92400e" : "#475569",
                              marginLeft: 3,
                            }}>
                              {u.abbr}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={ev => { ev.stopPropagation(); copyVal(u.key, displayMetres); }}
                        style={{
                          padding: "2px 7px",
                          borderRadius: 4,
                          border: `1px solid ${copiedKey === u.key ? "rgba(74,222,128,.45)" : "rgba(255,255,255,.08)"}`,
                          background: copiedKey === u.key ? "rgba(74,222,128,.1)" : "transparent",
                          color: copiedKey === u.key ? "#4ade80" : "#334155",
                          fontSize: 9, fontWeight: 700, cursor: "pointer",
                          flexShrink: 0,
                        }}>
                        {copiedKey === u.key ? "✓" : "Copy"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Copy all button */}
              <button
                onClick={() => {
                  const allText = UNITS.map(u =>
                    `${u.label}: ${toUnit(displayMetres, u.key).toFixed(u.dp)} ${u.abbr}`
                  ).join("\n");
                  navigator.clipboard?.writeText(allText).catch(() => {});
                  setCopiedKey("_all");
                  setTimeout(() => setCopiedKey(""), 1800);
                }}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "8px",
                  borderRadius: 6,
                  border: `1px solid ${copiedKey === "_all" ? "rgba(74,222,128,.4)" : "rgba(255,255,255,.07)"}`,
                  background: copiedKey === "_all" ? "rgba(74,222,128,.07)" : "rgba(255,255,255,.02)",
                  color: copiedKey === "_all" ? "#4ade80" : "#64748b",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}>
                {copiedKey === "_all" ? "✓ Copied All Units!" : "📋 Copy All Units"}
              </button>
            </div>
          )}
        </>
      )}

      {/* Collapsed summary bar when panel is folded */}
      {!panelOpen && totalMetres > 0 && (
        <div style={{
          padding: "7px 14px",
          background: "#0d1520",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}>
          {UNITS.slice(0, 5).map(u => (
            <span key={u.key} style={{
              color: u.key === (measureUnit || "m") ? "#fbbf24" : "#334155",
              fontSize: 10,
              fontFamily: "monospace",
              fontWeight: u.key === (measureUnit || "m") ? 800 : 400,
            }}>
              {toUnit(totalMetres, u.key).toFixed(u.dp)}{u.abbr}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}