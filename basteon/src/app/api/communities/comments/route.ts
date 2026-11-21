import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateInteractiveCommunityText } from "@/lib/communities/guardrails";
import { communityAccount, recordInteractiveGuardResult } from "@/lib/communities/server";

const commentSchema = z.object({
  postId: z.string().uuid(),
  kind: z.enum(["reply", "answer", "question", "host_answer"]),
  body: z.string().trim().min(1).max(400),
  stance: z.enum(["Agree", "Nuance", "Disagree"]).optional(),
  commentId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;
  const parsed = commentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_comment" }, { status: 400 });
  const input = parsed.data;
  const limit = input.kind === "reply" ? 280 : input.kind === "host_answer" ? 400 : 140;
  if (input.body.length > limit || (input.kind === "host_answer" && !input.commentId)) {
    return NextResponse.json({ error: "invalid_comment" }, { status: 400 });
  }
  if (input.stance && input.kind !== "answer") return NextResponse.json({ error: "invalid_comment" }, { status: 400 });

  const { data: post, error: postError } = await access.db.from("community_posts")
    .select("id,community_id,post_type,author_membership_id,is_kiki,status")
    .eq("id", input.postId)
    .eq("status", "published")
    .is("parent_id", null)
    .maybeSingle();
  if (postError) {
    console.error("Could not verify community post for comment.", postError);
    return NextResponse.json({ error: "community_unavailable" }, { status: 503 });
  }
  if (!post) return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  const { data: membership, error: membershipError } = await access.db.from("community_memberships")
    .select("id,pseudonym,emoji,welcome_read_at,muted_until")
    .eq("community_id", post.community_id)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify community comment membership.", membershipError);
    return NextResponse.json({ error: "community_unavailable" }, { status: 503 });
  }
  if (!membership) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  if (!membership.welcome_read_at) return NextResponse.json({ error: "scope_not_acknowledged" }, { status: 403 });
  if (membership.muted_until && membership.muted_until > new Date().toISOString()) {
    return NextResponse.json({ error: "posting_muted" }, { status: 429 });
  }

  const allowedKinds = input.kind === "reply"
    || (input.kind === "answer" && ["fill", "cap", "hot"].includes(post.post_type))
    || (input.kind === "question" && post.post_type === "ama")
    || (input.kind === "host_answer" && post.post_type === "ama");
  if (!allowedKinds) return NextResponse.json({ error: "wrong_comment_kind" }, { status: 400 });
  if (input.kind === "host_answer" && post.author_membership_id !== membership.id) {
    return NextResponse.json({ error: "not_host" }, { status: 403 });
  }

  const { count, error: rateError } = await access.db.from("community_posts")
    .select("id", { count: "exact", head: true })
    .eq("author_membership_id", membership.id)
    .eq("post_type", "comment")
    .gt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (rateError) {
    console.error("Could not check comment rate limit.", rateError);
    return NextResponse.json({ error: "community_comment_unavailable" }, { status: 503 });
  }
  if ((count ?? 0) >= 60) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const guard = evaluateInteractiveCommunityText(input.body, access.realName);
  const moderation = await recordInteractiveGuardResult(
    access.db, access.user.id, membership.id, post.community_id, input.kind, guard.removed,
  );
  if (guard.decision === "refuse") {
    return NextResponse.json({ error: "guard_refused", reason: guard.reason, eventRecorded: moderation.eventRecorded }, { status: 422 });
  }

  if (input.kind === "host_answer") {
    const { data: answeredQuestion, error: answerError } = await access.db.from("community_posts")
      .update({ host_answer: guard.safeText, host_answered_at: new Date().toISOString(), guard_removed: guard.removed })
      .eq("id", input.commentId!)
      .eq("parent_id", post.id)
      .eq("comment_kind", "question")
      .eq("status", "published")
      .select("id")
      .maybeSingle();
    if (answerError || !answeredQuestion) {
      console.error("Could not save AMA host answer.", answerError);
      return NextResponse.json({ error: answeredQuestion ? "community_comment_unavailable" : "question_not_found" }, { status: answeredQuestion ? 503 : 404 });
    }
    return NextResponse.json({ id: input.commentId, body: guard.safeText, removed: guard.removed });
  }

  const { data: commentId, error: insertError } = await access.db.from("community_posts").insert({
    community_id: post.community_id,
    author_membership_id: membership.id,
    parent_id: post.id,
    post_type: "comment",
    author_alias: membership.pseudonym,
    author_emoji: membership.emoji,
    is_kiki: false,
    body: guard.safeText,
    comment_kind: input.kind,
    stance: input.kind === "answer" ? input.stance ?? null : null,
    guard_removed: guard.removed,
  }).select("id").single();
  if (insertError || !commentId) {
    if (insertError) console.error("Could not save community comment.", insertError);
    return NextResponse.json({ error: "community_comment_unavailable" }, { status: 503 });
  }
  return NextResponse.json({
    id: commentId.id,
    body: guard.safeText,
    removed: guard.removed,
    eventRecorded: moderation.eventRecorded,
    noticeSent: moderation.noticeSent,
  }, { status: 201 });
}
