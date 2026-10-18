"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setHasRecoverySession(Boolean(data.session));
      setChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        setHasRecoverySession(true);
        setChecking(false);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Your password has been updated. You can now sign in with your new password.");
    setPassword("");
    setConfirmation("");
  }

  return <main className="auth-shell">
    <section className="auth-card auth-recovery">
      <header className="auth-brand">
        <span className="auth-recovery-icon"><ShieldCheck size={23} /></span>
        <div><b>KIKI CONNECT</b><span><ShieldCheck size={15} />Personal Safety Network</span></div>
      </header>
      <Link className="auth-recovery-back" href="/login"><ArrowLeft size={16} />Back to sign in</Link>
      <div className="auth-copy">
        <h1>Choose a new password</h1>
        <p>Set a new password to secure your Kiki account.</p>
      </div>
      {checking ? <p className="auth-feedback" role="status">Checking your reset link…</p> : message ? <p className="auth-feedback is-success" role="status">{message}</p> : !hasRecoverySession ? <div className="auth-recovery-invalid">
        <p className="auth-feedback is-error" role="alert">{error || "This password reset link is invalid or has expired. Request a new link to continue."}</p>
        <Link href="/login" className="auth-submit">Request another reset link</Link>
      </div> : <form className="auth-body" onSubmit={(event) => void savePassword(event)}>
        <label className="auth-field">
          <span>New password</span>
          <span className="auth-input-wrap"><KeyRound size={18} /><input type={showPassword ? "text" : "password"} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter a new password" /><button className="auth-password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        <label className="auth-field">
          <span>Confirm new password</span>
          <input type={showPassword ? "text" : "password"} autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Re-enter your password" />
        </label>
        {error && <p className="auth-feedback is-error" role="alert">{error}</p>}
        <button className="auth-submit" type="submit" disabled={saving}>{saving ? "Updating password…" : "Update password"}</button>
      </form>}
      {message && <Link className="auth-recovery-login" href="/login">Go to sign in</Link>}
    </section>
  </main>;
}
