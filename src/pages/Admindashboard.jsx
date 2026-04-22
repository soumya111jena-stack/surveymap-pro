/**
 * AdminDashboard.jsx — SurveyMap Pro v2.1
 * Tabs: Tracks · Analytics · Users · Sessions
 *
 * v2.1 fixes:
 *  - Filter out invalid [0,0] / [0,lat] / [lng,0] coordinates before
 *    rendering polyline and FitBounds — prevents map flying to Gulf of Guinea
 *  - pointCount fallback from coordinates.length when API returns null
 *  - Photo modal already correctly uses BASE prefix — confirmed working
 *  - Track detail strip shows cleaned waypoint count
 */

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const BASE = "http://localhost:8080";
const hdrs = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("accessToken") || ""}`,
});

const api = async (path, opts = {}) => {
  const r = await fetch(`${BASE}${path}`, { headers: hdrs(), ...opts });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `HTTP ${r.status}`); }
  return r.json();
};

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── Formatters ────────────────────────────────────────────────────────────
const fmtDist  = (m) => !m ? "0 m" : m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${Math.round(m)} m`;
const fmtDate  = (d) => d ? new Date(d).toLocaleString("en-IN", { dateStyle:"short", timeStyle:"short" }) : "—";
const fmtShort = (d) => d ? new Date(d).toLocaleDateString("en-IN") : "—";
const duration = (s, e) => {
  if (!s || !e) return "—";
  const ms = new Date(e) - new Date(s);
  if (ms < 0) return "—";
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

// ── Coordinate cleaner ────────────────────────────────────────────────────
// Filters out invalid points where lng=0 or lat=0 (GPS sensor glitches,
// DevTools Sensors switching delay, or PostGIS null coordinate artifacts).
// Backend stores [lng, lat] pairs — we validate both are non-zero and finite.
function cleanCoords(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  return coordinates.filter(([lng, lat]) =>
    isFinite(lng) && isFinite(lat) &&
    lng !== 0 && lat !== 0 &&
    Math.abs(lng) <= 180 && Math.abs(lat) <= 90
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const C = {
  page:  { minHeight:"100vh", background:"#060e1a", color:"#c8e1f8", fontFamily:"'DM Sans',sans-serif" },
  nav:   { background:"rgba(5,12,24,0.98)", borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"0 24px", display:"flex", alignItems:"center", height:52, position:"sticky", top:0, zIndex:300, gap:4 },
  logo:  { display:"flex", alignItems:"center", gap:10, marginRight:20, paddingRight:20, borderRight:"1px solid rgba(255,255,255,0.07)" },
  tab:   (a) => ({ padding:"0 16px", height:"100%", display:"flex", alignItems:"center", fontSize:13, fontWeight:a?700:400, color:a?"#80c4ff":"rgba(200,225,255,0.4)", cursor:"pointer", borderBottom:a?"2px solid #4a9eff":"2px solid transparent", userSelect:"none" }),
  body:  { padding:24, maxWidth:1500, margin:"0 auto" },
  card:  { background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20, marginBottom:20 },
  th:    { padding:"10px 14px", fontSize:10.5, fontWeight:700, color:"rgba(255,255,255,0.28)", letterSpacing:"0.08em", textTransform:"uppercase", borderBottom:"1px solid rgba(255,255,255,0.07)", whiteSpace:"nowrap", textAlign:"left" },
  td:    { padding:"11px 14px", fontSize:12.5, color:"rgba(200,225,255,0.7)", borderBottom:"1px solid rgba(255,255,255,0.04)", verticalAlign:"middle" },
  btn:   (c = "#4a9eff", bg) => ({ padding:"5px 13px", borderRadius:7, border:`1px solid ${c}55`, background: bg || `${c}18`, color:c, fontSize:11.5, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }),
  badge: (c) => ({ display:"inline-block", padding:"2px 9px", borderRadius:20, fontSize:11, fontWeight:700, background:`${c}18`, border:`1px solid ${c}44`, color:c }),
  stat:  (c) => ({ flex:1, minWidth:140, background:`${c}09`, border:`1px solid ${c}33`, borderRadius:10, padding:"16px 20px" }),
};

// ── Map fit helper ────────────────────────────────────────────────────────
// Uses cleaned coordinates — never tries to fit [0,0] points
function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords?.length >= 2) {
      const clean = cleanCoords(coords);
      if (clean.length >= 2) {
        try {
          map.fitBounds(
            L.latLngBounds(clean.map(([lng, lat]) => [lat, lng])),
            { padding: [40, 40] }
          );
        } catch(_) {}
      }
    }
  }, [coords, map]);
  return null;
}

