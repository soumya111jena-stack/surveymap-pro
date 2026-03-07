import { useRef, useState, useCallback, useEffect } from "react";
import { useMap } from "react-leaflet";

export default function NavControls() {
  const map = useMap();
  const [bearing, setBearing] = useState(0);
  const [zoom, setZoom] = useState(() => map.getZoom());
  const MIN_ZOOM = 2, MAX_ZOOM = 19;

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => map.off("zoomend", onZoom);
  }, [map]);

  // ── CSS tile rotation (no plugin needed) ───────────────────────────────
  const applyRotation = useCallback((deg) => {
    const norm = ((deg % 360) + 360) % 360;
    ["tilePane","overlayPane","markerPane","shadowPane","tooltipPane","popupPane"].forEach(p => {
      const el = map.getPanes()[p];
      if (el) el.style.transform = `rotate(${norm}deg)`;
    });
    setBearing(norm);
  }, [map]);

  const resetNorth = useCallback(() => applyRotation(0), [applyRotation]);

  // ── Compass drag ────────────────────────────────────────────────────────
  const roseRef = useRef(null);
  const dragging = useRef(false);
  const startAngle = useRef(0);
  const startBearing = useRef(0);

  const getAngle = useCallback((cx, cy) => {
    const el = roseRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.atan2(cy - (r.top + r.height/2), cx - (r.left + r.width/2)) * (180/Math.PI);
  }, []);

  const onPD = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    startAngle.current = getAngle(e.clientX, e.clientY);
    startBearing.current = bearing;
  }, [bearing, getAngle]);

  const onPM = useCallback((e) => {
    if (!dragging.current) return;
    applyRotation(startBearing.current + getAngle(e.clientX, e.clientY) - startAngle.current);
  }, [getAngle, applyRotation]);

  const onPU = useCallback(() => { dragging.current = false; }, []);

  // ── Zoom ────────────────────────────────────────────────────────────────
  const zoomIn  = useCallback(() => map.setZoom(Math.min(map.getZoom()+1, MAX_ZOOM)), [map]);
  const zoomOut = useCallback(() => map.setZoom(Math.max(map.getZoom()-1, MIN_ZOOM)), [map]);
  const onSlider = useCallback((e) => { const z=Number(e.target.value); map.setZoom(z); setZoom(z); }, [map]);

  // ── Pan ─────────────────────────────────────────────────────────────────
  const pan = useCallback((dir) => {
    const d={N:[0,-120],S:[0,120],E:[120,0],W:[-120,0]};
    map.panBy(d[dir],{animate:true});
  }, [map]);

  // ── Street View ─────────────────────────────────────────────────────────
  const streetView = useCallback(() => {
    const c=map.getCenter();
    window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.lat},${c.lng}`,"_blank");
  }, [map]);

  const sliderPct = ((zoom-MIN_ZOOM)/(MAX_ZOOM-MIN_ZOOM))*100;

  return (
    <>
      <style>{`
        .nc-root{position:absolute;top:10px;right:12px;z-index:900;display:flex;flex-direction:column;align-items:center;gap:5px;user-select:none;pointer-events:auto;}
        .nc-btn{border:1px solid rgba(255,255,255,0.16);border-radius:4px;background:linear-gradient(180deg,rgba(52,82,115,0.94),rgba(15,28,48,0.94));color:rgba(255,255,255,0.85);cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);transition:filter 0.12s,transform 0.08s;}
        .nc-btn:hover{filter:brightness(1.22);}
        .nc-btn:active{filter:brightness(0.82);transform:scale(0.95);}
        .nc-zoom-sl{-webkit-appearance:slider-vertical;appearance:slider-vertical;writing-mode:vertical-lr;direction:rtl;width:6px;height:62px;cursor:pointer;accent-color:#5bbfff;outline:none;background:transparent;}
        .nc-zoom-sl::-webkit-slider-runnable-track{background:linear-gradient(to top,#5bbfff ${sliderPct}%,rgba(0,0,0,0.35) ${sliderPct}%);border-radius:3px;}
        /* Mobile: shift to bottom-right, smaller sizes */
        @media(max-width:640px){
          .nc-root{top:auto;bottom:56px;right:8px;gap:3px;}
          .nc-rose{width:52px!important;height:52px!important;}
          .nc-pan-wrap{width:52px!important;height:32px!important;}
          .nc-pan-btn{width:16px!important;height:16px!important;font-size:8px!important;}
          .nc-globe{width:30px!important;height:30px!important;}
          .nc-zoom-block{width:24px!important;}
          .nc-zoom-sl{height:44px!important;}
          .nc-zoom-txt{font-size:14px!important;line-height:22px!important;}
          .nc-pegman{width:24px!important;height:24px!important;font-size:13px!important;}
        }
        @media(max-width:380px){
          .nc-root{display:none;}
        }
      `}</style>

      <div className="nc-root" onMouseDown={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()}>

        {/* ── COMPASS ROSE ── */}
        <div ref={roseRef} className="nc-rose"
          onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}
          onDoubleClick={resetNorth}
          title="Drag to rotate map · Double-click = reset North"
          style={{width:68,height:68,cursor:"grab",filter:"drop-shadow(0 3px 10px rgba(0,0,0,0.72))",touchAction:"none",flexShrink:0}}>
          <svg viewBox="0 0 68 68" width="68" height="68">
            <defs>
              <radialGradient id="nc_g" cx="50%" cy="35%">
                <stop offset="0%" stopColor="#4a6f90"/>
                <stop offset="100%" stopColor="#0c1a2c"/>
              </radialGradient>
            </defs>
            <circle cx="34" cy="34" r="32" fill="url(#nc_g)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2"/>
            {Array.from({length:24},(_,i)=>i*15).map(a=>(
              <line key={a} x1="34" y1="4" x2="34" y2={a%90===0?"11":a%45===0?"8":"6"}
                stroke={a%90===0?"rgba(255,255,255,0.52)":"rgba(255,255,255,0.16)"}
                strokeWidth={a%90===0?"1.5":"0.8"} transform={`rotate(${a} 34 34)`}/>
            ))}
            <g transform={`rotate(${-bearing} 34 34)`}>
              <polygon points="34,5 31,27 34,23 37,27" fill="#ef4444"/>
              <polygon points="34,63 31,41 34,45 37,41" fill="rgba(190,210,228,0.7)"/>
              <line x1="5" y1="34" x2="12" y2="34" stroke="rgba(190,210,228,0.45)" strokeWidth="1.5"/>
              <line x1="56" y1="34" x2="63" y2="34" stroke="rgba(190,210,228,0.45)" strokeWidth="1.5"/>
              <circle cx="34" cy="34" r="3.5" fill="rgba(255,255,255,0.92)" stroke="#0c1a2c" strokeWidth="1.2"/>
            </g>
            <text x="34" y="19" textAnchor="middle" fill="#ef4444" fontSize="8.5" fontWeight="800" fontFamily="'Segoe UI',sans-serif">N</text>
            <text x="34" y="58" textAnchor="middle" fill="rgba(255,255,255,0.36)" fontSize="7" fontFamily="sans-serif">S</text>
            <text x="11" y="37" textAnchor="middle" fill="rgba(255,255,255,0.36)" fontSize="7" fontFamily="sans-serif">W</text>
            <text x="57" y="37" textAnchor="middle" fill="rgba(255,255,255,0.36)" fontSize="7" fontFamily="sans-serif">E</text>
          </svg>
        </div>

        {/* ── PAN ARROWS ── */}
        <div className="nc-pan-wrap" style={{position:"relative",width:68,height:42,flexShrink:0}}>
          {[{d:"N",s:{top:0,left:"50%",transform:"translateX(-50%)"},sym:"▲"},
            {d:"S",s:{bottom:0,left:"50%",transform:"translateX(-50%)"},sym:"▼"},
            {d:"W",s:{top:"50%",left:0,transform:"translateY(-50%)"},sym:"◀"},
            {d:"E",s:{top:"50%",right:0,transform:"translateY(-50%)"},sym:"▶"}
          ].map(({d,s,sym})=>(
            <button key={d} className="nc-btn nc-pan-btn" onClick={()=>pan(d)}
              style={{position:"absolute",...s,width:20,height:20,fontSize:9,padding:0,boxShadow:"0 1px 5px rgba(0,0,0,0.55)"}}>
              {sym}
            </button>
          ))}
        </div>

        {/* ── GLOBE BUTTON ── */}
        <div className="nc-btn nc-globe" title="Globe view"
          style={{width:36,height:36,borderRadius:"50%",boxShadow:"0 2px 10px rgba(0,0,0,0.6)",flexShrink:0}}>
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="9" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
            <ellipse cx="11" cy="11" rx="9" ry="3.8" fill="none" stroke="rgba(255,255,255,0.52)" strokeWidth="1.3"/>
            <line x1="11" y1="2" x2="11" y2="20" stroke="rgba(255,255,255,0.28)" strokeWidth="1"/>
          </svg>
        </div>

        {/* ── ZOOM BLOCK ── */}
        <div className="nc-zoom-block" style={{display:"flex",flexDirection:"column",alignItems:"center",
          background:"linear-gradient(180deg,rgba(40,68,100,0.96),rgba(12,24,44,0.96))",
          borderRadius:5,border:"1px solid rgba(255,255,255,0.18)",
          boxShadow:"0 2px 12px rgba(0,0,0,0.6)",width:28,overflow:"visible",paddingBottom:2,flexShrink:0}}>
          <button className="nc-zoom-txt" onClick={zoomIn} disabled={zoom>=MAX_ZOOM}
            style={{background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,0.1)",
              color:zoom>=MAX_ZOOM?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.9)",
              fontSize:16,lineHeight:"26px",cursor:zoom>=MAX_ZOOM?"default":"pointer",width:"100%",textAlign:"center",padding:0}}>
            ＋
          </button>
          <div style={{width:28,height:74,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <input type="range" className="nc-zoom-sl" min={MIN_ZOOM} max={MAX_ZOOM} step={1}
              value={zoom} onChange={onSlider} title={`Zoom ${zoom}`}/>
          </div>
          <button className="nc-zoom-txt" onClick={zoomOut} disabled={zoom<=MIN_ZOOM}
            style={{background:"none",border:"none",borderTop:"1px solid rgba(255,255,255,0.1)",
              color:zoom<=MIN_ZOOM?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.9)",
              fontSize:16,lineHeight:"26px",cursor:zoom<=MIN_ZOOM?"default":"pointer",width:"100%",textAlign:"center",padding:0}}>
            －
          </button>
        </div>

        {/* ── PEGMAN ── */}
        <div className="nc-btn nc-pegman" onClick={streetView} title="Street View"
          style={{width:28,height:28,borderRadius:"50%",boxShadow:"0 2px 8px rgba(0,0,0,0.5)",fontSize:16,cursor:"pointer",flexShrink:0}}>
          🧍
        </div>
      </div>
    </>
  );
}