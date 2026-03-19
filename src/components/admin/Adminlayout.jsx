// components/admin/AdminLayout.jsx
import { NavLink, Outlet, useNavigate } from "react-router-dom";

const NAV = [
  {
    to: "/admin",
    end: true,
    label: "Dashboard",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    to: "/admin/users",
    label: "Users",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    to: "/admin/sessions",
    label: "Sessions",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
];

export default function AdminLayout() {
  const navigate  = useNavigate();
  const username  = localStorage.getItem("username") || "Admin";

  function handleLogout() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    localStorage.removeItem("email");
    navigate("/login", { replace: true });
  }

  const linkBase = {
    display: "flex", alignItems: "center", gap: 10,
    padding: "9px 12px", borderRadius: 8,
    fontSize: 13, fontWeight: 500,
    textDecoration: "none",
    transition: "all .15s",
    fontFamily: "'DM Sans', sans-serif",
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#060e1a", color: "#c8e0f8", fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── SIDEBAR ── */}
      <aside style={{
        width: 220, flexShrink: 0,
        background: "rgba(4,10,22,0.99)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex", flexDirection: "column",
        padding: "0 12px",
      }}>

        {/* Logo */}
        <div style={{
          display: "flex", alignItems: "center", gap: 9,
          padding: "20px 8px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          marginBottom: 10,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: "linear-gradient(135deg,#1a3a6e,#0d5a9e)",
            border: "1px solid rgba(74,158,255,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14,
          }}>🧭</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#c8e0f8", lineHeight: 1.2 }}>SurveyMap</div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".12em", color: "#4a9eff", lineHeight: 1 }}>PRO · ADMIN</div>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map(({ to, end, label, icon }) => (
            <NavLink key={to} to={to} end={end}
              style={({ isActive }) => ({
                ...linkBase,
                background: isActive ? "rgba(74,158,255,0.13)" : "transparent",
                color:      isActive ? "#4a9eff" : "rgba(255,255,255,0.45)",
                borderLeft: isActive ? "2px solid #4a9eff" : "2px solid transparent",
              })}
              onMouseEnter={e => { if (!e.currentTarget.classList.contains("active")) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}}
              onMouseLeave={e => { if (!e.currentTarget.style.borderLeftColor.includes("74,158,255")) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.45)"; }}}
            >
              {icon}
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User + logout */}
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "14px 8px 16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              background: "rgba(74,158,255,0.18)",
              border: "1px solid rgba(74,158,255,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, color: "#4a9eff", flexShrink: 0,
            }}>
              {username[0]?.toUpperCase() || "A"}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#c8e0f8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{username}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Administrator</div>
            </div>
          </div>
          <button onClick={handleLogout} style={{
            width: "100%", padding: "8px 12px", borderRadius: 8,
            border: "1px solid rgba(248,113,113,0.2)",
            background: "rgba(248,113,113,0.06)",
            color: "#f87171", fontSize: 12, fontWeight: 600,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "all .15s", fontFamily: "'DM Sans', sans-serif",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(248,113,113,0.12)"; e.currentTarget.style.borderColor = "rgba(248,113,113,0.4)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(248,113,113,0.06)"; e.currentTarget.style.borderColor = "rgba(248,113,113,0.2)"; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <header style={{
          height: 52, flexShrink: 0,
          background: "rgba(4,10,22,0.85)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", padding: "0 24px",
          gap: 10,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#4ade80",
            boxShadow: "0 0 8px #4ade80",
          }}/>
          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: ".06em" }}>
            ADMIN CONSOLE
          </span>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
            {new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: "auto", padding: "28px 28px" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}