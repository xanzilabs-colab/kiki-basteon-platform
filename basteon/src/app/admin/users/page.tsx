"use client"; import { useEffect, useState } from "react"; import type { Profile } from "@/lib/types"; import { UserTable } from "@/components/UserTable";
export default function UsersPage() { const [users, setUsers] = useState<Profile[]>([]); const refresh = async () => { const response = await fetch("/api/admin/users"); if (response.ok) setUsers(await response.json()); }; useEffect(() => { void refresh(); }, []); return (
  <div className="space-y-4">
    <div><p className="eyebrow">Access control</p><h1 className="page-title mt-1">Users</h1></div>
    <UserTable users={users} refresh={refresh} />
  </div>
); }