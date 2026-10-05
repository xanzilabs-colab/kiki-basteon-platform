import { describe, expect, it } from "vitest";
import { initialMicState, isTransmitting, micReducer } from "../mic";
import { parseModeStatus, parseSignal } from "../types";

describe("per-user microphone", () => {
  it("defaults to open but never transmits before connection", () => {
    expect(initialMicState.mode).toBe("open");
    expect(isTransmitting(initialMicState)).toBe(false);
    expect(isTransmitting(micReducer(initialMicState, { type: "connection", connected: true }))).toBe(true);
  });
  it("walkie-talkie transmits only while held", () => {
    const connected = { ...initialMicState, connected: true };
    const idle = micReducer(connected, { type: "mode", mode: "walkie-talkie" });
    expect(isTransmitting(idle)).toBe(false);
    const held = micReducer(idle, { type: "hold", held: true });
    expect(isTransmitting(held)).toBe(true);
    expect(isTransmitting(micReducer(held, { type: "hold", held: false }))).toBe(false);
  });
  it.each([
    { type: "visibility", visible: false } as const,
    { type: "connection", connected: false } as const,
    { type: "mute", muted: true } as const,
    { type: "reset" } as const,
  ])("fails closed on %j", (action) => {
    const held = { ...initialMicState, mode: "walkie-talkie" as const, held: true, connected: true };
    const next = micReducer(held, action);
    expect(next.held).toBe(false);
    expect(isTransmitting(next)).toBe(false);
  });
  it("does not restore a held press after visibility or connection returns", () => {
    const held = { ...initialMicState, mode: "walkie-talkie" as const, held: true, connected: true };
    const hidden = micReducer(held, { type: "visibility", visible: false });
    expect(isTransmitting(micReducer(hidden, { type: "visibility", visible: true }))).toBe(false);
  });
  it("rejects a press while disconnected or hidden", () => {
    expect(micReducer({ ...initialMicState, mode: "walkie-talkie" }, { type: "hold", held: true }).held).toBe(false);
    expect(micReducer({ ...initialMicState, mode: "walkie-talkie", connected: true, visible: false }, { type: "hold", held: true }).held).toBe(false);
  });
  it("changes only this person's mic mode and releases the previous press", () => {
    const held = { ...initialMicState, mode: "walkie-talkie" as const, held: true, connected: true };
    const next = micReducer(held, { type: "mode", mode: "open" });
    expect(next.held).toBe(false); expect(isTransmitting(next)).toBe(true);
    expect(held.mode).toBe("walkie-talkie");
  });
});

describe("strict audio parsers", () => {
  it("rejects malformed or extended signals", () => {
    expect(parseSignal({ kind: "offer", sdp: "x" })).toBeNull();
    expect(parseSignal({ version: 1, kind: "ready", walkId: "123", senderId: "123" })).toBeNull();
    expect(parseModeStatus('{"version":1,"kind":"mode","mode":"open","transmitting":true}')).not.toBeNull();
    expect(parseModeStatus('{"version":1,"kind":"mode","mode":"open","transmitting":true,"extra":1}')).toBeNull();
    expect(parseModeStatus("invalid")).toBeNull();
  });
});