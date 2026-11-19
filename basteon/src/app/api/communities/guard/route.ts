import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateCommunityText } from "@/lib/communities/guardrails";
import { communityAccount } from "@/lib/communities/server";

const previewSchema = z.object({ text: z.string().min(1).max(3000) });

export async function POST(request: Request) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;
  const input = previewSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_message" }, { status: 400 });
  const result = evaluateCommunityText(input.data.text);
  return NextResponse.json({
    decision: result.decision,
    intent: result.intent,
    categories: result.categories,
    severity: result.severity,
    safeText: result.safeText,
    reason: result.reason,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const access = await communityAccount();
  if ("response" in access) return access.response;
  const { data, error } = await access.db.from("community_moderation_events")
    .select("decision,categories,severity,created_at")
    .eq("user_id", access.user.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("Could not load Kiki Guard history.", error);
    return NextResponse.json({ error: "guard_history_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ events: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
