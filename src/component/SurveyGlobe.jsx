import { useRef } from "react";
import Globe from "react-globe.gl";

function SurveyGlobe() {
  const globeRef = useRef(null);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(circle at top, #1f2937, #020617)",
      }}
    >
      <Globe
        ref={globeRef}
        width={window.innerWidth}
        height={window.innerHeight}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        atmosphereColor="#60a5fa"
        atmosphereAltitude={0.2}
      />
    </div>
  );
}

export default SurveyGlobe;

