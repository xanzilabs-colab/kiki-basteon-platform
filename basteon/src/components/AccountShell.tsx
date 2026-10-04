"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { House, LogOut, Menu, PhoneCall, PhoneOff, Route, ShieldAlert, Smartphone, UserRound, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KikiMark } from "@/components/KikiMark";
import { primeRingtone, startRingtone } from "@/lib/ringtone";

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
  const [safetyCall, setSafetyCall] = useState<"idle" | "arming" | "incoming" | "active">("idle");
  const [callSeconds, setCallSeconds] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [ringtoneUrl, setRingtoneUrl] = useState<string | null>(null);
  async function signOut() {
    await fetch("/api/verification/device/logout", { method: "POST" });
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function loadRingtone() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("ringtone_path,ringtone_id").eq("id", user.id).single();
    let storagePath = profile?.ringtone_path;
    if (!storagePath && profile?.ringtone_id) {
      const { data: ringtone } = await supabase.from("ringtones").select("storage_path").eq("id", profile.ringtone_id).maybeSingle();
      storagePath = ringtone?.storage_path;
    }
    if (!storagePath) return setRingtoneUrl(null);
    const { data } = await supabase.storage.from("kiki-ringtones").createSignedUrl(storagePath, 3_600);
    setRingtoneUrl(data?.signedUrl ?? null);
  }

  useEffect(() => {
    if (safetyCall !== "arming") return;
    const timer = window.setTimeout(() => {
      setSafetyCall("incoming");
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [safetyCall]);

  useEffect(() => {
    if (safetyCall !== "incoming") return;
    const vibrate = () => navigator.vibrate?.([350, 180, 350, 1_100]);
    vibrate();
    const timer = window.setInterval(vibrate, 1_980);
    return () => {
      window.clearInterval(timer);
      navigator.vibrate?.(0);
    };
  }, [safetyCall]);

  useEffect(() => {
    void loadRingtone();
  }, []);

  useEffect(() => {
    if (safetyCall !== "incoming") return;
    return startRingtone(ringtoneUrl);
  }, [ringtoneUrl, safetyCall]);

  useEffect(() => {
    if (safetyCall !== "active") {
      setCallSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setCallSeconds((current) => current + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [safetyCall]);

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

  async function startSafetyCall() {
    if (safetyCall === "idle") {
      primeRingtone(ringtoneUrl);
      setSafetyCall("arming");
    }
  }

  const callDuration = `${String(Math.floor(callSeconds / 60)).padStart(2, "0")}:${String(callSeconds % 60).padStart(2, "0")}`;
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
          <Link href="/account/trips" className="sidebar-link" aria-current={pathname === "/account/trips" ? "page" : undefined}>Trips</Link>
          <Link href="/account/buddies" className="sidebar-link" aria-current={pathname === "/account/buddies" ? "page" : undefined}><UsersRound size={18} /> Buddies</Link>
        </nav>
        <button className="account-desktop-sos btn btn-danger mx-3 mt-auto" onClick={() => setSosOpen(true)}>
          <KikiMark size={48} /> Send SOS
        </button>
        <button className="account-desktop-call btn mx-3 mt-2" onClick={() => void startSafetyCall()}>
          <PhoneCall size={18} /> Safety call
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
          <div className="account-user-summary" title={name}>
            <span className="account-user-label">Signed in as</span>
            <span className="account-user-name">{name}</span>
          </div>
          <button className="btn btn-ghost account-sign-out md:hidden" title="Sign out" onClick={() => void signOut()}>
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
        <button className="account-mobile-more nav-link flex-1 flex-col justify-center gap-1 border-t-2 border-transparent text-[11px]" title="More options" aria-label="Open more options" onClick={() => setMoreOpen(true)}>
          <Menu size={20} strokeWidth={2.2} aria-hidden="true" />
          <span>More</span>
        </button>
        {links.slice(2).map((link) => (
          <Link key={link.href} href={link.href} className="nav-link flex-1 flex-col justify-center gap-1 border-t-2 border-transparent text-[11px] aria-[current=page]:border-t-[var(--text)]" aria-current={pathname === link.href ? "page" : undefined}>
            <link.icon size={18} strokeWidth={2.2} aria-hidden="true" />
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>
      {moreOpen && (
        <div className="account-more-scrim" role="presentation" onClick={() => setMoreOpen(false)}>
          <section className="account-more-sheet" role="dialog" aria-modal="true" aria-label="More account options" onClick={(event) => event.stopPropagation()}>
            <button className="account-more-option" onClick={() => { setMoreOpen(false); router.push("/account/trips"); }}><span><Route size={20} /> Trips</span><small>Hamba travel safety</small></button>
            <button className="account-more-option" onClick={() => { setMoreOpen(false); router.push("/account/buddies"); }}><span><UsersRound size={20} /> Buddies</span><small>Find safer travel company</small></button>
            <button className="account-more-option" onClick={() => { setMoreOpen(false); void startSafetyCall(); }}><span><PhoneCall size={20} /> Safety call</span><small>Start a discreet in-app call</small></button>
            <button className="btn w-full" onClick={() => setMoreOpen(false)}>Close</button>
          </section>
        </div>
      )}
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
      {safetyCall === "incoming" && (
        <section className="safety-call-screen" role="dialog" aria-modal="true" aria-label="Incoming safety call">
          <div className="safety-call-caller">
            <span className="safety-call-avatar"><PhoneCall size={36} /></span>
            <p>INCOMING CALL</p>
            <h2>Kiki Care</h2>
            <span>Safety check-in</span>
          </div>
          <div className="safety-call-actions">
            <button className="safety-call-decline" onClick={() => setSafetyCall("idle")}><PhoneOff size={25} /><span>Decline</span></button>
            <button className="safety-call-answer" onClick={() => setSafetyCall("active")}><PhoneCall size={25} /><span>Answer</span></button>
          </div>
        </section>
      )}
      {safetyCall === "active" && (
        <section className="safety-call-screen safety-call-active" role="dialog" aria-modal="true" aria-label="Safety call in progress">
          <div className="safety-call-caller">
            <span className="safety-call-avatar"><PhoneCall size={36} /></span>
            <p>KIKI CARE</p>
            <h2>{callDuration}</h2>
            <span>Connected</span>
          </div>
          <button className="safety-call-decline" onClick={() => setSafetyCall("idle")}><PhoneOff size={25} /><span>End call</span></button>
        </section>
      )}
    </div>
  );
}