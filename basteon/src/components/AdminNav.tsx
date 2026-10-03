"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, LayoutDashboard, ScrollText, Smartphone, Users } from "lucide-react";

const links = [
  { name: "Overview", href: "/admin", Icon: LayoutDashboard },
  { name: "Devices", href: "/admin/devices", Icon: Smartphone },
  { name: "Users", href: "/admin/users", Icon: Users },
  { name: "Alert audit", href: "/admin/alerts", Icon: ScrollText },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap py-2 md:flex-col" aria-label="Admin">
      {links.map(({ name, href, Icon }) => (
        <Link
          key={href}
          href={href}
          className="sidebar-link flex-1 whitespace-nowrap md:flex-none"
          aria-current={path === href ? "page" : undefined}
        >
          <Icon size={17} />
          {name}
        </Link>
      ))}
      <div className="my-2 border-t border-[var(--line)] hidden md:block" />
      <Link href="/responder" className="sidebar-link flex-1 whitespace-nowrap md:flex-none">
        <ExternalLink size={17} />
        Response console
      </Link>
    </nav>
  );
}