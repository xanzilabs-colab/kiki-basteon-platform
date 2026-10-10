import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderSimpleCredentialPdf } from "@/lib/pdf";
import { requireOrganisationAccess } from "@/lib/organisation";

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const organisationId = new URL(request.url).searchParams.get("organisationId");
  const { userId: actorId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher"]);
  if (!actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!organisationId) return NextResponse.json({ error: "organisationId required" }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === organisationId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createAdminClient();
  const { data: membership } = await db
    .from("organisation_memberships")
    .select("id,role,membership_type,branch_id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Responder not found for organisation" }, { status: 404 });
  const [{ data: profile }, { data: branch }, { data: organisation }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    membership.branch_id ? db.from("organisation_branches").select("name").eq("id", membership.branch_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
  ]);
  (membership as any).profiles = profile;
  (membership as any).organisation_branches = branch;
  (membership as any).organisations = organisation;

  const lines = [
    "BASTEON RESPONDER ONBOARDING CREDENTIALS",
    `Organisation: ${(membership as any).organisations?.name ?? "Unknown"}`,
    `Name: ${(membership as any).profiles?.full_name ?? userId}`,
    `Role: ${(membership as any).role ?? "responder"}`,
    `Member Type: ${(membership as any).membership_type ?? "responder"}`,
    `Branch: ${(membership as any).organisation_branches?.name ?? "Unassigned"}`,
    "Password: Generated and shown once in secure admin view.",
    "Please rotate credentials on first login.",
    `Generated: ${new Date().toISOString()}`,
  ];
  const pdf = renderSimpleCredentialPdf(lines);
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="basteon-responder-${userId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

