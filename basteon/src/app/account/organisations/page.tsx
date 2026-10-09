"use client";

import { Building2, Link2, Search, Unlink } from "lucide-react";
import { useEffect, useState } from "react";

type SearchOrganisation = {
  id: string;
  name: string;
  slug: string;
  organisation_type: string;
  support_email?: string | null;
  support_phone?: string | null;
  organisation_branches?: Array<{ id: string; name: string; city: string | null }>;
};

type LinkedOrganisation = {
  id: string;
  organisation_id: string;
  label: string;
  method: string;
  identifier: string;
  membership_type: string;
  status: string;
  roster_entry_id?: string | null;
  org_roster_entries?: { status: string; valid_until: string | null } | null;
  place_address: string | null;
  organisations?: { name: string; organisation_type: string };
  organisation_branches?: { name: string; city: string | null } | null;
};

type ValidateCode = "LINKED" | "PENDING_APPROVAL" | "NOT_ELIGIBLE" | "EXPIRED" | "ALREADY_CLAIMED" | "RATE_LIMITED";
const VALIDATION_COPY: Record<ValidateCode, string> = {
  LINKED: "Organisation linked. You are covered by your organisation.",
  PENDING_APPROVAL: "Request submitted. Waiting for organisation approval.",
  NOT_ELIGIBLE: "We could not confirm eligibility. Contact your organisation or request approval.",
  EXPIRED: "This roster access entry has expired. Contact your organisation.",
  ALREADY_CLAIMED: "This identifier has already been claimed. Contact your organisation.",
  RATE_LIMITED: "Too many attempts right now. Please wait and try again.",
};

