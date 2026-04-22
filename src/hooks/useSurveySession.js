/**
 * useSurveySession.js — SurveyMap Pro v2
 *
 * Changes from v1:
 *  - syncTrack now accepts full track object: { points, name, startedAt, endedAt,
 *    distanceMeters, photoDataURL, photoFilename }
 *  - syncDrawing is now a no-op (drawings are local only, not saved to backend)
 *  - syncBadge has .type field for SurveyMap.jsx spinner
 *  - Full debug logging to trace session + track save flow
 *
 * v2.1 FIX:
 *  - Export syncTrackRef (stable ref always pointing to latest syncTrack)
 *    so LiveTrackRecorder never holds a stale closure across async session restores
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  isLoggedIn,
  createSession,
  getSessions,
  completeSession,
  saveTrack,
} from "../services/surveyApi";

export function useSurveySession({ enqueue, isOnline }) {
  const [activeSessionId,       setActiveSessionId]       = useState(null);
  const [activeSessionClientId, setActiveSessionClientId] = useState(null);
  const [sessionStatus,         setSessionStatus]         = useState("idle");
  const [restoredDrawings,      setRestoredDrawings]      = useState([]);
  const [syncStatus,            setSyncStatus]            = useState("idle");

  const restoredRef = useRef(false);

  // ── Restore last active session on mount ─────────────────────────────
  useEffect(() => {
    if (restoredRef.current) return;
    if (!isLoggedIn()) {
      console.log("[useSurveySession] not logged in, skipping session restore");
      return;
    }
    restoredRef.current = true;
    setSessionStatus("loading");
    console.log("[useSurveySession] restoring last active session…");

    getSessions()
      .then((sessions) => {
        console.log("[useSurveySession] getSessions returned:", sessions?.length, "sessions");
        if (!Array.isArray(sessions) || sessions.length === 0) {
          setSessionStatus("idle"); return;
        }
        const last = sessions
          .filter((s) => s.status === "ACTIVE" || s.status === "PAUSED")
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

        if (!last) {
          console.log("[useSurveySession] no active session found");
          setSessionStatus("idle"); return;
        }

        console.log("[useSurveySession] restored session:", last.clientId);
        setActiveSessionId(last.id);
        setActiveSessionClientId(last.clientId);
        setSessionStatus("active");
      })
      .catch((err) => {
        console.error("[useSurveySession] getSessions failed:", err.message);
        setSessionStatus("idle");
      });
  }, []);

  // ── Start session ─────────────────────────────────────────────────────
  const startSurveySession = useCallback(
    async ({ name = "Field Survey", description = "" } = {}) => {
      if (!isLoggedIn()) return null;
      if (activeSessionId) return activeSessionId;

      setSyncStatus("syncing");
      try {
        const session = await createSession({ name, description });
        console.log("[startSurveySession] created:", session.clientId);
        setActiveSessionId(session.id);
        setActiveSessionClientId(session.clientId);
        setSessionStatus("active");
        setSyncStatus("synced");
        return session.id;
      } catch (err) {
        console.warn("[startSurveySession] failed, using offline clientId:", err.message);
        const clientId = `client_${Date.now()}_offline`;
        await enqueue("session", { clientId, name, description });
        setActiveSessionClientId(clientId);
        setSessionStatus("active");
        setSyncStatus("queued");
        return null;
      }
    },
    [activeSessionId, enqueue]
  );

  // ── End session ───────────────────────────────────────────────────────
  const endSurveySession = useCallback(async () => {
    if (!activeSessionId) {
      setSessionStatus("idle");
      setActiveSessionClientId(null);
      return;
    }
    setSyncStatus("syncing");
    try {
      await completeSession(activeSessionId);
      setSyncStatus("synced");
    } catch (err) {
      console.warn("[endSurveySession] failed:", err.message);
      setSyncStatus("error");
    } finally {
      setActiveSessionId(null);
      setActiveSessionClientId(null);
      setSessionStatus("idle");
    }
  }, [activeSessionId]);

  // ── syncTrack — main track save ───────────────────────────────────────
  // Accepts either:
  //   syncTrack(points)  — legacy plain array
  //   syncTrack({ points, name, startedAt, endedAt, distanceMeters, photoDataURL })
  const syncTrack = useCallback(
    async (trackOrPoints) => {
      console.log("[syncTrack] called");

      // ── Auth check ────────────────────────────────────────────────────
      if (!isLoggedIn()) {
        console.warn("[syncTrack] not logged in — aborting");
        return;
      }

      // ── Normalise input ───────────────────────────────────────────────
      const isArray        = Array.isArray(trackOrPoints);
      const points         = isArray ? trackOrPoints : (trackOrPoints.points || []);
      const name           = isArray ? "Field Track" : (trackOrPoints.name           || "Field Track");
      const startedAt      = isArray ? null          : (trackOrPoints.startedAt      || null);
      const endedAt        = isArray ? null          : (trackOrPoints.endedAt        || null);
      const distanceMeters = isArray ? 0             : (trackOrPoints.distanceMeters || 0);
      const photoDataURL   = isArray ? null          : (trackOrPoints.photoDataURL   || null);
      const photoFilename  = isArray ? "photo.jpg"   : (trackOrPoints.photoFilename  || "photo.jpg");

      console.log("[syncTrack] points:", points?.length,
        "| name:", name,
        "| startedAt:", startedAt,
        "| endedAt:", endedAt,
        "| distance:", distanceMeters, "m",
        "| hasPhoto:", !!photoDataURL);

      // ── Minimum points check ──────────────────────────────────────────
      if (!points || points.length < 2) {
        console.warn("[syncTrack] not enough points (need ≥ 2), got:", points?.length, "— aborting");
        return;
      }

      // ── Session check / auto-create ───────────────────────────────────
      let sessionClientId = activeSessionClientId;
      console.log("[syncTrack] activeSessionClientId:", sessionClientId);

      if (!sessionClientId) {
        console.log("[syncTrack] no active session — auto-creating one…");
        try {
          const session = await createSession({ name: "Auto Session" });
          console.log("[syncTrack] auto session created:", JSON.stringify(session));
          setActiveSessionId(session.id);
          setActiveSessionClientId(session.clientId);
          setSessionStatus("active");
          sessionClientId = session.clientId;
          console.log("[syncTrack] will use sessionClientId:", sessionClientId);
        } catch (err) {
          console.error("[syncTrack] session auto-create FAILED:", err.message);
          return;
        }
      }

      // ── Save track ────────────────────────────────────────────────────
      setSyncStatus("syncing");
      console.log("[syncTrack] → calling saveTrack, sessionClientId:", sessionClientId, "points:", points.length);

      try {
        const result = await saveTrack(sessionClientId, points, {
          name,
          startedAt,
          endedAt,
          distanceMeters,
          photoDataURL,
          photoFilename,
        });
        console.log("[syncTrack] ✅ saveTrack SUCCESS:", JSON.stringify(result));
        setSyncStatus("synced");
      } catch (err) {
        console.error("[syncTrack] ❌ saveTrack FAILED:", err.message);
        try {
          await enqueue("track", {
            sessionClientId,
            points,
            name,
            startedAt,
            endedAt,
            distanceMeters,
          });
          console.log("[syncTrack] track queued for later sync");
          setSyncStatus("queued");
        } catch (qErr) {
          console.error("[syncTrack] enqueue also failed:", qErr.message);
          setSyncStatus("error");
        }
      }
    },
    [activeSessionClientId, enqueue]
  );

  // ── syncTrackRef — stable ref always pointing to latest syncTrack ─────
  // LiveTrackRecorder uses this ref so it never holds a stale closure
  // even when syncTrack recreates after an async session restore.
  const syncTrackRef = useRef(syncTrack);
  useEffect(() => {
    syncTrackRef.current = syncTrack;
  }, [syncTrack]);

  // ── syncDrawing — drawings are local only, this is a no-op ───────────
  // Kept so existing call sites in SurveyMap.jsx don't crash.
  const syncDrawing = useCallback(
    async (_drawing) => {
      console.log("[syncDrawing] drawings are local only — skipping backend sync");
    },
    []
  );

  // ── Badge ─────────────────────────────────────────────────────────────
  const badgeMap = {
    idle:    { label: null,       type: "idle",    color: "#94a3b8", bg: "transparent",           border: "transparent"           },
    syncing: { label: "Syncing…", type: "syncing", color: "#60a5fa", bg: "rgba(74,158,255,0.1)",  border: "rgba(74,158,255,0.3)"  },
    synced:  { label: "Synced",   type: "synced",  color: "#4ade80", bg: "rgba(74,222,128,0.1)",  border: "rgba(74,222,128,0.3)"  },
    queued:  { label: "Queued",   type: "queued",  color: "#fbbf24", bg: "rgba(251,191,36,0.1)",  border: "rgba(251,191,36,0.3)"  },
    error:   { label: "Error",    type: "error",   color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.3)" },
  };

  return {
    activeSessionId,
    activeSessionClientId,
    sessionStatus,
    restoredDrawings,
    syncStatus,
    syncBadge: badgeMap[syncStatus] || badgeMap.idle,
    startSurveySession,
    endSurveySession,
    syncDrawing,
    syncTrack,
    syncTrackRef,   // ← NEW: stable ref for LiveTrackRecorder
  };
}