"use client";

import { Activity, HeartPulse, Siren, ShieldAlert } from "lucide-react";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";

const icons = { siren: Siren, "heart-pulse": HeartPulse, activity: Activity } as const;
type Props = { typeCode?: string | null; size?: "row" | "header" | "marker" };

export function AlertTypeBadge({ typeCode, size = "row" }: Props) {
  const catalogue = useEmergencyTypes();
  const normalized = typeCode === "sos" ? "general" : typeCode;
  const emergencyType = catalogue.find((item) => item.code === (normalized ?? "general"));
  const known = emergencyType ?? (normalized == null || normalized === "general" ? catalogue.find((item) => item.code === "general") : null);
  const Icon = known ? icons[known.icon as keyof typeof icons] ?? ShieldAlert : ShieldAlert;
  const tone = known?.tone === "medical"
    ? "border-[#087f70]/50 bg-[#087f70]/15 text-[#50d6c2]"
    : known?.tone === "danger"
      ? "border-[#d93036]/50 bg-[#d93036]/15 text-[#ff777c]"
      : "border-[#686d73] bg-[#2a2d30] text-[#d2d5d8]";
  const label = known?.short_label ?? "Alert";
  const sizeClass = size === "header" ? "min-h-7 px-2.5 text-xs" : size === "marker" ? "min-h-6 px-2 text-[11px]" : "min-h-5 px-1.5 text-[10px]";

  return <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded border font-semibold ${tone} ${sizeClass}`} aria-label={`Alert type: ${known?.label ?? "Alert"}`}><Icon size={size === "header" ? 15 : 13} aria-hidden="true" />{label}</span>;
}