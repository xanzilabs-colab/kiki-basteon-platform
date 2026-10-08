import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function OrganisationLayout({ children }: { children: React.ReactNode }) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/organisation/login");
  return <main className="min-h-screen p-4 md:p-6">{children}</main>;
}
