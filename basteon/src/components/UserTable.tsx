"use client";

import { Fragment, useState } from "react";
import { UserRound } from "lucide-react";
import { fmtDateTime, fmtRelativeTime } from "@/lib/datetime";
import type { Profile } from "@/lib/types";
import { UserProfileDrawer } from "./UserProfileDrawer";

export function UserTable({ users, refresh }: { users: Profile[]; refresh(): void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  async function role(id: string, value: string) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role: value }),
    });
    void refresh();
  }

  return (
    <>
      <div className="overflow-x-auto">
      <div className="tbl-wrap min-w-max">
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Linked devices</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const incomplete = !user.full_name?.trim() || !user.phone?.trim();
              const open = expanded === user.id;
              return (
                <Fragment key={user.id}>
                  <tr>
                    <td>
                      <button
                        className="inline-flex items-center gap-1.5 text-left hover:text-[var(--info)] transition-colors"
                        title="View user profile"
                        onClick={() => setProfile(user)}
                      >
                        <UserRound size={14} />
                        {user.full_name ?? "—"}
                      </button>
                      {incomplete && (
                        <span className="status status-amber ml-2">Profile incomplete</span>
                      )}
                    </td>
                    <td className="muted">{user.email ?? "—"}</td>
                    <td className="data muted">{user.phone ?? "—"}</td>
                    <td>
                      <select
                        className="input"
                        style={{ width: 108, height: 24, padding: "0 6px" }}
                        value={user.role}
                        onChange={(event) => void role(user.id, event.target.value)}
                      >
                        {["admin", "responder", "user"].map((roleName) => (
                          <option key={roleName}>{roleName}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="btn data"
                        style={{ height: 24, padding: "0 8px" }}
                        disabled={!user.linked_device_count}
                        onClick={() => setExpanded(open ? null : user.id)}
                      >
                        {user.linked_device_count ?? 0}
                      </button>
                    </td>
                    <td className="data muted">{fmtDateTime(user.created_at)}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0, height: "auto" }}>
                        <div className="p-4 bg-[var(--raised)] border-t border-[var(--line)]">
                          <p className="label mb-3">Linked devices</p>
                          <div className="space-y-2">
                            {(user.devices ?? []).map((device) => (
                              <div
                                key={device.id}
                                className="flex flex-wrap items-center justify-between gap-3 text-[12px]"
                              >
                                <span>
                                  <b>{device.device_name}</b>{" "}
                                  <span className="data muted ml-2">{device.device_id}</span>
                                </span>
                                <span className={`status ${device.active ? "status-green" : "status-gray"}`}>
                                  {device.active ? "Active" : "Inactive"}
                                </span>
                                <span
                                  className="muted"
                                  title={device.last_seen_at ? fmtDateTime(device.last_seen_at) : undefined}
                                >
                                  {device.last_seen_at ? fmtRelativeTime(device.last_seen_at) : "Never seen"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
      <UserProfileDrawer profile={profile} onClose={() => setProfile(null)} />
    </>
  );
}