/**
 * GoogleEarthOptionsDialog.jsx — SurveyMap Pro
 * ─────────────────────────────────────────────
 * Full Google Earth Pro "Options" dialog:
 *  - 5 tabs: 3D View | Cache | Touring | Navigation | General
 *  - All settings editable with live state
 *  - OK / Cancel / Apply / Restore Defaults footer
 *  - Pixel-accurate match to Google Earth Pro Options panel
 */

import { useState, useEffect, useRef } from "react";

/* ── Default settings (mirrors Google Earth Pro) ────────────────────────── */
const DEFAULT_SETTINGS = {
  // 3D View
  textureColor: "trueColor32",      // highColor16 | trueColor32
  compress: true,
  anisotropicFiltering: "medium",   // off | medium | high
  labelsIconSize: "medium",         // small | medium | large
  graphicsMode: "opengl",           // opengl | directx
  useSafeMode: false,
  showLatLong: "decimalDegrees",    // decimalDegrees | dms | decimalMinutes | utm
  showElevation: "feetMiles",       // feetMiles | metersKm
  antialiasing: "off",              // off | medium | high
  terrainQuality: 50,               // 0–100
  elevationExaggeration: 1,         // 0.5–3
  mapSize: 50,                      // 0–100 (Small–Large)
  zoomRelation: "infinity",         // infinity | custom
  primaryFont: "Arial",
  secondaryFont: "Arial",

  // Cache
  diskCacheSize: 2000,              // MB
  memCacheSize: 32,                 // MB
  autoCachePath: "C:\\Users\\User\\AppData\\Local\\Google\\GoogleEarth\\",
  saveToCache: true,
  deleteCacheOnExit: false,

  // Touring
  tourSpeed: 1.0,
  tourWaitAtFeature: 5,
  tourFlyToView: true,
  tourCameraAngle: 0,
  tourCameraTilt: 0,
  tourShowBalloons: true,

  // Navigation
  navigationMode: "click",          // click | zoom
  invertMouseWheel: false,
  continuousZoom: true,
  autoTiltWhenZooming: false,
  returnToNorth: false,
  clickSpeed: 3,                    // 1–5
  inertia: true,

  // General
  language: "en",
  showTips: true,
  showSplash: true,
  units: "imperial",                // imperial | metric
  webBrowser: "system",
  emailClient: "system",
  showTermsOnStartup: false,
  checkUpdates: true,
};

