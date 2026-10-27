import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ user: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...mocks.database(), auth: { getUser: mocks.user } }),
}));

import { GET } from "./route";

function setup(user: { id: string; email?: string } | null, fullName: string | null = null) {
  const db = fakeSupabase((call) => call.table === "profiles" ? { data: fullName ? { full_name: fullName } : null } : {});
  mocks.database.mockReturnValue(db.client);
  mocks.user.mockResolvedValue({ data: { user }, error: null });
  return db;
}

describe("journal demo PIN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KIKI_JOURNAL_DEMO_PIN;
  });

  afterEach(() => vi.unstubAllEnvs());

  it("only returns the configured server PIN for the allowlisted demo email", async () => {
    const db = setup({ id: "demo-user", email: "Tumishopraise03@gmail.com" }, "Another Name");
    vi.stubEnv("KIKI_JOURNAL_DEMO_PIN", "654321");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pin: "654321" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(db.calls[0].filters).toContainEqual(["eq", "id", "demo-user"]);
  });

  it("also allows the configured demo profile name", async () => {
    setup({ id: "demo-user", email: "other@example.com" }, "  Tumisho Aphane ");
    vi.stubEnv("KIKI_JOURNAL_DEMO_PIN", "654321");

    const response = await GET();

    expect(await response.json()).toEqual({ pin: "654321" });
  });

  it("does not return a PIN for other accounts or when the demo PIN is unset", async () => {
    setup({ id: "other-user", email: "other@example.com" }, "Someone Else");
    vi.stubEnv("KIKI_JOURNAL_DEMO_PIN", "654321");

    expect((await GET()).status).toBe(404);

    setup({ id: "demo-user", email: "tumishopraise03@gmail.com" });
    delete process.env.KIKI_JOURNAL_DEMO_PIN;
    expect(await (await GET()).json()).toEqual({ pin: null });
  });

  it("does not return invalid demo PIN configuration", async () => {
    setup({ id: "demo-user", email: "tumishopraise03@gmail.com" });
    vi.stubEnv("KIKI_JOURNAL_DEMO_PIN", "not-a-pin");

    expect(await (await GET()).json()).toEqual({ pin: null });
  });

  it("rejects unauthenticated requests", async () => {
    const db = setup(null);

    expect((await GET()).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});
