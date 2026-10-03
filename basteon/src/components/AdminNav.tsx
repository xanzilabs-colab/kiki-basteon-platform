"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [["Overview", "/admin"], ["Devices", "/admin/devices"], ["Users", "/admin/users"], ["Alert audit", "/admin/alerts"]];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex md:flex-col">
      {links.map(([name, href]) => (
        <Link key={href} href={href} className="nav-link" aria-current={path === href ? "page" : undefined}>{name}</Link>
      ))}
      <div className="my-2 border-t border-[var(--line)] hidden md:block" />
      <Link href="/responder" className="nav-link">Ops console ↗</Link>
    </nav>
  );
}