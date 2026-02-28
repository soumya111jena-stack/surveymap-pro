import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import JSZip from "jszip";
import omnivore from "@mapbox/leaflet-omnivore";

function KMZLoader({ file, onDone }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!file) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    JSZip.loadAsync(file).then(async (zip) => {
      const kmlName = Object.keys(zip.files).find((f) => f.endsWith(".kml"));
      if (!kmlName) {
        alert("KMZ has no KML inside");
        onDone();
        return;
      }

      const kmlText = await zip.files[kmlName].async("text");

      const parser = new DOMParser();
      const xml = parser.parseFromString(kmlText, "text/xml");

      const styleMap = {};

      xml.querySelectorAll("Style").forEach((style) => {
        const id = style.getAttribute("id");

        const iconHref =
          style.querySelector("IconStyle Icon href")?.textContent;
        const fillColor = style.querySelector("PolyStyle color")?.textContent;
        const lineColor = style.querySelector("LineStyle color")?.textContent;
        const lineWidth = style.querySelector("LineStyle width")?.textContent;

        styleMap[id] = {
          icon: iconHref,
          fill: fillColor,
          stroke: lineColor,
          width: lineWidth,
        };
      });

      const geojson = omnivore.kml.parse(kmlText).toGeoJSON();

      geojson.features.forEach((f) => {
        const styleUrl = f.properties?.styleUrl?.replace("#", "");
        if (styleMap[styleUrl]) {
          f.properties.icon = styleMap[styleUrl].icon;
          f.properties.fill = styleMap[styleUrl].fill;
          f.properties.stroke = styleMap[styleUrl].stroke;
          f.properties["stroke-width"] = styleMap[styleUrl].width;
        }
      });

      layerRef.current = L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) =>
          L.marker(latlng, {
            icon: L.icon({
              iconUrl:
                "https://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png",
              iconSize: [32, 32],
            }),
          }),
        style: () => ({
          color: "#facc15",
          weight: 2,
          fillColor: "#3b82f6",
          fillOpacity: 0.4,
        }),
      }).addTo(map);

      map.fitBounds(layerRef.current.getBounds());
      onDone();
    });

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [file, map, onDone]);

  return null;
}

export default KMZLoader;

