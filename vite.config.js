import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ─────────────────────────────────────────────────────────────
// Vite Configuration for React + Netlify Deployment
// Includes ESRI Wayback Proxy for local development
// ─────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react()],

  // Important for Netlify production build
  base: "/",

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
          Referer: "https://waybackviewer.arcgis.com/",
        },
      },
    },
  },

  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
  },
});