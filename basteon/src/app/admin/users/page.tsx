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
    <div className="space-y-5 max-w-[1280px]">
      <div>
        <p className="eyebrow">Access control</p>
        <h1 className="page-title mt-1">Users</h1>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-[var(--surface-2)] border-l-4 border-[var(--crit)] px-3 py-2.5 text-[12px] text-[var(--crit)]"
        >
          Could not load users — {error}
        </div>
      )}

      {loading ? (
        <div className="tbl-wrap">
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-8 bg-[var(--surface-2)] animate-pulse" />
            ))}
          </div>
        </div>
      ) : (
        <UserTable users={users} refresh={refresh} />
      )}
    </div>
  );
}