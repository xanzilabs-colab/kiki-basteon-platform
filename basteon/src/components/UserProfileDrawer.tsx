"use client";

import { Mail, MapPin, Phone, ShieldAlert, UserRound, X } from "lucide-react";
import type { ProfileContact } from "@/lib/types";

export function UserProfileDrawer({ profile, onClose }: { profile: ProfileContact | null; onClose(): void }) {
  if (!profile) return null;

  return (
    <div className="fixed inset-0 z-[1300]" role="dialog" aria-modal="true" aria-label="User profile">
      <button className="absolute inset-0 bg-black/60" aria-label="Close user profile" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--line-strong)] bg-[var(--surface)] shadow-2xl animate-[slide-in_.18s_ease-out]">
        <div className="pane-head h-12">
          <span>User profile</span>
          <button className="btn !px-2" title="Close user profile" aria-label="Close user profile" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="overflow-y-auto">
          <section className="section">
            <div className="flex items-center gap-3">
              <UserRound size={20} className="text-[var(--accent)]" />
              <div><h2 className="text-base font-semibold">{profile.full_name?.trim() || "Unnamed user"}</h2><p className="muted text-xs">Emergency profile</p></div>
            </div>
          </section>
          <section className="section space-y-3">
            <p className="label">Contact</p>
            <ProfileField icon={<Phone size={15} />} label="Mobile" value={profile.phone} href={profile.phone ? `tel:${profile.phone}` : undefined} />
            <ProfileField icon={<Mail size={15} />} label="Email" value={profile.email} href={profile.email ? `mailto:${profile.email}` : undefined} />
            <ProfileField icon={<MapPin size={15} />} label="Home address" value={profile.home_address} />
          </section>
          <section className="section space-y-3">
            <p className="label">Emergency contact</p>
            <ProfileField icon={<ShieldAlert size={15} />} label="Name" value={profile.emergency_contact_name} />
            <ProfileField icon={<Phone size={15} />} label="Phone" value={profile.emergency_contact_phone} href={profile.emergency_contact_phone ? `tel:${profile.emergency_contact_phone}` : undefined} />
          </section>
        </div>
      </aside>
    </div>
  );
}

function ProfileField({ icon, label, value, href }: { icon: React.ReactNode; label: string; value?: string | null; href?: string }) {
  return <div className="flex gap-3"><span className="mt-0.5 text-[var(--muted)]">{icon}</span><div className="min-w-0"><p className="label">{label}</p>{href && value ? <a className="mt-0.5 block break-words text-sm text-[var(--accent)]" href={href}>{value}</a> : <p className="mt-0.5 break-words text-sm">{value?.trim() || "Not provided"}</p>}</div></div>;
}