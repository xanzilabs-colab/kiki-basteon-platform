"use client";

import { fmtDateTime, fmtRelativeTime } from "@/lib/datetime";
import type { Device } from "@/lib/types";
import { useAppDialog } from "@/components/AppDialogProvider";
import { useState } from "react";
import { Copy, Info, KeyRound, X } from "lucide-react";
import { toast } from "sonner";

export function DeviceTable({ devices, refresh }: { devices: Device[]; refresh(): void }) {
  const { confirm, prompt } = useAppDialog();
  const [rotatedKey, setRotatedKey] = useState<{ deviceId: string; command: string } | null>(null);
  const [telemetryDevice, setTelemetryDevice] = useState<Device | null>(null);
  async function toggle(device: Device) { await fetch("/api/admin/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: device.device_id, active: !device.active }) }); void refresh(); }
  async function changeOwner(device: Device) {
    const userId = await prompt("Enter an owner user UUID, or leave it blank to unlink this device.", device.user_id ?? "", {
      title: "Change device owner",
      inputLabel: "Owner user UUID",
      submitLabel: "Save owner",
    });
    if (userId === null) return;
    await fetch("/api/admin/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: device.device_id, user_id: userId.trim() || null }) });
    void refresh();
  }
  async function pinAction(device: Device, action: "reset" | "clear_lockout") {
    const message = action === "reset"
      ? `Remove the PIN from ${device.device_name}? Only do this after verifying the owner's identity. The owner is notified and the band drops its PIN on its next check-in.`
      : `Clear the wrong-PIN lockout on ${device.device_name}?`;
    if (!(await confirm(message, {
      title: action === "reset" ? "Reset device PIN?" : "Clear PIN lockout?",
      confirmLabel: action === "reset" ? "Reset PIN" : "Clear lockout",
      danger: true,
    }))) return;
    const response = await fetch("/api/admin/devices/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: device.device_id, action }) });
    if (!response.ok) toast.error("PIN action failed.");
    void refresh();
  }
  async function rotateDeviceKey(device: Device) {
    if (!(await confirm(`Replace the server key for ${device.device_name} (${device.device_id})? The band cannot send alerts again until you enter the new key in its Serial Monitor.`, {
      title: "Rotate device key?",
      confirmLabel: "Rotate key",
      danger: true,
    }))) return;
    try {
      const response = await fetch("/api/admin/devices/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: device.device_id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not rotate the device key.");
      setRotatedKey({ deviceId: device.device_id, command: `KEY:${result.key_b64}:${result.last_ctr}` });
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rotate the device key.");
    }
  }
  async function copyRotatedKey() {
    if (!rotatedKey) return;
    try {
      await navigator.clipboard.writeText(rotatedKey.command);
      toast.success("Device provisioning command copied.");
    } catch {
      toast.error("Clipboard access failed. Select and copy the key shown below.");
    }
  }
  const lockedOut = (device: Device) => Boolean(device.pin?.locked_until && new Date(device.pin.locked_until).getTime() > Date.now());
  const telemetryRows = telemetryDevice ? [
    ["Firmware", telemetryDevice.fw_version ?? "Not reported"],
    ["Last telemetry", telemetryDevice.telemetry_at ? fmtDateTime(telemetryDevice.telemetry_at) : "Not reported"],
    ["GPS module", telemetryDevice.hw_gps == null ? "Not reported" : telemetryDevice.hw_gps ? "Detected" : "Not detected"],
    ["GPS fix", telemetryDevice.has_fix == null ? "Not reported" : telemetryDevice.has_fix ? "Available" : "No fix"],
    ["Satellites", telemetryDevice.last_satellites == null ? "Not reported" : String(telemetryDevice.last_satellites)],
    ["HDOP", telemetryDevice.last_hdop == null ? "Not reported" : telemetryDevice.last_hdop.toFixed(1)],
    ["IMU", telemetryDevice.hw_imu == null ? "Not reported" : telemetryDevice.hw_imu ? "Detected" : "Not detected"],
    ["Motion", telemetryDevice.last_motion_state ?? "Not reported"],
    ["Motion updated", telemetryDevice.last_motion_at ? fmtDateTime(telemetryDevice.last_motion_at) : "Not reported"],
    ["Speed", telemetryDevice.last_speed_kmh == null ? "Not reported" : `${Math.round(telemetryDevice.last_speed_kmh)} km/h`],
    ["Heading", telemetryDevice.last_heading_deg == null ? "Not reported" : `${Math.round(telemetryDevice.last_heading_deg)}°`],
    ["Battery", telemetryDevice.battery == null ? "Not reported" : `${Math.round(telemetryDevice.battery)}%`],
    ["Wi-Fi signal", telemetryDevice.wifi_rssi == null ? "Not reported" : `${telemetryDevice.wifi_rssi} dBm`],
    ["Counter", String(telemetryDevice.last_ctr)],
  ] : [];
  if (!devices.length) return <section className="panel p-5"><p className="font-medium">No matching devices</p><p className="muted text-xs mt-1">Change the search or ownership filter to see other registered devices.</p></section>;
  return (
    <div className="overflow-x-auto">
      <div className="tbl-wrap min-w-max">
        <table className="tbl min-w-[920px]">
          <thead><tr><th>Device ID</th><th>Name</th><th>Owner</th><th>Linked</th><th>State</th><th>PIN</th><th>Last seen</th><th>Telemetry</th><th>Counter</th><th /></tr></thead>
          <tbody>{devices.map((device) => <tr key={device.id}>
            <td className="data">{device.device_id}</td>
            <td>{device.device_name}</td>
            <td>{device.owner ? <div title={device.owner.phone ?? undefined}><p>{device.owner.full_name ?? "Unnamed user"}</p><p className="muted text-[11px]">{device.owner.email ?? "No email"}</p>{device.owner.phone && <p className="muted text-[11px]">{device.owner.phone}</p>}</div> : <span className="status status-gray">Unlinked</span>}</td>
            <td className="data muted">{device.linked_at ? <time title={fmtDateTime(device.linked_at)}>{fmtDateTime(device.linked_at)}</time> : "Not linked"}</td>
            <td><button className={`status ${device.active ? "status-green" : "status-gray"}`} onClick={() => void toggle(device)} title="Toggle active state">{device.active ? "Active" : "Inactive"}</button></td>
            <td>
              <span className={`status ${device.pin_locked ? "status-green" : "status-gray"}`}>{device.pin_locked ? (lockedOut(device) ? "Locked out" : "On") : "Off"}</span>
              {device.pin_locked && device.band_pin_locked === false && <p className="muted text-[11px]" title="The band reported no PIN on its last heartbeat">Band not synced</p>}
              {!device.pin_locked && device.band_pin_locked && <p className="muted text-[11px]" title="The band will clear its PIN on its next heartbeat">Band clearing</p>}
              {device.pin_locked && <div className="flex gap-1 mt-1">{(lockedOut(device) || (device.pin?.failed_attempts ?? 0) > 0) && <button className="btn !px-2 !py-0.5 text-[11px]" onClick={() => void pinAction(device, "clear_lockout")}>Clear lockout</button>}<button className="btn !px-2 !py-0.5 text-[11px]" onClick={() => void pinAction(device, "reset")}>Reset PIN</button></div>}
            </td>
            <td className="data muted">{device.last_seen_at ? <time title={fmtDateTime(device.last_seen_at)}>{fmtRelativeTime(device.last_seen_at)}</time> : "Never"}</td>
            <td><button type="button" className="btn !px-2" title={`View telemetry for ${device.device_name}`} aria-label={`View telemetry for ${device.device_name}`} onClick={() => setTelemetryDevice(device)}><Info size={15} /><span className="sr-only">View telemetry</span></button></td>
            <td className="data">{device.last_ctr}</td>
            <td><div className="flex gap-1"><button className="btn !px-2" onClick={() => void changeOwner(device)}>Owner</button><button className="btn !px-2" title="Rotate device encryption key" aria-label={`Rotate key for ${device.device_name}`} onClick={() => void rotateDeviceKey(device)}><KeyRound size={14} /></button></div></td>
          </tr>)}</tbody>
        </table>
      </div>
      {rotatedKey && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="device-key-title" className="panel w-full max-w-lg space-y-4 border border-[var(--line)] p-5">
          <h2 id="device-key-title" className="text-lg font-semibold">New key for {rotatedKey.deviceId}</h2>
          <p className="text-sm text-[var(--muted)]">Copy this command now. It is shown only once and includes the server counter needed to resume safely. In the device Serial Monitor at 115200 baud, send it followed by a newline.</p>
          <code className="block select-all break-all rounded border border-[var(--line)] bg-[var(--surface-2)] p-3 text-xs">{rotatedKey.command}</code>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => void copyRotatedKey()}><Copy size={14} />Copy key</button>
            <button className="btn btn-primary" onClick={() => setRotatedKey(null)}>I saved the key</button>
          </div>
        </section>
      </div>}
      {telemetryDevice && <div
        className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setTelemetryDevice(null);
        }}
      >
        <style>{`
          @keyframes deviceTelemetryIn {
            from { opacity: 0; transform: translateY(8px) scale(.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          .device-telemetry-dialog { animation: deviceTelemetryIn 180ms ease-out both; }
          @media (prefers-reduced-motion: reduce) {
            .device-telemetry-dialog { animation: none; }
          }
        `}</style>
        <section
          className="device-telemetry-dialog w-full max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="device-telemetry-title"
          aria-describedby="device-telemetry-description"
          onKeyDown={(event) => {
            if (event.key === "Escape") setTelemetryDevice(null);
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="device-telemetry-title" className="text-lg font-semibold">Device telemetry</h2>
              <p id="device-telemetry-description" className="mt-1 text-sm text-[var(--muted)]">{telemetryDevice.device_name} · {telemetryDevice.device_id}</p>
            </div>
            <button type="button" className="btn !px-2" autoFocus aria-label="Close telemetry details" onClick={() => setTelemetryDevice(null)}><X size={16} /></button>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {telemetryRows.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                <dt className="text-[11px] font-medium text-[var(--muted)]">{label}</dt>
                <dd className="mt-0.5 break-words text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>}
    </div>
  );
}