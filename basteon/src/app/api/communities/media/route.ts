import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { jpegDimensions, jpegHasSensitiveMetadata } from "@/lib/communities/images";
import { communityAccount } from "@/lib/communities/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;

  const form = await request.formData().catch(() => null);
  const communityId = form?.get("communityId");
  const postId = form?.get("postId");
  const file = form?.get("file");
  if (typeof communityId !== "string" || typeof postId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(communityId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId)
    || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "images_only" }, { status: 415 });
  }
  if (file.type !== "image/jpeg" || file.size < 1 || file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  }

  const { data: membership, error: membershipError } = await access.db.from("community_memberships")
    .select("id,welcome_read_at,muted_until")
    .eq("community_id", communityId)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify image upload membership.", membershipError);
    return NextResponse.json({ error: "community_unavailable" }, { status: 503 });
  }
  if (!membership) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  if (!membership.welcome_read_at) return NextResponse.json({ error: "scope_not_acknowledged" }, { status: 403 });
  if (membership.muted_until && membership.muted_until > new Date().toISOString()) {
    return NextResponse.json({ error: "posting_muted" }, { status: 429 });
  }

  const { data: existingPost, error: postLookupError } = await access.db.from("community_posts")
    .select("id")
    .eq("id", postId)
    .maybeSingle();
  if (postLookupError) {
    console.error("Could not verify draft image post.", postLookupError);
    return NextResponse.json({ error: "media_unavailable" }, { status: 503 });
  }
  if (existingPost) return NextResponse.json({ error: "post_already_exists" }, { status: 409 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = jpegDimensions(bytes);
  if (!dimensions || dimensions.width > 4000 || dimensions.height > 4000 || jpegHasSensitiveMetadata(bytes)) {
    return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  }

  const storagePath = `${communityId}/${postId}/${randomUUID()}.jpg`;
  const { data: existingUploads, error: listError } = await access.db.storage.from("community-images")
    .list(`${communityId}/${postId}`, { limit: 11 });
  if (listError) {
    console.error("Could not check the draft image limit.", listError);
    return NextResponse.json({ error: "media_upload_unavailable" }, { status: 503 });
  }
  if ((existingUploads ?? []).length >= 10) return NextResponse.json({ error: "too_many_images" }, { status: 400 });
  const { error: uploadError } = await access.db.storage.from("community-images").upload(storagePath, bytes, {
    contentType: "image/jpeg",
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    console.error("Could not upload community image.", uploadError);
    return NextResponse.json({ error: "media_upload_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ storagePath, width: dimensions.width, height: dimensions.height }, { status: 201 });
}
