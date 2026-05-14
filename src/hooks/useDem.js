/**
 * useDEM.js — DEM state management hook for SurveyMap Pro v5.9
 *
 * ✅ FIX 1: demRasterRef is now properly populated inside handleDEMStats
 *           (previously the rasterPayload arg was ignored — DEMElevationDrape
 *            always received null and the canvas stayed blank/white)
 * ✅ FIX 2: handleDEMStats correctly accepts (stats, rasterPayload) to match
 *           the DEMLoader onStats(stats, rasterPayload) call signature
 */

import { useState, useCallback, useRef } from "react";

export function useDEM() {
  const [demFile,      setDemFile]      = useState(null);
  const [demFileName,  setDemFileName]  = useState(null);
  const [demLoading,   setDemLoading]   = useState(false);
  const [demStats,     setDemStats]     = useState(null);   // { min, max, mean, width, height }
  const [demOpacity,   setDemOpacity]   = useState(0.75);
  const [demColorRamp, setDemColorRamp] = useState("Terrain");
  const [demError,     setDemError]     = useState(null);

  /**
   * Raw raster data ref — populated by DEMLoader via onStats callback.
   * Shape: { data, width, height, west, south, east, north, minVal, maxVal }
   *
   * ✅ FIX: Previously this was declared but NEVER written to.
   *   handleDEMStats(stats) only saved the summary stats and ignored the
   *   second argument (rasterPayload), so demRasterRef.current stayed null
   *   forever → DEMElevationDrape had no data → canvas rendered white.
   */
  const demRasterRef = useRef(null);

  /* ── Upload ───────────────────────────────────────────────────────── */
  const handleDEMUpload = useCallback((file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    const allowed = ["tif", "tiff", "asc", "dem", "img"];
    if (!allowed.includes(ext)) {
      alert(`Unsupported DEM format: .${ext}\nSupported: .tif .tiff .asc .dem .img`);
      return;
    }
    setDemError(null);
    setDemStats(null);
    setDemLoading(true);
    setDemFileName(file.name);
    setDemFile(file);
    // Clear stale raster when a new file is picked
    demRasterRef.current = null;
  }, []);

  /* ── Remove ───────────────────────────────────────────────────────── */
  const handleDEMRemove = useCallback(() => {
    setDemFile(null);
    setDemFileName(null);
    setDemLoading(false);
    setDemStats(null);
    setDemError(null);
    demRasterRef.current = null;
  }, []);

  /* ── Opacity ──────────────────────────────────────────────────────── */
  const handleDEMOpacity = useCallback((v) => {
    setDemOpacity(Math.max(0, Math.min(1, v)));
  }, []);

  /* ── Colour ramp ──────────────────────────────────────────────────── */
  const handleDEMColorRamp = useCallback((name) => {
    setDemColorRamp(name);
  }, []);

  /* ── Callbacks passed to DEMLoader ───────────────────────────────── */
  const handleDEMDone = useCallback(() => {
    setDemLoading(false);
    setDemError(null);
  }, []);

  const handleDEMError = useCallback((msg) => {
    setDemLoading(false);
    setDemError(msg || "Failed to load DEM file.");
    demRasterRef.current = null;
  }, []);

  /**
   * ✅ FIX: Accept BOTH arguments that DEMLoader passes:
   *     onStats(stats, rasterPayload)
   *
   *   - stats         = { min, max, mean, width, height }  → shown in UI panel
   *   - rasterPayload = { data, width, height, west, south, east, north, minVal, maxVal }
   *                     → stored in demRasterRef so DEMElevationDrape can sample it
   *
   * Old broken version:
   *   const handleDEMStats = useCallback((stats) => {   // rasterPayload silently dropped!
   *     setDemStats(stats);
   *     setDemLoading(false);
   *   }, []);
   */
  const handleDEMStats = useCallback((stats, rasterPayload) => {
    setDemStats(stats);
    setDemLoading(false);

    // ✅ Populate the ref — this is what was missing
    if (rasterPayload) {
      demRasterRef.current = rasterPayload;
    }
  }, []);

  return {
    demFile,
    demFileName,
    demLoading,
    demStats,
    demOpacity,
    demColorRamp,
    demError,
    demRasterRef,
    handleDEMUpload,
    handleDEMRemove,
    handleDEMOpacity,
    handleDEMColorRamp,
    handleDEMDone,
    handleDEMError,
    handleDEMStats,
  };
}