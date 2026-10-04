"use client";

import { fmtDateTime, fmtRelativeTime } from "@/lib/datetime";
import type { Device } from "@/lib/types";

export function DeviceTable({ devices, refresh }: { devices: Device[]; refresh(): void }) {
  async function toggle(device: Device) { await fetch("/api/admin/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: device.device_id, active: !device.active }) }); void refresh(); }
  async function changeOwner(device: Device) { const userId = window.prompt("Owner user UUID. Leave blank to unlink.", device.user_id ?? ""); if (userId === null) return; await fetch("/api/admin/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: device.device_id, user_id: userId.trim() || null }) }); void refresh(); }
  async function pinAction(device: Device, action: "reset" | "clear_lockout") {
    const prompt = action === "reset"
      ? `Remove the PIN from ${device.device_name}? Only do this after verifying the owner's identity. The owner is notified and the band drops its PIN on its next check-in.`
      : `Clear the wrong-PIN lockout on ${device.device_name}?`;
    if (!window.confirm(prompt)) return;
    const response = await fetch("/api/admin/devices/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: device.device_id, action }) });
    if (!response.ok) window.alert("PIN action failed.");
    void refresh();
  }
  const lockedOut = (device: Device) => Boolean(device.pin?.locked_until && new Date(device.pin.locked_until).getTime() > Date.now());
  if (!devices.length) return <section className="panel p-5"><p className="font-medium">No matching devices</p><p className="muted text-xs mt-1">Change the search or ownership filter to see other registered devices.</p></section>;
  return (
    <div className="overflow-x-auto">
      <div className="tbl-wrap min-w-max">
        <table className="tbl min-w-[920px]">
          <thead><tr><th>Device ID</th><th>Name</th><th>Owner</th><th>Linked</th><th>State</th><th>PIN</th><th>Last seen</th><th>Counter</th><th /></tr></thead>
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
            <td className="data">{device.last_ctr}</td>
            <td><button className="btn !px-2" onClick={() => void changeOwner(device)}>Owner</button></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}