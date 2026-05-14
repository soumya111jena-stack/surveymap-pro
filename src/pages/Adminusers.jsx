import { useEffect, useState, useMemo } from "react";
import useAdminAuth from "../hooks/useAdminAuth";
import { getUsers } from "../services/adminApi";
import { BASE_URL } from "../services/apiConfig";
import UserTable from "../components/admin/UserTable";

const api = async (path, opts = {}) => {
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("accessToken") || ""}`,
    },
    ...opts,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
  return j;
};

function CreateUserModal({ onClose, onCreated }) {
  const [form,    setForm]    = useState({ username:"", email:"", password:"", role:"USER" });
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.username || !form.email || !form.password) {
      setError("All fields are required."); return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters."); return;
    }
    setLoading(true);
    try {
      const user = await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      onCreated(user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inp = {
    width: "100%", padding: "10px 13px", borderRadius: 8,
    border: "1px solid rgba(74,158,255,0.25)",
    background: "rgba(74,158,255,0.05)",
    color: "#c8e0f8", fontSize: 13, outline: "none",
    fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box",
    marginBottom: 12,
  };

  const lbl = (t) => (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
      color: "rgba(255,255,255,.3)", textTransform: "uppercase", marginBottom: 5 }}>{t}</div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "rgba(5,12,24,0.98)", borderRadius: 16, padding: 28,
        width: "100%", maxWidth: 400,
        border: "1px solid rgba(74,158,255,0.2)",
        boxShadow: "0 24px 72px rgba(0,0,0,0.8)",
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#c8e0f8" }}>Create New User</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.3)", marginTop: 2 }}>User can login and record tracks</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"rgba(255,255,255,.4)", fontSize:20, cursor:"pointer", padding:4 }}>×</button>
        </div>

        {error && (
          <div style={{ padding:"9px 13px", marginBottom:14, borderRadius:8,
            background:"rgba(239,68,68,.09)", border:"1px solid rgba(239,68,68,.25)",
            fontSize:12, color:"#f87171" }}>{error}</div>
        )}

        <form onSubmit={submit}>
          {lbl("Username")}
          <input style={inp} placeholder="e.g. john_field" value={form.username}
            onChange={e => set("username", e.target.value)} autoFocus/>

          {lbl("Email")}
          <input style={inp} type="email" placeholder="user@example.com" value={form.email}
            onChange={e => set("email", e.target.value)}/>

          {lbl("Password")}
          <input style={inp} type="password" placeholder="Min 6 characters" value={form.password}
            onChange={e => set("password", e.target.value)}/>

          {lbl("Role")}
          <select value={form.role} onChange={e => set("role", e.target.value)}
            style={{ ...inp, marginBottom: 20, cursor: "pointer" }}>
            <option value="USER">USER — Can record tracks</option>
            <option value="ADMIN">ADMIN — Full access</option>
          </select>

          <div style={{ display:"flex", gap:8 }}>
            <button type="submit" disabled={loading} style={{
              flex: 2, padding: "11px 0", borderRadius: 9, border: "none",
              background: "linear-gradient(135deg,#1a6fd4,#0d47a1)",
              color: "#fff", fontWeight: 700, fontSize: 13, cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1, fontFamily: "'DM Sans', sans-serif",
            }}>{loading ? "Creating…" : "✓ Create User"}</button>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: "11px 0", borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent", color: "rgba(255,255,255,.4)",
              fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            }}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminUsers() {
  useAdminAuth();
  const [data,       setData]       = useState({ content:[], totalPages:1, totalElements:0 });
  const [page,       setPage]       = useState(0);
  const [search,     setSearch]     = useState("");
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [toast,      setToast]      = useState(null);

  const showToast = (msg, color = "#4ade80") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchUsers = async (p = page) => {
    setLoading(true);
    try {
      const res = await getUsers(p);
      if (Array.isArray(res)) setData({ content: res, totalPages: 1, totalElements: res.length });
      else setData(res);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(page); }, [page]);

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
    padding: "6px 14px", borderRadius: 7, border: "1px solid",
    borderColor: active ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.1)",
    background:  active ? "rgba(74,158,255,0.14)" : "transparent",
    color:       active ? "#4a9eff" : "rgba(255,255,255,0.35)",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
  });

  return (
    <div style={{ fontFamily:"'DM Sans', sans-serif", color:"#c8e0f8" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", top:20, right:20, zIndex:9999,
          padding:"10px 18px", borderRadius:10,
          background:`${toast.color}18`, border:`1px solid ${toast.color}44`,
          color:toast.color, fontSize:13, fontWeight:600,
          boxShadow:"0 8px 24px rgba(0,0,0,0.5)",
        }}>{toast.msg}</div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(u) => {
            showToast(`✓ User "${u.username}" created successfully`);
            fetchUsers(page);
          }}
        />
      )}

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:22, flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:"#c8e0f8", margin:0 }}>Users</h1>
          <p style={{ fontSize:13, color:"rgba(255,255,255,0.35)", marginTop:4 }}>
            {data.totalElements ?? data.content?.length ?? 0} total users
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{
          display:"flex", alignItems:"center", gap:7,
          padding:"9px 18px", borderRadius:9,
          background:"linear-gradient(135deg,rgba(74,158,255,0.22),rgba(37,99,235,0.22))",
          border:"1px solid rgba(74,158,255,0.4)",
          color:"#80c4ff", fontSize:13, fontWeight:700,
          cursor:"pointer", fontFamily:"'DM Sans', sans-serif",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Create User
        </button>
      </div>

      {/* Search */}
      <div style={{ position:"relative", marginBottom:18, maxWidth:340 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"rgba(255,255,255,0.3)", pointerEvents:"none" }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by username or email…"
          style={{
            width:"100%", padding:"9px 12px 9px 34px", borderRadius:9,
            border:"1px solid rgba(255,255,255,0.1)",
            background:"rgba(255,255,255,0.04)",
            color:"#c8e0f8", fontSize:13, outline:"none",
            fontFamily:"'DM Sans', sans-serif", boxSizing:"border-box",
          }}
          onFocus={e => e.target.style.borderColor="rgba(74,158,255,0.45)"}
          onBlur={e  => e.target.style.borderColor="rgba(255,255,255,0.1)"}
        />
      </div>

      {/* Table */}
      <div style={{
        background:"rgba(255,255,255,0.03)",
        border:"1px solid rgba(255,255,255,0.07)",
        borderRadius:14, overflow:"hidden",
      }}>
        {loading ? (
          <div style={{ padding:"48px 0", textAlign:"center", color:"rgba(255,255,255,0.25)", fontSize:13 }}>
            Loading users…
          </div>
        ) : (
          <UserTable users={filtered} onRefresh={() => fetchUsers(page)} />
        )}
      </div>

      {/* Pagination */}
      {(data.totalPages ?? 1) > 1 && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginTop:20 }}>
          <button disabled={page===0} onClick={() => setPage(p => Math.max(0,p-1))} style={btnStyle(false)}>← Prev</button>
          {Array.from({ length: data.totalPages ?? 1 }, (_,i) => (
            <button key={i} onClick={() => setPage(i)} style={btnStyle(i===page)}>{i+1}</button>
          ))}
          <button disabled={page>=(data.totalPages??1)-1} onClick={() => setPage(p => Math.min((data.totalPages??1)-1,p+1))} style={btnStyle(false)}>Next →</button>
        </div>
      )}
    </div>
  );
}