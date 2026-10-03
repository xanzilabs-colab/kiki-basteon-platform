"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  if (!now) return null;
  return (
    <div className="clock hidden sm:flex" aria-label="Current time">
      <span className="clock-time">{now.toLocaleTimeString("en-ZA", { hour12: false })}</span>
      <span className="clock-date">
        {now.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}
      </span>
    </div>
  );
}

export function Navbar({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  return (
    <header className="appbar">
      <div className="brand">
        <span className="mark">B</span>
        <span>BASTEON</span>
      </div>

      <div className="context hidden sm:flex">
        <b>Response console</b>
        <span>Incident dispatch</span>
      </div>

      <div className="spacer" />

      <div className="slot">
        <Clock />
        {children}
      </div>

      <div className="slot">
        <button
          className="btn btn-ghost"
          title="Sign out"
          onClick={async () => {
            await createClient().auth.signOut();
            router.replace("/login");
          }}
        >
          <LogOut size={16} />
          <span className="hidden md:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}