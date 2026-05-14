/**
 * OfflineTileLayer.jsx  —  src/component/map/OfflineTileLayer.jsx
 *
 * Drop-in replacement for <TileLayer> that:
 *  1. Checks IndexedDB first for every tile
 *  2. If found → renders instantly from local blob (works offline)
 *  3. If not found → fetches from internet AND saves to IndexedDB
 *  4. If offline + not cached → shows a gray "OFFLINE" placeholder tile
 *
 * Usage:
 *   <OfflineTileLayer
 *     layerKey="Satellite"          // key used for IndexedDB storage
 *     url="https://..."             // tile URL template
 *     attribution="© Esri"
 *     offlineOnly={false}           // set true to BLOCK all network fetches
 *   />
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { idbGetTile, idbPutTile } from "./useOfflineMap";

// ── Gray placeholder SVG for uncached offline tiles ──────────────
const OFFLINE_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect width="256" height="256" fill="#111827"/>
  <rect x=".5" y=".5" width="255" height="255" fill="none" stroke="#1f2937" stroke-width="1"/>
  <text x="128" y="118" text-anchor="middle" fill="#374151" font-family="monospace" font-size="11">OFFLINE</text>
  <text x="128" y="138" text-anchor="middle" fill="#1f2937" font-family="monospace" font-size="9">tile not cached</text>
</svg>`;

const OFFLINE_BLOB_URL = URL.createObjectURL(
  new Blob([OFFLINE_TILE_SVG], { type: "image/svg+xml" })
);

// ── Build the actual tile fetch URL from template ─────────────────
function buildUrl(template, x, y, z) {
  // Handle subdomain rotation {s}
  const subs = ["a", "b", "c"];
  const s = subs[Math.abs(x + y) % subs.length];
  return template
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y)
    .replace("{r}", "")
    .replace("{s}", s);
}

// ── Custom Leaflet GridLayer ──────────────────────────────────────
function createIdbTileLayer(layerKey, urlTemplate, offlineOnly) {
  return L.GridLayer.extend({
    options: {
      tileSize: 256,
      maxZoom: 19,
      minZoom: 0,
    },

    createTile(coords, done) {
      const img = document.createElement("img");
      img.setAttribute("role", "presentation");
      img.style.width  = "256px";
      img.style.height = "256px";

      const { x, y, z } = coords;
      const idbKey = `${layerKey}/${z}/${x}/${y}`;

      // 1. Try IndexedDB first
      idbGetTile(idbKey)
        .then((blob) => {
          if (blob) {
            // ✅ Found in cache — render instantly, no internet needed
            img.src = URL.createObjectURL(blob);
            img.onload = () => done(null, img);
            img.onerror = () => done(new Error("blob render failed"), img);
            return;
          }

          // 2. Not in cache
          if (offlineOnly) {
            // Offline-only mode: show placeholder
            img.src = OFFLINE_BLOB_URL;
            img.onload = () => done(null, img);
            return;
          }

          // 3. Fetch from network
          const url = buildUrl(urlTemplate, x, y, z);
          fetch(url, { signal: AbortSignal.timeout(10000) })
            .then((res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.blob();
            })
            .then((fetchedBlob) => {
              // Save to IndexedDB for future offline use (fire and forget)
              idbPutTile(idbKey, fetchedBlob).catch(() => {});
              img.src = URL.createObjectURL(fetchedBlob);
              img.onload  = () => done(null, img);
              img.onerror = () => done(new Error("img load failed"), img);
            })
            .catch(() => {
              // Network failed — show placeholder
              img.src = OFFLINE_BLOB_URL;
              img.onload = () => done(null, img);
            });
        })
        .catch(() => {
          img.src = OFFLINE_BLOB_URL;
          img.onload = () => done(null, img);
        });

      return img;
    },
  });
}

// ── React component ───────────────────────────────────────────────
export default function OfflineTileLayer({
  layerKey,
  url,
  attribution = "",
  offlineOnly = false,
  opacity = 1,
  zIndex = 200,
}) {
  const map     = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map || !url || !layerKey) return;

    // Remove previous layer
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    // Create new IDB-backed layer
    const IdbLayer = createIdbTileLayer(layerKey, url, offlineOnly);
    const layer = new IdbLayer({ attribution, opacity, zIndex });
    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
    // Re-mount when any of these change
  }, [map, layerKey, url, offlineOnly, opacity, zIndex]);

  return null;
}