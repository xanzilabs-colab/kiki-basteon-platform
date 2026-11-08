import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteUserStorage } from "@/lib/account/deleteUserStorage";
import { renderSimpleCredentialPdf } from "@/lib/pdf";

async function adminUser() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const { data: profile } = user
    ? await client.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  return profile?.role === "admin" ? user : null;
}

const role = z.enum(["admin", "responder", "user"]);
const createSchema = z.object({
  email: z.string().email(),
  full_name: z.string().trim().min(2),
  phone: z.string().trim().max(40).optional().default(""),
  role,
});
const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("role"), id: z.string().uuid(), role }),
  z.object({
    action: z.literal("update_profile"),
    id: z.string().uuid(),
    role,
    full_name: z.string().trim().min(2),
    phone: z.string().trim().max(40),
    home_address: z.string().trim().max(500),
    emergency_contact_name: z.string().trim().max(120),
    emergency_contact_phone: z.string().trim().max(40),
  }),
  z.object({ action: z.literal("suspension"), id: z.string().uuid(), suspended: z.boolean() }),
  z.object({ action: z.literal("reset_password"), id: z.string().uuid() }),
]);

function credentialPdf(email: string, password: string, name: string) {
  return renderSimpleCredentialPdf([
    "BASTEON Account Credentials",
    `Name: ${name}`,
    `Email: ${email}`,
    `Password: ${password}`,
    `Generated: ${new Date().toISOString()}`,
    "Change the password after first sign in.",
  ]).toString("base64");
}

export async function GET() {
  if (!await adminUser()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createAdminClient();
  const [{ data: profiles, error: profileError }, { data: auth, error: authError }, { data: devices, error: deviceError }] = await Promise.all([
    db.from("profiles").select("*").order("created_at", { ascending: false }),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from("devices").select("id,device_id,device_name,user_id,active,last_seen_at,linked_at,last_ctr,created_at,is_virtual"),
  ]);
  if (profileError || authError || deviceError) {
    return NextResponse.json({ error: profileError?.message ?? authError?.message ?? deviceError?.message ?? "Could not load users" }, { status: 500 });
  }
  return NextResponse.json((profiles ?? []).map((profile) => {
    const userDevices = (devices ?? []).filter((device) => device.user_id === profile.id && !device.is_virtual);
    const authUser = auth.users.find((user) => user.id === profile.id);
    return {
      ...profile,
      email: authUser?.email ?? "",
      banned_until: authUser?.banned_until ?? null,
      is_suspended: Boolean(authUser?.banned_until && new Date(authUser.banned_until).getTime() > Date.now()),
      linked_device_count: userDevices.length,
      devices: userDevices,
    };
  }));
}

export async function POST(request: Request) {
  if (!await adminUser()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const input = createSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const password = randomBytes(18).toString("base64url");
  const db = createAdminClient();
  const { data, error } = await db.auth.admin.createUser({
    email: input.data.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.data.full_name, phone: input.data.phone || null },
  });
  if (error || !data.user) return NextResponse.json({ error: error?.message ?? "Could not create account." }, { status: 400 });

  const { error: profileError } = await db.from("profiles").update({
    role: input.data.role,
    full_name: input.data.full_name,
    phone: input.data.phone || null,
  }).eq("id", data.user.id);
  if (profileError) {
    const { error: rollbackError } = await db.auth.admin.deleteUser(data.user.id);
    if (rollbackError) console.error("admin_user_create_rollback_failed", { code: rollbackError.status });
    return NextResponse.json({ error: "Account profile could not be created." }, { status: 500 });
  }

  return NextResponse.json({
    id: data.user.id,
    credentials: { email: input.data.email, password },
    credentialPdfBase64: credentialPdf(input.data.email, password, input.data.full_name),
  }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await adminUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const input = patchSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  if (input.data.action === "role" && input.data.id === actor.id) {
    return NextResponse.json({ error: "You cannot change your own administrator role." }, { status: 400 });
  }

  const db = createAdminClient();
  if (input.data.action === "role") {
    const { error } = await db.from("profiles").update({ role: input.data.role }).eq("id", input.data.id);
    return error
      ? NextResponse.json({ error: error.message }, { status: 400 })
      : NextResponse.json({ ok: true });
  }

  if (input.data.action === "update_profile") {
    const { id, action: _action, ...profile } = input.data;
    const { error } = await db.from("profiles").update({
      role: profile.role,
      full_name: profile.full_name,
      phone: profile.phone || null,
      home_address: profile.home_address || null,
      emergency_contact_name: profile.emergency_contact_name || null,
      emergency_contact_phone: profile.emergency_contact_phone || null,
    }).eq("id", id);
    return error
      ? NextResponse.json({ error: error.message }, { status: 400 })
      : NextResponse.json({ ok: true });
  }

  if (input.data.action === "reset_password") {
    const { data: authUser, error: lookupError } = await db.auth.admin.getUserById(input.data.id);
    if (lookupError || !authUser.user?.email) {
      return NextResponse.json({ error: lookupError?.message ?? "Account email is unavailable." }, { status: 404 });
    }
    const password = randomBytes(18).toString("base64url");
    const { error } = await db.auth.admin.updateUserById(input.data.id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      credentials: { email: authUser.user.email, password },
      credentialPdfBase64: credentialPdf(authUser.user.email, password, authUser.user.user_metadata?.full_name ?? ""),
    });
  }

  if (input.data.id === actor.id) {
    return NextResponse.json({ error: "You cannot suspend your own administrator account." }, { status: 400 });
  }
  const { data: target, error: userError } = await db.auth.admin.getUserById(input.data.id);
  if (userError || !target.user) return NextResponse.json({ error: userError?.message ?? "Account not found." }, { status: 404 });
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("verification_status")
    .eq("id", input.data.id)
    .maybeSingle();
  if (profileError || !profile) return NextResponse.json({ error: profileError?.message ?? "Account profile not found." }, { status: 404 });

  const metadata = target.user.app_metadata ?? {};
  const previouslySuspended = metadata.admin_suspended === true;
  const nextStatus = input.data.suspended
    ? "suspended"
    : (metadata.admin_previous_verification_status ?? "unverified");
  const { error: profileUpdateError } = await db.from("profiles").update({ verification_status: nextStatus }).eq("id", input.data.id);
  if (profileUpdateError) return NextResponse.json({ error: profileUpdateError.message }, { status: 400 });

  const app_metadata = input.data.suspended
    ? { ...metadata, admin_suspended: true, admin_previous_verification_status: previouslySuspended ? metadata.admin_previous_verification_status : profile.verification_status }
    : Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "admin_suspended" && key !== "admin_previous_verification_status"));
  const { error: authUpdateError } = await db.auth.admin.updateUserById(input.data.id, {
    ban_duration: input.data.suspended ? "876000h" : "none",
    app_metadata,
  });
  if (authUpdateError) {
    const { error: rollbackError } = await db.from("profiles").update({ verification_status: profile.verification_status }).eq("id", input.data.id);
    if (rollbackError) console.error("admin_user_suspend_rollback_failed", { code: rollbackError.code });
    return NextResponse.json({ error: authUpdateError.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, suspended: input.data.suspended });
}

