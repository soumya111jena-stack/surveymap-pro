// components/admin/StatCard.jsx
export default function StatCard({ label, value, sub, icon, accent = "#4a9eff" }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12,
      padding: "20px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      position: "relative",
      overflow: "hidden",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* glow blob */}
      <div style={{
        position: "absolute", top: -30, right: -20,
        width: 90, height: 90, borderRadius: "50%",
        background: accent,
        opacity: 0.06,
        filter: "blur(24px)",
        pointerEvents: "none",
      }}/>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "rgba(255,255,255,0.38)", textTransform: "uppercase" }}>
          {label}
        </span>
        {icon && (
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${accent}18`,
            border: `1px solid ${accent}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: accent, fontSize: 15,
          }}>
            {icon}
          </div>
        )}
      </div>

      <div style={{ fontSize: 30, fontWeight: 700, color: "#c8e0f8", lineHeight: 1.1, letterSpacing: "-.02em" }}>
        {value ?? <span style={{ opacity: 0.3 }}>—</span>}
      </div>

      {sub && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: -4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}