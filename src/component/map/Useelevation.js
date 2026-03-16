/**
 * useElevation.js  —  src/component/map/useElevation.js
 *
 * Elevation data engine — works ONLINE and OFFLINE
 *
 * ONLINE:
 *   • Tries Open-Meteo elevation API (free, no API key, very fast)
 *   • Falls back to Open-Elevation API
 *   • Auto-caches every result in IndexedDB for offline reuse
 *
 * OFFLINE:
 *   • Reads previously cached elevation values from IndexedDB
 *   • Returns null for points not yet cached (shows "–" in UI)
 *
 * EXPORTS:
 *   useElevation()        → hook with getElevation, getElevationProfile, cursorElevation
 *   cacheElevationPoint() → save one lat/lng/elev to IDB (called during precache)
 */

import { useState, useCallback, useRef } from "react";

// ─── IndexedDB helpers ─────────────────────────────────────────────
const ELEV_DB    = "ElevationDB";
const ELEV_VER  = 1;
const ELEV_STORE = "elevations";
let   _elevDb   = null;

function openElevDB() {
  if (_elevDb) return Promise.resolve(_elevDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ELEV_DB, ELEV_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(ELEV_STORE)) {
        db.createObjectStore(ELEV_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => { _elevDb = e.target.result; resolve(_elevDb); };
    req.onerror   = ()  => reject(req.error);
  });
}

