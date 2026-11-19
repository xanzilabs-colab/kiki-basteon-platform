import { NextResponse } from "next/server";
import { z } from "zod";
import { communityAccount } from "@/lib/communities/server";

const idSchema = z.string().uuid();

export async function POST(request: Request, { params }: { params: Promise<{ communityKey: string }> }) {
  const access = await communityAccount(request);
  if ("response" in access) return access.response;
  const { communityKey } = await params;
  if (!idSchema.safeParse(communityKey).success) return NextResponse.json({ error: "community_not_found" }, { status: 404 });

  const { data, error } = await access.db.from("community_memberships")
    .update({ welcome_read_at: new Date().toISOString() })
    .eq("community_id", communityKey)
    .eq("user_id", access.user.id)
    .is("welcome_read_at", null)
    .select("welcome_read_at")
    .maybeSingle();
  if (error) {
    console.error("Could not acknowledge community welcome.", error);
    return NextResponse.json({ error: "welcome_acknowledgement_unavailable" }, { status: 503 });
  }
  if (!data) {
    const { data: membership, error: membershipError } = await access.db.from("community_memberships")
      .select("welcome_read_at")
      .eq("community_id", communityKey)
      .eq("user_id", access.user.id)
      .maybeSingle();
    if (membershipError) {
      console.error("Could not verify community membership.", membershipError);
      return NextResponse.json({ error: "welcome_acknowledgement_unavailable" }, { status: 503 });
    }
    if (!membership) return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  }
  return NextResponse.json({ acknowledged: true });
}
