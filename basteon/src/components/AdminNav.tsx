"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChartLine, ExternalLink, ListChecks, MapPin, Radio, RadioTower, Settings2, ShieldCheck, Siren, Users } from "lucide-react";

const links = [
  { name: "Overview", href: "/admin", Icon: ChartLine },
  { name: "Devices (Fleet)", href: "/admin/devices", Icon: Radio },
  { name: "Users", href: "/admin/users", Icon: Users },
  { name: "Alert Audit Log", href: "/admin/alerts", Icon: ListChecks },
  { name: "Buddies safety", href: "/admin/buddies", Icon: ShieldCheck },
  { name: "Buddy safe spots", href: "/admin/buddy-places", Icon: MapPin },
  { name: "Organisations", href: "/admin/organisations", Icon: Building2 },
  { name: "Responders (Partners)", href: "/admin/responders", Icon: Siren },
  { name: "Settings", href: "/admin/settings", Icon: Settings2 },
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
        <RadioTower size={17} />
        Tactical Response
      </Link>
    </nav>
  );
}