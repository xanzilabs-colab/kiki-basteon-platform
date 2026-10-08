"use client";

import { Building2, Link2, Search, Unlink } from "lucide-react";
import { useEffect, useState } from "react";

type SearchOrganisation = {
  id: string;
  name: string;
  slug: string;
  organisation_type: string;
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
  place_address: string | null;
  organisations?: { name: string; organisation_type: string };
  organisation_branches?: { name: string; city: string | null } | null;
};

export default function AccountOrganisationsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchOrganisation[]>([]);
  const [selected, setSelected] = useState<SearchOrganisation | null>(null);
  const [branchId, setBranchId] = useState("");
  const [method, setMethod] = useState<"email_domain" | "work_id">("email_domain");
  const [identifier, setIdentifier] = useState("");
  const [label, setLabel] = useState<"work" | "school" | "home" | "other">("work");
  const [placeAddress, setPlaceAddress] = useState("");
  const [linked, setLinked] = useState<LinkedOrganisation[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    const response = await fetch("/api/account/organisations/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: selected.id,
        branchId: branchId || null,
        label,
        method,
        identifier,
        placeAddress: placeAddress || null,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not link organisation.");
      setBusy(false);
      return;
    }
    setMessage("Organisation linked.");
    setQuery("");
    setResults([]);
    setSelected(null);
    setIdentifier("");
    setPlaceAddress("");
    await refreshLinked();
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
                className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-1)] px-3 py-2 text-left transition hover:bg-[var(--surface-3)]"
                onClick={() => {
                  setSelected(organisation);
                  setBranchId(organisation.organisation_branches?.[0]?.id ?? "");
                  setResults([]);
                  setQuery(organisation.name);
                }}
              >
                <span className="font-semibold">{organisation.name}</span>
                <span className="mt-1 block text-[11px] text-[var(--muted)]">{organisation.organisation_type} · {(organisation.organisation_branches ?? []).length} branches</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <form className="space-y-3 border-t border-[var(--line)] pt-3" onSubmit={(event) => void linkOrganisation(event)}>
            <p className="text-sm">Selected: <b>{selected.name}</b></p>
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
              <label className="field">Link method
                <select className="input" value={method} onChange={(event) => setMethod(event.target.value as any)}>
                  <option value="email_domain">Email / domain</option>
                  <option value="work_id">Work / student ID</option>
                </select>
              </label>
              <label className="field">{method === "email_domain" ? "Email address" : "Work / student ID"}
                <input className="input" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
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
            <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 border border-[var(--line)] p-3">
              <div>
                <p className="font-semibold">{item.organisations?.name}</p>
                <p className="muted text-xs capitalize">{item.label} · {item.membership_type} · {item.status}</p>
                <p className="muted text-xs">{item.method} · {item.identifier}</p>
                {item.organisation_branches?.name && <p className="muted text-xs">Branch: {item.organisation_branches.name}</p>}
              </div>
              <button className="btn" disabled={busy} onClick={() => void unlinkOrganisation(item.organisation_id)}><Unlink size={15} />Unlink</button>
            </article>
          ))}
        </div>
      </section>

      {error && <p role="alert" className="ops-login-error">{error}</p>}
      {message && <p role="status" className="ops-login-status">{message}</p>}
    </div>
  );
}
