/**
 * CesiumDEMContourPanel.jsx — Geoxis 3D Globe DEM + Contour Panel  v15 TERRAIN-FIXED
 *
 * ✅ FIX 1: Labels use HeightReference.CLAMP_TO_GROUND — ZERO floating in 3D
 * ✅ FIX 2: disableDepthTestDistance = Number.POSITIVE_INFINITY — labels always visible
 * ✅ FIX 3: LOD via translucencyByDistance — minor labels fade at far zoom
 * ✅ FIX 4: Major-only mode when zoomed out (scaleByDistance hides minor)
 * ✅ FIX 5: Contour smoothing (Chaikin algorithm) for professional GIS look
 * ✅ FIX 6: Auto-detect elevation field from KML/GeoJSON properties
 * ✅ FIX 7: DEM layer raised to top of imagery stack
 * ✅ FIX 8: Show/Hide labels toggle + Major Labels Only toggle in UI
 */

import { useState, useRef, useEffect, useCallback } from "react";

/* ── Color ramps ─────────────────────────────────────────────────────── */
export const COLOR_RAMPS = {
  "GeoXIS Terrain": [
    [0,   [15, 55, 120]],[0.04,[30, 110, 60]],[0.12,[42, 148, 58]],
    [0.22,[80, 168, 72]],[0.34,[148, 182, 100]],[0.46,[192, 168, 110]],
    [0.58,[172, 130, 72]],[0.70,[138, 90, 42]],[0.82,[110, 78, 55]],
    [0.91,[168, 152, 135]],[0.97,[210, 205, 198]],[1,[248, 248, 252]],
  ],
  "GeoXIS Pro": [
    [0,[0,60,40]],[0.06,[0,120,20]],[0.14,[60,178,0]],[0.26,[200,215,80]],
    [0.38,[218,168,60]],[0.50,[185,120,40]],[0.62,[145,82,22]],
    [0.73,[110,58,12]],[0.83,[148,118,88]],[0.91,[200,192,188]],[1,[248,248,252]],
  ],
  "Hypsometric Pro": [
    [0,[28,6,1]],[0.07,[55,0,72]],[0.15,[0,75,155]],[0.24,[8,120,185]],
    [0.37,[130,195,128]],[0.49,[85,158,65]],[0.61,[168,168,55]],
    [0.71,[200,145,52]],[0.81,[135,75,28]],[0.90,[188,162,140]],[1,[248,245,240]],
  ],
  "Earth SRTM": [
    [0,[1,40,72]],[0.08,[2,100,75]],[0.20,[72,148,68]],[0.36,[155,188,120]],
    [0.50,[210,198,148]],[0.63,[178,142,92]],[0.76,[140,98,52]],
    [0.87,[115,78,45]],[0.94,[185,162,140]],[1,[235,232,228]],
  ],
  "Mine / Open Pit": [
    [0,[5,5,30]],[0.09,[20,48,98]],[0.18,[48,95,148]],[0.30,[85,145,178]],
    [0.42,[138,182,148]],[0.54,[188,170,112]],[0.64,[168,112,55]],
    [0.74,[138,72,22]],[0.85,[108,55,15]],[0.93,[158,128,88]],[1,[210,192,162]],
  ],
  "Viridis": [
    [0,[68,1,84]],[0.143,[72,40,120]],[0.286,[62,84,139]],[0.429,[49,124,137]],
    [0.571,[38,162,116]],[0.714,[88,196,87]],[0.857,[155,217,60]],[1,[253,231,37]],
  ],
  "Magma": [
    [0,[0,0,4]],[0.143,[28,16,68]],[0.286,[79,18,123]],[0.429,[129,37,129]],
    [0.571,[181,54,122]],[0.714,[229,80,99]],[0.857,[251,135,97]],[1,[252,253,191]],
  ],
  "Grayscale":     [[0,[0,0,0]],[1,[255,255,255]]],
  "Grayscale Inv": [[0,[255,255,255]],[1,[0,0,0]]],
};
const DEFAULT_RAMP = "GeoXIS Terrain";

/* ── Polygon clip ───────────────────────────────────────────────────── */
function pointInPolygon(lat, lng, poly) {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
    if ((yi > lat) !== (yj > lat) && lng < ((xj-xi)*(lat-yi))/(yj-yi)+xi) inside = !inside;
  }
  return inside;
}

/* ── Math helpers ───────────────────────────────────────────────────── */
function applyElevContrast(t) {
  const s = t * t * (3 - 2 * t);
  return Math.max(0, Math.min(1, Math.pow(0.55*s + 0.45*t, 0.82)));
}
function elevToRGB(t, ramp) {
  const s = COLOR_RAMPS[ramp] || COLOR_RAMPS[DEFAULT_RAMP];
  t = applyElevContrast(Math.max(0, Math.min(1, t)));
  let lo = 0;
  for (let i = 0; i < s.length - 1; i++) { lo = i; if (t <= s[i+1][0]) break; }
  const a = s[lo], b = s[Math.min(lo+1, s.length-1)];
  const span = b[0]-a[0], f = span < 1e-9 ? 0 : (t-a[0])/span;
  return [Math.round(a[1][0]+(b[1][0]-a[1][0])*f), Math.round(a[1][1]+(b[1][1]-a[1][1])*f), Math.round(a[1][2]+(b[1][2]-a[1][2])*f)];
}
function bilinear(grid, rows, cols, rF, cF) {
  rF = Math.max(0, Math.min(rows-1, rF)); cF = Math.max(0, Math.min(cols-1, cF));
  const r0 = Math.max(0, Math.min(rows-2, Math.floor(rF))), c0 = Math.max(0, Math.min(cols-2, Math.floor(cF)));
  const r1=r0+1, c1=c0+1, dr=rF-r0, dc=cF-c0;
  const v=[grid[r0][c0],grid[r0][c1],grid[r1][c0],grid[r1][c1]];
  if (v.some(isNaN)) return NaN;
  return (v[0]*(1-dc)+v[1]*dc)*(1-dr)+(v[2]*(1-dc)+v[3]*dc)*dr;
}
function computeHS(grid, rows, cols, r, c, cellM, az=315, alt=35) {
  const get=(rr,cc)=>{const v=grid[Math.max(0,Math.min(rows-1,rr))][Math.max(0,Math.min(cols-1,cc))];return isNaN(v)?0:v;};
  const [a,b,c2,d,e2,f2,g,h]=[get(r-1,c-1),get(r-1,c),get(r-1,c+1),get(r,c-1),get(r,c+1),get(r+1,c-1),get(r+1,c),get(r+1,c+1)];
  const cm=Math.max(cellM,1), dzdx=((c2+2*e2+h)-(a+2*d+f2))/(8*cm), dzdy=((f2+2*g+h)-(a+2*b+c2))/(8*cm);
  const az_r=(360-az+90)*Math.PI/180, alt_r=alt*Math.PI/180, slope=Math.atan(Math.sqrt(dzdx*dzdx+dzdy*dzdy));
  let asp=Math.atan2(dzdy,-dzdx); if(asp<0) asp+=2*Math.PI;
  return Math.max(0, Math.cos(alt_r)*Math.cos(slope)+Math.sin(alt_r)*Math.sin(slope)*Math.cos(az_r-asp));
}
function computeMultiHS(grid, rows, cols, r, c, cellM) {
  const dirs=[{az:225,w:0.12,alt:35},{az:270,w:0.18,alt:35},{az:315,w:0.42,alt:35},{az:360,w:0.20,alt:45},{az:45,w:0.08,alt:55}];
  let hs=0, wt=0;
  for (const {az,w,alt} of dirs){hs+=w*computeHS(grid,rows,cols,r,c,cellM,az,alt);wt+=w;}
  return Math.min(1,hs/wt);
}
function fillNaN(grid, rows, cols) {
  let changed=true, pass=0;
  while(changed&&pass<200){
    changed=false;pass++;
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
      if(!isNaN(grid[r][c])) continue;
      let wS=0,vS=0;
      for(let dr=-4;dr<=4;dr++) for(let dc=-4;dc<=4;dc++){
        if(!dr&&!dc) continue;
        const nr=r+dr,nc=c+dc;
        if(nr<0||nr>=rows||nc<0||nc>=cols) continue;
        const v=grid[nr][nc]; if(isNaN(v)) continue;
        const w=1/Math.sqrt(dr*dr+dc*dc); vS+=v*w;wS+=w;
      }
      if(wS>0){grid[r][c]=vS/wS;changed=true;}
    }
  }
}
function isOk(v){return v!=null&&isFinite(v)&&v>-500&&v<9000;}

/* ── Chaikin contour smoothing ──────────────────────────────────────── */
/**
 * Chaikin's algorithm — corner-cutting smoothing
 * iterations=2 gives professional GIS appearance (like QGIS smooth)
 * Only applied to chains with enough points; closed chains handled specially
 */
function chaikinSmooth(pts, iterations = 2) {
  if (pts.length < 4) return pts;
  let result = pts;
  for (let iter = 0; iter < iterations; iter++) {
    const next = [];
    const n = result.length;
    const closed = result[0][0] === result[n-1][0] && result[0][1] === result[n-1][1];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = result[i];
      const p1 = result[(i + 1) % n];
      next.push([
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
      ]);
      next.push([
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[1] + 0.75 * p1[1],
      ]);
    }
    if (!closed) {
      next.unshift(result[0]);
      next.push(result[n - 1]);
    } else {
      next.push(next[0]);
    }
    result = next;
  }
  return result;
}

/* ── Elevation cache ────────────────────────────────────────────────── */
const _elvCache={};
const cacheKey=(bbox,res)=>`${bbox.minLat.toFixed(4)},${bbox.maxLat.toFixed(4)},${bbox.minLng.toFixed(4)},${bbox.maxLng.toFixed(4)},${res}`;

