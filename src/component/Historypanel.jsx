import React, { useState, useEffect, useRef } from "react";

/*
HISTORY DATA
Satellite imagery + historical maps
*/

const HISTORY_DATA = [
  { year: 2024, type: "satellite", version: 104, label: "Oct 2024" },
  { year: 2023, type: "satellite", version: 92, label: "Oct 2023" },
  { year: 2022, type: "satellite", version: 80, label: "Oct 2022" },
  { year: 2021, type: "satellite", version: 68, label: "Oct 2021" },
  { year: 2020, type: "satellite", version: 56, label: "Oct 2020" },
  { year: 2019, type: "satellite", version: 44, label: "Oct 2019" },
  { year: 2018, type: "satellite", version: 32, label: "Oct 2018" },
  { year: 2017, type: "satellite", version: 20, label: "Oct 2017" },

  { year: 2000, type: "historical", label: "2000 Map" },
  { year: 1980, type: "historical", label: "1980 Map" },
  { year: 1960, type: "historical", label: "1960 Map" },
  { year: 1940, type: "historical", label: "1940 Map" },
  { year: 1920, type: "historical", label: "1920 Map" },
  { year: 1900, type: "historical", label: "1900 Map" }
];

/*
HISTORY PANEL
*/

export default function HistoryPanel({ onClose }) {

  const [index, setIndex] = useState(0);
  const [opacity, setOpacity] = useState(1);

  const layerRef = useRef(null);

  /*
  APPLY MAP LAYER
  */

  function applyLayer(i) {

    const map = window.mapInstance;

    if (!map) return;

    const L = window.L;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    const item = HISTORY_DATA[i];

    let layer;

    /*
    SATELLITE (ESRI WAYBACK)
    */

    if (item.type === "satellite") {

      const url =
        "https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/MapServer/tile/" +
        item.version +
        "/{z}/{y}/{x}";

      layer = L.tileLayer(url, {
        maxZoom: 19,
        opacity: opacity,
        attribution: "© Esri Wayback"
      });

    }

    /*
    HISTORICAL MAP
    */

    else {

      layer = L.tileLayer(
        "https://tile.openhistoricalmap.org/tiles/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          opacity: opacity,
          attribution: "© OpenHistoricalMap"
        }
      );

    }

    layer.addTo(map);

    layerRef.current = layer;
  }

  /*
  UPDATE YEAR
  */

  useEffect(() => {
    applyLayer(index);
  }, [index]);

  /*
  UPDATE OPACITY
  */

  useEffect(() => {
    if (layerRef.current) layerRef.current.setOpacity(opacity);
  }, [opacity]);

  /*
  REMOVE LAYER WHEN CLOSED
  */

  useEffect(() => {

    return () => {
      const map = window.mapInstance;

      if (map && layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };

  }, []);

  /*
  UI
  */

  return (

    <div style={{
      position: "fixed",
      bottom: 40,
      left: "50%",
      transform: "translateX(-50%)",
      width: 700,
      background: "#0b1a26",
      border: "1px solid #2b4a62",
      borderRadius: 12,
      color: "#d0e8f8",
      fontFamily: "Segoe UI",
      zIndex: 9999
    }}>

      {/* HEADER */}

      <div style={{
        display: "flex",
        alignItems: "center",
        padding: 10,
        borderBottom: "1px solid #1f3b52"
      }}>

        <span style={{ fontSize: 18, marginRight: 8 }}>🕰️</span>

        <div style={{ flex: 1 }}>
          Historical Imagery Timeline
        </div>

        <button
          onClick={onClose}
          style={{
            background: "#c62828",
            border: "none",
            color: "#fff",
            borderRadius: 4,
            padding: "4px 10px",
            cursor: "pointer"
          }}
        >
          Close
        </button>

      </div>

      {/* YEAR */}

      <div style={{
        padding: 8,
        textAlign: "center",
        fontSize: 16,
        fontWeight: 700
      }}>
        {HISTORY_DATA[index].year}
      </div>

      {/* SLIDER */}

      <div style={{ padding: "0 20px" }}>

        <input
          type="range"
          min="0"
          max={HISTORY_DATA.length - 1}
          value={index}
          onChange={(e) => setIndex(parseInt(e.target.value))}
          style={{ width: "100%" }}
        />

      </div>

      {/* YEAR BUTTONS */}

      <div style={{
        display: "flex",
        overflowX: "auto",
        padding: 10,
        gap: 6
      }}>

        {HISTORY_DATA.map((d, i) => (

          <button
            key={i}
            onClick={() => setIndex(i)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: i === index ? "1px solid #3a78c8" : "1px solid #1f3b52",
              background: i === index ? "#1e4e80" : "#132736",
              color: "#d0e8f8",
              cursor: "pointer",
              whiteSpace: "nowrap"
            }}
          >
            {d.year}
          </button>

        ))}

      </div>

      {/* OPACITY */}

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderTop: "1px solid #1f3b52"
      }}>

        <span>Opacity</span>

        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(e) => setOpacity(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />

        <span>{Math.round(opacity * 100)}%</span>

      </div>

    </div>

  );
}