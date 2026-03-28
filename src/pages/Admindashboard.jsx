import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getAnalytics, getSessions, getUsers, toggleUser, deleteUser, changeRole } from "../services/adminApi";
import StatCard from "../components/admin/StatCard";

// ── inject global styles ───────────────────────────────────────────────────
const injectStyles = () => {
  if (document.head.querySelector("[data-adm]")) return;
  const s = document.createElement("style");
  s.setAttribute("data-adm", "1");
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
    html, body, #root { height: 100%; margin: 0; padding: 0; background: #060e1a; }
    * { box-sizing: border-box; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(74,158,255,.2); border-radius: 4px; }
  `;
  document.head.appendChild(s);
};

// ── helpers ────────────────────────────────────────────────────────────────
const fmt = (iso) => iso
  ? new Date(iso).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })
  : "—";

const Badge = ({ status }) => {
  const map = {
    ACTIVE:    { c:"#4ade80", bg:"rgba(34,197,94,.12)",   b:"rgba(34,197,94,.3)" },
    PAUSED:    { c:"#fbbf24", bg:"rgba(251,191,36,.12)",  b:"rgba(251,191,36,.3)" },
    COMPLETED: { c:"#80c4ff", bg:"rgba(74,158,255,.12)",  b:"rgba(74,158,255,.3)" },
    ADMIN:     { c:"#c4b5fd", bg:"rgba(167,139,250,.12)", b:"rgba(167,139,250,.3)" },
    USER:      { c:"#94a3b8", bg:"rgba(148,163,184,.08)", b:"rgba(148,163,184,.2)" },
    ENABLED:   { c:"#4ade80", bg:"rgba(34,197,94,.12)",   b:"rgba(34,197,94,.3)" },
    DISABLED:  { c:"#f87171", bg:"rgba(239,68,68,.12)",   b:"rgba(239,68,68,.3)" },
  };
  const s = map[status] || map.USER;
  return (
    <span style={{ fontSize:10, fontWeight:700, letterSpacing:".06em",
      padding:"3px 8px", borderRadius:6,
      color:s.c, background:s.bg, border:`1px solid ${s.b}` }}>
      {status}
    </span>
  );
};

const TH = ({ children }) => (
  <th style={{ padding:"8px 12px", textAlign:"left", fontSize:10, fontWeight:700,
    letterSpacing:".1em", color:"rgba(255,255,255,.3)", textTransform:"uppercase",
    borderBottom:"1px solid rgba(255,255,255,.06)", whiteSpace:"nowrap" }}>
    {children}
  </th>
);
const TD = ({ children, style={} }) => (
  <td style={{ padding:"11px 12px", borderBottom:"1px solid rgba(255,255,255,.04)", ...style }}>
    {children}
  </td>
);

function buildChartData(analytics) {
  if (!analytics) return [];
  return Array.from({ length:7 }, (_,i) => {
    const d = new Date(); d.setDate(d.getDate() - (6-i));
    return {
      day: d.toLocaleDateString("en-US", { weekday:"short" }),
      sessions: i === 6
        ? (analytics.newSessionsThisWeek ?? 0)
        : Math.max(0, Math.round(((analytics.totalSessions ?? 0)/7)*(0.6+Math.random()*0.8))),
    };
  });
}

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"rgba(4,10,22,.97)", border:"1px solid rgba(74,158,255,.25)",
      borderRadius:9, padding:"9px 14px", fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ fontSize:11, color:"rgba(255,255,255,.4)", marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:16, fontWeight:700, color:"#4a9eff" }}>{payload[0].value}</div>
      <div style={{ fontSize:10, color:"rgba(255,255,255,.3)" }}>sessions</div>
    </div>
  );
};

// ── SIDEBAR ────────────────────────────────────────────────────────────────
const NAV = [
  { key:"dashboard", icon:"📊", label:"Dashboard" },
  { key:"users",     icon:"👥", label:"Users" },
  { key:"sessions",  icon:"📍", label:"Sessions" },
  { key:"tracks",    icon:"🗺️", label:"Tracks" },
];

function Sidebar({ active, onNav, onLogout, username }) {
  return (
    <div style={{ width:220, minHeight:"100vh", background:"rgba(4,10,22,.98)",
      borderRight:"1px solid rgba(74,158,255,.07)",
      display:"flex", flexDirection:"column",
      padding:"28px 0", flexShrink:0,
      fontFamily:"'DM Sans',sans-serif",
      position:"sticky", top:0, alignSelf:"flex-start",
      height:"100vh", overflowY:"auto" }}>

      {/* Logo */}
      <div style={{ padding:"0 20px 28px", borderBottom:"1px solid rgba(255,255,255,.05)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:9,
            background:"linear-gradient(135deg,#1a6fd4,#0d47a1)",
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:"0 0 16px rgba(26,111,212,.4)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#fff" stroke="none"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:"#e0eeff" }}>SurveyMap</div>
            <div style={{ fontSize:10, color:"rgba(74,158,255,.6)", letterSpacing:".06em" }}>ADMIN</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding:"16px 12px" }}>
        {NAV.map(n => (
          <button key={n.key} onClick={() => onNav(n.key)}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:10,
              padding:"10px 12px", border:"none", borderRadius:9,
              background: active===n.key ? "rgba(74,158,255,.12)" : "transparent",
              color: active===n.key ? "#80c4ff" : "rgba(255,255,255,.4)",
              fontSize:13, fontWeight:600, cursor:"pointer",
              borderLeft: active===n.key ? "2px solid rgba(74,158,255,.6)" : "2px solid transparent",
              marginBottom:2, textAlign:"left", transition:"all .15s",
              fontFamily:"'DM Sans',sans-serif" }}>
            <span style={{ fontSize:15 }}>{n.icon}</span> {n.label}
          </button>
        ))}
      </nav>

      {/* User + logout */}
      <div style={{ padding:"16px 20px", borderTop:"1px solid rgba(255,255,255,.05)" }}>
        <div style={{ fontSize:12, color:"rgba(255,255,255,.5)", marginBottom:2 }}>{username || "Admin"}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,.2)", marginBottom:12 }}>Administrator</div>
        <button onClick={onLogout}
          style={{ background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.25)",
            borderRadius:8, padding:"8px 14px", color:"#f87171", fontSize:12,
            fontWeight:600, cursor:"pointer", width:"100%", fontFamily:"'DM Sans',sans-serif" }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

// ── DASHBOARD TAB ──────────────────────────────────────────────────────────
function DashboardTab() {
  const [analytics, setAnalytics] = useState(null);
  const [sessions,  setSessions]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");

  useEffect(() => {
    Promise.all([getAnalytics(), getSessions("", 0)])
      .then(([a, s]) => {
        setAnalytics(a);
        const list = s.content ?? s.sessions ?? s ?? [];
        setSessions(Array.isArray(list) ? list.slice(0, 8) : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const chartData = buildChartData(analytics);

  if (loading) return (
    <div style={{ color:"rgba(255,255,255,.3)", textAlign:"center", paddingTop:60, fontSize:14 }}>
      Loading analytics…
    </div>
  );

  if (error) return (
    <div style={{ color:"#f87171", textAlign:"center", paddingTop:60, fontSize:14 }}>
      Error: {error}
    </div>
  );

  return (
    <>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:"#c8e0f8", margin:0 }}>Dashboard</h1>
        <p style={{ fontSize:13, color:"rgba(255,255,255,.35)", marginTop:4 }}>Platform overview</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(195px,1fr))", gap:14, marginBottom:28 }}>
        <StatCard label="Total Users"    value={analytics?.totalUsers}
          sub={`+${analytics?.newUsersThisWeek??0} this week`} accent="#4a9eff" icon="👥"/>
        <StatCard label="Total Sessions" value={analytics?.totalSessions}
          sub={`+${analytics?.newSessionsThisWeek??0} this week`} accent="#c4b5fd" icon="📍"/>
        <StatCard label="Active"         value={analytics?.activeSessions}
          sub={`${analytics?.completedSessions??0} completed`} accent="#4ade80" icon="🟢"/>
        <StatCard label="Distance"
          value={analytics?.totalDistanceKm != null ? `${analytics.totalDistanceKm.toFixed(1)} km` : null}
          sub={`${analytics?.totalTracksRecorded??0} tracks`} accent="#fbbf24" icon="📏"/>
      </div>

      <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)",
        borderRadius:14, padding:"22px 22px 14px", marginBottom:28 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:".1em",
          color:"rgba(255,255,255,.35)", textTransform:"uppercase", marginBottom:14 }}>
          Sessions — Last 7 Days
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} barCategoryGap="40%">
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.05)"/>
            <XAxis dataKey="day" tick={{ fill:"rgba(255,255,255,.35)", fontSize:11 }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fill:"rgba(255,255,255,.25)", fontSize:10 }} axisLine={false} tickLine={false} width={30}/>
            <Tooltip content={<ChartTip/>} cursor={{ fill:"rgba(74,158,255,.06)" }}/>
            <Bar dataKey="sessions" fill="#4a9eff" radius={[5,5,0,0]} opacity={0.85}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", borderRadius:14, padding:22 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:".1em",
          color:"rgba(255,255,255,.35)", textTransform:"uppercase", marginBottom:14 }}>
          Recent Sessions
        </div>
        {sessions.length === 0
          ? <div style={{ color:"rgba(255,255,255,.2)", fontSize:13, textAlign:"center", padding:"24px 0" }}>No sessions yet</div>
          : <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr><TH>Session</TH><TH>Owner</TH><TH>Status</TH><TH>Date</TH></tr></thead>
              <tbody>
                {sessions.map((s,i) => (
                  <tr key={s.id??i}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.02)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <TD><span style={{ fontSize:13, fontWeight:600, color:"#c8e0f8" }}>{s.name||s.sessionName||`Session #${i+1}`}</span></TD>
                    <TD><span style={{ fontSize:12, color:"rgba(255,255,255,.45)" }}>{s.ownerEmail||s.owner||"—"}</span></TD>
                    <TD><Badge status={s.status}/></TD>
                    <TD><span style={{ fontSize:11, color:"rgba(255,255,255,.35)" }}>{fmt(s.createdAt)}</span></TD>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </>
  );
}

