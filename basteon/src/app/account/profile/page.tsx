"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

const phoneValid = (value: string) =>
  !value || /^(?:\+27|0)[1-9]\d{8}$/.test(value.replace(/[\s-]/g, ""));

export default function ProfilePage() {
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [ringtoneBusy, setRingtoneBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("full_name,phone,home_address,emergency_contact_name,emergency_contact_phone,consented_at,ringtone_path")
        .eq("id", user.id)
        .single();
      setProfile(data ?? {});
    })();
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
    const { error: profileError } = uploadError ? { error: uploadError } : await supabase.from("profiles").update({ ringtone_path: path }).eq("id", user.id);
    setRingtoneBusy(false);
    if (profileError) return setMessage(profileError.message);
    setProfile((current) => ({ ...current, ringtone_path: path }));
    setMessage("Ringtone saved for your in-app safety call.");
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

          <label className="block">
            <span className="label">Safety call ringtone</span>
            <input className="mt-2 block w-full text-[12px]" type="file" accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav" disabled={ringtoneBusy} onChange={(event) => void uploadRingtone(event.target.files?.[0])} />
            <span className="muted mt-1 block text-[11px]">Optional MP3, M4A, OGG, or WAV file, up to 5 MB.</span>
          </label>

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