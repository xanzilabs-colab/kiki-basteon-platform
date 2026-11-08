"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Plus, Search, Trash2, X } from "lucide-react";
import { BUSINESS_INDUSTRY_OPTIONS, INSTITUTION_KIND_OPTIONS, ORGANISATION_CATEGORY_OPTIONS, RESPONDER_CATEGORY_OPTIONS } from "@/lib/organisationCategories";

type Organisation = {
  id: string;
  name: string;
  slug: string;
  organisation_type: string;
  is_partner: boolean;
  institution_kind: string | null;
  business_category: string | null;
  responder_category: string | null;
  status: string;
  organisation_branches?: Array<{ id: string }>;
  organisation_memberships?: Array<{ id: string }>;
  blocked_until?: string | null;
  blocked_reason?: string | null;
};

type OrganisationDetail = {
  organisation: Organisation & { support_email?: string | null; support_phone?: string | null };
  owner: { userId: string; name: string | null } | null;
  counts: { members: number; responders: number; beneficiaries: number };
};

export default function AdminOrganisationsPage() {
  const [rows, setRows] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [generated, setGenerated] = useState<{ email: string; password: string } | null>(null);
  const [generatedCredentialPdfData, setGeneratedCredentialPdfData] = useState("");
  const [name, setName] = useState("");
  const [orgType, setOrgType] = useState<"institution" | "business" | "responder_partner">("responder_partner");
  const [category, setCategory] = useState(ORGANISATION_CATEGORY_OPTIONS[0]?.value ?? "other");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [isPartner, setIsPartner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<OrganisationDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [blockUntil, setBlockUntil] = useState("");
  const [blockReason, setBlockReason] = useState("Policy violation review");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [editForm, setEditForm] = useState({
    name: "",
    organisationType: "responder_partner" as "institution" | "business" | "responder_partner",
    category: "",
    supportEmail: "",
    supportPhone: "",
  });

  const categoryOptions = orgType === "institution"
    ? INSTITUTION_KIND_OPTIONS
    : orgType === "business"
      ? BUSINESS_INDUSTRY_OPTIONS
      : RESPONDER_CATEGORY_OPTIONS;
  const editCategoryOptions = editForm.organisationType === "institution"
    ? INSTITUTION_KIND_OPTIONS
    : editForm.organisationType === "business"
      ? BUSINESS_INDUSTRY_OPTIONS
      : RESPONDER_CATEGORY_OPTIONS;
  const visibleRows = rows.filter((row) => {
    const text = [row.name, row.slug, row.organisation_type, row.institution_kind, row.business_category, row.responder_category, row.status]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    setCategory(categoryOptions[0]?.value ?? "other");
  }, [orgType]);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/admin/organisations", { cache: "no-store" });
    const body = await response.json().catch(() => []);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not load organisations.");
      setLoading(false);
      return;
    }
    setRows(body as Organisation[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function openOrganisation(id: string) {
    setSelectedId(id);
    setDetailBusy(true);
    setOwnerPassword("");
    const response = await fetch(`/api/admin/organisations/${id}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not load organisation details.");
      setDetailBusy(false);
      return;
    }
    setDetail(body as OrganisationDetail);
    setEditingDetails(false);
    const organisation = (body as OrganisationDetail).organisation;
    const organisationType = organisation.organisation_type as typeof editForm.organisationType;
    setEditForm({
      name: organisation.name,
      organisationType,
      category: organisation.institution_kind || organisation.business_category || organisation.responder_category || "",
      supportEmail: organisation.support_email ?? "",
      supportPhone: organisation.support_phone ?? "",
    });
    setBlockUntil(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
    setDetailBusy(false);
  }

  async function saveOrganisationDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setDetailBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/organisations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_details",
          ...editForm,
          category: editForm.category || null,
          supportEmail: editForm.supportEmail || null,
          supportPhone: editForm.supportPhone || null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not update organisation details.");
        return;
      }
      setEditingDetails(false);
      setMessage("Organisation details updated.");
      await Promise.all([load(), openOrganisation(selectedId)]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update organisation details.");
    } finally {
      setDetailBusy(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setGenerated(null);
    setGeneratedCredentialPdfData("");
    try {
      const response = await fetch("/api/admin/organisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          organisationType: orgType,
          category: category || null,
          isPartner,
          ownerFullName,
          ownerEmail,
          ownerPhone: ownerPhone || null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError((body as any)?.error ?? "Could not create organisation.");
        return;
      }
      setGenerated((body as any).credentials ?? null);
      const base64 = (body as any).credentialPdfBase64;
      setGeneratedCredentialPdfData(typeof base64 === "string" ? `data:application/pdf;base64,${base64}` : "");
      setMessage("Organisation created.");
      setName("");
      setCategory("");
      setOwnerFullName("");
      setOwnerEmail("");
      setOwnerPhone("");
      setIsPartner(false);
      setShowCreate(false);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create organisation.");
    } finally {
      setBusy(false);
    }
  }

  async function blockOrganisation() {
    if (!selectedId || !blockUntil) return;
    setDetailBusy(true);
    const response = await fetch(`/api/admin/organisations/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "block", blockedUntil: new Date(blockUntil).toISOString(), reason: blockReason }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not block organisation.");
      setDetailBusy(false);
      return;
    }
    setMessage("Organisation temporarily blocked.");
    await Promise.all([load(), openOrganisation(selectedId)]);
    setDetailBusy(false);
  }

  async function unblockOrganisation() {
    if (!selectedId) return;
    setDetailBusy(true);
    const response = await fetch(`/api/admin/organisations/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unblock" }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not unblock organisation.");
      setDetailBusy(false);
      return;
    }
    setMessage("Organisation unblocked.");
    await Promise.all([load(), openOrganisation(selectedId)]);
    setDetailBusy(false);
  }

  async function resetOwnerPassword() {
    if (!selectedId) return;
    setDetailBusy(true);
    const response = await fetch(`/api/admin/organisations/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_owner_password" }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not reset owner password.");
      setDetailBusy(false);
      return;
    }
    setOwnerPassword((body as any).password ?? "");
    setMessage("Owner password reset.");
    setDetailBusy(false);
  }

  async function updatePartnerStatus(isPartner: boolean) {
    if (!selectedId) return;
    setPartnerBusy(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/organisations/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_partner", isPartner }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error ?? "Could not update partner status.");
      setPartnerBusy(false);
      return;
    }
    setDetail((current) => current ? {
      ...current,
      organisation: { ...current.organisation, is_partner: Boolean(body?.isPartner) },
    } : current);
    setMessage(isPartner ? "Organisation marked as a partner." : "Organisation removed from partner defaults.");
    await load();
    setPartnerBusy(false);
  }

  async function deleteOrganisation(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setDeleteBusy(true);
    setError("");
    const response = await fetch(`/api/admin/organisations/${selectedId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminPassword }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error ?? "Could not delete organisation.");
      setDeleteBusy(false);
      return;
    }
    setMessage("Organisation deleted.");
    setShowDeleteModal(false);
    setAdminPassword("");
    setSelectedId("");
    setDetail(null);
    await load();
    setDeleteBusy(false);
  }

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <h1>Organisations</h1>
          <p>Manage organisation accounts, responder partners and access.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => { setError(""); setShowCreate(true); }}>
          <Plus size={15} />Add organisation
        </button>
      </header>

      {error && !selectedId && !showCreate && <p className="admin-status admin-status-error" role="alert">{error}</p>}
      {message && <p className="admin-status admin-status-success" role="status">{message}</p>}
      {generated && (
        <div className="admin-status admin-status-success flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p>Generated owner credentials for <b>{generated.email}</b></p>
            <p className="admin-data">{generated.password}</p>
          </div>
          {generatedCredentialPdfData && (
            <a className="btn" href={generatedCredentialPdfData} download={`basteon-org-owner-${Date.now()}.pdf`}>
              Download credentials
            </a>
          )}
        </div>
      )}

      <section className="admin-panel">
        <div className="admin-panel-header">
          <div><h2>Organisation directory</h2><p>{rows.length} {rows.length === 1 ? "organisation" : "organisations"}</p></div>
        </div>
        <div className="admin-toolbar">
          <label className="admin-search">
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search organisation or category" aria-label="Search organisations" />
          </label>
          <span className="admin-muted text-[13px]">{visibleRows.length} shown</span>
        </div>
        {loading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-9 animate-pulse rounded bg-[#eef0f3]" />)}</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Type</th><th>Partner</th><th>Category</th><th>Branches</th><th>Members</th><th>Status</th></tr></thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td><button className="admin-person-name" type="button" onClick={() => void openOrganisation(row.id)}>{row.name}</button></td>
                    <td>{row.organisation_type.replaceAll("_", " ")}</td>
                    <td><span className={`admin-pill ${row.is_partner ? "admin-pill-teal" : ""}`}>{row.is_partner ? "Partner" : "No"}</span></td>
                    <td className="admin-muted">{row.institution_kind || row.business_category || row.responder_category || "—"}</td>
                    <td className="admin-data">{row.organisation_branches?.length ?? 0}</td>
                    <td className="admin-data">{row.organisation_memberships?.length ?? 0}</td>
                    <td><span className={`admin-pill ${row.status === "active" ? "admin-pill-green" : "admin-pill-amber"}`}>{row.status}</span></td>
                  </tr>
                ))}
                {visibleRows.length === 0 && <tr><td colSpan={7}><div className="py-12 text-center"><b className="block text-[16px]">No organisations found</b><span className="admin-muted mt-1 block">Try another name, type or category.</span></div></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && (
        <BodyPortal>
          <div className="fixed inset-0 z-[1200]">
            <button className="admin-overlay" type="button" aria-label="Close add organisation form" onClick={() => setShowCreate(false)} />
            <aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="create-organisation-title">
              <header className="admin-drawer-header">
                <h2 id="create-organisation-title">Add organisation</h2>
                <button className="btn" type="button" aria-label="Close add organisation form" onClick={() => setShowCreate(false)}><X size={16} /></button>
              </header>
              <form className="admin-drawer-body" onSubmit={(event) => void create(event)}>
                <p className="admin-muted mb-5">Create an organisation and its owner account.</p>
                {error && <p className="admin-status admin-status-error mb-4" role="alert">{error}</p>}
                <div className="grid gap-4">
                  <label className="admin-field-wrap">Organisation name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} /></label>
                  <label className="admin-field-wrap">Type
                    <select value={orgType} onChange={(event) => setOrgType(event.target.value as typeof orgType)}>
                      <option value="institution">Institution</option><option value="business">Business / Company</option><option value="responder_partner">Responder Partner</option>
                    </select>
                  </label>
                  <label className="admin-field-wrap">Category / industry
                    <select value={category} onChange={(event) => setCategory(event.target.value)}>
                      {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="admin-field-wrap">Owner name<input required minLength={2} value={ownerFullName} onChange={(event) => setOwnerFullName(event.target.value)} /></label>
                  <label className="admin-field-wrap">Owner email<input required type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /></label>
                  <label className="admin-field-wrap">Owner phone<input value={ownerPhone} onChange={(event) => setOwnerPhone(event.target.value)} /></label>
                  <div className="admin-detail-card flex items-center justify-between gap-4">
                    <div><b className="block text-sm">Partner organisation</b><span>Mark this organisation as a responder partner.</span></div>
                    <button type="button" role="switch" aria-checked={isPartner} aria-label="Mark this organisation as a partner" className={`admin-toggle ${isPartner ? "is-on" : ""}`} onClick={() => setIsPartner((value) => !value)}><span /></button>
                  </div>
                </div>
                <div className="admin-drawer-footer -mx-[22px] mt-6">
                  <button className="btn" type="button" disabled={busy} onClick={() => setShowCreate(false)}>Cancel</button>
                  <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create organisation"}</button>
                </div>
              </form>
            </aside>
          </div>
        </BodyPortal>
      )}

      {selectedId && (
        <BodyPortal>
        <div className="fixed inset-0 z-[1200]">
          <button className="admin-overlay" type="button" aria-label="Close organisation details" onClick={() => { setSelectedId(""); setDetail(null); }} />
          <aside className="admin-drawer" style={{ width: "min(560px, 100%)" }}>
            <header className="admin-drawer-header">
              <div><p className="admin-muted text-xs">Organisation details</p><h2>{detail?.organisation?.name ?? "Loading…"}</h2></div>
              <button className="btn" type="button" aria-label="Close organisation details" onClick={() => { setSelectedId(""); setDetail(null); }}><X size={16} /></button>
            </header>
            <div className="admin-drawer-body">
          {error && <p className="admin-status admin-status-error mb-3" role="alert">{error}</p>}
          {detailBusy && <p className="muted mt-3">Loading details…</p>}
          {detail && (
            <div className="mt-4 space-y-4">
              <section className="panel p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold">Partner organisation</p>
                    <p className="muted text-xs">Hidden from Kiki search; used as an alert fallback when no linked organisation is available.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(detail.organisation.is_partner)}
                    aria-label="Partner organisation"
                    disabled={partnerBusy}
                    className={`admin-toggle ${detail.organisation.is_partner ? "is-on" : ""}`}
                    onClick={() => void updatePartnerStatus(!detail.organisation.is_partner)}
                  ><span /></button>
                </div>
                <p className="text-sm">Owner: <b>{detail.owner?.name ?? "—"}</b></p>
                <p className="text-sm">Support email: <b>{detail.organisation.support_email ?? "—"}</b></p>
                <p className="text-sm">Support phone: <b>{detail.organisation.support_phone ?? "—"}</b></p>
                <button className="btn" type="button" disabled={detailBusy} onClick={() => setEditingDetails((editing) => !editing)}>
                  {editingDetails ? "Cancel organisation edit" : "Edit organisation details"}
                </button>
                {editingDetails && (
                  <form className="mt-3 grid gap-3" onSubmit={(event) => void saveOrganisationDetails(event)}>
                    <label className="field">Organisation name<input className="input" required minLength={2} value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
                    <label className="field">Type
                      <select
                        className="input"
                        value={editForm.organisationType}
                        onChange={(event) => {
                          const organisationType = event.target.value as typeof editForm.organisationType;
                          const options = organisationType === "institution" ? INSTITUTION_KIND_OPTIONS : organisationType === "business" ? BUSINESS_INDUSTRY_OPTIONS : RESPONDER_CATEGORY_OPTIONS;
                          setEditForm({ ...editForm, organisationType, category: options[0]?.value ?? "" });
                        }}
                      >
                        <option value="institution">Institution</option><option value="business">Business / Company</option><option value="responder_partner">Responder Partner</option>
                      </select>
                    </label>
                    <label className="field">Category / industry
                      <select className="input" value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}>
                        {editCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="field">Support email<input className="input" type="email" value={editForm.supportEmail} onChange={(event) => setEditForm({ ...editForm, supportEmail: event.target.value })} /></label>
                    <label className="field">Support phone<input className="input" value={editForm.supportPhone} onChange={(event) => setEditForm({ ...editForm, supportPhone: event.target.value })} /></label>
                    <button className="btn btn-primary w-fit" type="submit" disabled={detailBusy}>{detailBusy ? "Saving…" : "Save organisation"}</button>
                  </form>
                )}
                <div className="admin-detail-grid mt-4">
                  <div className="admin-detail-card"><span>Members</span><strong>{detail.counts.members}</strong></div>
                  <div className="admin-detail-card"><span>Responders</span><strong>{detail.counts.responders}</strong></div>
                  <div className="admin-detail-card"><span>Beneficiaries</span><strong>{detail.counts.beneficiaries}</strong></div>
                </div>
              </section>

              <section className="panel p-4 space-y-3">
                <h3 className="font-semibold">Temporary account block</h3>
                <label className="field">Blocked until<input className="input" type="datetime-local" value={blockUntil} onChange={(event) => setBlockUntil(event.target.value)} /></label>
                <label className="field">Reason<input className="input" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} /></label>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-danger" type="button" disabled={detailBusy} onClick={() => void blockOrganisation()}>Block organisation</button>
                  <button className="btn" type="button" disabled={detailBusy} onClick={() => void unblockOrganisation()}>Unblock organisation</button>
                </div>
                <p className="muted text-xs">While blocked, organisation dashboards show a lock notice and no services are available.</p>
              </section>

              <section className="panel p-4 space-y-3">
                <h3 className="font-semibold">Owner account controls</h3>
                <button className="btn btn-primary" type="button" disabled={detailBusy} onClick={() => void resetOwnerPassword()}>Generate new owner password</button>
                {ownerPassword && <p className="text-sm">New password: <b>{ownerPassword}</b></p>}
              </section>
              <section className="panel border border-[var(--crit)] p-4 space-y-3">
                <h3 className="font-semibold text-[var(--crit)]">Danger zone</h3>
                <p className="muted text-sm">Permanently delete this organisation and its organisation-linked records. This cannot be undone.</p>
                <button className="btn btn-danger" type="button" onClick={() => { setAdminPassword(""); setShowDeleteModal(true); }}>
                  <Trash2 size={16} />Delete organisation
                </button>
              </section>
            </div>
          )}
            </div>
          </aside>
        </div>
        </BodyPortal>
      )}
      {showDeleteModal && selectedId && (
        <BodyPortal>
        <div
          className="fixed inset-0 z-[1300] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleteBusy) setShowDeleteModal(false);
          }}
        >
          <section
            className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-organisation-title"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--crit-bg)] text-[var(--crit)]">
              <Trash2 size={22} />
            </div>
            <h2 id="delete-organisation-title" className="text-lg font-bold">Delete {detail?.organisation?.name ?? "organisation"}?</h2>
            <p className="muted mt-2 text-sm">This permanently removes the organisation and its linked records. Enter your admin control password to confirm.</p>
            {error && <p className="admin-status admin-status-error mt-3" role="alert">{error}</p>}
            <form className="mt-5 space-y-4" onSubmit={(event) => void deleteOrganisation(event)}>
              <label className="field">Admin control password
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button className="btn" type="button" disabled={deleteBusy} onClick={() => setShowDeleteModal(false)}>Cancel</button>
                <button className="btn btn-danger" type="submit" disabled={deleteBusy || !adminPassword}>
                  {deleteBusy ? "Deleting…" : "Confirm permanent deletion"}
                </button>
              </div>
            </form>
          </section>
        </div>
        </BodyPortal>
      )}
    </div>
  );
}

function BodyPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(<div className="admin-theme">{children}</div>, document.body) : null;
}