export default function AccountOrganisationsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchOrganisation[]>([]);
  const [selected, setSelected] = useState<SearchOrganisation | null>(null);
  const [branchId, setBranchId] = useState("");
  const [identifierType, setIdentifierType] = useState<"email" | "member_id" | "access_code">("email");
  const [identifier, setIdentifier] = useState("");
  const [label, setLabel] = useState<"work" | "school" | "home" | "other">("work");
  const [placeAddress, setPlaceAddress] = useState("");
  const [linked, setLinked] = useState<LinkedOrganisation[]>([]);
  const [message, setMessage] = useState("");
  const [validationCode, setValidationCode] = useState<ValidateCode | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editLabel, setEditLabel] = useState<"work" | "school" | "home" | "other">("work");
  const [editIdentifier, setEditIdentifier] = useState("");
  const [editPlaceAddress, setEditPlaceAddress] = useState("");

  async function refreshLinked() {
    const response = await fetch("/api/account/organisations/link", { cache: "no-store" });
    const body = await response.json().catch(() => []);
    if (response.ok) setLinked(body as LinkedOrganisation[]);
  }

  useEffect(() => { void refreshLinked(); }, []);

  useEffect(() => {
    const next = query.trim();
    if (next.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/account/organisations/search?q=${encodeURIComponent(next)}`, { cache: "no-store" });
      const body = await response.json().catch(() => []);
      if (response.ok) setResults(body as SearchOrganisation[]);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function linkOrganisation(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    setMessage("");
    setValidationCode(null);
    const response = await fetch("/api/org-links/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: selected.id,
        branchId: branchId || null,
        label,
        identifierType,
        identifier,
        placeAddress: placeAddress || null,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.message ?? "Could not link organisation.");
      setBusy(false);
      return;
    }
    const code = String((body as any)?.code ?? "NOT_ELIGIBLE") as ValidateCode;
    setValidationCode(code);
    setMessage(VALIDATION_COPY[code] ?? "Linking completed.");
    if (code === "LINKED" || code === "PENDING_APPROVAL") {
      setQuery("");
      setResults([]);
      setSelected(null);
      setIdentifier("");
      setPlaceAddress("");
      await refreshLinked();
    }
    setBusy(false);
  }

  async function unlinkOrganisation(organisationId: string) {
    setBusy(true);
    setError("");
    const response = await fetch("/api/account/organisations/link", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId }),
    });
    if (!response.ok) setError("Could not unlink organisation.");
    await refreshLinked();
    setBusy(false);
  }

  async function saveEdit(organisationId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/account/organisations/link", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId,
        label: editLabel,
        identifier: editIdentifier,
        placeAddress: editPlaceAddress || null,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not update linked organisation.");
      setBusy(false);
      return;
    }
    setMessage("Linked organisation updated.");
    setEditingId("");
    await refreshLinked();
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Profile</p>
        <h1 className="page-title mt-1 flex items-center gap-2"><Building2 size={24} />My organisations</h1>
        <p className="muted text-sm mt-2">Link school/work/home organisations to route alerts to the right branch.</p>
      </header>

      <section className="panel p-5 space-y-4">
        <h2 className="pane-head flex items-center gap-2"><Search size={18} />Add organisation</h2>
        <label className="field">Find by name<input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing organisation name..." /></label>
        {results.length > 0 && (
          <div className="space-y-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2">
            {results.map((organisation) => (
              <button
                key={organisation.id}
                type="button"
                className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-1)] px-3 py-2 text-left text-[var(--text)] transition hover:bg-[var(--surface-3)]"
                onClick={() => {
                  setSelected(organisation);
                  setBranchId(organisation.organisation_branches?.[0]?.id ?? "");
                  setResults([]);
                  setQuery(organisation.name);
                }}
              >
                <span className="font-semibold text-[var(--text)]">{organisation.name}</span>
                <span className="mt-1 block text-[11px] text-[var(--muted)]">{organisation.organisation_type} · {(organisation.organisation_branches ?? []).length} branches</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <form className="space-y-3 border-t border-[var(--line)] pt-3" onSubmit={(event) => void linkOrganisation(event)}>
            <p className="text-sm text-[var(--text)]">Selected: <b>{selected.name}</b></p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="field">Relationship
                <select className="input" value={label} onChange={(event) => setLabel(event.target.value as any)}>
                  <option value="work">Work</option>
                  <option value="school">School</option>
                  <option value="home">Home</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="field">Branch
                <select className="input" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                  <option value="">Select branch</option>
                  {(selected.organisation_branches ?? []).map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}{branch.city ? ` · ${branch.city}` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="field">Identifier type
                <select className="input" value={identifierType} onChange={(event) => setIdentifierType(event.target.value as "email" | "member_id" | "access_code")}>
                  <option value="email">Email</option>
                  <option value="member_id">Member / student / work ID</option>
                  <option value="access_code">Access code</option>
                </select>
              </label>
              <label className="field">{identifierType === "email" ? "Email address" : identifierType === "member_id" ? "Member / student / work ID" : "Access code"}
                <input className="input" required type={identifierType === "email" ? "email" : "text"} value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
              </label>
            </div>
            <label className="field">Place address (optional)<input className="input" value={placeAddress} onChange={(event) => setPlaceAddress(event.target.value)} placeholder="Campus, office, residence..." /></label>
            <button className="btn btn-primary" disabled={busy || !branchId}><Link2 size={16} />Link organisation</button>
          </form>
        )}
      </section>

      <section className="panel p-4 space-y-3">
        <h2 className="pane-head">Linked organisations</h2>
        {linked.length === 0 && <p className="muted text-sm">No organisations linked yet.</p>}
        <div className="space-y-2">
          {linked.map((item) => (
            <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 border border-[var(--line)] p-3 text-[var(--text)]">
              <div>
                <p className="font-semibold text-[var(--text)]">{item.organisations?.name}</p>
                <p className="muted text-xs capitalize">{item.label} · {item.membership_type} · {(() => {
                  if (item.status !== "active") return item.status.replaceAll("_", " ");
                  const entryStatus = item.org_roster_entries?.status;
                  if (entryStatus === "removed" || entryStatus === "suspended" || entryStatus === "expired") return `access ${entryStatus}`;
                  if (item.org_roster_entries?.valid_until && new Date(item.org_roster_entries.valid_until).getTime() < Date.now()) return "access expired";
                  if (!item.roster_entry_id) return "not roster verified";
                  return "active";
                })()}</p>
                <p className="muted text-xs">{item.method} · {item.identifier}</p>
                {item.organisation_branches?.name && <p className="muted text-xs">Branch: {item.organisation_branches.name}</p>}
                {editingId === item.id && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <label className="field">Relationship
                      <select className="input" value={editLabel} onChange={(event) => setEditLabel(event.target.value as "work" | "school" | "home" | "other")}>
                        <option value="work">Work</option>
                        <option value="school">School</option>
                        <option value="home">Home</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="field">Identifier
                      <input className="input" value={editIdentifier} onChange={(event) => setEditIdentifier(event.target.value)} />
                    </label>
                    <label className="field md:col-span-2">Place address
                      <input className="input" value={editPlaceAddress} onChange={(event) => setEditPlaceAddress(event.target.value)} placeholder="Campus, office, residence..." />
                    </label>
                    <div className="md:col-span-2 flex gap-2">
                      <button className="btn btn-primary" disabled={busy} onClick={() => void saveEdit(item.organisation_id)}>Save changes</button>
                      <button className="btn" disabled={busy} onClick={() => setEditingId("")}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(item.id);
                    setEditLabel(item.label as "work" | "school" | "home" | "other");
                    setEditIdentifier(item.identifier);
                    setEditPlaceAddress(item.place_address ?? "");
                  }}
                >
                  Edit
                </button>
                <button className="btn" disabled={busy} onClick={() => void unlinkOrganisation(item.organisation_id)}><Unlink size={15} />Unlink</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {error && <p role="alert" className="ops-login-error">{error}</p>}
      {message && <p role="status" className="ops-login-status">{message}</p>}
      {validationCode && validationCode !== "LINKED" && validationCode !== "PENDING_APPROVAL" && selected && (
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <p className="muted flex-1 text-sm">If you believe this is an error, your organisation can confirm your access or add you to its roster.</p>
          {selected.support_email && <a className="btn" href={`mailto:${encodeURIComponent(selected.support_email)}?subject=${encodeURIComponent(`Organisation access: ${selected.name}`)}`}>Contact your organisation</a>}
          {selected.support_phone && <a className="btn" href={`tel:${encodeURIComponent(selected.support_phone)}`}>Call organisation</a>}
        </div>
      )}
    </div>
  );
}
