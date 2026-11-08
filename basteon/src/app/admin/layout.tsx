import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/AdminNav";
import { BasteonBrand } from "@/components/BasteonBrand";
import { AdminTopBar } from "@/components/AdminTopBar";
import "./admin.css";

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
    <div className="basteon-admin-shell admin-theme">
      <aside className="admin-sidebar">
        <div className="sidebar-head basteon-admin-brand">
          <BasteonBrand variant="dark" />
          <span className="label ml-1">Admin</span>
        </div>
        <AdminNav />
      </aside>
      <div className="admin-main">
        <AdminTopBar />
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}