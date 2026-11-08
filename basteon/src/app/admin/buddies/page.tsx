import { createAdminClient } from "@/lib/supabase/admin";
import { Bot, Flag, ShieldCheck } from "lucide-react";

export default async function AdminBuddiesPage() {
  const db = createAdminClient();
  const { data: flags } = await db.from("buddy_moderation_flags").select("id,kind,created_at,resolved_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(100);
  const openFlags = flags ?? [];

  return <div className="admin-page">
    <header className="admin-page-heading">
      <div>
        <h1><ShieldCheck size={20} />Moderation Queue</h1>
        <p>Buddies safety flags, user reports, and automated distress queue moderation.</p>
      </div>
    </header>

    <section className="grid gap-4 md:grid-cols-3">
      <article className="admin-panel p-4"><p className="eyebrow">Open Review Items</p><strong className="my-2 block font-mono text-3xl">{openFlags.length}</strong><p className="admin-muted">{openFlags.length ? "Review required" : "Queue completely clear"}</p></article>
      <article className="admin-panel p-4"><p className="eyebrow">Flagged Contacts Today</p><strong className="my-2 block font-mono text-3xl">{openFlags.length}</strong><p className="admin-muted">{openFlags.length} reports in the open queue</p></article>
      <article className="admin-panel p-4"><p className="eyebrow">Moderation Latency</p><strong className="my-2 block font-mono text-3xl">&lt; 1m</strong><p className="admin-muted">Automated safety triage live</p></article>
    </section>

    {openFlags.length === 0 ? <section className="admin-panel flex min-h-72 flex-col items-center justify-center p-12 text-center"><span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-2)] admin-muted"><ShieldCheck size={20} /></span><h2 className="text-sm font-bold">No open Buddies safety flags.</h2><p className="mt-1 max-w-sm text-xs admin-muted">All safety network alerts and escalation request queues are verified and operating normally.</p></section> : <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table min-w-[620px]"><thead><tr><th>Signal</th><th>Reported</th><th>Status</th></tr></thead><tbody>{openFlags.map((flag) => <tr key={flag.id}><td className="capitalize"><span className="inline-flex items-center gap-2"><Flag size={14} />{flag.kind.replaceAll("_", " ")}</span></td><td className="admin-data">{new Date(flag.created_at).toLocaleString("en-ZA")}</td><td><span className="admin-pill admin-pill-teal"><Bot size={12} />Open review</span></td></tr>)}</tbody></table></div></section>}
  </div>;
}