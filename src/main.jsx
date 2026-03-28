import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import 'leaflet/dist/leaflet.css'
import 'leaflet-geosearch/dist/geosearch.css'
import './leafletFix'

// ── Cesium base URL ────────────────────────────────────────────────────────
// In development: Vite serves from node_modules via vite-plugin-cesium
// In production:  dist/cesium/ is copied by vite-plugin-static-copy
window.CESIUM_BASE_URL = "/cesium/";

// ⚠️ React.StrictMode removed intentionally.
// StrictMode mounts→unmounts→remounts every component in development,
// which breaks Leaflet controls (search bar added twice / removed before ready)
// and starts two GPS watchPosition listeners. Safe to re-add after migrating
// away from direct Leaflet DOM manipulation.

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)