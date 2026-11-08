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
type ReadRoomReport = {
  id: string;
  session_id: string;
  reporter_id: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: string;
};

export default function TeachModerationPage() {
  const [cards, setCards] = useState<TeachCard[]>([]);
  const [reports, setReports] = useState<TeachReport[]>([]);
  const [readRoomReports, setReadRoomReports] = useState<ReadRoomReport[]>([]);
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
      setReadRoomReports(body.readRoomReports as ReadRoomReport[]);
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
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <h1>
            <BookOpen size={20} /> Each One Teach One moderation
          </h1>
          <p>Review community tips and user reports before content is shared broadly.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="btn inline-flex items-center gap-2 px-3">
          <RefreshCw size={14} /> Refresh queue
        </button>
      </header>

      <aside className="admin-status" role="note">
        Community tips are not professional advice. Check each tip for personal information, unsafe guidance, and respectful language before approving it.
      </aside>

      {error && <p role="alert" className="admin-status admin-status-error">{error}</p>}
      {notice && <p role="status" className="admin-status admin-status-success">{notice}</p>}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={16} />Tip cards <span className="text-sm admin-muted">({cards.length})</span></h2>
        {loading ? <p className="text-sm admin-muted">Loading tips…</p> : cards.length === 0
          ? <p className="admin-panel p-4 text-sm admin-muted">No tips need review.</p>
          : cards.map((card) => (
            <article key={card.id} className="admin-panel space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs admin-muted">
                <span>{card.topic_id.replaceAll("_", " ")}</span>
                <span>·</span><span>{card.tier}</span>
                <span>·</span><span>{card.status}</span>
                {card.flagged && <span className="admin-pill admin-pill-red"><Flag size={12} />Flagged</span>}
                <span>· {card.report_count} open reports</span>
              </div>
              <div className="space-y-2 text-sm">
                <p><strong>Problem:</strong> {card.problem}</p>
                <p><strong>Tip:</strong> {card.tip}</p>
                {card.example && <p><strong>Example:</strong> {card.example}</p>}
                <p><strong>Quick check:</strong> {card.check_q}</p>
                <ol className="list-inside list-decimal">
                  {card.check_options.map((option, index) => <li key={`${card.id}-${index}`}>{option}{index === card.check_answer ? " · correct answer" : ""}</li>)}
                </ol>
              </div>
              {card.author_id && (
                <div className="admin-panel space-y-2 p-3">
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={credentialsChecked} onChange={(event) => setCredentialsChecked(event.target.checked)} />
                    I have checked this author’s relevant credentials using the organisation’s normal verification process.
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input aria-label="Verified professional area" value={area} onChange={(event) => setArea(event.target.value)} maxLength={120} placeholder="Verified area (e.g. financial literacy)" className="admin-field min-w-56 flex-1" />
                    <button type="button" disabled={!credentialsChecked || !area.trim() || Boolean(busyId)} onClick={() => void moderate({ action: "verify_author", userId: card.author_id!, area: area.trim() })} className="btn inline-flex items-center gap-1 px-3">
                      <BadgeCheck size={14} /> Verify credentials
                    </button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {(["approve", "reject", "remove"] as const).map((action) => (
                  <button key={action} type="button" disabled={Boolean(busyId)} onClick={() => void moderate({ action, cardId: card.id })} className={`btn capitalize ${action === "approve" ? "btn-primary" : action === "remove" ? "btn-danger" : ""}`}>
                    {busyId === card.id ? "Saving…" : action}
                  </button>
                ))}
              </div>
            </article>
          ))}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Flag size={16} />Open reports <span className="text-sm admin-muted">({reports.length})</span></h2>
        {!loading && reports.length === 0
          ? <p className="admin-panel p-4 text-sm admin-muted">No open reports.</p>
          : reports.map((report) => (
            <article key={report.id} className="admin-panel flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="space-y-1 text-sm">
                <p>{report.reason || "No reason provided"}</p>
                <p className="text-xs admin-muted">Card {report.card_id ?? "not linked"} · {new Date(report.created_at).toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate({ action: "resolve_report", reportId: report.id, reportStatus: "actioned" })} className="btn btn-primary">Action taken</button>
                <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate({ action: "resolve_report", reportId: report.id, reportStatus: "dismissed" })} className="btn">Dismiss</button>
              </div>
            </article>
          ))}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Flag size={16} />Read the Room reports <span className="text-sm admin-muted">({readRoomReports.length})</span></h2>
        {!loading && readRoomReports.length === 0
          ? <p className="admin-panel p-4 text-sm admin-muted">No open Read the Room reports.</p>
          : readRoomReports.map((report) => (
            <article key={report.id} className="admin-panel flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="space-y-1 text-sm">
                <p>{report.reason}</p>
                <p className="text-xs admin-muted">Reporter {report.reporter_id} · Reported user {report.target_id} · {new Date(report.created_at).toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate({ action: "resolve_read_room_report", reportId: report.id, reportStatus: "actioned" })} className="btn btn-primary">Action taken</button>
                <button type="button" disabled={Boolean(busyId)} onClick={() => void moderate({ action: "resolve_read_room_report", reportId: report.id, reportStatus: "dismissed" })} className="btn">Dismiss</button>
              </div>
            </article>
          ))}
      </section>
    </div>
  );
}
