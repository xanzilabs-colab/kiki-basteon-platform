"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, LayoutDashboard, RefreshCw, Settings2, Shield, UserPlus, Users } from "lucide-react";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";
import { membershipTypeOptionsForOrganisation, roleHintForMembershipType } from "@/lib/organisationCategories";

type MeResponse = {
  organisation: any;
  memberships: Array<{ role: string; organisation_id: string }>;
  branches: Array<any>;
  members: Array<any>;
  settings: any;
  domains: Array<any>;
  coverage: Array<any>;
  units: Array<any>;
  responderPresence: Array<any>;
  dispatchPolicy: { acknowledge_timeout_seconds: number; escalation_timeout_seconds: number; auto_assign_enabled: boolean } | null;
  onboarding: {
    organisation_profile_done: boolean;
    branches_done: boolean;
    linking_rules_done: boolean;
    coverage_done: boolean;
    responders_done: boolean;
    completed_at: string | null;
  } | null;
};

type DashboardTab = "home" | "beneficiaries" | "responders" | "members" | "settings" | "configurations";

export function OrganisationConsole() {
  const [state, setState] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [branchCity, setBranchCity] = useState("");
  const [branchLat, setBranchLat] = useState("");
  const [branchLng, setBranchLng] = useState("");
  const [branchGeofence, setBranchGeofence] = useState("");
  const [responderName, setResponderName] = useState("");
  const [responderEmail, setResponderEmail] = useState("");
  const [responderPhone, setResponderPhone] = useState("");
  const [responderRole, setResponderRole] = useState("responder");
  const [responderBranch, setResponderBranch] = useState("");
  const [responderUnit, setResponderUnit] = useState("");
  const [generatedCredentials, setGeneratedCredentials] = useState<{ email: string; password: string; fullName: string } | null>(null);
  const [generatedCredentialPdfUrl, setGeneratedCredentialPdfUrl] = useState("");
  const [coverageTypeCode, setCoverageTypeCode] = useState("general");
  const [coverageBranchId, setCoverageBranchId] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitBranchId, setUnitBranchId] = useState("");
  const [unitType, setUnitType] = useState("other");
  const [domainValue, setDomainValue] = useState("");
  const [domainMembershipType, setDomainMembershipType] = useState("staff");
  const [domainPriority, setDomainPriority] = useState("100");
  const [allowEmailDomain, setAllowEmailDomain] = useState(true);
  const [allowWorkId, setAllowWorkId] = useState(true);
  const [requireInvite, setRequireInvite] = useState(false);
  const [autoApproveLinks, setAutoApproveLinks] = useState(true);
  const [workIdRegex, setWorkIdRegex] = useState("");
  const [activeTab, setActiveTab] = useState<DashboardTab>("home");
  const [dashboardUnlocked, setDashboardUnlocked] = useState(false);
  const emergencyTypes = useEmergencyTypes();
  const membershipTypeOptions = useMemo(
    () => membershipTypeOptionsForOrganisation(state?.organisation ?? {}),
    [state?.organisation],
  );

  async function refresh() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/me", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not load organisation.");
      setBusy(false);
      return;
    }
    setState(body as MeResponse);
    setBusy(false);
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!state?.settings) return;
    setAllowEmailDomain(Boolean(state.settings.allow_email_domain));
    setAllowWorkId(Boolean(state.settings.allow_work_id));
    setRequireInvite(Boolean(state.settings.require_invite));
    setAutoApproveLinks(Boolean(state.settings.auto_approve_links));
    setWorkIdRegex(state.settings.work_id_regex ?? "");
  }, [state?.settings]);
  useEffect(() => {
    setDomainMembershipType((current) => membershipTypeOptions.some((option) => option.value === current) ? current : (membershipTypeOptions[0]?.value ?? "staff"));
  }, [membershipTypeOptions]);

  const organisationId = state?.organisation?.id ?? "";
  const dashboardUnlockStorageKey = organisationId ? `org-dashboard-unlocked:${organisationId}` : "";
  const branchOptions = state?.branches ?? [];
  const units = state?.units ?? [];
  const responders = state?.responderPresence ?? [];
  const activeMembers = useMemo(() => (state?.members ?? []).filter((member) => member.status === "active"), [state]);
  const onboarding = state?.onboarding ?? {
    organisation_profile_done: false,
    branches_done: false,
    linking_rules_done: false,
    coverage_done: false,
    responders_done: false,
    completed_at: null,
  };
  const onboardingProgress = [onboarding.organisation_profile_done, onboarding.branches_done, onboarding.linking_rules_done, onboarding.coverage_done, onboarding.responders_done].filter(Boolean).length;
  const onboardingComplete = onboardingProgress >= 5;
  const inOnboardingMode = !dashboardUnlocked;
  const responderRoles = new Set(["owner", "admin", "manager", "dispatcher", "responder", "viewer"]);
  const responderMembers = activeMembers.filter((member) => responderRoles.has(member.role));
  const beneficiaryMembers = activeMembers.filter((member) => !responderRoles.has(member.role) || member.membership_type === "member");

  useEffect(() => {
    if (!dashboardUnlockStorageKey) return;
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(dashboardUnlockStorageKey) === "1";
    setDashboardUnlocked(saved);
  }, [dashboardUnlockStorageKey, onboardingComplete]);

  function unlockDashboard() {
    if (!dashboardUnlockStorageKey || typeof window === "undefined") return;
    window.localStorage.setItem(dashboardUnlockStorageKey, "1");
    setDashboardUnlocked(true);
    setActiveTab("home");
  }

  async function markOnboardingStep(step: "organisationProfileDone" | "branchesDone" | "linkingRulesDone" | "coverageDone" | "respondersDone") {
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/organisation/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, [step]: true }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not update onboarding.");
      setBusy(false);
      return;
    }
    setMessage("Onboarding progress updated.");
    await refresh();
  }

  async function addDomainRule(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        domain: domainValue,
        membershipType: domainMembershipType,
        roleHint: roleHintForMembershipType(domainMembershipType),
        priority: Number(domainPriority) || 100,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not add domain rule.");
      setBusy(false);
      return;
    }
    setDomainValue("");
    setDomainPriority("100");
    setMessage("Domain rule added.");
    await refresh();
  }

  async function removeDomainRule(id: string) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/domains", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, id }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not remove domain rule.");
      setBusy(false);
      return;
    }
    setMessage("Domain rule removed.");
    await refresh();
  }

  async function createBranch(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    let geofence: unknown = null;
    if (branchGeofence.trim()) {
      try {
        geofence = JSON.parse(branchGeofence);
      } catch {
        setError("Geofence must be valid JSON polygon.");
        return;
      }
    }
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/organisation/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        name: branchName,
        address: branchAddress || null,
        city: branchCity || null,
        lat: branchLat ? Number(branchLat) : null,
        lng: branchLng ? Number(branchLng) : null,
        geofenceGeojson: geofence,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not create branch.");
      setBusy(false);
      return;
    }
    setBranchName("");
    setBranchAddress("");
    setBranchCity("");
    setBranchLat("");
    setBranchLng("");
    setBranchGeofence("");
    setMessage("Branch added.");
    await refresh();
  }

  async function addResponder(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    setGeneratedCredentials(null);
    setGeneratedCredentialPdfUrl("");
    if (!responderBranch) {
      setError("Responders and dispatchers must be assigned to a branch.");
      setBusy(false);
      return;
    }
    const response = await fetch("/api/organisation/responders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        fullName: responderName,
        email: responderEmail,
        phone: responderPhone || null,
        branchId: responderBranch,
        unitId: responderUnit || null,
        role: responderRole,
        membershipType: "responder",
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not add responder account.");
      setBusy(false);
      return;
    }
    setGeneratedCredentials((body as any).credentials ?? null);
    setGeneratedCredentialPdfUrl((body as any).credentialPdfUrl ?? "");
    setResponderName("");
    setResponderEmail("");
    setResponderPhone("");
    setResponderRole("responder");
    setResponderBranch("");
    setResponderUnit("");
    setMessage("Responder account created.");
    await refresh();
  }

  async function createUnit(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    if (!unitBranchId) {
      setError("Unit branch is required.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, branchId: unitBranchId, name: unitName, unitType }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not create unit.");
      setBusy(false);
      return;
    }
    setUnitName("");
    setUnitBranchId("");
    setUnitType("other");
    setMessage("Unit created.");
    await refresh();
  }

  async function setAvailability(userId: string, availability: string) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/organisation/responders/availability", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, userId, availability }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not update availability.");
      setBusy(false);
      return;
    }
    setMessage("Availability updated.");
    await refresh();
  }

  async function regeneratePassword(userId: string) {
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/responders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, userId }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not regenerate password.");
      setBusy(false);
      return;
    }
    setGeneratedCredentials({ email: "Password reset", fullName: "Share securely", password: (body as any).password });
    setMessage("Password regenerated.");
    setBusy(false);
  }

  async function addCoverage(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/organisation/coverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        branchId: coverageBranchId || null,
        emergencyTypeCode: coverageTypeCode,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not save emergency coverage.");
      setBusy(false);
      return;
    }
    setMessage("Coverage saved.");
    await refresh();
  }

  async function saveLinkSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/organisation/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        allowEmailDomain,
        allowWorkId,
        requireInvite,
        autoApproveLinks,
        workIdRegex: workIdRegex.trim() || null,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not save linking settings.");
      setBusy(false);
      return;
    }
    setMessage("Linking configuration updated.");
    await refresh();
  }

  async function removeCoverage(id: string) {
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/organisation/coverage", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, id }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not remove coverage.");
      setBusy(false);
      return;
    }
    setMessage("Coverage removed.");
    await refresh();
  }

  const dashboardTabs: Array<{ key: DashboardTab; label: string; icon: React.ComponentType<{ size?: number }>; description: string }> = [
    { key: "home", label: "Home", icon: LayoutDashboard, description: "Overview and quick actions" },
    { key: "beneficiaries", label: "Beneficiaries", icon: Users, description: "Linked members and beneficiaries" },
    { key: "responders", label: "Responders", icon: Shield, description: "Responder teams and availability" },
    { key: "members", label: "Staff / Members", icon: Users, description: "Accounts and credential actions" },
    { key: "settings", label: "Settings", icon: Settings2, description: "Organisation linking settings" },
    { key: "configurations", label: "Configurations", icon: Building2, description: "Branches, units, coverage, and onboarding controls" },
  ];

  const showHomePanel = !inOnboardingMode && activeTab === "home";
  const showBeneficiariesPanel = !inOnboardingMode && activeTab === "beneficiaries";
  const showRespondersPanel = !inOnboardingMode && activeTab === "responders";
  const showMembersPanel = !inOnboardingMode && activeTab === "members";
  const showSettingsPanel = !inOnboardingMode && activeTab === "settings";
  const showConfigurationsPanel = inOnboardingMode || activeTab === "configurations";

  if (!state) return <div className="panel p-5">Loading organisation console...</div>;

  return (
    <div className="w-full space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Organisation operations</p>
          <h1 className="page-title mt-1">{state.organisation.name}</h1>
          <p className="muted text-sm mt-1">
            {state.organisation.organisation_type} · {state.memberships[0]?.role ?? "member"}
          </p>
        </div>
        <button className="btn" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button>
      </header>

      {error && <p role="alert" className="ops-login-error">{error}</p>}
      {message && <p role="status" className="ops-login-status">{message}</p>}

      {inOnboardingMode && onboardingComplete && (
        <section className="panel p-4 space-y-3">
          <h2 className="pane-head">Onboarding complete</h2>
          <p className="muted text-sm">
            Your setup checklist is complete. Open the full dashboard to access tabs for home, beneficiaries, responders,
            staff/members, settings, and configurations.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => unlockDashboard()}>Go to dashboard</button>
            <button className="btn" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} />Refresh status</button>
          </div>
        </section>
      )}

      {!inOnboardingMode && (
        <section className="panel p-3">
          <nav className="flex flex-wrap gap-2" aria-label="Organisation dashboard tabs">
            {dashboardTabs.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`btn ${selected ? "btn-primary" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                  aria-pressed={selected}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
          <p className="muted text-xs mt-2">{dashboardTabs.find((tab) => tab.key === activeTab)?.description}</p>
        </section>
      )}

      {generatedCredentials && (
        <section className="panel p-4 space-y-2">
          <h2 className="pane-head">Generated credentials</h2>
          <p className="text-sm">Email: <b>{generatedCredentials.email}</b></p>
          <p className="text-sm">Password: <b>{generatedCredentials.password}</b></p>
          {generatedCredentialPdfUrl && <a className="btn inline-flex w-fit" href={generatedCredentialPdfUrl}>Download onboarding credential PDF</a>}
          <p className="muted text-xs">Share these securely. Ask the responder to change password on first login.</p>
        </section>
      )}

      {showHomePanel && (
        <section className="panel p-4 space-y-3">
          <h2 className="pane-head">Organisation dashboard</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="panel p-3"><p className="muted text-xs">Branches</p><p className="text-2xl font-semibold">{branchOptions.length}</p></div>
            <div className="panel p-3"><p className="muted text-xs">Units</p><p className="text-2xl font-semibold">{units.length}</p></div>
            <div className="panel p-3"><p className="muted text-xs">Responder accounts</p><p className="text-2xl font-semibold">{responderMembers.length}</p></div>
            <div className="panel p-3"><p className="muted text-xs">Beneficiaries / members</p><p className="text-2xl font-semibold">{beneficiaryMembers.length}</p></div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <button className="btn justify-between" type="button" onClick={() => setActiveTab("responders")}><span>Manage responders</span><span>Open</span></button>
            <button className="btn justify-between" type="button" onClick={() => setActiveTab("members")}><span>Manage staff / members</span><span>Open</span></button>
            <button className="btn justify-between" type="button" onClick={() => setActiveTab("beneficiaries")}><span>View beneficiaries</span><span>Open</span></button>
            <button className="btn justify-between" type="button" onClick={() => setActiveTab("configurations")}><span>Open configurations</span><span>Open</span></button>
          </div>
        </section>
      )}

      {(showConfigurationsPanel || showSettingsPanel) && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head">Onboarding checklist</h2>
        <p className="muted text-sm">Complete all five setup steps before go-live routing.</p>
        <p className="text-sm font-semibold">{onboardingProgress} / 5 complete</p>
        <div className="grid gap-2 md:grid-cols-2">
          <button className="btn justify-between" disabled={busy || onboarding.organisation_profile_done} onClick={() => void markOnboardingStep("organisationProfileDone")}><span>Organisation profile</span><span>{onboarding.organisation_profile_done ? "Done" : "Mark done"}</span></button>
          <button className="btn justify-between" disabled={busy || onboarding.branches_done} onClick={() => void markOnboardingStep("branchesDone")}><span>Branches</span><span>{onboarding.branches_done ? "Done" : "Mark done"}</span></button>
          <button className="btn justify-between" disabled={busy || onboarding.linking_rules_done} onClick={() => void markOnboardingStep("linkingRulesDone")}><span>Linking rules</span><span>{onboarding.linking_rules_done ? "Done" : "Mark done"}</span></button>
          <button className="btn justify-between" disabled={busy || onboarding.coverage_done} onClick={() => void markOnboardingStep("coverageDone")}><span>Emergency coverage</span><span>{onboarding.coverage_done ? "Done" : "Mark done"}</span></button>
          <button className="btn justify-between" disabled={busy || onboarding.responders_done} onClick={() => void markOnboardingStep("respondersDone")}><span>Responders</span><span>{onboarding.responders_done ? "Done" : "Mark done"}</span></button>
        </div>
      </section>
      )}

      {showBeneficiariesPanel && (
        <section className="panel p-4 space-y-3">
          <h2 className="pane-head">Beneficiaries</h2>
          <p className="muted text-sm">People linked to this organisation who are not in responder operations roles.</p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>
                {beneficiaryMembers.map((member) => (
                  <tr key={member.id}>
                    <td>{member.profiles?.full_name || member.user_id}</td>
                    <td>{member.profiles?.email || "—"}</td>
                    <td>{member.membership_type}</td>
                    <td>{member.status}</td>
                  </tr>
                ))}
                {beneficiaryMembers.length === 0 && <tr><td colSpan={4} className="muted text-center">No beneficiaries linked yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(showConfigurationsPanel || showSettingsPanel) && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head">Linking configuration</h2>
        <p className="muted text-sm">Control how users can link themselves to this organisation by email domain or verified work/student ID.</p>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void saveLinkSettings(event)}>
          <label className="field">
            <span className="inline-flex items-center gap-2">
              <input type="checkbox" checked={allowEmailDomain} onChange={(event) => setAllowEmailDomain(event.target.checked)} />
              Allow email-domain linking
            </span>
          </label>
          <label className="field">
            <span className="inline-flex items-center gap-2">
              <input type="checkbox" checked={allowWorkId} onChange={(event) => setAllowWorkId(event.target.checked)} />
              Allow work/student ID linking
            </span>
          </label>
          <label className="field">
            <span className="inline-flex items-center gap-2">
              <input type="checkbox" checked={requireInvite} onChange={(event) => setRequireInvite(event.target.checked)} />
              Require invite approval before activation
            </span>
          </label>
          <label className="field">
            <span className="inline-flex items-center gap-2">
              <input type="checkbox" checked={autoApproveLinks} onChange={(event) => setAutoApproveLinks(event.target.checked)} />
              Auto-approve eligible links
            </span>
          </label>
          <label className="field md:col-span-2">Work/Student ID regex rule (optional)
            <input value={workIdRegex} onChange={(event) => setWorkIdRegex(event.target.value)} placeholder="e.g. ^[A-Z]{2}[0-9]{6}$" />
          </label>
          <button className="btn btn-primary md:col-span-2 md:justify-self-start" disabled={busy}>Save linking configuration</button>
        </form>

        <form className="grid gap-3 border-t border-[var(--line)] pt-3 md:grid-cols-4" onSubmit={(event) => void addDomainRule(event)}>
          <label className="field md:col-span-2">Allowed domain
            <input required value={domainValue} onChange={(event) => setDomainValue(event.target.value)} placeholder="example.ac.za" />
          </label>
          <label className="field">Membership type
            <select value={domainMembershipType} onChange={(event) => setDomainMembershipType(event.target.value)}>
              {membershipTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">Priority
            <input type="number" min={1} max={1000} value={domainPriority} onChange={(event) => setDomainPriority(event.target.value)} />
          </label>
          <button className="btn btn-primary md:col-span-4 md:justify-self-start" disabled={busy}>Add domain rule</button>
        </form>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Allowed domain</th><th>Membership type</th><th>Priority</th><th>Actions</th></tr></thead>
            <tbody>
              {(state.domains ?? []).map((domain: any) => (
                <tr key={domain.id}>
                  <td>{domain.domain}</td>
                  <td>{domain.membership_type}</td>
                  <td>{domain.priority ?? 100}</td>
                  <td><button className="btn" disabled={busy} onClick={() => void removeDomainRule(domain.id)}>Remove</button></td>
                </tr>
              ))}
              {(state.domains ?? []).length === 0 && <tr><td colSpan={4} className="muted text-center">No domain rules configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showConfigurationsPanel && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head flex items-center gap-2"><Building2 size={18} />Branches / Stations</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void createBranch(event)}>
          <label className="field">Branch name<input required value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
          <label className="field">Address<input value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} /></label>
          <label className="field">City<input value={branchCity} onChange={(event) => setBranchCity(event.target.value)} /></label>
          <label className="field">Latitude<input value={branchLat} onChange={(event) => setBranchLat(event.target.value)} placeholder="-25.7461" /></label>
          <label className="field">Longitude<input value={branchLng} onChange={(event) => setBranchLng(event.target.value)} placeholder="28.1881" /></label>
          <label className="field md:col-span-2">Geofence GeoJSON (Polygon)
            <textarea value={branchGeofence} onChange={(event) => setBranchGeofence(event.target.value)} placeholder='{"type":"Polygon","coordinates":[[[28.1,-25.7],[28.2,-25.7],[28.2,-25.8],[28.1,-25.8],[28.1,-25.7]]]}' />
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Add branch</button>
        </form>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Address</th><th>City</th><th>HQ</th></tr></thead>
            <tbody>
              {branchOptions.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.name}</td>
                  <td>{branch.address || "—"}</td>
                  <td>{branch.city || "—"}</td>
                  <td>{branch.is_hq ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showConfigurationsPanel && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head">Units</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void createUnit(event)}>
          <label className="field">Unit name<input required value={unitName} onChange={(event) => setUnitName(event.target.value)} /></label>
          <label className="field">Unit type
            <select value={unitType} onChange={(event) => setUnitType(event.target.value)}>
              <option value="patrol_vehicle">Patrol vehicle</option>
              <option value="ambulance">Ambulance</option>
              <option value="response_team">Response team</option>
              <option value="medical_team">Medical team</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field">Branch
            <select required value={unitBranchId} onChange={(event) => setUnitBranchId(event.target.value)}>
              <option value="">Select branch</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Add unit</button>
        </form>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Type</th><th>Branch</th><th>Status</th></tr></thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id}>
                  <td>{unit.name}</td>
                  <td>{unit.unit_type}</td>
                  <td>{branchOptions.find((branch) => branch.id === unit.branch_id)?.name ?? "—"}</td>
                  <td>{unit.active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
              {units.length === 0 && <tr><td colSpan={4} className="muted text-center">No units configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showConfigurationsPanel && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head">Emergency coverage</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void addCoverage(event)}>
          <label className="field">Emergency type
            <select value={coverageTypeCode} onChange={(event) => setCoverageTypeCode(event.target.value)}>
              {emergencyTypes.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}
            </select>
          </label>
          <label className="field">Branch
            <select value={coverageBranchId} onChange={(event) => setCoverageBranchId(event.target.value)}>
              <option value="">All branches (org-wide)</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Save coverage</button>
        </form>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Type</th><th>Branch</th><th>Priority</th><th>Actions</th></tr></thead>
            <tbody>
              {(state.coverage ?? []).map((row: any) => (
                <tr key={row.id}>
                  <td>{emergencyTypes.find((type) => type.code === row.emergency_type_code)?.short_label ?? row.emergency_type_code}</td>
                  <td>{branchOptions.find((branch) => branch.id === row.branch_id)?.name ?? "All branches"}</td>
                  <td>{row.priority}</td>
                  <td><button className="btn" disabled={busy} onClick={() => void removeCoverage(row.id)}>Remove</button></td>
                </tr>
              ))}
              {(state.coverage ?? []).length === 0 && <tr><td colSpan={4} className="muted text-center">No emergency coverage configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {(showConfigurationsPanel || showRespondersPanel) && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head flex items-center gap-2"><UserPlus size={18} />Add responder / staff account</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void addResponder(event)}>
          <label className="field">Name<input required value={responderName} onChange={(event) => setResponderName(event.target.value)} /></label>
          <label className="field">Email<input required type="email" value={responderEmail} onChange={(event) => setResponderEmail(event.target.value)} /></label>
          <label className="field">Phone<input value={responderPhone} onChange={(event) => setResponderPhone(event.target.value)} /></label>
          <label className="field">Role
            <select value={responderRole} onChange={(event) => setResponderRole(event.target.value)}>
              <option value="dispatcher">Dispatcher</option>
              <option value="responder">Responder</option>
              <option value="manager">Manager</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label className="field">Branch
            <select required value={responderBranch} onChange={(event) => setResponderBranch(event.target.value)}>
              <option value="">Select branch</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label className="field">Unit
            <select value={responderUnit} onChange={(event) => setResponderUnit(event.target.value)}>
              <option value="">No unit</option>
              {units.filter((unit) => !responderBranch || unit.branch_id === responderBranch).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Create account</button>
        </form>
      </section>
      )}

      {(showConfigurationsPanel || showMembersPanel || showRespondersPanel) && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head flex items-center gap-2"><Shield size={18} />Members & responder accounts</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Type</th><th>Branch</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {activeMembers.map((member) => (
                <tr key={member.id}>
                  <td>{member.profiles?.full_name || member.user_id}</td>
                  <td>{member.role}</td>
                  <td>{member.membership_type}</td>
                  <td>{branchOptions.find((branch) => branch.id === member.branch_id)?.name ?? "—"}</td>
                  <td>{member.status}</td>
                  <td>
                    {(member.role === "responder" || member.role === "dispatcher" || member.role === "manager" || member.role === "viewer") && (
                      <div className="flex flex-wrap gap-2">
                        <button className="btn" disabled={busy} onClick={() => void regeneratePassword(member.user_id)}>Generate new password</button>
                        <a className="btn" href={`/api/organisation/responders/${member.user_id}/credential-pdf?organisationId=${organisationId}`}>Credential PDF</a>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {(showConfigurationsPanel || showRespondersPanel) && (
      <section className="panel p-4 space-y-3">
        <h2 className="pane-head">Responder availability</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Availability</th><th>Branch</th><th>Unit</th><th>Last seen</th><th>Actions</th></tr></thead>
            <tbody>
              {responders.map((presence) => (
                <tr key={presence.user_id}>
                  <td>{presence.profiles?.full_name ?? presence.user_id}</td>
                  <td>{presence.availability}</td>
                  <td>{branchOptions.find((branch) => branch.id === presence.branch_id)?.name ?? "—"}</td>
                  <td>{units.find((unit) => unit.id === presence.unit_id)?.name ?? "—"}</td>
                  <td>{presence.last_seen_at ? new Date(presence.last_seen_at).toLocaleString() : "—"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {["available", "busy", "off_duty", "unavailable"].map((value) => (
                        <button key={value} className="btn" disabled={busy || presence.availability === value} onClick={() => void setAvailability(presence.user_id, value)}>{value}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {responders.length === 0 && <tr><td colSpan={6} className="muted text-center">No responder presence records yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}
