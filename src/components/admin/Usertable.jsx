// components/admin/UserTable.jsx
import { useState } from "react";
import { toggleUser, changeRole, deleteUser } from "../../services/adminApi";

function RoleBadge({ role }) {
  const isAdmin = role === "ADMIN";
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: ".06em", padding: "3px 8px", borderRadius: 6,
      color:       isAdmin ? "#c4b5fd" : "rgba(255,255,255,0.4)",
      background:  isAdmin ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.06)",
      border:      isAdmin ? "1px solid rgba(167,139,250,0.3)" : "1px solid rgba(255,255,255,0.1)",
    }}>
      {role}
    </span>
  );
}

function StatusBadge({ enabled }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: ".06em", padding: "3px 8px", borderRadius: 6,
      color:      enabled ? "#4ade80" : "#f87171",
      background: enabled ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)",
      border:     enabled ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(248,113,113,0.25)",
    }}>
      {enabled ? "Active" : "Disabled"}
    </span>
  );
}

const ActionBtn = ({ onClick, color, title, children, disabled }) => (
  <button
    title={title}
    disabled={disabled}
    onClick={onClick}
    style={{
      padding: "5px 10px", borderRadius: 7, border: `1px solid ${color}30`,
      background: `${color}0e`, color, fontSize: 11, fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      transition: "all .14s", fontFamily: "'DM Sans', sans-serif",
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${color}22`; }}
    onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = `${color}0e`; }}
  >
    {children}
  </button>
);

export default function UserTable({ users, onRefresh }) {
  const [loading, setLoading] = useState({});

  const withLoading = async (id, key, fn) => {
    setLoading(p => ({ ...p, [`${id}-${key}`]: true }));
    try { await fn(); await onRefresh(); }
    catch (e) { console.error(e); }
    finally { setLoading(p => ({ ...p, [`${id}-${key}`]: false })); }
  };

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
            {["Username", "Email", "Role", "Status", "Joined", "Actions"].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr>
              <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "36px 0" }}>
                No users found
              </td>
            </tr>
          )}
          {users.map(u => (
            <tr key={u.id}
              style={{ transition: "background .12s" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <td style={{ ...tdStyle, fontWeight: 600 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "rgba(74,158,255,0.14)", border: "1px solid rgba(74,158,255,0.22)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: "#4a9eff", flexShrink: 0,
                  }}>
                    {u.username?.[0]?.toUpperCase() || "?"}
                  </div>
                  {u.username}
                </div>
              </td>
              <td style={{ ...tdStyle, color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{u.email}</td>
              <td style={tdStyle}><RoleBadge role={u.role} /></td>
              <td style={tdStyle}><StatusBadge enabled={u.enabled ?? u.active ?? true} /></td>
              <td style={{ ...tdStyle, color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
                {u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
              </td>
              <td style={tdStyle}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {/* Toggle enable/disable */}
                  <ActionBtn
                    color={(u.enabled ?? u.active ?? true) ? "#f87171" : "#4ade80"}
                    disabled={loading[`${u.id}-toggle`]}
                    onClick={() => withLoading(u.id, "toggle", () => toggleUser(u.id))}
                  >
                    {loading[`${u.id}-toggle`] ? "…" : (u.enabled ?? u.active ?? true) ? "Disable" : "Enable"}
                  </ActionBtn>

                  {/* Change role */}
                  <ActionBtn
                    color="#c4b5fd"
                    disabled={loading[`${u.id}-role`]}
                    onClick={() => withLoading(u.id, "role", () => changeRole(u.id, u.role === "ADMIN" ? "USER" : "ADMIN"))}
                  >
                    {loading[`${u.id}-role`] ? "…" : `→ ${u.role === "ADMIN" ? "USER" : "ADMIN"}`}
                  </ActionBtn>

                  {/* Delete */}
                  <ActionBtn
                    color="#f87171"
                    disabled={loading[`${u.id}-delete`]}
                    onClick={() => {
                      if (window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) {
                        withLoading(u.id, "delete", () => deleteUser(u.id));
                      }
                    }}
                  >
                    {loading[`${u.id}-delete`] ? "…" : "Delete"}
                  </ActionBtn>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}