/**
 * useOfflineMap.js  —  src/component/map/useOfflineMap.js
 *
 * ✅ No Service Worker — uses IndexedDB directly
 * ✅ Works on any IP (192.168.x.x), HTTP or HTTPS
 * ✅ Same API as before — drop-in replacement
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─────────────────────────────────────────────
// TILE MATH  (same as before, unchanged)
// ─────────────────────────────────────────────
export function estimateTileCount(bounds, minZoom, maxZoom, layerCount = 1) {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const dx = Math.abs(lon2x(bounds.east, z)  - lon2x(bounds.west, z))  + 1;
    const dy = Math.abs(lat2y(bounds.south, z) - lat2y(bounds.north, z)) + 1;
    total += dx * dy;
  }
  return total * layerCount;
}

function lon2x(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat, z) {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z
  );
}

function getTileList(bounds, zMin, zMax) {
  const tiles = [];
  for (let z = zMin; z <= zMax; z++) {
    const xMin = lon2x(bounds.west,  z);
    const xMax = lon2x(bounds.east,  z);
    const yMin = lat2y(bounds.north, z);
    const yMax = lat2y(bounds.south, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ x, y, z });
      }
    }
  }
  return tiles;
}

// ─────────────────────────────────────────────
// LAYER URL MAP  (matches OfflineMapManager layers)
// ─────────────────────────────────────────────
const LAYER_URLS = {
  Satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
  },
  Street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
  },
  Terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
  },
  Dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: ["a", "b", "c", "d"],
  },
  Light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    subdomains: ["a", "b", "c", "d"],
  },
};

function buildTileUrl(layerKey, x, y, z) {
  const cfg = LAYER_URLS[layerKey];
  if (!cfg) return null;
  const s = cfg.subdomains.length
    ? cfg.subdomains[Math.floor(Math.random() * cfg.subdomains.length)]
    : "";
  return cfg.url
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y)
    .replace("{r}", "")
    .replace("{s}", s);
}

// ─────────────────────────────────────────────
// INDEXEDDB  (replaces Service Worker cache)
// ─────────────────────────────────────────────
const DB_NAME    = "OfflineMapDB";
const DB_VERSION = 1;
const STORE      = "tiles";
let   _db        = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = ()  => reject(req.error);
  });
}

export async function idbPutTile(key, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, blob, ts: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

export async function idbGetTile(key) {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result?.blob ?? null);
    req.onerror   = () => resolve(null);
  });
}

async function idbCountTiles() {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(0);
  });
}

async function idbClearTiles() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────
export function useOfflineMap() {
  const [dbReady,          setDbReady]          = useState(false);
  const [dbError,          setDbError]          = useState(null);
  const [isOnline,         setIsOnline]         = useState(navigator.onLine);
  const [cacheStats,       setCacheStats]       = useState(null);
  const [precaching,       setPrecaching]       = useState(false);
  const [precacheProgress, setPrecacheProgress] = useState(null);

  const stopRef = useRef(false);

  // ── Init IndexedDB ───────────────────────────────────────────
  useEffect(() => {
    openDB()
      .then(() => {
        setDbReady(true);
        setDbError(null);
        refreshStats();
      })
      .catch((err) => {
        setDbError(`IndexedDB unavailable: ${err.message}`);
      });
  }, []);

  // ── Online / offline ─────────────────────────────────────────
  useEffect(() => {
    const up   = () => { setIsOnline(true);  refreshStats(); };
    const down = () => setIsOnline(false);
    window.addEventListener("online",  up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online",  up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // ── Stats ─────────────────────────────────────────────────────
  async function refreshStats() {
    try {
      const tileCount = await idbCountTiles();
      setCacheStats({
        tileCount,
        maxTiles:    50000,
        estimatedMB: Math.round(tileCount * 15 / 1024),
        appCount:    "N/A",
        version:     "IDB v1",
      });
    } catch {
      // ignore
    }
  }

  const fetchCacheStats = useCallback(() => refreshStats(), []);

  // ── Clear cache ───────────────────────────────────────────────
  const clearTileCache = useCallback(async () => {
    await idbClearTiles();
    refreshStats();
  }, []);

  // ── Download region ───────────────────────────────────────────
  const precacheRegion = useCallback(
    async ({ bounds, minZoom = 10, maxZoom = 15, layers = ["Satellite"] }) => {
      if (!dbReady || precaching) return;

      const est = estimateTileCount(bounds, minZoom, maxZoom, layers.length);
      if (
        est > 3000 &&
        !window.confirm(
          `Download ~${est} tiles (~${Math.round((est * 15) / 1024)} MB)?`
        )
      )
        return;

      setPrecaching(true);
      stopRef.current = false;

      const tiles = layers.flatMap((layer) =>
        getTileList(bounds, minZoom, maxZoom).map((t) => ({ ...t, layer }))
      );

      const total  = tiles.length;
      let cached   = 0;
      let failed   = 0;
      const BATCH  = 6;

      setPrecacheProgress({ progress: 0, cached: 0, failed: 0, total });

      for (let i = 0; i < tiles.length; i += BATCH) {
        if (stopRef.current) break;

        const batch = tiles.slice(i, i + BATCH);

        await Promise.all(
          batch.map(async ({ x, y, z, layer }) => {
            if (stopRef.current) return;
            const key      = `${layer}/${z}/${x}/${y}`;
            const existing = await idbGetTile(key);
            if (existing) { cached++; return; }

            const url = buildTileUrl(layer, x, y, z);
            if (!url) { failed++; return; }

            try {
              const res = await fetch(url);
              if (res.ok) {
                const blob = await res.blob();
                await idbPutTile(key, blob);
                cached++;
              } else {
                failed++;
              }
            } catch {
              failed++;
            }
          })
        );

        const done     = cached + failed;
        const progress = Math.round((done / total) * 100);
        setPrecacheProgress({ progress, cached, failed, total });

        // small yield to keep UI responsive
        await new Promise((r) => setTimeout(r, 10));
      }

      setPrecaching(false);
      setPrecacheProgress(null);
      refreshStats();
    },
    [dbReady, precaching]
  );

  // ── Cache current map view ────────────────────────────────────
  const precacheCurrentView = useCallback(
    (leafletMap, opts = {}) => {
      if (!leafletMap) return;
      const b = leafletMap.getBounds();
      const z = leafletMap.getZoom();
      precacheRegion({
        bounds: {
          north: b.getNorth(),
          south: b.getSouth(),
          east:  b.getEast(),
          west:  b.getWest(),
        },
        minZoom: opts.minZoom ?? Math.max(1,  z - 2),
        maxZoom: opts.maxZoom ?? Math.min(18, z + 3),
        layers:  opts.layers  ?? ["Satellite"],
      });
    },
    [precacheRegion]
  );

  // ── Stop download ─────────────────────────────────────────────
  const stopPrecache = useCallback(() => {
    stopRef.current = true;
  }, []);

  // ── Expose swReady / swError aliases for drop-in compatibility ─
  return {
    // original names kept so nothing else in your app breaks
    swReady:          dbReady,
    swError:          dbError,
    isOnline,
    cacheStats,
    precaching,
    precacheProgress,
    precacheRegion,
    precacheCurrentView,
    clearTileCache,
    fetchCacheStats,
    stopPrecache,       // new: lets UI cancel mid-download
  };
}