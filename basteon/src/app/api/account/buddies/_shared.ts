import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sameOrigin } from "@/lib/verification/http";
import { normalizeKikiId } from "@/lib/buddyIds";

export async function buddyAccount(request?: Request) {
  if (request && !sameOrigin(request)) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) } as const;

  const db = createAdminClient();
  const { data: profile, error } = await db
    .from("profiles")
    .select("role,verification_status")
    .eq("id", user.id)
    .single();
  if (error || profile?.role !== "user" || profile.verification_status === "suspended") {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  return { user, db } as const;
}

export async function publicBuddyProfile(db: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await db
    .from("profiles")
    .select("id,kiki_id,full_name,avatar_path")
    .eq("id", userId)
    .single();
  if (error || !data) return null;

  let avatarUrl: string | null = null;
  if (data.avatar_path) {
    const { data: signed, error: signError } = await db.storage
      .from("kiki-profile-images")
      .createSignedUrl(data.avatar_path, 3_600);
    if (signError) {
      console.error("Could not sign buddy profile image", signError);
    } else {
      avatarUrl = signed.signedUrl;
    }
  }

  return {
    id: data.id as string,
    kikiId: data.kiki_id as string,
    name: (data.full_name as string | null)?.trim() || "Kiki member",
    avatarUrl,
  };
}
