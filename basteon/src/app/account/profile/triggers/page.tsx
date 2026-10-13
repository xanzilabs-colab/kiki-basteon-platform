import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import EarbudTriggerCard from "@/components/EarbudTriggerCard";

export default function TriggerSettingsPage() {
  return (
    <div className="kiki-trigger-settings space-y-4">
      <Link className="inline-flex items-center gap-1 text-sm text-[var(--muted)]" href="/account/profile"><ChevronLeft size={16} />Profile settings</Link>
      <header><span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">ANDROID SAFETY</span><h1 className="text-2xl font-semibold">Bluetooth triggers</h1></header>
      <EarbudTriggerCard />
    </div>
  );
}
