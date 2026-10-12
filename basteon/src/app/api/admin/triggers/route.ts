import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return privateJson({ error: "unauthorized" }, { status: 401 });

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError) return privateJson({ error: "admin_check_failed" }, { status: 500 });
  if (profile?.role !== "admin") return privateJson({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const [shells, devices, diagnostics] = await Promise.all([
    db.from("shell_status")
      .select("token_id,user_id,armed,test_mode,app_version,android_sdk,model,battery_unrestricted,last_seen")
      .order("last_seen", { ascending: false })
      .limit(500),
    db.from("trigger_devices")
      .select("user_id,token_id,kind,label,status,battery_pct,verified_at,last_connected_at,last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1000),
    db.from("trigger_diagnostics")
      .select("id,user_id,token_id,at,pattern,origin,keycodes,device_hint")
      .order("at", { ascending: false })
      .limit(500),
  ]);
  const failed = shells.error ?? devices.error ?? diagnostics.error;
  if (failed) return privateJson({ error: "trigger_data_unavailable" }, { status: 500 });

  const userIds = [...new Set([
    ...(shells.data ?? []).map((row) => row.user_id),
    ...(devices.data ?? []).map((row) => row.user_id),
  ])];
  const owners = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles, error } = await db.from("profiles").select("id,full_name").in("id", userIds);
    if (error) return privateJson({ error: "trigger_owner_data_unavailable" }, { status: 500 });
    for (const owner of profiles ?? []) owners.set(owner.id, owner.full_name);
  }

  return NextResponse.json({
    shells: (shells.data ?? []).map((row) => ({ ...row, owner_name: owners.get(row.user_id) ?? null })),
    devices: (devices.data ?? []).map((row) => ({ ...row, owner_name: owners.get(row.user_id) ?? null })),
    diagnostics: diagnostics.data ?? [],
  });
}
