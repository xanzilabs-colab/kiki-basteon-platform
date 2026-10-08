import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";

const schema = z.object({
  organisationId: z.string().uuid(),
  organisationProfileDone: z.boolean().optional(),
  branchesDone: z.boolean().optional(),
  linkingRulesDone: z.boolean().optional(),
  coverageDone: z.boolean().optional(),
  respondersDone: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === payload.data.organisationId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createAdminClient();
  const { data: current } = await db.from("organisation_onboarding").select("*").eq("organisation_id", payload.data.organisationId).maybeSingle();
  const update = {
    organisation_id: payload.data.organisationId,
    organisation_profile_done: payload.data.organisationProfileDone ?? current?.organisation_profile_done ?? false,
    branches_done: payload.data.branchesDone ?? current?.branches_done ?? false,
    linking_rules_done: payload.data.linkingRulesDone ?? current?.linking_rules_done ?? false,
    coverage_done: payload.data.coverageDone ?? current?.coverage_done ?? false,
    responders_done: payload.data.respondersDone ?? current?.responders_done ?? false,
  };
  const completed = update.organisation_profile_done && update.branches_done && update.linking_rules_done && update.coverage_done && update.responders_done;
  const { data, error } = await db
    .from("organisation_onboarding")
    .upsert({
      ...update,
      completed_at: completed ? new Date().toISOString() : null,
    }, { onConflict: "organisation_id" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, onboarding: data });
}
