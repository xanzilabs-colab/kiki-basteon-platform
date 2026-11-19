import "server-only";

import { NextResponse } from "next/server";
import { createNotification } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sameOrigin } from "@/lib/verification/http";
import type { CommunityGuardResult } from "./guardrails";

export async function communityAccount(request?: Request) {
  if (request && !sameOrigin(request)) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) {
    return { response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) } as const;
  }

  const db = createAdminClient();
  const { data: profile, error } = await db.from("profiles")
    .select("role,verification_status")
    .eq("id", user.id)
    .single();
  if (error || profile?.role !== "user" || profile.verification_status === "suspended") {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  return { user, db } as const;
}

export async function recordGuardResult(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  communityId: string | null,
  result: CommunityGuardResult,
) {
  if (result.decision === "allow") return { eventRecorded: true, noticeSent: true, mutedUntil: null };
  const decision = result.decision === "redact" ? "redacted" : "refused";
  const { data: mutedUntil, error } = await db.rpc("record_community_guardrail_event", {
    p_user_id: userId,
    p_community_id: communityId,
    p_decision: decision,
    p_categories: result.categories,
    p_severity: result.severity,
  });
  if (error) {
    console.error("Could not record Kiki Guard decision.", error);
    return { eventRecorded: false, noticeSent: false, mutedUntil: null };
  }

  const ids = await createNotification({
    userId,
    type: "system",
    title: "Kiki Guard checked your community message",
    body: result.decision === "refuse"
      ? "Your message was not posted because it may reveal private or identifying details. Review the community safety guidance before trying again."
      : "Kiki Guard removed possible private or identifying details before your message was shared.",
    href: "/account/communities?tab=guard",
  }, db);
  return {
    eventRecorded: true,
    noticeSent: ids.length > 0,
    mutedUntil: typeof mutedUntil === "string" ? mutedUntil : null,
  };
}
