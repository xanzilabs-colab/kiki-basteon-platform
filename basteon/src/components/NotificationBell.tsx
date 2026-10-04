"use client";

import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, Handshake } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type NotificationItem = { id: string; type: string; title: string; body: string; href: string | null; read: boolean; createdAt: string };

const POLL_MS = 30_000;

export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const playAlert = useCallback(() => {
    navigator.vibrate?.(120);
    const ctx = audio.current;
    if (!ctx) return;
    void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.setValueAtTime(1320, start + 0.14);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.34);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { notifications?: NotificationItem[]; unreadCount?: number };
      const next = data.notifications ?? [];
      const previous = known.current;
      known.current = new Set(next.map((item) => item.id));
      setItems(next);
      setUnread(data.unreadCount ?? 0);
      if (previous && next.some((item) => !item.read && !previous.has(item.id))) playAlert();
    } catch { /* offline: keep the last inbox */ }
  }, [playAlert]);

  useEffect(() => {
    // Browsers only allow audio after a user gesture, so unlock the context on the first one.
    const unlock = () => {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!audio.current && AudioCtor) audio.current = new AudioCtor();
      void audio.current?.resume().catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function markRead(body: { id: string } | { all: true }) {
    void fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
  }

  function openItem(item: NotificationItem) {
    setOpen(false);
    if (!item.read) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
      setUnread((count) => Math.max(0, count - 1));
      markRead({ id: item.id });
    }
    if (item.href && /^\/account(\/|$)/.test(item.href)) router.push(item.href);
  }

  function markAll() {
    setItems((current) => current.map((entry) => ({ ...entry, read: true })));
    setUnread(0);
    markRead({ all: true });
  }

  return (
    <div className="account-notifications" ref={root}>
      <button className="account-header-action" title="Notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) void load(); setOpen(!open); }}>
        <Bell size={17} />
        {unread > 0 && <b className="account-notification-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</b>}
      </button>
      {open && (
        <section className="account-notification-panel" role="dialog" aria-label="Notifications">
          <header>
            <h2>Notifications</h2>
            {unread > 0 && <button type="button" onClick={markAll}><CheckCheck size={14} />Mark all read</button>}
          </header>
          {items.length === 0 ? <p className="account-notification-empty">You&apos;re all caught up.</p> : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={item.read ? undefined : "unread"} onClick={() => openItem(item)}>
                    {item.type === "buddy_bubble" ? <Handshake size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}
                    <span>
                      <b>{item.title}</b>
                      {item.body && <small>{item.body}</small>}
                      <time dateTime={item.createdAt}>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
