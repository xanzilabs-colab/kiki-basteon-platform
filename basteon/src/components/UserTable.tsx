"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Plus, Search, UserRound, X } from "lucide-react";
import { fmtDateTime, fmtRelativeTime } from "@/lib/datetime";
import type { Profile } from "@/lib/types";
import { UserProfileDrawer } from "./UserProfileDrawer";

type Credentials = { email: string; password: string };
type UserValues = {
  role: Profile["role"];
  full_name: string;
  phone: string;
  home_address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
};

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.formErrors?.[0] ?? body?.error ?? "The request could not be completed.");
  return body;
}

function pdfUrl(base64: string | null) {
  return base64 ? `data:application/pdf;base64,${base64}` : "";
}

export function UserTable({ users, refresh }: { users: Profile[]; refresh(): Promise<void> | void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<(Credentials & { id: string; pdfUrl: string }) | null>(null);
  const [form, setForm] = useState({ email: "", full_name: "", phone: "", role: "user" as Profile["role"] });
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? users.filter((user) => [user.full_name, user.email, user.phone, user.role].some((value) => value?.toLowerCase().includes(normalized)))
      : users;
  }, [users, query]);

  async function mutate(payload: Record<string, unknown>, method: "PATCH" | "DELETE" = "PATCH") {
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/admin/users", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refresh();
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The request could not be completed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(values: UserValues) {
    const success = await mutate({ action: "update_profile", id: profile?.id, ...values });
    if (success) setProfile((current) => current ? { ...current, ...values } : current);
    return success;
  }

  async function setSuspended(suspended: boolean) {
    const success = await mutate({ action: "suspension", id: profile?.id, suspended });
    if (success) setProfile((current) => current ? { ...current, is_suspended: suspended } : current);
    return success;
  }

  async function resetPassword() {
    if (!profile) return false;
    setBusy(true);
    setError("");
    try {
      const body = await requestJson("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_password", id: profile.id }),
      });
      setCredentials({ ...body.credentials, id: profile.id, pdfUrl: pdfUrl(body.credentialPdfBase64) });
      setError("");
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not reset password.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(adminPassword: string) {
    if (!profile) return false;
    const success = await mutate({ id: profile.id, adminPassword }, "DELETE");
    if (success) {
      setProfile(null);
      setCredentials(null);
    }
    return success;
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = await requestJson("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setCredentials({ ...body.credentials, id: body.id, pdfUrl: pdfUrl(body.credentialPdfBase64) });
      setForm({ email: "", full_name: "", phone: "", role: "user" });
      setShowCreate(false);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not create user.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id: string, role: Profile["role"]) {
    const oldRole = users.find((user) => user.id === id)?.role;
    const success = await mutate({ action: "role", id, role });
    if (!success && oldRole) await refresh();
  }

  const visibleCredentials = credentials && (credentials.id === profile?.id || !profile) ? credentials : null;

  return (
    <>
      {credentials && !profile && (
        <div className="admin-status admin-status-success flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p>Generated credentials for <b>{credentials.email}</b></p>
            <p className="admin-data break-all">{credentials.password}</p>
          </div>
          {credentials.pdfUrl && <a className="btn" href={credentials.pdfUrl} download={`basteon-user-credentials-${credentials.id}.pdf`}><Download size={14} />Download credentials</a>}
        </div>
      )}
      {error && !profile && <p className="admin-status admin-status-error" role="alert">{error}</p>}
      <section className="admin-panel">
        <div className="admin-panel-header">
          <div><h2>All users</h2><p>{users.length} {users.length === 1 ? "account" : "accounts"}</p></div>
          <button className="btn btn-primary" type="button" onClick={() => { setShowCreate(true); setError(""); }}>
            <Plus size={15} />Add user
          </button>
        </div>
        <div className="admin-toolbar">
          <label className="admin-search">
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or phone" aria-label="Search users" />
          </label>
          <span className="admin-muted text-[13px]">{filteredUsers.length} shown</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Linked devices</th><th>Created</th></tr></thead>
            <tbody>
              {filteredUsers.map((user) => {
                const incomplete = !user.full_name?.trim() || !user.phone?.trim();
                const open = expanded === user.id;
                const initials = (user.full_name ?? "U").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
                return (
                  <Fragment key={user.id}>
                    <tr>
                      <td>
                        <div className="admin-person">
                          <span className="admin-avatar">{initials || <UserRound size={14} />}</span>
                          <div>
                            <button className="admin-person-name" type="button" title="View and manage account" onClick={() => { setProfile(user); setError(""); }}>{user.full_name?.trim() || "Unnamed user"}</button>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {user.is_suspended && <span className="admin-pill admin-pill-red">Suspended</span>}
                              {incomplete && <span className="admin-pill admin-pill-amber">Profile incomplete</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="admin-muted">{user.email ?? "—"}</td>
                      <td className="admin-data admin-muted">{user.phone ?? "—"}</td>
                      <td>
                        <select
                          aria-label={`Role for ${user.full_name ?? user.email ?? "user"}`}
                          className="input"
                          value={user.role}
                          onChange={(event) => void changeRole(user.id, event.target.value as Profile["role"])}
                        >
                          {["admin", "responder", "user"].map((roleName) => <option key={roleName} value={roleName}>{roleName}</option>)}
                        </select>
                      </td>
                      <td><button className="btn admin-data" style={{ minHeight: 28, padding: "0 9px" }} disabled={!user.linked_device_count} onClick={() => setExpanded(open ? null : user.id)}>{user.linked_device_count ?? 0}</button></td>
                      <td className="admin-data admin-muted">{fmtDateTime(user.created_at)}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0, height: "auto" }}>
                          <div className="p-4">
                            <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Linked devices</p>
                            <div className="space-y-2">
                              {(user.devices ?? []).map((device) => (
                                <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 text-[12px]">
                                  <span><b>{device.device_name}</b>{" "}                                  <span className="admin-data admin-muted ml-2">{device.device_id}</span></span>
                                  <span className={`status ${device.active ? "status-green" : "status-gray"}`}>{device.active ? "Active" : "Inactive"}</span>
                                  <span className="admin-muted" title={device.last_seen_at ? fmtDateTime(device.last_seen_at) : undefined}>{device.last_seen_at ? fmtRelativeTime(device.last_seen_at) : "Never seen"}</span>
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
              {filteredUsers.length === 0 && <tr><td colSpan={6}><div className="py-12 text-center"><b className="block text-[16px]">No users found</b><span className="admin-muted mt-1 block">Try another name, email, phone number or role.</span></div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {showCreate && mounted && createPortal(
        <div className="admin-theme">
          <button className="admin-overlay" type="button" aria-label="Close add user form" onClick={() => setShowCreate(false)} />
          <aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
            <header className="admin-drawer-header">
              <h2 id="create-user-title">Add user</h2>
              <button className="btn" type="button" aria-label="Close add user form" onClick={() => setShowCreate(false)}><X size={16} /></button>
            </header>
            <form className="admin-drawer-body" onSubmit={(event) => void createUser(event)}>
              <p className="admin-muted mb-5">Create a platform account and assign its initial access role.</p>
              {error && <p className="admin-status admin-status-error mb-4" role="alert">{error}</p>}
              <div className="grid gap-4">
                <label className="admin-field-wrap">Full name<input required minLength={2} value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label>
                <label className="admin-field-wrap">Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
                <label className="admin-field-wrap">Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
                <label className="admin-field-wrap">Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Profile["role"] })}><option value="user">User</option><option value="responder">Responder</option><option value="admin">Admin</option></select></label>
              </div>
              <div className="admin-drawer-footer -mx-[22px] mt-6">
                <button className="btn" type="button" disabled={busy} onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
              </div>
            </form>
          </aside>
        </div>,
        document.body,
      )}
      <UserProfileDrawer
        profile={profile}
        onClose={() => setProfile(null)}
        onSave={saveProfile}
        onSuspend={setSuspended}
        onResetPassword={resetPassword}
        onDelete={deleteUser}
        credentials={visibleCredentials}
        credentialPdfUrl={visibleCredentials?.pdfUrl}
        error={profile ? error : ""}
        busy={busy}
      />
    </>
  );
}
