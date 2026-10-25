"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import "./organisationsPortal.css";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  Check,
  ChevronRight,
  GraduationCap,
  Home,
  Link2,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  Search,
  Unlink,
  X,
} from "lucide-react";

type Branch = { id: string; name: string; city: string | null };
type SearchOrganisation = {
  id: string;
  name: string;
  slug: string;
  organisation_type: string;
  support_email?: string | null;
  support_phone?: string | null;
  organisation_branches?: Branch[];
};
type LinkedOrganisation = {
  id: string;
  organisation_id: string;
  label: "work" | "school" | "home" | "other";
  method: string;
  identifier: string;
  membership_type: string;
  status: string;
  roster_entry_id?: string | null;
  org_roster_entries?: { status: string; valid_until: string | null } | null;
  place_address: string | null;
  organisations?: {
    name: string;
    organisation_type: string;
    support_email?: string | null;
    support_phone?: string | null;
  };
  organisation_branches?: Branch | null;
};
type LinkCode = "LINKED" | "PENDING_APPROVAL" | "NOT_ELIGIBLE" | "EXPIRED" | "ALREADY_CLAIMED" | "RATE_LIMITED";
type SheetState =
  | { type: "link"; stage: "form" | "fail"; organisation: SearchOrganisation; code?: LinkCode; detail?: string }
  | { type: "manage"; stage: "form" | "confirm"; organisation: LinkedOrganisation };
type Relationship = "work" | "school" | "home" | "other";
type IdentifierType = "email" | "member_id" | "access_code";

const validationCopy: Record<LinkCode, string> = {
  LINKED: "Organisation linked. You are covered by your organisation.",
  PENDING_APPROVAL: "Your request is waiting for organisation approval.",
  NOT_ELIGIBLE: "We could not confirm eligibility. Contact your organisation or request approval.",
  EXPIRED: "This roster access has expired. Contact your organisation.",
  ALREADY_CLAIMED: "This identifier is already in use. Contact your organisation.",
  RATE_LIMITED: "Too many attempts right now. Please wait and try again.",
};
const relationshipOptions: Array<{ value: Relationship; label: string; Icon: typeof Home }> = [
  { value: "school", label: "School", Icon: GraduationCap },
  { value: "work", label: "Work", Icon: Briefcase },
  { value: "home", label: "Home", Icon: Home },
];

function initials(name: string) {
  return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
}

function getLinkStatus(item: LinkedOrganisation) {
  const entry = item.org_roster_entries;
  if (entry?.status === "removed" || entry?.status === "suspended" || entry?.status === "expired") {
    const label = entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
    const detail = entry.status === "removed"
      ? "This organisation removed your access from its roster."
      : `This organisation's roster access is ${entry.status}.`;
    return { label: `Access ${label.toLowerCase()}`, tone: entry.status === "expired" ? "warn" : "bad", detail };
  }
  if (entry?.valid_until && new Date(entry.valid_until).getTime() < Date.now()) {
    return { label: "Access expired", tone: "warn", detail: "This roster access has passed its expiry date." };
  }
  if (item.status !== "active") {
    const label = item.status.replaceAll("_", " ");
    return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: item.status === "pending" ? "warn" : "bad", detail: "This organisation link is not currently active." };
  }
  if (!item.roster_entry_id) {
    return { label: "Not on roster yet", tone: "warn", detail: "Ask this organisation to add you to its roster." };
  }
  return { label: "Linked", tone: "ok", detail: `Alerts route to ${item.organisation_branches?.name ?? "your organisation"}.` };
}

