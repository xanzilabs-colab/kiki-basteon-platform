import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ device_id: z.string().trim().min(1).max(64), nickname: z.string().optional() });

export async function POST(request: Request) {
  const input = inputSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await client.from("profiles").select("full_name,phone").eq("id", user.id).single();
  if (!profile?.full_name?.trim() || !profile.phone?.trim()) return NextResponse.json({ error: "profile_incomplete" }, { status: 422 });

  const db = createAdminClient();
  const { data: device } = await db.from("devices").select("device_id,user_id,active").eq("device_id", input.data.device_id).maybeSingle();
  if (!device || !device.active) return NextResponse.json({ error: "device_not_registered" }, { status: 404 });
  if (device.user_id && device.user_id !== user.id) return NextResponse.json({ error: "already_owned" }, { status: 409 });
  if (device.user_id === user.id) return NextResponse.json({ already_linked: true });

  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db.from("device_link_tokens").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", cutoff);
  if ((count ?? 0) >= 5) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  await db.from("device_link_tokens").update({ expires_at: new Date().toISOString() }).eq("user_id", user.id).eq("device_id", device.device_id).is("used_at", null);
  const token = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const nickname = input.data.nickname?.trim().slice(0, 40) || null;
  const { error } = await db.from("device_link_tokens").insert({ user_id: user.id, device_id: device.device_id, token_hash: tokenHash, nickname, expires_at: expiresAt });
  if (error) return NextResponse.json({ error: "could_not_start_link" }, { status: 500 });
  return NextResponse.json({ token, expires_at: expiresAt });
}