import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { GET as getHistory } from "./history/route";
import { DELETE as deleteData } from "./my-data/route";
import { POST as saveSession } from "./session/route";
import { GET as getSettings } from "./settings/route";
import { GET as getTrivia } from "./trivia/route";

const url = "http://localhost/api/calm";
const reviewedTrivia = {
  id: "reviewed-id",
  question: "Which city is known as the Jacaranda City?",
  options: ["Pretoria", "Durban", "Kimberley"],
  answer: 0,
  fact: "Pretoria turns purple every spring.",
};

function setup(handler: (call: FakeCall) => { data?: unknown; error?: unknown } | undefined = () => ({})) {
  const db = fakeSupabase(handler, (name) => name === "consume_intelligence_limit" ? { data: true } : { data: null });
  mocks.admin.mockReturnValue(db.client);
  return db;
}

describe("Calm API privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  });

  it("serves reviewed trivia only and omits review metadata", async () => {
    const db = setup((call) => {
      if (call.table !== "calm_trivia") return {};
      const statusFilter = call.filters.find((filter) => filter[1] === "review_status");
      return { data: statusFilter?.[2] === "reviewed" ? [reviewedTrivia] : [reviewedTrivia, { id: "draft", review_status: "draft" }] };
    });
    const response = await getTrivia(new Request(`${url}/trivia?n=3`));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual([reviewedTrivia]);
    expect(body[0]).not.toHaveProperty("review_status");
    expect(db.calls.find((call) => call.table === "calm_trivia")?.filters).toContainEqual(["eq", "review_status", "reviewed"]);
  });

  it("does not write a session when history is disabled", async () => {
    const db = setup((call) => call.table === "calm_settings" ? { data: { save_history: false } } : {});
    const response = await saveSession(jsonRequest(`${url}/session`, {
      tool: "winds",
      mode: "quiet",
      durationSeconds: 44,
      completed: true,
      ratingBefore: 2,
      ratingAfter: 4,
      payload: { pattern: "slow", factCount: 0 },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: false });
    expect(db.calls.some((call) => call.table === "calm_sessions")).toBe(false);
  });

  it("defaults to private history and stores only validated summaries when opted in", async () => {
    const defaultsDb = setup((call) => call.table === "calm_settings" ? { data: null } : {});
    const defaultsResponse = await getSettings();
    expect(defaultsResponse.status).toBe(200);
    expect(await defaultsResponse.json()).toMatchObject({ saveHistory: false, breathPace: "gentle", breathHolds: false });
    expect(defaultsDb.calls.find((call) => call.table === "calm_settings")?.filters).toContainEqual(["eq", "user_id", "owner-1"]);

    const db = setup((call) => call.table === "calm_settings" ? { data: { save_history: true } } : {});
    const response = await saveSession(jsonRequest(`${url}/session`, {
      tool: "body",
      mode: "check",
      durationSeconds: 30,
      completed: true,
      ratingBefore: null,
      ratingAfter: 4,
      payload: { zones: { shoulders: 2 } },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(db.calls.find((call) => call.table === "calm_sessions")?.payload).toMatchObject({
      user_id: "owner-1",
      tool: "body",
      payload: { zones: { shoulders: 2 } },
    });
  });

  it("rejects invalid session data before writing", async () => {
    const db = setup((call) => call.table === "calm_settings" ? { data: { save_history: true } } : {});
    const response = await saveSession(jsonRequest(`${url}/session`, {
      tool: "body",
      mode: "check",
      durationSeconds: 30,
      completed: true,
      payload: { zones: { shoulders: 4 }, note: "must not be stored" },
    }));
    expect(response.status).toBe(400);
    expect(db.calls.some((call) => call.table === "calm_sessions")).toBe(false);
  });

  it("scopes calm history to the authenticated owner", async () => {
    const db = setup((call) => {
      if (call.table === "calm_settings") return { data: { save_history: true } };
      if (call.table === "calm_sessions") return { data: [] };
      return {};
    });
    const response = await getHistory();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(db.calls.find((call) => call.table === "calm_sessions")?.filters).toContainEqual(["eq", "user_id", "owner-1"]);
  });

  it("deletes Calm sessions and settings via the owner-scoped deletion RPC", async () => {
    const db = setup();
    const response = await deleteData();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith("calm_delete_user_data", { p_user_id: "owner-1" });
  });
});
