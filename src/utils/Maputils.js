// ─── mapUtils.js — Pure coordinate / format / geocode helpers ────────────────

// ── Zoom ↔ altitude approximation ────────────────────────────────────────────
const ZOOM_ALT = {
  1:147e6,2:73e6,3:36e6,4:18e6,5:9e6,6:4500000,7:2250000,8:1100000,
  9:550000,10:275000,11:137000,12:68000,13:34000,14:17000,15:8500,
  16:4200,17:2100,18:1050,19:525,20:262,
};
export function zoomToAltitude(zoom) { return ZOOM_ALT[Math.round(zoom)] || 34000; }

// ── Coordinate formatters ─────────────────────────────────────────────────────
export function toDMS(val, pos, neg) {
  const a = Math.abs(val), d = Math.floor(a),
        m = Math.floor((a - d) * 60),
        s = ((a - d - m / 60) * 3600).toFixed(1);
  return `${d}°${String(m).padStart(2,"0")}'${String(parseFloat(s).toFixed(1)).padStart(4,"0")}" ${val >= 0 ? pos : neg}`;
}

export function toUTM(lat, lng) {
  const a=6378137, f=1/298.257223563, b=a*(1-f);
  const e2=1-(b*b)/(a*a), e=Math.sqrt(e2), ep2=e2/(1-e2);
  const zone=Math.floor((lng+180)/6)+1;
  const lon0=(zone-1)*6-180+3;
  const latR=lat*Math.PI/180, lonR=lng*Math.PI/180, lon0R=lon0*Math.PI/180;
  const N=a/Math.sqrt(1-e2*Math.sin(latR)**2);
  const T=Math.tan(latR)**2, C=ep2*Math.cos(latR)**2, A=Math.cos(latR)*(lonR-lon0R);
  const k0=0.9996;
  const M=a*((1-e2/4-3*e2**2/64-5*e2**3/256)*latR
    -(3*e2/8+3*e2**2/32+45*e2**3/1024)*Math.sin(2*latR)
    +(15*e2**2/256+45*e2**3/1024)*Math.sin(4*latR)
    -(35*e2**3/3072)*Math.sin(6*latR));
  let x=k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T**2+72*C-58*ep2)*A**5/120)+500000;
  let y=k0*(M+N*Math.tan(latR)*(A**2/2+(5-T+9*C+4*C**2)*A**4/24+(61-58*T+T**2+600*C-330*ep2)*A**6/720));
  if (lat < 0) y += 10000000;
  const band = "CDEFGHJKLMNPQRSTUVWX"[Math.min(Math.floor((lat+80)/8),19)] || "Z";
  return `${zone}${band} ${Math.round(x)} ${Math.round(y)}`;
}

export function toPlusCode(lat, lng) {
  const ld=Math.floor(Math.abs(lat)), lo=Math.floor(Math.abs(lng));
  const lm=Math.floor((Math.abs(lat)-ld)*60), nm=Math.floor((Math.abs(lng)-lo)*60);
  return `${ld}°${lm}'${lat>=0?"N":"S"} ${lo}°${nm}'${lng>=0?"E":"W"}`;
}

// ── Bearing → compass label ───────────────────────────────────────────────────
export function bearingLabel(b) {
  const n = ((b % 360) + 360) % 360;
  if (n < 22.5)  return "N";
  if (n < 67.5)  return "NE";
  if (n < 112.5) return "E";
  if (n < 157.5) return "SE";
  if (n < 202.5) return "S";
  if (n < 247.5) return "SW";
  if (n < 292.5) return "W";
  if (n < 337.5) return "NW";
  return "N";
}

// ── Zoom level → best search zoom ────────────────────────────────────────────
export function zoomForType(type) {
  const t = (type || "").toLowerCase().replace(/_/g, " ");
  if (["country"].some(k => t.includes(k))) return 6;
  if (["state","administrative area level 1"].some(k => t.includes(k))) return 8;
  if (["administrative area level 2","district","county"].some(k => t.includes(k))) return 10;
  if (["city","municipality"].some(k => t === k)) return 12;
  if (["town"].includes(t)) return 13;
  if (["village","hamlet","suburb","neighbourhood","quarter","residential","locality"].some(k => t.includes(k))) return 14;
  if (["street","road","pedestrian","footway","route"].some(k => t.includes(k))) return 16;
  if (["amenity","shop","office","restaurant","cafe","hotel","hospital","bank","pharmacy",
       "school","college","university","place of worship","temple","church","mosque",
       "point of interest","establishment"].some(k => t.includes(k))) return 17;
  if (["postcode"].includes(t)) return 13;
  return 14;
}

