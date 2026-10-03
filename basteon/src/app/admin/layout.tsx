import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect(profile?.role === "user" ? "/account" : "/responder");

  return (
    <div className="h-screen md:grid md:grid-cols-[216px_1fr] overflow-hidden">
      <aside className="border-r border-[var(--line)] bg-[var(--surface)] md:overflow-y-auto">
        <div className="h-11 flex items-center gap-2 px-3 border-b border-[var(--line)]">
          <span className="w-4 h-4 bg-[var(--accent)]" style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
          <b className="text-[13px] tracking-[.14em]">BASTEON</b><span className="label">Admin</span>
        </div>
        <div className="py-2"><AdminNav /></div>
      </aside>
      <main className="min-w-0 h-full overflow-y-auto p-5 md:p-6">{children}</main>
    </div>
  );
}