import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const noStore = { "Cache-Control": "no-store" };
export const admin = createAdminClient;
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const tokenPattern = /^ktk_[0-9a-f]{64}$/;
const maxBodyBytes = 16 * 1024;

export function readToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return tokenPattern.test(token) ? token : null;
}

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) return { ok: false };

  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxBodyBytes) return { ok: false };
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
}

export function isInvalidTokenError(message: string) {
  return /invalid_token/.test(message);
}

export function tokenErrorStatus(message: string) {
  if (/invalid_token/.test(message)) return 401;
  if (/no_active_device/.test(message)) return 409;
  if (/token_limit/.test(message)) return 429;
  return 500;
}
