import { NextResponse } from "next/server";
import { communityAccount } from "@/lib/communities/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ communityKey: string }> }) {
  const access = await communityAccount();
  if ("response" in access) return access.response;
  const { communityKey } = await params;

  const { data: community, error: communityError } = await access.db.from("communities")
    .select("id,slug,name,description,scope,icon_key,is_system")
    .eq("slug", communityKey)
    .eq("is_active", true)
    .eq("is_public", true)
    .maybeSingle();
  if (communityError) {
    console.error("Could not load community.", communityError);
    return NextResponse.json({ error: "community_unavailable" }, { status: 503 });
  }
  if (!community) return NextResponse.json({ error: "community_not_found" }, { status: 404 });

  const { data: membership, error: membershipError } = await access.db.from("community_memberships")
    .select("pseudonym,welcome_read_at,muted_until")
    .eq("community_id", community.id)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not load community membership.", membershipError);
    return NextResponse.json({ error: "community_unavailable" }, { status: 503 });
  }
  if (!membership) {
    return NextResponse.json({
      community: { id: community.id, slug: community.slug, name: community.name, description: community.description, scope: community.scope, iconKey: community.icon_key, isSystem: community.is_system },
      isMember: false,
      posts: [],
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const baseQuery = access.db.from("community_posts")
    .select("id,post_type,author_alias,is_kiki,body,created_at")
    .eq("community_id", community.id)
    .eq("status", "published")
    .is("parent_id", null);
  const { data: posts, error: postError } = membership.welcome_read_at
    ? await baseQuery.eq("post_type", "post").gt("created_at", membership.welcome_read_at).order("created_at", { ascending: false }).limit(50)
    : await baseQuery.eq("post_type", "welcome").order("created_at", { ascending: true }).limit(1);
  if (postError) {
    console.error("Could not load community feed.", postError);
    return NextResponse.json({ error: "community_feed_unavailable" }, { status: 503 });
  }

  const postIds = (posts ?? []).map((post) => post.id);
  const [commentsResult, reactionsResult] = postIds.length ? await Promise.all([
    access.db.from("community_posts")
      .select("id,parent_id,author_alias,is_kiki,body,created_at")
      .in("parent_id", postIds)
      .eq("status", "published")
      .eq("post_type", "comment")
      .order("created_at", { ascending: true })
      .limit(500),
    access.db.rpc("community_post_reaction_summary", {
      p_post_ids: postIds,
      p_user_id: access.user.id,
    }),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (commentsResult.error || reactionsResult.error) {
    console.error("Could not load community interactions.", commentsResult.error ?? reactionsResult.error);
    return NextResponse.json({ error: "community_feed_unavailable" }, { status: 503 });
  }

  const commentsByPost = new Map<string, Array<{ id: string; authorAlias: string; isKiki: boolean; body: string; createdAt: string }>>();
  for (const comment of commentsResult.data ?? []) {
    const key = comment.parent_id;
    const group = commentsByPost.get(key) ?? [];
    group.push({ id: comment.id, authorAlias: comment.author_alias, isKiki: comment.is_kiki, body: comment.body, createdAt: comment.created_at });
    commentsByPost.set(key, group);
  }
  const reactionsByPost = new Map<string, { support: number; thanks: number; care: number; mine: string[] }>();
  for (const reaction of reactionsResult.data ?? []) {
    const values = reactionsByPost.get(reaction.post_id) ?? { support: 0, thanks: 0, care: 0, mine: [] };
    if (reaction.reaction === "support") {
      values.support = Number(reaction.reaction_count);
      if (reaction.viewer_reacted) values.mine.push("support");
    } else if (reaction.reaction === "thanks") {
      values.thanks = Number(reaction.reaction_count);
      if (reaction.viewer_reacted) values.mine.push("thanks");
    } else if (reaction.reaction === "care") {
      values.care = Number(reaction.reaction_count);
      if (reaction.viewer_reacted) values.mine.push("care");
    }
    reactionsByPost.set(reaction.post_id, values);
  }

  return NextResponse.json({
    community: { id: community.id, slug: community.slug, name: community.name, description: community.description, scope: community.scope, iconKey: community.icon_key, isSystem: community.is_system },
    isMember: true,
    pseudonym: membership.pseudonym,
    welcomeRequired: membership.welcome_read_at === null,
    canPost: membership.welcome_read_at !== null && (!membership.muted_until || membership.muted_until <= new Date().toISOString()),
    mutedUntil: membership.muted_until,
    posts: (posts ?? []).map((post) => ({
      id: post.id,
      type: post.post_type,
      authorAlias: post.author_alias,
      isKiki: post.is_kiki,
      body: post.body,
      createdAt: post.created_at,
      comments: commentsByPost.get(post.id) ?? [],
      reactions: reactionsByPost.get(post.id) ?? { support: 0, thanks: 0, care: 0, mine: [] },
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
