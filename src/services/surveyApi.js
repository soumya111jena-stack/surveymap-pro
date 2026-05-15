import { BASE_URL } from "./apiConfig";

const BASE = BASE_URL;

const CLOUDINARY_CLOUD_NAME    = "dmqqvyc6w";
const CLOUDINARY_UPLOAD_PRESET = "geoxis_tracks"; // unsigned preset

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

// Compress image before upload (reduces size from ~3MB to ~200KB)
async function compressImage(dataURL, maxWidth = 1024, quality = 0.6) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(dataURL);
      img.src = dataURL;
    } catch (e) {
      resolve(dataURL);
    }
  });
}

// ── Upload a single blob directly to Cloudinary (bypasses Render) ──────────
async function uploadToCloudinaryDirect(blob, filename) {
  try {
    const form = new FormData();
    form.append("file", new File([blob], filename, { type: blob.type || "image/jpeg" }));
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    form.append("folder", "geoxis/tracks");
    form.append("public_id", filename.replace(/\.[^.]+$/, "")); // strip extension

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: "POST", body: form }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[cloudinary] upload error:", err);
      return null;
    }

    const data = await res.json();
    console.log("[cloudinary] upload success:", data.secure_url);
    return data.secure_url;
  } catch (e) {
    console.error("[cloudinary] upload exception:", e.message);
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
    photos         = [],        // [{dataURL, filename, name, note, lat, lng, time}]
    photoDataURL   = null,      // legacy single photo fallback
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

  // Normalise: prefer photos[], else fall back to legacy single photo
  const allPhotos = photos && photos.length > 0
    ? photos
    : photoDataURL
      ? [{ dataURL: photoDataURL, filename: photoFilename, name: photoName, note: photoNote, lat: null, lng: null, time: null }]
      : [];

  console.log(`[saveTrack] allPhotos count: ${allPhotos.length}`);

  // ── STEP 1: Upload all photos directly to Cloudinary ──────────────────
  // Bypasses Render entirely. No multer, no timeout.
  const uploadedPhotos = [];

  for (let i = 0; i < allPhotos.length; i++) {
    const p = allPhotos[i];
    if (!p.dataURL) {
      console.warn(`[saveTrack] photo_${i} has no dataURL — skipping`);
      continue;
    }

    const compressedDataURL = await compressImage(p.dataURL, 1024, 0.6);
    console.log(`[saveTrack] compressed photo_${i}`);

    const blob = dataURLtoBlob(compressedDataURL);
    if (!blob) {
      console.warn(`[saveTrack] photo_${i} blob conversion failed — skipping`);
      continue;
    }

    const filename = p.filename || `photo_${Date.now()}_${i}.jpg`;
    const url = await uploadToCloudinaryDirect(blob, filename);

    if (url) {
      uploadedPhotos.push({
        index: i,
        url,
        name:  p.name || `Photo ${i + 1}`,
        note:  p.note || null,
        lat:   p.lat  != null ? p.lat : null,
        lng:   p.lng  != null ? p.lng : null,
        time:  p.time || null,
      });
    } else {
      console.warn(`[saveTrack] photo_${i} Cloudinary upload failed — skipping`);
    }
  }

  console.log(`[saveTrack] ${uploadedPhotos.length}/${allPhotos.length} photo(s) uploaded to Cloudinary`);

  // ── STEP 2: Build waypointsMeta entries (same shape backend already uses)
  const photoWaypoints = uploadedPhotos.map(p => ({
    photo: true,
    url:   p.url,
    name:  p.name,
    note:  p.note,
    lat:   p.lat,
    lng:   p.lng,
    time:  p.time,
  }));

  const firstPhoto = uploadedPhotos[0];

  // ── STEP 3: POST plain JSON to backend (no binary files, no multer timeout)
  // Your existing tracks.js backend reads:
  //   body.coordinates, body.photoUrl, body.photoName, body.photoNote,
  //   body.photosMeta (JSON string), body.waypointsMeta (JSON string)
  // All of that is preserved here — backend needs ZERO changes.
  const payload = {
    clientId,
    sessionClientId,
    name,
    coordinates:    JSON.stringify(coordinates),  // backend does JSON.parse()
    distanceMeters: String(distanceMeters),
    startedAt:      startedAt || undefined,
    endedAt:        endedAt   || undefined,

    // Legacy single-photo fields (backward compat with your backend SQL)
    photoUrl:  firstPhoto?.url  || undefined,
    photoName: firstPhoto?.name || photoName || undefined,
    photoNote: firstPhoto?.note || photoNote || undefined,

    // Multi-photo meta — backend iterates this to build waypointsMeta
    photosMeta: JSON.stringify(
      uploadedPhotos.map(p => ({
        index:    p.index,
        filename: `cloudinary_${p.index}`,
        name:     p.name,
        note:     p.note,
        lat:      p.lat,
        lng:      p.lng,
        time:     p.time,
      }))
    ),

    // Pre-built waypointsMeta so backend merges correctly
    waypointsMeta: JSON.stringify(photoWaypoints),
  };

  console.log("[saveTrack] sending JSON to backend (no binary files)");

  const res = await fetch(`${BASE}/api/tracks`, {
    method:  "POST",
    headers: authHeaders(), // Content-Type: application/json
    body:    JSON.stringify(payload),
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