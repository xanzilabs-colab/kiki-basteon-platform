"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type OperationsLoginProps = {
  consoleName: string;
  destination: string;
  allowedRoles: string[];
};

export function OperationsLogin({ consoleName, destination, allowedRoles }: OperationsLoginProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const client = createClient();
    const { data, error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError || !data.user) {
      setLoading(false);
      setError(signInError?.message ?? "Unable to sign in.");
      return;
    }

    const { data: profile } = await client.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    if (!profile || !allowedRoles.includes(profile.role)) {
      await client.auth.signOut();
      setLoading(false);
      setError(`This account does not have access to the ${consoleName.toLowerCase()}.`);
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  return (
    <main className="ops-login">
      <form className="ops-login-card" onSubmit={signIn}>
        <div className="ops-login-brand">
          <span className="mark">B</span>
          <div>
            <span>BASTEON</span>
            <strong>{consoleName}</strong>
          </div>
        </div>

        <div className="ops-login-copy">
          <h1>Sign in to continue</h1>
          <p>Authorised personnel only.</p>
        </div>

        <label className="ops-login-label">
          Email address
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="ops-login-label">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="ops-login-error" role="alert">{error}</p>}
        <button className="ops-login-submit" type="submit" disabled={loading}>
          {loading ? "Checking access..." : "Sign in"}
        </button>
        <Link className="ops-login-customer" href="/organisation/login">Organisation sign up / sign in</Link>
        <Link className="ops-login-customer" href="/login">Customer sign in</Link>
      </form>
    </main>
  );
}