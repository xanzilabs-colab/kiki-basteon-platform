"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bluetooth, BookOpen, Building2, ChartLine, ListChecks, MapPin, Radio, RadioTower, Settings2, ShieldCheck, Siren, Users } from "lucide-react";

const groups = [
  { title: "Operations", links: [
    { name: "Overview", href: "/admin", Icon: ChartLine },
    { name: "Alert audit log", href: "/admin/alerts", Icon: ListChecks },
  ] },
  { title: "Fleet", links: [
    { name: "Devices", href: "/admin/devices", Icon: Radio },
    { name: "Bluetooth triggers", href: "/admin/triggers", Icon: Bluetooth },
  ] },
  { title: "People", links: [
    { name: "Users", href: "/admin/users", Icon: Users },
    { name: "Organisations", href: "/admin/organisations", Icon: Building2 },
    { name: "Responder partners", href: "/admin/responders", Icon: Siren },
  ] },
  { title: "Community", links: [
    { name: "Buddies safety", href: "/admin/buddies", Icon: ShieldCheck },
    { name: "Teach moderation", href: "/admin/teach", Icon: BookOpen },
    { name: "Buddy safe spots", href: "/admin/buddy-places", Icon: MapPin },
    { name: "Settings", href: "/admin/settings", Icon: Settings2 },
  ] },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin">
      {groups.map(({ title, links }) => (
        <div className="admin-nav-group" key={title}>
          <div className="admin-nav-heading">{title}</div>
          {links.map(({ name, href, Icon }) => (
            <Link
              key={href}
              href={href}
              title={name}
              aria-label={name}
              className="sidebar-link"
              aria-current={path === href ? "page" : undefined}
            >
              <Icon size={17} />
              <span className="admin-nav-label">{name}</span>
            </Link>
          ))}
        </div>
      ))}
      <div className="admin-nav-console">
        <Link href="/responder" title="Tactical Response" aria-label="Tactical Response" className="sidebar-link">
          <RadioTower size={17} />
          <span className="admin-nav-label">Tactical Response</span>
        </Link>
      </div>
    </nav>
  );
}