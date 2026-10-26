import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/time", () => {
  it("returns an uncached server timestamp for client clock synchronization", async () => {
    const before = Date.now();
    const response = await GET();
    const data = await response.json();
    const after = Date.now();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Date.parse(data.now)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(data.now)).toBeLessThanOrEqual(after);
  });
});
