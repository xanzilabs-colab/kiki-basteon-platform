import { describe, expect, it } from "vitest";
import { formatLinkupError, formatLinkupMode, formatLinkupReason } from "./presentation";

describe("Linkup presentation text", () => {
  it("uses readable labels for server validation reasons", () => {
    expect(formatLinkupReason("not_a_word")).toBe("That word isn't in the word list");
    expect(formatLinkupReason("wrong_start")).toBe("Starts with the wrong letter");
    expect(formatLinkupReason("mine")).toBe("Contains a mine letter");
    expect(formatLinkupReason("future_reason")).toBe("Not accepted");
  });

  it("uses helpful copy for API errors without exposing internal codes", () => {
    expect(formatLinkupError("match_state_unavailable")).toContain("latest match state");
    expect(formatLinkupError("action_failed", "answer_insert")).toContain("still in the box");
    expect(formatLinkupError("unexpected_internal_code")).not.toContain("_");
  });

  it("formats internal mode names for result screens", () => {
    expect(formatLinkupMode("wildcard")).toBe("Wild Card");
    expect(formatLinkupMode("bomb")).toBe("Hot Potato");
  });
});
