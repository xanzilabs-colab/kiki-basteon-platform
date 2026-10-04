import "server-only";

import { assertBuddiesRuntime, buddiesEnabled } from "@/lib/verification/config";

export class BuddiesUnavailableError extends Error {
  code = "BUDDIES_UNAVAILABLE";
}

export function requireBuddiesEnabled() {
  assertBuddiesRuntime();
  if (!buddiesEnabled()) throw new BuddiesUnavailableError();
}

export function buddyHmacSecret() {
  assertBuddiesRuntime();
  return process.env.BUDDY_HMAC_SECRET!;
}