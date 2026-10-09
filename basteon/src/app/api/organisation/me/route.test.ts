import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/organisation", () => ({
  requireOrganisationAccess: mocks.access,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.admin,
}));

import { GET } from "./route";

const organisationId = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";
const rosterEntryId = "00000000-0000-0000-0000-000000000003";

function setup(linkStatus: "active" | "link_ended") {
  const rosterLink = {
    id: "00000000-0000-0000-0000-000000000004",
    user_id: userId,
    organisation_id: organisationId,
    branch_id: null,
    identifier: "member@example.org",
    membership_type: "member",
    status: linkStatus,
    roster_entry_id: rosterEntryId,
    org_roster_entries: {
      id: rosterEntryId,
      status: "active",
      valid_from: "2020-01-01T00:00:00.000Z",
      valid_until: null,
      claimed_by_user_id: userId,
      max_claims: 1,
      membership_type: "member",
    },
  };
  const db = fakeSupabase((call: FakeCall) => {
    if (call.table === "organisation_user_links" && call.action === "select") return { data: [rosterLink] };
    if (call.table === "organisation_memberships" && call.action === "select") {
      const isReconcileRead = call.filters.some(([op, column]) => op === "eq" && column === "user_id");
      return isReconcileRead
        ? { data: null }
        : { data: [{ id: "membership-1", user_id: userId, role: "member", membership_type: "member", status: "active", profiles: { full_name: "Member", phone: null } }] };
    }
    if (call.table === "organisations" && call.action === "select") return { data: { id: organisationId, status: "active" } };
    return {};
  });
  db.listUsers.mockResolvedValue({
    data: { users: [{ id: userId, email: "member@example.org" }] },
    error: null,
  });
  mocks.admin.mockReturnValue(db.client);
  return db;
}

describe("GET /api/organisation/me roster membership reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ userId, memberships: [{ organisation_id: organisationId }] });
  });

  it("creates the organisation membership for an active roster link", async () => {
    const db = setup("active");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.members[0].profiles.email).toBe("member@example.org");
    expect(db.calls.some((call) =>
      call.table === "organisation_memberships"
      && call.action === "upsert"
      && (call.payload as { status?: string; roster_entry_id?: string }).status === "active"
      && (call.payload as { roster_entry_id?: string }).roster_entry_id === rosterEntryId,
    )).toBe(true);
  });

  it("restores a link ended while its roster entry was inactive after the roster becomes valid again", async () => {
    const db = setup("link_ended");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(db.calls.some((call) =>
      call.table === "organisation_user_links"
      && call.action === "update"
      && (call.payload as { status?: string }).status === "active",
    )).toBe(true);
    expect(db.calls.some((call) =>
      call.table === "org_roster_audit_log"
      && call.action === "insert"
      && (call.payload as { action?: string }).action === "link_restored_from_active_roster",
    )).toBe(true);
  });
});
