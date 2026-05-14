// src/components/DirectionsPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Directions panel — Google Earth style
//  • Drive / Walk / Cycle mode selector
//  • Origin & Destination inputs with A/B pin badges
//  • Swap button (↕) between origin & destination
//  • Per-field clear (×) button
//  • Get Directions → calls onCalculate with resolved lat/lng
//  • Suggested routes list (fastest badge, active highlight)
//  • Turn-by-turn steps with direction icons
//  • Summary bar: total time + distance
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from "react";

/* ── Transport modes ────────────────────────────────────────────────────────── */
const MODES = [
  { key: "driving",  icon: "🚗", label: "Drive"  },
  { key: "walking",  icon: "🚶", label: "Walk"   },
  { key: "cycling",  icon: "🚴", label: "Cycle"  },
];

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function formatDist(m) {
  if (m == null || isNaN(m)) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function formatTime(s) {
  if (s == null || isNaN(s)) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  if (m === 0) return "< 1 min";
  return `${m} min`;
}

function stepIcon(type, modifier) {
  if (type === "depart" || type === "arrive") return "📍";
  if (type === "roundabout" || type === "rotary") return "🔄";
  if (!modifier) return "⬆️";
  const mod = modifier.toLowerCase();
  if (mod.includes("sharp left"))  return "↩️";
  if (mod.includes("sharp right")) return "↪️";
  if (mod.includes("slight left")) return "↖️";
  if (mod.includes("slight right")) return "↗️";
  if (mod.includes("left"))        return "⬅️";
  if (mod.includes("right"))       return "➡️";
  if (mod.includes("uturn"))       return "🔃";
  if (mod.includes("straight"))    return "⬆️";
  return "⬆️";
}

/* ── Pin badge (A / B) ────────────────────────────────────────────────────── */
function PinBadge({ letter, color }) {
  return (
    <div style={{
      position: "absolute", left: 10, top: "50%",
      width: 22, height: 22,
      background: color,
      borderRadius: "50% 50% 50% 0",
      transform: "translateY(-50%) rotate(-45deg)",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
      flexShrink: 0, pointerEvents: "none", zIndex: 1,
    }}>
      <span style={{
        transform: "rotate(45deg)", color: "#fff",
        fontWeight: 800, fontSize: 10, lineHeight: 1,
        fontFamily: "system-ui,sans-serif",
        display: "block", marginLeft: 1, marginTop: 1,
      }}>
        {letter}
      </span>
    </div>
  );
}

/* ── Input row ────────────────────────────────────────────────────────────── */
function LocationInput({ letter, color, value, onChange, onKeyDown, placeholder, onClear }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative", marginBottom: 6 }}>
      <PinBadge letter={letter} color={color} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "9px 32px 9px 38px",
          borderRadius: 8,
          border: `1px solid ${focused ? "rgba(74,158,255,0.45)" : "rgba(255,255,255,0.1)"}`,
          background: focused ? "rgba(74,158,255,0.06)" : "rgba(255,255,255,0.055)",
          color: "#c8dff0", fontSize: 12, outline: "none",
          fontFamily: "'DM Sans',sans-serif",
          transition: "border-color 0.15s, background 0.15s",
        }}
      />
      {value && (
        <button
          onClick={onClear}
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none",
            color: "rgba(255,255,255,0.3)", cursor: "pointer",
            fontSize: 15, lineHeight: 1, padding: "2px 4px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          title="Clear"
        >×</button>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */
export default function DirectionsPanel({
  onClose,
  onCalculate,
  onClear,
  routeResult,
  routeLoading,
  routeError,
  activeRouteIdx,
  setActiveRouteIdx,
  geocodeForMap,
}) {
  const [originText, setOriginText] = useState("");
  const [destText,   setDestText]   = useState("");
  const [mode,       setMode]       = useState("driving");
  const [resolving,  setResolving]  = useState(false);
  const [showSteps,  setShowSteps]  = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);

  const loading     = routeLoading || resolving;
  const activeRoute = routeResult?.routes?.[activeRouteIdx ?? 0];

  // Add animation keyframes to document
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes blink {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.8; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  /* ── Swap origin ↔ destination ─────────────────────────────────────────── */
  const handleSwap = () => {
    setOriginText(destText);
    setDestText(originText);
  };

  /* ── Geocode & fire onCalculate ────────────────────────────────────────── */
  const handleSearch = async () => {
    const oq = originText.trim();
    const dq = destText.trim();
    if (!oq || !dq) return;
    setResolving(true);
    try {
      const [o, d] = await Promise.all([
        geocodeForMap(oq),
        geocodeForMap(dq),
      ]);
      if (!o) { alert(`Could not find: "${oq}"`); return; }
      if (!d) { alert(`Could not find: "${dq}"`); return; }
      onCalculate({
        origin:      { lat: o.lat, lng: o.lng, label: o.name || oq },
        destination: { lat: d.lat, lng: d.lng, label: d.name || dq },
        mode,
      });
    } catch (err) {
      console.error("Directions geocode error:", err);
    } finally {
      setResolving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleClearAll = () => {
    onClear();
    setOriginText("");
    setDestText("");
  };

  // Minimized panel view
  if (isMinimized) {
    return (
      <div style={{
        position: "fixed",
        top: 78,
        left: 0,
        zIndex: 1120,
        background: "rgba(4,10,22,0.99)",
        borderRight: "1px solid rgba(255,255,255,0.07)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "0 0 12px 0",
        fontFamily: "'DM Sans',sans-serif",
        backdropFilter: "blur(10px)",
      }}>
        <button
          onClick={() => setIsMinimized(false)}
          style={{
            padding: "10px 14px",
            background: "none",
            border: "none",
            color: "#c8e0f8",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a9eff" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          Directions
        </button>
      </div>
    );
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  return (
    <>
      {/* Panel */}
      <div style={{
        position: "fixed",
        top: 78,
        left: 0,
        width: 320,
        bottom: 26,
        zIndex: 1120,
        background: "rgba(4,10,22,0.95)",
        backdropFilter: "blur(12px)",
        borderRight: "1px solid rgba(255,255,255,0.07)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'DM Sans',sans-serif",
        overflow: "hidden",
        boxShadow: "4px 0 20px rgba(0,0,0,0.3)",
        transition: "transform 0.3s ease",
      }}>
        {/* Minimize button */}
        <button
          onClick={() => setIsMinimized(true)}
          style={{
            position: "absolute",
            top: 12,
            right: 40,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 8px",
            zIndex: 10,
          }}
          title="Minimize panel"
        >
          −
        </button>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a9eff" strokeWidth="2" strokeLinecap="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
              <span style={{ color: "#c8e0f8", fontWeight: 700, fontSize: 14 }}>Get Directions</span>
            </div>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 4px", display: "flex", alignItems: "center" }}
            >×</button>
          </div>

          {/* Mode selector */}
          <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
            {MODES.map(m => {
              const on = mode === m.key;
              return (
                <button key={m.key} onClick={() => setMode(m.key)} style={{
                  flex: 1, padding: "7px 4px", borderRadius: 9, cursor: "pointer",
                  fontSize: 10.5, fontWeight: 600,
                  background: on ? "rgba(26,115,232,0.2)" : "rgba(255,255,255,0.04)",
                  border: `1.5px solid ${on ? "rgba(26,115,232,0.55)" : "rgba(255,255,255,0.08)"}`,
                  color: on ? "#80c4ff" : "rgba(200,220,255,0.38)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  transition: "all 0.15s",
                }}>
                  <span style={{ fontSize: 17 }}>{m.icon}</span>
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Origin + Destination + Swap */}
          <div style={{ position: "relative" }}>
            <LocationInput
              letter="A" color="#34a853"
              value={originText}
              onChange={setOriginText}
              onKeyDown={handleKeyDown}
              placeholder="Starting point…"
              onClear={() => setOriginText("")}
            />

            {/* Swap button */}
            <button
              onClick={handleSwap}
              title="Swap origin & destination"
              style={{
                position: "absolute", right: -2, top: "50%",
                transform: "translateY(-50%)",
                width: 28, height: 28,
                background: "rgba(74,158,255,0.14)",
                border: "1px solid rgba(74,158,255,0.3)",
                borderRadius: "50%", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#60a5fa", zIndex: 10, fontSize: 14,
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(74,158,255,0.28)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(74,158,255,0.14)"}
            >
              ⇅
            </button>

            <LocationInput
              letter="B" color="#ea4335"
              value={destText}
              onChange={setDestText}
              onKeyDown={handleKeyDown}
              placeholder="Destination…"
              onClear={() => setDestText("")}
            />
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button
              onClick={handleSearch}
              disabled={loading || !originText.trim() || !destText.trim()}
              style={{
                flex: 1, padding: "10px", borderRadius: 8, border: "none",
                background: loading
                  ? "rgba(26,115,232,0.3)"
                  : (!originText.trim() || !destText.trim())
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(26,115,232,0.88)",
                color: loading || (!originText.trim() || !destText.trim()) ? "rgba(255,255,255,0.3)" : "#fff",
                fontWeight: 700, fontSize: 12.5,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                transition: "background 0.15s",
              }}
            >
              {loading
                ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 13 }}>◌</span> Searching…</>
                : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg> Get Directions</>
              }
            </button>

            {(routeResult || originText || destText) && (
              <button
                onClick={handleClearAll}
                style={{
                  padding: "10px 13px", borderRadius: 8,
                  border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.1)",
                  color: "#f87171", fontWeight: 700, fontSize: 12, cursor: "pointer",
                }}
                title="Clear route"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* ── Results area ───────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

          {/* Error */}
          {routeError && (
            <div style={{
              margin: 10, padding: "12px 14px",
              color: "#f87171", fontSize: 12,
              background: "rgba(239,68,68,0.07)",
              borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)",
              display: "flex", alignItems: "flex-start", gap: 7,
            }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>⚠</span>
              <span>{routeError}</span>
            </div>
          )}

          {/* Route alternatives */}
          {routeResult?.routes?.length > 0 && (
            <>
              {/* Summary banner for active route */}
              {activeRoute && (
                <div style={{
                  margin: "10px 12px 4px",
                  padding: "12px 14px",
                  background: "linear-gradient(135deg,rgba(26,115,232,0.14),rgba(26,115,232,0.06))",
                  border: "1px solid rgba(26,115,232,0.28)",
                  borderRadius: 10,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#80c4ff", fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
                      {formatTime(activeRoute.duration)}
                    </div>
                    <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.38)", marginTop: 3 }}>
                      {formatDist(activeRoute.distance)}
                      {activeRoute.summary ? ` · via ${activeRoute.summary}` : ""}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#4ade80", background: "rgba(34,197,94,0.12)", padding: "3px 8px", borderRadius: 10, border: "1px solid rgba(34,197,94,0.25)" }}>
                      {MODES.find(m => m.key === (routeResult.mode || "driving"))?.icon} {MODES.find(m => m.key === (routeResult.mode || "driving"))?.label}
                    </div>
                  </div>
                </div>
              )}

              {/* Route alternatives list */}
              <div style={{ padding: "8px 12px 4px" }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.22)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7, fontFamily: "'DM Mono',monospace" }}>
                  Suggested Routes
                </div>
                {routeResult.routes.map((route, idx) => {
                  const on = idx === (activeRouteIdx ?? 0);
                  return (
                    <div
                      key={idx}
                      onClick={() => setActiveRouteIdx(idx)}
                      style={{
                        padding: "10px 12px", borderRadius: 10,
                        cursor: "pointer", marginBottom: 5,
                        background: on ? "rgba(26,115,232,0.14)" : "rgba(255,255,255,0.035)",
                        border: `1px solid ${on ? "rgba(26,115,232,0.42)" : "rgba(255,255,255,0.07)"}`,
                        transition: "background 0.12s, border-color 0.12s",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 17, fontWeight: 800, color: on ? "#80c4ff" : "rgba(200,220,255,0.45)", fontFamily: "'DM Mono',monospace" }}>
                            {formatTime(route.duration)}
                          </span>
                          <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.28)" }}>
                            {formatDist(route.distance)}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          {idx === 0 && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#4ade80", background: "rgba(34,197,94,0.12)", padding: "2px 7px", borderRadius: 10, border: "1px solid rgba(34,197,94,0.25)" }}>
                              FASTEST
                            </span>
                          )}
                          {on && <span style={{ fontSize: 9, color: "#60a5fa" }}>● Active</span>}
                        </div>
                      </div>
                      {route.summary && (
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          via {route.summary}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Turn-by-turn directions */}
              {activeRoute?.steps?.length > 0 && (
                <div style={{ padding: "4px 12px 20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.22)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>
                      Turn-by-Turn
                    </div>
                    <button
                      onClick={() => setShowSteps(p => !p)}
                      style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 10 }}
                    >
                      {showSteps ? "Hide ▲" : "Show ▼"}
                    </button>
                  </div>

                  {showSteps && activeRoute.steps.map((step, idx) => {
                    const isFirst = idx === 0;
                    const isLast  = idx === activeRoute.steps.length - 1;
                    const iconBg  = isFirst ? "rgba(52,168,83,0.15)" : isLast ? "rgba(234,67,53,0.15)" : "rgba(74,158,255,0.09)";
                    const iconBd  = isFirst ? "rgba(52,168,83,0.3)"  : isLast ? "rgba(234,67,53,0.3)"  : "rgba(74,158,255,0.2)";
                    return (
                      <div key={idx} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: iconBg, border: `1px solid ${iconBd}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>
                          {stepIcon(step.type, step.modifier)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: "rgba(200,220,255,0.78)", fontSize: 11.5, lineHeight: 1.45 }}>
                            {step.instruction || step.name || "Continue"}
                          </div>
                          {step.distance > 0 && (
                            <div style={{ color: "rgba(255,255,255,0.24)", fontSize: 10, fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
                              {formatDist(step.distance)}
                              {step.duration > 60 && ` · ${formatTime(step.duration)}`}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Empty state */}
          {!routeResult && !loading && !routeError && (
            <div style={{ padding: "30px 20px", textAlign: "center", color: "rgba(255,255,255,0.18)", fontSize: 11, fontStyle: "italic" }}>
              <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.6 }}>🗺</div>
              <div style={{ color: "rgba(200,220,255,0.3)", fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Get Directions</div>
              <div>Enter a start and end location above, then tap <strong style={{ color: "rgba(74,158,255,0.6)" }}>Get Directions</strong></div>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !routeResult && (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              {[80, 60, 90, 50].map((w, i) => (
                <div key={i} style={{ height: 12, width: `${w}%`, background: "rgba(255,255,255,0.07)", borderRadius: 6, animation: "blink 1.4s infinite", animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}