import { describe, expect, it } from "vitest";
import { EMOTIONS, RESPONSES, SCENARIOS, isReadRoomChoice, scenarioForRound } from "./engine";

describe("Read the Room engine", () => {
  it("offers varied fictional scenarios and five choices without a correct-answer field", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(10);
    expect(SCENARIOS.every((scenario) => scenario.prompt.length > 20)).toBe(true);
    expect(SCENARIOS.every((scenario) => !("correctAnswer" in scenario))).toBe(true);
    expect(EMOTIONS.length).toBe(5);
    expect(RESPONSES.length).toBe(5);
    expect(new Set(SCENARIOS.map((scenario) => scenario.prompt)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.slice(6).every((scenario) =>
      (scenario.emotionOptions?.length ?? 0) === 5 && (scenario.responseOptions?.length ?? 0) === 5,
    )).toBe(true);
  });

  it("selects a stable scenario for a session and round", () => {
    expect(scenarioForRound("session-a", 2)).toBe(scenarioForRound("session-a", 2));
    expect(SCENARIOS).toContain(scenarioForRound("session-a", 2));
    expect(new Set([1, 2, 3].map((round) => scenarioForRound("session-a", round))).size).toBe(3);
    expect(() => scenarioForRound("session-a", 0)).toThrow(RangeError);
  });

  it("accepts only indexes from the five emotion and response choices", () => {
    expect(isReadRoomChoice(0, 0)).toBe(true);
    expect(isReadRoomChoice(EMOTIONS.length - 1, RESPONSES.length - 1)).toBe(true);
    expect(isReadRoomChoice(EMOTIONS.length, 0)).toBe(false);
    expect(isReadRoomChoice(0, "0")).toBe(false);
    expect(isReadRoomChoice(-1, 1)).toBe(false);
  });
});
