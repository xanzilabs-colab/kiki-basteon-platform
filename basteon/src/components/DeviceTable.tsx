"use client";

import { fmtDateTime, fmtRelativeTime } from "@/lib/datetime";
import type { Device } from "@/lib/types";

export function DeviceTable({ devices, refresh }: { devices: Device[]; refresh(): void }) {
  async function toggle(device: Device) { await fetch("/api/admin/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: device.device_id, active: !device.active }) }); void refresh(); }
  async function changeOwner(device: Device) { const userId = window.prompt("Owner user UUID. Leave blank to unlink.", device.user_id ?? ""); if (userId === null) return; await fetch("/api/admin/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: device.device_id, user_id: userId.trim() || null }) }); void refresh(); }
  if (!devices.length) return <section className="panel p-5"><p className="font-medium">No matching devices</p><p className="muted text-xs mt-1">Change the search or ownership filter to see other registered devices.</p></section>;
  return (
    <div className="overflow-x-auto">
      <div className="tbl-wrap min-w-max">
        <table className="tbl min-w-[920px]">
          <thead><tr><th>Device ID</th><th>Name</th><th>Owner</th><th>Linked</th><th>State</th><th>Last seen</th><th>Counter</th><th /></tr></thead>
          <tbody>{devices.map((device) => <tr key={device.id}>
            <td className="data">{device.device_id}</td>
            <td>{device.device_name}</td>
            <td>{device.owner ? <div title={device.owner.phone ?? undefined}><p>{device.owner.full_name ?? "Unnamed user"}</p><p className="muted text-[11px]">{device.owner.email ?? "No email"}</p>{device.owner.phone && <p className="muted text-[11px]">{device.owner.phone}</p>}</div> : <span className="status status-gray">Unlinked</span>}</td>
            <td className="data muted">{device.linked_at ? <time title={fmtDateTime(device.linked_at)}>{fmtDateTime(device.linked_at)}</time> : "Not linked"}</td>
            <td><button className={`status ${device.active ? "status-green" : "status-gray"}`} onClick={() => void toggle(device)} title="Toggle active state">{device.active ? "Active" : "Inactive"}</button></td>
            <td className="data muted">{device.last_seen_at ? <time title={fmtDateTime(device.last_seen_at)}>{fmtRelativeTime(device.last_seen_at)}</time> : "Never"}</td>
            <td className="data">{device.last_ctr}</td>
            <td><button className="btn !px-2" onClick={() => void changeOwner(device)}>Owner</button></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}