/**
 * OfflineMapManager.jsx  –  src/component/map/OfflineMapManager.jsx
 *
 * ✅ No Service Worker references
 * ✅ Works on any IP / HTTP
 * ✅ Added Stop Download button
 */

import { useState } from "react";
import { estimateTileCount } from "./useOfflineMap";

const LAYERS = [
  { key: "Satellite", label: "Satellite",  color: "#38bdf8" },
  { key: "Street",    label: "Street Map", color: "#4ade80" },
  { key: "Terrain",   label: "Terrain",    color: "#fb923c" },
  { key: "Dark",      label: "Dark",       color: "#a78bfa" },
  { key: "Light",     label: "Light",      color: "#fbbf24" },
];

const s = {
  card: {
    background: "#0f1623",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 10,
    padding: "10px 13px",
  },
  lbl: {
    color: "#475569",
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: ".09em",
    textTransform: "uppercase",
    display: "block",
    marginBottom: 7,
  },
};

export default function OfflineMapManager({
  visible,
  onClose,
  leafletMap,
  isOnline,
  swReady,       // = dbReady from useOfflineMap
  swError,       // = dbError from useOfflineMap
  cacheStats,
  precaching,
  precacheProgress,
  precacheCurrentView,
  clearTileCache,
  fetchCacheStats,
  stopPrecache,  // new prop — call to cancel download
}) {
  const [tab,          setTab]          = useState("download");
  const [selLayers,    setSelLayers]    = useState(["Satellite"]);
  const [minZoom,      setMinZoom]      = useState(10);
  const [maxZoom,      setMaxZoom]      = useState(15);
  const [clearConfirm, setClearConfirm] = useState(false);

  if (!visible) return null;

  // ── Tile estimate for current view ──
  const est = (() => {
    if (!leafletMap) return 0;
    try {
      const b = leafletMap.getBounds();
      return estimateTileCount(
        { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        minZoom, maxZoom, selLayers.length
      );
    } catch { return 0; }
  })();

  const estMB       = ((est * 15) / 1024).toFixed(1);   // ~15 KB per tile
  const pct         = precacheProgress?.progress ?? 0;
  const cacheUsePct = cacheStats
    ? Math.min(100, Math.round((cacheStats.tileCount / cacheStats.maxTiles) * 100))
    : 0;

  const canDownload = swReady && !precaching && isOnline && selLayers.length > 0;

  function toggleLayer(k) {
    setSelLayers((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  }

  // ── DB status block (replaces SW error block) ──
  function DbStatusBlock() {
    if (swError) {
      return (
        <div style={{
          margin: "0 0 12px",
          padding: "12px 14px",
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 9,
          color: "#f87171",
          fontSize: 11,
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12 }}>
            ⚠ Storage Unavailable
          </div>
          <div style={{ color: "#fca5a5" }}>{swError}</div>
          <div style={{ marginTop: 8, fontSize: 10, color: "#64748b" }}>
            Try enabling cookies / site storage in your browser settings.
          </div>
        </div>
      );
    }

    if (!swReady) {
      return (
        <div style={{
          margin: "0 0 12px",
          padding: "10px 12px",
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.25)",
          borderRadius: 8,
          color: "#fbbf24",
          fontSize: 11,
        }}>
          ⏳ Initialising offline storage…
        </div>
      );
    }

    // Ready — show a small green confirmation once
    return (
      <div style={{
        margin: "0 0 12px",
        padding: "8px 12px",
        background: "rgba(34,197,94,0.07)",
        border: "1px solid rgba(34,197,94,0.2)",
        borderRadius: 8,
        color: "#4ade80",
        fontSize: 10,
        display: "flex",
        alignItems: "center",
        gap: 7,
      }}>
        <span>✓</span>
        <span>
          Offline storage ready — works on <strong>any IP or HTTP</strong>, no HTTPS needed.
        </span>
      </div>
    );
  }

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 3000,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(5px)",
        }}
      />

      {/* panel */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        zIndex: 3001, width: "100%", maxWidth: 380,
        background: "#0a0f1e",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 16,
        boxShadow: "0 28px 90px rgba(0,0,0,0.85)",
        fontFamily: "'DM Sans',system-ui,sans-serif",
        overflow: "hidden",
      }}>

        {/* ── header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "15px 18px 13px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.02)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              background: isOnline ? "#22c55e" : "#ef4444",
              boxShadow: `0 0 8px ${isOnline ? "#22c55e" : "#ef4444"}`,
              flexShrink: 0,
            }}/>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>Offline Maps</div>
              <div style={{ color: isOnline ? "#4ade80" : "#f87171", fontSize: 10, marginTop: 1 }}>
                {isOnline ? "● Online – tiles cached as you browse" : "● Offline – serving cached tiles only"}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#475569", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "2px 5px" }}
          >×</button>
        </div>

        {/* ── tabs ── */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          {[["download", "⬇ Download"], ["stats", "📊 Cache Stats"]].map(([id, lbl]) => (
            <button
              key={id} onClick={() => setTab(id)}
              style={{
                flex: 1, padding: "9px 4px", border: "none", background: "transparent",
                borderBottom: `2px solid ${tab === id ? "#3b82f6" : "transparent"}`,
                color: tab === id ? "#f1f5f9" : "#475569",
                fontWeight: tab === id ? 700 : 400,
                fontSize: 11, cursor: "pointer", fontFamily: "inherit", transition: "all .15s",
              }}
            >{lbl}</button>
          ))}
        </div>

        {/* ── body ── */}
        <div style={{ padding: "14px 16px 18px", maxHeight: "65vh", overflowY: "auto" }}>

          <DbStatusBlock />

          {/* ════ DOWNLOAD TAB ════ */}
          {tab === "download" && (<>

            {/* layer selector */}
            <div style={{ marginBottom: 14 }}>
              <span style={s.lbl}>Select layers to cache</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {LAYERS.map((l) => (
                  <button
                    key={l.key}
                    onClick={() => toggleLayer(l.key)}
                    style={{
                      padding: "5px 12px", borderRadius: 20,
                      border: `1px solid ${selLayers.includes(l.key) ? l.color : "rgba(255,255,255,0.1)"}`,
                      background: selLayers.includes(l.key) ? `${l.color}20` : "transparent",
                      color: selLayers.includes(l.key) ? l.color : "#64748b",
                      fontSize: 11, fontWeight: 600, cursor: "pointer",
                      fontFamily: "inherit", transition: "all .15s",
                    }}
                  >
                    {selLayers.includes(l.key) ? "✓ " : ""}{l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* zoom selectors */}
            <div style={{ marginBottom: 14 }}>
              <span style={s.lbl}>Zoom levels (detail)</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>Min zoom</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[8, 10, 12].map((z) => (
                      <button
                        key={z} onClick={() => setMinZoom(z)}
                        style={{
                          flex: 1, padding: "5px 4px", borderRadius: 7,
                          border: `1px solid ${minZoom === z ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.1)"}`,
                          background: minZoom === z ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                          color: minZoom === z ? "#60a5fa" : "#64748b",
                          fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >z{z}</button>
                    ))}
                  </div>
                </div>
                <div style={{ color: "#334155" }}>→</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>Max zoom</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[14, 15, 16].map((z) => (
                      <button
                        key={z} onClick={() => setMaxZoom(z)}
                        style={{
                          flex: 1, padding: "5px 4px", borderRadius: 7,
                          border: `1px solid ${maxZoom === z ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.1)"}`,
                          background: maxZoom === z ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                          color: maxZoom === z ? "#60a5fa" : "#64748b",
                          fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >z{z}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ color: "#334155", fontSize: 10, marginTop: 5 }}>
                z10 = city · z14 = street · z16 = building detail
              </div>
            </div>

            {/* tile estimate */}
            {est > 0 && !precaching && (
              <div style={{
                ...s.card,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 12,
                borderColor: "rgba(59,130,246,0.2)",
                background: "rgba(59,130,246,0.07)",
              }}>
                <div>
                  <div style={{ color: "#60a5fa", fontSize: 11, fontWeight: 600 }}>Current view area</div>
                  <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>
                    {selLayers.length} layer{selLayers.length !== 1 ? "s" : ""} · z{minZoom}–z{maxZoom}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, fontFamily: "monospace" }}>
                    ~{est.toLocaleString()}
                  </div>
                  <div style={{ color: "#475569", fontSize: 10 }}>tiles · ~{estMB} MB</div>
                </div>
              </div>
            )}

            {/* progress bar */}
            {precaching && precacheProgress && (
              <div style={{
                ...s.card,
                marginBottom: 12,
                borderColor: "rgba(59,130,246,0.25)",
                background: "rgba(59,130,246,0.07)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: 12 }}>⬇ Downloading…</span>
                  <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 12, fontFamily: "monospace" }}>{pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3, width: `${pct}%`,
                    transition: "width .3s",
                    background: "linear-gradient(90deg,#1d4ed8,#3b82f6)",
                  }}/>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ color: "#4ade80", fontSize: 10 }}>✓ {precacheProgress.cached}</span>
                  {precacheProgress.failed > 0 && (
                    <span style={{ color: "#f87171", fontSize: 10 }}>✗ {precacheProgress.failed}</span>
                  )}
                  <span style={{ color: "#475569", fontSize: 10 }}>
                    {precacheProgress.cached + precacheProgress.failed} / {precacheProgress.total}
                  </span>
                </div>
              </div>
            )}

            {/* download / stop buttons */}
            {!precaching ? (
              <button
                onClick={() =>
                  canDownload &&
                  precacheCurrentView(leafletMap, { minZoom, maxZoom, layers: selLayers })
                }
                disabled={!canDownload}
                style={{
                  width: "100%", padding: "13px", borderRadius: 10, border: "none",
                  background: canDownload
                    ? "linear-gradient(135deg,#1d4ed8,#3b82f6)"
                    : "rgba(255,255,255,0.06)",
                  color: canDownload ? "#fff" : "#334155",
                  fontWeight: 700, fontSize: 13,
                  cursor: canDownload ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                  boxShadow: canDownload ? "0 6px 20px rgba(59,130,246,0.4)" : "none",
                  transition: "all .2s",
                }}
              >
                {!swReady && swError
                  ? "⚠ Fix storage issue above"
                  : !swReady
                  ? "⏳ Initialising storage…"
                  : !isOnline
                  ? "⚠ Go online to download tiles"
                  : !selLayers.length
                  ? "Select at least one layer"
                  : "⬇ Download Current View for Offline"}
              </button>
            ) : (
              <button
                onClick={() => stopPrecache?.()}
                style={{
                  width: "100%", padding: "13px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg,#7f1d1d,#ef4444)",
                  color: "#fff", fontWeight: 700, fontSize: 13,
                  cursor: "pointer", fontFamily: "inherit",
                  boxShadow: "0 6px 20px rgba(239,68,68,0.35)",
                  transition: "all .2s",
                }}
              >
                ⏹ Stop Download
              </button>
            )}

            {!precaching && swReady && isOnline && (
              <div style={{ color: "#334155", fontSize: 10, marginTop: 8, textAlign: "center" }}>
                💡 Tiles are also auto-cached as you browse normally
              </div>
            )}
          </>)}

          {/* ════ STATS TAB ════ */}
          {tab === "stats" && (<>
            {cacheStats ? (<>
              <div style={{ ...s.card, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                  <span style={{ color: "#94a3b8", fontSize: 11 }}>Cache usage</span>
                  <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 11, fontFamily: "monospace" }}>{cacheUsePct}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 4, width: `${cacheUsePct}%`,
                    transition: "width .5s",
                    background: cacheUsePct > 80
                      ? "linear-gradient(90deg,#dc2626,#ef4444)"
                      : cacheUsePct > 50
                      ? "linear-gradient(90deg,#d97706,#f59e0b)"
                      : "linear-gradient(90deg,#15803d,#22c55e)",
                  }}/>
                </div>
                <div style={{ color: "#475569", fontSize: 10, marginTop: 5 }}>
                  {cacheStats.tileCount.toLocaleString()} / {cacheStats.maxTiles.toLocaleString()} tiles
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  ["🗺 Cached Tiles", cacheStats.tileCount.toLocaleString(), "#38bdf8"],
                  ["💾 Est. Storage",  `${cacheStats.estimatedMB} MB`,        "#4ade80"],
                  ["📦 Storage",      "IndexedDB",                            "#a78bfa"],
                  ["🔢 Engine",       cacheStats.version,                     "#fbbf24"],
                ].map(([lbl, val, col]) => (
                  <div key={lbl} style={s.card}>
                    <div style={{ color: "#475569", fontSize: 9, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", marginBottom: 4 }}>{lbl}</div>
                    <div style={{ color: col, fontSize: 15, fontWeight: 800, fontFamily: "monospace" }}>{val}</div>
                  </div>
                ))}
              </div>

              <div style={{
                ...s.card, marginBottom: 12,
                background: isOnline ? "rgba(34,197,94,0.05)" : "rgba(239,68,68,0.07)",
                borderColor: isOnline ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.25)",
              }}>
                <div style={{ color: isOnline ? "#4ade80" : "#f87171", fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                  {isOnline ? "✅ Online" : "📴 Offline Mode Active"}
                </div>
                <div style={{ color: "#475569", fontSize: 11 }}>
                  {isOnline
                    ? "Browsed tiles are automatically saved to IndexedDB for offline use."
                    : `Showing ${cacheStats.tileCount} cached tiles. Connect to download more.`}
                </div>
              </div>

              <button
                onClick={fetchCacheStats}
                style={{ width: "100%", padding: "9px", borderRadius: 8, marginBottom: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
              >
                🔄 Refresh Stats
              </button>

              {!clearConfirm ? (
                <button
                  onClick={() => setClearConfirm(true)}
                  style={{ width: "100%", padding: "9px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.07)", color: "#f87171", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
                >
                  🗑 Clear Tile Cache ({cacheStats.estimatedMB} MB)
                </button>
              ) : (
                <div style={{ ...s.card, borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)" }}>
                  <div style={{ color: "#f87171", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                    Delete all {cacheStats.tileCount.toLocaleString()} tiles?
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => { clearTileCache(); setClearConfirm(false); }}
                      style={{ flex: 1, padding: "8px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#dc2626,#ef4444)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                    >Yes, clear</button>
                    <button
                      onClick={() => setClearConfirm(false)}
                      style={{ flex: 1, padding: "8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                    >Cancel</button>
                  </div>
                </div>
              )}
            </>) : (
              <div style={{ textAlign: "center", padding: "28px 0", color: "#334155", fontSize: 12 }}>
                {swReady ? "Loading stats…" : swError ? "Storage unavailable — see above." : "Initialising storage…"}
              </div>
            )}
          </>)}

        </div>
      </div>
    </>
  );
}