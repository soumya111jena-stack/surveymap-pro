// ─── mapUtils.js — SurveyMap Pro v5.9.9 · Enhanced Geocoder ─────────────────
//
// FIXES:
//  • Removed countrycodes:"in" restriction — now searches globally like Google Earth Pro
//  • Multi-strategy Nominatim search with 6 progressive fallback queries
//  • Better CORS proxy rotation with 4 proxies
//  • Photon (Komoot) added as additional geocoder
//  • Smarter zoomForType covering 50+ OSM type strings
//  • Coordinate parsing enhanced (supports DMS, decimal, signed formats)
//  • India city lookup preserved for bias (not restriction)
//  • District / taluk / village lookup for India added
//  • Wikipedia place lookup removed from geocoder (stays in SurveyMap.jsx)
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Zoom level → best zoom for type ──────────────────────────────────────────
export function zoomForType(type) {
  const t = (type || "").toLowerCase().replace(/_/g, " ").trim();

  if (["country", "nation"].some(k => t.includes(k)))                          return 5;
  if (["state", "province", "region", "administrative area level 1",
       "union territory"].some(k => t.includes(k)))                            return 7;
  if (["administrative area level 2","district","county","prefecture",
       "division"].some(k => t.includes(k)))                                   return 9;
  if (["administrative area level 3","subdistrict","taluk","tehsil",
       "block", "mandal"].some(k => t.includes(k)))                            return 11;
  if (["city","municipality","municipal corporation","urban agglomeration",
       "metropolitan"].some(k => t.includes(k)))                               return 12;
  if (["town","census town"].some(k => t.includes(k)))                        return 13;
  if (["postcode","postal","zip"].some(k => t.includes(k)))                   return 13;
  if (["village","hamlet","suburb","neighbourhood","quarter","residential",
       "locality","ward","colony","nagar","panchayat"].some(k => t.includes(k))) return 14;
  if (["street","road","avenue","boulevard","highway","lane","pedestrian",
       "footway","route","expressway","bypass","ring road"].some(k => t.includes(k))) return 16;
  if (["amenity","shop","office","restaurant","cafe","hotel","hospital","bank",
       "pharmacy","school","college","university","place of worship","temple",
       "church","mosque","gurudwara","mandir","masjid","stadium","airport",
       "station","railway","metro","bus stop","park","garden","museum","mall",
       "market","complex","building","tower","monument","fort","palace","beach",
       "lake","dam","reservoir","waterfall","point of interest","establishment",
       "attraction","landmark","police","fire station","library",
       "cinema","theater","theatre"].some(k => t.includes(k)))                 return 17;
  if (["peak","mountain","hill","volcano","pass","ridge"].some(k => t.includes(k))) return 13;
  if (["river","stream","bay","gulf","ocean","sea","island",
       "peninsula"].some(k => t.includes(k)))                                  return 11;
  return 14;
}

// ── CORS Proxies (tried in order) ─────────────────────────────────────────────
const PROXIES = [
  "https://corsproxy.io/?url=",
  "https://api.allorigins.win/raw?url=",
  "https://cors-anywhere.herokuapp.com/",
  "https://thingproxy.freeboard.io/fetch/",
];