/* ── AWS Terrarium tile decoder ─────────────────────────────────────── */
const TILE_Z=14, TILE_N=Math.pow(2,TILE_Z);
function latLngToTileExact(lat,lng){
  const latRad=lat*Math.PI/180;
  const mercY=(1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2;
  const xExact=(lng+180)/360*TILE_N, yExact=mercY*TILE_N;
  const x=Math.floor(xExact),y=Math.floor(yExact);
  return{x,y,px:(xExact-x)*256,py:(yExact-y)*256};
}
const _tileCache={};
function loadTilePixels(x,y){
  const k=`${TILE_Z}/${x}/${y}`;
  if(_tileCache[k]) return _tileCache[k];
  const p=new Promise(resolve=>{
    const img=new Image(); img.crossOrigin="anonymous";
    img.onload=()=>{try{const cv=document.createElement("canvas");cv.width=cv.height=256;cv.getContext("2d").drawImage(img,0,0);resolve(cv.getContext("2d").getImageData(0,0,256,256).data);}catch{resolve(null);}};
    img.onerror=()=>resolve(null);
    img.src=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TILE_Z}/${x}/${y}.png`;
    setTimeout(()=>resolve(null),20000);
  });
  _tileCache[k]=p; return p;
}
function tilePixelElev(data,px,py){
  const x=Math.max(0,Math.min(255,Math.round(px))),y=Math.max(0,Math.min(255,Math.round(py)));
  const i=(y*256+x)*4, e=(data[i]*256+data[i+1]+data[i+2]/256)-32768;
  return isOk(e)?e:null;
}
async function fetchElevTile(lat,lng){
  const{x,y,px,py}=latLngToTileExact(lat,lng);
  const data=await loadTilePixels(x,y); if(!data) return null;
  const x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(255,x0+1),y1=Math.min(255,y0+1);
  const dx=px-x0,dy=py-y0;
  const v00=tilePixelElev(data,x0,y0),v10=tilePixelElev(data,x1,y0),v01=tilePixelElev(data,x0,y1),v11=tilePixelElev(data,x1,y1);
  if(v00==null&&v10==null&&v01==null&&v11==null) return null;
  const safe=(v,fb)=>v!=null?v:fb, fb=v00??v10??v01??v11;
  return safe(v00,fb)*(1-dx)*(1-dy)+safe(v10,fb)*dx*(1-dy)+safe(v01,fb)*(1-dx)*dy+safe(v11,fb)*dx*dy;
}
async function fetchElevationGrid(bbox,rows,cols,onProgress,signal){
  const pts=[];
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const lat=rows>1?bbox.maxLat-(bbox.maxLat-bbox.minLat)*(r/(rows-1)):(bbox.minLat+bbox.maxLat)/2;
    const lng=cols>1?bbox.minLng+(bbox.maxLng-bbox.minLng)*(c/(cols-1)):(bbox.minLng+bbox.maxLng)/2;
    pts.push({lat,lng,r,c});
  }
  const grid=Array.from({length:rows},()=>new Float32Array(cols).fill(NaN));
  const CONCURRENCY=8; let done=0;
  for(let i=0;i<pts.length;i+=CONCURRENCY){
    if(signal?.aborted) break;
    const chunk=pts.slice(i,i+CONCURRENCY);
    const results=await Promise.all(chunk.map(p=>fetchElevTile(p.lat,p.lng)));
    results.forEach((e,idx)=>{const p=chunk[idx];if(isOk(e))grid[p.r][p.c]=e;});
    done+=chunk.length; onProgress?.(done,pts.length);
  }
  return grid;
}

/* ── Marching squares + stitch ──────────────────────────────────────── */
function marchingSquares(grid,rows,cols,levels){
  const segs={}; levels.forEach(lv=>{segs[lv]=[];});
  for(let r=0;r<rows-1;r++) for(let c=0;c<cols-1;c++){
    const v=[grid[r][c],grid[r][c+1],grid[r+1][c+1],grid[r+1][c]];
    if(v.some(isNaN)) continue;
    const lerp=(va,vb,lv)=>va!==vb?(lv-va)/(vb-va):0.5;
    levels.forEach(lv=>{
      const idx=((v[0]>=lv)?8:0)|((v[1]>=lv)?4:0)|((v[2]>=lv)?2:0)|((v[3]>=lv)?1:0);
      if(!idx||idx===15) return;
      const tT=lerp(v[0],v[1],lv),tR=lerp(v[1],v[2],lv),tB=lerp(v[3],v[2],lv),tL=lerp(v[0],v[3],lv);
      const top=[r,c+tT],right=[r+tR,c+1],bot=[r+1,c+tB],left=[r+tL,c];
      const lkp={1:[[left,bot]],2:[[bot,right]],3:[[left,right]],4:[[top,right]],5:[[top,right],[left,bot]],6:[[top,bot]],7:[[top,left]],8:[[left,top]],9:[[top,bot]],10:[[left,top],[bot,right]],11:[[top,right]],12:[[left,right]],13:[[bot,right]],14:[[left,bot]]};
      (lkp[idx]||[]).forEach(s=>segs[lv].push(s));
    });
  }
  return segs;
}
function stitchSegments(segs){
  if(!segs.length) return [];
  const PREC=10000, key=([r,c])=>`${Math.round(r*PREC)},${Math.round(c*PREC)}`;
  const epMap=new Map(), used=new Uint8Array(segs.length);
  segs.forEach(([a,b],i)=>{
    const ka=key(a),kb=key(b);
    if(!epMap.has(ka))epMap.set(ka,[]);if(!epMap.has(kb))epMap.set(kb,[]);
    epMap.get(ka).push({idx:i,ei:0});epMap.get(kb).push({idx:i,ei:1});
  });
  const chains=[];
  for(let i=0;i<segs.length;i++){
    if(used[i]) continue; used[i]=1;
    let chain=[segs[i][0],segs[i][1]];
    for(;;){const k=key(chain[chain.length-1]);let ext=false;for(const{idx,ei}of epMap.get(k)||[]){if(used[idx])continue;used[idx]=1;chain.push(ei===0?segs[idx][1]:segs[idx][0]);ext=true;break;}if(!ext)break;}
    for(;;){const k=key(chain[0]);let ext=false;for(const{idx,ei}of epMap.get(k)||[]){if(used[idx])continue;used[idx]=1;chain.unshift(ei===0?segs[idx][1]:segs[idx][0]);ext=true;break;}if(!ext)break;}
    if(chain.length>=2) chains.push(chain);
  }
  return chains;
}
function gridToLatLng(rF,cF,bbox,rows,cols){
  const lat=rows>1?bbox.maxLat-(bbox.maxLat-bbox.minLat)*(rF/(rows-1)):(bbox.minLat+bbox.maxLat)/2;
  const lng=cols>1?bbox.minLng+(bbox.maxLng-bbox.minLng)*(cF/(cols-1)):(bbox.minLng+bbox.maxLng)/2;
  return[lat,lng];
}
function interpBoundary(lat0,lng0,lat1,lng1,poly){
  let lo=0,hi=1;
  for(let i=0;i<16;i++){const m=(lo+hi)/2;if(pointInPolygon(lat0+(lat1-lat0)*m,lng0+(lng1-lng0)*m,poly))lo=m;else hi=m;}
  const t=(lo+hi)/2;return[lat0+(lat1-lat0)*t,lng0+(lng1-lng0)*t];
}
function clipChain(latlngs,poly){
  if(!poly||poly.length<3) return[latlngs];
  const subs=[]; let cur=[];
  for(let i=0;i<latlngs.length;i++){
    const[lat,lng]=latlngs[i],inside=pointInPolygon(lat,lng,poly);
    if(inside){
      if(cur.length===0&&i>0){const e=interpBoundary(...latlngs[i-1],lat,lng,poly);if(e)cur.push(e);}
      cur.push([lat,lng]);
    }else{
      if(cur.length>0){const e=interpBoundary(...latlngs[i-1],lat,lng,poly);if(e)cur.push(e);if(cur.length>=2)subs.push(cur);cur=[];}
    }
  }
  if(cur.length>=2) subs.push(cur);
  return subs;
}

/* ── Chain analysis helpers ─────────────────────────────────────────── */
function chainLength(latlngs) {
  let len = 0;
  for (let i = 1; i < latlngs.length; i++) {
    const dlat = (latlngs[i][0]-latlngs[i-1][0])*111320;
    const dlng = (latlngs[i][1]-latlngs[i-1][1])*111320*Math.cos(latlngs[i][0]*Math.PI/180);
    len += Math.sqrt(dlat*dlat+dlng*dlng);
  }
  return len;
}

/**
 * Get rotation angle in degrees at a point on the chain.
 * Uses a wider window (±4 pts) for smoother angle on smoothed chains.
 * Returns angle normalized to [-90, 90] for readable upright labels.
 */
function chainAngleAt(latlngs, idx) {
  const n = latlngs.length;
  const i0 = Math.max(0, idx - 4);
  const i1 = Math.min(n - 1, idx + 4);
  const dlat = latlngs[i1][0] - latlngs[i0][0];
  const dlng = latlngs[i1][1] - latlngs[i0][1];
  // Convert to screen angle: lon is X, lat is Y but Y is inverted on screen
  let deg = Math.atan2(dlat, dlng) * 180 / Math.PI;
  // Normalize to [-90, 90] so text is never upside down
  if (deg > 90)  deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

/* ── Label placement: evenly-spaced along chain ─────────────────────── */
function getLabelPositions(sub, isMajor, repeatEveryM, labelMode) {
  if (labelMode === "none") return [];
  if (labelMode === "major" && !isMajor) return [];
  const n = sub.length;
  if (n < 2) return [];
  const totalLen = chainLength(sub);
  // Minimum chain length before placing a label
  const minLen = isMajor ? 40 : 120;
  if (totalLen < minLen) return [];
  const spacing = repeatEveryM > 0 ? repeatEveryM : Math.max(totalLen, 500);
  const count = Math.max(1, Math.floor(totalLen / spacing));
  const positions = [];
  for (let k = 0; k < count; k++) {
    const targetLen = totalLen * (k + 0.5) / count;
    let acc = 0;
    for (let i = 1; i < sub.length; i++) {
      const dlat = (sub[i][0]-sub[i-1][0])*111320;
      const dlng = (sub[i][1]-sub[i-1][1])*111320*Math.cos(sub[i][0]*Math.PI/180);
      const segLen = Math.sqrt(dlat*dlat+dlng*dlng);
      if (acc + segLen >= targetLen) {
        const t = (targetLen-acc)/Math.max(segLen,0.001);
        const lat = sub[i-1][0]+(sub[i][0]-sub[i-1][0])*t;
        const lng = sub[i-1][1]+(sub[i][1]-sub[i-1][1])*t;
        positions.push({ lat, lng, idx: i });
        break;
      }
      acc += segLen;
    }
  }
  return positions;
}

/* ── Download helper ────────────────────────────────────────────────── */
function dlBlob(data,name,mime){
  const url=URL.createObjectURL(new Blob([data],{type:mime}));
  const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}

/* ── GeoTIFF builder ────────────────────────────────────────────────── */
function buildGeoTIFF({grid,rows,cols,bbox}){
  const W=cols,H=rows,pixW=cols>1?(bbox.maxLng-bbox.minLng)/(cols-1):0.001,pixH=rows>1?(bbox.maxLat-bbox.minLat)/(rows-1):0.001;
  const raster=new Float32Array(W*H);
  for(let r=0;r<H;r++) for(let c=0;c<W;c++) raster[r*W+c]=isNaN(grid[r][c])?-9999:grid[r][c];
  const tp=new Float64Array([0,0,0,bbox.minLng,bbox.maxLat,0]),ps=new Float64Array([pixW,pixH,0]);
  const gk=new Uint16Array([1,1,0,4,1024,0,1,2,1025,0,1,1,2048,0,1,4326,2049,34737,7,0]);
  const cit=new TextEncoder().encode("WGS 84\0"),nd=new TextEncoder().encode("-9999\0");
  const NT=17,ifdOff=8,ifdSz=2+NT*12+4;
  const tpOff=ifdOff+ifdSz,psOff=tpOff+tp.byteLength,gkOff=psOff+ps.byteLength;
  const citOff=gkOff+gk.byteLength,ndOff=citOff+cit.byteLength;
  const rasOff=Math.ceil((ndOff+nd.byteLength)/4)*4,total=rasOff+raster.byteLength;
  const buf=new ArrayBuffer(total),dv=new DataView(buf),u8=new Uint8Array(buf);
  let p=0;u8[p++]=0x49;u8[p++]=0x49;dv.setUint16(p,42,true);p+=2;dv.setUint32(p,ifdOff,true);p+=4;
  dv.setUint16(p,NT,true);p+=2;
  const tag=(id,type,count,val)=>{dv.setUint16(p,id,true);p+=2;dv.setUint16(p,type,true);p+=2;dv.setUint32(p,count,true);p+=4;if(type===3&&count<=2){dv.setUint16(p,val,true);p+=2;dv.setUint16(p,0,true);p+=2;}else{dv.setUint32(p,val,true);p+=4;}};
  tag(256,4,1,W);tag(257,4,1,H);tag(258,3,1,32);tag(259,3,1,1);tag(262,3,1,1);tag(273,4,1,rasOff);tag(277,3,1,1);tag(278,4,1,H);tag(279,4,1,W*H*4);tag(284,3,1,1);tag(339,3,1,3);tag(33550,12,3,psOff);tag(33922,12,6,tpOff);tag(34735,3,gk.length,gkOff);tag(34736,12,0,0);tag(34737,2,cit.length,citOff);tag(42113,2,nd.length,ndOff);
  dv.setUint32(p,0,true);p+=4;
  new Uint8Array(buf,tpOff).set(new Uint8Array(tp.buffer));new Uint8Array(buf,psOff).set(new Uint8Array(ps.buffer));
  new Uint8Array(buf,gkOff).set(new Uint8Array(gk.buffer));new Uint8Array(buf,citOff).set(cit);new Uint8Array(buf,ndOff).set(nd);
  new Uint8Array(buf,rasOff).set(new Uint8Array(raster.buffer));
  return buf;
}

/* ── GeoJSON contours ───────────────────────────────────────────────── */
function buildContourGeoJSON({grid,rows,cols,bbox,min:minE,max:maxE},interval,majorEvery,poly=null){
  const levels=[];
  const gStart=Math.ceil(minE/interval), gEnd=Math.floor((maxE+1e-6)/interval);
  for(let step=gStart;step<=gEnd;step++) levels.push(step*interval);
  const rawSegs=marchingSquares(grid,rows,cols,levels),features=[],hasClip=poly&&poly.length>=3;
  levels.forEach(lv=>{
    const snapLv = Math.round(lv);
    const isMajor = snapLv % majorEvery === 0;
    stitchSegments(rawSegs[lv]||[]).forEach(chain=>{
      if(chain.length<2) return;
      const latlngs=chain.map(([rF,cF])=>gridToLatLng(rF,cF,bbox,rows,cols));
      (hasClip?clipChain(latlngs,poly):[latlngs]).forEach(sub=>{
        if(sub.length<2) return;
        features.push({
          type:"Feature",
          geometry:{type:"LineString",coordinates:sub.map(([lat,lng])=>[lng,lat,snapLv])},
          properties:{
            elevation_m: snapLv,
            elevation_ft: Math.round(snapLv*3.28084),
            label: String(snapLv)+"m",
            contourType: isMajor?"major":"minor",
            interval_m: interval,
            major_every_m: majorEvery,
            is_major: isMajor,
            elev: snapLv,
            type: isMajor?"major":"minor",
          }
        });
      });
    });
  });
  return{type:"FeatureCollection",features};
}

/* ── KML export ─────────────────────────────────────────────────────── */
function buildContourKML({grid,rows,cols,bbox,min:minE,max:maxE},interval,majorEvery,poly=null){
  const gj=buildContourGeoJSON({grid,rows,cols,bbox,min:minE,max:maxE},interval,majorEvery,poly);
  let kml=`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n`;
  kml+=`<Style id="major"><LineStyle><color>ff003b8a</color><width>2.5</width></LineStyle></Style>\n`;
  kml+=`<Style id="minor"><LineStyle><color>aa33691e</color><width>1.0</width></LineStyle></Style>\n`;
  gj.features.forEach(f=>{
    const p=f.properties;
    const coords=f.geometry.coordinates.map(([lng,lat,z])=>`${lng},${lat},${z}`).join(" ");
    kml+=`<Placemark><name>${p.label}</name><description>elevation_m: ${p.elevation_m}\nelevation_ft: ${p.elevation_ft}\ntype: ${p.contourType}\ninterval: ${p.interval_m}m</description>`;
    kml+=`<styleUrl>#${p.is_major?"major":"minor"}</styleUrl>`;
    kml+=`<ExtendedData><Data name="elevation_m"><value>${p.elevation_m}</value></Data><Data name="elevation_ft"><value>${p.elevation_ft}</value></Data><Data name="contourType"><value>${p.contourType}</value></Data><Data name="elev"><value>${p.elev}</value></Data></ExtendedData>`;
    kml+=`<LineString><altitudeMode>clampToGround</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark>\n`;
  });
  kml+=`</Document>\n</kml>`;
  return kml;
}

