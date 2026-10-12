import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";
import { sameOrigin } from "@/lib/verification/http";

const bucket = "organisation-logos";
const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const logoUrlSchema = z.string().trim().max(2048).url()
  .refine((value) => /^https?:\/\//i.test(value)).nullable();
const patchSchema = z.object({
  organisationId: z.string().uuid(),
  logoUrl: logoUrlSchema,
}).strict();

async function authorisedOrganisation(organisationId: string) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return { error: "unauthenticated" as const };
  if (!memberships.some((membership: { organisation_id: string }) => membership.organisation_id === organisationId)) {
    return { error: "forbidden" as const };
  }
  return { userId };
}

async function saveLogo(organisationId: string, logoUrl: string | null) {
  const db = createAdminClient();
  const { data, error } = await db.from("organisations").update({ logo_url: logoUrl })
    .eq("id", organisationId).select("logo_url").single();
  if (error) return { error: error.message };
  return { logoUrl: data.logo_url as string | null };
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const payload = patchSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: "invalid_logo_url" }, { status: 400 });
  const access = await authorisedOrganisation(payload.data.organisationId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.error === "unauthenticated" ? 401 : 403 });

  const result = await saveLogo(payload.data.organisationId, payload.data.logoUrl);
  if ("error" in result) return NextResponse.json({ error: "logo_save_failed" }, { status: 500 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const organisationId = form?.get("organisationId");
  const file = form?.get("file");
  if (typeof organisationId !== "string" || !z.string().uuid().safeParse(organisationId).success
    || !(file instanceof File) || !(file.type in extensions) || file.size === 0 || file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "invalid_logo_file" }, { status: 400 });
  }
  const access = await authorisedOrganisation(organisationId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.error === "unauthenticated" ? 401 : 403 });

  const db = createAdminClient();
  const path = `${organisationId}/${crypto.randomUUID()}.${extensions[file.type as keyof typeof extensions]}`;
  const { error: uploadError } = await db.storage.from(bucket).upload(path, file, { contentType: file.type });
  if (uploadError) return NextResponse.json({ error: "logo_upload_failed" }, { status: 500 });
  const { data: publicData } = db.storage.from(bucket).getPublicUrl(path);
  const result = await saveLogo(organisationId, publicData.publicUrl);
  if ("error" in result) {
    const { error: removeError } = await db.storage.from(bucket).remove([path]);
    if (removeError) console.error("Failed to remove unlinked organisation logo", removeError);
    return NextResponse.json({ error: "logo_save_failed" }, { status: 500 });
  }
  return NextResponse.json(result, { status: 201 });
}
