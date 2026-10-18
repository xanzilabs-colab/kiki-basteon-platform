"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, KeyRound, LogIn, Mail, ShieldCheck, UserRoundPlus } from "lucide-react";
import { KikiMark } from "@/components/KikiMark";
import { createClient } from "@/lib/supabase/client";

type AuthMode = "signin" | "signup" | "forgot";

const phoneValid = (value: string) => /^(?:\+27|0)[1-9]\d{8}$/.test(value.replace(/[\s-]/g, ""));

export function AuthExperience({ initialMode }: { initialMode: "signin" | "signup" }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function syncModeFromLocation() {
      const pathMode = window.location.pathname === "/signup" ? "signup" : "signin";
      setMode(pathMode);
      setError("");
      setMessage("");
      setCheckingEmail(false);
    }
    window.addEventListener("popstate", syncModeFromLocation);
    return () => window.removeEventListener("popstate", syncModeFromLocation);
  }, []);

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError("");
    setMessage("");
    setCheckingEmail(false);
    window.history.pushState({}, "", next === "signup" ? "/signup" : "/login");
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const { error: signInError } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    await fetch("/api/verification/device/rotate", { method: "POST" });
    router.replace("/");
  }

  async function signUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phoneValid(phone)) {
      setError("Use a South African mobile number, for example +27 82 123 4567.");
      return;
    }
    if (!consent) {
      setError("Consent is required to create an account.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    const { data, error: signUpError } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), phone: phone.replace(/[\s-]/g, ""), consent: true } },
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (!data.session) {
      setCheckingEmail(true);
      return;
    }
    router.replace("/account");
  }

  async function sendPasswordReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setMessage("If an account exists for that email, a password reset link is on its way.");
  }

  const heading = mode === "signup"
    ? "Create your account"
    : mode === "forgot"
      ? "Reset your password"
      : "Safety, wherever you are.";

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label="Kiki account access">
        <header className="auth-brand">
          <KikiMark size={82} />
          <div>
            <b>KIKI CONNECT</b>
            <span><ShieldCheck size={15} />Personal Safety Network</span>
          </div>
        </header>

        <div className="auth-mode-switch" role="tablist" aria-label="Choose account action">
          <button type="button" role="tab" aria-selected={mode !== "signup"} className={mode !== "signup" ? "selected" : ""} onClick={() => switchMode("signin")}>
            <LogIn size={17} />Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "selected" : ""} onClick={() => switchMode("signup")}>
            <UserRoundPlus size={17} />Create account
          </button>
          <span className={`auth-mode-indicator${mode === "signup" ? " is-signup" : ""}`} aria-hidden="true" />
        </div>

        <div className="auth-copy" key={mode}>
          {mode === "signup" && <span className="auth-eyebrow">PERSONAL SAFETY</span>}
          <h1>{heading}</h1>
          <p>{mode === "signup"
            ? "Create your account and keep support close."
            : mode === "forgot"
              ? "Enter your email and we’ll send you a secure reset link."
              : "Your Kiki keeps support close when you need it."}</p>
        </div>

        {mode === "signin" && <form onSubmit={(event) => void signIn(event)} className="auth-body">
          <label className="auth-field">
            <span>Email</span>
            <span className="auth-input-wrap"><Mail size={18} /><input type="email" autoComplete="username" placeholder="Enter your email" required value={email} onChange={(event) => setEmail(event.target.value)} /></span>
          </label>
          <label className="auth-field">
            <span className="auth-label-row"><span>Password</span><button type="button" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Forgot password?</button></span>
            <span className="auth-input-wrap"><KeyRound size={18} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
          </label>
          {error && <p className="auth-feedback is-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={loading}>{loading ? "Signing in…" : <>Sign in<ArrowRight size={18} /></>}</button>
          <p className="auth-switch-copy">New to Kiki? <button type="button" onClick={() => switchMode("signup")}>Create an account</button></p>
        </form>}

        {mode === "signup" && <form onSubmit={(event) => void signUp(event)} className="auth-body">
          {checkingEmail ? <div className="auth-success" role="status"><Mail size={21} /><p>Check your email to confirm your account, then sign in.</p><button type="button" onClick={() => switchMode("signin")}>Back to sign in</button></div> : <>
            <label className="auth-field">
              <span>Full name</span>
              <input type="text" autoComplete="name" placeholder="Enter your full name" required value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label className="auth-field">
              <span>Mobile number</span>
              <input type="tel" autoComplete="tel" placeholder="+27 82 123 4567" required value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <label className="auth-field">
              <span>Email</span>
              <input type="email" autoComplete="email" placeholder="Enter your email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <span className="auth-input-wrap"><KeyRound size={18} /><input type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Enter a password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
            </label>
            <label className="auth-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>I consent to Kiki Connect storing my profile and contact information for device ownership and emergency response.</span></label>
            {error && <p className="auth-feedback is-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={loading}>{loading ? "Creating account…" : <>Create account<ArrowRight size={18} /></>}</button>
            <p className="auth-switch-copy">Already registered? <button type="button" onClick={() => switchMode("signin")}>Sign in</button></p>
          </>}
        </form>}

        {mode === "forgot" && <form onSubmit={(event) => void sendPasswordReset(event)} className="auth-body">
          <label className="auth-field">
            <span>Email</span>
            <span className="auth-input-wrap"><Mail size={18} /><input type="email" autoComplete="email" placeholder="Enter your account email" required value={email} onChange={(event) => setEmail(event.target.value)} /></span>
          </label>
          {error && <p className="auth-feedback is-error" role="alert">{error}</p>}
          {message && <p className="auth-feedback is-success" role="status">{message}</p>}
          <button className="auth-submit" type="submit" disabled={loading}>{loading ? "Sending link…" : <>Send reset link<ArrowRight size={18} /></>}</button>
          <p className="auth-switch-copy"><button type="button" onClick={() => switchMode("signin")}>Back to sign in</button></p>
        </form>}
      </section>
    </main>
  );
}
