import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/AdminNav";
import { BasteonBrand } from "@/components/BasteonBrand";

export default async function AdminLayout({
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
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect(profile?.role === "user" ? "/account" : "/responder");
  }

  return (
    <div className="basteon-admin-shell min-h-screen md:grid md:h-screen md:grid-cols-[224px_1fr] md:overflow-hidden">
      <aside className="sidebar flex flex-col md:min-h-0 md:overflow-y-auto">
        <div className="sidebar-head basteon-admin-brand">
          <BasteonBrand variant="light" />
          <span className="label ml-1">Admin</span>
        </div>
        <div className="py-2">
          <AdminNav />
        </div>
      </aside>
      <main className="min-w-0 p-4 md:h-full md:min-h-0 md:overflow-y-auto md:p-6">{children}</main>
    </div>
  );
}