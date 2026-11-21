import { NextResponse } from "next/server";
import { z } from "zod";
import { communityAccount } from "@/lib/communities/server";

const interactionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("vote"), postId: z.string().uuid(), optionId: z.string().uuid() }),
  z.object({ action: z.literal("rate"), postId: z.string().uuid(), value: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal("challenge"), postId: z.string().uuid(), mode: z.enum(["join", "leave", "checkin"]) }),
  z.object({ action: z.literal("hunt"), postId: z.string().uuid(), x: z.number().min(0).max(100), y: z.number().min(0).max(100) }),
  z.object({ action: z.literal("path_finish"), postId: z.string().uuid(), endNode: z.number().int().min(0).max(6) }),
  z.object({ action: z.literal("comment_like"), commentId: z.string().uuid() }),
]);

function rpcErrorResponse(message: string) {
  if (message.includes("not_a_member")) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  if (message.includes("post_not_found")) return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  if (message.includes("already_answered")) return NextResponse.json({ error: "already_answered" }, { status: 409 });
  if (message.includes("already_rated")) return NextResponse.json({ error: "already_rated" }, { status: 409 });
  if (message.includes("voting_closed")) return NextResponse.json({ error: "voting_closed" }, { status: 409 });
  if (message.includes("already_complete")) return NextResponse.json({ error: "already_complete" }, { status: 409 });
  if (message.includes("not_enrolled")) return NextResponse.json({ error: "not_enrolled" }, { status: 409 });
  if (message.includes("too_many_attempts")) return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  if (message.includes("wrong_type") || message.includes("invalid_option") || message.includes("bad_coords")) {
    return NextResponse.json({ error: "invalid_interaction" }, { status: 400 });
  }
  return NextResponse.json({ error: "interaction_unavailable" }, { status: 503 });
}

export async function POST(request: Request) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;
  const parsed = interactionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_interaction" }, { status: 400 });
  const input = parsed.data;

  if (input.action === "comment_like") {
    const { data: comment, error: commentError } = await access.db.from("community_posts")
      .select("id,parent_id,community_id")
      .eq("id", input.commentId)
      .eq("post_type", "comment")
      .eq("status", "published")
      .maybeSingle();
    if (commentError) {
      console.error("Could not verify community comment.", commentError);
      return NextResponse.json({ error: "interaction_unavailable" }, { status: 503 });
    }
    if (!comment?.parent_id) return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
    const { data: membership, error: membershipError } = await access.db.from("community_memberships")
      .select("id,welcome_read_at")
      .eq("community_id", comment.community_id)
      .eq("user_id", access.user.id)
      .maybeSingle();
    if (membershipError) {
      console.error("Could not verify comment-like membership.", membershipError);
      return NextResponse.json({ error: "interaction_unavailable" }, { status: 503 });
    }
    if (!membership || !membership.welcome_read_at) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    const { data: existing, error: lookupError } = await access.db.from("community_post_comment_likes")
      .select("comment_id")
      .eq("comment_id", input.commentId)
      .eq("membership_id", membership.id)
      .maybeSingle();
    if (lookupError) {
      console.error("Could not load comment like.", lookupError);
      return NextResponse.json({ error: "interaction_unavailable" }, { status: 503 });
    }
    const result = existing
      ? await access.db.from("community_post_comment_likes").delete().eq("comment_id", input.commentId).eq("membership_id", membership.id)
      : await access.db.from("community_post_comment_likes").insert({ comment_id: input.commentId, membership_id: membership.id });
    if (result.error) {
      console.error("Could not update comment like.", result.error);
      return NextResponse.json({ error: "interaction_unavailable" }, { status: 503 });
    }
    const { count, error: countError } = await access.db.from("community_post_comment_likes")
      .select("comment_id", { count: "exact", head: true })
      .eq("comment_id", input.commentId);
    if (countError) {
      console.error("Could not count comment likes.", countError);
      return NextResponse.json({ error: "interaction_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ active: !existing, count: count ?? 0 });
  }

  const { data: post, error: postError } = await access.db.from("community_posts")
    .select("id,community_id")
    .eq("id", input.postId)
    .is("parent_id", null)
    .eq("status", "published")
    .maybeSingle();
  if (postError) {
    console.error("Could not verify interactive post.", postError);
    return NextResponse.json({ error: "interaction_unavailable" }, { status: 503 });
  }
  if (!post) return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  const { data: membership, error: membershipError } = await access.db.from("community_memberships")
    .select("id,welcome_read_at")
    .eq("community_id", post.community_id)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify interactive membership.", membershipError);
    return NextResponse.json({ error: "interaction_unavailable" }, { status: 503 });
  }
  if (!membership || !membership.welcome_read_at) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  let result;
  if (input.action === "vote") {
    result = await access.db.rpc("community_interactive_vote", {
      p_post_id: input.postId, p_user_id: access.user.id, p_option_id: input.optionId,
    });
  } else if (input.action === "rate") {
    result = await access.db.rpc("community_interactive_rate", {
      p_post_id: input.postId, p_user_id: access.user.id, p_value: input.value,
    });
  } else if (input.action === "challenge") {
    result = await access.db.rpc("community_interactive_challenge_action", {
      p_post_id: input.postId, p_user_id: access.user.id, p_mode: input.mode,
    });
  } else if (input.action === "hunt") {
    result = await access.db.rpc("community_interactive_hunt_guess", {
      p_post_id: input.postId, p_user_id: access.user.id, p_x: input.x, p_y: input.y,
    });
  } else {
    result = await access.db.rpc("community_interactive_path_finish", {
      p_post_id: input.postId, p_user_id: access.user.id, p_end_node: input.endNode,
    });
  }
  if (result.error) {
    console.error(`Could not apply community ${input.action} interaction.`, result.error);
    return rpcErrorResponse(result.error.message);
  }
  return NextResponse.json({ result: result.data });
}
