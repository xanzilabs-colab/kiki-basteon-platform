import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateCommunityText } from "@/lib/communities/guardrails";
import { communityAccount, recordGuardResult } from "@/lib/communities/server";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(1).max(280),
  scope: z.string().trim().min(10).max(500),
});

export async function GET() {
  const access = await communityAccount();
  if ("response" in access) return access.response;

  const { data: communities, error } = await access.db.from("communities")
    .select("id,slug,name,description,scope,icon_key,is_system")
    .eq("is_active", true)
    .eq("is_public", true)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) {
    console.error("Could not load communities.", error);
    return NextResponse.json({ error: "communities_unavailable" }, { status: 503 });
  }

  const { data: memberships, error: membershipError } = await access.db.from("community_memberships")
    .select("community_id,pseudonym,welcome_read_at,muted_until")
    .eq("user_id", access.user.id);
  if (membershipError) {
    console.error("Could not load community memberships.", membershipError);
    return NextResponse.json({ error: "communities_unavailable" }, { status: 503 });
  }

  const memberByCommunity = new Map((memberships ?? []).map((membership) => [membership.community_id, membership]));
  const shapedCommunities = await Promise.all((communities ?? []).map(async (community) => {
    const { count, error: countError } = await access.db.from("community_memberships")
      .select("id", { count: "exact", head: true })
      .eq("community_id", community.id);
    if (countError) {
      console.error("Could not count community members.", countError);
      return null;
    }
    const membership = memberByCommunity.get(community.id);
    return {
      id: community.id,
      slug: community.slug,
      name: community.name,
      description: community.description,
      scope: community.scope,
      iconKey: community.icon_key,
      isSystem: community.is_system,
      memberCount: count ?? 0,
      isMember: Boolean(membership),
      pseudonym: membership?.pseudonym ?? null,
      welcomeReadAt: membership?.welcome_read_at ?? null,
      mutedUntil: membership?.muted_until ?? null,
    };
  }));
  if (shapedCommunities.some((community) => community === null)) {
    return NextResponse.json({ error: "communities_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ communities: shapedCommunities, defaultCommunitySlug: "kiki-tips" }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;

  const input = createSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_community" }, { status: 400 });

  const checked = [input.data.name, input.data.description, input.data.scope].map(evaluateCommunityText);
  const flagged = checked.filter((result) => result.decision !== "allow");
  if (flagged.length) {
    const combined: typeof flagged[number] = {
      decision: flagged.some((result) => result.decision === "refuse") ? "refuse" : "redact",
      intent: flagged.some((result) => result.intent === "third_party_disclosure") ? "third_party_disclosure" : "personal_disclosure",
      categories: [...new Set(flagged.flatMap((result) => result.categories))],
      severity: Math.min(5, Math.max(...flagged.map((result) => result.severity))),
      safeText: "",
      reason: "",
    };
    const moderation = await recordGuardResult(access.db, access.user.id, null, combined);
    return NextResponse.json({
      error: "guarded_community",
      decision: combined.decision,
      reason: flagged[0].reason,
      noticeSent: moderation.noticeSent,
      eventRecorded: moderation.eventRecorded,
    }, { status: 422 });
  }

  const slugBase = input.data.name.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const slug = slugBase.replace(/-+$/g, "");
  if (!slug) return NextResponse.json({ error: "invalid_community" }, { status: 400 });

  const { data: communityId, error } = await access.db.rpc("create_community_with_welcome", {
    p_user_id: access.user.id,
    p_slug: slug,
    p_name: input.data.name,
    p_description: input.data.description,
    p_scope: input.data.scope,
    p_icon_key: "users",
    p_welcome_body: "Welcome. Read this community's scope and share general ideas only. Kiki Guard checks every post and reply to help protect your privacy.",
  });
  if (error || typeof communityId !== "string") {
    console.error("Could not create community.", error);
    if (error?.message.includes("rate_limited")) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    return NextResponse.json({ error: "community_create_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ id: communityId, slug }, { status: 201 });
}
