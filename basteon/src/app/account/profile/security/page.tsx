"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

export default function SecurityPage() {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinSet, setPinSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/account/security/pin", { cache: "no-store" });
        const result = await response.json() as { configured?: boolean; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Your security settings could not be loaded.");
        if (typeof result.configured !== "boolean") throw new Error("Your security settings could not be loaded.");
        if (active) setPinSet(result.configured);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Your security settings could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function savePin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{4,6}$/.test(newPin)) {
      setError("Choose a new PIN with 4 to 6 digits.");
      return;
    }
    if (pinSet && !/^\d{4,6}$/.test(currentPin)) {
      setError("Enter your current 4 to 6 digit PIN.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/security/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: newPin, currentPin: pinSet ? currentPin : undefined }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Your PIN could not be saved.");
      setCurrentPin("");
      setNewPin("");
      setPinSet(true);
      setMessage("Your Kiki PIN is set and will be requested for sensitive account changes.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your PIN could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kiki-setting-page">
      <header>
        <span>MY ACCOUNT</span>
        <h1>Security &amp; PIN Code</h1>
        <p>Protect sensitive changes with a private Kiki PIN.</p>
      </header>
      {error && <p className="kiki-profile-error" role="alert">{error}</p>}
      <form className="kiki-security-pin-form" onSubmit={(event) => void savePin(event)}>
        <div className="kiki-security-icon"><LockKeyhole size={24} /></div>
        <h2>{loading ? "Checking your PIN…" : pinSet ? "Update your Kiki PIN" : "Set your Kiki PIN"}</h2>
        <p>Your PIN is checked before changes to your personal details or medical information, and before deleting your data or account.</p>
        {pinSet && (
          <label>
            Current PIN
            <input className="input" value={currentPin} inputMode="numeric" autoComplete="current-password" maxLength={6} type="password" onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, ""))} disabled={saving || loading} />
          </label>
        )}
        <label>
          {pinSet ? "New PIN" : "4 to 6 digit PIN"}
          <input className="input" value={newPin} inputMode="numeric" autoComplete="new-password" maxLength={6} type="password" onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ""))} disabled={saving || loading} />
        </label>
        {message && <p role="status">{message}</p>}
        <button className="btn btn-primary" type="submit" disabled={saving || loading}>
          <ShieldCheck size={16} />{saving ? "Saving…" : pinSet ? "Update PIN" : "Save PIN"}
        </button>
      </form>
    </div>
  );
}
