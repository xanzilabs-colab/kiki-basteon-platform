"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, BookOpen, Flag, RefreshCw, ShieldCheck } from "lucide-react";

type TeachCard = {
  id: string;
  author_id: string | null;
  topic_id: string;
  problem: string;
  tip: string;
  example: string | null;
  check_q: string;
  check_options: string[];
  check_answer: number;
  tier: "seed" | "verified" | "community";
  status: string;
  flagged: boolean;
  helpful_distinct: number;
  report_count: number;
  created_at: string;
};
type TeachReport = {
  id: string;
  card_id: string | null;
  session_id: string | null;
  reason: string | null;
  status: string;
  created_at: string;
};

export default function TeachModerationPage() {
  const [cards, setCards] = useState<TeachCard[]>([]);
  const [reports, setReports] = useState<TeachReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [area, setArea] = useState("");
  const [credentialsChecked, setCredentialsChecked] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/teach", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The moderation queue could not be loaded.");
      setCards(body.cards as TeachCard[]);
      setReports(body.reports as TeachReport[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The moderation queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function moderate(payload: Record<string, string>) {
    const requestId = payload.cardId || payload.reportId || payload.userId || "queue";
    setBusyId(requestId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/teach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The moderation action could not be completed.");
      setNotice("Moderation action saved.");
      if (payload.action === "verify_author") {
        setArea("");
        setCredentialsChecked(false);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The moderation action could not be completed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="max-w-[1280px] space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#282930] pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
            <BookOpen size={20} className="text-slate-400" /> Each One Teach One moderation
          </h1>
          <p className="mt-1 text-xs text-slate-400">Review community tips and user reports before content is shared broadly.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded border border-[#34353D] px-3 py-2 text-xs text-slate-200 disabled:opacity-50">
          <RefreshCw size={14} /> Refresh queue
        </button>
      </header>

      <aside className="rounded border border-amber-900/70 bg-amber-950/30 p-4 text-sm text-amber-100">
        Community tips are not professional advice. Check each tip for personal information, unsafe guidance, and respectful language before approving it.
      </aside>

      {error && <p role="alert" className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-200">{notice}</p>}

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck size={16} />Tip cards <span className="text-xs text-slate-400">({cards.length})</span></div>
        {loading ? <p className="text-sm text-slate-400">Loading tips…</p> : cards.length === 0
          ? <p className="rounded border border-[#282930] bg-[#16171B] p-4 text-sm text-slate-400">No tips need review.</p>
          : cards.map((card) => (
            <article key={card.id} className="space-y-3 rounded border border-[#282930] bg-[#16171B] p-4">
              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                <span>{card.topic_id.replaceAll("_", " ")}</span>
                <span>·</span><span>{card.tier}</span>
                <span>·</span><span>{card.status}</span>
                {card.flagged && <span className="inline-flex items-center gap-1 text-red-300"><Flag size={12} /> flagged</span>}
                <span>· {card.report_count} open reports</span>
              </div>
              <div className="space-y-2 text-sm text-slate-200">
                <p><strong>Problem:</strong> {card.problem}</p>
                <p><strong>Tip:</strong> {card.tip}</p>
                {card.example && <p><strong>Example:</strong> {card.example}</p>}
                <p><strong>Quick check:</strong> {card.check_q}</p>
                <ol className="list-inside list-decimal text-slate-300">
                  {card.check_options.map((option, index) => <li key={`${card.id}-${index}`}>{option}{index === card.check_answer ? " · correct answer" : ""}</li>)}
                </ol>
              </div>
              {card.author_id && (
                <div className="space-y-2 rounded border border-[#282930] bg-[#111215] p-3">
                  <label className="flex items-start gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={credentialsChecked} onChange={(event) => setCredentialsChecked(event.target.checked)} />
                    I have checked this author’s relevant credentials using the organisation’s normal verification process.
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input aria-label="Verified professional area" value={area} onChange={(event) => setArea(event.target.value)} maxLength={120} placeholder="Verified area (e.g. financial literacy)" className="min-w-56 flex-1 rounded border border-[#34353D] bg-[#0B0C0E] px-3 py-2 text-xs text-white" />
                    <button type="button" disabled={!credentialsChecked || !area.trim() || Boolean(busyId)} onClick={() => void moderate({ action: "verify_author", userId: card.author_id!, area: area.trim() })} className="inline-flex items-center gap-1 rounded border border-[#34353D] px-3 py-2 text-xs text-slate-200 disabled:opacity-40">
                      <BadgeCheck size={14} /> Verify credentials
                    </button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {(["approve", "reject", "remove"] as const).map((action) => (
                  <button key={action} type="button" disabled={Boolean(busyId)} onClick={() => void moderate({ action, cardId: card.id })} className={`rounded border px-3 py-2 text-xs capitalize disabled:opacity-40 ${action === "approve" ? "border-emerald-900 text-emerald-200" : action === "remove" ? "border-red-900 text-red-200" : "border-[#34353D] text-slate-300"}`}>
                    {busyId === card.id ? "Saving…" : action}
                  </button>
                ))}
              </div>
            </article>
          ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white"><Flag size={16} />Open reports <span className="text-xs text-slate-400">({reports.length})</span></div>
        {!loading && reports.length === 0
          ? <p className="rounded border border-[#282930] bg-[#16171B] p-4 text-sm text-slate-400">No open reports.</p>
          : reports.map((report) => (
            <article key={report.id} className="flex flex-wrap items-start justify-between gap-3 rounded border border-[#282930] bg-[#16171B] p-4">
              <div className="space-y-1 text-sm text-slate-200">
                <p>{report.reason || "No reason provided"}</p>
                <p className="text-xs text-slate-400">Card {report.card_id ?? "not linked"} · {new Date(report.created_at).toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate({ action: "resolve_report", reportId: report.id, reportStatus: "actioned" })} className="rounded border border-emerald-900 px-3 py-2 text-xs text-emerald-200 disabled:opacity-40">Action taken</button>
                <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate({ action: "resolve_report", reportId: report.id, reportStatus: "dismissed" })} className="rounded border border-[#34353D] px-3 py-2 text-xs text-slate-300 disabled:opacity-40">Dismiss</button>
              </div>
            </article>
          ))}
      </section>
    </div>
  );
}