export default function AccountOrganisationsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchOrganisation[]>([]);
  const [linked, setLinked] = useState<LinkedOrganisation[]>([]);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [relationship, setRelationship] = useState<Relationship>("school");
  const [identifierType, setIdentifierType] = useState<IdentifierType>("member_id");
  const [identifier, setIdentifier] = useState("");
  const [branchId, setBranchId] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [editRelationship, setEditRelationship] = useState<Relationship>("work");
  const [editAddress, setEditAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [toastIsError, setToastIsError] = useState(false);
  const linkedSection = useRef<HTMLElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);

  const refreshLinked = useCallback(async () => {
    const response = await fetch("/api/account/organisations/link", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Could not load your organisations.");
    setLinked(Array.isArray(body) ? body as LinkedOrganisation[] : []);
  }, []);

  useEffect(() => {
    void refreshLinked().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load your organisations."))
      .finally(() => setLoading(false));
  }, [refreshLinked]);

  useEffect(() => {
    const search = query.trim();
    if (search.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/account/organisations/search?q=${encodeURIComponent(search)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Organisation search is unavailable.");
          if (!controller.signal.aborted) setResults(Array.isArray(body) ? body as SearchOrganisation[] : []);
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Organisation search is unavailable.");
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!error) return;
    setToastIsError(true);
    setToast(error);
  }, [error]);

  useEffect(() => {
    if (!sheet) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSheet(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sheet]);

  function openLink(organisation: SearchOrganisation) {
    setRelationship("school");
    setIdentifierType("member_id");
    setIdentifier("");
    setBranchId(organisation.organisation_branches?.[0]?.id ?? "");
    setPlaceAddress("");
    setSheet({ type: "link", stage: "form", organisation });
    setError("");
  }

  async function linkOrganisation(event: React.FormEvent) {
    event.preventDefault();
    if (!sheet || sheet.type !== "link") return;
    const organisation = sheet.organisation;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/org-links/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: organisation.id,
          branchId: branchId || null,
          label: relationship,
          identifierType,
          identifier: identifier.trim(),
          placeAddress: placeAddress.trim() || null,
        }),
      });
      const body = await response.json().catch(() => null);
      const code = (body?.code ?? "NOT_ELIGIBLE") as LinkCode;
      if (!response.ok && code !== "RATE_LIMITED") throw new Error(body?.message ?? "Could not link organisation.");
      if (code === "LINKED" || code === "PENDING_APPROVAL") {
        setSheet(null);
        setQuery("");
        setResults([]);
        await refreshLinked();
        setError("");
        setToastIsError(false);
        setToast(code === "LINKED" ? `Linked to ${organisation.name}` : "Approval request submitted");
      } else {
        setSheet({ type: "link", stage: "fail", organisation, code, detail: body?.message });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not link organisation.");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkOrganisation(item: LinkedOrganisation) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/organisations/link", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId: item.organisation_id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not unlink organisation.");
      setSheet(null);
      await refreshLinked();
      setError("");
      setToastIsError(false);
      setToast("Organisation unlinked");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlink organisation.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(item: LinkedOrganisation) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/organisations/link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: item.organisation_id,
          label: editRelationship,
          placeAddress: editAddress.trim() || null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not update linked organisation.");
      setSheet(null);
      await refreshLinked();
      setError("");
      setToastIsError(false);
      setToast("Changes saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update linked organisation.");
    } finally {
      setBusy(false);
    }
  }

  function confirmUnlink(item: LinkedOrganisation) {
    setSheet({ type: "manage", stage: "confirm", organisation: item });
    setError("");
  }

  function openManage(item: LinkedOrganisation) {
    setEditRelationship(item.label);
    setEditAddress(item.place_address ?? "");
    setSheet({ type: "manage", stage: "form", organisation: item });
    setError("");
  }

  function contactLink(item: SearchOrganisation | LinkedOrganisation["organisations"], kind: "email" | "phone") {
    if (!item) return null;
    const value = kind === "email" ? item.support_email : item.support_phone;
    if (!value) return null;
    if (kind === "email") {
      const subject = encodeURIComponent(`Organisation access request: ${item.name}`);
      const body = encodeURIComponent(`Hello ${item.name},\n\nPlease help me verify or request access to this organisation in Kiki.`);
      return `mailto:${value}?subject=${subject}&body=${body}`;
    }
    return `tel:${value}`;
  }

  const searchTerm = query.trim();
  const activeSheet = sheet;
  const sheetLayer = activeSheet && <div className="org-sheet-layer">
    <button className="org-sheet-backdrop" type="button" aria-label="Close dialog" onClick={() => !busy && setSheet(null)} />
    <section className="org-sheet" role="dialog" aria-modal="true" aria-labelledby="org-sheet-title" onClick={(event) => event.stopPropagation()}>
      <div className="org-grabber" />
      <div className="org-sheet-content">
        {activeSheet.type === "link" && activeSheet.stage === "fail" ? (
          <>
            <div className="org-sheet-topline"><span /><button className="org-close" type="button" aria-label="Close" onClick={() => setSheet(null)}><X size={18} /></button></div>
            <div className="org-failure">
              <span className="org-failure-icon"><AlertTriangle size={31} /></span>
              <h2 id="org-sheet-title">{activeSheet.code === "RATE_LIMITED" ? "Please wait a moment" : "We couldn’t confirm you"}</h2>
              <p>{activeSheet.code ? validationCopy[activeSheet.code] : activeSheet.detail ?? validationCopy.NOT_ELIGIBLE} Ask the organisation to confirm your access or add you to its roster.</p>
              <div className="org-action-stack">
                {contactLink(activeSheet.organisation, "email") && <a className="org-button org-primary" href={contactLink(activeSheet.organisation, "email") ?? undefined}><Mail size={17} />Request approval</a>}
                {contactLink(activeSheet.organisation, "phone") && <a className="org-button org-tonal" href={contactLink(activeSheet.organisation, "phone") ?? undefined}><Phone size={17} />Call organisation</a>}
                <button className="org-button org-text-button" type="button" onClick={() => setSheet({ ...activeSheet, stage: "form", code: undefined, detail: undefined })}>Try a different ID</button>
              </div>
            </div>
          </>
        ) : activeSheet.type === "link" ? (
          <form onSubmit={(event) => void linkOrganisation(event)}>
            <div className="org-sheet-head">
              <span className="org-avatar">{initials(activeSheet.organisation.name)}</span>
              <span><b id="org-sheet-title">{activeSheet.organisation.name}</b><small>{activeSheet.organisation.organisation_type} · {(activeSheet.organisation.organisation_branches ?? []).length} {(activeSheet.organisation.organisation_branches ?? []).length === 1 ? "branch" : "branches"}</small></span>
              <button className="org-close" type="button" aria-label="Close" disabled={busy} onClick={() => setSheet(null)}><X size={18} /></button>
            </div>
            <div className="org-field">
              <label>Relationship</label>
              <div className="org-segment" role="group" aria-label="Relationship">
                {relationshipOptions.map(({ value, label, Icon }) => <button type="button" key={value} className={relationship === value ? "selected" : ""} aria-pressed={relationship === value} onClick={() => setRelationship(value)}><Icon size={17} />{label}</button>)}
              </div>
            </div>
            {activeSheet.organisation.organisation_branches && activeSheet.organisation.organisation_branches.length > 1 && <label className="org-field"><span>Branch</span>
              <select value={branchId} onChange={(event) => setBranchId(event.target.value)} required>
                <option value="">Choose branch</option>
                {activeSheet.organisation.organisation_branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.city ? ` · ${branch.city}` : ""}</option>)}
              </select>
            </label>}
            <label className="org-field" htmlFor="org-identifier-type"><span>Identifier type</span>
              <select id="org-identifier-type" value={identifierType} onChange={(event) => setIdentifierType(event.target.value as IdentifierType)}>
                <option value="member_id">Member / student / work ID</option>
                <option value="email">Email address</option>
                <option value="access_code">Access code</option>
              </select>
            </label>
            <label className="org-field" htmlFor="org-identifier"><span>{identifierType === "email" ? "Email address" : identifierType === "access_code" ? "Access code" : "Student or work ID"}</span>
              <input id="org-identifier" autoFocus autoComplete="off" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={identifierType === "email" ? "name@organisation.com" : identifierType === "access_code" ? "Enter your access code" : "Student, staff or member ID"} required minLength={2} />
              <small>Use the ID or email {activeSheet.organisation.name} knows you by.</small>
            </label>
            <label className="org-field" htmlFor="org-address"><span>Place address <em>· optional</em></span>
              <span className="org-input-with-icon"><MapPin size={18} /><input id="org-address" value={placeAddress} onChange={(event) => setPlaceAddress(event.target.value)} placeholder="Campus, office or residence" /></span>
            </label>
            {error && <p className="org-inline-error" role="alert">{error}</p>}
            <button className="org-button org-primary org-submit" type="submit" disabled={busy || identifier.trim().length < 2 || Boolean(activeSheet.organisation.organisation_branches?.length && !branchId)}><Link2 size={17} />{busy ? "Checking access…" : "Link organisation"}</button>
            <p className="org-privacy-note"><LockKeyhole size={16} /><span>Your identifier is checked against this organisation’s roster. It is not shown to other Kiki users.</span></p>
          </form>
        ) : activeSheet.stage === "confirm" ? (
          <div className="org-failure org-unlink-confirm">
            <span className="org-failure-icon danger"><Unlink size={30} /></span>
            <h2 id="org-sheet-title">Unlink {activeSheet.organisation.organisations?.name ?? "this organisation"}?</h2>
            <p>Alerts will stop routing to this organisation. You can link again at any time.</p>
            <div className="org-action-stack"><button className="org-button org-danger" type="button" disabled={busy} onClick={() => void unlinkOrganisation(activeSheet.organisation)}>{busy ? "Unlinking…" : "Unlink organisation"}</button><button className="org-button org-tonal" type="button" disabled={busy} onClick={() => setSheet({ ...activeSheet, stage: "form" })}>Keep linked</button></div>
            {error && <p className="org-inline-error" role="alert">{error}</p>}
          </div>
        ) : (
          <>
            <div className="org-sheet-head">
              <span className="org-avatar">{initials(activeSheet.organisation.organisations?.name ?? "Organisation")}</span>
              <span><b id="org-sheet-title">{activeSheet.organisation.organisations?.name ?? "Organisation"}</b><small>{activeSheet.organisation.organisation_branches?.name ?? activeSheet.organisation.membership_type} · {activeSheet.organisation.membership_type}</small></span>
              <button className="org-close" type="button" aria-label="Close" onClick={() => setSheet(null)}><X size={18} /></button>
            </div>
            {(() => {
              const status = getLinkStatus(activeSheet.organisation);
              return <div className={`org-status-panel ${status.tone}`}><span>{status.tone === "ok" ? <Check size={18} /> : <InfoIcon />}</span><div><b>{status.label === "Linked" ? "Linked and on roster" : status.label}</b><p>{status.detail}</p></div></div>;
            })()}
            <div className="org-field">
              <label>Relationship</label>
              <div className="org-segment" role="group" aria-label="Relationship">
                {relationshipOptions.map(({ value, label, Icon }) => <button type="button" key={value} className={editRelationship === value ? "selected" : ""} aria-pressed={editRelationship === value} onClick={() => setEditRelationship(value)}><Icon size={17} />{label}</button>)}
              </div>
            </div>
            <label className="org-field" htmlFor="org-existing-identifier"><span>Student or work ID</span><input id="org-existing-identifier" value={activeSheet.organisation.identifier} readOnly aria-readonly="true" /><small>Identifiers are fixed to the verified roster claim. Contact your organisation if this needs correcting.</small></label>
            <label className="org-field" htmlFor="org-existing-address"><span>Place address <em>· optional</em></span><span className="org-input-with-icon"><MapPin size={18} /><input id="org-existing-address" value={editAddress} onChange={(event) => setEditAddress(event.target.value)} placeholder="Campus, office or residence" /></span></label>
            <div className="org-action-stack">
              <button className="org-button org-primary org-submit" type="button" disabled={busy || (editRelationship === activeSheet.organisation.label && editAddress === (activeSheet.organisation.place_address ?? ""))} onClick={() => void saveEdit(activeSheet.organisation)}><Check size={17} />Save changes</button>
              <button className="org-button org-text-button" type="button" disabled={busy} onClick={() => setSheet({ ...activeSheet, stage: "confirm" })}><Unlink size={16} />Unlink organisation</button>
            </div>
            {error && <p className="org-inline-error" role="alert">{error}</p>}
            {(activeSheet.organisation.status !== "active" || getLinkStatus(activeSheet.organisation).tone !== "ok") && <div className="org-contact-row">
              {contactLink(activeSheet.organisation.organisations, "email") && <a className="org-button org-tonal org-small-button" href={contactLink(activeSheet.organisation.organisations, "email") ?? undefined}><Mail size={16} />Contact</a>}
              {contactLink(activeSheet.organisation.organisations, "phone") && <a className="org-button org-tonal org-small-button" href={contactLink(activeSheet.organisation.organisations, "phone") ?? undefined}><Phone size={16} />Call</a>}
            </div>}
          </>
        )}
      </div>
    </section>
  </div>;

  return (
    <>
      <div className="org-screen">
        <div className="org-page">
          <header className="org-page-header">
            <Link className="org-back" href="/account/profile"><ArrowLeft size={18} />Profile</Link>
            <span className="org-eyebrow">PROFILE</span>
            <h1><Building2 size={25} aria-hidden="true" />My organisations</h1>
            <p className="org-lede">Link school, work or home to route alerts to the right branch.</p>
          </header>

          <section className="org-add-card" aria-labelledby="org-add-title">
            <div className="org-card-heading">
              <h2 id="org-add-title"><Search size={16} aria-hidden="true" />Add organisation</h2>
              <span>Quick link</span>
            </div>
            <div className={`org-search${searchTerm ? " has-value" : ""}`}>
              <Search size={18} aria-hidden="true" />
              <input ref={queryInput} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find organisation by name…" autoComplete="off" aria-label="Find an organisation" />
              {searchTerm && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setResults([]); queryInput.current?.focus(); }}><X size={16} /></button>}
            </div>
            {searchTerm.length > 0 && searchTerm.length < 2 && <p className="org-search-note">Type at least 2 characters to search.</p>}
            {searchTerm.length >= 2 && (
              <div className="org-results org-group" role="listbox" aria-label="Organisation search results">
                {results.length > 0 ? results.map((organisation) => {
                  const alreadyLinked = linked.some((item) => item.organisation_id === organisation.id && item.status === "active");
                  return <button className="org-row" key={organisation.id} type="button" role="option" aria-selected={false} disabled={alreadyLinked} onClick={() => openLink(organisation)}>
                    <span className="org-avatar">{initials(organisation.name)}</span>
                    <span className="org-row-copy"><b>{organisation.name}</b><span>{organisation.organisation_type} · {(organisation.organisation_branches ?? []).length} {(organisation.organisation_branches ?? []).length === 1 ? "branch" : "branches"}</span></span>
                    {alreadyLinked ? <span className="org-tag">Linked</span> : <ChevronRight className="org-chevron" size={19} />}
                  </button>;
                }) : <p className="org-no-results">No match for “{searchTerm}”.<br />Check the spelling or contact your organisation.</p>}
              </div>
            )}
          </section>

          <section className="org-section" ref={linkedSection} aria-labelledby="org-linked-title">
            <div className="org-section-heading">
              <h2 id="org-linked-title">Linked organisations</h2>
              <span className="org-count">{linked.length} linked</span>
            </div>
            {loading && <div className="org-empty org-loading" role="status">Loading your organisations…</div>}
            {!loading && linked.length === 0 && (
              <div className="org-empty">
                <span className="org-empty-icon"><Building2 size={27} /></span>
                <h3>No organisations linked yet</h3>
                <p>Search above to link your university, campus or workplace and start routing alerts.</p>
                <button className="org-button org-primary org-find-button" type="button" onClick={() => { queryInput.current?.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Search size={16} />Find organisation</button>
              </div>
            )}
            <div className="org-linked-list">
              {linked.map((item) => {
                const status = getLinkStatus(item);
                const RelationIcon = item.label === "school" ? GraduationCap : item.label === "work" ? Briefcase : item.label === "home" ? Home : Building2;
                const organisationName = item.organisations?.name ?? "Organisation";
                return <article className="org-linked-card" key={item.id}>
                  <div className="org-linked-top">
                    <div className="org-linked-title">
                      <h3>{organisationName}</h3>
                      {status.tone === "ok"
                        ? <span className="org-active-status"><Check size={13} aria-hidden="true" />Link active</span>
                        : <span className={`org-chip ${status.tone}`}><i />{status.label}</span>}
                    </div>
                    <span className="org-linked-icon"><RelationIcon size={19} aria-hidden="true" /></span>
                  </div>
                  <p className="org-linked-meta">
                    <span>{item.label === "home" ? "Home / residence" : item.label.charAt(0).toUpperCase() + item.label.slice(1)}</span>
                    {item.organisation_branches?.name && <><span aria-hidden="true">·</span><span>{item.organisation_branches.name}</span></>}
                    <span aria-hidden="true">·</span>
                    <span>{item.membership_type}</span>
                  </p>
                  <dl className="org-details">
                    <div><dt>Identifier</dt><dd className="org-identifier">{item.identifier}</dd></div>
                    <div><dt>Place address</dt><dd>{item.place_address || "Add a campus, office or residence"}</dd></div>
                  </dl>
                  {status.tone !== "ok" && <div className={`org-verification ${status.tone}${item.status === "pending" ? " pending" : ""}`}>
                    <AlertTriangle size={17} aria-hidden="true" />
                    <div><b>{item.status === "pending" ? "Verification pending" : status.label}</b><p>{status.detail}</p>
                      <div className="org-support-actions">
                        {contactLink(item.organisations, "email") && <a href={contactLink(item.organisations, "email") ?? undefined}><Mail size={14} />Contact organisation</a>}
                        {contactLink(item.organisations, "phone") && <a href={contactLink(item.organisations, "phone") ?? undefined}><Phone size={14} />Call</a>}
                      </div>
                    </div>
                  </div>}
                  <div className="org-card-actions">
                    <button type="button" className="org-edit-button" onClick={() => openManage(item)}><span><Building2 size={15} />Edit details</span></button>
                    <button type="button" className="org-unlink-button" onClick={() => confirmUnlink(item)}><Unlink size={15} />Unlink</button>
                  </div>
                </article>;
              })}
            </div>
          </section>
        </div>
      </div>

      {typeof document !== "undefined" && sheetLayer ? createPortal(sheetLayer, document.body) : null}
      {typeof document !== "undefined" && toast ? createPortal(<div className={`org-toast${toastIsError ? " is-error" : ""}`} role={toastIsError ? "alert" : "status"}>{toastIsError ? <AlertTriangle size={17} /> : <Check size={17} />}{toast}</div>, document.body) : null}
    </>
  );
}

function InfoIcon() {
  return <span className="org-info-dot">i</span>;
}
