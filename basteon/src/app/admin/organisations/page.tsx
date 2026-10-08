"use client";

import { useEffect, useState } from "react";
import { Building2, Plus } from "lucide-react";
import { BUSINESS_INDUSTRY_OPTIONS, INSTITUTION_KIND_OPTIONS, ORGANISATION_CATEGORY_OPTIONS, RESPONDER_CATEGORY_OPTIONS } from "@/lib/organisationCategories";

type Organisation = {
  id: string;
  name: string;
  slug: string;
  organisation_type: string;
  institution_kind: string | null;
  business_category: string | null;
  responder_category: string | null;
  status: string;
  organisation_branches?: Array<{ id: string }>;
  organisation_memberships?: Array<{ id: string }>;
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

  const categoryOptions = orgType === "institution"
    ? INSTITUTION_KIND_OPTIONS
    : orgType === "business"
      ? BUSINESS_INDUSTRY_OPTIONS
      : RESPONDER_CATEGORY_OPTIONS;

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

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setGenerated(null);
    setGeneratedCredentialPdfData("");
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
      setBusy(false);
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
    await load();
    setBusy(false);
  }

  return (
    <div className="space-y-5 max-w-[1280px]">
      <div>
        <p className="eyebrow">Platform directory</p>
        <h1 className="page-title mt-1 flex items-center gap-2"><Building2 size={23} />Organisations</h1>
      </div>

      {error && <p className="ops-login-error" role="alert">{error}</p>}
      {message && <p className="ops-login-status" role="status">{message}</p>}
      {generated && (
        <div className="panel p-4">
          <p className="text-sm">Generated owner credentials:</p>
          <p className="text-sm"><b>{generated.email}</b></p>
          <p className="text-sm"><b>{generated.password}</b></p>
          {generatedCredentialPdfData && (
            <a className="btn mt-3 inline-flex w-fit" href={generatedCredentialPdfData} download={`basteon-org-owner-${Date.now()}.pdf`}>
              Download credential PDF
            </a>
          )}
        </div>
      )}

      <section className="panel p-4 space-y-3">
        <h2 className="pane-head flex items-center gap-2"><Plus size={18} />Add organisation / responder partner</h2>
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => void create(event)}>
          <label className="field">Organisation name<input className="input" required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field">Type
            <select className="input" value={orgType} onChange={(event) => setOrgType(event.target.value as any)}>
              <option value="institution">Institution</option>
              <option value="business">Business / Company</option>
              <option value="responder_partner">Responder Partner</option>
            </select>
          </label>
          <label className="field">Category / industry
            <select className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">Owner name<input className="input" required value={ownerFullName} onChange={(event) => setOwnerFullName(event.target.value)} /></label>
          <label className="field">Owner email<input className="input" required type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /></label>
          <label className="field">Owner phone<input className="input" value={ownerPhone} onChange={(event) => setOwnerPhone(event.target.value)} /></label>
          <label className="field md:col-span-2">
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
              <input type="checkbox" checked={isPartner} onChange={(event) => setIsPartner(event.target.checked)} />
              Mark this organisation as our responder partner
            </span>
          </label>
          <button className="btn btn-primary self-end" disabled={busy}>Create organisation</button>
        </form>
      </section>

      <section className="tbl-wrap">
        {loading ? (
          <div className="p-4">Loading organisations...</div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Type</th><th>Category</th><th>Branches</th><th>Members</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.organisation_type}</td>
                  <td>{row.institution_kind || row.business_category || row.responder_category || "—"}</td>
                  <td>{row.organisation_branches?.length ?? 0}</td>
                  <td>{row.organisation_memberships?.length ?? 0}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