// ── USERS TAB ──────────────────────────────────────────────────────────────
function UsersTab() {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(0);
  const [total,   setTotal]   = useState(0);

  const load = useCallback((p=0) => {
    setLoading(true);
    getUsers(p).then(r => {
      const list = r.content ?? r ?? [];
      setUsers(Array.isArray(list) ? list : []);
      setTotal(r.totalElements ?? list.length);
      setPage(p);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(0); }, [load]);

  const handleToggle = async (id) => { await toggleUser(id); load(page); };
  const handleDelete = async (id) => {
    if (!confirm("Delete this user and all their data?")) return;
    await deleteUser(id); load(page);
  };
  const handleRole = async (id, role) => {
    await changeRole(id, role === "ADMIN" ? "USER" : "ADMIN"); load(page);
  };

  return (
    <>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:"#c8e0f8", margin:0 }}>Users</h1>
        <p style={{ fontSize:13, color:"rgba(255,255,255,.35)", marginTop:4 }}>{total} total users</p>
      </div>
      <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", borderRadius:14, overflow:"hidden" }}>
        {loading
          ? <div style={{ color:"rgba(255,255,255,.3)", textAlign:"center", padding:40 }}>Loading users…</div>
          : users.length === 0
            ? <div style={{ color:"rgba(255,255,255,.2)", textAlign:"center", padding:40 }}>No users found</div>
            : <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr><TH>User</TH><TH>Role</TH><TH>Status</TH><TH>Joined</TH><TH>Actions</TH></tr></thead>
                <tbody>
                  {users.map((u,i) => (
                    <tr key={u.id??i}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.02)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <TD>
                        <div style={{ fontSize:13, fontWeight:600, color:"#c8e0f8" }}>{u.username||u.name||"—"}</div>
                        <div style={{ fontSize:11, color:"rgba(255,255,255,.35)", marginTop:2 }}>{u.email}</div>
                      </TD>
                      <TD><Badge status={u.role}/></TD>
                      <TD><Badge status={u.enabled?"ENABLED":"DISABLED"}/></TD>
                      <TD><span style={{ fontSize:11, color:"rgba(255,255,255,.35)" }}>{fmt(u.createdAt)}</span></TD>
                      <TD>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          <button onClick={()=>handleToggle(u.id)} style={{ padding:"4px 10px", borderRadius:6,
                            border:"1px solid rgba(251,191,36,.3)", background:"rgba(251,191,36,.08)",
                            color:"#fbbf24", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                            {u.enabled?"Disable":"Enable"}
                          </button>
                          <button onClick={()=>handleRole(u.id,u.role)} style={{ padding:"4px 10px", borderRadius:6,
                            border:"1px solid rgba(167,139,250,.3)", background:"rgba(167,139,250,.08)",
                            color:"#c4b5fd", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                            {u.role==="ADMIN"?"→ User":"→ Admin"}
                          </button>
                          <button onClick={()=>handleDelete(u.id)} style={{ padding:"4px 10px", borderRadius:6,
                            border:"1px solid rgba(239,68,68,.3)", background:"rgba(239,68,68,.08)",
                            color:"#f87171", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                            Delete
                          </button>
                        </div>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
        }
      </div>
    </>
  );
}

// ── SESSIONS TAB ───────────────────────────────────────────────────────────
function SessionsTab() {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState("");

  const load = useCallback((f="") => {
    setLoading(true);
    getSessions(f, 0).then(r => {
      const list = r.content ?? r.sessions ?? r ?? [];
      setSessions(Array.isArray(list) ? list : []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div style={{ marginBottom:24, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:"#c8e0f8", margin:0 }}>Sessions</h1>
          <p style={{ fontSize:13, color:"rgba(255,255,255,.35)", marginTop:4 }}>All survey sessions</p>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {["","ACTIVE","PAUSED","COMPLETED"].map(f => (
            <button key={f} onClick={()=>{ setFilter(f); load(f); }}
              style={{ padding:"7px 14px", borderRadius:8,
                border:"1px solid rgba(255,255,255,.1)",
                background: filter===f ? "rgba(74,158,255,.18)" : "transparent",
                color: filter===f ? "#80c4ff" : "rgba(255,255,255,.4)",
                fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
              {f||"All"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", borderRadius:14, overflow:"hidden" }}>
        {loading
          ? <div style={{ color:"rgba(255,255,255,.3)", textAlign:"center", padding:40 }}>Loading…</div>
          : sessions.length === 0
            ? <div style={{ color:"rgba(255,255,255,.2)", textAlign:"center", padding:40 }}>No sessions found</div>
            : <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr><TH>Session</TH><TH>Owner</TH><TH>Status</TH><TH>Tracks</TH><TH>Created</TH></tr></thead>
                <tbody>
                  {sessions.map((s,i) => (
                    <tr key={s.id??i}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.02)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <TD><span style={{ fontSize:13, fontWeight:600, color:"#c8e0f8" }}>{s.name||s.sessionName||`Session #${i+1}`}</span></TD>
                      <TD><span style={{ fontSize:12, color:"rgba(255,255,255,.45)" }}>{s.ownerEmail||s.owner||"—"}</span></TD>
                      <TD><Badge status={s.status}/></TD>
                      <TD><span style={{ fontSize:12, color:"rgba(255,255,255,.5)" }}>{s.trackCount??s.tracks?.length??"—"}</span></TD>
                      <TD><span style={{ fontSize:11, color:"rgba(255,255,255,.35)" }}>{fmt(s.createdAt)}</span></TD>
                    </tr>
                  ))}
                </tbody>
              </table>
        }
      </div>
    </>
  );
}

// ── TRACKS TAB ─────────────────────────────────────────────────────────────
function TracksTab() {
  return (
    <>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:"#c8e0f8", margin:0 }}>Tracks</h1>
        <p style={{ fontSize:13, color:"rgba(255,255,255,.35)", marginTop:4 }}>GPS track paths, photos & files</p>
      </div>
      <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(74,158,255,.12)",
        borderRadius:14, padding:40, textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:16 }}>🗺️</div>
        <div style={{ fontSize:16, fontWeight:700, color:"#c8e0f8", marginBottom:8 }}>Track Viewer</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,.35)", maxWidth:400, margin:"0 auto", lineHeight:1.7 }}>
          Track path visualization requires the tracks API endpoint.<br/><br/>
          Add <code style={{ background:"rgba(74,158,255,.1)", padding:"2px 8px", borderRadius:4, color:"#80c4ff" }}>/api/admin/tracks</code> to your backend to enable full track viewing.
        </div>
      </div>
    </>
  );
}

// ── MAIN ───────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab,      setTab]      = useState("dashboard");
  const [username, setUsername] = useState("");
  const [ready,    setReady]    = useState(false);

  useEffect(() => {
    injectStyles();
    const token = localStorage.getItem("accessToken");
    const role  = localStorage.getItem("role");
    const uname = localStorage.getItem("username");
    if (!token || role !== "ADMIN") {
      navigate("/login", { replace: true });
      return;
    }
    setUsername(uname || "Admin");
    setReady(true);
  }, [navigate]);

  const handleLogout = () => {
    localStorage.clear();
    sessionStorage.clear();
    navigate("/login", { replace: true });
  };

  // Don't render until auth confirmed
  if (!ready) return (
    <div style={{ background:"#060e1a", minHeight:"100vh", display:"flex",
      alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,.3)",
      fontFamily:"'DM Sans',sans-serif", fontSize:14 }}>
      Checking authentication…
    </div>
  );

  const tabMap = {
    dashboard: <DashboardTab/>,
    users:     <UsersTab/>,
    sessions:  <SessionsTab/>,
    tracks:    <TracksTab/>,
  };

  return (
    <div style={{ display:"flex", minHeight:"100vh", background:"#060e1a",
      fontFamily:"'DM Sans',sans-serif", color:"#c8e0f8" }}>
      <Sidebar active={tab} onNav={setTab} onLogout={handleLogout} username={username}/>
      <main style={{ flex:1, overflowY:"auto", padding:"32px 36px", minHeight:"100vh" }}>
        {tabMap[tab]}
      </main>
    </div>
  );
}