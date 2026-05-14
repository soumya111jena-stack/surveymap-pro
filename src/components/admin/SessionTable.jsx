// components/admin/SessionTable.jsx

function StatusBadge({ status }) {
  const map = {
    ACTIVE:    { color: "#4ade80", bg: "rgba(34,197,94,0.12)",    border: "rgba(34,197,94,0.3)" },
    PAUSED:    { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",   border: "rgba(251,191,36,0.3)" },
    COMPLETED: { color: "#80c4ff", bg: "rgba(74,158,255,0.12)",   border: "rgba(74,158,255,0.3)" },
  };
  const s = map[status] || { color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
      padding: "3px 8px", borderRadius: 6,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
    }}>
      {status}
    </span>
  );
}

export default function SessionTable({ sessions }) {
  const thStyle = {
    padding: "10px 14px", textAlign: "left",
    fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
    color: "rgba(255,255,255,0.35)", textTransform: "uppercase",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    fontFamily: "'DM Sans', sans-serif",
  };
  const tdStyle = {
    padding: "12px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    fontSize: 13, color: "#c8e0f8",
    fontFamily: "'DM Sans', sans-serif",
    verticalAlign: "middle",
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.02)" }}>
            {["Session Name", "Owner", "Status", "Created"].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.length === 0 && (
            <tr>
              <td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "36px 0" }}>
                No sessions found
              </td>
            </tr>
          )}
          {sessions.map((s, i) => (
            <tr key={s.id ?? i}
              style={{ transition: "background .12s" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <td style={{ ...tdStyle, fontWeight: 600 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                    background: s.status === "ACTIVE" ? "#4ade80" : s.status === "PAUSED" ? "#fbbf24" : "#80c4ff",
                    boxShadow: s.status === "ACTIVE" ? "0 0 6px #4ade80" : "none",
                  }}/>
                  {s.name || s.sessionName || `Session #${i + 1}`}
                </div>
              </td>
              <td style={{ ...tdStyle, color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
                {s.ownerEmail || s.owner || "—"}
              </td>
              <td style={tdStyle}><StatusBadge status={s.status} /></td>
              <td style={{ ...tdStyle, color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
                {s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}