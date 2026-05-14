/**
 * useElevation.js — src/component/map/useElevation.js
 *
 * v2.0 — Fixed elevation fetching with reliable API fallback chain
 *
 * APIs used (all free, no key required):
 *  1. open-elevation.com  — SRTM global, batch POST
 *  2. open-meteo.com      — fast, global, batch GET
 *
 * Usage:
 *   const { cursorElevation, elevLoading, getCursorElevation, getElevationProfile } = useElevation({ isOnline });
 */

import { useState, useCallback, useRef } from "react";

/* haversine distance in metres */
function haverDist(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) *
    Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/* cumulative distances */
function addDistances(pts) {
  return pts.map((p, i) => {
    if (i === 0) return { ...p, distance: 0 };
    let d = 0;
    for (let j = 1; j <= i; j++) d += haverDist(pts[j - 1], pts[j]);
    return { ...p, distance: d };
  });
}

/* ── API: open-elevation.com (batch POST) ── */
async function fetchOpenElevation(pts) {
  const locations = pts.map(p => ({ latitude: p.lat, longitude: p.lng }));
  const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ locations }),
    signal: AbortSignal.timeout(14000),
  });
  if (!res.ok) throw new Error(`open-elevation ${res.status}`);
  const data = await res.json();
  if (!data?.results?.length || data.results.length !== pts.length)
    throw new Error("bad response length");
  return data.results.map(r => r.elevation);
}

/* ── API: open-meteo.com (batch GET) ── */
async function fetchOpenMeteo(pts) {
  const lats = pts.map(p => p.lat).join(",");
  const lngs = pts.map(p => p.lng).join(",");
  const url  = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.elevation) || data.elevation.length !== pts.length)
    throw new Error("bad response");
  return data.elevation;
}

/* ── MAIN FETCH (with fallback) ── */
async function fetchElevations(pts) {
  try {
    return await fetchOpenElevation(pts);
  } catch (_) {
    try {
      return await fetchOpenMeteo(pts);
    } catch (__) {
      // return nulls — caller decides how to handle
      return pts.map(() => null);
    }
  }
}

/* ── Interpolate/resample route to N evenly-spaced points ── */
function resampleRoute(pts, targetCount = 100) {
  if (pts.length >= targetCount) return pts;
  if (pts.length < 2) return pts;
  const totalDist = pts.slice(1).reduce((s, p, i) => s + haverDist(pts[i], p), 0);
  const step = totalDist / (targetCount - 1);
  const result = [pts[0]];
  let remaining = step, segIdx = 0, segProgress = 0;
  while (result.length < targetCount - 1 && segIdx < pts.length - 1) {
    const segLen = haverDist(pts[segIdx], pts[segIdx + 1]);
    const avail  = segLen - segProgress;
    if (remaining <= avail) {
      const t   = (segProgress + remaining) / segLen;
      result.push({
        lat: pts[segIdx].lat + t * (pts[segIdx + 1].lat - pts[segIdx].lat),
        lng: pts[segIdx].lng + t * (pts[segIdx + 1].lng - pts[segIdx].lng),
      });
      segProgress += remaining;
      remaining = step;
    } else {
      remaining -= avail;
      segIdx++;
      segProgress = 0;
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}

/* ══════════════════════════════════════════════════════════════════
   HOOK
══════════════════════════════════════════════════════════════════ */
export function useElevation({ isOnline = true } = {}) {
  const [cursorElevation, setCursorElevation] = useState(null);
  const [elevLoading,     setElevLoading]     = useState(false);

  const cursorTimer  = useRef(null);
  const profileAbort = useRef(null);

  /* ── single-point cursor elevation (debounced 400ms) ── */
  const getCursorElevation = useCallback((lat, lng) => {
    if (!isOnline) return;
    clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(async () => {
      try {
        const elevs = await fetchElevations([{ lat, lng }]);
        if (elevs[0] != null) setCursorElevation(elevs[0]);
      } catch (_) {}
    }, 400);
  }, [isOnline]);

  /* ── multi-point elevation profile ── */
  const getElevationProfile = useCallback(async (inputPts) => {
    if (!inputPts || inputPts.length < 2) return [];

    /* cancel previous request */
    profileAbort.current?.abort?.();

    setElevLoading(true);

    try {
      /* resample to max 120 points to keep API fast */
      const MAX_PTS = 120;
      const sampled = resampleRoute(inputPts, MAX_PTS);
      const withDist = addDistances(sampled);

      const elevs = await fetchElevations(sampled);

      const result = withDist.map((p, i) => ({
        lat:       p.lat,
        lng:       p.lng,
        distance:  p.distance,
        elevation: elevs[i],
      }));

      setElevLoading(false);
      return result;
    } catch (err) {
      setElevLoading(false);
      console.warn("useElevation: fetch failed", err);
      return [];
    }
  }, []);

  return {
    cursorElevation,
    elevLoading,
    getCursorElevation,
    getElevationProfile,
  };
}