const deleteSchema = z.object({ id: z.string().uuid(), adminPassword: z.string().min(1) });

export async function DELETE(request: Request) {
  const actor = await adminUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const input = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  if (input.data.id === actor.id) return NextResponse.json({ error: "You cannot delete your own administrator account." }, { status: 400 });

  const expectedPassword = process.env.ADMIN_CONTROL_PASSWORD;
  if (!expectedPassword) return NextResponse.json({ error: "Account deletion is unavailable because admin control is not configured." }, { status: 503 });
  const submitted = Buffer.from(input.data.adminPassword, "utf8");
  const expected = Buffer.from(expectedPassword, "utf8");
  if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
    return NextResponse.json({ error: "Admin password incorrect." }, { status: 403 });
  }

  const db = createAdminClient();
  try {
    await deleteUserStorage(db, input.data.id);
  } catch (error) {
    console.error("admin_user_storage_delete_failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "User files could not be fully removed. The account was not deleted; please try again." }, { status: 500 });
  }

  const { error: dataError } = await db.rpc("account_delete_user_data", { p_user_id: input.data.id });
  if (dataError) {
    console.error("admin_user_data_delete_failed", { code: dataError.code, message: dataError.message });
    return NextResponse.json({ error: "User data could not be fully removed. The account was not deleted; please try again." }, { status: 500 });
  }
  const { error: deleteError } = await db.auth.admin.deleteUser(input.data.id);
  if (deleteError) return NextResponse.json({ error: "User data was removed, but the account could not be closed. Please retry." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
