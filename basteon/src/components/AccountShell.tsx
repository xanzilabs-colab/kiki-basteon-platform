"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const links = [{ href: "/account", label: "Overview" }, { href: "/account/devices", label: "Devices" }, { href: "/account/profile", label: "Profile" }];

export function AccountShell({ name, children }: { name: string; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  async function signOut() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
  return <div className="min-h-screen md:grid md:grid-cols-[216px_1fr] bg-[var(--bg)]"><aside className="hidden md:flex flex-col border-r border-[var(--line)] bg-[var(--surface)]"><div className="h-12 px-4 flex items-center gap-2 border-b border-[var(--line)]"><b className="tracking-[.14em]">BASTEON</b></div><nav className="py-2">{links.map((link) => <Link key={link.href} href={link.href} className="nav-link" aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}</nav><button className="btn btn-danger m-3 mt-auto" onClick={() => void signOut()}>Sign out</button></aside><div className="min-w-0 pb-16 md:pb-0"><header className="h-12 px-4 border-b border-[var(--line)] bg-[var(--surface)] flex items-center justify-between"><b className="tracking-[.14em] md:hidden">BASTEON</b><span className="muted text-xs ml-auto truncate">{name}</span><button className="btn ml-3 md:hidden" onClick={() => void signOut()}>Sign out</button></header><main className="max-w-4xl mx-auto p-4 md:p-6">{children}</main></div><nav className="fixed z-20 bottom-0 inset-x-0 h-14 bg-[var(--surface)] border-t border-[var(--line)] flex md:hidden">{links.map((link) => <Link key={link.href} href={link.href} className="flex-1 grid place-items-center text-xs text-[var(--muted)]" aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}</nav></div>;
}