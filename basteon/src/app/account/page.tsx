"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: nextProfile }, { count: nextCount }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("devices").select("id", { count: "exact", head: true }),
      ]);
      setProfile(nextProfile as Profile | null);
      setCount(nextCount ?? 0);
    })();
  }, []);

  const complete = Boolean(profile?.full_name?.trim() && profile.phone?.trim());

  return (
    <div className="space-y-5 max-w-[840px]">
      <div>
        <p className="eyebrow">My safety</p>
        <h1 className="page-title mt-1">Account overview</h1>
      </div>

      {!complete && (
        <section className="panel">
          <div className="border-l-4 border-[var(--warn)] p-5">
            <p className="font-medium">Complete your profile before linking a device.</p>
            <Link className="btn btn-primary mt-3" href="/account/profile">
              Complete profile
            </Link>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="pane-head"><span>Devices</span></div>
        <div className="p-6">
          <p className="label">Linked devices</p>
          <p className="data text-[32px] font-medium mt-2 leading-none">{count ?? "—"}</p>
          <Link
            className="btn btn-primary mt-5"
            href={complete ? "/account/devices/link" : "/account/profile"}
          >
            Link a device
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="pane-head"><span>Profile</span></div>
        <div className="p-6">
          <p className="muted text-[12px] leading-relaxed">
            Your contact information is made available to authorised responders only when your
            device sends an alert.
          </p>
          <Link className="btn mt-4" href="/account/profile">Manage profile</Link>
        </div>
      </section>
    </div>
  );
}