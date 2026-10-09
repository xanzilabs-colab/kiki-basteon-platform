import { describe, expect, it } from "vitest";
import { haversineMeters, pickDispatchRecipients, planAlertTargets, pointInPolygonGeoJson, type CandidateResponder, type RoutingBranch, type RoutingCoverage, type RoutingLink } from "@/lib/alertRouting";

const poly = {
  type: "Polygon",
  coordinates: [[
    [18.40, -33.95],
    [18.50, -33.95],
    [18.50, -33.85],
    [18.40, -33.85],
    [18.40, -33.95],
  ]],
};

const linkedBranches: RoutingBranch[] = [
  { id: "b1", organisation_id: "o1", name: "HQ", lat: -33.91, lng: 18.43, geofence_geojson: poly, is_hq: true, active: true },
  { id: "b2", organisation_id: "o1", name: "North", lat: -33.85, lng: 18.52, geofence_geojson: null, is_hq: false, active: true },
];

const partnerBranches: RoutingBranch[] = [
  { id: "pb1", organisation_id: "p1", name: "Partner HQ", lat: -33.92, lng: 18.44, geofence_geojson: null, is_hq: true, active: true },
];

const linkedCoverage: RoutingCoverage[] = [
  { organisation_id: "o1", branch_id: null, emergency_type_code: "general", priority: 1, active: true },
  { organisation_id: "o1", branch_id: "b1", emergency_type_code: "medical", priority: 1, active: true },
];

const partnerCoverage: RoutingCoverage[] = [
  { organisation_id: "p1", branch_id: null, emergency_type_code: "general", priority: 1, active: true },
  { organisation_id: "p1", branch_id: null, emergency_type_code: "medical", priority: 1, active: true },
];

const links: RoutingLink[] = [{ organisation_id: "o1", branch_id: null, status: "active" }];

