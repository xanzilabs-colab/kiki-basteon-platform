import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  admin: vi.fn(),
  fail: vi.fn((error: string, status: number) => Response.json({ error }, { status })),
  sameOrigin: vi.fn(),
  checkPin: vi.fn(),
  hashPin: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/app/api/calm/_shared", () => ({
  authenticated: mocks.authenticated,
  admin: mocks.admin,
  fail: mocks.fail,
}));
vi.mock("@/lib/verification/http", () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock("@/lib/account/securityPin.server", () => ({
  checkAccountPin: mocks.checkPin,
  hashAccountPin: mocks.hashPin,
}));

import { GET, POST } from "./route";

function setup(configured = false) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: mocks.maybeSingle,
    upsert: mocks.upsert,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const db = { from: vi.fn(() => query) };
  mocks.admin.mockReturnValue(db);
  mocks.maybeSingle.mockResolvedValue({ data: configured ? { user_id: "owner-1" } : null, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  return { db, query };
}

function request(body: unknown) {
  return new Request("https://kiki.example/api/account/security/pin", {
    method: "POST",
    headers: { origin: "https://kiki.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("account security PIN route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticated.mockResolvedValue({ userId: "owner-1", response: null });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.checkPin.mockResolvedValue({ ok: true, configured: true });
    mocks.hashPin.mockResolvedValue({ salt: "salt", hash: "derived-hash" });
  });

  it("reports whether the authenticated user has a PIN without exposing its hash", async () => {
    setup(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: true });
  });

  it("stores a salted hash and requires the existing PIN when changing it", async () => {
    const { db } = setup(true);

    const response = await POST(request({ currentPin: "1234", pin: "5678" }));

    expect(response.status).toBe(200);
    expect(mocks.checkPin).toHaveBeenCalledWith(db, "owner-1", "1234");
    expect(mocks.hashPin).toHaveBeenCalledWith("5678");
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "owner-1",
      pin_salt: "salt",
      pin_hash: "derived-hash",
      failed_attempts: 0,
    }));
  });

  it("does not replace a PIN when verification of the current PIN fails", async () => {
    setup(true);
    mocks.checkPin.mockResolvedValue({ ok: false, status: 403, error: "That PIN is not correct." });

    const response = await POST(request({ currentPin: "9999", pin: "5678" }));

    expect(response.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects non-numeric or short PINs", async () => {
    setup();

    const response = await POST(request({ pin: "12x" }));

    expect(response.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
