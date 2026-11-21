import { NextResponse } from "next/server";
import { communityAccount, recordInteractiveGuardResult } from "@/lib/communities/server";
import { guardInteractivePost, interactivePostError, interactivePostSchema } from "@/lib/communities/interactive";
import { jpegDimensions } from "@/lib/communities/images";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;

  const parsed = interactivePostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_post" }, { status: 400 });
  const validationError = interactivePostError(parsed.data);
  if (validationError) return NextResponse.json({ error: "invalid_post", reason: validationError }, { status: 400 });

  const { data: membership, error: membershipError } = await access.db.from("community_memberships")
    .select("id,pseudonym,welcome_read_at,muted_until")
    .eq("community_id", parsed.data.communityId)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify interactive post membership.", membershipError);
    return NextResponse.json({ error: "community_unavailable" }, { status: 503 });
  }
  if (!membership) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  if (!membership.welcome_read_at) return NextResponse.json({ error: "scope_not_acknowledged" }, { status: 403 });
  if (membership.muted_until && membership.muted_until > new Date().toISOString()) {
    return NextResponse.json({ error: "posting_muted" }, { status: 429 });
  }

  const guarded = guardInteractivePost(parsed.data, access.realName);
  if (guarded.refusal) {
    const moderation = await recordInteractiveGuardResult(
      access.db, access.user.id, membership.id, parsed.data.communityId, "post", guarded.removed,
    );
    return NextResponse.json({
      error: "guard_refused",
      reason: guarded.refusal,
      eventRecorded: moderation.eventRecorded,
    }, { status: 422 });
  }

  const pathPrefix = `${parsed.data.communityId}/${parsed.data.id}/`;
  for (const [position, image] of guarded.input.media.entries()) {
    if (!image.storagePath.startsWith(pathPrefix)
      || !/^[0-9a-f-]{36}\.(?:jpg|jpeg|webp)$/i.test(image.storagePath.slice(pathPrefix.length))) {
      return NextResponse.json({ error: "invalid_media_path" }, { status: 400 });
    }
    const { data: imageFile, error: imageError } = await access.db.storage.from("community-images").download(image.storagePath);
    if (imageError || !imageFile) {
      if (imageError) console.error("Could not verify uploaded community image.", imageError);
      return NextResponse.json({ error: "media_unavailable" }, { status: 400 });
    }
    const dimensions = jpegDimensions(new Uint8Array(await imageFile.arrayBuffer()));
    if (!dimensions || dimensions.width !== image.width || dimensions.height !== image.height) {
      return NextResponse.json({ error: "invalid_image" }, { status: 400 });
    }
    if (position >= 10) return NextResponse.json({ error: "too_many_images" }, { status: 400 });
  }

  const input = guarded.input;
  const options = input.type === "hot"
    ? [{ label: "Agree", correct: false }, { label: "Disagree", correct: false }]
    : input.type === "mf"
      ? [
        { label: "Myth", correct: input.truth === "Myth" },
        { label: "Fact", correct: input.truth === "Fact" },
      ]
      : input.options;
  const config = input.type === "path"
    ? {
      nodes: input.config.nodes.map((node) => ({
        id: node.id,
        t: node.text,
        ...(node.mediaIndex === undefined ? {} : { media_index: node.mediaIndex }),
        ...(node.end ? { end: true } : {}),
        ...(node.choices ? { ch: node.choices.map((choice) => ({ t: choice.text, to: choice.to, ...(choice.tip ? { tip: choice.tip } : {}) })) } : {}),
      })),
    }
    : input.type === "fill"
      ? { prefix: input.config.prefix, suffix: input.config.suffix }
      : input.type === "hunt"
        ? { hit_radius: input.config.hitRadius }
        : input.type === "chal"
          ? { days: input.config.days }
          : { lo: input.config.lo, hi: input.config.hi };
  const payload = {
    id: input.id,
    user_id: access.user.id,
    community_id: input.communityId,
    type: input.type,
    title: input.title,
    body: input.body,
    config,
    options: options.map((option) => ({ label: option.label, sub_label: ("subLabel" in option ? option.subLabel : "") ?? "", correct: option.correct ?? false })),
    secret: { explanation: input.explanation },
    targets: input.targets.map((target, position) => ({ ...target, position })),
    media: input.media.map((image, position) => ({
      position,
      storage_path: image.storagePath,
      width: image.width,
      height: image.height,
      caption: image.caption,
      alt_text: image.altText,
    })),
    guard_removed: guarded.removed,
    parent_attempt_post_id: input.parentAttemptPostId ?? null,
  };
  const { data: postId, error: createError } = await access.db.rpc("create_community_interactive_post", { p_payload: payload });
  if (createError || typeof postId !== "string") {
    if (createError) console.error("Could not create interactive community post.", createError);
    const message = createError?.message ?? "";
    if (message.includes("muted")) return NextResponse.json({ error: "posting_muted" }, { status: 429 });
    if (message.includes("welcome_unread")) return NextResponse.json({ error: "scope_not_acknowledged" }, { status: 403 });
    if (message.includes("not_member")) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    if (message.includes("rate_limited")) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    return NextResponse.json({ error: "community_post_unavailable" }, { status: 503 });
  }

  const moderation = await recordInteractiveGuardResult(
    access.db, access.user.id, membership.id, input.communityId, "post", guarded.removed,
  );
  return NextResponse.json({
    id: postId,
    removed: guarded.removed,
    eventRecorded: moderation.eventRecorded,
    noticeSent: moderation.noticeSent,
  }, { status: 201 });
}
