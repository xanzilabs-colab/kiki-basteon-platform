"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message); else router.replace("/");
  }

  return (
    <main className="min-h-screen grid place-items-center p-5 bg-[var(--bg)]">
      <form onSubmit={login} className="panel w-full max-w-[360px]">
        <div className="p-5 border-b border-[var(--line)]">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 bg-[var(--accent)]" style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
            <b className="text-[13px] tracking-[.14em]">BASTEON</b>
          </div>
          <h1 className="page-title mt-4">Sign in</h1>
          <p className="muted text-xs mt-1">Sign in to manage your devices or respond to active incidents.</p>
        </div>
        <div className="p-5 space-y-4">
          <label className="block"><span className="label">Email</span>
            <input className="input mt-1.5" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="block"><span className="label">Password</span>
            <input className="input mt-1.5" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p role="alert" className="text-xs text-[var(--crit)] border border-[#6b2b32] bg-[rgb(255_77_90/.08)] p-2">{error}</p>}
          <button className="btn btn-primary w-full !h-9" disabled={loading}>{loading ? "Authenticating…" : "Sign in"}</button>
          <p className="muted text-xs text-center">New to Basteon? <Link className="text-[var(--accent)]" href="/signup">Create an account</Link></p>
        </div>
      </form>
    </main>
  );
}