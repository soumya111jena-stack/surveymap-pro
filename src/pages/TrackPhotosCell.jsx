/**
 * TrackPhotosCell.jsx  — GeoXis Admin Panel
 * ─────────────────────────────────────────────────────────────────────────
 * Shows ALL photos for a track in the admin table with:
 *   • Thumbnail strip inline in the table cell
 *   • Name + description visible on hover card
 *   • Full lightbox with name, description, coordinates, timestamp
 *   • Count badge
 *
 * Usage (table cell):
 *   import TrackPhotosCell from "./TrackPhotosCell";
 *   <td><TrackPhotosCell track={row} baseUrl={BASE_URL} /></td>
 *
 * Usage (detail drawer / full panel):
 *   import { TrackPhotoPanel } from "./TrackPhotosCell";
 *   <TrackPhotoPanel track={selectedTrack} baseUrl={BASE_URL} />
 */

import React, { useState, useEffect, useCallback } from "react";

/* ── design tokens matching GeoXis dark admin ─────────────────────────────── */
const C = {
  bg:        "#080d17",
  surface:   "rgba(255,255,255,0.032)",
  surfaceHi: "rgba(255,255,255,0.07)",
  border:    "rgba(255,255,255,0.07)",
  borderHi:  "rgba(255,255,255,0.14)",
  text:      "#dde8f8",
  textDim:   "rgba(180,205,240,0.5)",
  textFaint: "rgba(140,170,210,0.3)",
  blue:      "#4895ef",
  amber:     "#f4a261",
  green:     "#2dc653",
  red:       "#e63946",
  cyan:      "#4cc9f0",
};
const MONO = `"JetBrains Mono","Fira Code",ui-monospace,monospace`;
const UI   = `"DM Sans","Outfit",system-ui,sans-serif`;

/* ── helpers ──────────────────────────────────────────────────────────────── */
function getPhotos(track) {
  if (track.allPhotos?.length > 0) return track.allPhotos;
  const meta = track.waypointsMeta;
  if (meta) {
    const m = typeof meta === "string" ? tryParse(meta) : meta;
    if (m?.photoUrls?.length > 0) return m.photoUrls;
  }
  if (track.photoUrl) {
    return [{
      url:  track.photoUrl,
      name: track.photoName        || "Photo",
      note: track.photoDescription || null,
    }];
  }
  return [];
}

function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }

