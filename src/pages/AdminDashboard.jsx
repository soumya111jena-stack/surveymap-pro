import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASE_URL } from "../services/apiConfig";
import { logoutUser } from "../services/adminApi";


const BASE = BASE_URL;
const hdrs = () => ({
  "Content-Type": "application/json",
});

const api = async (path, opts = {}) => {
  const r = await fetch(`${BASE}${path}`, { headers: hdrs(), credentials: "include", ...opts });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `HTTP ${r.status}`); }
  return r.json();
};

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const fmtDist  = (m) => !m ? "0 m" : m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${Math.round(m)} m`;
const fmtDate  = (d) => d ? new Date(d).toLocaleString("en-IN", { dateStyle:"short", timeStyle:"short" }) : "—";
const fmtShort = (d) => d ? new Date(d).toLocaleDateString("en-IN") : "—";
const duration = (s, e) => {
  if (!s || !e) return "—";
  const ms = new Date(e) - new Date(s);
  if (ms < 0) return "—";
  const m = Math.floor(ms/60000), h = Math.floor(m/60);
  return h > 0 ? `${h}h ${m%60}m` : `${m}m`;
};

function cleanCoords(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  return coordinates.filter(([lng, lat]) =>
    isFinite(lng) && isFinite(lat) && lng !== 0 && lat !== 0 &&
    Math.abs(lng) <= 180 && Math.abs(lat) <= 90
  );
}

// ── Reverse geocode — Full address ────────────────────────────────────────────
const geocodeCache = {};
async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  if (geocodeCache[key] !== undefined) return geocodeCache[key];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) { geocodeCache[key] = null; return null; }
    const data = await res.json();
    const a = data.address || {};

    // Full address: road/house → neighbourhood/suburb → city → district → state
    const parts = [
      a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road || null,
      a.neighbourhood || a.suburb || a.village || a.city_district || null,
      a.city || a.town || a.county || null,
      a.state_district || null,
      a.state || null,
    ].filter(Boolean);

    const place = parts.length > 0
      ? parts.join(", ")
      : data.display_name?.split(",").slice(0, 5).join(",").trim() || null;

    geocodeCache[key] = place;
    return place;
  } catch {
    geocodeCache[key] = null;
    return null;
  }
}

// ── Download helper ───────────────────────────────────────────────────────────
async function downloadPhoto(url, filename) {
  try {
    const response = await fetch(url, { mode: "cors" });
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "photo.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}

// ── Export Photos + Waypoints CSV with full address ───────────────────────────
async function exportPhotosCSV(track) {
  const photos    = getTrackPhotos(track).map(p => ({ ...p, kind: "photo" }));
  const waypoints = getTrackWaypoints(track).map(w => ({ ...w, kind: "waypoint" }));
  const rows = [...photos, ...waypoints];

  if (!rows.length) { alert("No photos or waypoints in this track."); return; }

  const placeNames = await Promise.all(
    rows.map(p => reverseGeocode(p.lat, p.lng))
  );

  const header = "no,type,name,note,latitude,longitude,full_address,time,photo_url\n";
  const csvRows = rows.map((p, i) => {
    const name  = (p.name  || `Item ${i+1}`).replace(/,/g, " ");
    const note  = (p.note  || "").replace(/,/g, " ");
    const place = (placeNames[i] || "").replace(/,/g, " ");
    const time  = p.time ? new Date(p.time).toLocaleString("en-IN") : "";
    const lat   = p.lat  != null ? Number(p.lat).toFixed(6) : "";
    const lng   = p.lng  != null ? Number(p.lng).toFixed(6) : "";
    const url   = p.url  || "";
    return `${i+1},${p.kind},${name},${note},${lat},${lng},${place},${time},${url}`;
  }).join("\n");

  const blob = new Blob([header + csvRows], { type: "text/csv" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `locations_${track.name || track.id}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-base: #080c14; --bg-surface: #0d1420; --bg-elevated: #111827; --bg-overlay: #161d2e;
      --border: rgba(255,255,255,0.06); --border-accent: rgba(99,179,237,0.2);
      --text-primary: #e8f0fe; --text-secondary: rgba(200,220,255,0.55); --text-muted: rgba(200,220,255,0.28);
      --accent: #3b82f6; --accent-glow: rgba(59,130,246,0.25); --accent-soft: rgba(59,130,246,0.1);
      --green: #10b981; --green-soft: rgba(16,185,129,0.12);
      --red: #ef4444; --red-soft: rgba(239,68,68,0.1);
      --yellow: #f59e0b; --yellow-soft: rgba(245,158,11,0.1);
      --purple: #8b5cf6; --purple-soft: rgba(139,92,246,0.1);
      --cyan: #06b6d4; --cyan-soft: rgba(6,182,212,0.1);
      --font: 'Outfit', sans-serif; --mono: 'JetBrains Mono', monospace;
      --radius: 12px; --radius-lg: 18px; --radius-sm: 8px;
    }
    body { background: var(--bg-base); font-family: var(--font); color: var(--text-primary); }
    @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
    @keyframes spin { to{transform:rotate(360deg)} }
    .fade-up { animation: fadeUp 0.4s ease both; }
    .card { background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-lg); transition:border-color 0.2s; }
    .card:hover { border-color:rgba(255,255,255,0.1); }
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:7px 14px; border-radius:var(--radius-sm); font-family:var(--font); font-size:12.5px; font-weight:600; cursor:pointer; border:1px solid transparent; transition:all 0.18s ease; white-space:nowrap; }
    .btn:hover:not(:disabled) { transform:translateY(-1px); }
    .btn:active { transform:translateY(0); }
    .btn:disabled { opacity:0.5; cursor:not-allowed; }
    .btn-primary { background:var(--accent); color:#fff; border-color:var(--accent); box-shadow:0 4px 16px rgba(59,130,246,0.3); }
    .btn-primary:hover:not(:disabled) { background:#2563eb; }
    .btn-ghost { background:transparent; color:var(--text-secondary); border-color:var(--border); }
    .btn-ghost:hover:not(:disabled) { background:rgba(255,255,255,0.04); color:var(--text-primary); border-color:rgba(255,255,255,0.12); }
    .btn-danger { background:var(--red-soft); color:var(--red); border-color:rgba(239,68,68,0.25); }
    .btn-danger:hover:not(:disabled) { background:rgba(239,68,68,0.18); }
    .btn-success { background:var(--green-soft); color:var(--green); border-color:rgba(16,185,129,0.25); }
    .btn-success:hover:not(:disabled) { background:rgba(16,185,129,0.2); }
    .btn-warning { background:var(--yellow-soft); color:var(--yellow); border-color:rgba(245,158,11,0.25); }
    .btn-warning:hover:not(:disabled) { background:rgba(245,158,11,0.18); }
    .btn-cyan { background:rgba(6,182,212,0.1); color:#06b6d4; border-color:rgba(6,182,212,0.25); }
    .btn-cyan:hover:not(:disabled) { background:rgba(6,182,212,0.18); }
    .btn-purple { background:rgba(139,92,246,0.1); color:#8b5cf6; border-color:rgba(139,92,246,0.25); }
    .btn-purple:hover:not(:disabled) { background:rgba(139,92,246,0.2); }
    .badge { display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:100px; font-size:11px; font-weight:700; letter-spacing:0.03em; border:1px solid; }
    .badge-green { background:rgba(16,185,129,0.1); color:#10b981; border-color:rgba(16,185,129,0.25); }
    .badge-red { background:rgba(239,68,68,0.1); color:#ef4444; border-color:rgba(239,68,68,0.25); }
    .badge-blue { background:rgba(59,130,246,0.1); color:#3b82f6; border-color:rgba(59,130,246,0.25); }
    .badge-yellow { background:rgba(245,158,11,0.1); color:#f59e0b; border-color:rgba(245,158,11,0.25); }
    .badge-cyan { background:rgba(6,182,212,0.1); color:#06b6d4; border-color:rgba(6,182,212,0.25); }
    .input { width:100%; padding:11px 14px; border-radius:var(--radius-sm); border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:var(--text-primary); font-family:var(--font); font-size:13.5px; outline:none; transition:border-color 0.18s,box-shadow 0.18s; }
    .input:focus { border-color:rgba(59,130,246,0.5); box-shadow:0 0 0 3px rgba(59,130,246,0.1); }
    .input::placeholder { color:var(--text-muted); }
    select.input { cursor:pointer; }
    table { width:100%; border-collapse:collapse; }
    th { font-size:10.5px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--text-muted); padding:12px 16px; text-align:left; border-bottom:1px solid var(--border); }
    td { padding:13px 16px; font-size:13px; color:var(--text-secondary); border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
    tr:last-child td { border-bottom:none; }
    tr:hover td { background:rgba(255,255,255,0.015); }
    .scrollbar-thin::-webkit-scrollbar { width:4px; height:4px; }
    .scrollbar-thin::-webkit-scrollbar-track { background:transparent; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }
    .nav-tab { display:flex; align-items:center; gap:8px; padding:0 18px; height:100%; font-size:13px; font-weight:500; color:var(--text-muted); cursor:pointer; border-bottom:2px solid transparent; transition:color 0.18s,border-color 0.18s; user-select:none; white-space:nowrap; }
    .nav-tab:hover { color:var(--text-primary); }
    .nav-tab.active { color:var(--text-primary); font-weight:600; border-bottom-color:var(--accent); }
    .stat-card { background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:20px 24px; position:relative; overflow:hidden; transition:border-color 0.2s,transform 0.2s; }
    .stat-card:hover { border-color:rgba(255,255,255,0.1); transform:translateY(-2px); }
    .stat-card::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent); }
    .modal-backdrop { position:fixed; inset:0; z-index:9000; background:rgba(0,0,0,0.75); backdrop-filter:blur(20px); display:flex; align-items:center; justify-content:center; padding:20px; }
    .modal { background:var(--bg-elevated); border-radius:var(--radius-lg); border:1px solid rgba(255,255,255,0.08); box-shadow:0 40px 100px rgba(0,0,0,0.8); width:100%; max-width:440px; overflow:hidden; animation:fadeUp 0.25s ease; }
    .modal-header { padding:22px 24px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
    .modal-body { padding:22px 24px 24px; }
    .field-group { margin-bottom:18px; }
    .field-label { display:block; font-size:11px; font-weight:700; letter-spacing:0.07em; color:var(--text-muted); text-transform:uppercase; margin-bottom:7px; }
    .field-hint { font-size:10.5px; color:var(--text-muted); font-style:italic; margin-top:5px; }
    .close-btn { width:30px; height:30px; border-radius:8px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:var(--text-muted); font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.18s; }
    .close-btn:hover { background:rgba(255,255,255,0.1); color:var(--text-primary); }
    .error-box { display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:var(--radius-sm); background:var(--red-soft); border:1px solid rgba(239,68,68,0.25); color:#fca5a5; font-size:12.5px; margin-bottom:16px; }
    .section-title { font-size:14px; font-weight:700; color:var(--text-primary); margin-bottom:4px; }
    .section-sub { font-size:12px; color:var(--text-muted); }
    .icon-box { width:38px; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .toast { position:fixed; top:24px; right:24px; z-index:9999; padding:12px 20px 12px 16px; border-radius:12px; display:flex; align-items:center; gap:10px; font-size:13px; font-weight:600; box-shadow:0 8px 32px rgba(0,0,0,0.5); animation:fadeUp 0.3s ease; }
    .chip { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:6px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); font-size:12px; color:var(--text-secondary); }
    .chip-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
    .loading-spinner { width:32px; height:32px; border:2px solid rgba(255,255,255,0.08); border-top-color:var(--accent); border-radius:50%; animation:spin 0.7s linear infinite; }
    .submit-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:10px 18px; border-radius:var(--radius-sm); font-family:var(--font); font-size:13px; font-weight:700; cursor:pointer; border:none; transition:all 0.18s ease; }
    .submit-btn:hover:not(:disabled) { transform:translateY(-1px); opacity:0.9; }
    .submit-btn:disabled { opacity:0.5; cursor:not-allowed; }
    .place-tag { display:inline-flex; align-items:flex-start; gap:4px; font-size:10px; color:#10b981; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.2); border-radius:4px; padding:3px 6px; margin-top:5px; font-family:var(--mono); line-height:1.4; word-break:break-word; }
  `}</style>
);

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icons = {
  Map: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>,
  Chart: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  Users: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Sessions: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Plus: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Edit: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Trash: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  Eye: ({ open }) => open
    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
  Lock: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  Mail: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  User: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Shield: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Check: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
  Arrow: ({ dir }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{dir==="left"?<polyline points="15 18 9 12 15 6"/>:<polyline points="9 18 15 12 9 6"/>}</svg>,
  Download: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Close: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Activity: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  MapPin: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  Search: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Warning: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Logout: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="toast" style={{
      background: toast.type === "error" ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
      border: `1px solid ${toast.type === "error" ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
      color: toast.type === "error" ? "#ef4444" : "#10b981",
    }}>
      {toast.type === "error" ? <Icons.Warning/> : <Icons.Check/>}
      {toast.msg}
    </div>
  );
}

function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords?.length >= 2) {
      const clean = cleanCoords(coords);
      if (clean.length >= 2) {
        try { map.fitBounds(L.latLngBounds(clean.map(([lng,lat])=>[lat,lng])), { padding:[40,40] }); } catch(_){}
      }
    }
  }, [coords, map]);
  return null;
}

function absUrl(url, base) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${((base || BASE) + "").replace(/\/$/, "")}${url}`;
}

function getTrackPhotos(track) {
  if (track.photos?.length > 0) return track.photos;
  const meta = track.waypointsMeta;
  if (meta) {
    const m = typeof meta === "string"
      ? (() => { try { return JSON.parse(meta); } catch { return null; } })()
      : meta;
    if (Array.isArray(m)) {
      const photoEntries = m.filter(w => w.photo && w.url);
      if (photoEntries.length > 0) {
        return photoEntries.map(w => ({
          url: w.url, name: w.name || "Photo", note: w.note || null,
          lat: w.lat ?? null, lng: w.lng ?? null, time: w.time || null,
        }));
      }
    }
    if (m?.photoUrls?.length > 0) return m.photoUrls;
  }
  if (track.photoUrl) {
    return [{ url: track.photoUrl, name: track.photoName || "Photo", note: track.photoDescription || null, lat: null, lng: null, time: null }];
  }
  return [];
}

// ── Plain (non-photo) waypoints — pins with just name/note/lat/lng ───────────
function getTrackWaypoints(track) {
  const meta = track.waypointsMeta;
  if (!meta) return [];
  const m = typeof meta === "string"
    ? (() => { try { return JSON.parse(meta); } catch { return null; } })()
    : meta;
  if (!Array.isArray(m)) return [];
  return m
    .filter(w => !w.photo && w.lat != null && w.lng != null)
    .map(w => ({
      name: w.name || "Waypoint",
      note: w.note || null,
      lat: Number(w.lat),
      lng: Number(w.lng),
      time: w.time || null,
    }));
}

function downloadCSV(track) {
  const coords = cleanCoords(track.coordinates || []);
  if (!coords.length) { alert("No valid waypoints in this track."); return; }
  const startTime = track.startedAt ? new Date(track.startedAt).getTime() : null;
  const endTime   = track.endedAt   ? new Date(track.endedAt).getTime()   : null;
  const total     = coords.length;
  const header    = "point,latitude,longitude,timestamp\n";
  const rows      = coords.map(([lng,lat],i) => {
    let ts = "";
    if (startTime) {
      const fraction = total > 1 ? i/(total-1) : 0;
      const ms = endTime ? startTime+fraction*(endTime-startTime) : startTime+i*1000;
      ts = new Date(ms).toISOString();
    }
    return `${i+1},${lat},${lng},${ts}`;
  }).join("\n");
  const blob = new Blob([header+rows], { type:"text/csv" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `track_${track.name||track.id}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Photo Lightbox ────────────────────────────────────────────────────────────
function PhotoLightbox({ photos, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);
  const photo = photos[idx];

  useEffect(() => {
    const h = (e) => {
      if (e.key === "ArrowLeft")  setIdx(i => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx(i => Math.min(photos.length - 1, i + 1));
      if (e.key === "Escape")     onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [photos.length, onClose]);

  const photoUrl  = absUrl(photo.url);
  const photoName = photo.name || `photo_${idx + 1}`;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ background: "rgba(0,0,0,0.95)" }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
        <div style={{ position: "absolute", top: -50, right: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => downloadPhoto(photoUrl, photoName)} className="btn btn-cyan" style={{ fontSize: 12 }}>
            <Icons.Download/> Download
          </button>
          <button onClick={onClose} className="close-btn"><Icons.Close/></button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {photos.length > 1 && (
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              className="btn btn-ghost" style={{ fontSize: 24, padding: "8px 16px" }}>‹</button>
          )}
          <img src={photoUrl} alt={photo.name} style={{ maxWidth: "70vw", maxHeight: "70vh", borderRadius: 12, objectFit: "contain" }} />
          {photos.length > 1 && (
            <button onClick={() => setIdx(i => Math.min(photos.length - 1, i + 1))} disabled={idx === photos.length - 1}
              className="btn btn-ghost" style={{ fontSize: 24, padding: "8px 16px" }}>›</button>
          )}
        </div>
        {(photo.name || photo.note) && (
          <div style={{ marginTop: 16, textAlign: "center", maxWidth: "500px" }}>
            {photo.name && <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{photo.name}</div>}
            {photo.note && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{photo.note}</div>}
          </div>
        )}
        {photos.length > 1 && (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
            <span style={{ fontSize: 11, color: "rgba(200,220,255,0.3)", fontFamily: "var(--mono)" }}>{idx + 1} / {photos.length}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Photo Card with Full Address ──────────────────────────────────────────────
function PhotoCard({ photo, index, onLightbox, onDownload }) {
  const [placeName, setPlaceName] = useState(null);
  const [placeLoading, setPlaceLoading] = useState(false);
  const photoUrl  = absUrl(photo.url);
  const photoName = photo.name || `photo_${index + 1}`;

  useEffect(() => {
    if (photo.lat != null && photo.lng != null) {
      setPlaceLoading(true);
      reverseGeocode(photo.lat, photo.lng).then(p => {
        setPlaceName(p);
        setPlaceLoading(false);
      });
    }
  }, [photo.lat, photo.lng]);

  return (
    <div
      style={{ flexShrink: 0, width: 175, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", background: "rgba(255,255,255,0.02)", transition: "all 0.18s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
    >
      <div onClick={() => onLightbox(index)} style={{ cursor: "pointer" }}>
        <img src={photoUrl} alt={photo.name} style={{ width: "100%", height: 95, objectFit: "cover", display: "block" }} />
      </div>

      <div style={{ padding: "8px 10px 10px" }}>
        <div style={{ fontWeight: 600, fontSize: 11, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {photo.name || `Photo ${index + 1}`}
        </div>
        {photo.note && (
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {photo.note}
          </div>
        )}

        {/* Full address place tag */}
        {photo.lat != null && (
          <div style={{ marginTop: 5 }}>
            {placeLoading ? (
              <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--mono)" }}>📍 locating…</span>
            ) : placeName ? (
              <span className="place-tag">📍 {placeName}</span>
            ) : (
              <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--mono)" }}>
                📍 {Number(photo.lat).toFixed(5)}, {Number(photo.lng).toFixed(5)}
              </span>
            )}
          </div>
        )}

        <button
          onClick={() => onDownload(photoUrl, photoName)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            marginTop: 8, fontSize: 10, fontWeight: 700,
            color: "var(--cyan)", background: "rgba(6,182,212,0.08)",
            border: "1px solid rgba(6,182,212,0.2)",
            borderRadius: 5, padding: "3px 8px", cursor: "pointer",
            fontFamily: "var(--mono)", transition: "background .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(6,182,212,0.16)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(6,182,212,0.08)"}
        >
          <Icons.Download/> Download
        </button>
      </div>
    </div>
  );
}

// ── Waypoint Card ──────────────────────────────────────────────────────────────
function WaypointCard({ wp }) {
  const [placeName, setPlaceName] = useState(null);
  const [placeLoading, setPlaceLoading] = useState(false);

  useEffect(() => {
    if (wp.lat != null && wp.lng != null) {
      setPlaceLoading(true);
      reverseGeocode(wp.lat, wp.lng).then(p => {
        setPlaceName(p);
        setPlaceLoading(false);
      });
    }
  }, [wp.lat, wp.lng]);

  return (
    <div
      className="chip"
      style={{ justifyContent: "space-between", alignItems: "flex-start", padding: "8px 12px", flexWrap: "wrap", gap: 6 }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="chip-dot" style={{ background: "#f59e0b" }} />
          <strong style={{ color: "var(--text-primary)", fontSize: 12.5 }}>{wp.name}</strong>
        </div>
        {wp.note && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, fontStyle: "italic" }}>
            {wp.note}
          </div>
        )}
        <div style={{ marginTop: 5 }}>
          {placeLoading ? (
            <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--mono)" }}>📍 locating…</span>
          ) : placeName ? (
            <span className="place-tag">📍 {placeName}</span>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
          {Number(wp.lat).toFixed(5)}, {Number(wp.lng).toFixed(5)}
        </span>
        {wp.time && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-muted)" }}>
            {fmtDate(wp.time)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Photo Cell (table) ────────────────────────────────────────────────────────
function PhotoCell({ track, onOpen }) {
  const photos = getTrackPhotos(track);
  if (photos.length === 0) return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {photos.slice(0, 2).map((p, i) => (
        <div key={i} onClick={() => onOpen(photos, i)} style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", cursor: "pointer", border: "1px solid var(--border)" }}>
          <img src={absUrl(p.url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      ))}
      <button className="btn btn-ghost" onClick={() => onOpen(photos, 0)} style={{ padding: "2px 8px", fontSize: 10 }}>📷 {photos.length}</button>
    </div>
  );
}

// ── Waypoints Cell (table) ────────────────────────────────────────────────────
function WaypointsCell({ track }) {
  const meta = track.waypointsMeta;
  const m = typeof meta === "string"
    ? (() => { try { return JSON.parse(meta); } catch { return null; } })()
    : meta;
  const total = Array.isArray(m) ? m.filter(w => w.lat != null && w.lng != null).length : 0;
  if (total === 0) return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>;
  return <span className="badge badge-yellow" title={`${total} point(s)`}>📌 {total}</span>;
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const [data, setData] = useState(null);
  useEffect(() => { api("/api/admin/analytics").then(setData).catch(console.error); }, []);
  if (!data) return <div style={{ display:"flex", justifyContent:"center", alignItems:"center", height:300 }}><div className="loading-spinner"/></div>;

  const stats = [
    { label:"Total Users",     value:data.totalUsers,                     icon:<Icons.Users/>,    color:"#3b82f6", bg:"rgba(59,130,246,0.08)" },
    { label:"Total Sessions",  value:data.totalSessions,                  icon:<Icons.Sessions/>, color:"#8b5cf6", bg:"rgba(139,92,246,0.08)" },
    { label:"Total Tracks",    value:data.totalTracks,                    icon:<Icons.MapPin/>,   color:"#10b981", bg:"rgba(16,185,129,0.08)" },
    { label:"Active Sessions", value:data.activeSessions,                 icon:<Icons.Activity/>, color:"#ef4444", bg:"rgba(239,68,68,0.08)" },
    { label:"Total Distance",  value:fmtDist(data.totalDistanceMeters||0),icon:<Icons.Map/>,      color:"#06b6d4", bg:"rgba(6,182,212,0.08)" },
  ];
  const maxBar = Math.max(...(data.tracksPerDay||[]).map(d=>d.count),1);

  return (
    <div className="fade-up">
      <div style={{ fontSize:20, fontWeight:800, color:"var(--text-primary)", marginBottom:24 }}>Analytics Overview</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14, marginBottom:24 }}>
        {stats.map((s,i) => (
          <div key={s.label} className="stat-card" style={{ animationDelay:`${i*0.07}s` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <div className="icon-box" style={{ background:s.bg, border:`1px solid ${s.color}22`, color:s.color }}>{s.icon}</div>
              <div style={{ fontSize:11, color:"var(--text-muted)", fontWeight:600, letterSpacing:"0.05em", textTransform:"uppercase" }}>{s.label}</div>
            </div>
            <div style={{ fontSize:34, fontWeight:800, color:s.color, fontFamily:"var(--mono)", lineHeight:1 }}>{s.value}</div>
          </div>
        ))}
      </div>
      {data.tracksPerDay?.length > 0 && (
        <div className="card" style={{ padding:24 }}>
          <div style={{ marginBottom:18 }}><div className="section-title">Tracks per Day</div><div className="section-sub">Last 30 days of activity</div></div>
          <div style={{ display:"flex", gap:3, alignItems:"flex-end", height:90 }}>
            {data.tracksPerDay.map((bar,i) => (
              <div key={i} title={`${bar.date}: ${bar.count} track${bar.count!==1?"s":""}`}
                style={{ flex:1, height:`${Math.max(5,(bar.count/maxBar)*82)}px`, background:`rgba(59,130,246,${0.3+0.4*(bar.count/maxBar)})`, borderRadius:"3px 3px 0 0" }}/>
            ))}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:8 }}>
            <span style={{ fontSize:10.5, color:"var(--text-muted)" }}>30 days ago</span>
            <span style={{ fontSize:10.5, color:"var(--text-muted)" }}>Today</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create User Modal ─────────────────────────────────────────────────────────
function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ username:"", email:"", password:"", role:"USER" });
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const [showPass, setShowPass] = useState(false);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  const submit = async (e) => {
    e.preventDefault(); setError("");
    if (!form.username||!form.email||!form.password){setError("All fields are required.");return;}
    if (form.password.length<6){setError("Password must be at least 6 characters.");return;}
    setLoading(true);
    try { const u=await api("/api/admin/users",{method:"POST",body:JSON.stringify(form)}); onCreated(u); onClose(); }
    catch(err){setError(err.message);} finally{setLoading(false);}
  };
  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div className="icon-box" style={{ background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.2)" }}><Icons.Plus/></div>
            <div><div style={{ fontSize:16, fontWeight:700, color:"var(--text-primary)" }}>Create New User</div><div style={{ fontSize:11.5, color:"var(--text-muted)", marginTop:2 }}>Account will be active immediately</div></div>
          </div>
          <button className="close-btn" onClick={onClose}><Icons.Close/></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-box"><Icons.Warning/>{error}</div>}
          <form onSubmit={submit}>
            <div className="field-group"><label className="field-label">Username</label><input className="input" placeholder="e.g. john_field" value={form.username} onChange={e=>set("username",e.target.value)} autoFocus/></div>
            <div className="field-group"><label className="field-label">Email</label><input className="input" type="email" placeholder="user@example.com" value={form.email} onChange={e=>set("email",e.target.value)}/></div>
            <div className="field-group">
              <label className="field-label">Password</label>
              <div style={{ position:"relative" }}>
                <input className="input" type={showPass?"text":"password"} placeholder="Min 6 characters" value={form.password} onChange={e=>set("password",e.target.value)} style={{ paddingRight:44 }}/>
                <button type="button" onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"var(--text-muted)" }}><Icons.Eye open={showPass}/></button>
              </div>
            </div>
            <div className="field-group" style={{ marginBottom:24 }}>
              <label className="field-label">Role</label>
              <select className="input" value={form.role} onChange={e=>set("role",e.target.value)}>
                <option value="USER">USER — Can record tracks</option>
                <option value="ADMIN">ADMIN — Full access</option>
              </select>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button type="submit" disabled={loading} className="submit-btn" style={{ flex:2, background:"linear-gradient(135deg,#2563eb,#1d4ed8)", color:"#fff" }}>
                {loading?<span style={{ display:"flex",alignItems:"center",gap:8 }}><span className="loading-spinner" style={{ width:14,height:14 }}/> Creating…</span>:<><Icons.Check/> Create User</>}
              </button>
              <button type="button" onClick={onClose} className="btn btn-ghost" style={{ flex:1 }}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Edit User Modal ───────────────────────────────────────────────────────────
function EditUserModal({ user, onClose, onUpdated }) {
  const [form, setForm] = useState({ email:user.email||"", password:"" });
  const [showPass, setShowPass] = useState(false); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setError("");
    if (!form.email){setError("Email is required.");return;}
    if (form.password&&form.password.length<6){setError("New password must be at least 6 characters.");return;}
    setLoading(true);
    try { const body={email:form.email}; if(form.password)body.password=form.password; await api(`/api/admin/users/${user.id}`,{method:"PATCH",body:JSON.stringify(body)}); onUpdated(); onClose(); }
    catch(err){setError(err.message);} finally{setLoading(false);}
  };
  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-header" style={{ background:"rgba(245,158,11,0.05)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div className="icon-box" style={{ background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.25)" }}><Icons.Edit/></div>
            <div><div style={{ fontSize:16, fontWeight:700, color:"var(--text-primary)" }}>Edit User</div><div style={{ fontSize:11.5, color:"var(--text-muted)", marginTop:2 }}>Updating <span style={{ color:"#f59e0b", fontWeight:700 }}>{user.username}</span></div></div>
          </div>
          <button className="close-btn" onClick={onClose}><Icons.Close/></button>
        </div>
        <div className="modal-body">
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", borderRadius:10, marginBottom:20, background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)" }}>
            <div className="chip" style={{ flex:1 }}><span className="chip-dot" style={{ background:"#06b6d4" }}/><span style={{ fontFamily:"var(--mono)", fontSize:11.5 }}>{user.email}</span></div>
            <span className={`badge ${user.role==="ADMIN"?"badge-yellow":"badge-blue"}`}>{user.role}</span>
            <span className={`badge ${user.enabled?"badge-green":"badge-red"}`}>{user.enabled?"Active":"Disabled"}</span>
          </div>
          {error && <div className="error-box"><Icons.Warning/>{error}</div>}
          <form onSubmit={submit}>
            <div className="field-group"><label className="field-label">New Email</label><input className="input" type="email" placeholder="user@example.com" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} autoFocus/></div>
            <div className="field-group" style={{ marginBottom:24 }}>
              <label className="field-label">New Password</label>
              <div style={{ position:"relative" }}>
                <input className="input" type={showPass?"text":"password"} placeholder="Leave blank to keep current" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} style={{ paddingRight:44 }}/>
                <button type="button" onClick={()=>setShowPass(v=>!v)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"var(--text-muted)" }}><Icons.Eye open={showPass}/></button>
              </div>
              <p className="field-hint">Leave blank to keep the current password · min 6 chars</p>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button type="submit" disabled={loading} className="submit-btn" style={{ flex:2, background:"linear-gradient(135deg,#d97706,#b45309)", color:"#fff" }}>
                {loading?<><span className="loading-spinner" style={{ width:14,height:14,display:"inline-block" }}/> Saving…</>:<><Icons.Check/> Save Changes</>}
              </button>
              <button type="button" onClick={onClose} className="btn btn-ghost" style={{ flex:1 }}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab({ showToast }) {
  const [users,setUsers]=useState([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(0);
  const [loading,setLoading]=useState(true); const [showCreate,setShowCreate]=useState(false);
  const [editingUser,setEditingUser]=useState(null); const [search,setSearch]=useState("");
  const load=useCallback(async(p=0)=>{setLoading(true);try{const d=await api(`/api/admin/users?page=${p}&size=20`);setUsers(d.users||[]);setTotal(d.total||0);setPage(p);}catch(e){console.error(e);}finally{setLoading(false);};},[]);
  useEffect(()=>{load(0);},[load]);
  const filtered=users.filter(u=>u.username.toLowerCase().includes(search.toLowerCase())||u.email.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="fade-up">
      {showCreate&&<CreateUserModal onClose={()=>setShowCreate(false)} onCreated={()=>{showToast("User created");load(page);}}/>}
      {editingUser&&<EditUserModal user={editingUser} onClose={()=>setEditingUser(null)} onUpdated={()=>{showToast("User updated");load(page);}}/>}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
        <div><div style={{ fontSize:20, fontWeight:800, color:"var(--text-primary)" }}>Users</div><div style={{ fontSize:12.5, color:"var(--text-muted)", marginTop:4 }}>{total} total accounts</div></div>
        <button className="btn btn-primary" onClick={()=>setShowCreate(true)}><Icons.Plus/> Create User</button>
      </div>
      <div style={{ position:"relative", maxWidth:340, marginBottom:20 }}>
        <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--text-muted)" }}><Icons.Search/></div>
        <input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search username or email…" style={{ paddingLeft:38 }}/>
      </div>
      {loading?<div style={{ display:"flex", justifyContent:"center", padding:60 }}><div className="loading-spinner"/></div>:(
        <div className="card" style={{ overflow:"hidden" }}>
          <div style={{ overflowX:"auto" }} className="scrollbar-thin">
            <table>
              <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(u=>(
                  <tr key={u.id}>
                    <td><span style={{ fontWeight:600, color:"var(--text-primary)" }}>{u.username}</span></td>
                    <td><span style={{ fontFamily:"var(--mono)", fontSize:12 }}>{u.email}</span></td>
                    <td><span className={`badge ${u.role==="ADMIN"?"badge-yellow":"badge-blue"}`}>{u.role}</span></td>
                    <td><span className={`badge ${u.enabled?"badge-green":"badge-red"}`}>{u.enabled?"Active":"Disabled"}</span></td>
                    <td><span style={{ fontFamily:"var(--mono)", fontSize:11.5 }}>{fmtShort(u.createdAt)}</span></td>
                    <td>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        <button className="btn btn-warning" onClick={()=>setEditingUser(u)}><Icons.Edit/> Edit</button>
                        <button className={`btn ${u.enabled?"btn-danger":"btn-success"}`} onClick={async()=>{await api(`/api/admin/users/${u.id}/toggle`,{method:"PATCH"});load(page);}}>{u.enabled?"Disable":"Enable"}</button>
                        <button className="btn btn-ghost" onClick={async()=>{await api(`/api/admin/users/${u.id}/role`,{method:"PATCH",body:JSON.stringify({role:u.role==="ADMIN"?"USER":"ADMIN"})});load(page);}}>{u.role==="ADMIN"?"→ User":"→ Admin"}</button>
                        <button className="btn btn-danger" onClick={async()=>{if(window.confirm("Delete user?")){await api(`/api/admin/users/${u.id}`,{method:"DELETE"});load(page);}}}><Icons.Trash/></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length===0&&<tr><td colSpan={6} style={{ textAlign:"center", padding:48, color:"var(--text-muted)" }}>No users found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {total>20&&(
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:16, alignItems:"center" }}>
          <button onClick={()=>load(page-1)} disabled={page===0} className="btn btn-ghost">← Prev</button>
          <span style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"var(--mono)" }}>Page {page+1} / {Math.ceil(total/20)}</span>
          <button onClick={()=>load(page+1)} disabled={(page+1)*20>=total} className="btn btn-ghost">Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Sessions Tab ──────────────────────────────────────────────────────────────
function SessionsTab() {
  const [sessions,setSessions]=useState([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(0);
  const [filter,setFilter]=useState(""); const [loading,setLoading]=useState(true);
  const load=useCallback(async(p=0,f="")=>{setLoading(true);try{const d=await api(`/api/admin/sessions?status=${f}&page=${p}&size=20`);setSessions(d.sessions||[]);setTotal(d.total||0);setPage(p);}catch(e){console.error(e);}finally{setLoading(false);};},[]);
  useEffect(()=>{load(0,filter);},[load,filter]);
  return (
    <div className="fade-up">
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
        <div><div style={{ fontSize:20, fontWeight:800, color:"var(--text-primary)" }}>Sessions</div><div style={{ fontSize:12.5, color:"var(--text-muted)", marginTop:4 }}>{total} total sessions</div></div>
        <div style={{ display:"flex", gap:6 }}>
          {[["","All"],["ACTIVE","Active"],["COMPLETED","Completed"]].map(([f,l])=>(
            <button key={f} className="btn" onClick={()=>setFilter(f)} style={{ background:filter===f?"rgba(59,130,246,0.12)":"transparent", color:filter===f?"#3b82f6":"var(--text-muted)", borderColor:filter===f?"rgba(59,130,246,0.3)":"rgba(255,255,255,0.08)" }}>{l}</button>
          ))}
        </div>
      </div>
      {loading?<div style={{ display:"flex", justifyContent:"center", padding:60 }}><div className="loading-spinner"/></div>:(
        <div className="card" style={{ overflow:"hidden" }}>
          <div style={{ overflowX:"auto" }} className="scrollbar-thin">
            <table>
              <thead><tr><th>Session</th><th>User</th><th>Status</th><th>Tracks</th><th>Started</th><th>Ended</th></tr></thead>
              <tbody>
                {sessions.map(s=>(
                  <tr key={s.id}>
                    <td><div style={{ fontWeight:600, color:"var(--text-primary)" }}>{s.name}</div><div style={{ fontSize:10, color:"var(--text-muted)", fontFamily:"var(--mono)", marginTop:2 }}>{s.clientId}</div></td>
                    <td>{s.username}</td>
                    <td><span className={`badge ${s.status==="ACTIVE"?"badge-green":"badge-cyan"}`}>{s.status}</span></td>
                    <td><span style={{ fontFamily:"var(--mono)" }}>{s.trackCount??0}</span></td>
                    <td><span style={{ fontFamily:"var(--mono)", fontSize:11.5 }}>{fmtDate(s.startedAt)}</span></td>
                    <td><span style={{ fontFamily:"var(--mono)", fontSize:11.5 }}>{fmtDate(s.endedAt)}</span></td>
                  </tr>
                ))}
                {sessions.length===0&&<tr><td colSpan={6} style={{ textAlign:"center", padding:48, color:"var(--text-muted)" }}>No sessions found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {total>20&&(
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:16, alignItems:"center" }}>
          <button onClick={()=>load(page-1,filter)} disabled={page===0} className="btn btn-ghost">← Prev</button>
          <span style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"var(--mono)" }}>Page {page+1} / {Math.ceil(total/20)}</span>
          <button onClick={()=>load(page+1,filter)} disabled={(page+1)*20>=total} className="btn btn-ghost">Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Tracks Tab ────────────────────────────────────────────────────────────────
function TracksTab({ showToast }) {
  const [tracks,setTracks]=useState([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(0);
  const [loading,setLoading]=useState(true); const [selected,setSelected]=useState(null);
  const [loadingTrack,setLoadingTrack]=useState(false); const [exportingPhotos,setExportingPhotos]=useState(false);
  const [mapKey,setMapKey]=useState(0); const [lightbox,setLightbox]=useState(null); const [search,setSearch]=useState("");

  const load=useCallback(async(p=0)=>{setLoading(true);try{const d=await api(`/api/admin/tracks?page=${p}&size=20`);setTracks(d.tracks||[]);setTotal(d.total||0);setPage(p);}catch(e){console.error(e);}finally{setLoading(false);};},[]);
  useEffect(()=>{load(0);},[load]);

  const viewTrack=async(id)=>{setLoadingTrack(true);try{const t=await api(`/api/admin/tracks/${id}`);setSelected(t);setMapKey(k=>k+1);}catch(e){console.error(e);}finally{setLoadingTrack(false);};};

  const handleExportPhotos=async()=>{
    if(!selected)return;
    setExportingPhotos(true);
    showToast("Fetching place names… this may take a few seconds");
    try{await exportPhotosCSV(selected);showToast("Locations CSV exported!");}
    catch(e){showToast("Export failed: "+e.message,"error");}
    finally{setExportingPhotos(false);}
  };

  const filtered=tracks.filter(t=>t.name?.toLowerCase().includes(search.toLowerCase())||t.username?.toLowerCase().includes(search.toLowerCase()));
  const cleanedCoords=cleanCoords(selected?.coordinates||[]);
  const leafletCoords=cleanedCoords.map(([lng,lat])=>[lat,lng]);
  const startPt=leafletCoords[0];
  const endPt=leafletCoords[leafletCoords.length-1];
  const validPointCount=cleanedCoords.length;
  const totalPointCount=selected?.coordinates?.length||0;
  const mkIcon=(color)=>L.divIcon({html:`<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 0 10px ${color}99"></div>`,className:"",iconAnchor:[6,6]});
  const selectedPhotos=selected?getTrackPhotos(selected):[];
  const selectedWaypoints=selected?getTrackWaypoints(selected):[];

  return (
    <div className="fade-up">
      {lightbox&&<PhotoLightbox photos={lightbox.photos} startIndex={lightbox.index} onClose={()=>setLightbox(null)}/>}

      <div style={{ fontSize:20, fontWeight:800, color:"var(--text-primary)", marginBottom:24 }}>All Tracks</div>

      <div className="card" style={{ overflow:"hidden", marginBottom:20 }}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
          <div>
            <div className="section-title">{selected?selected.name:"Track Viewer"}</div>
            <div className="section-sub">
              {selected?`${selected.username} · ${selected.sessionName} · ${fmtDist(selected.distanceMeters)} · ${validPointCount} valid pts`:loadingTrack?"Loading track…":"Select a track below to display its route"}
            </div>
          </div>
          {selected&&(
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {selectedPhotos.length>0&&<button className="btn btn-ghost" onClick={()=>setLightbox({photos:selectedPhotos,index:0})}>📷 Photos ({selectedPhotos.length})</button>}
              {(selectedPhotos.length>0||selectedWaypoints.length>0)&&(
                <button className="btn btn-purple" onClick={handleExportPhotos} disabled={exportingPhotos} title="Export photo + waypoint locations as CSV with full address">
                  {exportingPhotos?<><span className="loading-spinner" style={{ width:12,height:12 }}/> Fetching…</>:<><Icons.Download/> Export Locations CSV</>}
                </button>
              )}
              <button className="btn btn-success" onClick={()=>downloadCSV(selected)}><Icons.Download/> Track CSV</button>
              <button className="btn btn-danger" onClick={()=>setSelected(null)}>✕ Close</button>
            </div>
          )}
        </div>

        <div style={{ height:360, background:"linear-gradient(135deg,#0a1628,#0d1e30)", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(rgba(59,130,246,0.1) 1px,transparent 1px)", backgroundSize:"28px 28px" }}/>
          {selected&&leafletCoords.length>=2?(
            <MapContainer key={mapKey} center={leafletCoords[Math.floor(leafletCoords.length/2)]} zoom={14} zoomControl style={{ width:"100%", height:"100%", position:"relative", zIndex:1 }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" maxZoom={19}/>
              <Polyline positions={leafletCoords} color="#3b82f6" weight={4} opacity={0.9}/>
              {startPt&&<Marker position={startPt} icon={mkIcon("#10b981")}><Popup><strong>Start</strong><br/>{fmtDate(selected.startedAt)}</Popup></Marker>}
              {endPt&&startPt!==endPt&&<Marker position={endPt} icon={mkIcon("#ef4444")}><Popup><strong>End</strong><br/>{fmtDate(selected.endedAt)}</Popup></Marker>}
              {selectedWaypoints.map((w,i)=>(
                <Marker key={`wp-${i}`} position={[w.lat,w.lng]} icon={mkIcon("#f59e0b")}>
                  <Popup><strong>{w.name}</strong>{w.note&&<><br/>{w.note}</>}</Popup>
                </Marker>
              ))}
              <FitBounds coords={selected.coordinates}/>
            </MapContainer>
          ):(
            <div style={{ height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, position:"relative", zIndex:1 }}>
              <div style={{ fontSize:52, opacity:0.1 }}>🗺</div>
              <div style={{ color:"var(--text-muted)", fontSize:13 }}>
                {loadingTrack?<><span className="loading-spinner" style={{ width:20,height:20,display:"inline-block",marginRight:8 }}/> Loading track…</>:"Click 'View Map' on any track to show its route here"}
              </div>
            </div>
          )}
        </div>

        {selected&&(
          <div style={{ padding:"16px 20px", borderTop:"1px solid var(--border)", background:"rgba(59,130,246,0.03)" }}>
            <div style={{ display:"flex", gap:24, flexWrap:"wrap", marginBottom:(selectedPhotos.length>0||selectedWaypoints.length>0)?16:0 }}>
              {[["User",selected.username],["Session",selected.sessionName],["Distance",fmtDist(selected.distanceMeters)],["Started",fmtDate(selected.startedAt)],["Ended",fmtDate(selected.endedAt)],["Duration",duration(selected.startedAt,selected.endedAt)],["Valid Pts",validPointCount],["Total Pts",totalPointCount]].map(([k,v])=>(
                <div key={k}>
                  <div style={{ fontSize:9, fontWeight:700, color:"var(--text-muted)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:3, fontFamily:"var(--mono)" }}>{k}</div>
                  <div style={{ fontSize:13, color:"var(--text-primary)", fontWeight:600 }}>{v}</div>
                </div>
              ))}
            </div>

            {selectedPhotos.length>0&&(
              <div style={{ marginBottom: selectedWaypoints.length>0?16:0 }}>
                <div style={{ fontSize:9, fontWeight:700, color:"var(--text-muted)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, fontFamily:"var(--mono)" }}>
                  Photos ({selectedPhotos.length})
                </div>
                <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:4 }}>
                  {selectedPhotos.map((p,i)=>(
                    <PhotoCard key={i} photo={p} index={i} onLightbox={(idx)=>setLightbox({photos:selectedPhotos,index:idx})} onDownload={downloadPhoto}/>
                  ))}
                </div>
              </div>
            )}

            {selectedWaypoints.length>0&&(
              <div>
                <div style={{ fontSize:9, fontWeight:700, color:"var(--text-muted)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, fontFamily:"var(--mono)" }}>
                  Waypoints ({selectedWaypoints.length})
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {selectedWaypoints.map((w,i)=>(
                    <WaypointCard key={i} wp={w}/>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ position:"relative", maxWidth:340, marginBottom:20 }}>
        <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--text-muted)" }}><Icons.Search/></div>
        <input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by track name or user…" style={{ paddingLeft:38 }}/>
      </div>

      {loading?<div style={{ display:"flex", justifyContent:"center", padding:60 }}><div className="loading-spinner"/></div>:(
        <div className="card" style={{ overflow:"hidden" }}>
          <div style={{ overflowX:"auto" }} className="scrollbar-thin">
            <table>
              <thead><tr><th>ID</th><th>Name</th><th>User</th><th>Session</th><th>Started</th><th>Ended</th><th>Duration</th><th>Distance</th><th>Points</th><th>Photos</th><th>Waypoints</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(t=>(
                  <tr key={t.id} style={{ background:selected?.id===t.id?"rgba(59,130,246,0.08)":"transparent" }}>
                    <td><span style={{ fontFamily:"var(--mono)", fontSize:11, color:"var(--text-muted)" }}>#{t.id}</span></td>
                    <td><span style={{ fontWeight:600, color:"var(--text-primary)" }}>{t.name||"Field Track"}</span></td>
                    <td>{t.username}</td>
                    <td><span style={{ fontSize:11.5, color:"var(--text-muted)" }}>{t.sessionName}</span></td>
                    <td><span style={{ fontFamily:"var(--mono)", fontSize:11.5 }}>{fmtDate(t.startedAt)}</span></td>
                    <td>{t.endedAt?<span style={{ fontFamily:"var(--mono)", fontSize:11.5 }}>{fmtDate(t.endedAt)}</span>:<span className="badge badge-green">● Live</span>}</td>
                    <td>{duration(t.startedAt,t.endedAt)}</td>
                    <td><span style={{ fontFamily:"var(--mono)", fontSize:12, color:"var(--cyan)" }}>{fmtDist(t.distanceMeters)}</span></td>
                    <td><span style={{ fontFamily:"var(--mono)", fontSize:11.5 }}>{t.pointCount??"-"}</span></td>
                    <td><PhotoCell track={t} onOpen={(photos,idx)=>setLightbox({photos,index:idx})}/></td>
                    <td><WaypointsCell track={t}/></td>
                    <td>
                      <div style={{ display:"flex", gap:6 }}>
                        <button className={`btn ${selected?.id===t.id?"btn-warning":"btn-ghost"}`} onClick={()=>viewTrack(t.id)}>{selected?.id===t.id?"✓ Shown":"View Map"}</button>
                        <button className="btn btn-success" onClick={async()=>{const full=await api(`/api/admin/tracks/${t.id}`);downloadCSV(full);}}><Icons.Download/></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length===0&&<tr><td colSpan={12} style={{ textAlign:"center", padding:48, color:"var(--text-muted)" }}>No tracks found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {total>20&&(
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:16, alignItems:"center" }}>
          <button onClick={()=>load(page-1)} disabled={page===0} className="btn btn-ghost">← Prev</button>
          <span style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"var(--mono)" }}>Page {page+1} / {Math.ceil(total/20)}</span>
          <button onClick={()=>load(page+1)} disabled={(page+1)*20>=total} className="btn btn-ghost">Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Main AdminDashboard ───────────────────────────────────────────────────────
export default function AdminDashboard() {
  console.log("🟢 [AdminDashboard] component function invoked at:", new Date().toISOString());
  const navigate = useNavigate();
  const [tab, setTab] = useState("tracks");
  const [toast, setToast] = useState(null);
  const showToast = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); };
  const logout = async () => {
    try { await logoutUser(); } catch (_) {}
    navigate("/login", { replace: true });
  };
  const navItems = [
    {key:"tracks",label:"Tracks",icon:<Icons.Map/>},
    {key:"analytics",label:"Analytics",icon:<Icons.Chart/>},
    {key:"users",label:"Users",icon:<Icons.Users/>},
    {key:"sessions",label:"Sessions",icon:<Icons.Sessions/>},
  ];

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg-base)", fontFamily:"var(--font)" }}>
      <GlobalStyles/>
      <Toast toast={toast}/>
      <nav style={{ background:"rgba(8,12,20,0.95)", borderBottom:"1px solid var(--border)", padding:"0 24px", display:"flex", alignItems:"center", height:54, position:"sticky", top:0, zIndex:300, backdropFilter:"blur(20px)", gap:2 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginRight:20, paddingRight:20, borderRight:"1px solid var(--border)" }}>
          <div style={{ width:30, height:30, borderRadius:9, background:"linear-gradient(135deg,#3b82f6,#1d4ed8)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 12px rgba(59,130,246,0.35)" }}><Icons.MapPin/></div>
          <div><div style={{ fontSize:14, fontWeight:800, color:"var(--text-primary)", letterSpacing:"-0.01em" }}>GeoXis</div><div style={{ fontSize:9, color:"#3b82f6", letterSpacing:"0.12em", fontWeight:700 }}>ADMIN</div></div>
        </div>
        {navItems.map(t=><div key={t.key} className={`nav-tab ${tab===t.key?"active":""}`} onClick={()=>setTab(t.key)}>{t.icon}{t.label}</div>)}
        <div style={{ flex:1 }}/>
        <div style={{ display:"flex", gap:8 }}>
          <button className="btn btn-ghost" onClick={()=>navigate("/")}><Icons.Arrow dir="left"/> Map</button>
          <button className="btn btn-danger" onClick={logout}><Icons.Logout/> Logout</button>
        </div>
      </nav>
      <main style={{ padding:"28px 28px", maxWidth:1480, margin:"0 auto" }}>
        {tab==="tracks"    && <TracksTab showToast={showToast}/>}
        {tab==="analytics" && <AnalyticsTab/>}
        {tab==="users"     && <UsersTab showToast={showToast}/>}
        {tab==="sessions"  && <SessionsTab/>}
      </main>
    </div>
  );
}