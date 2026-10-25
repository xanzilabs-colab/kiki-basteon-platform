"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2, UserRoundX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CachedProfileImage } from "@/components/CachedProfileImage";
import { useAppDialog } from "@/components/AppDialogProvider";
import { requestAccountPin } from "@/lib/account/pinPrompt";

type Details = { full_name: string; phone: string; home_address: string; emergency_contact_name: string; emergency_contact_phone: string };
const empty: Details = { full_name: "", phone: "", home_address: "", emergency_contact_name: "", emergency_contact_phone: "" };

export default function ProfileInfoPage() {
  const router = useRouter();
  const { confirm, prompt } = useAppDialog();
  const [details, setDetails] = useState<Details>(empty); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [deleting, setDeleting] = useState<"data" | "account" | null>(null); const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => { const db = createClient(); void (async () => { const { data: { user } } = await db.auth.getUser(); if (!user) return; const { data } = await db.from("profiles").select("full_name,phone,home_address,emergency_contact_name,emergency_contact_phone").eq("id", user.id).single(); setDetails({ ...empty, ...data }); const response = await fetch("/api/account/profile/avatar"); const avatar = response.ok ? await response.json() as { url?: string | null } : null; setAvatarUrl(avatar?.url ?? null); })(); }, []);
  function field(key: keyof Details) { return { value: details[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDetails((current) => ({ ...current, [key]: event.target.value })) }; }
  async function save(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(""); setMessage(""); try { const pin = await requestAccountPin(prompt, "save your personal details"); if (pin === null) return; const response = await fetch("/api/account/profile/details", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...details, pin }) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "Profile details could not be saved."); setMessage("Profile details saved."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Profile details could not be saved."); } finally { setSaving(false); } }
  async function uploadAvatar(file: File | undefined) { if (!file) return; if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { setError("Choose a JPG, PNG, or WebP image smaller than 2 MB."); return; } setError(""); try { const pin = await requestAccountPin(prompt, "change your profile image"); if (pin === null) return; const form = new FormData(); form.append("file", file); if (pin !== undefined) form.append("pin", pin); const response = await fetch("/api/account/profile/avatar", { method: "POST", body: form }); const result = await response.json().catch(() => ({})) as { url?: string | null; error?: string }; if (!response.ok || !result.url) throw new Error(result.error ?? "Profile image could not be saved. Please try again."); setAvatarUrl(result.url); window.dispatchEvent(new CustomEvent<string>("kiki-profile-avatar-updated", { detail: result.url })); setMessage("Profile image saved."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Profile image could not be saved."); } }
  async function deletePersonalData() {
    if (!(await confirm("This permanently deletes your profile details, linked-device alert and location history, saved activity, preferences, and uploaded personal files. Your devices will be unlinked, but your sign-in account remains active.", { title: "Delete your data?", confirmLabel: "Delete my data", danger: true }))) return;
    setDeleting("data"); setError(""); setMessage("");
    try {
      const pin = await requestAccountPin(prompt, "delete your personal data");
      if (pin === null) return;
      const response = await fetch("/api/account/my-data", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Your data could not be deleted. Please try again.");
      setDetails(empty); setAvatarUrl(null);
      localStorage.removeItem("hamba-active-route");
      localStorage.removeItem("kiki-journal-lock-type");
      localStorage.removeItem("kiki-journal-calm");
      window.dispatchEvent(new CustomEvent("kiki-profile-avatar-updated", { detail: null }));
      window.dispatchEvent(new CustomEvent("kiki-account-theme-change", { detail: false }));
      setMessage("Your personal data has been deleted. Your sign-in account is still active.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your data could not be deleted. Please try again."); }
    finally { setDeleting(null); }
  }
  async function deleteAccount() {
    if (!(await confirm("This permanently deletes your Kiki account and its associated data. You will be signed out, and this cannot be undone.", { title: "Delete your account?", confirmLabel: "Continue", danger: true }))) return;
    const typed = await prompt("To confirm permanent account deletion, type DELETE below.", "", { title: "Final confirmation", inputLabel: "Type DELETE to continue", placeholder: "DELETE", submitLabel: "Delete account" });
    if (typed !== "DELETE") return;
    setDeleting("account"); setError(""); setMessage("");
    try {
      const pin = await requestAccountPin(prompt, "delete your account");
      if (pin === null) return;
      const response = await fetch("/api/account/delete", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Your account could not be deleted. Please try again.");
      const { error: signOutError } = await createClient().auth.signOut({ scope: "local" });
      if (signOutError) throw new Error("Your account was deleted, but this device could not clear its saved sign-in. Please sign out manually.");
      router.replace("/login"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your account could not be deleted. Please try again."); }
    finally { setDeleting(null); }
  }
  const busy = saving || deleting !== null;
  return <form className="kiki-setting-page kiki-profile-details-page" onSubmit={save}>
    <header><span>MY ACCOUNT</span><h1>Personal details</h1><p>Keep your identity and emergency contact information current.</p></header>
    {error && <p className="kiki-profile-error" role="alert">{error}</p>}
    <section>
      <label className="kiki-avatar-upload"><CachedProfileImage src={avatarUrl} alt="Your profile" fallback={<span>{details.full_name.trim().charAt(0).toUpperCase() || "K"}</span>} /><b>Profile image<small>JPG, PNG, or WebP · up to 2 MB</small></b><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void uploadAvatar(event.target.files?.[0])} /></label>
      <label>Full name<input className="input" required {...field("full_name")} disabled={busy} /></label><label>Mobile number<input className="input" type="tel" {...field("phone")} disabled={busy} /></label><label>Home address<textarea className="input" {...field("home_address")} disabled={busy} /></label><label>Emergency contact name<input className="input" {...field("emergency_contact_name")} disabled={busy} /></label><label>Emergency contact phone<input className="input" type="tel" {...field("emergency_contact_phone")} disabled={busy} /></label>
      {message && <p role="status">{message}</p>}
      <button className="btn btn-primary" disabled={busy}>{saving ? "Saving…" : "Save details"}</button>
    </section>
    <section className="kiki-data-controls">
      <div><h2><AlertTriangle size={18} />Privacy controls</h2><p>Choose whether to erase your personal information or permanently close your account.</p></div>
      <button className="kiki-delete-data" type="button" disabled={busy} onClick={() => void deletePersonalData()}><Trash2 size={17} />{deleting === "data" ? "Deleting your data…" : "Delete my data"}</button>
      <button className="kiki-delete-account" type="button" disabled={busy} onClick={() => void deleteAccount()}><UserRoundX size={17} />{deleting === "account" ? "Deleting account…" : "Delete account"}</button>
    </section>
  </form>;
}
