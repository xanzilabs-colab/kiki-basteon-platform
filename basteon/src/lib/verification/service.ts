import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";
import { assertVerificationRuntime, FACE_PURPOSES, SIMULATION_OUTCOMES, VERIFICATION_CONFIG, type FacePurpose, type SimulationOutcome } from "./config";
import { deviceCookieName, hashDeviceToken, newDeviceToken } from "./device";
import { SimulatedFaceProvider } from "./providers/simulated";

export class FaceCheckRequiredError extends Error {
  code = "FACE_CHECK_REQUIRED";
}

export class FaceCheckLockedError extends Error {
  code = "FACE_CHECK_LOCKED";
}

export const isFacePurpose = (value: unknown): value is FacePurpose => typeof value === "string" && FACE_PURPOSES.includes(value as FacePurpose);
export const isSimulationOutcome = (value: unknown): value is SimulationOutcome => typeof value === "string" && SIMULATION_OUTCOMES.includes(value as SimulationOutcome);

export async function currentDeviceToken() {
  return (await cookies()).get(deviceCookieName)?.value ?? null;
}

export async function requireFreshFaceProof(userId: string) {
  const token = await currentDeviceToken();
  if (!token) throw new FaceCheckRequiredError();
  const db = createAdminClient();
  const { data } = await db.from("face_proofs").select("valid_until").eq("user_id", userId).eq("device_token_hash", hashDeviceToken(token)).gt("valid_until", new Date().toISOString()).maybeSingle();
  if (!data) throw new FaceCheckRequiredError();
  return data;
}

export async function invalidateFaceProof(userId: string, token?: string | null) {
  const deviceToken = token ?? await currentDeviceToken();
  if (!deviceToken) return;
  await createAdminClient().from("face_proofs").delete().eq("user_id", userId).eq("device_token_hash", hashDeviceToken(deviceToken));
}

export async function issueFaceSession(userId: string, purpose: FacePurpose, simulationOutcome?: SimulationOutcome) {
  assertVerificationRuntime();
  if (VERIFICATION_CONFIG.mode !== "simulation") throw new Error("No live face-verification provider has been configured.");
  const db = createAdminClient();
  const { data: profile } = await db.from("profiles").select("verification_status,face_locked_until").eq("id", userId).single();
  if (profile?.verification_status !== "verified") return { error: "not_verified" as const };
  if (profile.face_locked_until && new Date(profile.face_locked_until).getTime() > Date.now()) return { error: "locked" as const, lockedUntil: profile.face_locked_until };

  const token = await currentDeviceToken() ?? newDeviceToken();
  const nonce = randomBytes(24).toString("base64url");
  const outcome = VERIFICATION_CONFIG.mode === "simulation" && simulationOutcome ? simulationOutcome : "pass";
  const provider = new SimulatedFaceProvider(outcome);
  const providerSession = await provider.startFaceCheck(userId, purpose, nonce);
  const expiresAt = new Date(Date.now() + VERIFICATION_CONFIG.sessionTtlSeconds * 1000).toISOString();
  const { data: session, error } = await db.from("face_check_sessions").insert({
    user_id: userId, device_token_hash: hashDeviceToken(token), purpose, nonce,
    provider_session_id: providerSession.providerSessionId, expires_at: expiresAt,
  }).select("id").single();
  if (error || !session) throw new Error(error?.message ?? "Could not create face-check session.");
  return { token, sessionId: session.id, clientConfig: providerSession.clientConfig };
}

export async function completeFaceSession(userId: string, sessionId: string) {
  assertVerificationRuntime();
  if (VERIFICATION_CONFIG.mode !== "simulation") throw new Error("No live face-verification provider has been configured.");
  const token = await currentDeviceToken();
  if (!token) throw new FaceCheckRequiredError();
  const db = createAdminClient();
  const now = new Date();
  const { data: session } = await db.from("face_check_sessions").select("*").eq("id", sessionId).eq("user_id", userId).eq("device_token_hash", hashDeviceToken(token)).maybeSingle();
  if (!session || session.used_at || session.status !== "pending" || new Date(session.expires_at).getTime() <= now.getTime()) {
    throw new FaceCheckRequiredError();
  }

  const provider = new SimulatedFaceProvider("provider_error");
  const result = await provider.getFaceCheckResult(session.provider_session_id);
  const passed = result.status === "passed" && result.livenessPassed && result.matchScore >= VERIFICATION_CONFIG.minimumMatchScore;
  const status = passed ? "passed" : result.status === "pending" ? "expired" : "failed";
  await db.from("face_check_sessions").update({ status, provider_reference: result.providerRef ?? null, used_at: now.toISOString() }).eq("id", session.id);
  await db.from("face_check_attempts").insert({ user_id: userId, device_token_hash: hashDeviceToken(token), purpose: session.purpose, result: passed ? "passed" : result.status, provider_reference: result.providerRef ?? null });

  if (passed) {
    const validUntil = new Date(now.getTime() + VERIFICATION_CONFIG.faceProofTtlMinutes * 60_000).toISOString();
    await db.from("face_proofs").upsert({ user_id: userId, device_token_hash: hashDeviceToken(token), session_id: session.id, valid_until: validUntil });
    return { valid: true, validUntil };
  }

  await invalidateFaceProof(userId, token);
  const cutoff = new Date(now.getTime() - 60 * 60_000).toISOString();
  const { count } = await db.from("face_check_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId).neq("result", "passed").gte("created_at", cutoff);
  const suspicious = !result.livenessPassed || result.matchScore < VERIFICATION_CONFIG.minimumMatchScore;
  if (suspicious) {
    await db.from("buddy_moderation_flags").insert({ user_id: userId, kind: !result.livenessPassed ? "liveness_failure" : "face_mismatch" });
    await sendPushNotificationsToUser(userId, { title: "Kiki", body: "A security check needs your attention.", tag: "kiki-security-check", url: "/account" });
  }
  if ((count ?? 0) >= VERIFICATION_CONFIG.maxFailedAttemptsPerHour) {
    const lockedUntil = new Date(now.getTime() + VERIFICATION_CONFIG.lockoutMinutes * 60_000).toISOString();
    await db.from("profiles").update({ face_locked_until: lockedUntil }).eq("id", userId);
    await db.from("buddy_moderation_flags").insert({ user_id: userId, kind: "face_check_lockout" });
    throw new FaceCheckLockedError();
  }
  return { valid: false, code: "FACE_CHECK_FAILED" as const };
}