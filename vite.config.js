import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "path";

export default defineConfig({
  base: "./", // 🔥 VERY IMPORTANT (fix black screen)

  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "node_modules/cesium/Build/Cesium/Assets", dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/Widgets", dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/Workers", dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/ThirdParty", dest: "cesium" },
      ],
    }),
  ],

  server: {
    host: true,
    port: 5173,
  },

  resolve: {
    alias: {
      cesium: path.resolve(__dirname, "node_modules/cesium"),
    },
  },

  define: {
    CESIUM_BASE_URL: JSON.stringify("./cesium"), // 🔥 FIXED (relative path)
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: [],
    },
  },
});