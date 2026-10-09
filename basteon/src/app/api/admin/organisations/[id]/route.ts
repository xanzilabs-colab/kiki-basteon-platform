import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomPassword } from "@/lib/organisation";

async function allowed() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const { data } = user ? await client.from("profiles").select("role").eq("id", user.id).single() : { data: null };
  return { ok: data?.role === "admin", userId: user?.id ?? null };
}

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const auth = await allowed();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;
  const db = createAdminClient();

  const [{ data: organisation, error }, { count: memberCount }, { count: responderCount }, { count: beneficiaryCount }] = await Promise.all([
    db.from("organisations").select("*").eq("id", id).single(),
    db.from("organisation_memberships").select("*", { count: "exact", head: true }).eq("organisation_id", id).not("status", "in", "(removed,revoked,archived)"),
    db.from("organisation_memberships").select("*", { count: "exact", head: true }).eq("organisation_id", id).in("role", ["owner", "admin", "manager", "dispatcher", "responder", "viewer"]).not("status", "in", "(removed,revoked,archived)"),
    db.from("organisation_memberships").select("*", { count: "exact", head: true }).eq("organisation_id", id).or("membership_type.eq.member,role.eq.member").not("status", "in", "(removed,revoked,archived)"),
  ]);
  if (error || !organisation) return NextResponse.json({ error: error?.message ?? "Organisation not found" }, { status: 404 });

  const { data: ownerMembership } = await db
    .from("organisation_memberships")
    .select("user_id,profiles(full_name)")
    .eq("organisation_id", id)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();

  return NextResponse.json({
    organisation,
    owner: ownerMembership ? {
      userId: ownerMembership.user_id,
      name: (ownerMembership as any).profiles?.full_name ?? null,
    } : null,
    counts: {
      members: memberCount ?? 0,
      responders: responderCount ?? 0,
      beneficiaries: beneficiaryCount ?? 0,
    },
  });
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("block"),
    blockedUntil: z.string().datetime(),
    reason: z.string().min(3),
  }),
  z.object({
    action: z.literal("unblock"),
  }),
  z.object({
    action: z.literal("reset_owner_password"),
  }),
]);

export async function PATCH(request: Request, context: Context) {
  const auth = await allowed();
  if (!auth.ok || !auth.userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = createAdminClient();

  if (parsed.data.action === "block") {
    const { error } = await db.from("organisations").update({
      status: "suspended",
      blocked_until: parsed.data.blockedUntil,
      blocked_reason: parsed.data.reason,
      blocked_by: auth.userId,
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "unblock") {
    const { error } = await db.from("organisations").update({
      status: "active",
      blocked_until: null,
      blocked_reason: null,
      blocked_by: null,
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const { data: owner } = await db
    .from("organisation_memberships")
    .select("user_id")
    .eq("organisation_id", id)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();
  if (!owner?.user_id) return NextResponse.json({ error: "No active owner found for this organisation." }, { status: 404 });

  const password = randomPassword(16);
  const { error } = await db.auth.admin.updateUserById(owner.user_id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, password, ownerUserId: owner.user_id });
}
