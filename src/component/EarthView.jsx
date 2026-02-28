import { Viewer } from "resium";
import {
  Ion,
  createWorldTerrain,
  IonWorldImagery
} from "cesium";

import "cesium/Build/Cesium/Widgets/widgets.css";

Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxYTY2YTkyNC05MGIzLTQzZGItYjgyYS0wNjE3MTBlZTI5NGQiLCJpZCI6MzkyNzA5LCJpYXQiOjE3NzE2NzE4Mjl9.9lxvVnSIvngd46lswBo_v8lsKNubQ3VxPE2FT-7I-14";

function EarthView() {
  return (
    <Viewer
      full
      terrainProvider={createWorldTerrain()}
      imageryProvider={IonWorldImagery()}
      baseLayerPicker={false}
      sceneModePicker
      navigationHelpButton={false}
      timeline={false}
      animation={false}
      homeButton
      geocoder
    />
  );
}

export default EarthView;