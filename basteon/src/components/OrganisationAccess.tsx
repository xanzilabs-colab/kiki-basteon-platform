"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";
type OrganisationType = "institution" | "business" | "responder_partner";

export function OrganisationAccess() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [organisationType, setOrganisationType] = useState<OrganisationType>("institution");
  const [institutionKind, setInstitutionKind] = useState("university");
  const [businessCategory, setBusinessCategory] = useState("");
  const [responderCategory, setResponderCategory] = useState("");
  const [branchName, setBranchName] = useState("Main Branch");
  const [branchAddress, setBranchAddress] = useState("");

  const heading = useMemo(() => mode === "signin" ? "Organisation sign in" : "Create organisation account", [mode]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const client = createClient();
    const { data, error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError || !data.user) {
      setBusy(false);
      setError(signInError?.message ?? "Unable to sign in.");
      return;
    }
    router.replace("/organisation");
    router.refresh();
  }

  async function signUp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const response = await fetch("/api/organisation/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationName,
        organisationType,
        institutionKind: organisationType === "institution" ? institutionKind : null,
        businessCategory: organisationType === "business" ? businessCategory : null,
        responderCategory: organisationType === "responder_partner" ? responderCategory : null,
        fullName,
        email,
        password,
        phone,
        branchName,
        branchAddress,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(false);
      setError(typeof body.error === "string" ? body.error : "Could not create organisation.");
      return;
    }

    const client = createClient();
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) {
      setBusy(false);
      setSuccess("Organisation created. Please sign in.");
      setMode("signin");
      return;
    }
    router.replace("/organisation");
    router.refresh();
  }

  return (
    <main className="ops-login">
      <form className="ops-login-card" onSubmit={mode === "signin" ? signIn : signUp}>
        <div className="ops-login-brand">
          <span className="mark">B</span>
          <div>
            <span>BASTEON</span>
            <strong>Organisation Console</strong>
          </div>
        </div>
        <div className="ops-login-copy">
          <h1>{heading}</h1>
          <p>For institutions, businesses, private security and emergency partners.</p>
        </div>

        {mode === "signup" && (
          <>
            <label className="ops-login-label">Organisation name<input required value={organisationName} onChange={(event) => setOrganisationName(event.target.value)} /></label>
            <label className="ops-login-label">Organisation type
              <select required value={organisationType} onChange={(event) => setOrganisationType(event.target.value as OrganisationType)}>
                <option value="institution">Institution</option>
                <option value="business">Company / Business</option>
                <option value="responder_partner">Emergency / Security responder</option>
              </select>
            </label>
            {organisationType === "institution" && (
              <label className="ops-login-label">Institution type
                <select value={institutionKind} onChange={(event) => setInstitutionKind(event.target.value)}>
                  <option value="university">University</option>
                  <option value="college">College</option>
                  <option value="school">School</option>
                  <option value="other">Other</option>
                </select>
              </label>
            )}
            {organisationType === "business" && (
              <label className="ops-login-label">Business category<input value={businessCategory} onChange={(event) => setBusinessCategory(event.target.value)} placeholder="Retail, mining, logistics..." /></label>
            )}
            {organisationType === "responder_partner" && (
              <label className="ops-login-label">Responder category<input value={responderCategory} onChange={(event) => setResponderCategory(event.target.value)} placeholder="Private security, EMS, fire..." /></label>
            )}
            <label className="ops-login-label">Primary branch name<input required value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
            <label className="ops-login-label">Primary branch address<input value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} /></label>
            <label className="ops-login-label">Your full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label className="ops-login-label">Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          </>
        )}

        <label className="ops-login-label">Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="ops-login-label">Password<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>

        {error && <p className="ops-login-error" role="alert">{error}</p>}
        {success && <p className="ops-login-status" role="status">{success}</p>}

        <button className="ops-login-submit" type="submit" disabled={busy}>
          {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Create organisation"}
        </button>

        <button
          type="button"
          className="ops-login-customer"
          onClick={() => {
            setError("");
            setSuccess("");
            setMode(mode === "signin" ? "signup" : "signin");
          }}
        >
          {mode === "signin" ? "New organisation? Create account" : "Already have an account? Sign in"}
        </button>

        <Link className="ops-login-customer" href="/login">Customer sign in</Link>
      </form>
    </main>
  );
}