// ── India city lookup (for offline / biased geocoding) ───────────────────────
export const INDIA_CITIES = {
  bhubaneswar:{lat:20.2961,lng:85.8245},cuttack:{lat:20.4625,lng:85.8828},
  puri:{lat:19.8135,lng:85.8312},kolkata:{lat:22.5726,lng:88.3639},
  delhi:{lat:28.6139,lng:77.2090},mumbai:{lat:19.0760,lng:72.8777},
  bangalore:{lat:12.9716,lng:77.5946},hyderabad:{lat:17.3850,lng:78.4867},
  chennai:{lat:13.0827,lng:80.2707},pune:{lat:18.5204,lng:73.8567},
  ahmedabad:{lat:23.0225,lng:72.5714},surat:{lat:21.1702,lng:72.8311},
  jaipur:{lat:26.9124,lng:75.7873},lucknow:{lat:26.8467,lng:80.9462},
  patna:{lat:25.5941,lng:85.1376},ranchi:{lat:23.3441,lng:85.3096},
  visakhapatnam:{lat:17.6868,lng:83.2185},nagpur:{lat:21.1458,lng:79.0882},
  indore:{lat:22.7196,lng:75.8577},chandigarh:{lat:30.7333,lng:76.7794},
  coimbatore:{lat:11.0168,lng:76.9558},kochi:{lat:9.9312,lng:76.2673},
  guwahati:{lat:26.1445,lng:91.7362},bhopal:{lat:23.2599,lng:77.4126},
  raipur:{lat:21.2514,lng:81.6296},agra:{lat:27.1767,lng:78.0081},
  varanasi:{lat:25.3176,lng:82.9739},dehradun:{lat:30.3165,lng:78.0322},
};

export function extractCity(q) {
  const lower = q.toLowerCase();
  for (const [city, coords] of Object.entries(INDIA_CITIES)) {
    if (lower.includes(city)) return { city, coords };
  }
  return null;
}

// ── Geocoding (Google + Nominatim fallback) ───────────────────────────────────
export async function geocodeForMap(q) {
  const parts = q.split(",").map(s => s.trim()).filter(Boolean);
  const isSingle = parts.length <= 2;
  const cityMatch = extractCity(q);

  // Try Google via CORS proxies
  for (const proxy of ["https://corsproxy.io/?url=", "https://api.allorigins.win/raw?url="]) {
    try {
      const params = new URLSearchParams({ address: q, region: "in", language: "en" });
      if (cityMatch && !isSingle) {
        const c = cityMatch.coords;
        params.set("bounds", `${c.lat-0.4},${c.lng-0.4}|${c.lat+0.4},${c.lng+0.4}`);
      }
      const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;
      const res = await fetch(`${proxy}${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const d = await res.json();
      if (d.status === "OK" && d.results?.length) {
        const r = d.results[0];
        return {
          lat: r.geometry.location.lat, lng: r.geometry.location.lng,
          name: r.address_components?.[0]?.long_name || q.split(",")[0],
          type: r.types?.[0] || "place", display_name: r.formatted_address,
          bbox: r.geometry.viewport
            ? [String(r.geometry.viewport.southwest.lat), String(r.geometry.viewport.northeast.lat),
               String(r.geometry.viewport.southwest.lng), String(r.geometry.viewport.northeast.lng)]
            : null,
          source: "google",
        };
      }
    } catch (_) { continue; }
  }

  // Nominatim fallback
  const nominatim = async (query, extra = {}) => {
    const params = new URLSearchParams({ q: query, format: "json", limit: "5",
      polygon_geojson: "1", addressdetails: "1", "accept-language": "en", countrycodes: "in", ...extra });
    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    for (const px of [`https://corsproxy.io/?url=${encodeURIComponent(url)}`,
                       `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`]) {
      try {
        const res = await fetch(px, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data) && data.length) return data[0];
      } catch (_) { continue; }
    }
    return null;
  };

  let r = null;
  if (cityMatch && !isSingle) {
    const c = cityMatch.coords;
    r = await nominatim(q, { viewbox: `${c.lng-0.4},${c.lat+0.4},${c.lng+0.4},${c.lat-0.4}`, bounded: "1" });
  }
  if (!r) r = await nominatim(q);
  if (!r && parts.length > 1) {
    for (let skip = 1; skip < Math.min(parts.length, 4); skip++) {
      r = await nominatim(parts.slice(skip).join(", "));
      if (r) break;
    }
  }
  if (r) return {
    lat: parseFloat(r.lat), lng: parseFloat(r.lon),
    name: r.display_name?.split(",")?.[0] || q.split(",")[0],
    type: r.type || r.class || "place", display_name: r.display_name,
    bbox: r.boundingbox || null, geojson: r.geojson || null, source: "osm",
  };
  if (cityMatch) return {
    lat: cityMatch.coords.lat, lng: cityMatch.coords.lng,
    name: cityMatch.city.charAt(0).toUpperCase() + cityMatch.city.slice(1),
    type: "city", display_name: `${cityMatch.city}, India`, source: "fallback",
  };
  return null;
}

// ── Reverse geocode (Nominatim) ───────────────────────────────────────────────
export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}