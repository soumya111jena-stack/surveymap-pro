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

  // ── syncTrack ─────────────────────────────────────────────────────────
  // NOTE: accepts optional second argument `overrideSessionClientId`
  // so SyncQueueManager can pass the stored sessionClientId from the queued item.
  const syncTrack = useCallback(
    async (trackOrPoints, overrideSessionClientId = null) => {
      console.log("[syncTrack] called, overrideSid:", overrideSessionClientId);

      if (!isLoggedIn()) {
        console.warn("[syncTrack] not logged in — aborting");
        return;
      }

      const isArray        = Array.isArray(trackOrPoints);
      const points         = isArray ? trackOrPoints : (trackOrPoints.points         || []);
      const name           = isArray ? "Field Track" : (trackOrPoints.name           || "Field Track");
      const startedAt      = isArray ? null          : (trackOrPoints.startedAt      || null);
      const endedAt        = isArray ? null          : (trackOrPoints.endedAt        || null);
      const distanceMeters = isArray ? 0             : (trackOrPoints.distanceMeters || 0);
      const photos         = isArray ? []            : (trackOrPoints.photos         || []);
      const photoDataURL   = isArray ? null          : (trackOrPoints.photoDataURL   || null);
      const photoFilename  = isArray ? "photo.jpg"   : (trackOrPoints.photoFilename  || "photo.jpg");
      const photoName      = isArray ? null          : (trackOrPoints.photoName      || null);
      const photoNote      = isArray ? null          : (trackOrPoints.photoNote      || null);

      console.log("[syncTrack] points:", points?.length,
        "| name:", name,
        "| photos:", photos.length,
        "| photoName:", photoName,
        "| photoNote:", photoNote);

      if (!points || points.length < 2) {
        console.warn("[syncTrack] not enough points — aborting");
        return;
      }

      // Priority: override passed by SyncQueueManager → active session → auto-create
      let sessionClientId = overrideSessionClientId || activeSessionClientId;

      if (!sessionClientId) {
        console.log("[syncTrack] no sessionClientId — auto-creating session…");
        try {
          const session = await createSession({ name: `Auto Session — ${name}` });
          setActiveSessionId(session.id);
          setActiveSessionClientId(session.clientId);
          setSessionStatus("active");
          sessionClientId = session.clientId;
          console.log("[syncTrack] auto-created session:", sessionClientId);
        } catch (err) {
          console.error("[syncTrack] session auto-create FAILED:", err.message);
          setSyncStatus("error");
          return;
        }
      }

      setSyncStatus("syncing");

      try {
        const result = await saveTrack(sessionClientId, points, {
          name,
          startedAt,
          endedAt,
          distanceMeters,
          photos,
          photoDataURL,
          photoFilename,
          photoName,
          photoNote,
        });
        console.log("[syncTrack] ✅ saveTrack SUCCESS:", JSON.stringify(result));
        setSyncStatus("synced");
      } catch (err) {
        console.error("[syncTrack] ❌ saveTrack FAILED:", err.message);
        try {
          await enqueue("track", {
            sessionClientId, points, name,
            startedAt, endedAt, distanceMeters,
          });
          setSyncStatus("queued");
        } catch (qErr) {
          console.error("[syncTrack] enqueue failed:", qErr.message);
          setSyncStatus("error");
        }
        // Re-throw so SyncQueueManager knows this item failed and keeps it in the queue
        throw err;
      }
    },
    [activeSessionClientId, enqueue]
  );

  const syncTrackRef = useRef(syncTrack);
  useEffect(() => { syncTrackRef.current = syncTrack; }, [syncTrack]);

  const syncDrawing = useCallback(async (_drawing) => {}, []);

  const badgeMap = {
    idle:    { label: null,       color: "#94a3b8", bg: "transparent",           border: "transparent"           },
    syncing: { label: "Syncing…", color: "#60a5fa", bg: "rgba(74,158,255,0.1)",  border: "rgba(74,158,255,0.3)"  },
    synced:  { label: "Synced",   color: "#4ade80", bg: "rgba(74,222,128,0.1)",  border: "rgba(74,222,128,0.3)"  },
    queued:  { label: "Queued",   color: "#fbbf24", bg: "rgba(251,191,36,0.1)",  border: "rgba(251,191,36,0.3)"  },
    error:   { label: "Error",    color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.3)" },
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
    syncTrackRef,
  };
}