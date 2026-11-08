"use client";

import { useEffect, useState } from "react";
import type { Profile } from "@/lib/types";
import { UserTable } from "@/components/UserTable";

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load users.");
      setUsers(body as Profile[]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <h1>Users</h1>
          <p>Everyone with access to the platform, and the role they hold.</p>
        </div>
      </header>

      {error && <div role="alert" className="admin-status admin-status-error">{error}</div>}

      {loading ? (
        <section className="admin-panel">
          <div className="admin-panel-header"><div><h2>All users</h2><p>Loading accounts</p></div></div>
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-[#eef0f3]" />
            ))}
          </div>
        </section>
      ) : (
        <UserTable users={users} refresh={refresh} />
      )}
    </div>
  );
}