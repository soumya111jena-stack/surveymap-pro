/* ============================================================
   sw.js  —  place this in /public/sw.js
   SurveyMap Pro · Offline Tile Cache Service Worker
   ============================================================ */

const TILE_CACHE = "sm-tiles-v2";
const APP_CACHE  = "sm-app-v2";
const MAX_TILES  = 5000;  // ~250 MB

const TILE_HOSTS = [
  "arcgisonline.com",
  "tile.openstreetmap.org",
  "opentopomap.org",
  "cartocdn.com",
  "stadiamaps.com",
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener("install", () => {
  console.log("[SW] Installed");
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  console.log("[SW] Activated");
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== TILE_CACHE && k !== APP_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);
  const isTile = TILE_HOSTS.some(h => url.hostname.includes(h));

  if (isTile) {
    e.respondWith(handleTile(e.request));
  } else if (url.origin === self.location.origin) {
    e.respondWith(handleApp(e.request));
  }
});

// Cache-first for tiles
async function handleTile(request) {
  const cache  = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // Return cached, refresh in background
    refresh(request, cache);
    return cached;
  }

  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      cache.put(request, response.clone());
      trimCache(cache, MAX_TILES);
    }
    return response;
  } catch {
    return grayTile();
  }
}

// Cache-first for app shell
async function handleApp(request) {
  const cache  = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const fallback = await cache.match("/index.html");
    return fallback || new Response("Offline", { status: 503 });
  }
}

async function refresh(request, cache) {
  try {
    const r = await fetch(request, { signal: AbortSignal.timeout(8000) });
    if (r.ok) cache.put(request, r);
  } catch { /* ignore */ }
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) {
    for (let i = 0; i < Math.floor(max * 0.1); i++) {
      await cache.delete(keys[i]);
    }
  }
}

function grayTile() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="256" height="256" fill="#111827"/>
    <rect x=".5" y=".5" width="255" height="255" fill="none" stroke="#1f2937"/>
    <text x="128" y="118" text-anchor="middle" fill="#374151" font-family="monospace" font-size="11">OFFLINE</text>
    <text x="128" y="138" text-anchor="middle" fill="#1f2937" font-family="monospace" font-size="9">tile not cached</text>
  </svg>`;
  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" }
  });
}

// ── Messages ──────────────────────────────────────────────────
self.addEventListener("message", async (e) => {
  const { type, payload } = e.data || {};

  if (type === "GET_CACHE_STATS") {
    const tc = await caches.open(TILE_CACHE);
    const ac = await caches.open(APP_CACHE);
    const tk = await tc.keys();
    const ak = await ac.keys();
    reply(e, "CACHE_STATS", {
      tileCount:   tk.length,
      appCount:    ak.length,
      estimatedMB: +(tk.length * 50 / 1024).toFixed(1),
      maxTiles:    MAX_TILES,
      version:     "v2",
    });
  }

  if (type === "CLEAR_TILE_CACHE") {
    await caches.delete(TILE_CACHE);
    reply(e, "CACHE_CLEARED");
  }

  if (type === "PRECACHE_REGION") {
    await downloadRegion(e, payload);
  }
});

function reply(e, type, payload = {}) {
  e.source?.postMessage({ type, payload });
}

// ── Pre-download a bounding box ───────────────────────────────
const URLS = {
  Satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  Street:    "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  Terrain:   "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  Dark:      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  Light:     "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
};

function lon2x(lon, z) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
function lat2y(lat, z) {
  return Math.floor(
    ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * 2 ** z
  );
}

async function downloadRegion(e, { bounds, minZoom, maxZoom, layers }) {
  const cache = await caches.open(TILE_CACHE);
  let cached = 0, failed = 0, skipped = 0;

  // Build full tile list
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lon2x(bounds.west, z),  x1 = lon2x(bounds.east, z);
    const y0 = lat2y(bounds.north, z), y1 = lat2y(bounds.south, z);
    for (let x = Math.min(x0,x1); x <= Math.max(x0,x1); x++)
      for (let y = Math.min(y0,y1); y <= Math.max(y0,y1); y++)
        tiles.push({ z, x, y });
  }

  const total = tiles.length * layers.length;

  for (const layer of layers) {
    const tpl = URLS[layer];
    if (!tpl) continue;

    for (const { z, x, y } of tiles) {
      const url = tpl.replace("{z}",z).replace("{x}",x).replace("{y}",y).replace("{s}","a");

      if (await cache.match(url)) {
        skipped++;
      } else {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
          if (r.ok) { await cache.put(url, r); cached++; }
          else failed++;
        } catch { failed++; }
      }

      // Broadcast progress every tile
      const progress = Math.round((cached + failed + skipped) / total * 100);
      const clients  = await self.clients.matchAll();
      clients.forEach(c => c.postMessage({
        type: "PRECACHE_PROGRESS",
        payload: { progress, cached, failed, skipped, total }
      }));
    }
  }

  // Done
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: "PRECACHE_DONE", payload: { cached, failed, skipped, total } }));
}