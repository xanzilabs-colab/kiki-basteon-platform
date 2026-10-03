"use client";
import type { Device } from "@/lib/types";

export function DeviceTable({ devices, refresh }: { devices: Device[]; refresh(): void }) {
  async function toggle(d: Device) {
    await fetch("/api/admin/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: d.device_id, active: !d.active }) });
    refresh();
  }
  async function changeOwner(d: Device) {
    const userId = window.prompt("Owner user UUID. Leave blank to unlink.", d.user_id ?? "");
    if (userId === null) return;
    await fetch("/api/admin/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: d.device_id, user_id: userId.trim() || null }) });
    refresh();
  }
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Device ID</th><th>Name</th><th>Owner</th><th>Linked</th><th>State</th><th>Last seen</th><th>Counter</th><th /></tr></thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id}>
              <td className="data">{d.device_id}</td>
              <td>{d.device_name}</td>
              <td className="muted">{d.owner?.full_name ?? "—"}</td>
              <td className="data muted">{d.linked_at ? new Date(d.linked_at).toLocaleDateString() : "—"}</td>
              <td>
                <button className={`status ${d.active ? "status-green" : "status-gray"}`} onClick={() => void toggle(d)} title="Toggle">
                  {d.active ? "Active" : "Inactive"}
                </button>
              </td>
              <td className="data muted">{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "Never"}</td>
              <td className="data">{d.last_ctr}</td>
              <td><button className="btn !px-2" onClick={() => void changeOwner(d)}>Owner</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}