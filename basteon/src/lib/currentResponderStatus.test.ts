import { describe, expect, it } from "vitest";
import { currentResponderStatusByUser } from "./currentResponderStatus";

describe("current responder status", () => {
  it("uses the furthest active response status instead of duty availability", () => {
    const statuses = currentResponderStatusByUser([
      { responder_user_id: "responder-1", status: "assigned", assigned_at: "2026-01-01T10:00:00Z" },
      { responder_user_id: "responder-1", status: "en_route", assigned_at: "2026-01-01T10:05:00Z" },
      { responder_user_id: "responder-1", status: "acknowledged", assigned_at: "2026-01-01T10:10:00Z" },
    ]);

    expect(statuses.get("responder-1")).toBe("en_route");
  });

  it("prefers the most recently assigned response when statuses are equal", () => {
    const statuses = currentResponderStatusByUser([
      { responder_user_id: "responder-1", status: "en_route", assigned_at: "2026-01-01T10:00:00Z" },
      { responder_user_id: "responder-1", status: "en_route", assigned_at: "2026-01-01T10:05:00Z" },
    ]);

    expect(statuses.get("responder-1")).toBe("en_route");
  });

  it("ignores completed assignments and rows without a responder", () => {
    const statuses = currentResponderStatusByUser([
      { responder_user_id: "responder-1", status: "completed", assigned_at: "2026-01-01T10:00:00Z" },
      { responder_user_id: null, status: "on_scene", assigned_at: "2026-01-01T10:05:00Z" },
    ]);

    expect(statuses.size).toBe(0);
  });
});
