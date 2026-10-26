import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  audit: vi.fn(),
  calls: [] as Array<{ table: string; action: string; payload?: unknown }>,
}));

vi.mock("../_shared", () => ({ requireBuddyUser: mocks.access }));
vi.mock("../_audit", () => ({ recordBuddyAudit: mocks.audit }));

import { POST } from "./route";

const trip = {
  id: "trip-id",
  alias: "Kind Meadow",
  avatar: "🌻",
  expires_at: "2026-10-26T12:00:00.000Z",
};

describe("create Travel Together trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { client, calls } = fakeSupabase((call) => {
      if (call.table === "buddy_trips" && call.action === "insert") return { data: trip };
      return {};
    });
    mocks.access.mockResolvedValue({ user: { id: "user-id" }, db: client });
    mocks.audit.mockResolvedValue(undefined);
    mocks.calls = calls;
  });

  it("creates an active, hidden trip and returns its ID for subsequent actions", async () => {
    const response = await POST(jsonRequest("http://localhost/api/buddies/trips", {
      start: { lat: -26.2, lng: 28.0 },
      destination: { lat: -26.1, lng: 28.1 },
      route: [{ lat: -26.2, lng: 28.0 }, { lat: -26.1, lng: 28.1 }],
      mode: "walk",
      leaveFrom: "2026-10-26T08:00:00.000Z",
      maxWaitMinutes: 30,
      maxWalkM: 800,
      groupSize: 3,
      audience: "all_verified",
    }));
    const body = await response.json();
    const insert = mocks.calls.find((call: { table: string; action: string }) => call.table === "buddy_trips" && call.action === "insert");

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ active: true, id: trip.id, visible: false });
    expect(insert?.payload).toMatchObject({ active: true, visible: false, user_id: "user-id" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tripId: trip.id, actorId: "user-id" }));
  });
});
