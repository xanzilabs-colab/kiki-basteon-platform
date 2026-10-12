import { describe, expect, it } from "vitest";
import { countAvailableResponders, filterNearbyResponders, selectDiscoveryOrganisations } from "./nearbyResponders";

const now = Date.parse("2026-01-01T12:00:00Z");
const origin = { lat: -26.2, lng: 28.0 };
const fresh = "2026-01-01T11:58:00Z";
const presence = (user_id: string, over: Record<string, unknown> = {}) => ({
  user_id, organisation_id: "o1", availability: "available", last_lat: -26.21, last_lng: 28.01, last_seen_at: fresh, last_location_at: fresh, ...over,
});
const member = (user_id: string, over: Record<string, unknown> = {}) => ({ user_id, organisation_id: "o1", role: "responder", status: "active", ...over });
const run = (p: ReturnType<typeof presence>[], m: ReturnType<typeof member>[], orgs = ["o1"]) =>
  filterNearbyResponders({ origin, organisationIds: orgs, presence: p, memberships: m, now });

describe("nearby responders", () => {
  it("counts available in-radius responders", () => {
    expect(run([presence("a")], [member("a")])).toHaveLength(1);
  });
  it("excludes outside radius, off duty, stale, missing location, non-responders and other orgs", () => {
    const result = run(
      [
        presence("far", { last_lat: -25.0 }),
        presence("off", { availability: "off_duty" }),
        presence("stale", { last_seen_at: "2026-01-01T10:00:00Z", last_location_at: "2026-01-01T10:00:00Z" }),
        presence("noloc", { last_lat: null }),
        presence("viewer"),
        presence("other", { organisation_id: "o2" }),
        presence("suspended"),
      ],
      [member("far"), member("off"), member("stale"), member("noloc"), member("viewer", { role: "viewer" }), member("other", { organisation_id: "o2" }), member("suspended", { status: "suspended" })],
    );
    expect(result).toHaveLength(0);
  });
  it("deduplicates responders", () => {
    expect(run([presence("a"), presence("a")], [member("a")])).toHaveLength(1);
  });
  it("counts active on-duty responders without requiring location sharing", () => {
    const onDuty = [
      presence("located"),
      presence("no-location", { last_lat: null, last_lng: null }),
      presence("stale", { last_seen_at: "2026-01-01T10:00:00Z" }),
      presence("other-org", { organisation_id: "o2" }),
      presence("inactive", { user_id: "inactive" }),
    ];
    const memberships = [
      member("located"),
      member("no-location"),
      member("stale"),
      member("other-org", { organisation_id: "o2" }),
      member("inactive", { status: "suspended" }),
    ];
    expect(countAvailableResponders({
      organisationIds: ["o1"],
      presence: onDuty,
      memberships,
      now,
    })).toBe(2);
  });
  it("keeps a responder on duty while rejecting a GPS fix that has gone stale", () => {
    const responder = presence("walking", {
      last_seen_at: "2026-01-01T11:59:00Z",
      last_location_at: "2026-01-01T11:30:00Z",
    });
    expect(countAvailableResponders({
      organisationIds: ["o1"],
      presence: [responder],
      memberships: [member("walking")],
      now,
    })).toBe(1);
    expect(run([responder], [member("walking")])).toHaveLength(0);
  });
  it("does not treat a fresh heartbeat as a fresh GPS fix when a stationary responder's location was not republished", () => {
    const stationary = presence("stationary", {
      last_seen_at: "2026-01-01T11:59:55Z",
      last_location_at: "2026-01-01T11:30:00Z",
    });
    expect(countAvailableResponders({
      organisationIds: ["o1"],
      presence: [stationary],
      memberships: [member("stationary")],
      now,
    })).toBe(1);
    expect(run([stationary], [member("stationary")])).toHaveLength(0);
  });
  it("prefers linked organisations and falls back to partners", () => {
    const orgs = [{ id: "o1", is_partner: false, status: "active" }, { id: "p1", is_partner: true, status: "active" }, { id: "p2", is_partner: true, status: "suspended" }];
    expect(selectDiscoveryOrganisations(["o1"], orgs, now).organisations.map((o) => o.id)).toEqual(["o1"]);
    const fallback = selectDiscoveryOrganisations([], orgs, now);
    expect(fallback.scope).toBe("partners");
    expect(fallback.organisations.map((o) => o.id)).toEqual(["p1"]);
  });
});
