/**
 * SatelliteTimeSlider.jsx — SurveyMap Pro
 *
 * Uses Esri World Imagery Wayback — same high-res Maxar/Nearmap imagery as
 * Google Earth Historical Imagery. Free, no API key required.
 *
 * CORRECT tile URL (from Esri/wayback-core GitHub):
 *  https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/
 *  WMTS/1.0.0/default028mm/MapServer/tile/{releaseNum}/{level}/{row}/{col}
 *
 * Real release numbers fetched live from Esri's public config JSON:
 *  https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json
 */
import { useEffect, useRef, useState } from "react";

// Config URL confirmed from Esri/wayback-core GitHub source
const WAYBACK_CONFIG =
  "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";

// Correct tile URL — uses {level}/{row}/{col} NOT {z}/{y}/{x}
const buildTileUrl = (releaseNum) =>
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${releaseNum}/{z}/{y}/{x}`;

// Fallback hardcoded releases in case config fetch fails
// Cesium UrlTemplateImageryProvider maps {z}→level, {y}→row, {x}→col
const FALLBACK_RELEASES = [
  { year: 2014, releaseNum: 10,   date: "2014-02-20" },
  { year: 2015, releaseNum: 3,    date: "2015-08-06" },
  { year: 2016, releaseNum: 4,    date: "2016-11-10" },
  { year: 2017, releaseNum: 5,    date: "2017-05-11" },
  { year: 2018, releaseNum: 6,    date: "2018-01-11" },
  { year: 2019, releaseNum: 7,    date: "2019-03-14" },
  { year: 2020, releaseNum: 8,    date: "2020-05-07" },
  { year: 2021, releaseNum: 9,    date: "2021-07-08" },
  { year: 2022, releaseNum: 11,   date: "2022-09-01" },
  { year: 2023, releaseNum: 12,   date: "2023-10-12" },
  { year: 2024, releaseNum: 13,   date: "2024-10-03" },
];

export default function SatelliteTimeSlider({ viewer, Cesium, visible, onClose }) {
  const [releases, setReleases]     = useState([]);   // loaded from config
  const [epochIdx, setEpochIdx]     = useState(0);
  const [comparing, setComparing]   = useState(false);
  const [compareIdx, setCompareIdx] = useState(0);
  const [opacity, setOpacity]       = useState(1.0);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [configErr, setConfigErr]   = useState(false);

  const layerRef        = useRef(null);
  const compareLayerRef = useRef(null);
  const playTimerRef    = useRef(null);

  // ── Fetch release list from Esri config JSON ───────────────────────────
  useEffect(() => {
    if (!visible) return;
    fetch(WAYBACK_CONFIG)
      .then(r => r.json())
      .then(data => {
        // data is an object keyed by releaseNum: { itemTitle, itemURL, ... }
        // itemTitle example: "World Imagery (Wayback 2024-10-03)"
        const parsed = Object.entries(data)
          .map(([key, val]) => {
            const match = val.itemTitle?.match(/(\d{4}-\d{2}-\d{2})/);
            const date = match ? match[1] : null;
            const year = date ? parseInt(date.slice(0, 4)) : null;
            return { releaseNum: parseInt(key), date, year, title: val.itemTitle };
          })
          .filter(r => r.year && r.year >= 2014)
          .sort((a, b) => a.releaseNum - b.releaseNum);

        // Pick one per year — the earliest release of each year
        const byYear = {};
        parsed.forEach(r => {
          if (!byYear[r.year]) byYear[r.year] = r;
        });

        const yearly = Object.values(byYear).sort((a, b) => a.year - b.year);
        setReleases(yearly);
        setEpochIdx(yearly.length - 1);
        setLoading(false);
      })
      .catch(() => {
        // Config fetch failed — use fallback
        setConfigErr(true);
        setReleases(FALLBACK_RELEASES);
        setEpochIdx(FALLBACK_RELEASES.length - 1);
        setLoading(false);
      });
  }, [visible]);

  // ── Load imagery layer ───────────────────────────────────────────────────
  const loadLayer = (idx, targetRef, splitDir = null) => {
    if (!viewer || !Cesium || !releases.length) return;
    if (targetRef.current) {
      try { viewer.imageryLayers.remove(targetRef.current, true); } catch (_) {}
      targetRef.current = null;
    }

    const ep = releases[idx];
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: buildTileUrl(ep.releaseNum),
      credit: `© Esri, Maxar — World Imagery Wayback ${ep.date}`,
      minimumLevel: 1,
      maximumLevel: 19,
      tileWidth: 256,
      tileHeight: 256,
    });

    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = opacity;
    if (splitDir !== null && Cesium.SplitDirection) layer.splitDirection = splitDir;

    viewer.imageryLayers.lowerToBottom(layer);
    try { if (viewer.imageryLayers.length > 1) viewer.imageryLayers.raise(layer); } catch(_){}

    targetRef.current = layer;
  };

  useEffect(() => {
    if (!visible || !releases.length) return;
    loadLayer(epochIdx, layerRef, comparing ? Cesium?.SplitDirection?.RIGHT : null);
  }, [epochIdx, releases, visible]); // eslint-disable-line

  useEffect(() => {
    if (!visible || !releases.length) return;
    if (comparing) {
      if (viewer && Cesium?.SplitDirection) {
        const ls = viewer.imageryLayers;
        for (let i = 0; i < ls.length; i++) {
          const l = ls.get(i);
          if (l !== layerRef.current && l !== compareLayerRef.current)
            l.splitDirection = Cesium.SplitDirection.LEFT;
        }
        if (layerRef.current) layerRef.current.splitDirection = Cesium.SplitDirection.RIGHT;
      }
      loadLayer(compareIdx, compareLayerRef, Cesium?.SplitDirection?.LEFT);
    } else {
      if (compareLayerRef.current) {
        try { viewer?.imageryLayers.remove(compareLayerRef.current, true); } catch(_){}
        compareLayerRef.current = null;
      }
      if (viewer && Cesium?.SplitDirection) {
        const ls = viewer.imageryLayers;
        for (let i = 0; i < ls.length; i++) {
          try { ls.get(i).splitDirection = Cesium.SplitDirection.NONE; } catch(_){}
        }
      }
    }
  }, [comparing, compareIdx, releases, visible]); // eslint-disable-line

  useEffect(() => {
    if (layerRef.current) layerRef.current.alpha = opacity;
    if (compareLayerRef.current) compareLayerRef.current.alpha = opacity;
  }, [opacity]);

  useEffect(() => {
    if (isPlaying && releases.length) {
      playTimerRef.current = setInterval(() =>
        setEpochIdx(i => (i + 1) % releases.length), 1800);
    } else clearInterval(playTimerRef.current);
    return () => clearInterval(playTimerRef.current);
  }, [isPlaying, releases]);

  useEffect(() => {
    if (!visible) {
      setIsPlaying(false);
      [layerRef, compareLayerRef].forEach(ref => {
        if (ref.current) {
          try { viewer?.imageryLayers.remove(ref.current, true); } catch(_){}
          ref.current = null;
        }
      });
      if (viewer && Cesium?.SplitDirection) {
        const ls = viewer.imageryLayers;
        for (let i = 0; i < ls.length; i++) {
          try { ls.get(i).splitDirection = Cesium.SplitDirection.NONE; } catch(_){}
        }
      }
    }
  }, [visible]); // eslint-disable-line

  if (!visible) return null;

  const current = releases[epochIdx];
  const ss = x => ({ fontFamily:"'Segoe UI',sans-serif", ...x });

  return (
    <div style={ss({
      position:"fixed", bottom:36, left:"50%", transform:"translateX(-50%)",
      zIndex:1200, width:Math.min(600, window.innerWidth - 24),
      background:"rgba(10,16,26,.97)", border:"1px solid rgba(99,102,241,.3)",
      borderRadius:14, overflow:"hidden",
      boxShadow:"0 -4px 32px rgba(0,0,0,.65)",
      backdropFilter:"blur(14px)",
    })}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,.06)",
        background:"rgba(99,102,241,.08)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>🛰️</span>
          <span style={ss({ color:"#a78bfa", fontWeight:700, fontSize:13 })}>Satellite Time Slider</span>
          {loading && <span style={{ color:"#7c3aed", fontSize:13,
            display:"inline-block", animation:"spin .8s linear infinite" }}>⟳</span>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {configErr
            ? <span style={ss({ fontSize:10, color:"#f87171" })}>⚠ Offline mode</span>
            : <span style={ss({ fontSize:10, color:"#475569" })}>Esri Wayback · Maxar/World Imagery</span>
          }
          <button onClick={onClose} style={{ background:"none", border:"none",
            color:"#475569", cursor:"pointer", fontSize:15 }}>✕</button>
        </div>
      </div>

      {loading ? (
        <div style={ss({ padding:"24px", textAlign:"center", color:"#475569", fontSize:12 })}>
          ⟳ Loading release list from Esri…
        </div>
      ) : (
        <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>

          {/* Year ticks */}
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, padding:"0 4px",
              overflowX:"auto" }}>
              {releases.map((e, i) => (
                <div key={e.releaseNum} onClick={() => { setIsPlaying(false); setEpochIdx(i); }}
                  style={{ cursor:"pointer", display:"flex", flexDirection:"column",
                    alignItems:"center", gap:2, minWidth:28 }}>
                  <div style={{ width:3, height: epochIdx===i ? 14 : 6,
                    background: epochIdx===i ? "#a78bfa" : "#1e3050",
                    borderRadius:2, transition:"all .15s" }}/>
                  <span style={ss({ fontSize: epochIdx===i ? 11 : 9,
                    color: epochIdx===i ? "#a78bfa" : "#334155",
                    fontWeight: epochIdx===i ? 700 : 400 })}>{e.year}</span>
                </div>
              ))}
            </div>
            <input type="range" min={0} max={releases.length - 1} value={epochIdx}
              onChange={e => { setIsPlaying(false); setEpochIdx(+e.target.value); }}
              style={{ width:"100%", accentColor:"#7c3aed", cursor:"pointer", height:4 }}/>
          </div>

          {/* Controls */}
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <div style={ss({ padding:"4px 14px", borderRadius:100,
              background:"rgba(99,102,241,.18)", border:"1px solid rgba(99,102,241,.35)",
              color:"#a78bfa", fontWeight:700, fontSize:14 })}>{current?.year}</div>
            <div style={ss({ fontSize:11, color:"#64748b", flex:1 })}>
              {current?.date}
            </div>
            <button onClick={() => setIsPlaying(p => !p)} style={ss({
              padding:"5px 14px", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer",
              border: isPlaying ? "1px solid rgba(239,68,68,.4)" : "1px solid rgba(99,102,241,.4)",
              background: isPlaying ? "rgba(239,68,68,.1)" : "rgba(99,102,241,.1)",
              color: isPlaying ? "#f87171" : "#a78bfa",
            })}>{isPlaying ? "⏸ Pause" : "▶ Play"}</button>
            <button onClick={() => setComparing(p => !p)} style={ss({
              padding:"5px 14px", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer",
              border: comparing ? "1px solid rgba(251,191,36,.4)" : "1px solid rgba(255,255,255,.1)",
              background: comparing ? "rgba(251,191,36,.08)" : "transparent",
              color: comparing ? "#fbbf24" : "#475569",
            })}>⚖ Compare</button>
          </div>

          {/* Compare mode */}
          {comparing && (
            <div style={ss({ padding:"10px 12px", background:"rgba(251,191,36,.05)", borderRadius:8,
              border:"1px solid rgba(251,191,36,.2)", display:"flex", flexDirection:"column", gap:8 })}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={ss({ fontSize:11, color:"#fbbf24", fontWeight:700, minWidth:46 })}>LEFT</span>
                <select value={compareIdx} onChange={e => setCompareIdx(+e.target.value)}
                  style={ss({ flex:1, padding:"4px 8px", borderRadius:5,
                    border:"1px solid rgba(251,191,36,.3)",
                    background:"rgba(0,0,0,.5)", color:"#fbbf24", fontSize:11 })}>
                  {releases.map((e, i) => (
                    <option key={e.releaseNum} value={i}>{e.year} — {e.date}</option>
                  ))}
                </select>
                <span style={ss({ fontSize:11, color:"#a78bfa", fontWeight:700, minWidth:46 })}>RIGHT</span>
                <span style={ss({ padding:"4px 8px", borderRadius:5,
                  background:"rgba(99,102,241,.15)", color:"#a78bfa",
                  fontSize:11, fontWeight:700 })}>{current?.year}</span>
              </div>
              <div style={ss({ fontSize:10, color:"#78716c" })}>
                Drag the split line on the map to compare. Left = {releases[compareIdx]?.year}, Right = {current?.year}.
              </div>
            </div>
          )}

          {/* Opacity */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={ss({ fontSize:10, color:"#475569", fontWeight:700, width:48 })}>OPACITY</span>
            <input type="range" min={0.1} max={1} step={0.05} value={opacity}
              onChange={e => setOpacity(+e.target.value)}
              style={{ flex:1, accentColor:"#7c3aed", cursor:"pointer" }}/>
            <span style={ss({ fontSize:10, color:"#a78bfa", width:32, textAlign:"right",
              fontFamily:"monospace" })}>{Math.round(opacity * 100)}%</span>
          </div>

          {/* Year strip */}
          <div style={{ display:"flex", gap:3, overflowX:"auto", paddingBottom:2 }}>
            {releases.map((e, i) => (
              <div key={e.releaseNum} onClick={() => { setIsPlaying(false); setEpochIdx(i); }}
                style={ss({ flexShrink:0, width:44, padding:"5px 0", borderRadius:6,
                  cursor:"pointer", textAlign:"center", transition:"all .12s",
                  border: epochIdx===i ? "1px solid rgba(99,102,241,.55)" : "1px solid rgba(255,255,255,.06)",
                  background: epochIdx===i ? "rgba(99,102,241,.18)" : "rgba(255,255,255,.02)" })}>
                <div style={{ fontSize:9, fontWeight: epochIdx===i ? 700 : 400,
                  color: epochIdx===i ? "#a78bfa" : "#334155" }}>{e.year}</div>
              </div>
            ))}
          </div>

          <div style={ss({ fontSize:10, color:"#334155", lineHeight:1.5 })}>
            💡 Same high-res imagery archive as Google Earth. Release ID: {current?.releaseNum}.
          </div>
        </div>
      )}
    </div>
  );
}