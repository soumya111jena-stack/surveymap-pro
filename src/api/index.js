import axios from "axios";

// ── Detect environment ─────────────────────────────────────────────────────
// When running in Capacitor APK, localhost doesn't work.
// Use your PC's local IP when testing on emulator/device.
// Use your deployed URL when releasing to production.

const isCapacitor = window?.Capacitor?.isNativePlatform?.() || false;

const BASE_URL = isCapacitor
  ? "http://192.168.1.105:8080/api"   // ← Replace with YOUR PC's IPv4 address
  : "http://localhost:8080/api";       // ← Used when running in browser

const API = axios.create({
  baseURL: BASE_URL,
  withCredentials: false,             // Must be false for Capacitor
  headers: {
    "Content-Type": "application/json",
  },
});

// ── Auto-attach token ──────────────────────────────────────────────────────
API.interceptors.request.use((config) => {
  const token =
    localStorage.getItem("accessToken") ||
    localStorage.getItem("adminToken") ||
    sessionStorage.getItem("adminToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response error handler ─────────────────────────────────────────────────
API.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("API Error:", error.message);
    return Promise.reject(error);
  }
);

export default API;