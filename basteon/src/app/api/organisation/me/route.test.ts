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

function setup(
  linkStatus: "active" | "link_ended",
  historyHandler: (call: FakeCall) => { data?: unknown; error?: unknown } = () => ({}),
  reconciliationError = false,
) {
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
    if (call.table === "organisation_user_links" && call.action === "select") {
      return reconciliationError
        ? { data: null, error: { message: "roster source temporarily unavailable" } }
        : { data: [rosterLink] };
    }
    if (call.table === "organisation_memberships" && call.action === "select") {
      const isReconcileRead = call.filters.some(([op, column]) => op === "eq" && column === "user_id");
      return isReconcileRead
        ? { data: null }
        : { data: [{ id: "membership-1", user_id: userId, role: "member", membership_type: "member", status: "active", profiles: { full_name: "Member", phone: null } }] };
    }
    if (call.table === "organisations" && call.action === "select") return { data: { id: organisationId, status: "active" } };
    return historyHandler(call);
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

  it("serves an existing active membership when roster reconciliation fails", async () => {
    setup("active", () => ({}), true);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organisation.id).toBe(organisationId);
    expect(body.rosterSyncWarning).toBe(true);
  });

  it("returns responder assignment metrics and audit events", async () => {
    const alertId = "00000000-0000-0000-0000-000000000005";
    const assignmentId = "00000000-0000-0000-0000-000000000006";
    const db = setup("active", (call) => {
      if (call.table === "alert_assignments") {
        return {
          data: [{
            id: assignmentId,
            alert_id: alertId,
            responder_user_id: userId,
            branch_id: null,
            status: "completed",
            assigned_at: "2026-10-12T10:00:00.000Z",
            acknowledged_at: "2026-10-12T10:01:00.000Z",
            completed_at: "2026-10-12T10:05:00.000Z",
            profiles: { full_name: "Responder" },
          }],
        };
      }
      if (call.table === "alert_assignment_events") {
        return {
          data: [{
            id: "event-1",
            alert_id: alertId,
            assignment_id: assignmentId,
            actor_id: userId,
            action: "completed",
            from_status: "on_scene",
            to_status: "completed",
            created_at: "2026-10-12T10:05:00.000Z",
            profiles: { full_name: "Responder" },
          }],
        };
      }
      if (call.table === "alerts") {
        return { data: [{ id: alertId, status: "resolved", triggered_at: "2026-10-12T09:59:00.000Z" }] };
      }
      return { data: [] };
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.responderHistory[0]).toMatchObject({
      alertId,
      responderName: "Responder",
      responseSeconds: 60,
    });
    expect(body.responderPerformance[0]).toMatchObject({
      totalAssignments: 1,
      acceptedAssignments: 1,
      completedAssignments: 1,
      avgAcknowledgeSeconds: 60,
      avgCompletionSeconds: 300,
      successRate: 100,
    });
    expect(body.alertAuditTrail[0]).toMatchObject({
      alertId,
      action: "completed",
      actorName: "Responder",
    });
  });
});
