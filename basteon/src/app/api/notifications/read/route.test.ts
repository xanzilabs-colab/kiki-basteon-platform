import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { POST } from "./route";

function builder() {
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  for (const method of ["update", "eq", "is"]) query[method] = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
  return query;
}

function request(body: unknown) {
  return new Request("http://localhost/api/notifications/read", { method: "POST", headers: { origin: "http://localhost", "x-forwarded-host": "localhost", "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("mark notifications read", () => {
  let query: ReturnType<typeof builder>;
  beforeEach(() => {
    vi.clearAllMocks();
    query = builder();
    mocks.admin.mockReturnValue({ from: vi.fn(() => query) });
    mocks.user.mockResolvedValue({ data: { user: { id: "owner" } } });
  });

  it("marks a single notification scoped to the signed-in user", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect((await POST(request({ id }))).status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(query.eq).toHaveBeenCalledWith("id", id);
    expect(query.is).toHaveBeenCalledWith("read_at", null);
  });

  it("marks all unread notifications for the user", async () => {
    expect((await POST(request({ all: true }))).status).toBe(200);
    expect(query.eq).toHaveBeenCalledTimes(1);
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
  });

  it("rejects unauthenticated and malformed requests", async () => {
    expect((await POST(request({ id: "not-a-uuid" }))).status).toBe(400);
    mocks.user.mockResolvedValue({ data: { user: null } });
    expect((await POST(request({ all: true }))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
