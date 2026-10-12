import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { admin, noStore, readJson, sha256, tokenErrorStatus } from "@/lib/triggerRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenKinds = ["ios_shortcut", "android_shortcut", "watch", "home_hub", "android_shell", "other"] as const;
const CreateBody = z.object({
  label: z.string().trim().min(1).max(40),
  kind: z.enum(tokenKinds),
  countdown_s: z.number().int().min(1).max(60).default(10),
  discreet: z.boolean().default(false),
  allow_medical: z.boolean().default(false),
}).strict();
const RevokeBody = z.object({ id: z.string().uuid() }).strict();

async function authenticatedUser() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  return error ? null : user;
}

export async function GET() {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });

  const db = admin();
  const [tokens, shellStatus, devices, diagnostics] = await Promise.all([
    db.rpc("trigger_token_list", { p_user_id: user.id }),
    db.from("shell_status")
      .select("token_id,armed,test_mode,app_version,android_sdk,model,battery_unrestricted,last_seen")
      .eq("user_id", user.id)
      .order("last_seen", { ascending: false }),
    db.from("trigger_devices")
      .select("id,token_id,local_ref,kind,label,status,battery_pct,verified_at,last_connected_at,last_seen_at")
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false }),
    db.from("trigger_diagnostics")
      .select("id,at,pattern,origin,keycodes,device_hint")
      .eq("user_id", user.id)
      .order("at", { ascending: false })
      .limit(50),
  ]);
  if (tokens.error || shellStatus.error || devices.error || diagnostics.error) {
    return NextResponse.json({ error: "trigger_status_unavailable" }, { status: 500, headers: noStore });
  }

  return NextResponse.json({
    tokens: tokens.data ?? [],
    shell_status: shellStatus.data ?? [],
    devices: devices.data ?? [],
    diagnostics: diagnostics.data ?? [],
  }, { headers: noStore });
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });

  const body = await readJson(request);
  const parsed = CreateBody.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });

  const token = `ktk_${randomBytes(32).toString("hex")}`;
  const { data, error } = await admin().rpc("trigger_token_create", {
    p_user_id: user.id,
    p_token_hash: sha256(token),
    p_label: parsed.data.label,
    p_kind: parsed.data.kind,
    p_countdown_s: parsed.data.countdown_s,
    p_discreet: parsed.data.discreet,
    p_allow_medical: parsed.data.allow_medical,
  });
  if (error || !data?.id) {
    return NextResponse.json(
      { error: "token_create_failed" },
      { status: error ? tokenErrorStatus(error.message) : 500, headers: noStore },
    );
  }

  return NextResponse.json({ id: data.id, token }, { status: 201, headers: noStore });
}

export async function DELETE(request: Request) {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });

  const body = await readJson(request);
  const parsed = RevokeBody.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });

  const { data, error } = await admin().rpc("trigger_token_revoke", {
    p_user_id: user.id,
    p_token_id: parsed.data.id,
  });
  if (error) return NextResponse.json({ error: "token_revoke_failed" }, { status: 500, headers: noStore });
  if (!data) return NextResponse.json({ error: "token_not_found" }, { status: 404, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
