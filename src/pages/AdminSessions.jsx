// pages/AdminSessions.jsx
import { useEffect, useState } from "react";
import useAdminAuth from "../hooks/useAdminAuth";
import { getSessions } from "../services/adminApi";
import SessionTable from "../components/admin/SessionTable";

const STATUS_TABS = ["ALL", "ACTIVE", "PAUSED", "COMPLETED"];

export default function AdminSessions() {
  useAdminAuth();
  const [data,    setData]    = useState({ content: [], totalPages: 1, totalElements: 0 });
  const [page,    setPage]    = useState(0);
  const [status,  setStatus]  = useState("ALL");
  const [loading, setLoading] = useState(true);

  const fetchSessions = async (s = status, p = page) => {
    setLoading(true);
    try {
      const res = await getSessions(s === "ALL" ? "" : s, p);
      if (Array.isArray(res)) {
        setData({ content: res, totalPages: 1, totalElements: res.length });
      } else {
        setData(res);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchSessions(status, page); }, [status, page]); // eslint-disable-line

  function changeTab(tab) {
    setStatus(tab);
    setPage(0);
  }

  const tabStyle = (active) => ({
    padding: "7px 16px", borderRadius: 8, border: "1px solid",
    borderColor: active ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.08)",
    background:  active ? "rgba(74,158,255,0.13)" : "transparent",
    color:       active ? "#4a9eff" : "rgba(255,255,255,0.38)",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif", transition: "all .14s",
    letterSpacing: ".04em",
  });

  const btnStyle = (disabled) => ({
    padding: "5px 14px", borderRadius: 7,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent",
    color: disabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.5)",
    fontSize: 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'DM Sans', sans-serif", transition: "all .14s",
  });

  const sessions = data.content ?? [];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#c8e0f8" }}>

      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#c8e0f8", margin: 0, letterSpacing: "-.01em" }}>Sessions</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
          {data.totalElements ?? sessions.length} sessions
          {status !== "ALL" && ` · ${status}`}
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {STATUS_TABS.map(tab => (
          <button key={tab} onClick={() => changeTab(tab)} style={tabStyle(status === tab)}>
            {tab}
          </button>
        ))}
      </div>

      {/* Table card */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14, overflow: "hidden",
        marginBottom: 18,
      }}>
        {loading ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
            Loading sessions…
          </div>
        ) : (
          <SessionTable sessions={sessions} />
        )}
      </div>

      {/* Pagination */}
      {(data.totalPages ?? 1) > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <button
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            style={btnStyle(page === 0)}
          >← Prev</button>

          {Array.from({ length: data.totalPages ?? 1 }, (_, i) => (
            <button key={i} onClick={() => setPage(i)}
              style={{
                ...btnStyle(false),
                background:  i === page ? "rgba(74,158,255,0.13)" : "transparent",
                color:       i === page ? "#4a9eff" : "rgba(255,255,255,0.38)",
                borderColor: i === page ? "rgba(74,158,255,0.35)" : "rgba(255,255,255,0.1)",
              }}>
              {i + 1}
            </button>
          ))}

          <button
            disabled={page >= (data.totalPages ?? 1) - 1}
            onClick={() => setPage(p => Math.min((data.totalPages ?? 1) - 1, p + 1))}
            style={btnStyle(page >= (data.totalPages ?? 1) - 1)}
          >Next →</button>
        </div>
      )}
    </div>
  );
}