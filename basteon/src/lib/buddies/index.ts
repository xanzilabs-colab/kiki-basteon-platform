import "server-only";

// Public API of the Buddies engine. Import ONLY from server code (route handlers, server actions).
export * from "./types";
export { BUDDY_CONFIG } from "./config";
export { buildNearbyView, resolveRef } from "./view";
export type { BuildCtx, NearbyResult } from "./view";
export { cellAreaResolver } from "./matching";
export { suggestMeetingPoints } from "./meeting";
export type { MeetCandidate, MeetMember, MeetSuggestion } from "./meeting";
export { evaluateQueryPattern, canPing } from "./guard";
export type { QueryEvent, GuardDecision, PingState } from "./guard";
export { assertNoLeak } from "./privacy";
