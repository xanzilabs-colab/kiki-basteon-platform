import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), admin: vi.fn(), relation: vi.fn(), profile: vi.fn() }));
vi.mock("../../_shared", () => ({ requireTripUser: mocks.access }));
vi.mock("../../_guardians", () => ({ areCurrentBuddies: mocks.relation }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/app/api/account/buddies/_shared", () => ({ publicBuddyProfile: mocks.profile }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));

import { GET } from "./route";

async function getResponse(id: string) {
  const response = await GET(new Request("https://kiki.test"), { params: Promise.resolve({ id }) });
  if (!response) throw new Error("Guardian trip handler did not return a response");
  return response;
}

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), update: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [builder.select, builder.eq, builder.in, builder.order, builder.limit, builder.update]) method.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

describe("guardian shared trip location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ user: { id: "guardian" } });
    mocks.relation.mockResolvedValue({ allowed: true, error: null });
    mocks.profile.mockResolvedValue({ id: "owner", name: "Buddy", avatarUrl: null });
  });

  it("returns live location only for an accepted buddy while the trip is active", async () => {
    const tables = new Map<string, ReturnType<typeof query>>([
      ["trip_guardians", query({ data: { id: "share", owner_id: "owner", status: "accepted" }, error: null })],
      ["trips", query({ data: {
        id: "trip", owner_id: "owner", status: "active", destination_label: "Home", mode: "walk",
        planned_route: { points: [{ lat: 1, lng: 2 }] }, started_at: "start", expected_arrival_at: "eta",
        next_check_in_at: "check-in", route_watch_state: "normal", risk_score: 0,
      }, error: null })],
      ["trip_locations", query({ data: { lat: 3, lng: 4, accuracy_m: 5, recorded_at: "now" }, error: null })],
      ["trip_checkpoints", query({ data: [{ label: "Library", expected_at: "then", status: "missed", lat: 6, lng: 7 }], error: null })],
      ["trip_events", query({ data: null, error: null })],
    ]);
    mocks.admin.mockReturnValue({ from: vi.fn((table: string) => tables.get(table)) });

    const response = await getResponse("trip");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.trip.latestLocation).toEqual({ lat: 3, lng: 4, accuracy_m: 5, recorded_at: "now" });
    expect(body.trip.missedCheckIns[0].label).toBe("Library");
    expect(mocks.relation).toHaveBeenCalledWith(expect.anything(), "guardian", "owner");
    expect(tables.get("trip_locations")?.order).toHaveBeenCalledWith("recorded_at", { ascending: false });
  });

  it("does not return trip or location data after the buddy relationship ends", async () => {
    const shareQuery = query({ data: { id: "share", owner_id: "owner", status: "accepted" }, error: null });
    const revokeQuery = query({ data: null, error: null });
    mocks.admin.mockReturnValue({
      from: vi.fn().mockReturnValueOnce(shareQuery).mockReturnValueOnce(revokeQuery),
    });
    mocks.relation.mockResolvedValue({ allowed: false, error: null });

    const response = await getResponse("trip");

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("sharing_revoked");
    expect(mocks.admin.mock.results[0].value.from).toHaveBeenCalledTimes(2);
  });
});
