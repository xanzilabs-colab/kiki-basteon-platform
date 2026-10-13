import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import TriggerLab from "@/components/TriggerLab";

export default function TriggerLabPage() {
  return (
    <div className="kiki-trigger-settings space-y-4">
      <Link className="inline-flex items-center gap-1 text-sm text-[var(--muted)]" href="/account/profile/triggers"><ChevronLeft size={16} />Bluetooth triggers</Link>
      <header><span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">SAFE DEVICE CHECK</span><h1 className="text-2xl font-semibold">Trigger Lab</h1></header>
      <TriggerLab />
    </div>
  );
}
