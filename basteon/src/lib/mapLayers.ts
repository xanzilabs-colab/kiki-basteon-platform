import L from "leaflet";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "./mapLayerOptions";

export { MAP_BASE_LAYERS, type MapBaseLayerName } from "./mapLayerOptions";

export function installMapBaseLayers(map: L.Map) {
  const layers = MAP_BASE_LAYERS.map((config) => ({
    config,
    layer: L.tileLayer(config.url, {
      attribution: config.attribution,
      subdomains: config.subdomains,
      maxNativeZoom: config.maxNativeZoom,
      maxZoom: config.maxZoom,
    }),
  }));
  const defaultLayer = layers[0];
  if (!defaultLayer) throw new Error("At least one base map layer must be configured.");

  defaultLayer.layer.addTo(map);
  let activeLayer = defaultLayer;

  return {
    select(name: MapBaseLayerName) {
      const nextLayer = layers.find(({ config }) => config.name === name);
      if (!nextLayer) throw new Error(`Unknown base map layer: ${name}`);
      if (nextLayer === activeLayer) return;
      activeLayer.layer.remove();
      nextLayer.layer.addTo(map);
      activeLayer = nextLayer;
    },
    remove() {
      layers.forEach(({ layer }) => layer.remove());
    },
  };
}
