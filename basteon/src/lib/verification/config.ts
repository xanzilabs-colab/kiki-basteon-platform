import "server-only";

export const FACE_PURPOSES = ["visibility", "nearby", "ping", "bubble"] as const;
export type FacePurpose = (typeof FACE_PURPOSES)[number];
export const SIMULATION_OUTCOMES = ["pass", "liveness_fail", "face_mismatch", "timeout", "provider_error"] as const;
export type SimulationOutcome = (typeof SIMULATION_OUTCOMES)[number];

const integer = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const VERIFICATION_CONFIG = {
  mode: process.env.VERIFICATION_MODE ?? "simulation",
  faceProofTtlMinutes: integer(process.env.FACE_PROOF_TTL_MINUTES, 15),
  sessionTtlSeconds: integer(process.env.FACE_SESSION_TTL_SECONDS, 120),
  maxFailedAttemptsPerHour: integer(process.env.FACE_MAX_FAILED_ATTEMPTS_PER_HOUR, 5),
  lockoutMinutes: integer(process.env.FACE_LOCKOUT_MINUTES, 30),
  minimumMatchScore: Number(process.env.FACE_MIN_MATCH_SCORE ?? 0.9),
} as const;

export function assertVerificationRuntime() {
  if (process.env.NODE_ENV === "production" && VERIFICATION_CONFIG.mode === "simulation") {
    throw new Error("VERIFICATION_MODE=simulation is forbidden in production.");
  }
}

export function assertBuddiesRuntime() {
  assertVerificationRuntime();
  if (!process.env.BUDDY_HMAC_SECRET || process.env.BUDDY_HMAC_SECRET.length < 32) {
    throw new Error("BUDDY_HMAC_SECRET must be set to at least 32 random bytes.");
  }
}

export function buddiesEnabled() {
  assertBuddiesRuntime();
  return process.env.BUDDIES_ENABLED === "true" && (process.env.NODE_ENV !== "production" || VERIFICATION_CONFIG.mode === "live");
}