// pages/AdminUsers.jsx
import { useEffect, useState, useMemo } from "react";
import useAdminAuth from "../hooks/useAdminAuth";
import { getUsers } from "../services/adminApi";
import UserTable from "../components/admin/UserTable";

export default function AdminUsers() {
  useAdminAuth();
  const [data,    setData]    = useState({ content: [], totalPages: 1, totalElements: 0 });
  const [page,    setPage]    = useState(0);
  const [search,  setSearch]  = useState("");
  const [loading, setLoading] = useState(true);

  const fetchUsers = async (p = page) => {
    setLoading(true);
    try {
      const res = await getUsers(p);
      // Spring Page response: { content, totalPages, totalElements, number }
      // or flat array
      if (Array.isArray(res)) {
        setData({ content: res, totalPages: 1, totalElements: res.length });
      } else {
        setData(res);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(page); }, [page]); // eslint-disable-line

  const filtered = useMemo(() => {
    const list = data.content ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(u =>
      (u.username || "").toLowerCase().includes(q) ||
      (u.email    || "").toLowerCase().includes(q)
    );
  }, [data.content, search]);

  const btnStyle = (active) => ({
    padding: "5px 12px", borderRadius: 7, border: "1px solid",
    borderColor: active ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.1)",
    background:  active ? "rgba(74,158,255,0.14)" : "transparent",
    color:       active ? "#4a9eff" : "rgba(255,255,255,0.35)",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif", transition: "all .14s",
  });

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#c8e0f8" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#c8e0f8", margin: 0, letterSpacing: "-.01em" }}>Users</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
            {data.totalElements ?? data.content?.length ?? 0} total users
          </p>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 18, maxWidth: 340 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by username or email…"
          style={{
            width: "100%", padding: "9px 12px 9px 34px", borderRadius: 9,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "#c8e0f8", fontSize: 13, outline: "none",
            fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box",
            transition: "border-color .15s",
          }}
          onFocus={e => e.target.style.borderColor = "rgba(74,158,255,0.45)"}
          onBlur={e  => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
        />
      </div>

      {/* Table card */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14, overflow: "hidden",
      }}>
        {loading ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
            Loading users…
          </div>
        ) : (
          <UserTable users={filtered} onRefresh={() => fetchUsers(page)} />
        )}
      </div>

      {/* Pagination */}
      {(data.totalPages ?? 1) > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20 }}>
          <button
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            style={btnStyle(false)}
          >← Prev</button>

          {Array.from({ length: data.totalPages ?? 1 }, (_, i) => (
            <button key={i} onClick={() => setPage(i)} style={btnStyle(i === page)}>
              {i + 1}
            </button>
          ))}

          <button
            disabled={page >= (data.totalPages ?? 1) - 1}
            onClick={() => setPage(p => Math.min((data.totalPages ?? 1) - 1, p + 1))}
            style={btnStyle(false)}
          >Next →</button>
        </div>
      )}
    </div>
  );
}