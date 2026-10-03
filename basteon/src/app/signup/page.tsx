"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const phoneValid = (value: string) => /^(?:\+27|0)[1-9]\d{8}$/.test(value.replace(/[\s-]/g, ""));

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false); const [error, setError] = useState(""); const [checkingEmail, setCheckingEmail] = useState(false); const [loading, setLoading] = useState(false);
  async function signup(event: React.FormEvent) {
    event.preventDefault();
    if (!phoneValid(phone)) return setError("Use a South African mobile number, for example +27 82 123 4567.");
    if (!consent) return setError("Consent is required to create an account.");
    setLoading(true); setError("");
    const { data, error: signupError } = await createClient().auth.signUp({ email, password, options: { data: { full_name: fullName.trim(), phone: phone.replace(/[\s-]/g, ""), consent: true } } });
    setLoading(false);
    if (signupError) return setError(signupError.message);
    if (!data.session) return setCheckingEmail(true);
    router.replace("/account");
  }
  return (
    <main className="auth-shell">
      <form onSubmit={signup} className="auth-card">
        <div className="auth-head">
          <p className="eyebrow">Personal safety</p>
          <h1 className="page-title mt-2">Create your account</h1>
        </div>
        <div className="auth-body space-y-4">
          {checkingEmail ? (
            <p className="text-sm text-[var(--ok)]">
              Check your email to confirm your account, then sign in.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="label">Full name</span>
                <input
                  className="input mt-1.5"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">Mobile number</span>
                <input
                  className="input mt-1.5"
                  type="tel"
                  autoComplete="tel"
                  required
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">Email</span>
                <input
                  className="input mt-1.5"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">Password</span>
                <input
                  className="input mt-1.5"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="flex items-start gap-2 text-xs muted">
                <input
                  className="mt-0.5"
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                I consent to Basteon storing my profile and contact information for device
                ownership and emergency response.
              </label>
              {error && (
                <p
                  role="alert"
                  className="bg-[var(--surface-2)] border-l-4 border-[var(--crit)] p-2 text-xs text-[var(--crit)]"
                >
                  {error}
                </p>
              )}
              <button className="btn btn-primary w-full" disabled={loading}>
                {loading ? "Creating account…" : "Create account"}
              </button>
            </>
          )}
          <p className="muted text-xs text-center">
            Already registered?{" "}
            <Link className="text-[var(--accent)]" href="/login">
              Sign in
            </Link>
          </p>
        </div>
      </form>
    </main>
  );
}