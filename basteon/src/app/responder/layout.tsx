import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ResponderBrandingProvider, type ResponderBrandingSeed } from "@/components/ResponderBrandingProvider";
import { brandCssProperties } from "@/lib/organisationBranding";

export const dynamic = "force-dynamic";

const defaultBranding: ResponderBrandingSeed = {
  id: "",
  name: "",
  displayName: "",
  logoUrl: null,
  primaryColor: null,
  accentColor: null,
  branchName: "",
  operatorName: "",
};

export default async function ResponderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,full_name")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role === "user") redirect("/account");

  let branding = defaultBranding;
  try {
    const db = createAdminClient();
    const { data: membership, error: membershipError } = await db.from("organisation_memberships")
      .select("organisation_id,branch_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (membership) {
      const [{ data: organisation, error: organisationError }, { data: branch, error: branchError }] = await Promise.all([
        db.from("organisations")
          .select("id,name,display_name,logo_url,brand_primary_color,brand_accent_color")
          .eq("id", membership.organisation_id)
          .single(),
        membership.branch_id
          ? db.from("organisation_branches").select("name").eq("organisation_id", membership.organisation_id).eq("id", membership.branch_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (organisationError || branchError || !organisation) throw organisationError ?? branchError ?? new Error("Organisation branding is unavailable.");
      branding = {
        id: organisation.id,
        name: organisation.name,
        displayName: organisation.display_name?.trim() || organisation.name,
        logoUrl: organisation.logo_url,
        primaryColor: organisation.brand_primary_color,
        accentColor: organisation.brand_accent_color,
        branchName: branch?.name ?? "",
        operatorName: profile.full_name ?? user.email ?? "Responder",
      };
    }
  } catch (error) {
    console.error("Responder branding could not be loaded during server render; using Basteon defaults.", error);
  }

  const brandStyles = brandCssProperties(branding.primaryColor, branding.accentColor) as CSSProperties;
  return (
    <ResponderBrandingProvider value={branding}>
      <div style={brandStyles}>{children}</div>
    </ResponderBrandingProvider>
  );
}