import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateCommunityText } from "@/lib/communities/guardrails";
import { communityAccount, recordGuardResult } from "@/lib/communities/server";

const postSchema = z.object({
  communityId: z.string().uuid(),
  body: z.string().trim().min(1).max(3000),
  parentId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;
  const input = postSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_message" }, { status: 400 });

  const { data: membership, error: membershipError } = await access.db.from("community_memberships")
    .select("id,muted_until,welcome_read_at")
    .eq("community_id", input.data.communityId)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify community posting access.", membershipError);
    return NextResponse.json({ error: "community_unavailable" }, { status: 503 });
  }
  if (!membership) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  if (!membership.welcome_read_at) return NextResponse.json({ error: "welcome_unread" }, { status: 409 });
  if (membership.muted_until && membership.muted_until > new Date().toISOString()) {
    return NextResponse.json({ error: "posting_muted", mutedUntil: membership.muted_until }, { status: 429 });
  }

  const guard = evaluateCommunityText(input.data.body);
  if (guard.decision === "refuse") {
    const moderation = await recordGuardResult(access.db, access.user.id, input.data.communityId, guard);
    return NextResponse.json({
      error: "message_refused",
      reason: guard.reason,
      noticeSent: moderation.noticeSent,
      eventRecorded: moderation.eventRecorded,
      mutedUntil: moderation.mutedUntil,
    }, { status: 422 });
  }

  const { data: postId, error } = await access.db.rpc("create_community_post", {
    p_community_id: input.data.communityId,
    p_user_id: access.user.id,
    p_body: guard.safeText,
    p_parent_id: input.data.parentId ?? null,
  });
  if (error || typeof postId !== "string") {
    if (error) console.error("Could not publish community message.", error);
    const message = error?.message ?? "";
    if (message.includes("muted")) return NextResponse.json({ error: "posting_muted" }, { status: 429 });
    if (message.includes("welcome_unread")) return NextResponse.json({ error: "welcome_unread" }, { status: 409 });
    if (message.includes("not_member")) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    if (message.includes("rate_limited")) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (message.includes("post_not_found")) return NextResponse.json({ error: "post_not_found" }, { status: 404 });
    return NextResponse.json({ error: "community_post_unavailable" }, { status: 503 });
  }

  const moderation = await recordGuardResult(access.db, access.user.id, input.data.communityId, guard);
  return NextResponse.json({
    id: postId,
    body: guard.safeText,
    redacted: guard.decision === "redact",
    noticeSent: moderation.noticeSent,
    eventRecorded: moderation.eventRecorded,
  }, { status: 201 });
}
