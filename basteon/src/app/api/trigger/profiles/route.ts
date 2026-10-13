import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin, noStore } from "@/lib/triggerRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = ["sos", "medical", "duress", "cancel"] as const;
const TOKENS = /^[TNPSUDHX-]{1,20}$/;
const Action = z.enum(ACTIONS);
const Mapping = z.record(z.string().regex(TOKENS), Action).refine(
  (mapping) => Object.keys(mapping).length <= 20 && new Set(Object.values(mapping)).size === Object.values(mapping).length,
);
const Sample = z.object({
  prompted: z.number().int().min(1).max(6),
  sig: z.string().max(20).regex(/^[TNPSUDHX-]*$/),
  presses: z.number().int().min(0).max(40),
  gaps: z.array(z.number().int().min(0).max(30_000)).max(39),
}).strict();
const Profile = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["earbuds", "wired", "car", "speaker", "watch", "ring", "other"]),
  deviceRef: z.string().max(64).nullable(),
  gapMs: z.number().int().min(200).max(1500),
  settleMs: z.number().int().min(300).max(2500),
  mapping: Mapping,
  library: z.array(Sample).max(30).default([]),
  verifiedAt: z.number().int().positive().nullable(),
  appVersion: z.string().max(20).nullable().optional(),
  androidSdk: z.number().int().min(1).max(1000).nullable().optional(),
}).strict();
const Body = z.object({ profiles: z.array(Profile).max(20) }).strict();

async function authenticatedUser() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  return error ? null : user;
}

export async function GET() {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });

  const { data, error } = await admin()
    .from("trigger_profiles")
    .select("local_id,name,kind,device_ref,gap_ms,settle_ms,mapping,library,verified_at,app_version,android_sdk,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: "profiles_unavailable" }, { status: 500, headers: noStore });

  return NextResponse.json({
    profiles: (data ?? []).map((row) => ({
      id: row.local_id,
      name: row.name,
      kind: row.kind,
      deviceRef: row.device_ref,
      gapMs: row.gap_ms,
      settleMs: row.settle_ms,
      mapping: row.mapping,
      library: row.library,
      verifiedAt: row.verified_at ? Date.parse(row.verified_at) : null,
      appVersion: row.app_version,
      androidSdk: row.android_sdk,
      updatedAt: row.updated_at,
    })),
  }, { headers: noStore });
}

export async function PUT(request: Request) {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  const body = await request.json().catch(() => null) as unknown;
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });

  const db = admin();
  const { data: token, error: tokenError } = await db
    .from("trigger_tokens")
    .select("id")
    .eq("user_id", user.id)
    .eq("kind", "android_shell")
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tokenError) return NextResponse.json({ error: "token_lookup_failed" }, { status: 500, headers: noStore });
  if (!token?.id) return NextResponse.json({ error: "android_trigger_not_registered" }, { status: 409, headers: noStore });

  const rows = parsed.data.profiles.map((profile) => ({
    user_id: user.id,
    token_id: token.id,
    local_id: profile.id,
    name: profile.name,
    kind: profile.kind,
    device_ref: profile.deviceRef,
    gap_ms: profile.gapMs,
    settle_ms: profile.settleMs,
    mapping: profile.mapping,
    library: profile.library,
    verified_at: profile.verifiedAt ? new Date(profile.verifiedAt).toISOString() : null,
    app_version: profile.appVersion ?? null,
    android_sdk: profile.androidSdk ?? null,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await db.from("trigger_profiles").upsert(rows, { onConflict: "token_id,local_id" });
    if (error) return NextResponse.json({ error: "profiles_save_failed" }, { status: 500, headers: noStore });
  }
  const { data: existing, error: existingError } = await db
    .from("trigger_profiles")
    .select("local_id")
    .eq("user_id", user.id)
    .eq("token_id", token.id)
    .limit(25);
  if (existingError) return NextResponse.json({ error: "profiles_sync_failed" }, { status: 500, headers: noStore });
  const currentIds = new Set(parsed.data.profiles.map(({ id }) => id));
  const staleIds = (existing ?? []).map((row) => row.local_id).filter((id) => !currentIds.has(id));
  if (staleIds.length) {
    const { error } = await db
      .from("trigger_profiles")
      .delete()
      .eq("user_id", user.id)
      .eq("token_id", token.id)
      .in("local_id", staleIds);
    if (error) return NextResponse.json({ error: "profiles_sync_failed" }, { status: 500, headers: noStore });
  }
  return NextResponse.json({ ok: true }, { headers: noStore });
}