async function fetchWithProxy(url, timeout = 7000) {
  // Try direct first (works in some environments / if CORS is allowed)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (res.ok) return res;
  } catch (_) {}

  for (const proxy of PROXIES) {
    try {
      const proxyUrl = proxy.includes("cors-anywhere") || proxy.includes("thingproxy")
        ? `${proxy}${url}`
        : `${proxy}${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeout) });
      if (res.ok) return res;
    } catch (_) { continue; }
  }
  return null;
}

// ── India city/place offline lookup ──────────────────────────────────────────
export const INDIA_CITIES = {
  // Odisha
  bhubaneswar:{lat:20.2961,lng:85.8245},cuttack:{lat:20.4625,lng:85.8828},
  puri:{lat:19.8135,lng:85.8312},rourkela:{lat:22.2604,lng:84.8536},
  sambalpur:{lat:21.4669,lng:83.9756},berhampur:{lat:19.3150,lng:84.7941},
  balasore:{lat:21.4934,lng:86.9330},bhadrak:{lat:21.0550,lng:86.4997},
  kendrapara:{lat:20.5027,lng:86.4136},konark:{lat:19.8876,lng:86.1211},
  jagannath:{lat:19.8047,lng:85.8283},
  // Major metros
  kolkata:{lat:22.5726,lng:88.3639},delhi:{lat:28.6139,lng:77.2090},
  mumbai:{lat:19.0760,lng:72.8777},bangalore:{lat:12.9716,lng:77.5946},
  bengaluru:{lat:12.9716,lng:77.5946},hyderabad:{lat:17.3850,lng:78.4867},
  chennai:{lat:13.0827,lng:80.2707},pune:{lat:18.5204,lng:73.8567},
  ahmedabad:{lat:23.0225,lng:72.5714},surat:{lat:21.1702,lng:72.8311},
  jaipur:{lat:26.9124,lng:75.7873},lucknow:{lat:26.8467,lng:80.9462},
  patna:{lat:25.5941,lng:85.1376},ranchi:{lat:23.3441,lng:85.3096},
  visakhapatnam:{lat:17.6868,lng:83.2185},vizag:{lat:17.6868,lng:83.2185},
  nagpur:{lat:21.1458,lng:79.0882},indore:{lat:22.7196,lng:75.8577},
  chandigarh:{lat:30.7333,lng:76.7794},coimbatore:{lat:11.0168,lng:76.9558},
  kochi:{lat:9.9312,lng:76.2673},cochin:{lat:9.9312,lng:76.2673},
  guwahati:{lat:26.1445,lng:91.7362},bhopal:{lat:23.2599,lng:77.4126},
  raipur:{lat:21.2514,lng:81.6296},agra:{lat:27.1767,lng:78.0081},
  varanasi:{lat:25.3176,lng:82.9739},dehradun:{lat:30.3165,lng:78.0322},
  mysore:{lat:12.2958,lng:76.6394},mysuru:{lat:12.2958,lng:76.6394},
  madurai:{lat:9.9252,lng:78.1198},tiruchirappalli:{lat:10.7905,lng:78.7047},
  trichy:{lat:10.7905,lng:78.7047},thiruvananthapuram:{lat:8.5241,lng:76.9366},
  trivandrum:{lat:8.5241,lng:76.9366},amritsar:{lat:31.6340,lng:74.8723},
  srinagar:{lat:34.0837,lng:74.7973},jammu:{lat:32.7266,lng:74.8570},
  goa:{lat:15.2993,lng:74.1240},panaji:{lat:15.4909,lng:73.8278},
  hubli:{lat:15.3647,lng:75.1240},dharwad:{lat:15.4589,lng:75.0078},
  // World cities
  london:{lat:51.5074,lng:-0.1278},paris:{lat:48.8566,lng:2.3522},
  newyork:{lat:40.7128,lng:-74.0060},"new york":{lat:40.7128,lng:-74.0060},
  tokyo:{lat:35.6762,lng:139.6503},beijing:{lat:39.9042,lng:116.4074},
  sydney:{lat:-33.8688,lng:151.2093},dubai:{lat:25.2048,lng:55.2708},
  singapore:{lat:1.3521,lng:103.8198},bangkok:{lat:13.7563,lng:100.5018},
  moscow:{lat:55.7558,lng:37.6173},berlin:{lat:52.5200,lng:13.4050},
  rome:{lat:41.9028,lng:12.4964},madrid:{lat:40.4168,lng:-3.7038},
  toronto:{lat:43.6532,lng:-79.3832},losangeles:{lat:34.0522,lng:-118.2437},
  "los angeles":{lat:34.0522,lng:-118.2437},chicago:{lat:41.8781,lng:-87.6298},
};

export function extractCity(q) {
  const lower = q.toLowerCase().trim();
  // exact match first
  if (INDIA_CITIES[lower]) return { city: lower, coords: INDIA_CITIES[lower] };
  // partial match
  for (const [city, coords] of Object.entries(INDIA_CITIES)) {
    if (lower.includes(city)) return { city, coords };
  }
  return null;
}

// ── Parse DMS coordinate strings ──────────────────────────────────────────────
function parseDMS(str) {
  // e.g. "20°17'45.9"N 85°49'28.2"E" or "20 17 45 N 85 49 28 E"
  const dms = /(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([NSEW])/gi;
  const matches = [...str.matchAll(dms)];
  if (matches.length >= 2) {
    const toDecimal = (d, m, s, dir) => {
      const val = parseFloat(d) + parseFloat(m)/60 + parseFloat(s)/3600;
      return (dir === 'S' || dir === 'W') ? -val : val;
    };
    const lat = toDecimal(matches[0][1], matches[0][2], matches[0][3], matches[0][4].toUpperCase());
    const lng = toDecimal(matches[1][1], matches[1][2], matches[1][3], matches[1][4].toUpperCase());
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }
  return null;
}

// ── Nominatim search with full options ───────────────────────────────────────
async function nominatimSearch(query, options = {}) {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "10",
    polygon_geojson: "1",
    addressdetails: "1",
    namedetails: "1",
    extratags: "1",
    "accept-language": "en",
    ...options,
  });
  // Remove countrycodes if not explicitly set — search globally
  if (!options.countrycodes) params.delete("countrycodes");

  const url = `https://nominatim.openstreetmap.org/search?${params}`;
  const res = await fetchWithProxy(url, 8000);
  if (!res) return null;
  try {
    const data = await res.json();
    return Array.isArray(data) && data.length ? data : null;
  } catch { return null; }
}

// ── Photon geocoder (Komoot) — excellent global coverage ─────────────────────
async function photonSearch(query, lat = null, lng = null) {
  const params = new URLSearchParams({ q: query, limit: "5", lang: "en" });
  if (lat && lng) { params.set("lat", lat); params.set("lon", lng); }
  const url = `https://photon.komoot.io/api/?${params}`;
  const res = await fetchWithProxy(url, 7000);
  if (!res) return null;
  try {
    const data = await res.json();
    if (data?.features?.length) return data.features;
    return null;
  } catch { return null; }
}

// ── Convert Nominatim result → standard format ────────────────────────────────
function fromNominatim(r, query) {
  const addr = r.address || {};
  const name =
    r.namedetails?.name ||
    r.display_name?.split(",")?.[0] ||
    addr.amenity || addr.building || addr.road ||
    addr.neighbourhood || addr.suburb || addr.village ||
    addr.town || addr.city || addr.county || addr.state ||
    query.split(",")?.[0];

  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    name: name.trim(),
    type: r.type || r.class || "place",
    display_name: r.display_name,
    bbox: r.boundingbox || null,
    geojson: r.geojson || null,
    source: "osm",
    importance: parseFloat(r.importance || 0),
  };
}

