/**
 * OfflineStatusBadge.jsx  –  src/component/map/OfflineStatusBadge.jsx
 *
 * ✅ No Service Worker references
 * ✅ swReady = dbReady, swError = dbError (from useOfflineMap)
 * ✅ Drop-in replacement — same props as before
 */

export default function OfflineStatusBadge({
  isOnline,
  swReady,           // = dbReady from useOfflineMap
  swError,           // = dbError from useOfflineMap
  precaching,
  precacheProgress,
  cacheStats,
  onClick,
}) {
  const pct = precacheProgress?.progress ?? 0;
  const ff  = "'DM Sans',system-ui,sans-serif";

  // ── Downloading in progress ──────────────────────────────────
  if (precaching) {
    return (
      <div
        onClick={onClick}
        style={{
          position: "absolute", bottom: 36, left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1050, cursor: "pointer", fontFamily: ff,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 14px", minWidth: 210,
          background: "rgba(6,14,26,0.93)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(59,130,246,0.4)",
          borderRadius: 22,
          boxShadow: "0 4px 20px rgba(0,0,0,0.55)",
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#3b82f6", flexShrink: 0,
            animation: "sm-blink .8s infinite",
          }}/>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#60a5fa", fontSize: 10, fontWeight: 700, marginBottom: 3 }}>
              ⬇ Caching tiles… {pct}%
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: `${pct}%`, transition: "width .3s",
                background: "linear-gradient(90deg,#1d4ed8,#3b82f6)",
              }}/>
            </div>
          </div>
          <span style={{ color: "#334155", fontSize: 10 }}>
            {precacheProgress?.cached ?? 0} tiles
          </span>
        </div>
      </div>
    );
  }

  // ── Offline ───────────────────────────────────────────────────
  if (!isOnline) {
    return (
      <div
        onClick={onClick}
        title="Offline – tap to manage cached maps"
        style={{
          position: "absolute", bottom: 36, left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1050, cursor: "pointer", fontFamily: ff,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 14px",
          background: "rgba(6,14,26,0.93)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(239,68,68,0.5)",
          borderRadius: 22,
          boxShadow: "0 4px 20px rgba(0,0,0,0.55), 0 0 14px rgba(239,68,68,0.18)",
        }}>
          <span style={{ fontSize: 14 }}>📴</span>
          <div>
            <div style={{ color: "#f87171", fontSize: 11, fontWeight: 700 }}>Offline Mode</div>
            <div style={{ color: "#475569", fontSize: 9 }}>
              {cacheStats?.tileCount
                ? `${cacheStats.tileCount.toLocaleString()} tiles cached · tap to manage`
                : "No tiles cached · tap to download"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── DB error (still online) — show subtle warning ─────────────
  if (swError) {
    return (
      <div
        onClick={onClick}
        title="Offline storage unavailable – tap for details"
        style={{
          position: "absolute", bottom: 40, right: 110,
          zIndex: 1050, cursor: "pointer", fontFamily: ff,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "4px 9px",
          background: "rgba(6,14,26,0.8)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(251,191,36,0.35)",
          borderRadius: 14,
          boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
        }}>
          <span style={{ fontSize: 11 }}>⚠</span>
          <span style={{ color: "#fbbf24", fontSize: 9, fontWeight: 700 }}>
            Storage unavailable
          </span>
        </div>
      </div>
    );
  }

  // ── Not ready yet ─────────────────────────────────────────────
  if (!swReady) return null;

  // ── Online + ready ────────────────────────────────────────────
  return (
    <div
      onClick={onClick}
      title={`Online · ${cacheStats?.tileCount ?? 0} tiles cached`}
      style={{
        position: "absolute", bottom: 40, right: 110,
        zIndex: 1050, cursor: "pointer", fontFamily: ff,
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 9px",
        background: "rgba(6,14,26,0.8)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(34,197,94,0.22)",
        borderRadius: 14,
        boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#22c55e", boxShadow: "0 0 6px #22c55e",
        }}/>
        <span style={{ color: "#4ade80", fontSize: 9, fontWeight: 700 }}>
          {cacheStats?.tileCount
            ? `${cacheStats.tileCount.toLocaleString()} tiles`
            : "Offline Maps"}
        </span>
      </div>
    </div>
  );
}