// key = "lat4:lng4"  (4 decimal places ≈ ~11m precision, keeps storage small)
function elevKey(lat, lng) {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

export async function cacheElevationPoint(lat, lng, elevation) {
  try {
    const db  = await openElevDB();
    const key = elevKey(lat, lng);
    await new Promise((res, rej) => {
      const tx = db.transaction(ELEV_STORE, "readwrite");
      tx.objectStore(ELEV_STORE).put({ key, lat, lng, elevation, ts: Date.now() });
      tx.oncomplete = res;
      tx.onerror    = () => rej(tx.error);
    });
  } catch (_) {}
}

async function getCachedElevation(lat, lng) {
  try {
    const db  = await openElevDB();
    const key = elevKey(lat, lng);
    return await new Promise((resolve) => {
      const req = db.transaction(ELEV_STORE, "readonly")
                    .objectStore(ELEV_STORE).get(key);
      req.onsuccess = () => resolve(req.result?.elevation ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

// ─── Online elevation APIs ─────────────────────────────────────────
// Strategy: batch points → Open-Meteo (fastest, no key) → Open-Elevation fallback

async function fetchOpenMeteoElevation(points) {
  // Open-Meteo elevation — max 100 points per request
  const lats = points.map(p => p.lat.toFixed(6)).join(",");
  const lngs = points.map(p => p.lng.toFixed(6)).join(",");
  const url  = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.elevation)) throw new Error("Bad response");
  return data.elevation; // array of numbers
}

async function fetchOpenElevation(points) {
  // Open-Elevation — free, no key
  const body = { locations: points.map(p => ({ latitude: p.lat, longitude: p.lng })) };
  const res  = await fetch("https://api.open-elevation.com/api/v1/lookup", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Open-Elevation HTTP ${res.status}`);
  const data = await res.json();
  return data.results.map(r => r.elevation);
}

// ─── Batch fetch with IDB cache ────────────────────────────────────
// Returns array of { lat, lng, elevation } — elevation may be null if offline+uncached
async function batchGetElevations(points, isOnline) {
  const results = new Array(points.length).fill(null);
  const needFetch = [];

  // 1. Try cache first for all points
  await Promise.all(
    points.map(async (p, i) => {
      const cached = await getCachedElevation(p.lat, p.lng);
      if (cached !== null) {
        results[i] = cached;
      } else if (isOnline) {
        needFetch.push({ idx: i, lat: p.lat, lng: p.lng });
      }
    })
  );

  // 2. Batch-fetch uncached points online
  if (needFetch.length > 0 && isOnline) {
    // Split into chunks of 100 (Open-Meteo limit)
    const CHUNK = 100;
    for (let start = 0; start < needFetch.length; start += CHUNK) {
      const chunk = needFetch.slice(start, start + CHUNK);
      let elevations = null;

      try {
        elevations = await fetchOpenMeteoElevation(chunk);
      } catch (_) {
        try {
          elevations = await fetchOpenElevation(chunk);
        } catch (_) {}
      }

      if (elevations) {
        for (let j = 0; j < chunk.length; j++) {
          const { idx, lat, lng } = chunk[j];
          const elev = elevations[j];
          results[idx] = elev;
          // Save to IDB for offline use
          cacheElevationPoint(lat, lng, elev);
        }
      }
    }
  }

  return points.map((p, i) => ({ ...p, elevation: results[i] }));
}

// ─── HOOK ──────────────────────────────────────────────────────────
export function useElevation({ isOnline = true } = {}) {
  const [cursorElevation, setCursorElevation] = useState(null);
  const [elevLoading,     setElevLoading]     = useState(false);
  const cursorDebounce = useRef(null);

  /**
   * Get elevation for a single lat/lng (used for cursor hover)
   * Debounced — only fires 400ms after last call
   */
  const getCursorElevation = useCallback((lat, lng) => {
    if (cursorDebounce.current) clearTimeout(cursorDebounce.current);
    cursorDebounce.current = setTimeout(async () => {
      // Try cache first (instant)
      const cached = await getCachedElevation(lat, lng);
      if (cached !== null) {
        setCursorElevation(cached);
        return;
      }
      if (!isOnline) { setCursorElevation(null); return; }
      try {
        const [elev] = await fetchOpenMeteoElevation([{ lat, lng }]);
        setCursorElevation(elev ?? null);
        if (elev != null) cacheElevationPoint(lat, lng, elev);
      } catch {
        setCursorElevation(null);
      }
    }, 400);
  }, [isOnline]);

  /**
   * Get elevation profile for an array of {lat, lng} points
   * Returns array of {lat, lng, elevation, distance} — distance in metres from start
   * elevation may be null for offline+uncached points
   */
  const getElevationProfile = useCallback(async (points) => {
    if (!points || points.length < 2) return [];
    setElevLoading(true);

    // Subsample if too many points (max 200 for chart clarity + API speed)
    let pts = points;
    if (pts.length > 200) {
      const step = pts.length / 200;
      pts = Array.from({ length: 200 }, (_, i) => pts[Math.round(i * step)]);
    }

    try {
      const withElev = await batchGetElevations(pts, isOnline);

      // Calculate cumulative distance
      let cumDist = 0;
      return withElev.map((p, i) => {
        if (i > 0) {
          const prev = withElev[i - 1];
          const dlat = (p.lat - prev.lat) * Math.PI / 180;
          const dlng = (p.lng - prev.lng) * Math.PI / 180;
          const a = Math.sin(dlat/2)**2 + Math.cos(prev.lat*Math.PI/180) * Math.cos(p.lat*Math.PI/180) * Math.sin(dlng/2)**2;
          cumDist += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }
        return { ...p, distance: cumDist };
      });
    } finally {
      setElevLoading(false);
    }
  }, [isOnline]);

  /**
   * Get single elevation point (for marker info etc.)
   */
  const getElevation = useCallback(async (lat, lng) => {
    const cached = await getCachedElevation(lat, lng);
    if (cached !== null) return cached;
    if (!isOnline) return null;
    try {
      const [elev] = await fetchOpenMeteoElevation([{ lat, lng }]);
      if (elev != null) cacheElevationPoint(lat, lng, elev);
      return elev ?? null;
    } catch { return null; }
  }, [isOnline]);

  return {
    cursorElevation,
    elevLoading,
    getCursorElevation,
    getElevationProfile,
    getElevation,
    setCursorElevation,
  };
}