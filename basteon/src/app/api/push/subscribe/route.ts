import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role === "user") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const input = subscriptionSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });

  const { error } = await createAdminClient().from("push_subscriptions").upsert({
    endpoint: input.data.endpoint,
    user_id: user.id,
    subscription: input.data,
  }, { onConflict: "endpoint" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}