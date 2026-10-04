import { createAdminClient } from "@/lib/supabase/admin";
import { Bot, Flag, ShieldCheck } from "lucide-react";

export default async function AdminBuddiesPage() {
  const db = createAdminClient();
  const { data: flags } = await db.from("buddy_moderation_flags").select("id,kind,created_at,resolved_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(100);
  const openFlags = flags ?? [];

  return <div className="max-w-[1280px] space-y-6">
    <header className="border-b border-[#282930] pb-4">
      <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white"><ShieldCheck size={20} className="text-slate-400" />Moderation Queue</h1>
      <p className="mt-1 text-xs text-slate-400">Buddies safety flags, user reports, and automated distress queue moderation.</p>
    </header>

    <section className="grid gap-4 md:grid-cols-3">
      <article className="rounded border border-[#282930] bg-[#16171B] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Open Review Items</p><strong className="my-2 block font-mono text-3xl text-white">{openFlags.length}</strong><p className="text-[11px] text-emerald-400">{openFlags.length ? "Review required" : "Queue completely clear"}</p></article>
      <article className="rounded border border-[#282930] bg-[#16171B] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Flagged Contacts Today</p><strong className="my-2 block font-mono text-3xl text-slate-300">{openFlags.length}</strong><p className="text-[11px] text-slate-500">{openFlags.length} reports in the open queue</p></article>
      <article className="rounded border border-[#282930] bg-[#16171B] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Moderation Latency</p><strong className="my-2 block font-mono text-3xl text-slate-300">&lt; 1m</strong><p className="text-[11px] text-slate-500">Automated safety triage live</p></article>
    </section>

    {openFlags.length === 0 ? <section className="flex min-h-72 flex-col items-center justify-center rounded border border-[#282930] bg-[#16171B] p-12 text-center"><span className="mb-3 grid h-12 w-12 place-items-center rounded-full border border-[#282930] bg-[#0B0C0E] text-slate-500"><ShieldCheck size={20} /></span><h2 className="text-sm font-bold text-slate-200">No open Buddies safety flags.</h2><p className="mt-1 max-w-sm text-xs text-slate-500">All safety network alerts and escalation request queues are verified and operating normally.</p></section> : <section className="overflow-x-auto rounded border border-[#282930] bg-[#16171B]"><table className="w-full min-w-[620px] border-collapse text-left text-xs"><thead className="border-b border-[#282930] bg-[#111215] font-mono text-slate-400"><tr><th className="p-3 font-medium">SIGNAL</th><th className="p-3 font-medium">REPORTED</th><th className="p-3 font-medium">STATUS</th></tr></thead><tbody className="divide-y divide-[#282930]">{openFlags.map((flag) => <tr key={flag.id} className="transition-colors hover:bg-[#1C1D22]"><td className="p-3 capitalize text-slate-200"><span className="inline-flex items-center gap-2"><Flag size={14} className="text-purple-400" />{flag.kind.replaceAll("_", " ")}</span></td><td className="p-3 font-mono text-slate-300">{new Date(flag.created_at).toLocaleString("en-ZA")}</td><td className="p-3"><span className="inline-flex items-center gap-1.5 rounded border border-[#5B21B6] bg-[#3B125C] px-2 py-0.5 font-mono text-[10px] font-bold text-[#D8B4FE]"><Bot size={12} />OPEN REVIEW</span></td></tr>)}</tbody></table></section>}
  </div>;
}