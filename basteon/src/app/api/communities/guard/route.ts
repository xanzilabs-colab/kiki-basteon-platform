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
  const { data: legacyEvents, error: legacyError } = await access.db.from("community_moderation_events")
    .select("decision,categories,severity,created_at")
    .eq("user_id", access.user.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const { data: memberships, error: membershipError } = await access.db.from("community_memberships")
    .select("id")
    .eq("user_id", access.user.id);
  if (legacyError || membershipError) {
    console.error("Could not load Kiki Guard history.", legacyError ?? membershipError);
    return NextResponse.json({ error: "guard_history_unavailable" }, { status: 503 });
  }
  const memberIds = (memberships ?? []).map((membership) => membership.id);
  const { data: interactiveEvents, error: interactiveError } = memberIds.length
    ? await access.db.from("community_guard_events")
      .select("items,created_at")
      .in("membership_id", memberIds)
      .order("created_at", { ascending: false })
      .limit(10)
    : { data: [], error: null };
  if (interactiveError) {
    console.error("Could not load interactive Kiki Guard history.", interactiveError);
    return NextResponse.json({ error: "guard_history_unavailable" }, { status: 503 });
  }
  const events = [
    ...(legacyEvents ?? []).map((event) => ({ ...event, surface: "community", items: event.categories })),
    ...(interactiveEvents ?? []).map((event) => ({ decision: "redacted", categories: event.items, severity: 1, ...event, surface: "interactive" })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
}
