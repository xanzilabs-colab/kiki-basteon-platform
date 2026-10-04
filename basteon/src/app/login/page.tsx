"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { KikiMark } from "@/components/KikiMark";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else {
      await fetch("/api/verification/device/rotate", { method: "POST" });
      router.replace("/");
    }
  }

  return (
    <main className="auth-shell">
      <form onSubmit={login} className="auth-card">
        <div className="auth-head">
          <div className="flex items-center gap-2.5">
            <KikiMark size={170} />
            <b className="text-[13px] tracking-[.04em] font-semibold">KIKI CONNECT</b>
          </div>
          <h1 className="page-title mt-4">Safety, wherever you are.</h1>
          <p className="muted text-[12px] mt-1">
            Your Kiki keeps support close when you need it.
          </p>
        </div>

        <div className="auth-body space-y-4">
          <label className="block">
            <span className="label">Email</span>
            <input
              className="input mt-1.5"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="label">Password</span>
            <input
              className="input mt-1.5"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && (
            <p
              role="alert"
              className="bg-[var(--surface-2)] border-l-4 border-[var(--crit)] px-2.5 py-2 text-[12px] text-[var(--crit)]"
            >
              {error}
            </p>
          )}

          <button
            className="btn btn-primary w-full"
            style={{ height: 34 }}
            disabled={loading}
          >
            {loading ? "Authenticating…" : "Sign in"}
          </button>

          <p className="muted text-[12px] text-center">
            New to Kiki?{" "}
            <Link className="text-[var(--info)] hover:underline" href="/signup">
              Create an account
            </Link>
          </p>
        </div>
      </form>
    </main>
  );
}