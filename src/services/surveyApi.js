/**
 * surveyApi.js — SurveyMap Pro v2
 * Sessions + Tracks only (drawings removed)
 *
 * saveTrack now supports:
 *   - name, startedAt, endedAt, distanceMeters
 *   - photo upload via multipart/form-data (optional)
 */

const BASE = "http://localhost:8080";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("accessToken") || ""}`,
});

const throwIfNotOk = async (res) => {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.message || j.error || msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
};

// ── AUTH ──────────────────────────────────────────────────────────────────
export const isLoggedIn    = () => !!localStorage.getItem("accessToken");
export const getLoggedInUser = () => ({
  username: localStorage.getItem("username") || null,
  email:    localStorage.getItem("email")    || null,
  role:     localStorage.getItem("role")     || null,
});

// ── SESSIONS ──────────────────────────────────────────────────────────────
export const createSession = async ({ name = "Field Survey", description = "" } = {}) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${BASE}/api/sessions`, {
    method:  "POST",
    headers: authHeaders(),
    body:    JSON.stringify({ clientId, name, description }),
  });
  return throwIfNotOk(res);
};

export const getSessions = async () => {
  const res = await fetch(`${BASE}/api/sessions`, { headers: authHeaders() });
  return throwIfNotOk(res);
};

export const completeSession = async (sessionId) => {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/complete`, {
    method:  "PATCH",
    headers: authHeaders(),
  });
  return throwIfNotOk(res);
};

// ── TRACKS ────────────────────────────────────────────────────────────────

/**
 * saveTrack — saves a GPS track to the backend.
 *
 * @param {string} sessionClientId
 * @param {Array}  points          — array of {lat, lng} OR [lng, lat]
 * @param {Object} options
 *   @param {string}  options.name            — track name (default "Field Track")
 *   @param {string}  options.startedAt       — ISO timestamp when recording started
 *   @param {string}  options.endedAt         — ISO timestamp when recording stopped
 *   @param {number}  options.distanceMeters  — calculated distance in metres
 *   @param {string}  options.photoDataURL    — base64 data URL from camera (optional)
 *   @param {string}  options.photoFilename   — filename for the photo (optional)
 *
 * If photoDataURL is provided, sends multipart/form-data so multer can
 * handle the file. Otherwise sends application/json.
 */
export const saveTrack = async (
  sessionClientId,
  points,
  {
    name           = "Field Track",
    startedAt      = null,
    endedAt        = null,
    distanceMeters = 0,
    photoDataURL   = null,
    photoFilename  = "photo.jpg",
  } = {}
) => {
  if (!points || points.length < 2) return null;

  const clientId = `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Convert {lat,lng} objects OR [lat,lng] arrays → [lng,lat] for PostGIS
  const coordinates = points.map((p) =>
    Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]
  );

  // ── With photo: send multipart/form-data ──────────────────────────────
  if (photoDataURL) {
    try {
      // Convert base64 data URL → Blob
      const res0   = await fetch(photoDataURL);
      const blob   = await res0.blob();
      const file   = new File([blob], photoFilename, { type: blob.type || "image/jpeg" });

      const form = new FormData();
      form.append("clientId",        clientId);
      form.append("sessionClientId", sessionClientId);
      form.append("name",            name);
      form.append("coordinates",     JSON.stringify(coordinates));
      form.append("distanceMeters",  String(distanceMeters));
      if (startedAt) form.append("startedAt", startedAt);
      if (endedAt)   form.append("endedAt",   endedAt);
      form.append("photo", file);

      const res = await fetch(`${BASE}/api/tracks`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken") || ""}` },
        // ⚠ Do NOT set Content-Type — browser sets it with boundary automatically
        body: form,
      });
      return throwIfNotOk(res);
    } catch (err) {
      console.warn("[saveTrack] Photo upload failed, retrying without photo:", err.message);
      // Fall through to JSON upload without photo
    }
  }

  // ── Without photo: send application/json ─────────────────────────────
  const res = await fetch(`${BASE}/api/tracks`, {
    method:  "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      clientId,
      sessionClientId,
      name,
      coordinates,
      distanceMeters,
      startedAt:  startedAt || undefined,
      endedAt:    endedAt   || undefined,
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

// ── BULK SYNC ─────────────────────────────────────────────────────────────
export const bulkSync = async (payload) => {
  const res = await fetch(`${BASE}/api/sync`, {
    method:  "POST",
    headers: authHeaders(),
    body:    JSON.stringify(payload),
  });
  return throwIfNotOk(res);
};