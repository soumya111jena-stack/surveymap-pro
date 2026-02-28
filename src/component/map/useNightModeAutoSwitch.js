import { useEffect, useRef } from "react";

/**
 * getSunTimes — pure JS sun position calculator (no external library needed)
 * Returns { sunrise, sunset } as Date objects for a given lat/lng/date
 * Based on NOAA solar calculations
 */
function getSunTimes(lat, lng, date = new Date()) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const dayOfYear = (d) => {
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d - start + (start.getTimezoneOffset() - d.getTimezoneOffset()) * 60 * 1000;
    return Math.floor(diff / 86400000);
  };

  const n = dayOfYear(date);
  const lngHour = lng / 15;

  const calcTime = (isSunrise) => {
    const t = n + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634;
    if (L > 360) L -= 360;
    if (L < 0) L += 360;
    let RA = deg * Math.atan(0.91764 * Math.tan(L * rad));
    if (RA > 360) RA -= 360;
    if (RA < 0) RA += 360;
    const Lq = Math.floor(L / 90) * 90;
    const RAq = Math.floor(RA / 90) * 90;
    RA = (RA + (Lq - RAq)) / 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(96 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null; // polar day/night
    const H = isSunrise
      ? (360 - deg * Math.acos(cosH)) / 15
      : (deg * Math.acos(cosH)) / 15;
    const T = H + RA - 0.06571 * t - 6.622;
    let UT = T - lngHour;
    if (UT > 24) UT -= 24;
    if (UT < 0) UT += 24;
    const result = new Date(date);
    result.setUTCHours(Math.floor(UT));
    result.setUTCMinutes(Math.round((UT % 1) * 60));
    result.setUTCSeconds(0);
    result.setUTCMilliseconds(0);
    return result;
  };

  return {
    sunrise: calcTime(true),
    sunset: calcTime(false),
  };
}

/**
 * useNightModeAutoSwitch
 *
 * @param {object} options
 * @param {boolean} options.enabled         - feature toggle
 * @param {string}  options.activeLayer     - current map layer name
 * @param {function} options.setActiveLayer - setter
 * @param {string}  options.nightLayer      - layer name to switch to at night (default "Dark")
 * @param {string}  options.dayLayer        - layer name to restore at sunrise (default "Satellite + Labels")
 * @param {function} options.onSwitch       - optional callback({ isNight, sunrise, sunset, switchedTo })
 */
export function useNightModeAutoSwitch({
  enabled,
  activeLayer,
  setActiveLayer,
  nightLayer = "Dark",
  dayLayer = "Satellite + Labels",
  onSwitch,
}) {
  const autoSwitchedRef = useRef(false); // true if WE switched it (not user)
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      clearTimeout(timerRef.current);
      return;
    }

    function scheduleSwitch() {
      clearTimeout(timerRef.current);

      // Try to get user's location for accurate sun times
      // Fall back to a default if geolocation unavailable
      const applyLogic = (lat, lng) => {
        const now = new Date();
        const { sunrise, sunset } = getSunTimes(lat, lng, now);
        if (!sunrise || !sunset) return; // polar regions

        const isNight = now >= sunset || now < sunrise;

        // Switch if auto-switched before or it's the first run
        if (isNight) {
          if (activeLayer !== nightLayer) {
            setActiveLayer(nightLayer);
            autoSwitchedRef.current = true;
            onSwitch?.({ isNight: true, sunrise, sunset, switchedTo: nightLayer });
          }
        } else {
          // Daytime — only restore if WE previously auto-switched
          if (autoSwitchedRef.current && activeLayer === nightLayer) {
            setActiveLayer(dayLayer);
            autoSwitchedRef.current = false;
            onSwitch?.({ isNight: false, sunrise, sunset, switchedTo: dayLayer });
          }
        }

        // Schedule next check at the next transition (sunrise or sunset)
        const nextTransition = isNight
          ? (now < sunrise ? sunrise : new Date(sunrise.getTime() + 86400000)) // tomorrow sunrise
          : sunset;

        const msUntilNext = nextTransition - now;
        console.log(
          `🌙 NightMode: ${isNight ? "NIGHT" : "DAY"} | Next switch in ${Math.round(msUntilNext / 60000)} min`
        );
        timerRef.current = setTimeout(scheduleSwitch, msUntilNext + 1000);
      };

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => applyLogic(pos.coords.latitude, pos.coords.longitude),
          () => applyLogic(20.2961, 85.8245) // fallback: Bhubaneswar
        );
      } else {
        applyLogic(20.2961, 85.8245);
      }
    }

    scheduleSwitch();

    return () => clearTimeout(timerRef.current);
  }, [enabled]); // only re-run when feature is toggled
}

export { getSunTimes };