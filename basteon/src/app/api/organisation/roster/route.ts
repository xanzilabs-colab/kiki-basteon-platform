import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";
import { normalizeIdentifierInput, normalizeRosterIdentifier } from "@/lib/orgRoster";

const querySchema = z.object({
  organisationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().optional().default(""),
});

const createEntrySchema = z.object({
  organisationId: z.string().uuid(),
  membershipType: z.string().min(2).default("member"),
  identifierType: z.enum(["email", "member_id", "access_code"]),
  identifier: z.string().min(2),
  displayName: z.string().optional().nullable(),
  validFrom: z.string().datetime().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  maxClaims: z.number().int().min(1).default(1),
  source: z.enum(["manual", "pasted", "generated"]).default("manual"),
}).superRefine((entry, context) => {
  if (entry.identifierType === "email" && !z.string().email().safeParse(entry.identifier.trim()).success) {
    context.addIssue({ code: "custom", path: ["identifier"], message: "Enter a valid email address." });
  }
});
const createBulkSchema = z.object({
  organisationId: z.string().uuid(),
  source: z.enum(["csv", "spreadsheet", "pasted", "manual", "generated"]).default("pasted"),
  entries: z.array(z.object({
    membershipType: z.string().min(2).default("member"),
    identifierType: z.enum(["email", "member_id", "access_code"]),
    identifier: z.string().min(2),
    displayName: z.string().optional().nullable(),
    validFrom: z.string().datetime().optional().nullable(),
    validUntil: z.string().datetime().optional().nullable(),
    maxClaims: z.number().int().min(1).default(1),
  })).min(1).max(20000),
}).superRefine((payload, context) => {
  payload.entries.forEach((entry, index) => {
    if (entry.identifierType === "email" && !z.string().email().safeParse(entry.identifier.trim()).success) {
      context.addIssue({ code: "custom", path: ["entries", index, "identifier"], message: "Enter a valid email address." });
    }
  });
});
const createSchema = z.union([createEntrySchema, createBulkSchema]);