// ── Photo Modal ────────────────────────────────────────────────────────────
// photoUrl is the raw DB path e.g. "/uploads/tracks/track_123.jpg"
// We prepend BASE so it resolves to http://localhost:8080/uploads/tracks/...
// Make sure Express has: app.use('/uploads', express.static('uploads'))
function PhotoModal({ url, onClose }) {
  if (!url) return null;
  const fullUrl = url.startsWith("http") ? url : `${BASE}${url}`;
  return (
    <div
      onClick={onClose}
      style={{
        position:"fixed", inset:0, zIndex:9000,
        background:"rgba(0,0,0,0.88)",
        display:"flex", alignItems:"center", justifyContent:"center",
        backdropFilter:"blur(12px)", cursor:"zoom-out",
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ position:"relative", maxWidth:"90vw", maxHeight:"90vh" }}>
        <img
          src={fullUrl}
          alt="Track photo"
          onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
          style={{ maxWidth:"90vw", maxHeight:"85vh", borderRadius:12, boxShadow:"0 24px 80px rgba(0,0,0,0.8)", display:"block" }}
        />
        {/* Fallback when image fails to load */}
        <div style={{
          display:"none", flexDirection:"column", alignItems:"center", justifyContent:"center",
          width:320, height:240, borderRadius:12, background:"rgba(255,255,255,0.04)",
          border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", fontSize:13, gap:8,
        }}>
          <span style={{ fontSize:32 }}>📷</span>
          <span>Photo not available</span>
          <span style={{ fontSize:10, opacity:0.5 }}>{fullUrl}</span>
        </div>
        <button
          onClick={onClose}
          style={{
            position:"absolute", top:-14, right:-14,
            width:32, height:32, borderRadius:"50%",
            background:"rgba(239,68,68,0.9)", border:"none",
            color:"#fff", fontSize:18, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700,
          }}
        >×</button>
        <a
          href={fullUrl} target="_blank" rel="noreferrer"
          style={{
            ...C.btn("#4ade80"),
            display:"inline-block", marginTop:10,
            textDecoration:"none", textAlign:"center",
            width:"100%", boxSizing:"border-box",
          }}
        >↗ Open Full Size</a>
      </div>
    </div>
  );
}

