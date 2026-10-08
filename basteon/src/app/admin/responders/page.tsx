"use client";

import { useEffect, useMemo, useState } from "react";
import { Siren } from "lucide-react";

type Organisation = {
  id: string;
  name: string;
  organisation_type: string;
  responder_category: string | null;
  organisation_branches?: Array<{ id: string; name: string }>;
  organisation_memberships?: Array<{ id: string }>;
};

export default function AdminRespondersPage() {
  const [rows, setRows] = useState<Organisation[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/admin/organisations", { cache: "no-store" });
    const body = await response.json().catch(() => []);
    if (!response.ok) {
      setError((body as any)?.error ?? "Could not load responder partners.");
      setLoading(false);
      return;
    }
    setRows(body as Organisation[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const responderRows = useMemo(
    () => rows.filter((row) => row.organisation_type === "responder_partner" || !!row.responder_category),
    [rows],
  );

  return (
    <div className="space-y-5 max-w-[1280px]">
      <div>
        <p className="eyebrow">Dispatch network</p>
        <h1 className="page-title mt-1 flex items-center gap-2"><Siren size={24} />Responder Partners</h1>
      </div>

      {error && <p className="ops-login-error" role="alert">{error}</p>}

      <section className="tbl-wrap">
        {loading ? (
          <div className="p-4">Loading partners...</div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Partner</th><th>Category</th><th>Branches</th><th>Responder accounts</th></tr></thead>
            <tbody>
              {responderRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.responder_category || "Responder"}</td>
                  <td>{row.organisation_branches?.length ?? 0}</td>
                  <td>{row.organisation_memberships?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
