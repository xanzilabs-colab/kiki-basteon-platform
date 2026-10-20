import L from "leaflet";

export const MAP_BASE_LAYERS = [
  {
    name: "Street",
    url: process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "© OpenStreetMap contributors",
    maxZoom: 19,
  },
  {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
  {
    name: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap",
    maxZoom: 17,
  },
  {
    name: "Humanitarian",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors, Tiles: Humanitarian OpenStreetMap Team",
    maxZoom: 19,
  },
  {
    name: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap contributors, © CARTO",
    maxZoom: 20,
  },
] as const;

export type MapBaseLayerName = (typeof MAP_BASE_LAYERS)[number]["name"];

export function installMapBaseLayers(map: L.Map) {
  const layers = MAP_BASE_LAYERS.map((config) => ({
    config,
    layer: L.tileLayer(config.url, {
      attribution: config.attribution,
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
