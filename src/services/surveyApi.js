import { BASE_URL } from "./apiConfig";

const BASE = BASE_URL;

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("accessToken") || ""}`,
});

const throwIfNotOk = async (res) => {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.message || j.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
};

// ── Convert base64 dataURL → Blob WITHOUT fetch() ─────────────────────────
// fetch(dataURL) fails on Android WebView for large images (>2MB).
function dataURLtoBlob(dataURL) {
  try {
    const [header, base64] = dataURL.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch (e) {
    console.warn("[dataURLtoBlob] failed:", e.message);
    return null;
  }
}

// ── AUTH ──────────────────────────────────────────────────────────────────
export const isLoggedIn = () => !!localStorage.getItem("accessToken");
export const getLoggedInUser = () => ({
  username: localStorage.getItem("username") || null,
  email:    localStorage.getItem("email")    || null,
  role:     localStorage.getItem("role")     || null,
});

// ── SESSIONS ──────────────────────────────────────────────────────────────
export const createSession = async ({ name = "Field Survey", description = "" } = {}) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${BASE}/api/sessions`, {
    method: "POST", headers: authHeaders(),
    body: JSON.stringify({ clientId, name, description }),
  });
  return throwIfNotOk(res);
};

export const getSessions = async () => {
  const res = await fetch(`${BASE}/api/sessions`, { headers: authHeaders() });
  return throwIfNotOk(res);
};

export const completeSession = async (sessionId) => {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/complete`, {
    method: "PATCH", headers: authHeaders(),
  });
  return throwIfNotOk(res);
};

// ── TRACKS ────────────────────────────────────────────────────────────────
export const saveTrack = async (
  sessionClientId,
  points,
  {
    name           = "Field Track",
    startedAt      = null,
    endedAt        = null,
    distanceMeters = 0,
    photos         = [],        // ← NEW: full array [{dataURL, filename, name, note, lat, lng, time}]
    photoDataURL   = null,      // ← legacy single photo fallback
    photoFilename  = "photo.jpg",
    photoName      = null,
    photoNote      = null,
  } = {}
) => {
  if (!points || points.length < 2) return null;

  const clientId    = `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const coordinates = points.map((p) =>
    Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]
  );

  // ── Normalise: prefer photos[], else fall back to legacy single photo ──
  const allPhotos = photos && photos.length > 0
    ? photos
    : photoDataURL
      ? [{ dataURL: photoDataURL, filename: photoFilename, name: photoName, note: photoNote, lat: null, lng: null, time: null }]
      : [];

  console.log(`[saveTrack] allPhotos count: ${allPhotos.length}`);

  // ── Send multipart/form-data when photos exist ────────────────────────
  if (allPhotos.length > 0) {
    const form = new FormData();
    form.append("clientId",        clientId);
    form.append("sessionClientId", sessionClientId);
    form.append("name",            name);
    form.append("coordinates",     JSON.stringify(coordinates));
    form.append("distanceMeters",  String(distanceMeters));
    if (startedAt) form.append("startedAt", startedAt);
    if (endedAt)   form.append("endedAt",   endedAt);

    const photosMeta  = [];
    let   successCount = 0;

    for (let i = 0; i < allPhotos.length; i++) {
      const p = allPhotos[i];
      if (!p.dataURL) {
        console.warn(`[saveTrack] photo_${i} has no dataURL — skipping`);
        continue;
      }

      // Use dataURLtoBlob() — works for ALL sizes on Android, never fails
      const blob = dataURLtoBlob(p.dataURL);
      if (!blob) {
        console.warn(`[saveTrack] photo_${i} blob conversion failed — skipping`);
        continue;
      }

      const filename = p.filename || `photo_${i + 1}.jpg`;
      const file     = new File([blob], filename, { type: blob.type || "image/jpeg" });

      form.append(`photo_${i}`, file);
      photosMeta.push({
        index:    i,
        filename,
        name:     p.name  || `Photo ${i + 1}`,
        note:     p.note  || null,
        lat:      p.lat   != null ? p.lat  : null,
        lng:      p.lng   != null ? p.lng  : null,
        time:     p.time  || null,
      });
      successCount++;
      console.log(`[saveTrack] attached photo_${i}: ${filename} (${Math.round(blob.size/1024)}KB)`);
    }

    if (successCount > 0) {
      form.append("photosMeta", JSON.stringify(photosMeta));
      form.append("photoName",  photosMeta[0]?.name || "");
      form.append("photoNote",  photosMeta[0]?.note || "");

      console.log(`[saveTrack] sending ${successCount}/${allPhotos.length} photo(s) for: ${name}`);

      try {
        const res = await fetch(`${BASE}/api/tracks`, {
          method:  "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("accessToken") || ""}` },
          body:    form,
        });
        return throwIfNotOk(res);
      } catch (err) {
        console.warn("[saveTrack] multipart POST failed:", err.message);
        // fall through to JSON fallback
      }
    }
  }

  // ── Fallback: JSON without photos ─────────────────────────────────────
  console.log("[saveTrack] sending JSON (no photos)");
  const res = await fetch(`${BASE}/api/tracks`, {
    method:  "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      clientId, sessionClientId, name, coordinates, distanceMeters,
      startedAt:  startedAt  || undefined,
      endedAt:    endedAt    || undefined,
      photoName:  photoName  || undefined,
      photoNote:  photoNote  || undefined,
    }),
  });
  return throwIfNotOk(res);
};

export const getTracksForSession = async (sessionClientId) => {
  const res = await fetch(`${BASE}/api/tracks/session/${sessionClientId}`, {
    headers: authHeaders(),
  });
  return throwIfNotOk(res);
};

export const bulkSync = async (payload) => {
  const res = await fetch(`${BASE}/api/sync`, {
    method: "POST", headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return throwIfNotOk(res);
};