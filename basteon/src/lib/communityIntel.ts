import { distanceM } from "@/lib/hamba/geometry";

export type IntelKind = "unsafe_area" | "poor_lighting" | "harassment" | "road_hazard";
export type IntelStatus = "unverified" | "corroborated" | "verified" | "rejected";
export type IntelZone = "near" | "outer";

export type IntelRecord = {
  id: string;
  kind: IntelKind;
  lat: number;
  lng: number;
  summary: string;
  status: IntelStatus;
  reporterId?: string | null;
  incidentAt: string;
  expiresAt: string;
};

export type IntelConfig = { outerM: number; nearM: number; cooldownMs: number; corroborationRadiusM: number };

export const intelConfig = (env: Record<string, string | undefined> = process.env): IntelConfig => {
  const num = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };
  const outerM = num(env.SAFETY_INTEL_OUTER_RADIUS_M, 1000, 200, 5000);
  const nearM = Math.min(num(env.SAFETY_INTEL_NEAR_RADIUS_M, 300, 50, 2000), outerM);
  return {
    outerM,
    nearM,
    cooldownMs: num(env.SAFETY_INTEL_COOLDOWN_MIN, 120, 5, 1440) * 60_000,
    corroborationRadiusM: 300,
  };
};

const TTL_HOURS: Record<IntelKind, number> = { unsafe_area: 12, poor_lighting: 72, harassment: 6, road_hazard: 24 };

export const intelExpiry = (kind: IntelKind, from: Date) => new Date(from.getTime() + TTL_HOURS[kind] * 3_600_000);

/** Removes contact details and identifiers so the stored summary cannot identify a person. */
export function sanitizeSummary(input: string | null | undefined, max = 140) {
  const cleaned = (input ?? "")
    .normalize("NFKC")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/@\w+/g, "[handle]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

/** Roughly 110 m precision so the exact reporter position is never stored on the intelligence record. */
export const coarsen = (value: number) => Math.round(value * 1000) / 1000;

export const isActive = (record: Pick<IntelRecord, "status" | "expiresAt">, now = Date.now()) =>
  record.status !== "rejected" && new Date(record.expiresAt).getTime() > now;

export function freshness(incidentAt: string, now = Date.now()): "just now" | "earlier today" | "older" {
  const age = now - new Date(incidentAt).getTime();
  if (age <= 2 * 3_600_000) return "just now";
  if (age <= 24 * 3_600_000) return "earlier today";
  return "older";
}

/** Distinct reporters near this record for the same kind; a single person reporting twice is not corroboration. */
export function corroboration(record: IntelRecord, all: IntelRecord[], cfg: IntelConfig, now = Date.now()) {
  const reporters = new Set<string>();
  for (const other of all) {
    if (other.kind !== record.kind || !isActive(other, now)) continue;
    if (distanceM(record, other) > cfg.corroborationRadiusM) continue;
    reporters.add(other.reporterId ?? other.id);
  }
  return reporters.size;
}

export function classifyZone(meters: number, cfg: IntelConfig): IntelZone | null {
  if (meters <= cfg.nearM) return "near";
  if (meters <= cfg.outerM) return "outer";
  return null;
}

export type AlertHistory = { recordId: string; zone: IntelZone; sentAt: number }[];

/** Dedupe per record/zone, suppress while a recent alert exists for the same kind nearby, and allow near after outer. */
export function shouldAlert(record: IntelRecord, zone: IntelZone, history: AlertHistory, cfg: IntelConfig, now = Date.now()) {
  if (!isActive(record, now)) return false;
  return !history.some((entry) => entry.recordId === record.id && entry.zone === zone && now - entry.sentAt < cfg.cooldownMs);
}

const LABEL: Record<IntelKind, string> = {
  unsafe_area: "an unsafe area",
  poor_lighting: "poor lighting",
  harassment: "harassment",
  road_hazard: "a road hazard",
};

/** Wording stays neutral: reports are community-submitted, so we only say "verified" or "multiple" when that is true. */
export function buildMessage(record: IntelRecord, zone: IntelZone, count: number, now = Date.now()) {
  const when = freshness(record.incidentAt, now);
  const source = record.status === "verified" ? "A verified report" : count > 1 ? `${count} community reports` : "A community report";
  const where = zone === "near" ? "close to you" : "in your area";
  return {
    title: zone === "near" ? "Community report nearby" : "Community report in your area",
    body: `${source} (${when}) mentions ${LABEL[record.kind]} ${where}. ${record.status === "verified" ? "" : "This hasn't been independently confirmed. "}Stay aware of your surroundings.`,
  };
}
