import { MAP_BASE_LAYERS } from "@/lib/mapLayerOptions";

const TILE_SIZE = 256;
const DEFAULT_ZOOM = 14;

export type ReportMapTile = { key: string; src: string; left: number; top: number };

export function reportMapTiles(
  lat: number,
  lng: number,
  columns = 4,
  rows = 2,
  zoom = DEFAULT_ZOOM,
): ReportMapTile[] {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const scale = 2 ** zoom;
  const worldX = ((lng + 180) / 360) * scale;
  const latRad = (clampedLat * Math.PI) / 180;
  const worldY = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * scale;
  const centerTileX = Math.floor(worldX);
  const centerTileY = Math.floor(worldY);
  const fractionX = worldX - centerTileX;
  const fractionY = worldY - centerTileY;
  const centerLeft = -fractionX * TILE_SIZE;
  const centerTop = -fractionY * TILE_SIZE;
  const startColumn = columns % 2 === 0
    ? -columns / 2 + (fractionX >= 0.5 ? 1 : 0)
    : -Math.floor(columns / 2);
  const startRow = rows % 2 === 0
    ? -rows / 2 + (fractionY >= 0.5 ? 1 : 0)
    : -Math.floor(rows / 2);
  const layer = MAP_BASE_LAYERS[0];
  const tiles: ReportMapTile[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offsetX = startColumn + column;
      const offsetY = startRow + row;
      const x = ((centerTileX + offsetX) % scale + scale) % scale;
      const y = Math.max(0, Math.min(scale - 1, centerTileY + offsetY));
      const subdomain = ["a", "b", "c"][(x + y) % 3];
      const src = layer.url
        .replace("{s}", subdomain)
        .replace("{z}", String(zoom))
        .replace("{x}", String(x))
        .replace("{y}", String(y))
        .replace("{r}", "");
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        src,
        left: centerLeft + offsetX * TILE_SIZE,
        top: centerTop + offsetY * TILE_SIZE,
      });
    }
  }
  return tiles;
}

export const reportMapAttribution = MAP_BASE_LAYERS[0].attribution;
