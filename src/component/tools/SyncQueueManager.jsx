/**
 * SyncQueueManager.jsx -- SurveyMap Pro
 * ─────────────────────────────────────────────────────────────────────────
 * Mount this once near your map / app shell (alongside <LiveTrackRecorder/>).
 * It watches IndexedDB's "pendingSync" store for tracks that were recorded
 * offline (or whose upload failed), and retries them whenever the device
 * comes back online — using the same syncTrack/saveTrack function.
 *
 * Usage:
 *   <SyncQueueManager syncTrack={syncTrackFn} sessionClientId={sessionClientId} />
 *
 * `syncTrack` should have the same signature used by LiveTrackRecorder:
 *   syncTrack({ points, name, startedAt, endedAt, distanceMeters, photos })
 * If a queued track has its own sessionClientId stored (captured at the
 * time it was recorded), that is preferred; otherwise falls back to the
 * sessionClientId prop passed in. If neither is available, syncs anyway
 * without a session link.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  dbGetAll,
  dbDelete,
  dbPut,
  STORE_PENDING,
  isReallyOnline,
} from "./LiveTrackRecorder";

const T = {
  amber: "#f4a261",
  green: "#2dc653",
  red:   "#e63946",
  text:  "#dde8f8",
};

const FONT_MONO = `"JetBrains Mono","Fira Code","Cascadia Code",ui-monospace,monospace`;
const FONT_UI   = `"Geist","DM Sans","Outfit",system-ui,sans-serif`;

const MAX_ATTEMPTS = 8;

export default function SyncQueueManager({ syncTrack, sessionClientId }) {
  const [pending, setPending]       = useState([]);
  const [syncing, setSyncing]       = useState(false);
  const [lastResult, setLastResult] = useState(null); // {synced, failed} | null
  const runningRef          = useRef(false);
  const syncTrackRef        = useRef(syncTrack);
  const sessionClientIdRef  = useRef(sessionClientId);

  useEffect(() => { syncTrackRef.current       = syncTrack;       }, [syncTrack]);
  useEffect(() => { sessionClientIdRef.current = sessionClientId; }, [sessionClientId]);

  const refreshPending = useCallback(async () => {
    try {
      const items = await dbGetAll(STORE_PENDING);
      setPending(items);
      return items;
    } catch (e) {
      console.warn("[SyncQueue] failed to read pending store:", e);
      return [];
    }
  }, []);

  const flush = useCallback(async () => {
    if (runningRef.current) return;
    const fn = syncTrackRef.current;
    if (!fn) return;

    if (!(await isReallyOnline())) {
      await refreshPending();
      return;
    }

    runningRef.current = true;
    setSyncing(true);

    let synced = 0, failed = 0;

    try {
      const items = await dbGetAll(STORE_PENDING);

      if (items.length === 0) {
        console.log("[SyncQueue] no pending tracks to sync.");
        return;
      }

      console.log(`[SyncQueue] flushing ${items.length} pending track(s)…`);

      for (const item of items) {
        // Use stored sessionClientId, or current prop, or null — never skip!
        const sid = item.sessionClientId || sessionClientIdRef.current || null;

        if (!sid) {
          console.warn(
            `[SyncQueue] ${item.id} has no sessionClientId — syncing anyway without session link`
          );
        }

        try {
          console.log(
            `[SyncQueue] syncing ${item.id}` +
            ` (${item.payload?.photos?.length || 0} photos,` +
            ` sid: ${sid || "none"})…`
          );
          await fn(item.payload, sid);
          await dbDelete(STORE_PENDING, item.id);
          synced++;
          console.log(`[SyncQueue] ✅ synced ${item.id}`);
        } catch (err) {
          failed++;
          console.warn(`[SyncQueue] ❌ retry failed for ${item.id}:`, err.message);
          try {
            await dbPut(STORE_PENDING, {
              ...item,
              attempts:      (item.attempts || 0) + 1,
              lastError:     err.message,
              lastAttemptAt: new Date().toISOString(),
            });
          } catch (_) {}
        }
      }
    } finally {
      runningRef.current = false;
      setSyncing(false);
      const remaining = await refreshPending();
      if (synced > 0 || failed > 0) {
        setLastResult({ synced, failed });
        if (remaining.length === 0) {
          setTimeout(() => setLastResult(null), 4000);
        }
      }
    }
  }, [refreshPending]);

  useEffect(() => {
    refreshPending();
    flush(); // attempt immediately on mount

    const onOnline = () => {
      console.log("[SyncQueue] network came online — triggering flush");
      flush();
    };
    window.addEventListener("online", onOnline);

    const interval = setInterval(flush, 60000); // retry every 60s

    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [flush, refreshPending]);

  if (pending.length === 0 && !lastResult) return null;

  return (
    <div style={{
      position: "fixed",
      top: "calc(env(safe-area-inset-top, 0px) + 10px)",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 3000,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "7px 14px",
      borderRadius: 100,
      background: lastResult && pending.length === 0
        ? "rgba(45,198,83,0.12)"
        : "rgba(244,162,97,0.12)",
      border: `1px solid ${
        lastResult && pending.length === 0
          ? "rgba(45,198,83,0.3)"
          : "rgba(244,162,97,0.3)"
      }`,
      color: lastResult && pending.length === 0 ? T.green : T.amber,
      fontSize: 11,
      fontWeight: 700,
      fontFamily: FONT_MONO,
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      pointerEvents: "none",
    }}>
      {lastResult && pending.length === 0 ? (
        <>✅ {lastResult.synced} track{lastResult.synced !== 1 ? "s" : ""} synced</>
      ) : syncing ? (
        <>
          <span style={{
            display: "inline-block",
            animation: "spin 1s linear infinite",
            fontSize: 12,
          }}>◌</span>
          Syncing {pending.length} track{pending.length !== 1 ? "s" : ""}…
        </>
      ) : (
        <>📴 {pending.length} track{pending.length !== 1 ? "s" : ""} pending sync</>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}