// pages/AdminDashboard.jsx
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import useAdminAuth from "../hooks/useAdminAuth";
import { getAnalytics, getSessions } from "../services/adminApi";
import StatCard from "../components/admin/StatCard";

// Build last-7-days labels for the chart (mock distribution using totalSessions)
function buildChartData(analytics) {
  if (!analytics) return [];
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      sessions: i === 0
        ? (analytics.newSessionsThisWeek ?? 0)
        : Math.max(0, Math.round(((analytics.totalSessions ?? 0) / 7) * (0.6 + Math.random() * 0.8))),
    });
  }
  return days;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(4,10,22,0.97)", border: "1px solid rgba(74,158,255,0.25)",
      borderRadius: 9, padding: "9px 14px", fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#4a9eff" }}>{payload[0].value}</div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>sessions</div>
    </div>
  );
};

export default function AdminDashboard() {
  useAdminAuth();
  const [analytics, setAnalytics] = useState(null);
  const [sessions,  setSessions]  = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([getAnalytics(), getSessions("", 0)])
      .then(([a, s]) => {
        setAnalytics(a);
        const list = s.content ?? s.sessions ?? s ?? [];
        setSessions(Array.isArray(list) ? list.slice(0, 10) : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const chartData = buildChartData(analytics);

  const sectionTitle = (text) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 14 }}>
      {text}
    </div>
  );

  const statusBadge = (status) => {
    const map = {
      ACTIVE:    { color: "#4ade80", bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.3)" },
      PAUSED:    { color: "#fbbf24", bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.3)" },
      COMPLETED: { color: "#80c4ff", bg: "rgba(74,158,255,0.12)", border: "rgba(74,158,255,0.3)" },
    };
    const s = map[status] || { color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.1)" };
    return (
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", padding: "3px 8px", borderRadius: 6, color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
        {status}
      </span>
    );
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#c8e0f8" }}>

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#c8e0f8", margin: 0, letterSpacing: "-.01em" }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>Overview of platform activity</p>
      </div>

      {loading ? (
        <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", paddingTop: 60, fontSize: 13 }}>Loading analytics…</div>
      ) : (
        <>
          {/* ── STAT CARDS ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(195px, 1fr))", gap: 14, marginBottom: 28 }}>
            <StatCard
              label="Total Users"
              value={analytics?.totalUsers}
              sub={`+${analytics?.newUsersThisWeek ?? 0} this week`}
              accent="#4a9eff"
              icon="👥"
            />
            <StatCard
              label="Total Sessions"
              value={analytics?.totalSessions}
              sub={`+${analytics?.newSessionsThisWeek ?? 0} this week`}
              accent="#c4b5fd"
              icon="📍"
            />
            <StatCard
              label="Active Sessions"
              value={analytics?.activeSessions}
              sub={`${analytics?.completedSessions ?? 0} completed`}
              accent="#4ade80"
              icon="🟢"
            />
            <StatCard
              label="Total Distance"
              value={analytics?.totalDistanceKm != null ? `${analytics.totalDistanceKm.toFixed(1)} km` : null}
              sub={`${analytics?.totalTracksRecorded ?? 0} tracks recorded`}
              accent="#fbbf24"
              icon="📏"
            />
          </div>

          {/* ── CHART ── */}
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14, padding: "22px 22px 14px",
            marginBottom: 28,
          }}>
            {sectionTitle("Sessions — Last 7 Days")}
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barCategoryGap="40%">
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10, fontFamily: "'DM Sans', sans-serif" }}
                  axisLine={false} tickLine={false} width={30}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(74,158,255,0.06)" }} />
                <Bar dataKey="sessions" fill="#4a9eff" radius={[5, 5, 0, 0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── RECENT SESSIONS ── */}
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14, padding: "22px",
          }}>
            {sectionTitle("Recent Sessions")}
            {sessions.length === 0 ? (
              <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No sessions yet</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Session", "Owner", "Status", "Date"].map(h => (
                      <th key={h} style={{
                        padding: "8px 12px", textAlign: "left",
                        fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
                        color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s, i) => (
                    <tr key={s.id ?? i}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      style={{ transition: "background .12s" }}
                    >
                      <td style={{ padding: "11px 12px", fontSize: 13, fontWeight: 600, color: "#c8e0f8", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        {s.name || s.sessionName || `Session #${i + 1}`}
                      </td>
                      <td style={{ padding: "11px 12px", fontSize: 12, color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        {s.ownerEmail || s.owner || "—"}
                      </td>
                      <td style={{ padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        {statusBadge(s.status)}
                      </td>
                      <td style={{ padding: "11px 12px", fontSize: 11, color: "rgba(255,255,255,0.35)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        {s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}