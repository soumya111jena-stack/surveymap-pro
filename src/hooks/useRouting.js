// src/hooks/useRouting.js
import { useState, useCallback } from "react";

const OSRM_BASE = "https://router.project-osrm.org/route/v1";

export function useRouting() {
  const [routeResult,   setRouteResult]   = useState(null); // { routes, waypoints }
  const [routeLoading,  setRouteLoading]  = useState(false);
  const [routeError,    setRouteError]    = useState(null);
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);

  const calculateRoute = useCallback(async ({
    origin,       // { lat, lng, label }
    destination,  // { lat, lng, label }
    mode = "driving", // "driving" | "walking" | "cycling"
  }) => {
    if (!origin || !destination) return;
    setRouteLoading(true);
    setRouteError(null);
    setRouteResult(null);
    setActiveRouteIdx(0);

    const modeMap = { driving: "car", walking: "foot", cycling: "bike" };
    const profile = modeMap[mode] || "car";
    const coords  = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url     = `${OSRM_BASE}/${profile}/${coords}?steps=true&alternatives=true&overview=full&geometries=geojson`;

    try {
      const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Routing failed: ${res.status}`);
      const data = await res.json();

      if (data.code !== "Ok" || !data.routes?.length) {
        throw new Error("No route found between these locations.");
      }

      // Parse routes
      const routes = data.routes.map((r, idx) => ({
        index:       idx,
        distance:    r.distance,        // meters
        duration:    r.duration,        // seconds
        geometry:    r.geometry,        // GeoJSON LineString
        coordinates: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        legs:        r.legs,
        steps:       r.legs?.[0]?.steps?.map(step => ({
          instruction: step.maneuver?.instruction || cleanInstruction(step),
          distance:    step.distance,
          duration:    step.duration,
          name:        step.name,
          type:        step.maneuver?.type,
          modifier:    step.maneuver?.modifier,
        })) || [],
        summary:     r.legs?.[0]?.summary || "",
      }));

      setRouteResult({
        routes,
        origin,
        destination,
        mode,
      });
    } catch (err) {
      setRouteError(err.message || "Could not calculate route.");
    } finally {
      setRouteLoading(false);
    }
  }, []);

  const clearRoute = useCallback(() => {
    setRouteResult(null);
    setRouteError(null);
    setRouteLoading(false);
    setActiveRouteIdx(0);
  }, []);

  return {
    routeResult, routeLoading, routeError,
    activeRouteIdx, setActiveRouteIdx,
    calculateRoute, clearRoute,
  };
}

// Convert OSRM maneuver to human-readable instruction
function cleanInstruction(step) {
  const type     = step.maneuver?.type     || "";
  const modifier = step.maneuver?.modifier || "";
  const name     = step.name ? `onto ${step.name}` : "";
  const map = {
    "depart":        `Head ${modifier} ${name}`,
    "arrive":        `Arrive at destination`,
    "turn":          `Turn ${modifier} ${name}`,
    "new name":      `Continue ${name}`,
    "continue":      `Continue ${modifier} ${name}`,
    "merge":         `Merge ${modifier} ${name}`,
    "on ramp":       `Take the ramp ${modifier}`,
    "off ramp":      `Take the exit ${modifier}`,
    "fork":          `Keep ${modifier} at fork ${name}`,
    "end of road":   `Turn ${modifier} at end of road ${name}`,
    "roundabout":    `Enter roundabout`,
    "rotary":        `Enter rotary`,
    "roundabout turn": `At roundabout, turn ${modifier}`,
  };
  return (map[type] || `${type} ${modifier} ${name}`).trim().replace(/\s+/g, " ");
}