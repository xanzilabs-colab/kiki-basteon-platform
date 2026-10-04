import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), admin: vi.fn() }));
vi.mock("./_shared", () => ({ requireTripUser: mocks.access }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { GET } from "./route";

async function getResponse() {
  const response = await GET();
  if (!response) throw new Error("Trip activity did not return a response");
  return response;
}

function query(result: unknown) {
  const builder = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [builder.select, builder.eq, builder.in, builder.order, builder.limit]) method.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

describe("owner trip activity", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: "owner" } }); });

  it("returns saved destination coordinates and scopes both queries to the owner", async () => {
    const recent = [{ id: "recent", destination_label: "Saved destination", destination_lat: -26.2, destination_lng: 28.04, mode: "walk", status: "arrived" }];
    const activeQuery = query({ data: { id: "active" }, error: null });
    const recentQuery = query({ data: recent });
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(activeQuery).mockReturnValueOnce(recentQuery) });
    const response = await getResponse();
    expect(await response.json()).toEqual({ trip: { id: "active" }, recent });
    expect(activeQuery.eq).toHaveBeenCalledWith("owner_id", "owner");
    expect(recentQuery.eq).toHaveBeenCalledWith("owner_id", "owner");
    expect(recentQuery.select).toHaveBeenCalledWith("id,destination_label,destination_lat,destination_lng,mode,status,created_at,ended_at");
    expect(recentQuery.limit).toHaveBeenCalledWith(5);
  });

  it("does not query activity when access is denied", async () => {
    mocks.access.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    expect((await getResponse()).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("returns empty activity when there are no saved trips", async () => {
    mocks.admin.mockReturnValue({ from: vi.fn(() => query({ data: null, error: null })) });
    expect(await (await getResponse()).json()).toEqual({ trip: null, recent: [] });
  });
});