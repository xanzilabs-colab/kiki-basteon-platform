export type SosType = "sos" | "medical";
export type SosVia = "tap" | "hold_slide" | "hold_release";

export const HOLD_MS = 400;
export const TAP_SLOP_PX = 12;
export const ARM_RADIUS_PX = 64;

export type Point = { x: number; y: number };

export type GestureState =
  | { phase: "idle" }
  | { phase: "pressing"; start: Point; at: number }
  | { phase: "holding"; start: Point; pos: Point; armed: boolean }
  | { phase: "done"; type: SosType; via: SosVia };

export type GestureEvent =
  | { kind: "down"; pos: Point; at: number }
  | { kind: "holdTimer" }
  | { kind: "move"; pos: Point; bubble: Point | null }
  | { kind: "up"; pos: Point; bubble: Point | null }
  | { kind: "cancel" }
  | { kind: "reset" };

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const isArmed = (pos: Point, bubble: Point | null) =>
  !!bubble && dist(pos, bubble) <= ARM_RADIUS_PX;

export function gestureReducer(s: GestureState, e: GestureEvent): GestureState {
  switch (e.kind) {
    case "reset":
      return { phase: "idle" };

    case "down":
      return s.phase === "idle" ? { phase: "pressing", start: e.pos, at: e.at } : s;

    case "holdTimer":
      return s.phase === "pressing"
        ? { phase: "holding", start: s.start, pos: s.start, armed: false }
        : s;

    case "move":
      if (s.phase === "pressing") {
        return dist(s.start, e.pos) > TAP_SLOP_PX
          ? { phase: "holding", start: s.start, pos: e.pos, armed: isArmed(e.pos, e.bubble) }
          : s;
      }
      if (s.phase === "holding") return { ...s, pos: e.pos, armed: isArmed(e.pos, e.bubble) };
      return s;

    case "up":
      if (s.phase === "pressing") return { phase: "done", type: "sos", via: "tap" };
      if (s.phase === "holding") {
        return isArmed(e.pos, e.bubble)
          ? { phase: "done", type: "medical", via: "hold_slide" }
          : { phase: "done", type: "sos", via: "hold_release" };
      }
      return s;

    case "cancel":
      if (s.phase === "holding") {
        return s.armed
          ? { phase: "done", type: "medical", via: "hold_slide" }
          : { phase: "done", type: "sos", via: "hold_release" };
      }
      return s.phase === "pressing" ? { phase: "idle" } : s;

    default:
      return s;
  }
}

export const typeSourceFor = (via: SosVia): "tap" | "hold_slide" =>
  via === "hold_slide" ? "hold_slide" : "tap";