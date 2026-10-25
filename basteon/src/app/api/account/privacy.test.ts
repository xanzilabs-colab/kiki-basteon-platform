import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  admin: vi.fn(),
  sameOrigin: vi.fn(),
  rpc: vi.fn(),
  deleteUser: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  checkPin: vi.fn(),
}));

vi.mock("@/app/api/calm/_shared", () => ({
  authenticated: mocks.authenticated,
  admin: mocks.admin,
  fail: (error: string, status: number) => Response.json({ error }, { status }),
  reportDatabaseFailure: vi.fn(),
}));
vi.mock("@/lib/verification/http", () => ({ sameOrigin: mocks.sameOrigin }));
vi.mock("@/lib/account/securityPin.server", () => ({ checkAccountPin: mocks.checkPin }));

import { DELETE as deleteAccount } from "./delete/route";
import { DELETE as deletePersonalData } from "./my-data/route";

function setup() {
  const db = {
    storage: { from: vi.fn(() => ({ list: mocks.list, remove: mocks.remove })) },
    rpc: mocks.rpc,
    auth: { admin: { deleteUser: mocks.deleteUser } },
  };
  mocks.admin.mockReturnValue(db);
  return db;
}

function request() {
  return new Request("https://kiki.example/api/account/data", {
    method: "DELETE",
    headers: { origin: "https://kiki.example" },
  });
}

describe("account privacy deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sameOrigin.mockReturnValue(true);
    mocks.authenticated.mockResolvedValue({ userId: "owner-1", response: null });
    mocks.checkPin.mockResolvedValue({ ok: true, configured: false });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.deleteUser.mockResolvedValue({ error: null });
    mocks.list.mockResolvedValue({ data: [], error: null });
    mocks.remove.mockResolvedValue({ error: null });
  });

  it("removes the authenticated user's personal data and storage without closing the account", async () => {
    setup();
    const response = await deletePersonalData(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("account_delete_user_data", { p_user_id: "owner-1" });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });

  it("does not delete data when the request is unauthenticated", async () => {
    setup();
    mocks.authenticated.mockResolvedValue({ userId: null, response: Response.json({ error: "unauthorized" }, { status: 401 }) });

    const response = await deletePersonalData(request());

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the configured account PIN before removing personal data", async () => {
    setup();
    mocks.checkPin.mockResolvedValue({ ok: false, status: 428, error: "Enter your Kiki PIN to continue." });

    const response = await deletePersonalData(request());

    expect(response.status).toBe(428);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("closes the account only after data and user storage are removed", async () => {
    setup();
    const response = await deleteAccount(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("account_delete_user_data", { p_user_id: "owner-1" });
    expect(mocks.deleteUser).toHaveBeenCalledWith("owner-1");
  });

  it("keeps the account if private file cleanup fails", async () => {
    setup();
    mocks.list.mockResolvedValue({ data: null, error: new Error("storage unavailable") });

    const response = await deleteAccount(request());

    expect(response.status).toBe(500);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
