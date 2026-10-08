"use client";

import { Copy, ExternalLink, Phone, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Alert, AlertEvent } from "@/lib/types";
import { locationAgeMs, locationHealth } from "@/lib/locationTracking";
import { StatusBadge } from "./StatusBadge";
import { LocationSourceBadge } from "./LocationSourceBadge";
import { StatusActions } from "./StatusActions";
import { AlertTimeline } from "./AlertTimeline";
import { AlertTypeBadge } from "./alerts/AlertTypeBadge";
import { createClient } from "@/lib/supabase/client";

export function AlertDetailPanel({
  alert,
  events,
  admin,
  refresh,
  organisationId,
  canDispatch,
  onViewProfile,
}: {
  alert: Alert | null;
  events: AlertEvent[];
  admin?: boolean;
  refresh(): void;
  organisationId?: string;
  canDispatch?: boolean;
  onViewProfile?(alert: Alert): void;
}) {
  const [now, setNow] = useState(Date.now());
  const [assignBusy, setAssignBusy] = useState(false);
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Array<{ user_id: string; branch_id: string | null; availability: string; profiles?: { full_name: string | null } | null }>>([]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!organisationId) return;
    let active = true;
    void (async () => {
      const mod = await fetch(`/api/organisation/responders/availability?organisationId=${organisationId}`, { cache: "no-store" });
      const client = createClient();
      const { data: { user } } = await client.auth.getUser();
      if (!active) return;
      setOperatorId(user?.id ?? null);
      if (mod.ok) {
        const body = await mod.json().catch(() => []);
        if (active) setAvailability(Array.isArray(body) ? body : []);
      }
    })();
    return () => { active = false; };
  }, [organisationId]);

  if (!alert) {
    return (
      <div className="p-6">
        <p className="label">No selection</p>
        <p className="muted text-[12px] mt-1">Select an incident to view response details.</p>
      </div>
    );
  }

  const coords =
    alert.lat == null || alert.lng == null
      ? null
      : `${alert.lat.toFixed(6)}, ${alert.lng.toFixed(6)}`;
  const ageSeconds = Math.floor(locationAgeMs(alert, now) / 1000);
  const health = locationHealth(alert, now);
  const healthText = health === "live" ? "LIVE" : health === "delayed" ? "SIGNAL DELAYED" : "NO SIGNAL";
  const healthColor =
    health === "live"
      ? "text-[var(--ok)]"
      : health === "delayed"
      ? "text-[var(--warn)]"
      : "text-[var(--crit)]";
  const currentAlert = alert;
  const branchAvailability = availability.filter((item) => item.branch_id === (currentAlert.primary_branch_id ?? null));
  const bestAvailable = branchAvailability.find((item) => item.availability === "available") ?? branchAvailability[0] ?? null;

  async function assignResponder(responderUserId: string | null) {
    if (!currentAlert.primary_branch_id || !organisationId) return;
    setAssignBusy(true);
    const response = await fetch("/api/alerts/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alertId: currentAlert.id,
        organisationId,
        branchId: currentAlert.primary_branch_id,
        responderUserId,
      }),
    });
    const body = await response.json().catch(() => null);
    setAssignBusy(false);
    if (!response.ok) {
      toast.error((body as { error?: string } | null)?.error ?? "Could not assign responder.");
      return;
    }
    toast.success("Responder assigned.");
    refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="pane-head">
        <StatusBadge status={alert.status} />
        <AlertTypeBadge typeCode={alert.type_code} size="header" />
        <span className="data text-[11px] muted">#{alert.ctr}</span>
      </div>

      {alert.type_source === "upgrade" && alert.type_updated_at && <div className="mx-4 mt-3 border-l-4 border-[#087f70] bg-[#087f70]/15 px-3 py-2 text-[12px] font-semibold text-[#70e1d0]">Updated to {alert.type_code === "medical" ? "Medical" : "General"} at {new Date(alert.type_updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
      {alert.type_code === "medical" && <p className="mx-4 mt-2 text-[12px] text-[#8ddfd2]">Caller reports a medical emergency.</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="section">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--surface-3)] font-bold">{alert.device?.owner?.avatar_url ? <img src={alert.device.owner.avatar_url} alt="" className="h-full w-full object-cover" /> : (alert.device?.owner?.full_name?.slice(0, 1) ?? "?")}</span><div><h2 className="text-[15px] font-semibold tracking-[-.005em]">{alert.device?.device_name ?? alert.device_id}</h2><p className="muted text-[12px] mt-0.5">{alert.device?.owner?.full_name ?? "No owner assigned"}</p></div></div>

        {alert.device?.owner?.phone && (
          <a
            className="btn mt-3 inline-flex items-center gap-2 text-[var(--info)]"
            href={`tel:${alert.device.owner.phone}`}
          >
            <Phone size={13} />
            <span className="data">{alert.device.owner.phone}</span>
          </a>
        )}

        {alert.device?.owner && onViewProfile && (
          <button
            className="btn mt-2 w-full inline-flex items-center justify-center gap-2"
            onClick={() => onViewProfile(alert)}
          >
            <UserRound size={14} />
            View user profile
          </button>
        )}
      </div>

      <div className="section space-y-2">
        <span className="label">Location</span>
        <div className="flex items-center justify-between gap-2">
          <LocationSourceBadge alert={alert} />
          <span className={`data text-[11px] ${healthColor}`}>{healthText}</span>
        </div>
        <div className="kv">
          <span className="muted text-[12px]">Last update</span>
          <span className={`data text-[12px] ${healthColor}`}>{ageSeconds}s ago</span>
        </div>

        {coords ? (
          <>
            <div className="kv">
              <span className="data text-[12px]">{coords}</span>
              <button
                className="btn"
                style={{ height: 24, width: 28, padding: 0 }}
                title="Copy coordinates"
                onClick={() => {
                  void navigator.clipboard.writeText(coords);
                  toast.success("Coordinates copied");
                }}
              >
                <Copy size={13} />
              </button>
            </div>
            <a
              className="btn w-full inline-flex items-center justify-center gap-2"
              target="_blank"
              rel="noreferrer"
              href={`https://www.google.com/maps/dir/?api=1&destination=${alert.lat},${alert.lng}`}
            >
              <ExternalLink size={13} />
              Navigate
            </a>
          </>
        ) : (
          <p className="text-[var(--crit)] text-[12px]">No GPS fix available for this incident.</p>
        )}
      </div>

      <div className="section">
        <div className="kv">
          <span className="label">Battery</span>
          <span className="data text-[12px]">{alert.battery == null ? "—" : `${alert.battery}%`}</span>
        </div>
        <div className="kv mt-2">
          <span className="label">Location updates</span>
          <span className="data text-[12px]">{alert.update_count ?? 0}</span>
        </div>
      </div>

      {canDispatch && (
        <div className="section space-y-2">
          <span className="label block">Dispatch</span>
          {!alert.primary_branch_id && <p className="muted text-[12px]">No routed branch available yet for assignment.</p>}
          {alert.primary_branch_id && (
            <>
              <p className="muted text-[12px]">Routed branch: <b>{alert.primary_branch_id}</b></p>
              <div className="flex flex-wrap gap-2">
                <button className="btn" disabled={assignBusy || !operatorId} onClick={() => void assignResponder(operatorId)}>
                  Assign to me
                </button>
                <button className="btn" disabled={assignBusy || !bestAvailable} onClick={() => void assignResponder(bestAvailable?.user_id ?? null)}>
                  Assign best available
                </button>
              </div>
              {bestAvailable && <p className="muted text-[11px]">Best available: {bestAvailable.profiles?.full_name ?? bestAvailable.user_id}</p>}
            </>
          )}
        </div>
      )}

      <div className="section">
        <span className="label block mb-3">Timeline</span>
        <AlertTimeline events={events.filter((e) => e.alert_id === alert.id)} />
      </div>
      </div>

      <div className="section shrink-0 border-t border-[var(--line-strong)] border-b-0 bg-[var(--surface)]">
        <StatusActions alert={alert} admin={admin} onChanged={refresh} />
      </div>
    </div>
  );
}