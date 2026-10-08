"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, RefreshCw, Shield, UserPlus } from "lucide-react";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";

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
  const emergencyTypes = useEmergencyTypes();

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

  const organisationId = state?.organisation?.id ?? "";
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

  if (!state) return <div className="panel p-5">Loading organisation console...</div>;

  return (
    <div className="space-y-5 max-w-[1280px]">
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

      {generatedCredentials && (
        <section className="panel p-4 space-y-2">
          <h2 className="pane-head">Generated credentials</h2>
          <p className="text-sm">Email: <b>{generatedCredentials.email}</b></p>
          <p className="text-sm">Password: <b>{generatedCredentials.password}</b></p>
          {generatedCredentialPdfUrl && <a className="btn inline-flex w-fit" href={generatedCredentialPdfUrl}>Download onboarding credential PDF</a>}
          <p className="muted text-xs">Share these securely. Ask the responder to change password on first login.</p>
        </section>
      )}

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
    </div>
  );
}
