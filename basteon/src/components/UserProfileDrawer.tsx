"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Download, KeyRound, Mail, MapPin, Phone, Save, ShieldAlert, Trash2, UserRound, X } from "lucide-react";
import type { Profile, ProfileContact } from "@/lib/types";
import { CachedProfileImage } from "@/components/CachedProfileImage";

type DrawerProfile = ProfileContact & Partial<Pick<Profile, "id" | "role" | "is_suspended">>;
type ProfileValues = {
  role: Profile["role"];
  full_name: string;
  phone: string;
  home_address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
};

type Credentials = { email: string; password: string };

export function UserProfileDrawer({
  profile,
  onClose,
  onSave,
  onSuspend,
  onResetPassword,
  onDelete,
  credentials,
  credentialPdfUrl,
  error,
  busy = false,
}: {
  profile: DrawerProfile | null;
  onClose(): void;
  onSave?: (values: ProfileValues) => Promise<boolean>;
  onSuspend?: (suspended: boolean) => Promise<boolean>;
  onResetPassword?: () => Promise<boolean>;
  onDelete?: (adminPassword: string) => Promise<boolean>;
  credentials?: Credentials | null;
  credentialPdfUrl?: string;
  error?: string;
  busy?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<ProfileValues>({
    role: "user",
    full_name: "",
    phone: "",
    home_address: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
  });
  const [adminPassword, setAdminPassword] = useState("");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!profile) return;
    setEditing(false);
    setAdminPassword("");
    setValues({
      role: profile.role ?? "user",
      full_name: profile.full_name ?? "",
      phone: profile.phone ?? "",
      home_address: profile.home_address ?? "",
      emergency_contact_name: profile.emergency_contact_name ?? "",
      emergency_contact_phone: profile.emergency_contact_phone ?? "",
    });
  }, [profile]);

  if (!profile || !mounted) return null;

  const managed = Boolean(onSave || onSuspend || onResetPassword || onDelete);

  return createPortal(
    <div
      className={managed ? "admin-theme fixed inset-0 z-[1300]" : "fixed inset-0 z-[1300]"}
      role="dialog"
      aria-modal="true"
      aria-label="User profile"
    >
      <button
        className={managed ? "admin-overlay" : "drawer-scrim absolute inset-0"}
        aria-label="Close user profile"
        onClick={onClose}
      />
      <aside className={managed ? "admin-drawer" : "drawer-panel absolute inset-y-0 right-0 flex w-full max-w-md flex-col"}>
        <div className={managed ? "admin-drawer-header" : "pane-head"} style={managed ? undefined : { height: 48 }}>
          {managed ? <h2>Account details</h2> : <span>User profile</span>}
          <button
            className="btn"
            style={{ height: 24, width: 28, padding: 0 }}
            title="Close user profile"
            aria-label="Close user profile"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <div className={managed ? "admin-drawer-body" : "overflow-y-auto"}>
          <section className="section">
            <div className="flex items-center gap-3">
              <span className="inline-grid h-9 w-9 overflow-hidden place-items-center rounded-[4px] bg-[var(--surface-3)] text-[var(--text)]">
                <CachedProfileImage src={profile.avatar_url} alt="" className="h-full w-full object-cover" fallback={<UserRound size={18} />} />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold">{profile.full_name?.trim() || "Unnamed user"}</h2>
                <p className="muted text-[12px]">{managed ? profile.is_suspended ? "Suspended account" : profile.role ?? "user" : "Emergency profile"}</p>
              </div>
            </div>
          </section>

          {managed && editing ? (
            <form
              className="section space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void onSave?.(values).then((saved) => { if (saved) setEditing(false); });
              }}
            >
              <p className="label">Edit account</p>
              <label className="field">Full name<input className="input" required minLength={2} value={values.full_name} onChange={(event) => setValues({ ...values, full_name: event.target.value })} /></label>
              <label className="field">Phone<input className="input" value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} /></label>
              <label className="field">Home address<input className="input" value={values.home_address} onChange={(event) => setValues({ ...values, home_address: event.target.value })} /></label>
              <label className="field">Emergency contact name<input className="input" value={values.emergency_contact_name} onChange={(event) => setValues({ ...values, emergency_contact_name: event.target.value })} /></label>
              <label className="field">Emergency contact phone<input className="input" value={values.emergency_contact_phone} onChange={(event) => setValues({ ...values, emergency_contact_phone: event.target.value })} /></label>
              <label className="field">Role
                <select className="input" value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value as Profile["role"] })}>
                  <option value="admin">Admin</option><option value="responder">Responder</option><option value="user">User</option>
                </select>
              </label>
              <div className="flex gap-2">
                <button className="btn btn-primary" type="submit" disabled={busy}><Save size={14} />Save changes</button>
                <button className="btn" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          ) : (
          <section className="section space-y-3">
            <p className="label">Contact</p>
            <ProfileField
              icon={<Phone size={15} />}
              label="Mobile"
              value={profile.phone}
              href={profile.phone ? `tel:${profile.phone}` : undefined}
            />
            <ProfileField
              icon={<Mail size={15} />}
              label="Email"
              value={profile.email}
              href={profile.email ? `mailto:${profile.email}` : undefined}
            />
            <ProfileField icon={<MapPin size={15} />} label="Home address" value={profile.home_address}             />
          </section>
          )}

          <section className="section space-y-3">
            <p className="label">Emergency contact</p>
            <ProfileField
              icon={<ShieldAlert size={15} />}
              label="Name"
              value={profile.emergency_contact_name}
            />
            <ProfileField
              icon={<Phone size={15} />}
              label="Phone"
              value={profile.emergency_contact_phone}
              href={
                profile.emergency_contact_phone
                  ? `tel:${profile.emergency_contact_phone}`
                  : undefined
              }
            />
          </section>

          {managed && (
            <section className="section space-y-3">
              {error && <p className="admin-status admin-status-error" role="alert">{error}</p>}
              <p className="label">Account controls</p>
              {onSave && <button className="btn w-full justify-center" type="button" disabled={busy} onClick={() => setEditing(true)}>Edit account details</button>}
              {onSuspend && <button className="btn w-full justify-center" type="button" disabled={busy} onClick={() => void onSuspend(!profile.is_suspended)}><Ban size={14} />{profile.is_suspended ? "Restore account" : "Suspend account"}</button>}
              {onResetPassword && <button className="btn w-full justify-center" type="button" disabled={busy} onClick={() => void onResetPassword()}><KeyRound size={14} />Generate new password</button>}
              {credentials && (
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
                  <p><b>{credentials.email}</b></p>
                  <p className="data break-all">{credentials.password}</p>
                  {credentialPdfUrl && <a className="btn mt-2 inline-flex" href={credentialPdfUrl} download={`basteon-user-credentials-${profile.id ?? "account"}.pdf`}><Download size={14} />Download credentials</a>}
                </div>
              )}
              {onDelete && (
                <form
                  className="space-y-2 border-t border-[var(--admin-line)] pt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onDelete(adminPassword).then((deleted) => { if (deleted) setAdminPassword(""); });
                  }}
                >
                  <label className="field text-[var(--crit)]">Delete account permanently
                    <input className="input" type="password" autoComplete="current-password" required placeholder="Admin control password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
                  </label>
                  <button className="btn btn-danger w-full justify-center" type="submit" disabled={busy || !adminPassword}><Trash2 size={14} />Delete account</button>
                </form>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function ProfileField({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  href?: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-[var(--muted)]">{icon}</span>
      <div className="min-w-0">
        <p className="label">{label}</p>
        {href && value ? (
          <a className="mt-0.5 block break-words text-[13px] text-[var(--text)] hover:underline" href={href}>
            {value}
          </a>
        ) : (
          <p className="mt-0.5 break-words text-[13px]">{value?.trim() || "Not provided"}</p>
        )}
      </div>
    </div>
  );
}