"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null); const [count, setCount] = useState<number | null>(null);
  useEffect(() => { const supabase = createClient(); void (async () => { const { data: { user } } = await supabase.auth.getUser(); if (!user) return; const [{ data: nextProfile }, { count: nextCount }] = await Promise.all([supabase.from("profiles").select("*").eq("id", user.id).single(), supabase.from("devices").select("id", { count: "exact", head: true })]); setProfile(nextProfile as Profile | null); setCount(nextCount ?? 0); })(); }, []);
  const complete = Boolean(profile?.full_name?.trim() && profile.phone?.trim());
  return <div className="space-y-4"><div><p className="eyebrow">My safety</p><h1 className="page-title mt-1">Account overview</h1></div>{!complete && <section className="panel p-4 border-[var(--warn)]"><p className="font-medium">Complete your profile before linking a device.</p><Link className="btn btn-primary inline-flex items-center mt-3" href="/account/profile">Complete profile</Link></section>}<section className="panel p-4"><p className="label">Linked devices</p><p className="text-3xl data mt-2">{count ?? "--"}</p><Link className="btn btn-primary inline-flex items-center mt-4" href={complete ? "/account/devices/link" : "/account/profile"}>Link a device</Link></section><section className="panel p-4"><p className="label">Profile</p><p className="muted text-xs mt-2">Your contact information is made available to authorised responders only when your device sends an alert.</p><Link className="btn inline-flex items-center mt-3" href="/account/profile">Manage profile</Link></section></div>;
}