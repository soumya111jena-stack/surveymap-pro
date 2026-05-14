/**
 * apiConfig.js — SurveyMap Pro
 * 
 * Emulator UA contains: "sdk_gphone64_x86_64"
 * Real phone UA does NOT contain "sdk_gphone"
 */

function getBaseUrl() {
  const ua = navigator.userAgent || "";

  // Matches: sdk_gphone64_x86_64, sdk_gphone_x86, etc.
  const isEmulator = ua.includes("sdk_gphone");

  const url = isEmulator
    ? "http://10.0.2.2:8080"
    : "http://192.168.29.173:8080";

  console.log("[apiConfig] isEmulator:", isEmulator, "→", url);
  return url;
}

export const BASE_URL = getBaseUrl();