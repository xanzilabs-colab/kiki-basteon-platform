import { describe, expect, it } from "vitest";
import { reportMapTiles } from "./reportMap";

describe("reportMapTiles", () => {
  it("centers the selected point in the preview and returns a complete tile grid", () => {
    const tiles = reportMapTiles(0, 0);
    const center = tiles.find((tile) => tile.key === "14/8192/8192");

    expect(tiles).toHaveLength(8);
    expect(center).toMatchObject({ left: 0, top: 0 });
  });

  it("wraps longitude at the date line instead of requesting an invalid tile", () => {
    const tiles = reportMapTiles(0, 180);

    expect(tiles).toHaveLength(8);
    expect(tiles.every((tile) => !tile.key.includes("/16384/"))).toBe(true);
  });
});
