export const MAP_BASE_LAYERS = [
  {
    name: "Positron",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors &copy; <a href="https://carto.com">CARTO</a>',
    subdomains: "abcd",
    maxNativeZoom: 20,
    maxZoom: 20,
  },
  {
    name: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    subdomains: "abc",
    maxNativeZoom: 19,
    maxZoom: 20,
  },
  {
    name: "Dark Matter",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors &copy; <a href="https://carto.com">CARTO</a>',
    subdomains: "abcd",
    maxNativeZoom: 20,
    maxZoom: 20,
  },
] as const;

export type MapBaseLayerName = (typeof MAP_BASE_LAYERS)[number]["name"];
