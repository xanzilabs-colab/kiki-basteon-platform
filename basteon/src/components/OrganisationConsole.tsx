"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, RefreshCw, Shield, UserPlus } from "lucide-react";

type MeResponse = {
  organisation: any;
  memberships: Array<{ role: string; organisation_id: string }>;
  branches: Array<any>;
  members: Array<any>;
  settings: any;
  domains: Array<any>;
  coverage: Array<any>;
};

export function OrganisationConsole() {
  const [state, setState] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [responderName, setResponderName] = useState("");
  const [responderEmail, setResponderEmail] = useState("");
  const [responderPhone, setResponderPhone] = useState("");
  const [responderRole, setResponderRole] = useState("responder");
  const [responderBranch, setResponderBranch] = useState("");
  const [generatedCredentials, setGeneratedCredentials] = useState<{ email: string; password: string; fullName: string } | null>(null);

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
  const activeMembers = useMemo(() => (state?.members ?? []).filter((member) => member.status === "active"), [state]);

  async function createBranch(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId) return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/organisation/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, name: branchName, address: branchAddress || null }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not create branch.");
      setBusy(false);
      return;
    }
    setBranchName("");
    setBranchAddress("");
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
    const response = await fetch("/api/organisation/responders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        fullName: responderName,
        email: responderEmail,
        phone: responderPhone || null,
        branchId: responderBranch || null,
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
    setResponderName("");
    setResponderEmail("");
    setResponderPhone("");
    setResponderRole("responder");
    setResponderBranch("");
    setMessage("Responder account created.");
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
          <p className="muted text-xs">Share these securely. Ask the responder to change password on first login.</p>
        </section>
      )}

      <section className="panel p-4 space-y-3">
        <h2 className="pane-head flex items-center gap-2"><Building2 size={18} />Branches / Stations</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void createBranch(event)}>
          <label className="field">Branch name<input required value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
          <label className="field">Address<input value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} /></label>
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
            <select value={responderBranch} onChange={(event) => setResponderBranch(event.target.value)}>
              <option value="">Unassigned</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
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
                      <button className="btn" disabled={busy} onClick={() => void regeneratePassword(member.user_id)}>Generate new password</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
