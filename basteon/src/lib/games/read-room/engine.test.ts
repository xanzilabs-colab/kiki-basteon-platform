import { describe, expect, it } from "vitest";
import { EMOTIONS, RESPONSES, SCENARIOS, isReadRoomChoice, scenarioForRound } from "./engine";

describe("Read the Room engine", () => {
  it("uses a small curated set of fictional scenarios with no correct-answer field", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(4);
    expect(SCENARIOS.every((scenario) => scenario.prompt.length > 20)).toBe(true);
    expect(SCENARIOS.every((scenario) => !("correctAnswer" in scenario))).toBe(true);
    expect(EMOTIONS.length).toBe(4);
    expect(RESPONSES.length).toBe(4);
  });

  it("selects a stable scenario for a session and round", () => {
    expect(scenarioForRound("session-a", 2)).toBe(scenarioForRound("session-a", 2));
    expect(SCENARIOS).toContain(scenarioForRound("session-a", 2));
    expect(() => scenarioForRound("session-a", 0)).toThrow(RangeError);
  });

  it("accepts only indexes from the fixed emotion and response choices", () => {
    expect(isReadRoomChoice(0, 0)).toBe(true);
    expect(isReadRoomChoice(EMOTIONS.length - 1, RESPONSES.length - 1)).toBe(true);
    expect(isReadRoomChoice(EMOTIONS.length, 0)).toBe(false);
    expect(isReadRoomChoice(0, "0")).toBe(false);
    expect(isReadRoomChoice(-1, 1)).toBe(false);
  });
});
