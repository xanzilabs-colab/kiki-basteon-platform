import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodTypeAny, output } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireBuddiesEnabled } from "@/lib/buddies/server/runtime";

export function meetingJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function meetingError(error: unknown) {
  const message = error instanceof Error ? error.message : "unavailable";
  const statuses: Record<string, number> = { unauthenticated: 401, forbidden: 403, not_member: 403, not_found: 404, stale_round: 409, membership_changed: 409, waiting_for_locations: 409, invalid_candidate: 409, invalid_location: 400, invalid_bounds: 400, invalid_place: 400, rate_limited: 429, BUDDIES_UNAVAILABLE: 503 };
  return meetingJson({ error: message in statuses ? message : "unavailable" }, statuses[message] ?? 503);
}

export async function meetingSession(request?: Request, admin = false) {
  requireBuddiesEnabled();
  if (request && request.method !== "GET") {
    const origin = request.headers.get("origin");
    let matches = false;
    try { matches = Boolean(origin && new URL(origin).origin === new URL(request.url).origin); } catch { matches = false; }
    if (!matches) throw new Error("forbidden");
  }
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile, error } = await client.from("profiles").select("role,verification_status").eq("id", user.id).single();
  if (error || profile?.role !== (admin ? "admin" : "user") || (!admin && profile.verification_status === "suspended")) throw new Error("forbidden");
  return { client, user };
}

export async function meetingBody<Schema extends ZodTypeAny>(request: Request, schema: Schema): Promise<output<Schema> | null> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function meetingRpc(client: SupabaseClient, name: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}