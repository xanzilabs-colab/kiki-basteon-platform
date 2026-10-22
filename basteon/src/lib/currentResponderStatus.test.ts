import { describe, expect, it } from "vitest";
import { currentResponderStatusByUser, formatCurrentResponderStatus } from "./currentResponderStatus";

describe("current responder status", () => {
  it("uses the latest actual response status instead of preferring en route", () => {
    const statuses = currentResponderStatusByUser([
      { responder_user_id: "responder-1", status: "en_route", assigned_at: "2026-01-01T10:00:00Z", status_updated_at: "2026-01-01T10:05:00Z" },
      { responder_user_id: "responder-1", status: "acknowledged", assigned_at: "2026-01-01T10:10:00Z", status_updated_at: "2026-01-01T10:11:00Z" },
    ]);

    expect(statuses.get("responder-1")).toBe("acknowledged");
  });

  it("uses the most recently updated active assignment", () => {
    const statuses = currentResponderStatusByUser([
      { responder_user_id: "responder-1", status: "on_scene", assigned_at: "2026-01-01T10:00:00Z", status_updated_at: "2026-01-01T10:05:00Z" },
      { responder_user_id: "responder-1", status: "en_route", assigned_at: "2026-01-01T10:05:00Z", status_updated_at: "2026-01-01T10:06:00Z" },
    ]);

    expect(statuses.get("responder-1")).toBe("en_route");
  });

  it("falls back to assignment time for older rows without a status event", () => {
    const statuses = currentResponderStatusByUser([
      { responder_user_id: "responder-1", status: "en_route", assigned_at: "2026-01-01T10:00:00Z" },
      { responder_user_id: "responder-1", status: "acknowledged", assigned_at: "2026-01-01T10:05:00Z" },
    ]);

    expect(statuses.get("responder-1")).toBe("acknowledged");
  });

  it("ignores completed assignments and rows without a responder", () => {
    const statuses = currentResponderStatusByUser([
      { responder_user_id: "responder-1", status: "completed", assigned_at: "2026-01-01T10:00:00Z" },
      { responder_user_id: null, status: "on_scene", assigned_at: "2026-01-01T10:05:00Z" },
    ]);

    expect(statuses.size).toBe(0);
  });

  it("formats the current response state for display without changing its meaning", () => {
    expect(formatCurrentResponderStatus("en_route")).toBe("En route");
    expect(formatCurrentResponderStatus("on_scene")).toBe("On scene");
    expect(formatCurrentResponderStatus(null)).toBeNull();
  });
});
