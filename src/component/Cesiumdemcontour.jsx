/**
 * CesiumDEMContourPanel.jsx — Geoxis 3D Globe DEM + Contour Panel  v9
 *
 * KEY CHANGES vs v7:
 *  ✅ FIX-CORS:   Removed open-elevation.com + USGS EPQS (both fail CORS in browsers).
 *               Now uses ONLY AWS Terrain Tiles (Mapzen Terrarium) as the elevation source.
 *               These load via <img> tags — no CORS preflight, no 429, works everywhere.
 *  ✅ FIX-BATCH:  Parallel tile fetching with concurrency limit (8 at a time) for speed.
 *  ✅ COMPACT:    ~40% fewer lines — removed dead rate-limit UI, tier badges, 3-tier logic.
 *  ✅ All v7 rendering fixes retained (hillshade, contours, exports, KML clip).
 */

import { useState, useRef, useEffect, useCallback } from "react";

/* ── Color ramps ─────────────────────────────────────────────────────── */
export const COLOR_RAMPS = {
  "GeoXIS Terrain": [
    [0,[70,130,180]],[.06,[34,139,34]],[.18,[107,168,95]],[.32,[189,188,131]],
    [.46,[202,164,116]],[.60,[169,127,78]],[.72,[131,90,48]],[.84,[148,130,115]],
    [.92,[200,195,185]],[1,[255,255,255]],
  ],
  "GeoXIS Pro": [
    [0,[0,97,64]],[.08,[0,150,0]],[.16,[102,195,0]],[.28,[255,240,128]],
    [.40,[230,185,80]],[.52,[195,140,60]],[.64,[155,100,35]],[.75,[128,72,18]],
    [.84,[160,130,100]],[.92,[210,200,195]],[1,[255,255,255]],
  ],
  "Hypsometric Pro": [
    [0,[41,10,2]],[.08,[68,1,84]],[.16,[0,97,171]],[.25,[13,143,201]],
    [.38,[161,212,143]],[.50,[106,179,79]],[.62,[183,183,76]],[.72,[212,163,71]],
    [.82,[148,90,40]],[.91,[196,174,152]],[1,[255,255,255]],
  ],
  "Earth SRTM": [
    [0,[2,56,88]],[.10,[4,122,90]],[.22,[89,168,84]],[.38,[175,202,137]],
    [.50,[222,214,163]],[.65,[189,158,110]],[.78,[154,114,70]],[.88,[130,94,62]],
    [.95,[198,176,153]],[1,[240,238,235]],
  ],
  "Mine / Open Pit": [
    [0,[10,10,40]],[.10,[30,60,110]],[.20,[60,110,160]],[.32,[100,160,190]],
    [.44,[160,195,160]],[.56,[200,185,130]],[.66,[180,130,70]],[.76,[150,90,40]],
    [.86,[120,70,30]],[.93,[170,140,100]],[1,[220,200,170]],
  ],
  "Viridis": [
    [0,[68,1,84]],[.143,[72,40,120]],[.286,[62,84,139]],[.429,[49,124,137]],
    [.571,[38,162,116]],[.714,[88,196,87]],[.857,[155,217,60]],[1,[253,231,37]],
  ],
  "Magma": [
    [0,[0,0,4]],[.143,[28,16,68]],[.286,[79,18,123]],[.429,[129,37,129]],
    [.571,[181,54,122]],[.714,[229,80,99]],[.857,[251,135,97]],[1,[252,253,191]],
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
function elevToRGB(t, ramp) {
  const s = COLOR_RAMPS[ramp] || COLOR_RAMPS[DEFAULT_RAMP];
  t = Math.max(0, Math.min(1, t));
  let lo = 0;
  for (let i = 0; i < s.length - 1; i++) { lo = i; if (t <= s[i+1][0]) break; }
  const a = s[lo], b = s[Math.min(lo+1, s.length-1)];
  const span = b[0]-a[0], f = span < 1e-9 ? 0 : (t-a[0])/span;
  return [
    Math.round(a[1][0]+(b[1][0]-a[1][0])*f),
    Math.round(a[1][1]+(b[1][1]-a[1][1])*f),
    Math.round(a[1][2]+(b[1][2]-a[1][2])*f),
  ];
}

function bilinear(grid, rows, cols, rF, cF) {
  rF = Math.max(0, Math.min(rows-1, rF)); cF = Math.max(0, Math.min(cols-1, cF));
  const r0 = Math.min(rows-2, Math.floor(rF)), c0 = Math.min(cols-2, Math.floor(cF));
  const r1 = r0+1, c1 = c0+1, dr = rF-r0, dc = cF-c0;
  const v = [grid[r0][c0], grid[r0][c1], grid[r1][c0], grid[r1][c1]];
  if (v.some(isNaN)) return NaN;
  return (v[0]*(1-dc)+v[1]*dc)*(1-dr) + (v[2]*(1-dc)+v[3]*dc)*dr;
}

function computeHS(grid, rows, cols, r, c, cellM, az=315, alt=45) {
  const get = (rr,cc) => { const v=grid[Math.max(0,Math.min(rows-1,rr))][Math.max(0,Math.min(cols-1,cc))]; return isNaN(v)?0:v; };
  const [a,b,c2,d,e2,f2,g,h] = [get(r-1,c-1),get(r-1,c),get(r-1,c+1),get(r,c-1),get(r,c+1),get(r+1,c-1),get(r+1,c),get(r+1,c+1)];
  const cm = Math.max(cellM,1);
  const dzdx = ((c2+2*e2+h)-(a+2*d+f2))/(8*cm);
  const dzdy = ((f2+2*g+h)-(a+2*b+c2))/(8*cm);
  const az_r=(360-az+90)*Math.PI/180, alt_r=alt*Math.PI/180;
  const slope=Math.atan(Math.sqrt(dzdx*dzdx+dzdy*dzdy));
  let asp=Math.atan2(dzdy,-dzdx); if(asp<0) asp+=2*Math.PI;
  return Math.max(0, Math.cos(alt_r)*Math.cos(slope)+Math.sin(alt_r)*Math.sin(slope)*Math.cos(az_r-asp));
}

function computeMultiHS(grid, rows, cols, r, c, cellM) {
  const dirs=[{az:225,w:.167},{az:270,w:.239},{az:315,w:.294},{az:360,w:.2},{az:45,w:.1}];
  let hs=0, wt=0;
  for (const {az,w} of dirs) { hs+=w*computeHS(grid,rows,cols,r,c,cellM,az,45); wt+=w; }
  return Math.min(1, hs/wt);
}

function fillNaN(grid, rows, cols, frozenMask) {
  let changed=true, pass=0;
  while (changed && pass<200) {
    changed=false; pass++;
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
      if (!isNaN(grid[r][c])) continue;
      if (frozenMask?.[r][c]) continue;
      let wS=0, vS=0;
      for (let dr=-4;dr<=4;dr++) for (let dc=-4;dc<=4;dc++) {
        if (!dr&&!dc) continue;
        const nr=r+dr, nc=c+dc;
        if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
        const v=grid[nr][nc]; if (isNaN(v)) continue;
        const w=1/Math.sqrt(dr*dr+dc*dc); vS+=v*w; wS+=w;
      }
      if (wS>0) { grid[r][c]=vS/wS; changed=true; }
    }
  }
}

function isOk(v) { return v!=null && isFinite(v) && v>-500 && v<9000; }

/* ── Elevation cache ────────────────────────────────────────────────── */
const _elvCache = {};
const cacheKey = (bbox,res) =>
  `${bbox.minLat.toFixed(4)},${bbox.maxLat.toFixed(4)},${bbox.minLng.toFixed(4)},${bbox.maxLng.toFixed(4)},${res}`;

/* ── AWS Terrarium tile decoder ─────────────────────────────────────── */
// Zoom 14 = ~2.4m/px at equator (~3m in Kashmir). Dramatically better for mountains.
// Tile cache stores full 256×256 RGBA arrays; bilinear sub-pixel sampling within tile.
const TILE_Z = 14;
const TILE_N = Math.pow(2, TILE_Z);

function latLngToTileExact(lat, lng) {
  const latRad = lat * Math.PI / 180;
  const mercY = (1 - Math.log(Math.tan(latRad) + 1/Math.cos(latRad)) / Math.PI) / 2;
  const xExact = (lng + 180) / 360 * TILE_N;
  const yExact = mercY * TILE_N;
  const x = Math.floor(xExact), y = Math.floor(yExact);
  // Sub-pixel fractional position within tile (0–255.999)
  const px = (xExact - x) * 256;
  const py = (yExact - y) * 256;
  return { x, y, px, py };
}

const _tileCache = {};
function loadTilePixels(x, y) {
  const k = `${TILE_Z}/${x}/${y}`;
  if (_tileCache[k]) return _tileCache[k];
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 256;
        cv.getContext("2d").drawImage(img, 0, 0);
        resolve(cv.getContext("2d").getImageData(0, 0, 256, 256).data);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TILE_Z}/${x}/${y}.png`;
    setTimeout(() => resolve(null), 20000);
  });
  _tileCache[k] = p;
  return p;
}

// Read one pixel from tile data (clamped)
function tilePixelElev(data, px, py) {
  const x = Math.max(0, Math.min(255, Math.round(px)));
  const y = Math.max(0, Math.min(255, Math.round(py)));
  const i = (y * 256 + x) * 4;
  const e = (data[i]*256 + data[i+1] + data[i+2]/256) - 32768;
  return isOk(e) ? e : null;
}

async function fetchElevTile(lat, lng) {
  const { x, y, px, py } = latLngToTileExact(lat, lng);
  const data = await loadTilePixels(x, y);
  if (!data) return null;
  // Bilinear sub-pixel interpolation within tile for smoother values
  const x0=Math.floor(px), y0=Math.floor(py);
  const x1=Math.min(255,x0+1), y1=Math.min(255,y0+1);
  const dx=px-x0, dy=py-y0;
  const v00=tilePixelElev(data,x0,y0), v10=tilePixelElev(data,x1,y0);
  const v01=tilePixelElev(data,x0,y1), v11=tilePixelElev(data,x1,y1);
  if (v00==null&&v10==null&&v01==null&&v11==null) return null;
  const safe=(v,fb)=>v!=null?v:fb;
  const fb=v00??v10??v01??v11;
  return safe(v00,fb)*(1-dx)*(1-dy)+safe(v10,fb)*dx*(1-dy)+safe(v01,fb)*(1-dx)*dy+safe(v11,fb)*dx*dy;
}

async function fetchElevationGrid(bbox, rows, cols, onProgress, signal) {
  const pts = [];
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    const lat = rows>1 ? bbox.maxLat-(bbox.maxLat-bbox.minLat)*(r/(rows-1)) : (bbox.minLat+bbox.maxLat)/2;
    const lng = cols>1 ? bbox.minLng+(bbox.maxLng-bbox.minLng)*(c/(cols-1)) : (bbox.minLng+bbox.maxLng)/2;
    pts.push({ lat, lng, r, c });
  }

  const grid = Array.from({length:rows},()=>new Float32Array(cols).fill(NaN));
  const CONCURRENCY = 8;
  let done = 0;

  for (let i=0; i<pts.length; i+=CONCURRENCY) {
    if (signal?.aborted) break;
    const chunk = pts.slice(i, i+CONCURRENCY);
    const results = await Promise.all(chunk.map(p => fetchElevTile(p.lat, p.lng)));
    results.forEach((e, idx) => {
      const p = chunk[idx];
      if (isOk(e)) grid[p.r][p.c] = e;
    });
    done += chunk.length;
    onProgress?.(done, pts.length);
  }

  return grid;
}

/* ── Marching squares + stitch ──────────────────────────────────────── */
function marchingSquares(grid, rows, cols, levels) {
  const segs = {}; levels.forEach(lv => { segs[lv] = []; });
  for (let r=0;r<rows-1;r++) for (let c=0;c<cols-1;c++) {
    const v = [grid[r][c], grid[r][c+1], grid[r+1][c+1], grid[r+1][c]];
    if (v.some(isNaN)) continue;
    const lerp = (va,vb,lv) => va!==vb ? (lv-va)/(vb-va) : 0.5;
    levels.forEach(lv => {
      const idx = ((v[0]>=lv)?8:0)|((v[1]>=lv)?4:0)|((v[2]>=lv)?2:0)|((v[3]>=lv)?1:0);
      if (!idx||idx===15) return;
      const tT=lerp(v[0],v[1],lv), tR=lerp(v[1],v[2],lv), tB=lerp(v[3],v[2],lv), tL=lerp(v[0],v[3],lv);
      const top=[r,c+tT], right=[r+tR,c+1], bot=[r+1,c+tB], left=[r+tL,c];
      const lkp = {1:[[left,bot]],2:[[bot,right]],3:[[left,right]],4:[[top,right]],
        5:[[top,right],[left,bot]],6:[[top,bot]],7:[[top,left]],8:[[left,top]],
        9:[[top,bot]],10:[[left,top],[bot,right]],11:[[top,right]],12:[[left,right]],
        13:[[bot,right]],14:[[left,bot]]};
      (lkp[idx]||[]).forEach(s => segs[lv].push(s));
    });
  }
  return segs;
}

function stitchSegments(segs) {
  if (!segs.length) return [];
  const PREC=10000;
  const key=([r,c])=>`${Math.round(r*PREC)},${Math.round(c*PREC)}`;
  const epMap=new Map(), used=new Uint8Array(segs.length);
  segs.forEach(([a,b],i)=>{
    const ka=key(a), kb=key(b);
    if(!epMap.has(ka)) epMap.set(ka,[]);
    if(!epMap.has(kb)) epMap.set(kb,[]);
    epMap.get(ka).push({idx:i,ei:0});
    epMap.get(kb).push({idx:i,ei:1});
  });
  const chains=[];
  for (let i=0;i<segs.length;i++) {
    if (used[i]) continue;
    used[i]=1;
    let chain=[segs[i][0],segs[i][1]];
    for (;;) { const k=key(chain[chain.length-1]); let ext=false; for(const{idx,ei}of epMap.get(k)||[]){if(used[idx])continue;used[idx]=1;chain.push(ei===0?segs[idx][1]:segs[idx][0]);ext=true;break;} if(!ext)break; }
    for (;;) { const k=key(chain[0]); let ext=false; for(const{idx,ei}of epMap.get(k)||[]){if(used[idx])continue;used[idx]=1;chain.unshift(ei===0?segs[idx][1]:segs[idx][0]);ext=true;break;} if(!ext)break; }
    if (chain.length>=2) chains.push(chain);
  }
  return chains;
}

function gridToLatLng(rF, cF, bbox, rows, cols) {
  const lat = rows>1 ? bbox.maxLat-(bbox.maxLat-bbox.minLat)*(rF/(rows-1)) : (bbox.minLat+bbox.maxLat)/2;
  const lng = cols>1 ? bbox.minLng+(bbox.maxLng-bbox.minLng)*(cF/(cols-1)) : (bbox.minLng+bbox.maxLng)/2;
  return [lat, lng];
}

function interpBoundary(lat0,lng0,lat1,lng1,poly) {
  let lo=0, hi=1;
  for(let i=0;i<16;i++){const m=(lo+hi)/2;if(pointInPolygon(lat0+(lat1-lat0)*m,lng0+(lng1-lng0)*m,poly))lo=m;else hi=m;}
  const t=(lo+hi)/2; return [lat0+(lat1-lat0)*t, lng0+(lng1-lng0)*t];
}

function clipChain(latlngs, poly) {
  if (!poly||poly.length<3) return [latlngs];
  const subs=[]; let cur=[];
  for (let i=0;i<latlngs.length;i++) {
    const [lat,lng]=latlngs[i], inside=pointInPolygon(lat,lng,poly);
    if(inside){
      if(cur.length===0&&i>0){const e=interpBoundary(...latlngs[i-1],lat,lng,poly);if(e)cur.push(e);}
      cur.push([lat,lng]);
    } else {
      if(cur.length>0){const e=interpBoundary(...latlngs[i-1],lat,lng,poly);if(e)cur.push(e);if(cur.length>=2)subs.push(cur);cur=[];}
    }
  }
  if(cur.length>=2) subs.push(cur);
  return subs;
}

/* ── Download helper ────────────────────────────────────────────────── */
function dlBlob(data, name, mime) {
  const url = URL.createObjectURL(new Blob([data],{type:mime}));
  const a = document.createElement("a"); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
}

/* ── GeoTIFF builder ────────────────────────────────────────────────── */
function buildGeoTIFF({grid,rows,cols,bbox}) {
  const W=cols, H=rows;
  const pixW=cols>1?(bbox.maxLng-bbox.minLng)/(cols-1):0.001;
  const pixH=rows>1?(bbox.maxLat-bbox.minLat)/(rows-1):0.001;
  const raster=new Float32Array(W*H);
  for(let r=0;r<H;r++) for(let c=0;c<W;c++) raster[r*W+c]=isNaN(grid[r][c])?-9999:grid[r][c];
  const tp=new Float64Array([0,0,0,bbox.minLng,bbox.maxLat,0]);
  const ps=new Float64Array([pixW,pixH,0]);
  const gk=new Uint16Array([1,1,0,4,1024,0,1,2,1025,0,1,1,2048,0,1,4326,2049,34737,7,0]);
  const cit=new TextEncoder().encode("WGS 84\0"), nd=new TextEncoder().encode("-9999\0");
  const NT=17, ifdOff=8, ifdSz=2+NT*12+4;
  const tpOff=ifdOff+ifdSz, psOff=tpOff+tp.byteLength, gkOff=psOff+ps.byteLength;
  const citOff=gkOff+gk.byteLength, ndOff=citOff+cit.byteLength;
  const rasOff=Math.ceil((ndOff+nd.byteLength)/4)*4, total=rasOff+raster.byteLength;
  const buf=new ArrayBuffer(total), dv=new DataView(buf), u8=new Uint8Array(buf);
  let p=0; u8[p++]=0x49; u8[p++]=0x49; dv.setUint16(p,42,true); p+=2; dv.setUint32(p,ifdOff,true); p+=4;
  dv.setUint16(p,NT,true); p+=2;
  const tag=(id,type,count,val)=>{dv.setUint16(p,id,true);p+=2;dv.setUint16(p,type,true);p+=2;dv.setUint32(p,count,true);p+=4;if(type===3&&count<=2){dv.setUint16(p,val,true);p+=2;dv.setUint16(p,0,true);p+=2;}else{dv.setUint32(p,val,true);p+=4;}};
  tag(256,4,1,W);tag(257,4,1,H);tag(258,3,1,32);tag(259,3,1,1);
  tag(262,3,1,1);tag(273,4,1,rasOff);tag(277,3,1,1);tag(278,4,1,H);
  tag(279,4,1,W*H*4);tag(284,3,1,1);tag(339,3,1,3);
  tag(33550,12,3,psOff);tag(33922,12,6,tpOff);
  tag(34735,3,gk.length,gkOff);tag(34736,12,0,0);
  tag(34737,2,cit.length,citOff);tag(42113,2,nd.length,ndOff);
  dv.setUint32(p,0,true); p+=4;
  new Uint8Array(buf,tpOff).set(new Uint8Array(tp.buffer));
  new Uint8Array(buf,psOff).set(new Uint8Array(ps.buffer));
  new Uint8Array(buf,gkOff).set(new Uint8Array(gk.buffer));
  new Uint8Array(buf,citOff).set(cit); new Uint8Array(buf,ndOff).set(nd);
  new Uint8Array(buf,rasOff).set(new Uint8Array(raster.buffer));
  return buf;
}

/* ── GeoJSON contours ────────────────────────────────────────────────── */
function buildContourGeoJSON({grid,rows,cols,bbox,min:minE,max:maxE}, interval, majorEvery, poly=null) {
  const levels=[]; for(let lv=Math.ceil(minE/interval)*interval;lv<=maxE+1e-6;lv+=interval) levels.push(parseFloat(lv.toFixed(6)));
  const rawSegs=marchingSquares(grid,rows,cols,levels), features=[], hasClip=poly&&poly.length>=3;
  levels.forEach(lv=>{
    stitchSegments(rawSegs[lv]||[]).forEach(chain=>{
      if(chain.length<2) return;
      const latlngs=chain.map(([rF,cF])=>gridToLatLng(rF,cF,bbox,rows,cols));
      (hasClip?clipChain(latlngs,poly):[latlngs]).forEach(sub=>{
        if(sub.length<2) return;
        features.push({type:"Feature",geometry:{type:"LineString",coordinates:sub.map(([lat,lng])=>[lng,lat,lv])},
          properties:{elevation_m:lv,elevation_ft:Math.round(lv*3.28084),
            contourType:Math.round(lv)%majorEvery===0?"major":"minor",interval_m:interval}});
      });
    });
  });
  return {type:"FeatureCollection",features};
}

/* ── Shapefile builder (compact) ─────────────────────────────────────── */
const CRC32T=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c;}return t;})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC32T[(c^u8[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function concat(...a){const t=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let p=0;for(const x of a){t.set(x,p);p+=x.length;}return t;}

function buildSHPLines(features) {
  let xMin=Infinity,yMin=Infinity,xMax=-Infinity,yMax=-Infinity;
  const recs=features.map(f=>{
    const coords=f.geometry?.coordinates||[];
    coords.forEach(([x,y])=>{if(x<xMin)xMin=x;if(x>xMax)xMax=x;if(y<yMin)yMin=y;if(y>yMax)yMax=y;});
    const n=coords.length, ab=new ArrayBuffer(4+32+4+4+4+n*16), dv=new DataView(ab);
    let rxMin=Infinity,ryMin=Infinity,rxMax=-Infinity,ryMax=-Infinity;
    coords.forEach(([x,y])=>{if(x<rxMin)rxMin=x;if(x>rxMax)rxMax=x;if(y<ryMin)ryMin=y;if(y>ryMax)ryMax=y;});
    dv.setInt32(0,3,true);dv.setFloat64(4,rxMin,true);dv.setFloat64(12,ryMin,true);
    dv.setFloat64(20,rxMax,true);dv.setFloat64(28,ryMax,true);
    dv.setInt32(36,1,true);dv.setInt32(40,n,true);dv.setInt32(44,0,true);
    let pt=48; coords.forEach(([x,y])=>{dv.setFloat64(pt,x,true);dv.setFloat64(pt+8,y,true);pt+=16;});
    return new Uint8Array(ab);
  });
  if(!isFinite(xMin)){xMin=yMin=xMax=yMax=0;}
  const bodyLen=recs.reduce((s,r)=>s+8+r.length,0);
  const shpL=100+bodyLen, shpAB=new ArrayBuffer(shpL), shpDV=new DataView(shpAB), shpU8=new Uint8Array(shpAB);
  const shxL=100+recs.length*8, shxAB=new ArrayBuffer(shxL), shxDV=new DataView(shxAB);
  const wHdr=(dv,fl)=>{dv.setInt32(0,9994,false);dv.setInt32(24,fl/2,false);dv.setInt32(28,1000,true);dv.setInt32(32,3,true);dv.setFloat64(36,xMin,true);dv.setFloat64(44,yMin,true);dv.setFloat64(52,xMax,true);dv.setFloat64(60,yMax,true);};
  wHdr(shpDV,shpL);wHdr(shxDV,shxL);
  let pos=100; recs.forEach((rec,ri)=>{const cw=rec.length/2;shpDV.setInt32(pos,ri+1,false);shpDV.setInt32(pos+4,cw,false);shpU8.set(rec,pos+8);shxDV.setInt32(100+ri*8,pos/2,false);shxDV.setInt32(100+ri*8+4,cw,false);pos+=8+rec.length;});
  return {shp:new Uint8Array(shpAB),shx:new Uint8Array(shxAB)};
}

function buildDBF(features) {
  const FIELDS=[{name:"elev_m",type:"N",len:10,dec:2},{name:"type",type:"C",len:8,dec:0},{name:"interval",type:"N",len:8,dec:1}];
  const enc=new TextEncoder(),hSz=32+FIELDS.length*32+1,recSz=1+FIELDS.reduce((s,f)=>s+f.len,0);
  const buf=new Uint8Array(hSz+features.length*recSz+1), dv=new DataView(buf.buffer);
  buf[0]=3; const now=new Date(); buf[1]=now.getFullYear()-1900;buf[2]=now.getMonth()+1;buf[3]=now.getDate();
  dv.setUint32(4,features.length,true);dv.setUint16(8,hSz,true);dv.setUint16(10,recSz,true);
  FIELDS.forEach((f,fi)=>{const off=32+fi*32,nb=enc.encode(f.name.slice(0,10));nb.forEach((b,i)=>{buf[off+i]=b;});buf[off+11]=f.type.charCodeAt(0);buf[off+16]=f.len;buf[off+17]=f.dec;});
  buf[32+FIELDS.length*32]=0x0D;
  features.forEach((feat,ri)=>{
    const p2=feat.properties||{},off=hSz+ri*recSz; buf[off]=0x20; let col=1;
    const vals=[p2.elevation_m??0,p2.contourType??"minor",p2.interval_m??0];
    FIELDS.forEach((f,fi)=>{
      let str=String(vals[fi]??"").slice(0,f.len);
      if(f.type==="N"){const n=parseFloat(str);str=isNaN(n)?"0".padStart(f.len):n.toFixed(f.dec).padStart(f.len);}else str=str.padEnd(f.len);
      const bytes=enc.encode(str.slice(0,f.len));for(let i=0;i<f.len;i++)buf[off+col+i]=bytes[i]??0x20;col+=f.len;
    });
  });
  buf[hSz+features.length*recSz]=0x1A; return buf;
}

function buildZip(files) {
  const enc=new TextEncoder(), parts=[], central=[]; let off=0;
  for(const{name,data}of files){
    const nb=enc.encode(name), u8=data instanceof Uint8Array?data:new Uint8Array(data);
    const cr=crc32(u8),sz=u8.length;
    const lh=new ArrayBuffer(30+nb.length), lhDV=new DataView(lh), lhU=new Uint8Array(lh);
    lhDV.setUint32(0,0x04034B50,true);lhDV.setUint16(4,20,true);lhDV.setUint32(14,cr,true);lhDV.setUint32(18,sz,true);lhDV.setUint32(22,sz,true);lhDV.setUint16(26,nb.length,true);lhU.set(nb,30);
    const cd=new ArrayBuffer(46+nb.length), cdDV=new DataView(cd), cdU=new Uint8Array(cd);
    cdDV.setUint32(0,0x02014B50,true);cdDV.setUint16(4,20,true);cdDV.setUint16(6,20,true);cdDV.setUint32(16,cr,true);cdDV.setUint32(20,sz,true);cdDV.setUint32(24,sz,true);cdDV.setUint16(28,nb.length,true);cdDV.setUint32(42,off,true);cdU.set(nb,46);
    parts.push(lhU,u8); central.push(cdU); off+=30+nb.length+sz;
  }
  const cdD2=concat(...central), eo=new ArrayBuffer(22), eoDV=new DataView(eo);
  eoDV.setUint32(0,0x06054B50,true);eoDV.setUint16(8,files.length,true);eoDV.setUint16(10,files.length,true);eoDV.setUint32(12,cdD2.length,true);eoDV.setUint32(16,off,true);
  return concat(...parts,cdD2,new Uint8Array(eo));
}

const WGS84_PRJ = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;

/* ── DEM render ──────────────────────────────────────────────────────── */
async function renderDEM(Cesium, viewer, elevGrid, opts, poly=null, layerRef=null) {
  const {colorRamp=DEFAULT_RAMP, opacity=0.85, hillshadeStrength=0.55, hillshadeMode="multi"} = opts;
  if (layerRef?.current) { try{viewer.imageryLayers.remove(layerRef.current,true);}catch(_){} layerRef.current=null; }

  const {grid,rows,cols,bbox,min:minE,max:maxE} = elevGrid;
  const range=maxE-minE;
  const OS=6, W=Math.min((cols-1)*OS+1,2048)|0, H=Math.min((rows-1)*OS+1,2048)|0;
  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const ctx=cv.getContext("2d"), img=ctx.createImageData(W,H), px=img.data;

  const latSpan=bbox.maxLat-bbox.minLat, lngSpan=bbox.maxLng-bbox.minLng;
  const midLat=(bbox.minLat+bbox.maxLat)/2;
  const cellM=Math.max(1,((rows>1?latSpan/(rows-1)*111320:100)+(cols>1?lngSpan/(cols-1)*111320*Math.cos(midLat*Math.PI/180):100))/2);

  const hsGrid = hillshadeStrength>0 && hillshadeMode!=="off"
    ? Array.from({length:rows},(_,r)=>Float32Array.from({length:cols},(_2,c)=>
        hillshadeMode==="multi"?computeMultiHS(grid,rows,cols,r,c,cellM):computeHS(grid,rows,cols,r,c,cellM)))
    : null;

  const hasClip=poly&&poly.length>=3;

  // Anti-aliased polygon clip: feather zone = 2 canvas pixels wide
  // Instead of hard binary inside/outside, we sample neighbours and blend alpha.
  const featherLat = H>1 ? (bbox.maxLat-bbox.minLat)/(H-1)*2 : 0;
  const featherLng = W>1 ? (bbox.maxLng-bbox.minLng)/(W-1)*2 : 0;

  function edgeAlpha(lat, lng) {
    if (!hasClip) return 1;
    const inside = pointInPolygon(lat, lng, poly);
    // Quick interior check — if all 4 cardinal neighbours also inside, full opacity
    if (inside) {
      if (
        pointInPolygon(lat+featherLat, lng, poly) &&
        pointInPolygon(lat-featherLat, lng, poly) &&
        pointInPolygon(lat, lng+featherLng, poly) &&
        pointInPolygon(lat, lng-featherLng, poly)
      ) return 1;
      // On the inner edge — sample 8 neighbours
      const nb = [
        [lat+featherLat,lng],[lat-featherLat,lng],
        [lat,lng+featherLng],[lat,lng-featherLng],
        [lat+featherLat,lng+featherLng],[lat+featherLat,lng-featherLng],
        [lat-featherLat,lng+featherLng],[lat-featherLat,lng-featherLng],
      ];
      const cnt = nb.filter(([la,ln])=>pointInPolygon(la,ln,poly)).length;
      return 0.5 + 0.5*(cnt/8);
    }
    // Outside — check cardinal neighbours for feather bleed
    const nb4 = [
      [lat+featherLat,lng],[lat-featherLat,lng],
      [lat,lng+featherLng],[lat,lng-featherLng],
    ];
    const cnt = nb4.filter(([la,ln])=>pointInPolygon(la,ln,poly)).length;
    if (cnt===0) return 0;
    return 0.3*(cnt/4);
  }

  for (let py=0;py<H;py++) for (let qx=0;qx<W;qx++) {
    const i4=(py*W+qx)*4;
    const rF=H>1?py*(rows-1)/(H-1):0, cF=W>1?qx*(cols-1)/(W-1):0;
    const [lat,lng]=gridToLatLng(rF,cF,bbox,rows,cols);
    const ea = edgeAlpha(lat,lng);
    if(ea<=0){px[i4+3]=0;continue;}
   // Sample slightly inset into padded grid
const elev = bilinear(
  grid,
  rows,
  cols,
  rF + 1,
  cF + 1
);
 if(isNaN(elev)){px[i4+3]=0;continue;}
    const t=range>0.5?Math.max(0,Math.min(1,(elev-minE)/range)):0.5;
    let [r,g,b]=elevToRGB(t,colorRamp);
    if(hsGrid){
      const ri=Math.max(0,Math.min(rows-1,Math.round(rF))), ci=Math.max(0,Math.min(cols-1,Math.round(cF)));
      const hs=hsGrid[ri][ci], str=Math.min(hillshadeStrength,0.85), amb=1-str*0.25;
      const sv=Math.max(0.05,Math.min(1.3,amb+str*hs));
      r=Math.max(0,Math.min(255,Math.round(r*sv)));g=Math.max(0,Math.min(255,Math.round(g*sv)));b=Math.max(0,Math.min(255,Math.round(b*sv)));
    }
    px[i4]=r; px[i4+1]=g; px[i4+2]=b; px[i4+3]=Math.round(opacity*ea*255);
  }
  ctx.putImageData(img,0,0);

  const imageUrl = await new Promise(res=>{
    try{cv.toBlob(blob=>blob?res(URL.createObjectURL(blob)):res(cv.toDataURL()),"image/png");}catch{res(cv.toDataURL());}
  });

  const rect=new Cesium.Rectangle(
    Cesium.Math.toRadians(bbox.minLng),Cesium.Math.toRadians(bbox.minLat),
    Cesium.Math.toRadians(bbox.maxLng),Cesium.Math.toRadians(bbox.maxLat));

  let provider;
  try{provider=new Cesium.SingleTileImageryProvider({url:imageUrl,rectangle:rect,tileWidth:W,tileHeight:H});}
  catch(_){try{provider=new Cesium.SingleTileImageryProvider(imageUrl,rect);}catch(e){console.error(e);return null;}}

  const layer=viewer.imageryLayers.addImageryProvider(provider);
  layer.alpha=opacity;
  try{let idx=viewer.imageryLayers.indexOf?.(layer)??viewer.imageryLayers.length-1;for(let i=idx;i>1;i--)viewer.imageryLayers.lower(layer);}catch(_){}
  if(layerRef) layerRef.current=layer;
  return layer;
}

/* ── Contour render ──────────────────────────────────────────────────── */
function renderContours(Cesium, viewer, elevGrid, opts, poly=null) {
  const {interval=10,majorEvery=50,minorColor="#966F33",majorColor="#6B3D00",opacity=0.88} = opts;
  const {grid,rows,cols,bbox,min:minE,max:maxE} = elevGrid;
  const levels=[];
  for(let lv=Math.ceil(minE/interval)*interval;lv<=maxE+1e-6;lv+=interval) levels.push(parseFloat(lv.toFixed(6)));
  if(!levels.length) return {primitives:[],entities:[],count:0};

  const rawSegs=marchingSquares(grid,rows,cols,levels);
  const prims=[], ents=[], hasClip=poly&&poly.length>=3;

  levels.forEach(lv=>{
    const roundedLv=Math.round(lv), isMajor=roundedLv%majorEvery<0.01||Math.abs(roundedLv%majorEvery-majorEvery)<0.01;
    stitchSegments(rawSegs[lv]||[]).forEach(chain=>{
      if(chain.length<2) return;
      const latlngs=chain.map(([rF,cF])=>gridToLatLng(rF,cF,bbox,rows,cols));
      (hasClip?clipChain(latlngs,poly):[latlngs]).forEach(sub=>{
        if(sub.length<2) return;
        const positions=sub.map(([lat,lng])=>Cesium.Cartographic.toCartesian(Cesium.Cartographic.fromDegrees(lng,lat)));
        try{
          const pl=new Cesium.GroundPolylinePrimitive({
            geometryInstances:new Cesium.GeometryInstance({
              geometry:new Cesium.GroundPolylineGeometry({positions,width:isMajor?2.5:1.0}),
              attributes:{color:Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString(isMajor?majorColor:minorColor).withAlpha(isMajor?opacity:opacity*0.75))},
            }),
            appearance:new Cesium.PolylineColorAppearance(),
            classificationType:Cesium.ClassificationType.TERRAIN, asynchronous:false,
          });
          viewer.scene.primitives.add(pl); prims.push(pl);
        } catch {
          const ent=viewer.entities.add({polyline:{positions:sub.map(([lat,lng])=>Cesium.Cartesian3.fromDegrees(lng,lat)),
            width:isMajor?2.5:1.0,material:Cesium.Color.fromCssColorString(isMajor?majorColor:minorColor).withAlpha(isMajor?opacity:opacity*0.75),
            clampToGround:true}});
          ents.push(ent);
        }
        if(isMajor&&sub.length>=10){
          const[lat,lng]=sub[Math.floor(sub.length/2)];
          if(!hasClip||pointInPolygon(lat,lng,poly)){
            const le=viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lng,lat),label:{
              text:String(Math.round(lv))+"m",font:"bold 11px monospace",
              fillColor:Cesium.Color.fromCssColorString(majorColor),outlineColor:Cesium.Color.WHITE,outlineWidth:3,
              style:Cesium.LabelStyle.FILL_AND_OUTLINE,disableDepthTestDistance:Number.POSITIVE_INFINITY,
              heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,showBackground:true,
              backgroundColor:new Cesium.Color(1,1,1,0.92),backgroundPadding:new Cesium.Cartesian2(4,2),scale:0.85,
            }});
            ents.push(le);
          }
        }
      });
    });
  });
  return {primitives:prims,entities:ents,count:prims.length+ents.filter(e=>e.polyline).length};
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════ */
export default function CesiumDEMContourPanel({viewer,Cesium,bbox,kmlPolygon=null,visible,onClose,kmlName="area"}) {
  const [tab, setTab] = useState("dem");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("info");
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elevGrid, setElevGrid] = useState(null);

  const [colorRamp, setColorRamp] = useState(DEFAULT_RAMP);
  const [demOpacity, setDemOpacity] = useState(0.85);
  const [hillshadeStrength, setHillshadeStrength] = useState(0.55);
  const [hillshadeMode, setHillshadeMode] = useState("multi");
  const [gridRes, setGridRes] = useState(20);
  const [hasDEM, setHasDEM] = useState(false);
  const [demVisible, setDemVisible] = useState(true);

  const [contourInterval, setContourInterval] = useState(10);
  const [majorEvery, setMajorEvery] = useState(50);
  const [minorColor, setMinorColor] = useState("#966F33");
  const [majorColor, setMajorColor] = useState("#6B3D00");
  const [hasContour, setHasContour] = useState(false);
  const [contourVisible, setContourVisible] = useState(true);
  const [contourCount, setContourCount] = useState(0);

  const abortRef     = useRef(null);
  const demLayerRef  = useRef(null);
  const contourRef   = useRef({primitives:[],entities:[]});
  const elevGridRef  = useRef(null);
  const optsRef      = useRef({colorRamp,demOpacity,hillshadeStrength,hillshadeMode});
  const debounceRef  = useRef(null);
  const polyRef      = useRef(kmlPolygon);

  useEffect(()=>{polyRef.current=kmlPolygon;},[kmlPolygon]);
  useEffect(()=>{optsRef.current={colorRamp,demOpacity,hillshadeStrength,hillshadeMode};},[colorRamp,demOpacity,hillshadeStrength,hillshadeMode]);

  useEffect(()=>()=>{
    clearTimeout(debounceRef.current); abortRef.current?.abort();
    clearDEMLayer(); clearContourLayers();
  },[]);

  // Auto re-render DEM when visual opts change
  useEffect(()=>{
    if(!hasDEM||!elevGridRef.current||!viewer||!Cesium) return;
    clearTimeout(debounceRef.current);
    debounceRef.current=setTimeout(async()=>{
      clearDEMLayer();
      const o=optsRef.current;
      const layer=await renderDEM(Cesium,viewer,elevGridRef.current,
        {colorRamp:o.colorRamp,opacity:o.demOpacity,hillshadeStrength:o.hillshadeStrength,hillshadeMode:o.hillshadeMode},
        polyRef.current,demLayerRef);
      if(layer){demLayerRef.current=layer;setDemVisible(true);}
    },600);
    return ()=>clearTimeout(debounceRef.current);
  },[colorRamp,demOpacity,hillshadeStrength,hillshadeMode]);// eslint-disable-line

  function clearDEMLayer(){if(demLayerRef.current){try{viewer?.imageryLayers?.remove(demLayerRef.current,true);}catch(_){}demLayerRef.current=null;}}
  function clearContourLayers(){contourRef.current.primitives.forEach(p=>{try{viewer?.scene?.primitives?.remove(p);}catch(_){}});contourRef.current.entities.forEach(e=>{try{viewer?.entities?.remove(e);}catch(_){}});contourRef.current={primitives:[],entities:[]};}
  const msg=(m,t="info")=>{setStatus(m);setStatusType(t);};

  /* ── Fetch elevation ── */
  const fetchElev = useCallback(async()=>{
    if(!bbox){msg("No bounding area defined.","warn");return;}
    const key=cacheKey(bbox,gridRes);
    if(_elvCache[key]){
      const eg=_elvCache[key]; setElevGrid(eg); elevGridRef.current=eg;
      autoInterval(eg.max-eg.min);
      msg(`Cache hit · ${Math.round(eg.min)}m → ${Math.round(eg.max)}m`,"ok"); return;
    }
    abortRef.current=new AbortController();
    setIsProcessing(true); setProgress(5);
    msg("Sampling AWS Terrain Tiles (Mapzen Terrarium, ~10m)…","info");
    try{
      const rows=gridRes, cols=gridRes;
      const grid=await fetchElevationGrid(bbox,rows,cols,(done,total)=>{
        setProgress(5+Math.round(done/total*82));
        msg(`Fetching elevation tiles… ${done}/${total} pts (${Math.round(done/total*100)}%)`, "info");
      },abortRef.current.signal);

      if(abortRef.current.signal.aborted){msg("Cancelled.","warn");setIsProcessing(false);setProgress(0);return;}

      // KML clip
      // IMPORTANT FIX:
// NEVER clip DEM data before interpolation.
// Keep the grid fully populated so interpolation reaches
// all boundary cells correctly.

msg("Interpolating full DEM grid…","info");
setProgress(90);

// Fill ALL NaNs without frozen boundaries
fillNaN(grid, rows, cols, null);

// Edge padding fix to prevent Cesium/canvas bilinear shrink
const padded = Array.from(
  { length: rows + 2 },
  () => new Float32Array(cols + 2)
);

for (let r = 0; r < rows + 2; r++) {
  for (let c = 0; c < cols + 2; c++) {

    const rr = Math.max(0, Math.min(rows - 1, r - 1));
    const cc = Math.max(0, Math.min(cols - 1, c - 1));

    padded[r][c] = grid[rr][cc];
  }
}

// Replace original grid with padded grid
grid.length = 0;
for (let r = 0; r < rows + 2; r++) {
  grid.push(padded[r]);
}

// Update dimensions
const paddedRows = rows + 2;
const paddedCols = cols + 2;
      let minE=Infinity, maxE=-Infinity;
      for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){const v=grid[r][c];if(!isNaN(v)){if(v<minE)minE=v;if(v>maxE)maxE=v;}}
      if(!isFinite(minE)){msg("No valid elevation data received.","err");setIsProcessing(false);setProgress(0);return;}

    const eg={
  grid,
  rows: paddedRows,
  cols: paddedCols,
  bbox,
  min: minE,
  max: maxE
};
      _elvCache[key]=eg; setElevGrid(eg); elevGridRef.current=eg; autoInterval(maxE-minE);
      setProgress(100);
     const hasPoly = polyRef.current && polyRef.current.length >= 3;

msg(
  `Done · ${rows*cols} pts · ${Math.round(minE)}m → ${Math.round(maxE)}m · Δ${Math.round(maxE-minE)}m` +
  (hasPoly ? " · KML clipped" : ""),
  "ok"
);
    }catch(e){
      if(e.name!=="AbortError"){msg("Error: "+e.message,"err");console.error(e);}
    }finally{setIsProcessing(false);setTimeout(()=>setProgress(0),1200);}
  },[bbox,gridRes]);

  function autoInterval(range){
    if(range<20)setContourInterval(1);
    else if(range<50)setContourInterval(5);
    else if(range<150)setContourInterval(10);
    else if(range<400)setContourInterval(20);
    else setContourInterval(50);
  }

  const doRenderDEM = useCallback(async()=>{
    const eg=elevGridRef.current||elevGrid;
    if(!eg||!viewer||!Cesium){msg("Fetch elevation first.","warn");return;}
    msg("Rendering DEM…","info"); clearDEMLayer();
    const layer=await renderDEM(Cesium,viewer,eg,{colorRamp,opacity:demOpacity,hillshadeStrength,hillshadeMode},polyRef.current,demLayerRef);
    if(!layer){msg("DEM render failed.","err");return;}
    demLayerRef.current=layer; setHasDEM(true); setDemVisible(true);
    msg(`DEM rendered · ${colorRamp} · ${hillshadeMode==="off"?"flat":hillshadeMode==="multi"?"multi-dir HS":"single HS"}`,"ok");
  },[elevGrid,viewer,Cesium,colorRamp,demOpacity,hillshadeStrength,hillshadeMode]);// eslint-disable-line

  const doRenderContours = useCallback(()=>{
    const eg=elevGridRef.current||elevGrid;
    if(!eg||!viewer||!Cesium){msg("Fetch elevation first.","warn");return;}
    msg("Generating contours…","info"); clearContourLayers();
    const result=renderContours(Cesium,viewer,eg,{interval:contourInterval,majorEvery,minorColor,majorColor,opacity:0.88},polyRef.current);
    contourRef.current=result; setHasContour(true); setContourVisible(true); setContourCount(result.count);
    msg(result.count>0?`${result.count} lines · ${contourInterval}m interval`:"0 contours — try smaller interval.",result.count>0?"ok":"warn");
  },[elevGrid,viewer,Cesium,contourInterval,majorEvery,minorColor,majorColor]);// eslint-disable-line

  function toggleDEM(){if(!demLayerRef.current)return;demLayerRef.current.show=!demLayerRef.current.show;setDemVisible(demLayerRef.current.show);}
  function toggleContours(){const show=!contourVisible;contourRef.current.primitives.forEach(p=>{try{p.show=show;}catch(_){}});contourRef.current.entities.forEach(e=>{if(e.polyline)e.polyline.show=show;if(e.label)e.show=show;});setContourVisible(show);}

  /* ── Exports ── */
  function exportTIFF(){const eg=elevGridRef.current||elevGrid;if(!eg){msg("No data.","warn");return;}try{dlBlob(buildGeoTIFF(eg),kmlName.replace(/\.[^.]+$/,"")+"_dem.tif","image/tiff");msg("GeoTIFF exported.","ok");}catch(e){msg("Export error: "+e.message,"err");}}
  function exportCSV(){const eg=elevGridRef.current||elevGrid;if(!eg){msg("No data.","warn");return;}const{grid,rows,cols,bbox}=eg;const lines=["lat,lng,elevation_m,elevation_ft"];for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const[lat,lng]=gridToLatLng(r,c,bbox,rows,cols);const e=grid[r][c];lines.push(`${lat.toFixed(7)},${lng.toFixed(7)},${isNaN(e)?"":e.toFixed(2)},${isNaN(e)?"":(e*3.28084).toFixed(2)}`);}dlBlob(new TextEncoder().encode(lines.join("\n")),kmlName.replace(/\.[^.]+$/,"")+"_dem.csv","text/csv");msg("CSV exported.","ok");}
  function exportGeoJSON(){const eg=elevGridRef.current||elevGrid;if(!eg){msg("No data.","warn");return;}const gj=buildContourGeoJSON(eg,contourInterval,majorEvery,polyRef.current);dlBlob(new TextEncoder().encode(JSON.stringify(gj,null,2)),kmlName.replace(/\.[^.]+$/,"")+"_contours.geojson","application/json");msg("GeoJSON exported.","ok");}
  function exportSHP(){const eg=elevGridRef.current||elevGrid;if(!eg){msg("No data.","warn");return;}try{const gj=buildContourGeoJSON(eg,contourInterval,majorEvery,polyRef.current);const{shp,shx}=buildSHPLines(gj.features);const dbf=buildDBF(gj.features);const prj=new TextEncoder().encode(WGS84_PRJ);const base=(kmlName.replace(/\.[^.]+$/,"")+"_contours_"+contourInterval+"m").replace(/[^a-zA-Z0-9_]/g,"_");dlBlob(buildZip([{name:base+".shp",data:shp},{name:base+".shx",data:shx},{name:base+".dbf",data:dbf},{name:base+".prj",data:prj}]).buffer,base+"_shapefile.zip","application/zip");msg("Shapefile ZIP exported.","ok");}catch(e){msg("Export error: "+e.message,"err");}}

  if (!visible) return null;

  /* ── Styles ── */
  const F={ui:"'DM Sans',system-ui,sans-serif",mono:"'JetBrains Mono','Courier New',monospace"};
  const C={bg:"rgba(6,10,22,0.97)",sur:"rgba(255,255,255,0.04)",bor:"rgba(255,255,255,0.08)",
    tx:"#c8dff8",dim:"rgba(165,200,240,0.55)",
    blue:"#3b82f6",cyan:"#22d3c8",green:"#4ade80",amber:"#f5a623",red:"#f06060",violet:"#b89cf8",pink:"#f472b6"};
  const INTERVALS=[1,2,5,10,20,25,50,100], MAJORS=[5,10,25,50,100,200];
  const sm={ok:{color:C.green,icon:"✓"},err:{color:C.red,icon:"✕"},warn:{color:C.amber,icon:"⚠"},info:{color:C.blue,icon:"›"}}[statusType]||{color:C.blue,icon:"›"};
  const rampCSS=n=>(COLOR_RAMPS[n]||COLOR_RAMPS[DEFAULT_RAMP]).map(([t,[r,g,b]])=>`rgb(${r},${g},${b}) ${Math.round(t*100)}%`).join(",");
  const Btn=({color=C.blue,children,onClick,disabled,fullWidth=true})=>(
    <button onClick={onClick} disabled={disabled} style={{width:fullWidth?"100%":"auto",padding:"9px 14px",borderRadius:8,cursor:disabled?"not-allowed":"pointer",background:`${color}18`,border:`1px solid ${color}38`,color,fontSize:11.5,fontWeight:700,fontFamily:F.ui,display:"flex",alignItems:"center",justifyContent:"center",gap:6,opacity:disabled?0.35:1,transition:"all .12s"}}>{children}</button>
  );

  return (
    <div style={{position:"fixed",top:0,right:0,bottom:0,width:310,zIndex:5000,background:C.bg,backdropFilter:"blur(36px)",borderLeft:`1px solid ${C.bor}`,display:"flex",flexDirection:"column",fontFamily:F.ui,boxShadow:"-12px 0 48px rgba(0,0,0,.9)"}}>

      {/* Header */}
      <div style={{padding:"12px 14px 10px",borderBottom:`1px solid ${C.bor}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <div style={{width:34,height:34,borderRadius:9,background:"linear-gradient(135deg,rgba(59,130,246,.25),rgba(34,211,200,.25))",border:"1px solid rgba(59,130,246,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>🏔</div>
          <div style={{flex:1}}>
            <div style={{color:C.tx,fontWeight:700,fontSize:13}}>3D DEM & Contours</div>
            <div style={{color:C.dim,fontSize:9,fontFamily:F.mono,marginTop:1}}>AWS Terrarium zoom-14 · ~3m · anti-alias clip · Cesium 3D</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:20,padding:0,lineHeight:1}}>×</button>
        </div>
        {kmlPolygon?.length>=3&&<div style={{background:"rgba(74,222,128,.07)",border:"1px solid rgba(74,222,128,.25)",borderRadius:7,padding:"4px 9px",fontSize:9,fontFamily:F.mono,color:C.green,marginBottom:6}}>✂ KML clip active · {kmlPolygon.length} vertices</div>}
        {bbox&&<div style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.bor}`,borderRadius:8,padding:"6px 9px",fontSize:9,fontFamily:F.mono,color:C.dim,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 10px"}}>
          <span>N {bbox.maxLat.toFixed(4)}°</span><span>S {bbox.minLat.toFixed(4)}°</span>
          <span>E {bbox.maxLng.toFixed(4)}°</span><span>W {bbox.minLng.toFixed(4)}°</span>
        </div>}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:`1px solid ${C.bor}`,flexShrink:0}}>
        {[["dem","🏔 DEM"],["contour","📐 Contour"],["export","💾 Export"]].map(([id,lb])=>(
          <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:"9px 4px",background:tab===id?"rgba(59,130,246,.08)":"transparent",border:"none",borderBottom:`2px solid ${tab===id?C.blue:"transparent"}`,cursor:"pointer",fontSize:10,fontWeight:700,color:tab===id?C.blue:C.dim,transition:"all .15s",fontFamily:F.ui}}>{lb}</button>
        ))}
      </div>

      {/* Body */}
      <div style={{flex:1,overflowY:"auto",padding:"12px 13px 24px",display:"flex",flexDirection:"column",gap:10,scrollbarWidth:"thin",scrollbarColor:"rgba(59,130,246,.2) transparent"}}>

        {/* ── DEM TAB ── */}
        {tab==="dem"&&<>
          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>GRID RESOLUTION · {gridRes}×{gridRes} = {gridRes*gridRes} pts</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <input type="range" min={10} max={60} step={5} value={gridRes} onChange={e=>setGridRes(+e.target.value)} disabled={isProcessing} style={{flex:1,accentColor:C.pink,cursor:isProcessing?"not-allowed":"pointer"}}/>
              <span style={{color:C.pink,fontSize:10,fontFamily:F.mono,minWidth:40}}>{gridRes}×{gridRes}</span>
            </div>
            <div style={{color:gridRes>50?C.amber:C.dim,fontSize:9}}>{gridRes>50?`⚠ ${gridRes*gridRes} pts — may be slow`:`~${Math.ceil(gridRes*gridRes/TILE_Z*0.15).toFixed(0)}s est · Terrarium tiles`}</div>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:7}}>HILLSHADE</div>
            <div style={{display:"flex",gap:4,marginBottom:8}}>
              {[["multi","Multi-Dir"],["single","Single 315°"],["off","Off"]].map(([id,lb])=>(
                <button key={id} onClick={()=>setHillshadeMode(id)} style={{flex:1,padding:"6px 3px",borderRadius:7,border:hillshadeMode===id?`1px solid ${C.blue}44`:`1px solid ${C.bor}`,background:hillshadeMode===id?"rgba(59,130,246,.12)":C.sur,color:hillshadeMode===id?C.blue:C.dim,fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:F.mono}}>{lb}</button>
              ))}
            </div>
            {hillshadeMode!=="off"&&<>
              <div style={{color:C.dim,fontSize:9,marginBottom:4}}>Strength · {Math.round(hillshadeStrength*100)}%</div>
              <input type="range" min={0} max={0.85} step={0.05} value={hillshadeStrength} onChange={e=>setHillshadeStrength(+e.target.value)} style={{width:"100%",accentColor:C.amber}}/>
            </>}
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>OPACITY · {Math.round(demOpacity*100)}%</div>
            <input type="range" min={0.1} max={1} step={0.05} value={demOpacity} onChange={e=>setDemOpacity(+e.target.value)} style={{width:"100%",accentColor:C.pink}}/>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:8}}>COLOR RAMP</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {Object.keys(COLOR_RAMPS).map(name=>{
                const sel=colorRamp===name;
                return <button key={name} onClick={()=>setColorRamp(name)} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"5px 7px",borderRadius:7,cursor:"pointer",background:sel?"rgba(59,130,246,.08)":"transparent",border:sel?"1.5px solid rgba(59,130,246,.4)":`1px solid ${C.bor}`}}>
                  <span style={{width:90,fontSize:9,fontFamily:F.mono,textAlign:"left",flexShrink:0,color:sel?C.blue:C.dim,fontWeight:sel?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</span>
                  <div style={{flex:1,height:14,borderRadius:4,background:`linear-gradient(to right,${rampCSS(name)})`,border:sel?"1px solid rgba(59,130,246,.35)":`1px solid ${C.bor}`}}/>
                </button>;
              })}
            </div>
          </div>

          {elevGrid&&<>
            <div style={{background:"rgba(74,222,128,.04)",border:"1px solid rgba(74,222,128,.15)",borderRadius:10,padding:"10px 12px"}}>
              <div style={{color:C.green,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>ELEVATION SUMMARY</div>
              {[["Min",`${elevGrid.min.toFixed(1)} m`,`${(elevGrid.min*3.28084).toFixed(0)} ft`],["Max",`${elevGrid.max.toFixed(1)} m`,`${(elevGrid.max*3.28084).toFixed(0)} ft`],["Range",`${(elevGrid.max-elevGrid.min).toFixed(1)} m`,""],["Grid",`${elevGrid.rows}×${elevGrid.cols}`,`${elevGrid.rows*elevGrid.cols} pts`],["Source","AWS Terrarium z14","~3m"]].map(([k,v,v2])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid rgba(74,222,128,.08)"}}>
                  <span style={{color:C.dim,fontSize:9,fontFamily:F.mono}}>{k}</span>
                  <div style={{textAlign:"right"}}><span style={{color:C.green,fontSize:11,fontWeight:700,fontFamily:F.mono}}>{v}</span>{v2&&<span style={{color:C.dim,fontSize:8,fontFamily:F.mono,marginLeft:5}}>{v2}</span>}</div>
                </div>
              ))}
            </div>
            <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
              <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:6}}>LEGEND · {Math.round(elevGrid.min)}m → {Math.round(elevGrid.max)}m</div>
              <div style={{height:22,borderRadius:5,background:`linear-gradient(to right,${rampCSS(colorRamp)})`,border:`1px solid ${C.bor}`,marginBottom:6}}/>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                {[0,.25,.5,.75,1].map(t=><span key={t} style={{fontSize:8,color:C.dim,fontFamily:F.mono}}>{Math.round(elevGrid.min+(elevGrid.max-elevGrid.min)*t)}m</span>)}
              </div>
            </div>
          </>}

          {/* Progress */}
          {isProcessing&&<div style={{background:"rgba(59,130,246,.06)",border:"1px solid rgba(59,130,246,.18)",borderRadius:9,padding:"9px 11px"}}>
            <div style={{height:3,borderRadius:2,background:"rgba(255,255,255,.06)",overflow:"hidden",marginBottom:6}}>
              <div style={{height:"100%",width:`${progress}%`,borderRadius:2,transition:"width .25s",background:"linear-gradient(90deg,#3b82f6,#22d3c8)"}}/>
            </div>
          </div>}

          <div style={{display:"flex",gap:6}}>
            <Btn color={C.pink} onClick={fetchElev} disabled={isProcessing||!bbox} fullWidth>
              {isProcessing?<><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⟳</span>Fetching…</>:"📡 Fetch Elevation Data"}
            </Btn>
            {isProcessing&&<button onClick={()=>abortRef.current?.abort()} style={{flexShrink:0,padding:"9px 12px",borderRadius:8,background:"rgba(240,96,96,.1)",border:"1px solid rgba(240,96,96,.3)",color:C.red,cursor:"pointer",fontSize:12,fontFamily:F.ui,fontWeight:700}}>✕</button>}
          </div>
          <Btn color={C.amber} onClick={doRenderDEM} disabled={!elevGrid}>🎨 Render DEM on Globe</Btn>
          {hasDEM&&<Btn color={demVisible?C.red:C.green} onClick={toggleDEM}>{demVisible?"🙈 Hide DEM":"👁 Show DEM"}</Btn>}
        </>}

        {/* ── CONTOUR TAB ── */}
        {tab==="contour"&&<>
          {!elevGrid&&<div style={{padding:"10px",borderRadius:8,background:"rgba(245,166,35,.07)",border:"1px solid rgba(245,166,35,.2)",color:C.amber,fontSize:10.5,textAlign:"center"}}>⚠️ Fetch elevation in DEM tab first</div>}

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:7}}>CONTOUR INTERVAL</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {INTERVALS.map(v=><button key={v} onClick={()=>setContourInterval(v)} style={{flex:"1 0 auto",minWidth:32,padding:"6px 3px",borderRadius:7,border:contourInterval===v?`1px solid ${C.cyan}44`:`1px solid ${C.bor}`,background:contourInterval===v?"rgba(34,211,200,.12)":C.sur,color:contourInterval===v?C.cyan:C.dim,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:F.mono,textAlign:"center"}}>{v}m</button>)}
            </div>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.dim,fontSize:9,fontWeight:700,letterSpacing:".1em",marginBottom:7}}>MAJOR INDEX EVERY</div>
            <div style={{display:"flex",gap:4}}>
              {MAJORS.map(v=><button key={v} onClick={()=>setMajorEvery(v)} style={{flex:1,padding:"6px 3px",borderRadius:7,border:majorEvery===v?`1px solid ${C.amber}44`:`1px solid ${C.bor}`,background:majorEvery===v?"rgba(245,166,35,.12)":C.sur,color:majorEvery===v?C.amber:C.dim,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:F.mono}}>{v}m</button>)}
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[["Minor",minorColor,setMinorColor],["Major",majorColor,setMajorColor]].map(([lb,val,set])=>(
              <div key={lb} style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:8,padding:"8px 10px"}}>
                <div style={{color:C.dim,fontSize:9,fontWeight:700,marginBottom:5}}>{lb.toUpperCase()}</div>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <input type="color" value={val} onChange={e=>set(e.target.value)} style={{width:28,height:28,border:"none",borderRadius:5,cursor:"pointer"}}/>
                  <span style={{color:C.dim,fontSize:9,fontFamily:F.mono}}>{val}</span>
                </div>
              </div>
            ))}
          </div>

          <svg width="100%" height="52" style={{display:"block"}}>
            <line x1="8" y1="16" x2="95%" y2="16" stroke={minorColor} strokeWidth="0.75" opacity="0.65"/>
            <text x="8" y="11" fill={C.dim} fontSize="8" fontFamily="monospace">minor ({contourInterval}m)</text>
            <line x1="8" y1="36" x2="95%" y2="36" stroke={majorColor} strokeWidth="2.0" opacity="0.88"/>
            <text x="8" y="50" fill={C.dim} fontSize="8" fontFamily="monospace">index ({majorEvery}m) + label</text>
            <rect x="48" y="28" width="26" height="12" rx="2" fill="rgba(255,255,255,0.92)" stroke={majorColor} strokeWidth="0.5"/>
            <text x="61" y="37" fill={majorColor} fontSize="8" fontFamily="monospace" textAnchor="middle" fontWeight="bold">{majorEvery}</text>
          </svg>

          <Btn color={C.cyan} onClick={doRenderContours} disabled={!elevGrid}>📐 Generate Contours on Globe</Btn>
          {hasContour&&<>
            <Btn color={contourVisible?C.red:C.green} onClick={toggleContours}>{contourVisible?"🙈 Hide Contours":"👁 Show Contours"}</Btn>
            {contourCount>0&&<div style={{textAlign:"center",color:C.cyan,fontSize:10,fontFamily:F.mono}}>{contourCount} lines · {contourInterval}m interval · major {majorEvery}m</div>}
          </>}
        </>}

        {/* ── EXPORT TAB ── */}
        {tab==="export"&&<>
          <div style={{padding:"10px 12px",borderRadius:10,background:"rgba(184,156,248,.05)",border:"1px solid rgba(184,156,248,.17)"}}>
            <div style={{color:C.violet,fontWeight:700,fontSize:12.5,marginBottom:4}}>💾 Export GIS Data</div>
            <div style={{color:C.dim,fontSize:10.5,lineHeight:1.7}}>GeoTIFF · CSV · GeoJSON · Shapefile ZIP — QGIS/ArcGIS ready</div>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.pink,fontWeight:700,fontSize:11,marginBottom:7}}>🏔 DEM / Elevation</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <Btn color={C.pink} onClick={exportTIFF} disabled={!elevGrid}>📥 Export → GeoTIFF (.tif)</Btn>
              <Btn color={C.amber} onClick={exportCSV} disabled={!elevGrid}>📥 Export → CSV</Btn>
            </div>
          </div>

          <div style={{background:C.sur,border:`1px solid ${C.bor}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.cyan,fontWeight:700,fontSize:11,marginBottom:7}}>📐 Contour Lines</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <Btn color={C.cyan} onClick={exportGeoJSON} disabled={!elevGrid}>📥 Contours → GeoJSON 3D</Btn>
              <Btn color={C.blue} onClick={exportSHP} disabled={!elevGrid}>📥 Contours → Shapefile ZIP</Btn>
            </div>
          </div>

          {elevGrid&&<div style={{background:"rgba(74,222,128,.04)",border:"1px solid rgba(74,222,128,.15)",borderRadius:10,padding:"10px 12px"}}>
            <div style={{color:C.green,fontWeight:700,fontSize:11,marginBottom:6}}>✅ Summary</div>
            {[["Grid",`${elevGrid.rows}×${elevGrid.cols} pts`],["Min",`${elevGrid.min.toFixed(1)} m`],["Max",`${elevGrid.max.toFixed(1)} m`],["Range",`${(elevGrid.max-elevGrid.min).toFixed(1)} m`],["Source","AWS Terrarium z14 ~3m"],["Interval",`${contourInterval}m / major ${majorEvery}m`],...(contourCount>0?[["Contours",`${contourCount} lines`]]:[]),...(kmlPolygon?.length>=3?[["Clip",`KML · ${kmlPolygon.length} pts`]]:[])].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid rgba(74,222,128,.08)"}}>
                <span style={{color:C.dim,fontSize:10,fontFamily:F.mono}}>{k}</span>
                <span style={{color:C.green,fontSize:11,fontWeight:700,fontFamily:F.mono}}>{v}</span>
              </div>
            ))}
          </div>}
        </>}

      </div>

      {/* Status bar */}
      {status&&<div style={{padding:"6px 12px",flexShrink:0,borderTop:`1px solid ${C.bor}`,background:`${sm.color}0a`,display:"flex",alignItems:"center",gap:6}}>
        <span style={{color:sm.color,fontSize:11,fontWeight:700,flexShrink:0,width:16,textAlign:"center",fontFamily:F.mono}}>{sm.icon}</span>
        <span style={{color:sm.color,fontSize:9.5,fontFamily:F.mono,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{status}</span>
      </div>}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}