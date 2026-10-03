import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const renameSchema = z.object({ device_name: z.string().trim().min(1).max(100) });
type Context = { params: Promise<{ id: string }> };

async function access(id: string) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
  const db = createAdminClient();
  const { data: device } = await db.from("devices").select("id,user_id").eq("id", id).maybeSingle();
  if (!device || (device.user_id !== user.id && profile?.role !== "admin")) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { user, db, device };
}

export async function PATCH(request: Request, context: Context) {
  const input = renameSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { id } = await context.params; const result = await access(id); if (result.error) return result.error;
  const { error } = await result.db!.from("devices").update({ device_name: input.data.device_name }).eq("id", id);
  return error ? NextResponse.json({ error: "update_failed" }, { status: 500 }) : NextResponse.json({ ok: true });
}