import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomPassword, requireOrganisationAccess } from "@/lib/organisation";

const createSchema = z.object({
  organisationId: z.string().uuid(),
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  branchId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  membershipType: z.string().default("responder"),
  role: z.enum(["dispatcher", "responder", "manager", "viewer"]).default("responder"),
});

const resetSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
});

const updateSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  fullName: z.string().min(2),
  phone: z.string().optional().nullable(),
  role: z.enum(["dispatcher", "responder", "manager", "viewer"]),
  branchId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "pending", "suspended", "archived"]).default("active"),
  availability: z.enum(["available", "busy", "off_duty", "unavailable"]).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const organisationId = url.searchParams.get("organisationId");
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!organisationId) return NextResponse.json({ error: "organisationId required" }, { status: 400 });
  if (!memberships.some((m: any) => m.organisation_id === organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { data, error } = await db
    .from("organisation_memberships")
    .select("id,user_id,branch_id,membership_type,role,status,profiles(full_name,phone)")
    .eq("organisation_id", organisationId)
    .in("role", ["dispatcher", "responder", "manager", "viewer"])
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = createSchema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!memberships.some((m: any) => m.organisation_id === payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const password = randomPassword(14);
  const db = createAdminClient();
  const { data: authCreated, error: authError } = await db.auth.admin.createUser({
    email: payload.data.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: payload.data.fullName, phone: payload.data.phone ?? null },
  });
  if (authError || !authCreated.user) return NextResponse.json({ error: authError?.message ?? "Could not create account" }, { status: 400 });

  await db.from("profiles").update({
    full_name: payload.data.fullName,
    phone: payload.data.phone ?? null,
    role: "responder",
  }).eq("id", authCreated.user.id);

  const { error: memberError } = await db.from("organisation_memberships").insert({
    organisation_id: payload.data.organisationId,
    user_id: authCreated.user.id,
    branch_id: payload.data.branchId,
    membership_type: payload.data.membershipType,
    role: payload.data.role,
    source: "manual",
    created_by: userId,
  });
  if (memberError) {
    await db.auth.admin.deleteUser(authCreated.user.id);
    return NextResponse.json({ error: memberError.message }, { status: 400 });
  }
  const { error: presenceError } = await db.from("responder_presence").upsert({
    user_id: authCreated.user.id,
    organisation_id: payload.data.organisationId,
    branch_id: payload.data.branchId,
    unit_id: payload.data.unitId ?? null,
    availability: "off_duty",
  }, { onConflict: "user_id" });
  if (presenceError) {
    await db.from("organisation_memberships").delete().eq("organisation_id", payload.data.organisationId).eq("user_id", authCreated.user.id);
    await db.auth.admin.deleteUser(authCreated.user.id);
    return NextResponse.json({ error: presenceError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    credentials: {
      email: payload.data.email,
      password,
      fullName: payload.data.fullName,
    },
    credentialPdfUrl: `/api/organisation/responders/${authCreated.user.id}/credential-pdf?organisationId=${payload.data.organisationId}`,
  }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const raw = await request.json();
  const action = String((raw as any)?.action ?? "reset");

  if (action === "update") {
    const payload = updateSchema.safeParse(raw);
    if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
    if (!memberships.some((m: any) => m.organisation_id === payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data: member } = await db
      .from("organisation_memberships")
      .select("id")
      .eq("organisation_id", payload.data.organisationId)
      .eq("user_id", payload.data.userId)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: "Responder not found for organisation" }, { status: 404 });

    const { error: profileError } = await db.from("profiles").update({
      full_name: payload.data.fullName,
      phone: payload.data.phone ?? null,
    }).eq("id", payload.data.userId);
    if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 });

    const { error: memberError } = await db.from("organisation_memberships").update({
      role: payload.data.role,
      branch_id: payload.data.branchId,
      status: payload.data.status,
    }).eq("organisation_id", payload.data.organisationId).eq("user_id", payload.data.userId);
    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 400 });

    const { error: presenceError } = await db.from("responder_presence").upsert({
      user_id: payload.data.userId,
      organisation_id: payload.data.organisationId,
      branch_id: payload.data.branchId,
      unit_id: payload.data.unitId ?? null,
      availability: payload.data.availability ?? "off_duty",
    }, { onConflict: "user_id" });
    if (presenceError) return NextResponse.json({ error: presenceError.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  }

  const payload = resetSchema.safeParse(raw);
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!memberships.some((m: any) => m.organisation_id === payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data: member } = await db
    .from("organisation_memberships")
    .select("id")
    .eq("organisation_id", payload.data.organisationId)
    .eq("user_id", payload.data.userId)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Responder not found for organisation" }, { status: 404 });

  const password = randomPassword(14);
  const { error } = await db.auth.admin.updateUserById(payload.data.userId, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, password });
}
