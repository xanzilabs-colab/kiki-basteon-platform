"use client";

import { Mail, MapPin, Phone, ShieldAlert, UserRound, X } from "lucide-react";
import type { ProfileContact } from "@/lib/types";

export function UserProfileDrawer({
  profile,
  onClose,
}: {
  profile: ProfileContact | null;
  onClose(): void;
}) {
  if (!profile) return null;

  return (
    <div
      className="fixed inset-0 z-[1300]"
      role="dialog"
      aria-modal="true"
      aria-label="User profile"
    >
      <button
        className="drawer-scrim absolute inset-0"
        aria-label="Close user profile"
        onClick={onClose}
      />
      <aside className="drawer-panel absolute inset-y-0 right-0 flex w-full max-w-md flex-col">
        <div className="pane-head" style={{ height: 48 }}>
          <span>User profile</span>
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

        <div className="overflow-y-auto">
          <section className="section">
            <div className="flex items-center gap-3">
              <span className="inline-grid h-9 w-9 overflow-hidden place-items-center rounded-[4px] bg-[var(--surface-3)] text-[var(--text)]">
                {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <UserRound size={18} />}
              </span>
              <div>
                <h2 className="text-[15px] font-semibold">
                  {profile.full_name?.trim() || "Unnamed user"}
                </h2>
                <p className="muted text-[12px]">Emergency profile</p>
              </div>
            </div>
          </section>

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
            <ProfileField icon={<MapPin size={15} />} label="Home address" value={profile.home_address} />
          </section>

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
        </div>
      </aside>
    </div>
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