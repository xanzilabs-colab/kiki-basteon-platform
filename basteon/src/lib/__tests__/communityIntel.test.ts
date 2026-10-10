import { describe, expect, it } from "vitest";
import { buildMessage, classifyZone, corroboration, intelConfig, sanitizeSummary, shouldAlert, type IntelRecord } from "../communityIntel";

const cfg = intelConfig({});
const now = Date.parse("2026-01-01T12:00:00Z");
const rec = (over: Partial<IntelRecord> = {}): IntelRecord => ({ id: "a", kind: "road_hazard", lat: -26.2, lng: 28.04, summary: "", status: "unverified", reporterId: "u1", incidentAt: new Date(now - 600_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), ...over });

describe("communityIntel", () => {
  it("strips contact details", () => {
    const out = sanitizeSummary("call +27 82 123 4567 or a@b.co @bob https://x.y/z");
    expect(out).not.toMatch(/\d{5}|@b\.co|bob|https/);
  });
  it("classifies zones and respects config bounds", () => {
    expect(classifyZone(100, cfg)).toBe("near");
    expect(classifyZone(800, cfg)).toBe("outer");
    expect(classifyZone(5000, cfg)).toBeNull();
    expect(intelConfig({ SAFETY_INTEL_OUTER_RADIUS_M: "abc" }).outerM).toBe(1000);
  });
  it("dedupes within cooldown, allows after cooldown and for another zone", () => {
    const history = [{ recordId: "a", zone: "outer" as const, sentAt: now - 60_000 }];
    expect(shouldAlert(rec(), "outer", history, cfg, now)).toBe(false);
    expect(shouldAlert(rec(), "near", history, cfg, now)).toBe(true);
    const longLived = rec({ expiresAt: new Date(now + 2 * cfg.cooldownMs).toISOString() });
    expect(shouldAlert(longLived, "outer", history, cfg, now + cfg.cooldownMs + 1)).toBe(true);
  });
  it("never alerts for expired or rejected records", () => {
    expect(shouldAlert(rec({ expiresAt: new Date(now - 1).toISOString() }), "near", [], cfg, now)).toBe(false);
    expect(shouldAlert(rec({ status: "rejected" }), "near", [], cfg, now)).toBe(false);
  });
  it("counts distinct reporters only", () => {
    const a = rec();
    expect(corroboration(a, [a, rec({ id: "b" })], cfg, now)).toBe(1);
    expect(corroboration(a, [a, rec({ id: "b", reporterId: "u2" })], cfg, now)).toBe(2);
  });
  it("only claims verification or multiple reports when true", () => {
    const single = buildMessage(rec(), "near", 1, now).body;
    expect(single).not.toMatch(/verified|reports/);
    expect(single).toMatch(/hasn't been independently confirmed/);
    expect(buildMessage(rec(), "near", 3, now).body).toMatch(/3 community reports/);
    expect(buildMessage(rec({ status: "verified" }), "outer", 1, now).body).toMatch(/verified/);
  });
});