// ── CSV Download ───────────────────────────────────────────────────────────
function downloadCSV(track) {
  // Use cleaned coordinates for CSV too — skip [0,0] glitch points
  const rawCoords = track.coordinates || [];
  const coords    = cleanCoords(rawCoords);

  if (!coords.length) { alert("No valid waypoints in this track."); return; }

  const startTime = track.startedAt ? new Date(track.startedAt).getTime() : null;
  const endTime   = track.endedAt   ? new Date(track.endedAt).getTime()   : null;
  const total     = coords.length;

  const header = "point,latitude,longitude,timestamp\n";
  const rows   = coords.map(([lng, lat], i) => {
    let ts = "";
    if (startTime) {
      const fraction = total > 1 ? i / (total - 1) : 0;
      const ms = endTime
        ? startTime + fraction * (endTime - startTime)
        : startTime + i * 1000;
      ts = new Date(ms).toISOString();
    }
    return `${i + 1},${lat},${lng},${ts}`;
  }).join("\n");

  const blob = new Blob([header + rows], { type: "text/csv" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `track_${track.name || track.id}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACKS TAB
// ═══════════════════════════════════════════════════════════════════════════
function TracksTab() {
  const [tracks,       setTracks]       = useState([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [mapKey,       setMapKey]       = useState(0);
  const [photoUrl,     setPhotoUrl]     = useState(null);

  const load = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const d = await api(`/api/admin/tracks?page=${p}&size=20`);
      setTracks(d.tracks || []);
      setTotal(d.total  || 0);
      setPage(p);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(0); }, [load]);

  const viewTrack = async (id) => {
    setLoadingTrack(true);
    try {
      const t = await api(`/api/admin/tracks/${id}`);
      setSelected(t);
      setMapKey(k => k + 1);
    } catch(e) { console.error(e); }
    finally { setLoadingTrack(false); }
  };

  // Clean coordinates — filter [0,0], [0,lat], [lng,0] artifacts
  const cleanedCoords = cleanCoords(selected?.coordinates || []);

  // Leaflet needs [lat, lng] — backend stores [lng, lat]
  const leafletCoords = cleanedCoords.map(([lng, lat]) => [lat, lng]);
  const startPt = leafletCoords[0];
  const endPt   = leafletCoords[leafletCoords.length - 1];

  // Valid point count (excluding glitch [0,0] points)
  const validPointCount = cleanedCoords.length;
  const totalPointCount = selected?.coordinates?.length || 0;
  const hasGlitchPoints = totalPointCount > validPointCount;

  const mkIcon = (color) => L.divIcon({
    html: `<div style="width:11px;height:11px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color}88"></div>`,
    className: "", iconAnchor: [6, 6],
  });

  return (
    <div>
      {/* Photo Modal */}
      <PhotoModal url={photoUrl} onClose={() => setPhotoUrl(null)} />

      {/* ── Map Panel ── */}
      <div style={{ ...C.card, padding:0, overflow:"hidden" }}>
        {/* Header */}
        <div style={{ padding:"14px 20px", borderBottom:"1px solid rgba(255,255,255,0.07)", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <span style={{ fontSize:18 }}>🗺</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#c8e1f8" }}>
              {selected ? selected.name : "Track Map"}
            </div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>
              {selected
                ? `${selected.username} · ${selected.sessionName} · ${fmtDist(selected.distanceMeters)} · ${validPointCount} valid pts${hasGlitchPoints ? ` (${totalPointCount - validPointCount} filtered)` : ""}`
                : loadingTrack ? "Loading track…" : "Click 'View Map' on any track to show its route here"}
            </div>
          </div>
          {selected && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {selected.photoUrl && (
                <button onClick={() => setPhotoUrl(selected.photoUrl)} style={C.btn("#c4b5fd")}>📷 View Photo</button>
              )}
              <button onClick={() => downloadCSV(selected)} style={C.btn("#4ade80")}>↓ CSV</button>
              <button onClick={() => setSelected(null)} style={C.btn("#f87171")}>✕ Close</button>
            </div>
          )}
        </div>

        {/* Map */}
        <div style={{ height:400, background:"#0a1628" }}>
          {selected && leafletCoords.length >= 2 ? (
            <MapContainer
              key={mapKey}
              center={leafletCoords[Math.floor(leafletCoords.length / 2)]}
              zoom={14}
              zoomControl
              style={{ width:"100%", height:"100%" }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="© OpenStreetMap"
                maxZoom={19}
              />
              <Polyline positions={leafletCoords} color="#4a9eff" weight={4} opacity={0.88} />
              {startPt && (
                <Marker position={startPt} icon={mkIcon("#4ade80")}>
                  <Popup><strong>Start</strong><br />{fmtDate(selected.startedAt)}</Popup>
                </Marker>
              )}
              {endPt && startPt !== endPt && (
                <Marker position={endPt} icon={mkIcon("#f87171")}>
                  <Popup><strong>End</strong><br />{fmtDate(selected.endedAt)}</Popup>
                </Marker>
              )}
              {/* FitBounds uses cleaned coords — never fits to [0,0] */}
              <FitBounds coords={selected.coordinates} />
            </MapContainer>
          ) : selected && leafletCoords.length < 2 ? (
            <div style={{ height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10 }}>
              <div style={{ fontSize:32, opacity:0.3 }}>📍</div>
              <div style={{ color:"rgba(255,255,255,0.35)", fontSize:13 }}>
                Not enough valid coordinates to draw route
              </div>
              <div style={{ color:"rgba(255,255,255,0.18)", fontSize:11 }}>
                {totalPointCount} recorded, {validPointCount} valid (need ≥ 2)
              </div>
            </div>
          ) : (
            <div style={{ height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10 }}>
              <div style={{ fontSize:40, opacity:0.15 }}>🗺</div>
              <div style={{ color:"rgba(255,255,255,0.18)", fontSize:13 }}>
                {loadingTrack ? "⏳ Loading track route…" : "No track selected"}
              </div>
            </div>
          )}
        </div>

        {/* Detail strip */}
        {selected && (
          <div style={{ padding:"12px 20px", borderTop:"1px solid rgba(255,255,255,0.06)", background:"rgba(74,158,255,0.04)", display:"flex", gap:28, flexWrap:"wrap" }}>
            {[
              ["User",         selected.username],
              ["Session",      selected.sessionName],
              ["Distance",     fmtDist(selected.distanceMeters)],
              ["Started",      fmtDate(selected.startedAt)],
              ["Ended",        fmtDate(selected.endedAt)],
              ["Duration",     duration(selected.startedAt, selected.endedAt)],
              ["Valid Pts",    validPointCount],
              ["Total Pts",    totalPointCount],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.22)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:2 }}>{k}</div>
                <div style={{ fontSize:13, color:"#c8e1f8", fontWeight:600 }}>{v}</div>
              </div>
            ))}
            {hasGlitchPoints && (
              <div style={{ alignSelf:"center", padding:"4px 10px", borderRadius:8, background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.25)", color:"#fbbf24", fontSize:10, fontWeight:600 }}>
                ⚠ {totalPointCount - validPointCount} invalid point{totalPointCount - validPointCount !== 1 ? "s" : ""} filtered (lng=0 or lat=0)
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Tracks Table ── */}
      <div style={C.card}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"#c8e1f8" }}>All Tracking Records</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)" }}>{total} total</div>
        </div>

        {loading ? (
          <div style={{ textAlign:"center", padding:48, color:"rgba(255,255,255,0.25)" }}>Loading…</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  {["ID","Name","User","Session","Started","Ended","Duration","Distance","Pts","Photo","Map","CSV"].map(h => (
                    <th key={h} style={C.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tracks.map((t, i) => (
                  <tr
                    key={t.id}
                    style={{ background: selected?.id === t.id ? "rgba(74,158,255,0.08)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}
                  >
                    <td style={C.td}>
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10.5, color:"rgba(255,255,255,0.3)" }}>#{t.id}</span>
                    </td>
                    <td style={C.td}><span style={{ fontWeight:600, color:"#c8e1f8" }}>{t.name || "Field Track"}</span></td>
                    <td style={C.td}>{t.username}</td>
                    <td style={C.td}><span style={{ fontSize:11, color:"rgba(255,255,255,0.45)" }}>{t.sessionName}</span></td>
                    <td style={C.td}><span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>{fmtDate(t.startedAt)}</span></td>
                    <td style={C.td}>
                      {t.endedAt
                        ? <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>{fmtDate(t.endedAt)}</span>
                        : <span style={C.badge("#4ade80")}>● Running</span>
                      }
                    </td>
                    <td style={C.td}>{duration(t.startedAt, t.endedAt)}</td>
                    <td style={C.td}>
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#38bdf8" }}>{fmtDist(t.distanceMeters)}</span>
                    </td>
                    <td style={C.td}>
                      {/* pointCount from list API — fallback to "—" if null */}
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>
                        {t.pointCount != null ? t.pointCount : "—"}
                      </span>
                    </td>
                    <td style={C.td}>
                      {t.photoUrl
                        ? (
                          <button
                            onClick={() => setPhotoUrl(t.photoUrl)}
                            style={C.btn("#c4b5fd")}
                          >📷 View</button>
                        )
                        : <span style={{ color:"rgba(255,255,255,0.18)", fontSize:11 }}>—</span>
                      }
                    </td>
                    <td style={C.td}>
                      <button
                        onClick={() => viewTrack(t.id)}
                        style={C.btn(selected?.id === t.id ? "#fbbf24" : "#4a9eff")}
                      >
                        {selected?.id === t.id ? "✓ Shown" : "View Map"}
                      </button>
                    </td>
                    <td style={C.td}>
                      <button
                        onClick={async () => {
                          try {
                            const full = await api(`/api/admin/tracks/${t.id}`);
                            downloadCSV(full);
                          } catch(e) { alert("Failed to fetch track: " + e.message); }
                        }}
                        style={C.btn("#4ade80")}
                      >↓ CSV</button>
                    </td>
                  </tr>
                ))}
                {tracks.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ ...C.td, textAlign:"center", padding:48, color:"rgba(255,255,255,0.18)", fontStyle:"italic" }}>
                      No tracks recorded yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {total > 20 && (
          <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:16, alignItems:"center" }}>
            <button onClick={() => load(page - 1)} disabled={page === 0} style={C.btn("#80c4ff")}>← Prev</button>
            <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>Page {page + 1} of {Math.ceil(total / 20)}</span>
            <button onClick={() => load(page + 1)} disabled={(page + 1) * 20 >= total} style={C.btn("#80c4ff")}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB
// ═══════════════════════════════════════════════════════════════════════════
function AnalyticsTab() {
  const [data, setData] = useState(null);
  useEffect(() => { api("/api/admin/analytics").then(setData).catch(console.error); }, []);
  if (!data) return <div style={{ textAlign:"center", padding:60, color:"rgba(255,255,255,0.25)" }}>Loading analytics…</div>;

  const stats = [
    { label:"Total Users",     value:data.totalUsers,                          icon:"👥", color:"#4a9eff" },
    { label:"Total Sessions",  value:data.totalSessions,                       icon:"📋", color:"#c4b5fd" },
    { label:"Total Tracks",    value:data.totalTracks,                         icon:"📍", color:"#4ade80" },
    { label:"Active Sessions", value:data.activeSessions,                      icon:"🔴", color:"#f87171" },
    { label:"Total Distance",  value:fmtDist(data.totalDistanceMeters || 0),   icon:"📏", color:"#38bdf8" },
  ];

  const maxBar = Math.max(...(data.tracksPerDay || []).map(d => d.count), 1);

  return (
    <div>
      <div style={{ display:"flex", gap:14, marginBottom:20, flexWrap:"wrap" }}>
        {stats.map(s => (
          <div key={s.label} style={C.stat(s.color)}>
            <div style={{ fontSize:24, marginBottom:6 }}>{s.icon}</div>
            <div style={{ fontSize:30, fontWeight:800, color:s.color, fontFamily:"'DM Mono',monospace" }}>{s.value}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {data.tracksPerDay?.length > 0 && (
        <div style={C.card}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:16, color:"#c8e1f8" }}>Tracks per Day — Last 30 days</div>
          <div style={{ display:"flex", gap:3, alignItems:"flex-end", height:80 }}>
            {data.tracksPerDay.map((d, i) => (
              <div
                key={i}
                title={`${d.date}: ${d.count} track${d.count !== 1 ? "s" : ""}`}
                style={{ flex:1, height:Math.max(4, (d.count / maxBar) * 72), background:"rgba(74,158,255,0.45)", borderRadius:"3px 3px 0 0", cursor:"default", transition:"background 0.12s" }}
                onMouseEnter={e => e.target.style.background = "rgba(74,158,255,0.85)"}
                onMouseLeave={e => e.target.style.background = "rgba(74,158,255,0.45)"}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════════════════
function UsersTab() {
  const [users,   setUsers]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const d = await api(`/api/admin/users?page=${p}&size=20`);
      setUsers(d.users || []);
      setTotal(d.total || 0);
      setPage(p);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(0); }, [load]);

  return (
    <div style={C.card}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#c8e1f8" }}>Users</div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)" }}>{total} total</div>
      </div>
      {loading ? (
        <div style={{ textAlign:"center", padding:40, color:"rgba(255,255,255,0.25)" }}>Loading…</div>
      ) : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>{["Username","Email","Role","Status","Joined","Actions"].map(h => <th key={h} style={C.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
                  <td style={C.td}><span style={{ fontWeight:600 }}>{u.username}</span></td>
                  <td style={C.td}><span style={{ fontSize:12, color:"rgba(255,255,255,0.45)" }}>{u.email}</span></td>
                  <td style={C.td}><span style={C.badge(u.role==="ADMIN"?"#f59e0b":"#4a9eff")}>{u.role}</span></td>
                  <td style={C.td}><span style={C.badge(u.enabled?"#4ade80":"#f87171")}>{u.enabled?"Active":"Disabled"}</span></td>
                  <td style={C.td}><span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>{fmtShort(u.createdAt)}</span></td>
                  <td style={{ ...C.td, display:"flex", gap:6 }}>
                    <button
                      onClick={async () => { await api(`/api/admin/users/${u.id}/toggle`,{method:"PATCH"}); load(page); }}
                      style={C.btn(u.enabled?"#f87171":"#4ade80")}
                    >{u.enabled?"Disable":"Enable"}</button>
                    <button
                      onClick={async () => { await api(`/api/admin/users/${u.id}/role`,{method:"PATCH",body:JSON.stringify({role:u.role==="ADMIN"?"USER":"ADMIN"})}); load(page); }}
                      style={C.btn("#f59e0b")}
                    >{u.role==="ADMIN"?"→ User":"→ Admin"}</button>
                    <button
                      onClick={async () => { if(!window.confirm("Delete user?")) return; await api(`/api/admin/users/${u.id}`,{method:"DELETE"}); load(page); }}
                      style={C.btn("#ef4444")}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSIONS TAB
// ═══════════════════════════════════════════════════════════════════════════
function SessionsTab() {
  const [sessions, setSessions] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(0);
  const [filter,   setFilter]   = useState("");
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async (p = 0, f = "") => {
    setLoading(true);
    try {
      const d = await api(`/api/admin/sessions?status=${f}&page=${p}&size=20`);
      setSessions(d.sessions || []);
      setTotal(d.total || 0);
      setPage(p);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(0, filter); }, [load, filter]);

  return (
    <div style={C.card}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#c8e1f8" }}>Sessions</div>
        <div style={{ display:"flex", gap:6 }}>
          {["","ACTIVE","COMPLETED"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={C.btn("#4a9eff", filter===f?"rgba(74,158,255,0.22)":"transparent")}>
              {f || "All"}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={{ textAlign:"center", padding:40, color:"rgba(255,255,255,0.25)" }}>Loading…</div>
      ) : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>{["Session","User","Status","Tracks","Started","Ended"].map(h => <th key={h} style={C.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={s.id} style={{ background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
                  <td style={C.td}>
                    <div style={{ fontWeight:600 }}>{s.name}</div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace" }}>{s.clientId}</div>
                  </td>
                  <td style={C.td}>{s.username}</td>
                  <td style={C.td}><span style={C.badge(s.status==="ACTIVE"?"#4ade80":"#80c4ff")}>{s.status}</span></td>
                  <td style={C.td}>{s.trackCount ?? 0}</td>
                  <td style={C.td}><span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>{fmtDate(s.startedAt)}</span></td>
                  <td style={C.td}><span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>{fmtDate(s.endedAt)}</span></td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...C.td, textAlign:"center", padding:40, color:"rgba(255,255,255,0.18)", fontStyle:"italic" }}>
                    No sessions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {total > 20 && (
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:16, alignItems:"center" }}>
          <button onClick={() => load(page - 1, filter)} disabled={page === 0} style={C.btn("#80c4ff")}>← Prev</button>
          <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>Page {page + 1} of {Math.ceil(total / 20)}</span>
          <button onClick={() => load(page + 1, filter)} disabled={(page + 1) * 20 >= total} style={C.btn("#80c4ff")}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("tracks");

  const logout = () => { localStorage.clear(); navigate("/login", { replace:true }); };

  return (
    <div style={C.page}>
      <div style={C.nav}>
        <div style={C.logo}>
          <div style={{ width:28, height:28, borderRadius:7, background:"linear-gradient(135deg,#4a9eff,#2563eb)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#fff" stroke="none"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:"#c8e1f8", lineHeight:1 }}>SurveyMap Pro</div>
            <div style={{ fontSize:9, color:"rgba(74,158,255,0.6)", letterSpacing:"0.08em" }}>ADMIN PANEL</div>
          </div>
        </div>

        {[
          { key:"tracks",    label:"🗺  Tracks"   },
          { key:"analytics", label:"📊 Analytics" },
          { key:"users",     label:"👥 Users"     },
          { key:"sessions",  label:"📋 Sessions"  },
        ].map(t => (
          <div key={t.key} style={C.tab(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</div>
        ))}

        <div style={{ flex:1 }} />
        <button onClick={() => navigate("/")} style={{ ...C.btn("#80c4ff"), marginRight:8 }}>← Map</button>
        <button onClick={logout} style={C.btn("#f87171")}>Logout</button>
      </div>

      <div style={C.body}>
        {tab === "tracks"    && <TracksTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "users"     && <UsersTab />}
        {tab === "sessions"  && <SessionsTab />}
      </div>
    </div>
  );
}