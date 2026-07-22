import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../services/adminApi";

// ── CSS Variables & Global Styles ─────────────────────────────────────────────
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    :root {
      --bg-base: #080c14;
      --bg-surface: #0d1420;
      --bg-elevated: #111827;
      --border: rgba(255,255,255,0.06);
      --border-accent: rgba(99,179,237,0.2);
      --text-primary: #e8f0fe;
      --text-secondary: rgba(200,220,255,0.55);
      --text-muted: rgba(200,220,255,0.28);
      --accent: #3b82f6;
      --accent-glow: rgba(59,130,246,0.25);
      --accent-soft: rgba(59,130,246,0.1);
      --green: #10b981;
      --green-soft: rgba(16,185,129,0.12);
      --red: #ef4444;
      --red-soft: rgba(239,68,68,0.1);
      --yellow: #f59e0b;
      --purple: #8b5cf6;
      --cyan: #06b6d4;
      --font: 'Outfit', sans-serif;
      --mono: 'JetBrains Mono', monospace;
      --radius: 12px;
      --radius-lg: 18px;
      --radius-sm: 8px;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes scan {
      0%   { transform: translateY(-100%); }
      100% { transform: translateY(100vh); }
    }
    @keyframes pulse-ring {
      0%   { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); }
      70%  { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
      100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .fade-up { animation: fadeUp 0.4s ease both; }
    
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 8px; padding: 12px 20px; border-radius: var(--radius-sm);
      font-family: var(--font); font-size: 14px; font-weight: 600;
      cursor: pointer; border: 1px solid transparent;
      transition: all 0.18s ease; width: 100%;
    }
    .btn:hover:not(:disabled) { transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-primary { 
      background: linear-gradient(135deg, #3b82f6, #1d4ed8); 
      color: #fff; 
      box-shadow: 0 4px 16px rgba(59,130,246,0.3);
    }
    .btn-primary:hover:not(:disabled) { 
      box-shadow: 0 6px 20px rgba(59,130,246,0.4);
      filter: brightness(1.05);
    }
    
    .btn-ghost { 
      background: rgba(255,255,255,0.03); 
      color: var(--text-secondary); 
      border-color: var(--border);
      backdrop-filter: blur(8px);
    }
    .btn-ghost:hover:not(:disabled) { 
      background: rgba(255,255,255,0.06); 
      color: var(--text-primary); 
      border-color: rgba(255,255,255,0.12);
    }

    .input {
      width: 100%; 
      padding: 12px 16px; 
      border-radius: var(--radius-sm);
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      color: var(--text-primary); 
      font-family: var(--mono); 
      font-size: 13.5px;
      outline: none; 
      transition: all 0.18s;
    }
    .input:focus { 
      border-color: rgba(59,130,246,0.5); 
      background: rgba(59,130,246,0.05);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
    }
    .input::placeholder { color: var(--text-muted); }

    .password-field {
      position: relative;
      width: 100%;
    }
    
    .password-field input {
      width: 100%;
      padding: 12px 44px 12px 16px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      color: var(--text-primary);
      font-family: var(--mono);
      font-size: 13.5px;
      outline: none;
      transition: all 0.18s;
    }
    
    .password-field input:focus { 
      border-color: rgba(59,130,246,0.5); 
      background: rgba(59,130,246,0.05);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
    }
    
    .password-field input::placeholder {
      color: var(--text-muted);
    }
    
    .eye-toggle {
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      transition: color 0.18s;
      z-index: 10;
      border-radius: 6px;
    }
    
    .eye-toggle:hover {
      color: var(--text-primary);
      background: rgba(255,255,255,0.05);
    }

    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 100px;
      background: linear-gradient(135deg, #3b82f6, #7c3aed);
      font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
      color: #fff; text-transform: uppercase;
    }

    .feature-item {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 0; animation: fadeUp 0.4s ease both;
    }

    .dot-pulse {
      width: 6px; height: 6px; border-radius: 50%;
      background: #10b981; flex-shrink: 0;
      animation: pulse-ring 1.5s infinite;
    }

    .loading-spinner {
      width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff; border-radius: 50%;
      animation: spin 0.7s linear infinite;
      display: inline-block;
    }
  `}</style>
);

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icons = {
  Logo: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#fff" stroke="none"/>
    </svg>
  ),
  Compass: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
    </svg>
  ),
  Map: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/>
      <line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  ),
  GPS: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>
    </svg>
  ),
  Cloud: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
    </svg>
  ),
  Icon3D: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>
  ),
  Lock: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  Mail: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  ),
  ArrowRight: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Warning: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  EyeOpen: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  EyeClosed: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ),
};

// ── Feature Lists ────────────────────────────────────────────────────────────
const FREE_FEATURES = [
  { icon: <Icons.Compass/>, label: "Digital Compass", color: "var(--text-muted)" },
  { icon: <Icons.Map/>, label: "Basic Maps (2D only)", color: "var(--text-muted)" },
  { icon: <Icons.GPS/>, label: "GPS Tracking (Basic)", color: "var(--text-muted)" },
];

const PRO_FEATURES = [
  { icon: <Icons.Icon3D/>, label: "3D Map Access", color: "var(--accent)" },
  { icon: <Icons.Map/>, label: "Full Offline Maps", color: "var(--accent)" },
  { icon: <Icons.Compass/>, label: "Advanced Survey Tools", color: "var(--accent)" },
  { icon: <Icons.Cloud/>, label: "Cloud Sync & Backup", color: "var(--accent)" },
  { icon: <Icons.GPS/>, label: "Live Track Recording", color: "var(--accent)" },
];

// ── Main Login Component ─────────────────────────────────────────────────────
export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState("Fetching location...");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showPassword, setShowPassword] = useState(false);

  const intent = sessionStorage.getItem("loginIntent") || "";

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setCoords(`${p.coords.latitude.toFixed(4)}°N, ${p.coords.longitude.toFixed(4)}°E`),
        () => setCoords("Location unavailable")
      );
    }
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── FIXED: redirect already-logged-in users based on role ────────────────
  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) {
      navigate(role === "ADMIN" ? "/admin" : "/", { replace: true });
    }
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setLoading(true);
    try {
      const data = await login(email.trim().toLowerCase(), password);
      localStorage.setItem("role",     data.role);
      localStorage.setItem("username", data.username || "");
      localStorage.setItem("email",    data.email || email);

      // ── FIXED: redirect based on role ─────────────────────────────────
      if (data.role === "ADMIN") {
        navigate("/admin", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err.message || "Invalid credentials. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const togglePassword = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowPassword(!showPassword);
  };

  // ── MOBILE VIEW ───────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <GlobalStyles />
        <div style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #080c14 0%, #0a1220 100%)",
          fontFamily: "var(--font)",
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "radial-gradient(rgba(59,130,246,0.08) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            opacity: 0.5,
          }}/>
          
          <div style={{ position: "relative", padding: "32px 24px 20px", textAlign: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 8px 24px rgba(59,130,246,0.3)",
              }}>
                <Icons.Logo/>
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>GeoXis</div>
                <div style={{ fontSize: 10, color: "var(--accent)", fontFamily: "var(--mono)", letterSpacing: "0.08em" }}>FIELD EDITION</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <div className="dot-pulse"/>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-muted)" }}>{coords}</span>
            </div>
          </div>

          {intent === "openTracker" && (
            <div style={{
              margin: "0 20px 16px", padding: "14px 16px", borderRadius: 12,
              background: "var(--red-soft)", border: "1px solid rgba(239,68,68,0.25)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(239,68,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📍</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171" }}>Login Required</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Sign in to start live GPS tracking</div>
              </div>
            </div>
          )}

          <div style={{ position: "relative", padding: "0 20px 20px" }}>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.02em" }}>Welcome Back</h2>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Sign in to unlock Pro features</p>
            </div>

            {error && (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "12px 16px", marginBottom: 20, borderRadius: 10,
                background: "var(--red-soft)", border: "1px solid rgba(239,68,68,0.25)",
                fontSize: 12.5, color: "#fca5a5",
              }}>
                <Icons.Warning/>{error}
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>
                  <Icons.Mail/> Email
                </label>
                <input
                  className="input"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>
                  <Icons.Lock/> Password
                </label>
                <div className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button type="button" className="eye-toggle" onClick={togglePassword}>
                    {showPassword ? <Icons.EyeClosed/> : <Icons.EyeOpen/>}
                  </button>
                </div>
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? <><span className="loading-spinner"/> Signing in...</> : <>🔐 Sign In</>}
              </button>
            </form>

            <div style={{ margin: "20px 0", textAlign: "center", position: "relative" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>or</div>
              <button className="btn btn-ghost" onClick={() => { sessionStorage.removeItem("loginIntent"); navigate("/"); }}>
                🧭 Continue with Free Mode
              </button>
            </div>
          </div>

          <div style={{
            margin: "20px", padding: "20px", borderRadius: 16,
            background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span className="badge">PRO FEATURES</span>
            </div>
            {PRO_FEATURES.map((f, i) => (
              <div key={i} className="feature-item" style={{ animationDelay: `${i * 0.05}s` }}>
                <span style={{ color: f.color }}>{f.icon}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: f.color }}>{f.label}</span>
                <Icons.Check style={{ color: "var(--green)" }}/>
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center", padding: "20px", fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--mono)" }}>
            v2.4.1 · SRPL GEO
          </div>
        </div>
      </>
    );
  }

  // ── DESKTOP VIEW ───────────────────────────────────────────────────────────
  return (
    <>
      <GlobalStyles />
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #080c14 0%, #0a1220 100%)",
        display: "flex",
        fontFamily: "var(--font)",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "radial-gradient(rgba(59,130,246,0.06) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}/>
        
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: "linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent)",
          animation: "scan 3s linear infinite",
        }}/>

        {/* LEFT PANEL - Features */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px 56px",
          position: "relative",
          zIndex: 1,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 48 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16,
              background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 8px 32px rgba(59,130,246,0.35)",
            }}>
              <Icons.Logo/>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>GeoXis</div>
              <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--mono)", letterSpacing: "0.1em", marginTop: 2 }}>FIELD EDITION</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 48 }}>
            <div className="dot-pulse"/>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.05em" }}>{coords}</span>
          </div>

          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 16 }}>
              🔓 Free Mode
            </div>
            {FREE_FEATURES.map((f, i) => (
              <div key={i} className="feature-item" style={{ animationDelay: `${i * 0.05}s` }}>
                <span style={{ color: f.color }}>{f.icon}</span>
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)", fontWeight: 500 }}>{f.label}</span>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: "linear-gradient(90deg, transparent, var(--border), transparent)", marginBottom: 32 }}/>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase" }}>🔐 Pro Mode</span>
              <span className="badge">UNLOCK</span>
            </div>
            {PRO_FEATURES.map((f, i) => (
              <div key={i} className="feature-item" style={{ animationDelay: `${(i + FREE_FEATURES.length) * 0.05}s` }}>
                <span style={{ color: f.color }}>{f.icon}</span>
                <span style={{ flex: 1, fontSize: 13.5, color: f.color, fontWeight: 500 }}>{f.label}</span>
                <div className="dot-pulse" style={{ background: "var(--accent)" }}/>
              </div>
            ))}
          </div>

          <div style={{ position: "absolute", bottom: 32, left: 56, fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--mono)" }}>
            v2.4.1 · SRPL GEO
          </div>
        </div>

        {/* RIGHT PANEL - Login Form */}
        <div style={{
          width: 480,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px 48px",
          position: "relative",
          zIndex: 1,
          background: "rgba(8,12,20,0.6)",
          backdropFilter: "blur(20px)",
          borderLeft: "1px solid var(--border)",
        }}>
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)", marginBottom: 10, letterSpacing: "-0.02em" }}>Welcome Back</h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)" }}>Sign in to unlock Pro features and start tracking</p>
          </div>

          {error && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 18px", marginBottom: 24, borderRadius: 12,
              background: "var(--red-soft)", border: "1px solid rgba(239,68,68,0.25)",
              fontSize: 13, color: "#fca5a5",
            }}>
              <Icons.Warning/>{error}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>
                <Icons.Mail/> Email Address
              </label>
              <input
                className="input"
                type="email"
                placeholder="admin@geoxis.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>
                <Icons.Lock/> Password
              </label>
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button type="button" className="eye-toggle" onClick={togglePassword}>
                  {showPassword ? <Icons.EyeClosed/> : <Icons.EyeOpen/>}
                </button>
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ padding: "14px" }}>
              {loading ? <><span className="loading-spinner"/> Signing in...</> : <>🔐 Sign In to Pro <Icons.ArrowRight/></>}
            </button>
          </form>

          <div style={{ margin: "24px 0", textAlign: "center", position: "relative" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>or continue with</div>
            <button className="btn btn-ghost" onClick={() => { sessionStorage.removeItem("loginIntent"); navigate("/"); }} style={{ padding: "12px" }}>
              🧭 Free Mode (Limited Features)
            </button>
          </div>

          <div style={{
            marginTop: 32,
            padding: "16px 20px",
            borderRadius: 12,
            background: "rgba(59,130,246,0.05)",
            border: "1px solid var(--border)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, fontFamily: "var(--mono)" }}>
              Free · Basic GPS · 2D maps only<br/>
              <span style={{ color: "var(--accent)" }}>Sign in</span> for Live Track & full Pro access
            </div>
          </div>
        </div>
      </div>
    </>
  );
}