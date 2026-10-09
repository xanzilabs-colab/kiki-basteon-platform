"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const SIGNUP_STORAGE_KEY = "basteon:organisation-signup";

type OrganisationSignupDraft = {
  organisationName: string;
  email: string;
  fullName: string;
  createdAt: number;
  [key: string]: unknown;
};

function isSignupDraft(value: unknown): value is OrganisationSignupDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.organisationName === "string"
    && typeof draft.email === "string"
    && typeof draft.fullName === "string"
    && typeof draft.createdAt === "number";
}

export function OrganisationSignupVerify() {
  const router = useRouter();
  const [draft, setDraft] = useState<OrganisationSignupDraft | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function loadSignup() {
      const client = createClient();
      const { data, error: authError } = await client.auth.getUser();
      if (!active) return;
      if (authError || !data.user) {
        setError(authError?.message ?? "Open the verification link in the browser where you started registration.");
        setLoading(false);
        return;
      }
      if (!data.user.email_confirmed_at) {
        setError("Your email has not been verified yet. Open the latest verification link from your inbox.");
        setLoading(false);
        return;
      }

      const rawDraft = localStorage.getItem(SIGNUP_STORAGE_KEY);
      if (!rawDraft) {
        setError("Registration details were not found in this browser. Return to organisation registration and try again.");
        setLoading(false);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawDraft);
      } catch {
        setError("Saved registration details could not be read. Please restart registration.");
        setLoading(false);
        return;
      }
      if (!isSignupDraft(parsed)) {
        setError("Saved registration details are incomplete. Please restart registration.");
        setLoading(false);
        return;
      }
      if (!Number.isFinite(parsed.createdAt) || Date.now() - parsed.createdAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(SIGNUP_STORAGE_KEY);
        setError("The saved registration has expired. Please restart registration.");
        setLoading(false);
        return;
      }
      if (parsed.email.trim().toLowerCase() !== data.user.email?.trim().toLowerCase()) {
        setError("The verified email does not match the administrator email in this registration.");
        setLoading(false);
        return;
      }
      setDraft(parsed);
      setLoading(false);
    }
    void loadSignup();
    return () => { active = false; };
  }, []);

  async function createOrganisation(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError("Use at least 8 characters with uppercase and lowercase letters, a number, and a symbol.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(false);
      setError(typeof body.error === "string" ? body.error : "Could not create the organisation. Please try again.");
      return;
    }
    localStorage.removeItem(SIGNUP_STORAGE_KEY);
    router.replace("/organisation");
    router.refresh();
  }

  return (
    <main className="ops-login">
      <form className="ops-login-card" onSubmit={createOrganisation}>
        <div className="ops-login-brand">
          <span className="mark">B</span>
          <div>
            <span>BASTEON</span>
            <strong>Organisation Console</strong>
          </div>
        </div>
        <div className="ops-login-copy">
          <h1>Finish organisation registration</h1>
          <p>Your email is verified. Set a password to create the organisation administrator account.</p>
        </div>
        {loading ? (
          <p role="status">Verifying your account…</p>
        ) : draft ? (
          <>
            <p className="ops-signup-note">Creating <b>{draft.organisationName}</b> with <b>{draft.email}</b>.</p>
            <label className="ops-login-label">
              Password
              <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label className="ops-login-label">
              Confirm password
              <input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
          </>
        ) : null}
        {error && <p className="ops-login-error" role="alert">{error}</p>}
        {draft && (
          <button className="ops-login-submit" type="submit" disabled={busy}>
            {busy ? "Creating organisation..." : "Set password and create organisation"}
          </button>
        )}
      </form>
    </main>
  );
}
