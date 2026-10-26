"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAppDialog } from "@/components/AppDialogProvider";
import type { AlertStatus } from "@/lib/types";
import { isExpiredAuthError, redirectToSignIn, refreshExpiredSession } from "@/lib/authSession";

type Assignment = { id: string; responder_user_id: string | null; status: string };
type ResponseEvent = { id: string; actor_id: string | null; action: string; created_at: string };
const activeStatuses = ["assigned", "acknowledged", "en_route", "on_scene"];

const statusText: Record<string, string> = {
  assigned: "Assigned",
  acknowledged: "Acknowledged",
  en_route: "On the way",
  on_scene: "On scene",
};

export function AlertResponseActions({ alertId, alertStatus }: { alertId: string; alertStatus: AlertStatus }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [history, setHistory] = useState<ResponseEvent[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const authRecoveryAttempted = useRef(false);
  const progressErrorShown = useRef(false);
  const { confirm } = useAppDialog();
  const supabase = useMemo(() => createClient(), []);
  const isClosed = alertStatus === "resolved" || alertStatus === "false_alarm";

  const loadAssignments = useCallback(async () => {
    if (isClosed) return;
    const [{ data: { user } }, { data, error }, { data: events, error: eventError }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("alert_assignments")
        .select("id,responder_user_id,status")
        .eq("alert_id", alertId)
        .in("status", activeStatuses)
        .order("assigned_at", { ascending: true }),
      supabase.from("alert_assignment_events")
        .select("id,actor_id,action,created_at")
        .eq("alert_id", alertId)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
    if (error || eventError) {
      const authError = isExpiredAuthError(error) || isExpiredAuthError(eventError);
      if (authError) {
        if (authRecoveryAttempted.current) {
          await supabase.auth.signOut();
          redirectToSignIn(window.location.pathname);
          return;
        }
        authRecoveryAttempted.current = true;
        if (await refreshExpiredSession(supabase, window.location.pathname)) {
          await loadAssignments();
        }
        return;
      }
      if (progressErrorShown.current) return;
      progressErrorShown.current = true;
      toast.error("Could not refresh responder progress and audit history.");
      return;
    }
    authRecoveryAttempted.current = false;
    progressErrorShown.current = false;
    setUserId(user?.id ?? null);
    setAssignments((data ?? []) as Assignment[]);
    setHistory((events ?? []) as ResponseEvent[]);
  }, [alertId, isClosed, supabase]);

  useEffect(() => {
    if (isClosed) return;
    void loadAssignments();
    const channel = supabase.channel(`alert-response-${alertId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "alert_assignments",
        filter: `alert_id=eq.${alertId}`,
      }, () => void loadAssignments())
      .subscribe();
    const timer = window.setInterval(() => void loadAssignments(), 5_000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [alertId, isClosed, loadAssignments, supabase]);

  const myAssignment = assignments.find((assignment) => assignment.responder_user_id === userId);
  const acceptedCount = assignments.filter((assignment) => assignment.status === "acknowledged").length;
  const enRouteCount = assignments.filter((assignment) => assignment.status === "en_route").length;
  const onSceneCount = assignments.filter((assignment) => assignment.status === "on_scene").length;
  const activeCount = assignments.filter((assignment) => ["acknowledged", "en_route", "on_scene"].includes(assignment.status)).length;
  if (isClosed) {
    return (
      <section className="section" aria-label="Responder progress">
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
          This incident is {alertStatus === "resolved" ? "resolved" : "closed as a false alarm"}. No further response is required.
        </p>
      </section>
    );
  }

  async function act(action: "accept" | "en_route" | "on_scene" | "withdraw" | "resolved") {
    if (isClosed) return;
    if (action === "resolved" && !(await confirm("This closes the incident for everyone, removes it from active responder queues, and keeps it in history.", {
      title: "Remove active alert?",
      confirmLabel: "Resolve for everyone",
      danger: true,
    }))) return;
    setBusy(true);
    try {
      const isResolve = action === "resolved";
      const response = await fetch(isResolve ? "/api/alerts/close" : "/api/alerts/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isResolve
          ? { alertId, source: "responder" }
          : { alertId, action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(result.error === "closed_alert"
          ? "This alert is already closed."
          : result.error === "forbidden"
            ? "Only a responder who has arrived can resolve this incident."
            : "Could not update your response.");
        return;
      }
      toast.success(isResolve
        ? "Incident resolved. Other responders have been notified."
        : action === "withdraw"
          ? "You have stopped responding."
          : "Your response status has been shared.");
      await loadAssignments();
    } catch {
      toast.error("Could not reach the response service. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section space-y-3" aria-label="Responder progress">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Responder progress</span>
        <span className="data text-[11px]">{activeCount} responding</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-[var(--line)] px-2 py-2"><b className="block text-sm">{acceptedCount}</b><span className="muted text-[10px]">Acknowledged</span></div>
        <div className="rounded border border-[var(--line)] px-2 py-2"><b className="block text-sm">{enRouteCount}</b><span className="muted text-[10px]">On the way</span></div>
        <div className="rounded border border-[var(--line)] px-2 py-2"><b className="block text-sm">{onSceneCount}</b><span className="muted text-[10px]">On scene</span></div>
      </div>
      {assignments.filter((assignment) => assignment.responder_user_id).map((assignment) => (
        <p key={assignment.id} className="flex items-center justify-between text-[11px]">
          <span className="muted">{assignment.responder_user_id === userId ? "You" : "Responder"}</span>
          <span className="data">{statusText[assignment.status] ?? assignment.status}</span>
        </p>
      ))}
      {!myAssignment ? (
        <button className="btn btn-danger w-full" disabled={busy} onClick={() => void act("accept")}>
          {busy ? "Updating…" : "Acknowledge & respond"}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {myAssignment.status === "assigned" && <button className="btn btn-danger" disabled={busy} onClick={() => void act("accept")}>Acknowledge</button>}
          {myAssignment.status === "acknowledged" && <button className="btn btn-danger" disabled={busy} onClick={() => void act("en_route")}>I&apos;m on my way</button>}
          {myAssignment.status === "en_route" && <button className="btn btn-danger" disabled={busy} onClick={() => void act("on_scene")}>I&apos;ve arrived</button>}
          {myAssignment.status === "on_scene" && <button className="btn btn-primary" disabled={busy} onClick={() => void act("resolved")}>Resolve for everyone</button>}
          <button className="btn" disabled={busy} onClick={() => void act("withdraw")}>Stop responding</button>
        </div>
      )}
      <p className="muted text-[10px]">Accepting shares your live location with the caller while you are responding.</p>
      {history.length > 0 && (
        <ol className="space-y-1 border-t border-[var(--line)] pt-2" aria-label="Recent response audit">
          {history.map((event) => (
            <li key={event.id} className="flex justify-between gap-2 text-[10px]">
              <span className="muted">{event.actor_id === userId ? "You" : "Responder"} · {event.action.replaceAll("_", " ")}</span>
              <time className="data shrink-0" dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
