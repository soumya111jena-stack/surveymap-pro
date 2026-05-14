// ─── UIComponents.jsx — Shared primitive UI components ───────────────────────
import React, { useState } from "react";
import { Ico } from "../constants/icons.jsx";

// ── Section header with collapse toggle ──────────────────────────────────────
export function SectionHeader({ icon, title, collapsed, onToggle }) {
  return (
    <button onClick={onToggle} style={{
      display:"flex", alignItems:"center", gap:8, width:"100%",
      padding:"10px 14px", background:"transparent", border:"none",
      borderBottom:`1px solid ${collapsed ? "transparent" : "rgba(255,255,255,0.06)"}`,
      cursor:"pointer", userSelect:"none",
    }}>
      <span style={{ color:"#4a9eff", display:"flex", opacity:0.9 }}><Ico name={icon} size={14}/></span>
      <span style={{ color:"#f5f5f5", fontSize:10.5, fontWeight:600, letterSpacing:"0.08em",
        textTransform:"uppercase", flex:1, textAlign:"left", fontFamily:"'DM Sans',sans-serif" }}>
        {title}
      </span>
      <span style={{ color:"rgba(255,255,255,0.35)", display:"flex", transition:"transform 0.2s",
        transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
        <Ico name="ChevronDown" size={12}/>
      </span>
    </button>
  );
}

// ── Sidebar layer item row ────────────────────────────────────────────────────
export function LayerItem({ iconName, label, active, checked, onCheck, onClick, indent = 0, badge = null }) {
  return (
    <div onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:8,
      padding:`6px 12px 6px ${12 + indent * 14}px`,
      cursor:"pointer", borderRadius:6, margin:"1px 6px",
      background: active ? "rgba(74,158,255,0.15)" : "transparent",
      borderLeft: active ? "2px solid #4a9eff" : "2px solid transparent",
      transition:"all 0.15s",
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? "rgba(74,158,255,0.15)" : "transparent"; }}>
      {checked !== undefined && (
        <span onClick={e => { e.stopPropagation(); onCheck?.(); }} style={{
          width:16, height:16, borderRadius:4, flexShrink:0, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          background: checked ? "#4a9eff" : "rgba(255,255,255,0.08)",
          border:`1px solid ${checked ? "#4a9eff" : "rgba(255,255,255,0.2)"}`,
        }}>
          {checked && <Ico name="Check" size={10} style={{ color:"#fff" }}/>}
        </span>
      )}
      <span style={{ color: active ? "#80bfff" : "rgba(255,255,255,0.5)", display:"flex" }}>
        <Ico name={iconName} size={13}/>
      </span>
      <span style={{ color: active ? "#d0e8ff" : "rgba(255,255,255,0.7)", fontSize:11.5, flex:1,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        fontFamily:"'DM Sans',sans-serif", fontWeight: active ? 500 : 400 }}>
        {label}
      </span>
      {badge && (
        <span style={{ fontSize:8.5, padding:"2px 7px", borderRadius:20,
          background:"rgba(74,158,255,0.2)", color:"#80bfff", fontWeight:700, letterSpacing:"0.05em" }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Primary action button ─────────────────────────────────────────────────────
const BTN_COLORS = {
  blue:   { bg:"rgba(74,158,255,0.2)",   border:"rgba(74,158,255,0.45)",   color:"#80c0ff",  hover:"rgba(74,158,255,0.3)" },
  green:  { bg:"rgba(52,211,153,0.15)",  border:"rgba(52,211,153,0.4)",   color:"#34d399",  hover:"rgba(52,211,153,0.25)" },
  red:    { bg:"rgba(248,113,113,0.15)", border:"rgba(248,113,113,0.35)", color:"#f87171",  hover:"rgba(248,113,113,0.25)" },
  amber:  { bg:"rgba(251,191,36,0.15)",  border:"rgba(251,191,36,0.35)",  color:"#fbbf24",  hover:"rgba(251,191,36,0.25)" },
  purple: { bg:"rgba(167,139,250,0.15)", border:"rgba(167,139,250,0.35)", color:"#a78bfa",  hover:"rgba(167,139,250,0.25)" },
  rose:   { bg:"rgba(239,68,68,0.15)",   border:"rgba(239,68,68,0.45)",   color:"#f87171",  hover:"rgba(239,68,68,0.3)" },
  cyan:   { bg:"rgba(34,211,238,0.14)",  border:"rgba(34,211,238,0.4)",   color:"#22d3ee",  hover:"rgba(34,211,238,0.24)" },
  teal:   { bg:"rgba(20,184,166,0.15)",  border:"rgba(20,184,166,0.4)",   color:"#2dd4bf",  hover:"rgba(20,184,166,0.25)" },
};

export function PrimaryButton({ children, onClick, style = {}, disabled = false, variant = "blue" }) {
  const c = BTN_COLORS[variant] || BTN_COLORS.blue;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width:"100%", padding:"9px 14px", borderRadius:8,
      cursor: disabled ? "not-allowed" : "pointer",
      background: c.bg, border:`1px solid ${c.border}`, color: c.color,
      fontWeight:600, fontSize:12, fontFamily:"'DM Sans',sans-serif",
      display:"flex", alignItems:"center", justifyContent:"center",
      gap:7, transition:"all 0.2s", opacity: disabled ? 0.5 : 1, ...style,
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = c.hover; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = c.bg; }}>
      {children}
    </button>
  );
}

// ── Mobile bottom-sheet wrapper ───────────────────────────────────────────────
export function MobileBottomSheet({ activeSheet, onClose, children }) {
  if (!activeSheet) return null;
  return (
    <>
      <div onClick={onClose} style={{
        position:"fixed", inset:0, zIndex:1400,
        background:"rgba(0,0,0,0.55)", backdropFilter:"blur(6px)",
        WebkitBackdropFilter:"blur(6px)", animation:"fadeIn 0.18s ease",
      }}/>
      <div style={{
        position:"fixed", bottom:0, left:0, right:0, zIndex:1500,
        background:"rgba(7,12,24,0.98)",
        backdropFilter:"blur(48px) saturate(220%)",
        WebkitBackdropFilter:"blur(48px) saturate(220%)",
        borderTop:"1px solid rgba(255,255,255,0.07)",
        borderRadius:"24px 24px 0 0", maxHeight:"88vh", overflowY:"auto",
        animation:"slideUpSheet 0.3s cubic-bezier(.16,1,.3,1)",
        boxShadow:"0 -3px 0 rgba(255,255,255,0.04), 0 -50px 120px rgba(0,0,0,0.9)",
        fontFamily:"'DM Sans',sans-serif",
        paddingBottom:"env(safe-area-inset-bottom, 12px)",
      }}>
        <div style={{ display:"flex", justifyContent:"center", paddingTop:12, paddingBottom:2 }}>
          <div style={{ width:40, height:4.5, borderRadius:3, background:"rgba(255,255,255,0.15)" }}/>
        </div>
        {children}
      </div>
    </>
  );
}

// ── Sheet sub-components (used inside sheet content) ─────────────────────────
export function SheetHeader({ title, sub, onClose, icon, iconColor = "#3b82f6" }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px 12px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        {icon && (
          <div style={{ width:38, height:38, borderRadius:12, flexShrink:0,
            background:`${iconColor}18`, border:`1px solid ${iconColor}30`,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ width:18, height:18, color:iconColor }}>{icon}</div>
          </div>
        )}
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:"#e8f2ff", letterSpacing:"-0.01em", lineHeight:1.2 }}>{title}</div>
          {sub && <div style={{ fontSize:11.5, color:"rgba(255,255,255,0.28)", marginTop:2, fontWeight:400 }}>{sub}</div>}
        </div>
      </div>
      <button onClick={onClose} style={{
        width:36, height:36, borderRadius:11, flexShrink:0,
        border:"1px solid rgba(255,255,255,0.08)", background:"rgba(255,255,255,0.04)",
        color:"rgba(255,255,255,0.38)", cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

export const SheetDivider = () => (
  <div style={{ height:1, background:"rgba(255,255,255,0.05)", margin:"4px 0" }}/>
);

export function SheetBtn({ label, color = "#3b82f6", icon, onClick, variant = "primary", fullWidth = true }) {
  const styles = {
    primary: { bg:`${color}1c`, border:`1px solid ${color}45`, text: color },
    solid:   { bg: color,       border:`1px solid ${color}`,   text:"#fff" },
    ghost:   { bg:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", text:"rgba(190,215,250,0.55)" },
    danger:  { bg:"rgba(239,68,68,0.13)",  border:"1px solid rgba(239,68,68,0.28)",   text:"#f87171" },
    success: { bg:"rgba(16,185,129,0.13)", border:"1px solid rgba(16,185,129,0.28)",  text:"#34d399" },
  };
  const s = styles[variant] || styles.primary;
  return (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", justifyContent:"center", gap:8,
      padding:"14px 20px", borderRadius:14, cursor:"pointer",
      background:s.bg, border:s.border, color:s.text,
      fontWeight:700, fontSize:14, fontFamily:"'DM Sans',sans-serif",
      width: fullWidth ? "100%" : "auto", transition:"opacity 0.15s",
    }}>
      {icon && <div style={{ width:18, height:18 }}>{icon}</div>}
      {label}
    </button>
  );
}