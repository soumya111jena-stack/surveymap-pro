import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "node_modules/cesium/Build/Cesium/Assets",     dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/Widgets",    dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/Workers",    dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/ThirdParty", dest: "cesium" },
      ],
    }),
  ],

  server: {
    host: "localhost",
    port: 5173,
    // NO https — localhost already supports Service Workers over http
  },

  resolve: {
    alias: {
      cesium: path.resolve(__dirname, "node_modules/cesium"),
    },
  },

  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesium"),
  },

  build: {
    rollupOptions: {
      external: [],
    },
  },
});