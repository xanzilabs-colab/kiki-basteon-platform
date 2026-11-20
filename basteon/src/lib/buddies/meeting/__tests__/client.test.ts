import { afterEach, describe, expect, it, vi } from "vitest";
import { meetingFetch } from "../client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("meetingFetch", () => {
  it("explains when a report is no longer available for comments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    ));

    await expect(meetingFetch("/api/buddies/community-alerts/report-id/comments"))
      .rejects.toThrow("This report is no longer available. Refresh Pulse to load current reports.");
  });

  it("keeps the normal error for unrelated 404 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    ));

    await expect(meetingFetch("/api/buddies/meetings"))
      .rejects.toThrow("Could not load or save Buddy places. Please try again.");
  });
});
