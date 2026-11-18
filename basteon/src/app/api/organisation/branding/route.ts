import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";
import { sameOrigin } from "@/lib/verification/http";
import { BRAND_HEX_PATTERN, resolveBrandColors } from "@/lib/organisationBranding";

const colorSchema = z.string().regex(BRAND_HEX_PATTERN, "Colour must use #RRGGBB format.").nullable();
const schema = z.object({
  organisationId: z.string().uuid(),
  primaryColor: colorSchema,
  accentColor: colorSchema,
}).strict();

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: "invalid_brand_colors", details: payload.error.flatten() }, { status: 400 });

  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = memberships.find((item: { organisation_id: string; role?: string }) =>
    item.organisation_id === payload.data.organisationId && ["owner", "admin"].includes(item.role ?? ""));
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const colors = resolveBrandColors(payload.data.primaryColor, payload.data.accentColor);
  const db = createAdminClient();
  const { data, error } = await db.from("organisations").update({
    brand_primary_color: payload.data.primaryColor ? colors.primary : null,
    brand_accent_color: payload.data.accentColor?.toUpperCase() ?? null,
  }).eq("id", payload.data.organisationId)
    .select("brand_primary_color,brand_accent_color").single();
  if (error) return NextResponse.json({ error: "branding_save_failed" }, { status: 500 });
  return NextResponse.json({
    primaryColor: data.brand_primary_color as string | null,
    accentColor: data.brand_accent_color as string | null,
  });
}
