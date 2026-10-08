"use client";

import Link from "next/link";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";
type OrganisationType = "institution" | "business" | "responder_partner";
type StepId = "organisation" | "classification" | "branch" | "contact" | "security" | "review";

const signupSteps: Array<{ id: StepId; title: string; description: string }> = [
  {
    id: "organisation",
    title: "Organisation",
    description: "Tell us about your organisation",
  },
  {
    id: "classification",
    title: "Classification",
    description: "Classify your organisation",
  },
  {
    id: "branch",
    title: "Branch",
    description: "Set up your primary branch",
  },
  {
    id: "contact",
    title: "Contact",
    description: "Create your organisation administrator",
  },
  {
    id: "security",
    title: "Security",
    description: "Secure your account",
  },
  {
    id: "review",
    title: "Review",
    description: "Review and create",
  },
];

export function OrganisationAccess() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organisationDescription, setOrganisationDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [organisationCategory, setOrganisationCategory] = useState("");
  const [organisationType, setOrganisationType] = useState<OrganisationType>("institution");
  const [institutionKind, setInstitutionKind] = useState("university");
  const [businessCategory, setBusinessCategory] = useState("");
  const [responderCategory, setResponderCategory] = useState("");
  const [branchName, setBranchName] = useState("Main Branch");
  const [branchAddress, setBranchAddress] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const heading = useMemo(() => mode === "signin" ? "Organisation sign in" : "Create organisation account", [mode]);
  const progress = Math.round(((stepIndex + 1) / signupSteps.length) * 100);
  const passwordChecks = useMemo(() => ({
    minLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasDigit: /\d/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
    matches: password.length > 0 && password === confirmPassword,
  }), [password, confirmPassword]);
  const strengthScore = Object.values(passwordChecks).slice(0, 5).filter(Boolean).length;
  const strengthLabel = strengthScore <= 2 ? "Weak" : strengthScore <= 4 ? "Good" : "Strong";

  function validateStep(index: number) {
    if (index === 0) {
      if (!organisationName.trim()) return "Organisation name is required.";
      if (!organisationType) return "Organisation type is required.";
    }
    if (index === 1) {
      if (organisationType === "institution" && !institutionKind.trim()) return "Institution type is required.";
    }
    if (index === 2) {
      if (!branchName.trim()) return "Primary branch name is required.";
    }
    if (index === 3) {
      if (!fullName.trim()) return "Administrator full name is required.";
      if (!email.trim()) return "Administrator email is required.";
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "Enter a valid administrator email address.";
    }
    if (index === 4) {
      if (!password.trim()) return "Password is required.";
      if (password.length < 8) return "Password must be at least 8 characters.";
      if (password !== confirmPassword) return "Passwords do not match.";
    }
    return "";
  }

  function nextStep() {
    const nextError = validateStep(stepIndex);
    if (nextError) {
      setError(nextError);
      return;
    }
    setError("");
    setStepIndex((current) => Math.min(signupSteps.length - 1, current + 1));
  }

  function previousStep() {
    setError("");
    setStepIndex((current) => Math.max(0, current - 1));
  }

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
    for (let i = 0; i < signupSteps.length - 1; i++) {
      const nextError = validateStep(i);
      if (nextError) {
        setStepIndex(i);
        setError(nextError);
        return;
      }
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const response = await fetch("/api/organisation/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationName,
        legalName: legalName || null,
        displayName: displayName || null,
        description: organisationDescription || null,
        logoUrl: logoUrl || null,
        category: organisationCategory || null,
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

  const currentStep = signupSteps[stepIndex];
  const isLastStep = stepIndex === signupSteps.length - 1;

  return (
    <main className="ops-login">
      <form className={mode === "signup" ? "ops-login-card ops-login-card--wide" : "ops-login-card"} onSubmit={mode === "signin" ? signIn : signUp}>
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
            <div className="ops-signup-progress">
              <div className="ops-signup-progress-mobile">Step {stepIndex + 1} of {signupSteps.length} · {currentStep.title}</div>
              <ol className="ops-signup-steps" aria-label="Organisation registration progress">
                {signupSteps.map((step, index) => (
                  <li key={step.id} className={index === stepIndex ? "is-current" : index < stepIndex ? "is-done" : ""}>
                    <span className="ops-signup-step-index">{index + 1}</span>
                    <span className="ops-signup-step-copy">
                      <b>{step.title}</b>
                      <small>{step.description}</small>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="ops-signup-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>

            <section className="ops-signup-step-panel">
              <header>
                <p className="ops-signup-step-eyebrow">Step {stepIndex + 1}</p>
                <h2>{currentStep.description}</h2>
                {currentStep.id === "organisation" && <p>Start by giving us some basic information about the organisation you're creating.</p>}
                {currentStep.id === "classification" && <p>Help us understand what type of organisation you're registering.</p>}
                {currentStep.id === "branch" && <p>Add the main location associated with this organisation.</p>}
                {currentStep.id === "contact" && <p>These details will be used to manage this organisation account.</p>}
                {currentStep.id === "security" && <p>Create a password for your BASTEON organisation account.</p>}
                {currentStep.id === "review" && <p>Make sure everything looks correct before creating your organisation account.</p>}
              </header>

              {currentStep.id === "organisation" && (
                <div className="ops-signup-grid">
                  <label className="ops-login-label">Organisation name<input required value={organisationName} onChange={(event) => setOrganisationName(event.target.value)} /></label>
                  <label className="ops-login-label">Legal name (optional)<input value={legalName} onChange={(event) => setLegalName(event.target.value)} /></label>
                  <label className="ops-login-label">Display name (optional)<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
                  <label className="ops-login-label">Organisation type
                    <select required value={organisationType} onChange={(event) => setOrganisationType(event.target.value as OrganisationType)}>
                      <option value="institution">Institution</option>
                      <option value="business">Company / Business</option>
                      <option value="responder_partner">Emergency / Security responder</option>
                    </select>
                  </label>
                </div>
              )}

              {currentStep.id === "classification" && (
                <div className="ops-signup-grid">
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
                  <label className="ops-login-label">Category<input value={organisationCategory} onChange={(event) => setOrganisationCategory(event.target.value)} placeholder="University, Corporate, Security partner..." /></label>
                  <label className="ops-login-label ops-login-label--full">Description<textarea value={organisationDescription} onChange={(event) => setOrganisationDescription(event.target.value)} placeholder="Operational overview and who this organisation supports." /></label>
                  <label className="ops-login-label ops-login-label--full">Logo URL (optional)<input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://..." /></label>
                </div>
              )}

              {currentStep.id === "branch" && (
                <div className="ops-signup-grid">
                  <label className="ops-login-label">Primary branch name<input required value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
                  <label className="ops-login-label ops-login-label--full">Primary branch address<input value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} placeholder="Street, suburb, city, province, South Africa" /></label>
                </div>
              )}

              {currentStep.id === "contact" && (
                <div className="ops-signup-grid">
                  <label className="ops-login-label">Your full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
                  <label className="ops-login-label">Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+27..." /></label>
                  <label className="ops-login-label ops-login-label--full">Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  <p className="ops-signup-note"><ShieldCheck size={16} /> This contact becomes the primary organisation administrator.</p>
                </div>
              )}

              {currentStep.id === "security" && (
                <div className="ops-signup-grid">
                  <label className="ops-login-label">Password
                    <span className="ops-password-wrap">
                      <input type={showPassword ? "text" : "password"} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
                      <button type="button" className="ops-password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                  </label>
                  <label className="ops-login-label">Confirm password
                    <span className="ops-password-wrap">
                      <input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                      <button type="button" className="ops-password-toggle" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}>
                        {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                  </label>
                  <div className="ops-password-strength ops-login-label--full">
                    <p>Password strength: <b>{strengthLabel}</b></p>
                    <div className="ops-signup-meter"><span style={{ width: `${(strengthScore / 5) * 100}%` }} /></div>
                    <ul>
                      <li className={passwordChecks.minLength ? "is-good" : ""}>At least 8 characters</li>
                      <li className={passwordChecks.hasUpper ? "is-good" : ""}>Uppercase letter</li>
                      <li className={passwordChecks.hasLower ? "is-good" : ""}>Lowercase letter</li>
                      <li className={passwordChecks.hasDigit ? "is-good" : ""}>Number</li>
                      <li className={passwordChecks.hasSymbol ? "is-good" : ""}>Symbol</li>
                      <li className={passwordChecks.matches ? "is-good" : ""}>Passwords match</li>
                    </ul>
                  </div>
                </div>
              )}

              {currentStep.id === "review" && (
                <div className="ops-signup-review">
                  <article>
                    <div><h3>Organisation</h3><button type="button" onClick={() => setStepIndex(0)}>Edit</button></div>
                    <p><b>Organisation name:</b> {organisationName || "—"}</p>
                    <p><b>Legal name:</b> {legalName || "—"}</p>
                    <p><b>Display name:</b> {displayName || "—"}</p>
                    <p><b>Organisation type:</b> {organisationType}</p>
                  </article>
                  <article>
                    <div><h3>Classification</h3><button type="button" onClick={() => setStepIndex(1)}>Edit</button></div>
                    <p><b>Institution type:</b> {organisationType === "institution" ? institutionKind : "N/A"}</p>
                    <p><b>Category:</b> {organisationCategory || "—"}</p>
                    <p><b>Description:</b> {organisationDescription || "—"}</p>
                  </article>
                  <article>
                    <div><h3>Primary branch</h3><button type="button" onClick={() => setStepIndex(2)}>Edit</button></div>
                    <p><b>Branch name:</b> {branchName || "—"}</p>
                    <p><b>Address:</b> {branchAddress || "—"}</p>
                  </article>
                  <article>
                    <div><h3>Administrator</h3><button type="button" onClick={() => setStepIndex(3)}>Edit</button></div>
                    <p><b>Full name:</b> {fullName || "—"}</p>
                    <p><b>Phone:</b> {phone || "—"}</p>
                    <p><b>Email:</b> {email || "—"}</p>
                  </article>
                </div>
              )}
            </section>
          </>
        )}

        {mode === "signin" && (
          <>
            <label className="ops-login-label">Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="ops-login-label">Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          </>
        )}

        {error && <p className="ops-login-error" role="alert">{error}</p>}
        {success && <p className="ops-login-status" role="status">{success}</p>}

        {mode === "signin" ? (
          <button className="ops-login-submit" type="submit" disabled={busy}>
            {busy ? "Please wait..." : "Sign in"}
          </button>
        ) : (
          <div className="ops-signup-nav">
            <button type="button" className="ops-login-submit is-secondary" onClick={previousStep} disabled={busy || stepIndex === 0}>Back</button>
            {isLastStep ? (
              <button className="ops-login-submit" type="submit" disabled={busy}>
                {busy ? "Creating organisation..." : "Create Organisation"}
              </button>
            ) : (
              <button type="button" className="ops-login-submit" onClick={nextStep} disabled={busy}>Continue</button>
            )}
          </div>
        )}

        <button
          type="button"
          className="ops-login-customer"
          onClick={() => {
            setError("");
            setSuccess("");
            setMode(mode === "signin" ? "signup" : "signin");
            setStepIndex(0);
          }}
        >
          {mode === "signin" ? "New organisation? Create account" : "Already have an account? Sign in"}
        </button>

        <Link className="ops-login-customer" href="/login">Customer sign in</Link>
      </form>
    </main>
  );
}
