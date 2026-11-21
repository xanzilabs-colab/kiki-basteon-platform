import { NextResponse } from "next/server";
import { communityAccount } from "@/lib/communities/server";

export const dynamic = "force-dynamic";

const feedGroups = new Set(["all", "general", "carousel", "vote", "prompts", "games", "cocreate"]);

function currentJohannesburgDay() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Africa/Johannesburg" });
}

function streakLength(days: string[]) {
  const sorted = [...new Set(days)].sort();
  let streak = 0;
  const today = new Date(`${currentJohannesburgDay()}T00:00:00Z`);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let expected = sorted.includes(currentJohannesburgDay()) ? currentJohannesburgDay() : yesterday;
  for (let index = sorted.length - 1; index >= 0 && sorted[index] === expected; index -= 1) {
    streak += 1;
    expected = new Date(`${expected}T00:00:00Z`).toISOString().slice(0, 10);
    expected = new Date(new Date(`${expected}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return streak;
}

export async function GET(request: Request, { params }: { params: Promise<{ communityKey: string }> }) {
  const access = await communityAccount();
  if ("response" in access) return access.response;
  const { communityKey } = await params;
  const url = new URL(request.url);
  const requestedGroup = url.searchParams.get("group") ?? "all";
  const group = feedGroups.has(requestedGroup) ? requestedGroup : "all";

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
    .select("id,pseudonym,emoji,welcome_read_at,muted_until")
    .eq("community_id", community.id)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not load community membership.", membershipError);
    return NextResponse.json({ error: "community_unavailable" }, { status: 503 });
  }
  const communityView = {
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description,
    scope: community.scope,
    iconKey: community.icon_key,
    isSystem: community.is_system,
  };
  if (!membership) {
    return NextResponse.json({
      community: communityView,
      isMember: false,
      posts: [],
      stories: [],
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const acknowledged = Boolean(membership.welcome_read_at);
  let baseQuery = access.db.from("community_posts")
    .select("id,parent_id,post_type,author_alias,author_emoji,is_kiki,body,title,category_group,config,ends_at,created_at,guard_removed,author_membership_id,parent_attempt_post_id,like_count,helpful_count")
    .eq("community_id", community.id)
    .eq("status", "published");
  if (!acknowledged) {
    baseQuery = baseQuery.eq("post_type", "welcome").is("parent_id", null);
  } else {
    baseQuery = baseQuery.neq("post_type", "welcome").neq("post_type", "comment").is("parent_id", null);
    if (group !== "all") baseQuery = baseQuery.eq("category_group", group);
    const cursor = url.searchParams.get("before");
    const cursorMatch = cursor?.match(/^([^|]+)\|([0-9a-f-]{36})$/i);
    if (cursorMatch && Number.isFinite(Date.parse(cursorMatch[1]))) {
      baseQuery = baseQuery.or(`created_at.lt.${new Date(cursorMatch[1]).toISOString()},and(created_at.eq.${new Date(cursorMatch[1]).toISOString()},id.lt.${cursorMatch[2]})`);
    }
  }
  const { data: posts, error: postError } = await baseQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(20);
  if (postError) {
    console.error("Could not load community feed.", postError);
    return NextResponse.json({ error: "community_feed_unavailable" }, { status: 503 });
  }
  const postIds = (posts ?? []).map((post) => post.id);

  const [{ data: comments, error: commentsError }, { data: stories, error: storiesError }] = await Promise.all([
    acknowledged && postIds.length
      ? access.db.from("community_posts")
        .select("id,parent_id,author_alias,author_emoji,is_kiki,body,created_at,comment_kind,stance,host_answer,host_answered_at,guard_removed")
        .in("parent_id", postIds)
        .eq("status", "published")
        .eq("post_type", "comment")
        .order("created_at", { ascending: false })
        .limit(500)
      : Promise.resolve({ data: [], error: null }),
    acknowledged
      ? access.db.from("community_stories")
        .select("id,title,emoji,byline,body,expires_at")
        .or(`community_id.is.null,community_id.eq.${community.id}`)
        .lte("starts_at", new Date().toISOString())
        .gt("expires_at", new Date().toISOString())
        .order("starts_at", { ascending: false })
        .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (commentsError || storiesError) {
    console.error("Could not load community comments or stories.", commentsError ?? storiesError);
    return NextResponse.json({ error: "community_feed_unavailable" }, { status: 503 });
  }
  if (!postIds.length) {
    return NextResponse.json({
      community: communityView,
      isMember: true,
      pseudonym: membership.pseudonym,
      emoji: membership.emoji,
      welcomeRequired: !acknowledged,
      canPost: acknowledged && (!membership.muted_until || membership.muted_until <= new Date().toISOString()),
      mutedUntil: membership.muted_until,
      posts: (posts ?? []).map((post) => ({
        id: post.id, type: post.post_type, authorAlias: post.author_alias, isKiki: post.is_kiki,
        body: post.body, title: post.title, createdAt: post.created_at, comments: [],
        reactions: { support: 0, thanks: 0, care: 0, mine: [] },
      })),
      stories: stories ?? [],
      nextCursor: null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const [
    optionsResult,
    mediaResult,
    votesMineResult,
    myRatingsResult,
    myLikesResult,
    myHelpfulResult,
    enrollmentsMineResult,
    enrollmentsAllResult,
    checkinsMineResult,
    huntFoundResult,
    huntAttemptsResult,
    huntTargetsResult,
    commentLikesResult,
    reactionResult,
  ] = await Promise.all([
    access.db.from("community_post_options").select("id,post_id,position,label,sub_label").in("post_id", postIds).order("position"),
    access.db.from("community_post_media").select("id,post_id,position,storage_path,width,height,caption,alt_text").in("post_id", postIds).order("position"),
    access.db.from("community_post_votes").select("post_id,option_id,is_correct").in("post_id", postIds).eq("membership_id", membership.id),
    access.db.from("community_post_ratings").select("post_id,value").in("post_id", postIds).eq("membership_id", membership.id),
    access.db.from("community_post_likes").select("post_id").in("post_id", postIds).eq("membership_id", membership.id),
    access.db.from("community_post_helpful").select("post_id").in("post_id", postIds).eq("membership_id", membership.id),
    access.db.from("community_challenge_enrollments").select("post_id").in("post_id", postIds).eq("membership_id", membership.id),
    access.db.from("community_challenge_enrollments").select("post_id").in("post_id", postIds),
    access.db.from("community_challenge_checkins").select("post_id,day").in("post_id", postIds).eq("membership_id", membership.id),
    access.db.from("community_hunt_found").select("post_id,target_id").in("post_id", postIds).eq("membership_id", membership.id),
    access.db.from("community_hunt_attempts").select("post_id").in("post_id", postIds).eq("membership_id", membership.id),
    access.db.from("community_hunt_targets").select("id,post_id").in("post_id", postIds),
    (comments ?? []).length
      ? access.db.from("community_post_comment_likes").select("comment_id,membership_id").in("comment_id", (comments ?? []).map((comment) => comment.id))
      : Promise.resolve({ data: [], error: null }),
    access.db.rpc("community_post_reaction_summary", { p_post_ids: postIds, p_user_id: access.user.id }),
  ]);
  const queryErrors = [
    optionsResult.error, mediaResult.error, votesMineResult.error, myRatingsResult.error,
    myLikesResult.error, myHelpfulResult.error, enrollmentsMineResult.error, enrollmentsAllResult.error, checkinsMineResult.error,
    huntFoundResult.error, huntAttemptsResult.error, huntTargetsResult.error, commentLikesResult.error, reactionResult.error,
  ].filter(Boolean);
  if (queryErrors.length) {
    console.error("Could not load community post interactions.", queryErrors[0]);
    return NextResponse.json({ error: "community_feed_unavailable" }, { status: 503 });
  }

  const myVotes = new Map((votesMineResult.data ?? []).map((vote) => [vote.post_id, vote]));
  const myRatings = new Map((myRatingsResult.data ?? []).map((rating) => [rating.post_id, rating.value]));
  const likedIds = new Set((myLikesResult.data ?? []).map((row) => row.post_id));
  const helpfulIds = new Set((myHelpfulResult.data ?? []).map((row) => row.post_id));
  const enrolledIds = new Set((enrollmentsMineResult.data ?? []).map((row) => row.post_id));
  const enrollmentCounts = new Map<string, number>();
  for (const enrollment of enrollmentsAllResult.data ?? []) {
    enrollmentCounts.set(enrollment.post_id, (enrollmentCounts.get(enrollment.post_id) ?? 0) + 1);
  }
  const checkinsByPost = new Map<string, string[]>();
  for (const checkin of checkinsMineResult.data ?? []) {
    const values = checkinsByPost.get(checkin.post_id) ?? [];
    values.push(checkin.day);
    checkinsByPost.set(checkin.post_id, values);
  }
  const huntFoundByPost = new Map<string, string[]>();
  for (const found of huntFoundResult.data ?? []) {
    const values = huntFoundByPost.get(found.post_id) ?? [];
    values.push(found.target_id);
    huntFoundByPost.set(found.post_id, values);
  }
  const huntTriesByPost = new Map<string, number>();
  for (const attempt of huntAttemptsResult.data ?? []) huntTriesByPost.set(attempt.post_id, (huntTriesByPost.get(attempt.post_id) ?? 0) + 1);
  const targetCounts = new Map<string, number>();
  for (const target of huntTargetsResult.data ?? []) targetCounts.set(target.post_id, (targetCounts.get(target.post_id) ?? 0) + 1);
  const commentLikesById = new Map<string, { count: number; mine: boolean }>();
  for (const like of commentLikesResult.data ?? []) {
    const current = commentLikesById.get(like.comment_id) ?? { count: 0, mine: false };
    current.count += 1;
    if (like.membership_id === membership.id) current.mine = true;
    commentLikesById.set(like.comment_id, current);
  }
  const reactionByPost = new Map<string, { support: number; thanks: number; care: number; mine: string[] }>();
  for (const reaction of reactionResult.data ?? []) {
    const current = reactionByPost.get(reaction.post_id) ?? { support: 0, thanks: 0, care: 0, mine: [] };
    if (reaction.reaction === "support") current.support = Number(reaction.reaction_count);
    if (reaction.reaction === "thanks") current.thanks = Number(reaction.reaction_count);
    if (reaction.reaction === "care") current.care = Number(reaction.reaction_count);
    if (reaction.viewer_reacted) current.mine.push(reaction.reaction);
    reactionByPost.set(reaction.post_id, current);
  }

  const answeredIds = new Set<string>();
  for (const post of posts ?? []) {
    const mine = myVotes.get(post.id);
    const closed = post.post_type === "decide" && Boolean(post.ends_at && post.ends_at <= new Date().toISOString());
    if (mine || closed) answeredIds.add(post.id);
  }
  const answeredPostIds = [...answeredIds];
  const { data: allVotes, error: allVotesError } = answeredPostIds.length
    ? await access.db.from("community_post_votes").select("post_id,option_id,is_correct").in("post_id", answeredPostIds)
    : { data: [], error: null };
  const quizPostIds = (posts ?? []).filter((post) => ["quiz", "mf"].includes(post.post_type) && myVotes.has(post.id)).map((post) => post.id);
  const [{ data: secrets, error: secretsError }, { data: ratings, error: ratingsError }, { data: foundTargets, error: foundTargetsError }] = await Promise.all([
    quizPostIds.length
      ? access.db.from("community_post_secrets").select("post_id,correct_option_id,explanation").in("post_id", quizPostIds)
      : Promise.resolve({ data: [], error: null }),
    (posts ?? []).some((post) => post.post_type === "slider" && myRatings.has(post.id))
      ? access.db.from("community_post_ratings").select("post_id,value").in("post_id", (posts ?? []).filter((post) => post.post_type === "slider" && myRatings.has(post.id)).map((post) => post.id))
      : Promise.resolve({ data: [], error: null }),
    (huntFoundResult.data ?? []).length
      ? access.db.from("community_hunt_targets").select("id,label,x,y").in("id", (huntFoundResult.data ?? []).map((target) => target.target_id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (allVotesError || secretsError || ratingsError || foundTargetsError) {
    console.error("Could not load gated interactive results.", allVotesError ?? secretsError ?? ratingsError ?? foundTargetsError);
    return NextResponse.json({ error: "community_feed_unavailable" }, { status: 503 });
  }

  const voteCountsByPost = new Map<string, Map<string, number>>();
  const correctByPost = new Map<string, number>();
  for (const vote of allVotes ?? []) {
    const options = voteCountsByPost.get(vote.post_id) ?? new Map<string, number>();
    options.set(vote.option_id, (options.get(vote.option_id) ?? 0) + 1);
    voteCountsByPost.set(vote.post_id, options);
    if (vote.is_correct) correctByPost.set(vote.post_id, (correctByPost.get(vote.post_id) ?? 0) + 1);
  }
  const secretsByPost = new Map((secrets ?? []).map((secret) => [secret.post_id, secret]));
  const ratingSummary = new Map<string, { avg: number; count: number }>();
  for (const rating of ratings ?? []) {
    const current = ratingSummary.get(rating.post_id) ?? { avg: 0, count: 0 };
    current.avg += rating.value;
    current.count += 1;
    ratingSummary.set(rating.post_id, current);
  }
  for (const [postId, summary] of ratingSummary) summary.avg = Math.round(summary.avg / summary.count);
  const foundLabelsByPost = new Map<string, Array<{ id: string; label: string; x: number; y: number }>>();
  for (const target of foundTargets ?? []) {
    const values = foundLabelsByPost.get(target.id) ?? [];
    values.push({ id: target.id, label: target.label, x: Number(target.x), y: Number(target.y) });
    foundLabelsByPost.set(target.id, values);
  }

  const mediaRows = mediaResult.data ?? [];
  const storagePaths = mediaRows.map((media) => media.storage_path);
  const { data: signedUrls, error: signedUrlError } = storagePaths.length
    ? await access.db.storage.from("community-images").createSignedUrls(storagePaths, 60 * 60)
    : { data: [], error: null };
  if (signedUrlError) {
    console.error("Could not sign private community image URLs.", signedUrlError);
    return NextResponse.json({ error: "community_media_unavailable" }, { status: 503 });
  }
  const signedUrlByPath = new Map(
    (signedUrls ?? [])
      .filter((entry) => entry.path && entry.signedUrl)
      .map((entry) => [entry.path as string, entry.signedUrl as string]),
  );
  const mediaByPost = new Map<string, Array<Record<string, unknown>>>();
  for (const media of mediaRows) {
    const list = mediaByPost.get(media.post_id) ?? [];
    list.push({
      id: media.id,
      position: media.position,
      url: signedUrlByPath.get(media.storage_path) ?? null,
      storagePath: media.storage_path,
      width: media.width,
      height: media.height,
      caption: media.caption,
      altText: media.alt_text,
    });
    mediaByPost.set(media.post_id, list);
  }
  const optionsByPost = new Map<string, Array<Record<string, unknown>>>();
  for (const option of optionsResult.data ?? []) {
    const list = optionsByPost.get(option.post_id) ?? [];
    list.push({ id: option.id, label: option.label, subLabel: option.sub_label, position: option.position });
    optionsByPost.set(option.post_id, list);
  }
  const commentsByPost = new Map<string, Array<Record<string, unknown>>>();
  for (const comment of comments ?? []) {
    const list = commentsByPost.get(comment.parent_id) ?? [];
    const likes = commentLikesById.get(comment.id) ?? { count: 0, mine: false };
    list.push({
      id: comment.id,
      authorAlias: comment.author_alias,
      emoji: comment.author_emoji,
      isKiki: comment.is_kiki,
      body: comment.body,
      createdAt: comment.created_at,
      kind: comment.comment_kind,
      stance: comment.stance,
      hostAnswer: comment.host_answer,
      hostAnsweredAt: comment.host_answered_at,
      likes: likes.count,
      liked: likes.mine,
    });
    commentsByPost.set(comment.parent_id, list);
  }

  const postsForResponse = await Promise.all((posts ?? []).map(async (post) => {
    const commentsForPost = commentsByPost.get(post.id) ?? [];
    const postOptions = optionsByPost.get(post.id) ?? [];
    const options = postOptions as Array<{ id: string; label: string; subLabel: string | null; position: number }>;
    const myVote = myVotes.get(post.id);
    const myRating = myRatings.get(post.id);
    const closed = post.post_type === "decide" && Boolean(post.ends_at && post.ends_at <= new Date().toISOString());
    const canSeeResults = Boolean(myVote) || closed;
    const tallies = canSeeResults ? options.map((option) => ({
      optionId: option.id,
      votes: voteCountsByPost.get(post.id)?.get(option.id) ?? 0,
    })) : [];
    const isQuiz = post.post_type === "quiz" || post.post_type === "mf";
    const secret = isQuiz && myVote ? secretsByPost.get(post.id) : null;
    const ratingsSummary = ratingSummary.get(post.id);
    const checkinDays = checkinsByPost.get(post.id) ?? [];
    const currentDay = currentJohannesburgDay();
    const huntTargetIds = huntFoundByPost.get(post.id) ?? [];
    const foundTargetsForPost = huntTargetIds.flatMap((id) => foundLabelsByPost.get(id) ?? []);
    const publicConfig = post.post_type === "hunt"
      ? { ...post.config, targets_count: targetCounts.get(post.id) ?? 0 }
      : post.config;
    const reactions = reactionByPost.get(post.id) ?? { support: 0, thanks: 0, care: 0, mine: [] };
    return {
      id: post.id,
      type: post.post_type,
      categoryGroup: post.category_group,
      authorAlias: post.author_alias,
      authorEmoji: post.author_emoji,
      isKiki: post.is_kiki,
      isHost: post.author_membership_id === membership.id,
      title: post.title,
      body: post.body,
      createdAt: post.created_at,
      endsAt: post.ends_at,
      closed,
      parentAttemptPostId: post.parent_attempt_post_id,
      guardRemoved: (post.guard_removed ?? []).length > 0,
      config: publicConfig,
      options,
      media: mediaByPost.get(post.id) ?? [],
      comments: commentsForPost,
      topAnswers: commentsForPost.filter((comment) => comment.kind === "answer" || comment.kind === "question")
        .sort((left, right) => Number(right.likes) - Number(left.likes)).slice(0, 4),
      recentReplies: commentsForPost.filter((comment) => comment.kind === "reply").slice(0, 3),
      likeCount: post.like_count ?? 0,
      helpfulCount: post.helpful_count ?? 0,
      iLiked: likedIds.has(post.id),
      iHelpful: helpfulIds.has(post.id),
      reactions,
      my: {
        voteOptionId: myVote?.option_id ?? null,
        rating: myRating ?? null,
        hunt: { found: foundTargetsForPost, tries: huntTriesByPost.get(post.id) ?? 0 },
        challenge: {
          joined: enrolledIds.has(post.id),
          daysDone: checkinDays,
          streak: streakLength(checkinDays),
          todayDone: checkinDays.includes(currentDay),
        },
      },
      results: {
        tallies,
        ...(secret ? {
          quiz: {
            correctOptionId: secret.correct_option_id,
            explanation: secret.explanation,
            isCorrect: myVote?.is_correct ?? false,
            pctCorrect: (allVotes ?? []).filter((vote) => vote.post_id === post.id).length
              ? Math.round((correctByPost.get(post.id) ?? 0) / (allVotes ?? []).filter((vote) => vote.post_id === post.id).length * 100)
              : 0,
          },
        } : {}),
        ...(myRating !== undefined && ratingsSummary ? { slider: ratingsSummary } : {}),
        ...(post.post_type === "chal" ? {
          challenge: { participants: enrollmentCounts.get(post.id) ?? 0 },
        } : {}),
      },
    };
  }));
  const nextCursor = (posts ?? []).length === 20
    ? `${posts![posts!.length - 1].created_at}|${posts![posts!.length - 1].id}`
    : null;

  return NextResponse.json({
    community: communityView,
    isMember: true,
    pseudonym: membership.pseudonym,
    emoji: membership.emoji,
    welcomeRequired: !acknowledged,
    canPost: acknowledged && (!membership.muted_until || membership.muted_until <= new Date().toISOString()),
    mutedUntil: membership.muted_until,
    posts: postsForResponse,
    stories: stories ?? [],
    nextCursor,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
