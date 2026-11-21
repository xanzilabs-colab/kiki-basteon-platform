import { NextResponse } from "next/server";
import { z } from "zod";
import { communityAccount } from "@/lib/communities/server";

const reactionSchema = z.object({
  postId: z.string().uuid(),
  reaction: z.enum(["support", "thanks", "care", "like", "helpful"]),
});

export async function POST(request: Request) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;
  const input = reactionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_reaction" }, { status: 400 });

  const { data: post, error: postError } = await access.db.from("community_posts")
    .select("id,community_id")
    .eq("id", input.data.postId)
    .neq("post_type", "welcome")
    .is("parent_id", null)
    .eq("status", "published")
    .maybeSingle();
  if (postError) {
    console.error("Could not verify community post.", postError);
    return NextResponse.json({ error: "reaction_unavailable" }, { status: 503 });
  }
  if (!post) return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  const { data: membership, error: membershipError } = await access.db.from("community_memberships")
    .select("id,welcome_read_at")
    .eq("community_id", post.community_id)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify community membership.", membershipError);
    return NextResponse.json({ error: "reaction_unavailable" }, { status: 503 });
  }
  if (!membership || !membership.welcome_read_at) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  if (input.data.reaction === "like" || input.data.reaction === "helpful") {
    const table = input.data.reaction === "like" ? "community_post_likes" : "community_post_helpful";
    const { data: existing, error: lookupError } = await access.db.from(table)
      .select("post_id")
      .eq("post_id", input.data.postId)
      .eq("membership_id", membership.id)
      .maybeSingle();
    if (lookupError) {
      console.error("Could not load community reaction.", lookupError);
      return NextResponse.json({ error: "reaction_unavailable" }, { status: 503 });
    }
    const result = existing
      ? await access.db.from(table).delete().eq("post_id", input.data.postId).eq("membership_id", membership.id)
      : await access.db.from(table).insert({ post_id: input.data.postId, membership_id: membership.id });
    if (result.error) {
      console.error("Could not update community reaction.", result.error);
      return NextResponse.json({ error: "reaction_unavailable" }, { status: 503 });
    }
    const { data: postCounts, error: countError } = await access.db.from("community_posts")
      .select("like_count,helpful_count")
      .eq("id", input.data.postId)
      .maybeSingle();
    if (countError) {
      console.error("Could not load community reaction counts.", countError);
      return NextResponse.json({ error: "reaction_unavailable" }, { status: 503 });
    }
    const count = input.data.reaction === "like"
      ? Number(postCounts?.like_count ?? 0)
      : Number(postCounts?.helpful_count ?? 0);
    return NextResponse.json({ active: !existing, count });
  }

  const { data: existing, error: lookupError } = await access.db.from("community_reactions")
    .select("post_id")
    .eq("post_id", input.data.postId)
    .eq("membership_id", membership.id)
    .eq("reaction", input.data.reaction)
    .maybeSingle();
  if (lookupError) {
    console.error("Could not load community reaction.", lookupError);
    return NextResponse.json({ error: "reaction_unavailable" }, { status: 503 });
  }
  const result = existing
    ? await access.db.from("community_reactions").delete().eq("post_id", input.data.postId).eq("membership_id", membership.id).eq("reaction", input.data.reaction)
    : await access.db.from("community_reactions").upsert(
      { post_id: input.data.postId, membership_id: membership.id, reaction: input.data.reaction },
      { onConflict: "post_id,membership_id,reaction", ignoreDuplicates: true },
    );
  if (result.error) {
    console.error("Could not update community reaction.", result.error);
    return NextResponse.json({ error: "reaction_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ active: !existing });
}
