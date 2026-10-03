"use client";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function Clock() {
  const [t, setT] = useState("");
  useEffect(() => {
    const f = () => setT(new Date().toLocaleTimeString("en-ZA", { hour12: false }));
    f();
    const i = setInterval(f, 1000);
    return () => clearInterval(i);
  }, []);
  return <span className="data text-[12px] muted hidden sm:inline">{t}</span>;
}

export function Navbar({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  return (
    <header className="h-11 flex items-center gap-3 px-3 border-b border-[var(--line)] bg-[var(--surface)] relative z-[1100]">
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 bg-[var(--accent)]" style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
        <b className="text-[13px] font-semibold tracking-[.14em]">BASTEON</b>
        <span className="w-px h-4 bg-[var(--line-strong)] mx-1 hidden sm:block" />
        <span className="label hidden sm:inline">Response Console</span>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <Clock />
        {children}
        <button className="btn !px-2" title="Sign out" onClick={async () => { await createClient().auth.signOut(); router.replace("/login"); }}>
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}