import "server-only";

import { NextResponse } from "next/server";
import { assertNoLeak } from "@/lib/buddies";

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  return Boolean(host && new URL(origin).host === host);
}

export function safeJson(body: Record<string, unknown>, init?: ResponseInit) {
  assertNoLeak(body);
  return NextResponse.json(body, init);
}