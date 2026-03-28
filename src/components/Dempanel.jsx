/**
 * DEMPanel.jsx — QGIS-style DEM control panel for SurveyMap Pro v5.9
 *
 * Shows:
 *  • Import / Remove button
 *  • Colour-ramp picker (visual swatches, identical to QGIS built-ins)
 *  • Opacity slider
 *  • Min / Max / Mean elevation stats
 *  • Gradient legend bar with tick labels (like QGIS legend)
 *  • Error state
 */

import React from "react";
import { COLOR_RAMPS } from "../component/loaders/Demloader";
import { exportDEM } from "../utils/exportDem";

/* ─── tiny gradient swatch for each ramp ─────────────────────────────── */
function RampSwatch({ ramp, selected, onClick, label }) {
  // Build CSS gradient stops from the ramp definition
  const stops = ramp
    .map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`)
    .join(", ");
  const gradient = `linear-gradient(to right, ${stops})`;

  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: "100%",
        height: 22,
        borderRadius: 5,
        cursor: "pointer",
        background: gradient,
        border: selected
          ? "2px solid #fb7185"
          : "1.5px solid rgba(255,255,255,0.12)",
        outline: "none",
        padding: 0,
        transition: "border-color 0.15s, transform 0.1s",
        transform: selected ? "scaleY(1.15)" : "scaleY(1)",
        boxShadow: selected ? "0 0 8px rgba(251,113,133,0.5)" : "none",
      }}
    />
  );
}

/* ─── Legend bar (identical layout to QGIS legend) ───────────────────── */
function ElevationLegend({ ramp, minVal, maxVal }) {
  if (minVal == null || maxVal == null) return null;
  const stops = ramp
    .map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`)
    .join(", ");
  const range  = maxVal - minVal;
  const ticks  = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        height: 18,
        borderRadius: 4,
        background: `linear-gradient(to right, ${stops})`,
        border: "1px solid rgba(255,255,255,0.12)",
        position: "relative",
      }}/>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: 3,
      }}>
        {ticks.map(t => (
          <span key={t} style={{
            fontSize: 9,
            color: "rgba(255,255,255,0.38)",
            fontFamily: "'DM Mono',monospace",
            userSelect: "none",
          }}>
            {Math.round(minVal + t * range)} m
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PANEL
═══════════════════════════════════════════════════════════════════════ */
export default function DEMPanel({
  demFileName,
  demLoading,
  demStats,
  demOpacity,
  demColorRamp,
  demError,
  onUpload,       // (File) => void
  onRemove,       // () => void
  onOpacity,      // (number 0-1) => void
  onColorRamp,    // (string) => void
}) {
  const rampEntries = Object.entries(COLOR_RAMPS);

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif" }}>

      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 9.5,
          fontWeight: 700,
          color: "rgba(255,255,255,0.3)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontFamily: "'DM Mono',monospace",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          <span style={{ fontSize: 13 }}>🏔</span> DEM Elevation Layer
        </div>
        {demFileName && (
          <button
            onClick={onRemove}
            style={{
              background: "none",
              border: "none",
              color: "rgba(239,68,68,0.5)",
              cursor: "pointer",
              fontSize: 15,
              padding: 0,
              lineHeight: 1,
            }}
            title="Remove DEM"
          >×</button>
        )}
      </div>

      {/* Import area (if no file loaded) */}
      {!demFileName && !demLoading && (
        <label style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "16px 10px",
          borderRadius: 10,
          cursor: "pointer",
          background: "rgba(251,113,133,0.05)",
          border: "1.5px dashed rgba(251,113,133,0.28)",
          color: "#fb7185",
          fontSize: 11,
          fontWeight: 600,
          textAlign: "center",
          transition: "background 0.15s, border-color 0.15s",
        }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(251,113,133,0.10)";
            e.currentTarget.style.borderColor = "rgba(251,113,133,0.5)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(251,113,133,0.05)";
            e.currentTarget.style.borderColor = "rgba(251,113,133,0.28)";
          }}
        >
          <span style={{ fontSize: 22 }}>🏔</span>
          <span>Import DEM File</span>
          <span style={{
            fontSize: 9.5,
            color: "rgba(251,113,133,0.45)",
            fontWeight: 400,
            fontFamily: "'DM Mono',monospace",
          }}>
            .tif · .tiff · .asc · .dem · .img
          </span>
          <input
            type="file"
            accept=".tif,.tiff,.asc,.dem,.img"
            onChange={e => { const f = e.target.files[0]; if (f) { onUpload(f); e.target.value = ""; } }}
            style={{ display: "none" }}
          />
        </label>
      )}

      {/* Loading state */}
      {demLoading && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "rgba(251,113,133,0.07)",
          border: "1px solid rgba(251,113,133,0.22)",
          borderRadius: 8,
          color: "#fb7185",
          fontSize: 11,
        }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 14 }}>⟳</span>
          Parsing DEM raster…
        </div>
      )}

      {/* Error state */}
      {demError && (
        <div style={{
          padding: "9px 12px",
          background: "rgba(239,68,68,0.07)",
          border: "1px solid rgba(239,68,68,0.22)",
          borderRadius: 8,
          color: "#f87171",
          fontSize: 10.5,
          marginBottom: 8,
        }}>
          ⚠ {demError}
        </div>
      )}

      {/* Loaded — show controls */}
      {demFileName && !demLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* File chip */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            background: "rgba(251,113,133,0.07)",
            border: "1px solid rgba(251,113,133,0.22)",
            borderRadius: 8,
          }}>
            <span style={{ fontSize: 14 }}>🏔</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: "#fda4af",
                fontSize: 11,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {demFileName}
              </div>
              {demStats && (
                <div style={{
                  color: "rgba(251,113,133,0.45)",
                  fontSize: 9.5,
                  fontFamily: "'DM Mono',monospace",
                }}>
                  {demStats.width}×{demStats.height}px
                  · {Math.round(demStats.min)}–{Math.round(demStats.max)} m
                </div>
              )}
            </div>
          </div>

          {/* Stats row (QGIS-style) */}
          {demStats && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 5,
            }}>
              {[
                ["Min", Math.round(demStats.min) + " m", "#38bdf8"],
                ["Mean", Math.round(demStats.mean) + " m", "#a78bfa"],
                ["Max", Math.round(demStats.max) + " m", "#fb7185"],
              ].map(([label, value, color]) => (
                <div key={label} style={{
                  padding: "6px 8px",
                  background: "rgba(255,255,255,0.035)",
                  borderRadius: 7,
                  border: "1px solid rgba(255,255,255,0.07)",
                  textAlign: "center",
                }}>
                  <div style={{
                    fontSize: 8.5,
                    color: "rgba(255,255,255,0.28)",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontFamily: "'DM Mono',monospace",
                    marginBottom: 2,
                  }}>
                    {label}
                  </div>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color,
                    fontFamily: "'DM Mono',monospace",
                  }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Colour ramp picker */}
          <div>
            <div style={{
              fontSize: 9,
              fontWeight: 700,
              color: "rgba(255,255,255,0.25)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 6,
              fontFamily: "'DM Mono',monospace",
            }}>
              Colour Ramp
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {rampEntries.map(([name, ramp]) => (
                <div key={name} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}>
                  <span style={{
                    width: 52,
                    fontSize: 9.5,
                    color: demColorRamp === name
                      ? "#fda4af"
                      : "rgba(255,255,255,0.28)",
                    fontWeight: demColorRamp === name ? 700 : 400,
                    fontFamily: "'DM Mono',monospace",
                    flexShrink: 0,
                    userSelect: "none",
                  }}>
                    {name}
                  </span>
                  <div style={{ flex: 1 }}>
                    <RampSwatch
                      ramp={ramp}
                      selected={demColorRamp === name}
                      onClick={() => onColorRamp(name)}
                      label={name}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Opacity slider */}
          <div>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}>
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                color: "rgba(255,255,255,0.25)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily: "'DM Mono',monospace",
              }}>
                Opacity
              </span>
              <span style={{
                fontSize: 10,
                color: "#fb7185",
                fontFamily: "'DM Mono',monospace",
                fontWeight: 700,
              }}>
                {Math.round(demOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={demOpacity}
              onChange={e => onOpacity(Number(e.target.value))}
              style={{
                width: "100%",
                accentColor: "#fb7185",
                cursor: "pointer",
              }}
            />
          </div>

          {/* Legend bar */}
          {demStats && (
            <ElevationLegend
              ramp={COLOR_RAMPS[demColorRamp] || COLOR_RAMPS["Terrain"]}
              minVal={demStats.min}
              maxVal={demStats.max}
            />
          )}

        </div>
      )}
    </div>
  );
}