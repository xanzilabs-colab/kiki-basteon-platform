import { describe, expect, it } from "vitest";
import { filterNearbyResponders, selectDiscoveryOrganisations } from "./nearbyResponders";

const now = Date.parse("2026-01-01T12:00:00Z");
const origin = { lat: -26.2, lng: 28.0 };
const fresh = "2026-01-01T11:58:00Z";
const presence = (user_id: string, over: Record<string, unknown> = {}) => ({
  user_id, organisation_id: "o1", availability: "available", last_lat: -26.21, last_lng: 28.01, last_seen_at: fresh, ...over,
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
        presence("stale", { last_seen_at: "2026-01-01T10:00:00Z" }),
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
  it("prefers linked organisations and falls back to partners", () => {
    const orgs = [{ id: "o1", is_partner: false, status: "active" }, { id: "p1", is_partner: true, status: "active" }, { id: "p2", is_partner: true, status: "suspended" }];
    expect(selectDiscoveryOrganisations(["o1"], orgs, now).organisations.map((o) => o.id)).toEqual(["o1"]);
    const fallback = selectDiscoveryOrganisations([], orgs, now);
    expect(fallback.scope).toBe("partners");
    expect(fallback.organisations.map((o) => o.id)).toEqual(["p1"]);
  });
});