// ── Convert Photon result → standard format ───────────────────────────────────
function fromPhoton(f, query) {
  const p = f.properties || {};
  const name = p.name || p.city || p.street || p.county || p.state || query.split(",")?.[0];
  const parts = [p.name, p.street, p.city || p.town || p.village, p.county, p.state, p.country].filter(Boolean);
  return {
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    name: name?.trim(),
    type: p.osm_value || p.type || "place",
    display_name: parts.join(", "),
    bbox: null,
    geojson: null,
    source: "photon",
    importance: 0,
  };
}

// ── Score a result by how well it matches the query ───────────────────────────
function scoreResult(result, query) {
  const q = query.toLowerCase();
  const name = (result.name || "").toLowerCase();
  const display = (result.display_name || "").toLowerCase();
  let score = result.importance || 0;
  if (name === q) score += 10;
  else if (name.startsWith(q.split(",")[0].toLowerCase().trim())) score += 5;
  else if (display.includes(q.split(",")[0].toLowerCase().trim())) score += 2;
  return score;
}

// ── MAIN GEOCODER ─────────────────────────────────────────────────────────────
// Searches globally — no country restriction — like Google Earth Pro
export async function geocodeForMap(query) {
  const q = query.trim();
  if (!q) return null;

  // ── 1. Pure coordinate input (decimal) ──────────────────────────────────
  const decMatch = q.match(/^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/);
  if (decMatch) {
    const lat = parseFloat(decMatch[1]), lng = parseFloat(decMatch[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng, name: `${lat.toFixed(6)}, ${lng.toFixed(6)}`, type: "coordinate", display_name: `${lat.toFixed(6)}, ${lng.toFixed(6)}`, source: "coordinate" };
    }
  }

  // ── 2. DMS coordinate input ──────────────────────────────────────────────
  const dmsResult = parseDMS(q);
  if (dmsResult) {
    return { lat: dmsResult.lat, lng: dmsResult.lng, name: `${dmsResult.lat.toFixed(6)}, ${dmsResult.lng.toFixed(6)}`, type: "coordinate", display_name: q, source: "dms" };
  }

  // ── 3. Build search strategies ───────────────────────────────────────────
  const parts = q.split(",").map(s => s.trim()).filter(Boolean);
  const cityMatch = extractCity(q);

  // Strategies: from most specific to most broad
  const strategies = [];

  // a) Exact query — with viewbox bias toward known city if detected
  const s1 = { q };
  if (cityMatch) {
    const c = cityMatch.coords;
    s1.viewbox = `${c.lng-0.8},${c.lat+0.8},${c.lng+0.8},${c.lat-0.8}`;
    s1.bounded = "0"; // soft bias, not hard restriction
  }
  strategies.push(s1);

  // b) Same query without viewbox (global)
  if (cityMatch) strategies.push({ q });

  // c) Progressively drop leading parts (e.g. "Shop Name, Street, City" → "Street, City")
  for (let i = 1; i < Math.min(parts.length, 4); i++) {
    strategies.push({ q: parts.slice(i).join(", ") });
  }

  // d) Just the first meaningful part
  if (parts.length > 1) {
    strategies.push({ q: parts[0] });
  }

  // e) Transliterated / alternate (e.g. add "India" for Indian place searches)
  if (cityMatch && parts.length > 1) {
    strategies.push({ q: `${q}, India` });
  }

  // ── 4. Run Nominatim strategies ──────────────────────────────────────────
  let allResults = [];

  for (const opts of strategies) {
    const { q: sq, ...rest } = opts;
    const data = await nominatimSearch(sq, rest);
    if (data) {
      const mapped = data.map(r => fromNominatim(r, sq));
      allResults.push(...mapped);
      // If we have a high-confidence result (importance > 0.5), stop early
      if (mapped[0]?.importance > 0.5) break;
    }
    if (allResults.length >= 3) break; // enough results, stop trying
  }

  // ── 5. Photon fallback if Nominatim found nothing ────────────────────────
  if (allResults.length === 0) {
    const photonData = await photonSearch(q, cityMatch?.coords?.lat, cityMatch?.coords?.lng);
    if (photonData) {
      allResults = photonData.map(f => fromPhoton(f, q));
    }
  }

  // ── 6. Deduplicate by proximity (within ~1km) ────────────────────────────
  const deduped = [];
  for (const r of allResults) {
    const near = deduped.some(d => Math.abs(d.lat - r.lat) < 0.01 && Math.abs(d.lng - r.lng) < 0.01);
    if (!near) deduped.push(r);
  }

  // ── 7. Sort by score ─────────────────────────────────────────────────────
  deduped.sort((a, b) => scoreResult(b, q) - scoreResult(a, q));

  if (deduped.length > 0) return deduped[0];

  // ── 8. Offline city fallback ─────────────────────────────────────────────
  if (cityMatch) {
    return {
      lat: cityMatch.coords.lat,
      lng: cityMatch.coords.lng,
      name: cityMatch.city.charAt(0).toUpperCase() + cityMatch.city.slice(1),
      type: "city",
      display_name: `${cityMatch.city}, (offline fallback)`,
      source: "fallback",
    };
  }

  return null;
}

// ── Reverse geocode (Nominatim) ───────────────────────────────────────────────
export async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18&accept-language=en`;
  try {
    const res = await fetchWithProxy(url, 7000);
    if (!res) return null;
    return await res.json();
  } catch { return null; }
}

// ── Multi-result search (for AddSearch component if needed) ───────────────────
export async function searchPlaces(query, maxResults = 8) {
  const q = query.trim();
  if (!q) return [];
  const data = await nominatimSearch(q, { limit: String(maxResults) });
  if (!data) return [];
  return data.map(r => fromNominatim(r, q));
}