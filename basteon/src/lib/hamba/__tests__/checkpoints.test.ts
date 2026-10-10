import { describe, expect, it } from "vitest";
import { checkpointConfig, deviationConfig, evaluateCheckpoint, isOffRoute, isOverdue, type Checkpoint } from "../checkpoints";

const cfg = checkpointConfig({});
const T = 1_000_000_000;
const cp = (over: Partial<Checkpoint> = {}): Checkpoint => ({ id: "c", expectedAt: T, status: "pending", remindersSent: 0, ...over });

describe("checkpoints", () => {
  it("is silent before the prompt window", () => expect(evaluateCheckpoint(cp(), T - cfg.promptLeadMs - 1, cfg)).toBe("none"));
  it("prompts near the stop and inside grace", () => {
    expect(evaluateCheckpoint(cp(), T - 1000, cfg)).toBe("prompt");
    expect(evaluateCheckpoint(cp(), T + cfg.graceMs - 1, cfg)).toBe("prompt");
  });
  it("reminds after grace, respects interval, then escalates", () => {
    const late = T + cfg.graceMs + 1;
    expect(evaluateCheckpoint(cp({ status: "prompted" }), late, cfg)).toBe("reminder");
    expect(evaluateCheckpoint(cp({ status: "missed", remindersSent: 1, lastNotifiedAt: late - 1000 }), late, cfg)).toBe("none");
    expect(evaluateCheckpoint(cp({ status: "missed", remindersSent: cfg.maxReminders }), late, cfg)).toBe("escalate");
  });
  it("does nothing once checked in or escalated", () => {
    expect(evaluateCheckpoint(cp({ status: "checked_in" }), T + 10 * cfg.graceMs, cfg)).toBe("none");
    expect(evaluateCheckpoint(cp({ status: "escalated" }), T + 10 * cfg.graceMs, cfg)).toBe("none");
  });
});

describe("deviation", () => {
  const d = deviationConfig({});
  const route = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }];
  const on = { lat: 0, lng: 0.005 };
  const off = { lat: 0.01, lng: 0.005 };
  it("ignores a single noisy fix", () => expect(isOffRoute([on, on, off], route, d)).toBe(false));
  it("flags consecutive off-route fixes", () => expect(isOffRoute([off, off, off], route, d)).toBe(true));
  it("widens by GPS accuracy", () => expect(isOffRoute([off, off, off].map((f) => ({ ...f, accuracyM: 2000 })), route, d)).toBe(false));
  it("overdue only past grace", () => {
    expect(isOverdue(T, T + d.overdueGraceMs - 1, d)).toBe(false);
    expect(isOverdue(T, T + d.overdueGraceMs + 1, d)).toBe(true);
  });
});
