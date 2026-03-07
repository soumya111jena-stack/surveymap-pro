import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ─────────────────────────────────────────────────────────────────────────────
// ESRI Wayback CORS Fix
//
// ESRI's Wayback tile server (wayback.maptiles.arcgis.com) does not send
// Access-Control-Allow-Origin headers for localhost requests, so the browser
// blocks tiles with a CORS error.
//
// This Vite dev server proxy rewrites requests like:
//   /wayback-proxy/WMTS/1.0.0/.../tile/104/13/5432/3215
// to:
//   https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/.../tile/104/13/5432/3215
//
// Since the request comes from the server (not the browser), CORS does not apply.
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/wayback-proxy": {
        target: "https://wayback.maptiles.arcgis.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\/wayback-proxy/,
            "/arcgis/rest/services/World_Imagery"
          ),
        headers: {
          // Some tile servers check the Referer header
          Referer: "https://waybackviewer.arcgis.com/",
        },
      },
    },
  },
});