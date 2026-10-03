import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
  const db = createAdminClient();
  const { data: device } = await db.from("devices").select("user_id").eq("id", id).maybeSingle();
  if (!device || (device.user_id !== user.id && profile?.role !== "admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { error } = await db.from("devices").update({ user_id: null, linked_at: null, unlinked_at: new Date().toISOString(), unlinked_by: user.id }).eq("id", id);
  return error ? NextResponse.json({ error: "unlink_failed" }, { status: 500 }) : NextResponse.json({ ok: true });
}