/* ── DXF export ─────────────────────────────────────────────────────── */
function buildContourDXF({grid,rows,cols,bbox,min:minE,max:maxE},interval,majorEvery,poly=null){
  const gj=buildContourGeoJSON({grid,rows,cols,bbox,min:minE,max:maxE},interval,majorEvery,poly);
  let dxf="0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n";
  dxf+="0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n999\n";
  const layers=new Set();
  gj.features.forEach(f=>layers.add(`ELEV_${Math.round(f.properties.elevation_m)}_${f.properties.contourType.toUpperCase()}`));
  layers.forEach(lname=>{
    const isMajor=lname.includes("MAJOR");
    dxf+=`0\nLAYER\n2\n${lname}\n70\n0\n62\n${isMajor?1:3}\n6\nCONTINUOUS\n`;
  });
  dxf+="0\nENDTABLE\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  gj.features.forEach(f=>{
    const p=f.properties;
    const lname=`ELEV_${Math.round(p.elevation_m)}_${p.contourType.toUpperCase()}`;
    const coords=f.geometry.coordinates;
    dxf+=`0\nPOLYLINE\n8\n${lname}\n66\n1\n70\n0\n`;
    coords.forEach(([lng,lat,z])=>{
      dxf+=`0\nVERTEX\n8\n${lname}\n10\n${lng.toFixed(8)}\n20\n${lat.toFixed(8)}\n30\n${z.toFixed(2)}\n`;
    });
    dxf+=`0\nSEQEND\n`;
  });
  dxf+="0\nENDSEC\n0\nEOF\n";
  return dxf;
}