function absUrl(url, base) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${(base || "").replace(/\/$/, "")}${url}`;
}

function fmtTime(t) {
  if (!t) return null;
  try {
    return new Date(t).toLocaleString("en-IN", {
      day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return null; }
}

/* ── Lightbox ─────────────────────────────────────────────────────────────── */
function Lightbox({ photos, startIndex, baseUrl, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);
  const photo = photos[idx];

  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIdx(i => Math.min(photos.length - 1, i + 1)), [photos.length]);

  useEffect(() => {
    const h = (e) => {
      if (e.key === "ArrowLeft")  prev();
      if (e.key === "ArrowRight") next();
      if (e.key === "Escape")     onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [prev, next, onClose]);

  const timeStr = fmtTime(photo.time);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: "rgba(4,8,18,0.96)",
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: UI,
      }}
    >
      <style>{`
        @keyframes lbIn  { from{opacity:0}                           to{opacity:1} }
        @keyframes imgIn { from{transform:scale(.96);opacity:0}      to{transform:scale(1);opacity:1} }
        @keyframes hcUp  { from{opacity:0;transform:translateX(-50%) translateY(6px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>

      {/* top bar */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "absolute", top: 0, left: 0, right: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px",
          background: "linear-gradient(to bottom,rgba(4,8,18,0.9) 0%,transparent 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: C.textFaint, fontFamily: MONO, letterSpacing: ".08em" }}>
            PHOTO
          </span>
          <span style={{
            background: `${C.blue}22`, border: `1px solid ${C.blue}44`,
            color: C.blue, fontSize: 11, fontWeight: 700,
            padding: "2px 9px", borderRadius: 5, fontFamily: MONO,
          }}>
            {idx + 1} / {photos.length}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.08)", border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.textDim, fontSize: 16,
            width: 34, height: 34, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >✕</button>
      </div>

      {/* image */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: "relative", display: "flex", alignItems: "center" }}
      >
        {photos.length > 1 && (
          <button
            onClick={prev} disabled={idx === 0}
            style={{
              position: "absolute", left: -56, top: "50%", transform: "translateY(-50%)",
              background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}`,
              borderRadius: 10, color: "#fff", width: 42, height: 42,
              fontSize: 22, cursor: idx === 0 ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: idx === 0 ? 0.18 : 0.85, transition: "opacity .15s",
            }}
          >‹</button>
        )}

        <img
          key={idx}
          src={absUrl(photo.url, baseUrl)}
          alt={photo.name || `Photo ${idx + 1}`}
          style={{
            maxWidth: "80vw", maxHeight: "58vh",
            borderRadius: 14, display: "block",
            boxShadow: "0 32px 100px rgba(0,0,0,0.85)",
            objectFit: "contain",
            animation: "imgIn .2s cubic-bezier(.16,1,.3,1)",
          }}
        />

        {photos.length > 1 && (
          <button
            onClick={next} disabled={idx === photos.length - 1}
            style={{
              position: "absolute", right: -56, top: "50%", transform: "translateY(-50%)",
              background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}`,
              borderRadius: 10, color: "#fff", width: 42, height: 42,
              fontSize: 22, cursor: idx === photos.length - 1 ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: idx === photos.length - 1 ? 0.18 : 0.85, transition: "opacity .15s",
            }}
          >›</button>
        )}
      </div>

      {/* info card — name + description + coords + time */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          marginTop: 14, width: "min(500px, 84vw)",
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${C.borderHi}`,
          borderRadius: 12, padding: "14px 16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ flex: 1 }}>
            {/* name */}
            <div style={{
              color: C.text, fontWeight: 700, fontSize: 14, lineHeight: 1.3,
            }}>
              {photo.name || `Photo ${idx + 1}`}
            </div>

            {/* description */}
            {photo.note ? (
              <div style={{
                color: C.textDim, fontSize: 12, marginTop: 5,
                lineHeight: 1.55, fontStyle: "italic",
              }}>
                {photo.note}
              </div>
            ) : (
              <div style={{
                color: C.textFaint, fontSize: 11, marginTop: 4, fontStyle: "italic",
              }}>
                No description
              </div>
            )}
          </div>

          {/* timestamp */}
          {timeStr && (
            <div style={{
              color: C.textFaint, fontSize: 10, fontFamily: MONO,
              whiteSpace: "nowrap", marginTop: 2, flexShrink: 0,
            }}>
              {timeStr}
            </div>
          )}
        </div>

        {/* coordinates */}
        {photo.lat != null && photo.lng != null && (
          <div style={{
            marginTop: 10,
            color: C.cyan, fontSize: 10, fontFamily: MONO,
            background: "rgba(76,201,240,0.05)",
            border: "1px solid rgba(76,201,240,0.14)",
            borderRadius: 6, padding: "5px 9px",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <span>📍</span>
            {Number(photo.lat).toFixed(6)}, {Number(photo.lng).toFixed(6)}
          </div>
        )}
      </div>

      {/* thumbnail strip */}
      {photos.length > 1 && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            display: "flex", gap: 6, marginTop: 12,
            overflowX: "auto", maxWidth: "88vw", padding: "4px 2px",
          }}
        >
          {photos.map((p, i) => (
            <div
              key={i}
              onClick={() => setIdx(i)}
              style={{
                flexShrink: 0, cursor: "pointer",
                width: 52, height: 52, borderRadius: 8, overflow: "hidden",
                border: i === idx
                  ? `2.5px solid ${C.blue}`
                  : `2px solid rgba(255,255,255,0.1)`,
                opacity: i === idx ? 1 : 0.5,
                transition: "opacity .15s, border-color .15s",
              }}
            >
              <img
                src={absUrl(p.url, baseUrl)}
                alt={p.name || `Photo ${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Hover card ───────────────────────────────────────────────────────────── */
function HoverCard({ photo, baseUrl }) {
  const timeStr = fmtTime(photo.time);
  return (
    <div style={{
      position: "absolute", bottom: "calc(100% + 10px)", left: "50%",
      transform: "translateX(-50%)",
      zIndex: 9999,
      background: "#0d1525",
      border: `1px solid ${C.borderHi}`,
      borderRadius: 12,
      boxShadow: "0 16px 48px rgba(0,0,0,0.85)",
      width: 210, overflow: "hidden",
      pointerEvents: "none",
      animation: "hcUp .15s ease",
    }}>
      <img
        src={absUrl(photo.url, baseUrl)}
        alt={photo.name}
        style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
      />
      <div style={{ padding: "9px 11px 11px" }}>
        {/* name */}
        <div style={{
          color: C.text, fontWeight: 700, fontSize: 11.5, lineHeight: 1.3,
        }}>
          {photo.name || "Photo"}
        </div>

        {/* description */}
        <div style={{
          color: photo.note ? C.textDim : C.textFaint,
          fontSize: 10.5, marginTop: 4, lineHeight: 1.45,
          fontStyle: photo.note ? "italic" : "normal",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {photo.note || "No description"}
        </div>

        {/* time + coords */}
        <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 3 }}>
          {timeStr && (
            <span style={{ color: C.textFaint, fontSize: 9.5, fontFamily: MONO }}>
              {timeStr}
            </span>
          )}
          {photo.lat != null && (
            <span style={{ color: C.cyan, fontSize: 9, fontFamily: MONO, opacity: .7 }}>
              📍 {Number(photo.lat).toFixed(5)}, {Number(photo.lng).toFixed(5)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Single thumbnail with hover card ────────────────────────────────────── */
function Thumb({ photo, index, baseUrl, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      style={{ position: "relative", flexShrink: 0 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div
        onClick={() => onClick(index)}
        style={{
          width: 40, height: 40, borderRadius: 6, overflow: "hidden", cursor: "pointer",
          border: `1.5px solid ${hov ? C.blue : C.border}`,
          transform: hov ? "scale(1.1)" : "scale(1)",
          transition: "border-color .15s, transform .15s",
        }}
      >
        <img
          src={absUrl(photo.url, baseUrl)}
          alt={photo.name || `Photo ${index + 1}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
      {hov && <HoverCard photo={photo} baseUrl={baseUrl} />}
    </div>
  );
}

/* ── TABLE CELL (default export) ──────────────────────────────────────────── */
export default function TrackPhotosCell({ track, baseUrl }) {
  const [lbOpen,  setLbOpen]  = useState(false);
  const [lbStart, setLbStart] = useState(0);
  const photos = getPhotos(track);

  if (photos.length === 0) {
    return <span style={{ color: C.textFaint, fontSize: 12, fontFamily: MONO }}>—</span>;
  }

  const open = (i) => { setLbStart(i); setLbOpen(true); };

  return (
    <>
      {lbOpen && (
        <Lightbox
          photos={photos} startIndex={lbStart}
          baseUrl={baseUrl} onClose={() => setLbOpen(false)}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {photos.slice(0, 4).map((p, i) => (
          <Thumb key={i} photo={p} index={i} baseUrl={baseUrl} onClick={open} />
        ))}

        <div
          onClick={() => open(0)}
          style={{
            cursor: "pointer",
            background: `${C.blue}15`,
            border: `1px solid ${C.blue}32`,
            borderRadius: 6, padding: "3px 8px",
            color: C.blue, fontSize: 11, fontWeight: 700,
            fontFamily: MONO, userSelect: "none", whiteSpace: "nowrap",
          }}
          onMouseEnter={e => e.currentTarget.style.background = `${C.blue}28`}
          onMouseLeave={e => e.currentTarget.style.background = `${C.blue}15`}
        >
          🖼 {photos.length}
        </div>
      </div>
    </>
  );
}

/* ── FULL PANEL (named export — use in track detail drawer) ───────────────── */
export function TrackPhotoPanel({ track, baseUrl }) {
  const [lbOpen,  setLbOpen]  = useState(false);
  const [lbStart, setLbStart] = useState(0);
  const photos = getPhotos(track);
  if (photos.length === 0) return null;
  const open = (i) => { setLbStart(i); setLbOpen(true); };

  return (
    <>
      {lbOpen && (
        <Lightbox
          photos={photos} startIndex={lbStart}
          baseUrl={baseUrl} onClose={() => setLbOpen(false)}
        />
      )}

      <div style={{ fontFamily: UI }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 14 }}>📷</span>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>Photos</span>
          <span style={{
            background: `${C.amber}18`, border: `1px solid ${C.amber}30`,
            color: C.amber, fontSize: 10, fontWeight: 700,
            padding: "2px 8px", borderRadius: 5, fontFamily: MONO,
          }}>
            {photos.length}
          </span>
        </div>

        {/* grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
          gap: 10,
        }}>
          {photos.map((p, i) => {
            const timeStr = fmtTime(p.time);
            return (
              <div
                key={i}
                onClick={() => open(i)}
                style={{
                  borderRadius: 11, overflow: "hidden", cursor: "pointer",
                  background: C.surface, border: `1px solid ${C.border}`,
                  transition: "border-color .15s, transform .18s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = C.borderHi;
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* thumbnail */}
                <img
                  src={absUrl(p.url, baseUrl)}
                  alt={p.name || `Photo ${i + 1}`}
                  style={{ width: "100%", height: 115, objectFit: "cover", display: "block" }}
                />

                {/* info */}
                <div style={{ padding: "9px 11px 11px" }}>
                  {/* name */}
                  <div style={{
                    color: C.text, fontWeight: 600, fontSize: 11.5,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {p.name || `Photo ${i + 1}`}
                  </div>

                  {/* description */}
                  <div style={{
                    color: p.note ? C.textDim : C.textFaint,
                    fontSize: 10.5, marginTop: 4, lineHeight: 1.45,
                    fontStyle: p.note ? "italic" : "normal",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    minHeight: 26,
                  }}>
                    {p.note || "No description"}
                  </div>

                  {/* bottom meta row */}
                  <div style={{
                    display: "flex", alignItems: "center",
                    justifyContent: "space-between", marginTop: 7, gap: 4,
                  }}>
                    {timeStr ? (
                      <span style={{ color: C.textFaint, fontSize: 9.5, fontFamily: MONO }}>
                        {timeStr}
                      </span>
                    ) : <span />}

                    {p.lat != null && (
                      <span style={{
                        color: C.cyan, fontSize: 9, fontFamily: MONO,
                        background: "rgba(76,201,240,0.07)",
                        border: "1px solid rgba(76,201,240,0.15)",
                        borderRadius: 4, padding: "1px 5px",
                      }}>
                        📍 GPS
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}