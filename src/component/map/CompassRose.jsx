import { useEffect, useState, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

function CompassRose() {
  const map = useMap();
  const [bearing, setBearing] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartAngleRef = useRef(0);
  const startBearingRef = useRef(0);
  const rafRef = useRef();
  const compassRef = useRef(null);
  const prevBearingRef = useRef(0);

  useEffect(() => {
    // Check if map rotation is supported
    if (!map.getBearing || !map.setBearing) {
      console.warn("Map rotation not supported in this Leaflet version");
      return;
    }

    // Smooth rotation update using requestAnimationFrame
    const updateBearing = () => {
      const currentBearing = map.getBearing() || 0;
      
      // Handle bearing wrap-around for smooth animation
      let diff = currentBearing - prevBearingRef.current;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      
      // Smooth interpolation
      const smoothBearing = prevBearingRef.current + diff * 0.3;
      prevBearingRef.current = smoothBearing;
      setBearing(smoothBearing);
      
      rafRef.current = requestAnimationFrame(updateBearing);
    };

    // Start animation loop
    rafRef.current = requestAnimationFrame(updateBearing);

    // Event listeners for map rotation
    const handleRotate = () => {
      setBearing(map.getBearing() || 0);
      prevBearingRef.current = map.getBearing() || 0;
    };

    map.on("rotate", handleRotate);
    map.on("rotatestart", handleRotate);
    map.on("rotateend", handleRotate);

    return () => {
      map.off("rotate", handleRotate);
      map.off("rotatestart", handleRotate);
      map.off("rotateend", handleRotate);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [map]);

  // Calculate angle from center to mouse position
  const getAngleFromCenter = (clientX, clientY) => {
    if (!compassRef.current) return 0;
    
    const rect = compassRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    
    // Calculate angle in degrees (0° = North/up)
    let angle = Math.atan2(dx, -dy) * 180 / Math.PI;
    angle = (angle + 360) % 360;
    
    return angle;
  };

  // Handle drag start
  const handleDragStart = (e) => {
    e.preventDefault();
    
    // Get initial angle and bearing
    const clientX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
    const clientY = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;
    
    dragStartAngleRef.current = getAngleFromCenter(clientX, clientY);
    startBearingRef.current = bearing;
    setIsDragging(true);
    
    // Change cursor
    document.body.style.cursor = 'grabbing';
  };

  // Handle drag move
  const handleDragMove = (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    
    const clientX = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
    const clientY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;
    
    const currentAngle = getAngleFromCenter(clientX, clientY);
    
    // Calculate angle difference
    let angleDiff = currentAngle - dragStartAngleRef.current;
    
    // Handle angle wrap-around
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;
    
    // Calculate new bearing (reverse direction for intuitive control)
    const newBearing = (startBearingRef.current - angleDiff + 360) % 360;
    
    // Apply rotation to map
    if (map.setBearing) {
      map.setBearing(newBearing);
    }
  };

  // Handle drag end
  const handleDragEnd = (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    setIsDragging(false);
    document.body.style.cursor = '';
  };

  // Reset bearing to north
  const resetNorth = (e) => {
    // Don't reset if we're dragging
    if (isDragging) return;
    
    if (map.setBearing) {
      map.setBearing(0);
      setBearing(0);
      prevBearingRef.current = 0;
    }
  };

  // Format bearing for display
  const bearingFormatted = Math.round(bearing) % 360;
  const direction = bearingFormatted === 0 ? 'N' :
                    bearingFormatted === 90 ? 'E' :
                    bearingFormatted === 180 ? 'S' :
                    bearingFormatted === 270 ? 'W' :
                    bearingFormatted > 0 && bearingFormatted < 90 ? 'NE' :
                    bearingFormatted > 90 && bearingFormatted < 180 ? 'SE' :
                    bearingFormatted > 180 && bearingFormatted < 270 ? 'SW' : 'NW';

  useEffect(() => {
    // Add global event listeners when dragging
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
      window.addEventListener('touchcancel', handleDragEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
      window.removeEventListener('touchcancel', handleDragEnd);
    };
  }, [isDragging]);

  return (
    <div
      ref={compassRef}
      className="compass-rose-container"
      title={`Drag to rotate map • Click to reset north (${bearingFormatted}° ${direction})`}
      onMouseDown={handleDragStart}
      onTouchStart={handleDragStart}
      onClick={resetNorth}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: "absolute",
        bottom: 108,
        right: 10,
        zIndex: 999,
        width: 56,
        height: 56,
        cursor: isDragging ? 'grabbing' : 'grab',
        filter: `drop-shadow(0 4px 16px rgba(0,0,0,0.5))`,
        transition: "filter 0.2s ease, transform 0.2s ease",
        transform: isHovered && !isDragging ? "scale(1.05)" : "scale(1)",
        userSelect: 'none',
        touchAction: 'none', // Prevent scrolling while dragging on touch devices
      }}
    >
      {/* SVG Compass */}
      <svg width="56" height="56" viewBox="0 0 56 56">
        <defs>
          <radialGradient id="compassGradient" cx="28" cy="28" r="27">
            <stop offset="0%" stopColor="rgba(30, 41, 59, 0.98)" />
            <stop offset="100%" stopColor="rgba(15, 23, 42, 0.99)" />
          </radialGradient>
          <radialGradient id="innerGlow" cx="28" cy="28" r="24">
            <stop offset="0%" stopColor="rgba(96, 165, 250, 0.2)" />
            <stop offset="100%" stopColor="rgba(96, 165, 250, 0)" />
          </radialGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
            <feMerge>
              <feMergeNode in="offsetblur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="dropShadow">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.3"/>
          </filter>
        </defs>

        {/* Outer ring with metallic effect */}
        <circle
          cx="28"
          cy="28"
          r="26"
          fill="url(#compassGradient)"
          stroke={isDragging ? "rgba(96, 165, 250, 0.8)" : isHovered ? "rgba(96, 165, 250, 0.4)" : "rgba(255,255,255,0.15)"}
          strokeWidth="1.5"
          style={{ transition: "stroke 0.2s ease" }}
        />

        {/* Inner glow when dragging */}
        {isDragging && (
          <circle
            cx="28"
            cy="28"
            r="24"
            fill="url(#innerGlow)"
          />
        )}

        {/* Decorative inner ring */}
        <circle
          cx="28"
          cy="28"
          r="22"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="0.5"
          strokeDasharray="3 6"
        />

        {/* Degree marks - every 15 degrees */}
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = i * 15;
          const isCardinal = i % 6 === 0; // N, E, S, W
          const isHalfCardinal = i % 3 === 0; // NE, SE, SW, NW
          const length = isCardinal ? 6 : isHalfCardinal ? 4 : 2.5;
          const strokeWidth = isCardinal ? 1.5 : isHalfCardinal ? 1.2 : 0.8;
          
          const x1 = 28 + 21 * Math.sin((angle * Math.PI) / 180);
          const y1 = 28 - 21 * Math.cos((angle * Math.PI) / 180);
          const x2 = 28 + (21 - length) * Math.sin((angle * Math.PI) / 180);
          const y2 = 28 - (21 - length) * Math.cos((angle * Math.PI) / 180);
          
          return (
            <line
              key={angle}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isCardinal ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)"}
              strokeWidth={strokeWidth}
            />
          );
        })}

        {/* Bearing indicator with smooth rotation */}
        <g
          transform={`rotate(${-bearing} 28 28)`}
          style={{ transition: isDragging ? "none" : "transform 0.1s linear" }}
        >
          {/* North arrow - premium design */}
          <path
            d="M28,8 L24,24 L28,21 L32,24 Z"
            fill="#ef4444"
            filter="url(#glow)"
          />
          <path
            d="M28,11 L25,24 L28,22 L31,24 Z"
            fill="#f87171"
          />
          
          {/* South indicator */}
          <path
            d="M28,48 L24,32 L28,35 L32,32 Z"
            fill="rgba(255,255,255,0.25)"
          />
          
          {/* East/West indicators */}
          <circle cx="42" cy="28" r="2" fill="rgba(255,255,255,0.2)" />
          <circle cx="14" cy="28" r="2" fill="rgba(255,255,255,0.2)" />
          
          {/* Center pivot with depth */}
          <circle
            cx="28"
            cy="28"
            r="4"
            fill="rgba(255,255,255,0.95)"
            stroke="rgba(15,23,42,0.8)"
            strokeWidth="1.2"
            filter="url(#dropShadow)"
          />
          <circle
            cx="28"
            cy="28"
            r="2"
            fill="rgba(96,165,250,0.8)"
          />
        </g>

        {/* Cardinal direction labels */}
        <text
          x="28"
          y="15"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ef4444"
          fontSize="9"
          fontWeight="800"
          fontFamily="'Segoe UI', Arial, sans-serif"
          letterSpacing="0.5"
        >
          N
        </text>
        <text
          x="28"
          y="43"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.6)"
          fontSize="8"
          fontWeight="600"
          fontFamily="'Segoe UI', Arial, sans-serif"
        >
          S
        </text>
        <text
          x="12"
          y="28"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.6)"
          fontSize="8"
          fontWeight="600"
          fontFamily="'Segoe UI', Arial, sans-serif"
        >
          W
        </text>
        <text
          x="44"
          y="28"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.6)"
          fontSize="8"
          fontWeight="600"
          fontFamily="'Segoe UI', Arial, sans-serif"
        >
          E
        </text>

        {/* Bearing display ring - appears when dragging */}
        {isDragging && (
          <circle
            cx="28"
            cy="28"
            r="27"
            fill="none"
            stroke="rgba(96,165,250,0.3)"
            strokeWidth="2"
            strokeDasharray="4 4"
            style={{ animation: "spin 8s linear infinite" }}
          />
        )}
      </svg>

      {/* Bearing indicator strip (appears on hover/drag) */}
      {(isHovered || isDragging) && (
        <div
          style={{
            position: "absolute",
            bottom: -20,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(15,23,42,0.95)",
            color: "#60a5fa",
            padding: "2px 8px",
            borderRadius: 12,
            fontSize: 9,
            fontWeight: 600,
            fontFamily: "monospace",
            border: "1px solid rgba(96,165,250,0.3)",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            pointerEvents: "none",
            zIndex: 1000,
          }}
        >
          {bearingFormatted}° {direction}
          {isDragging && " • Drag to rotate"}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default CompassRose;