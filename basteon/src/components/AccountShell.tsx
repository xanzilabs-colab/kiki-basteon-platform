"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { KikiMark } from "@/components/KikiMark";

const links = [{ href: "/account", label: "Overview" }, { href: "/account/devices", label: "Devices" }, { href: "/account/profile", label: "Profile" }];

export function AccountShell({ name, children }: { name: string; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  async function signOut() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
  return (
    <div className="account-shell min-h-screen bg-[var(--bg)] md:grid md:h-screen md:grid-cols-[216px_1fr] md:overflow-hidden">
      <aside className="sidebar hidden md:flex md:min-h-0 md:flex-col">
        <div className="sidebar-head">
          <KikiMark size={34} />
          <span>KIKI CONNECT</span>
        </div>
        <nav className="py-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="sidebar-link"
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <button className="btn btn-ghost m-3 mt-auto" onClick={() => void signOut()}>
          Sign out
        </button>
      </aside>

      <div className="min-w-0 pb-16 md:min-h-0 md:overflow-y-auto md:pb-0">
        <header className="appbar px-4">
          <b className="tracking-[.1em] md:hidden">KIKI CONNECT</b>
          <span className="muted ml-auto truncate text-xs">{name}</span>
          <button className="btn btn-ghost ml-3 md:hidden" onClick={() => void signOut()}>
            Sign out
          </button>
        </header>
        <main className="mx-auto max-w-4xl p-4 md:p-6">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-14 border-t border-[var(--line)] bg-[var(--chrome)] md:hidden">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="nav-link flex-1 justify-center border-t-2 border-transparent text-xs aria-[current=page]:border-t-[var(--text)]"
            aria-current={pathname === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}