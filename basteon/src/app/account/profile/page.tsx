"use client";

import { Bluetooth, Building2, ChevronRight, FileText, Lock, Moon, Route, Shield, Sun, Users, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LocationPrivacyCard } from "@/components/LocationPrivacyCard";
import { CachedProfileImage } from "@/components/CachedProfileImage";
import { AccountListCard, AccountListRow, AccountSectionLabel } from "@/components/account/AccountList";

type AccountProfile = { full_name: string | null; avatar_path: string | null; dark_theme: boolean | null };

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { const supabase = createClient(); void (async () => { const { data: { user } } = await supabase.auth.getUser(); if (!user) { router.replace("/login"); return; } setEmail(user.email ?? ""); const { data, error: profileError } = await supabase.from("profiles").select("full_name,avatar_path,dark_theme").eq("id", user.id).single(); if (profileError) { setError("Your profile settings could not be loaded. Please refresh and try again."); return; } setProfile(data); const response = await fetch("/api/account/profile/avatar"); if (!response.ok) { setError("Your profile image could not be loaded."); return; } const avatar = await response.json() as { url?: string | null }; setAvatarUrl(avatar.url ?? null); })().catch(() => setError("Your profile could not be loaded. Please refresh and try again.")); }, [router]);
  useEffect(() => { const updateAvatar = (event: Event) => setAvatarUrl((event as CustomEvent<string | null>).detail); window.addEventListener("kiki-profile-avatar-updated", updateAvatar); return () => window.removeEventListener("kiki-profile-avatar-updated", updateAvatar); }, []);
  async function toggleTheme() {
    if (!profile || themeSaving) return;
    const next = !profile.dark_theme;
    setThemeSaving(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Your session has expired. Sign in again to change this setting.");
      const { error: updateError } = await supabase.from("profiles").update({ dark_theme: next }).eq("id", user.id);
      if (updateError) throw updateError;
      setProfile((current) => current ? { ...current, dark_theme: next } : current);
      window.dispatchEvent(new CustomEvent("kiki-account-theme-change", { detail: next }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The theme setting could not be saved. Please try again.");
    } finally {
      setThemeSaving(false);
    }
  }
  async function signOut() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
  const name = profile?.full_name || "Your Kiki profile";
  return <div className="kiki-profile-hub">
    <header><span>MY ACCOUNT</span><h1>User Profile</h1></header>
    {error && <p className="kiki-profile-error" role="alert">{error}</p>}
    <div className="kiki-profile-card">
      <AccountListCard className="kiki-profile-identity-card">
        <Link className="kiki-profile-identity" href="/account/profile/info">
          <CachedProfileImage src={avatarUrl} alt="Your profile" fallback={<span>{name.charAt(0).toUpperCase()}</span>} />
          <div className="kiki-profile-identity-copy">
            <h2>{name}</h2>
            <p>{email}</p>
            <div className="kiki-profile-open-cue">View profile details <ChevronRight size={14} aria-hidden="true" /></div>
            <b>Premium Safety Subscriber</b>
          </div>
          <ChevronRight className="kiki-profile-card-arrow" size={18} aria-hidden="true" />
        </Link>
      </AccountListCard>
      <AccountSectionLabel>Account</AccountSectionLabel>
      <nav className="kiki-profile-menu account-list-card" aria-label="Account settings">
        <AccountListRow href="/account/profile/medical" icon={<FileText size={18} />} title="Medical ID & Emergency Info" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/organisations" icon={<Building2 size={18} />} title="My Organisations" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/profile/security" icon={<Lock size={18} />} title="Security &amp; PIN Code" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/profile/ringtones" icon={<Volume2 size={18} />} title="Ringtones" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/profile/triggers" icon={<Bluetooth size={18} />} title="Bluetooth Triggers" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/profile/buddies" icon={<Users size={18} />} title="My Buddies" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/guardian-walks" icon={<Route size={18} />} title="Shared Walks" trailing={<ChevronRight size={18} />} />
        <button type="button" className="kiki-profile-theme-toggle" role="switch" aria-checked={profile?.dark_theme ?? false} disabled={!profile || themeSaving} onClick={() => void toggleTheme()}>
          <span className="kiki-profile-theme-copy"><i>{profile?.dark_theme ? <Sun size={17} /> : <Moon size={17} />}</i><span><strong>Dark mode</strong><small>Use a softer look in low light</small></span></span>
          <span className="kiki-profile-switch" aria-hidden="true"><i /></span>
        </button>
        <AccountListRow href="/account/guardians" icon={<Shield size={18} />} title="Guardian Circle" trailing={<ChevronRight size={18} />} />
      </nav>
      <LocationPrivacyCard />
      <button type="button" className="kiki-profile-logout" onClick={() => void signOut()}>Log Out Account</button>
    </div>
  </div>;
}
