import "server-only";

import { createHash, randomBytes } from "node:crypto";

const production = process.env.NODE_ENV === "production";
export const deviceCookieName = production ? "__Host-kiki-buddy-device" : "kiki-buddy-device";

export const deviceCookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 180,
};

export function newDeviceToken() {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// This binds proofs to a browser session, not hardware. Native clients should use platform attestation.