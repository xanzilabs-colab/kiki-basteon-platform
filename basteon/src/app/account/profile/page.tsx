"use client";

import { Check, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Ringtone } from "@/lib/types";

const phoneValid = (value: string) =>
  !value || /^(?:\+27|0)[1-9]\d{8}$/.test(value.replace(/[\s-]/g, ""));

export default function ProfilePage() {
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [ringtoneBusy, setRingtoneBusy] = useState(false);
  const [ringtones, setRingtones] = useState<Ringtone[]>([]);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("full_name,phone,home_address,emergency_contact_name,emergency_contact_phone,consented_at,ringtone_path,ringtone_id,avatar_path")
        .eq("id", user.id)
        .single();
      setProfile(data ?? {});
      if (data?.avatar_path) {
        const { data: signed } = await supabase.storage.from("kiki-profile-images").createSignedUrl(data.avatar_path, 3_600);
        setAvatarUrl(signed?.signedUrl ?? null);
      }
      const { data: ringtoneCatalog } = await supabase.from("ringtones").select("id,name,storage_path,is_stock").eq("is_stock", true).order("name");
      setRingtones(ringtoneCatalog ?? []);
    })();
    return () => previewAudio.current?.pause();
  }, []);

  const field = (name: keyof Profile) => ({
    value: (profile[name] as string | null | undefined) ?? "",
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setProfile((current) => ({ ...current, [name]: event.target.value })),
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (
      !profile.full_name?.trim() ||
      !phoneValid(profile.phone ?? "") ||
      !phoneValid(profile.emergency_contact_phone ?? "")
    ) {
      return setMessage("Enter your name and valid South African phone numbers.");
    }
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: profile.full_name.trim(),
        phone: profile.phone?.replace(/[\s-]/g, "") || null,
        home_address: profile.home_address?.trim() || null,
        emergency_contact_name: profile.emergency_contact_name?.trim() || null,
        emergency_contact_phone: profile.emergency_contact_phone?.replace(/[\s-]/g, "") || null,
      })
      .eq("id", user!.id);
    setSaving(false);
    setMessage(error ? error.message : "Profile saved.");
  }

  async function uploadRingtone(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("audio/") || file.size > 5 * 1024 * 1024) return setMessage("Choose an audio file smaller than 5 MB.");
    setRingtoneBusy(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRingtoneBusy(false); return; }
    const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "audio";
    const path = `${user.id}/ringtone.${extension}`;
    if (profile.ringtone_path) await supabase.storage.from("kiki-ringtones").remove([profile.ringtone_path]);
    const { error: uploadError } = await supabase.storage.from("kiki-ringtones").upload(path, file, { upsert: true, contentType: file.type });
    const { error: profileError } = uploadError ? { error: uploadError } : await supabase.from("profiles").update({ ringtone_path: path, ringtone_id: null }).eq("id", user.id);
    setRingtoneBusy(false);
    if (profileError) return setMessage(profileError.message);
    setProfile((current) => ({ ...current, ringtone_path: path, ringtone_id: null }));
    setMessage("Ringtone saved for your in-app safety call.");
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) return setMessage("Choose a JPG, PNG, or WebP image smaller than 2 MB.");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
    const path = `${user.id}/avatar.${extension}`;
    if (profile.avatar_path && profile.avatar_path !== path) await supabase.storage.from("kiki-profile-images").remove([profile.avatar_path]);
    const { error: uploadError } = await supabase.storage.from("kiki-profile-images").upload(path, file, { upsert: true, contentType: file.type });
    const { error } = uploadError ? { error: uploadError } : await supabase.from("profiles").update({ avatar_path: path }).eq("id", user.id);
    if (error) return setMessage(error.message);
    const { data: signed } = await supabase.storage.from("kiki-profile-images").createSignedUrl(path, 3_600);
    setProfile((current) => ({ ...current, avatar_path: path })); setAvatarUrl(signed?.signedUrl ?? null); setMessage("Profile image saved.");
  }

  function stopPreview() {
    previewAudio.current?.pause();
    previewAudio.current = null;
    setPreviewingId(null);
  }

  async function previewRingtone(ringtone: Ringtone) {
    if (previewingId === ringtone.id) return stopPreview();
    stopPreview();
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("kiki-ringtones").createSignedUrl(ringtone.storage_path, 60);
    if (error || !data?.signedUrl) return setMessage(error?.message ?? "Ringtone preview could not be loaded.");
    const audio = new Audio(data.signedUrl);
    previewAudio.current = audio;
    audio.addEventListener("ended", stopPreview, { once: true });
    try {
      await audio.play();
      setPreviewingId(ringtone.id);
    } catch {
      setMessage("Ringtone preview could not play in this browser.");
    }
  }

  async function selectRingtone(ringtone: Ringtone) {
    setRingtoneBusy(true);
    stopPreview();
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRingtoneBusy(false); return; }
    const { error } = await supabase.from("profiles").update({ ringtone_id: ringtone.id, ringtone_path: null }).eq("id", user.id);
    setRingtoneBusy(false);
    if (error) return setMessage(error.message);
    setProfile((current) => ({ ...current, ringtone_id: ringtone.id, ringtone_path: null }));
    setMessage(`${ringtone.name} selected for your in-app safety call.`);
  }

  return (
    <form className="max-w-[640px] space-y-5" onSubmit={save}>
      <div>
        <p className="eyebrow">Personal information</p>
        <h1 className="page-title mt-1">Your profile</h1>
      </div>

      <section className="panel">
        <div className="pane-head"><span>Profile</span></div>

        <div className="p-5 space-y-4">
          <label className="flex items-center gap-3 rounded-xl bg-[var(--surface-2)] p-3">
            {avatarUrl ? <img src={avatarUrl} alt="Your profile" className="h-14 w-14 rounded-full object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--accent)] font-bold text-white">K</span>}
            <span><b className="block">Profile image</b><span className="muted text-[12px]">Visible to authorised responders during an alert.</span><input className="mt-1 block text-[12px]" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadAvatar(event.target.files?.[0])} /></span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Link className="btn" href="/account/profile/medical">Medical ID &amp; Emergency Info</Link>
            <Link className="btn" href="/account/guardians">Guardian Circle</Link>
          </div>
          <label className="block">
            <span className="label">Full name</span>
            <input className="input mt-1.5" required {...field("full_name")} />
          </label>
          <label className="block">
            <span className="label">Mobile number</span>
            <input className="input mt-1.5" type="tel" required {...field("phone")} />
          </label>
          <label className="block">
            <span className="label">
              Home address <span className="normal-case text-[var(--muted-2)]">(optional)</span>
            </span>
            <textarea
              className="input mt-1.5"
              style={{ height: "auto", minHeight: 80, padding: "8px 9px" }}
              {...field("home_address")}
            />
          </label>
          <label className="block">
            <span className="label">Emergency contact name</span>
            <input className="input mt-1.5" {...field("emergency_contact_name")} />
          </label>
          <label className="block">
            <span className="label">Emergency contact phone</span>
            <input className="input mt-1.5" type="tel" {...field("emergency_contact_phone")} />
          </label>

          <p className="muted text-[11.5px]">
            Consent recorded{" "}
            {profile.consented_at
              ? new Date(profile.consented_at).toLocaleString()
              : "during account setup"}.
          </p>

          <div className="account-ringtone-settings">
            <span className="label">Safety call ringtone</span>
            <p className="account-ringtone-caption">Choose a Kiki tone or upload your own. Safety calls ring for up to 20 seconds.</p>
            <div className="account-ringtone-grid">
              {ringtones.map((ringtone) => {
                const selected = profile.ringtone_id === ringtone.id;
                const previewing = previewingId === ringtone.id;
                return <div className={`account-ringtone-option${selected ? " is-selected" : ""}`} key={ringtone.id}>
                  <span className="account-ringtone-name">{ringtone.name}</span>
                  <div className="account-ringtone-actions">
                    <button className="account-ringtone-icon" type="button" title={previewing ? `Stop ${ringtone.name} preview` : `Preview ${ringtone.name}`} onClick={() => void previewRingtone(ringtone)}>{previewing ? <Pause size={16} /> : <Play size={16} />}</button>
                    <button className="account-ringtone-select" type="button" disabled={ringtoneBusy || selected} onClick={() => void selectRingtone(ringtone)}>{selected ? <><Check size={15} /> Selected</> : "Select"}</button>
                  </div>
                </div>;
              })}
            </div>

            <input className="mt-2 block w-full text-[12px]" type="file" accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav" disabled={ringtoneBusy} onChange={(event) => void uploadRingtone(event.target.files?.[0])} />
            <span className="muted mt-1 block text-[11px]">Optional MP3, M4A, OGG, or WAV file, up to 5 MB.</span>
          </div>

          {message && (
            <p role="status" className="text-[12px] text-[var(--ok)]">{message}</p>
          )}

          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </section>
    </form>
  );
}