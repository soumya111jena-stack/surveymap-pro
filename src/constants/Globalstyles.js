// ─── globalStyles.js — CSS string injected via <style> in SurveyMap root ─────
export const GLOBAL_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');

html, body, #root { margin:0; padding:0; width:100%; height:100%; overflow:hidden; }
*, *::before, *::after { box-sizing: border-box; }
body { font-family:'DM Sans',sans-serif; background:#060e1a; }

::-webkit-scrollbar { width:4px; height:4px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:rgba(74,158,255,0.22); border-radius:4px; }
::-webkit-scrollbar-thumb:hover { background:rgba(74,158,255,0.42); }

/* ── Layout token variables ── */
.sm-layout {
  --menu-h: 32px; --tb-h: 52px; --top-h: 84px;
  --sb-w: 268px;  --stat-h: 28px;
  --mob-search-h: 0px; --mob-fab-h: 0px;
}

/* ── Desktop sidebar ── */
.sm-sidebar {
  position:absolute; top:var(--top-h); left:0; bottom:var(--stat-h);
  width:var(--sb-w); z-index:1100; display:flex; flex-direction:column;
  overflow-y:hidden;
  background:rgba(7,18,32,0.78);
  backdrop-filter:blur(24px) saturate(180%);
  -webkit-backdrop-filter:blur(24px) saturate(180%);
  border:1px solid rgba(255,255,255,0.07);
  border-top:none; border-bottom:none; border-left:none;
  box-shadow:4px 0 36px rgba(0,0,0,0.55);
}

/* ── Mobile overrides ── */
@media(max-width:640px){
  .sm-layout {
    --menu-h:0px; --tb-h:0px; --top-h:0px; --sb-w:0px; --stat-h:0px;
    --mob-search-h:58px; --mob-fab-h:76px;
  }
  .sm-menubar  { display:none !important; }
  .sm-toolbar  { display:none !important; }
  .sm-sidebar  { display:none !important; }
  .sm-stat-bar { display:none !important; }
  .sm-mob-search { display:flex !important; }
  .sm-mob-nav    { display:flex !important; }
  .sm-map-wrap {
    position:fixed !important; left:0 !important; right:0 !important;
    top:var(--mob-search-h) !important; bottom:var(--mob-fab-h) !important;
    transition:bottom 0.3s cubic-bezier(.16,1,.3,1) !important;
  }
  .sm-loc-card {
    width:calc(100vw - 16px) !important;
    left:8px !important; right:8px !important;
    top:calc(var(--mob-search-h) + 8px) !important;
  }
  .desktop-compass { display:none !important; }
}

@media(min-width:641px){
  .sm-mob-search  { display:none !important; }
  .sm-mob-nav     { display:none !important; }
  .sm-mob-hud     { display:none !important; }
  .sm-mob-compass { display:none !important; }
  /* Desktop map area — fills space right of sidebar, below toolbar, above status bar */
  .sm-map-wrap {
    position:absolute;
    top: var(--top-h);
    left: var(--sb-w);
    right: 0;
    bottom: var(--stat-h);
    z-index: 1;
  }
}

/* ── Toolbar button ── */
.tb-btn {
  display:flex; align-items:center; gap:6px; padding:6px 12px;
  border-radius:8px; cursor:pointer; font-size:12px; font-weight:500;
  font-family:'DM Sans',sans-serif; border:1px solid rgba(255,255,255,0.08);
  transition:all 0.2s; white-space:nowrap; flex-shrink:0;
}
.tb-btn:hover            { filter:brightness(1.15); }
.tb-btn.active           { background:rgba(74,158,255,0.2); border-color:rgba(74,158,255,0.5); color:#80c4ff; box-shadow:0 0 18px rgba(74,158,255,0.2); }
.tb-btn.inactive         { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.85); }
.tb-btn.inactive:hover   { background:rgba(255,255,255,0.1); }
.tb-btn.tracker-active   { background:rgba(239,68,68,0.2); border-color:rgba(239,68,68,0.6); color:#f87171; box-shadow:0 0 18px rgba(239,68,68,0.3); }
.tb-btn.offline-active   { background:rgba(34,197,94,0.18); border-color:rgba(34,197,94,0.6); color:#4ade80; }
.tb-btn.compass-active   { background:rgba(14,165,233,0.18); border-color:rgba(14,165,233,0.55); color:#38bdf8; }
.tb-btn.geojson-active   { background:rgba(20,184,166,0.18); border-color:rgba(20,184,166,0.55); color:#2dd4bf; }

/* ── Menu item ── */
.menu-item {
  display:flex; align-items:center; gap:9px; padding:8px 16px;
  font-size:12.5px; color:rgba(200,225,255,0.85); cursor:pointer;
  font-family:'DM Sans',sans-serif; transition:all 0.15s; white-space:nowrap;
}
.menu-item:hover { background:rgba(74,158,255,0.15); color:#fff; }

/* ── Animations ── */
@keyframes fadeIn       { from{opacity:0} to{opacity:1} }
@keyframes fadeSlideIn  { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:translateX(0)} }
@keyframes slideUpSheet { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes slideUpElev  { from{transform:translateY(100%)} to{transform:translateY(0)} }
@keyframes slideDown    { from{opacity:0;transform:translateX(-50%) translateY(-10px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
@keyframes blink        { 0%,100%{opacity:1} 50%{opacity:0.18} }
@keyframes spin         { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes compassPulse { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:0.7;transform:scale(1.04)} }
@keyframes compassHalo  { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.12)} }

/* ── Leaflet overrides ── */
.leaflet-control-zoom { display:none !important; }
.leaflet-control-attribution {
  background:rgba(8,20,35,0.75)!important; backdrop-filter:blur(8px)!important;
  color:rgba(255,255,255,0.38)!important; font-size:9px!important;
  padding:2px 8px!important; border-radius:4px 0 0 0!important;
  border:1px solid rgba(255,255,255,0.05)!important;
}
.leaflet-control-attribution a { color:rgba(74,158,255,0.65)!important; }
`;