/* ── Reusable radio group ────────────────────────────────────────────────── */
function RadioGroup({ options, value, onChange, name }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {options.map(opt => (
        <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#1a1a1a" }}>
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            style={{ accentColor: "#1a73e8", width: 13, height: 13, cursor: "pointer" }}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

/* ── Checkbox ────────────────────────────────────────────────────────────── */
function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#1a1a1a" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ accentColor: "#1a73e8", width: 13, height: 13, cursor: "pointer" }}
      />
      {label}
    </label>
  );
}

/* ── Labeled slider ──────────────────────────────────────────────────────── */
function LabeledSlider({ min, max, value, onChange, leftLabel, rightLabel, step = 1 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {leftLabel && <span style={{ fontSize: 11, color: "#555", minWidth: 60, textAlign: "right" }}>{leftLabel}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#1a73e8", cursor: "pointer", height: 16 }}
      />
      {rightLabel && <span style={{ fontSize: 11, color: "#555", minWidth: 60 }}>{rightLabel}</span>}
    </div>
  );
}

/* ── Field row (label + input) ───────────────────────────────────────────── */
function FieldRow({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: "#1a1a1a", minWidth: 140, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}

/* ── Group box (Windows-style border + title) ────────────────────────────── */
function GroupBox({ title, children, style }) {
  return (
    <div style={{
      border: "1px solid #aaa",
      borderRadius: 3,
      padding: "10px 12px 10px",
      position: "relative",
      marginBottom: 10,
      background: "#f5f5f5",
      ...style,
    }}>
      {title && (
        <span style={{
          position: "absolute",
          top: -8,
          left: 10,
          background: "#ece9d8",
          padding: "0 4px",
          fontSize: 11,
          fontWeight: 600,
          color: "#1a1a1a",
          fontFamily: "Tahoma, Arial, sans-serif",
        }}>
          {title}
        </span>
      )}
      {children}
    </div>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
const TABS = ["3D View", "Cache", "Touring", "Navigation", "General"];

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════ */
export default function GoogleEarthOptionsDialog({ onClose, onApply }) {
  const [activeTab, setActiveTab] = useState("3D View");
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [pendingSettings, setPendingSettings] = useState({ ...DEFAULT_SETTINGS });

  const set = (key, value) => setPendingSettings(p => ({ ...p, [key]: value }));

  const handleOK = () => {
    setSettings({ ...pendingSettings });
    onApply?.(pendingSettings);
    onClose?.();
  };

  const handleCancel = () => {
    setPendingSettings({ ...settings });
    onClose?.();
  };

  const handleApply = () => {
    setSettings({ ...pendingSettings });
    onApply?.(pendingSettings);
  };

  const handleRestoreDefaults = () => {
    setPendingSettings({ ...DEFAULT_SETTINGS });
  };

  // Close on Escape
  useEffect(() => {
    const h = e => { if (e.key === "Escape") handleCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [settings]);

  const baseStyle = {
    fontFamily: "Tahoma, Arial, sans-serif",
    fontSize: 12,
    color: "#1a1a1a",
  };

  /* ── Tab content renderers ─────────────────────────────────────────── */

  const render3DView = () => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {/* Left column */}
      <div>
        <GroupBox title="Texture Colors">
          <RadioGroup
            name="textureColor"
            value={pendingSettings.textureColor}
            onChange={v => set("textureColor", v)}
            options={[
              { value: "highColor16",  label: "High Color (16 bit)" },
              { value: "trueColor32",  label: "True Color (32 bit)" },
            ]}
          />
          <div style={{ marginTop: 5 }}>
            <Checkbox label="Compress" checked={pendingSettings.compress} onChange={v => set("compress", v)} />
          </div>
        </GroupBox>

        <GroupBox title="Show Lat/Long">
          <RadioGroup
            name="showLatLong"
            value={pendingSettings.showLatLong}
            onChange={v => set("showLatLong", v)}
            options={[
              { value: "decimalDegrees",   label: "Decimal Degrees" },
              { value: "dms",              label: "Degrees, Minutes, Seconds" },
              { value: "decimalMinutes",   label: "Degrees, Decimal Minutes" },
              { value: "utm",              label: "Universal Transverse Mercator" },
            ]}
          />
        </GroupBox>

        <GroupBox title="Terrain Quality">
          <LabeledSlider
            min={0} max={100} value={pendingSettings.terrainQuality}
            onChange={v => set("terrainQuality", v)}
            leftLabel="Lower (faster)" rightLabel="Higher (slower)"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: "#1a1a1a" }}>Elevation Exaggeration:</span>
            <input
              type="number"
              min={0.5} max={3} step={0.1}
              value={pendingSettings.elevationExaggeration}
              onChange={e => set("elevationExaggeration", parseFloat(e.target.value))}
              style={{ width: 50, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma, Arial, sans-serif" }}
            />
            <span style={{ fontSize: 11, color: "#555" }}>(0.5 - 3)</span>
          </div>
        </GroupBox>
      </div>

      {/* Right column */}
      <div>
        <GroupBox title="Anisotropic Filtering">
          <RadioGroup
            name="anisotropicFiltering"
            value={pendingSettings.anisotropicFiltering}
            onChange={v => set("anisotropicFiltering", v)}
            options={[
              { value: "off",    label: "Off" },
              { value: "medium", label: "Medium" },
              { value: "high",   label: "High" },
            ]}
          />
        </GroupBox>

        <GroupBox title="Labels/Icon Size">
          <RadioGroup
            name="labelsIconSize"
            value={pendingSettings.labelsIconSize}
            onChange={v => set("labelsIconSize", v)}
            options={[
              { value: "small",  label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large",  label: "Large" },
            ]}
          />
        </GroupBox>

        <GroupBox title="Graphics Mode">
          <RadioGroup
            name="graphicsMode"
            value={pendingSettings.graphicsMode}
            onChange={v => set("graphicsMode", v)}
            options={[
              { value: "opengl",  label: "OpenGL" },
              { value: "directx", label: "DirectX" },
            ]}
          />
          <div style={{ marginTop: 4 }}>
            <Checkbox label="Use safe mode" checked={pendingSettings.useSafeMode} onChange={v => set("useSafeMode", v)} />
          </div>
        </GroupBox>

        <GroupBox title="Show Elevation">
          <RadioGroup
            name="showElevation"
            value={pendingSettings.showElevation}
            onChange={v => set("showElevation", v)}
            options={[
              { value: "feetMiles",   label: "Feet, Miles" },
              { value: "metersKm",    label: "Meters, Kilometers" },
            ]}
          />
        </GroupBox>

        <GroupBox title="Fonts">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={() => {}}
              style={{ padding: "4px 12px", border: "2px outset #ccc", background: "#ece9d8", cursor: "pointer", fontSize: 12, fontFamily: "Tahoma, Arial, sans-serif", textAlign: "center" }}
            >
              Primary 3D font
            </button>
            <button
              onClick={() => {}}
              style={{ padding: "4px 12px", border: "2px outset #ccc", background: "#ece9d8", cursor: "pointer", fontSize: 12, fontFamily: "Tahoma, Arial, sans-serif", textAlign: "center" }}
            >
              Secondary 3D font
            </button>
          </div>
        </GroupBox>

        <GroupBox title="Antialiasing">
          <RadioGroup
            name="antialiasing"
            value={pendingSettings.antialiasing}
            onChange={v => set("antialiasing", v)}
            options={[
              { value: "off",    label: "Off" },
              { value: "medium", label: "Medium" },
              { value: "high",   label: "High" },
            ]}
          />
        </GroupBox>
      </div>

      {/* Overview Map — full width */}
      <div style={{ gridColumn: "1 / -1" }}>
        <GroupBox title="Overview Map">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#1a1a1a", minWidth: 70 }}>Map Size:</span>
              <span style={{ fontSize: 11, color: "#555", minWidth: 36 }}>Small</span>
              <input
                type="range" min={0} max={100} value={pendingSettings.mapSize}
                onChange={e => set("mapSize", Number(e.target.value))}
                style={{ flex: 1, accentColor: "#1a73e8", cursor: "pointer" }}
              />
              <span style={{ fontSize: 11, color: "#555", minWidth: 36, textAlign: "right" }}>Large</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#1a1a1a", minWidth: 70 }}>Zoom Relation:</span>
              <input
                type="text"
                value={pendingSettings.zoomRelation}
                onChange={e => set("zoomRelation", e.target.value)}
                style={{ width: 60, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma, Arial, sans-serif" }}
              />
              <span style={{ fontSize: 11, color: "#555" }}>1:1</span>
              <input
                type="range" min={0} max={100} value={80}
                onChange={() => {}}
                style={{ flex: 1, accentColor: "#1a73e8", cursor: "pointer" }}
              />
              <span style={{ fontSize: 11, color: "#555" }}>1:infinity</span>
            </div>
          </div>
        </GroupBox>
      </div>
    </div>
  );

  const renderCache = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <GroupBox title="Disk Cache">
        <FieldRow label="Maximum disk cache size:">
          <input
            type="number"
            value={pendingSettings.diskCacheSize}
            onChange={e => set("diskCacheSize", Number(e.target.value))}
            style={{ width: 70, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma" }}
          />
          <span style={{ fontSize: 11, color: "#555" }}>MB</span>
        </FieldRow>
        <FieldRow label="Cache directory:">
          <input
            type="text"
            value={pendingSettings.autoCachePath}
            onChange={e => set("autoCachePath", e.target.value)}
            style={{ flex: 1, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 11, fontFamily: "Tahoma" }}
          />
        </FieldRow>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          <Checkbox label="Save map tiles to disk cache" checked={pendingSettings.saveToCache} onChange={v => set("saveToCache", v)} />
          <Checkbox label="Delete cache on exit" checked={pendingSettings.deleteCacheOnExit} onChange={v => set("deleteCacheOnExit", v)} />
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <button style={{ padding: "4px 16px", border: "2px outset #ccc", background: "#ece9d8", cursor: "pointer", fontSize: 12, fontFamily: "Tahoma" }}>
            Clear disk cache
          </button>
        </div>
      </GroupBox>

      <GroupBox title="Memory Cache">
        <FieldRow label="Maximum memory cache size:">
          <input
            type="number"
            value={pendingSettings.memCacheSize}
            onChange={e => set("memCacheSize", Number(e.target.value))}
            style={{ width: 70, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma" }}
          />
          <span style={{ fontSize: 11, color: "#555" }}>MB</span>
        </FieldRow>
        <div style={{ marginTop: 6 }}>
          <button style={{ padding: "4px 16px", border: "2px outset #ccc", background: "#ece9d8", cursor: "pointer", fontSize: 12, fontFamily: "Tahoma" }}>
            Clear memory cache
          </button>
        </div>
      </GroupBox>
    </div>
  );

  const renderTouring = () => (
    <div>
      <GroupBox title="Tour Settings">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FieldRow label="Tour speed (seconds):">
            <input
              type="number" min={0.1} max={10} step={0.1}
              value={pendingSettings.tourSpeed}
              onChange={e => set("tourSpeed", parseFloat(e.target.value))}
              style={{ width: 70, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma" }}
            />
          </FieldRow>
          <FieldRow label="Wait at each feature (sec):">
            <input
              type="number" min={0} max={60}
              value={pendingSettings.tourWaitAtFeature}
              onChange={e => set("tourWaitAtFeature", Number(e.target.value))}
              style={{ width: 70, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma" }}
            />
          </FieldRow>
          <FieldRow label="Camera angle (°):">
            <input
              type="number" min={-90} max={90}
              value={pendingSettings.tourCameraAngle}
              onChange={e => set("tourCameraAngle", Number(e.target.value))}
              style={{ width: 70, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma" }}
            />
          </FieldRow>
          <FieldRow label="Camera tilt (°):">
            <input
              type="number" min={0} max={90}
              value={pendingSettings.tourCameraTilt}
              onChange={e => set("tourCameraTilt", Number(e.target.value))}
              style={{ width: 70, padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma" }}
            />
          </FieldRow>
          <Checkbox label="Fly to view when playing tour" checked={pendingSettings.tourFlyToView} onChange={v => set("tourFlyToView", v)} />
          <Checkbox label="Show balloons when tour plays" checked={pendingSettings.tourShowBalloons} onChange={v => set("tourShowBalloons", v)} />
        </div>
      </GroupBox>
    </div>
  );

  const renderNavigation = () => (
    <div>
      <GroupBox title="Navigation Mode">
        <RadioGroup
          name="navigationMode"
          value={pendingSettings.navigationMode}
          onChange={v => set("navigationMode", v)}
          options={[
            { value: "click", label: "Click-and-drag to move" },
            { value: "zoom",  label: "Click-and-drag to zoom" },
          ]}
        />
      </GroupBox>

      <GroupBox title="Mouse Wheel">
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <Checkbox label="Invert mouse wheel zoom direction" checked={pendingSettings.invertMouseWheel} onChange={v => set("invertMouseWheel", v)} />
          <Checkbox label="Continuous zoom" checked={pendingSettings.continuousZoom} onChange={v => set("continuousZoom", v)} />
        </div>
      </GroupBox>

      <GroupBox title="Navigation Controls">
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <Checkbox label="Automatically tilt when zooming" checked={pendingSettings.autoTiltWhenZooming} onChange={v => set("autoTiltWhenZooming", v)} />
          <Checkbox label="Return to north after navigation" checked={pendingSettings.returnToNorth} onChange={v => set("returnToNorth", v)} />
          <Checkbox label="Enable inertia (smooth deceleration)" checked={pendingSettings.inertia} onChange={v => set("inertia", v)} />
        </div>
        <div style={{ marginTop: 8 }}>
          <FieldRow label="Click speed:">
            <LabeledSlider
              min={1} max={5} value={pendingSettings.clickSpeed}
              onChange={v => set("clickSpeed", v)}
              leftLabel="Slow" rightLabel="Fast"
            />
          </FieldRow>
        </div>
      </GroupBox>
    </div>
  );

  const renderGeneral = () => (
    <div>
      <GroupBox title="Appearance">
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <Checkbox label="Show tips on startup" checked={pendingSettings.showTips} onChange={v => set("showTips", v)} />
          <Checkbox label="Show splash screen" checked={pendingSettings.showSplash} onChange={v => set("showSplash", v)} />
          <Checkbox label="Show Terms of Service on startup" checked={pendingSettings.showTermsOnStartup} onChange={v => set("showTermsOnStartup", v)} />
          <Checkbox label="Automatically check for updates" checked={pendingSettings.checkUpdates} onChange={v => set("checkUpdates", v)} />
        </div>
      </GroupBox>

      <GroupBox title="Units">
        <RadioGroup
          name="units"
          value={pendingSettings.units}
          onChange={v => set("units", v)}
          options={[
            { value: "imperial", label: "Imperial (feet, miles)" },
            { value: "metric",   label: "Metric (meters, kilometers)" },
          ]}
        />
      </GroupBox>

      <GroupBox title="Language">
        <FieldRow label="Application language:">
          <select
            value={pendingSettings.language}
            onChange={e => set("language", e.target.value)}
            style={{ padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma", background: "#fff" }}
          >
            {[["en","English"],["fr","Français"],["de","Deutsch"],["es","Español"],["ja","日本語"],["zh","中文"],["ar","العربية"],["hi","हिन्दी"]].map(([v,l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </FieldRow>
      </GroupBox>

      <GroupBox title="External Applications">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldRow label="Web browser:">
            <select
              value={pendingSettings.webBrowser}
              onChange={e => set("webBrowser", e.target.value)}
              style={{ padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma", background: "#fff" }}
            >
              <option value="system">System default</option>
              <option value="chrome">Google Chrome</option>
              <option value="firefox">Firefox</option>
              <option value="edge">Microsoft Edge</option>
            </select>
          </FieldRow>
          <FieldRow label="Email client:">
            <select
              value={pendingSettings.emailClient}
              onChange={e => set("emailClient", e.target.value)}
              style={{ padding: "2px 5px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, fontFamily: "Tahoma", background: "#fff" }}
            >
              <option value="system">System default</option>
              <option value="gmail">Gmail (web)</option>
              <option value="outlook">Outlook</option>
            </select>
          </FieldRow>
        </div>
      </GroupBox>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case "3D View":    return render3DView();
      case "Cache":      return renderCache();
      case "Touring":    return renderTouring();
      case "Navigation": return renderNavigation();
      case "General":    return renderGeneral();
      default:           return null;
    }
  };

  return (
    /* ── Backdrop ─────────────────────────────────────────────────────── */
    <div
      onClick={e => { if (e.target === e.currentTarget) handleCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9800,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "Tahoma, Arial, sans-serif",
      }}
    >
      {/* ── Dialog window ────────────────────────────────────────────── */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 680,
          background: "#ece9d8",
          border: "2px outset #fff",
          boxShadow: "4px 4px 12px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          userSelect: "none",
        }}
      >
        {/* ── Title bar ──────────────────────────────────────────────── */}
        <div style={{
          background: "linear-gradient(to right, #0054e3, #2a8fef)",
          color: "#fff",
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 24,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* GE icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="#4ac34a" stroke="#fff" strokeWidth="1"/>
              <path d="M12 2a10 10 0 010 20" fill="#1a73e8"/>
              <circle cx="12" cy="12" r="3" fill="#fff"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "Tahoma, Arial, sans-serif" }}>
               Options
            </span>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {/* ? button */}
            <button
              style={{ width: 18, height: 18, background: "#c0c0c0", border: "1px outset #fff", fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#000", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Tahoma" }}
            >?</button>
            {/* X button */}
            <button
              onClick={handleCancel}
              style={{ width: 18, height: 18, background: "#c0c0c0", border: "1px outset #fff", fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#000", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Tahoma" }}
            >×</button>
          </div>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────── */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid #aaa",
          background: "#ece9d8",
          paddingLeft: 6,
          paddingTop: 4,
          flexShrink: 0,
        }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "4px 14px",
                  border: "1px solid #aaa",
                  borderBottom: isActive ? "1px solid #ece9d8" : "1px solid #aaa",
                  background: isActive ? "#ece9d8" : "#d4d0c8",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "Tahoma, Arial, sans-serif",
                  color: "#1a1a1a",
                  marginRight: 2,
                  marginBottom: isActive ? -1 : 0,
                  borderRadius: "3px 3px 0 0",
                  fontWeight: isActive ? 700 : 400,
                  position: "relative",
                  zIndex: isActive ? 1 : 0,
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* ── Tab content ────────────────────────────────────────────── */}
        <div style={{
          padding: "14px 14px 8px",
          flex: 1,
          overflowY: "auto",
          maxHeight: 480,
          background: "#ece9d8",
        }}>
          {renderTabContent()}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px 10px",
          borderTop: "1px solid #aaa",
          background: "#ece9d8",
          flexShrink: 0,
        }}>
          <button
            onClick={handleRestoreDefaults}
            style={{
              padding: "5px 16px",
              border: "2px outset #fff",
              background: "#d4d0c8",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "Tahoma, Arial, sans-serif",
              color: "#1a1a1a",
              minWidth: 110,
            }}
          >
            Restore Defaults
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleOK}
              style={{
                padding: "5px 20px",
                border: "2px outset #fff",
                background: "#d4d0c8",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "Tahoma, Arial, sans-serif",
                color: "#1a1a1a",
                minWidth: 70,
              }}
            >
              OK
            </button>
            <button
              onClick={handleCancel}
              style={{
                padding: "5px 20px",
                border: "2px outset #fff",
                background: "#d4d0c8",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "Tahoma, Arial, sans-serif",
                color: "#1a1a1a",
                minWidth: 70,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              style={{
                padding: "5px 20px",
                border: "2px outset #fff",
                background: "#d4d0c8",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "Tahoma, Arial, sans-serif",
                color: "#1a1a1a",
                minWidth: 70,
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}