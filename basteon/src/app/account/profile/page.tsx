"use client";

import { ChevronRight, FileText, Lock, Moon, Shield, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type AccountProfile = { full_name: string | null; avatar_path: string | null; dark_theme: boolean | null };

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => { const supabase = createClient(); void (async () => { const { data: { user } } = await supabase.auth.getUser(); if (!user) return; setEmail(user.email ?? ""); const { data } = await supabase.from("profiles").select("full_name,avatar_path,dark_theme").eq("id", user.id).single(); setProfile(data); if (data?.avatar_path) { const { data: signed } = await supabase.storage.from("kiki-profile-images").createSignedUrl(data.avatar_path, 3600); setAvatarUrl(signed?.signedUrl ?? null); } })(); }, []);
  async function toggleTheme() { const next = !profile?.dark_theme; const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return; await supabase.from("profiles").update({ dark_theme: next }).eq("id", user.id); setProfile((current) => current ? { ...current, dark_theme: next } : current); document.documentElement.classList.toggle("dark", next); }
  async function signOut() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
  const name = profile?.full_name || "Your Kiki profile";
  return <div className="kiki-profile-hub">
    <header><span>MY ACCOUNT</span><h1>User Profile</h1></header>
    <section className="kiki-profile-card">
      <Link className="kiki-profile-identity" href="/account/profile/info">{avatarUrl ? <img src={avatarUrl} alt="Your profile" /> : <span>{name.charAt(0).toUpperCase()}</span>}<div><h2>{name}</h2><p>{email}</p><b>Premium Safety Subscriber</b></div><ChevronRight size={18} /></Link>
      <nav className="kiki-profile-menu" aria-label="Account settings">
        <Link href="/account/profile/medical"><span><FileText size={17} />Medical ID &amp; Emergency Info</span><ChevronRight size={17} /></Link>
        <Link href="/account/profile/security"><span><Lock size={17} />Security &amp; PIN Code</span><ChevronRight size={17} /></Link>
        <Link href="/account/profile/ringtones"><span><Volume2 size={17} />Ringtones</span><ChevronRight size={17} /></Link>
        <button type="button" onClick={() => void toggleTheme()}><span><Moon size={17} />Dark Theme Mode</span><b>{profile?.dark_theme ? "On" : "Off"}</b></button>
        <Link href="/account/guardians"><span><Shield size={17} />Guardian Circle</span><ChevronRight size={17} /></Link>
      </nav>
      <button type="button" className="kiki-profile-logout" onClick={() => void signOut()}>Log Out Account</button>
    </section>
  </div>;
}