describe("alert routing planner", () => {
  it("1. routes to linked organisation with matching coverage", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "general",
      lifeThreat: true,
      lat: -33.90,
      lng: 18.45,
      links,
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets.some((target) => target.organisation_id === "o1" && target.tier === 1)).toBe(true);
  });

  it("2. does not include partners when a linked organisation is a routing target", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "general",
      lifeThreat: true,
      lat: -33.90,
      lng: 18.45,
      links,
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets.some((target) => target.organisation_id === "p1")).toBe(false);
  });

  it("3. skips partner tier for non-life-threatening when linked targets exist", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "general",
      lifeThreat: false,
      lat: -33.90,
      lng: 18.45,
      links,
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets.some((target) => target.organisation_id === "p1")).toBe(false);
  });

  it("4. falls back to partner tier when no linked coverage exists", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "fire",
      lifeThreat: false,
      lat: -33.90,
      lng: 18.45,
      links,
      linkedBranches,
      linkedCoverage: [],
      partnerBranches,
      partnerCoverage: [{ organisation_id: "p1", branch_id: null, emergency_type_code: "fire", priority: 1, active: true }],
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].organisation_id).toBe("p1");
  });

  it("5. respects branch-specific links", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "medical",
      lifeThreat: true,
      lat: -33.90,
      lng: 18.45,
      links: [{ organisation_id: "o1", branch_id: "b1", status: "active" }],
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets.some((target) => target.branch_id === "b1")).toBe(true);
  });

  it("6. excludes out-of-geofence branch-only links", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "medical",
      lifeThreat: true,
      lat: -34.20,
      lng: 18.45,
      links: [{ organisation_id: "o1", branch_id: "b1", status: "active" }],
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets.some((target) => target.organisation_id === "o1" && target.tier === 1)).toBe(false);
  });

  it("7. ignores inactive links", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "general",
      lifeThreat: true,
      lat: -33.90,
      lng: 18.45,
      links: [{ organisation_id: "o1", branch_id: null, status: "pending" }],
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets.some((target) => target.organisation_id === "o1")).toBe(false);
  });

  it("8. deduplicates repeated routing targets", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "general",
      lifeThreat: true,
      lat: -33.90,
      lng: 18.45,
      links: [
        { organisation_id: "o1", branch_id: null, status: "active" },
        { organisation_id: "o1", branch_id: null, status: "active" },
      ],
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets.filter((target) => target.organisation_id === "o1" && target.tier === 1)).toHaveLength(1);
  });

  it("9. sorts by tier ascending", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "general",
      lifeThreat: true,
      lat: -33.90,
      lng: 18.45,
      links,
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets[0].tier).toBe(1);
  });

  it("10. uses closest branch when geofence is absent", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "general",
      lifeThreat: false,
      lat: -33.85,
      lng: 18.52,
      links,
      linkedBranches: [
        { id: "x1", organisation_id: "o1", name: "Far", lat: -33.50, lng: 18.80, geofence_geojson: null, is_hq: false, active: true },
        { id: "x2", organisation_id: "o1", name: "Near", lat: -33.85, lng: 18.52, geofence_geojson: null, is_hq: false, active: true },
      ],
      linkedCoverage: [{ organisation_id: "o1", branch_id: null, emergency_type_code: "general", priority: 1, active: true }],
      partnerBranches,
      partnerCoverage,
    });
    expect(targets[0].branch_id).toBe("x2");
  });

  it("11. accepts null location and still routes linked coverage", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "general",
      lifeThreat: false,
      lat: null,
      lng: null,
      links,
      linkedBranches,
      linkedCoverage,
      partnerBranches,
      partnerCoverage,
    });
    expect(targets.some((target) => target.organisation_id === "o1")).toBe(true);
  });

  it("12. requires partner branch geofence match when coverage is branch-scoped", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "medical",
      lifeThreat: true,
      lat: -34.30,
      lng: 18.90,
      links: [],
      linkedBranches: [],
      linkedCoverage: [],
      partnerBranches: [{ id: "pb2", organisation_id: "p1", name: "Geo", lat: null, lng: null, geofence_geojson: poly, is_hq: false, active: true }],
      partnerCoverage: [{ organisation_id: "p1", branch_id: "pb2", emergency_type_code: "medical", priority: 1, active: true }],
    });
    expect(targets).toHaveLength(0);
  });

  it("13. routes partner branch when branch geofence matches", () => {
    const targets = planAlertTargets({
      emergencyTypeCode: "medical",
      lifeThreat: true,
      lat: -33.90,
      lng: 18.45,
      links: [],
      linkedBranches: [],
      linkedCoverage: [],
      partnerBranches: [{ id: "pb2", organisation_id: "p1", name: "Geo", lat: null, lng: null, geofence_geojson: poly, is_hq: false, active: true }],
      partnerCoverage: [{ organisation_id: "p1", branch_id: "pb2", emergency_type_code: "medical", priority: 1, active: true }],
    });
    expect(targets[0]?.branch_id).toBe("pb2");
  });

  it("14. point in polygon works for interior point", () => {
    expect(pointInPolygonGeoJson(poly, -33.90, 18.45)).toBe(true);
  });

  it("15. point in polygon rejects exterior point", () => {
    expect(pointInPolygonGeoJson(poly, -34.20, 18.45)).toBe(false);
  });

  it("16. haversine distance is positive and bounded", () => {
    const d = haversineMeters(-33.90, 18.45, -33.91, 18.46);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(2_000);
  });
});

describe("dispatch recipient selection", () => {
  it("prefers available responder in branch", () => {
    const recipients = pickDispatchRecipients([
      { user_id: "u1", branch_id: "b1", role: "responder", availability: "available", last_seen_at: "2026-01-01T00:00:00Z" },
      { user_id: "u2", branch_id: "b1", role: "manager", availability: null, last_seen_at: null },
    ] satisfies CandidateResponder[], ["b1"]);
    expect(recipients.map((recipient) => recipient.user_id)).toEqual(["u1"]);
  });

  it("falls back to managers when no responder is available", () => {
    const recipients = pickDispatchRecipients([
      { user_id: "u1", branch_id: "b1", role: "responder", availability: "off_duty", last_seen_at: "2026-01-01T00:00:00Z" },
      { user_id: "u2", branch_id: "b1", role: "manager", availability: null, last_seen_at: null },
    ] satisfies CandidateResponder[], ["b1"]);
    expect(recipients.map((recipient) => recipient.user_id)).toEqual(["u2"]);
  });

  it("filters out responders from other branches", () => {
    const recipients = pickDispatchRecipients([
      { user_id: "u1", branch_id: "b2", role: "responder", availability: "available", last_seen_at: "2026-01-01T00:00:00Z" },
      { user_id: "u2", branch_id: "b1", role: "manager", availability: null, last_seen_at: null },
    ] satisfies CandidateResponder[], ["b1"]);
    expect(recipients.map((recipient) => recipient.user_id)).toEqual(["u2"]);
  });
});
