import { redirect } from "next/navigation";
import { OrganisationConsole } from "@/components/OrganisationConsole";
import { requireOrganisationAccess } from "@/lib/organisation";

export default async function OrganisationPage() {
  const { userId, memberships } = await requireOrganisationAccess();
  if (!userId) redirect("/organisation/login");
  if (memberships.length === 0) redirect("/organisation/login");
  return <OrganisationConsole />;
}
