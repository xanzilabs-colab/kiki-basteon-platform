import type { MicMode } from "./types";

export type MicState = { mode: MicMode; held: boolean; muted: boolean; connected: boolean; visible: boolean };
export type MicAction =
  | { type: "mode"; mode: MicMode }
  | { type: "hold"; held: boolean }
  | { type: "mute"; muted: boolean }
  | { type: "connection"; connected: boolean }
  | { type: "visibility"; visible: boolean }
  | { type: "reset" };
export const initialMicState: MicState = { mode: "open", held: false, muted: false, connected: false, visible: true };
export function micReducer(state: MicState, action: MicAction): MicState {
  switch (action.type) {
    case "mode": return { ...state, mode: action.mode, held: false };
    case "hold": return { ...state, held: action.held && state.connected && state.visible && state.mode === "walkie-talkie" };
    case "mute": return { ...state, muted: action.muted, held: false };
    case "connection": return { ...state, connected: action.connected, held: false };
    case "visibility": return { ...state, visible: action.visible, held: false };
    case "reset": return { ...initialMicState };
  }
}
export function isTransmitting(state: MicState): boolean {
  return state.connected && state.visible && !state.muted && (state.mode === "open" || state.held);
}