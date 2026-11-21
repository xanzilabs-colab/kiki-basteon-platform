import { describe, expect, it } from "vitest";
import { interactivePostError, interactivePostSchema } from "./interactive";

const basePost = {
  id: "c2d724ad-b52a-4b9b-a5e0-6a9582f6e2fc",
  communityId: "c2d724ad-b52a-4b9b-a5e0-6a9582f6e2fc",
  title: "Which routine feels easiest to keep?",
  type: "poll" as const,
  options: [{ label: "Plan ahead" }, { label: "Check in after" }],
};

describe("interactive community post validation", () => {
  it("accepts bounded poll choices and rejects missing carousel media", () => {
    const poll = interactivePostSchema.parse(basePost);
    const carousel = interactivePostSchema.parse({ ...basePost, type: "carousel", options: [] });

    expect(interactivePostError(poll)).toBe("");
    expect(interactivePostError(carousel)).toContain("at least one image");
  });

  it("rejects cyclic or disconnected choose-your-path graphs", () => {
    const path = interactivePostSchema.parse({
      ...basePost,
      type: "path",
      options: [],
      config: {
        nodes: [
          { id: "start", text: "Choose an option", choices: [{ text: "A", to: "end" }, { text: "B", to: "start" }] },
          { id: "end", text: "Outcome", end: true },
        ],
      },
    });

    expect(interactivePostError(path)).toContain("connected steps");
  });
});