const updateSchema = z.object({
  organisationId: z.string().uuid(),
  id: z.string().uuid(),
  status: z.enum(["active", "suspended", "expired", "removed"]).optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export async function GET(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    organisationId: url.searchParams.get("organisationId"),
    page: url.searchParams.get("page") ?? 1,
    pageSize: url.searchParams.get("pageSize") ?? 25,
    q: url.searchParams.get("q") ?? "",
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!memberships.some((m: any) => m.organisation_id === parsed.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const q = parsed.data.q.trim();
  let query = db
    .from("org_roster_entries")
    .select("id,membership_type,identifier_type,identifier_raw,identifier_normalized,display_name,status,valid_from,valid_until,source,claimed_by_user_id,claimed_at,max_claims,updated_at", { count: "exact" })
    .eq("org_id", parsed.data.organisationId)
    .order("updated_at", { ascending: false })
    .range(offset, offset + parsed.data.pageSize - 1);
  if (q) query = query.ilike("identifier_raw", `%${q}%`);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
}

export async function POST(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!memberships.some((m: any) => m.organisation_id === parsed.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { data: settings } = await db.from("organisation_link_settings").select("roster_id_case_mode").eq("organisation_id", parsed.data.organisationId).maybeSingle();
  const idMode = (settings?.roster_id_case_mode as "upper" | "lower" | "as_is" | undefined) ?? "upper";
  const entries = "entries" in parsed.data
    ? parsed.data.entries
    : [{
      membershipType: parsed.data.membershipType,
      identifierType: parsed.data.identifierType,
      identifier: parsed.data.identifier,
      displayName: parsed.data.displayName,
      validFrom: parsed.data.validFrom,
      validUntil: parsed.data.validUntil,
      maxClaims: parsed.data.maxClaims,
    }];
  const isBulk = "entries" in parsed.data;
  const source = parsed.data.source;
  const nowIso = new Date().toISOString();
  let importId: string | null = null;
  if (isBulk) {
    const { data: importRecord, error: importError } = await db.from("org_roster_imports").insert({
      org_id: parsed.data.organisationId,
      uploaded_by: userId,
      file_type: source,
      status: "previewed",
      mode: "add_only",
      detected_mapping: {},
      counts: { rows: entries.length },
    }).select("id").single();
    if (importError || !importRecord) return NextResponse.json({ error: importError?.message ?? "Could not create roster import record." }, { status: 500 });
    importId = importRecord.id;
  }
  const dedupe = new Set<string>();
  const rows = entries.flatMap((entry) => {
    const raw = normalizeIdentifierInput(entry.identifier);
    const normalized = normalizeRosterIdentifier(entry.identifier, entry.identifierType, idMode);
    const key = `${entry.identifierType}:${normalized}`;
    if (!raw || dedupe.has(key)) return [];
    dedupe.add(key);
    return [{
      org_id: parsed.data.organisationId,
      membership_type: entry.membershipType,
      identifier_type: entry.identifierType,
      identifier_raw: raw,
      identifier_normalized: normalized,
      display_name: entry.displayName?.trim() || null,
      status: "active",
      valid_from: entry.validFrom ?? nowIso,
      valid_until: entry.validUntil ?? null,
      source,
      import_id: importId,
      max_claims: entry.maxClaims,
      metadata: {},
    }];
  });
  if (!rows.length) {
    if (importId) await db.from("org_roster_imports").update({ status: "failed", counts: { rows: entries.length, accepted: 0, duplicates: 0, invalid: entries.length, removed: 0 } }).eq("id", importId);
    return NextResponse.json({ error: "No valid roster entries found." }, { status: 400 });
  }

  const { data, error } = await db.from("org_roster_entries").upsert(rows, {
    onConflict: "org_id,identifier_type,identifier_normalized",
    ignoreDuplicates: true,
  }).select("id,identifier_type");
  if (error) {
    if (importId) await db.from("org_roster_imports").update({ status: "failed" }).eq("id", importId);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const inserted = data?.length ?? 0;
  if (importId) {
    const { error: finalizeError } = await db.from("org_roster_imports").update({
      status: "committed",
      counts: { rows: entries.length, accepted: inserted, duplicates: rows.length - inserted, invalid: 0, removed: 0 },
      committed_at: nowIso,
    }).eq("id", importId);
    if (finalizeError) throw new Error(`Roster entries imported but import history could not be finalized: ${finalizeError.message}`);
  }
  await db.from("org_roster_audit_log").insert({
    org_id: parsed.data.organisationId,
    actor_id: userId,
    action: inserted > 1 ? "roster_entries_bulk_created" : "roster_entry_created",
    entry_id: inserted === 1 ? data?.[0]?.id ?? null : null,
    details: { count: inserted, duplicates: rows.length - inserted, source },
  });
  return NextResponse.json({ ok: true, inserted, duplicates: rows.length - inserted, rows: data ?? [] }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!memberships.some((m: any) => m.organisation_id === parsed.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const updates: Record<string, unknown> = {};
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.validUntil !== undefined) updates.valid_until = parsed.data.validUntil;
  if (!Object.keys(updates).length) return NextResponse.json({ error: "No updates provided." }, { status: 400 });

  const db = createAdminClient();
  const { error } = await db.from("org_roster_entries")
    .update(updates)
    .eq("id", parsed.data.id)
    .eq("org_id", parsed.data.organisationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await db.from("org_roster_audit_log").insert({
    org_id: parsed.data.organisationId,
    actor_id: userId,
    action: parsed.data.status === "removed" ? "roster_entry_removed" : "roster_entry_updated",
    entry_id: parsed.data.id,
    details: { status: parsed.data.status ?? null, validUntil: parsed.data.validUntil ?? null },
  });
  return NextResponse.json({ ok: true });
}
