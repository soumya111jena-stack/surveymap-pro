/**
 * useOfflineQueue.js — SurveyMap Pro
 *
 * Persists failed API calls to IndexedDB when offline.
 * Automatically flushes the queue via POST /api/sync when the browser
 * comes back online.
 *
 * Usage:
 *   const { enqueue, flushQueue, queueSize } = useOfflineQueue();
 *
 *   // Instead of calling saveDrawing() directly:
 *   try {
 *     await saveDrawing(sessionClientId, drawing);
 *   } catch (err) {
 *     await enqueue("drawing", { sessionClientId, drawing });
 *   }
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { bulkSync } from "../services/surveyApi";

const DB_NAME    = "surveymap_offline";
const STORE_NAME = "queue";
const DB_VERSION = 1;

// ── IndexedDB helpers ─────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function dbAdd(db, item) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbClear(db) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useOfflineQueue() {
  const dbRef          = useRef(null);
  const [queueSize,    setQueueSize]    = useState(0);
  const [isFlushing,   setIsFlushing]   = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  // Open DB on mount
  useEffect(() => {
    openDB()
      .then((db) => {
        dbRef.current = db;
        return dbGetAll(db);
      })
      .then((items) => setQueueSize(items.length))
      .catch((err) => console.warn("[OfflineQueue] IndexedDB unavailable:", err));
  }, []);

  /**
   * Add an item to the offline queue.
   * @param {"session"|"track"|"drawing"} type
   * @param {object} payload
   */
  const enqueue = useCallback(async (type, payload) => {
    if (!dbRef.current) return;
    try {
      await dbAdd(dbRef.current, { type, payload, ts: Date.now() });
      const items = await dbGetAll(dbRef.current);
      setQueueSize(items.length);
      console.log(`[OfflineQueue] Queued ${type} — total: ${items.length}`);
    } catch (err) {
      console.error("[OfflineQueue] Failed to enqueue:", err);
    }
  }, []);

  /**
   * Flush the queue via POST /api/sync.
   * Groups items by type and sends in one request.
   */
  const flushQueue = useCallback(async () => {
    if (!dbRef.current || isFlushing) return;
    const items = await dbGetAll(dbRef.current);
    if (!items.length) return;

    setIsFlushing(true);
    console.log(`[OfflineQueue] Flushing ${items.length} queued items…`);

    try {
      const sessions = items
        .filter((i) => i.type === "session")
        .map((i) => i.payload);
      const tracks = items
        .filter((i) => i.type === "track")
        .map((i) => i.payload);
      const drawings = items
        .filter((i) => i.type === "drawing")
        .map((i) => i.payload);

      await bulkSync({ sessions, tracks, drawings });
      await dbClear(dbRef.current);
      setQueueSize(0);
      setLastSyncTime(new Date());
      console.log("[OfflineQueue] Flush complete.");
    } catch (err) {
      console.warn("[OfflineQueue] Flush failed, will retry on next online event:", err);
    } finally {
      setIsFlushing(false);
    }
  }, [isFlushing]);

  // Auto-flush when browser comes back online
  useEffect(() => {
    const handleOnline = () => {
      console.log("[OfflineQueue] Back online — attempting flush…");
      flushQueue();
    };
    window.addEventListener("online", handleOnline);
    // Also try on mount if already online and queue has items
    if (navigator.onLine && queueSize > 0) flushQueue();
    return () => window.removeEventListener("online", handleOnline);
  }, [flushQueue, queueSize]);

  return { enqueue, flushQueue, queueSize, isFlushing, lastSyncTime };
}