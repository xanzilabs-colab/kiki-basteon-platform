import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { validateAndLinkOrganisation } from "@/lib/orgLinkValidation";
import { normalizeIdentifierInput, normalizeRosterIdentifier } from "@/lib/orgRoster";

type Scenario = {
  attempts?: number;
  failures?: number;
  organisation?: { id: string; status: string; blocked_until: string | null } | null;
  requireInvite?: boolean;
  entry?: any | null;
  claimCount?: number;
};

function filterValue(call: FakeCall, op: string, column: string) {
  return call.filters.find((f) => f[0] === op && f[1] === column)?.[2];
}

function setupScenario(s: Scenario) {
  const scenario: Required<Scenario> = {
    attempts: s.attempts ?? 0,
    failures: s.failures ?? 0,
    organisation: s.organisation ?? { id: "org-1", status: "active", blocked_until: null },
    requireInvite: s.requireInvite ?? false,
    entry: Object.prototype.hasOwnProperty.call(s, "entry") ? (s.entry as any) : {
      id: "entry-1",
      membership_type: "member",
      status: "active",
      valid_from: "2020-01-01T00:00:00.000Z",
      valid_until: null,
      max_claims: 1,
      claimed_by_user_id: null,
      claimed_at: null,
    },
    claimCount: s.claimCount ?? 0,
  };
  const db = fakeSupabase((call: FakeCall) => {
    if (call.table === "org_link_validation_attempts" && call.action === "select") {
      const failureFilter = filterValue(call, "eq", "success");
      return { count: failureFilter === false ? scenario.failures : scenario.attempts };
    }
    if (call.table === "organisations" && call.action === "select") return { data: scenario.organisation };
    if (call.table === "organisation_link_settings" && call.action === "select") {
      return { data: { require_invite: scenario.requireInvite, auto_approve_links: !scenario.requireInvite, roster_id_case_mode: "upper" } };
    }
    if (call.table === "org_roster_entries" && call.action === "select") return { data: scenario.entry };
    if (call.table === "org_roster_entries" && call.action === "update") return { data: { id: "entry-1" } };
    if (call.table === "organisation_user_links" && call.action === "select") return { count: scenario.claimCount };
    return {};
  });
  mocks.admin.mockReturnValue(db.client);
}

const baseInput = {
  userId: "user-1",
  organisationId: "org-1",
  branchId: null,
  identifierType: "email" as const,
  identifier: " member@example.org ",
  label: "work" as const,
  placeAddress: null,
  ipAddress: "127.0.0.1",
};

describe("validateAndLinkOrganisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("roster identifier normalization", () => {
    it("normalizes email case, compatibility characters, and zero-width characters", () => {
      expect(normalizeRosterIdentifier("  USER\u200B@Ｅxample.org ", "email")).toBe("user@example.org");
    });

    it("applies organisation ID case mode without losing leading zeroes", () => {
      expect(normalizeRosterIdentifier("  ００12ab  ", "member_id", "upper")).toBe("0012AB");
      expect(normalizeRosterIdentifier("Aa-01", "member_id", "lower")).toBe("aa-01");
      expect(normalizeRosterIdentifier("Aa-01", "member_id", "as_is")).toBe("Aa-01");
    });

    it("strips zero-width spaces rather than inserting an identifier separator", () => {
      expect(normalizeIdentifierInput("AB\u200BCD")).toBe("ABCD");
    });
  });

  it("returns LINKED when a matching active roster entry can be claimed", async () => {
    setupScenario({});
    const result = await validateAndLinkOrganisation(baseInput);
    expect(result.code).toBe("LINKED");
  });

  it("returns NOT_ELIGIBLE when no matching roster entry exists", async () => {
    setupScenario({ entry: null });
    const result = await validateAndLinkOrganisation(baseInput);
    expect(result.code).toBe("NOT_ELIGIBLE");
  });

  it("returns EXPIRED when an entry is out of its validity window", async () => {
    setupScenario({
      entry: {
        id: "entry-1",
        membership_type: "member",
        status: "active",
        valid_from: "2020-01-01T00:00:00.000Z",
        valid_until: "2020-01-02T00:00:00.000Z",
        max_claims: 1,
        claimed_by_user_id: null,
        claimed_at: null,
      },
    });
    const result = await validateAndLinkOrganisation(baseInput);
    expect(result.code).toBe("EXPIRED");
  });

  it("returns NOT_ELIGIBLE when the roster entry is removed", async () => {
    setupScenario({
      entry: {
        id: "entry-1",
        membership_type: "member",
        status: "removed",
        valid_from: "2020-01-01T00:00:00.000Z",
        valid_until: null,
        max_claims: 1,
        claimed_by_user_id: null,
        claimed_at: null,
      },
    });
    const result = await validateAndLinkOrganisation(baseInput);
    expect(result.code).toBe("NOT_ELIGIBLE");
  });

  it("returns ALREADY_CLAIMED when claimed by another user", async () => {
    setupScenario({
      entry: {
        id: "entry-1",
        membership_type: "member",
        status: "active",
        valid_from: "2020-01-01T00:00:00.000Z",
        valid_until: null,
        max_claims: 1,
        claimed_by_user_id: "someone-else",
        claimed_at: "2026-01-01T00:00:00.000Z",
      },
    });
    const result = await validateAndLinkOrganisation(baseInput);
    expect(result.code).toBe("ALREADY_CLAIMED");
  });

  it("returns RATE_LIMITED after repeated failures", async () => {
    setupScenario({ failures: 6 });
    const result = await validateAndLinkOrganisation(baseInput);
    expect(result.code).toBe("RATE_LIMITED");
  });

  it("returns PENDING_APPROVAL when org requires manual approval", async () => {
    setupScenario({ requireInvite: true });
    const result = await validateAndLinkOrganisation(baseInput);
    expect(result.code).toBe("PENDING_APPROVAL");
  });

  it("links a roster-listed email without email verification", async () => {
    setupScenario({});
    const result = await validateAndLinkOrganisation({
      ...baseInput,
      identifier: "someone-else@example.org",
    });
    expect(result.code).toBe("LINKED");
  });

  it("links non-email roster identifiers immediately when auto-approval is enabled", async () => {
    setupScenario({});
    const result = await validateAndLinkOrganisation({
      ...baseInput,
      identifierType: "member_id",
      identifier: "AB-123",
    });
    expect(result.code).toBe("LINKED");
  });
});
