"use client";

import { useEffect, useMemo, useState } from "react";
import { LifeBuoy, Plus, Settings2 } from "lucide-react";

type SupportContact = {
  id: string;
  contact_name: string;
  contact_type: "email" | "phone";
  contact_value: string;
  purpose: string;
  active: boolean;
};

export default function AdminSettingsPage() {
  const [rows, setRows] = useState<SupportContact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"email" | "phone">("email");
  const [value, setValue] = useState("");
  const [purpose, setPurpose] = useState("general support");
  const [purposeFilter, setPurposeFilter] = useState("all");

  const purposeOptions = useMemo(
    () => ["all", ...Array.from(new Set(rows.map((row) => row.purpose))).sort()],
    [rows],
  );

  async function load() {
    setBusy(true);
    const response = await fetch("/api/admin/support-contacts", { cache: "no-store" });
    const body = await response.json().catch(() => []);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not load support contacts.");
      setBusy(false);
      return;
    }
    setRows(body as SupportContact[]);
    setBusy(false);
  }

  useEffect(() => { void load(); }, []);

  async function addContact(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/admin/support-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactName: name,
        contactType: type,
        contactValue: value,
        purpose,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not add support contact.");
      setBusy(false);
      return;
    }
    setName("");
    setValue("");
    setPurpose("general support");
    setMessage("Support contact added.");
    await load();
  }

  async function setActive(id: string, active: boolean) {
    setBusy(true);
    const response = await fetch("/api/admin/support-contacts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not update contact.");
      setBusy(false);
      return;
    }
    await load();
  }

  async function removeContact(id: string) {
    setBusy(true);
    const response = await fetch("/api/admin/support-contacts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not remove contact.");
      setBusy(false);
      return;
    }
    await load();
  }

  const filteredRows = purposeFilter === "all" ? rows : rows.filter((row) => row.purpose === purposeFilter);

  return (
    <div className="space-y-5 max-w-[1280px]">
      <div>
        <p className="eyebrow">Admin settings</p>
        <h1 className="page-title mt-1 flex items-center gap-2"><Settings2 size={22} />Settings</h1>
      </div>
      {error && <p className="ops-login-error">{error}</p>}
      {message && <p className="ops-login-status">{message}</p>}

      <section className="panel p-4 space-y-3">
        <h2 className="pane-head flex items-center gap-2"><Plus size={18} />Support contacts</h2>
        <form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => void addContact(event)}>
          <label className="field">Person<input className="input" required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field">Type
            <select className="input" value={type} onChange={(event) => setType(event.target.value as "email" | "phone")}>
              <option value="email">email</option>
              <option value="phone">phone</option>
            </select>
          </label>
          <label className="field">Contact value<input className="input" required value={value} onChange={(event) => setValue(event.target.value)} /></label>
          <label className="field">Role / purpose<input className="input" required value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
          <button className="btn btn-primary md:col-span-4 md:justify-self-start" disabled={busy}>Add support contact</button>
        </form>
      </section>

      <section className="panel p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="pane-head flex items-center gap-2"><LifeBuoy size={18} />Support directory</h2>
          <label className="field">
            <span className="muted text-xs">Filter by role / purpose</span>
            <select className="input h-8 text-[12px]" value={purposeFilter} onChange={(event) => setPurposeFilter(event.target.value)}>
              {purposeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Purpose</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.contact_name}</td>
                  <td>{row.contact_type}</td>
                  <td>{row.contact_value}</td>
                  <td>{row.purpose}</td>
                  <td>{row.active ? "active" : "inactive"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn" type="button" disabled={busy} onClick={() => void setActive(row.id, !row.active)}>{row.active ? "Deactivate" : "Activate"}</button>
                      <button className="btn" type="button" disabled={busy} onClick={() => void removeContact(row.id)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && <tr><td colSpan={6} className="muted text-center">No support contacts found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
