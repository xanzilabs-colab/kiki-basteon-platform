import { describe, expect, it } from "vitest";
import { isPickDeadlineExpired, isPickSubmissionOnTime, PICK_REQUEST_GRACE_MS, pickTimeRemainingMs } from "./pickTiming";

describe("Linkup pick timing", () => {
  const deadline = "2026-10-12T17:00:05.000Z";
  const deadlineMs = Date.parse(deadline);

  it("keeps the pick open for an in-flight request after the visible deadline", () => {
    expect(isPickDeadlineExpired(deadline, deadlineMs)).toBe(false);
    expect(isPickDeadlineExpired(deadline, deadlineMs + PICK_REQUEST_GRACE_MS)).toBe(false);
    expect(isPickDeadlineExpired(deadline, deadlineMs + PICK_REQUEST_GRACE_MS + 1)).toBe(true);
  });

  it("reports the remaining pick and request-settlement window", () => {
    expect(pickTimeRemainingMs(deadline, deadlineMs - 1_000)).toBe(3_000);
    expect(pickTimeRemainingMs(deadline, deadlineMs + 1_000)).toBe(1_000);
    expect(pickTimeRemainingMs(deadline, deadlineMs + PICK_REQUEST_GRACE_MS)).toBe(0);
  });

  it("accepts a pick made with at least one second left even if the request arrives after zero", () => {
    const startedAt = "2026-10-12T17:00:00.000Z";
    expect(isPickSubmissionOnTime(startedAt, deadline, deadlineMs - 1_000, deadlineMs + 1_000)).toBe(true);
    expect(isPickSubmissionOnTime(startedAt, deadline, deadlineMs + 1, deadlineMs + 1_000)).toBe(false);
    expect(isPickSubmissionOnTime(startedAt, deadline, deadlineMs - 1_000, deadlineMs + PICK_REQUEST_GRACE_MS + 1)).toBe(false);
  });
});
