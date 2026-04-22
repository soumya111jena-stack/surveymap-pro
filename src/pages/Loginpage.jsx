import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../services/adminApi";

const FREE_FEATURES = [
  { icon: "🧭", label: "Compass" },
  { icon: "🗺️", label: "Basic maps (online/offline limited)" },
  { icon: "📍", label: "GPS tracking (basic)" },
  { icon: "🧱", label: "2D map only" },
];
const PRO_FEATURES = [
  { icon: "🌍", label: "3D Map access" },
  { icon: "🗺️", label: "Full offline maps" },
  { icon: "📊", label: "Survey tools" },
  { icon: "☁️",  label: "Sync & backup" },
  { icon: "🧭", label: "Advanced tracking" },
];

const injectStyles = () => {
  if (document.head.querySelector("[data-lp]")) return;
  const s = document.createElement("style");
  s.setAttribute("data-lp", "1");
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
    @keyframes gridMove{0%{transform:translateY(0)}100%{transform:translateY(40px)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pdot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
    @keyframes scan{0%{top:-4px}100%{top:100%}}
    .lp *{box-sizing:border-box;margin:0;padding:0}
    .lp{font-family:'Syne',sans-serif}
    .lp-grid{position:absolute;inset:0;overflow:hidden;
      background:linear-gradient(rgba(74,158,255,.04) 1px,transparent 1px),
        linear-gradient(90deg,rgba(74,158,255,.04) 1px,transparent 1px);
      background-size:40px 40px;animation:gridMove 4s linear infinite alternate}
    .lp-scan{position:absolute;left:0;width:100%;height:2px;
      background:linear-gradient(90deg,transparent,rgba(74,158,255,.22),transparent);
      animation:scan 4s linear infinite;pointer-events:none}
    .lp-feat{display:flex;align-items:center;gap:10px;padding:7px 0;animation:fadeUp .5s ease both}
    .lp-feat:nth-child(1){animation-delay:.05s}.lp-feat:nth-child(2){animation-delay:.10s}
    .lp-feat:nth-child(3){animation-delay:.15s}.lp-feat:nth-child(4){animation-delay:.20s}
    .lp-feat:nth-child(5){animation-delay:.25s}
    .lp-inp{width:100%;padding:13px 16px;background:rgba(255,255,255,.04);
      border:1px solid rgba(74,158,255,.18);border-radius:10px;color:#e0eeff;
      font-size:14px;font-family:'JetBrains Mono',monospace;outline:none;
      transition:border-color .2s,background .2s}
    .lp-inp::placeholder{color:rgba(255,255,255,.2)}
    .lp-inp:focus{border-color:rgba(74,158,255,.55);background:rgba(74,158,255,.06)}
    .lp-btn{width:100%;padding:14px;border:none;border-radius:10px;
      font-family:'Syne',sans-serif;font-size:15px;font-weight:700;cursor:pointer;
      background:linear-gradient(135deg,#1a6fd4,#0d47a1);color:#fff;
      transition:opacity .2s,transform .15s;letter-spacing:.04em}
    .lp-btn:not(:disabled):hover{opacity:.88;transform:translateY(-1px)}
    .lp-btn:disabled{opacity:.45;cursor:not-allowed}
    .lp-ghost{background:none;border:1px solid rgba(255,255,255,.08);border-radius:9px;
      padding:11px 0;width:100%;color:rgba(255,255,255,.35);font-size:13px;
      font-family:'Syne',sans-serif;font-weight:600;cursor:pointer;transition:all .2s}
    .lp-ghost:hover{border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.6)}
    .lp-dot{width:7px;height:7px;border-radius:50%;animation:pdot 2s ease-in-out infinite}
    .lp-badge{display:inline-block;padding:2px 7px;
      background:linear-gradient(135deg,#1a6fd4,#7c3aed);
      border-radius:4px;font-size:9px;font-weight:800;letter-spacing:.1em;color:#fff;
      vertical-align:middle;margin-left:6px}
  `;
  document.head.appendChild(s);
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [coords, setCoords]     = useState("--°N  --°E");

  useEffect(() => {
    injectStyles();
    // clear any stale tokens first
    const token = localStorage.getItem("accessToken");
    const role  = localStorage.getItem("role");
    if (token && role === "ADMIN") navigate("/admin", { replace: true });

    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords(`${p.coords.latitude.toFixed(4)}°N  ${p.coords.longitude.toFixed(4)}°E`),
      () => {}
    );
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Enter email and password."); return; }
    setLoading(true);
    try {
      const data = await login(email.trim().toLowerCase(), password);
      // Backend returns: accessToken, role, username, email
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("role",        data.role);
      localStorage.setItem("username",    data.username  || "");
      localStorage.setItem("email",       data.email     || email);
      if (data.role === "ADMIN") navigate("/admin", { replace: true });
      else navigate("/", { replace: true });
    } catch (err) {
      // Show the actual backend error message
      setError(err.message || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const lbl = (text) => (
    <label style={{
      display:"block",fontSize:10,fontWeight:700,letterSpacing:".1em",
      color:"rgba(255,255,255,.3)",textTransform:"uppercase",marginBottom:7
    }}>{text}</label>
  );

  return (
    <div className="lp" style={{ position:"fixed",inset:0,background:"#050d1a",display:"flex",overflow:"hidden" }}>

      {/* ── LEFT — feature list ── */}
      <div style={{ flex:1,position:"relative",display:"flex",flexDirection:"column",
        justifyContent:"center",padding:"60px 56px",
        borderRight:"1px solid rgba(74,158,255,.07)",overflow:"hidden" }}>
        <div className="lp-grid"/><div className="lp-scan"/>

        {/* Logo */}
        <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:48,position:"relative" }}>
          <div style={{ width:44,height:44,borderRadius:12,
            background:"linear-gradient(135deg,#1a6fd4,#0d47a1)",
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:"0 0 28px rgba(26,111,212,.45)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#fff" stroke="none"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize:18,fontWeight:800,color:"#e0eeff",letterSpacing:"-.01em" }}>SurveyMap Pro</div>
            <div style={{ fontSize:10,color:"rgba(74,158,255,.65)",fontFamily:"'JetBrains Mono',monospace",letterSpacing:".08em" }}>FIELD EDITION</div>
          </div>
        </div>

        {/* GPS */}
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:36,position:"relative" }}>
          <div className="lp-dot" style={{ background:"#4ade80" }}/>
          <span style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"rgba(74,158,255,.55)",letterSpacing:".07em" }}>{coords}</span>
        </div>

        {/* Free */}
        <div style={{ marginBottom:28,position:"relative" }}>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:".12em",color:"rgba(255,255,255,.25)",textTransform:"uppercase",marginBottom:12 }}>
            🔓 Free mode
          </div>
          {FREE_FEATURES.map((f,i) => (
            <div key={i} className="lp-feat">
              <span style={{ fontSize:15 }}>{f.icon}</span>
              <span style={{ fontSize:13,color:"rgba(255,255,255,.4)",fontWeight:600 }}>{f.label}</span>
            </div>
          ))}
        </div>

        <div style={{ height:1,background:"linear-gradient(90deg,transparent,rgba(74,158,255,.18),transparent)",marginBottom:28,position:"relative" }}/>

        {/* Pro */}
        <div style={{ position:"relative" }}>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:".12em",color:"rgba(255,255,255,.25)",textTransform:"uppercase",marginBottom:12,display:"flex",alignItems:"center",gap:8 }}>
            🔐 Pro mode <span className="lp-badge">UNLOCK</span>
          </div>
          {PRO_FEATURES.map((f,i) => (
            <div key={i} className="lp-feat">
              <span style={{ fontSize:15 }}>{f.icon}</span>
              <span style={{ fontSize:13,color:"#80c4ff",fontWeight:600 }}>{f.label}</span>
              <div className="lp-dot" style={{ background:"#4a9eff",marginLeft:"auto" }}/>
            </div>
          ))}
        </div>

        <div style={{ position:"absolute",bottom:28,left:56,fontSize:11,color:"rgba(255,255,255,.12)",fontFamily:"'JetBrains Mono',monospace" }}>
          v2.4.1 · SRPL GEO
        </div>
      </div>

      {/* ── RIGHT — login form ── */}
      <div style={{ width:420,display:"flex",flexDirection:"column",justifyContent:"center",
        padding:"60px 44px",position:"relative",background:"rgba(4,10,22,.7)" }}>

        <div style={{ marginBottom:28 }}>
          <h2 style={{ fontSize:24,fontWeight:800,color:"#e0eeff",letterSpacing:"-.02em",marginBottom:5 }}>
            Welcome back
          </h2>
          <p style={{ fontSize:13,color:"rgba(255,255,255,.28)" }}>Sign in to unlock Pro features</p>
        </div>

        {error && (
          <div style={{ padding:"10px 14px",marginBottom:16,borderRadius:9,
            background:"rgba(239,68,68,.09)",border:"1px solid rgba(239,68,68,.25)",
            fontSize:12,color:"#f87171" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <div>{lbl("Email")}
            <input className="lp-inp" type="email" placeholder="admin@surveymappro.com"
              value={email} onChange={e=>setEmail(e.target.value)} required autoFocus/>
          </div>
          <div>{lbl("Password")}
            <input className="lp-inp" type="password" placeholder="••••••••"
              value={password} onChange={e=>setPassword(e.target.value)} required/>
          </div>
          <button className="lp-btn" type="submit" disabled={loading} style={{ marginTop:6 }}>
            {loading ? "Signing in…" : "🔐  Sign In to Pro"}
          </button>
        </form>

        <div style={{ marginTop:18,textAlign:"center" }}>
          <div style={{ fontSize:11,color:"rgba(255,255,255,.13)",marginBottom:10 }}>or</div>
          <button className="lp-ghost" onClick={()=>navigate("/")}>
            🧭  Continue with Free Mode
          </button>
        </div>

        <div style={{ marginTop:32,fontSize:11,color:"rgba(255,255,255,.1)",
          textAlign:"center",lineHeight:1.8,fontFamily:"'JetBrains Mono',monospace" }}>
          Free · Basic GPS · 2D maps only<br/>Sign in for full Pro access
        </div>
      </div>
    </div>
  );
}