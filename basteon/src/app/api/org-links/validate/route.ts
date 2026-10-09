import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/verification/http";
import { validateAndLinkOrganisation } from "@/lib/orgLinkValidation";

const schema = z.object({
  organisationId: z.string().uuid().optional(),
  organisationCode: z.string().trim().min(2).optional(),
  branchId: z.string().uuid().optional().nullable(),
  identifierType: z.enum(["email", "member_id", "access_code"]),
  identifier: z.string().min(2),
  label: z.enum(["work", "school", "home", "other"]).default("other"),
  placeAddress: z.string().optional().nullable(),
});

function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip")?.trim() ?? null;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ code: "NOT_ELIGIBLE", message: "Request rejected." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "NOT_ELIGIBLE", message: "Invalid request." }, { status: 400 });
  if (!parsed.data.organisationId && !parsed.data.organisationCode) {
    return NextResponse.json({ code: "NOT_ELIGIBLE", message: "Organisation is required." }, { status: 400 });
  }

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ code: "NOT_ELIGIBLE", message: "Unauthorized." }, { status: 401 });

  let organisationId = parsed.data.organisationId ?? "";
  if (!organisationId && parsed.data.organisationCode) {
    const db = createAdminClient();
    const { data: organisation } = await db
      .from("organisations")
      .select("id")
      .eq("slug", parsed.data.organisationCode.trim().toLowerCase())
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    organisationId = organisation?.id ?? "";
  }
  if (!organisationId) {
    return NextResponse.json({
      code: "NOT_ELIGIBLE",
      message: "We could not confirm eligibility. Please contact your organisation.",
      action: "contact_organisation",
    }, { status: 200 });
  }

  const result = await validateAndLinkOrganisation({
    userId: user.id,
    organisationId,
    branchId: parsed.data.branchId ?? null,
    identifierType: parsed.data.identifierType,
    identifier: parsed.data.identifier,
    label: parsed.data.label,
    placeAddress: parsed.data.placeAddress ?? null,
    ipAddress: requestIp(request),
  });

  const status = result.code === "RATE_LIMITED" ? 429 : 200;
  return NextResponse.json(result, { status });
}
