import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If already logged in → redirect to admin (inside useEffect, not render)
  useEffect(() => {
    const token = localStorage.getItem("adminToken") || sessionStorage.getItem("adminToken");
    if (token) navigate("/admin", { replace: true });
  }, [navigate]);

  const handleLogin = (e) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Enter email and password."); return; }
    setLoading(true);
    // TODO: replace with your real API call
    setTimeout(() => {
      localStorage.setItem("adminToken", "token-" + Date.now());
      setLoading(false);
      navigate("/admin", { replace: true });
    }, 500);
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#060e1a",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{
        width: "100%", maxWidth: 380,
        margin: "0 16px",
        padding: 36,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(74,158,255,0.2)",
        borderRadius: 18,
        boxShadow: "0 24px 72px rgba(0,0,0,0.8)",
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "linear-gradient(135deg,#4a9eff,#2563eb)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px",
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#fff" stroke="none"/>
            </svg>
          </div>
          <div style={{ color: "#c8e0f8", fontWeight: 800, fontSize: 22 }}>SurveyMap Pro</div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, marginTop: 4 }}>Admin Login</div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin}>
          {error && (
            <div style={{
              color: "#f87171", fontSize: 12,
              padding: "10px 14px", marginBottom: 16,
              background: "rgba(239,68,68,0.09)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 8,
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={{
              display: "block", marginBottom: 6,
              color: "rgba(200,225,255,0.45)", fontSize: 11,
              fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              autoFocus
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 9,
                border: "1px solid rgba(74,158,255,0.22)",
                background: "rgba(74,158,255,0.06)",
                color: "#c8e0f8", fontSize: 13, outline: "none",
                fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: "block", marginBottom: 6,
              color: "rgba(200,225,255,0.45)", fontSize: 11,
              fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 9,
                border: "1px solid rgba(74,158,255,0.22)",
                background: "rgba(74,158,255,0.06)",
                color: "#c8e0f8", fontSize: 13, outline: "none",
                fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "13px 0", borderRadius: 10,
              border: "none",
              background: loading
                ? "rgba(37,99,235,0.5)"
                : "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color: "#fff", fontWeight: 800, fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit", transition: "opacity 0.2s",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        {/* Back to map — uses navigate, never causes redirect loop */}
        <button
          onClick={() => navigate("/")}
          style={{
            display: "block", width: "100%", marginTop: 18,
            padding: "10px 0",
            background: "none", border: "none",
            color: "rgba(74,158,255,0.7)", fontSize: 13,
            fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          ← Back to Map
        </button>

      </div>
    </div>
  );
}