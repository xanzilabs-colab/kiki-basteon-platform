"use client";

import { useCallback, useEffect, useState } from "react";
import { Bluetooth, RefreshCw, ShieldAlert } from "lucide-react";

type Shell = {
  token_id: string;
  user_id: string;
  owner_name: string | null;
  armed: boolean;
  test_mode: boolean;
  app_version: string | null;
  android_sdk: number | null;
  model: string | null;
  battery_unrestricted: boolean | null;
  last_seen: string;
};

type TriggerDevice = {
  user_id: string;
  owner_name: string | null;
  token_id: string;
  kind: string;
  label: string;
  status: string;
  battery_pct: number | null;
  verified_at: string | null;
  last_connected_at: string | null;
  last_seen_at: string;
};

type Diagnostic = {
  id: number;
  user_id: string;
  token_id: string;
  at: string;
  pattern: string;
  origin: string | null;
  keycodes: number[];
  device_hint: string | null;
};

type Data = { shells: Shell[]; devices: TriggerDevice[]; diagnostics: Diagnostic[] };

function timestamp(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Invalid timestamp" : parsed.toLocaleString();
}

export default function AdminTriggersPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/triggers", { cache: "no-store" });
      const body = await response.json() as Data | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error ?? "Could not load trigger records." : "Could not load trigger records.");
      setData(body as Data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load trigger records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const staleArmed = (data?.shells ?? []).filter((shell) =>
    shell.armed && Date.now() - new Date(shell.last_seen).getTime() > 15 * 60_000,
  ).length;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <header className="flex flex-col gap-3 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Safety integrations</p>
          <h1 className="page-title mt-1">Bluetooth triggers</h1>
          <p className="muted mt-2 max-w-2xl text-[13px]">Phone shell health and privacy-filtered device/press diagnostics. A recent heartbeat is a status signal, not a guarantee that a physical accessory can trigger an alert.</p>
        </div>
        <button className="btn" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button>
      </header>

      {error && <p role="alert" className="border-l-4 border-[var(--crit)] bg-[var(--crit-bg)] px-4 py-3 text-sm text-[var(--crit)]">Trigger data could not be loaded: {error}</p>}
      {staleArmed > 0 && <p role="status" className="flex items-center gap-2 border-l-4 border-[var(--warn)] bg-[var(--warn-bg)] px-4 py-3 text-sm"><ShieldAlert size={17} />{staleArmed} phone shell{staleArmed === 1 ? "" : "s"} marked armed have not sent a heartbeat in over 15 minutes.</p>}

      <section className="panel border border-[var(--line)] shadow-none">
        <div className="pane-head"><div><span>Phone trigger health</span><p className="muted mt-0.5 text-[11px]">{data?.shells.length ?? 0} registered Android shell{data?.shells.length === 1 ? "" : "s"}</p></div></div>
        {loading ? <p className="p-5 text-sm muted">Loading trigger health…</p> : data?.shells.length ? (
          <div className="overflow-x-auto"><table className="tbl min-w-[900px]"><thead><tr><th>Owner</th><th>Phone</th><th>State</th><th>Test mode</th><th>Battery</th><th>App / Android</th><th>Last heartbeat</th></tr></thead><tbody>
            {data.shells.map((shell) => {
              const stale = Date.now() - new Date(shell.last_seen).getTime() > 15 * 60_000;
              return <tr key={shell.token_id}>
                <td>{shell.owner_name ?? "Kiki user"}<span className="data mt-1 block text-[10px]">{shell.user_id}</span></td>
                <td>{shell.model ?? "Model not reported"}</td>
                <td><span className={`status ${shell.armed && !stale ? "status-green" : "status-gray"}`}>{stale ? "Stale heartbeat" : shell.armed ? "Armed" : "Disarmed"}</span></td>
                <td>{shell.test_mode ? "On" : "Off"}</td>
                <td>{shell.battery_unrestricted == null ? "Unknown" : shell.battery_unrestricted ? "Unrestricted" : "Optimised"}</td>
                <td>{shell.app_version ?? "—"} / Android {shell.android_sdk ?? "—"}</td>
                <td className="data">{timestamp(shell.last_seen)}</td>
              </tr>;
            })}
          </tbody></table></div>
        ) : <p className="p-5 text-sm muted">No phone trigger heartbeats have been recorded.</p>}
      </section>

      <section className="panel border border-[var(--line)] shadow-none">
        <div className="pane-head"><div><span>Everyday devices</span><p className="muted mt-0.5 text-[11px]">User-selected labels and connection state only; Bluetooth names and addresses are not uploaded.</p></div></div>
        {loading ? <p className="p-5 text-sm muted">Loading device status…</p> : data?.devices.length ? (
          <div className="overflow-x-auto"><table className="tbl min-w-[760px]"><thead><tr><th>Owner</th><th>Label</th><th>Type</th><th>Connection</th><th>Battery</th><th>Practice verified</th><th>Last seen</th></tr></thead><tbody>
            {data.devices.map((device, index) => <tr key={`${device.token_id}-${device.label}-${index}`}>
              <td>{device.owner_name ?? "Kiki user"}</td><td>{device.label}</td><td>{device.kind}</td>
              <td><span className={`status ${device.status === "connected" ? "status-green" : "status-gray"}`}>{device.status.replaceAll("_", " ")}</span></td>
              <td>{device.battery_pct == null ? "Not reported" : `${device.battery_pct}%`}</td>
              <td>{device.verified_at ? timestamp(device.verified_at) : "Not tested"}</td><td className="data">{timestamp(device.last_seen_at)}</td>
            </tr>)}
          </tbody></table></div>
        ) : <p className="p-5 text-sm muted">No everyday device reports have been received.</p>}
      </section>

      <section className="panel border border-[var(--line)] shadow-none">
        <div className="pane-head"><div><span className="flex items-center gap-2"><Bluetooth size={16} />Recent input diagnostics</span><p className="muted mt-0.5 text-[11px]">Most recent 500 events. Key codes describe media-button input only; no device address or location is stored here.</p></div></div>
        {loading ? <p className="p-5 text-sm muted">Loading diagnostics…</p> : data?.diagnostics.length ? (
          <div className="overflow-x-auto"><table className="tbl min-w-[700px]"><thead><tr><th>Received</th><th>Owner ID</th><th>Pattern</th><th>Input source</th><th>Media key codes</th><th>Device hint</th></tr></thead><tbody>
            {data.diagnostics.map((event) => <tr key={event.id}><td className="data">{timestamp(event.at)}</td><td className="data">{event.user_id}</td><td>{event.pattern}</td><td>{event.origin ?? "Unknown"}</td><td className="data">{event.keycodes.join(", ") || "None"}</td><td>{event.device_hint ?? "Not reported"}</td></tr>)}
          </tbody></table></div>
        ) : <p className="p-5 text-sm muted">No trigger input diagnostics have been received.</p>}
      </section>
    </div>
  );
}
