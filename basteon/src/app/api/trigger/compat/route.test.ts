import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/trigger/compat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
    body: JSON.stringify(body),
  });
}

describe("anonymous compatibility reports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires explicit opt-in and stores aggregate signatures without accessory IDs", async () => {
    const db = fakeSupabase(() => ({}));
    mocks.admin.mockReturnValue(db.client);
    const response = await POST(request({
      opt_in: true,
      phone_model: "Test phone",
      android_sdk: 35,
      accessory_kind: "earbuds",
      signatures: [{ prompted: 3, signature: "TTT", reliability: 1, grade: "A" }],
    }));
    expect(response.status).toBe(201);
    expect(db.calls[0].action).toBe("insert");
    expect(JSON.stringify(db.calls[0].payload)).not.toContain("198.51.100.10");
    expect(JSON.stringify(db.calls[0].payload)).not.toContain("deviceRef");
  });

  it("rejects reports without opt-in and malformed signatures", async () => {
    const db = fakeSupabase(() => ({}));
    mocks.admin.mockReturnValue(db.client);
    expect((await POST(request({
      opt_in: false,
      accessory_kind: "earbuds",
      signatures: [],
    }))).status).toBe(400);
    expect((await POST(request({
      opt_in: true,
      accessory_kind: "earbuds",
      signatures: [{ prompted: 3, signature: "MAC-ADDRESS", reliability: 1, grade: "A" }],
    }))).status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });
});
