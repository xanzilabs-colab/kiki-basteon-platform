"use client";

import { useEffect, useState } from "react";
import type { Profile } from "@/lib/types";
import { UserTable } from "@/components/UserTable";

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const refresh = async () => { setLoading(true); setError(""); try { const response = await fetch("/api/admin/users", { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not load users."); setUsers(body as Profile[]); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Could not load users."); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  return <div className="space-y-4"><div><p className="eyebrow">Access control</p><h1 className="page-title mt-1">Users</h1></div>{error && <div role="alert" className="border border-[#6b2b32] bg-[rgb(255_77_90/.08)] p-3 text-sm text-[var(--crit)]">Could not load users: {error}</div>}{loading ? <div className="tbl-wrap p-4 space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-8 bg-[var(--surface-2)] animate-pulse" />)}</div> : <UserTable users={users} refresh={refresh} />}</div>;
}