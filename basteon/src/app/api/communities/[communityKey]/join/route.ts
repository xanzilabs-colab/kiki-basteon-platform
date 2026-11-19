import { NextResponse } from "next/server";
import { z } from "zod";
import { communityAccount } from "@/lib/communities/server";

const idSchema = z.string().uuid();

export async function POST(request: Request, { params }: { params: Promise<{ communityKey: string }> }) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;
  const { communityKey } = await params;
  if (!idSchema.safeParse(communityKey).success) return NextResponse.json({ error: "community_not_found" }, { status: 404 });

  const { data, error } = await access.db.rpc("join_community", {
    p_community_id: communityKey,
    p_user_id: access.user.id,
  });
  if (error || !Array.isArray(data) || !data[0]) {
    if (error) console.error("Could not join community.", error);
    return NextResponse.json({ error: "community_join_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ membership: {
    pseudonym: data[0].pseudonym,
    joinedAt: data[0].joined_at,
    welcomeReadAt: data[0].welcome_read_at,
    mutedUntil: data[0].muted_until,
  } });
}
