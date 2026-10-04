import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sameOrigin } from "@/lib/verification/http";

const schema = z.union([z.object({ id: z.string().uuid() }).strict(), z.object({ all: z.literal(true) }).strict()]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  let query = createAdminClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
  if ("id" in input.data) query = query.eq("id", input.data.id);
  const { error } = await query;
  if (error) return NextResponse.json({ error: "notifications_unavailable" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
