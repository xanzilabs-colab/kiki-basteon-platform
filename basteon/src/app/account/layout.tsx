import { redirect } from "next/navigation";
import { AccountShell } from "@/components/AccountShell";
import { getAccountMenuFeatures } from "@/lib/account/menuFeatures";
import { createClient } from "@/lib/supabase/server";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role,dark_theme").eq("id", user.id).single();
  if (!profile || profile.role !== "user") redirect(profile?.role === "admin" ? "/admin" : "/responder");
  return <AccountShell name={profile.full_name ?? user.email ?? "Account"} initialDarkTheme={profile.dark_theme ?? false} {...getAccountMenuFeatures()}>{children}</AccountShell>;
}