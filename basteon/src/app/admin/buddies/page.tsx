import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminBuddiesPage() {
  const db = createAdminClient();
  const { data: flags } = await db.from("buddy_moderation_flags").select("id,kind,created_at,resolved_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(100);
  return <div className="space-y-5 max-w-[960px]"><div><p className="eyebrow">Buddies safety</p><h1 className="page-title mt-1">Moderation queue</h1></div><section className="panel"><div className="pane-head"><span>Open review items</span><span className="data">{flags?.length ?? 0}</span></div>{(flags ?? []).length === 0 ? <p className="p-5 muted text-[13px]">No open Buddies safety flags.</p> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Signal</th><th>Reported</th><th>Status</th></tr></thead><tbody>{flags?.map((flag) => <tr key={flag.id}><td>{flag.kind.replaceAll("_", " ")}</td><td>{new Date(flag.created_at).toLocaleString("en-ZA")}</td><td>Open</td></tr>)}</tbody></table></div>}</section></div>;
}