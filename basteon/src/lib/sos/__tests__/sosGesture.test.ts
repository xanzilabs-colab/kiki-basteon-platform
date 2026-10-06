import { describe, expect, it } from "vitest";
import { gestureReducer, type GestureEvent, type GestureState } from "../sosGesture";

const origin = { x: 10, y: 10 };
const bubble = { x: 150, y: 10 };
const reduce = (events: GestureEvent[]) => events.reduce(gestureReducer, { phase: "idle" } as GestureState);

describe("SOS gesture state machine", () => {
  it("turns a quick press and release into SOS", () => {
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "up", pos: origin, bubble: null }]))
      .toEqual({ phase: "done", type: "sos", via: "tap" });
  });

  it("keeps hold-and-release outside the bubble as SOS", () => {
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "holdTimer" }, { kind: "up", pos: origin, bubble }]))
      .toEqual({ phase: "done", type: "sos", via: "hold_release" });
  });

  it("selects Medical when release lands inside the bubble", () => {
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "holdTimer" }, { kind: "move", pos: bubble, bubble }, { kind: "up", pos: bubble, bubble }]))
      .toEqual({ phase: "done", type: "medical", via: "hold_slide" });
  });

  it("promotes a quick drag beyond the tap slop to a hold", () => {
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "move", pos: bubble, bubble }, { kind: "up", pos: bubble, bubble }]))
      .toEqual({ phase: "done", type: "medical", via: "hold_slide" });
  });

  it("cancels a pointer that leaves while pressing", () => {
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "cancel" }])).toEqual({ phase: "idle" });
  });

  it("treats cancellation while holding as SOS unless armed", () => {
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "holdTimer" }, { kind: "cancel" }]))
      .toEqual({ phase: "done", type: "sos", via: "hold_release" });
  });

  it("can arm and complete Medical on cancellation after reaching the bubble", () => {
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "holdTimer" }, { kind: "move", pos: bubble, bubble: null }, { kind: "cancel" }]))
      .toEqual({ phase: "done", type: "sos", via: "hold_release" });
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "holdTimer" }, { kind: "move", pos: bubble, bubble }, { kind: "cancel" }]))
      .toEqual({ phase: "done", type: "medical", via: "hold_slide" });
  });

  it("resets completed gestures to idle", () => {
    expect(reduce([{ kind: "down", pos: origin, at: 0 }, { kind: "up", pos: origin, bubble: null }, { kind: "reset" }]))
      .toEqual({ phase: "idle" });
  });
});