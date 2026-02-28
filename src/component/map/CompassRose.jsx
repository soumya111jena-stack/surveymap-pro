import { useEffect, useState } from "react";
import { useMap } from "react-leaflet";

function CompassRose() {
  const map = useMap();
  const [bearing, setBearing] = useState(0);

  useEffect(() => {
    const upd = () => setBearing(map.getBearing ? map.getBearing() : 0);
    map.on("rotate", upd);
    return () => map.off("rotate", upd);
  }, [map]);

  return (
    <div
      title="Click to reset north"
      onClick={() => map.setBearing && map.setBearing(0)}
      style={{
        position: "absolute",
        bottom: 108,
        right: 10,
        zIndex: 999,
        width: 48,
        height: 48,
        cursor: "pointer",
        filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
      }}
    >
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle
          cx="24"
          cy="24"
          r="22"
          fill="rgba(15,23,42,0.88)"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1"
        />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <line
            key={a}
            x1="24"
            y1="4"
            x2="24"
            y2={a % 90 === 0 ? "8" : "6"}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth={a % 90 === 0 ? "1.5" : "1"}
            transform={`rotate(${a} 24 24)`}
          />
        ))}
        <g transform={`rotate(${-bearing} 24 24)`}>
          <polygon
            points="24,6 21,24 24,21 27,24"
            fill="#ef4444"
          />
          <polygon
            points="24,42 21,24 24,27 27,24"
            fill="rgba(255,255,255,0.6)"
          />
          <circle
            cx="24"
            cy="24"
            r="2.5"
            fill="rgba(255,255,255,0.9)"
          />
        </g>
        <text
          x="24"
          y="15"
          textAnchor="middle"
          fill="#ef4444"
          fontSize="7"
          fontWeight="800"
          fontFamily="sans-serif"
        >
          N
        </text>
        <text
          x="24"
          y="38"
          textAnchor="middle"
          fill="rgba(255,255,255,0.5)"
          fontSize="6"
          fontFamily="sans-serif"
        >
          S
        </text>
        <text
          x="10"
          y="26"
          textAnchor="middle"
          fill="rgba(255,255,255,0.5)"
          fontSize="6"
          fontFamily="sans-serif"
        >
          W
        </text>
        <text
          x="38"
          y="26"
          textAnchor="middle"
          fill="rgba(255,255,255,0.5)"
          fontSize="6"
          fontFamily="sans-serif"
        >
          E
        </text>
      </svg>
    </div>
  );
}

export default CompassRose;

