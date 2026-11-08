"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";

const pageNames: Record<string, string> = {
  "/admin": "Overview",
  "/admin/alerts": "Alert audit log",
  "/admin/devices": "Devices",
  "/admin/triggers": "Bluetooth triggers",
  "/admin/users": "Users",
  "/admin/organisations": "Organisations",
  "/admin/responders": "Responder partners",
  "/admin/buddies": "Buddies safety",
  "/admin/teach": "Teach moderation",
  "/admin/buddy-places": "Buddy safe spots",
  "/admin/settings": "Settings",
};

export function AdminTopBar() {
  const pathname = usePathname();
  const title = pageNames[pathname] ?? "Platform admin";

  return (
    <header className="admin-topbar">
      <div className="admin-breadcrumb">Platform admin <span aria-hidden="true">/</span> <strong>{title}</strong></div>
      <span className="admin-topbar-spacer" />
      <span className="admin-live">Live</span>
      <button className="btn admin-refresh" type="button" aria-label="Refresh admin page" onClick={() => window.location.reload()}>
        <RefreshCw size={14} /><span className="admin-refresh-label">Refresh</span>
      </button>
      <Link className="btn btn-primary" href="/responder" target="_blank" rel="noreferrer" aria-label="Open response console">
        <span className="admin-console-label">Open response console</span><ExternalLink size={14} />
      </Link>
    </header>
  );
}
