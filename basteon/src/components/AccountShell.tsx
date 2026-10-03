"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { House, LogOut, ShieldAlert, Smartphone, UserRound } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KikiMark } from "@/components/KikiMark";

const links = [
  { href: "/account", label: "Overview", icon: House },
  { href: "/account/devices", label: "Devices", icon: Smartphone },
  { href: "/account/profile", label: "Profile", icon: UserRound },
];

export function AccountShell({ name, children }: { name: string; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  const [sosOpen, setSosOpen] = useState(false);
  const [sosBusy, setSosBusy] = useState(false);
  const [sosError, setSosError] = useState("");
  async function signOut() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }

  function location() {
    return new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
      );
    });
  }

  async function triggerSos() {
    setSosBusy(true);
    setSosError("");
    const position = await location();
    const response = await fetch("/api/account/sos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(position ?? {}),
    });
    const result = await response.json().catch(() => ({}));
    setSosBusy(false);
    if (response.ok) {
      setSosOpen(false);
      return;
    }
    setSosError(result.error === "no_active_device" ? "Link an active Kiki device before sending an SOS." : "SOS could not be sent. Please try again or call emergency services.");
  }
  return (
    <div className="account-shell min-h-screen bg-[var(--bg)] md:grid md:h-screen md:grid-cols-[260px_1fr] md:overflow-hidden">
      <aside className="sidebar hidden md:flex md:min-h-0 md:flex-col">
        <div className="sidebar-head">
          <KikiMark size={100} />
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
        <button className="account-desktop-sos btn btn-danger mx-3 mt-auto" onClick={() => setSosOpen(true)}>
          <KikiMark size={48} /> Send SOS
        </button>
        <button className="btn btn-ghost m-3 mt-2" onClick={() => void signOut()}>
          Sign out
        </button>
      </aside>

      <div className="min-w-0 pb-[76px] md:min-h-0 md:overflow-y-auto md:pb-0">
        <header className="appbar account-mobile-appbar px-4">
          <div className="account-mobile-brand md:hidden">
            <KikiMark size={92} />
            <span>KIKI CONNECT</span>
          </div>
          <span className="muted account-user-name ml-auto truncate text-xs" title={name}>{name}</span>
          <button className="btn btn-ghost account-sign-out ml-3 md:hidden" title="Sign out" onClick={() => void signOut()}>
            <LogOut size={17} aria-hidden="true" />
          </button>
        </header>
        <main className="mx-auto max-w-4xl p-5 md:p-6">{children}</main>
      </div>

      <nav className="account-mobile-nav fixed inset-x-0 bottom-0 z-20 flex h-[68px] border-t border-[var(--line)] bg-[var(--chrome)] md:hidden">
        {links.slice(0, 2).map((link) => (
          <Link key={link.href} href={link.href} className="nav-link flex-1 flex-col justify-center gap-1 border-t-2 border-transparent text-[11px] aria-[current=page]:border-t-[var(--text)]" aria-current={pathname === link.href ? "page" : undefined}>
            <link.icon size={18} strokeWidth={2.2} aria-hidden="true" />
            <span>{link.label}</span>
          </Link>
        ))}
        <button className="account-mobile-sos" title="Send SOS" aria-label="Send SOS" onClick={() => setSosOpen(true)}>
          <KikiMark size={108} />
        </button>
        {links.slice(2).map((link) => (
          <Link key={link.href} href={link.href} className="nav-link flex-1 flex-col justify-center gap-1 border-t-2 border-transparent text-[11px] aria-[current=page]:border-t-[var(--text)]" aria-current={pathname === link.href ? "page" : undefined}>
            <link.icon size={18} strokeWidth={2.2} aria-hidden="true" />
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>
      {sosOpen && (
        <div className="account-sos-scrim" role="presentation">
          <section className="account-sos-dialog" role="dialog" aria-modal="true" aria-labelledby="sos-title">
            <span className="account-sos-icon"><ShieldAlert size={30} /></span>
            <h2 id="sos-title">Send an SOS alert?</h2>
            <p>Your active Kiki device and available phone location will be shared with responders.</p>
            {sosError && <p className="account-sos-error" role="alert">{sosError}</p>}
            <div className="account-sos-actions">
              <button className="btn" disabled={sosBusy} onClick={() => setSosOpen(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={sosBusy} onClick={() => void triggerSos()}>{sosBusy ? "Sending..." : "Send SOS"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}