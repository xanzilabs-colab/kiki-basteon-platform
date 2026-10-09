import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function allowed() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const { data } = user ? await client.from("profiles").select("role").eq("id", user.id).single() : { data: null };
  return { ok: data?.role === "admin", userId: user?.id ?? null };
}

const createSchema = z.object({
  contactName: z.string().min(2),
  contactType: z.enum(["email", "phone"]),
  contactValue: z.string().min(3),
  purpose: z.string().min(2),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

const removeSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(request: Request) {
  const auth = await allowed();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const purpose = (url.searchParams.get("purpose") ?? "").trim();
  const db = createAdminClient();
  const query = db
    .from("support_contacts")
    .select("*")
    .eq("scope", "global")
    .order("purpose", { ascending: true })
    .order("contact_name", { ascending: true });
  if (purpose) query.eq("purpose", purpose);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const auth = await allowed();
  if (!auth.ok || !auth.userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = createAdminClient();
  const { error } = await db.from("support_contacts").insert({
    scope: "global",
    organisation_id: null,
    contact_name: parsed.data.contactName,
    contact_type: parsed.data.contactType,
    contact_value: parsed.data.contactValue,
    purpose: parsed.data.purpose,
    created_by: auth.userId,
    active: true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await allowed();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = createAdminClient();
  const { error } = await db.from("support_contacts").update({ active: parsed.data.active }).eq("id", parsed.data.id).eq("scope", "global");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await allowed();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = removeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = createAdminClient();
  const { error } = await db.from("support_contacts").delete().eq("id", parsed.data.id).eq("scope", "global");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
