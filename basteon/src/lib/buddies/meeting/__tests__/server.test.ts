import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMeetingEngine } from "../server";

const landmarks = vi.hoisted(() => vi.fn());
vi.mock("../overpass", () => ({ fetchLandmarks: landmarks }));
const serviceRpc = vi.fn(); const userRpc = vi.fn();
const args = { userClient: { rpc: userRpc } as unknown as SupabaseClient, serviceClient: { rpc: serviceRpc } as unknown as SupabaseClient, userId: "one", bubbleId: "bubble", regenerate: false, now: new Date("2026-10-05T10:00:00Z") };
const inputs = { total: 2, ready: 2, allowLandmarks: false, locations: [{ userId: "one", lat: -26, lng: 28 }, { userId: "two", lat: -26.002, lng: 28 }], excludeSpotIds: [], excludeOsmRefs: [] };

beforeEach(() => {
  vi.resetAllMocks();
  serviceRpc.mockImplementation(async (name) => ({ data: name === "get_bubble_meeting_inputs" ? inputs : 1, error: null }));
  userRpc.mockResolvedValue({ data: [], error: null });
  landmarks.mockResolvedValue([]);
});

describe("meeting orchestrator", () => {
  it("waits for all members before querying public sources", async () => {
    serviceRpc.mockResolvedValue({ data: { ...inputs, ready: 1, locations: inputs.locations.slice(0, 1) }, error: null });
    expect(await runMeetingEngine(args)).toEqual({ status: "waiting_for_locations", ready: 1, total: 2 });
    expect(userRpc).not.toHaveBeenCalled();
  });
  it("fails closed when curated places or safety alerts cannot be read", async () => {
    userRpc.mockResolvedValueOnce({ data: null, error: { message: "places unavailable" } });
    await expect(runMeetingEngine(args)).rejects.toThrow("places unavailable");
    userRpc.mockReset().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "alerts unavailable" } });
    await expect(runMeetingEngine(args)).rejects.toThrow("alerts unavailable");
    expect(serviceRpc).not.toHaveBeenCalledWith("save_bubble_spot_candidates", expect.anything());
  });
  it("saves the ranked camel-case contract through service role only", async () => {
    userRpc.mockImplementation(async (name) => ({ data: name === "list_meetup_candidates_near" ? [{ id: "spot", name: "Station", category: "police_station", lat: -26.001, lng: 28, open_24h: true, quality: 5 }] : [], error: null }));
    expect(await runMeetingEngine(args)).toEqual({ status: "ok", round: 1, count: 1 });
    expect(serviceRpc).toHaveBeenCalledWith("save_bubble_spot_candidates", expect.objectContaining({ p_user_id: "one", p_bubble_id: "bubble", p_regenerate: false, p_candidates: [expect.objectContaining({ spotId: "spot", source: "curated", distM: { one: expect.any(Number), two: expect.any(Number) } })] }));
    expect(landmarks).not.toHaveBeenCalled();
  });
  it("does not persist an empty round", async () => {
    expect(await runMeetingEngine(args)).toEqual({ status: "no_candidates" });
    expect(serviceRpc).toHaveBeenCalledTimes(1);
  });
});