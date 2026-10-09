import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/organisation";

const actionSchema = z.object({ action: z.enum(["start", "advance", "reset"]) });
const stages = ["ready", "due_soon", "nudge", "countdown", "resolved"] as const;

function enabled() {
  return process.env.KIKI_INTELLIGENCE_DEMO_ENABLED === "true";
}

export async function GET() {
  if (!enabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await createAdminClient().from("intelligence_demo_sessions")
    .select("id,status,stage,reason,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data ?? null });
}

export async function POST(request: Request) {
  if (!enabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = createAdminClient();
  const { data: allowed, error: limitError } = await db.rpc("consume_intelligence_limit", {
    p_user_id: userId,
    p_action_key: "intelligence_demo",
    p_limit: 20,
    p_window_seconds: 60,
  });
  if (limitError) return NextResponse.json({ error: limitError.message }, { status: 500 });
  if (!allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  if (parsed.data.action === "reset") {
    const { error } = await db.from("intelligence_demo_sessions").delete().eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ session: null });
  }
  if (parsed.data.action === "start") {
    const now = new Date().toISOString();
    const { data, error } = await db.from("intelligence_demo_sessions").insert({
      user_id: userId,
      status: "active",
      stage: "ready",
      simulated_started_at: now,
      simulated_expected_at: new Date(Date.now() + 12 * 60_000).toISOString(),
      reason: { text: "Synthetic demo only. This scenario uses no real trip, route, location, or contacts." },
      updated_at: now,
    }).select("id,status,stage,reason,updated_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ session: data });
  }

  const { data: session, error: readError } = await db.from("intelligence_demo_sessions")
    .select("id,status,stage")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "No active demo. Start a new scenario first." }, { status: 409 });
  const nextStage = stages[Math.min(stages.indexOf(session.stage as typeof stages[number]) + 1, stages.length - 1)];
  const now = new Date().toISOString();
  const { data, error } = await db.from("intelligence_demo_sessions").update({
    stage: nextStage,
    status: nextStage === "resolved" ? "resolved" : "active",
    reason: { text: `Synthetic demo stage: ${nextStage}. No real trip or person is affected.` },
    updated_at: now,
  }).eq("id", session.id).eq("user_id", userId)
    .select("id,status,stage,reason,updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
