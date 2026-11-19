"use client";

import { Bluetooth, BookOpen, Building2, CheckCircle2, ChevronRight, CircleHelp, CreditCard, FileText, Flower2, Gamepad2, Lock, LogOut, Mail, MapPinned, Moon, PhoneCall, Shield, Sun, Users, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LocationPrivacyCard } from "@/components/LocationPrivacyCard";
import { CachedProfileImage } from "@/components/CachedProfileImage";
import { AccountListCard, AccountListRow, AccountSectionLabel, AccountToggleRow } from "@/components/account/AccountList";

type AccountProfile = { full_name: string | null; avatar_path: string | null; dark_theme: boolean | null };

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const [medicalCompletion, setMedicalCompletion] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { const supabase = createClient(); void (async () => { const { data: { user } } = await supabase.auth.getUser(); if (!user) { router.replace("/login"); return; } setEmail(user.email ?? ""); const { data, error: profileError } = await supabase.from("profiles").select("full_name,avatar_path,dark_theme").eq("id", user.id).single(); if (profileError) { setError("Your profile settings could not be loaded. Please refresh and try again."); return; } setProfile(data); const response = await fetch("/api/account/profile/avatar"); if (!response.ok) { setError("Your profile image could not be loaded."); return; } const avatar = await response.json() as { url?: string | null }; setAvatarUrl(avatar.url ?? null); const medicalResponse = await fetch("/api/account/profile/medical", { cache: "no-store" }); if (!medicalResponse.ok) { setError("Medical ID completion could not be loaded."); return; } const result = await medicalResponse.json() as { medical?: { blood_type?: string | null; allergies?: string | null; conditions?: string | null; medications?: string | null; notes?: string | null } }; const medical = result.medical; const fields = [medical?.blood_type, medical?.allergies, medical?.conditions, medical?.medications, medical?.notes]; setMedicalCompletion(Math.round(fields.filter((value) => Boolean(value?.trim())).length / fields.length * 100)); })().catch(() => setError("Your profile could not be loaded. Please refresh and try again.")); }, [router]);
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
  const profileReady = Boolean(profile?.full_name?.trim());
  const medicalStarted = medicalCompletion !== null && medicalCompletion > 0;
  return <div className="kiki-profile-hub">
    {error && <p className="kiki-profile-error" role="alert">{error}</p>}
    <AccountListCard className="kiki-profile-identity-card">
      <Link className="kiki-profile-identity" href="/account/profile/info">
        <CachedProfileImage src={avatarUrl} alt="Your profile" fallback={<span>{name.charAt(0).toUpperCase()}</span>} />
        <div className="kiki-profile-identity-copy">
          <h2>{name}</h2>
          <p>{email}</p>
          <b>Premium Safety Subscriber</b>
        </div>
        <ChevronRight className="kiki-profile-card-arrow" size={18} aria-hidden="true" />
      </Link>
    </AccountListCard>

    {profile && medicalCompletion !== null && !(profileReady && medicalStarted) && (
      <section className="kiki-profile-section">
        <AccountSectionLabel>Get started</AccountSectionLabel>
        <AccountListCard className="kiki-profile-setup" aria-label="Profile setup">
          <div className="kiki-profile-setup-intro">
            <h2>Make your profile responder-ready</h2>
            <p>Add the details you want your trusted network and responders to have.</p>
          </div>
          <AccountListRow
            href="/account/profile/info"
            icon={<Users size={20} />}
            title="Profile details"
            subtitle={profileReady ? "Name added" : "Add your name and photo"}
            trailing={profileReady ? <CheckCircle2 size={18} /> : <ChevronRight size={18} />}
          />
          <AccountListRow
            href="/account/profile/medical"
            icon={<FileText size={20} />}
            title="Medical ID"
            subtitle={medicalStarted ? `${medicalCompletion}% of fields filled` : "Add any helpful medical details"}
            trailing={medicalStarted ? <CheckCircle2 size={18} /> : <ChevronRight size={18} />}
          />
        </AccountListCard>
      </section>
    )}

    <section className="kiki-profile-section">
      <AccountSectionLabel>Account</AccountSectionLabel>
      <AccountListCard aria-label="Account">
        <AccountListRow href="/account/profile/medical" icon={<FileText size={20} />} title="Medical ID" subtitle={medicalCompletion === null ? "Completion unavailable" : `${medicalCompletion}% complete`} trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/organisations" icon={<Building2 size={20} />} title="Organisations" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/profile/security" icon={<Lock size={20} />} title="Security and PIN" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/guardians" icon={<Shield size={20} />} title="Guardian Circle" trailing={<ChevronRight size={18} />} />
      </AccountListCard>
    </section>

    <section className="kiki-profile-section">
      <AccountSectionLabel>Safety tools</AccountSectionLabel>
      <AccountListCard aria-label="Safety tools">
        <AccountListRow href="/w" icon={<BookOpen size={20} />} title="Journal" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/guardians" icon={<Shield size={20} />} title="Guardians" trailing={<ChevronRight size={18} />} />
        <AccountListRow onClick={() => window.dispatchEvent(new Event("kiki:start-safety-call"))} icon={<PhoneCall size={20} />} title="Safety call" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/buddies/safe-places" icon={<MapPinned size={20} />} title="Safe spots and reports" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/profile/triggers" icon={<Bluetooth size={20} />} title="Bluetooth triggers" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/profile/buddies" icon={<Users size={20} />} title="My Buddies" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/profile/ringtones" icon={<Volume2 size={20} />} title="Ringtones" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/games" icon={<Gamepad2 size={20} />} title="Stoep" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/calm" icon={<Flower2 size={20} />} title="Calm" trailing={<ChevronRight size={18} />} />
      </AccountListCard>
    </section>

    <section className="kiki-profile-section">
      <AccountSectionLabel>Preferences</AccountSectionLabel>
      <AccountListCard aria-label="Preferences">
        <AccountToggleRow icon={profile?.dark_theme ? <Sun size={20} /> : <Moon size={20} />} title="Dark mode" subtitle="Use a softer look in low light." checked={profile?.dark_theme ?? false} disabled={!profile || themeSaving} onChange={() => void toggleTheme()} />
        <LocationPrivacyCard />
      </AccountListCard>
    </section>

    <section className="kiki-profile-section">
      <AccountSectionLabel>Help &amp; support</AccountSectionLabel>
      <AccountListCard aria-label="Help and support">
        <AccountListRow href="/account/help" icon={<CircleHelp size={20} />} title="FAQs" subtitle="Answers to common questions" trailing={<ChevronRight size={18} />} />
        <AccountListRow href="/account/terms" icon={<FileText size={20} />} title="Terms of Service" trailing={<ChevronRight size={18} />} />
        <a className="account-list-row" href="mailto:xanzitech@gmail.com">
          <span className="account-icon-badge" aria-hidden="true"><Mail size={20} /></span>
          <span className="account-list-row-copy"><strong>Contact support</strong><small>Email xanzitech@gmail.com</small></span>
          <span className="account-list-row-trailing"><ChevronRight size={18} aria-hidden="true" /></span>
        </a>
      </AccountListCard>
    </section>

    <section className="kiki-profile-section">
      <AccountSectionLabel>Plans &amp; cover</AccountSectionLabel>
      <AccountListCard aria-label="Plans and cover">
        <AccountListRow href="/account/plans" icon={<CreditCard size={20} />} title="My plans &amp; cover" subtitle="View Kiki plan options" trailing={<ChevronRight size={18} />} />
      </AccountListCard>
    </section>

    <AccountListCard className="kiki-profile-logout-card">
      <button type="button" className="kiki-profile-logout" onClick={() => void signOut()}><LogOut size={18} aria-hidden="true" /><span>Log out</span></button>
    </AccountListCard>
    <p className="kiki-profile-version">Kiki app · v1.10</p>
  </div>;
}