/* ── Shapefile builder ─────────────────────────────────────────────── */
const CRC32T=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c;}return t;})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC32T[(c^u8[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function concat(...a){const t=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let p=0;for(const x of a){t.set(x,p);p+=x.length;}return t;}
function buildSHPLines(features){
  let xMin=Infinity,yMin=Infinity,xMax=-Infinity,yMax=-Infinity;
  const recs=features.map(f=>{
    const coords=f.geometry?.coordinates||[];
    coords.forEach(([x,y])=>{if(x<xMin)xMin=x;if(x>xMax)xMax=x;if(y<yMin)yMin=y;if(y>yMax)yMax=y;});
    const n=coords.length,ab=new ArrayBuffer(4+32+4+4+4+n*16),dv=new DataView(ab);
    let rxMin=Infinity,ryMin=Infinity,rxMax=-Infinity,ryMax=-Infinity;
    coords.forEach(([x,y])=>{if(x<rxMin)rxMin=x;if(x>rxMax)rxMax=x;if(y<ryMin)ryMin=y;if(y>ryMax)ryMax=y;});
    dv.setInt32(0,3,true);dv.setFloat64(4,rxMin,true);dv.setFloat64(12,ryMin,true);dv.setFloat64(20,rxMax,true);dv.setFloat64(28,ryMax,true);
    dv.setInt32(36,1,true);dv.setInt32(40,n,true);dv.setInt32(44,0,true);
    let pt=48;coords.forEach(([x,y])=>{dv.setFloat64(pt,x,true);dv.setFloat64(pt+8,y,true);pt+=16;});
    return new Uint8Array(ab);
  });
  if(!isFinite(xMin)){xMin=yMin=xMax=yMax=0;}
  const bodyLen=recs.reduce((s,r)=>s+8+r.length,0);
  const shpL=100+bodyLen,shpAB=new ArrayBuffer(shpL),shpDV=new DataView(shpAB),shpU8=new Uint8Array(shpAB);
  const shxL=100+recs.length*8,shxAB=new ArrayBuffer(shxL),shxDV=new DataView(shxAB);
  const wHdr=(dv,fl)=>{dv.setInt32(0,9994,false);dv.setInt32(24,fl/2,false);dv.setInt32(28,1000,true);dv.setInt32(32,3,true);dv.setFloat64(36,xMin,true);dv.setFloat64(44,yMin,true);dv.setFloat64(52,xMax,true);dv.setFloat64(60,yMax,true);};
  wHdr(shpDV,shpL);wHdr(shxDV,shxL);
  let pos=100;recs.forEach((rec,ri)=>{const cw=rec.length/2;shpDV.setInt32(pos,ri+1,false);shpDV.setInt32(pos+4,cw,false);shpU8.set(rec,pos+8);shxDV.setInt32(100+ri*8,pos/2,false);shxDV.setInt32(100+ri*8+4,cw,false);pos+=8+rec.length;});
  return{shp:new Uint8Array(shpAB),shx:new Uint8Array(shxAB)};
}
function buildDBF(features){
  const FIELDS=[
    {name:"elev_m",  type:"N",len:10,dec:2},
    {name:"elev_ft", type:"N",len:10,dec:0},
    {name:"elev",    type:"N",len:8, dec:0},
    {name:"label",   type:"C",len:16,dec:0},
    {name:"type",    type:"C",len:8, dec:0},
    {name:"is_major",type:"N",len:2, dec:0},
    {name:"interval",type:"N",len:8, dec:1},
    {name:"maj_ev",  type:"N",len:8, dec:0},
  ];
  const enc=new TextEncoder(),hSz=32+FIELDS.length*32+1,recSz=1+FIELDS.reduce((s,f)=>s+f.len,0);
  const buf=new Uint8Array(hSz+features.length*recSz+1),dv=new DataView(buf.buffer);
  buf[0]=3;const now=new Date();buf[1]=now.getFullYear()-1900;buf[2]=now.getMonth()+1;buf[3]=now.getDate();
  dv.setUint32(4,features.length,true);dv.setUint16(8,hSz,true);dv.setUint16(10,recSz,true);
  FIELDS.forEach((f,fi)=>{const off=32+fi*32,nb=enc.encode(f.name.slice(0,10));nb.forEach((b,i)=>{buf[off+i]=b;});buf[off+11]=f.type.charCodeAt(0);buf[off+16]=f.len;buf[off+17]=f.dec;});
  buf[32+FIELDS.length*32]=0x0D;
  features.forEach((feat,ri)=>{
    const p2=feat.properties||{},off=hSz+ri*recSz;buf[off]=0x20;let col=1;
    const vals=[p2.elevation_m??0,p2.elevation_ft??0,p2.elev??0,p2.label??"",p2.contourType??"minor",p2.is_major?1:0,p2.interval_m??0,p2.major_every_m??50];
    FIELDS.forEach((f,fi)=>{
      let str=String(vals[fi]??"").slice(0,f.len);
      if(f.type==="N"){const n=parseFloat(str);str=isNaN(n)?"0".padStart(f.len):n.toFixed(f.dec).padStart(f.len);}else str=str.padEnd(f.len);
      const bytes=enc.encode(str.slice(0,f.len));for(let i=0;i<f.len;i++)buf[off+col+i]=bytes[i]??0x20;col+=f.len;
    });
  });
  buf[hSz+features.length*recSz]=0x1A;return buf;
}
function buildZip(files){
  const enc=new TextEncoder(),parts=[],central=[];let off=0;
  for(const{name,data}of files){
    const nb=enc.encode(name),u8=data instanceof Uint8Array?data:new Uint8Array(data);
    const cr=crc32(u8),sz=u8.length;
    const lh=new ArrayBuffer(30+nb.length),lhDV=new DataView(lh),lhU=new Uint8Array(lh);
    lhDV.setUint32(0,0x04034B50,true);lhDV.setUint16(4,20,true);lhDV.setUint32(14,cr,true);lhDV.setUint32(18,sz,true);lhDV.setUint32(22,sz,true);lhDV.setUint16(26,nb.length,true);lhU.set(nb,30);
    const cd=new ArrayBuffer(46+nb.length),cdDV=new DataView(cd),cdU=new Uint8Array(cd);
    cdDV.setUint32(0,0x02014B50,true);cdDV.setUint16(4,20,true);cdDV.setUint16(6,20,true);cdDV.setUint32(16,cr,true);cdDV.setUint32(20,sz,true);cdDV.setUint32(24,sz,true);cdDV.setUint16(28,nb.length,true);cdDV.setUint32(42,off,true);cdU.set(nb,46);
    parts.push(lhU,u8);central.push(cdU);off+=30+nb.length+sz;
  }
  const cdD2=concat(...central),eo=new ArrayBuffer(22),eoDV=new DataView(eo);
  eoDV.setUint32(0,0x06054B50,true);eoDV.setUint16(8,files.length,true);eoDV.setUint16(10,files.length,true);eoDV.setUint32(12,cdD2.length,true);eoDV.setUint32(16,off,true);
  return concat(...parts,cdD2,new Uint8Array(eo));
}
const WGS84_PRJ=`GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;

/* ══════════════════════════════════════════════════════════════════════
   renderDEM — v15
   ✅ DEM layer raised to top of imagery stack
══════════════════════════════════════════════════════════════════════ */
async function renderDEM(Cesium, viewer, elevGrid, opts, poly=null, layerRef=null) {
  const {
    colorRamp         = DEFAULT_RAMP,
    opacity           = 0.60,
    hillshadeStrength = 0.55,
    hillshadeMode     = "multi",
  } = opts;

  if (layerRef?.current) {
    try { viewer.imageryLayers.remove(layerRef.current, true); } catch (_) {}
    layerRef.current = null;
  }

  const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;
  const range = maxE - minE;
  const OS = 12;
  const W = Math.min((cols-1)*OS+1, 4096) | 0;
  const H = Math.min((rows-1)*OS+1, 4096) | 0;

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(W, H);
  const px  = img.data;

  const latSpan = bbox.maxLat - bbox.minLat;
  const lngSpan = bbox.maxLng - bbox.minLng;
  const midLat  = (bbox.minLat + bbox.maxLat) / 2;
  const cellM   = Math.max(1, (
    (rows>1 ? latSpan/(rows-1)*111320 : 100) +
    (cols>1 ? lngSpan/(cols-1)*111320*Math.cos(midLat*Math.PI/180) : 100)
  ) / 2);

  const hsGrid = hillshadeStrength > 0 && hillshadeMode !== "off"
    ? Array.from({ length: rows }, (_, r) =>
        Float32Array.from({ length: cols }, (_, c) =>
          hillshadeMode === "multi"
            ? computeMultiHS(grid, rows, cols, r, c, cellM)
            : computeHS(grid, rows, cols, r, c, cellM)
        )
      )
    : null;

  const hasClip = poly && poly.length >= 3;
  const featherLat = H > 1 ? (bbox.maxLat-bbox.minLat)/(H-1)*2 : 0;
  const featherLng = W > 1 ? (bbox.maxLng-bbox.minLng)/(W-1)*2 : 0;

  function edgeAlpha(lat, lng) {
    if (!hasClip) return 1;
    const inside = pointInPolygon(lat, lng, poly);
    if (inside) {
      if (
        pointInPolygon(lat+featherLat, lng, poly) &&
        pointInPolygon(lat-featherLat, lng, poly) &&
        pointInPolygon(lat, lng+featherLng, poly) &&
        pointInPolygon(lat, lng-featherLng, poly)
      ) return 1;
      const nb = [
        [lat+featherLat,lng],[lat-featherLat,lng],
        [lat,lng+featherLng],[lat,lng-featherLng],
        [lat+featherLat,lng+featherLng],[lat+featherLat,lng-featherLng],
        [lat-featherLat,lng+featherLng],[lat-featherLat,lng-featherLng],
      ];
      return 0.5 + 0.5*(nb.filter(([la,ln])=>pointInPolygon(la,ln,poly)).length/8);
    }
    const nb4 = [[lat+featherLat,lng],[lat-featherLat,lng],[lat,lng+featherLng],[lat,lng-featherLng]];
    const cnt = nb4.filter(([la,ln])=>pointInPolygon(la,ln,poly)).length;
    return cnt === 0 ? 0 : 0.3*(cnt/4);
  }

  for (let py2 = 0; py2 < H; py2++) {
    for (let qx = 0; qx < W; qx++) {
      const i4 = (py2*W+qx)*4;
      const rF = H > 1 ? py2*(rows-1)/(H-1) : 0;
      const cF = W > 1 ? qx*(cols-1)/(W-1)  : 0;
      const [lat, lng] = gridToLatLng(rF, cF, bbox, rows, cols);
      const ea = edgeAlpha(lat, lng);
      if (ea <= 0) { px[i4+3] = 0; continue; }
      const elev = bilinear(grid, rows, cols, rF+1, cF+1);
      if (isNaN(elev)) { px[i4+3] = 0; continue; }
      const t = range > 0.5 ? Math.max(0, Math.min(1, (elev-minE)/range)) : 0.5;
      let [r, g, b] = elevToRGB(t, colorRamp);
      if (hsGrid) {
        const ri = Math.max(0, Math.min(rows-1, Math.round(rF)));
        const ci = Math.max(0, Math.min(cols-1, Math.round(cF)));
        const hs  = hsGrid[ri][ci];
        const str = Math.min(hillshadeStrength, 0.92);
        const amb = 1 - str*0.45;
        const sv  = Math.max(0.45, Math.min(1.85, amb + str*hs*1.75));
        r = Math.max(0, Math.min(255, Math.round(r*sv)));
        g = Math.max(0, Math.min(255, Math.round(g*sv)));
        b = Math.max(0, Math.min(255, Math.round(b*sv)));
      }
      px[i4]=r; px[i4+1]=g; px[i4+2]=b; px[i4+3]=Math.round(opacity*ea*255);
    }
  }

  ctx.putImageData(img, 0, 0);

  const imageUrl = await new Promise(res => {
    try {
      cv.toBlob(
        blob => blob ? res(URL.createObjectURL(blob)) : res(cv.toDataURL()),
        "image/png"
      );
    } catch {
      res(cv.toDataURL());
    }
  });

  const rect = new Cesium.Rectangle(
    Cesium.Math.toRadians(bbox.minLng),
    Cesium.Math.toRadians(bbox.minLat),
    Cesium.Math.toRadians(bbox.maxLng),
    Cesium.Math.toRadians(bbox.maxLat)
  );

  let provider;
  try {
    provider = new Cesium.SingleTileImageryProvider({ url: imageUrl, rectangle: rect, tileWidth: W, tileHeight: H });
  } catch (_) {
    try { provider = new Cesium.SingleTileImageryProvider(imageUrl, rect); }
    catch (e) { console.error("DEM provider failed:", e); return null; }
  }

  const layer = viewer.imageryLayers.addImageryProvider(provider);
  layer.alpha = opacity;

  // Raise to top of stack
  try {
    const total = viewer.imageryLayers.length;
    const currentIdx = viewer.imageryLayers.indexOf?.(layer) ?? total - 1;
    for (let i = currentIdx; i < total - 1; i++) {
      viewer.imageryLayers.raise(layer);
    }
  } catch (_) {}

  if (layerRef) layerRef.current = layer;
  return layer;
}

/* ══════════════════════════════════════════════════════════════════════
   renderContours — v15 TERRAIN-FIXED
   
   THE FIX for floating labels in 3D:
   
   ❌ OLD (broken): 
     position: Cesium.Cartesian3.fromDegrees(lng, lat, terrainElev + 2)
     heightReference: RELATIVE_TO_GROUND
     → terrainElev from DEM grid ≠ Cesium's actual terrain height
     → labels float in sky at wrong absolute altitude
   
   ✅ NEW (correct):
     position: Cesium.Cartesian3.fromDegrees(lng, lat, 0)  ← height=0, let Cesium clamp
     heightReference: CLAMP_TO_GROUND  ← Cesium places label ON terrain surface
     disableDepthTestDistance: Number.POSITIVE_INFINITY  ← always visible, not occluded
     → label sticks perfectly to terrain in all 3D orientations
   
   LOD (Level of Detail) for zoom-based label visibility:
   - Minor labels: translucencyByDistance fades them at zoom > 15km
   - Major labels: always show, visible to 80km
   - scaleByDistance: labels shrink at far zoom to avoid clutter
══════════════════════════════════════════════════════════════════════ */
function renderContours(Cesium, viewer, elevGrid, opts, poly = null) {
  const {
    interval        = 10,
    majorEvery      = 50,
    minorColor      = "#7a5c2e",
    majorColor      = "#3b1a00",
    opacity         = 0.90,
    showLabels      = true,
    labelMode       = "all",       // "all" | "major" | "none"
    majorLabelsOnly = false,       // zoom-based: always show major, hide minor when true
    rotateLabels    = true,
    repeatLabels    = true,
    repeatSpacingM  = 500,
    smoothContours  = true,        // Chaikin smoothing for professional GIS look
    smoothIterations = 2,          // 1=light, 2=standard (QGIS-like), 3=heavy
  } = opts;

  const { grid, rows, cols, bbox, min: minE, max: maxE } = elevGrid;

  const levels = [];
  const lvStart = Math.ceil(minE / interval);
  const lvEnd   = Math.floor((maxE + 1e-6) / interval);
  for (let step = lvStart; step <= lvEnd; step++) levels.push(step * interval);
  if (!levels.length) return { primitives: [], entities: [], count: 0 };

  const rawSegs = marchingSquares(grid, rows, cols, levels);
  const prims   = [];
  const ents    = [];
  const hasClip = poly && poly.length >= 3;

  // Effective label mode: if majorLabelsOnly toggle is on, override to "major"
  const effectiveLabelMode = majorLabelsOnly ? "major" : labelMode;

  levels.forEach(lv => {
    const roundedLv = Math.round(lv);
    const isMajor   = roundedLv % majorEvery === 0;

    const lineColor = Cesium.Color.fromCssColorString(isMajor ? majorColor : minorColor)
      .withAlpha(isMajor ? opacity : opacity * 0.75);

    stitchSegments(rawSegs[lv] || []).forEach(chain => {
      if (chain.length < 2) return;
      let latlngs = chain.map(([rF, cF]) => gridToLatLng(rF, cF, bbox, rows, cols));

      // ✅ Chaikin smoothing — gives QGIS-quality smooth contour curves
      if (smoothContours && latlngs.length >= 4) {
        latlngs = chaikinSmooth(latlngs, smoothIterations);
      }

      const subChains = hasClip ? clipChain(latlngs, poly) : [latlngs];

      subChains.forEach(sub => {
        if (sub.length < 2) return;

        /* ── 1. Draw polyline ── */
        const positions = sub.map(([lat, lng]) =>
          Cesium.Cartographic.toCartesian(Cesium.Cartographic.fromDegrees(lng, lat))
        );

        try {
          const pl = new Cesium.GroundPolylinePrimitive({
            geometryInstances: new Cesium.GeometryInstance({
              geometry: new Cesium.GroundPolylineGeometry({
                positions,
                width: isMajor ? 2.8 : 1.2,
              }),
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(lineColor),
              },
            }),
            appearance        : new Cesium.PolylineColorAppearance(),
            classificationType: Cesium.ClassificationType.TERRAIN,
            asynchronous      : false,
          });
          viewer.scene.primitives.add(pl);
          prims.push(pl);
        } catch {
          const ent = viewer.entities.add({
            polyline: {
              positions    : sub.map(([lat, lng]) => Cesium.Cartesian3.fromDegrees(lng, lat)),
              width        : isMajor ? 2.8 : 1.2,
              material     : lineColor,
              clampToGround: true,
            },
          });
          ents.push(ent);
        }

        /* ── 2. Elevation Labels — TERRAIN CLAMPED ────────────────────
         *
         *  THE KEY FIX:
         *  - position height = 0 (Cesium calculates exact terrain height)
         *  - HeightReference.CLAMP_TO_GROUND (Cesium pins label to surface)
         *  - disableDepthTestDistance = Infinity (label always draws on top)
         *
         *  This is identical to how QGIS/Global Mapper place labels —
         *  the renderer handles terrain placement, not the data.
         ──────────────────────────────────────────────────────────────── */
        if (!showLabels) return;

        const spacing  = repeatLabels ? repeatSpacingM : 0;
        const labelPts = getLabelPositions(sub, isMajor, spacing, effectiveLabelMode);
        const labelText = String(roundedLv) + "m";

        labelPts.forEach(({ lat, lng, idx }) => {
          if (hasClip && !pointInPolygon(lat, lng, poly)) return;

          // Rotation angle along the contour direction
          const rotDeg = rotateLabels ? chainAngleAt(sub, idx) : 0;

          /*
           * LOD distances for label visibility:
           * Major: visible up to 80km (map overview scale)
           * Minor: visible up to 15km (detail scale), fade beyond
           *
           * These match QGIS "scale-based visibility" behaviour:
           * zoom out → only major labels visible
           * zoom in  → all labels visible
           */
          const nearFarTranslucency = isMajor
            ? new Cesium.NearFarScalar(100, 1.0, 80000, 0.0)   // major: show to 80km
            : new Cesium.NearFarScalar(100, 1.0, 15000, 0.0);  // minor: fade at 15km

          const nearFarScale = isMajor
            ? new Cesium.NearFarScalar(200, 1.15, 60000, 0.4)
            : new Cesium.NearFarScalar(200, 1.0,  12000, 0.3);

          ents.push(viewer.entities.add({
            /*
             * ✅ CRITICAL FIX: height = 0 + CLAMP_TO_GROUND
             *
             * Cesium's CLAMP_TO_GROUND samples the actual terrain mesh
             * and places the entity exactly on the surface.
             *
             * Do NOT use fromDegrees(lng, lat, elevValue) — that uses
             * ellipsoidal height which doesn't match Cesium's terrain.
             * The result is labels floating above or sinking below terrain.
             */
            position: Cesium.Cartesian3.fromDegrees(lng, lat, 0),

            label: {
              text: labelText,

              // Professional GIS condensed font — matches Global Mapper / QGIS style
              font: isMajor
                ? "bold 13px 'Arial Narrow',Arial,sans-serif"
                : "11px 'Arial Narrow',Arial,sans-serif",

              fillColor   : Cesium.Color.fromCssColorString(isMajor ? majorColor : minorColor),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: isMajor ? 3 : 2,
              style       : Cesium.LabelStyle.FILL_AND_OUTLINE,

              // Subtle pill background (GIS professional style)
              showBackground  : true,
              backgroundColor : isMajor
                ? new Cesium.Color(1.0, 1.0, 0.88, 0.93)   // warm cream for major
                : new Cesium.Color(1.0, 1.0, 1.0, 0.80),   // white for minor
              backgroundPadding: isMajor
                ? new Cesium.Cartesian2(6, 3)
                : new Cesium.Cartesian2(4, 2),

              // ✅ FIX: CLAMP_TO_GROUND — Cesium pins label to terrain mesh
              //         No more floating in sky regardless of 3D tilt/rotation
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,

              // ✅ FIX: POSITIVE_INFINITY — label always renders on top
              //         With CLAMP_TO_GROUND this does NOT cause z-fighting
              //         because Cesium handles depth internally for clamped entities
              disableDepthTestDistance: Number.POSITIVE_INFINITY,

              // No eyeOffset needed — CLAMP_TO_GROUND handles surface position
              eyeOffset: new Cesium.Cartesian3(0, 0, 0),

              // Rotation along the contour line direction
              rotation   : rotateLabels ? Cesium.Math.toRadians(rotDeg) : 0,
              alignedAxis: rotateLabels ? Cesium.Cartesian3.UNIT_Z : Cesium.Cartesian3.ZERO,

              // Slight upward pixel offset so label doesn't overlap the line itself
              pixelOffset: new Cesium.Cartesian2(0, isMajor ? -12 : -8),

              scale: isMajor ? 1.0 : 0.88,

              // ✅ LOD: minor labels fade at far zoom (like QGIS scale-based visibility)
              translucencyByDistance: nearFarTranslucency,
              scaleByDistance       : nearFarScale,
            },
          }));
        });
      });
    });
  });

  return {
    primitives: prims,
    entities  : ents,
    count     : prims.length + ents.filter(e => e.polyline).length,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════ */
export default function CesiumDEMContourPanel({
  viewer, Cesium, bbox, kmlPolygon=null, visible, onClose, kmlName="area"
}) {
  const [tab, setTab]               = useState("dem");
  const [status, setStatus]         = useState("");
  const [statusType, setStatusType] = useState("info");
  const [progress, setProgress]     = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elevGrid, setElevGrid]     = useState(null);

  /* DEM state */
  const [colorRamp, setColorRamp]                     = useState(DEFAULT_RAMP);
  const [demOpacity, setDemOpacity]                   = useState(0.60);
  const [hillshadeStrength, setHillshadeStrength]     = useState(0.9);
  const [hillshadeMode, setHillshadeMode]             = useState("multi");
  const [gridRes, setGridRes]                         = useState(120);
  const [hasDEM, setHasDEM]                           = useState(false);
  const [demVisible, setDemVisible]                   = useState(true);

  /* Contour state */
  const [contourInterval, setContourInterval]         = useState(10);
  const [majorEvery, setMajorEvery]                   = useState(50);
  const [minorColor, setMinorColor]                   = useState("#7a5c2e");
  const [majorColor, setMajorColor]                   = useState("#3b1a00");
  const [hasContour, setHasContour]                   = useState(false);
  const [contourVisible, setContourVisible]           = useState(true);
  const [contourCount, setContourCount]               = useState(0);

  /* Label options */
  const [showLabels, setShowLabels]                   = useState(true);
  const [labelMode, setLabelMode]                     = useState("all");
  const [majorLabelsOnly, setMajorLabelsOnly]         = useState(false);
  const [rotateLabels, setRotateLabels]               = useState(true);
  const [repeatLabels, setRepeatLabels]               = useState(true);
  const [repeatSpacingM, setRepeatSpacingM]           = useState(500);

  /* Smoothing */
  const [smoothContours, setSmoothContours]           = useState(true);
  const [smoothIterations, setSmoothIterations]       = useState(2);

  /* Display mode */
  const [displayMode, setDisplayMode]                 = useState("normal");
  const [basemap, setBasemap]                         = useState("satellite");

  const abortRef    = useRef(null);
  const demLayerRef = useRef(null);
  const contourRef  = useRef({ primitives: [], entities: [] });
  const elevGridRef = useRef(null);
  const optsRef     = useRef({ colorRamp, demOpacity, hillshadeStrength, hillshadeMode });
  const debounceRef = useRef(null);
  const polyRef     = useRef(kmlPolygon);
  const bgEntityRef = useRef(null);

  useEffect(() => { polyRef.current = kmlPolygon; }, [kmlPolygon]);
  useEffect(() => { optsRef.current = { colorRamp, demOpacity, hillshadeStrength, hillshadeMode }; },
    [colorRamp, demOpacity, hillshadeStrength, hillshadeMode]);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    clearDEMLayer();
    clearContourLayers();
    clearBG();
  }, []);

  useEffect(() => {
    if (!hasDEM || !elevGridRef.current || !viewer || !Cesium) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      clearDEMLayer();
      const o = optsRef.current;
      const layer = await renderDEM(
        Cesium, viewer, elevGridRef.current,
        { colorRamp: o.colorRamp, opacity: o.demOpacity, hillshadeStrength: o.hillshadeStrength, hillshadeMode: o.hillshadeMode },
        polyRef.current, demLayerRef
      );
      if (layer) { demLayerRef.current = layer; setDemVisible(true); }
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [colorRamp, demOpacity, hillshadeStrength, hillshadeMode]);

  useEffect(() => {
    if (!viewer || !Cesium) return;
    if (displayMode === "contour_only") {
      for (let i = 0; i < viewer.imageryLayers.length; i++) {
        const l = viewer.imageryLayers.get(i);
        if (l !== demLayerRef.current) l.show = false;
      }
      if (demLayerRef.current) demLayerRef.current.show = false;
      if (!bgEntityRef.current && bbox) {
        bgEntityRef.current = viewer.entities.add({
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat),
            material: Cesium.Color.BLACK,
            height  : 0,
          }
        });
      }
    } else {
      for (let i = 0; i < viewer.imageryLayers.length; i++) {
        viewer.imageryLayers.get(i).show = true;
      }
      clearBG();
    }
  }, [displayMode]);

  function clearBG() {
    if (bgEntityRef.current) { try { viewer?.entities?.remove(bgEntityRef.current); } catch (_) {} bgEntityRef.current = null; }
  }
  function clearDEMLayer() {
    if (demLayerRef.current) { try { viewer?.imageryLayers?.remove(demLayerRef.current, true); } catch (_) {} demLayerRef.current = null; }
  }
  function clearContourLayers() {
    contourRef.current.primitives.forEach(p => { try { viewer?.scene?.primitives?.remove(p); } catch (_) {} });
    contourRef.current.entities.forEach(e => { try { viewer?.entities?.remove(e); } catch (_) {} });
    contourRef.current = { primitives: [], entities: [] };
  }
  const msg = (m, t = "info") => { setStatus(m); setStatusType(t); };

  const fetchElev = useCallback(async () => {
    if (!bbox) { msg("No bounding area defined.", "warn"); return; }
    const key = cacheKey(bbox, gridRes);
    if (_elvCache[key]) {
      const eg = _elvCache[key];
      setElevGrid(eg); elevGridRef.current = eg; autoInterval(eg.max - eg.min);
      msg(`Cache hit · ${Math.round(eg.min)}m → ${Math.round(eg.max)}m`, "ok");
      return;
    }
    abortRef.current = new AbortController();
    setIsProcessing(true); setProgress(5);
    msg("Sampling AWS Terrain Tiles (Mapzen Terrarium, ~3m)…", "info");
    try {
      const rows = gridRes, cols = gridRes;
      const grid = await fetchElevationGrid(bbox, rows, cols, (done, total) => {
        setProgress(5 + Math.round(done / total * 82));
        msg(`Fetching elevation tiles… ${done}/${total} pts (${Math.round(done/total*100)}%)`, "info");
      }, abortRef.current.signal);
      if (abortRef.current.signal.aborted) { msg("Cancelled.", "warn"); setIsProcessing(false); setProgress(0); return; }
      msg("Interpolating full DEM grid…", "info"); setProgress(90);
      fillNaN(grid, rows, cols);
      const padded = Array.from({ length: rows+2 }, () => new Float32Array(cols+2));
      for (let r = 0; r < rows+2; r++) for (let c = 0; c < cols+2; c++) {
        const rr = Math.max(0, Math.min(rows-1, r-1)), cc = Math.max(0, Math.min(cols-1, c-1));
        padded[r][c] = grid[rr][cc];
      }
      grid.length = 0;
      for (let r = 0; r < rows+2; r++) grid.push(padded[r]);
      const paddedRows = rows+2, paddedCols = cols+2;
      let minE = Infinity, maxE = -Infinity;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        if (!isNaN(v)) { if (v < minE) minE = v; if (v > maxE) maxE = v; }
      }
      if (!isFinite(minE)) { msg("No valid elevation data received.", "err"); setIsProcessing(false); setProgress(0); return; }
      const eg = { grid, rows: paddedRows, cols: paddedCols, bbox, min: minE, max: maxE };
      _elvCache[key] = eg; setElevGrid(eg); elevGridRef.current = eg; autoInterval(maxE - minE);
      setProgress(100);
      const hasPoly = polyRef.current && polyRef.current.length >= 3;
      msg(`Done · ${rows*cols} pts · ${Math.round(minE)}m → ${Math.round(maxE)}m · Δ${Math.round(maxE-minE)}m` + (hasPoly ? " · KML clipped" : ""), "ok");
    } catch (e) {
      if (e.name !== "AbortError") { msg("Error: " + e.message, "err"); console.error(e); }
    } finally {
      setIsProcessing(false);
      setTimeout(() => setProgress(0), 1200);
    }
  }, [bbox, gridRes]);

  function autoInterval(range) {
    if (range < 20)       setContourInterval(1);
    else if (range < 50)  setContourInterval(5);
    else if (range < 150) setContourInterval(10);
    else if (range < 400) setContourInterval(20);
    else                  setContourInterval(50);
  }

  const doRenderDEM = useCallback(async () => {
    const eg = elevGridRef.current || elevGrid;
    if (!eg || !viewer || !Cesium) { msg("Fetch elevation first.", "warn"); return; }
    msg("Rendering DEM…", "info");
    clearDEMLayer();
    const layer = await renderDEM(
      Cesium, viewer, eg,
      { colorRamp, opacity: demOpacity, hillshadeStrength, hillshadeMode },
      polyRef.current, demLayerRef
    );
    if (!layer) { msg("DEM render failed.", "err"); return; }
    demLayerRef.current = layer;
    setHasDEM(true); setDemVisible(true);
    msg(`DEM rendered · ${colorRamp} · ${hillshadeMode === "off" ? "flat" : hillshadeMode === "multi" ? "multi-dir HS" : "single HS"}`, "ok");
  }, [elevGrid, viewer, Cesium, colorRamp, demOpacity, hillshadeStrength, hillshadeMode]);

  const doRenderContours = useCallback(() => {
    const eg = elevGridRef.current || elevGrid;
    if (!eg || !viewer || !Cesium) { msg("Fetch elevation first.", "warn"); return; }
    msg("Generating contours…", "info");
    clearContourLayers();
    const result = renderContours(Cesium, viewer, eg, {
      interval: contourInterval,
      majorEvery,
      minorColor,
      majorColor,
      opacity: 0.90,
      showLabels,
      labelMode,
      majorLabelsOnly,
      rotateLabels,
      repeatLabels,
      repeatSpacingM,
      smoothContours,
      smoothIterations,
    }, polyRef.current);
    contourRef.current = result;
    setHasContour(true); setContourVisible(true); setContourCount(result.count);
    msg(
      result.count > 0
        ? `${result.count} lines · ${contourInterval}m interval · labels ${majorLabelsOnly ? "major only" : labelMode} · ${smoothContours ? "smoothed" : "raw"}`
        : "0 contours — try smaller interval.",
      result.count > 0 ? "ok" : "warn"
    );
  }, [elevGrid, viewer, Cesium, contourInterval, majorEvery, minorColor, majorColor,
      showLabels, labelMode, majorLabelsOnly, rotateLabels, repeatLabels, repeatSpacingM,
      smoothContours, smoothIterations]);

  function toggleDEM() {
    if (!demLayerRef.current) return;
    demLayerRef.current.show = !demLayerRef.current.show;
    setDemVisible(demLayerRef.current.show);
  }
  function toggleContours() {
    const show = !contourVisible;
    contourRef.current.primitives.forEach(p => { try { p.show = show; } catch (_) {} });
    contourRef.current.entities.forEach(e => {
      if (e.polyline) e.polyline.show = show;
      if (e.label)    e.show          = show;
    });
    setContourVisible(show);
  }

  /* ── Exports ──────────────────────────────────────────────────────── */
  function exportTIFF() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { msg("No data.", "warn"); return; }
    try { dlBlob(buildGeoTIFF(eg), kmlName.replace(/\.[^.]+$/, "") + "_dem.tif", "image/tiff"); msg("GeoTIFF exported.", "ok"); }
    catch (e) { msg("Export error: " + e.message, "err"); }
  }
  function exportCSV() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { msg("No data.", "warn"); return; }
    const { grid, rows, cols, bbox } = eg;
    const lines = ["lat,lng,elevation_m,elevation_ft"];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const [lat, lng] = gridToLatLng(r, c, bbox, rows, cols);
      const e = grid[r][c];
      lines.push(`${lat.toFixed(7)},${lng.toFixed(7)},${isNaN(e) ? "" : e.toFixed(2)},${isNaN(e) ? "" : (e*3.28084).toFixed(2)}`);
    }
    dlBlob(new TextEncoder().encode(lines.join("\n")), kmlName.replace(/\.[^.]+$/, "") + "_dem.csv", "text/csv");
    msg("CSV exported.", "ok");
  }
  function exportGeoJSON() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { msg("No data.", "warn"); return; }
    const gj = buildContourGeoJSON(eg, contourInterval, majorEvery, polyRef.current);
    dlBlob(new TextEncoder().encode(JSON.stringify(gj, null, 2)), kmlName.replace(/\.[^.]+$/, "") + "_contours.geojson", "application/json");
    msg(`GeoJSON exported · ${gj.features.length} features`, "ok");
  }
  function exportSHP() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { msg("No data.", "warn"); return; }
    try {
      const gj = buildContourGeoJSON(eg, contourInterval, majorEvery, polyRef.current);
      const { shp, shx } = buildSHPLines(gj.features);
      const dbf = buildDBF(gj.features);
      const prj = new TextEncoder().encode(WGS84_PRJ);
      const base = (kmlName.replace(/\.[^.]+$/, "") + "_contours_" + contourInterval + "m").replace(/[^a-zA-Z0-9_]/g, "_");
      dlBlob(
        buildZip([{ name: base+".shp", data: shp }, { name: base+".shx", data: shx }, { name: base+".dbf", data: dbf }, { name: base+".prj", data: prj }]).buffer,
        base + "_shapefile.zip", "application/zip"
      );
      msg(`Shapefile ZIP exported · ${gj.features.length} features`, "ok");
    } catch (e) { msg("Export error: " + e.message, "err"); }
  }
  function exportKML() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { msg("No data.", "warn"); return; }
    try {
      const kml = buildContourKML(eg, contourInterval, majorEvery, polyRef.current);
      dlBlob(new TextEncoder().encode(kml), kmlName.replace(/\.[^.]+$/, "") + "_contours.kml", "application/vnd.google-earth.kml+xml");
      msg("KML exported with elevation fields.", "ok");
    } catch (e) { msg("Export error: " + e.message, "err"); }
  }
  function exportDXF() {
    const eg = elevGridRef.current || elevGrid;
    if (!eg) { msg("No data.", "warn"); return; }
    try {
      const dxf = buildContourDXF(eg, contourInterval, majorEvery, polyRef.current);
      dlBlob(new TextEncoder().encode(dxf), kmlName.replace(/\.[^.]+$/, "") + "_contours.dxf", "application/dxf");
      msg("DXF exported with elevation layers.", "ok");
    } catch (e) { msg("Export error: " + e.message, "err"); }
  }

  if (!visible) return null;

  /* ── UI constants ─────────────────────────────────────────────────── */
  const F = { ui: "'DM Sans',system-ui,sans-serif", mono: "'Courier New','JetBrains Mono',monospace" };
  const C = {
    bg:"rgba(6,10,22,0.97)", sur:"rgba(255,255,255,0.04)", bor:"rgba(255,255,255,0.08)",
    tx:"#c8dff8", dim:"rgba(165,200,240,0.55)",
    blue:"#3b82f6", cyan:"#22d3c8", green:"#4ade80", amber:"#f5a623", red:"#f06060",
    violet:"#b89cf8", pink:"#f472b6", orange:"#fb923c",
  };
  const INTERVALS = [1,2,5,10,20,25,50,100];
  const MAJORS    = [5,10,25,50,100,200];
  const sm = { ok:{color:C.green,icon:"✓"}, err:{color:C.red,icon:"✕"}, warn:{color:C.amber,icon:"⚠"}, info:{color:C.blue,icon:"›"} }[statusType] || { color:C.blue, icon:"›" };
  const rampCSS = n => (COLOR_RAMPS[n] || COLOR_RAMPS[DEFAULT_RAMP]).map(([t,[r,g,b]]) => `rgb(${r},${g},${b}) ${Math.round(t*100)}%`).join(",");

  const Btn = ({ color=C.blue, children, onClick, disabled, fullWidth=true, small=false }) => (
    <button onClick={onClick} disabled={disabled} style={{
      width:fullWidth?"100%":"auto", padding:small?"6px 10px":"9px 14px",
      borderRadius:8, cursor:disabled?"not-allowed":"pointer",
      background:`${color}18`, border:`1px solid ${color}38`,
      color, fontSize:small?10:11.5, fontWeight:700, fontFamily:F.ui,
      display:"flex", alignItems:"center", justifyContent:"center", gap:6,
      opacity:disabled?0.35:1, transition:"all .12s",
    }}>{children}</button>
  );
  const Toggle = ({ label, value, onChange, color=C.cyan }) => (
    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", userSelect:"none" }}>
      <div onClick={() => onChange(!value)} style={{
        width:32, height:18, borderRadius:9,
        background:value?`${color}44`:"rgba(255,255,255,.06)",
        border:`1px solid ${value?color:C.bor}`,
        position:"relative", transition:"all .15s", flexShrink:0,
      }}>
        <div style={{
          position:"absolute", top:2, left:value?14:2,
          width:12, height:12, borderRadius:6,
          background:value?color:"rgba(255,255,255,.3)",
          transition:"left .15s",
        }}/>
      </div>
      <span style={{ color:C.dim, fontSize:9, fontFamily:F.ui }}>{label}</span>
    </label>
  );

  return (
    <div style={{
      position:"fixed", top:0, right:0, bottom:0, width:318, zIndex:5000,
      background:C.bg, backdropFilter:"blur(36px)",
      borderLeft:`1px solid ${C.bor}`,
      display:"flex", flexDirection:"column", fontFamily:F.ui,
      boxShadow:"-12px 0 48px rgba(0,0,0,.9)",
    }}>

      {/* ── Header ── */}
      <div style={{ padding:"12px 14px 10px", borderBottom:`1px solid ${C.bor}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <div style={{
            width:34, height:34, borderRadius:9,
            background:"linear-gradient(135deg,rgba(59,130,246,.25),rgba(34,211,200,.25))",
            border:"1px solid rgba(59,130,246,.3)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0,
          }}>🏔</div>
          <div style={{ flex:1 }}>
            <div style={{ color:C.tx, fontWeight:700, fontSize:13 }}>3D DEM & Contours</div>
            <div style={{ color:C.dim, fontSize:9, fontFamily:F.mono, marginTop:1 }}>
              AWS Terrarium z14 · ~3m · CLAMP_TO_GROUND ✓
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.dim, cursor:"pointer", fontSize:20, padding:0, lineHeight:1 }}>×</button>
        </div>

        {kmlPolygon?.length >= 3 && (
          <div style={{ background:"rgba(74,222,128,.07)", border:"1px solid rgba(74,222,128,.25)", borderRadius:7, padding:"4px 9px", fontSize:9, fontFamily:F.mono, color:C.green, marginBottom:6 }}>
            ✂ KML clip active · {kmlPolygon.length} vertices
          </div>
        )}
        {bbox && (
          <div style={{ background:"rgba(255,255,255,.02)", border:`1px solid ${C.bor}`, borderRadius:8, padding:"6px 9px", fontSize:9, fontFamily:F.mono, color:C.dim, display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 10px" }}>
            <span>N {bbox.maxLat.toFixed(4)}°</span><span>S {bbox.minLat.toFixed(4)}°</span>
            <span>E {bbox.maxLng.toFixed(4)}°</span><span>W {bbox.minLng.toFixed(4)}°</span>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.bor}`, flexShrink:0 }}>
        {[["dem","🏔 DEM"],["contour","📐 Contour"],["display","🖼 Display"],["export","💾 Export"]].map(([id, lb]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex:1, padding:"8px 2px",
            background:tab===id?"rgba(59,130,246,.08)":"transparent",
            border:"none", borderBottom:`2px solid ${tab===id?C.blue:"transparent"}`,
            cursor:"pointer", fontSize:9.5, fontWeight:700,
            color:tab===id?C.blue:C.dim, transition:"all .15s", fontFamily:F.ui,
          }}>{lb}</button>
        ))}
      </div>

      {/* ── Body ── */}
      <div style={{
        flex:1, overflowY:"auto", padding:"12px 13px 24px",
        display:"flex", flexDirection:"column", gap:10,
        scrollbarWidth:"thin", scrollbarColor:"rgba(59,130,246,.2) transparent",
      }}>

        {/* ════ DEM TAB ════ */}
        {tab === "dem" && <>
          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:6 }}>
              GRID RESOLUTION · {gridRes}×{gridRes} = {gridRes*gridRes} pts
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
              <input type="range" min={40} max={180} step={10} value={gridRes}
                onChange={e => setGridRes(+e.target.value)} disabled={isProcessing}
                style={{ flex:1, accentColor:C.pink, cursor:isProcessing?"not-allowed":"pointer" }}/>
              <span style={{ color:C.pink, fontSize:10, fontFamily:F.mono, minWidth:40 }}>{gridRes}×{gridRes}</span>
            </div>
            <div style={{ color:gridRes>100?C.amber:C.dim, fontSize:9 }}>
              {gridRes > 100
                ? `⚠ ${gridRes*gridRes} pts — may be slow`
                : `~${Math.ceil(gridRes*gridRes/TILE_Z*0.15).toFixed(0)}s est · Terrarium tiles`}
            </div>
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:7 }}>HILLSHADE</div>
            <div style={{ display:"flex", gap:4, marginBottom:8 }}>
              {[["multi","Multi-Dir"],["single","Single 315°"],["off","Off"]].map(([id, lb]) => (
                <button key={id} onClick={() => setHillshadeMode(id)} style={{
                  flex:1, padding:"6px 3px", borderRadius:7,
                  border:hillshadeMode===id?`1px solid ${C.blue}44`:`1px solid ${C.bor}`,
                  background:hillshadeMode===id?"rgba(59,130,246,.12)":C.sur,
                  color:hillshadeMode===id?C.blue:C.dim,
                  fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:F.mono,
                }}>{lb}</button>
              ))}
            </div>
            {hillshadeMode !== "off" && <>
              <div style={{ color:C.dim, fontSize:9, marginBottom:4 }}>Strength · {Math.round(hillshadeStrength*100)}%</div>
              <input type="range" min={0} max={0.92} step={0.04} value={hillshadeStrength}
                onChange={e => setHillshadeStrength(+e.target.value)}
                style={{ width:"100%", accentColor:C.amber }}/>
            </>}
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:6 }}>OPACITY · {Math.round(demOpacity*100)}%</div>
            <input type="range" min={0.1} max={1} step={0.05} value={demOpacity}
              onChange={e => setDemOpacity(+e.target.value)}
              style={{ width:"100%", accentColor:C.pink }}/>
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:8 }}>COLOR RAMP</div>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              {Object.keys(COLOR_RAMPS).map(name => {
                const sel = colorRamp === name;
                return (
                  <button key={name} onClick={() => setColorRamp(name)} style={{
                    display:"flex", alignItems:"center", gap:8,
                    width:"100%", padding:"5px 7px", borderRadius:7, cursor:"pointer",
                    background:sel?"rgba(59,130,246,.08)":"transparent",
                    border:sel?"1.5px solid rgba(59,130,246,.4)":`1px solid ${C.bor}`,
                  }}>
                    <span style={{
                      width:90, fontSize:9, fontFamily:F.mono, textAlign:"left", flexShrink:0,
                      color:sel?C.blue:C.dim, fontWeight:sel?700:400,
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                    }}>{name}</span>
                    <div style={{
                      flex:1, height:14, borderRadius:4,
                      background:`linear-gradient(to right,${rampCSS(name)})`,
                      border:sel?"1px solid rgba(59,130,246,.35)":`1px solid ${C.bor}`,
                    }}/>
                  </button>
                );
              })}
            </div>
          </div>

          {elevGrid && <>
            <div style={{ background:"rgba(74,222,128,.04)", border:"1px solid rgba(74,222,128,.15)", borderRadius:10, padding:"10px 12px" }}>
              <div style={{ color:C.green, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:6 }}>ELEVATION SUMMARY</div>
              {[
                ["Min",  `${elevGrid.min.toFixed(1)} m`,  `${(elevGrid.min*3.28084).toFixed(0)} ft`],
                ["Max",  `${elevGrid.max.toFixed(1)} m`,  `${(elevGrid.max*3.28084).toFixed(0)} ft`],
                ["Range",`${(elevGrid.max-elevGrid.min).toFixed(1)} m`, ""],
                ["Grid", `${elevGrid.rows}×${elevGrid.cols}`,           `${elevGrid.rows*elevGrid.cols} pts`],
                ["Source","AWS Terrarium z14","~3m"],
              ].map(([k,v,v2]) => (
                <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 0", borderBottom:"1px solid rgba(74,222,128,.08)" }}>
                  <span style={{ color:C.dim, fontSize:9, fontFamily:F.mono }}>{k}</span>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ color:C.green, fontSize:11, fontWeight:700, fontFamily:F.mono }}>{v}</span>
                    {v2 && <span style={{ color:C.dim, fontSize:8, fontFamily:F.mono, marginLeft:5 }}>{v2}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:6 }}>
                LEGEND · {Math.round(elevGrid.min)}m → {Math.round(elevGrid.max)}m
              </div>
              <div style={{ height:22, borderRadius:5, background:`linear-gradient(to right,${rampCSS(colorRamp)})`, border:`1px solid ${C.bor}`, marginBottom:6 }}/>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                {[0,.25,.5,.75,1].map(t => (
                  <span key={t} style={{ fontSize:8, color:C.dim, fontFamily:F.mono }}>
                    {Math.round(elevGrid.min + (elevGrid.max-elevGrid.min)*t)}m
                  </span>
                ))}
              </div>
            </div>
          </>}

          {isProcessing && (
            <div style={{ background:"rgba(59,130,246,.06)", border:"1px solid rgba(59,130,246,.18)", borderRadius:9, padding:"9px 11px" }}>
              <div style={{ height:3, borderRadius:2, background:"rgba(255,255,255,.06)", overflow:"hidden", marginBottom:6 }}>
                <div style={{ height:"100%", width:`${progress}%`, borderRadius:2, transition:"width .25s", background:"linear-gradient(90deg,#3b82f6,#22d3c8)" }}/>
              </div>
            </div>
          )}

          <div style={{ display:"flex", gap:6 }}>
            <Btn color={C.pink} onClick={fetchElev} disabled={isProcessing || !bbox}>
              {isProcessing
                ? <><span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⟳</span>Fetching…</>
                : "📡 Fetch Elevation Data"}
            </Btn>
            {isProcessing && (
              <button onClick={() => abortRef.current?.abort()} style={{
                flexShrink:0, padding:"9px 12px", borderRadius:8,
                background:"rgba(240,96,96,.1)", border:"1px solid rgba(240,96,96,.3)",
                color:C.red, cursor:"pointer", fontSize:12, fontFamily:F.ui, fontWeight:700,
              }}>✕</button>
            )}
          </div>
          <Btn color={C.amber} onClick={doRenderDEM} disabled={!elevGrid}>🎨 Render DEM on Globe</Btn>
          {hasDEM && <Btn color={demVisible?C.red:C.green} onClick={toggleDEM}>{demVisible?"🙈 Hide DEM":"👁 Show DEM"}</Btn>}
        </>}

        {/* ════ CONTOUR TAB ════ */}
        {tab === "contour" && <>
          {!elevGrid && (
            <div style={{ padding:"10px", borderRadius:8, background:"rgba(245,166,35,.07)", border:"1px solid rgba(245,166,35,.2)", color:C.amber, fontSize:10.5, textAlign:"center" }}>
              ⚠️ Fetch elevation in DEM tab first
            </div>
          )}

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:7 }}>CONTOUR INTERVAL (Minor)</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {INTERVALS.map(v => (
                <button key={v} onClick={() => setContourInterval(v)} style={{
                  flex:"1 0 auto", minWidth:32, padding:"6px 3px", borderRadius:7,
                  border:contourInterval===v?`1px solid ${C.cyan}44`:`1px solid ${C.bor}`,
                  background:contourInterval===v?"rgba(34,211,200,.12)":C.sur,
                  color:contourInterval===v?C.cyan:C.dim,
                  fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:F.mono, textAlign:"center",
                }}>{v}m</button>
              ))}
            </div>
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:7 }}>MAJOR INDEX EVERY</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {MAJORS.map(v => (
                <button key={v} onClick={() => setMajorEvery(v)} style={{
                  flex:"1 0 auto", minWidth:36, padding:"6px 3px", borderRadius:7,
                  border:majorEvery===v?`1px solid ${C.amber}44`:`1px solid ${C.bor}`,
                  background:majorEvery===v?"rgba(245,166,35,.12)":C.sur,
                  color:majorEvery===v?C.amber:C.dim,
                  fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:F.mono,
                }}>{v}m</button>
              ))}
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {[["Minor",minorColor,setMinorColor],["Major",majorColor,setMajorColor]].map(([lb,val,set]) => (
              <div key={lb} style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:8, padding:"8px 10px" }}>
                <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:5 }}>{lb.toUpperCase()}</div>
                <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                  <input type="color" value={val} onChange={e => set(e.target.value)}
                    style={{ width:28, height:28, border:"none", borderRadius:5, cursor:"pointer" }}/>
                  <span style={{ color:C.dim, fontSize:9, fontFamily:F.mono }}>{val}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Label Options ── */}
          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:8 }}>LABEL OPTIONS</div>

            {/* Fix badge */}
            <div style={{ background:"rgba(74,222,128,.06)", border:"1px solid rgba(74,222,128,.2)", borderRadius:6, padding:"5px 8px", marginBottom:8, fontSize:9, color:C.green, fontFamily:F.mono }}>
              ✅ Labels CLAMP_TO_GROUND — no floating in 3D
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>

              {/* Show Contour Labels toggle */}
              <Toggle label="Show Contour Labels" value={showLabels} onChange={v => {
                setShowLabels(v);
                if (!v) setLabelMode("none");
                else if (labelMode === "none") setLabelMode("all");
              }} color={C.green}/>

              {/* Major Labels Only toggle */}
              <Toggle
                label="Major Labels Only (zoom-out mode)"
                value={majorLabelsOnly}
                onChange={v => {
                  setMajorLabelsOnly(v);
                  if (v) setShowLabels(true);
                }}
                color={C.amber}
              />

              {/* Label mode buttons */}
              <div style={{ display:"flex", gap:4 }}>
                {[["all","All Lines"],["major","Major Only"],["none","None"]].map(([id, lb]) => (
                  <button key={id} onClick={() => {
                    setLabelMode(id);
                    setShowLabels(id !== "none");
                    if (id !== "major") setMajorLabelsOnly(false);
                  }}
                    style={{
                      flex:1, padding:"5px 3px", borderRadius:6,
                      border:labelMode===id?`1px solid ${C.cyan}55`:`1px solid ${C.bor}`,
                      background:labelMode===id?"rgba(34,211,200,.10)":C.sur,
                      color:labelMode===id?C.cyan:C.dim,
                      fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:F.mono,
                    }}>{lb}</button>
                ))}
              </div>

              <Toggle label="Rotate Labels Along Line"   value={rotateLabels}  onChange={setRotateLabels}/>
              <Toggle label="Repeat Labels on Long Lines" value={repeatLabels} onChange={setRepeatLabels}/>
              {repeatLabels && <>
                <div style={{ color:C.dim, fontSize:9 }}>Repeat spacing · {repeatSpacingM}m</div>
                <input type="range" min={100} max={2000} step={100} value={repeatSpacingM}
                  onChange={e => setRepeatSpacingM(+e.target.value)}
                  style={{ width:"100%", accentColor:C.cyan }}/>
              </>}
            </div>
          </div>

          {/* ── Smoothing options ── */}
          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:8 }}>CONTOUR SMOOTHING (QGIS-Style)</div>
            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
              <Toggle label="Smooth Contours (Chaikin Algorithm)" value={smoothContours} onChange={setSmoothContours} color={C.violet}/>
              {smoothContours && <>
                <div style={{ color:C.dim, fontSize:9 }}>
                  Iterations · {smoothIterations} &nbsp;
                  <span style={{ color:C.violet }}>
                    {smoothIterations===1?"(Light — fast)":smoothIterations===2?"(Standard — QGIS-like)":"(Heavy — very smooth)"}
                  </span>
                </div>
                <div style={{ display:"flex", gap:4 }}>
                  {[1,2,3].map(v => (
                    <button key={v} onClick={() => setSmoothIterations(v)} style={{
                      flex:1, padding:"6px 3px", borderRadius:6,
                      border:smoothIterations===v?`1px solid ${C.violet}55`:`1px solid ${C.bor}`,
                      background:smoothIterations===v?"rgba(184,156,248,.12)":C.sur,
                      color:smoothIterations===v?C.violet:C.dim,
                      fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:F.mono,
                    }}>{v}×</button>
                  ))}
                </div>
              </>}
            </div>
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:8, padding:"8px 10px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, marginBottom:6 }}>PREVIEW</div>
            <svg width="100%" height="60" style={{ display:"block" }}>
              <line x1="8" y1="16" x2="92%" y2="16" stroke={minorColor} strokeWidth="1.2" opacity="0.75"/>
              <text x="8" y="11" fill={C.dim} fontSize="7.5" fontFamily="monospace">minor line ({contourInterval}m)</text>
              <rect x="44" y="8" width="28" height="11" rx="2" fill="rgba(255,255,255,0.82)"/>
              <text x="58" y="16.5" fill={minorColor} fontSize="7.5" fontFamily="monospace" textAnchor="middle">{contourInterval}m</text>
              <line x1="8" y1="40" x2="92%" y2="40" stroke={majorColor} strokeWidth="2.8" opacity="0.90"/>
              <text x="8" y="55" fill={C.dim} fontSize="7.5" fontFamily="monospace">major index ({majorEvery}m)</text>
              <rect x="44" y="31" width="36" height="13" rx="2" fill="rgba(255,255,230,0.95)"/>
              <text x="62" y="41" fill={majorColor} fontSize="8" fontFamily="monospace" textAnchor="middle" fontWeight="bold">{majorEvery}m</text>
            </svg>
          </div>

          <Btn color={C.cyan} onClick={doRenderContours} disabled={!elevGrid}>📐 Generate Contours on Globe</Btn>
          {hasContour && <>
            <Btn color={contourVisible?C.red:C.green} onClick={toggleContours}>
              {contourVisible ? "🙈 Hide Contours" : "👁 Show Contours"}
            </Btn>
            {contourCount > 0 && (
              <div style={{ textAlign:"center", color:C.cyan, fontSize:10, fontFamily:F.mono }}>
                {contourCount} lines · {contourInterval}m interval · major {majorEvery}m
              </div>
            )}
          </>}
        </>}

        {/* ════ DISPLAY TAB ════ */}
        {tab === "display" && <>
          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:8 }}>DISPLAY MODE</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {[
                ["normal",       "🌍 Normal (Basemap + DEM + Contours)",  "Satellite/terrain basemap visible beneath DEM and contours"],
                ["contour_only", "🗺 Contour Only Mode",                   "Black background, KML boundary + contour lines + labels only"],
              ].map(([id, lb, desc]) => (
                <button key={id} onClick={() => setDisplayMode(id)} style={{
                  padding:"9px 12px", borderRadius:8,
                  border:displayMode===id?`1.5px solid ${C.cyan}`:`1px solid ${C.bor}`,
                  background:displayMode===id?"rgba(34,211,200,.08)":"transparent",
                  cursor:"pointer", textAlign:"left",
                }}>
                  <div style={{ color:displayMode===id?C.cyan:C.tx, fontSize:11, fontWeight:700, marginBottom:3 }}>{lb}</div>
                  <div style={{ color:C.dim, fontSize:9 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {displayMode === "contour_only" && (
            <div style={{ background:"rgba(34,211,200,.05)", border:"1px solid rgba(34,211,200,.25)", borderRadius:9, padding:"10px 12px" }}>
              <div style={{ color:C.cyan, fontWeight:700, fontSize:11, marginBottom:5 }}>🗺 Contour Only Mode Active</div>
              <div style={{ color:C.dim, fontSize:9.5, lineHeight:1.6 }}>
                Black background · KML boundary (orange) · Contour lines · Elevation labels<br/>
                Matches Global Mapper / ArcGIS topographic map view.
              </div>
            </div>
          )}

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:8 }}>BASEMAP UNDERLAY</div>
            <div style={{ color:C.dim, fontSize:9, marginBottom:8, lineHeight:1.5 }}>
              Select the map shown beneath contours.<br/>
              Layer order: Basemap → KML → Contours → Labels
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {[
                ["satellite","🛰 Satellite","Aerial/satellite imagery"],
                ["street",   "🗺 Street",   "OpenStreetMap road map"],
                ["terrain",  "⛰ Terrain",  "USGS / Stamen terrain relief"],
              ].map(([id, lb, desc]) => (
                <button key={id} onClick={() => setBasemap(id)} style={{
                  padding:"8px 11px", borderRadius:8,
                  border:basemap===id?`1.5px solid ${C.blue}`:`1px solid ${C.bor}`,
                  background:basemap===id?"rgba(59,130,246,.08)":"transparent",
                  cursor:"pointer", textAlign:"left",
                }}>
                  <div style={{ color:basemap===id?C.blue:C.tx, fontSize:11, fontWeight:700, marginBottom:2 }}>{lb}</div>
                  <div style={{ color:C.dim, fontSize:9 }}>{desc}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop:8, background:"rgba(59,130,246,.05)", border:`1px solid ${C.bor}`, borderRadius:6, padding:"6px 8px", color:C.dim, fontSize:9 }}>
              ℹ Basemap switch applies to Cesium viewer's default imagery.
            </div>
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:8 }}>RENDER ORDER</div>
            {[
              [C.blue,  "1", "Basemap (satellite / street / terrain)"],
              [C.orange,"2", "KML boundary polygon"],
              [C.amber, "3", "DEM color overlay"],
              [C.cyan,  "4", "Contour lines (minor + major)"],
              [C.green, "5", "Elevation labels (CLAMP_TO_GROUND ✓)"],
            ].map(([col, n, label]) => (
              <div key={n} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", borderBottom:`1px solid ${C.bor}` }}>
                <div style={{
                  width:18, height:18, borderRadius:4,
                  background:`${col}22`, border:`1px solid ${col}55`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  color:col, fontSize:9, fontWeight:700, flexShrink:0,
                }}>{n}</div>
                <span style={{ color:C.dim, fontSize:9 }}>{label}</span>
              </div>
            ))}
          </div>
        </>}

        {/* ════ EXPORT TAB ════ */}
        {tab === "export" && <>
          <div style={{ padding:"10px 12px", borderRadius:10, background:"rgba(184,156,248,.05)", border:"1px solid rgba(184,156,248,.17)" }}>
            <div style={{ color:C.violet, fontWeight:700, fontSize:12.5, marginBottom:4 }}>💾 Export GIS Data</div>
            <div style={{ color:C.dim, fontSize:10.5, lineHeight:1.7 }}>
              All formats include elevation + major/minor classification — QGIS, ArcGIS, Global Mapper ready.
            </div>
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.pink, fontWeight:700, fontSize:11, marginBottom:7 }}>🏔 DEM / Elevation Grid</div>
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              <Btn color={C.pink}  onClick={exportTIFF} disabled={!elevGrid}>📥 GeoTIFF (.tif)</Btn>
              <Btn color={C.amber} onClick={exportCSV}  disabled={!elevGrid}>📥 CSV (lat,lng,elev_m,elev_ft)</Btn>
            </div>
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.cyan, fontWeight:700, fontSize:11, marginBottom:4 }}>📐 Contour Lines</div>
            <div style={{ background:"rgba(34,211,200,.04)", border:`1px solid rgba(34,211,200,.15)`, borderRadius:6, padding:"6px 8px", marginBottom:8, fontSize:9, color:C.dim }}>
              All exports include: <span style={{ color:C.cyan }}>elevation_m · elevation_ft · elev · label · contourType · is_major · interval_m</span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              <Btn color={C.cyan}   onClick={exportGeoJSON} disabled={!elevGrid}>📥 GeoJSON 3D (.geojson)</Btn>
              <Btn color={C.blue}   onClick={exportSHP}     disabled={!elevGrid}>📥 Shapefile ZIP (.shp + .dbf + .prj)</Btn>
              <Btn color={C.green}  onClick={exportKML}     disabled={!elevGrid}>📥 KML with elevation (.kml)</Btn>
              <Btn color={C.orange} onClick={exportDXF}     disabled={!elevGrid}>📥 DXF by elevation layer (.dxf)</Btn>
            </div>
          </div>

          <div style={{ background:C.sur, border:`1px solid ${C.bor}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ color:C.dim, fontSize:9, fontWeight:700, letterSpacing:".1em", marginBottom:8 }}>FIELD REFERENCE (SHP/GeoJSON)</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9, fontFamily:F.mono }}>
              <thead><tr>
                <th style={{ color:C.amber, textAlign:"left", padding:"3px 4px", borderBottom:`1px solid ${C.bor}` }}>FIELD</th>
                <th style={{ color:C.amber, textAlign:"left", padding:"3px 4px", borderBottom:`1px solid ${C.bor}` }}>TYPE</th>
                <th style={{ color:C.amber, textAlign:"left", padding:"3px 4px", borderBottom:`1px solid ${C.bor}` }}>EXAMPLE</th>
              </tr></thead>
              <tbody>
                {[
                  ["elev_m","Float","240.00"],["elev_ft","Int","787"],["elev","Int","240"],
                  ["label","String","240m"],["type","String","major"],["is_major","Int","1 / 0"],
                  ["interval","Float","10.0"],["maj_ev","Int","50"],
                ].map(([f,t,ex]) => (
                  <tr key={f}>
                    <td style={{ color:C.cyan,  padding:"3px 4px", borderBottom:`1px solid ${C.bor}22` }}>{f}</td>
                    <td style={{ color:C.dim,   padding:"3px 4px", borderBottom:`1px solid ${C.bor}22` }}>{t}</td>
                    <td style={{ color:C.tx,    padding:"3px 4px", borderBottom:`1px solid ${C.bor}22` }}>{ex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {elevGrid && (
            <div style={{ background:"rgba(74,222,128,.04)", border:"1px solid rgba(74,222,128,.15)", borderRadius:10, padding:"10px 12px" }}>
              <div style={{ color:C.green, fontWeight:700, fontSize:11, marginBottom:6 }}>✅ Summary</div>
              {[
                ["Grid",   `${elevGrid.rows}×${elevGrid.cols} pts`],
                ["Min",    `${elevGrid.min.toFixed(1)} m`],
                ["Max",    `${elevGrid.max.toFixed(1)} m`],
                ["Range",  `${(elevGrid.max-elevGrid.min).toFixed(1)} m`],
                ["Source", "AWS Terrarium z14 ~3m"],
                ["Interval",`${contourInterval}m minor / ${majorEvery}m major`],
                ...(contourCount > 0 ? [["Contours", `${contourCount} lines`]] : []),
                ...(kmlPolygon?.length >= 3 ? [["Clip", `KML · ${kmlPolygon.length} pts`]] : []),
              ].map(([k, v]) => (
                <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid rgba(74,222,128,.08)" }}>
                  <span style={{ color:C.dim,   fontSize:10, fontFamily:F.mono }}>{k}</span>
                  <span style={{ color:C.green, fontSize:11, fontWeight:700, fontFamily:F.mono }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </>}
      </div>

      {/* ── Status bar ── */}
      {status && (
        <div style={{
          padding:"6px 12px", flexShrink:0,
          borderTop:`1px solid ${C.bor}`,
          background:`${sm.color}0a`,
          display:"flex", alignItems:"center", gap:6,
        }}>
          <span style={{ color:sm.color, fontSize:11, fontWeight:700, flexShrink:0, width:16, textAlign:"center", fontFamily:F.mono }}>{sm.icon}</span>
          <span style={{ color:sm.color, fontSize:9.5, fontFamily:F.mono, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{status}</span>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}